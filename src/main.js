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
import { initDragTools } from './ui/drag-tools.js';
import { initDock } from './ui/dock.js';
import { initRiveDock, setRiveDockActive, riveDockStrokeHit } from './ui/rive-dock.js';
import { initSettingsMenu } from './ui/settings-menu.js';
import { initRailSync } from './ui/rail-sync.js';
import { warmupTools } from './tools/prewarm.js';

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
  if (state.tool === 'rect') hideRectSubmenu();
  if (state.tool === 'ellipse') hideEllipseSubmenu();
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
  if (window.__dockStrokeHit) window.__dockStrokeHit(e.clientX, e.clientY);
  riveDockStrokeHit(e.clientX, e.clientY);
});

state.canvas.addEventListener('mouseup', function() {
  state.painting = false;
  finalizeVineStrokeV2(); finalizeFlowerStroke(); finalizeBoltStroke(); finalizeFireStroke();
  finalizeRectStroke(); finalizeEllipseStroke(); finalizePipeStroke(); finalizeThreeStroke();
  clearBrushPreview();
});

state.canvas.addEventListener('mouseleave', function() {
  state.painting = false;
  finalizeVineStrokeV2(); finalizeFlowerStroke(); finalizeBoltStroke(); finalizeFireStroke();
  cancelRectStroke(); cancelEllipseStroke(); finalizePipeStroke(); finalizeThreeStroke();
  clearBrushPreview();
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
  // Safety net: a release anywhere ends the bolt stroke, so its live tail can
  // never be orphaned and left crackling on the overlay (idempotent if idle).
  finalizeBoltStroke();
  onSliderRelease();
  onColorRelease();
});
window.addEventListener('touchmove', function(e) {
  if (!e.touches.length) return;
  onSliderMove(e.touches[0].clientY);
  onColorMove(e.touches[0].clientY);
}, {passive: false});
window.addEventListener('touchend', function() {
  onSliderRelease();
  onColorRelease();
});

// Init all UI modules
initBrushSlider();
initColorPicker();
initToolbar();
initToolbarOverflow();
initDragTools();
initDock();
initSettingsMenu();
initRailSync();
initRiveDock();

var _dockModeToggle = document.getElementById('debug-dock-toggle');
if (_dockModeToggle) {
  // Apply whichever option is selected on load (default: rive)
  document.body.setAttribute('data-dock', _dockModeToggle.value);
  setRiveDockActive(_dockModeToggle.value === 'rive');

  _dockModeToggle.addEventListener('change', function() {
    document.body.setAttribute('data-dock', this.value);
    setRiveDockActive(this.value === 'rive');
  });
}

if (window.requestIdleCallback) {
  requestIdleCallback(warmupTools, { timeout: 2000 });
} else {
  setTimeout(warmupTools, 50);
}
