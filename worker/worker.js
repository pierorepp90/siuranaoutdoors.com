// Cloudflare Worker: creates a Stripe Checkout Session with the exact
// quantity and (optional) shipping fee baked in, so the amount charged
// always matches what the customer saw on the order page - a static
// Stripe Payment Link can't do this (adjustable quantity multiplies a
// single fixed price; it has no way to conditionally add a shipping
// line item). Deployed separately from the static site (GitHub Pages
// can't run this) via `wrangler deploy` - see README.md in this folder.

const ALLOWED_ORIGINS = [
  'https://siuranaoutdoors.com',
  'https://www.siuranaoutdoors.com',
  'https://pierorepp90.github.io'
];

const UNIT_AMOUNT_CENTS = 800;   // 8.00 EUR per bag
const SHIPPING_AMOUNT_CENTS = 299; // 2.99 EUR flat shipping fee

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
};
