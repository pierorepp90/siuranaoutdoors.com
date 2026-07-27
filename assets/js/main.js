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
