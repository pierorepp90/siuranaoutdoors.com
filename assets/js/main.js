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
    }, 500);
  }, 3000);
})();

// Order page only (guarded on #order-form so this is a no-op on every
// other page sharing this same script).
(function () {
  var form = document.getElementById('order-form');
  if (!form) return;

  var isEnglish = document.documentElement.lang === 'en';
  var unitPrice = 8;
  var shippingFee = 2.99;
  var whatsappNumber = '34667895438';
  // Update this once the Cloudflare Worker is deployed (see worker/wrangler.toml).
  var CHECKOUT_ENDPOINT = 'https://REPLACE-WITH-YOUR-WORKER-URL.workers.dev';

  var qtyInput = document.getElementById('qty');
  var qtyMinus = document.getElementById('qty-minus');
  var qtyPlus = document.getElementById('qty-plus');
  var totalEl = document.getElementById('order-total');

  var firstNameInput = document.getElementById('first-name');
  var lastNameInput = document.getElementById('last-name');
  var phoneInput = document.getElementById('phone');
  var emailInput = document.getElementById('email');

  var deliveryShipping = document.getElementById('delivery-shipping');
  var deliveryPickup = document.getElementById('delivery-pickup');
  var addressField = document.getElementById('address-field');
  var addressInput = document.getElementById('address');
  var pickupField = document.getElementById('pickup-field');
  var pickupSelect = document.getElementById('pickup-point');

  var paymentCard = document.getElementById('payment-card');
  var paymentBizum = document.getElementById('payment-bizum');
  var paymentCash = document.getElementById('payment-cash');

  var submitBtn = document.getElementById('submit-order');
  var errorEl = document.getElementById('order-error');
  var confirmationEl = document.getElementById('order-confirmation');

  function currentQty() {
    var n = parseInt(qtyInput.value, 10);
    if (isNaN(n) || n < 1) n = 1;
    if (n > 10) n = 10;
    return n;
  }

  function isShipping() { return deliveryShipping.checked; }

  function currentTotal() {
    var total = currentQty() * unitPrice;
    if (isShipping()) total += shippingFee;
    return Math.round(total * 100) / 100;
  }

  function formatPrice(n) {
    var s = (Math.round(n * 100) / 100).toString();
    return isEnglish ? ('€' + s) : (s + '€');
  }

  function updateTotal() {
    qtyInput.value = currentQty();
    totalEl.textContent = formatPrice(currentTotal());
  }

  function updateDeliveryFields() {
    if (isShipping()) {
      addressField.hidden = false;
      addressInput.required = true;
      pickupField.hidden = true;
      pickupSelect.required = false;
    } else {
      addressField.hidden = true;
      addressInput.required = false;
      pickupField.hidden = false;
      pickupSelect.required = true;
    }
    updateTotal();
  }

  // Cash is pickup/in-person only - paying cash for a home delivery isn't
  // an option, so shipping gets disabled (and forced over to pickup)
  // whenever cash is selected, and re-enabled otherwise.
  function updatePaymentConstraints() {
    if (paymentCash.checked) {
      deliveryShipping.disabled = true;
      if (deliveryShipping.checked) deliveryPickup.checked = true;
    } else {
      deliveryShipping.disabled = false;
    }
    updateDeliveryFields();
  }

  qtyMinus.addEventListener('click', function () { qtyInput.value = currentQty() - 1; updateTotal(); });
  qtyPlus.addEventListener('click', function () { qtyInput.value = currentQty() + 1; updateTotal(); });
  qtyInput.addEventListener('input', updateTotal);
  deliveryShipping.addEventListener('change', updateDeliveryFields);
  deliveryPickup.addEventListener('change', updateDeliveryFields);
  paymentCard.addEventListener('change', updatePaymentConstraints);
  paymentBizum.addEventListener('change', updatePaymentConstraints);
  paymentCash.addEventListener('change', updatePaymentConstraints);
  updatePaymentConstraints();

  function currentPaymentMethod() {
    if (paymentBizum.checked) return 'bizum';
    if (paymentCash.checked) return 'cash';
    return 'card';
  }

  // Maps link for each pickup point, matching the hrefs on the About-section
  // stockist links - included so the exact location comes through in the
  // WhatsApp message, not just the point's short label. Plain-text street
  // addresses aren't on file for Gavà/Barcelona (Raza Alimentación), only
  // coordinates/business name, so those two use the maps link; Rocafort has
  // a real address on file and uses that directly.
  var PICKUP_LOCATIONS = {
    'Gavà': 'https://www.google.com/maps/place/41%C2%B018\'13.2%22N+2%C2%B000\'35.6%22E/@41.3036579,2.0073166,17z/data=!3m1!4b1!4m4!3m3!8m2!3d41.3036579!4d2.0098915',
    'Barcelona': 'https://www.google.com/maps/place/Raza+Alimentaci%C3%B3n/@41.4161977,2.2108011,17z/data=!3m1!4b1!4m6!3m5!1s0x12a4a34c379c5c1b:0xa8f54bc33366c0a!8m2!3d41.4161977!4d2.2108011!16s%2Fg%2F11cns7l4rz',
    'Barcelona (Rocafort)': 'Carrer Rocafort 165, 5-1, Barcelona, 08015'
  };

  function deliverySummary() {
    if (isShipping()) return (isEnglish ? 'Ship to: ' : 'Envío a: ') + addressInput.value.trim();
    var point = pickupSelect.value;
    var exact = PICKUP_LOCATIONS[point] || point;
    return (isEnglish ? 'Pickup at: ' : 'Recoger en: ') + point + ' - ' + exact;
  }

  // Every order - regardless of payment method - sends this same WhatsApp
  // notification to the business, since a static Stripe Payment Link/session
  // has no way to carry our own customer-info fields back to the owner.
  function buildWhatsappMessage(method) {
    var qty = currentQty();
    var total = formatPrice(currentTotal());
    var name = firstNameInput.value.trim() + ' ' + lastNameInput.value.trim();
    var paymentLine = isEnglish
      ? (method === 'bizum' ? 'Payment: Bizum (please confirm details)'
        : method === 'cash' ? 'Payment: cash on pickup'
        : 'Payment: card (processing via Stripe)')
      : (method === 'bizum' ? 'Pago: Bizum (confirmar datos)'
        : method === 'cash' ? 'Pago: efectivo al retirar'
        : 'Pago: tarjeta (procesando por Stripe)');

    var lines = isEnglish ? [
      'New order - Siurana Outdoors',
      'Name: ' + name,
      'Phone: ' + phoneInput.value.trim(),
      'Email: ' + emailInput.value.trim(),
      'Quantity: ' + qty + (qty === 1 ? ' bag' : ' bags'),
      deliverySummary(),
      'Total: ' + total,
      paymentLine
    ] : [
      'Nuevo pedido - Siurana Outdoors',
      'Nombre: ' + name,
      'Teléfono: ' + phoneInput.value.trim(),
      'Email: ' + emailInput.value.trim(),
      'Cantidad: ' + qty + (qty === 1 ? ' bolsa' : ' bolsas'),
      deliverySummary(),
      'Total: ' + total,
      paymentLine
    ];
    return lines.join('\n');
  }

  function openWhatsapp(method) {
    var text = buildWhatsappMessage(method);
    window.open('https://wa.me/' + whatsappNumber + '?text=' + encodeURIComponent(text), '_blank', 'noopener');
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    errorEl.hidden = true;
    confirmationEl.hidden = true;

    if (!form.reportValidity()) return;

    var method = currentPaymentMethod();

    if (method === 'card') {
      // Open WhatsApp synchronously (within the click), before the async
      // fetch below, so popup blockers don't treat it as an unrequested popup.
      submitBtn.disabled = true;
      openWhatsapp('card');
      fetch(CHECKOUT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity: currentQty(),
          delivery: isShipping() ? 'shipping' : 'pickup',
          lang: isEnglish ? 'en' : 'es'
        })
      })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && data.url) {
            window.location.href = data.url;
          } else {
            submitBtn.disabled = false;
            showError(isEnglish ? 'Something went wrong starting the payment. Please try again.' : 'Hubo un problema al iniciar el pago. Probá de nuevo.');
          }
        })
        .catch(function () {
          submitBtn.disabled = false;
          showError(isEnglish ? 'Something went wrong starting the payment. Please try again.' : 'Hubo un problema al iniciar el pago. Probá de nuevo.');
        });
      return;
    }

    openWhatsapp(method);
    if (method === 'cash') {
      confirmationEl.textContent = isEnglish
        ? 'Your order is ready to pick up whenever you\'d like, at ' + pickupSelect.value + '.'
        : 'Tu pedido está listo para recoger cuando quieras, en ' + pickupSelect.value + '.';
    } else {
      confirmationEl.textContent = isEnglish
        ? 'Order sent! We\'ll confirm Bizum payment details in the WhatsApp tab that just opened.'
        : '¡Pedido enviado! Te vamos a confirmar el pago por Bizum en la pestaña de WhatsApp que se acaba de abrir.';
    }
    confirmationEl.hidden = false;
  });
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
