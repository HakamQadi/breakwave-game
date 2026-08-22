(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const canvas = $("gameCanvas");
  const stage = $("stageWrap");
  const touchControl = $("touchControl");
  const touchThumb = $("touchThumb");
  const ctx = canvas?.getContext("2d", { alpha: false });
  if (!canvas || !stage || !ctx) throw new Error("Breakwave requires Canvas 2D support.");

  const ui = {
    score: $("scoreValue"), best: $("bestValue"), level: $("levelValue"), lives: $("livesValue"),
    progress: $("progressValue"), fill: $("progressFill"), track: document.querySelector(".progress-track"),
    startOverlay: $("startOverlay"), start: $("startBtn"), stateOverlay: $("stateOverlay"), stateTag: $("stateTag"),
    stateTitle: $("stateTitle"), stateText: $("stateText"), statePrimary: $("statePrimaryBtn"), stateSecondary: $("stateSecondaryBtn"),
    pause: $("pauseBtn"), restart: $("restartBtn"), sound: $("soundBtn"), fullscreen: $("fullscreenBtn"), card: document.querySelector(".game-card")
  };

  const coarse = matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const WORLD = { w: 960, h: 600 };
  const GRID = { cols: 36, rows: 20, top: 42, gap: 1.35, left: 40, width: 880, cellW: 880 / 36, cellH: 20 };
  const cfg = { speed: coarse ? 365 : 390, ballR: coarse ? 7 : 6.2, paddleY: 548, paddleH: coarse ? 17 : 14, lives: 3 };
  const pal = { bg: "#090c16", white: "#e9f0ff", mint: "#9bff6a", cyan: "#5ee7ff", pink: "#ff72c6", yellow: "#ffd36b", fill1: "#2c3656", fill2: "#36426a", fillHi: "#4a5a90" };
  const view = { scale: 1, x: 0, y: 0 };
  const store = {
    get(k, d = null) { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, String(v)); } catch {} }
  };

  const state = {
    mode: "ready", score: 0, best: Math.max(Number(store.get("breakwaveBest", 0)), Number(store.get("pixelShatterBest", 0))),
    lives: cfg.lives, level: 0, blocksLeft: 0, totalBlocks: 0, last: performance.now(), transition: 0,
    keys: { left: false, right: false }, pointerActive: false, pointerMouse: false, pointerX: WORLD.w / 2,
    sound: store.get("breakwaveSound", store.get("pixelShatterSound", "on")) !== "off", shake: 0
  };

  const paddle = { x: 414, y: cfg.paddleY, w: 132, h: cfg.paddleH, targetX: 480 };
  let balls = [], blocks = [], powerups = [], particles = [], popups = [], stars = [];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const paddleWidth = () => 132 * WORLD.w / 960 * (coarse ? 1.35 : 1);

  function paintHeart(x, y) {
    const nx = (x - 17.5) / 12.5, ny = (y - 9.5) / 8.7, q = nx * nx + ny * ny - .72;
    if (q * q * q - nx * nx * ny * ny * ny < 0) return x < 15 && y < 8 ? pal.white : y > 13 ? "#ff4f91" : pal.pink;
    return (x + y) % 17 === 0 ? pal.fillHi : (x + y) % 2 ? pal.fill2 : pal.fill1;
  }
  function paintBug(x, y) {
    const bg = (x + y) % 2 ? pal.fill2 : pal.fill1;
    if (((x === 16 || x === 20) && y === 5)) return pal.pink;
    if (((x === 15 || x === 21) && y >= 1 && y <= 3) || ((y === 9 || y === 12) && ((x >= 10 && x <= 13) || (x >= 23 && x <= 26)))) return pal.white;
    if (Math.abs(x - 18) <= 3 && y >= 3 && y <= 6) return pal.yellow;
    if (Math.abs(x - 18) <= 5 && y >= 5 && y <= 15) return x % 3 === 0 ? "#65da53" : pal.mint;
    if (y === 16 && x >= 13 && x <= 23) return pal.cyan;
    return bg;
  }
  function paintFace(x, y) {
    const dx = (x - 18) / 11.5, dy = (y - 10) / 8;
    if (dx * dx + dy * dy > 1) return (x + y) % 2 ? pal.fill2 : pal.fill1;
    if ((x >= 13 && x <= 15 && y >= 7 && y <= 9) || (x >= 21 && x <= 23 && y >= 7 && y <= 9)) return pal.white;
    if ((x === 14 || x === 22) && y === 8) return "#0a0d15";
    if (y >= 12 && y <= 14 && x >= 13 && x <= 23 && (y === 14 || x === 13 || x === 23)) return pal.pink;
    return (x + y) % 3 === 0 ? "#59d8f0" : pal.cyan;
  }
  const painters = [paintHeart, paintBug, paintFace];

  function resize() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = Math.min(devicePixelRatio || 1, 2), oldW = WORLD.w;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    canvas.style.width = `${r.width}px`; canvas.style.height = `${r.height}px`;
    WORLD.w = clamp(WORLD.h * r.width / r.height, coarse ? 620 : 760, 2200);
    GRID.width = WORLD.w - Math.min(120, WORLD.w * .16); GRID.left = (WORLD.w - GRID.width) / 2; GRID.cellW = GRID.width / GRID.cols;
    const ratio = WORLD.w / oldW;
    paddle.x *= ratio; paddle.w *= ratio; paddle.targetX *= ratio; state.pointerX *= ratio;
    balls.forEach(b => b.x *= ratio); powerups.forEach(p => p.x *= ratio);
    blocks.forEach(b => { b.x = GRID.left + b.col * GRID.cellW + GRID.gap / 2; b.w = GRID.cellW - GRID.gap; });
    paddle.w = Math.max(paddle.w, paddleWidth()); paddle.x = clamp(paddle.x, 12, WORLD.w - paddle.w - 12);
    view.scale = Math.min(canvas.width / WORLD.w, canvas.height / WORLD.h); view.x = (canvas.width - WORLD.w * view.scale) / 2; view.y = (canvas.height - WORLD.h * view.scale) / 2;
    stars = Array.from({ length: coarse ? 38 : 55 }, () => ({ x: Math.random() * WORLD.w, y: Math.random() * WORLD.h, r: rand(.4, 1.5), a: rand(.12, .5) }));
    syncThumb();
  }

  function buildLevel(i) {
    blocks = [];
    for (let row = 0; row < GRID.rows; row++) for (let col = 0; col < GRID.cols; col++) {
      blocks.push({ col, row, x: GRID.left + col * GRID.cellW + GRID.gap / 2, y: GRID.top + row * GRID.cellH + GRID.gap / 2,
        w: GRID.cellW - GRID.gap, h: GRID.cellH - GRID.gap, color: painters[i](col, row), alive: true });
    }
    state.totalBlocks = state.blocksLeft = blocks.length; powerups = []; particles = []; popups = []; resetBall(true); updateUI();
  }

  function resetBall(attached = true) { balls = [{ x: paddle.x + paddle.w / 2, y: paddle.y - 18, vx: rand(-60, 60), vy: -cfg.speed, r: cfg.ballR, attached, trail: [] }]; }
  function launch() {
    const b = balls.find(x => x.attached); if (!b) return;
    const a = rand(-.35, .35), s = cfg.speed + state.level * 15; b.attached = false; b.vx = Math.sin(a) * s; b.vy = -Math.cos(a) * s;
  }
  function start() {
    state.score = 0; state.lives = cfg.lives; state.level = 0; paddle.w = paddleWidth(); paddle.x = WORLD.w / 2 - paddle.w / 2; paddle.targetX = WORLD.w / 2;
    buildLevel(0); state.mode = "playing"; ui.startOverlay.classList.remove("is-visible"); ui.stateOverlay.classList.remove("is-visible"); launch(); updateUI();
  }
  function saveBest() { state.best = Math.max(state.best, state.score); store.set("breakwaveBest", state.best); }
  function showState(tag, title, text, primary, secondary = true) {
    ui.stateTag.textContent = tag; ui.stateTitle.textContent = title; ui.stateText.textContent = text; ui.statePrimary.innerHTML = `${primary} <span>→</span>`;
    ui.stateSecondary.style.display = secondary ? "block" : "none"; ui.stateOverlay.classList.add("is-visible");
  }
  function pause(force) {
    if (!["playing", "paused"].includes(state.mode)) return;
    const on = typeof force === "boolean" ? force : state.mode === "playing"; state.mode = on ? "paused" : "playing";
    if (on) showState("PAUSED", "Run paused", "Your run is safe. Resume when you're ready.", "Resume", false); else { ui.stateOverlay.classList.remove("is-visible"); state.last = performance.now(); }
  }
  function gameOver() { state.mode = "gameover"; saveBest(); showState("RUN OVER", "Out of lives", `You scored ${state.score.toLocaleString()}. One more run?`, "Play again"); }
  function levelClear() {
    state.score += 800; saveBest(); updateUI(); state.mode = "levelclear"; state.transition = 1.1; popups.push({ x: WORLD.w / 2, y: 470, text: "LEVEL CLEAR +800", life: 1.1, big: true, color: pal.mint });
  }
  function nextLevel() {
    state.level++;
    if (state.level >= painters.length) { state.mode = "victory"; saveBest(); showState("COMPLETE", "Perfect shatter", `Final score: ${state.score.toLocaleString()}.`, "Play again"); return; }
    paddle.w = paddleWidth(); buildLevel(state.level); state.mode = "playing"; launch();
  }
  function updateUI() {
    ui.score.textContent = state.score.toLocaleString(); ui.best.textContent = state.best.toLocaleString(); ui.level.textContent = `${Math.min(state.level + 1, painters.length)}/${painters.length}`;
    ui.lives.textContent = Array.from({ length: cfg.lives }, (_, i) => i < state.lives ? "●" : "○").join(" ");
    const pct = state.totalBlocks ? state.blocksLeft / state.totalBlocks * 100 : 100; ui.progress.textContent = `${pct >= 99.95 ? "100" : pct.toFixed(pct >= 10 ? 1 : 0)}%`;
    ui.fill.style.width = `${Math.max(0, pct)}%`; ui.track.setAttribute("aria-valuenow", String(Math.round(pct)));
  }

  function hitRect(ball, r) { const x = clamp(ball.x, r.x, r.x + r.w), y = clamp(ball.y, r.y, r.y + r.h), dx = ball.x - x, dy = ball.y - y; return dx * dx + dy * dy <= ball.r * ball.r; }
  function shatter(b) {
    b.alive = false; state.blocksLeft--; state.score += 10; updateUI();
    for (let i = 0; i < 4; i++) particles.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, vx: rand(-90, 90), vy: rand(-80, 30), life: .35, color: b.color });
    if (Math.random() < .018 && powerups.length < 2) powerups.push({ x: b.x + b.w / 2, y: b.y + b.h / 2, r: coarse ? 17 : 15, vy: 105 });
    if (state.blocksLeft <= 0) levelClear();
  }
  function updateBall(b, dt) {
    if (b.attached) { b.x = paddle.x + paddle.w / 2; b.y = paddle.y - b.r - 3; return true; }
    b.trail.unshift({ x: b.x, y: b.y }); if (b.trail.length > 6) b.trail.pop();
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.vx), Math.abs(b.vy)) * dt / 7)), sd = dt / steps;
    for (let s = 0; s < steps; s++) {
      const px = b.x, py = b.y; b.x += b.vx * sd; b.y += b.vy * sd;
      if (b.x - b.r < 10) { b.x = 10 + b.r; b.vx = Math.abs(b.vx); } if (b.x + b.r > WORLD.w - 10) { b.x = WORLD.w - 10 - b.r; b.vx = -Math.abs(b.vx); } if (b.y - b.r < 10) { b.y = 10 + b.r; b.vy = Math.abs(b.vy); }
      if (b.vy > 0 && hitRect(b, paddle)) { const hit = clamp((b.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2), -1, 1), sp = clamp(Math.hypot(b.vx, b.vy) * 1.012, cfg.speed, coarse ? 550 : 590); b.y = paddle.y - b.r; b.vx = hit * sp * .82; b.vy = -Math.sqrt(Math.max(sp * sp - b.vx * b.vx, sp * sp * .25)); }
      const c0 = clamp(Math.floor((b.x - b.r - GRID.left) / GRID.cellW) - 1, 0, GRID.cols - 1), c1 = clamp(Math.floor((b.x + b.r - GRID.left) / GRID.cellW) + 1, 0, GRID.cols - 1), r0 = clamp(Math.floor((b.y - b.r - GRID.top) / GRID.cellH) - 1, 0, GRID.rows - 1), r1 = clamp(Math.floor((b.y + b.r - GRID.top) / GRID.cellH) + 1, 0, GRID.rows - 1);
      let hit = null; for (let r = r0; r <= r1 && !hit; r++) for (let c = c0; c <= c1; c++) { const block = blocks[r * GRID.cols + c]; if (block?.alive && hitRect(b, block)) { hit = block; break; } }
      if (hit) { const vert = py + b.r <= hit.y || py - b.r >= hit.y + hit.h; if (vert) b.vy *= -1; else b.vx *= -1; b.x = px; b.y = py; shatter(hit); break; }
    }
    return b.y - b.r <= WORLD.h + 20;
  }

  function update(dt) {
    if (state.mode === "levelclear") { state.transition -= dt; if (state.transition <= 0) nextLevel(); }
    if (state.mode !== "playing") return updateFx(dt);
    const dir = (state.keys.right ? 1 : 0) - (state.keys.left ? 1 : 0);
    if (dir) { paddle.x = clamp(paddle.x + dir * (coarse ? 760 : 650) * dt, 12, WORLD.w - paddle.w - 12); paddle.targetX = paddle.x + paddle.w / 2; }
    else { const target = state.pointerActive ? state.pointerX : paddle.targetX, left = clamp(target - paddle.w / 2, 12, WORLD.w - paddle.w - 12); paddle.x += (left - paddle.x) * Math.min(1, dt * (coarse ? 22 : 16)); paddle.targetX = paddle.x + paddle.w / 2; }
    balls = balls.filter(b => updateBall(b, dt));
    if (!balls.length) { state.lives--; updateUI(); if (state.lives <= 0) gameOver(); else { resetBall(true); popups.push({ x: WORLD.w / 2, y: 480, text: "TAP TO LAUNCH", life: 1.2, color: pal.white }); } }
    for (let i = powerups.length - 1; i >= 0; i--) { const p = powerups[i]; p.y += p.vy * dt; if (p.y + p.r >= paddle.y && p.x >= paddle.x - p.r && p.x <= paddle.x + paddle.w + p.r) { const src = balls.slice(); src.forEach(b => [-.4,.4].forEach(a => { if (balls.length < 30) { const sp = Math.hypot(b.vx,b.vy), ang = Math.atan2(b.vy,b.vx)+a; balls.push({ x:b.x,y:b.y,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,r:cfg.ballR,attached:false,trail:[] }); } })); powerups.splice(i,1); popups.push({x:p.x,y:p.y,text:"MULTIBALL ×3",life:1,color:pal.yellow,big:true}); } else if (p.y > WORLD.h + 30) powerups.splice(i,1); }
    updateFx(dt); syncThumb();
  }
  function updateFx(dt) { particles.forEach(p => { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 80 * dt; }); particles = particles.filter(p => p.life > 0); popups.forEach(p => { p.life -= dt; p.y -= 22 * dt; }); popups = popups.filter(p => p.life > 0); }

  function render() {
    ctx.setTransform(1,0,0,1,0,0); ctx.fillStyle = pal.bg; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.setTransform(view.scale,0,0,view.scale,view.x,view.y);
    const g = ctx.createLinearGradient(0,0,0,WORLD.h); g.addColorStop(0,"#0d1120"); g.addColorStop(1,"#080b13"); ctx.fillStyle = g; ctx.fillRect(0,0,WORLD.w,WORLD.h);
    stars.forEach(s => { ctx.globalAlpha = s.a; ctx.fillStyle = "#dceaff"; ctx.beginPath(); ctx.arc(s.x,s.y,s.r,0,Math.PI*2); ctx.fill(); }); ctx.globalAlpha = 1;
    blocks.forEach(b => { if (b.alive) { ctx.fillStyle = b.color; ctx.fillRect(b.x,b.y,b.w,b.h); } });
    particles.forEach(p => { ctx.globalAlpha = clamp(p.life / .35,0,1); ctx.fillStyle = p.color; ctx.fillRect(p.x-2,p.y-2,4,4); }); ctx.globalAlpha = 1;
    powerups.forEach(p => { ctx.fillStyle = "#1c1a11"; ctx.strokeStyle = pal.yellow; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill(); ctx.stroke(); ctx.fillStyle = pal.yellow; ctx.font = "900 12px system-ui"; ctx.textAlign="center"; ctx.fillText("×3",p.x,p.y+4); });
    const pg = ctx.createLinearGradient(paddle.x,paddle.y,paddle.x+paddle.w,paddle.y); pg.addColorStop(0,pal.cyan); pg.addColorStop(.5,pal.white); pg.addColorStop(1,pal.mint); ctx.fillStyle = pg; ctx.shadowColor = pal.mint; ctx.shadowBlur = 16; ctx.beginPath(); ctx.roundRect(paddle.x,paddle.y,paddle.w,paddle.h,8); ctx.fill(); ctx.shadowBlur = 0;
    balls.forEach(b => { b.trail.forEach((t,i) => { ctx.globalAlpha = (1-i/b.trail.length)*.16; ctx.fillStyle = pal.white; ctx.beginPath(); ctx.arc(t.x,t.y,Math.max(1,b.r-i*.7),0,Math.PI*2); ctx.fill(); }); ctx.globalAlpha=1; ctx.fillStyle=pal.mint; ctx.shadowColor="#fff"; ctx.shadowBlur=14; ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill(); ctx.shadowBlur=0; });
    popups.forEach(p => { ctx.globalAlpha=clamp(p.life,0,1); ctx.fillStyle=p.color; ctx.font=`900 ${p.big?22:13}px system-ui`; ctx.textAlign="center"; ctx.fillText(p.text,p.x,p.y); }); ctx.globalAlpha=1; ctx.textAlign="start";
  }

  function loop(now) { const dt = Math.min(.032, Math.max(0,(now-state.last)/1000)); state.last=now; update(dt); render(); requestAnimationFrame(loop); }
  function worldX(clientX) { const r=canvas.getBoundingClientRect(), x=(clientX-r.left)*(canvas.width/Math.max(1,r.width)); return (x-view.x)/view.scale; }
  function setPointer(x, mouse=false) { state.pointerActive=true; state.pointerMouse=mouse; state.pointerX=clamp(x,0,WORLD.w); paddle.targetX=state.pointerX; }
  function safeCapture(el,id){ try{ el.setPointerCapture?.(id); }catch{} } function safeRelease(el,id){ try{ if(el.hasPointerCapture?.(id)) el.releasePointerCapture?.(id); }catch{} }
  function syncThumb(n) { if (!touchThumb) return; const v=n ?? clamp((paddle.x+paddle.w/2)/WORLD.w,0,1); touchThumb.style.left=`${v*100}%`; }
  function touchMove(e) { const tr=touchControl.querySelector(".touch-control__track").getBoundingClientRect(), n=clamp((e.clientX-tr.left)/tr.width,0,1); setPointer(n*WORLD.w); syncThumb(n); }

  stage.addEventListener("pointerdown", e => { if (e.target instanceof Element && e.target.closest(".overlay")) return; e.preventDefault(); safeCapture(stage,e.pointerId); setPointer(worldX(e.clientX),e.pointerType==="mouse"); if(state.mode==="playing") launch(); }, {passive:false});
  stage.addEventListener("pointermove", e => { if(e.pointerType==="mouse"||e.buttons>0||state.pointerActive){e.preventDefault();setPointer(worldX(e.clientX),e.pointerType==="mouse");}}, {passive:false});
  stage.addEventListener("pointerup", e => { if(e.pointerType!=="mouse")state.pointerActive=false;safeRelease(stage,e.pointerId);}); stage.addEventListener("pointercancel",()=>state.pointerActive=false);
  touchControl?.addEventListener("pointerdown", e => { e.preventDefault(); safeCapture(touchControl,e.pointerId); touchMove(e); if(state.mode==="playing")launch(); }, {passive:false});
  touchControl?.addEventListener("pointermove", e => { if(e.buttons>0||state.pointerActive||e.pointerType!=="mouse"){e.preventDefault();touchMove(e);}}, {passive:false});
  touchControl?.addEventListener("pointerup", e => {state.pointerActive=false;safeRelease(touchControl,e.pointerId);}); touchControl?.addEventListener("pointercancel",()=>state.pointerActive=false);

  addEventListener("keydown", e => { if(["ArrowLeft","ArrowRight","Space"].includes(e.code))e.preventDefault(); if(e.code==="ArrowLeft"||e.code==="KeyA"){state.keys.left=true;state.pointerActive=false;} if(e.code==="ArrowRight"||e.code==="KeyD"){state.keys.right=true;state.pointerActive=false;} if(e.code==="Space"&&!e.repeat){if(state.mode==="playing"&&balls.some(b=>b.attached))launch();else pause();} if(e.code==="KeyR"&&!e.repeat)start(); if(e.code==="KeyF"&&!e.repeat)fullscreen(); }, {passive:false});
  addEventListener("keyup", e => {if(e.code==="ArrowLeft"||e.code==="KeyA")state.keys.left=false;if(e.code==="ArrowRight"||e.code==="KeyD")state.keys.right=false;});
  const interrupt=()=>{state.keys.left=state.keys.right=false;state.pointerActive=false;if(state.mode==="playing")pause(true);}; addEventListener("blur",interrupt); document.addEventListener("visibilitychange",()=>{if(document.hidden)interrupt();}); addEventListener("resize",resize); addEventListener("orientationchange",()=>setTimeout(resize,80)); visualViewport?.addEventListener("resize",resize);
  function fullscreen(){if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});else ui.card.requestFullscreen?.().catch(()=>{});} document.addEventListener("fullscreenchange",()=>requestAnimationFrame(resize));

  ui.start.addEventListener("click",start); ui.pause.addEventListener("click",()=>pause()); ui.restart.addEventListener("click",start); ui.fullscreen.addEventListener("click",fullscreen); ui.stateSecondary.addEventListener("click",start);
  ui.statePrimary.addEventListener("click",()=>{if(state.mode==="paused")pause(false);else if(state.mode==="gameover"||state.mode==="victory")start();});
  ui.sound.addEventListener("click",()=>{state.sound=!state.sound;store.set("breakwaveSound",state.sound?"on":"off");ui.sound.classList.toggle("muted",!state.sound);ui.sound.setAttribute("aria-label",state.sound?"Mute sound":"Turn sound on");});
  ui.sound.classList.toggle("muted",!state.sound); resize(); paddle.w=paddleWidth(); paddle.x=WORLD.w/2-paddle.w/2; paddle.targetX=WORLD.w/2; buildLevel(0); updateUI(); syncThumb(); requestAnimationFrame(loop);
})();
