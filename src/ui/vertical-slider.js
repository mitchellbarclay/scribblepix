// Reusable vertical knob slider: drag the handle, or tap/drag the track to jump.
// Reports position p in [0,1] (0 = top) via onPos on every change. The same
// drag / rAF-throttle / elastic-press machinery the colour & brush sliders use,
// factored out so multiple sliders can share it.

export function makeVerticalSlider(trackEl, handleEl, onPos) {
  let dragging = false, grabY = 0, cachedTop = 0, maxTop = 0, handleH = 0;
  let rafScheduled = false, pendingY = 0, p = 0.5;

  function cache() {
    cachedTop = trackEl.getBoundingClientRect().top;
    handleH = handleEl.offsetHeight;
    maxTop = trackEl.clientHeight - handleH;
  }

  function applyTop(topPx) {
    const mt = maxTop > 0 ? maxTop : (trackEl.clientHeight - handleEl.offsetHeight);
    topPx = Math.max(0, Math.min(mt, topPx));
    handleEl.style.top = topPx + 'px';
    p = mt > 0 ? topPx / mt : 0;
    onPos(p);
  }

  function startHandle(clientY) {
    cache();
    grabY = clientY - handleEl.getBoundingClientRect().top;
    dragging = true;
    handleEl.classList.remove('anim-release', 'anim-press');
    void handleEl.offsetHeight;
    handleEl.classList.add('grabbing', 'anim-press');
  }

  function startJump(clientY) {
    cache();
    handleEl.classList.add('jumping');
    applyTop(clientY - cachedTop - handleH / 2);
    grabY = handleH / 2;
    dragging = true;
    handleEl.classList.remove('anim-release', 'anim-press');
    void handleEl.offsetHeight;
    handleEl.classList.add('grabbing', 'anim-press');
    setTimeout(() => handleEl.classList.remove('jumping'), 200);
  }

  function move(clientY) {
    if (!dragging) return;
    pendingY = clientY;
    if (rafScheduled) return;
    rafScheduled = true;
    requestAnimationFrame(() => {
      rafScheduled = false;
      if (!dragging) return;
      applyTop(pendingY - cachedTop - grabY);
    });
  }

  function release() {
    if (!dragging) return;
    dragging = false;
    handleEl.classList.remove('grabbing', 'anim-press');
    void handleEl.offsetHeight;
    handleEl.classList.add('anim-release');
    handleEl.addEventListener('animationend', function h() {
      handleEl.removeEventListener('animationend', h);
      handleEl.classList.remove('anim-release');
    });
  }

  // Set position programmatically (init / external), running onPos.
  function setP(np) {
    cache();
    applyTop(np * (maxTop > 0 ? maxTop : 0));
  }

  handleEl.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); startHandle(e.clientY); });
  handleEl.addEventListener('touchstart', e => { e.preventDefault(); startHandle(e.touches[0].clientY); }, { passive: false });
  trackEl.addEventListener('mousedown', e => { e.preventDefault(); startJump(e.clientY); });
  trackEl.addEventListener('touchstart', e => { e.preventDefault(); startJump(e.touches[0].clientY); }, { passive: false });

  new ResizeObserver(() => requestAnimationFrame(() => {
    cache();
    if (maxTop <= 0) { applyTop(0); return; }
    applyTop(p * maxTop);
  })).observe(trackEl);

  return { move, release, setP, getP: () => p };
}
