// Splash ambient — a "screensaver" that draws the app's real brushes behind the
// splash content, then fades each completed stroke out uniformly so the
// title/buttons stay readable.
//
// How it works: every brush in the app funnels through drawStroke() and renders
// onto the shared singleton `state` (state.ctx for committed art, state.ovCtx for
// the per-tool grow/flicker animations). While the splash is up the user can't
// draw, so `state` is idle and borrowable. We give *each* stroke its own canvas
// layer: state.ctx points at that layer while the stroke is drawn and its grow
// animation settles, then the layer is sealed and fades out as a single unit via
// a CSS opacity transition before being removed.
//
// This is deliberately NOT a per-frame global blend. Fading the whole stroke as
// one element means it fades uniformly and goes fully transparent (no leftover
// haze building up), and nothing re-touches already-drawn pixels frame to frame
// (no flicker). A shared overlay canvas on top carries the transient grow/flicker
// preview of the stroke currently being drawn.
//
// Readability: the per-layer fade keeps the scene from saturating, a radial glow
// (#splash-glow) sits behind the text, and stroke paths are steered away from the
// central text band.

import state from '../state.js';
import { applyResize } from '../core/canvas-setup.js';
import { drawStroke } from '../tools/draw-stroke.js';
import { commitAllSplatterParticles } from '../tools/bubble-brush.js';
import { finalizeVineStrokeV2 } from '../tools/vine-brush-v2.js';
import { finalizeFlowerStroke } from '../tools/flower-brush.js';
import { finalizeBoltStroke } from '../tools/bolt-brush.js';
import { commitFireStrokeNow } from '../tools/fire-brush.js';
import { finalizePipeStroke } from '../tools/pipes-brush.js';

// ── Tuning ──────────────────────────────────────────────────────────────────
var DRAW_STEP    = 5.5;   // px advanced per frame (~330 px/s) — lower = slower draw
var SETTLE_MS    = 450;   // after the path, let grow/flicker animations finish on the layer
var HOLD_MS      = 2200;  // stroke sits fully visible before it starts fading
var FADE_MS      = 9000;  // uniform fade-out duration
var GAP_MS       = 120;   // pause after a stroke seals before the next begins
var LAYER_ALPHA  = 0.85;  // opacity each stroke layer holds before fading
var MAX_LAYERS   = 10;    // hard cap on concurrent layers (memory guard)

// A cheerful pastel palette that reads against the #c9effb splash background.
var PALETTE = ['#ff8fb4', '#ffd166', '#7ed957', '#5ec8ff', '#b08bff', '#ff9e7a', '#5fd6c4'];
var FIRE_COLORS = ['#ff7a18', '#ff5252', '#ffb020', '#ff6a00'];
var VINE_COLORS = ['#3fbf5f', '#5fae3a', '#2fa36b', '#57b94a'];
var FLOWER_COLORS = ['#ff6fae', '#ff8fb1', '#ffd24d', '#b06fff', '#ff7a7a'];
var BOLT_COLORS = ['#ffd83b', '#5cc8ff', '#b08bff', '#7ad0ff'];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(a, b) { return a + Math.random() * (b - a); }

// Per-tool recipes: brush size, colour source, path curviness, and how much the
// brush paints beyond its path (used to size the stroke's layer canvas).
var RECIPES = [
  { tool: 'pencil',  size: function () { return rand(28, 46); }, color: function () { return pick(PALETTE); },       curvy: 0.16, padMul: 1.4 },
  { tool: 'vine',    size: function () { return rand(32, 50); }, color: function () { return pick(VINE_COLORS); },   curvy: 0.22, padMul: 3.0 },
  { tool: 'flower',  size: function () { return rand(32, 48); }, color: function () { return pick(FLOWER_COLORS); }, curvy: 0.24, padMul: 2.6 },
  { tool: 'fire',    size: function () { return rand(34, 54); }, color: function () { return pick(FIRE_COLORS); },   curvy: 0.10, padMul: 3.6 },
  { tool: 'bolt',    size: function () { return rand(26, 42); }, color: function () { return pick(BOLT_COLORS); },   curvy: 0.08, padMul: 2.6 },
  { tool: 'splatter',size: function () { return rand(36, 56); }, color: function () { return pick(PALETTE); },       curvy: 0.18, padMul: 3.2 },
  { tool: 'pipe',    size: function () { return rand(40, 60); }, color: function () { return pick(PALETTE); },       curvy: 0.14, padMul: 1.8 },
];

// ── Lifecycle ─────────────────────────────────────────────────────────────--
var running = false;
var rafId = null;
var host = null;        // container div for stroke layers
var ovCanvas = null;    // shared overlay (transient grow/flicker preview)
var saved = null;       // snapshot of borrowed state fields
var queue = [];         // shuffled recipe queue for even variety
var layers = [];        // live layer descriptors { el, removeTimer, sealed }
var cur = null;         // current playback { samples, idx, recipe, layer }
var mode = 'idle';      // 'drawing' | 'settling' | 'gap'
var phaseUntil = 0;

function vw(splash) { return splash.clientWidth; }
function vh(splash) { return splash.clientHeight; }

function makeOverlay(splash) {
  var c = document.createElement('canvas');
  var w = vw(splash), h = vh(splash);
  c.width = w * state.DPR; c.height = h * state.DPR;
  c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;opacity:' + LAYER_ALPHA + ';';
  var ctx = c.getContext('2d');
  ctx.scale(state.DPR, state.DPR);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  splash.appendChild(c);
  return { canvas: c, ctx: ctx };
}

// A layer sized to the stroke's bounding box (with padding). Its context is
// translated so brushes can keep drawing in absolute canvas coordinates.
function makeLayer(b) {
  var c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(b.w * state.DPR));
  c.height = Math.max(1, Math.round(b.h * state.DPR));
  c.style.cssText = 'position:absolute;left:' + b.bx + 'px;top:' + b.by + 'px;width:' + b.w +
    'px;height:' + b.h + 'px;pointer-events:none;opacity:' + LAYER_ALPHA + ';';
  var ctx = c.getContext('2d');
  ctx.scale(state.DPR, state.DPR);
  ctx.translate(-b.bx, -b.by);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  host.appendChild(c);
  var layer = { el: c, ctx: ctx, removeTimer: null, sealed: false };
  layers.push(layer);
  return layer;
}

export function startSplashAmbient(splash) {
  if (running || !splash) return;
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  host = document.createElement('div');
  host.style.cssText = 'position:absolute;inset:0;z-index:1;pointer-events:none;overflow:hidden;';
  splash.appendChild(host);
  var ov = makeOverlay(splash);
  ovCanvas = ov.canvas;

  // Borrow the shared state. Snapshot everything we touch so dismiss() can
  // restore the app to a pristine, idle state.
  saved = {
    ctx: state.ctx, ovCtx: state.ovCtx, canvasW: state.canvasW, canvasH: state.canvasH,
    tool: state.tool, color: state.color, brushSize: state.brushSize,
    lastX: state.lastX, lastY: state.lastY, painting: state.painting,
    mirrorMode: state.mirrorMode, rainbowMode: state.rainbowMode,
  };
  state.ovCtx = ov.ctx; state.ctx = ov.ctx; // ctx gets repointed per stroke in beginStroke
  state.canvasW = vw(splash); state.canvasH = vh(splash);
  state.mirrorMode = false; state.rainbowMode = false; state.painting = false;
  state.splashAmbient = true; // suspend the app's resize handlers while borrowed

  running = true;
  mode = 'gap'; phaseUntil = 0; queue = []; cur = null; layers = [];
  rafId = requestAnimationFrame(frame);

  window.addEventListener('resize', onResize);
}

export function stopSplashAmbient() {
  if (!running) return;
  running = false;
  window.removeEventListener('resize', onResize);
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }

  resetBrushes(); // flush + cancel every brush loop before we hand state back

  layers.forEach(function (l) { if (l.removeTimer) clearTimeout(l.removeTimer); if (l.el) l.el.remove(); });
  layers = [];
  if (host) { host.remove(); host = null; }
  if (ovCanvas) { ovCanvas.remove(); ovCanvas = null; }
  cur = null; mode = 'idle';

  if (saved) {
    state.ctx = saved.ctx; state.ovCtx = saved.ovCtx;
    state.canvasW = saved.canvasW; state.canvasH = saved.canvasH;
    state.tool = saved.tool; state.color = saved.color; state.brushSize = saved.brushSize;
    state.lastX = saved.lastX; state.lastY = saved.lastY; state.painting = saved.painting;
    state.mirrorMode = saved.mirrorMode; state.rainbowMode = saved.rainbowMode;
    saved = null;
  }

  // Re-enable the app's resize path and sync the real canvas to the current
  // viewport (a no-op if the window didn't change while the splash was up).
  state.splashAmbient = false;
  applyResize();
}

function onResize() {
  var splash = document.getElementById('splash-screen');
  stopSplashAmbient();
  if (splash && !splash.classList.contains('hiding')) {
    setTimeout(function () {
      if (splash.isConnected && !splash.classList.contains('hiding')) startSplashAmbient(splash);
    }, 260);
  }
}

// ── Brush commit / cleanup ────────────────────────────────────────────────--
// Synchronously commit the just-drawn stroke onto its layer (state.ctx) and tear
// down every per-tool loop, so the layer holds the finished stroke with nothing
// left to paint asynchronously.
function endStroke() {
  state.painting = false;
  finalizeVineStrokeV2(); finalizeFlowerStroke(); finalizeBoltStroke();
  commitFireStrokeNow(); finalizePipeStroke(); commitAllSplatterParticles();
}

// Cancel every per-tool animation frame and clear all transient buffers, so the
// shared state is genuinely idle (used on stop).
function resetBrushes() {
  endStroke();
  ['splatterAnimId', 'boltAnimFrame', 'rectAnimFrame', 'ellipseAnimFrame',
   'vineAnimFrame', 'pipeAnimFrame', 'flowerAnimFrame', 'fireAnimFrame',
   'threeAnimFrame'].forEach(function (k) {
    if (state[k]) { cancelAnimationFrame(state[k]); state[k] = null; }
  });
  state.splatterParticles = [];
  state.fireLiveStamps = [];
  state.flowerLiveBlossoms = [];
  state.vineLiveLeaves = [];
  state.boltStroke = state.mirrorBoltStroke = null;
  state.vineStrokeV2 = state.mirrorVineStrokeV2 = null;
  state.flowerStroke = state.mirrorFlowerStroke = null;
  state.pipeStroke = state.mirrorPipeStroke = null;
  state.fireHasPrev = false; state.fireVelX = 0; state.fireVelY = 0; state.fireDistAcc = 0;
}

// Seal a finished stroke's layer: fade the whole thing out uniformly, then remove.
function sealLayer(layer) {
  layer.sealed = true;
  var el = layer.el;
  el.style.transition = 'opacity ' + FADE_MS + 'ms linear ' + HOLD_MS + 'ms';
  void el.offsetWidth; // force reflow so the transition takes effect
  el.style.opacity = '0';
  layer.removeTimer = setTimeout(function () {
    el.remove();
    var i = layers.indexOf(layer);
    if (i >= 0) layers.splice(i, 1);
  }, HOLD_MS + FADE_MS + 80);
}

// ── Path generation ───────────────────────────────────────────────────────--
// Pick a point `off` px outside a random edge of the viewport. `off` is the
// stroke's brush reach plus slack, so its start/end caps land fully off-screen.
function edgePoint(W, H, off, exclude) {
  var e; do { e = Math.floor(Math.random() * 4); } while (e === exclude);
  if (e === 0) return { edge: 0, x: rand(0, W), y: -off };       // top
  if (e === 1) return { edge: 1, x: W + off, y: rand(0, H) };    // right
  if (e === 2) return { edge: 2, x: rand(0, W), y: H + off };    // bottom
  return { edge: 3, x: -off, y: rand(0, H) };                    // left
}

// A wandering polyline that enters from one off-screen edge and exits another,
// crossing the whole viewport. It heads gently toward the exit point while a
// soft outward steer routes it around the central text band.
function buildPath(curvy, off) {
  var W = state.canvasW, H = state.canvasH;
  var cx = W / 2, cy = H / 2;
  var avoidRx = W * 0.34, avoidRy = H * 0.30; // soft text-protection ellipse

  var start = edgePoint(W, H, off);
  var end = edgePoint(W, H, off, start.edge);
  var x = start.x, y = start.y;
  var ang = Math.atan2(end.y - y, end.x - x);
  var seg = 24;
  var verts = [{ x: x, y: y }];
  var maxSteps = Math.ceil((W + H) / seg) * 3;

  for (var s = 0; s < maxSteps; s++) {
    if (Math.hypot(end.x - x, end.y - y) < seg * 1.5) break;
    // Gentle pull toward the exit point so the stroke actually crosses.
    var goalAng = Math.atan2(end.y - y, end.x - x);
    ang += Math.sin(goalAng - ang) * 0.12;
    // Wander.
    ang += (Math.random() - 0.5) * curvy * 1.4;
    // Soft outward steer when inside the protected ellipse around the text.
    var ex = (x - cx) / avoidRx, ey = (y - cy) / avoidRy;
    var er = ex * ex + ey * ey;
    if (er < 1) {
      var outAng = Math.atan2(y - cy, x - cx);
      ang += Math.sin(outAng - ang) * (1 - er) * 1.0;
    }
    x += Math.cos(ang) * seg; y += Math.sin(ang) * seg;
    verts.push({ x: x, y: y });
  }
  verts.push({ x: end.x, y: end.y });
  return verts;
}

// Resample a polyline into points evenly spaced by DRAW_STEP px.
function densify(verts) {
  var out = [verts[0]];
  var carry = 0;
  for (var i = 1; i < verts.length; i++) {
    var a = verts[i - 1], b = verts[i];
    var dx = b.x - a.x, dy = b.y - a.y, segLen = Math.hypot(dx, dy);
    if (segLen < 1e-6) continue;
    var d = DRAW_STEP - carry;
    while (d <= segLen) {
      var t = d / segLen;
      out.push({ x: a.x + dx * t, y: a.y + dy * t });
      d += DRAW_STEP;
    }
    carry = segLen - (d - DRAW_STEP);
  }
  return out;
}

// Bounding box of the path expanded by the brush's paint reach, clamped to view.
function boundsOf(samples, pad) {
  var W = state.canvasW, H = state.canvasH;
  var minx = 1e9, miny = 1e9, maxx = -1e9, maxy = -1e9;
  for (var i = 0; i < samples.length; i++) {
    var p = samples[i];
    if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
    if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
  }
  minx = Math.max(0, minx - pad); miny = Math.max(0, miny - pad);
  maxx = Math.min(W, maxx + pad); maxy = Math.min(H, maxy + pad);
  return { bx: minx, by: miny, w: maxx - minx, h: maxy - miny };
}

function nextRecipe() {
  if (!queue.length) {
    queue = RECIPES.slice();
    for (var i = queue.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = queue[i]; queue[i] = queue[j]; queue[j] = t; }
  }
  return queue.pop();
}

function beginStroke() {
  var recipe = nextRecipe();
  state.tool = recipe.tool;
  state.color = recipe.color();
  state.brushSize = recipe.size();

  // pad = how far this brush paints beyond its path. Used both to size the layer
  // and (plus slack) as the off-screen buffer, so start/end caps stay clipped.
  var pad = state.brushSize * recipe.padMul + 30;
  var samples = densify(buildPath(recipe.curvy, pad + 40));
  if (samples.length < 2) { mode = 'gap'; phaseUntil = performance.now(); return; }

  var layer = makeLayer(boundsOf(samples, pad));
  state.ctx = layer.ctx;

  // Mirror what main.js's mousedown sets up for a fresh stroke.
  state.mirrorBoltStroke = state.mirrorVineStrokeV2 = null;
  state.mirrorFlowerStroke = state.mirrorPipeStroke = null;
  state.splatterGateX = null; state.splatterGateY = null;

  var p0 = samples[0];
  state.lastX = p0.x; state.lastY = p0.y;
  state.painting = true;
  drawStroke(p0.x, p0.y);

  cur = { samples: samples, idx: 1, recipe: recipe, layer: layer };
  mode = 'drawing';

  // Memory guard: never let sealed layers accumulate unbounded.
  while (layers.length > MAX_LAYERS) {
    var old = layers.shift();
    if (old === layer) { layers.push(old); break; }
    if (old.removeTimer) clearTimeout(old.removeTimer);
    if (old.el) old.el.remove();
  }
}

// ── Master loop ───────────────────────────────────────────────────────────--
function frame(now) {
  if (!running) return;

  if (mode === 'drawing' && cur) {
    var p = cur.samples[cur.idx];
    drawStroke(p.x, p.y);
    state.lastX = p.x; state.lastY = p.y;
    cur.idx++;
    if (cur.idx >= cur.samples.length) {
      state.painting = false;
      mode = 'settling';
      phaseUntil = now + SETTLE_MS;
    }
  } else if (mode === 'settling') {
    if (now >= phaseUntil) {
      endStroke();          // commit the finished stroke onto its layer
      sealLayer(cur.layer); // fade the whole layer out uniformly
      cur = null;
      mode = 'gap';
      phaseUntil = now + GAP_MS;
    }
  } else if (mode === 'gap') {
    if (now >= phaseUntil) beginStroke();
  }

  rafId = requestAnimationFrame(frame);
}
