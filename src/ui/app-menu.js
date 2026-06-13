import state from '../state.js';
import { saveHistory } from '../core/history.js';
import { saveDrawing } from './toolbar.js';
import { openSettings } from './settings-menu.js';

// The canvas-corner MENU button + dropdown. Nests what used to be the left-rail
// settings cog and save button, plus a new "Open image" import.

export function initAppMenu() {
  const btn = document.getElementById('app-menu-btn');
  const dropdown = document.getElementById('app-menu-dropdown');
  const fileInput = document.getElementById('open-image-input');

  function close() { dropdown.classList.remove('visible'); }

  btn.addEventListener('click', (e) => { e.stopPropagation(); dropdown.classList.toggle('visible'); });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());

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
      if (action === 'about') openSettings(0);
      else if (action === 'install') openSettings(1);
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
