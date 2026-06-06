import state from '../state.js';
import * as THREE from 'three';

var DPR = 2; // matches state.DPR

var renderer = null;
var scene = null;
var camera = null;
var cachedW = 0, cachedH = 0;
var camDist = 0;
var primaryMesh = null;
var mirrorMesh = null;

// Cross-section of the ribbon: a flattened hexagon (faceted, wider than thick).
// Listed CCW. Scaled per-ring by halfW (u) and halfT (v).
var SIDES = 6;
var CS = [];
(function () {
  for (var k = 0; k < SIDES; k++) {
    var a = (k / SIDES) * Math.PI * 2;
    CS.push([Math.cos(a), Math.sin(a)]);
  }
})();

var _tmpQ = new THREE.Quaternion();
var _tmpV = new THREE.Vector3();

function ensureRenderer() {
  if (renderer) return;

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();

  scene.add(new THREE.AmbientLight(0xffffff, 0.40));

  var sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(-0.5, 0.85, 0.95).normalize();
  scene.add(sun);

  // Cool rim light from the lower-right keeps shadowed facets from going muddy.
  var rim = new THREE.DirectionalLight(0x88c0ff, 0.45);
  rim.position.set(0.9, -0.5, 0.4).normalize();
  scene.add(rim);
}

function ensureCamera() {
  var W = state.canvasW, H = state.canvasH;
  if (W === cachedW && H === cachedH && camera) return;
  cachedW = W; cachedH = H;

  // Perspective camera placed so the z=0 plane maps 1:1 to canvas pixels.
  // World y is flipped at point-build time (worldY = H - canvasY), so up = +Y.
  camDist = H * 1.85;
  var fov = 2 * Math.atan((H / 2) / camDist) * 180 / Math.PI;
  camera = new THREE.PerspectiveCamera(fov, W / H, camDist - 400, camDist + 400);
  camera.position.set(W / 2, H / 2, camDist);
  camera.lookAt(W / 2, H / 2, 0);

  renderer.setSize(W * DPR, H * DPR);
}

function hexToColor(hex) {
  return new THREE.Color(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  );
}

function makeMaterial(color) {
  var col = hexToColor(color);
  return new THREE.MeshPhongMaterial({
    color: col,
    shininess: 95,
    specular: new THREE.Color(0.62, 0.62, 0.62),
    emissive: col.clone().multiplyScalar(0.06),
    side: THREE.DoubleSide,
    flatShading: false,
  });
}

// Depth profile — rolling swells (low freq) + finer ripple (high freq) so the
// ribbon dives through the z-axis and the light rakes across its facets.
function zAt(x, y, amp) {
  return amp * (0.62 * Math.sin(x * 0.017 + y * 0.011)
              + 0.38 * Math.sin(x * 0.052 - y * 0.034 + 1.7));
}

// Rotate vector v around unit axis by angle (radians), in place.
function rotateAround(v, axis, angle) {
  _tmpQ.setFromAxisAngle(axis, angle);
  v.applyQuaternion(_tmpQ);
}

// Builds a twisting faceted ribbon mesh from append-only spine points.
// Geometry is built one ring per point (no global resample) so already-laid
// segments never shift as new points arrive.
function buildRibbonMesh(pts, color, brushSize) {
  var radius = Math.max(2.2, brushSize * 0.40);
  var halfW = radius * 1.25;   // ribbon is wider...
  var halfT = radius * 0.46;   // ...than it is thick
  var zAmp = radius * 3.1;
  var twistTurn = Math.max(78, brushSize * 4.2); // px of arc-length per half-turn

  var H = state.canvasH;

  // 1) Build the 3D spine (dedup near-coincident points).
  var P = [];
  for (var i = 0; i < pts.length; i++) {
    var px = pts[i].x, py = pts[i].y;
    var wx = px, wy = H - py, wz = zAt(px, py, zAmp);
    if (P.length === 0 || Math.abs(wx - P[P.length - 1].x) + Math.abs(wy - P[P.length - 1].y) > 0.5) {
      P.push(new THREE.Vector3(wx, wy, wz));
    }
  }

  if (P.length < 2) {
    // Single tap → a faceted gem so it still reads as a solid 3D object.
    var geo = new THREE.IcosahedronGeometry(radius * 1.15, 0);
    var c = P[0] || new THREE.Vector3(pts[0] ? pts[0].x : 0, pts[0] ? H - pts[0].y : 0, 0);
    geo.translate(c.x, c.y, c.z);
    return new THREE.Mesh(geo, makeMaterial(color));
  }

  var n = P.length;

  // 2) Tangents (central difference).
  var T = [];
  for (var i = 0; i < n; i++) {
    var a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    var t = new THREE.Vector3().subVectors(b, a);
    if (t.lengthSq() < 1e-9) t.set(1, 0, 0);
    t.normalize();
    T.push(t);
  }

  // 3) Rotation-minimizing frame: normal N transported along the curve.
  var N = [];
  var up = Math.abs(T[0].z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  var n0 = up.clone().sub(T[0].clone().multiplyScalar(up.dot(T[0]))).normalize();
  N.push(n0);
  for (var i = 1; i < n; i++) {
    var prev = N[i - 1].clone();
    var axis = _tmpV.crossVectors(T[i - 1], T[i]);
    var sl = axis.length();
    if (sl > 1e-6) {
      axis.multiplyScalar(1 / sl);
      var ang = Math.acos(Math.max(-1, Math.min(1, T[i - 1].dot(T[i]))));
      rotateAround(prev, axis, ang);
    }
    // re-orthogonalise against the new tangent
    prev.sub(T[i].clone().multiplyScalar(prev.dot(T[i]))).normalize();
    N.push(prev);
  }

  // 4) Cumulative arc length → drives the intentional twist.
  var arc = [0];
  for (var i = 1; i < n; i++) arc.push(arc[i - 1] + P[i].distanceTo(P[i - 1]));

  // 5) Emit rings.
  var pos = [];
  function pushV(v) { pos.push(v.x, v.y, v.z); return (pos.length / 3) - 1; }

  var ringBase = [];
  var bvec = new THREE.Vector3();
  for (var i = 0; i < n; i++) {
    var twist = (arc[i] / twistTurn) * Math.PI;
    // twisted basis: rotate N around T by `twist` → U; B = T × U
    var Uv = N[i].clone();
    rotateAround(Uv, T[i], twist);
    bvec.crossVectors(T[i], Uv).normalize();
    ringBase.push(pos.length / 3);
    for (var k = 0; k < SIDES; k++) {
      var u = CS[k][0] * halfW, vv = CS[k][1] * halfT;
      _tmpV.copy(P[i])
        .addScaledVector(Uv, u)
        .addScaledVector(bvec, vv);
      pos.push(_tmpV.x, _tmpV.y, _tmpV.z);
    }
  }

  // 6) Indices — side quads.
  var idx = [];
  for (var i = 0; i < n - 1; i++) {
    var a = ringBase[i], b = ringBase[i + 1];
    for (var k = 0; k < SIDES; k++) {
      var k2 = (k + 1) % SIDES;
      idx.push(a + k, b + k, a + k2);
      idx.push(a + k2, b + k, b + k2);
    }
  }

  // 7) End caps (fan from each end-ring centroid) so the ribbon looks solid.
  function cap(ringStart, flip) {
    var cx = 0, cy = 0, cz = 0;
    for (var k = 0; k < SIDES; k++) {
      cx += pos[(ringStart + k) * 3];
      cy += pos[(ringStart + k) * 3 + 1];
      cz += pos[(ringStart + k) * 3 + 2];
    }
    var ci = pushV(_tmpV.set(cx / SIDES, cy / SIDES, cz / SIDES));
    for (var k = 0; k < SIDES; k++) {
      var k2 = (k + 1) % SIDES;
      if (flip) idx.push(ci, ringStart + k2, ringStart + k);
      else idx.push(ci, ringStart + k, ringStart + k2);
    }
  }
  cap(ringBase[0], true);
  cap(ringBase[n - 1], false);

  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  return new THREE.Mesh(geo, makeMaterial(color));
}

function disposeMesh(mesh) {
  if (!mesh) return;
  scene.remove(mesh);
  if (mesh.geometry) mesh.geometry.dispose();
  if (mesh.material) mesh.material.dispose();
}

function renderToCtx(ctx) {
  renderer.render(scene, camera);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(renderer.domElement, 0, 0, state.canvasW, state.canvasH);
  ctx.restore();
}

function threeOverlayFrame() {
  if (!state.threeStroke && !state.mirrorThreeStroke) {
    state.threeAnimFrame = null;
    return;
  }

  ensureCamera();
  var rebuilt = false;

  if (state.threeStroke && state.threeStroke.dirty) {
    disposeMesh(primaryMesh);
    primaryMesh = buildRibbonMesh(state.threeStroke.pts, state.threeStroke.color, state.threeStroke.brushSize);
    if (primaryMesh) scene.add(primaryMesh);
    state.threeStroke.dirty = false;
    rebuilt = true;
  }

  if (state.mirrorThreeStroke && state.mirrorThreeStroke.dirty) {
    disposeMesh(mirrorMesh);
    mirrorMesh = buildRibbonMesh(state.mirrorThreeStroke.pts, state.mirrorThreeStroke.color, state.mirrorThreeStroke.brushSize);
    if (mirrorMesh) scene.add(mirrorMesh);
    state.mirrorThreeStroke.dirty = false;
    rebuilt = true;
  }

  if (rebuilt) {
    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
    if (primaryMesh || mirrorMesh) renderToCtx(state.ovCtx);
  }

  state.threeAnimFrame = requestAnimationFrame(threeOverlayFrame);
}

export function drawThreeStroke(x, y, color) {
  ensureRenderer();

  if (!state.threeStroke) {
    state.threeStroke = {
      pts: [{ x: x, y: y }],
      color: color,
      brushSize: state.brushSize,
      dirty: true,
    };
  } else {
    var last = state.threeStroke.pts[state.threeStroke.pts.length - 1];
    // Append-only spine with a fixed min spacing → committed segments are frozen.
    if (Math.hypot(x - last.x, y - last.y) >= 6) {
      state.threeStroke.pts.push({ x: x, y: y });
      state.threeStroke.dirty = true;
    }
  }

  if (!state.threeAnimFrame) {
    state.threeAnimFrame = requestAnimationFrame(threeOverlayFrame);
  }
}

export function finalizeThreeStroke() {
  if (!state.threeStroke && !state.mirrorThreeStroke) return;

  if (state.threeAnimFrame) {
    cancelAnimationFrame(state.threeAnimFrame);
    state.threeAnimFrame = null;
  }

  ensureRenderer();
  ensureCamera();

  var anyMesh = false;

  if (state.threeStroke) {
    disposeMesh(primaryMesh);
    primaryMesh = buildRibbonMesh(state.threeStroke.pts, state.threeStroke.color, state.threeStroke.brushSize);
    if (primaryMesh) { scene.add(primaryMesh); anyMesh = true; }
  }

  if (state.mirrorThreeStroke) {
    disposeMesh(mirrorMesh);
    mirrorMesh = buildRibbonMesh(state.mirrorThreeStroke.pts, state.mirrorThreeStroke.color, state.mirrorThreeStroke.brushSize);
    if (mirrorMesh) { scene.add(mirrorMesh); anyMesh = true; }
  }

  if (anyMesh) renderToCtx(state.ctx);

  disposeMesh(primaryMesh); primaryMesh = null;
  disposeMesh(mirrorMesh);  mirrorMesh = null;

  state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
  state.threeStroke = null;
  state.mirrorThreeStroke = null;
}
