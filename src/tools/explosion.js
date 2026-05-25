import state from '../state.js';
import { parseColorRgb } from '../core/color-utils.js';
import { stampDot, getBrushStamp } from '../core/brush-pipeline.js';
import { saveHistory } from '../core/history.js';

function makeNoiseSeed() {
  return [Math.random()*6.2832, Math.random()*6.2832, Math.random()*6.2832];
}

function noiseRadius(theta, seed, amp) {
  return 1 + amp*0.55*Math.sin(theta*3+seed[0])
           + amp*0.30*Math.sin(theta*5+seed[1])
           + amp*0.18*Math.sin(theta*9+seed[2]);
}

function buildNoiseTable(seed, amp, bins) {
  bins = bins || 1024;
  var arr = new Float32Array(bins);
  for (var i = 0; i < bins; i++) arr[i] = noiseRadius((i/bins)*6.2832, seed, amp);
  return arr;
}

function buildJaggedBlobStamp(baseR, css, seed, amp) {
  baseR = Math.max(2, Math.round(baseR));
  var maxR = Math.ceil(baseR*(1+amp));
  var size = 2*maxR+1;
  var sc = document.createElement('canvas'); sc.width = size; sc.height = size;
  var sctx = sc.getContext('2d');
  var img = sctx.createImageData(size,size), d = img.data;
  var rgb = parseColorRgb(css);
  var bins = 512, rByBin = new Float32Array(bins);
  for (var k = 0; k < bins; k++) {
    var theta = (k/bins)*6.2832 - Math.PI;
    rByBin[k] = baseR*noiseRadius(theta, seed, amp);
  }
  for (var y = 0; y < size; y++) {
    var dy = y-maxR, dyy = dy*dy;
    for (var x = 0; x < size; x++) {
      var dx = x-maxR;
      var theta = Math.atan2(dy,dx);
      var bin = ((theta+Math.PI)/6.2832*bins)|0;
      if (bin < 0) bin = 0; else if (bin >= bins) bin = bins-1;
      var rr = rByBin[bin];
      if (dx*dx+dyy <= rr*rr) {
        var idx = (y*size+x)*4;
        d[idx] = rgb[0]; d[idx+1] = rgb[1]; d[idx+2] = rgb[2]; d[idx+3] = 255;
      }
    }
  }
  sctx.putImageData(img,0,0);
  return sc;
}

function strokeJaggedRing(targetCtx, cx, cy, r, thickness, css, alpha, table) {
  if (r <= 0 || thickness <= 0) return;
  var rgb = parseColorRgb(css);
  targetCtx.fillStyle = 'rgb('+rgb[0]+','+rgb[1]+','+rgb[2]+')';
  targetCtx.globalAlpha = alpha;
  var icx = Math.round(cx), icy = Math.round(cy);
  var t = Math.max(1, Math.round(thickness));
  var bins = table.length, binsOver2pi = bins/6.2832;
  var step = 1/Math.max(r,1);
  for (var k = 0; k < t; k++) {
    var rr = r-k; if (rr <= 0) break;
    for (var a = 0; a < 6.2832; a += step) {
      var bin = (a*binsOver2pi)|0;
      if (bin >= bins) bin = bins-1;
      var nr = rr*table[bin];
      var px = icx+Math.round(Math.cos(a)*nr);
      var py = icy+Math.round(Math.sin(a)*nr);
      targetCtx.fillRect(px,py,1,1);
    }
  }
  targetCtx.globalAlpha = 1;
}

export function doBoom(cx, cy) {
  saveHistory();
  state.lastStrokePoints = null;
  var baseR = 200+Math.random()*60;
  var fragCount = 44+Math.floor(Math.random()*16);
  var clearR = baseR*0.32;
  var frags = [];

  for (var i = 0; i < fragCount; i++) {
    var a = Math.random()*6.2832;
    var r = clearR+Math.sqrt(Math.random())*(baseR*0.9-clearR);
    var fcx = cx+Math.cos(a)*r, fcy = cy+Math.sin(a)*r;
    var nv = 4+Math.floor(Math.random()*5);
    var angs = [];
    for (var j = 0; j < nv; j++) angs.push(Math.random()*6.2832);
    angs.sort(function(a,b){return a-b;});
    var fR = baseR*(0.07+Math.random()*0.12);
    var verts = [];
    for (var j = 0; j < angs.length; j++) {
      var vr = fR*(0.5+Math.random()*0.7);
      verts.push({x:fcx+Math.cos(angs[j])*vr, y:fcy+Math.sin(angs[j])*vr});
    }
    var minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (var j = 0; j < verts.length; j++) {
      if (verts[j].x < minX) minX=verts[j].x; if (verts[j].y < minY) minY=verts[j].y;
      if (verts[j].x > maxX) maxX=verts[j].x; if (verts[j].y > maxY) maxY=verts[j].y;
    }
    minX = Math.max(0,Math.floor(minX)); minY = Math.max(0,Math.floor(minY));
    maxX = Math.min(state.canvasW,Math.ceil(maxX)); maxY = Math.min(state.canvasH,Math.ceil(maxY));
    var fw = maxX-minX, fh = maxY-minY;
    if (fw < 2 || fh < 2) continue;
    var dx = fcx-cx, dy = fcy-cy, dist = Math.sqrt(dx*dx+dy*dy)||1;
    var spd = 1.8+(dist/baseR)*5+Math.random()*2.5;
    frags.push({
      verts:verts, cx:fcx, cy:fcy, minX:minX, minY:minY, fw:fw, fh:fh, x:0, y:0,
      vx:(dx/dist)*spd+(Math.random()-0.5)*1.5,
      vy:(dy/dist)*spd+(Math.random()-0.5)*1.5,
      rot:0, rotSpeed:(Math.random()-0.5)*0.06,
      frame:0, maxFrame:22+Math.floor(Math.random()*20), done:false
    });
  }

  for (var i = 0; i < frags.length; i++) {
    var f = frags[i];
    var pw = f.fw*state.DPR, ph = f.fh*state.DPR;
    var fc = document.createElement('canvas'); fc.width = pw; fc.height = ph;
    var fctx = fc.getContext('2d');
    fctx.beginPath();
    fctx.moveTo((f.verts[0].x-f.minX)*state.DPR,(f.verts[0].y-f.minY)*state.DPR);
    for (var j = 1; j < f.verts.length; j++)
      fctx.lineTo((f.verts[j].x-f.minX)*state.DPR,(f.verts[j].y-f.minY)*state.DPR);
    fctx.closePath(); fctx.clip();
    fctx.drawImage(state.canvas,-f.minX*state.DPR,-f.minY*state.DPR);

    var imgData = fctx.getImageData(0,0,pw,ph);
    var src = imgData.data;
    var out = new Uint8ClampedArray(src);
    var bsz = 2, nbx = Math.floor(pw/bsz), nby = Math.floor(ph/bsz);
    var swaps = Math.floor(nbx*nby*0.12);
    for (var s = 0; s < swaps; s++) {
      var ax = Math.floor(Math.random()*nbx)*bsz, ay = Math.floor(Math.random()*nby)*bsz;
      if (out[(ay*pw+ax)*4+3]===0) continue;
      var nx = ax+(Math.floor(Math.random()*9)-4)*bsz, ny = ay+(Math.floor(Math.random()*9)-4)*bsz;
      nx = Math.max(0,Math.min((nbx-1)*bsz,nx)); ny = Math.max(0,Math.min((nby-1)*bsz,ny));
      if (out[(ny*pw+nx)*4+3]===0) continue;
      for (var by = 0; by < bsz; by++) for (var bx3 = 0; bx3 < bsz; bx3++) {
        var ai = ((ay+by)*pw+(ax+bx3))*4, bi = ((ny+by)*pw+(nx+bx3))*4;
        for (var c = 0; c < 4; c++) { var tmp=out[ai+c]; out[ai+c]=out[bi+c]; out[bi+c]=tmp; }
      }
    }
    fctx.putImageData(new ImageData(out,pw,ph),0,0);
    f.img = fc;
  }

  // Clear each fragment's source polygon so the displacement creates the space
  state.ctx.save();
  state.ctx.fillStyle = state.BG_CSS;
  for (var i = 0; i < frags.length; i++) {
    var f = frags[i];
    if (!f.img) continue;
    state.ctx.beginPath();
    state.ctx.moveTo(f.verts[0].x, f.verts[0].y);
    for (var j = 1; j < f.verts.length; j++) state.ctx.lineTo(f.verts[j].x, f.verts[j].y);
    state.ctx.closePath();
    state.ctx.fill();
  }
  state.ctx.restore();
  // Clear center void — no fragments originate here
  var craterStamp = buildJaggedBlobStamp(clearR*1.2, state.BG_CSS, makeNoiseSeed(), 0.20);
  state.ctx.save(); stampDot(state.ctx, cx, cy, craterStamp); state.ctx.restore();

  var frame = 0;
  function animBoom() {
    state.ovCtx.clearRect(0,0,state.canvasW,state.canvasH);
    var alive = false;
    for (var i = 0; i < frags.length; i++) {
      var f = frags[i];
      if (!f.img || f.done) continue;
      f.vx *= 0.88; f.vy *= 0.88;
      f.x += f.vx; f.y += f.vy; f.rot += f.rotSpeed; f.frame++;
      if (f.frame%3===0) {
        var tdx = f.cx+f.x-cx, tdy = f.cy+f.y-cy;
        if (tdx*tdx+tdy*tdy > clearR*clearR) {
          state.ctx.save(); state.ctx.globalAlpha = 0.13;
          state.ctx.translate(f.cx+f.x,f.cy+f.y); state.ctx.rotate(f.rot);
          state.ctx.drawImage(f.img,-(f.cx-f.minX),-(f.cy-f.minY),f.fw,f.fh);
          state.ctx.restore();
        }
      }
      state.ovCtx.save();
      state.ovCtx.translate(f.cx+f.x,f.cy+f.y); state.ovCtx.rotate(f.rot);
      state.ovCtx.drawImage(f.img,-(f.cx-f.minX),-(f.cy-f.minY),f.fw,f.fh);
      state.ovCtx.restore();
      if (f.frame >= f.maxFrame) {
        f.done = true;
        state.ctx.save();
        state.ctx.translate(f.cx+f.x,f.cy+f.y); state.ctx.rotate(f.rot);
        state.ctx.drawImage(f.img,-(f.cx-f.minX),-(f.cy-f.minY),f.fw,f.fh);
        state.ctx.restore();
      } else { alive = true; }
    }
    if (alive && ++frame < 120) requestAnimationFrame(animBoom);
    else state.ovCtx.clearRect(0,0,state.canvasW,state.canvasH);
  }
  animBoom();
}
