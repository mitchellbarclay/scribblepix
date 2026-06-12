import state from '../state.js';
import { hexToRgb, hslToRgb } from './color-utils.js';
import { fillScan } from './fill-scan.js';

var POUR_VX0 = -1.5, POUR_FRICTION = 0.93, POUR_GRAVITY = 0.34;
var POUR_SPAWN_DX = -15, POUR_SPAWN_DY = 0;
var POUR_FALL = 80;

export function flattenCanvas() {
  var w = state.canvas.width, h = state.canvas.height;
  var img = state.ctx.getImageData(0, 0, w, h), d = img.data;
  for (var i = 0; i < d.length; i += 4) {
    if (d[i+3] < 255) {
      var a = d[i+3]/255;
      d[i]   = Math.round(d[i]*a   + state.BG[0]*(1-a));
      d[i+1] = Math.round(d[i+1]*a + state.BG[1]*(1-a));
      d[i+2] = Math.round(d[i+2]*a + state.BG[2]*(1-a));
      d[i+3] = 255;
    }
  }
  state.ctx.putImageData(img, 0, 0);
}

export function doFill(sx, sy) {
  flattenCanvas();
  var w = state.canvas.width, h = state.canvas.height;
  var img = state.ctx.getImageData(0, 0, w, h), data = img.data;
  var idx = (sy*w+sx)*4;
  var tr = data[idx], tg = data[idx+1], tb = data[idx+2], ta = data[idx+3];
  var tol = state.fillTolerance;
  var fc = state.rainbowMode ? 'hsl('+Math.floor(Math.random()*360)+',100%,50%)' : state.color;
  var rgb = fc.indexOf('hsl') === 0 ? hslToRgb(fc) : hexToRgb(fc);
  var fr = rgb[0], fg = rgb[1], fb = rgb[2];
  var stack = [[sx, sy]], vis = new Uint8Array(w*h);
  while (stack.length) {
    var pt = stack.pop(); var x = pt[0], y = pt[1];
    if (x < 0 || x >= w || y < 0 || y >= h || vis[y*w+x]) continue;
    var i = (y*w+x)*4;
    if (Math.abs(data[i]-tr)>tol || Math.abs(data[i+1]-tg)>tol || Math.abs(data[i+2]-tb)>tol || Math.abs(data[i+3]-ta)>tol) continue;
    vis[y*w+x] = 1; data[i] = fr; data[i+1] = fg; data[i+2] = fb; data[i+3] = 255;
    stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);
  }
  state.ctx.putImageData(img, 0, 0);
}

// ── Progressive flood fill ────────────────────────────────────────────────────
// The heavy work (flatten + BFS over every physical pixel) runs in a module
// worker so the drop moment doesn't freeze the main thread — on iPad a large
// fill cost several hundred ms synchronously. The reveal animation then paints
// the pre-computed result through an expanding ring clip + drawImage (same
// pattern as the alien-blast warp reveal): one GPU composite per frame instead
// of scanning every fill pixel and putImageData-ing a growing rect.

var _fillWorker;
function _getFillWorker() {
  if (_fillWorker === undefined) {
    try {
      _fillWorker = new Worker(new URL('./fill-worker.js', import.meta.url), { type: 'module' });
    } catch (e) {
      console.warn('[fill] worker unavailable, falling back to sync fill:', e);
      _fillWorker = null;
    }
  }
  return _fillWorker;
}

export function progressiveFloodFill(sx, sy, rgb, onDone, baseImg) {
  var w = state.canvas.width, h = state.canvas.height;
  if (sx < 0 || sx >= w || sy < 0 || sy >= h) { onDone(); return; }
  // A caller that just took an undo snapshot can pass it in — copying it is a
  // memcpy, much cheaper than a second synchronous GPU readback.
  var img;
  if (baseImg && baseImg.width === w && baseImg.height === h) {
    img = new ImageData(new Uint8ClampedArray(baseImg.data), w, h);
  } else {
    img = state.ctx.getImageData(0, 0, w, h);
  }

  var worker = _getFillWorker();
  if (worker) {
    worker.onmessage = function(e) {
      _revealFill(e.data, sx, sy, onDone);
    };
    worker.onerror = function(err) {
      console.error('[fill] worker failed, using sync fill from now on:', err.message || err);
      _fillWorker = null;
      // The transferred buffer is gone — rescan from a fresh readback.
      var fresh = state.ctx.getImageData(0, 0, w, h);
      var res = fillScan(fresh.data, w, h, sx, sy, state.fillTolerance, rgb, state.BG);
      res.buffer = fresh.data.buffer;
      _revealFill(res, sx, sy, onDone);
    };
    worker.postMessage(
      { buffer: img.data.buffer, w: w, h: h, sx: sx, sy: sy, tol: state.fillTolerance, fill: rgb, bg: state.BG },
      [img.data.buffer]
    );
  } else {
    var res = fillScan(img.data, w, h, sx, sy, state.fillTolerance, rgb, state.BG);
    res.buffer = img.data.buffer;
    _revealFill(res, sx, sy, onDone);
  }
}

// Paints the scan result onto the canvas as an expanding circular reveal.
// res.buffer holds the full flattened+filled canvas; pixels outside the fill
// region are identical to what's already on screen, so over-painting them
// inside the ring is invisible and lets us use one clipped drawImage per frame.
function _revealFill(res, sx, sy, onDone) {
  if (!res.count) { onDone(); return; }
  var w = state.canvas.width, h = state.canvas.height;
  var DPR = state.DPR;
  var bw = res.maxX - res.minX + 1, bh = res.maxY - res.minY + 1;

  var off = document.createElement('canvas');
  off.width = bw; off.height = bh;
  var img = new ImageData(new Uint8ClampedArray(res.buffer), w, h);
  off.getContext('2d').putImageData(img, -res.minX, -res.minY, res.minX, res.minY, bw, bh);

  // Same reveal origin formula as fillScan — maxDist is measured from here.
  var cx = sx / DPR, cy = Math.min(h-1, sy+30) / DPR;
  var maxDist = res.maxDist / DPR;
  var dxCSS = res.minX / DPR, dyCSS = res.minY / DPR, dwCSS = bw / DPR, dhCSS = bh / DPR;
  var startTime = performance.now(), duration = 1000;
  var lastR = 0;

  function frame() {
    var t = Math.min(1, (performance.now() - startTime) / duration);
    var eased = 1 - Math.pow(1-t, 2);
    var radius = maxDist * eased;
    if (radius > lastR || t >= 1) {
      state.ctx.save();
      state.ctx.beginPath();
      state.ctx.arc(cx, cy, radius + 1, 0, Math.PI*2, false);
      if (lastR > 0.5) {
        // Cut out the already-revealed inner zone with a reverse arc; the 2px
        // overlap re-covers the previous frame's anti-aliased clip edge.
        state.ctx.arc(cx, cy, Math.max(0, lastR - 1), 0, Math.PI*2, true);
      }
      state.ctx.clip();
      state.ctx.drawImage(off, dxCSS, dyCSS, dwCSS, dhCSS);
      state.ctx.restore();
      lastR = radius;
    }
    if (t < 1) requestAnimationFrame(frame);
    else onDone();
  }
  frame();
}

export function computeBucketPos(targetX, targetY) {
  var n = Math.max(1, Math.round((1+Math.sqrt(1+8*POUR_FALL/POUR_GRAVITY))/2));
  var horizDrift = POUR_VX0*(1-Math.pow(POUR_FRICTION,n))/(1-POUR_FRICTION);
  return {
    bx: Math.round(targetX - POUR_SPAWN_DX - horizDrift),
    by: Math.round(targetY - POUR_SPAWN_DY - POUR_FALL)
  };
}

export function paintStream(spawnX, spawnY, landingX, landingY, rgb, spawnDurationMs, onLanding, onDone) {
  var col = 'rgb('+rgb[0]+','+rgb[1]+','+rgb[2]+')';
  var startTime = performance.now();
  var drops = [];
  var deathY = landingY;
  var landed = false;

  function frame() {
    var elapsed = performance.now() - startTime;
    var spawning = elapsed < spawnDurationMs;
    if (spawning) {
      for (var i = 0; i < 2; i++) {
        drops.push({
          x: spawnX + (Math.random()-0.5)*4,
          y: spawnY + (Math.random()-0.5)*6,
          vx: POUR_VX0 - 0.35 + (Math.random()-0.5)*0.6,
          vy: 0,
          r: 3 + Math.random()*3
        });
      }
    }
    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);

    var fadeMs = 300;
    var shadowAlpha = spawning ? 0.22 : Math.max(0, 0.22*(1-(elapsed-spawnDurationMs)/fadeMs));
    if (shadowAlpha > 0) {
      var scx = landingX, scy = (spawnY+deathY)/2;
      var rad = 46;
      var grad = state.ovCtx.createRadialGradient(scx, scy, 0, scx, scy, rad);
      grad.addColorStop(0, 'rgba(0,0,0,'+shadowAlpha+')');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      state.ovCtx.save();
      state.ovCtx.translate(scx, scy); state.ovCtx.scale(0.7, 1.5); state.ovCtx.translate(-scx, -scy);
      state.ovCtx.fillStyle = grad;
      state.ovCtx.fillRect(scx-rad, scy-rad, rad*2, rad*2);
      state.ovCtx.restore();
    }

    for (var i = drops.length-1; i >= 0; i--) {
      var d = drops[i];
      d.x += d.vx; d.y += d.vy; d.vx *= POUR_FRICTION; d.vy += POUR_GRAVITY;
      if (!landed && d.y >= deathY-6) { landed = true; if (onLanding) onLanding(); }
      if (d.y > deathY) { drops.splice(i, 1); continue; }
      state.ovCtx.beginPath();
      state.ovCtx.arc(d.x, d.y, d.r, 0, Math.PI*2);
      state.ovCtx.fillStyle = col;
      state.ovCtx.fill();
    }
    if (drops.length || spawning) {
      requestAnimationFrame(frame);
    } else {
      state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
      if (onDone) onDone();
    }
  }
  frame();
}

export function bucketPour(sx, sy, ghostEl, onDone) {
  var fc = state.rainbowMode ? 'hsl('+Math.floor(Math.random()*360)+',100%,50%)' : state.color;
  var rgb = fc.indexOf('hsl') === 0 ? hslToRgb(fc) : hexToRgb(fc);
  var landingX = sx, landingY = sy;
  var bucketPos = computeBucketPos(landingX, landingY);
  var spawnX = bucketPos.bx + POUR_SPAWN_DX;
  var spawnY = bucketPos.by + POUR_SPAWN_DY;
  var canvasRect = state.canvasArea.getBoundingClientRect();
  ghostEl.style.transition = 'left 0.22s ease-out, top 0.22s ease-out, transform 0.28s cubic-bezier(0.34,1.56,0.64,1)';
  ghostEl.style.left = (canvasRect.left + bucketPos.bx) + 'px';
  ghostEl.style.top  = (canvasRect.top  + bucketPos.by) + 'px';
  ghostEl.style.transform = 'translate(-50%,-50%) rotate(-80deg)';
  setTimeout(function() {
    paintStream(spawnX, spawnY, landingX, landingY, rgb, 240,
      function() {
        progressiveFloodFill(Math.round(landingX*state.DPR), Math.round(landingY*state.DPR), rgb, function() {});
      },
      function() {
        ghostEl.style.transform = 'translate(-50%,-50%) rotate(0deg)';
        setTimeout(onDone, 150);
      }
    );
  }, 260);
}
