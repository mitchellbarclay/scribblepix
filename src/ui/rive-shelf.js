import state from '../state.js';
import { saveHistory, undoMagic } from '../core/history.js';

// ── Rive shelf: top-bar tornado + undo buttons and the full-canvas wipe ────────
// Three artboards in rive-shelf.riv:
//   wipe-container — full-canvas overlay; plays the tornado sweep, drives WipeVM
//                    (canvasW/canvasH/wipePosition/wipeProgress). pointer-events:none.
//   tornado        — top-bar button; its state machine fires WipeVM.wipe on press.
//   undo           — top-bar button; its state machine fires UndoVM.undo on press.
//
// WipeVM bridge: tornado and wipe-container are separate Rive instances. Binding
// one shared WipeVM instance to both proved unreliable (it resolves
// non-deterministically by onLoad order, so the wipe-container often never
// sweeps), so each artboard keeps its OWN instance and JS bridges the triggers:
//   tornado press → WipeVM.wipe (tornado)  → JS → fire WipeVM.wipe (wipe-container)
//   sweep done    → WipeVM.endWipe (w-cont) → JS → fire WipeVM.endWipe (tornado)
// This only relies on SM-fired triggers reaching JS .on() and JS firing triggers
// via .trigger() — both proven to work in this runtime.

var TORNADO_ARTBOARD_W = 1180;
var TORNADO_ARTBOARD_H = 820;

var _buffer = null;
var _wipeRive = null, _tornadoRive = null, _undoRive = null;
var _wipeVM = null;       // wipe-container instance — canonical (sweep + wipePosition)
var _tornadoVM = null;    // tornado instance — its press fires WipeVM.wipe
var _undoVM = null;
var _wipeBusy = false;
var _undoBusy = false;

export function initRiveShelf() {
  if (!window.rive) { console.warn('[rive-shelf] Rive runtime not loaded'); return; }
  fetch('src/rive/rive-shelf.riv')
    .then(function(r) { return r.arrayBuffer(); })
    .then(function(buf) { _buffer = buf; _initWipeContainer(); _initTornado(); _initUndo(); })
    .catch(function(e) { console.error('[rive-shelf] failed to load rive-shelf.riv:', e); });
}

// ── wipe-container (full-canvas sweep) — canonical WipeVM instance ─────────────
function _initWipeContainer() {
  var canvas = document.getElementById('wipe-canvas');
  if (!canvas) return;
  _sizeWipeCanvas(canvas);
  _wipeRive = new window.rive.Rive({
    buffer: _buffer,
    canvas: canvas,
    artboard: 'wipe-container',
    stateMachines: 'State Machine 1',
    autoplay: true,
    layout: new window.rive.Layout({ fit: window.rive.Fit.Cover }),
    onLoad: function() {
      _wipeRive.resizeDrawingSurfaceToCanvas();
      _wipeVM = _wipeInstance(_wipeRive);
      if (!_wipeVM) { console.warn('[rive-shelf] WipeVM not found'); return; }
      _wipeRive.bindViewModelInstance(_wipeVM);
      _pushCanvasSize();
      // The wipe-container fires endWipe when its sweep completes; relay it to the
      // tornado so its spin stops in sync.
      var endTrig = _wipeVM.trigger('endWipe');
      if (endTrig && typeof endTrig.on === 'function') {
        endTrig.on(function() { _fireTrigger(_tornadoVM, 'endWipe'); });
      }
    },
    onLoadError: function(e) { console.error('[rive-shelf] wipe-container load error', e); }
  });

  var resync = function() {
    var rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    _sizeWipeCanvas(canvas);
    if (_wipeRive) _wipeRive.resizeDrawingSurfaceToCanvas();
    _pushCanvasSize();
  };
  window.addEventListener('resize', resync);
  if (window.ResizeObserver) new ResizeObserver(resync).observe(canvas);
}

// ── tornado button ────────────────────────────────────────────────────────────
function _initTornado() {
  var canvas = document.getElementById('tornado-canvas');
  if (!canvas) return;
  _tornadoRive = new window.rive.Rive({
    buffer: _buffer,
    canvas: canvas,
    artboard: 'tornado',
    stateMachines: 'State Machine 1',
    autoplay: true,
    layout: new window.rive.Layout({ fit: window.rive.Fit.Contain }),
    onLoad: function() {
      _tornadoRive.resizeDrawingSurfaceToCanvas();
      _tornadoVM = _wipeInstance(_tornadoRive);
      if (!_tornadoVM) { console.warn('[rive-shelf] WipeVM not found (tornado)'); return; }
      _tornadoRive.bindViewModelInstance(_tornadoVM);
      var wipeTrig = _tornadoVM.trigger('wipe');
      if (wipeTrig && typeof wipeTrig.on === 'function') wipeTrig.on(_onTornadoPress);
      else console.warn('[rive-shelf] tornado wipe trigger not subscribable');
      console.log('[rive-shelf] tornado ready');
    },
    onLoadError: function(e) { console.error('[rive-shelf] tornado load error', e); }
  });
}

// ── undo button ───────────────────────────────────────────────────────────────
function _initUndo() {
  var canvas = document.getElementById('undo-canvas');
  if (!canvas) return;
  _undoRive = new window.rive.Rive({
    buffer: _buffer,
    canvas: canvas,
    artboard: 'undo',
    stateMachines: 'State Machine 1',
    autoplay: true,
    layout: new window.rive.Layout({ fit: window.rive.Fit.Contain }),
    onLoad: function() {
      _undoRive.resizeDrawingSurfaceToCanvas();
      var def = _undoRive.viewModelByName('UndoVM');
      if (!def) { console.warn('[rive-shelf] UndoVM not found'); return; }
      _undoVM = def.defaultInstance();
      _undoRive.bindViewModelInstance(_undoVM);
      var undoTrig = _undoVM.trigger('undo');
      if (undoTrig && typeof undoTrig.on === 'function') undoTrig.on(doUndo);
      else console.warn('[rive-shelf] undo trigger not subscribable');
      console.log('[rive-shelf] ready');
    },
    onLoadError: function(e) { console.error('[rive-shelf] undo load error', e); }
  });
}

// tornado press → play the wipe-container sweep + run the canvas clear.
function _onTornadoPress() {
  if (_wipeBusy || !_wipeVM) return;
  _fireTrigger(_wipeVM, 'wipe');
  doTornadoWipe();
}

// This runtime fires View-Model triggers via .trigger() (not .fire()); fall back
// to .fire() for older runtimes just in case.
// The artboards are bound in-editor to the named WipeVM instance "Instance 1",
// so we must bind that same named instance (not defaultInstance, which is a
// disconnected copy) for triggers fired into it to drive the artboard's SM.
function _wipeInstance(rive) {
  var def = rive.viewModelByName('WipeVM');
  if (!def) return null;
  var inst = null;
  try { inst = def.instanceByName('Instance 1'); } catch (e) { inst = null; }
  return inst || def.defaultInstance();
}

function _fireTrigger(vm, name) {
  if (!vm) return;
  var t = vm.trigger(name);
  if (!t) return;
  if (typeof t.trigger === 'function') t.trigger();
  else if (typeof t.fire === 'function') t.fire();
}

function _sizeWipeCanvas(canvas) {
  var dpr = window.devicePixelRatio || 1;
  var area = state.canvasArea || document.getElementById('canvas-area');
  var w = area.clientWidth, h = area.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  // Set the CSS size too — without it the canvas lays out at its intrinsic
  // backing-store size and resizeDrawingSurfaceToCanvas re-multiplies by DPR,
  // blowing the artboard up to 4× (the "huge wipe" bug).
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
}

function _pushCanvasSize() {
  if (!_wipeVM) return;
  var area = state.canvasArea || document.getElementById('canvas-area');
  var cw = _wipeVM.number('canvasW');
  var ch = _wipeVM.number('canvasH');
  if (cw) cw.value = area.clientWidth;
  if (ch) ch.value = area.clientHeight;
}

// ── Tornado wipe — column clear synced to WipeVM.wipePosition ──────────────────
// wipePosition is in artboard design-space (1180×820, cover-fitted), so account
// for the cover scale and horizontal offset before converting to canvas pixels:
//   scale   = max(canvasW/1180, canvasH/820)
//   offsetX = (canvasW − 1180·scale)/2
//   canvasX = offsetX + wipePosition·scale   → clamped to [0, canvasW]
function doTornadoWipe() {
  _wipeBusy = true;
  saveHistory();
  state.effectBusy++;
  state.lastStrokePoints = null;
  var w = state.canvasW, h = state.canvasH;
  var maxClearX = 0; // one-way ratchet — cleared region only grows
  var frames = 0;    // safety cap against a stalled wipePosition
  var posProp = _wipeVM ? _wipeVM.number('wipePosition') : null;

  function animWipe() {
    var pos = posProp ? posProp.value : 0;
    var scale = Math.max(w / TORNADO_ARTBOARD_W, h / TORNADO_ARTBOARD_H);
    var offsetX = (w - TORNADO_ARTBOARD_W * scale) / 2;
    var clearX = Math.ceil(offsetX + pos * scale);
    clearX = Math.max(0, Math.min(w, clearX));

    if (clearX > maxClearX) {
      state.ctx.fillStyle = state.BG_CSS;
      state.ctx.fillRect(maxClearX, 0, clearX - maxClearX, h);
      maxClearX = clearX;
    }

    if (maxClearX >= w || ++frames > 600) {
      state.ctx.fillStyle = state.BG_CSS;
      state.ctx.fillRect(0, 0, w, h); // final fill guarantees no stray pixels
      state.effectBusy--;
      _wipeBusy = false;
      // Stop the tornado as soon as the *canvas* is cleared. The sweep's
      // wipePosition runs well off-screen (cover-fit responsiveness) before the
      // animation fires its own endWipe, so firing here ends the tornado promptly.
      // The wipe-container's animation endWipe (relayed below) remains as a fallback.
      _fireTrigger(_tornadoVM, 'endWipe');
    } else {
      requestAnimationFrame(animWipe);
    }
  }
  animWipe();
}

// ── Undo — delegates to undoMagic (same as the old dock) ──────────────────────
function doUndo() {
  if (_undoBusy || !state.undoSnapshot) return;
  if (state.undoSnapshot.width !== state.canvas.width || state.undoSnapshot.height !== state.canvas.height) return;
  _undoBusy = true;
  state.effectBusy++;
  undoMagic(function() {
    state.effectBusy--;
    setTimeout(function() { _undoBusy = false; }, 180);
  });
}
