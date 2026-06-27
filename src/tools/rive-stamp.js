import state from '../state.js';
import { saveHistory } from '../core/history.js';
import { hexToRgb, hslToRgb } from '../core/color-utils.js';
import { progressiveFloodFill } from '../core/fill.js';
import { doBoom } from './explosion.js';
import { doAlienBlast } from './alien-blast.js';

// ── Generic pooled Rive "stamp" player for placed effect tools ────────────────
// Each placed tool (fill, and later dynamite/alien) maps to a 360×360 artboard in
// rive-tools.riv that shares one View Model, "EffectVM". Here Rive is a *pure
// visual player*: pointer-events:none canvases positioned by JS, driven by
// triggers, with the permanent canvas mutation run by JS on the `impact` event.
//
//   place    (fire)  — pointer down: the instance appears at the tap point
//   dragging (bool)  — true while repositioning before commit
//   commit   (fire)  — pointer up: play the effect through to its climax
//   cancel   (fire)  — pointer left the canvas before committing
//   color    (color) — current paint colour, pushed in at place time
//   impact   (listen)— Rive's climax frame → JS runs the real effect here
//   done     (listen)— animation fully settled → recycle the instance
//
// Lifecycle: prewarmed instances sit idle on a blank frame (display:none) but run
// with autoplay so their state machines keep advancing — required because, once
// the old Rive dock (which kept a permanent advance loop alive) was removed, a
// settled/paused stamp would never advance to consume a fired trigger. On a tap we
// acquire a free one, position its canvas centred on the tap (anchor = artboard
// centre = impact zone), fire `place`, then `commit` on release. The SM returns to
// its initial state and fires `done` when complete, so a reused instance needs no
// manual reset. If all are busy we grow the pool on demand.

var ARTBOARD = 360;       // design px — anchor at centre is the impact zone
var DRAG_THRESH = 6;      // px of movement before a press counts as a drag
var PREWARM = 2;          // instances spun up per tool ahead of time
var MIN_COMMIT_GAP = 200; // ms — guarantee this beat between place and commit on a rapid tap

var _buffer = null;
var _pools = {};        // tool -> { artboard, impact, instances:[] }
var _active = null;     // instance currently being placed
var _pressX = 0, _pressY = 0, _moved = false;

// Registry of placed tools. `solo` tools allow only one live instance at a time.
var _registry = {
  fill:     { artboard: 'Fill bucket', impact: fillImpact },
  dynamite: { artboard: 'Dynamite',    impact: dynamiteImpact, solo: true },
  alien:    { artboard: 'Alien',       impact: alienImpact,    solo: true }
};

export function isPlacedTool(tool) {
  return Object.prototype.hasOwnProperty.call(_registry, tool);
}

export function initRiveStamp() {
  if (!window.rive) { console.warn('[rive-stamp] Rive runtime not loaded'); return; }
  fetch('src/rive/rive-tools.riv')
    .then(function(r) { return r.arrayBuffer(); })
    .then(function(buf) {
      _buffer = buf;
      Object.keys(_registry).forEach(function(tool) {
        var reg = _registry[tool];
        var pool = { artboard: reg.artboard, impact: reg.impact, solo: !!reg.solo, instances: [] };
        _pools[tool] = pool;
        for (var i = 0; i < PREWARM; i++) _createInstance(pool);
      });
      console.log('[rive-stamp] ready. Pools:', Object.keys(_pools).join(', '));
    })
    .catch(function(e) { console.error('[rive-stamp] failed to load rive-tools.riv:', e); });
}

function _createInstance(pool) {
  var canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;width:' + ARTBOARD + 'px;height:' + ARTBOARD +
    'px;pointer-events:none;z-index:100;display:none;';
  (state.canvasArea || document.getElementById('canvas-area')).appendChild(canvas);

  var inst = {
    canvas: canvas, rive: null, vm: null, ready: false, busy: false,
    tPlace: null, tCommit: null, tCancel: null, bDragging: null, cColor: null,
    cx: 0, cy: 0, placeT: 0, impact: pool.impact
  };
  pool.instances.push(inst);

  inst.rive = new window.rive.Rive({
    buffer: _buffer,
    canvas: canvas,
    artboard: pool.artboard,
    stateMachines: 'State Machine 1',
    autoplay: true,
    layout: new window.rive.Layout({ fit: window.rive.Fit.Contain }),
    onLoad: function() {
      // Don't size the surface here — the canvas is display:none (0×0) until first
      // use, which would lock the surface to zero (the classic dock bug). We size
      // on show in placedDown(), when the canvas has its real 360×360 box.
      var vmDef = inst.rive.viewModelByName('EffectVM');
      if (!vmDef) { console.warn('[rive-stamp] EffectVM not found on', pool.artboard); return; }
      inst.vm = vmDef.defaultInstance();
      inst.rive.bindViewModelInstance(inst.vm);
      inst.tPlace    = inst.vm.trigger('place');
      inst.tCommit   = inst.vm.trigger('commit');
      inst.tCancel   = inst.vm.trigger('cancel');
      inst.bDragging = inst.vm.boolean('dragging');
      inst.cColor    = inst.vm.color('color');
      var impact = inst.vm.trigger('impact');
      var done   = inst.vm.trigger('done');
      if (impact && typeof impact.on === 'function') impact.on(function() { _onImpact(inst); });
      if (done && typeof done.on === 'function') done.on(function() { _recycle(inst); });
      inst.ready = true;
    },
    onLoadError: function(e) { console.error('[rive-stamp] load error on', pool.artboard, e); }
  });
  return inst;
}

function _anyBusy(pool) {
  for (var i = 0; i < pool.instances.length; i++) if (pool.instances[i].busy) return true;
  return false;
}


function _acquire(tool) {
  var pool = _pools[tool];
  if (!pool) return null;
  for (var i = 0; i < pool.instances.length; i++) {
    if (pool.instances[i].ready && !pool.instances[i].busy) return pool.instances[i];
  }
  _createInstance(pool); // grow for next time (async load — not usable this tap)
  return null;
}

function _position(inst, x, y) {
  inst.canvas.style.left = (x - ARTBOARD / 2) + 'px';
  inst.canvas.style.top  = (y - ARTBOARD / 2) + 'px';
}

export function placedDown(x, y) {
  // Solo tools (dynamite, alien) allow only one live instance at a time — a new
  // placement is ignored until the current one finishes (fires done). This is the
  // v1 "one active at a time" rule that keeps heavy effects from stacking; the
  // multi-instance governor in MIGRATION.md §6 is still deferred.
  var pool = _pools[state.tool];
  if (pool && pool.solo && _anyBusy(pool)) return;
  var inst = _acquire(state.tool);
  if (!inst) return;
  _active = inst;
  _pressX = x; _pressY = y; _moved = false;
  inst.busy = true;
  inst.cx = x; inst.cy = y;
  inst.placeT = performance.now();

  _position(inst, x, y);
  inst.canvas.style.display = 'block';
  inst.rive.resizeDrawingSurfaceToCanvas();
  if (inst.cColor) inst.cColor.value = _currentArgb();
  if (inst.bDragging) inst.bDragging.value = false;
  _fire(inst.tPlace);
}

export function placedMove(x, y) {
  if (!_active) return;
  if (!_moved) {
    var dx = x - _pressX, dy = y - _pressY;
    if (dx * dx + dy * dy < DRAG_THRESH * DRAG_THRESH) return;
    _moved = true;
    if (_active.bDragging) _active.bDragging.value = true;
  }
  _active.cx = x; _active.cy = y;
  _position(_active, x, y);
}

export function placedUp() {
  if (!_active) return;
  var inst = _active;
  _active = null;
  if (inst.bDragging) inst.bDragging.value = false;
  // On a rapid tap, hold commit until at least MIN_COMMIT_GAP after place so the
  // place animation gets a beat to read before the effect fires. The instance
  // stays busy (won't be re-acquired) until done, so the deferred commit is safe.
  var elapsed = performance.now() - inst.placeT;
  if (elapsed < MIN_COMMIT_GAP) {
    setTimeout(function() { _fire(inst.tCommit); }, MIN_COMMIT_GAP - elapsed);
  } else {
    _fire(inst.tCommit);
  }
}

export function placedCancel() {
  if (!_active) return;
  var inst = _active;
  _active = null;
  _fire(inst.tCancel);
  // The SM should return to initial (and fire done) on cancel; recycle as a
  // fallback in case it doesn't. _recycle is idempotent.
  setTimeout(function() { _recycle(inst); }, 1500);
}

function _onImpact(inst) {
  if (!inst.busy) return;
  if (typeof inst.impact === 'function') inst.impact(inst.cx, inst.cy);
}

function _recycle(inst) {
  if (!inst.busy) return;
  inst.busy = false;
  inst.canvas.style.display = 'none';
  if (inst.bDragging) inst.bDragging.value = false;
}

function _fire(t) {
  if (!t) return;
  if (typeof t.fire === 'function') t.fire();
  else if (typeof t.trigger === 'function') t.trigger();
}

function _currentArgb() {
  var hex = state.color || '#000000';
  if (hex[0] !== '#' || hex.length < 7) return 0xFF000000 >>> 0;
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return ((0xFF << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

// ── Fill impact ───────────────────────────────────────────────────────────────
// Flood fill at the impact point, reusing the snapshot saveHistory() just took so
// the fill doesn't do a second GPU readback.
var _fillBusy = false;
function fillImpact(x, y) {
  if (_fillBusy) return;
  _fillBusy = true;
  state.effectBusy++;
  saveHistory();
  state.lastStrokePoints = null;
  var fc = state.rainbowMode ? 'hsl(' + Math.floor(Math.random() * 360) + ',100%,50%)' : state.color;
  var rgb = fc.indexOf('hsl') === 0 ? hslToRgb(fc) : hexToRgb(fc);
  var sx = Math.round(x * state.DPR);
  var sy = Math.round(y * state.DPR);
  progressiveFloodFill(sx, sy, rgb, function() {
    _fillBusy = false;
    state.effectBusy--;
  }, state.undoSnapshot);
}

// ── Dynamite / Alien impacts ──────────────────────────────────────────────────
// doBoom and doAlienBlast manage their own saveHistory + effectBusy accounting,
// so the impact handler just delegates at the placement point (CSS px).
function dynamiteImpact(x, y) { doBoom(x, y); }
function alienImpact(x, y)    { doAlienBlast(x, y); }
