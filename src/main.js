import state from './state.js';
import { applyResize, resize } from './core/canvas-setup.js';
import { saveHistory } from './core/history.js';
import { drawStroke, getPos } from './tools/draw-stroke.js';
import { commitAllSplatterParticles } from './tools/bubble-brush.js';
import { finalizeVineStrokeV2 } from './tools/vine-brush-v2.js';
import { finalizeFlowerStroke } from './tools/flower-brush.js';
import { finalizeBoltStroke } from './tools/bolt-brush.js';
import { finalizeFireStroke } from './tools/fire-brush.js';
import { finalizeRectStroke, cancelRectStroke } from './tools/rect-tool.js';
import { finalizeEllipseStroke, cancelEllipseStroke } from './tools/ellipse-tool.js';
import { finalizePipeStroke } from './tools/pipes-brush.js';
import { finalizeThreeStroke } from './tools/threed-brush.js';
import { initColorPicker, onColorMove, onColorRelease } from './ui/color-picker.js';
import { initBrushSlider, onSliderMove, onSliderRelease } from './ui/brush-slider.js';
import { initToolbar, hideRectSubmenu, hideEllipseSubmenu } from './ui/toolbar.js';
import { initToolbarOverflow } from './ui/toolbar-overflow.js';
import { initRiveDock, setRiveDockActive, riveDockStrokeHit, riveDockStrokeEnd } from './ui/rive-dock.js';
import { initSettingsMenu } from './ui/settings-menu.js';
import { initAppMenu, menuBtnStrokeBegin, menuBtnStrokeHit, menuBtnStrokeEnd } from './ui/app-menu.js';
import { warmupTools } from './tools/prewarm.js';
import { initSplashScreen } from './ui/splash-screen.js';

// Init DOM refs into state
state.canvas = document.getElementById('c');
state.ctx = state.canvas.getContext('2d');
state.ov = document.getElementById('overlay');
state.ovCtx = state.ov.getContext('2d');
state.canvasArea = document.getElementById('canvas-area');

state.ctx.imageSmoothingEnabled = true;
state.ctx.imageSmoothingQuality = 'high';
state.ovCtx.imageSmoothingEnabled = true;
state.ovCtx.imageSmoothingQuality = 'high';

// Canvas setup and resize
applyResize();
window.addEventListener('resize', resize);
new ResizeObserver(resize).observe(state.canvasArea);

// Canvas drawing event handlers
function clearBrushPreview() {
  if (state.tool === 'bolt' || state.tool === 'fire' || state.tool === 'pipe' || state.tool === 'threed') state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
  if (state.tool === 'rect' && !state.rectBouncing) state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
  if (state.tool === 'ellipse' && !state.ellipseBouncing) state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
}

state.canvas.addEventListener('mousedown', function(e) {
  // No drawing while a dock effect (fill, dynamite, tornado, alien, undo) is
  // animating — concurrent strokes get eaten by the effect's canvas writes.
  if (state.effectBusy > 0) return;
  if (state.tool === 'rect') hideRectSubmenu();
  if (state.tool === 'ellipse') hideEllipseSubmenu();
  menuBtnStrokeBegin();
  var pos = getPos(e), x = pos[0], y = pos[1];
  saveHistory();
  state.mirrorVineStrokeV2 = null;
  state.mirrorFlowerStroke = null;
  state.mirrorBoltStroke = null;
  state.mirrorPipeStroke = null;
  state.mirrorThreeStroke = null;
  state.lastStrokePoints = [{x:x, y:y}];
  if (state.mirrorMode) state.lastStrokePoints.push({x: state.canvasW-x, y: y});
  state.lastStrokeRadius = state.tool === 'eraser' ? state.brushSize*1.6
                         : state.tool === 'splatter' ? state.brushSize*5
                         : state.tool === 'fire' ? state.brushSize*7.5
                         : state.tool === 'bolt' ? state.brushSize*2.2
                         : state.tool === 'vine' ? state.brushSize*1.6
                         : state.tool === 'flower' ? state.brushSize*1.8
                         : state.tool === 'pipe' ? state.brushSize*1.8
                         : state.tool === 'rect' ? 0
                         : state.tool === 'ellipse' ? 0
                         : state.tool === 'threed' ? state.brushSize*0.5
                         : state.brushSize*1.1;
  state.lastStrokeTool = state.tool;
  state.painting = true; state.lastX = x; state.lastY = y;
  state.splatterGateX = null; state.splatterGateY = null;
  commitAllSplatterParticles();
  drawStroke(x, y);
});

state.canvas.addEventListener('mousemove', function(e) {
  if (!state.painting) return;
  var pos = getPos(e);
  drawStroke(pos[0], pos[1]);
  if (state.lastStrokePoints) {
    state.lastStrokePoints.push({x: pos[0], y: pos[1]});
    if (state.mirrorMode) state.lastStrokePoints.push({x: state.canvasW-pos[0], y: pos[1]});
  }
  state.lastX = pos[0]; state.lastY = pos[1];
  riveDockStrokeHit(e.clientX, e.clientY);
  menuBtnStrokeHit(e.clientX, e.clientY);
});

state.canvas.addEventListener('mouseup', function() {
  state.painting = false;
  finalizeVineStrokeV2(); finalizeFlowerStroke(); finalizeBoltStroke(); finalizeFireStroke();
  finalizeRectStroke(); finalizeEllipseStroke(); finalizePipeStroke(); finalizeThreeStroke();
  clearBrushPreview();
  riveDockStrokeEnd(); menuBtnStrokeEnd();
});

state.canvas.addEventListener('mouseleave', function() {
  state.painting = false;
  finalizeVineStrokeV2(); finalizeFlowerStroke(); finalizeBoltStroke(); finalizeFireStroke();
  cancelRectStroke(); cancelEllipseStroke(); finalizePipeStroke(); finalizeThreeStroke();
  clearBrushPreview();
  riveDockStrokeEnd(); menuBtnStrokeEnd();
});

// On iOS/iPadOS, touchcancel fires instead of touchend when the OS interrupts the
// touch (system gesture, Pencil edge, notification). Without this, state.pipeStroke
// (and any other in-flight brush state) stays live and re-commits on the next mouseup.
state.canvas.addEventListener('touchcancel', function() {
  state.painting = false;
  finalizeVineStrokeV2(); finalizeFlowerStroke(); finalizeBoltStroke(); finalizeFireStroke();
  cancelRectStroke(); cancelEllipseStroke(); finalizePipeStroke(); finalizeThreeStroke();
  clearBrushPreview();
  riveDockStrokeEnd(); menuBtnStrokeEnd();
});

// Touch → mouse passthrough
state.canvas.addEventListener('touchstart', function(e) {
  e.preventDefault();
  state.canvas.dispatchEvent(new MouseEvent('mousedown', {clientX: e.touches[0].clientX, clientY: e.touches[0].clientY}));
}, {passive: false});
state.canvas.addEventListener('touchmove', function(e) {
  e.preventDefault();
  state.canvas.dispatchEvent(new MouseEvent('mousemove', {clientX: e.touches[0].clientX, clientY: e.touches[0].clientY}));
}, {passive: false});
state.canvas.addEventListener('touchend', function(e) {
  e.preventDefault();
  state.canvas.dispatchEvent(new MouseEvent('mouseup'));
}, {passive: false});

// Window-level handlers for sliders, color picker, and painting stop
window.addEventListener('mousemove', function(e) {
  onSliderMove(e.clientY);
  onColorMove(e.clientY);
});
window.addEventListener('mouseup', function() {
  state.painting = false;
  // Safety net: a release anywhere ends bolt/pipe strokes so their live tails
  // can never be orphaned on the overlay (both are idempotent if idle).
  finalizeBoltStroke();
  finalizePipeStroke();
  onSliderRelease();
  onColorRelease();
  riveDockStrokeEnd(); menuBtnStrokeEnd();
});
window.addEventListener('touchmove', function(e) {
  if (!e.touches.length) return;
  onSliderMove(e.touches[0].clientY);
  onColorMove(e.touches[0].clientY);
}, {passive: false});
window.addEventListener('touchend', function() {
  // Safety net: iPadOS sometimes routes touchend to the window instead of the
  // canvas element when the finger lifts over a foreign sibling (side rails).
  finalizePipeStroke();
  onSliderRelease();
  onColorRelease();
});

// Init all UI modules
initBrushSlider();
initColorPicker();
initToolbar();
initToolbarOverflow();
initSettingsMenu();
initAppMenu();
initRiveDock();
setRiveDockActive(true);
initSplashScreen();

if (window.requestIdleCallback) {
  requestIdleCallback(warmupTools, { timeout: 2000 });
} else {
  setTimeout(warmupTools, 50);
}

// ── Update check ──────────────────────────────────────────────────────────────
// GitHub Pages caches everything for 10 minutes and the installed home-screen
// app has no refresh UI, so a fresh deploy can be invisible on iPad. At startup
// (canvas is blank, so a reload can never lose a drawing) compare version.json
// (fetched uncached; bumped on every push) with the last version this device
// saw and reload once if it changed. The sessionStorage guard stops a reload
// loop while the CDN is still serving stale files.
fetch('version.json', { cache: 'no-store' })
  .then(function(r) { return r.json(); })
  .then(function(j) {
    // Human-facing release version shown in the About modal (separate from the
    // cache-buster `v`, which changes every push). Single source of truth.
    if (j.name) {
      var el = document.querySelector('.about-version');
      if (el) el.textContent = 'Version ' + j.name;
    }
    var seen = localStorage.getItem('tiny-draw-version');
    if (seen !== j.v) {
      localStorage.setItem('tiny-draw-version', j.v);
      if (seen !== null && sessionStorage.getItem('tiny-draw-reloaded') !== j.v) {
        sessionStorage.setItem('tiny-draw-reloaded', j.v);
        location.reload();
      }
    }
  })
  .catch(function() {}); // offline / file:// — skip silently
