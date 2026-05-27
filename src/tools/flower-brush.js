import state from '../state.js';
import { adjacentColor, shadeColor } from '../core/color-utils.js';

var GROW_DURATION = 260;

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Draws one flower (petals + center) scaled from its own center.
// Caller sets ctx transform/alpha before calling.
function drawBlossom(ctx, b, scale) {
  ctx.save();
  ctx.translate(b.cx, b.cy);
  ctx.rotate(b.baseAngle);
  ctx.scale(scale, scale);

  var len = b.len, hw = b.hw, n = b.nPetals;
  var step = (Math.PI * 2) / n;

  for (var i = 0; i < n; i++) {
    ctx.save();
    ctx.rotate(step * i);

    var grad = ctx.createLinearGradient(0, 0, 0, -len);
    grad.addColorStop(0.00, shadeColor(b.petalColor, -0.10, 0));
    grad.addColorStop(0.40, b.petalColor);
    grad.addColorStop(1.00, shadeColor(b.petalColor, +0.18, -8));

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-hw * 0.85, -len * 0.18, -hw, -len * 0.65, 0, -len);
    ctx.bezierCurveTo( hw * 0.85, -len * 0.65,  hw * 0.85, -len * 0.18, 0, 0);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.restore();
  }

  // Center — warm radial gradient
  var cr = b.centerR;
  var cg = ctx.createRadialGradient(0, -cr * 0.22, 0, 0, 0, cr);
  cg.addColorStop(0.00, shadeColor(b.centerColor, +0.22, 0));
  cg.addColorStop(1.00, shadeColor(b.centerColor, -0.08, 0));
  ctx.beginPath();
  ctx.arc(0, 0, cr, 0, Math.PI * 2);
  ctx.fillStyle = cg;
  ctx.fill();

  ctx.restore();
}

function commitBlossom(ctx, b) {
  ctx.save();
  ctx.globalAlpha = b.alpha;
  drawBlossom(ctx, b, 1);
  ctx.restore();
}

function flowerOverlayFrame() {
  if (!state.flowerLiveBlossoms.length) {
    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
    state.flowerAnimFrame = null;
    return;
  }

  var now = performance.now();
  state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);

  state.flowerLiveBlossoms = state.flowerLiveBlossoms.filter(function(b) {
    var t = Math.min(1, (now - b.born) / b.growDuration);
    var scale = easeOut(t);

    if (t >= 1) {
      commitBlossom(state.ctx, b);
      return false;
    }

    state.ovCtx.save();
    state.ovCtx.globalAlpha = b.alpha * (0.35 + 0.65 * t);
    drawBlossom(state.ovCtx, b, scale);
    state.ovCtx.restore();

    return true;
  });

  state.flowerAnimFrame = requestAnimationFrame(flowerOverlayFrame);
}

export function drawFlowerStroke(x, y, col) {
  if (!state.flowerStroke) {
    var flowerBase = Math.max(18, state.brushSize * 0.95);
    state.flowerStroke = {
      lx: state.lastX, ly: state.lastY,
      dir: null,
      accumDist: 0,
      flowerBase: flowerBase,
      nextSpacing: flowerBase * (0.85 + Math.random() * 0.45),
    };
    // Spawn one flower immediately on press so short taps produce something
    spawnBlossom(state.lastX, state.lastY, col, state.flowerStroke);
  }

  var st = state.flowerStroke;
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

  st.lx = x; st.ly = y;
  st.accumDist += d;

  // Spawn blossoms at intervals
  while (st.accumDist >= st.nextSpacing && st.dir) {
    st.accumDist -= st.nextSpacing;
    st.nextSpacing = st.flowerBase * (0.85 + Math.random() * 0.45);
    spawnBlossom(x, y, col, st);
  }
}

function spawnBlossom(x, y, col, st) {
  var petalLen   = st.flowerBase * (0.65 + Math.random() * 0.50);
  var petalHw    = petalLen * (0.30 + Math.random() * 0.14);

  state.flowerLiveBlossoms.push({
    cx: x, cy: y,
    nPetals:     5 + Math.floor(Math.random() * 3),
    len:         petalLen,
    hw:          petalHw,
    centerR:     petalLen * 0.24,
    baseAngle:   Math.random() * Math.PI * 2,
    petalColor:  adjacentColor(col, 22),
    centerColor: shadeColor(col, +0.28, +52),
    alpha:       1.0,
    born:        performance.now(),
    growDuration: GROW_DURATION + Math.random() * 90,
  });

  if (!state.flowerAnimFrame) {
    state.flowerAnimFrame = requestAnimationFrame(flowerOverlayFrame);
  }
}

export function finalizeFlowerStroke() {
  state.flowerLiveBlossoms.forEach(function(b) { commitBlossom(state.ctx, b); });
  state.flowerLiveBlossoms = [];

  if (state.flowerAnimFrame) {
    cancelAnimationFrame(state.flowerAnimFrame);
    state.flowerAnimFrame = null;
  }
  state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);

  if (state.mirrorFlowerStroke) state.mirrorFlowerStroke = null;
  state.flowerStroke = null;
}
