// Shared mutable application state. Every module imports this object and
// reads/writes via state.X so ownership is explicit and there are no implicit globals.
const state = {
  // DOM refs — populated by main.js on DOMContentLoaded
  canvas: null,
  ctx: null,
  ov: null,
  ovCtx: null,
  canvasArea: null,

  // Canvas dimensions (logical pixels)
  canvasW: 0,
  canvasH: 0,
  DPR: 2,

  // Background
  BG_CSS: '#ffffff',
  BG: [255, 255, 255],

  // Resize guard
  tooSmall: false,
  resizeTimer: null,

  // Active tool + drawing state
  tool: 'pencil',
  color: '#111111',
  brushSize: 30,
  mirrorMode: false,
  rainbowMode: false,
  rainbowHue: 0,
  fillTolerance: 32,

  // Stroke tracking
  painting: false,
  lastX: 0,
  lastY: 0,
  splatterGateX: null,
  splatterGateY: null,

  // Undo history
  undoSnapshot: null,
  lastStrokePoints: null,
  lastStrokeRadius: 30,
  lastStrokeTool: '',

  // ── Tool-local state ──────────────────────────────────────────────────────

  // Bubble / splatter
  splatterParticles: [],
  splatterAnimId: null,

  // Lightning bolt — each stroke is a self-contained recorded path object
  boltStroke: null,
  boltAnimFrame: null,
  // Mirror copy (bolt)
  mirrorBoltStroke: null,

  // Rectangle
  rectStroke: null,
  rectAnimFrame: null,
  rectSubTool: 'outline',
  rectBouncing: false,

  // Ellipse
  ellipseStroke: null,
  ellipseAnimFrame: null,
  ellipseSubTool: 'outline',
  ellipseBouncing: false,

  // Vine
  vineStroke: null,
  mirrorVineStroke: null,

  // Vine v2 (alt testing tool)
  vineStrokeV2: null,
  mirrorVineStrokeV2: null,
  vineLiveLeaves: [],
  vineAnimFrame: null,

  // Pipes
  pipeStroke: null,
  pipeAnimFrame: null,
  mirrorPipeStroke: null,

  // Flower
  flowerStroke: null,
  mirrorFlowerStroke: null,
  flowerLiveBlossoms: [],
  flowerAnimFrame: null,

  // Fire
  fireDistAcc: 0,
  fireVelX: 0,
  fireVelY: 0,
  fireHasPrev: false,
  firePrevX: 0,
  firePrevY: 0,
  fireAnimFrame: null,
  fireLiveStamps: [],

  // 3D tube brush
  threeStroke: null,
  mirrorThreeStroke: null,
  threeAnimFrame: null,
};

export default state;
