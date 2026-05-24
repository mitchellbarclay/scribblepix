import state from '../state.js';
import { hslToRgb, hexToRgb } from '../core/color-utils.js';
import { getBrushStamp, stampDot } from '../core/brush-pipeline.js';
import { saveHistory } from '../core/history.js';
import { bucketPour } from '../core/fill.js';
import { doBoom } from '../tools/explosion.js';

// ---- Undo tool ----

function setUndoEmoji(e) {
  var undoBtn = document.getElementById('undo-btn');
  var icon = undoBtn.querySelector('.drag-item-icon');
  if (!icon) return;
  var img = icon.querySelector('img');
  var src = (e === '😮') ? 'custom-icons/drag icons/undo_oops.svg' : 'custom-icons/drag icons/undo_yikes.svg';
  if (img) img.src = src;
}

var undoBusy = false;
function fireUndo() {
  if (undoBusy || !state.undoSnapshot) { setUndoEmoji('😬'); return; }
  if (state.undoSnapshot.width !== state.canvas.width || state.undoSnapshot.height !== state.canvas.height) { setUndoEmoji('😬'); return; }
  undoBusy = true;

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
        setTimeout(function() { setUndoEmoji('😬'); undoBusy = false; }, 180);
      }
    } catch(err) {
      console.error('undo frame error:', err);
      commit();
      undoBusy = false;
      setUndoEmoji('😬');
    }
  }
  frame();
}

function makeUndoTool() {
  var btn = document.getElementById('undo-btn');
  var iconEl = btn.querySelector('.drag-item-icon');
  var pressed = false, startX = 0, startY = 0;

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

  function startDrag(cx, cy) { pressed = true; startX = cx; startY = cy; iconEl.style.transition = ''; setUndoEmoji('😮'); }
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

var ALIEN_PALETTE = [
  '#ff3b6f','#ff7a3b','#ffd93b','#3bff6f',
  '#3bd8ff','#7a3bff','#ff3be0','#ffffff','#222244'
];
function pickAlienColor() {
  if (state.rainbowMode) return 'hsl('+Math.floor(Math.random()*360)+',95%,55%)';
  return ALIEN_PALETTE[Math.floor(Math.random()*ALIEN_PALETTE.length)];
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
  var margin = 70;
  var nWP = 6+Math.floor(Math.random()*3);
  var wps = [];
  for (var i = 0; i < nWP; i++) {
    wps.push({
      x: margin+Math.random()*Math.max(1, state.canvasW-margin*2),
      y: margin*0.5+Math.random()*Math.max(1, state.canvasH*0.55)
    });
  }
  ghostEl.style.transition = 'none';

  var leg = 0, legDur = 420;
  var legStart = {x:dropX, y:dropY}, legEnd = wps[0];
  var legT0 = performance.now(), lastReleaseT = 0, releaseInterval = 240;
  var drops = [], splashes = [], flightDone = false;
  // Immediate big splash right at the drop point
  var _ir = Math.max(10, Math.min(38, Math.round(state.brushSize * 0.6 + Math.random() * 8)));
  splashes.push({stamps: buildSplashStamps(dropX, dropY, _ir), revealed: 0, color: pickAlienColor(), duration: 240+Math.random()*100, t0: performance.now()});

  function spawnDrop(x, y) {
    var fallDist = 80+Math.random()*180;
    var landY = Math.min(state.canvasH-12, y+fallDist);
    drops.push({
      x:x, y:y+10,
      vy: 30+Math.random()*40,
      landY: landY,
      color: pickAlienColor(),
      sway: (Math.random()-0.5)*8,
      swayPhase: Math.random()*Math.PI*2,
      r0: 5+Math.random()*4
    });
  }

  function spawnSplash(x, y, color) {
    var baseR = Math.max(8, Math.min(34, Math.round(state.brushSize*0.55+Math.random()*8)));
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
      while (s.revealed < s.stamps.length && s.stamps[s.revealed].dist <= revealDist) {
        var st = s.stamps[s.revealed];
        stampDot(state.ctx, st.x, st.y, getBrushStamp(Math.max(1, Math.round(st.r)), s.color));
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
  var beamHalfW = 28 + Math.random() * 38;
  var beamLen = Math.min(dropY - 5, 140 + Math.random() * 120);
  var hoverY = Math.max(8, dropY - beamLen);
  var startY = hoverY - 70;
  var beamHue = Math.floor(Math.random() * 360);

  var phase = 'descend', phaseT = performance.now();
  var beamExtent = 0, invertDone = false;
  var particles = [], particleTimer = 0;

  ghostEl.style.transition = 'none';
  ghostEl.style.opacity = '1';
  ghostEl.style.left = (canvasRect.left + beamX) + 'px';
  ghostEl.style.top  = (canvasRect.top + startY) + 'px';
  ghostEl.style.transform = 'translate(-50%,-50%) scale(0.7)';

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
      var frac = ((now * 0.0024 + s * 0.5) % 1);
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

  function doInvert() {
    // Invert only pixels inside the trapezoid — no rectangular black bar
    var topY = hoverY + 10, botY = beamBotY, topW = 5, botW = beamHalfW;
    var x0 = Math.max(0, Math.floor((beamX - botW - 2) * state.DPR));
    var y0 = Math.max(0, Math.floor(topY * state.DPR));
    var x1 = Math.min(state.canvas.width,  Math.ceil((beamX + botW + 2) * state.DPR));
    var y1 = Math.min(state.canvas.height, Math.ceil(botY * state.DPR));
    var pw = x1 - x0, ph = y1 - y0;
    if (pw <= 0 || ph <= 0) return;
    var id = state.ctx.getImageData(x0, y0, pw, ph);
    var d = id.data;
    for (var row = 0; row < ph; row++) {
      var cssY = (row + y0) / state.DPR;
      var t = (cssY - topY) / (botY - topY);
      if (t < 0 || t > 1) continue;
      var hw = (topW + (botW - topW) * t) * state.DPR;
      var cPx = beamX * state.DPR - x0;
      var lx = Math.max(0, Math.round(cPx - hw));
      var rx = Math.min(pw, Math.round(cPx + hw));
      for (var col = lx; col < rx; col++) {
        var idx = (row * pw + col) * 4;
        d[idx]   = 255 - d[idx];
        d[idx+1] = 255 - d[idx+1];
        d[idx+2] = 255 - d[idx+2];
      }
    }
    state.ctx.putImageData(id, x0, y0);
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
      var t = Math.min(1, elapsed / 500);
      var e = 1 - Math.pow(1 - t, 3);
      ghostEl.style.top = (canvasRect.top + startY + (hoverY - startY) * e) + 'px';
      ghostEl.style.transform = 'translate(-50%,-50%) scale(' + (0.7 + e * 0.3) + ')';
      if (t >= 1) { phase = 'beaming'; phaseT = now; }

    } else if (phase === 'beaming') {
      beamExtent = Math.min(1, elapsed / 520);
      drawBeam(beamExtent, now);
      ghostEl.style.top = (canvasRect.top + hoverY) + 'px';
      ghostEl.style.transform = 'translate(-50%,-50%) scale(' + (1 + Math.sin(now * 0.02) * 0.05) + ')';
      if (beamExtent >= 1) {
        if (particleTimer <= 0) { spawnParticle(); particleTimer = 0.07; }
        if (!invertDone && elapsed > 750) { doInvert(); invertDone = true; }
      }
      if (elapsed > 1600) { phase = 'retracting'; phaseT = now; }

    } else if (phase === 'retracting') {
      var t = Math.min(1, elapsed / 380);
      drawBeam(1 - t * t, now);
      if (t >= 1) {
        particles = [];
        state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
        phase = 'ascend'; phaseT = now;
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

function alienStarblast(dropX, dropY, ghostEl, onDone) {
  saveHistory();
  state.lastStrokePoints = null;
  var canvasRect = state.canvasArea.getBoundingClientRect();

  // First blast at the drop point, then random extras
  var nExtra = 2 + Math.floor(Math.random() * 2);
  var blasts = [{x: dropX, y: dropY}];
  for (var i = 0; i < nExtra; i++) {
    blasts.push({x: state.canvasW * (0.1 + Math.random() * 0.8), y: state.canvasH * (0.1 + Math.random() * 0.8)});
  }

  var blastIdx = 0, fromX = dropX, fromY = dropY;
  var ufoX = dropX, ufoY = dropY;
  // Start charging immediately — no "move to drop" phase needed
  var phase = 'charging', phaseT = performance.now();

  ghostEl.style.transition = 'none';
  ghostEl.style.opacity = '1';
  ghostEl.style.left = (canvasRect.left + dropX) + 'px';
  ghostEl.style.top  = (canvasRect.top  + dropY) + 'px';
  ghostEl.style.transform = 'translate(-50%,-50%)';

  // Shockwave rings and flash managed in the animation loop
  var shockwaves = [];
  var flashX = 0, flashY = 0, flashAlpha = 0, flashR = 0;

  function doBlast(cx, cy) {
    var rays = 8 + Math.floor(Math.random() * 7);
    var maxLen = 55 + Math.random() * 85;
    for (var i = 0; i < rays; i++) {
      var angle = (i / rays) * Math.PI * 2 + Math.random() * 0.2;
      var len = maxLen * (0.6 + Math.random() * 0.4);
      var lw = 3 + Math.random() * 5;
      var col = pickAlienColor();
      state.ctx.save();
      state.ctx.strokeStyle = col; state.ctx.lineWidth = lw; state.ctx.lineCap = 'round';
      state.ctx.shadowColor = col; state.ctx.shadowBlur = 7;
      state.ctx.beginPath(); state.ctx.moveTo(cx, cy);
      state.ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len); state.ctx.stroke();
      state.ctx.fillStyle = col;
      state.ctx.beginPath(); state.ctx.arc(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len, lw * 0.8, 0, Math.PI * 2); state.ctx.fill();
      state.ctx.restore();
    }
    // Bright centre
    var cg = state.ctx.createRadialGradient(cx, cy, 0, cx, cy, maxLen * 0.2);
    cg.addColorStop(0, 'rgba(255,255,255,0.95)'); cg.addColorStop(1, 'rgba(255,255,255,0)');
    state.ctx.fillStyle = cg;
    state.ctx.beginPath(); state.ctx.arc(cx, cy, maxLen * 0.2, 0, Math.PI * 2); state.ctx.fill();
    // Queue shockwave + flash for the loop to animate
    shockwaves.push({x: cx, y: cy, r: 4, maxR: maxLen * 0.8, alpha: 0.9, color: pickAlienColor()});
    flashX = cx; flashY = cy; flashAlpha = 1; flashR = maxLen * 0.55;
  }

  var lastT = performance.now();
  function frame() {
    var now = performance.now();
    var dt = Math.min(0.05, (now - lastT) / 1000);
    lastT = now;
    var elapsed = now - phaseT;
    var target = blasts[blastIdx];

    // Decay shockwaves and flash each frame
    for (var i = shockwaves.length - 1; i >= 0; i--) {
      shockwaves[i].r += dt * 230; shockwaves[i].alpha -= dt * 2.8;
      if (shockwaves[i].alpha <= 0) shockwaves.splice(i, 1);
    }
    flashAlpha = Math.max(0, flashAlpha - dt * 7);

    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);

    // Draw shockwaves
    for (var i = 0; i < shockwaves.length; i++) {
      var sw = shockwaves[i];
      state.ovCtx.save();
      state.ovCtx.globalAlpha = sw.alpha * 0.7;
      state.ovCtx.strokeStyle = sw.color; state.ovCtx.lineWidth = 2.5;
      state.ovCtx.beginPath(); state.ovCtx.arc(sw.x, sw.y, sw.r, 0, Math.PI * 2); state.ovCtx.stroke();
      state.ovCtx.restore();
    }
    // Draw flash
    if (flashAlpha > 0) {
      var fg = state.ovCtx.createRadialGradient(flashX, flashY, 0, flashX, flashY, flashR);
      fg.addColorStop(0, 'rgba(255,255,255,' + flashAlpha + ')');
      fg.addColorStop(1, 'rgba(255,255,255,0)');
      state.ovCtx.fillStyle = fg;
      state.ovCtx.beginPath(); state.ovCtx.arc(flashX, flashY, flashR, 0, Math.PI * 2); state.ovCtx.fill();
    }

    if (phase === 'moving') {
      var t = Math.min(1, elapsed / 350);
      var e = 1 - Math.pow(1 - t, 3);
      ufoX = fromX + (target.x - fromX) * e;
      ufoY = fromY + (target.y - fromY) * e;
      ghostEl.style.left = (canvasRect.left + ufoX) + 'px';
      ghostEl.style.top  = (canvasRect.top  + ufoY) + 'px';
      ghostEl.style.transform = 'translate(-50%,-50%)';
      if (t >= 1) { ufoX = target.x; ufoY = target.y; phase = 'charging'; phaseT = now; }

    } else if (phase === 'charging') {
      var t = Math.min(1, elapsed / 520);
      // Expanding concentric charge rings — 4 rings cycling continuously, growing with t
      for (var r = 0; r < 4; r++) {
        var ringT = (now * 0.003 + r * 0.25) % 1;
        var rr = ringT * (20 + t * 25);
        var ralpha = (1 - ringT) * 0.7 * t;
        if (rr > 0.5 && ralpha > 0) {
          state.ovCtx.save();
          state.ovCtx.globalAlpha = ralpha;
          state.ovCtx.strokeStyle = 'hsl(' + ((blastIdx * 90 + r * 60) % 360) + ',100%,70%)';
          state.ovCtx.lineWidth = 2;
          state.ovCtx.beginPath(); state.ovCtx.arc(ufoX, ufoY, rr, 0, Math.PI * 2); state.ovCtx.stroke();
          state.ovCtx.restore();
        }
      }
      var shakeX = t > 0.5 ? (Math.random() - 0.5) * t * 10 : 0;
      var shakeY = t > 0.5 ? (Math.random() - 0.5) * t * 10 : 0;
      ghostEl.style.left = (canvasRect.left + ufoX + shakeX) + 'px';
      ghostEl.style.top  = (canvasRect.top  + ufoY + shakeY) + 'px';
      ghostEl.style.transform = 'translate(-50%,-50%) scale(' + (1 + t * 0.22) + ')';
      if (t >= 1) { doBlast(ufoX, ufoY); phase = 'recovering'; phaseT = now; }

    } else if (phase === 'recovering') {
      var t = Math.min(1, elapsed / 260);
      ghostEl.style.left = (canvasRect.left + ufoX) + 'px';
      ghostEl.style.top  = (canvasRect.top  + ufoY) + 'px';
      ghostEl.style.transform = 'translate(-50%,-50%) scale(' + (1 + (1 - t) * 0.3) + ')';
      if (t >= 1) {
        blastIdx++;
        if (blastIdx >= blasts.length) { phase = 'leaving'; phaseT = now; }
        else { fromX = ufoX; fromY = ufoY; phase = 'moving'; phaseT = now; }
      }

    } else if (phase === 'leaving') {
      var t = Math.min(1, elapsed / 420);
      ghostEl.style.left = (canvasRect.left + ufoX) + 'px';
      ghostEl.style.top  = (canvasRect.top  + ufoY - state.canvasH * 0.5 * t * t) + 'px';
      ghostEl.style.opacity = String(Math.max(0, 1 - t * 1.6));
      if (t >= 1) { state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH); onDone(); return; }
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ---- Alien crop circles effect ----
// UFO descends to hover above the drop point and slowly traces a glowing
// geometric pattern — rings sweeping arc by arc, then spokes extending outward.

function alienCropCircles(dropX, dropY, ghostEl, onDone) {
  saveHistory();
  state.lastStrokePoints = null;
  var canvasRect = state.canvasArea.getBoundingClientRect();

  var cx = dropX, cy = dropY;
  var maxR = Math.min(state.canvasW, state.canvasH) * (0.12 + Math.random() * 0.15);
  var nRings = 3 + Math.floor(Math.random() * 3);
  var nSpokes = 4 + Math.floor(Math.random() * 4);
  var hoverY = Math.max(12, cy - maxR - 35);
  var startY = hoverY - 65;

  // Pre-compute stable colors and widths
  var ringColors = [], ringWidths = [], spokeColors = [], spokeWidths = [];
  for (var i = 0; i < nRings; i++) { ringColors.push(pickAlienColor()); ringWidths.push(1.8 + Math.random() * 1.6); }
  for (var i = 0; i < nSpokes; i++) { spokeColors.push(pickAlienColor()); spokeWidths.push(1.2 + Math.random() * 1.3); }
  var dotColor = pickAlienColor();

  var RING_DUR = 380, SPOKE_DUR = 160;
  var totalDur = nRings * RING_DUR + nSpokes * SPOKE_DUR + 120;
  var ringProgress = new Array(nRings).fill(0); // radians drawn per ring
  var spokeProgress = new Array(nSpokes).fill(0); // 0..1 fraction drawn per spoke
  var dotDrawn = false;
  var cursorX = cx, cursorY = cy - maxR; // glowing draw cursor position

  var phase = 'descend', phaseT = performance.now(), drawT = 0;
  ghostEl.style.transition = 'none';
  ghostEl.style.opacity = '1';
  ghostEl.style.left = (canvasRect.left + cx) + 'px';
  ghostEl.style.top  = (canvasRect.top + startY) + 'px';
  ghostEl.style.transform = 'translate(-50%,-50%) scale(0.72)';

  function getRingR(i) { return maxR * ((nRings - i) / nRings); }

  function updateDrawing(drawElapsed) {
    // Rings: outer to inner, each sweeps from 0 to 2π
    for (var i = 0; i < nRings; i++) {
      var rt = Math.max(0, Math.min(1, (drawElapsed - i * RING_DUR) / RING_DUR));
      var targetAngle = rt * Math.PI * 2;
      if (targetAngle > ringProgress[i]) {
        var r = getRingR(i);
        state.ctx.save();
        state.ctx.strokeStyle = ringColors[i]; state.ctx.lineWidth = ringWidths[i];
        state.ctx.shadowColor = ringColors[i]; state.ctx.shadowBlur = 8;
        state.ctx.beginPath();
        state.ctx.arc(cx, cy, r, ringProgress[i] - Math.PI / 2, targetAngle - Math.PI / 2);
        state.ctx.stroke();
        state.ctx.restore();
        ringProgress[i] = targetAngle;
        cursorX = cx + Math.cos(targetAngle - Math.PI / 2) * r;
        cursorY = cy + Math.sin(targetAngle - Math.PI / 2) * r;
      }
    }
    // Spokes: extend outward one at a time
    var spokesStart = nRings * RING_DUR;
    for (var i = 0; i < nSpokes; i++) {
      var st = Math.max(0, Math.min(1, (drawElapsed - spokesStart - i * SPOKE_DUR) / SPOKE_DUR));
      if (st <= spokeProgress[i]) continue;
      var ang = (i / nSpokes) * Math.PI * 2;
      var innerR = maxR * 0.09, outerR = maxR;
      state.ctx.save();
      state.ctx.strokeStyle = spokeColors[i]; state.ctx.lineWidth = spokeWidths[i];
      state.ctx.shadowColor = spokeColors[i]; state.ctx.shadowBlur = 5; state.ctx.lineCap = 'round';
      state.ctx.beginPath();
      state.ctx.moveTo(cx + Math.cos(ang) * (innerR + (outerR - innerR) * spokeProgress[i]),
                       cy + Math.sin(ang) * (innerR + (outerR - innerR) * spokeProgress[i]));
      state.ctx.lineTo(cx + Math.cos(ang) * (innerR + (outerR - innerR) * st),
                       cy + Math.sin(ang) * (innerR + (outerR - innerR) * st));
      state.ctx.stroke();
      state.ctx.restore();
      spokeProgress[i] = st;
      cursorX = cx + Math.cos(ang) * (innerR + (outerR - innerR) * st);
      cursorY = cy + Math.sin(ang) * (innerR + (outerR - innerR) * st);
    }
    // Centre dot
    if (!dotDrawn && drawElapsed >= spokesStart + nSpokes * SPOKE_DUR) {
      state.ctx.save();
      state.ctx.fillStyle = dotColor; state.ctx.shadowColor = dotColor; state.ctx.shadowBlur = 12;
      state.ctx.beginPath(); state.ctx.arc(cx, cy, maxR * 0.07, 0, Math.PI * 2); state.ctx.fill();
      state.ctx.restore();
      dotDrawn = true; cursorX = cx; cursorY = cy;
    }
  }

  function drawCursor(now) {
    state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
    var pulse = 0.6 + Math.sin(now * 0.016) * 0.4;
    var cg = state.ovCtx.createRadialGradient(cursorX, cursorY, 0, cursorX, cursorY, 12);
    cg.addColorStop(0, 'rgba(255,255,200,' + (pulse * 0.88) + ')');
    cg.addColorStop(1, 'rgba(255,255,200,0)');
    state.ovCtx.fillStyle = cg;
    state.ovCtx.beginPath(); state.ovCtx.arc(cursorX, cursorY, 12, 0, Math.PI * 2); state.ovCtx.fill();
    state.ovCtx.fillStyle = 'rgba(255,255,255,' + pulse + ')';
    state.ovCtx.beginPath(); state.ovCtx.arc(cursorX, cursorY, 2.5, 0, Math.PI * 2); state.ovCtx.fill();
  }

  function frame() {
    var now = performance.now(), elapsed = now - phaseT;

    if (phase === 'descend') {
      var t = Math.min(1, elapsed / 530);
      var e = 1 - Math.pow(1 - t, 3);
      ghostEl.style.top = (canvasRect.top + startY + (hoverY - startY) * e) + 'px';
      ghostEl.style.transform = 'translate(-50%,-50%) scale(' + (0.72 + e * 0.28) + ')';
      if (t >= 1) { phase = 'drawing'; phaseT = now; drawT = now; }

    } else if (phase === 'drawing') {
      updateDrawing(now - drawT);
      drawCursor(now);
      ghostEl.style.top = (canvasRect.top + hoverY + Math.sin(now * 0.005) * 4) + 'px';
      ghostEl.style.transform = 'translate(-50%,-50%) scale(' + (1 + Math.sin(now * 0.009) * 0.03) + ')';
      if ((now - drawT) >= totalDur + 280) { phase = 'leaving'; phaseT = now; }

    } else if (phase === 'leaving') {
      state.ovCtx.clearRect(0, 0, state.canvasW, state.canvasH);
      var t = Math.min(1, elapsed / 440);
      ghostEl.style.top  = (canvasRect.top + hoverY - state.canvasH * 0.48 * t * t) + 'px';
      ghostEl.style.opacity = String(Math.max(0, 1 - t * 1.65));
      if (t >= 1) { onDone(); return; }
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
  var alienEffects = [alienFlight, alienBeam, alienStarblast, alienCropCircles];
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
