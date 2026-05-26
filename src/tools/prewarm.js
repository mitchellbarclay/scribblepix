import state from '../state.js';
import { getBrushStamp, getEraserStamp } from '../core/brush-pipeline.js';

export function warmupTools() {
  var ctx = state.ctx, ovCtx = state.ovCtx;
  if (!ctx || !ovCtx) return;

  var r = Math.max(1, Math.round(state.brushSize / 2));

  // Pre-populate the stamp cache so the first real stroke doesn't create them
  getBrushStamp(r, state.color);
  getEraserStamp(r);

  // Invisible draw pass on both contexts — forces the browser to warm up the
  // GPU compositing pipelines (texture upload, gradient shader, shadow filter,
  // clip path) so the first real user stroke doesn't pay the cold-start cost.
  [ctx, ovCtx].forEach(function(c) {
    c.save();
    c.globalAlpha = 0;

    // drawImage (pencil, eraser)
    c.drawImage(getBrushStamp(r, state.color), 0, 0);

    // Linear gradient + fill (fire)
    var lg = c.createLinearGradient(0, 0, 0, 4);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = lg; c.fillRect(0, 0, 1, 1);

    // Radial gradient + clip + fill (bubble)
    var rg = c.createRadialGradient(0, 0, 0, 0, 0, 4);
    rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = rg;
    c.save(); c.beginPath(); c.arc(2, 2, 2, 0, Math.PI * 2); c.clip();
    c.fillRect(0, 0, 4, 4); c.restore();

    // Shadow stroke (bolt)
    c.shadowBlur = 10; c.shadowColor = '#000';
    c.beginPath(); c.moveTo(0, 0); c.lineTo(1, 1); c.stroke();
    c.shadowBlur = 0;

    c.restore();
  });
}
