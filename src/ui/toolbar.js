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
      document.querySelector('[data-tool="rect"] img').src = 'icons/tools/rect-' + state.rectSubTool + '.svg';
      hideRectSubmenu();
    });
  });

  document.querySelectorAll('.ellipse-sub-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      state.ellipseSubTool = btn.dataset.ellipseMode;
      document.querySelectorAll('.ellipse-sub-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      document.querySelector('[data-tool="ellipse"] img').src = 'icons/tools/ellipse-' + state.ellipseSubTool + '.svg';
      hideEllipseSubmenu();
    });
  });

}

// On touch devices, hand the PNG to the native share sheet so "Save image"
// puts it straight in the photo library (a web app can't write there directly,
// and a download link makes iPad Safari offer "Open in Preview"). Everything
// stays synchronous so WebKit's user-gesture token is live when navigator.share
// is called. Desktop (fine pointer) keeps the plain download.
export function saveDrawing() {
  var dataUrl = state.canvas.toDataURL('image/png');
  var wantShare = navigator.share && window.matchMedia('(pointer: coarse)').matches;
  if (wantShare) {
    var bin = atob(dataUrl.split(',')[1]);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var file = new File([bytes], 'tiny-draw.png', { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file] }).catch(function() {}); // user closing the sheet rejects — fine
      return;
    }
  }
  var a = document.createElement('a');
  a.download = 'tiny-draw.png';
  a.href = dataUrl;
  a.click();
}
