import state from '../state.js';
import { colorAtPos, rgbToHex, lightenColor, darkenColor } from '../core/color-utils.js';
import { updateBrushPreview } from './brush-slider.js';

var colorTrack, colorHandle;
var colorDragging = false;
var colorGrabY = 0;
var colorCachedTrackTop = 0, colorCachedMaxTop = 0, colorCachedHandleH = 0;
var colorRafScheduled = false, colorPendingY = 0;
var colorP = 0.5;

function cacheColorRects() {
  var tr = colorTrack.getBoundingClientRect();
  colorCachedTrackTop = tr.top;
  colorCachedHandleH = colorHandle.offsetHeight;
  colorCachedMaxTop = colorTrack.clientHeight - colorCachedHandleH;
}

var bgPendingP = null, bgRafScheduled = false;
function updateBackground(p) {
  bgPendingP = p;
  if (bgRafScheduled) return;
  bgRafScheduled = true;
  requestAnimationFrame(function() {
    bgRafScheduled = false;
    var pp = bgPendingP;
    var baseCenter = colorAtPos(pp);
    var nearWhite = baseCenter[0] > 240 && baseCenter[1] > 240 && baseCenter[2] > 240;
    var c1, c2, c3;
    if (nearWhite) {
      c1 = [232,236,240]; c2 = [218,223,229]; c3 = [198,205,213];
    } else {
      c1 = lightenColor(colorAtPos(Math.max(0, pp-0.18)), 0.78);
      c2 = lightenColor(baseCenter, 0.78);
      c3 = lightenColor(colorAtPos(Math.min(1, pp+0.18)), 0.78);
    }
    document.body.style.setProperty('--bg-c1', 'rgb('+c1.join(',')+')');
    document.body.style.setProperty('--bg-c2', 'rgb('+c2.join(',')+')');
    document.body.style.setProperty('--bg-c3', 'rgb('+c3.join(',')+')');
    var baseRgb = colorAtPos(pp);
    var rail = lightenColor(baseRgb, 0.62);
    document.body.style.setProperty('--rail-bg', 'rgba('+rail[0]+','+rail[1]+','+rail[2]+',0.55)');
    document.body.style.setProperty('--accent', 'rgb('+baseRgb.join(',')+')');
    var accDark = darkenColor(baseRgb, 0.45);
    document.body.style.setProperty('--accent-dark', 'rgb('+accDark.join(',')+')');
  });
}

function applyColorHandleTop(topPx) {
  var maxTop = colorCachedMaxTop > 0 ? colorCachedMaxTop : (colorTrack.clientHeight - colorHandle.offsetHeight);
  topPx = Math.max(0, Math.min(maxTop, topPx));
  colorHandle.style.top = topPx + 'px';
  colorP = maxTop > 0 ? topPx/maxTop : 0;
  var rgb = colorAtPos(colorP);
  state.color = rgbToHex(rgb);
  colorHandle.style.background = state.color;
  updateBackground(colorP);
  updateBrushPreview();
}

function startColorJumpDrag(clientY) {
  cacheColorRects();
  var targetTop = clientY - colorCachedTrackTop - colorCachedHandleH/2;
  colorHandle.classList.add('jumping');
  applyColorHandleTop(targetTop);
  colorGrabY = colorCachedHandleH/2;
  colorDragging = true;
  colorHandle.classList.remove('anim-release', 'anim-press');
  colorHandle.offsetHeight;
  colorHandle.classList.add('grabbing', 'anim-press');
  setTimeout(function() { colorHandle.classList.remove('jumping'); }, 200);
}

export function onColorMove(clientY) {
  if (!colorDragging) return;
  colorPendingY = clientY;
  if (colorRafScheduled) return;
  colorRafScheduled = true;
  requestAnimationFrame(function() {
    colorRafScheduled = false;
    if (!colorDragging) return;
    applyColorHandleTop(colorPendingY - colorCachedTrackTop - colorGrabY);
  });
}

export function onColorRelease() {
  if (!colorDragging) return;
  colorDragging = false;
  colorHandle.classList.remove('grabbing', 'anim-press');
  colorHandle.offsetHeight;
  colorHandle.classList.add('anim-release');
  colorHandle.addEventListener('animationend', function h() {
    colorHandle.removeEventListener('animationend', h);
    colorHandle.classList.remove('anim-release');
  });
}

export function initColorPicker() {
  colorTrack = document.getElementById('color-track');
  colorHandle = document.getElementById('color-handle');

  var maxTop = colorTrack.clientHeight - colorHandle.offsetHeight;
  applyColorHandleTop(maxTop * 0.5);

  colorHandle.addEventListener('mousedown', function(e) {
    e.preventDefault(); e.stopPropagation();
    cacheColorRects();
    var r = colorHandle.getBoundingClientRect();
    colorGrabY = e.clientY - r.top;
    colorDragging = true;
    colorHandle.classList.remove('anim-release', 'anim-press');
    colorHandle.offsetHeight;
    colorHandle.classList.add('grabbing', 'anim-press');
  });
  colorHandle.addEventListener('touchstart', function(e) {
    e.preventDefault();
    cacheColorRects();
    var r = colorHandle.getBoundingClientRect();
    colorGrabY = e.touches[0].clientY - r.top;
    colorDragging = true;
    colorHandle.classList.remove('anim-release', 'anim-press');
    colorHandle.offsetHeight;
    colorHandle.classList.add('grabbing', 'anim-press');
  }, {passive: false});

  colorTrack.addEventListener('mousedown', function(e) {
    e.preventDefault();
    startColorJumpDrag(e.clientY);
  });
  colorTrack.addEventListener('touchstart', function(e) {
    e.preventDefault();
    startColorJumpDrag(e.touches[0].clientY);
  }, {passive: false});

  new ResizeObserver(function() { requestAnimationFrame(function() {
    cacheColorRects();
    var maxTop = colorCachedMaxTop;
    if (maxTop <= 0) { applyColorHandleTop(0); return; }
    applyColorHandleTop(colorP * maxTop);
  }); }).observe(colorTrack);
}
