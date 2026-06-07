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
var _mirrorBool = null;   // polled each Advance frame to sync mirror state

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

  // Per-frame sync: fill colour, dock centering, mirror state
  var _lastColor = '';
  var _lastMirror = false;
  _riveInst.on(window.rive.EventType.Advance, function() {
    if (state.color !== _lastColor) {
      _syncFillColor();
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

// ── Alien blast: permanent pixel scatter + paint explosion + overlay animation ──
// Rive handles the UFO animation; this fires the canvas-side impact effect.
// Three distinct permanent marks are left on the canvas:
//   1. Outward pixel displacement warp (done once, never reverts)
//   2. Crater mark with neon rim
//   3. Large paint explosion — blobs, tendrils, far satellites, energy streaks

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
  var blastHue = Math.floor(Math.random() * 360);

  var maxR = Math.ceil(Math.sqrt(
    Math.pow(Math.max(dropX, state.canvasW - dropX), 2) +
    Math.pow(Math.max(dropY, state.canvasH - dropY), 2)
  )) + 10;

  // 1. Permanent outward pixel warp — reads canvas once, displaces pixels away from
  //    blast centre, writes back. No per-frame revert.
  _applyPermanentBlastWarp(dropX, dropY);

  // 2. Permanent crater + paint explosion stamped directly onto canvas
  _stampAlienExplosion(dropX, dropY, scheme, blastHue);

  // 3. Overlay-only animation: flash glow + expanding rings + debris sparks.
  //    Nothing here writes to state.canvas — all visual revert is fine.
  var pulseR = 0;
  var flashAlpha = 1.0;
  var PULSE_SPEED = 620;
  var lastT = performance.now();

  var debris = [];
  for (var di = 0; di < 55; di++) {
    var da = Math.random() * Math.PI * 2;
    var dspd = 160 + Math.random() * 480;
    var dlife = 0.5 + Math.random() * 1.0;
    debris.push({
      x: dropX, y: dropY,
      vx: Math.cos(da) * dspd,
      vy: Math.sin(da) * dspd,
      life: dlife, maxLife: dlife,
      r: 1.5 + Math.random() * 3.5,
      hue: (blastHue + Math.floor(Math.random() * 80) - 40 + 360) % 360
    });
  }

  function blastFrame() {
    var now = performance.now();
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;

    flashAlpha = Math.max(0, flashAlpha - dt * 2.4);
    pulseR += dt * PULSE_SPEED;

    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);

    // Flash glow
    if (flashAlpha > 0) {
      var fg = state.ovCtx.createRadialGradient(dropX, dropY, 0, dropX, dropY, 120);
      fg.addColorStop(0, 'rgba(255,255,255,' + flashAlpha.toFixed(3) + ')');
      fg.addColorStop(0.3, 'hsla(' + blastHue + ',100%,80%,' + (flashAlpha * 0.75).toFixed(3) + ')');
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      state.ovCtx.fillStyle = fg;
      state.ovCtx.beginPath();
      state.ovCtx.arc(dropX, dropY, 120, 0, Math.PI * 2);
      state.ovCtx.fill();
    }

    // Expanding colour rings
    for (var ri = 0; ri < 4; ri++) {
      var rR = pulseR * (1 - ri * 0.07);
      if (rR <= 0 || rR > maxR + 80) continue;
      var ringFade = Math.max(0, 1 - rR / (maxR + 80));
      var rHue = (blastHue + ri * 55) % 360;
      state.ovCtx.save();
      state.ovCtx.globalAlpha = ringFade * Math.max(0, 0.55 - ri * 0.1);
      state.ovCtx.strokeStyle = 'hsla(' + rHue + ',100%,70%,1)';
      state.ovCtx.lineWidth = Math.max(2, 16 - ri * 3);
      state.ovCtx.beginPath();
      state.ovCtx.arc(dropX, dropY, rR, 0, Math.PI * 2);
      state.ovCtx.stroke();
      state.ovCtx.restore();
    }
    if (pulseR < maxR + 30) {
      var wFade = Math.max(0, 1 - pulseR / maxR);
      state.ovCtx.save();
      state.ovCtx.globalAlpha = wFade * 0.85;
      state.ovCtx.strokeStyle = 'white';
      state.ovCtx.lineWidth = 2;
      state.ovCtx.beginPath();
      state.ovCtx.arc(dropX, dropY, pulseR, 0, Math.PI * 2);
      state.ovCtx.stroke();
      state.ovCtx.restore();
    }

    // Debris sparks
    var anyAlive = false;
    for (var k = 0; k < debris.length; k++) {
      var p = debris[k];
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 200 * dt;
      p.life -= dt;
      var lt = p.life / p.maxLife;
      state.ovCtx.save();
      state.ovCtx.globalAlpha = lt * 0.9;
      state.ovCtx.fillStyle = 'hsl(' + p.hue + ',100%,' + Math.round(55 + lt * 25) + '%)';
      state.ovCtx.beginPath();
      state.ovCtx.arc(p.x, p.y, Math.max(0.5, p.r * lt), 0, Math.PI * 2);
      state.ovCtx.fill();
      state.ovCtx.restore();
      anyAlive = true;
    }

    if (pulseR < maxR + 80 || flashAlpha > 0 || anyAlive) {
      requestAnimationFrame(blastFrame);
    } else {
      state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
    }
  }
  requestAnimationFrame(blastFrame);
}

// One-shot permanent outward pixel displacement.
// For each destination pixel within PUSH_R of the blast, pulls its source from
// closer to centre (inverse warp = forward "explosion push"). Written once; no revert.
function _applyPermanentBlastWarp(blastX, blastY) {
  var DPR = state.DPR;
  var bcx = blastX * DPR;
  var bcy = blastY * DPR;
  var W = state.canvas.width;
  var H = state.canvas.height;
  var MAX_PUSH = 85 * DPR;
  var PUSH_R   = 250 * DPR;
  var PUSH_R2  = PUSH_R * PUSH_R;

  var bx0 = Math.max(0, Math.floor(bcx - PUSH_R));
  var by0 = Math.max(0, Math.floor(bcy - PUSH_R));
  var bx1 = Math.min(W, Math.ceil(bcx + PUSH_R));
  var by1 = Math.min(H, Math.ceil(bcy + PUSH_R));
  var pw = bx1 - bx0, ph = by1 - by0;
  if (pw <= 0 || ph <= 0) return;

  var snap = state.ctx.getImageData(bx0, by0, pw, ph);
  var sd   = snap.data;
  var dd   = new Uint8ClampedArray(sd.length);

  for (var py = 0; py < ph; py++) {
    var wy  = py + by0;
    var ddy = wy - bcy;
    var dy2 = ddy * ddy;
    for (var px = 0; px < pw; px++) {
      var wx   = px + bx0;
      var ddx  = wx - bcx;
      var dist2 = ddx * ddx + dy2;
      var oi   = (py * pw + px) * 4;

      if (dist2 >= PUSH_R2) {
        dd[oi] = sd[oi]; dd[oi+1] = sd[oi+1]; dd[oi+2] = sd[oi+2]; dd[oi+3] = sd[oi+3];
        continue;
      }

      var dist = Math.sqrt(dist2);
      if (dist < 0.5) {
        dd[oi] = dd[oi+1] = dd[oi+2] = 0; dd[oi+3] = 0;
        continue;
      }

      var t    = 1 - dist / PUSH_R;
      // Cap push so source is always within same side of centre (no "other side" smear)
      var push = Math.min(dist * 0.88, t * t * MAX_PUSH);
      var norm = 1 / dist;
      var srcX = Math.round(wx - ddx * norm * push);
      var srcY = Math.round(wy - ddy * norm * push);
      var srx  = Math.min(pw - 1, Math.max(0, srcX - bx0));
      var sry  = Math.min(ph - 1, Math.max(0, srcY - by0));
      var si   = (sry * pw + srx) * 4;
      dd[oi] = sd[si]; dd[oi+1] = sd[si+1]; dd[oi+2] = sd[si+2]; dd[oi+3] = sd[si+3];
    }
  }

  state.ctx.putImageData(new ImageData(dd, pw, ph), bx0, by0);
}

// Permanent crater mark + large paint explosion.
function _stampAlienExplosion(dropX, dropY, scheme, blastHue) {
  function pick() { return scheme[Math.floor(Math.random() * scheme.length)]; }
  var baseR = Math.max(32, Math.min(state.canvasW, state.canvasH) * 0.09);

  state.ctx.save();

  // Crater: dark void with neon rim
  var crR = baseR * 0.55;
  var cg = state.ctx.createRadialGradient(dropX, dropY, 0, dropX, dropY, crR);
  cg.addColorStop(0,   'rgba(0,0,0,0.92)');
  cg.addColorStop(0.7, 'rgba(0,0,0,0.72)');
  cg.addColorStop(1,   'rgba(0,0,0,0)');
  state.ctx.fillStyle = cg;
  state.ctx.beginPath();
  state.ctx.arc(dropX, dropY, crR, 0, Math.PI * 2);
  state.ctx.fill();

  state.ctx.save();
  state.ctx.shadowColor = 'hsla(' + blastHue + ',100%,72%,1)';
  state.ctx.shadowBlur  = 18;
  state.ctx.strokeStyle = 'hsla(' + blastHue + ',100%,82%,0.95)';
  state.ctx.lineWidth   = 2.5;
  state.ctx.beginPath();
  state.ctx.arc(dropX, dropY, crR * 0.76, 0, Math.PI * 2);
  state.ctx.stroke();
  state.ctx.restore();

  // Core paint blobs
  for (var i = 0; i < 20; i++) {
    var ang   = (i / 20) * Math.PI * 2;
    var blobD = baseR * (0.25 + Math.random() * 0.85);
    var blobR = baseR * (0.42 + Math.random() * 0.88);
    state.ctx.fillStyle  = pick();
    state.ctx.globalAlpha = 0.75 + Math.random() * 0.25;
    state.ctx.beginPath();
    state.ctx.arc(dropX + Math.cos(ang) * blobD, dropY + Math.sin(ang) * blobD, blobR, 0, Math.PI * 2);
    state.ctx.fill();
  }
  state.ctx.globalAlpha = 1;

  // Long alien tendrils
  for (var l = 0; l < 12; l++) {
    var ta     = Math.random() * Math.PI * 2;
    var tlen   = baseR * (2.8 + Math.random() * 4.5);
    var tw     = baseR * (0.22 + Math.random() * 0.42);
    var tx     = dropX, ty = dropY;
    var tsteps = Math.ceil(tlen * 2.2);
    state.ctx.fillStyle = pick();
    for (var s = 0; s < tsteps; s++) {
      var tt = s / tsteps;
      var tr = Math.max(0.5, tw * (1 - tt * 0.88));
      state.ctx.globalAlpha = Math.max(0, 1 - tt * 0.65);
      state.ctx.beginPath();
      state.ctx.arc(tx, ty, tr, 0, Math.PI * 2);
      state.ctx.fill();
      ta += (Math.random() - 0.5) * 0.22;
      tx += Math.cos(ta) * (1 + Math.random() * 0.5);
      ty += Math.sin(ta) * (1 + Math.random() * 0.5);
    }
  }
  state.ctx.globalAlpha = 1;

  // Far satellite splatters
  for (var k = 0; k < 24; k++) {
    var sa   = Math.random() * Math.PI * 2;
    var satD = baseR * (2.0 + Math.random() * 5.5);
    var satR = Math.max(3, baseR * (0.07 + Math.random() * 0.38));
    state.ctx.fillStyle   = pick();
    state.ctx.globalAlpha = 0.65 + Math.random() * 0.35;
    state.ctx.beginPath();
    state.ctx.arc(dropX + Math.cos(sa) * satD, dropY + Math.sin(sa) * satD, satR, 0, Math.PI * 2);
    state.ctx.fill();
  }
  state.ctx.globalAlpha = 1;

  // Thin alien energy streaks radiating from epicentre
  var nStreaks = 6 + Math.floor(Math.random() * 5);
  for (var sr = 0; sr < nStreaks; sr++) {
    var sAng  = Math.random() * Math.PI * 2;
    var sLen  = baseR * (3.2 + Math.random() * 4.8);
    var sHue  = (blastHue + sr * 42) % 360;
    state.ctx.save();
    state.ctx.globalAlpha = 0.55 + Math.random() * 0.35;
    state.ctx.strokeStyle = 'hsla(' + sHue + ',100%,75%,1)';
    state.ctx.lineWidth   = 1.2;
    state.ctx.beginPath();
    state.ctx.moveTo(dropX, dropY);
    state.ctx.lineTo(dropX + Math.cos(sAng) * sLen, dropY + Math.sin(sAng) * sLen);
    state.ctx.stroke();
    state.ctx.restore();
  }

  state.ctx.restore();
}
