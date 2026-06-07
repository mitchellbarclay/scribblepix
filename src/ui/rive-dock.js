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
var _fillBusy = false;
var _bound = false;
var _riveCapturing = false; // true while a dock tool drag is in progress
var _dockAtTop = false;
var _lastFlipAt = 0;
var _bottomDefault = null; // initial bottomPlacement captured after Rive loads
var DOCK_EDGE = 18;

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

  // Per-frame sync: fill colour + dock centering
  var _lastColor = '';
  _riveInst.on(window.rive.EventType.Advance, function() {
    if (state.color !== _lastColor) {
      _syncFillColor();
      _lastColor = state.color;
    }
    _centerDock();
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
      // Dispatch to the drawing canvas (not window) so the canvas mouseup
      // handler fires and calls all tool finalizers (rect, ellipse, pipe, etc.).
      // bubbles:true lets it propagate to window for the bolt safety-net too.
      state.canvas.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
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

  // Capture initial bottomPlacement so we know the "dock at bottom" value
  var bpInit = _dockVM.number('bottomPlacement');
  if (bpInit) _bottomDefault = bpInit.value;

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

  // Mirror: watch mirrorActive boolean on the nested 'mirror' VM instance
  var mirrorInst = _dockVM.viewModel('mirror');
  if (mirrorInst) {
    _toolVMs.mirror = mirrorInst;
    var mirrorBool = mirrorInst.boolean('mirrorActive');
    if (mirrorBool && typeof mirrorBool.on === 'function') {
      mirrorBool.on(function() {
        state.mirrorMode = mirrorBool.value;
        var btn = document.getElementById('mirror-toggle');
        if (btn) btn.classList.toggle('active', state.mirrorMode);
      });
    } else {
      console.warn('[rive-dock] mirrorActive boolean not found or not subscribable');
    }
  } else {
    console.warn('[rive-dock] missing VM instance for: mirror');
  }

  // Alien: watch blast trigger on the nested 'alien' VM instance
  var alienInst = _dockVM.viewModel('alien');
  if (alienInst) {
    _toolVMs.alien = alienInst;
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
        _fireEffect('alien', dropX, dropY);
      });
    } else {
      console.warn('[rive-dock] blast trigger not found or not subscribable on alien VM');
    }
  } else {
    console.warn('[rive-dock] missing VM instance for: alien');
  }

  _syncFillColor();
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

function _hexToArgb(hex) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return 0xFF000000 >>> 0;
  var r = parseInt(hex.slice(1, 3), 16);
  var g = parseInt(hex.slice(3, 5), 16);
  var b = parseInt(hex.slice(5, 7), 16);
  return ((0xFF << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

// ── Dock vertical flip — triggered when a stroke passes through the dock area ──

export function riveDockStrokeHit(cx, cy) {
  if (!_active || !_dockVM) return;
  if (Date.now() - _lastFlipAt < 480) return;
  var canvas = document.getElementById('rive-dock-canvas');
  if (!canvas) return;
  var rect = canvas.getBoundingClientRect();
  var px = cx - rect.left;
  var py = cy - rect.top;
  if (_isInDock(px, py)) _flipDockVertical();
}

function _flipDockVertical() {
  if (!_dockVM) return;
  _dockAtTop = !_dockAtTop;
  _lastFlipAt = Date.now();
  var bpProp = _dockVM.number('bottomPlacement');
  var dhProp = _dockVM.number('dockH');
  if (!bpProp) return;
  if (_dockAtTop) {
    var dh = dhProp ? dhProp.value : 80;
    bpProp.value = state.canvasH - dh - DOCK_EDGE;
  } else {
    bpProp.value = _bottomDefault !== null ? _bottomDefault : DOCK_EDGE;
  }
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
  } else if (toolName === 'alien') {
    _doAlienBlast(dropX, dropY);
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
  saveHistory();
  state.lastStrokePoints = null;
  var fc = state.rainbowMode ? 'hsl(' + Math.floor(Math.random() * 360) + ',100%,50%)' : state.color;
  var rgb = fc.indexOf('hsl') === 0 ? hslToRgb(fc) : hexToRgb(fc);
  var sx = Math.round(dropX * state.DPR);
  var sy = Math.round(dropY * state.DPR);
  progressiveFloodFill(sx, sy, rgb, function() {
    _fillBusy = false;
  });
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

// ── Alien blast: concentrated paint explosion + displacement wave ──────────────
// Rive handles the UFO animation; this fires the canvas-side impact effect.

var _ALIEN_SCHEMES = [
  ['#ff4daa', '#c44dff'],
  ['#4dffb4', '#4db8ff'],
  ['#ffe04d', '#ff8c4d'],
  ['#4dff91', '#00d4ff'],
  ['#ff4d6e', '#ff9b4d'],
];

function _doAlienBlast(dropX, dropY) {
  saveHistory();
  state.lastStrokePoints = null;

  var scheme = _ALIEN_SCHEMES[Math.floor(Math.random() * _ALIEN_SCHEMES.length)];
  function pick() { return scheme[Math.floor(Math.random() * scheme.length)]; }
  var blastHue = Math.floor(Math.random() * 360);

  var maxR = Math.ceil(Math.sqrt(
    Math.pow(Math.max(dropX, state.canvasW - dropX), 2) +
    Math.pow(Math.max(dropY, state.canvasH - dropY), 2)
  )) + 10;

  // Epicentre flash burned in immediately — snapshot includes it so wave carries it outward
  var cg = state.ctx.createRadialGradient(dropX, dropY, 0, dropX, dropY, 22);
  cg.addColorStop(0, 'rgba(255,255,255,0.95)');
  cg.addColorStop(0.4, 'hsla(' + blastHue + ',100%,72%,0.75)');
  cg.addColorStop(1, 'hsla(' + blastHue + ',100%,72%,0)');
  state.ctx.fillStyle = cg;
  state.ctx.beginPath(); state.ctx.arc(dropX, dropY, 22, 0, Math.PI * 2); state.ctx.fill();

  // Snapshot after the epicentre flash so the wave displaces it outward
  var snapCanvas = document.createElement('canvas');
  snapCanvas.width = state.canvas.width;
  snapCanvas.height = state.canvas.height;
  snapCanvas.getContext('2d').drawImage(state.canvas, 0, 0);
  var snapData = snapCanvas.getContext('2d').getImageData(0, 0, snapCanvas.width, snapCanvas.height);

  var pulseR = 0;
  var flashAlpha = 1.0;
  var paintStamped = false;
  var PULSE_SPEED = 580;

  var lastT = performance.now();
  function blastFrame() {
    var now = performance.now();
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    flashAlpha = Math.max(0, flashAlpha - dt * 3.2);
    pulseR += dt * PULSE_SPEED;

    // Wave displacement from pre-blast snapshot
    if (snapData && pulseR < maxR) {
      _applyBlastWave(snapData, dropX, dropY, pulseR);
    } else if (pulseR >= maxR) {
      snapData = null;
    }

    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);

    // Overlay flash glow
    if (flashAlpha > 0) {
      var fg = state.ovCtx.createRadialGradient(dropX, dropY, 0, dropX, dropY, 65);
      fg.addColorStop(0, 'rgba(255,255,255,' + flashAlpha.toFixed(3) + ')');
      fg.addColorStop(0.45, 'hsla(' + blastHue + ',100%,72%,' + (flashAlpha * 0.55).toFixed(3) + ')');
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      state.ovCtx.fillStyle = fg;
      state.ovCtx.beginPath(); state.ovCtx.arc(dropX, dropY, 65, 0, Math.PI * 2); state.ovCtx.fill();
    }

    // Expanding shockwave ring on overlay
    if (pulseR < maxR + 30) {
      var ringFade = Math.max(0, 1 - pulseR / maxR);
      state.ovCtx.save();
      state.ovCtx.globalAlpha = ringFade * 0.45;
      state.ovCtx.strokeStyle = 'hsla(' + blastHue + ',100%,72%,1)';
      state.ovCtx.lineWidth = 18;
      state.ovCtx.beginPath(); state.ovCtx.arc(dropX, dropY, pulseR, 0, Math.PI * 2); state.ovCtx.stroke();
      state.ovCtx.restore();
      state.ovCtx.save();
      state.ovCtx.globalAlpha = ringFade * 0.9;
      state.ovCtx.strokeStyle = 'white';
      state.ovCtx.lineWidth = 2;
      state.ovCtx.beginPath(); state.ovCtx.arc(dropX, dropY, pulseR, 0, Math.PI * 2); state.ovCtx.stroke();
      state.ovCtx.restore();
    }

    // Stamp paint explosion at epicentre once the flash dims
    if (!paintStamped && flashAlpha < 0.35) {
      paintStamped = true;
      var baseR = Math.max(12, Math.min(48, state.brushSize * 0.65 + 8));
      state.ctx.save();
      // Core blobs
      for (var i = 0; i < 10; i++) {
        var ang = (i / 10) * Math.PI * 2;
        var blobD = Math.random() * baseR * 0.45;
        var blobR = baseR * (0.55 + Math.random() * 0.6);
        state.ctx.fillStyle = pick();
        state.ctx.beginPath();
        state.ctx.arc(dropX + Math.cos(ang) * blobD, dropY + Math.sin(ang) * blobD, blobR, 0, Math.PI * 2);
        state.ctx.fill();
      }
      // Tendrils
      for (var l = 0; l < 5; l++) {
        var ta = Math.random() * Math.PI * 2;
        var tlen = baseR * (1.4 + Math.random() * 2.2);
        var tw = baseR * (0.28 + Math.random() * 0.35);
        var tx = dropX, ty = dropY;
        var tsteps = Math.ceil(tlen);
        state.ctx.fillStyle = pick();
        for (var s = 0; s < tsteps; s++) {
          var tt = s / tsteps;
          var tr = Math.max(1, tw * (1 - tt * 0.8));
          state.ctx.beginPath();
          state.ctx.arc(tx, ty, tr, 0, Math.PI * 2);
          state.ctx.fill();
          ta += (Math.random() - 0.5) * 0.14;
          tx += Math.cos(ta); ty += Math.sin(ta);
        }
      }
      // Satellite splatters
      for (var k = 0; k < 7; k++) {
        var sa = Math.random() * Math.PI * 2;
        var sataD = baseR * (1.4 + Math.random() * 2.8);
        var satR = Math.max(2, baseR * (0.1 + Math.random() * 0.28));
        state.ctx.fillStyle = pick();
        state.ctx.beginPath();
        state.ctx.arc(dropX + Math.cos(sa) * sataD, dropY + Math.sin(sa) * sataD, satR, 0, Math.PI * 2);
        state.ctx.fill();
      }
      state.ctx.restore();
    }

    if (pulseR < maxR || flashAlpha > 0) {
      requestAnimationFrame(blastFrame);
    } else {
      snapData = null;
      state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
    }
  }
  requestAnimationFrame(blastFrame);
}

// Per-frame radial wave displacement — reads only from snapData, never stalls on GPU readback.
function _applyBlastWave(snapData, blastX, blastY, waveR) {
  var DPR = state.DPR;
  var WAVE_W = 45, WAVE_DECAY = 65, WAVE_MAX = 38, PUSH_R = 240;

  var waveRp  = waveR   * DPR;
  var waveWp  = WAVE_W  * DPR;
  var decayDp = WAVE_DECAY * DPR;
  var maxPushP = WAVE_MAX * DPR;
  var pushRp  = PUSH_R  * DPR;

  var settleRp = Math.round(4 * decayDp);
  var innerRp  = Math.max(0, waveRp - settleRp);
  var outerRp  = Math.min(pushRp, waveRp + waveWp);
  if (innerRp >= outerRp) return;

  var bcx = blastX * DPR, bcy = blastY * DPR;
  var snapW = snapData.width;
  var sd = snapData.data;

  var bx0 = Math.max(0, Math.floor(bcx - outerRp - 2));
  var by0 = Math.max(0, Math.floor(bcy - outerRp - 2));
  var bx1 = Math.min(state.canvas.width,  Math.ceil(bcx + outerRp + 2));
  var by1 = Math.min(state.canvas.height, Math.ceil(bcy + outerRp + 2));
  var pw = bx1 - bx0, ph = by1 - by0;
  if (pw <= 0 || ph <= 0) return;

  var lutSize = Math.ceil(outerRp) + 2;
  var lut = new Float32Array(lutSize);
  for (var li = 0; li < lutSize; li++) {
    if (li <= innerRp) { lut[li] = 0; continue; }
    var lag = waveRp - li;
    if (lag < -waveWp || li > pushRp) { lut[li] = 0; continue; }
    if (lag < 0) {
      var te = (lag + waveWp) / waveWp;
      lut[li] = te * te * maxPushP;
    } else {
      lut[li] = maxPushP * Math.exp(-lag / decayDp);
    }
  }

  var dst = new ImageData(pw, ph);
  var dd  = dst.data;
  var outerRp2 = outerRp * outerRp;

  for (var py = 0; py < ph; py++) {
    var wy  = py + by0;
    var dy0 = wy - bcy;
    var dy2 = dy0 * dy0;
    for (var px = 0; px < pw; px++) {
      var wx  = px + bx0;
      var dx0 = wx - bcx;
      var di  = (py * pw + px) * 4;
      var dist2 = dx0 * dx0 + dy2;

      if (dist2 > outerRp2) {
        var os = (wy * snapW + wx) * 4;
        dd[di] = sd[os]; dd[di+1] = sd[os+1]; dd[di+2] = sd[os+2]; dd[di+3] = sd[os+3];
        continue;
      }

      var dist = Math.sqrt(dist2);
      var dIdx = Math.min(Math.round(dist), lutSize - 1);
      var strength = lut[dIdx];
      var srcX, srcY;
      if (strength < 0.5 || dist < 1) {
        srcX = wx; srcY = wy;
      } else {
        srcX = Math.min(Math.max(0, Math.round(wx - (dx0 / dist) * strength)), snapW - 1);
        srcY = Math.min(Math.max(0, Math.round(wy - (dy0 / dist) * strength)), snapData.height - 1);
      }
      var si = (srcY * snapW + srcX) * 4;
      dd[di] = sd[si]; dd[di+1] = sd[si+1]; dd[di+2] = sd[si+2]; dd[di+3] = sd[si+3];
    }
  }
  state.ctx.putImageData(dst, bx0, by0);
}
