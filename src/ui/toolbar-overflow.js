// Windowed tool palette: the scroll area always shows a whole number of tool
// slots (never a partial tool), scrolling snaps one tool at a time, and when
// the list overflows the top/bottom slot is replaced by a scroll arrow.

let viewport, toolList, upBtn, downBtn, pinEl, toolPill;

const BTN = 46;            // tool button diameter
const GAP = 14;            // gap between buttons in the list
const PITCH = BTN + GAP;   // 60px — vertical distance from one tool to the next
const PAD = 10;            // viewport top/bottom padding (matches CSS)
const PIN_RESERVE = 60;    // space the pin steals when shown (52px pin + 8px gap)

let k = 0;          // number of whole tools scrolled past (top hidden count)
let maxK = 0;       // max value of k
let visibleN = 0;   // number of whole tool slots the viewport shows
let total = 0;      // total tool count

// Elastic settle when snapping to a whole tool, and rubber-band resistance
// past the ends while dragging.
const SETTLE = 'transform 0.34s cubic-bezier(0.34,1.56,0.64,1)';
const RUBBER = 0.35;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function tools() { return toolList.querySelectorAll('.tool-btn'); }

function maxOffset() { return maxK * PITCH; }

// Apply a pixel offset to the list. `animate` toggles the elastic settle ease;
// during a live drag we set it raw (no transition) so it tracks the finger.
function setListOffset(px, animate) {
  toolList.style.transition = animate ? SETTLE : 'none';
  toolList.style.transform = `translateY(${-px}px)`;
}

// Reflect the current snapped index k in the arrows, replaced slots, and pin.
function updateSlots() {
  const canUp = k > 0;
  const canDown = k < maxK;
  upBtn.classList.toggle('visible', canUp);
  downBtn.classList.toggle('visible', canDown);
  // Hide the tool occupying a slot taken by an arrow ("replaced" by the arrow).
  const btns = tools();
  btns.forEach(b => b.classList.remove('slot-hidden'));
  if (canUp && btns[k]) btns[k].classList.add('slot-hidden');
  if (canDown && btns[k + visibleN - 1]) btns[k + visibleN - 1].classList.add('slot-hidden');
  updateActiveToolPin();
}

// Snap to a whole-tool index, elastically settling unless told otherwise.
function goToK(nk, animate = true) {
  k = clamp(nk, 0, maxK);
  setListOffset(k * PITCH, animate);
  updateSlots();
}

// Size the viewport to a whole number of tool slots based on available height.
function relayout() {
  total = tools().length;
  const pillH = toolPill.clientHeight;
  // How many whole tools fit if the pin is hidden. N buttons need
  // N*BTN + (N-1)*GAP = N*PITCH - GAP px (plus the viewport's 2*PAD).
  let N = Math.floor((pillH - 2 * PAD + GAP) / PITCH);
  if (N < total) {
    // Overflow → the pin will show and eat space, so recompute with it reserved.
    N = Math.floor((pillH - PIN_RESERVE - 2 * PAD + GAP) / PITCH);
  }
  visibleN = clamp(N, 1, total);
  maxK = Math.max(0, total - visibleN);
  const contentH = visibleN * BTN + (visibleN - 1) * GAP;
  viewport.style.height = (contentH + 2 * PAD) + 'px';
  goToK(k, false);
}

export function updateActiveToolPin() {
  const activeBtn = document.querySelector('.tool-btn.active');
  // Pin is shown whenever the palette overflows (is scrollable), a consistent
  // anchor for the current tool. Hidden when every tool fits without scrolling.
  if (!activeBtn || maxK === 0) {
    pinEl.classList.remove('visible');
    toolPill.classList.remove('pin-active');
    return;
  }
  const img = activeBtn.querySelector('img');
  if (img) pinEl.querySelector('img').src = img.src;
  pinEl.classList.toggle('eraser-active', activeBtn.dataset.tool === 'eraser');
  pinEl.classList.add('visible');
  toolPill.classList.add('pin-active');
}

export function initToolbarOverflow() {
  viewport = document.getElementById('tool-scroll-viewport');
  toolList = document.getElementById('tool-list');
  upBtn = document.getElementById('tool-overflow-up');
  downBtn = document.getElementById('tool-overflow-down');
  pinEl = document.getElementById('active-tool-pin');
  toolPill = document.getElementById('tool-pill');

  upBtn.addEventListener('click', () => goToK(k - 1));
  downBtn.addEventListener('click', () => goToK(k + 1));

  pinEl.addEventListener('click', () => {
    const activeBtn = document.querySelector('.tool-btn.active');
    if (!activeBtn) return;
    const idx = [...tools()].indexOf(activeBtn);
    if (idx < 0) return;
    // Centre the active tool in the window (keeps it clear of the arrow slots).
    goToK(idx - Math.floor(visibleN / 2));
  });

  let dragStartY = 0;
  let dragStartOffset = 0;
  let isDrag = false;

  viewport.addEventListener('pointerdown', e => {
    dragStartY = e.clientY;
    dragStartOffset = k * PITCH;
    isDrag = false;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  });

  function onMove(e) {
    const delta = dragStartY - e.clientY;
    if (!isDrag && Math.abs(delta) > 6) isDrag = true;
    if (!isDrag) return;
    const raw = dragStartOffset + delta;
    const max = maxOffset();
    // Follow the finger 1:1 in range; past the ends apply rubber-band resistance.
    let o = raw;
    if (raw < 0) o = raw * RUBBER;
    else if (raw > max) o = max + (raw - max) * RUBBER;
    setListOffset(o, false);
    // Keep arrows / replaced slots in sync with the nearest snap point live.
    const nk = clamp(Math.round(clamp(raw, 0, max) / PITCH), 0, maxK);
    if (nk !== k) { k = nk; updateSlots(); }
  }

  function onUp() {
    window.removeEventListener('pointermove', onMove);
    if (isDrag) {
      viewport.addEventListener('click', e => e.stopPropagation(), { capture: true, once: true });
      isDrag = false;
      // Settle elastically onto the nearest whole tool (or bounce back from an edge).
      goToK(k);
    }
  }

  let wheelAccum = 0;
  viewport.addEventListener('wheel', e => {
    e.preventDefault();
    wheelAccum += e.deltaY;
    if (Math.abs(wheelAccum) >= PITCH * 0.5) {
      goToK(k + (wheelAccum > 0 ? 1 : -1));
      wheelAccum = 0;
    }
  }, { passive: false });

  window.addEventListener('resize', relayout);
  requestAnimationFrame(relayout);
}
