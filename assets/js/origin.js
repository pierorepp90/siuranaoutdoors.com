// Where each order came from: a campaign, ChatGPT, Perplexity...
// Loaded on every page, after meta.js (it needs the cookie answer) and
// before main.js (which sends the origin with the order).
//
// Two sources, same as the other sites of the agency that built this:
//   - the utm_ tags of the address. ChatGPT adds utm_source=chatgpt.com by
//     itself to every link it cites;
//   - the Referer, for the assistants that tag nothing (Perplexity, Claude,
//     Gemini, Copilot). Noted as utm_source=<domain>&utm_medium=ia.
//
// The origin reaches the owner inside the order email (worker.js) and in
// the Stripe payment's metadata. It is never shown to the customer.
//
// Storage follows the cookie banner, like the Meta pixel: the origin is
// remembered for 30 days (localStorage) only if the visitor accepted.
// Without that, it still reaches the order page because the "buy" links
// of the page the visitor landed on carry it in their address, which
// stores nothing in the browser. A visitor who rejected and comes back
// another day is not attributed: the count from AI assistants is a
// minimum, not the total.
window.siuranaOrigin = (function () {
  var KEY = 'siuranaOrigin';
  var MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
  var MAX_LENGTH = 300;
  var TAGS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  // Assistants that send visitors, by the domain they come from.
  var ASSISTANTS = {
    'chatgpt.com': 'chatgpt.com',
    'chat.openai.com': 'chatgpt.com',
    'perplexity.ai': 'perplexity.ai',
    'claude.ai': 'claude.ai',
    'gemini.google.com': 'gemini.google.com',
    'copilot.microsoft.com': 'copilot.microsoft.com',
    'chat.mistral.ai': 'mistral.ai',
    'chat.deepseek.com': 'deepseek.com',
    'meta.ai': 'meta.ai',
    'you.com': 'you.com',
    'phind.com': 'phind.com'
  };

  function clean(value) {
    return String(value || '').replace(/[^\w .\-|/+]/g, '').trim().slice(0, 80);
  }

  // "utm_source=chatgpt.com&utm_medium=ia" from an address's query string,
  // only the five standard tags, or null if it has none.
  function fromSearch(search) {
    var params = new URLSearchParams(search || '');
    var out = new URLSearchParams();
    TAGS.forEach(function (tag) {
      var value = clean(params.get(tag));
      if (value) out.set(tag, value);
    });
    var text = out.toString();
    return text ? text.slice(0, MAX_LENGTH) : null;
  }

  // The whole domain or a subdomain of it, never a piece of text:
  // claude.ai.example.com is not Claude.
  function fromReferrer(referrer) {
    if (!referrer) return null;
    var host;
    try { host = new URL(referrer).hostname.toLowerCase(); } catch (e) { return null; }
    for (var domain in ASSISTANTS) {
      if (!Object.prototype.hasOwnProperty.call(ASSISTANTS, domain)) continue;
      if (host === domain || host.slice(-(domain.length + 1)) === '.' + domain) {
        return 'utm_source=' + ASSISTANTS[domain] + '&utm_medium=ia';
      }
    }
    return null;
  }

  function consented() {
    return !!(window.siuranaMeta && window.siuranaMeta.hasConsent && window.siuranaMeta.hasConsent());
  }

  function readSaved() {
    if (!consented()) return null;
    try {
      var saved = JSON.parse(localStorage.getItem(KEY));
      if (saved && typeof saved.v === 'string' && (Date.now() - saved.t) < MAX_AGE_MS) return fromSearch(saved.v);
    } catch (e) { /* nothing valid stored */ }
    return null;
  }

  function save(value) {
    if (!consented()) return;
    try { localStorage.setItem(KEY, JSON.stringify({ v: value, t: Date.now() })); } catch (e) {}
  }

  // The tags of this address always win (a new campaign click is new
  // information). An assistant seen only in the Referer never replaces an
  // origin already remembered, the same way a Google visit doesn't take
  // the credit from an ad seen last week.
  var tagged = fromSearch(location.search);
  var saved = readSaved();
  var assistant = tagged || saved ? null : fromReferrer(document.referrer);
  var current = tagged || saved || assistant;
  if (tagged || assistant) save(current);

  // Carry the origin to the order page in the link itself, so it arrives
  // even when nothing may be stored.
  function decorateOrderLinks() {
    if (!current) return;
    var links = document.querySelectorAll('a[href="/pedido/"], a[href="/en/order/"]');
    for (var i = 0; i < links.length; i++) links[i].setAttribute('href', links[i].getAttribute('href') + '?' + current);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', decorateOrderLinks);
  else decorateOrderLinks();

  return {
    current: function () { return current; },
    fromSearch: fromSearch,
    fromReferrer: fromReferrer
  };
})();
