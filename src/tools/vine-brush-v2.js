import state from '../state.js';
import { adjacentColor, shadeColor } from '../core/color-utils.js';

var GROW_DURATION = 220; // ms per leaf grow-in

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Leaf object fields used by drawLeaf (all set at spawn, never mutated):
//   dx, dy      — normalised growth direction
//   len         — total length
//   squat       — width-to-length ratio
//   peakT       — where the leaf is widest (0–1 along length)
//   asym        — left/right bulge asymmetry (–1..+1)
//   fillColor   — base fill colour
//   rimColor    — vein and edge colour
//   veins       — array of {t, side, reach}
//
// Caller must ctx.translate(cx, cy) and set ctx.globalAlpha before calling.
function drawLeaf(ctx, leaf) {
  ctx.save();

  var dx = leaf.dx, dy = leaf.dy;
  var len = leaf.len;
  var halfW = len * leaf.squat * 0.5;
  var px = -dy, py = dx;
  var pt = leaf.peakT;
  var al = leaf.asym;
  var lhw = halfW * (1 + al); // left-side bulge
  var rhw = halfW * (1 - al); // right-side bulge
  var baseAlpha = ctx.globalAlpha;

  function mainPath() {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(
      dx * len * 0.10 - px * lhw * 0.55, dy * len * 0.10 - py * lhw * 0.55,
      dx * len * pt   - px * lhw,         dy * len * pt   - py * lhw,
      dx * len,                            dy * len
    );
    ctx.bezierCurveTo(
      dx * len * pt   + px * rhw,          dy * len * pt   + py * rhw,
      dx * len * 0.10 + px * rhw * 0.55,  dy * len * 0.10 + py * rhw * 0.55,
      0, 0
    );
    ctx.closePath();
  }

  // Gradient fill: richer/darker at base, lighter at tip
  var grad = ctx.createLinearGradient(0, 0, dx * len, dy * len);
  grad.addColorStop(0.00, shadeColor(leaf.fillColor, -0.12, +5));
  grad.addColorStop(0.45, leaf.fillColor);
  grad.addColorStop(1.00, shadeColor(leaf.fillColor, +0.22, -8));

  mainPath();
  ctx.fillStyle = grad;
  ctx.globalAlpha = baseAlpha * 0.92;
  ctx.fill();

  // Soft rim
  mainPath();
  ctx.strokeStyle = leaf.rimColor;
  ctx.lineWidth = Math.max(0.4, len * 0.018);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = baseAlpha * 0.20;
  ctx.stroke();

  // Midrib — curves slightly toward the heavier side
  var mCtrlX = dx * len * 0.48 - px * halfW * al * 0.28;
  var mCtrlY = dy * len * 0.48 - py * halfW * al * 0.28;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(mCtrlX, mCtrlY, dx * len * 0.88, dy * len * 0.88);
  ctx.strokeStyle = leaf.rimColor;
  ctx.lineWidth = Math.max(0.5, len * 0.028);
  ctx.globalAlpha = baseAlpha * 0.38;
  ctx.stroke();

  // Side veins — curved branches off the midrib, alternating sides
  ctx.lineWidth = Math.max(0.3, len * 0.014);
  ctx.globalAlpha = baseAlpha * 0.24;
  for (var v = 0; v < leaf.veins.length; v++) {
    var vn = leaf.veins[v];
    var vbx = dx * len * vn.t;
    var vby = dy * len * vn.t;
    // leaf width at this t position (sine profile)
    var leafWatT = halfW * Math.sin(Math.PI * vn.t) * 0.9;
    var sideX = vn.side * px, sideY = vn.side * py;
    var vtipX = vbx + (dx * len * 0.10 + sideX * leafWatT) * vn.reach;
    var vtipY = vby + (dy * len * 0.10 + sideY * leafWatT) * vn.reach;
    var vcpX  = vbx + sideX * leafWatT * 0.5 * vn.reach;
    var vcpY  = vby + sideY * leafWatT * 0.5 * vn.reach;
    ctx.beginPath();
    ctx.moveTo(vbx, vby);
    ctx.quadraticCurveTo(vcpX, vcpY, vtipX, vtipY);
    ctx.stroke();
  }

  ctx.restore();
}

function commitLeaf(ctx, leaf) {
  ctx.save();
  ctx.translate(leaf.cx, leaf.cy);
  ctx.globalAlpha = leaf.alpha;
  drawLeaf(ctx, leaf);
  ctx.restore();
}

function vineOverlayFrame() {
  if (!state.vineLiveLeaves.length) {
    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
    state.vineAnimFrame = null;
    return;
  }

  var now = performance.now();
  state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);

  state.vineLiveLeaves = state.vineLiveLeaves.filter(function(leaf) {
    var t = Math.min(1, (now - leaf.born) / leaf.growDuration);
    var scale = easeOut(t);

    if (t >= 1) {
      commitLeaf(state.ctx, leaf);
      return false;
    }

    state.ovCtx.save();
    state.ovCtx.translate(leaf.cx, leaf.cy);
    state.ovCtx.scale(scale, scale);
    state.ovCtx.globalAlpha = leaf.alpha * (0.35 + 0.65 * t);
    drawLeaf(state.ovCtx, leaf);
    state.ovCtx.restore();

    return true;
  });

  state.vineAnimFrame = requestAnimationFrame(vineOverlayFrame);
}

export function drawVineStrokeV2(x, y, col) {
  if (!state.vineStrokeV2) {
    // Match original vine-brush.js sizing
    var leafBase = Math.max(22, state.brushSize * 0.95);
    state.vineStrokeV2 = {
      lx: state.lastX, ly: state.lastY,
      dir: null,
      stemDist: 0,
      accumLeaf: 0,
      side: 1,
      phase: Math.random() * Math.PI * 2,
      leafBase: leafBase,
      nextLeafSpacing: leafBase * (0.7 + Math.random() * 0.55),
      stemDark: shadeColor(col, -0.22, +12),
      stemHi:   shadeColor(col, +0.20, -8),
    };
  }

  var st = state.vineStrokeV2;
  var ddx = x - st.lx, ddy = y - st.ly;
  var d = Math.hypot(ddx, ddy);

  if (d > 0.3) {
    var ndx = ddx / d, ndy = ddy / d;
    if (!st.dir) {
      st.dir = [ndx, ndy];
    } else {
      st.dir[0] = st.dir[0] * 0.72 + ndx * 0.28;
      st.dir[1] = st.dir[1] * 0.72 + ndy * 0.28;
      var m = Math.hypot(st.dir[0], st.dir[1]) || 1;
      st.dir[0] /= m; st.dir[1] /= m;
    }
  }

  // Stem — direct to main canvas
  var stemW = Math.max(1.5, state.brushSize * 0.19);
  var wob   = 1 + 0.14 * Math.sin(st.stemDist * 0.020 + st.phase);
  var tdx = d > 0 ? ddx / d : (st.dir ? st.dir[0] : 1);
  var tdy = d > 0 ? ddy / d : (st.dir ? st.dir[1] : 0);
  var snx = -tdy, sny = tdx;
  if (snx + sny > 0) { snx = -snx; sny = -sny; }
  var off = stemW * 0.42;

  state.ctx.save();
  state.ctx.lineCap = 'round';
  state.ctx.lineJoin = 'round';

  if (stemW > 2) {
    state.ctx.beginPath();
    state.ctx.moveTo(st.lx - snx * off, st.ly - sny * off);
    state.ctx.lineTo(x   - snx * off, y   - sny * off);
    state.ctx.lineWidth   = stemW * 0.65;
    state.ctx.strokeStyle = st.stemDark;
    state.ctx.globalAlpha = 0.40;
    state.ctx.stroke();
  }

  state.ctx.beginPath();
  state.ctx.moveTo(st.lx, st.ly);
  state.ctx.lineTo(x, y);
  state.ctx.lineWidth   = stemW * wob;
  state.ctx.strokeStyle = col;
  state.ctx.globalAlpha = 1.0;
  state.ctx.stroke();

  if (stemW > 2.5) {
    state.ctx.beginPath();
    state.ctx.moveTo(st.lx + snx * off * 0.6, st.ly + sny * off * 0.6);
    state.ctx.lineTo(x   + snx * off * 0.6, y   + sny * off * 0.6);
    state.ctx.lineWidth   = stemW * 0.38;
    state.ctx.strokeStyle = st.stemHi;
    state.ctx.globalAlpha = 0.42;
    state.ctx.stroke();
  }

  state.ctx.restore();

  st.lx = x; st.ly = y;
  st.stemDist  += d;
  st.accumLeaf += d;

  // Spawn leaves
  while (st.accumLeaf >= st.nextLeafSpacing && st.dir) {
    st.accumLeaf -= st.nextLeafSpacing;
    st.nextLeafSpacing = st.leafBase * (0.7 + Math.random() * 0.55);
    st.side = -st.side;

    var tx = st.dir[0], ty = st.dir[1];
    var perpX = -ty * st.side, perpY = tx * st.side;
    var bias = 0.05 + Math.random() * 0.18;
    var ldx = perpX * (1 - bias) + tx * bias;
    var ldy = perpY * (1 - bias) + ty * bias;
    var lm = Math.hypot(ldx, ldy) || 1;
    ldx /= lm; ldy /= lm;

    var ang = (Math.random() - 0.5) * 0.98;
    var ca = Math.cos(ang), sa = Math.sin(ang);

    // Match original vine-brush.js leaf sizing
    var sizeJitter = 1.05 + Math.random() * 0.5;
    var leafLen = Math.max(18, state.brushSize * 1.4) * (0.78 + Math.random() * 0.55) * sizeJitter;

    var numVeins = 3 + Math.floor(Math.random() * 2); // 3–4 veins
    var veins = [];
    for (var vi = 0; vi < numVeins; vi++) {
      veins.push({
        t:     0.20 + (vi / (numVeins - 1)) * 0.52,
        side:  vi % 2 === 0 ? 1 : -1,
        reach: 0.72 + Math.random() * 0.36,
      });
    }

    var leafCol = adjacentColor(col, 25);

    state.vineLiveLeaves.push({
      cx: x, cy: y,
      dx: ldx * ca - ldy * sa,
      dy: ldx * sa + ldy * ca,
      len:       leafLen,
      squat:     0.26 + Math.random() * 0.16, // narrower, like original (0.24–0.38 range)
      peakT:     0.36 + Math.random() * 0.14,
      asym:      (Math.random() - 0.5) * 0.50,
      fillColor: leafCol,
      rimColor:  shadeColor(leafCol, -0.25, +8),
      veins:     veins,
      alpha:     0.82 + Math.random() * 0.14,
      born:      performance.now(),
      growDuration: GROW_DURATION + Math.random() * 80,
    });

    if (!state.vineAnimFrame) {
      state.vineAnimFrame = requestAnimationFrame(vineOverlayFrame);
    }
  }
}

export function finalizeVineStrokeV2() {
  state.vineLiveLeaves.forEach(function(leaf) { commitLeaf(state.ctx, leaf); });
  state.vineLiveLeaves = [];

  if (state.vineAnimFrame) {
    cancelAnimationFrame(state.vineAnimFrame);
    state.vineAnimFrame = null;
  }
  state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);

  if (state.mirrorVineStrokeV2) state.mirrorVineStrokeV2 = null;
  state.vineStrokeV2 = null;
}
