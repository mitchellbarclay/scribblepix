import state from '../state.js';
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

var DPR = 2; // matches state.DPR

var renderer = null;
var scene = null;
var camera = null;
var cachedW = 0, cachedH = 0;
var primaryMesh = null;
var mirrorMesh = null;

function ensureRenderer() {
  if (renderer) return;

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);

  scene = new THREE.Scene();

  var ambient = new THREE.AmbientLight(0xffffff, 0.42);
  scene.add(ambient);

  var sun = new THREE.DirectionalLight(0xffffff, 1.15);
  sun.position.set(-0.55, 0.70, 1.10).normalize();
  scene.add(sun);

  // Second fill light from the right so it never goes fully dark
  var fill = new THREE.DirectionalLight(0xffffff, 0.28);
  fill.position.set(1, -0.3, 0.6).normalize();
  scene.add(fill);
}

function ensureCamera() {
  var W = state.canvasW, H = state.canvasH;
  if (W === cachedW && H === cachedH && camera) return;
  cachedW = W; cachedH = H;

  // OrthographicCamera(left, right, top, bottom, near, far)
  // top=H, bottom=0 → world y=H is top of viewport, y=0 is bottom.
  // Canvas y=0 (top) → world y = H - 0 = H  ✓
  // Canvas y=H (btm) → world y = H - H = 0  ✓
  camera = new THREE.OrthographicCamera(0, W, H, 0, -500, 500);
  camera.position.set(0, 0, 100);
  camera.lookAt(0, 0, 0);

  renderer.setSize(W * DPR, H * DPR);
}

function hexToColor(hex) {
  return new THREE.Color(
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255
  );
}

function subsample(pts, n) {
  var out = [];
  var step = (pts.length - 1) / (n - 1);
  for (var i = 0; i < n; i++) {
    out.push(pts[Math.round(i * step)]);
  }
  return out;
}

// Builds a THREE.Mesh tube (or sphere for single-point strokes). Returns null if not enough points.
function buildTubeMesh(pts, color, brushSize) {
  var radius = Math.max(2, brushSize * 0.44);
  var col = hexToColor(color);

  var mat = new THREE.MeshPhongMaterial({
    color: col,
    shininess: 82,
    specular: new THREE.Color(0.58, 0.58, 0.58),
    emissive: col.clone().multiplyScalar(0.07),
  });

  if (pts.length < 2) {
    // Single tap — render a sphere
    var geo = new THREE.SphereGeometry(radius, 14, 10);
    var p = pts[0] || { x: 0, y: 0 };
    var H = state.canvasH;
    geo.translate(p.x, H - p.y, 0);
    return new THREE.Mesh(geo, mat);
  }

  // Subsample to cap control-point count for performance
  var sampled = pts.length > 90 ? subsample(pts, 90) : pts;

  var H = state.canvasH;
  var worldPts = [];
  for (var i = 0; i < sampled.length; i++) {
    var p = sampled[i];
    // Spatial z-oscillation — makes the tube undulate in/out of the canvas plane,
    // so the directional light shading dances along the length.
    var z = Math.sin(p.x * 0.068 + p.y * 0.044) * radius * 0.85;
    var v = new THREE.Vector3(p.x, H - p.y, z);
    if (worldPts.length === 0 || v.distanceTo(worldPts[worldPts.length - 1]) > 0.4) {
      worldPts.push(v);
    }
  }

  if (worldPts.length < 2) {
    mat.dispose();
    return null;
  }

  var curve = new THREE.CatmullRomCurve3(worldPts, false, 'catmullrom', 0.5);
  var tubeSeg = Math.max(14, Math.min(worldPts.length * 4, 260));
  var tubeGeo = new THREE.TubeGeometry(curve, tubeSeg, radius, 8, false);

  return new THREE.Mesh(tubeGeo, mat);
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
    primaryMesh = buildTubeMesh(state.threeStroke.pts, state.threeStroke.color, state.threeStroke.brushSize);
    if (primaryMesh) scene.add(primaryMesh);
    state.threeStroke.dirty = false;
    rebuilt = true;
  }

  if (state.mirrorThreeStroke && state.mirrorThreeStroke.dirty) {
    disposeMesh(mirrorMesh);
    mirrorMesh = buildTubeMesh(state.mirrorThreeStroke.pts, state.mirrorThreeStroke.color, state.mirrorThreeStroke.brushSize);
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
    if (Math.hypot(x - last.x, y - last.y) >= 2) {
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
    primaryMesh = buildTubeMesh(state.threeStroke.pts, state.threeStroke.color, state.threeStroke.brushSize);
    if (primaryMesh) { scene.add(primaryMesh); anyMesh = true; }
  }

  if (state.mirrorThreeStroke) {
    disposeMesh(mirrorMesh);
    mirrorMesh = buildTubeMesh(state.mirrorThreeStroke.pts, state.mirrorThreeStroke.color, state.mirrorThreeStroke.brushSize);
    if (mirrorMesh) { scene.add(mirrorMesh); anyMesh = true; }
  }

  if (anyMesh) renderToCtx(state.ctx);

  disposeMesh(primaryMesh); primaryMesh = null;
  disposeMesh(mirrorMesh);  mirrorMesh = null;

  state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
  state.threeStroke = null;
  state.mirrorThreeStroke = null;
}
