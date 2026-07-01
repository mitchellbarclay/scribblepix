import state from '../state.js';
import { saveHistory } from '../core/history.js';
import { parseColorRgb, rgbToHsl, hslToRgbCss } from '../core/color-utils.js';

// ── Alien blast: permanent pixel scatter + paint explosion + overlay animation ──
// Rive handles the UFO animation; this fires the canvas-side impact effect.
// Called from rive-stamp.js on the alien tool's impact.
//
// Animation sequence (all permanent canvas changes are kept; only overlay reverts):
//   1. Compute warped offscreen canvas in one pass (pixel displacement)
//   2. Reveal the warp progressively as an expanding ring (clip + drawImage)
//   3. Tendrils grow incrementally as the warp front passes each step
//   4. Blobs, satellites, streaks appear sequentially as the front reaches them
//   5. Crater burns in once the front clears the epicentre
//   6. Overlay (flash + rings + debris sparks) animates on ovCtx and fades

var WARP_R = 250; // CSS px radius of the permanent pixel warp

// Alien is a placed tool in the standard flow now, so its two-tone scheme and
// hue-driven accents (rings/streaks/crater) follow the selected colour instead
// of picking a fixed palette at random.
function alienSchemeFromColor() {
  if (state.rainbowMode) {
    var rh = Math.random() * 360;
    return { hue: rh, c0: hslToRgbCss(rh, 0.9, 0.62), c1: hslToRgbCss((rh + 45) % 360, 0.9, 0.62) };
  }
  var rgb = parseColorRgb(state.color);
  var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  var s = Math.max(0.65, hsl[1]);
  var l = Math.max(0.45, Math.min(0.75, hsl[2]));
  return {
    hue: hsl[0],
    c0: hslToRgbCss(hsl[0], s, l),
    c1: hslToRgbCss((hsl[0] + 45) % 360, s, Math.min(0.8, l + 0.1))
  };
}

export function doAlienBlast(dropX, dropY) {
  saveHistory();
  state.effectBusy++;
  state.lastStrokePoints = null;

  var alienC   = alienSchemeFromColor();
  var scheme   = [alienC.c0, alienC.c1];
  var blastHue = Math.round(alienC.hue);
  var baseR    = Math.max(32, Math.min(state.canvasW, state.canvasH) * 0.09);

  // N-fold symmetry: prime numbers 5/6/7 feel alien, not natural or mechanical
  var N   = [5, 6, 7][Math.floor(Math.random() * 3)];
  var TAU = Math.PI * 2;
  var phi = Math.random() * TAU; // global rotation — different each blast

  var maxR = Math.ceil(Math.sqrt(
    Math.pow(Math.max(dropX, state.canvasW - dropX), 2) +
    Math.pow(Math.max(dropY, state.canvasH - dropY), 2)
  )) + 10;

  // ── Warped offscreen: compute once, revealed progressively via ring clip ────
  var offscreen = document.createElement('canvas');
  offscreen.width  = state.canvas.width;
  offscreen.height = state.canvas.height;
  var offCtx = offscreen.getContext('2d');
  offCtx.drawImage(state.canvas, 0, 0);
  _blastWarpCtx(offCtx, dropX, dropY);

  // ── N logarithmic spiral arms  (r = r0·eᵇᶿ, all same handedness) ──────────
  // Inner zone, scheme[0]. Grows outward as warp front sweeps past each point.
  var tendrils = [];
  var spiralR0  = baseR * 0.16;
  var spiralB   = 0.19 + Math.random() * 0.05; // growth rate
  var spiralMax = baseR * (3.2 + Math.random() * 2.0);
  var spiralW0  = baseR * 0.17;

  for (var n = 0; n < N; n++) {
    var armBase = phi + n * (TAU / N);
    var steps = [];
    var theta = 0;
    while (true) {
      var r = spiralR0 * Math.exp(spiralB * theta);
      if (r > spiralMax) break;
      var t = r / spiralMax;
      steps.push({
        x: dropX + r * Math.cos(armBase + theta),
        y: dropY + r * Math.sin(armBase + theta),
        r: Math.max(0.5, spiralW0 * Math.pow(1 - t, 1.3)),
        a: Math.max(0, 1 - t * 0.5),
        dist: r
      });
      theta += 0.045;
    }
    tendrils.push({ steps: steps, color: scheme[0], drawn: 0 });
  }

  // ── Two concentric dot rings with uniform angular spacing ──────────────────
  // Inner ring at spiral-arm angles (scheme[0]), outer ring offset by π/N (scheme[1]).
  var blobs = [];
  var r1 = baseR * 1.15, br1 = baseR * 0.38;
  var r2 = baseR * 2.2,  br2 = baseR * 0.26;
  for (var ni = 0; ni < N; ni++) {
    var a1 = phi + ni * (TAU / N);
    blobs.push({
      x: dropX + r1 * Math.cos(a1), y: dropY + r1 * Math.sin(a1),
      r: br1, color: scheme[0], alpha: 0.92, dist: r1, drawn: false
    });
    var a2 = phi + ni * (TAU / N) + Math.PI / N; // half-step between arms
    blobs.push({
      x: dropX + r2 * Math.cos(a2), y: dropY + r2 * Math.sin(a2),
      r: br2, color: scheme[1], alpha: 0.88, dist: r2, drawn: false
    });
  }

  // ── N radial streaks as dot-steps (extend along with warp front) ───────────
  // Placed at outer-ring angles so they interleave with spiral arms.
  var streakLen  = baseR * (4.5 + Math.random() * 2.0);
  var streaks    = []; // reuse tendril drawing loop — same {steps, color, drawn} shape
  var streakHsl  = 'hsla(' + blastHue + ',100%,78%,1)';
  for (var ns = 0; ns < N; ns++) {
    var sAng = phi + ns * (TAU / N) + Math.PI / N;
    var sSteps = [];
    // 1px dot spacing → near-continuous line that grows with the front
    for (var sd = 0; sd <= streakLen; sd += 1) {
      sSteps.push({
        x: dropX + Math.cos(sAng) * sd, y: dropY + Math.sin(sAng) * sd,
        r: 0.9, a: 0.6, dist: sd
      });
    }
    streaks.push({ steps: sSteps, color: streakHsl, drawn: 0 });
  }
  // Merge streaks into the tendrils list so the animation loop handles them uniformly
  for (var ms = 0; ms < streaks.length; ms++) tendrils.push(streaks[ms]);

  // ── N satellites at streak endpoints + secondary dots at ~60% ─────────────
  var satellites = [];
  var satR  = Math.max(5, baseR * 0.20);
  var sat2R = Math.max(3, baseR * 0.10);
  for (var nsat = 0; nsat < N; nsat++) {
    var satAng = phi + nsat * (TAU / N) + Math.PI / N;
    satellites.push({
      x: dropX + Math.cos(satAng) * streakLen,
      y: dropY + Math.sin(satAng) * streakLen,
      r: satR, color: scheme[1], alpha: 0.92,
      dist: streakLen, drawn: false
    });
    var d2 = streakLen * (0.52 + Math.random() * 0.14);
    satellites.push({
      x: dropX + Math.cos(satAng) * d2, y: dropY + Math.sin(satAng) * d2,
      r: sat2R, color: scheme[0], alpha: 0.82,
      dist: d2, drawn: false
    });
  }

  // ── Overlay debris ──────────────────────────────────────────────────────────
  var debris = [];
  for (var di = 0; di < 55; di++) {
    var da   = Math.random() * Math.PI * 2;
    var dspd = 160 + Math.random() * 480;
    var dlif = 0.5 + Math.random() * 1.0;
    debris.push({
      x: dropX, y: dropY,
      vx: Math.cos(da) * dspd, vy: Math.sin(da) * dspd,
      life: dlif, maxLife: dlif,
      r: 1.5 + Math.random() * 3.5,
      hue: (blastHue + Math.floor(Math.random() * 80) - 40 + 360) % 360
    });
  }

  // ── Animation ──────────────────────────────────────────────────────────────
  var revealR     = 0;
  var lastRevealR = 0;
  var REVEAL_SPEED = 380; // CSS px/s — how fast the warp front expands
  var flashAlpha  = 1.0;
  var pulseR      = 0;
  var PULSE_SPEED = 640;
  var craterDrawn = false;
  var lastT       = performance.now();

  function frame() {
    var now = performance.now();
    var dt  = Math.min(0.05, (now - lastT) / 1000);
    lastT   = now;

    flashAlpha  = Math.max(0, flashAlpha - dt * 2.2);
    pulseR     += dt * PULSE_SPEED;
    lastRevealR = revealR;
    revealR     = Math.min(WARP_R, revealR + dt * REVEAL_SPEED);

    // ── Warp ring reveal (GPU drawImage, only new annulus each frame) ─────────
    if (lastRevealR < WARP_R) {
      state.ctx.save();
      state.ctx.beginPath();
      state.ctx.arc(dropX, dropY, revealR + 1, 0, Math.PI * 2, false);
      if (lastRevealR > 0.5) {
        // Cut out the already-revealed inner zone with a reverse arc (nonzero winding)
        state.ctx.arc(dropX, dropY, Math.max(0, lastRevealR - 1), 0, Math.PI * 2, true);
      }
      state.ctx.clip();
      // Draw at CSS size (state.canvasW × state.canvasH) so the physical-pixel
      // offscreen maps 1:1 to the canvas — ctx has scale(2,2) applied, so
      // drawImage(offscreen, 0, 0) would otherwise render it at 2× the canvas area.
      state.ctx.drawImage(offscreen, 0, 0, state.canvasW, state.canvasH);
      state.ctx.restore();
    }

    // ── Crater burns in once the front clears the epicentre ───────────────────
    if (!craterDrawn && revealR >= baseR * 0.28) {
      craterDrawn = true;
      _drawBlastCrater(dropX, dropY, baseR, blastHue);
    }

    // ── Tendrils grow step by step ────────────────────────────────────────────
    state.ctx.save();
    for (var ti = 0; ti < tendrils.length; ti++) {
      var tnd = tendrils[ti];
      state.ctx.fillStyle = tnd.color;
      while (tnd.drawn < tnd.steps.length && tnd.steps[tnd.drawn].dist <= revealR) {
        var step = tnd.steps[tnd.drawn++];
        state.ctx.globalAlpha = step.a;
        state.ctx.beginPath();
        state.ctx.arc(step.x, step.y, step.r, 0, Math.PI * 2);
        state.ctx.fill();
      }
    }
    state.ctx.globalAlpha = 1;
    state.ctx.restore();

    // ── Blobs pop in ──────────────────────────────────────────────────────────
    state.ctx.save();
    for (var bi = 0; bi < blobs.length; bi++) {
      var blob = blobs[bi];
      if (!blob.drawn && revealR >= blob.dist) {
        blob.drawn = true;
        state.ctx.fillStyle   = blob.color;
        state.ctx.globalAlpha = blob.alpha;
        state.ctx.beginPath();
        state.ctx.arc(blob.x, blob.y, blob.r, 0, Math.PI * 2);
        state.ctx.fill();
      }
    }
    state.ctx.globalAlpha = 1;
    state.ctx.restore();

    // ── Satellites pop in ─────────────────────────────────────────────────────
    state.ctx.save();
    for (var si2 = 0; si2 < satellites.length; si2++) {
      var sat = satellites[si2];
      if (!sat.drawn && revealR >= sat.dist) {
        sat.drawn = true;
        state.ctx.fillStyle   = sat.color;
        state.ctx.globalAlpha = sat.alpha;
        state.ctx.beginPath();
        state.ctx.arc(sat.x, sat.y, sat.r, 0, Math.PI * 2);
        state.ctx.fill();
      }
    }
    state.ctx.globalAlpha = 1;
    state.ctx.restore();

    // ── Streaks extend outward ────────────────────────────────────────────────
    state.ctx.save();
    for (var ski = 0; ski < streaks.length; ski++) {
      var sk = streaks[ski];
      if (!sk.drawn && revealR >= sk.dist) {
        sk.drawn = true;
        state.ctx.globalAlpha = sk.alpha;
        state.ctx.strokeStyle = 'hsla(' + sk.hue + ',100%,75%,1)';
        state.ctx.lineWidth   = 1.2;
        state.ctx.beginPath();
        state.ctx.moveTo(dropX, dropY);
        state.ctx.lineTo(sk.ex, sk.ey);
        state.ctx.stroke();
      }
    }
    state.ctx.restore();

    // ── Overlay (flash + rings + debris) — all on ovCtx, reverts fine ─────────
    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);

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

    for (var ri = 0; ri < 4; ri++) {
      var rR = pulseR * (1 - ri * 0.07);
      if (rR <= 0 || rR > maxR + 80) continue;
      var ringFade = Math.max(0, 1 - rR / (maxR + 80));
      var rHue = (blastHue + ri * 55) % 360;
      state.ovCtx.save();
      state.ovCtx.globalAlpha = ringFade * Math.max(0, 0.55 - ri * 0.1);
      state.ovCtx.strokeStyle = 'hsla(' + rHue + ',100%,70%,1)';
      state.ovCtx.lineWidth   = Math.max(2, 16 - ri * 3);
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
      state.ovCtx.lineWidth   = 2;
      state.ovCtx.beginPath();
      state.ovCtx.arc(dropX, dropY, pulseR, 0, Math.PI * 2);
      state.ovCtx.stroke();
      state.ovCtx.restore();
    }

    var anyAlive = false;
    for (var k = 0; k < debris.length; k++) {
      var p = debris[k];
      if (p.life <= 0) continue;
      p.x  += p.vx * dt;
      p.y  += p.vy * dt;
      p.vy += 200 * dt;
      p.life -= dt;
      var lt = p.life / p.maxLife;
      state.ovCtx.save();
      state.ovCtx.globalAlpha = lt * 0.9;
      state.ovCtx.fillStyle   = 'hsl(' + p.hue + ',100%,' + Math.round(55 + lt * 25) + '%)';
      state.ovCtx.beginPath();
      state.ovCtx.arc(p.x, p.y, Math.max(0.5, p.r * lt), 0, Math.PI * 2);
      state.ovCtx.fill();
      state.ovCtx.restore();
      anyAlive = true;
    }

    if (revealR < WARP_R || flashAlpha > 0 || anyAlive) {
      requestAnimationFrame(frame);
    } else {
      state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
      state.effectBusy--;
    }
  }
  requestAnimationFrame(frame);
}

// Compute full outward pixel warp into the given ctx (inverse warp = forward explosion push).
// Reads from ctx's own pixels, writes back. Called once on an offscreen canvas.
function _blastWarpCtx(ctx, blastX, blastY) {
  var DPR    = state.DPR;
  var bcx    = blastX * DPR;
  var bcy    = blastY * DPR;
  var W      = ctx.canvas.width;
  var H      = ctx.canvas.height;
  var MAX_PUSH = 85 * DPR;
  var PUSH_R   = WARP_R * DPR;
  var PUSH_R2  = PUSH_R * PUSH_R;

  var bx0 = Math.max(0, Math.floor(bcx - PUSH_R));
  var by0 = Math.max(0, Math.floor(bcy - PUSH_R));
  var bx1 = Math.min(W, Math.ceil(bcx + PUSH_R));
  var by1 = Math.min(H, Math.ceil(bcy + PUSH_R));
  var pw = bx1 - bx0, ph = by1 - by0;
  if (pw <= 0 || ph <= 0) return;

  var snap = ctx.getImageData(bx0, by0, pw, ph);
  var sd   = snap.data;
  var dd   = new Uint8ClampedArray(sd.length);

  for (var py = 0; py < ph; py++) {
    var wy  = py + by0;
    var ddy = wy - bcy;
    var dy2 = ddy * ddy;
    for (var px = 0; px < pw; px++) {
      var wx    = px + bx0;
      var ddx   = wx - bcx;
      var dist2 = ddx * ddx + dy2;
      var oi    = (py * pw + px) * 4;

      if (dist2 >= PUSH_R2) {
        dd[oi] = sd[oi]; dd[oi+1] = sd[oi+1]; dd[oi+2] = sd[oi+2]; dd[oi+3] = sd[oi+3];
        continue;
      }

      var dist = Math.sqrt(dist2);
      if (dist < 0.5) { dd[oi] = dd[oi+1] = dd[oi+2] = 0; dd[oi+3] = 0; continue; }

      var t    = 1 - dist / PUSH_R;
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

  ctx.putImageData(new ImageData(dd, pw, ph), bx0, by0);
}

// Crater void + neon rim, drawn onto state.ctx.
function _drawBlastCrater(dropX, dropY, baseR, blastHue) {
  var crR = baseR * 0.55;
  state.ctx.save();

  var cg = state.ctx.createRadialGradient(dropX, dropY, 0, dropX, dropY, crR);
  cg.addColorStop(0,   'rgba(0,0,0,0.92)');
  cg.addColorStop(0.7, 'rgba(0,0,0,0.72)');
  cg.addColorStop(1,   'rgba(0,0,0,0)');
  state.ctx.fillStyle = cg;
  state.ctx.beginPath();
  state.ctx.arc(dropX, dropY, crR, 0, Math.PI * 2);
  state.ctx.fill();

  state.ctx.shadowColor = 'hsla(' + blastHue + ',100%,72%,1)';
  state.ctx.shadowBlur  = 18;
  state.ctx.strokeStyle = 'hsla(' + blastHue + ',100%,82%,0.95)';
  state.ctx.lineWidth   = 2.5;
  state.ctx.beginPath();
  state.ctx.arc(dropX, dropY, crR * 0.76, 0, Math.PI * 2);
  state.ctx.stroke();

  state.ctx.restore();
}
