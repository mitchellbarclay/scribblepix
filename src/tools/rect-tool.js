import state from '../state.js';

var RECT_STATE_DURATION = 800;

// Squash-and-settle played when a rect/ellipse is released. The shape dips
// slightly inward (anticipation), springs back out a touch past its final size,
// then lands exactly on it. Scaling is about the shape's centre so the motion is
// symmetric. (The previous version scaled from one corner and only dipped ~3%
// inward with no overshoot, so it read as a lopsided flinch rather than a
// settle.) Shared by both the rect and ellipse tools — pass the per-tool draw
// function and the state keys it uses for its rAF handle / bouncing flag.
var SETTLE_MS = 420;     // total settle duration
var SETTLE_AMP = 0.012;  // peak scale deviation — barely-there settle (~0.7% in, ~0.3% out)
var SETTLE_DECAY = 2;    // how fast the oscillation damps
var SETTLE_FREQ = Math.PI * 2; // one full cycle: in → out → rest (sin(2π)=0 lands clean)

export function settleShape(drawFn, x1, y1, x2, y2, st, col, pat, frameKey, flagKey) {
  state[flagKey] = true;
  var cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  var hw = (x2 - x1) / 2, hh = (y2 - y1) / 2;
  var mcx = state.mirrorMode ? state.canvasW - cx : null;
  var startTime = performance.now();
  function frame() {
    var t = Math.min(1, (performance.now() - startTime) / SETTLE_MS);
    var s = 1 - SETTLE_AMP * Math.exp(-SETTLE_DECAY * t) * Math.sin(t * SETTLE_FREQ);
    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
    drawFn(state.ovCtx, cx - hw * s, cy - hh * s, cx + hw * s, cy + hh * s, st, col, pat);
    if (mcx !== null) drawFn(state.ovCtx, mcx - hw * s, cy - hh * s, mcx + hw * s, cy + hh * s, st, col, pat);
    if (t < 1) {
      state[frameKey] = requestAnimationFrame(frame);
    } else {
      drawFn(state.ctx, cx - hw, cy - hh, cx + hw, cy + hh, st, col, pat);
      if (mcx !== null) drawFn(state.ctx, mcx - hw, cy - hh, mcx + hw, cy + hh, st, col, pat);
      state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
      state[frameKey] = null; state[flagKey] = false;
    }
  }
  state[frameKey] = requestAnimationFrame(frame);
}

export function makeRectPattern(col, patternScale) {
  var sc = Math.max(0.4, Math.min(5, patternScale || 1));
  var types = ['stripes','dots','crosshatch','checker','wavylines','hexagons','chevron','brick','fishscales','diamonds'];
  var p = {type: types[Math.floor(Math.random()*types.length)], col: col};
  if (p.type === 'stripes') {
    p.sz = Math.round((16+Math.floor(Math.random()*16))*sc);
    p.lw = sc*(1+Math.random()*2.5);
    p.angle = (20+Math.random()*70)*Math.PI/180;
    p.sGap = p.sz*(0.25+Math.random()*0.35);
  } else if (p.type === 'dots') {
    var dSp = Math.round((12+Math.floor(Math.random()*12))*sc);
    p.dR = dSp*(0.18+Math.random()*0.16); p.dtW = dSp*2; p.dtH = Math.round(dSp*Math.sqrt(3));
  } else if (p.type === 'crosshatch') {
    p.chSz = Math.round((18+Math.floor(Math.random()*12))*sc);
    p.lw = sc*(1+Math.random()*1.5);
    p.chGap = p.chSz/Math.max(2,Math.round(1/(0.28+Math.random()*0.24)));
  } else if (p.type === 'checker') {
    p.ckH = Math.round((10+Math.floor(Math.random()*12))*sc);
  } else if (p.type === 'wavylines') {
    p.wSz = Math.round((24+Math.floor(Math.random()*12))*sc);
    p.wAmp = sc*(3+Math.random()*5); p.lw = sc*(1+Math.random()*2);
    p.wRow = p.wSz/Math.max(2,Math.round(1/(0.25+Math.random()*0.2)));
  } else if (p.type === 'hexagons') {
    p.hexR = Math.round((8+Math.floor(Math.random()*8))*sc);
    p.hexW = p.hexR*Math.sqrt(3)/2; p.lw = sc*1.5;
  } else if (p.type === 'chevron') {
    p.cvW = Math.round((16+Math.floor(Math.random()*16))*sc);
    p.cvH = Math.round(p.cvW*0.5); p.lw = sc*(1.5+Math.random());
  } else if (p.type === 'brick') {
    p.bkW = Math.round((28+Math.floor(Math.random()*16))*sc);
    p.bkH = Math.round(p.bkW*0.38); p.bkPitch = p.bkH+Math.round(2*sc); p.lw = Math.max(1,sc);
  } else if (p.type === 'fishscales') {
    p.fsr = Math.round((10+Math.floor(Math.random()*10))*sc); p.lw = sc*1.5;
  } else {
    p.dd = Math.round((10+Math.floor(Math.random()*10))*sc); p.lw = sc*1.5;
  }
  return p;
}

export function applyPattern(tctx, x, y, w, h, p) {
  tctx.save();
  tctx.strokeStyle = p.col; tctx.fillStyle = p.col;
  if (p.type === 'stripes') {
    tctx.lineWidth = p.lw; tctx.save();
    tctx.translate(x+w/2, y+h/2); tctx.rotate(p.angle);
    var diag = Math.sqrt(w*w+h*h);
    for (var si = -(diag+p.sGap); si <= diag+p.sGap; si += p.sGap) {
      tctx.beginPath(); tctx.moveTo(si,-diag); tctx.lineTo(si,diag); tctx.stroke();
    }
    tctx.restore();
  } else if (p.type === 'dots') {
    for (var row = -1; row <= Math.ceil(h/p.dtH)+1; row++) {
      var dy = y+row*p.dtH;
      var xOff = (Math.abs(row)%2===1) ? p.dtW/2 : 0;
      for (var col = -1; col <= Math.ceil(w/p.dtW)+1; col++) {
        tctx.beginPath(); tctx.arc(x+col*p.dtW+xOff, dy, p.dR, 0, Math.PI*2); tctx.fill();
      }
    }
  } else if (p.type === 'crosshatch') {
    tctx.lineWidth = p.lw;
    var diag = Math.sqrt(w*w+h*h), chcx = x+w/2, chcy = y+h/2;
    tctx.save(); tctx.translate(chcx,chcy); tctx.rotate(Math.PI/4);
    for (var ci = -(diag+p.chGap); ci <= diag+p.chGap; ci += p.chGap) {
      tctx.beginPath(); tctx.moveTo(ci,-diag); tctx.lineTo(ci,diag); tctx.stroke();
    }
    tctx.restore(); tctx.save(); tctx.translate(chcx,chcy); tctx.rotate(-Math.PI/4);
    for (var ci = -(diag+p.chGap); ci <= diag+p.chGap; ci += p.chGap) {
      tctx.beginPath(); tctx.moveTo(ci,-diag); tctx.lineTo(ci,diag); tctx.stroke();
    }
    tctx.restore();
  } else if (p.type === 'checker') {
    var ckH = p.ckH;
    for (var gy = 0; gy <= Math.ceil(h/ckH)+1; gy++)
      for (var gx = 0; gx <= Math.ceil(w/ckH)+1; gx++)
        if ((gx+gy)%2===0) tctx.fillRect(x+gx*ckH, y+gy*ckH, ckH, ckH);
  } else if (p.type === 'wavylines') {
    tctx.lineWidth = p.lw;
    for (var wr = -p.wRow; wr <= h+p.wRow; wr += p.wRow) {
      tctx.beginPath();
      for (var wx = -1; wx <= w+1; wx++) {
        var wy = wr+p.wAmp*Math.sin((wx/p.wSz)*Math.PI*2);
        if (wx===-1) tctx.moveTo(x+wx,y+wy); else tctx.lineTo(x+wx,y+wy);
      }
      tctx.stroke();
    }
  } else if (p.type === 'hexagons') {
    tctx.lineWidth = p.lw;
    for (var hc = -1; hc <= Math.ceil(w/p.hexW)+1; hc++) {
      var hcx = x+hc*p.hexW;
      var hOff = (Math.abs(hc)%2!==0) ? p.hexR*1.5 : 0;
      for (var hr = -1; hr <= Math.ceil(h/(p.hexR*3))+1; hr++) {
        var hcy = y+hr*p.hexR*3+hOff;
        tctx.beginPath();
        for (var hv = 0; hv < 6; hv++) {
          var ha = Math.PI/3*hv-Math.PI/6;
          if (hv===0) tctx.moveTo(hcx+p.hexR*Math.cos(ha),hcy+p.hexR*Math.sin(ha));
          else        tctx.lineTo(hcx+p.hexR*Math.cos(ha),hcy+p.hexR*Math.sin(ha));
        }
        tctx.closePath(); tctx.stroke();
      }
    }
  } else if (p.type === 'chevron') {
    tctx.lineWidth = p.lw;
    for (var cr = -1; cr <= Math.ceil(h/(p.cvH*2))+1; cr++)
      for (var cc = -1; cc <= Math.ceil(w/(p.cvW*2))+1; cc++) {
        var cbx = x+cc*p.cvW*2, cby = y+cr*p.cvH*2;
        tctx.beginPath(); tctx.moveTo(cbx,cby); tctx.lineTo(cbx+p.cvW,cby+p.cvH); tctx.lineTo(cbx+p.cvW*2,cby); tctx.stroke();
        tctx.beginPath(); tctx.moveTo(cbx,cby+p.cvH*2); tctx.lineTo(cbx+p.cvW,cby+p.cvH); tctx.lineTo(cbx+p.cvW*2,cby+p.cvH*2); tctx.stroke();
      }
  } else if (p.type === 'brick') {
    tctx.lineWidth = p.lw;
    for (var br = -1; br <= Math.ceil(h/p.bkPitch)+1; br++) {
      var bby = y+br*p.bkPitch;
      var bxOff = (Math.abs(br)%2!==0) ? p.bkW/2 : 0;
      for (var bc = -2; bc <= Math.ceil(w/p.bkW)+2; bc++)
        tctx.strokeRect(x+bc*p.bkW-bxOff, bby, p.bkW, p.bkH);
    }
  } else if (p.type === 'fishscales') {
    tctx.lineWidth = p.lw;
    for (var fr = -1; fr <= Math.ceil(h/p.fsr)+1; fr++) {
      var fy = y+fr*p.fsr;
      var fxOff = (Math.abs(fr)%2!==0) ? p.fsr : 0;
      for (var fc = -1; fc <= Math.ceil(w/(p.fsr*2))+1; fc++) {
        tctx.beginPath(); tctx.arc(x+fc*p.fsr*2+fxOff, fy, p.fsr, 0, Math.PI); tctx.stroke();
      }
    }
  } else {
    tctx.lineWidth = p.lw;
    var dd = p.dd, dper = dd*2;
    for (var dr = -1; dr <= Math.ceil(h/dper)+1; dr++)
      for (var dc = -1; dc <= Math.ceil(w/dper)+1; dc++) {
        var dpx = x+dc*dper+dd, dpy = y+dr*dper+dd;
        tctx.beginPath(); tctx.moveTo(dpx,dpy-dd); tctx.lineTo(dpx+dd,dpy); tctx.lineTo(dpx,dpy+dd); tctx.lineTo(dpx-dd,dpy); tctx.closePath(); tctx.stroke();
      }
  }
  tctx.restore();
}

export function drawRectOnCtx(targetCtx, x1, y1, x2, y2, st, col, patternCanvas) {
  var rx = Math.min(x1,x2), ry = Math.min(y1,y2);
  var rw = Math.abs(x2-x1), rh = Math.abs(y2-y1);
  if (rw < 1 || rh < 1) return;
  var lw = Math.max(1, state.brushSize*0.2), R = 5;
  targetCtx.save(); targetCtx.lineWidth = lw; targetCtx.strokeStyle = col;
  if (st === 0) {
    targetCtx.beginPath(); targetCtx.roundRect(rx,ry,rw,rh,R); targetCtx.stroke();
  } else if (st === 1) {
    targetCtx.beginPath(); targetCtx.roundRect(rx,ry,rw,rh,R); targetCtx.fillStyle = col; targetCtx.fill();
    targetCtx.beginPath(); targetCtx.roundRect(rx,ry,rw,rh,R); targetCtx.stroke();
  } else {
    if (patternCanvas) {
      targetCtx.save(); targetCtx.beginPath(); targetCtx.roundRect(rx,ry,rw,rh,R); targetCtx.clip();
      applyPattern(targetCtx, rx, ry, rw, rh, patternCanvas);
      targetCtx.restore();
    }
    targetCtx.beginPath(); targetCtx.roundRect(rx,ry,rw,rh,R); targetCtx.stroke();
  }
  targetCtx.restore();
}

function rectStateFromSubTool() {
  return state.rectSubTool === 'outline' ? 0 : state.rectSubTool === 'filled' ? 1 : 2;
}

function rectOverlayFrame() {
  if (!state.rectStroke) return;
  var rs = state.rectStroke;
  var st = rectStateFromSubTool();
  if (st === 2) {
    var cycle = Math.floor((performance.now()-rs.startTime)/RECT_STATE_DURATION);
    if (cycle !== rs.lastCycle) { rs.patternCanvas = makeRectPattern(rs.col, state.brushSize/20); rs.lastCycle = cycle; }
  }
  state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
  drawRectOnCtx(state.ovCtx, rs.x1, rs.y1, rs.x2, rs.y2, st, rs.col, rs.patternCanvas);
  if (state.mirrorMode) drawRectOnCtx(state.ovCtx, state.canvasW-rs.x1, rs.y1, state.canvasW-rs.x2, rs.y2, st, rs.col, rs.patternCanvas);
  state.rectAnimFrame = requestAnimationFrame(rectOverlayFrame);
}

export function drawRectStroke(x, y, col) {
  if (!state.rectStroke) {
    var c = col || state.color;
    state.rectStroke = {
      x1: state.lastX, y1: state.lastY, x2: x, y2: y, col: c,
      startTime: performance.now(), lastCycle: -1,
      patternCanvas: state.rectSubTool === 'pattern' ? makeRectPattern(c, state.brushSize/20) : null
    };
    state.rectAnimFrame = requestAnimationFrame(rectOverlayFrame);
  }
  state.rectStroke.x2 = x;
  state.rectStroke.y2 = y;
  state.rectStroke.col = col || state.color;
}

export function finalizeRectStroke() {
  if (!state.rectStroke) return;
  var rs = state.rectStroke;
  var st = rectStateFromSubTool();
  var x1 = rs.x1, y1 = rs.y1, x2 = rs.x2, y2 = rs.y2;
  var col = rs.col, pat = rs.patternCanvas;
  if (state.rectAnimFrame) { cancelAnimationFrame(state.rectAnimFrame); state.rectAnimFrame = null; }
  state.rectStroke = null;
  settleShape(drawRectOnCtx, x1, y1, x2, y2, st, col, pat, 'rectAnimFrame', 'rectBouncing');
}

export function cancelRectStroke() {
  if (!state.rectStroke) return;
  if (state.rectAnimFrame) { cancelAnimationFrame(state.rectAnimFrame); state.rectAnimFrame = null; }
  state.rectStroke = null;
  state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
}
