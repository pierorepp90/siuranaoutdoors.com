// Meta Pixel + cookie consent. Loaded on every page, before main.js.
//
// Inert until SIURANA_PIXEL_ID is filled in: no banner, no fbevents.js, no
// cookies. The pixel has to be created in the business owner's own Meta
// Business Manager; once it exists, paste its numeric ID below and every
// event already wired in main.js starts reaching Meta - but only for
// visitors who accepted the cookie banner, since advertising cookies need
// prior consent in Spain (LSSI art. 22.2).
//
// Debug: open any page with ?meta_debug=1 to log every event to the console
// (and preview the banner) even without a pixel ID. The flag sticks for the
// tab, so it survives the round-trip through Stripe; ?meta_debug=0 clears it.
var SIURANA_PIXEL_ID = '';

// Stable product label for every event. Audiences and custom conversions
// get built on this string, so it must never change - renaming it silently
// empties anything already built on the old one.
var SIURANA_PRODUCT = {
  id: 'magnesio-250g',
  name: 'Magnesio Siurana Outdoors 250g',
  unitPrice: 8
};

window.siuranaMeta = (function () {
  var CONSENT_KEY = 'siuranaConsent';
  var CONSENT_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000; // ask again after a year
  var isEnglish = document.documentElement.lang === 'en';
  var isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  var loaded = false;
  // Events fired on this page before the visitor answered the banner. If they
  // accept, these are sent then, so the page they are on still counts; if
  // they reject, they are dropped and nothing ever leaves the browser.
  var pageEvents = [];

  var debug = false;
  try {
    var flag = new URLSearchParams(location.search).get('meta_debug');
    if (flag === '1') sessionStorage.setItem('siuranaMetaDebug', '1');
    if (flag === '0') sessionStorage.removeItem('siuranaMetaDebug');
    debug = sessionStorage.getItem('siuranaMetaDebug') === '1';
  } catch (e) { /* storage blocked - debug stays off */ }

  // Also kept in sessionStorage ('siuranaMetaLog'), so the whole journey of
  // the tab - Stripe round-trip included - can be read back in one place.
  function log() {
    if (!debug) return;
    var args = [].slice.call(arguments);
    console.log.apply(console, ['[meta]', location.pathname].concat(args));
    try {
      var saved = JSON.parse(sessionStorage.getItem('siuranaMetaLog') || '[]');
      saved.push([location.pathname].concat(JSON.parse(JSON.stringify(args))));
      sessionStorage.setItem('siuranaMetaLog', JSON.stringify(saved.slice(-50)));
    } catch (e) {}
  }

  function readConsent() {
    try {
      var saved = JSON.parse(localStorage.getItem(CONSENT_KEY));
      if (saved && (Date.now() - saved.t) < CONSENT_MAX_AGE_MS) return saved.v;
    } catch (e) { /* no valid answer stored */ }
    return null;
  }

  function saveConsent(value) {
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ v: value, t: Date.now() })); } catch (e) {}
  }

  function canSend() {
    return !!SIURANA_PIXEL_ID && readConsent() === 'granted' && !isLocal;
  }

  function loadPixel() {
    if (loaded || !canSend()) return;
    loaded = true;
    /* eslint-disable */
    !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
    n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
    document,'script','https://connect.facebook.net/en_US/fbevents.js');
    /* eslint-enable */
    window.fbq('init', SIURANA_PIXEL_ID);
    window.fbq('track', 'PageView');
  }

  function send(name, params, eventId) {
    var options = eventId ? { eventID: eventId } : undefined;
    log('send', name, params, options || '');
    if (!canSend()) return;
    loadPixel();
    window.fbq('track', name, params, options);
  }

  // Standard events only (ViewContent, InitiateCheckout, AddPaymentInfo,
  // Purchase, Contact). eventId matters for Purchase: the same id will be
  // used by a future server-side (Conversions API) copy, so Meta keeps one.
  function track(name, params, eventId) {
    if (readConsent() === null && SIURANA_PIXEL_ID) {
      pageEvents.push([name, params, eventId]);
      log('queued until the banner is answered', name, params);
      return;
    }
    send(name, params, eventId);
  }

  // Attaches the buyer's details to the events that follow, which is what
  // lets Meta match a purchase to a real account (Event Match Quality).
  // Sent in plain text on purpose: fbevents.js hashes it itself, and hashing
  // here too would make it hash a hash, which matches nothing.
  function identify(user) {
    var data = {};
    var email = String(user.email || '').trim().toLowerCase();
    var phone = String(user.phone || '').replace(/\D/g, '');
    if (phone.length === 9) phone = '34' + phone; // Spanish number typed without prefix
    var firstName = String(user.firstName || '').trim().toLowerCase();
    var lastName = String(user.lastName || '').trim().toLowerCase();
    if (email) data.em = email;
    if (phone) data.ph = phone;
    if (firstName) data.fn = firstName;
    if (lastName) data.ln = lastName;
    log('identify', data);
    if (!canSend()) return;
    loadPixel();
    window.fbq('init', SIURANA_PIXEL_ID, data);
  }

  // Common product fields, so every event says which product and how much.
  function productParams(quantity, extra) {
    var qty = quantity || 1;
    var params = {
      content_ids: [SIURANA_PRODUCT.id],
      content_name: SIURANA_PRODUCT.name,
      content_type: 'product',
      contents: [{ id: SIURANA_PRODUCT.id, quantity: qty, item_price: SIURANA_PRODUCT.unitPrice }],
      num_items: qty,
      // Product only, shipping excluded: an order is worth the same whether
      // it's shipped or picked up.
      value: Math.round(qty * SIURANA_PRODUCT.unitPrice * 100) / 100,
      currency: 'EUR',
      site_lang: isEnglish ? 'en' : 'es'
    };
    for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) params[k] = extra[k]; }
    return params;
  }

  function answer(value) {
    saveConsent(value);
    var banner = document.getElementById('cookie-banner');
    if (banner) banner.remove();
    if (value === 'granted') {
      loadPixel();
      pageEvents.forEach(function (ev) { send(ev[0], ev[1], ev[2]); });
    }
    pageEvents = [];
  }

  function showBanner() {
    var banner = document.createElement('div');
    banner.id = 'cookie-banner';
    banner.className = 'cookie-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Cookies');
    var policyUrl = isEnglish ? '/en/privacy/' : '/privacidad/';
    banner.innerHTML = isEnglish
      ? '<p>We use Meta cookies to see whether our ads work. They only switch on if you accept; the site works the same if you don\'t. <a href="' + policyUrl + '">More info</a>.</p>'
        + '<div class="cookie-actions"><button type="button" data-consent="granted">Accept</button><button type="button" data-consent="denied">Reject</button></div>'
      : '<p>Usamos cookies de Meta para saber si nuestros anuncios funcionan. Sólo se activan si aceptas; la web funciona igual si no. <a href="' + policyUrl + '">Más información</a>.</p>'
        + '<div class="cookie-actions"><button type="button" data-consent="granted">Aceptar</button><button type="button" data-consent="denied">Rechazar</button></div>';
    banner.addEventListener('click', function (e) {
      var value = e.target.getAttribute && e.target.getAttribute('data-consent');
      if (value) answer(value);
    });
    document.body.appendChild(banner);
  }

  // Lets the privacy page offer a "change my cookie choice" link.
  function resetConsent() {
    try { localStorage.removeItem(CONSENT_KEY); } catch (e) {}
    location.reload();
  }

  document.addEventListener('DOMContentLoaded', function () {
    var consent = readConsent();
    if (consent === 'granted') loadPixel();
    // No pixel means no advertising cookies, so there is nothing to ask
    // about yet. In debug mode the banner shows anyway, to preview it.
    if (consent === null && (SIURANA_PIXEL_ID || debug)) showBanner();
    log('pixel', SIURANA_PIXEL_ID || '(not set)', '| consent', consent, '| local', isLocal);
  });

  return { track: track, identify: identify, productParams: productParams, resetConsent: resetConsent };
})();
