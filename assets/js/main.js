document.querySelectorAll('.stage').forEach(function (stage) {
  var btn = stage.querySelector('.btn-crimp');
  var puffWrap = stage.querySelector('.puffWrap');
  if (!btn || !puffWrap) return;
  btn.addEventListener('pointerdown', function () {
    puffWrap.classList.remove('puffing');
    void puffWrap.offsetWidth;
    puffWrap.classList.add('puffing');
  });
});

// A real click on the hero CTA navigates away immediately, cutting off the
// :active/puff animation before it can finish playing - so visitors were
// missing it. Auto-preview it once, 3s after load, using the .js-preview /
// .js-preview-active companion classes defined alongside the :hover/:active
// rules in style.css.
(function () {
  var stage = document.querySelector('.hero .stage');
  if (!stage) return;
  var btn = stage.querySelector('.btn-crimp');
  var puffWrap = stage.querySelector('.puffWrap');
  if (!btn || !puffWrap) return;
  window.setTimeout(function () {
    btn.classList.add('js-preview');
    window.setTimeout(function () {
      btn.classList.add('js-preview-active');
      puffWrap.classList.add('puffing');
      window.setTimeout(function () {
        btn.classList.remove('js-preview', 'js-preview-active');
        puffWrap.classList.remove('puffing');
      }, 650);
    }, 900);
  }, 3000);
})();

// Order page only (guarded on #qty so this is a no-op on every other page
// sharing this same script).
(function () {
  var qtyInput = document.getElementById('qty');
  if (!qtyInput) return;

  var qtyMinus = document.getElementById('qty-minus');
  var qtyPlus = document.getElementById('qty-plus');
  var totalEl = document.getElementById('order-total');
  var stripeLink = document.getElementById('stripe-link');
  var stripeBaseHref = stripeLink.getAttribute('href');
  var bizumBtn = document.getElementById('bizum-btn');
  var addressInput = document.getElementById('address');
  var addressError = document.getElementById('address-error');
  var unitPrice = 8;
  var whatsappNumber = '34667895438';
  var isEnglish = document.documentElement.lang === 'en';

  function currentQty() {
    var n = parseInt(qtyInput.value, 10);
    if (isNaN(n) || n < 1) n = 1;
    if (n > 10) n = 10;
    return n;
  }

  // Stripe Payment Links only honor ?quantity=N if "adjustable quantity" is
  // turned on for that price in the Stripe dashboard - if it isn't, Stripe
  // just ignores the param and checks out at its own default quantity, so
  // this alone doesn't guarantee the charge matches what's shown here.
  function updateTotal() {
    var qty = currentQty();
    qtyInput.value = qty;
    totalEl.textContent = isEnglish ? ('€' + (qty * unitPrice)) : ((qty * unitPrice) + '€');
    if (stripeLink) {
      var sep = stripeBaseHref.indexOf('?') === -1 ? '?' : '&';
      stripeLink.setAttribute('href', stripeBaseHref + sep + 'quantity=' + qty);
    }
  }

  if (qtyMinus) qtyMinus.addEventListener('click', function () { qtyInput.value = currentQty() - 1; updateTotal(); });
  if (qtyPlus) qtyPlus.addEventListener('click', function () { qtyInput.value = currentQty() + 1; updateTotal(); });
  qtyInput.addEventListener('input', updateTotal);
  updateTotal();

  if (bizumBtn) {
    bizumBtn.addEventListener('click', function () {
      var address = addressInput.value.trim();
      if (!address) {
        addressError.hidden = false;
        addressInput.focus();
        return;
      }
      addressError.hidden = true;
      var qty = currentQty();
      var total = qty * unitPrice;
      var text = isEnglish
        ? 'Hi! I want to order ' + qty + (qty === 1 ? ' bag' : ' bags') + ' of Siurana chalk (€' + total + ') and pay by Bizum. Shipping address: ' + address
        : 'Hola! Quiero pedir ' + qty + (qty === 1 ? ' bolsa' : ' bolsas') + ' de magnesio Siurana (' + total + '€) y pagar por Bizum. Dirección de envío: ' + address;
      window.location.href = 'https://wa.me/' + whatsappNumber + '?text=' + encodeURIComponent(text);
    });
  }
})();

document.querySelectorAll('[data-carousel]').forEach(function (carousel) {
  var slides = carousel.querySelectorAll('.carousel-slide');
  var prev = carousel.querySelector('.carousel-prev');
  var next = carousel.querySelector('.carousel-next');
  var idx = 0;
  var dots = [];
  // Shared script loaded by both /index.html (lang="es") and /en/index.html
  // (lang="en") — keep the dot label numeric-only so it reads fine either way
  // instead of hardcoding a single language's text.
  var dotLabel = function (n) { return 'Slide ' + (n + 1); };

  if (slides.length > 1) {
    var dotsWrap = document.createElement('div');
    dotsWrap.className = 'carousel-dots';
    slides.forEach(function (_, n) {
      var dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'carousel-dot';
      dot.setAttribute('aria-label', dotLabel(n));
      dot.addEventListener('click', function () { show(n); });
      dotsWrap.appendChild(dot);
      dots.push(dot);
    });
    carousel.appendChild(dotsWrap);
  }

  function show(i) {
    idx = (i + slides.length) % slides.length;
    slides.forEach(function (slide, n) {
      var active = n === idx;
      slide.classList.toggle('is-active', active);
      var video = slide.querySelector('video');
      if (video) { active ? video.play().catch(function (e) { console.warn('carousel video play failed', e); }) : video.pause(); }
    });
    dots.forEach(function (dot, n) { dot.classList.toggle('is-active', n === idx); });
  }

  if (slides.length <= 1) {
    if (prev) prev.style.display = 'none';
    if (next) next.style.display = 'none';
  } else {
    if (prev) prev.addEventListener('click', function () { show(idx - 1); });
    if (next) next.addEventListener('click', function () { show(idx + 1); });
  }

  show(0);
});
