// Pure flood-fill scan shared by the fill worker and the synchronous fallback
// in fill.js. Flattens semi-transparent pixels (eraser leaves destination-out
// holes) against the background colour, BFS-fills from (sx, sy) writing the
// fill colour directly into `data`, and reports the touched bounding box plus
// the farthest filled pixel's distance from the reveal origin.
//
// All coordinates are physical pixels. Runs in both window and worker
// contexts, so it must not touch state.js or the DOM.

// Scratch buffers reused across fills — at DPR 2 a full-canvas fill needs
// several bytes per physical pixel of working space; reallocating tens of MB
// on every fill caused an alloc/GC spike right at the drop moment.
var _vis = null, _queue = null, _n = 0;

export function fillScan(data, w, h, sx, sy, tol, fill, bg) {
  var bgR = bg[0], bgG = bg[1], bgB = bg[2];
  for (var fi = 3; fi < data.length; fi += 4) {
    if (data[fi] < 255) {
      var a = data[fi]/255;
      data[fi-3] = (data[fi-3]*a + bgR*(1-a) + 0.5)|0;
      data[fi-2] = (data[fi-2]*a + bgG*(1-a) + 0.5)|0;
      data[fi-1] = (data[fi-1]*a + bgB*(1-a) + 0.5)|0;
      data[fi] = 255;
    }
  }

  var p0 = sy*w + sx, idx0 = p0*4;
  var tr = data[idx0], tg = data[idx0+1], tb = data[idx0+2], ta = data[idx0+3];
  var fr = fill[0], fg = fill[1], fb = fill[2];

  var n = w*h;
  if (_n !== n) { _n = n; _vis = new Uint8Array(n); _queue = new Int32Array(n); }
  else _vis.fill(0);
  var vis = _vis, queue = _queue;
  var qHead = 0, qTail = 0;
  queue[qTail++] = p0; vis[p0] = 1;

  // Reveal origin sits slightly below the seed (matches the paint-drip landing)
  var cx = sx, cy = Math.min(h-1, sy+30);
  var count = 0, maxDistSq = 0;
  var minX = w, maxX = -1, minY = h, maxY = -1;

  // Matched pixels are overwritten as they are dequeued; unvisited neighbours
  // are always compared against their original values because only dequeued
  // (and therefore vis-marked) pixels ever get written.
  while (qHead < qTail) {
    var p = queue[qHead++];
    var i = p*4;
    if (Math.abs(data[i]-tr)>tol || Math.abs(data[i+1]-tg)>tol || Math.abs(data[i+2]-tb)>tol || Math.abs(data[i+3]-ta)>tol) continue;
    data[i] = fr; data[i+1] = fg; data[i+2] = fb; data[i+3] = 255;
    count++;
    var px = p%w, py = (p-px)/w;
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
    var dx = px-cx, dy = py-cy;
    var dsq = dx*dx + dy*dy;
    if (dsq > maxDistSq) maxDistSq = dsq;
    if (px+1 < w) { var q1 = p+1; if (!vis[q1]) { vis[q1]=1; queue[qTail++]=q1; } }
    if (px > 0)   { var q2 = p-1; if (!vis[q2]) { vis[q2]=1; queue[qTail++]=q2; } }
    if (py+1 < h) { var q3 = p+w; if (!vis[q3]) { vis[q3]=1; queue[qTail++]=q3; } }
    if (py > 0)   { var q4 = p-w; if (!vis[q4]) { vis[q4]=1; queue[qTail++]=q4; } }
  }

  return { count: count, minX: minX, minY: minY, maxX: maxX, maxY: maxY, maxDist: Math.sqrt(maxDistSq) };
}
