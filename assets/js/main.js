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

  function show(i) {
    idx = (i + slides.length) % slides.length;
    slides.forEach(function (slide, n) {
      var active = n === idx;
      slide.classList.toggle('is-active', active);
      var video = slide.querySelector('video');
      if (video) { active ? video.play().catch(function () {}) : video.pause(); }
    });
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
