// Cloudflare Worker for Siurana Outdoors. Two jobs, routed by pathname:
//   (any path except /send-order-emails) - creates a Stripe Checkout Session
//     with the exact quantity and (optional) shipping fee baked in, so the
//     amount charged always matches what the customer saw on the order page
//     - a static Stripe Payment Link can't do this (adjustable quantity
//     multiplies a single fixed price; it has no way to conditionally add a
//     shipping line item). Kept path-agnostic since main.js already calls
//     this Worker's bare URL with no path.
//   /send-order-emails - sends the two Resend notification emails (customer
//     thank-you + business order alert). Deployed separately from the
//     static site (GitHub Pages can't run this) via `wrangler deploy`.

const ALLOWED_ORIGINS = [
  'https://siuranaoutdoors.com',
  'https://www.siuranaoutdoors.com',
  'https://pierorepp90.github.io'
];

const UNIT_AMOUNT_CENTS = 800;   // 8.00 EUR per bag
const SHIPPING_AMOUNT_CENTS = 299; // 2.99 EUR flat shipping fee
const BUSINESS_EMAIL = 'siuranaoutdoors@outlook.com';
// Must be on a domain verified in Resend, or sending will fail - see the
// setup notes given alongside this change.
const FROM_EMAIL = 'Siurana Outdoors <info@siuranaoutdoors.com>';

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

async function handleCreateCheckoutSession(body, env, origin) {
  var quantity = parseInt(body.quantity, 10);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return jsonResponse({ error: 'Invalid quantity' }, 400, origin);
  }

  var shipping = body.delivery === 'shipping';
  var lang = body.lang === 'en' ? 'en' : 'es';
  // Hardcoded to the custom domain on purpose (not derived from the request
  // origin): the site's GitHub Pages default URL serves under a
  // /siuranaoutdoors.com/ path prefix, which would make a same-logic
  // derivation wrong. Real payments should only run once DNS points here.
  var siteBase = 'https://siuranaoutdoors.com';
  var siteRoot = lang === 'en' ? siteBase + '/en' : siteBase;

  var params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', siteRoot + '/order-success/?session_id={CHECKOUT_SESSION_ID}');
  params.append('cancel_url', lang === 'en' ? siteBase + '/en/order/' : siteBase + '/pedido/');
  params.append('line_items[0][price_data][currency]', 'eur');
  params.append('line_items[0][price_data][product_data][name]',
    lang === 'en' ? 'Siurana Outdoors climbing chalk (250g)' : 'Magnesio Siurana Outdoors (250g)');
  params.append('line_items[0][price_data][unit_amount]', String(UNIT_AMOUNT_CENTS));
  params.append('line_items[0][quantity]', String(quantity));

  if (shipping) {
    params.append('line_items[1][price_data][currency]', 'eur');
    params.append('line_items[1][price_data][product_data][name]', lang === 'en' ? 'Shipping' : 'Envío');
    params.append('line_items[1][price_data][unit_amount]', String(SHIPPING_AMOUNT_CENTS));
    params.append('line_items[1][quantity]', '1');
  }

  var stripeRes;
  try {
    stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.STRIPE_SECRET_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
  } catch (e) {
    return jsonResponse({ error: 'Could not reach Stripe' }, 502, origin);
  }

  var session = await stripeRes.json();
  if (!stripeRes.ok) {
    return jsonResponse({ error: (session.error && session.error.message) || 'Stripe error' }, 502, origin);
  }

  return jsonResponse({ url: session.url }, 200, origin);
}

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

async function handleSendOrderEmails(body, env, origin) {
  var lang = body.lang === 'en' ? 'en' : 'es';
  var name = String(body.name || '').slice(0, 200);
  var email = String(body.email || '').slice(0, 200);
  var phone = String(body.phone || '').slice(0, 100);
  var quantity = String(body.quantity || '').slice(0, 20);
  var deliverySummary = String(body.deliverySummary || '').slice(0, 300);
  var total = String(body.total || '').slice(0, 30);
  var paymentMethod = body.paymentMethod === 'bizum' ? 'Bizum (confirmar datos)'
    : body.paymentMethod === 'cash' ? 'Efectivo al retirar'
    : 'Tarjeta (pagado por Stripe)';

  if (!email) return jsonResponse({ error: 'Missing customer email' }, 400, origin);

  var customerHtml = lang === 'en'
    ? '<div style="font-family:sans-serif;color:#26323f;line-height:1.6;">'
      + '<p>Thank you for your purchase!</p>'
      + "<p>We've received and confirmed your order.</p>"
      + "<p>We'll start preparing your order soon and will keep you posted along the way. If you have any questions or need help, we're happy to assist.</p>"
      + '<p>We hope you enjoy your purchase!</p>'
      + '</div>'
    : '<div style="font-family:sans-serif;color:#26323f;line-height:1.6;">'
      + '<p>¡Gracias por tu compra!</p>'
      + '<p>Hemos recibido y confirmado tu pedido correctamente.</p>'
      + '<p>Muy pronto comenzaremos a preparar tu pedido y te mantendremos informado sobre el proceso. Si tienes alguna duda o necesitas ayuda, estaremos encantados de atenderte.</p>'
      + '<p>¡Esperamos que disfrutes tu compra!</p>'
      + '</div>';

  var businessHtml = '<div style="font-family:sans-serif;color:#26323f;line-height:1.6;">'
    + '<p><strong>Nuevo pedido recibido</strong></p>'
    + '<p>Nombre: ' + escapeHtml(name) + '<br>'
    + 'Teléfono: ' + escapeHtml(phone) + '<br>'
    + 'Email: ' + escapeHtml(email) + '<br>'
    + 'Cantidad: ' + escapeHtml(quantity) + '<br>'
    + escapeHtml(deliverySummary) + '<br>'
    + 'Total: ' + escapeHtml(total) + '<br>'
    + 'Pago: ' + escapeHtml(paymentMethod) + '</p>'
    + '</div>';

  var results = await Promise.all([
    sendResendEmail(env, {
      from: FROM_EMAIL,
      to: email,
      reply_to: BUSINESS_EMAIL,
      subject: lang === 'en' ? 'Thanks for your order! - Siurana Outdoors' : '¡Gracias por tu compra! - Siurana Outdoors',
      html: customerHtml
    }),
    sendResendEmail(env, {
      from: FROM_EMAIL,
      to: BUSINESS_EMAIL,
      reply_to: email,
      subject: 'Nuevo pedido - Siurana Outdoors',
      html: businessHtml
    })
  ]);

  var failed = results.filter(function (r) { return !r.ok; });
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

    var body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: 'Invalid JSON body' }, 400, origin);
    }

    var pathname = new URL(request.url).pathname;
    if (pathname === '/send-order-emails') {
      return handleSendOrderEmails(body, env, origin);
    }
    return handleCreateCheckoutSession(body, env, origin);
  }
};
