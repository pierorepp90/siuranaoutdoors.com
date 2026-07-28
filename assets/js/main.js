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
