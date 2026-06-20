import state from '../state.js';
import { saveHistory } from '../core/history.js';
import { saveDrawing } from './toolbar.js';
import { openAbout, openInstall } from './settings-menu.js';

// The canvas-corner MENU button + dropdown. Nests what used to be the left-rail
// settings cog and save button, plus a new "Open image" import.

var _menuFaded = false;

// Called on stroke start: make the pill transparent to pointer events for the
// whole stroke. Otherwise events over the solid pill route to the button (not
// the canvas), so the canvas mousemove — and thus menuBtnStrokeHit — never fires
// there, and the button hijacks the drag (selection cursor). With pointer-events
// off, the canvas receives every move, detection is reliable, and you can draw
// straight through the (faded) pill.
export function menuBtnStrokeBegin() {
  const btn = document.getElementById('app-menu-btn');
  if (btn) btn.style.pointerEvents = 'none';
}

export function menuBtnStrokeHit(cx, cy) {
  if (_menuFaded) return;
  const btn = document.getElementById('app-menu-btn');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
    _menuFaded = true;
    btn.style.opacity = '0';
    const dd = document.getElementById('app-menu-dropdown');
    if (dd) dd.classList.remove('visible');
  }
}

export function menuBtnStrokeEnd() {
  const btn = document.getElementById('app-menu-btn');
  if (btn) {
    btn.style.pointerEvents = '';
    if (_menuFaded) btn.style.opacity = '';
  }
  _menuFaded = false;
}

export function initAppMenu() {
  const btn = document.getElementById('app-menu-btn');
  const dropdown = document.getElementById('app-menu-dropdown');
  const closeBtn = document.getElementById('app-menu-close');
  const fileInput = document.getElementById('open-image-input');

  // The pill expands into the card: hide the pill while the card is open so the
  // card's "Menu" title + close X stand in for it.
  function open() { dropdown.classList.add('visible'); btn.classList.add('hidden'); }
  function close() { dropdown.classList.remove('visible'); btn.classList.remove('hidden'); }

  btn.addEventListener('click', (e) => { e.stopPropagation(); open(); });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });

  // Dismiss on any press outside the menu, or Escape.
  document.addEventListener('pointerdown', (e) => {
    if (!dropdown.classList.contains('visible')) return;
    if (dropdown.contains(e.target) || btn.contains(e.target)) return;
    close();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  dropdown.querySelectorAll('.app-menu-item').forEach((item) => {
    item.addEventListener('click', () => {
      const action = item.dataset.action;
      close();
      if (action === 'about') openAbout();
      else if (action === 'install') openInstall();
      else if (action === 'save') saveDrawing();
      else if (action === 'open') fileInput.click();
    });
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) loadImageFile(file);
    fileInput.value = ''; // let the same file be re-opened later
  });
}

// Draw an opened image onto the canvas, fit (contain) and centred over a fresh
// background. Snapshots first so the dock's undo restores the prior drawing.
function loadImageFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    saveHistory();
    const ctx = state.ctx, W = state.canvasW, H = state.canvasH;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = state.BG_CSS;
    ctx.fillRect(0, 0, W, H);
    const scale = Math.min(W / img.width, H / img.height);
    const dw = img.width * scale, dh = img.height * scale;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();
    URL.revokeObjectURL(url);
  };
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
}
