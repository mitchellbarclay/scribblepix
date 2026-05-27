import state from '../state.js';
import { getBrushStamp, getEraserStamp, stampLine } from '../core/brush-pipeline.js';
import { drawSplatterStroke } from './bubble-brush.js';
import { drawBoltStroke } from './bolt-brush.js';
import { drawVineStrokeV2 } from './vine-brush-v2.js';
import { drawFlowerStroke } from './flower-brush.js';
import { drawPipeStroke } from './pipes-brush.js';
import { drawFireStroke } from './fire-brush.js';
import { drawRectStroke } from './rect-tool.js';
import { drawEllipseStroke } from './ellipse-tool.js';

export function currentColor() {
  if (state.rainbowMode) { state.rainbowHue = (state.rainbowHue+3)%360; return 'hsl('+state.rainbowHue+',100%,50%)'; }
  return state.color;
}

export function getPos(e) {
  var r = state.canvas.getBoundingClientRect();
  var s = e.touches ? e.touches[0] : e;
  return [s.clientX-r.left, s.clientY-r.top];
}

export function drawStroke(x, y) {
  state.ctx.globalCompositeOperation = 'source-over'; state.ctx.globalAlpha = 1;
  var c = currentColor();
  var r = state.brushSize/2;
  if (state.tool === 'pencil') {
    var st = getBrushStamp(r, c);
    stampLine(state.ctx, state.lastX, state.lastY, x, y, st);
    if (state.mirrorMode) stampLine(state.ctx, state.canvasW-state.lastX, state.lastY, state.canvasW-x, y, st);
  } else if (state.tool === 'splatter') {
    drawSplatterStroke(x, y);
  } else if (state.tool === 'eraser') {
    state.ctx.globalCompositeOperation = 'destination-out';
    var es = getEraserStamp(state.brushSize/2);
    stampLine(state.ctx, state.lastX, state.lastY, x, y, es);
    if (state.mirrorMode) stampLine(state.ctx, state.canvasW-state.lastX, state.lastY, state.canvasW-x, y, es);
    state.ctx.globalCompositeOperation = 'source-over';
  } else if (state.tool === 'fire') {
    drawFireStroke(x, y);
  } else if (state.tool === 'bolt') {
    drawBoltStroke(x, y, c);
    if (state.mirrorMode) {
      var _savLastX=state.lastX, _savBS=state.boltStroke, _savPA=state.boltPtsA, _savPB=state.boltPtsB, _savMS=state.boltMorphStart, _savBC=state.boltCommits;
      state.lastX=state.canvasW-_savLastX; state.boltStroke=state.mirrorBoltStroke; state.boltPtsA=state.mirrorBoltPtsA; state.boltPtsB=state.mirrorBoltPtsB; state.boltMorphStart=state.mirrorBoltMorphStart; state.boltCommits=state.mirrorBoltCommits;
      drawBoltStroke(state.canvasW-x, y, c);
      state.mirrorBoltStroke=state.boltStroke; state.mirrorBoltPtsA=state.boltPtsA; state.mirrorBoltPtsB=state.boltPtsB; state.mirrorBoltMorphStart=state.boltMorphStart; state.mirrorBoltCommits=state.boltCommits;
      state.lastX=_savLastX; state.boltStroke=_savBS; state.boltPtsA=_savPA; state.boltPtsB=_savPB; state.boltMorphStart=_savMS; state.boltCommits=_savBC;
    }
  } else if (state.tool === 'vine') {
    drawVineStrokeV2(x, y, c);
    if (state.mirrorMode) {
      var _savLastX=state.lastX, _savV2=state.vineStrokeV2;
      state.lastX=state.canvasW-_savLastX; state.vineStrokeV2=state.mirrorVineStrokeV2;
      drawVineStrokeV2(state.canvasW-x, y, c);
      state.mirrorVineStrokeV2=state.vineStrokeV2; state.vineStrokeV2=_savV2; state.lastX=_savLastX;
    }
  } else if (state.tool === 'flower') {
    drawFlowerStroke(x, y, c);
    if (state.mirrorMode) {
      var _savLastX=state.lastX, _savFS=state.flowerStroke;
      state.lastX=state.canvasW-_savLastX; state.flowerStroke=state.mirrorFlowerStroke;
      drawFlowerStroke(state.canvasW-x, y, c);
      state.mirrorFlowerStroke=state.flowerStroke; state.flowerStroke=_savFS; state.lastX=_savLastX;
    }
  } else if (state.tool === 'pipe') {
    drawPipeStroke(x, y, c);
    if (state.mirrorMode) {
      var _savLastX=state.lastX, _savPS=state.pipeStroke;
      state.lastX=state.canvasW-_savLastX; state.pipeStroke=state.mirrorPipeStroke;
      drawPipeStroke(state.canvasW-x, y, c);
      state.mirrorPipeStroke=state.pipeStroke; state.pipeStroke=_savPS; state.lastX=_savLastX;
    }
  } else if (state.tool === 'rect') {
    drawRectStroke(x, y, c);
  } else if (state.tool === 'ellipse') {
    drawEllipseStroke(x, y, c);
  }
}
