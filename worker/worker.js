// Cloudflare Worker for Siurana Outdoors. Two jobs, routed by pathname:
//   (any path except /send-order-emails) - creates a Stripe Checkout Session
//     with the exact quantity and (optional) shipping fee baked in, so the
//     amount charged always matches what the customer saw on the order page.
//     The order details (name, phone, address...) travel inside the session
//     as metadata, so the confirmation emails are built from what Stripe says
//     was paid, not from what a browser claims.
//   /send-order-emails - sends the two Resend notification emails (customer
//     thank-you + business order alert).
//
// Why /send-order-emails verifies everything (28/09/2026): it used to send
// whatever it was given - recipient, total, free text - so anyone could use
// it to mail arbitrary content from info@siuranaoutdoors.com, and a fake
// "paid by card" order alert could reach the owner. Now:
//   - card orders: only with a Stripe session that is actually paid, using
//     the email, amounts and details stored in that session, and only once
//     (the PaymentIntent is marked emails_sent=1);
//   - Bizum and cash orders: only with a valid Cloudflare Turnstile token,
//     and the total and pickup point are computed here, not trusted;
//   - every POST must come from the shop's own origin.
// Deployed on Manke's Cloudflare account with `wrangler deploy`.

const ALLOWED_ORIGINS = [
  'https://siuranaoutdoors.com',
  'https://www.siuranaoutdoors.com'
];
const TURNSTILE_HOSTNAMES = ['siuranaoutdoors.com', 'www.siuranaoutdoors.com'];

const UNIT_AMOUNT_CENTS = 800;   // 8.00 EUR per bag
const SHIPPING_AMOUNT_CENTS = 299; // 2.99 EUR flat shipping fee
const BUSINESS_EMAIL = 'siuranaoutdoors@outlook.com';
// Must be on a domain verified in Resend, or sending will fail.
const FROM_EMAIL = 'Siurana Outdoors <info@siuranaoutdoors.com>';

// The only pickup points that exist (same list as the order form's select).
const PICKUP_POINTS = {
  'Gavà': 'https://www.google.com/maps/place/41%C2%B018\'13.2%22N+2%C2%B000\'35.6%22E/@41.3036579,2.0073166,17z/data=!3m1!4b1!4m4!3m3!8m2!3d41.3036579!4d2.0098915',
  'Barcelona (Poble Nou)': 'https://www.google.com/maps/place/Raza+Alimentaci%C3%B3n/@41.4161977,2.2108011,17z/data=!3m1!4b1!4m6!3m5!1s0x12a4a34c379c5c1b:0xa8f54bc33366c0a!8m2!3d41.4161977!4d2.2108011!16s%2Fg%2F11cns7l4rz'
};

function corsHeaders(origin) {
  var allowOrigin = ALLOWED_ORIGINS.indexOf(origin) !== -1 ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function jsonResponse(data, status, origin) {
  var headers = corsHeaders(origin);
  headers['Content-Type'] = 'application/json';
  return new Response(JSON.stringify(data), { status: status || 200, headers: headers });
}

// --- The order, read and checked once for every path -----------------------

function cleanText(value, max) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// A web address inside a name or a street address is the one thing a
// spammer needs from this form and no customer does.
function hasLink(s) {
  return /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|ru|xyz|info|top|io|link|click)\b)/i.test(s);
}

function readOrder(body) {
  var order = {
    orderId: cleanText(body.orderId, 40),
    lang: body.lang === 'en' ? 'en' : 'es',
    name: cleanText(body.name, 120),
    phone: cleanText(body.phone, 40),
    email: cleanText(body.email, 200),
    quantity: parseInt(body.quantity, 10),
    delivery: body.delivery === 'shipping' ? 'shipping' : 'pickup',
    address: cleanText(body.address, 300),
    pickupPoint: cleanText(body.pickupPoint, 60)
  };
  var errors = [];
  if (!Number.isInteger(order.quantity) || order.quantity < 1 || order.quantity > 10) errors.push('quantity');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(order.email)) errors.push('email');
  if (!order.name) errors.push('name');
  if (!/^[0-9+()\s.-]{6,40}$/.test(order.phone)) errors.push('phone');
  if (order.delivery === 'shipping' && order.address.length < 5) errors.push('address');
  if (order.delivery === 'pickup' && !PICKUP_POINTS[order.pickupPoint]) errors.push('pickupPoint');
  if (hasLink(order.name) || hasLink(order.address)) errors.push('links');
  if (!/^SO-[A-Z0-9-]{4,30}$/.test(order.orderId)) order.orderId = '';
  return { order: order, errors: errors };
}

function totalCents(order) {
  return order.quantity * UNIT_AMOUNT_CENTS + (order.delivery === 'shipping' ? SHIPPING_AMOUNT_CENTS : 0);
}

function formatEuros(cents, lang) {
  var s = (cents / 100).toFixed(2).replace(/\.00$/, '');
  return lang === 'en' ? '€' + s : s + '€';
}

function deliveryLine(order, lang) {
  if (order.delivery === 'shipping' && !order.address) return lang === 'en' ? 'Shipping (address sent by WhatsApp)' : 'Envío (dirección enviada por WhatsApp)';
  if (order.delivery !== 'shipping' && !PICKUP_POINTS[order.pickupPoint]) return lang === 'en' ? 'Pickup (point sent by WhatsApp)' : 'Recogida (punto enviado por WhatsApp)';
  if (order.delivery === 'shipping') return (lang === 'en' ? 'Ship to: ' : 'Envío a: ') + order.address;
  return (lang === 'en' ? 'Pickup at: ' : 'Recoger en: ') + order.pickupPoint + ' - ' + PICKUP_POINTS[order.pickupPoint];
}

// --- Stripe ------------------------------------------------------------------

async function stripe(env, method, path, params) {
  var res = await fetch('https://api.stripe.com/v1/' + path, {
    method: method,
    headers: {
      'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params ? params.toString() : undefined
  });
  var data = await res.json().catch(function () { return {}; });
  return { ok: res.ok, data: data };
}

async function handleCreateCheckoutSession(body, env, origin) {
  var read = readOrder(body);
  // A page cached from before 28/09/2026 sends only quantity, delivery and
  // lang. Starting a payment is harmless, so it still works; the session
  // just carries no details, and the emails fall back to Stripe's own copy
  // of the customer's email.
  var legacy = !body.email && !body.name && read.errors.every(function (e) {
    return e === 'email' || e === 'name' || e === 'phone' || e === 'address' || e === 'pickupPoint';
  });
  if (legacy) read.errors = [];
  if (read.errors.length) {
    return jsonResponse({ error: 'Invalid order', fields: read.errors }, 400, origin);
  }
  var order = read.order;
  var lang = order.lang;
  // Hardcoded to the custom domain on purpose (not derived from the request
  // origin).
  var siteBase = 'https://siuranaoutdoors.com';
  var siteRoot = lang === 'en' ? siteBase + '/en' : siteBase;

  var params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', siteRoot + '/order-success/?session_id={CHECKOUT_SESSION_ID}');
  params.append('cancel_url', lang === 'en' ? siteBase + '/en/order/' : siteBase + '/pedido/');
  if (order.email) params.append('customer_email', order.email);
  params.append('line_items[0][price_data][currency]', 'eur');
  params.append('line_items[0][price_data][product_data][name]',
    lang === 'en' ? 'Siurana Outdoors climbing chalk (250g)' : 'Magnesio Siurana Outdoors (250g)');
  params.append('line_items[0][price_data][unit_amount]', String(UNIT_AMOUNT_CENTS));
  params.append('line_items[0][quantity]', String(order.quantity));

  if (order.delivery === 'shipping') {
    params.append('line_items[1][price_data][currency]', 'eur');
    params.append('line_items[1][price_data][product_data][name]', lang === 'en' ? 'Shipping' : 'Envío');
    params.append('line_items[1][price_data][unit_amount]', String(SHIPPING_AMOUNT_CENTS));
    params.append('line_items[1][quantity]', '1');
  }

  // Everything the emails need, stored where only a real payment can unlock
  // it (Stripe metadata: 500 characters per value). Also copied onto the
  // PaymentIntent, where it shows up in Stripe's dashboard for the owner.
  var meta = {
    order_id: order.orderId, lang: lang, name: order.name, phone: order.phone,
    email: order.email, quantity: String(order.quantity), delivery: order.delivery,
    address: order.address, pickup_point: order.pickupPoint
  };
  Object.keys(meta).forEach(function (k) {
    if (legacy && k !== 'lang' && k !== 'quantity' && k !== 'delivery') return;
    params.append('metadata[' + k + ']', meta[k]);
    params.append('payment_intent_data[metadata][' + k + ']', meta[k]);
  });

  var created;
  try {
    created = await stripe(env, 'POST', 'checkout/sessions', params);
  } catch (e) {
    return jsonResponse({ error: 'Could not reach Stripe' }, 502, origin);
  }
  if (!created.ok) {
    return jsonResponse({ error: (created.data.error && created.data.error.message) || 'Stripe error' }, 502, origin);
  }
  return jsonResponse({ url: created.data.url }, 200, origin);
}

// --- Turnstile ----------------------------------------------------------------

async function turnstileOk(token, env, ip) {
  if (!token || !env.TURNSTILE_SECRET_KEY) return false;
  var form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET_KEY);
  form.append('response', String(token).slice(0, 2048));
  if (ip) form.append('remoteip', ip);
  try {
    var res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    var data = await res.json();
    return data.success === true && TURNSTILE_HOSTNAMES.indexOf(data.hostname) !== -1;
  } catch (e) {
    return false;
  }
}

// --- Emails ---------------------------------------------------------------------

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

async function sendResendEmail(env, payload) {
  var res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.RESEND_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  var data = await res.json().catch(function () { return {}; });
  return { ok: res.ok, data: data };
}

async function sendOrderEmails(env, order, method, total) {
  var name = order.name;
  var quantity = String(order.quantity);
  var paymentMethod = method === 'bizum' ? 'Bizum (confirmar datos)'
    : method === 'cash' ? 'Efectivo al retirar'
    : 'Tarjeta (pagado por Stripe)';

  var isBizum = method === 'bizum';
  var bizumNoteEs = isBizum
    ? '<p>Para completar el pago por Bizum, envía ' + escapeHtml(total) + ' al <strong>+34 667 89 54 38</strong>, indicando como concepto tu nombre y apellido (' + escapeHtml(name) + ').</p>'
    : '';
  var bizumNoteEn = isBizum
    ? '<p>To complete payment via Bizum, please send ' + escapeHtml(total) + ' to <strong>+34 667 89 54 38</strong>, using your full name (' + escapeHtml(name) + ') as the reference.</p>'
    : '';

  var customerHtml = '<div style="font-family:sans-serif;color:#26323f;line-height:1.6;">'
    + '<p>¡Gracias por tu compra!</p>'
    + '<p>Hemos recibido y confirmado tu pedido correctamente.</p>'
    + '<p>Resumen de tu pedido:<br>'
    + 'Cantidad: ' + escapeHtml(quantity) + '<br>'
    + 'Total: ' + escapeHtml(total) + '<br>'
    + escapeHtml(deliveryLine(order, 'es')) + '</p>'
    + bizumNoteEs
    + '<p>Muy pronto comenzaremos a preparar tu pedido y te mantendremos informado sobre el proceso. Si tienes alguna duda o necesitas ayuda, estaremos encantados de atenderte.</p>'
    + '<p>Ante cualquier consulta o inquietud no dudes en comunicarte con nosotros vía '
    + '<a href="mailto:' + BUSINESS_EMAIL + '" style="color:#a9542f;">email</a> o '
    + '<a href="https://wa.me/34667895438" style="color:#a9542f;">WhatsApp</a>.</p>'
    + '<p>¡Esperamos que disfrutes tu compra!</p>'
    + '<hr style="border:none;border-top:1px solid #d8c4a0;margin:24px 0;">'
    + '<p>Thank you for your purchase!</p>'
    + "<p>We've received and confirmed your order.</p>"
    + '<p>Order summary:<br>'
    + 'Quantity: ' + escapeHtml(quantity) + '<br>'
    + 'Total: ' + escapeHtml(total) + '<br>'
    + escapeHtml(deliveryLine(order, 'en')) + '</p>'
    + bizumNoteEn
    + "<p>We'll start preparing your order soon and will keep you posted along the way. If you have any questions or need help, we're happy to assist.</p>"
    + '<p>If you have any questions or concerns, feel free to reach out to us via '
    + '<a href="mailto:' + BUSINESS_EMAIL + '" style="color:#a9542f;">email</a> or '
    + '<a href="https://wa.me/34667895438" style="color:#a9542f;">WhatsApp</a>.</p>'
    + '<p>We hope you enjoy your purchase!</p>'
    + '</div>';

  var businessHtml = '<div style="font-family:sans-serif;color:#26323f;line-height:1.6;">'
    + '<p><strong>Nuevo pedido recibido</strong></p>'
    + '<p>Nombre: ' + escapeHtml(name) + '<br>'
    + 'Teléfono: ' + escapeHtml(order.phone) + '<br>'
    + 'Email: ' + escapeHtml(order.email) + '<br>'
    + 'Cantidad: ' + escapeHtml(quantity) + '<br>'
    + escapeHtml(deliveryLine(order, 'es')) + '<br>'
    + 'Total: ' + escapeHtml(total) + '<br>'
    + 'Pago: ' + escapeHtml(paymentMethod)
    + (order.orderId ? '<br>Pedido: ' + escapeHtml(order.orderId) : '') + '</p>'
    + '</div>';

  var results = await Promise.all([
    sendResendEmail(env, {
      from: FROM_EMAIL,
      to: order.email,
      reply_to: BUSINESS_EMAIL,
      subject: '¡Gracias por tu compra! / Thank you for your order - Siurana Outdoors',
      html: customerHtml
    }),
    sendResendEmail(env, {
      from: FROM_EMAIL,
      to: BUSINESS_EMAIL,
      reply_to: order.email,
      subject: 'Nuevo pedido - Siurana Outdoors',
      html: businessHtml
    })
  ]);
  return results.filter(function (r) { return !r.ok; });
}

// Card: only a paid Stripe session unlocks the emails, and only once.
async function handleCardEmails(body, env, origin) {
  var sessionId = cleanText(body.sessionId, 200);
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) {
    return jsonResponse({ error: 'Invalid session' }, 400, origin);
  }
  var got = await stripe(env, 'GET', 'checkout/sessions/' + encodeURIComponent(sessionId) + '?expand[]=payment_intent');
  if (!got.ok) return jsonResponse({ error: 'Unknown session' }, 404, origin);
  var session = got.data;
  if (session.payment_status !== 'paid') return jsonResponse({ error: 'Not paid' }, 402, origin);

  var pi = session.payment_intent || {};
  if (pi.metadata && pi.metadata.emails_sent === '1') return jsonResponse({ ok: true, already: true }, 200, origin);

  var m = session.metadata || {};
  var order = {
    orderId: m.order_id || '',
    lang: m.lang === 'en' ? 'en' : 'es',
    name: m.name || '',
    phone: m.phone || '',
    email: m.email || (session.customer_details && session.customer_details.email) || '',
    quantity: parseInt(m.quantity, 10) || 0,
    delivery: m.delivery === 'shipping' ? 'shipping' : 'pickup',
    address: m.address || '',
    pickupPoint: PICKUP_POINTS[m.pickup_point] ? m.pickup_point : ''
  };
  if (!order.email) return jsonResponse({ error: 'Session without email' }, 422, origin);

  var failed = await sendOrderEmails(env, order, 'card', formatEuros(session.amount_total, order.lang));
  if (failed.length) {
    return jsonResponse({ error: 'Resend error', details: failed.map(function (f) { return f.data; }) }, 502, origin);
  }
  if (pi.id) {
    var mark = new URLSearchParams();
    mark.append('metadata[emails_sent]', '1');
    await stripe(env, 'POST', 'payment_intents/' + encodeURIComponent(pi.id), mark).catch(function () {});
  }
  return jsonResponse({ ok: true }, 200, origin);
}

// Bizum and cash: nothing is paid yet, so a person has to be behind it.
async function handleOfflineEmails(body, env, origin, ip) {
  var method = body.paymentMethod === 'bizum' ? 'bizum' : body.paymentMethod === 'cash' ? 'cash' : null;
  if (!method) return jsonResponse({ error: 'Invalid payment method' }, 400, origin);
  if (!(await turnstileOk(body.turnstileToken, env, ip))) {
    return jsonResponse({ error: 'Verification failed' }, 403, origin);
  }
  var read = readOrder(body);
  if (read.errors.length) return jsonResponse({ error: 'Invalid order', fields: read.errors }, 400, origin);
  var order = read.order;
  if (method === 'cash' && order.delivery === 'shipping') {
    return jsonResponse({ error: 'Cash is pickup only' }, 400, origin);
  }
  var failed = await sendOrderEmails(env, order, method, formatEuros(totalCents(order), order.lang));
  if (failed.length) {
    return jsonResponse({ error: 'Resend error', details: failed.map(function (f) { return f.data; }) }, 502, origin);
  }
  return jsonResponse({ ok: true }, 200, origin);
}

export default {
  async fetch(request, env) {
    var origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin) });
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405, origin);
    }
    // CORS only stops browsers on other sites; this also stops scripts that
    // don't send the shop's Origin.
    if (ALLOWED_ORIGINS.indexOf(origin) === -1) {
      return jsonResponse({ error: 'Forbidden origin' }, 403, origin);
    }

    var body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: 'Invalid JSON body' }, 400, origin);
    }
    if (!body || typeof body !== 'object') return jsonResponse({ error: 'Invalid JSON body' }, 400, origin);

    var pathname = new URL(request.url).pathname;
    if (pathname === '/send-order-emails') {
      if (body.sessionId) return handleCardEmails(body, env, origin);
      return handleOfflineEmails(body, env, origin, request.headers.get('CF-Connecting-IP'));
    }
    return handleCreateCheckoutSession(body, env, origin);
  }
};
