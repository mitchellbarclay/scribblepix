import state from '../state.js';

// --- Lightning bolt ---------------------------------------------------------
// Model: a bolt is ONE continuous stroke (the path you draw) with a jagged
// perpendicular *displacement* laid on top. The displacement shimmers, and each
// part of the stroke settles to a standstill based on *its own age* — so the
// older tail freezes while the freshly-drawn head still crackles, all at a
// steady wall-clock rate independent of how fast you move the cursor. The whole
// bolt lives on the overlay until release, then bakes to the main canvas once.
// No mid-stroke "segments", so no seams; the only per-frame cost is re-stroking
// one path.

// --- Tuning -----------------------------------------------------------------
var SKEL_STEP = 5;        // path resample step (px) — small, so curves survive
function jagAmp() { return Math.max(12, state.brushSize * 1.8); } // jag size
var JAG_WL = 46;          // base jag wavelength (px); each octave halves it
var JAG_OCTAVES = 3;      // layers of detail: big bends + finer crackle
var MORPH_RATE = 0.0030;  // shimmer speed (noise units per ms), constant in time
var SETTLE_MS = 1000;     // each point settles over this long after it's drawn
var CADENCE_MS = 33;      // throttle rebuild/morph to ~30fps

// How far a point's animation phase has advanced as a function of its age. The
// phase drifts at MORPH_RATE when fresh and eases linearly to a standstill over
// SETTLE_MS — so this is the integral of that decaying rate. Past SETTLE_MS it's
// frozen at a constant, which makes the settled jag permanent and deterministic.
function settlePhase(age) {
  if (age <= 0) return 0;
  if (age >= SETTLE_MS) return MORPH_RATE * SETTLE_MS * 0.5;
  return MORPH_RATE * (age - age*age / (2*SETTLE_MS));
}

// --- Coherent value noise ---------------------------------------------------
// 1D value noise in [-1,1], smooth and deterministic in both inputs. Sampling
// it at a slowly drifting phase gives a gentle shimmer; sampling the same arc
// position always returns the same base shape, so the bolt is stable in space.
function fract(x) { return x - Math.floor(x); }
function hash1(n, seed) { return fract(Math.sin(n*12.9898 + seed*78.233) * 43758.5453) * 2 - 1; }
function vnoise(u, seed) {
  var i = Math.floor(u), f = u - i, t = f*f*(3-2*f);
  return hash1(i, seed) + (hash1(i+1, seed) - hash1(i, seed)) * t;
}
// Perpendicular offset at arc length s, animation phase, and stroke seed.
// Multi-octave (fractal): big slow bends plus progressively finer crackle.
function jagOffset(s, phase, seed) {
  var o = 0, amp = jagAmp(), wl = JAG_WL, ph = phase;
  for (var k = 0; k < JAG_OCTAVES; k++) {
    o += amp * vnoise(s/wl + ph, seed + k*19.7);
    amp *= 0.5; wl *= 0.5; ph *= 1.8;
  }
  return o;
}

// --- Geometry ---------------------------------------------------------------
// Rebuild the cached skeleton: resample the recorded points to evenly-spaced
// (SKEL_STEP) vertices, carrying along per-vertex arc length (sArr) and a
// per-vertex timestamp (tArr, interpolated from the recorded points' times).
// The timestamps are what let each part of the bolt settle by its own age.
function rebuildSkel(bs) {
  var pts = bs.pts;
  if (pts.length < 2) { bs.skel = null; bs.sArr = null; bs.tArr = null; return; }
  var skel = [{x:pts[0].x, y:pts[0].y}], sArr = [0], tArr = [pts[0].t];
  var total = 0, acc = 0; // arc length so far, distance since last emitted vertex
  for (var i = 1; i < pts.length; i++) {
    var x0 = pts[i-1].x, y0 = pts[i-1].y, t0 = pts[i-1].t;
    var dx = pts[i].x-x0, dy = pts[i].y-y0, seg = Math.hypot(dx, dy);
    if (seg < 1e-6) continue;
    var pos = 0; // distance consumed along this segment
    while (acc + (seg - pos) >= SKEL_STEP) {
      pos += SKEL_STEP - acc;
      var f = pos / seg;
      total += SKEL_STEP;
      skel.push({x: x0+dx*f, y: y0+dy*f});
      sArr.push(total);
      tArr.push(t0 + (pts[i].t - t0) * f);
      acc = 0;
    }
    acc += seg - pos;
  }
  if (acc > SKEL_STEP*0.25) { // trailing remainder → keep the true last point
    var last = pts[pts.length-1];
    total += acc;
    skel.push({x:last.x, y:last.y}); sArr.push(total); tArr.push(last.t);
  }
  if (skel.length < 2) {
    var a = pts[0], b = pts[pts.length-1];
    bs.skel = [{x:a.x,y:a.y},{x:b.x,y:b.y}]; bs.sArr = [0, SKEL_STEP]; bs.tArr = [a.t, b.t];
    return;
  }
  bs.skel = skel; bs.sArr = sArr; bs.tArr = tArr;
}

// Displace every skeleton vertex perpendicular to its local tangent. Each vertex
// gets its own animation phase from its age (now - its timestamp), so the older
// tail is frozen and the fresh head still crackles.
function buildShape(bs, now) {
  var skel = bs.skel, s = bs.sArr, tA = bs.tArr;
  if (!skel || skel.length < 2) return null;
  var out = [];
  for (var j = 0; j < skel.length; j++) {
    var a = skel[Math.max(0,j-1)], b = skel[Math.min(skel.length-1,j+1)];
    var tx = b.x-a.x, ty = b.y-a.y, tl = Math.hypot(tx,ty)||1;
    var nx = -ty/tl, ny = tx/tl;
    var o = jagOffset(s[j], settlePhase(now - tA[j]), bs.seed);
    out.push({x: skel[j].x + nx*o, y: skel[j].y + ny*o});
  }
  return out;
}

// --- Rendering --------------------------------------------------------------
// Neon glow via a few stacked translucent strokes (widest/faintest first) plus
// a hot white core. Deliberately NOT using ctx.filter='blur()' — that allocates
// an offscreen and gaussian-blurs the whole bbox every frame, which tanked the
// whole app. Stacked strokes are cheap and composite fine.
function renderBolt(ctx, pts, col) {
  if (!pts || pts.length < 2) return;
  var w = Math.max(2, state.brushSize*0.70);
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  function trace() {
    ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.strokeStyle = col;
  ctx.globalAlpha = 0.14; ctx.lineWidth = w*2.8; trace(); ctx.stroke(); // outer glow halo
  ctx.globalAlpha = 0.55; ctx.lineWidth = w*1.0; trace(); ctx.stroke(); // inner colored edge
  ctx.globalAlpha = 1.0;  ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, w*0.42); trace(); ctx.stroke(); // hot core
  ctx.restore();
}

// --- Per-frame animation ----------------------------------------------------
// Advance one stroke. Returns {changed, animating}: `changed` => the overlay
// needs a repaint this tick; `animating` => keep the rAF loop alive.
function advance(bs, now) {
  // The newest point is the youngest; once even it is older than SETTLE_MS the
  // whole bolt has frozen and there's nothing left to animate.
  var animating = (now - bs.lastMoveT) < SETTLE_MS;
  if (now - bs.procAt < CADENCE_MS) return {changed:false, animating:animating};
  bs.procAt = now;

  var changed = false;
  if (bs.skelDirty) { rebuildSkel(bs); bs.skelDirty = false; changed = true; }
  // While anything is still settling, every vertex's age changed, so rebuild.
  if (animating) { bs.shape = buildShape(bs, now); changed = true; }
  else if (changed || !bs.shape) bs.shape = buildShape(bs, now);
  return {changed:changed, animating:animating};
}

function boltOverlayFrame() {
  var hasMain   = !!state.boltStroke;
  var hasMirror = state.mirrorMode && !!state.mirrorBoltStroke;
  if (!hasMain && !hasMirror) {
    state.ovCtx.clearRect(0,0,state.canvasW,state.canvasH);
    state.boltAnimFrame = null;
    return;
  }
  var now = performance.now();
  var changed = false, animating = false;
  if (hasMain)   { var a = advance(state.boltStroke, now);       changed = changed||a.changed; animating = animating||a.animating; }
  if (hasMirror) { var b = advance(state.mirrorBoltStroke, now); changed = changed||b.changed; animating = animating||b.animating; }
  if (changed) {
    state.ovCtx.clearRect(0,0,state.canvasW,state.canvasH);
    if (hasMain   && state.boltStroke.shape)       renderBolt(state.ovCtx, state.boltStroke.shape, state.boltStroke.col);
    if (hasMirror && state.mirrorBoltStroke.shape) renderBolt(state.ovCtx, state.mirrorBoltStroke.shape, state.mirrorBoltStroke.col);
  }
  // Once everything has settled we stop the loop entirely (0 CPU); the next
  // point added (drawBoltStroke) restarts it.
  state.boltAnimFrame = animating ? requestAnimationFrame(boltOverlayFrame) : null;
}

// --- Public API -------------------------------------------------------------
export function drawBoltStroke(x, y, col) {
  var now = performance.now();
  if (!state.boltStroke) {
    state.boltStroke = {
      pts: [{x:x, y:y, t:now}], col: col, seed: Math.random()*1000,
      lastMoveT: now, procAt: now - CADENCE_MS,
      skel: null, sArr: null, tArr: null, skelDirty: true, shape: null
    };
  } else {
    var bs = state.boltStroke;
    bs.col = col;
    bs.pts.push({x:x, y:y, t:now});
    bs.lastMoveT = now;
    bs.skelDirty = true;
  }
  if (!state.boltAnimFrame) state.boltAnimFrame = requestAnimationFrame(boltOverlayFrame);
}

// Bake the bolt to the main canvas at release — rebuild at the current time so
// any still-settling parts freeze exactly where they are on screen.
function bakeStroke(bs) {
  if (!bs) return;
  if (bs.skelDirty || !bs.skel) rebuildSkel(bs);
  var shape = buildShape(bs, performance.now());
  if (shape) renderBolt(state.ctx, shape, bs.col);
}

export function finalizeBoltStroke() {
  if (state.boltStroke)       { bakeStroke(state.boltStroke);       state.boltStroke = null; }
  if (state.mirrorBoltStroke) { bakeStroke(state.mirrorBoltStroke); state.mirrorBoltStroke = null; }
  if (state.boltAnimFrame)    { cancelAnimationFrame(state.boltAnimFrame); state.boltAnimFrame = null; }
  state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
}
