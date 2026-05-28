import state from '../state.js';
import { hslToRgb, hexToRgb } from '../core/color-utils.js';
import { getBrushStamp, stampDot } from '../core/brush-pipeline.js';
import { saveHistory } from '../core/history.js';
import { bucketPour } from '../core/fill.js';
import { doBoom } from '../tools/explosion.js';

// ---- Undo tool ----

var undoBusy = false;
var undoTriggerInput = null;

function fireUndo() {
  if (undoBusy || !state.undoSnapshot) { return; }
  if (state.undoSnapshot.width !== state.canvas.width || state.undoSnapshot.height !== state.canvas.height) { return; }
  undoBusy = true;
  if (undoTriggerInput) undoTriggerInput.trigger();

  var pts = state.lastStrokePoints;
  var snap = document.createElement('canvas');
  snap.width = state.canvas.width; snap.height = state.canvas.height;
  snap.getContext('2d').putImageData(state.undoSnapshot, 0, 0);
  var current = state.ctx.getImageData(0, 0, state.canvas.width, state.canvas.height);
  var snapCSSW = state.canvasW, snapCSSH = state.canvasH;
  function commit() {
    state.ctx.putImageData(state.undoSnapshot, 0, 0);
    state.undoSnapshot = current;
  }

  var sparkleOrigins = [];
  if (pts && pts.length >= 2) {
    var step = Math.max(1, Math.floor(pts.length/40));
    for (var i = 0; i < pts.length; i += step) sparkleOrigins.push(pts[i]);
    if (sparkleOrigins[sparkleOrigins.length-1] !== pts[pts.length-1])
      sparkleOrigins.push(pts[pts.length-1]);
  } else {
    sparkleOrigins.push({x: state.canvasW/2, y: state.canvasH/2});
  }

  var particles = [];
  var COUNT = Math.min(60, sparkleOrigins.length*3);
  for (var i = 0; i < COUNT; i++) {
    var o = sparkleOrigins[Math.floor(Math.random()*sparkleOrigins.length)];
    var angle = Math.random()*Math.PI*2;
    var speed = 0.4+Math.random()*1.2;
    particles.push({
      x: o.x+(Math.random()-0.5)*8, y: o.y+(Math.random()-0.5)*8,
      vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed,
      r: 1.5+Math.random()*2.5, delay: Math.random()*0.4, life: 0
    });
  }

  var duration = 360, startTime = performance.now();
  function frame() {
    try {
      var now = performance.now();
      var t = Math.min(1, (now-startTime)/duration);
      var e = t < 0.5 ? 2*t*t : 1-Math.pow(-2*t+2, 2)/2;
      state.ctx.putImageData(current, 0, 0);
      state.ctx.save(); state.ctx.globalAlpha = e;
      state.ctx.drawImage(snap, 0, 0, snapCSSW, snapCSSH);
      state.ctx.restore();
      state.ovCtx.clearRect(0, 0, snapCSSW, snapCSSH);
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        if (t < p.delay) continue;
        p.life += 0.045; p.x += p.vx; p.y += p.vy;
        var alpha = Math.max(0, Math.sin(Math.min(p.life, 1)*Math.PI)) * (1-e);
        if (alpha <= 0) continue;
        state.ovCtx.save(); state.ovCtx.globalAlpha = alpha*0.85;
        state.ovCtx.fillStyle = state.color;
        state.ovCtx.beginPath(); state.ovCtx.arc(p.x, p.y, p.r, 0, Math.PI*2); state.ovCtx.fill();
        state.ovCtx.restore();
      }
      if (t < 1) requestAnimationFrame(frame);
      else {
        state.ovCtx.clearRect(0, 0, snapCSSW, snapCSSH);
        commit();
        setTimeout(function() { undoBusy = false; }, 180);
      }
    } catch(err) {
      console.error('undo frame error:', err);
      commit();
      undoBusy = false;
    }
  }
  frame();
}

function makeUndoTool() {
  var btn = document.getElementById('undo-btn');
  var iconEl = btn.querySelector('.drag-item-icon');
  var pressed = false, startX = 0, startY = 0;

  if (window.rive) {
    var r = new window.rive.Rive({
      src: 'src/rive/drag_tools.riv',
      canvas: document.getElementById('undo-canvas'),
      artboard: 'Undo',
      stateMachines: 'State Machine 1',
      autoplay: true,
      layout: new window.rive.Layout({ fit: window.rive.Fit.Contain, alignment: window.rive.Alignment.Center }),
      onLoad: function() {
        var vm = r.viewModelByName('DragToolsVM');
        if (vm) {
          var inst = vm.defaultInstance();
          r.bindViewModelInstance(inst);
          undoTriggerInput = inst.trigger('undo');
        }
      }
    });
  }

  function applyStretch(dx, dy) {
    var dist = Math.hypot(dx, dy);
    if (dist < 0.5) { iconEl.style.transform = ''; return; }
    var MAX = 42;
    var damped = MAX*(1-Math.exp(-dist/55));
    var amt = damped/MAX;
    var ux = dx/dist, uy = dy/dist;
    var tx = ux*damped*0.55, ty = uy*damped*0.55;
    var stretch = 1+amt*0.30, squash = 1-amt*0.15;
    var angDeg = Math.atan2(dy, dx)*180/Math.PI;
    iconEl.style.transform =
      'translate('+tx.toFixed(2)+'px,'+ty.toFixed(2)+'px) '+
      'rotate('+angDeg.toFixed(2)+'deg) '+
      'scale('+stretch.toFixed(3)+','+squash.toFixed(3)+') '+
      'rotate('+(-angDeg).toFixed(2)+'deg)';
  }

  function recoilAndFire() {
    iconEl.style.transition = 'transform 0.46s cubic-bezier(0.34, 1.56, 0.64, 1)';
    iconEl.style.transform = '';
    var done = false;
    function clearTransition() {
      if (done) return; done = true;
      iconEl.removeEventListener('transitionend', clearTransition);
      iconEl.style.transition = '';
    }
    iconEl.addEventListener('transitionend', clearTransition);
    setTimeout(clearTransition, 520);
    fireUndo();
  }

  function startDrag(cx, cy) { pressed = true; startX = cx; startY = cy; iconEl.style.transition = ''; }
  function moveDrag(cx, cy) { if (!pressed) return; applyStretch(cx-startX, cy-startY); }
  function endDrag() { if (!pressed) return; pressed = false; recoilAndFire(); }

  btn.addEventListener('mousedown', function(e) { e.preventDefault(); startDrag(e.clientX, e.clientY); });
  btn.addEventListener('touchstart', function(e) { e.preventDefault(); startDrag(e.touches[0].clientX, e.touches[0].clientY); }, {passive: false});

  return {move: moveDrag, end: endDrag};
}

// ---- Generic drag tool factory ----

export function makeDragTool(btnId, onDrop, options) {
  options = options || {};
  var btn = document.getElementById(btnId);
  var iconEl = btn.querySelector('.drag-item-icon');
  var dragging = false, ghost = null, grabDX = 0, grabDY = 0;
  var pressX = 0, pressY = 0, passedThreshold = false;
  var locked = false;

  function playAnim(cls) {
    btn.classList.remove('anim-press', 'anim-release', 'anim-wiggle');
    void btn.offsetWidth;
    btn.classList.add(cls);
  }
  function isOutsideDock(cx, cy) {
    var shelf = document.getElementById('drag-shelf');
    if (!shelf) return true;
    var r = shelf.getBoundingClientRect();
    return cx < r.left || cx > r.right || cy < r.top || cy > r.bottom;
  }
  function homeCenter() {
    var r = iconEl.getBoundingClientRect();
    return {x: r.left+r.width/2, y: r.top+r.height/2};
  }
  function start(cx, cy) {
    if (locked) return;
    locked = true;
    dragging = true; passedThreshold = false;
    pressX = cx; pressY = cy;
    var home = homeCenter();
    grabDX = cx-home.x; grabDY = cy-home.y;
    ghost = iconEl.cloneNode(true);
    ghost.classList.add('drag-ghost-icon');
    ghost.style.left = home.x + 'px'; ghost.style.top = home.y + 'px';
    document.body.appendChild(ghost);
    iconEl.style.visibility = 'hidden';
    playAnim('anim-press');
    if (options.onStart) options.onStart(ghost);
    move(cx, cy);
  }
  function move(cx, cy) {
    if (!dragging || !ghost) return;
    if (!passedThreshold && isOutsideDock(cx, cy)) {
      passedThreshold = true;
      ghost.classList.add('pulled-out');
    }
    ghost.style.left = (cx-grabDX) + 'px';
    ghost.style.top = (cy-grabDY) + 'px';
  }
  function showDragHint() {
    var atTop = (document.getElementById('drag-shelf').getAttribute('data-dock-pos') === 'top');
    var iconR = iconEl.getBoundingClientRect();
    var arrow = document.createElement('span');
    arrow.className = 'drag-hint-arrow ' + (atTop ? 'dir-down' : 'dir-up');
    arrow.textContent = atTop ? 'arrow_downward' : 'arrow_upward';
    arrow.style.left = (iconR.left+iconR.width/2) + 'px';
    arrow.style.top = (atTop ? (iconR.bottom+4) : (iconR.top-4)) + 'px';
    document.body.appendChild(arrow);
    setTimeout(function() { arrow.remove(); }, 880);
  }
  function end(cx, cy) {
    if (!dragging) return;
    dragging = false;
    var r = state.canvasArea.getBoundingClientRect(), x = cx-r.left, y = cy-r.top;
    var inCanvas = x >= 0 && x <= state.canvasW && y >= 0 && y <= state.canvasH;
    var g = ghost; ghost = null;
    var wasCancelled = !passedThreshold;
    function returnHome() {
      g.style.transition = '';
      var home = homeCenter();
      g.classList.add('returning');
      g.style.left = home.x + 'px'; g.style.top = home.y + 'px';
      g.style.transform = 'translate(-50%,-50%) rotate(0deg)';
      var done = false;
      function finish() {
        if (done) return; done = true;
        g.remove(); iconEl.style.visibility = '';
        playAnim(wasCancelled ? 'anim-wiggle' : 'anim-release');
        locked = false;
      }
      g.addEventListener('transitionend', finish);
      setTimeout(finish, 500);
    }
    if (passedThreshold && (inCanvas || options.alwaysFire)) {
      var result = onDrop(x, y, g);
      if (result && typeof result.then === 'function') { result.then(returnHome); return; }
      returnHome(); return;
    }
    if (wasCancelled) {
      if (options.onCancel) options.onCancel();
      g.remove(); iconEl.style.visibility = '';
      playAnim('anim-wiggle');
      locked = false;
      showDragHint(); return;
    }
    returnHome();
  }

  btn.addEventListener('mousedown', function(e) { e.preventDefault(); start(e.clientX, e.clientY); });
  btn.addEventListener('touchstart', function(e) { e.preventDefault(); start(e.touches[0].clientX, e.touches[0].clientY); }, {passive: false});

  return {move: move, end: end};
}

// ---- Dynamite ----

function hideDynamiteSpark(ghostEl) {
  var paths = ghostEl.querySelectorAll('path');
  [4,5,6,7,8,10].forEach(function(i) { if (paths[i]) paths[i].style.display = 'none'; });
}

function drawFuseSpark(x, y) {
  var time = performance.now();
  var flicker = Math.sin(time*0.05)*0.15+0.85;
  var size = 5+Math.sin(time*0.03)*1.5;
  var grad = state.ovCtx.createRadialGradient(x, y, 0, x, y, size*2.5);
  grad.addColorStop(0, 'rgba(255,240,150,'+(0.95*flicker)+')');
  grad.addColorStop(0.3, 'rgba(255,150,30,'+(0.7*flicker)+')');
  grad.addColorStop(0.7, 'rgba(255,80,30,'+(0.4*flicker)+')');
  grad.addColorStop(1, 'rgba(255,80,30,0)');
  state.ovCtx.fillStyle = grad;
  state.ovCtx.beginPath(); state.ovCtx.arc(x, y, size*2.5, 0, Math.PI*2); state.ovCtx.fill();
  state.ovCtx.fillStyle = 'rgba(255,255,240,'+flicker+')';
  state.ovCtx.beginPath(); state.ovCtx.arc(x, y, size*0.5, 0, Math.PI*2); state.ovCtx.fill();
  for (var i = 0; i < 4; i++) {
    var angle = Math.random()*Math.PI*2;
    var dist = Math.random()*size*1.5;
    var sx = x+Math.cos(angle)*dist, sy = y+Math.sin(angle)*dist-Math.random()*6;
    state.ovCtx.fillStyle = 'rgba(255,200,80,'+(Math.random()*0.7+0.3)+')';
    state.ovCtx.beginPath(); state.ovCtx.arc(sx, sy, Math.random()*2+0.5, 0, Math.PI*2); state.ovCtx.fill();
  }
}

function fuseBurn(cx, cy, onDone) {
  var fuseTopX = cx+12.7, fuseTopY = cy-26.4;
  var fuseBotX = cx+13.9, fuseBotY = cy-8.3;
  var duration = 1100, startTime = performance.now();
  function frame() {
    var elapsed = performance.now()-startTime;
    var t = Math.min(1, elapsed/duration);
    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
    var sparkX = fuseTopX+(fuseBotX-fuseTopX)*t;
    var sparkY = fuseTopY+(fuseBotY-fuseTopY)*t;
    drawFuseSpark(sparkX, sparkY);
    if (t < 1) requestAnimationFrame(frame);
    else { state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH); onDone(); }
  }
  frame();
}

function dynamitePlace(x, y, ghostEl, onDone) {
  hideDynamiteSpark(ghostEl);
  var canvasRect = state.canvasArea.getBoundingClientRect();
  ghostEl.style.transition = 'left 0.2s ease-out, top 0.2s ease-out';
  ghostEl.style.left = (canvasRect.left+x) + 'px';
  ghostEl.style.top = (canvasRect.top+y) + 'px';
  setTimeout(function() {
    fuseBurn(x, y, function() {
      ghostEl.style.transition = 'opacity 0.12s';
      ghostEl.style.opacity = '0';
      doBoom(x, y);
      onDone();
    });
  }, 220);
}

// ---- Tornado ----

function doTornado() {
  saveHistory();
  state.lastStrokePoints = null;
  var w = state.canvasW, h = state.canvasH;
  var topW = Math.min(w*0.22, 280);
  var botW = Math.max(topW*0.08, 16);
  var lean = Math.max(40, topW*0.35);
  var startX = -topW*0.7, endX = w+topW*0.9;
  var totalFrames = 130, frame = 0;
  var debris = [];
  var debrisCols = ['#5a4a3a','#8a7060','#403838','#605860','#a59a8a','#3f3a3a'];

  function clearWipe(cx) {
    state.ctx.fillStyle = state.BG_CSS;
    state.ctx.beginPath();
    state.ctx.moveTo(-100, -10);
    state.ctx.lineTo(cx+lean, -10);
    state.ctx.lineTo(cx-lean, h+10);
    state.ctx.lineTo(-100, h+10);
    state.ctx.closePath();
    state.ctx.fill();
  }

  function drawTornado(cx) {
    var bands = 28;
    for (var i = 0; i < bands; i++) {
      var t = i/(bands-1);
      var y = t*h;
      var bw = botW+(topW-botW)*Math.pow(1-t, 1.7);
      var bh = bw*0.20;
      var phase = frame*0.32+i*0.85;
      var wobble = Math.sin(phase)*bw*0.08;
      var bcx = cx+wobble;
      state.ovCtx.globalAlpha = 0.16;
      state.ovCtx.fillStyle = '#3a3540';
      state.ovCtx.beginPath(); state.ovCtx.ellipse(bcx, y, bw*1.18, bh*1.4, 0, 0, Math.PI*2); state.ovCtx.fill();
      state.ovCtx.globalAlpha = 0.55;
      state.ovCtx.fillStyle = '#7d7585';
      state.ovCtx.beginPath(); state.ovCtx.ellipse(bcx, y, bw, bh, 0, 0, Math.PI*2); state.ovCtx.fill();
      var hx = bcx+Math.cos(phase*1.3)*bw*0.55;
      var hy = y+Math.sin(phase*1.3)*bh*0.5;
      state.ovCtx.globalAlpha = 0.42;
      state.ovCtx.fillStyle = '#d8d3dd';
      state.ovCtx.beginPath(); state.ovCtx.ellipse(hx, hy, bw*0.22, bh*0.7, 0, 0, Math.PI*2); state.ovCtx.fill();
    }
    state.ovCtx.globalAlpha = 1;
  }

  function spawnDebris(cx) {
    for (var i = 0; i < 3; i++) {
      debris.push({
        baseAngle: Math.random()*Math.PI*2,
        angVel: 0.18+Math.random()*0.12,
        radius: 30+Math.random()*100,
        radVel: -0.3+Math.random()*0.6,
        y: 60+Math.random()*(h-120),
        vy: -0.6-Math.random()*1.4,
        size: 1.5+Math.random()*4,
        color: debrisCols[Math.floor(Math.random()*debrisCols.length)],
        life: 0.8+Math.random()*0.4,
        decay: 0.008+Math.random()*0.012
      });
    }
  }

  function animTornado() {
    var p = frame/totalFrames;
    var cx = startX+(endX-startX)*p;
    clearWipe(cx);
    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
    drawTornado(cx);
    if (frame%2 === 0) spawnDebris(cx);
    for (var i = debris.length-1; i >= 0; i--) {
      var d = debris[i];
      d.baseAngle += d.angVel;
      d.radius = Math.max(18, d.radius+d.radVel);
      d.y += d.vy;
      d.life -= d.decay;
      if (d.life <= 0 || d.y < -30) { debris.splice(i, 1); continue; }
      var dx = cx+Math.cos(d.baseAngle)*d.radius;
      state.ovCtx.globalAlpha = Math.min(1, d.life);
      state.ovCtx.fillStyle = d.color;
      state.ovCtx.beginPath(); state.ovCtx.arc(dx, d.y, d.size, 0, Math.PI*2); state.ovCtx.fill();
    }
    state.ovCtx.globalAlpha = 1;
    frame++;
    if (frame < totalFrames) requestAnimationFrame(animTornado);
    else {
      state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
      state.ctx.fillStyle = state.BG_CSS;
      state.ctx.fillRect(0, 0, w, h);
    }
  }
  animTornado();
}

function tornadoExit(ghostEl, onDone) {
  ghostEl.style.transition = 'transform 0.18s cubic-bezier(0.4,0,0.6,1)';
  ghostEl.style.transform = 'translate(-50%,-50%) translateX(30px) skewX(-8deg) scale(1.05)';
  setTimeout(function() {
    ghostEl.style.transition = 'transform 0.26s cubic-bezier(0.5,0,0.85,0.4)';
    ghostEl.style.transform = 'translate(-50%,-50%) translateX(-160px) skewX(22deg) scale(1.7)';
    setTimeout(function() {
      ghostEl.style.transition = 'transform 0.18s cubic-bezier(0.4,0,0.4,1), opacity 0.18s ease-in';
      ghostEl.style.transform = 'translate(-50%,-50%) translateX(-110px) skewX(-20deg) scale(2.3)';
      ghostEl.style.opacity = '0';
      setTimeout(function() { doTornado(); onDone(); }, 160);
    }, 230);
  }, 180);
}

// ---- Alien UFO ----

// Per-invocation 2-colour schemes — coherent within one effect run
var ALIEN_SCHEMES = [
  ['#ff4daa', '#c44dff'],   // pink + purple
  ['#4dffb4', '#4db8ff'],   // mint + sky blue
  ['#ffe04d', '#ff8c4d'],   // yellow + orange
  ['#4dff91', '#00d4ff'],   // green + cyan
  ['#ff4d6e', '#ff9b4d'],   // coral + peach
];
function pickAlienColor() {
  // fallback used outside flight — pick any scheme pair entry
  var s = ALIEN_SCHEMES[Math.floor(Math.random()*ALIEN_SCHEMES.length)];
  return s[Math.floor(Math.random()*s.length)];
}
function colorWithAlpha(color, alpha) {
  if (color.startsWith('#')) {
    var r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16);
    return 'rgba('+r+','+g+','+b+','+alpha.toFixed(3)+')';
  }
  if (color.startsWith('hsl(')) return color.replace('hsl(','hsla(').replace(')',','+alpha.toFixed(3)+')');
  return color;
}

function buildSplashStamps(cx, cy, baseR) {
  var stamps = [];
  var coreCount = 6+Math.floor(Math.random()*4);
  for (var i = 0; i < coreCount; i++) {
    var ang = Math.random()*Math.PI*2;
    var d = Math.random()*baseR*0.55;
    var rr = baseR*(0.55+Math.random()*0.5);
    var x = cx+Math.cos(ang)*d, y = cy+Math.sin(ang)*d;
    stamps.push({x:x, y:y, r:rr, dist:Math.hypot(x-cx, y-cy)});
  }
  var tendrils = 3+Math.floor(Math.random()*5);
  for (var l = 0; l < tendrils; l++) {
    var ang = Math.random()*Math.PI*2;
    var len = baseR*(0.9+Math.random()*2.2);
    var width = baseR*(0.35+Math.random()*0.45);
    var drift = (Math.random()-0.5)*0.04;
    var jitterSeed = Math.random()*1000;
    var x = cx, y = cy;
    var steps = Math.ceil(len);
    for (var s = 0; s < steps; s++) {
      var t = s/steps;
      var rr = Math.max(1, width*(1-t*0.78)+(Math.random()-0.5)*width*0.25);
      var perp = ang+Math.PI/2;
      var jitter = (Math.sin(s*0.42+jitterSeed)+Math.sin(s*0.17+jitterSeed)*0.6)*width*0.3;
      var px = x+Math.cos(perp)*jitter, py = y+Math.sin(perp)*jitter;
      stamps.push({x:px, y:py, r:rr, dist:Math.hypot(px-cx, py-cy)});
      ang += drift; x += Math.cos(ang); y += Math.sin(ang);
    }
    stamps.push({x:x, y:y, r:Math.max(2, width*0.4), dist:Math.hypot(x-cx, y-cy)});
  }
  var sats = 4+Math.floor(Math.random()*5);
  for (var i = 0; i < sats; i++) {
    var ang = Math.random()*Math.PI*2;
    var d = baseR*(1.2+Math.random()*2.4);
    var sx = cx+Math.cos(ang)*d, sy = cy+Math.sin(ang)*d;
    var sr = Math.max(1, baseR*(0.12+Math.random()*0.28));
    stamps.push({x:sx, y:sy, r:sr, dist:d});
    if (Math.random() < 0.4) {
      var tx = cx+Math.cos(ang)*d*0.7, ty = cy+Math.sin(ang)*d*0.7;
      stamps.push({x:tx, y:ty, r:Math.max(1, sr*0.7), dist:d*0.7});
    }
  }
  stamps.sort(function(a, b) { return a.dist-b.dist; });
  return stamps;
}

function alienFlight(dropX, dropY, ghostEl, onDone) {
  saveHistory();
  state.lastStrokePoints = null;
  var canvasRect = state.canvasArea.getBoundingClientRect();

  // Pick one 2-colour scheme for the whole flight so drops look cohesive
  var flightScheme = ALIEN_SCHEMES[Math.floor(Math.random()*ALIEN_SCHEMES.length)];
  function pickFlightColor() { return flightScheme[Math.floor(Math.random()*flightScheme.length)]; }

  var margin = 70;
  var nWP = 8+Math.floor(Math.random()*4);
  var wps = [];
  for (var i = 0; i < nWP; i++) {
    wps.push({
      x: margin+Math.random()*Math.max(1, state.canvasW-margin*2),
      y: margin*0.5+Math.random()*Math.max(1, state.canvasH*0.88-margin)
    });
  }
  ghostEl.style.transition = 'none';

  var leg = 0, legDur = 360;
  var legStart = {x:dropX, y:dropY}, legEnd = wps[0];
  var legT0 = performance.now(), lastReleaseT = 0, releaseInterval = 155;
  var drops = [], splashes = [], flightDone = false;
  // Immediate big splash right at the drop point
  var _ir = Math.max(10, Math.min(38, Math.round(state.brushSize * 0.6 + Math.random() * 8)));
  splashes.push({stamps: buildSplashStamps(dropX, dropY, _ir), revealed: 0, color: pickFlightColor(), duration: 240+Math.random()*100, t0: performance.now()});

  function spawnDrop(x, y) {
    var fallDist = 80+Math.random()*180;
    var landY = Math.min(state.canvasH-12, y+fallDist);
    drops.push({
      x:x, y:y+10,
      vy: 30+Math.random()*40,
      landY: landY,
      color: pickFlightColor(),
      sway: (Math.random()-0.5)*8,
      swayPhase: Math.random()*Math.PI*2,
      r0: 6+Math.random()*5
    });
  }

  function spawnSplash(x, y, color) {
    var baseR = Math.max(10, Math.min(40, Math.round(state.brushSize*0.6+Math.random()*10)));
    splashes.push({
      stamps: buildSplashStamps(x, y, baseR),
      revealed: 0, color: color,
      duration: 220+Math.random()*160,
      t0: performance.now()
    });
  }

  function renderDrops() {
    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
    for (var i = 0; i < drops.length; i++) {
      var d = drops[i];
      var stretch = Math.min(18, d.vy*0.12);
      state.ovCtx.fillStyle = d.color;
      state.ovCtx.beginPath();
      state.ovCtx.ellipse(d.x, d.y, d.r0*0.85, d.r0+stretch*0.6, 0, 0, Math.PI*2); state.ovCtx.fill();
      state.ovCtx.beginPath();
      state.ovCtx.ellipse(d.x, d.y-stretch*0.6, d.r0*0.45, stretch*0.55, 0, 0, Math.PI*2); state.ovCtx.fill();
    }
  }

  function updateDrops(dt) {
    for (var i = drops.length-1; i >= 0; i--) {
      var d = drops[i];
      d.vy += 600*dt; d.y += d.vy*dt;
      d.swayPhase += dt*4; d.x += Math.sin(d.swayPhase)*d.sway*dt;
      if (d.y >= d.landY) { spawnSplash(d.x, d.landY, d.color); drops.splice(i, 1); }
    }
  }

  function updateSplashes() {
    var now = performance.now();
    for (var i = splashes.length-1; i >= 0; i--) {
      var s = splashes[i];
      var t = Math.min(1, (now-s.t0)/s.duration);
      var eased = 1-Math.pow(1-t, 2.4);
      var maxDist = s.stamps.length ? s.stamps[s.stamps.length-1].dist : 0;
      var revealDist = maxDist*eased;
      // Draw directly with arc() so the native ctx scale(2,2) renders at full 2x
      // resolution — getBrushStamp/stampDot upscales a 1x image which looks blurry
      state.ctx.fillStyle = s.color;
      while (s.revealed < s.stamps.length && s.stamps[s.revealed].dist <= revealDist) {
        var st = s.stamps[s.revealed];
        state.ctx.beginPath();
        state.ctx.arc(st.x, st.y, Math.max(0.5, st.r), 0, Math.PI*2);
        state.ctx.fill();
        s.revealed++;
      }
      if (t >= 1) splashes.splice(i, 1);
    }
  }

  var lastT = performance.now();
  function frame() {
    var now = performance.now();
    var dt = Math.min(0.05, (now-lastT)/1000);
    lastT = now;

    if (!flightDone) {
      var t = Math.min(1, (now-legT0)/legDur);
      var ease = t < 0.5 ? 2*t*t : 1-Math.pow(-2*t+2, 2)/2;
      var cx = legStart.x+(legEnd.x-legStart.x)*ease;
      var cy = legStart.y+(legEnd.y-legStart.y)*ease;
      var wob = Math.sin(now*0.018)*4, wob2 = Math.cos(now*0.013)*3;
      var vx = legEnd.x-legStart.x, vy = legEnd.y-legStart.y;
      var tilt = Math.atan2(vy, vx)*0.18;
      var pulse = 1+Math.sin(now*0.02)*0.04;
      ghostEl.style.left = (canvasRect.left+cx+wob2) + 'px';
      ghostEl.style.top = (canvasRect.top+cy+wob) + 'px';
      ghostEl.style.transform = 'translate(-50%,-50%) rotate('+tilt+'rad) scale('+pulse+')';

      if (now-lastReleaseT > releaseInterval) { spawnDrop(cx+wob2, cy+wob); lastReleaseT = now; }
      if (t >= 1) {
        leg++;
        if (leg >= wps.length) {
          flightDone = true;
          ghostEl.style.transform = 'translate(-50%,-50%) rotate(0rad) scale(1)';
        } else { legStart = legEnd; legEnd = wps[leg]; legT0 = now; }
      }
    }

    updateDrops(dt);
    updateSplashes();
    renderDrops();

    if (flightDone && drops.length === 0 && splashes.length === 0) {
      state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
      onDone(); return;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ---- Alien beam effect ----
// UFO descends from above the drop point, fires a tractor beam down to it,
// inverts the pixels inside the beam trapezoid, then ascends away.

function alienBeam(dropX, dropY, ghostEl, onDone) {
  saveHistory();
  state.lastStrokePoints = null;
  var canvasRect = state.canvasArea.getBoundingClientRect();

  // Beam points directly at where the user dropped
  var beamX = dropX;
  var beamBotY = dropY;
  var beamHalfW = 55 + Math.random() * 55;
  var beamLen = Math.min(dropY - 5, 140 + Math.random() * 120);
  var hoverY = Math.max(8, dropY - beamLen);
  var startY = hoverY - 70;
  var beamHue = Math.floor(Math.random() * 360);

  // Build all beam targets — first is the drop point, then 1–2 more
  var nExtra = 1 + Math.floor(Math.random() * 2);
  var allTargets = [{ x: beamX, botY: beamBotY, hoverY: hoverY, halfW: beamHalfW }];
  for (var _ek = 0; _ek < nExtra; _ek++) {
    var _tBotY = state.canvasH * 0.18 + Math.random() * state.canvasH * 0.64;
    var _tLen  = Math.min(_tBotY - 5, 110 + Math.random() * 130);
    allTargets.push({
      x:      state.canvasW * 0.1 + Math.random() * state.canvasW * 0.8,
      botY:   _tBotY,
      hoverY: Math.max(8, _tBotY - _tLen),
      halfW:  50 + Math.random() * 55
    });
  }
  var targetIdx = 0;

  var phase = 'descend', phaseT = performance.now();
  var beamSubPhase = 'extending', beamSubPhaseT = 0, subGlitchFired = false;
  var beamExtent = 0;
  var particles = [], particleTimer = 0;

  ghostEl.style.transition = 'none';
  ghostEl.style.opacity = '1';

  function spawnParticle() {
    particles.push({
      x: beamX + (Math.random() - 0.5) * beamHalfW * 1.3,
      y: beamBotY - Math.random() * 25,
      vy: -(55 + Math.random() * 75),
      r: 1.5 + Math.random() * 2.5,
      life: 1,
      color: pickAlienColor(),
      wobble: (Math.random() - 0.5) * 22,
      wobblePhase: Math.random() * Math.PI * 2
    });
  }

  function drawBeam(ext, now) {
    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
    if (ext <= 0) return;
    var topY = hoverY + 10;
    var botY = topY + (beamBotY - topY) * ext;
    var topW = 5, botW = beamHalfW * Math.min(1, ext * 1.8);
    // Main cone
    var grad = state.ovCtx.createLinearGradient(beamX, topY, beamX, botY);
    grad.addColorStop(0, 'rgba(255,255,255,0.92)');
    grad.addColorStop(0.35, 'hsla(' + beamHue + ',100%,72%,0.58)');
    grad.addColorStop(1, 'hsla(' + beamHue + ',100%,72%,0.07)');
    state.ovCtx.beginPath();
    state.ovCtx.moveTo(beamX - topW, topY);
    state.ovCtx.lineTo(beamX + topW, topY);
    state.ovCtx.lineTo(beamX + botW, botY);
    state.ovCtx.lineTo(beamX - botW, botY);
    state.ovCtx.closePath();
    state.ovCtx.fillStyle = grad;
    state.ovCtx.fill();
    // Two scan lines travelling downward
    for (var s = 0; s < 2; s++) {
      var frac = ((now * 0.0014 + s * 0.5) % 1);
      var scanY = topY + (botY - topY) * frac;
      var scanW = topW + (botW - topW) * frac;
      state.ovCtx.strokeStyle = 'rgba(255,255,255,0.48)';
      state.ovCtx.lineWidth = 1.5;
      state.ovCtx.beginPath();
      state.ovCtx.moveTo(beamX - scanW, scanY);
      state.ovCtx.lineTo(beamX + scanW, scanY);
      state.ovCtx.stroke();
    }
    // Landing ellipse glow
    if (ext > 0.8) {
      var ga = ((ext - 0.8) / 0.2) * (0.45 + Math.sin(now * 0.013) * 0.2);
      var rg = state.ovCtx.createRadialGradient(beamX, botY, 0, beamX, botY, botW * 0.95);
      rg.addColorStop(0, 'hsla(' + beamHue + ',100%,85%,' + ga + ')');
      rg.addColorStop(1, 'hsla(' + beamHue + ',100%,85%,0)');
      state.ovCtx.fillStyle = rg;
      state.ovCtx.beginPath();
      state.ovCtx.ellipse(beamX, botY, botW * 0.95, botW * 0.28, 0, 0, Math.PI * 2);
      state.ovCtx.fill();
    }
    // Abduction particles
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      state.ovCtx.save();
      state.ovCtx.globalAlpha = p.life * 0.9;
      state.ovCtx.fillStyle = p.color;
      state.ovCtx.beginPath();
      state.ovCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      state.ovCtx.fill();
      state.ovCtx.restore();
    }
  }

  function doGlitchBeam() {
    var topY = hoverY + 10, botY = beamBotY, topW = 5, botW = beamHalfW;
    var DPR = state.DPR;

    // 1. Gradient fill of the trapezoid — always visible even on white canvas.
    //    Bright near the ship, fades toward the impact point.
    var fillGrad = state.ctx.createLinearGradient(beamX, topY, beamX, botY);
    fillGrad.addColorStop(0,   'hsla(' + beamHue + ',100%,72%,0.55)');
    fillGrad.addColorStop(0.45,'hsla(' + beamHue + ',100%,65%,0.38)');
    fillGrad.addColorStop(1,   'hsla(' + beamHue + ',100%,60%,0.14)');
    state.ctx.save();
    state.ctx.fillStyle = fillGrad;
    state.ctx.beginPath();
    state.ctx.moveTo(beamX - topW, topY);
    state.ctx.lineTo(beamX + topW, topY);
    state.ctx.lineTo(beamX + botW, botY);
    state.ctx.lineTo(beamX - botW, botY);
    state.ctx.closePath();
    state.ctx.fill();
    state.ctx.restore();

    // 2. Row jitter — scrambles interior pixels AND tears the beam edges outward.
    //    edgeReach grows the jitter region beyond the trapezoid boundary so the
    //    gradient's edges get warped into the surrounding area.
    var edgeReach = 28;
    var jx0 = Math.max(0, Math.floor((beamX - botW - edgeReach - 2) * DPR));
    var jy0 = Math.max(0, Math.floor(topY * DPR));
    var jx1 = Math.min(state.canvas.width,  Math.ceil((beamX + botW + edgeReach + 2) * DPR));
    var jy1 = Math.min(state.canvas.height, Math.ceil(botY * DPR));
    var pw = jx1 - jx0, ph = jy1 - jy0;
    if (pw > 0 && ph > 0) {
      var id = state.ctx.getImageData(jx0, jy0, pw, ph);
      var src = new Uint8ClampedArray(id.data);
      var d = id.data;
      for (var row = 0; row < ph; row++) {
        var cssY = (row + jy0) / DPR;
        var tRow = (cssY - topY) / (botY - topY);
        if (tRow < 0 || tRow > 1) continue;
        var hw = (topW + (botW - topW) * tRow) * DPR;
        var cx = beamX * DPR - jx0;
        // Extend jitter reach beyond beam edge, increasing toward the base
        var edgePad = Math.round(edgeReach * tRow * DPR);
        var lx = Math.max(0, Math.round(cx - hw - edgePad));
        var rx = Math.min(pw, Math.round(cx + hw + edgePad));
        var maxJitter = Math.round(28 * tRow + 4);
        var jitter = Math.round((Math.random() * 2 - 1) * maxJitter);
        for (var col = lx; col < rx; col++) {
          var sc = Math.min(Math.max(lx, col + jitter), rx - 1);
          var di = (row * pw + col) * 4;
          var si = (row * pw + sc) * 4;
          d[di] = src[si]; d[di+1] = src[si+1]; d[di+2] = src[si+2];
        }
      }
      state.ctx.putImageData(id, jx0, jy0);
    }
  }

  var lastT = performance.now();
  function frame() {
    var now = performance.now();
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    var elapsed = now - phaseT;

    // Update particles
    particleTimer -= dt;
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.wobblePhase += dt * 3;
      p.x += Math.sin(p.wobblePhase) * p.wobble * dt;
      p.y += p.vy * dt;
      p.life -= dt * 1.4;
      if (p.life <= 0 || p.y < hoverY) particles.splice(i, 1);
    }

    if (phase === 'descend') {
      var t = Math.min(1, elapsed / 400);
      var e = 1 - Math.pow(1 - t, 3);
      ghostEl.style.left = (canvasRect.left + beamX) + 'px';
      ghostEl.style.top = (canvasRect.top + dropY + (hoverY - dropY) * e) + 'px';
      ghostEl.style.transform = 'translate(-50%,-50%)';
      if (t >= 1) { phase = 'beaming'; phaseT = now; beamSubPhaseT = now; }

    } else if (phase === 'beaming') {
      var subElapsed = now - beamSubPhaseT;
      if (beamSubPhase === 'extending') {
        beamExtent = Math.min(1, subElapsed / 520);
        drawBeam(beamExtent, now);
        ghostEl.style.left = (canvasRect.left + beamX) + 'px';
        ghostEl.style.top  = (canvasRect.top  + hoverY) + 'px';
        ghostEl.style.transform = 'translate(-50%,-50%) scale(' + (1 + Math.sin(now * 0.02) * 0.04) + ')';
        if (beamExtent >= 0.7) {
          if (particleTimer <= 0) { spawnParticle(); particleTimer = 0.055; }
          if (!subGlitchFired && subElapsed > 650) { doGlitchBeam(); subGlitchFired = true; }
        }
        if (subGlitchFired && subElapsed > 950) {
          beamSubPhase = 'shrinking'; beamSubPhaseT = now;
        }
      } else if (beamSubPhase === 'shrinking') {
        var rt = Math.min(1, subElapsed / 300);
        beamExtent = 1 - rt * rt;
        drawBeam(beamExtent, now);
        ghostEl.style.left = (canvasRect.left + beamX) + 'px';
        ghostEl.style.top  = (canvasRect.top  + hoverY) + 'px';
        ghostEl.style.transform = 'translate(-50%,-50%)';
        if (rt >= 1) {
          particles = [];
          state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
          targetIdx++;
          if (targetIdx < allTargets.length) {
            beamSubPhase = 'flying'; beamSubPhaseT = now;
          } else {
            phase = 'ascend'; phaseT = now;
          }
        }
      } else if (beamSubPhase === 'flying') {
        var tgt = allTargets[targetIdx];
        var ft = Math.min(1, subElapsed / 420);
        var fe = 1 - Math.pow(1 - ft, 3);
        var flyX = beamX + (tgt.x - beamX) * fe;
        var flyY = hoverY + (tgt.hoverY - hoverY) * fe;
        ghostEl.style.left = (canvasRect.left + flyX) + 'px';
        ghostEl.style.top  = (canvasRect.top  + flyY)  + 'px';
        ghostEl.style.transform = 'translate(-50%,-50%)';
        if (ft >= 1) {
          beamX = tgt.x; beamBotY = tgt.botY; hoverY = tgt.hoverY; beamHalfW = tgt.halfW;
          beamExtent = 0; subGlitchFired = false;
          beamSubPhase = 'extending'; beamSubPhaseT = now;
        }
      }

    } else if (phase === 'ascend') {
      var t = Math.min(1, elapsed / 500);
      ghostEl.style.top  = (canvasRect.top + hoverY - state.canvasH * 0.55 * t * t) + 'px';
      ghostEl.style.opacity = String(Math.max(0, 1 - t * 1.7));
      if (t >= 1) { onDone(); return; }
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ---- Alien starblast effect ----
// First blast fires immediately at the drop point, then UFO teleports to 2-3
// more positions for additional blasts. Charge rings expand before each blast.

function alienPlasmaPulse(dropX, dropY, ghostEl, onDone) {
  saveHistory();
  state.lastStrokePoints = null;
  var canvasRect = state.canvasArea.getBoundingClientRect();

  var ufoX = dropX;
  var hoverY = Math.max(50, dropY - 85);
  // Blast fires from just below the UFO (where the orb charges up), not from the
  // original drop point — this prevents the stamp "popping" 85px below the UFO.
  var blastX = ufoX, blastY = hoverY + 28;
  var pulseColor = pickAlienColor();
  // Max radius: distance from blast point to farthest canvas corner
  var maxR = Math.ceil(Math.sqrt(
    Math.pow(Math.max(blastX, state.canvasW - blastX), 2) +
    Math.pow(Math.max(blastY, state.canvasH - blastY), 2)
  )) + 10;
  var PULSE_SPEED = 560; // CSS px/s — slightly snappier

  var pulseR = 0;
  var flashAlpha = 0;
  var glitchRings = [];
  var warpSnap = null, warpT0 = 0;
  var WARP_DURATION = 700;

  var phase = 'rise';
  var phaseT = performance.now();

  ghostEl.style.transition = 'none';
  ghostEl.style.opacity = '1';
  ghostEl.style.left = (canvasRect.left + ufoX) + 'px';
  ghostEl.style.top  = (canvasRect.top  + dropY) + 'px';
  ghostEl.style.transform = 'translate(-50%,-50%)';

  var lastT = performance.now();
  function frame() {
    var now = performance.now();
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    var elapsed = now - phaseT;

    flashAlpha = Math.max(0, flashAlpha - dt * 6);

    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);

    // Smooth warp reveal — overlay fades from the pre-displacement snapshot to the
    // displaced main canvas, giving a GPU-accelerated animated warp feel.
    if (warpSnap) {
      var _wt = Math.min(1, (now - warpT0) / WARP_DURATION);
      var _we = 1 - Math.pow(1 - _wt, 2); // easeOutQuad
      if (_we < 1) {
        state.ovCtx.save();
        state.ovCtx.globalAlpha = 1 - _we;
        state.ovCtx.drawImage(warpSnap, 0, 0, state.canvasW, state.canvasH);
        state.ovCtx.restore();
      } else {
        warpSnap = null;
      }
    }

    // Draw impact flash
    if (flashAlpha > 0) {
      var fg = state.ovCtx.createRadialGradient(blastX, blastY, 0, blastX, blastY, 55);
      fg.addColorStop(0, 'rgba(255,255,255,' + flashAlpha.toFixed(3) + ')');
      fg.addColorStop(0.5, colorWithAlpha(pulseColor, flashAlpha * 0.6));
      fg.addColorStop(1, 'rgba(0,0,0,0)');
      state.ovCtx.fillStyle = fg;
      state.ovCtx.beginPath(); state.ovCtx.arc(blastX, blastY, 55, 0, Math.PI * 2); state.ovCtx.fill();
    }

    // Draw expanding pulse ring on overlay
    if (phase === 'pulsing' && pulseR > 0 && pulseR < maxR + 30) {
      var ringFade = Math.max(0, 1 - pulseR / maxR);
      // Outer soft glow
      state.ovCtx.save();
      state.ovCtx.globalAlpha = ringFade * 0.45;
      state.ovCtx.strokeStyle = pulseColor;
      state.ovCtx.lineWidth = 22;
      state.ovCtx.beginPath(); state.ovCtx.arc(blastX, blastY, pulseR, 0, Math.PI * 2); state.ovCtx.stroke();
      state.ovCtx.restore();
      // Mid ring
      state.ovCtx.save();
      state.ovCtx.globalAlpha = ringFade * 0.75;
      state.ovCtx.strokeStyle = pulseColor;
      state.ovCtx.lineWidth = 7;
      state.ovCtx.beginPath(); state.ovCtx.arc(blastX, blastY, pulseR, 0, Math.PI * 2); state.ovCtx.stroke();
      state.ovCtx.restore();
      // Bright white core
      state.ovCtx.save();
      state.ovCtx.globalAlpha = ringFade * 0.95;
      state.ovCtx.strokeStyle = 'white';
      state.ovCtx.lineWidth = 2;
      state.ovCtx.beginPath(); state.ovCtx.arc(blastX, blastY, pulseR, 0, Math.PI * 2); state.ovCtx.stroke();
      state.ovCtx.restore();
    }

    if (phase === 'rise') {
      var t = Math.min(1, elapsed / 450);
      var e = 1 - Math.pow(1 - t, 3);
      var cy = dropY + (hoverY - dropY) * e;
      ghostEl.style.left = (canvasRect.left + ufoX) + 'px';
      ghostEl.style.top  = (canvasRect.top  + cy) + 'px';
      ghostEl.style.transform = 'translate(-50%,-50%)';
      if (t >= 1) { phase = 'charging'; phaseT = now; }

    } else if (phase === 'charging') {
      var t = Math.min(1, elapsed / 680);
      // Rings converge inward toward an orb below the UFO
      var orbY = hoverY + 28;
      for (var r = 0; r < 5; r++) {
        var ringPhase = ((now * 0.0022 + r * 0.2) % 1);
        var rr = (1 - ringPhase) * (28 + t * 18);
        var ralpha = ringPhase * 0.85 * t;
        if (rr > 1 && ralpha > 0.02) {
          state.ovCtx.save();
          state.ovCtx.globalAlpha = ralpha;
          state.ovCtx.strokeStyle = pulseColor;
          state.ovCtx.lineWidth = 1.5;
          state.ovCtx.beginPath(); state.ovCtx.arc(ufoX, orbY, rr, 0, Math.PI * 2); state.ovCtx.stroke();
          state.ovCtx.restore();
        }
      }
      // Glowing orb grows as charge builds
      var orbR = t * 14;
      if (orbR > 0.5) {
        var og = state.ovCtx.createRadialGradient(ufoX, orbY, 0, ufoX, orbY, orbR);
        og.addColorStop(0, 'rgba(255,255,255,0.95)');
        og.addColorStop(0.45, colorWithAlpha(pulseColor, 0.7));
        og.addColorStop(1, 'rgba(0,0,0,0)');
        state.ovCtx.fillStyle = og;
        state.ovCtx.beginPath(); state.ovCtx.arc(ufoX, orbY, orbR, 0, Math.PI * 2); state.ovCtx.fill();
      }
      var shakeAmt = t > 0.65 ? ((t - 0.65) / 0.35) * 7 : 0;
      ghostEl.style.left = (canvasRect.left + ufoX + (Math.random() - 0.5) * shakeAmt) + 'px';
      ghostEl.style.top  = (canvasRect.top  + hoverY + (Math.random() - 0.5) * shakeAmt) + 'px';
      ghostEl.style.transform = 'translate(-50%,-50%) scale(' + (1 + t * 0.18) + ')';
      if (t >= 1) { phase = 'fire'; phaseT = now; }

    } else if (phase === 'fire') {
      var t = Math.min(1, elapsed / 170);
      flashAlpha = 1;
      ghostEl.style.left = (canvasRect.left + ufoX) + 'px';
      ghostEl.style.top  = (canvasRect.top  + hoverY) + 'px';
      ghostEl.style.transform = 'translate(-50%,-50%) scale(' + (1.18 - t * 0.18) + ')';
      if (t >= 1) {
        phase = 'pulsing'; phaseT = now;

        // 1. Capture pre-displacement snapshot so we can animate the warp
        warpSnap = document.createElement('canvas');
        warpSnap.width = state.canvas.width; warpSnap.height = state.canvas.height;
        warpSnap.getContext('2d').drawImage(state.canvas, 0, 0);
        warpT0 = now;

        // 2. Radial pixel displacement — push existing art outward in one shot
        (function() {
          var pushR = 200, pushStr = 35, DPR = state.DPR;
          var bx0 = Math.max(0, Math.floor((blastX - pushR - 2) * DPR));
          var by0 = Math.max(0, Math.floor((blastY - pushR - 2) * DPR));
          var bx1 = Math.min(state.canvas.width,  Math.ceil((blastX + pushR + 2) * DPR));
          var by1 = Math.min(state.canvas.height, Math.ceil((blastY + pushR + 2) * DPR));
          var pw = bx1 - bx0, ph = by1 - by0;
          if (pw <= 0 || ph <= 0) return;
          var src = state.ctx.getImageData(bx0, by0, pw, ph);
          var dst = new ImageData(pw, ph);
          var sd = src.data, dd = dst.data;
          var bcx = blastX * DPR - bx0, bcy = blastY * DPR - by0;
          var maxRp = pushR * DPR, maxPush = pushStr * DPR;
          for (var py = 0; py < ph; py++) {
            for (var px = 0; px < pw; px++) {
              var ddx = px - bcx, ddy = py - bcy;
              var dist = Math.sqrt(ddx * ddx + ddy * ddy);
              var di = (py * pw + px) * 4;
              if (dist < 1 || dist > maxRp) {
                dd[di] = sd[di]; dd[di+1] = sd[di+1]; dd[di+2] = sd[di+2]; dd[di+3] = sd[di+3];
                continue;
              }
              var strength = (1 - dist / maxRp) * maxPush;
              var sx = Math.min(Math.max(0, Math.round(px - (ddx / dist) * strength)), pw - 1);
              var sy = Math.min(Math.max(0, Math.round(py - (ddy / dist) * strength)), ph - 1);
              var si = (sy * pw + sx) * 4;
              dd[di] = sd[si]; dd[di+1] = sd[si+1]; dd[di+2] = sd[si+2]; dd[di+3] = sd[si+3];
            }
          }
          state.ctx.putImageData(dst, bx0, by0);
        })();

        // 3. Epicentre glow — use pulseColor at 0 alpha for outer stop to avoid dark halo
        var cg = state.ctx.createRadialGradient(blastX, blastY, 0, blastX, blastY, 30);
        cg.addColorStop(0, 'rgba(255,255,255,0.95)');
        cg.addColorStop(0.4, colorWithAlpha(pulseColor, 0.75));
        cg.addColorStop(1, colorWithAlpha(pulseColor, 0));
        state.ctx.fillStyle = cg;
        state.ctx.beginPath(); state.ctx.arc(blastX, blastY, 30, 0, Math.PI * 2); state.ctx.fill();

        // 4. Initialise glitch rings — animated in pulsing phase, committed to main canvas
        //    when fully grown (so they scale up rather than popping in).
        glitchRings = [];
        var nRings = 2 + Math.floor(Math.random() * 2);
        for (var ri = 0; ri < nRings; ri++) {
          var rr = 55 + ri * (30 + Math.random() * 25);
          var gapCount = 2 + Math.floor(Math.random() * 3);
          var startAngle = Math.random() * Math.PI * 2;
          var segs = [];
          for (var gi = 0; gi < gapCount; gi++) {
            var seg = (Math.PI * 2 / gapCount) * (0.55 + Math.random() * 0.35);
            segs.push({
              a0: startAngle + (Math.PI * 2 / gapCount) * gi,
              a1: startAngle + (Math.PI * 2 / gapCount) * gi + seg,
              alpha: 0.5 + Math.random() * 0.45,
              lw: 1.5 + Math.random() * 2.5
            });
          }
          glitchRings.push({ targetR: rr, delay: ri * 90, segs: segs, t0: now, committed: false });
        }
      }

    } else if (phase === 'pulsing') {
      pulseR += dt * PULSE_SPEED;
      ghostEl.style.left = (canvasRect.left + ufoX) + 'px';
      ghostEl.style.top  = (canvasRect.top  + hoverY) + 'px';
      ghostEl.style.transform = 'translate(-50%,-50%)';

      // Animate glitch rings — grow on overlay, commit permanently to main canvas once full
      for (var _ri = 0; _ri < glitchRings.length; _ri++) {
        var gr = glitchRings[_ri];
        if (gr.committed) continue;
        var ringAge = now - gr.t0 - gr.delay;
        if (ringAge < 0) continue;
        var ringT = Math.min(1, ringAge / 180); // just a fade timer, no scaling
        var curR = gr.targetR;                  // full radius immediately
        var ringFadeIn = ringT;
        if (curR < 1) continue;
        for (var _si = 0; _si < gr.segs.length; _si++) {
          var sg = gr.segs[_si];
          state.ovCtx.save();
          state.ovCtx.globalAlpha = sg.alpha * ringFadeIn * 0.4;
          state.ovCtx.strokeStyle = pulseColor;
          state.ovCtx.lineWidth = sg.lw + 8;
          state.ovCtx.beginPath(); state.ovCtx.arc(blastX, blastY, curR, sg.a0, sg.a1); state.ovCtx.stroke();
          state.ovCtx.restore();
          state.ovCtx.save();
          state.ovCtx.globalAlpha = sg.alpha * ringFadeIn;
          state.ovCtx.strokeStyle = 'white';
          state.ovCtx.lineWidth = sg.lw * 0.6;
          state.ovCtx.beginPath(); state.ovCtx.arc(blastX, blastY, curR, sg.a0, sg.a1); state.ovCtx.stroke();
          state.ovCtx.restore();
          state.ovCtx.save();
          state.ovCtx.globalAlpha = sg.alpha * ringFadeIn * 0.8;
          state.ovCtx.strokeStyle = pulseColor;
          state.ovCtx.lineWidth = sg.lw;
          state.ovCtx.beginPath(); state.ovCtx.arc(blastX, blastY, curR, sg.a0, sg.a1); state.ovCtx.stroke();
          state.ovCtx.restore();
        }
        if (ringT >= 1) {
          // Commit at full size to main canvas
          for (var _si2 = 0; _si2 < gr.segs.length; _si2++) {
            var sg2 = gr.segs[_si2];
            state.ctx.save();
            state.ctx.globalAlpha = sg2.alpha * 0.3;
            state.ctx.strokeStyle = pulseColor;
            state.ctx.lineWidth = sg2.lw + 8;
            state.ctx.beginPath(); state.ctx.arc(blastX, blastY, gr.targetR, sg2.a0, sg2.a1); state.ctx.stroke();
            state.ctx.restore();
            state.ctx.save();
            state.ctx.globalAlpha = sg2.alpha;
            state.ctx.strokeStyle = 'white';
            state.ctx.lineWidth = sg2.lw * 0.6;
            state.ctx.beginPath(); state.ctx.arc(blastX, blastY, gr.targetR, sg2.a0, sg2.a1); state.ctx.stroke();
            state.ctx.restore();
            state.ctx.save();
            state.ctx.globalAlpha = sg2.alpha * 0.8;
            state.ctx.strokeStyle = pulseColor;
            state.ctx.lineWidth = sg2.lw;
            state.ctx.beginPath(); state.ctx.arc(blastX, blastY, gr.targetR, sg2.a0, sg2.a1); state.ctx.stroke();
            state.ctx.restore();
          }
          gr.committed = true;
        }
      }

      if (pulseR >= maxR) { phase = 'leaving'; phaseT = now; }

    } else if (phase === 'leaving') {
      var t = Math.min(1, elapsed / 480);
      ghostEl.style.left = (canvasRect.left + ufoX) + 'px';
      ghostEl.style.top  = (canvasRect.top  + hoverY - state.canvasH * 0.55 * t * t) + 'px';
      ghostEl.style.opacity = String(Math.max(0, 1 - t * 1.7));
      if (t >= 1) { state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH); onDone(); return; }
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ---- Init all drag tools ----

export function initDragTools() {
  var undoTool = makeUndoTool();
  var bucketTool = makeDragTool('bucket-btn', function(x, y, ghostEl) {
    return new Promise(function(resolve) {
      saveHistory();
      state.lastStrokePoints = null;
      bucketPour(Math.round(x), Math.round(y), ghostEl, resolve);
    });
  });
  var dynamiteTool = makeDragTool('dynamite-btn', function(x, y, ghostEl) {
    return new Promise(function(resolve) { dynamitePlace(x, y, ghostEl, resolve); });
  });
  var tornadoTool = makeDragTool('tornado-btn', function(x, y, ghostEl) {
    return new Promise(function(resolve) { tornadoExit(ghostEl, resolve); });
  });
  var alienEffects = [alienFlight, alienBeam, alienPlasmaPulse];
  var alienTool = makeDragTool('alien-btn', function(x, y, ghostEl) {
    return new Promise(function(resolve) {
      alienEffects[Math.floor(Math.random() * alienEffects.length)](x, y, ghostEl, resolve);
    });
  });

  window.addEventListener('mousemove', function(e) {
    bucketTool.move(e.clientX, e.clientY);
    dynamiteTool.move(e.clientX, e.clientY);
    tornadoTool.move(e.clientX, e.clientY);
    alienTool.move(e.clientX, e.clientY);
    undoTool.move(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', function(e) {
    bucketTool.end(e.clientX, e.clientY);
    dynamiteTool.end(e.clientX, e.clientY);
    tornadoTool.end(e.clientX, e.clientY);
    alienTool.end(e.clientX, e.clientY);
    undoTool.end(e.clientX, e.clientY);
  });
  window.addEventListener('touchmove', function(e) {
    if (!e.touches.length) return;
    bucketTool.move(e.touches[0].clientX, e.touches[0].clientY);
    dynamiteTool.move(e.touches[0].clientX, e.touches[0].clientY);
    tornadoTool.move(e.touches[0].clientX, e.touches[0].clientY);
    alienTool.move(e.touches[0].clientX, e.touches[0].clientY);
    undoTool.move(e.touches[0].clientX, e.touches[0].clientY);
  }, {passive: false});
  window.addEventListener('touchend', function(e) {
    if (!e.changedTouches.length) return;
    bucketTool.end(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    dynamiteTool.end(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    tornadoTool.end(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    alienTool.end(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
    undoTool.end(e.changedTouches[0].clientX, e.changedTouches[0].clientY);
  });
}
