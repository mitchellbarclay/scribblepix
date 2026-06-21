import state from '../state.js';
import { saveHistory, undoMagic } from '../core/history.js';
import { hexToRgb, hslToRgb, lightenColor } from '../core/color-utils.js';
import { progressiveFloodFill } from '../core/fill.js';
import { doBoom } from '../tools/explosion.js';
import { doAlienBlast } from '../tools/alien-blast.js';

var _riveInst = null;
var _dockVM = null;
var _toolVMs = {};
var _active = false;
var _undoBusy = false;
var _fillBusy = false;
var _bound = false;
var _riveCapturing = false; // true while a dock tool drag is in progress
var _strokeFaded = false;  // dock faded out because the current stroke crossed it
var _mirrorBool = null;   // polled each Advance frame to sync mirror state
var _releaseReadyBool = null; // DockVM.releaseReady — gates whether a release leads to an action
var _pendingReleases = []; // safety-timeout ids, one per release that promised an action trigger

export function initRiveDock() {
  if (!window.rive) { console.warn('[rive-dock] Rive runtime not loaded'); return; }
  var canvas = document.getElementById('rive-dock-canvas');
  if (!canvas) return;

  _sizeCanvas(canvas);

  // Keep the canvas backing store, Rive's drawing surface, and the DockVM
  // canvas size all in sync with the current canvas-area size.
  //
  // Critical guard: bail when the canvas has no rendered size. During the
  // initial load the main canvas's ResizeObserver fires resize(), which adds
  // .resizing to #canvas-area and hides #rive-dock-canvas (display:none) for
  // ~180ms. resizeDrawingSurfaceToCanvas() measures the canvas via
  // getBoundingClientRect — 0×0 while hidden — which would lock Rive's drawing
  // surface to zero and leave the dock invisible until a manual refresh. This
  // is the root of the "dock not sized / missing on load" bug.
  function _resync() {
    var rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    _sizeCanvas(canvas);
    if (_riveInst) _riveInst.resizeDrawingSurfaceToCanvas();
    _pushCanvasSize();
    _syncDockColour();  // gradient sample depends on dock geometry
  }

  window.addEventListener('resize', _resync);
  // Observe the canvas element itself (not #canvas-area). It's inset:0 inside
  // the area, so it tracks every area size change AND fires on the
  // display:none→block transition when .resizing clears after load — which is
  // exactly when we need to re-sync the surface to its now-visible size.
  if (window.ResizeObserver) new ResizeObserver(_resync).observe(canvas);

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
      // Re-sync the drawing surface now that load is complete and the layout
      // has settled. The surface size captured during async load can lag the
      // final canvas-area size, which left the dock rendered at the wrong scale
      // until a manual refresh.
      //
      // If load lands during the ~180ms .resizing flash at startup the canvas
      // is display:none, so this _resync (and any during the flash) bails on the
      // zero-size guard, and ResizeObserver does NOT fire on display:none→block.
      // The delayed re-syncs below run after the flash clears (canvas visible
      // again) and correct a surface that would otherwise be stuck at zero —
      // closing the intermittent "dock missing on load" race for good.
      _resync();
      setTimeout(_resync, 250);
      setTimeout(_resync, 600);
      _bindViewModels();
    },
    onLoadError: function(e) {
      console.error('[rive-dock] failed to load .riv:', e);
    }
  });

  // Per-frame sync: fill colour, dock centering, mirror state
  var _lastColor = '';
  var _lastMirror = false;
  _riveInst.on(window.rive.EventType.Advance, function() {
    if (state.color !== _lastColor) {
      _syncFillColor();
      _syncDockColour();
      _lastColor = state.color;
    }
    _centerDock();
    if (_mirrorBool) {
      var mv = _mirrorBool.value;
      if (mv !== _lastMirror) {
        _lastMirror = mv;
        state.mirrorMode = mv;
        var btn = document.getElementById('mirror-toggle');
        if (btn) btn.classList.toggle('active', mv);
      }
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

  // Stuck-drag safety: if a dock tool is being dragged and the pointer leaves
  // the rive canvas before releasing (mouse heading into a rail or out the
  // window), Rive never sees the pointer-up and the tool stays glued to a
  // pointer it can no longer track. Resolve the drag so the tool returns to the
  // dock *without* actioning: force releaseReady false (so the release leads to
  // a plain bounce-back, never an effect) and clear dragging (otherwise the tool
  // bounces back but stays at drag scale) before firing the release trigger.
  canvas.addEventListener('pointerleave', function() {
    if (!_riveCapturing) return;
    _riveCapturing = false;
    if (_releaseReadyBool) _releaseReadyBool.value = false;
    Object.keys(_toolVMs).forEach(function(name) {
      var vm = _toolVMs[name];
      var dragging = vm.boolean && vm.boolean('dragging');
      if (dragging && dragging.value) {
        dragging.value = false;
        _fireTrigger(vm, 'release');
      }
    });
  });

  canvas.addEventListener('pointerup', function(e) {
    if (!_active) return;
    var wasCap = _riveCapturing;
    _riveCapturing = false;
    if (!wasCap) {
      // Dispatch to the drawing canvas (not window) so the canvas mouseup
      // handler fires and calls all tool finalizers (rect, ellipse, pipe, etc.).
      // bubbles:true lets it propagate to window for the bolt safety-net too.
      state.canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }
  });

  // ── touchend → mouseup shim ────────────────────────────────────────────────
  // The Rive web runtime's touchend handler fires pointerUp + pointerExit
  // before the same advance; the exit clears any hover ("over dock") state the
  // .riv state machine relies on, so releasing a dragged tool inside the dock
  // behaved like dropping it on the canvas. mouseup fires pointerUp only.
  // Intercept touchend in the capture phase (runs before Rive's bubble
  // listener) and replay it as a mouseup so touch matches mouse semantics.
  // Native pointerup has already fired by touchend time, so the relay above
  // is unaffected.
  var _touchId = null;
  canvas.addEventListener('touchstart', function(e) {
    if (_touchId === null && e.changedTouches.length) _touchId = e.changedTouches[0].identifier;
  }, true);
  canvas.addEventListener('touchend', function(e) {
    var t = null;
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === _touchId) { t = e.changedTouches[i]; break; }
    }
    if (!t) return;
    _touchId = null;
    e.preventDefault();
    e.stopImmediatePropagation();
    canvas.dispatchEvent(new MouseEvent('mouseup', { clientX: t.clientX, clientY: t.clientY }));
    // Rive resets its single-touch primary-finger lock in its touchend handler
    // (now suppressed) and in touchcancel — fire the latter so the next touch
    // can claim the lock. Its touchcancel callback ignores the event payload.
    canvas.dispatchEvent(new Event('touchcancel'));
    // stopImmediatePropagation also keeps the touchend from window's slider/
    // colour release handlers — replay it so a drag that wanders onto the
    // dock canvas still releases cleanly.
    window.dispatchEvent(new Event('touchend'));
  }, true);
  canvas.addEventListener('touchcancel', function() { _touchId = null; }, true);
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
// Defaults to true (assume in dock) when bounds are unknown/zero — this
// prevents accidental mousedown relays that draw a brush stamp before a fill.
function _isInDock(px, py) {
  if (!_dockVM) return true;
  var dw = _dockVM.number('dockW');
  var dh = _dockVM.number('dockH');
  var lp = _dockVM.number('leftPlacement');
  var bp = _dockVM.number('bottomPlacement');
  if (!dw || !dh || !lp || !bp) return true;
  var w = dw.value, h = dh.value, left = lp.value, bottom = bp.value;
  if (w <= 0 || h <= 0) return true;
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

  _releaseReadyBool = _dockVM.boolean('releaseReady');
  if (!_releaseReadyBool) console.warn('[rive-dock] releaseReady boolean not found — release lockout disabled');

  var effectTriggerNames = { tornado: 'wipe', dynamite: 'explode', fill: 'fill', undo: 'undo' };

  ['tornado', 'dynamite', 'fill', 'undo'].forEach(function(name) {
    var inst = _dockVM.viewModel(name);
    if (!inst) { console.warn('[rive-dock] missing VM instance for:', name); return; }
    _toolVMs[name] = inst;
    _watchRelease(inst, name);

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

  // Mirror: poll mirrorActive boolean each Advance frame (SM-driven writes don't
  // reliably fire .on() so polling is the safe approach)
  var mirrorInst = _dockVM.viewModel('mirror');
  if (mirrorInst) {
    _toolVMs.mirror = mirrorInst;
    _mirrorBool = mirrorInst.boolean('mirrorActive');
    if (!_mirrorBool) console.warn('[rive-dock] mirrorActive boolean not found — check property name in Rive');
  } else {
    console.warn('[rive-dock] missing VM instance for: mirror');
  }

  // Alien: watch blast trigger on the nested 'alien' VM instance
  var alienInst = _dockVM.viewModel('alien');
  if (alienInst) {
    _toolVMs.alien = alienInst;
    _watchRelease(alienInst, 'alien');
    var blastTrig = alienInst.trigger('blast');
    if (blastTrig && typeof blastTrig.on === 'function') {
      blastTrig.on(function() {
        var dropX = 0, dropY = 0;
        if (_dockVM) {
          var pxProp = _dockVM.number('dropX');
          var pyProp = _dockVM.number('dropY');
          if (pxProp) dropX = pxProp.value;
          if (pyProp) dropY = pyProp.value;
        }
        console.log('[rive-dock] alien blast at', Math.round(dropX), Math.round(dropY));
        setTimeout(function() { _fireEffect('alien', dropX, dropY); }, 500);
      });
    } else {
      console.warn('[rive-dock] blast trigger not found or not subscribable on alien VM');
    }
  } else {
    console.warn('[rive-dock] missing VM instance for: alien');
  }

  _syncFillColor();
  _syncDockColour();
  console.log('[rive-dock] ready. Tools bound:', Object.keys(_toolVMs).join(', '));
}

function _pushCanvasSize() {
  if (!_dockVM) return;
  var area = state.canvasArea || document.getElementById('canvas-area');
  var w = area ? area.clientWidth : state.canvasW;
  var h = area ? area.clientHeight : state.canvasH;
  var cw = _dockVM.number('canvasW');
  var ch = _dockVM.number('canvasH');
  if (cw) cw.value = w;
  if (ch) ch.value = h;
}

function _centerDock() {
  if (!_dockVM) return;
  var dwProp = _dockVM.number('dockW');
  var lpProp = _dockVM.number('leftPlacement');
  if (!dwProp || !lpProp || dwProp.value <= 0) return;
  lpProp.value = (state.canvasW - dwProp.value) / 2;
}

function _syncFillColor() {
  var vm = _toolVMs.fill;
  if (!vm) return;
  var prop = vm.color('paintColour');
  if (!prop) return;
  prop.value = _hexToArgb(state.color || '#000000');
}

// The page background is a 135° gradient: linear-gradient(135deg, c1 0%, c2 50%,
// c3 100%) running top-left → bottom-right. For that angle the colour-stop
// fraction at any viewport point (x,y) is simply t = (x+y)/(W+H). Return the
// interpolated stop colour at t. Stops mirror updateBackground() in
// color-picker.js, including the near-white clamp.
function _bgGradientAt(rgb, t) {
  var nearWhite = rgb[0] > 240 && rgb[1] > 240 && rgb[2] > 240;
  var c1, c2, c3;
  if (nearWhite) {
    c1 = [232, 236, 240]; c2 = [218, 223, 229]; c3 = [198, 205, 213];
  } else {
    c1 = lightenColor(rgb, 0.84);
    c2 = lightenColor(rgb, 0.78);
    c3 = lightenColor(rgb, 0.72);
  }
  t = Math.max(0, Math.min(1, t));
  var a, b, f;
  if (t <= 0.5) { a = c1; b = c2; f = t / 0.5; }
  else { a = c2; b = c3; f = (t - 0.5) / 0.5; }
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f)
  ];
}

function _syncDockColour() {
  if (!_dockVM) return;
  var prop = _dockVM.color('dockColour');
  if (!prop) return;
  // Match the page background behind the canvas (full opacity) so the dock reads
  // as a notch in the outer page. Using the flat bottom stop (c3) is too dark:
  // c3 only occurs at the bottom-RIGHT corner of the diagonal gradient, while
  // the dock sits at the horizontal centre where the gradient is lighter.
  // Sample the gradient at the dock's bottom edge — that edge is the only place
  // the dock meets the page (its top edge borders the white canvas), so a perfect
  // match there hides the seam.
  var rgb = hexToRgb(state.color || '#000000');
  var canvas = document.getElementById('rive-dock-canvas');
  var t = 1;
  if (canvas) {
    var r = canvas.getBoundingClientRect();
    var W = window.innerWidth || (r.left + r.width);
    var H = window.innerHeight || r.bottom;
    if (W + H > 0) t = (r.left + r.width / 2 + r.bottom) / (W + H);
  }
  var c = _bgGradientAt(rgb, t);
  prop.value = ((0xFF << 24) | (c[0] << 16) | (c[1] << 8) | c[2]) >>> 0;
}

function _hexToArgb(hex) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return 0xFF000000 >>> 0;
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return ((0xFF << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

// ── Dock fade — when a stroke passes through the dock area, fade the dock out
// for the rest of the stroke instead of moving it (repositioning broke on
// device rotation). riveDockStrokeEnd() restores it on stroke end.

export function riveDockStrokeHit(cx, cy) {
  if (!_active || !_dockVM || _strokeFaded) return;
  var canvas = document.getElementById('rive-dock-canvas');
  if (!canvas) return;
  var rect = canvas.getBoundingClientRect();
  var px = cx - rect.left;
  var py = cy - rect.top;
  if (_isInDock(px, py)) {
    _strokeFaded = true;
    canvas.style.opacity = '0';
  }
}

export function riveDockStrokeEnd() {
  if (!_strokeFaded) return;
  _strokeFaded = false;
  var canvas = document.getElementById('rive-dock-canvas');
  if (canvas) canvas.style.opacity = '';
}

// ── Release → action lockout ─────────────────────────────────────────────────
// The action trigger only fires after the tool's drop animation finishes, so
// locking the canvas at action time left the release→action window drawable.
// Each tool VM fires a `release` trigger on drop; if DockVM.releaseReady is
// true at that moment an action trigger is guaranteed to follow, so we take
// the effectBusy lock immediately and hand it over to the effect when the
// action trigger arrives (consumed in _fireEffect). If releaseReady is false
// the tool just bounces back — no lock taken, nothing to get stuck on. A 6s
// safety timeout frees the lock if the promised action trigger never shows.

function _watchRelease(inst, name) {
  var rel = inst.trigger('release');
  if (!rel || typeof rel.on !== 'function') {
    console.warn('[rive-dock] no release trigger on:', name);
    return;
  }
  rel.on(function() {
    if (!_releaseReadyBool || !_releaseReadyBool.value) return;
    state.effectBusy++;
    var tid = setTimeout(function() {
      var idx = _pendingReleases.indexOf(tid);
      if (idx !== -1) {
        console.warn('[rive-dock] action trigger never arrived after release — freeing canvas lock');
        _pendingReleases.splice(idx, 1);
        state.effectBusy--;
      }
    }, 6000);
    _pendingReleases.push(tid);
  });
}

function _consumePendingRelease() {
  var tid = _pendingReleases.shift();
  if (tid !== undefined) {
    clearTimeout(tid);
    state.effectBusy--;
  }
}

function _fireEffect(toolName, dropX, dropY) {
  // Hand the release lock over to the effect's own effectBusy accounting.
  _consumePendingRelease();
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
  } else if (toolName === 'alien') {
    doAlienBlast(dropX, dropY);
  }
}

// ── Tornado: wipe synced to Rive's wipePosition ───────────────────────────────
// The tornado is a nested artboard (1180 × 820 design px) with cover/leaf
// fitting, so it scales to fill the canvas and is centered. wipePosition is
// in artboard design-space, so we must account for the cover scale and the
// horizontal offset before converting to canvas pixels.
//
//   scale   = max(canvasW / 1180, canvasH / 820)
//   offsetX = (canvasW − 1180 * scale) / 2
//   canvasX = offsetX + wipePosition * scale   → clamped to [0, canvasW]

var TORNADO_ARTBOARD_W = 1180;
var TORNADO_ARTBOARD_H = 820;

function _doTornadoWipe() {
  saveHistory();
  state.effectBusy++;
  state.lastStrokePoints = null;
  var w = state.canvasW, h = state.canvasH;
  var maxClearX = 0; // one-way ratchet — cleared region only grows

  function animWipe() {
    var pos = 0;
    if (_dockVM) {
      var posProp = _dockVM.number('wipePosition');
      if (posProp) pos = posProp.value;
    }

    var scale = Math.max(w / TORNADO_ARTBOARD_W, h / TORNADO_ARTBOARD_H);
    var offsetX = (w - TORNADO_ARTBOARD_W * scale) / 2;
    var clearX = Math.ceil(offsetX + pos * scale);
    clearX = Math.max(0, Math.min(w, clearX));

    if (clearX > maxClearX) {
      state.ctx.fillStyle = state.BG_CSS;
      state.ctx.fillRect(maxClearX, 0, clearX - maxClearX, h);
      maxClearX = clearX;
    }

    if (maxClearX >= w) {
      // Canvas fully cleared — final fill guarantees no stray pixels
      state.ctx.fillRect(0, 0, w, h);
      state.effectBusy--;
    } else {
      requestAnimationFrame(animWipe);
    }
  }
  animWipe();
}

// ── Fill: immediate flood fill — Rive handles the drip animation ──────────────

function _doFill(dropX, dropY) {
  if (_fillBusy) return;
  _fillBusy = true;
  state.effectBusy++;
  saveHistory();
  state.lastStrokePoints = null;
  var fc = state.rainbowMode ? 'hsl(' + Math.floor(Math.random() * 360) + ',100%,50%)' : state.color;
  var rgb = fc.indexOf('hsl') === 0 ? hslToRgb(fc) : hexToRgb(fc);
  var sx = Math.round(dropX * state.DPR);
  var sy = Math.round(dropY * state.DPR);
  // Pass the snapshot saveHistory just took so the fill copies it instead of
  // doing a second synchronous GPU readback of the whole canvas.
  progressiveFloodFill(sx, sy, rgb, function() {
    _fillBusy = false;
    state.effectBusy--;
  }, state.undoSnapshot);
}

// ── Undo: delegates to undoMagic from history.js ─────────────────────────────

function _doUndo() {
  if (_undoBusy || !state.undoSnapshot) return;
  if (state.undoSnapshot.width !== state.canvas.width || state.undoSnapshot.height !== state.canvas.height) return;
  _undoBusy = true;
  state.effectBusy++;
  undoMagic(function() {
    state.effectBusy--;
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
