import state from '../state.js';

var MIN_WIN_W = 480, MIN_WIN_H = 420;
var AGENT_MODE = new URLSearchParams(location.search).has('agent');

export function blankColsFromEdge(data, w, h, fromRight) {
  var count = 0;
  for (var k = 0; k < w; k++) {
    var x = fromRight ? (w-1-k) : k;
    for (var y = 0; y < h; y++) {
      var i = (y*w+x)*4;
      if (data[i+3] !== 0 && (data[i] !== 255 || data[i+1] !== 255 || data[i+2] !== 255)) return count;
    }
    count++;
  }
  return count;
}

export function blankRowsFromEdge(data, w, h, fromBottom) {
  var count = 0;
  for (var k = 0; k < h; k++) {
    var y = fromBottom ? (h-1-k) : k;
    var rowStart = y*w*4;
    for (var x = 0; x < w; x++) {
      var i = rowStart + x*4;
      if (data[i+3] !== 0 && (data[i] !== 255 || data[i+1] !== 255 || data[i+2] !== 255)) return count;
    }
    count++;
  }
  return count;
}

var miniBrowser = null;
export function updateMiniBrowser() {
  if (!miniBrowser) miniBrowser = document.getElementById('mini-browser');
  var maxW = 220, maxH = 160;
  var ratio = window.innerWidth / window.innerHeight;
  var w, h;
  if (ratio > maxW/maxH) { w = maxW; h = maxW / ratio; }
  else { h = maxH; w = maxH * ratio; }
  miniBrowser.style.width = Math.round(w) + 'px';
  miniBrowser.style.height = Math.round(h) + 'px';
}

export function applyResize() {
  state.resizeTimer = null;
  var tooSmallNow = !AGENT_MODE && (window.innerWidth < MIN_WIN_W || window.innerHeight < MIN_WIN_H);
  var sizeWarning = document.getElementById('size-warning');
  if (tooSmallNow !== state.tooSmall) {
    state.tooSmall = tooSmallNow;
    sizeWarning.classList.toggle('show', state.tooSmall);
  }
  if (state.tooSmall) {
    if (state.canvasW === 0) {
      state.canvasW = MIN_WIN_W; state.canvasH = MIN_WIN_H;
      state.canvas.width = MIN_WIN_W * state.DPR; state.canvas.height = MIN_WIN_H * state.DPR;
      state.canvas.style.width = MIN_WIN_W + 'px'; state.canvas.style.height = MIN_WIN_H + 'px';
      state.ov.width = MIN_WIN_W * state.DPR; state.ov.height = MIN_WIN_H * state.DPR;
      state.ov.style.width = MIN_WIN_W + 'px'; state.ov.style.height = MIN_WIN_H + 'px';
      state.ctx.scale(state.DPR, state.DPR);
      state.ovCtx.scale(state.DPR, state.DPR);
      state.ctx.fillStyle = state.BG_CSS;
      state.ctx.fillRect(0, 0, MIN_WIN_W, MIN_WIN_H);
    }
    return;
  }
  var newW = state.canvasArea.clientWidth, newH = state.canvasArea.clientHeight;
  if (newW <= 0 || newH <= 0) return;
  var oldW = state.canvasW, oldH = state.canvasH;
  if (oldW === newW && oldH === newH) return;
  var hadContent = oldW > 0 && oldH > 0;
  var snap = null;
  if (hadContent) {
    snap = document.createElement('canvas');
    snap.width = oldW * state.DPR; snap.height = oldH * state.DPR;
    var sctx = snap.getContext('2d');
    sctx.imageSmoothingEnabled = false;
    sctx.drawImage(state.canvas, 0, 0);
  }
  state.canvasW = newW; state.canvasH = newH;
  state.canvas.width = newW * state.DPR; state.canvas.height = newH * state.DPR;
  state.canvas.style.width = newW + 'px'; state.canvas.style.height = newH + 'px';
  state.ov.width = newW * state.DPR; state.ov.height = newH * state.DPR;
  state.ov.style.width = newW + 'px'; state.ov.style.height = newH + 'px';
  state.ctx.imageSmoothingEnabled = true;
  state.ctx.imageSmoothingQuality = 'high';
  state.ctx.scale(state.DPR, state.DPR);
  state.ovCtx.imageSmoothingEnabled = true;
  state.ovCtx.imageSmoothingQuality = 'high';
  state.ovCtx.scale(state.DPR, state.DPR);
  state.ctx.globalCompositeOperation = 'source-over';
  state.ctx.fillStyle = state.BG_CSS;
  state.ctx.fillRect(0, 0, newW, newH);
  if (snap) {
    var snapPhysW = oldW * state.DPR, snapPhysH = oldH * state.DPR;
    var cropX = 0, cropY = 0;
    var needX = Math.max(0, (oldW - newW) / 2) * state.DPR;
    var needY = Math.max(0, (oldH - newH) / 2) * state.DPR;
    if (needX > 0 || needY > 0) {
      var snapData = snap.getContext('2d').getImageData(0, 0, snapPhysW, snapPhysH).data;
      if (needX > 0) {
        var maxX = Math.min(blankColsFromEdge(snapData, snapPhysW, snapPhysH, false), blankColsFromEdge(snapData, snapPhysW, snapPhysH, true));
        cropX = Math.floor(Math.min(needX, maxX));
      }
      if (needY > 0) {
        var maxY = Math.min(blankRowsFromEdge(snapData, snapPhysW, snapPhysH, false), blankRowsFromEdge(snapData, snapPhysW, snapPhysH, true));
        cropY = Math.floor(Math.min(needY, maxY));
      }
    }
    var srcW = snapPhysW - 2*cropX, srcH = snapPhysH - 2*cropY;
    var srcWL = srcW / state.DPR, srcHL = srcH / state.DPR;
    var scale = Math.min(newW / srcWL, newH / srcHL);
    if (scale >= 1) {
      var dx = Math.round((newW - srcWL) / 2), dy = Math.round((newH - srcHL) / 2);
      state.ctx.drawImage(snap, cropX, cropY, srcW, srcH, dx, dy, srcWL, srcHL);
    } else {
      var drawW = Math.round(srcWL * scale), drawH = Math.round(srcHL * scale);
      var dx = Math.round((newW - drawW) / 2), dy = Math.round((newH - drawH) / 2);
      state.ctx.drawImage(snap, cropX, cropY, srcW, srcH, dx, dy, drawW, drawH);
    }
  }
}

export function resize() {
  var tooSmallNow = !AGENT_MODE && (window.innerWidth < MIN_WIN_W || window.innerHeight < MIN_WIN_H);
  var sizeWarning = document.getElementById('size-warning');
  if (tooSmallNow !== state.tooSmall) {
    state.tooSmall = tooSmallNow;
    sizeWarning.classList.toggle('show', state.tooSmall);
  }
  state.painting = false;
  updateMiniBrowser();
  state.canvasArea.classList.add('resizing');
  if (state.resizeTimer) clearTimeout(state.resizeTimer);
  state.resizeTimer = setTimeout(function() {
    applyResize();
    state.canvasArea.classList.remove('resizing');
  }, 180);
}
