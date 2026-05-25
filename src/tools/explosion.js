import state from '../state.js';
import { saveHistory } from '../core/history.js';

// Sutherland-Hodgman polygon clip against a convex clip polygon (CW in screen coords)
function clipPolyToConvex(poly, clip) {
  var output = poly.slice();
  var n = clip.length;
  for (var i = 0; i < n; i++) {
    if (output.length === 0) return [];
    var input = output;
    output = [];
    var eA = clip[i], eB = clip[(i+1) % n];
    for (var j = 0; j < input.length; j++) {
      var curr = input[j];
      var prev = input[(j + input.length - 1) % input.length];
      var currIn = (eB.x-eA.x)*(curr.y-eA.y) - (eB.y-eA.y)*(curr.x-eA.x) >= 0;
      var prevIn = (eB.x-eA.x)*(prev.y-eA.y) - (eB.y-eA.y)*(prev.x-eA.x) >= 0;
      if (currIn) {
        if (!prevIn) output.push(edgeIntersect(eA, eB, prev, curr));
        output.push(curr);
      } else if (prevIn) {
        output.push(edgeIntersect(eA, eB, prev, curr));
      }
    }
  }
  return output;
}

function edgeIntersect(a, b, c, d) {
  var denom = (a.x-b.x)*(c.y-d.y) - (a.y-b.y)*(c.x-d.x);
  if (Math.abs(denom) < 1e-10) return {x:(c.x+d.x)/2, y:(c.y+d.y)/2};
  var t = ((a.x-c.x)*(c.y-d.y) - (a.y-c.y)*(c.x-d.x)) / denom;
  return {x: a.x + t*(b.x-a.x), y: a.y + t*(b.y-a.y)};
}

function makeCirclePoly(cx, cy, r) {
  var pts = [], n = 48;
  for (var i = 0; i < n; i++) {
    var a = (i / n) * Math.PI * 2;
    pts.push({x: cx + Math.cos(a)*r, y: cy + Math.sin(a)*r});
  }
  return pts;
}

export function doBoom(cx, cy) {
  saveHistory();
  state.lastStrokePoints = null;
  var baseR = 440 + Math.random()*80;

  // Jittered grid tessellation over blast area
  var cols = 20, rows = 20;
  var cellW = baseR*2/cols, cellH = baseR*2/rows;
  var jitter = cellW*0.38;

  var gridPts = [];
  for (var row = 0; row <= rows; row++) {
    for (var col = 0; col <= cols; col++) {
      var bx = cx - baseR + col*cellW;
      var by = cy - baseR + row*cellH;
      var jx = (col > 0 && col < cols) ? (Math.random()-0.5)*2*jitter : 0;
      var jy = (row > 0 && row < rows) ? (Math.random()-0.5)*2*jitter : 0;
      gridPts.push({x: bx+jx, y: by+jy});
    }
  }
  function gpt(r, c) { return gridPts[r*(cols+1)+c]; }

  var circlePoly = makeCirclePoly(cx, cy, baseR);

  // Clip each grid quad to blast circle → fragment polygons
  var frags = [];
  for (var row = 0; row < rows; row++) {
    for (var col = 0; col < cols; col++) {
      var quad = [gpt(row,col), gpt(row,col+1), gpt(row+1,col+1), gpt(row+1,col)];
      var verts = clipPolyToConvex(quad, circlePoly);
      if (!verts || verts.length < 3) continue;
      var fcx = 0, fcy = 0;
      for (var k = 0; k < verts.length; k++) { fcx += verts[k].x; fcy += verts[k].y; }
      fcx /= verts.length; fcy /= verts.length;
      var dx = fcx-cx, dy = fcy-cy, dist = Math.sqrt(dx*dx+dy*dy) || 1;
      var spd = 18 - (dist/baseR)*10 + Math.random()*3;
      frags.push({
        verts: verts, cx: fcx, cy: fcy,
        vx: (dx/dist)*spd + (Math.random()-0.5)*1.5,
        vy: (dy/dist)*spd + (Math.random()-0.5)*1.5,
        rot: 0, rotSpeed: (Math.random()-0.5)*0.05,
        x: 0, y: 0, frame: 0, maxFrame: 20+Math.floor(Math.random()*20), done: false,
        img: null, minX: 0, minY: 0, fw: 0, fh: 0
      });
    }
  }

  // Capture canvas pixels for each fragment
  for (var i = 0; i < frags.length; i++) {
    var f = frags[i];
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (var j = 0; j < f.verts.length; j++) {
      if (f.verts[j].x < minX) minX = f.verts[j].x;
      if (f.verts[j].y < minY) minY = f.verts[j].y;
      if (f.verts[j].x > maxX) maxX = f.verts[j].x;
      if (f.verts[j].y > maxY) maxY = f.verts[j].y;
    }
    minX = Math.max(0, Math.floor(minX)); minY = Math.max(0, Math.floor(minY));
    maxX = Math.min(state.canvasW, Math.ceil(maxX)); maxY = Math.min(state.canvasH, Math.ceil(maxY));
    var fw = maxX-minX, fh = maxY-minY;
    if (fw < 1 || fh < 1) { f.img = null; continue; }
    f.minX = minX; f.minY = minY; f.fw = fw; f.fh = fh;

    var fc = document.createElement('canvas');
    fc.width = fw*state.DPR; fc.height = fh*state.DPR;
    var fctx = fc.getContext('2d');
    fctx.beginPath();
    fctx.moveTo((f.verts[0].x-minX)*state.DPR, (f.verts[0].y-minY)*state.DPR);
    for (var j = 1; j < f.verts.length; j++)
      fctx.lineTo((f.verts[j].x-minX)*state.DPR, (f.verts[j].y-minY)*state.DPR);
    fctx.closePath(); fctx.clip();
    fctx.drawImage(state.canvas, -minX*state.DPR, -minY*state.DPR);
    f.img = fc;
  }

  // Clear blast area as a clean circle — per-polygon fills leave seam artifacts at edges
  state.ctx.save();
  state.ctx.beginPath();
  state.ctx.arc(cx, cy, baseR, 0, Math.PI*2);
  state.ctx.fillStyle = state.BG_CSS;
  state.ctx.fill();
  state.ctx.restore();

  // Animate fragments flying outward
  var frame = 0;
  function animBoom() {
    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
    var alive = false;
    for (var i = 0; i < frags.length; i++) {
      var f = frags[i];
      if (!f.img || f.done) continue;
      f.vx *= 0.91; f.vy *= 0.91;
      f.x += f.vx; f.y += f.vy; f.rot += f.rotSpeed; f.frame++;
      state.ovCtx.save();
      state.ovCtx.translate(f.cx+f.x, f.cy+f.y); state.ovCtx.rotate(f.rot);
      state.ovCtx.drawImage(f.img, -(f.cx-f.minX), -(f.cy-f.minY), f.fw, f.fh);
      state.ovCtx.restore();
      if (f.frame >= f.maxFrame) {
        f.done = true;
        state.ctx.save();
        state.ctx.translate(f.cx+f.x, f.cy+f.y); state.ctx.rotate(f.rot);
        state.ctx.drawImage(f.img, -(f.cx-f.minX), -(f.cy-f.minY), f.fw, f.fh);
        state.ctx.restore();
      } else { alive = true; }
    }
    if (alive && ++frame < 120) requestAnimationFrame(animBoom);
    else state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
  }
  animBoom();
}
