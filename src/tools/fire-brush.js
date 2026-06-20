import state from '../state.js';
import { hexToRgb, rgbToHsl } from '../core/color-utils.js';

var FIRE_SETTLE_MS = 300;
// Newborn flames ramp up over this window instead of popping in at full alpha.
var FIRE_FADE_IN_MS = 90;
// Sweep reference in px/ms so flame direction is consistent regardless of input
// device event rate (Apple Pencil fires at ~240 Hz vs finger at ~60 Hz).
var FIRE_SWEEP_REF = 0.5;
// Velocity EMA time constant (ms). Driving the smoothing by elapsed time rather
// than per-event makes the response frame-rate independent.
var FIRE_VEL_TAU = 35;
// dt clamp window (ms). Floors out impossibly-short bursts and caps long stalls
// so a janky frame can't collapse or spike the velocity estimate.
var FIRE_DT_MIN = 3, FIRE_DT_MAX = 50;
var _FIRE_N = 32;
var _fireLastT = 0;

var FLAME_VARIANTS = [
  {pa:0.48,pb:1.60,wMul:0.90,hMul:1.15,asym: 0.12,curl:0.14,cFreq:1.3,cPhase:0.0,wob1:0.05,wob2:0.02,lPhase:0.6, rPhase:2.4},
  {pa:0.55,pb:1.25,wMul:0.78,hMul:1.55,asym: 0.14,curl:0.16,cFreq:1.7,cPhase:1.4,wob1:0.05,wob2:0.02,lPhase:1.9, rPhase:4.0},
  {pa:0.50,pb:1.45,wMul:1.00,hMul:0.95,asym:-0.10,curl:0.12,cFreq:1.1,cPhase:3.1,wob1:0.05,wob2:0.02,lPhase:3.0, rPhase:5.4},
  {pa:0.45,pb:1.50,wMul:0.85,hMul:1.35,asym: 0.16,curl:0.18,cFreq:1.9,cPhase:4.4,wob1:0.05,wob2:0.02,lPhase:4.6, rPhase:0.8},
  {pa:0.46,pb:1.55,wMul:1.05,hMul:1.10,asym:-0.08,curl:0.10,cFreq:1.0,cPhase:5.8,wob1:0.05,wob2:0.02,lPhase:5.5, rPhase:1.7},
  {pa:0.52,pb:1.50,wMul:0.65,hMul:1.50,asym:-0.14,curl:0.16,cFreq:1.5,cPhase:2.3,wob1:0.04,wob2:0.02,lPhase:2.7, rPhase:5.0},
  {pa:0.50,pb:1.35,wMul:0.88,hMul:1.30,asym: 0.10,curl:0.12,cFreq:1.4,cPhase:0.9,wob1:0.05,wob2:0.02,lPhase:3.7, rPhase:0.4},
  {pa:0.44,pb:1.55,wMul:0.95,hMul:1.05,asym:-0.12,curl:0.14,cFreq:2.1,cPhase:2.7,wob1:0.05,wob2:0.02,lPhase:0.9, rPhase:3.6},
  {pa:0.55,pb:1.10,wMul:0.75,hMul:1.55,asym: 0.08,curl:0.14,cFreq:1.6,cPhase:5.0,wob1:0.04,wob2:0.02,lPhase:5.0, rPhase:2.1},
  {pa:0.46,pb:1.40,wMul:0.92,hMul:1.25,asym: 0.13,curl:0.15,cFreq:1.2,cPhase:3.8,wob1:0.05,wob2:0.02,lPhase:2.0, rPhase:4.7},
];

function fireBaseHue() {
  if (state.rainbowMode) return state.rainbowHue;
  var rgb = hexToRgb(state.color);
  var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  if (hsl[1] < 0.15) return 12;
  return hsl[0];
}

// Flame gradients depend only on hue + height, both constant per stamp, so they
// are built once at placement and reused every frame. Coordinates are local
// (post translate/rotate); CanvasGradients are not bound to a context, so a
// gradient created from state.ctx paints correctly on the overlay too.
function makeFlameGradients(hue, H) {
  var grad = state.ctx.createLinearGradient(0,0,0,-H);
  grad.addColorStop(0.00,'hsla('+hue+',95%,22%,0)');
  grad.addColorStop(0.05,'hsla('+hue+',95%,32%,0.55)');
  grad.addColorStop(0.25,'hsla('+(hue+4)+',98%,44%,0.72)');
  grad.addColorStop(0.55,'hsla('+(hue+12)+',98%,54%,0.80)');
  grad.addColorStop(0.80,'hsla('+(hue+24)+',98%,66%,0.85)');
  grad.addColorStop(0.94,'hsla('+(hue+36)+',98%,80%,0.90)');
  grad.addColorStop(1.00,'rgba(255,255,245,0.95)');
  var core = state.ctx.createLinearGradient(0,0,0,-H*0.88);
  core.addColorStop(0.00,'hsla('+(hue+8)+',98%,62%,0.70)');
  core.addColorStop(0.20,'hsla('+(hue+14)+',98%,72%,0.80)');
  core.addColorStop(0.55,'hsla('+(hue+26)+',98%,84%,0.90)');
  core.addColorStop(0.85,'hsla('+(hue+40)+',95%,93%,0.95)');
  core.addColorStop(1.00,'rgba(255,255,252,1.00)');
  return {grad:grad, core:core};
}

function drawFlameDirectly(targetCtx, stamp, phaseTime, alphaOverride) {
  var v = stamp.lv, H = stamp.lH, baseHW = stamp.lBaseHW;
  var pre = stamp.lPre, lean = stamp.lLean, sqU = stamp.lSqU;
  var N = _FIRE_N;
  var dt = phaseTime - stamp.born;
  var lPhase = v.lPhase + dt*stamp.phaseSpeed;
  var rPhase = v.rPhase + dt*stamp.phaseSpeed*1.17;
  var cPhase = v.cPhase + dt*stamp.phaseSpeed*0.73;
  var alpha = (alphaOverride !== undefined) ? alphaOverride : stamp.alpha;

  targetCtx.save();
  targetCtx.globalCompositeOperation = 'source-over';
  targetCtx.globalAlpha = alpha;
  targetCtx.translate(stamp.x, stamp.y);
  targetCtx.rotate(stamp.rot);

  function buildPath(scaleX, scaleH) {
    targetCtx.beginPath();
    targetCtx.moveTo(lean[0], 0);
    for (var i = 1; i <= N; i++) {
      var u = i/N, pi2 = Math.min(i, _FIRE_N);
      var wob = baseHW*(v.wob1*Math.sin(u*4.0+lPhase)+v.wob2*Math.sin(u*7.0+lPhase*1.3))*(1-u*0.7);
      var sway = H*v.curl*Math.sin(u*Math.PI*v.cFreq+cPhase)*sqU[pi2]+lean[pi2];
      targetCtx.lineTo((sway-Math.max(0,pre[pi2]+wob))*scaleX, -u*H*scaleH);
    }
    for (var i = N-1; i >= 0; i--) {
      var u = i/N, pi2 = Math.min(i, _FIRE_N);
      var wob = baseHW*(v.wob1*Math.sin(u*4.0+rPhase)+v.wob2*Math.sin(u*7.0+rPhase*1.3))*(1-u*0.7);
      var sway = H*v.curl*Math.sin(u*Math.PI*v.cFreq+cPhase)*sqU[pi2]+lean[pi2];
      targetCtx.lineTo((sway+Math.max(0,pre[pi2]+wob))*scaleX, -u*H*scaleH);
    }
    targetCtx.closePath();
  }

  buildPath(1,1); targetCtx.fillStyle = stamp.gradMain; targetCtx.fill();
  buildPath(0.62, 0.88); targetCtx.fillStyle = stamp.gradCore; targetCtx.fill();
  targetCtx.restore();
}

function fireOverlayFrame() {
  if (!state.fireLiveStamps.length) {
    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
    state.fireAnimFrame = null;
    return;
  }
  var now = performance.now();
  state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
  state.fireLiveStamps = state.fireLiveStamps.filter(function(stamp) {
    var age = now - stamp.born;
    // Fade-in by real elapsed age (not the frozen settle pose time) so a flame
    // that settles mid-ramp still finishes rising to full alpha smoothly.
    var fade = age < FIRE_FADE_IN_MS ? age/FIRE_FADE_IN_MS : 1;
    var a = stamp.alpha*fade;
    if (stamp.settleStart !== null) {
      var settleAge = now - stamp.settleStart;
      if (settleAge >= FIRE_SETTLE_MS) {
        drawFlameDirectly(state.ctx, stamp, stamp.settleStart, a);
        return false;
      }
      drawFlameDirectly(state.ovCtx, stamp, stamp.settleStart, a);
    } else {
      if (age >= stamp.lifetime) stamp.settleStart = now;
      drawFlameDirectly(state.ovCtx, stamp, now, a);
    }
    return true;
  });
  state.fireAnimFrame = requestAnimationFrame(fireOverlayFrame);
}

export function finalizeFireStroke() {
  var now = performance.now();
  state.fireLiveStamps.forEach(function(stamp) {
    if (stamp.settleStart === null) stamp.settleStart = now;
  });
}

// Synchronously bake every live flame onto state.ctx and tear down the loop.
// Used by the splash ambient so a stroke fully commits to its own layer with no
// async settle frames left to paint onto a later layer.
export function commitFireStrokeNow() {
  var now = performance.now();
  state.fireLiveStamps.forEach(function(stamp) {
    drawFlameDirectly(state.ctx, stamp, stamp.settleStart || now, stamp.alpha);
  });
  state.fireLiveStamps = [];
  if (state.fireAnimFrame) { cancelAnimationFrame(state.fireAnimFrame); state.fireAnimFrame = null; }
  state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
}

function placeFlameStamp(x, y) {
  var height = state.brushSize*(1.5+Math.random()*0.8);
  var variant = Math.floor(Math.random()*FLAME_VARIANTS.length);
  var hue = fireBaseHue();
  if (state.rainbowMode) state.rainbowHue = (state.rainbowHue+4)%360;

  var speed = Math.hypot(state.fireVelX, state.fireVelY);
  var sweep = Math.min(1, speed/FIRE_SWEEP_REF);
  var bx = 0, by = -1;
  if (speed > 0.01) {
    var ux = state.fireVelX/speed, uy = state.fireVelY/speed;
    bx = -sweep*ux; by = (1-sweep)*(-1)+sweep*(-uy);
  }
  var baseRot = Math.atan2(bx,-by);
  var jitter = (Math.random()-0.5)*(Math.PI/180*12);
  var rot = baseRot+jitter;
  var jx = (Math.random()-0.5)*state.brushSize*0.22;
  var jy = (Math.random()-0.5)*state.brushSize*0.18;

  var v = FLAME_VARIANTS[variant];
  var now = performance.now();
  var lH = height*v.hMul;
  var lBaseHW = height*0.34*v.wMul;
  var lPeakU = v.pa/(v.pa+v.pb);
  var lPeakVal = Math.pow(lPeakU,v.pa)*Math.pow(1-lPeakU,v.pb);
  var lPre=[], lLean=[], lSqU=[];
  for (var pi = 0; pi <= _FIRE_N; pi++) {
    var pu = pi/_FIRE_N;
    lPre[pi]  = (pu<=0||pu>=1)?0:lBaseHW*Math.pow(pu,v.pa)*Math.pow(1-pu,v.pb)/lPeakVal;
    lLean[pi] = v.asym*Math.sin(pu*Math.PI)*lBaseHW*1.2;
    lSqU[pi]  = Math.sqrt(pu);
  }
  var grads = makeFlameGradients(hue, lH);
  var stampData = {
    x:x+jx, y:y+jy, rot:rot,
    variant:variant, height:height, hue:hue,
    alpha:0.62, born:now, phaseSpeed:0.005+Math.random()*0.004,
    lifetime:400+Math.random()*400, settleStart:null,
    lv:v, lH:lH, lBaseHW:lBaseHW, lPre:lPre, lLean:lLean, lSqU:lSqU,
    gradMain:grads.grad, gradCore:grads.core
  };
  state.fireLiveStamps.push(stampData);
  if (state.mirrorMode) {
    state.fireLiveStamps.push(Object.assign({}, stampData, {x:state.canvasW-(x+jx), rot:-rot}));
  }
}

export function drawFireStroke(x, y, t) {
  var dx = x-state.lastX, dy = y-state.lastY;
  var dist = Math.hypot(dx, dy);
  // Prefer the hardware input timestamp (threaded from the event). It reflects
  // when the touch actually happened, so it survives main-thread jank — unlike
  // performance.now() read at handler-execution time, which inflates under load
  // (the heavy fire render is exactly such a load) and collapses the velocity.
  var now = (t !== undefined) ? t : performance.now();
  // Clamp so a stalled frame (huge gap) or a coalesced burst (near-zero gap)
  // can't wreck the estimate.
  var dt = _fireLastT > 0 ? now - _fireLastT : 16;
  dt = Math.min(FIRE_DT_MAX, Math.max(FIRE_DT_MIN, dt));
  _fireLastT = now;
  if (dist < 0.001) {
    state.fireVelX = 0; state.fireVelY = 0;
    state.fireHasPrev = true; state.firePrevX = x; state.firePrevY = y;
    placeFlameStamp(x, y);
    state.fireDistAcc = 0;
    if (!state.fireAnimFrame) state.fireAnimFrame = requestAnimationFrame(fireOverlayFrame);
    return;
  }
  // Time-constant EMA on px/ms velocity: identical response at 60 Hz (finger/
  // mouse) and 240 Hz (Apple Pencil) for equal physical stroke speed.
  var a = 1 - Math.exp(-dt/FIRE_VEL_TAU);
  state.fireVelX += ((dx/dt) - state.fireVelX)*a;
  state.fireVelY += ((dy/dt) - state.fireVelY)*a;
  var spacing = Math.max(2, state.brushSize*0.45);
  var firstOffset = spacing - state.fireDistAcc;
  if (firstOffset < 0) firstOffset = 0;
  for (var d = firstOffset; d <= dist; d += spacing) {
    var t = d/dist;
    placeFlameStamp(state.lastX+dx*t, state.lastY+dy*t);
  }
  state.fireDistAcc = (state.fireDistAcc+dist)%spacing;
  if (!state.fireAnimFrame) state.fireAnimFrame = requestAnimationFrame(fireOverlayFrame);
}
