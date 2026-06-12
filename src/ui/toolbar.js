import state from '../state.js';
import { commitAllSplatterParticles } from '../tools/bubble-brush.js';
import { updateActiveToolPin } from './toolbar-overflow.js';

var rectSubmenu, ellipseSubmenu;

function positionRectSubmenu() {
  var btn = document.querySelector('[data-tool="rect"]');
  var br = btn.getBoundingClientRect();
  rectSubmenu.style.top = br.top + 'px';
  rectSubmenu.style.left = (br.right + 10) + 'px';
}
function showRectSubmenu() { positionRectSubmenu(); rectSubmenu.classList.add('visible'); }
export function hideRectSubmenu() { rectSubmenu.classList.remove('visible'); }

function positionEllipseSubmenu() {
  var btn = document.querySelector('[data-tool="ellipse"]');
  var br = btn.getBoundingClientRect();
  ellipseSubmenu.style.top = br.top + 'px';
  ellipseSubmenu.style.left = (br.right + 10) + 'px';
}
function showEllipseSubmenu() { positionEllipseSubmenu(); ellipseSubmenu.classList.add('visible'); }
export function hideEllipseSubmenu() { ellipseSubmenu.classList.remove('visible'); }

export function initToolbar() {
  rectSubmenu = document.getElementById('rect-submenu');
  ellipseSubmenu = document.getElementById('ellipse-submenu');

  document.querySelectorAll('[data-tool]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      commitAllSplatterParticles();
      state.tool = btn.dataset.tool;
      document.querySelectorAll('[data-tool]').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      updateActiveToolPin();
      if (state.tool === 'rect') {
        hideEllipseSubmenu();
        if (rectSubmenu.classList.contains('visible')) { hideRectSubmenu(); } else { showRectSubmenu(); }
      } else if (state.tool === 'ellipse') {
        hideRectSubmenu();
        if (ellipseSubmenu.classList.contains('visible')) { hideEllipseSubmenu(); } else { showEllipseSubmenu(); }
      } else {
        hideRectSubmenu();
        hideEllipseSubmenu();
      }
    });
  });

  document.getElementById('mirror-toggle').addEventListener('click', function() {
    state.mirrorMode = !state.mirrorMode;
    this.classList.toggle('active', state.mirrorMode);
  });

  document.querySelectorAll('.rect-sub-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      state.rectSubTool = btn.dataset.rectMode;
      document.querySelectorAll('.rect-sub-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelector('[data-tool="rect"] img').src = 'custom-icons/rect_' + state.rectSubTool + '.svg';
      hideRectSubmenu();
    });
  });

  document.querySelectorAll('.ellipse-sub-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      state.ellipseSubTool = btn.dataset.ellipseMode;
      document.querySelectorAll('.ellipse-sub-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelector('[data-tool="ellipse"] img').src = 'custom-icons/ellipse_' + state.ellipseSubTool + '.svg';
      hideEllipseSubmenu();
    });
  });

  var saveBtn = document.getElementById('save-btn');
  var saveHoldTimer = null;
  var SAVE_HOLD_MS = 600;

  function startSaveHold(e) {
    e.preventDefault();
    clearTimeout(saveHoldTimer);
    saveBtn.classList.add('holding');
    saveHoldTimer = setTimeout(function() {
      saveBtn.classList.remove('holding');
      saveDrawing();
    }, SAVE_HOLD_MS);
  }

  function cancelSaveHold() {
    clearTimeout(saveHoldTimer);
    saveBtn.classList.remove('holding');
  }

  // On touch devices, hand the PNG to the native share sheet so "Save Image"
  // puts it straight in the photo library (a web app can't write there
  // directly, and a download link makes iPad Safari offer "Open in Preview").
  // Everything here stays synchronous: WebKit only carries the user-gesture
  // token through the hold timer into this tick, and navigator.share refuses
  // to open without it. Desktop (fine pointer) keeps the plain download.
  function saveDrawing() {
    var dataUrl = state.canvas.toDataURL('image/png');
    var wantShare = navigator.share && window.matchMedia('(pointer: coarse)').matches;
    if (wantShare) {
      var bin = atob(dataUrl.split(',')[1]);
      var bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      var file = new File([bytes], 'scribblepix.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file] }).catch(function() {}); // user closing the sheet rejects — fine
        return;
      }
    }
    var a = document.createElement('a');
    a.download = 'scribblepix.png';
    a.href = dataUrl;
    a.click();
  }

  saveBtn.addEventListener('pointerdown', startSaveHold);
  saveBtn.addEventListener('pointerup', cancelSaveHold);
  saveBtn.addEventListener('pointercancel', cancelSaveHold);
  saveBtn.addEventListener('pointerleave', cancelSaveHold);
  saveBtn.addEventListener('contextmenu', function(e) { e.preventDefault(); });
}
