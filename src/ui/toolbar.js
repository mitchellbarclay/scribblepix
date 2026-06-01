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

  document.getElementById('save-btn').addEventListener('click', function() {
    var a = document.createElement('a');
    a.download = 'drawing.png';
    a.href = state.canvas.toDataURL();
    a.click();
  });
}
