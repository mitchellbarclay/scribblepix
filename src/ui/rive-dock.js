import state from '../state.js';
import { saveHistory, undoMagic } from '../core/history.js';
import { hexToRgb, hslToRgb } from '../core/color-utils.js';
import { progressiveFloodFill } from '../core/fill.js';
import { doBoom } from '../tools/explosion.js';

var _riveInst = null;
var _dockVM = null;
var _toolVMs = {};
var _active = false;
var _undoBusy = false;
var _bound = false;
var _riveCapturing = false; // true while a dock tool drag is in progress

export function initRiveDock() {
  if (!window.rive) { console.warn('[rive-dock] Rive runtime not loaded'); return; }
  var canvas = document.getElementById('rive-dock-canvas');
  if (!canvas) return;

  _sizeCanvas(canvas);
  window.addEventListener('resize', function() {
    _sizeCanvas(canvas);
    if (_riveInst) _riveInst.resizeToCanvas();
  });

  // Rive sets up its own pointer listeners on the canvas via setupRiveListeners
  // (called automatically on construction). We give the canvas pointer-events: auto
  // when active so those listeners actually fire. Non-dock events are relayed below.
  _riveInst = new window.rive.Rive({
    src: 'src/rive/rive-dock.riv',
    canvas: canvas,
    artboard: 'Drag tools main',
    stateMachines: 'State Machine 1',
    autoplay: true,
    layout: new window.rive.Layout({ fit: window.rive.Fit.Layout }),
    onLoad: function() {
      _bindViewModels();
    },
    onLoadError: function(e) {
      console.error('[rive-dock] failed to load .riv:', e);
    }
  });

  // Sync fill colour on every frame when state.color changes
  var _lastColor = '';
  _riveInst.on(window.rive.EventType.Advance, function() {
    if (state.color !== _lastColor) {
      _syncFillColor();
      _lastColor = state.color;
    }
  });

  // ── Event relay ────────────────────────────────────────────────────────────
  // The Rive canvas is on top with pointer-events: auto when active.
  // On pointerdown we do an immediate bounds check against dockW/dockH/leftPlacement/
  // bottomPlacement from DockVM. If the press is outside the dock, relay to the
  // drawing canvas straight away — no rAF delay.

  canvas.addEventListener('pointerdown', function(e) {
    if (!_active) return;
    var rect = canvas.getBoundingClientRect();
    var px = e.clientX - rect.left;
    var py = e.clientY - rect.top;
    if (_isInDock(px, py)) {
      _riveCapturing = true;
    } else {
      _riveCapturing = false;
      state.canvas.dispatchEvent(new MouseEvent('mousedown', {
        clientX: e.clientX, clientY: e.clientY, bubbles: false
      }));
    }
  });

  canvas.addEventListener('pointermove', function(e) {
    if (!_active) return;
    // Relay drawing moves. Even if _riveCapturing, Rive's own listener handles it.
    if (state.painting && !_riveCapturing) {
      state.canvas.dispatchEvent(new MouseEvent('mousemove', {
        clientX: e.clientX, clientY: e.clientY, bubbles: false
      }));
    }
  });

  canvas.addEventListener('pointerup', function(e) {
    if (!_active) return;
    var wasCap = _riveCapturing;
    _riveCapturing = false;
    if (!wasCap) {
      // End any drawing stroke in progress
      window.dispatchEvent(new MouseEvent('mouseup'));
    }
  });
}

export function setRiveDockActive(active) {
  _active = active;
  var canvas = document.getElementById('rive-dock-canvas');
  if (canvas) canvas.style.pointerEvents = active ? 'auto' : 'none';
}

function _sizeCanvas(canvas) {
  var dpr = window.devicePixelRatio || 1;
  var area = state.canvasArea || document.getElementById('canvas-area');
  var w = area.clientWidth;
  var h = area.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
}

// Returns true if canvas-area-relative point (px, py) is inside the dock.
// Uses dockW/dockH/leftPlacement/bottomPlacement outputs from DockVM.
function _isInDock(px, py) {
  if (!_dockVM) return false;
  var dw = _dockVM.number('dockW');
  var dh = _dockVM.number('dockH');
  var lp = _dockVM.number('leftPlacement');
  var bp = _dockVM.number('bottomPlacement');
  if (!dw || !dh || !lp || !bp) return false;
  var w = dw.value, h = dh.value, left = lp.value, bottom = bp.value;
  var dockTop = state.canvasH - bottom - h;
  var dockBottom = state.canvasH - bottom;
  return px >= left && px <= left + w && py >= dockTop && py <= dockBottom;
}

function _bindViewModels() {
  if (_bound) return;
  _bound = true;
  var vmDef = _riveInst.viewModelByName('DockVM');
  if (!vmDef) { console.warn('[rive-dock] DockVM not found'); return; }

  _dockVM = vmDef.defaultInstance();
  _riveInst.bindViewModelInstance(_dockVM);

  _pushCanvasSize();
  window.addEventListener('resize', _pushCanvasSize);

  var effectTriggerNames = { tornado: 'wipe', dynamite: 'explode', fill: 'fill', undo: 'undo' };

  ['tornado', 'dynamite', 'fill', 'undo'].forEach(function(name) {
    var inst = _dockVM.viewModel(name);
    if (!inst) { console.warn('[rive-dock] missing VM instance for:', name); return; }
    _toolVMs[name] = inst;

    // Listen for effect output triggers
    var effectTrig = inst.trigger(effectTriggerNames[name]);
    if (!effectTrig) { console.warn('[rive-dock] missing trigger:', effectTriggerNames[name]); return; }
    (function(toolName, t) {
      if (typeof t.on === 'function') {
        t.on(function() {
          var dropX = 0, dropY = 0;
          if (_dockVM) {
            var px = _dockVM.number('dropX');
            var py = _dockVM.number('dropY');
            if (px) dropX = px.value;
            if (py) dropY = py.value;
          }
          console.log('[rive-dock] effect:', toolName, 'at', Math.round(dropX), Math.round(dropY));
          _fireEffect(toolName, dropX, dropY);
        });
      }
    })(name, effectTrig);
  });

  _syncFillColor();
  console.log('[rive-dock] ready. Tools bound:', Object.keys(_toolVMs).join(', '));
}

function _pushCanvasSize() {
  if (!_dockVM) return;
  var cw = _dockVM.number('canvasW');
  var ch = _dockVM.number('canvasH');
  if (cw) cw.value = state.canvasW;
  if (ch) ch.value = state.canvasH;
}

function _syncFillColor() {
  var vm = _toolVMs.fill;
  if (!vm) return;
  var prop = vm.color('paintColour');
  if (!prop) return;
  prop.value = _hexToArgb(state.color || '#000000');
}

function _hexToArgb(hex) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return 0xFF000000 >>> 0;
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return ((0xFF << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

function _fireEffect(toolName, dropX, dropY) {
  // Rive canvas is now inside #canvas-area, so dropX/dropY are already
  // canvas-area-relative — no offset subtraction needed.
  if (toolName === 'undo') {
    _doUndo();
  } else if (toolName === 'fill') {
    _doFill(dropX, dropY);
  } else if (toolName === 'dynamite') {
    doBoom(dropX, dropY);
  } else if (toolName === 'tornado') {
    _doTornadoWipe();
  }
}

// ── Tornado: straight vertical wipe — Rive handles the ghost animation ───────

function _doTornadoWipe() {
  saveHistory();
  state.lastStrokePoints = null;
  var w = state.canvasW, h = state.canvasH;
  var totalFrames = 130, frame = 0;

  function animWipe() {
    var p = frame / totalFrames;
    state.ctx.fillStyle = state.BG_CSS;
    state.ctx.fillRect(0, 0, Math.ceil(w * p), h);
    frame++;
    if (frame < totalFrames) {
      requestAnimationFrame(animWipe);
    } else {
      state.ctx.fillRect(0, 0, w, h);
      _fireTrigger(_toolVMs.tornado, 'endWipe');
    }
  }
  animWipe();
}

// ── Fill: immediate flood fill — Rive handles the drip animation ──────────────

function _doFill(dropX, dropY) {
  saveHistory();
  state.lastStrokePoints = null;
  var fc = state.rainbowMode ? 'hsl(' + Math.floor(Math.random() * 360) + ',100%,50%)' : state.color;
  var rgb = fc.indexOf('hsl') === 0 ? hslToRgb(fc) : hexToRgb(fc);
  var sx = Math.round(dropX * state.DPR);
  var sy = Math.round(dropY * state.DPR);
  progressiveFloodFill(sx, sy, rgb, function() {});
}

// ── Undo: delegates to undoMagic from history.js ─────────────────────────────

function _doUndo() {
  if (_undoBusy || !state.undoSnapshot) return;
  if (state.undoSnapshot.width !== state.canvas.width || state.undoSnapshot.height !== state.canvas.height) return;
  _undoBusy = true;
  undoMagic(function() {
    setTimeout(function() { _undoBusy = false; }, 180);
  });
}

// ── Helper: fire a named trigger from JS side ─────────────────────────────────

function _fireTrigger(vmInst, triggerName) {
  if (!vmInst) return;
  var t = vmInst.trigger(triggerName);
  if (!t) return;
  if (typeof t.fire === 'function') t.fire();
  else if (typeof t.trigger === 'function') t.trigger();
}
