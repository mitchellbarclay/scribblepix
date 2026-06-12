// Module worker that runs the flood-fill scan off the main thread.
// The pixel buffer is transferred in (zero-copy), mutated by fillScan, and
// transferred back with the fill metadata. fill.js owns the protocol.
import { fillScan } from './fill-scan.js';

self.onmessage = function(e) {
  var d = e.data;
  var data = new Uint8ClampedArray(d.buffer);
  var res = fillScan(data, d.w, d.h, d.sx, d.sy, d.tol, d.fill, d.bg);
  res.buffer = d.buffer;
  self.postMessage(res, [d.buffer]);
};
