(() => {
  "use strict";

  const canvas = document.getElementById("gameCanvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas 2D is not supported by this browser.");
  const stage = document.getElementById("stageWrap");

  const ui = {
    score: document.getElementById("scoreValue"),
    best: document.getElementById("bestValue"),
    level: document.getElementById("levelValue"),
    lives: document.getElementById("livesValue"),
    progress: document.getElementById("progressValue"),
    progressFill: document.getElementById("progressFill"),
    progressTrack: document.querySelector(".progress-track"),
    startOverlay: document.getElementById("startOverlay"),
    startBtn: document.getElementById("startBtn"),
    stateOverlay: document.getElementById("stateOverlay"),
    stateTag: document.getElementById("stateTag"),
    stateTitle: document.getElementById("stateTitle"),
    stateText: document.getElementById("stateText"),
    statePrimary: document.getElementById("statePrimaryBtn"),
    stateSecondary: document.getElementById("stateSecondaryBtn"),
    pauseBtn: document.getElementById("pauseBtn"),
    restartBtn: document.getElementById("restartBtn"),
    soundBtn: document.getElementById("soundBtn")
  };

  const WORLD = { w: 960, h: 600 };
  const GRID = { cols: 36, rows: 20, left: 78, top: 58, width: 804, height: 312, gap: 1.35 };
  GRID.cellW = GRID.width / GRID.cols;
  GRID.cellH = GRID.height / GRID.rows;

  const settings = {
    ballRadius: 6.2,
    baseBallSpeed: 390,
    paddleY: 548,
    paddleW: 132,
    paddleH: 14,
    paddleSpeed: 650,
    maxBalls: 30,
    powerupChance: 0.018,
    startingLives: 3
  };

  const safeStorage = {
    get(key, fallback = null) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, String(value)); } catch {} }
  };

  const view = { scale: 1, offsetX: 0, offsetY: 0 };

  const state = {
    mode: "ready", // ready | playing | paused | levelclear | gameover | victory
    score: 0,
    best: Number(safeStorage.get("pixelShatterBest", 0) || 0),
    lives: settings.startingLives,
    level: 0,
    combo: 0,
    comboTimer: 0,
    lastTime: performance.now(),
    shake: 0,
    sound: safeStorage.get("pixelShatterSound", "on") !== "off",
    keys: { left: false, right: false },
    pointerActive: false,
    pointerX: WORLD.w / 2,
    transitionTimer: 0,
    flash: 0,
    totalBlocks: 0,
    blocksLeft: 0,
    levelStartedAt: 0,
    destroyedThisLevel: 0,
    nextPowerAt: 14
  };

  const paddle = { x: WORLD.w / 2 - settings.paddleW / 2, y: settings.paddleY, w: settings.paddleW, h: settings.paddleH, targetX: WORLD.w / 2 };
  let balls = [];
  let blocks = [];
  let particles = [];
  let powerups = [];
  let popups = [];
  let stars = [];
  let audioCtx = null;

  const palette = {
    bg: "#090c16", grid: "#171c2b", grid2: "#1b2132", white: "#e9f0ff", mint: "#9bff6a",
    cyan: "#5ee7ff", pink: "#ff72c6", yellow: "#ffd36b", purple: "#a88bff", red: "#ff6b7a"
  };

  const levels = [
    { name: "HEARTBEAT", painter: paintHeart, tint: palette.pink },
    { name: "SPACE BUG", painter: paintBug, tint: palette.mint },
    { name: "ARCADE FACE", painter: paintFace, tint: palette.cyan }
  ];

  function ensureAudio() {
    if (!state.sound) return null;
    if (!audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) audioCtx = new AudioContext();
    }
    if (audioCtx?.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  function tone(freq, duration = .04, type = "sine", volume = .03, slide = 0) {
    const ac = ensureAudio();
    if (!ac) return;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ac.currentTime);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), ac.currentTime + duration);
    gain.gain.setValueAtTime(volume, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + duration);
    osc.connect(gain).connect(ac.destination);
    osc.start(); osc.stop(ac.currentTime + duration);
  }

  function random(min, max) { return min + Math.random() * (max - min); }
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function dist2(x1, y1, x2, y2) { const dx = x1 - x2, dy = y1 - y2; return dx * dx + dy * dy; }

  function resize() {
    const rect = stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    view.scale = Math.min(canvas.width / WORLD.w, canvas.height / WORLD.h);
    view.offsetX = (canvas.width - WORLD.w * view.scale) / 2;
    view.offsetY = (canvas.height - WORLD.h * view.scale) / 2;
  }

  function initStars() {
    stars = Array.from({ length: 55 }, () => ({ x: Math.random() * WORLD.w, y: Math.random() * WORLD.h, r: random(.4, 1.5), a: random(.12, .5) }));
  }

  function cellColor(base, x, y) {
    const center = 1 - Math.min(1, Math.hypot((x - GRID.cols / 2) / GRID.cols, (y - GRID.rows / 2) / GRID.rows));
    return { color: base, alpha: .74 + center * .24 };
  }

  function paintHeart(x, y) {
    const nx = (x - 17.5) / 12.5, ny = (y - 9.5) / 8.7;
    const xx = nx * nx + ny * ny - 0.72;
    const inside = (xx * xx * xx - nx * nx * ny * ny * ny) < 0;
    if (inside) {
      const hi = x < 15 && y < 8;
      return hi ? palette.white : (y > 13 ? "#ff4f91" : palette.pink);
    }
    if ((x + y) % 17 === 0 || (x * 3 + y) % 29 === 0) return "#293047";
    return (x + y) % 2 ? "#161b2a" : "#141927";
  }

  function paintBug(x, y) {
    const bg = (x + y) % 2 ? "#151a28" : "#181e2d";
    const cx = 18, cy = 10;
    const body = Math.abs(x - cx) <= 5 && y >= 5 && y <= 15;
    const head = Math.abs(x - cx) <= 3 && y >= 3 && y <= 6;
    const eyeL = (x === 16 && y === 5), eyeR = (x === 20 && y === 5);
    const legs = ((y === 9 || y === 12) && (x >= 10 && x <= 13 || x >= 23 && x <= 26));
    const antenna = ((x === 15 && y <= 3 && y >= 1) || (x === 21 && y <= 3 && y >= 1));
    if (eyeL || eyeR) return palette.pink;
    if (antenna || legs) return palette.white;
    if (head) return palette.yellow;
    if (body) return x % 3 === 0 ? "#65da53" : palette.mint;
    if (y === 16 && x >= 13 && x <= 23) return palette.cyan;
    return bg;
  }

  function paintFace(x, y) {
    const cx = 18, cy = 10;
    const dx = (x - cx) / 11.5, dy = (y - cy) / 8;
    const inside = dx * dx + dy * dy <= 1;
    if (!inside) return (x + y) % 2 ? "#151a28" : "#181e2d";
    if ((x >= 13 && x <= 15 && y >= 7 && y <= 9) || (x >= 21 && x <= 23 && y >= 7 && y <= 9)) return palette.white;
    if ((x === 14 || x === 22) && y === 8) return "#0a0d15";
    if (y >= 12 && y <= 14 && x >= 13 && x <= 23 && (y === 14 || x === 13 || x === 23)) return palette.pink;
    return (x + y) % 3 === 0 ? "#59d8f0" : palette.cyan;
  }

  function buildLevel(index) {
    const level = levels[index % levels.length];
    blocks = [];
    for (let row = 0; row < GRID.rows; row++) {
      for (let col = 0; col < GRID.cols; col++) {
        const color = level.painter(col, row);
        const cc = cellColor(color, col, row);
        blocks.push({
          col, row,
          x: GRID.left + col * GRID.cellW + GRID.gap / 2,
          y: GRID.top + row * GRID.cellH + GRID.gap / 2,
          w: GRID.cellW - GRID.gap,
          h: GRID.cellH - GRID.gap,
          alive: true,
          color: cc.color,
          alpha: cc.alpha,
          hit: 0
        });
      }
    }
    state.totalBlocks = blocks.length;
    state.blocksLeft = blocks.length;
    state.destroyedThisLevel = 0;
    state.nextPowerAt = 14;
    powerups.length = 0; particles.length = 0; popups.length = 0;
    resetBall(true);
    updateUI();
  }

  function resetBall(onPaddle = true) {
    balls = [{
      x: paddle.x + paddle.w / 2,
      y: paddle.y - 16,
      vx: random(-70, 70),
      vy: -settings.baseBallSpeed,
      r: settings.ballRadius,
      trail: [],
      attached: onPaddle
    }];
  }

  function launchBall() {
    const b = balls[0];
    if (b?.attached) {
      b.attached = false;
      const angle = random(-.35, .35);
      const s = settings.baseBallSpeed + state.level * 15;
      b.vx = Math.sin(angle) * s;
      b.vy = -Math.cos(angle) * s;
      tone(520, .06, "triangle", .025, 160);
    }
  }

  function startGame() {
    state.score = 0; state.lives = settings.startingLives; state.level = 0; state.combo = 0;
    paddle.w = settings.paddleW; paddle.x = WORLD.w / 2 - paddle.w / 2;
    buildLevel(state.level);
    state.mode = "playing";
    state.levelStartedAt = performance.now();
    ui.startOverlay.classList.remove("is-visible");
    ui.stateOverlay.classList.remove("is-visible");
    launchBall();
    ensureAudio();
    updateUI();
  }

  function restartGame() { startGame(); }

  function togglePause(force) {
    if (!["playing", "paused"].includes(state.mode)) return;
    const pause = typeof force === "boolean" ? force : state.mode === "playing";
    state.mode = pause ? "paused" : "playing";
    if (pause) {
      showState("PAUSED", "Run paused", "The pixels will still be here.", "Resume", false);
    } else {
      ui.stateOverlay.classList.remove("is-visible");
      state.lastTime = performance.now();
    }
  }

  function showState(tag, title, text, primary, secondary = true) {
    ui.stateTag.textContent = tag;
    ui.stateTitle.textContent = title;
    ui.stateText.textContent = text;
    ui.statePrimary.innerHTML = `${primary} <span>→</span>`;
    ui.stateSecondary.style.display = secondary ? "block" : "none";
    ui.stateOverlay.classList.add("is-visible");
  }

  function gameOver() {
    state.mode = "gameover";
    saveBest();
    tone(180, .35, "sawtooth", .025, -90);
    showState("RUN OVER", "Out of lives", `You scored ${state.score.toLocaleString()}. One more run?`, "Play again");
  }

  function completeLevel() {
    if (state.mode !== "playing") return;
    state.mode = "levelclear";
    state.transitionTimer = 1.55;
    const bonus = Math.max(500, 1600 - Math.round((performance.now() - state.levelStartedAt) / 1000) * 25);
    state.score += bonus;
    state.flash = 1;
    saveBest();
    tone(680, .12, "triangle", .04, 250);
    setTimeout(() => tone(920, .16, "triangle", .035, 220), 90);
    popups.push({ x: WORLD.w / 2, y: 440, text: `CLEAR +${bonus}`, life: 1.4, max: 1.4, big: true, color: palette.mint });
    updateUI();
  }

  function nextLevel() {
    state.level++;
    if (state.level >= levels.length) {
      state.mode = "victory";
      saveBest();
      showState("COMPLETE", "Perfect shatter", `All ${levels.length} artworks cleared. Final score: ${state.score.toLocaleString()}.`, "Play again");
      return;
    }
    paddle.w = settings.paddleW;
    buildLevel(state.level);
    state.mode = "playing";
    state.levelStartedAt = performance.now();
    launchBall();
  }

  function saveBest() {
    if (state.score > state.best) {
      state.best = state.score;
      safeStorage.set("pixelShatterBest", state.best);
    }
  }

  function updateUI() {
    ui.score.textContent = state.score.toLocaleString();
    ui.best.textContent = state.best.toLocaleString();
    ui.level.textContent = `${Math.min(state.level + 1, levels.length)}/${levels.length}`;
    ui.lives.textContent = Array.from({ length: settings.startingLives }, (_, i) => i < state.lives ? "●" : "○").join(" ");
    ui.lives.setAttribute("aria-label", `${state.lives} ${state.lives === 1 ? "life" : "lives"}`);
    const pctExact = state.totalBlocks ? (state.blocksLeft / state.totalBlocks) * 100 : 100;
    const pctLabel = pctExact >= 99.95 ? "100" : (pctExact >= 10 ? pctExact.toFixed(1) : pctExact.toFixed(0));
    ui.progress.textContent = `${pctLabel}%`;
    ui.progressFill.style.width = `${pctExact}%`;
    ui.progressTrack.setAttribute("aria-valuenow", String(Math.round(pctExact)));
  }

  function spawnParticles(x, y, color, count = 8, power = 1) {
    const allowed = Math.min(count, 220 - particles.length);
    for (let i = 0; i < allowed; i++) {
      const a = random(0, Math.PI * 2), speed = random(45, 150) * power;
      particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: random(.22, .55), max: .55, size: random(1.8, 4.8), color });
    }
  }

  function maybeSpawnPowerup(x, y) {
    if (powerups.length >= 2 || balls.length >= settings.maxBalls) return;
    const guaranteed = state.destroyedThisLevel >= state.nextPowerAt;
    if (guaranteed || Math.random() < settings.powerupChance) {
      powerups.push({ x, y, r: 15, vy: 105, spin: 0, type: "multi" });
      state.nextPowerAt = state.destroyedThisLevel + Math.round(random(70, 105));
    }
  }

  function triggerMultiball(x, y) {
    const sources = balls.length ? balls.slice() : [{ x: paddle.x + paddle.w/2, y: paddle.y - 30, vx: 0, vy: -settings.baseBallSpeed }];
    for (const source of sources) {
      if (balls.length >= settings.maxBalls) break;
      const speed = Math.hypot(source.vx, source.vy) || settings.baseBallSpeed;
      const baseAngle = Math.atan2(source.vy, source.vx);
      for (const delta of [-0.42, 0.42]) {
        if (balls.length >= settings.maxBalls) break;
        const a = baseAngle + delta;
        balls.push({ x: source.x, y: source.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: settings.ballRadius, trail: [], attached: false });
      }
    }
    spawnParticles(x, y, palette.yellow, 22, 1.7);
    popups.push({ x, y: y - 16, text: "MULTIBALL ×3", life: 1.1, max: 1.1, big: true, color: palette.yellow });
    state.shake = .5;
    tone(760, .12, "square", .025, 420);
  }

  function circleRectCollision(ball, rect) {
    const nx = clamp(ball.x, rect.x, rect.x + rect.w);
    const ny = clamp(ball.y, rect.y, rect.y + rect.h);
    return dist2(ball.x, ball.y, nx, ny) <= ball.r * ball.r;
  }

  function destroyBlock(block, ball) {
    block.alive = false;
    state.blocksLeft--;
    state.destroyedThisLevel++;
    state.combo++;
    state.comboTimer = 1.15;
    const multiplier = 1 + Math.min(4, Math.floor(state.combo / 8));
    state.score += 10 * multiplier;
    const cx = block.x + block.w / 2, cy = block.y + block.h / 2;
    spawnParticles(cx, cy, block.color, 7, 1);
    maybeSpawnPowerup(cx, cy);
    if (state.combo > 0 && state.combo % 12 === 0) {
      popups.push({ x: cx, y: cy, text: `×${multiplier} COMBO`, life: .8, max: .8, big: false, color: palette.cyan });
    }
    if (state.combo % 4 === 0) tone(430 + Math.min(400, state.combo * 9), .035, "triangle", .012, 70);
    updateUI();
    if (state.blocksLeft <= 0) completeLevel();
  }

  function updateBall(ball, dt) {
    if (ball.attached) {
      ball.x = paddle.x + paddle.w / 2;
      ball.y = paddle.y - ball.r - 3;
      return true;
    }

    ball.trail.unshift({ x: ball.x, y: ball.y });
    if (ball.trail.length > 8) ball.trail.pop();

    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(ball.vx), Math.abs(ball.vy)) * dt / 7));
    const stepDt = dt / steps;
    for (let s = 0; s < steps; s++) {
      const prevX = ball.x, prevY = ball.y;
      ball.x += ball.vx * stepDt;
      ball.y += ball.vy * stepDt;

      if (ball.x - ball.r < 10) { ball.x = 10 + ball.r; ball.vx = Math.abs(ball.vx); tone(230, .025, "sine", .008); }
      if (ball.x + ball.r > WORLD.w - 10) { ball.x = WORLD.w - 10 - ball.r; ball.vx = -Math.abs(ball.vx); tone(230, .025, "sine", .008); }
      if (ball.y - ball.r < 10) { ball.y = 10 + ball.r; ball.vy = Math.abs(ball.vy); tone(260, .025, "sine", .008); }

      if (ball.vy > 0 && circleRectCollision(ball, paddle)) {
        ball.y = paddle.y - ball.r - .5;
        const hit = clamp((ball.x - (paddle.x + paddle.w / 2)) / (paddle.w / 2), -1, 1);
        const speed = clamp(Math.hypot(ball.vx, ball.vy) * 1.012, settings.baseBallSpeed, 590);
        ball.vx = hit * speed * .82;
        ball.vy = -Math.sqrt(Math.max(speed * speed - ball.vx * ball.vx, speed * speed * .25));
        state.combo = 0;
        spawnParticles(ball.x, paddle.y, palette.mint, 5, .55);
        tone(340, .04, "triangle", .018, 80);
      }

      // Search only cells near the ball instead of all 720 blocks.
      const minCol = clamp(Math.floor((ball.x - ball.r - GRID.left) / GRID.cellW) - 1, 0, GRID.cols - 1);
      const maxCol = clamp(Math.floor((ball.x + ball.r - GRID.left) / GRID.cellW) + 1, 0, GRID.cols - 1);
      const minRow = clamp(Math.floor((ball.y - ball.r - GRID.top) / GRID.cellH) - 1, 0, GRID.rows - 1);
      const maxRow = clamp(Math.floor((ball.y + ball.r - GRID.top) / GRID.cellH) + 1, 0, GRID.rows - 1);
      let hitBlock = null;
      for (let row = minRow; row <= maxRow && !hitBlock; row++) {
        for (let col = minCol; col <= maxCol; col++) {
          const block = blocks[row * GRID.cols + col];
          if (block?.alive && circleRectCollision(ball, block)) { hitBlock = block; break; }
        }
      }
      if (hitBlock) {
        const crossedFromTop = prevY + ball.r <= hitBlock.y;
        const crossedFromBottom = prevY - ball.r >= hitBlock.y + hitBlock.h;
        const crossedFromLeft = prevX + ball.r <= hitBlock.x;
        const crossedFromRight = prevX - ball.r >= hitBlock.x + hitBlock.w;
        if (crossedFromTop || crossedFromBottom) ball.vy *= -1;
        else if (crossedFromLeft || crossedFromRight) ball.vx *= -1;
        else ball.vy *= -1;
        ball.x = prevX; ball.y = prevY;
        destroyBlock(hitBlock, ball);
        break;
      }
    }

    return ball.y - ball.r <= WORLD.h + 20;
  }

  function update(dt) {
    if (state.mode === "levelclear") {
      state.transitionTimer -= dt;
      state.flash = Math.max(0, state.flash - dt * 1.8);
      updateFx(dt);
      if (state.transitionTimer <= 0) nextLevel();
      return;
    }
    if (state.mode !== "playing") { updateFx(dt); return; }

    const keyDir = (state.keys.right ? 1 : 0) - (state.keys.left ? 1 : 0);
    if (keyDir !== 0) {
      paddle.x = clamp(paddle.x + keyDir * settings.paddleSpeed * dt, 12, WORLD.w - 12 - paddle.w);
      paddle.targetX = paddle.x + paddle.w / 2;
    } else {
      const desired = state.pointerActive ? state.pointerX : paddle.targetX;
      const targetLeft = clamp(desired - paddle.w / 2, 12, WORLD.w - 12 - paddle.w);
      paddle.x += (targetLeft - paddle.x) * Math.min(1, dt * 16);
      paddle.targetX = paddle.x + paddle.w / 2;
    }

    if (state.comboTimer > 0) state.comboTimer -= dt;
    else state.combo = 0;

    balls = balls.filter(ball => updateBall(ball, dt));
    if (balls.length === 0 && state.mode === "playing") {
      state.lives--;
      updateUI();
      if (state.lives <= 0) gameOver();
      else {
        state.combo = 0;
        resetBall(true);
        popups.push({ x: WORLD.w/2, y: 475, text: "TAP TO LAUNCH", life: 1.4, max: 1.4, big: false, color: palette.white });
        tone(150, .12, "sine", .025, -40);
      }
    }

    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.y += p.vy * dt; p.spin += dt * 3;
      if (p.y + p.r >= paddle.y && p.y - p.r <= paddle.y + paddle.h && p.x >= paddle.x - p.r && p.x <= paddle.x + paddle.w + p.r) {
        triggerMultiball(p.x, p.y); powerups.splice(i, 1); continue;
      }
      if (p.y > WORLD.h + 30) powerups.splice(i, 1);
    }

    updateFx(dt);
  }

  function updateFx(dt) {
    state.shake = Math.max(0, state.shake - dt * 2.8);
    state.flash = Math.max(0, state.flash - dt * 2);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= .985; p.vy = p.vy * .985 + 52 * dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i]; p.life -= dt; p.y -= 23 * dt;
      if (p.life <= 0) popups.splice(i, 1);
    }
  }

  function roundedRectPath(x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y); ctx.arcTo(x+w, y, x+w, y+h, rr); ctx.arcTo(x+w, y+h, x, y+h, rr); ctx.arcTo(x, y+h, x, y, rr); ctx.arcTo(x, y, x+w, y, rr); ctx.closePath();
  }

  function renderBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, WORLD.h);
    g.addColorStop(0, "#0d1120"); g.addColorStop(1, "#080b13");
    ctx.fillStyle = g; ctx.fillRect(0, 0, WORLD.w, WORLD.h);
    for (const s of stars) { ctx.globalAlpha = s.a; ctx.fillStyle = "#dceaff"; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill(); }
    ctx.globalAlpha = 1;

    const glow = ctx.createRadialGradient(WORLD.w/2, 210, 0, WORLD.w/2, 210, 430);
    glow.addColorStop(0, "rgba(94,231,255,.08)"); glow.addColorStop(1, "rgba(94,231,255,0)");
    ctx.fillStyle = glow; ctx.fillRect(0,0,WORLD.w,WORLD.h);

    ctx.fillStyle = "rgba(255,255,255,.035)";
    roundedRectPath(55, 35, 850, 360, 21); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.lineWidth = 1; ctx.stroke();

    ctx.fillStyle = "rgba(255,255,255,.52)"; ctx.font = "800 10px system-ui"; ctx.letterSpacing = "2px";
    ctx.fillText(levels[state.level % levels.length].name, 76, 54);
  }

  function renderBlocks() {
    for (const b of blocks) {
      if (!b.alive) continue;
      ctx.globalAlpha = b.alpha;
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.globalAlpha = .16;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(b.x + 1, b.y + 1, Math.max(0, b.w - 2), 1);
    }
    ctx.globalAlpha = 1;
  }

  function renderPaddle() {
    ctx.save();
    ctx.shadowColor = palette.mint; ctx.shadowBlur = 18;
    const grad = ctx.createLinearGradient(paddle.x, 0, paddle.x + paddle.w, 0);
    grad.addColorStop(0, palette.cyan); grad.addColorStop(.55, palette.mint); grad.addColorStop(1, "#d8ff72");
    ctx.fillStyle = grad;
    roundedRectPath(paddle.x, paddle.y, paddle.w, paddle.h, paddle.h/2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,.65)";
    roundedRectPath(paddle.x + 10, paddle.y + 2, paddle.w - 20, 2.3, 2); ctx.fill();
  }

  function renderBalls() {
    for (const b of balls) {
      b.trail.forEach((p, i) => {
        const a = (1 - i / b.trail.length) * .18;
        ctx.globalAlpha = a; ctx.fillStyle = palette.white;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1.2, b.r - i*.6), 0, Math.PI*2); ctx.fill();
      });
      ctx.globalAlpha = 1;
      ctx.save(); ctx.shadowColor = "#ffffff"; ctx.shadowBlur = 16;
      const g = ctx.createRadialGradient(b.x-2,b.y-2,1,b.x,b.y,b.r+1);
      g.addColorStop(0,"#ffffff"); g.addColorStop(.45,"#dfffee"); g.addColorStop(1,palette.mint);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(b.x,b.y,b.r,0,Math.PI*2); ctx.fill(); ctx.restore();
    }
  }

  function renderPowerups() {
    for (const p of powerups) {
      ctx.save();
      ctx.shadowColor = palette.yellow; ctx.shadowBlur = 20;
      ctx.translate(p.x, p.y); ctx.rotate(Math.sin(p.spin) * .08);
      ctx.fillStyle = "#1c1a11"; ctx.strokeStyle = palette.yellow; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0,0,p.r,0,Math.PI*2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = palette.yellow; ctx.font = "900 12px system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("×3",0,.5);
      ctx.restore();
    }
  }

  function renderParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color; ctx.fillRect(p.x - p.size/2, p.y - p.size/2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function renderPopups() {
    ctx.textAlign = "center";
    for (const p of popups) {
      const t = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = Math.min(1, t*2.5);
      ctx.fillStyle = p.color;
      ctx.font = `${p.big ? 900 : 800} ${p.big ? 24 : 13}px system-ui`;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1; ctx.textAlign = "start";
  }

  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);
    ctx.save();
    if (state.shake > 0) ctx.translate(random(-4,4)*state.shake, random(-3,3)*state.shake);
    renderBackground(); renderBlocks(); renderParticles(); renderPowerups(); renderPaddle(); renderBalls(); renderPopups();
    if (state.mode === "levelclear" && state.flash > 0) { ctx.globalAlpha = state.flash * .18; ctx.fillStyle = palette.mint; ctx.fillRect(0,0,WORLD.w,WORLD.h); }
    ctx.restore();
  }

  function frame(now) {
    let dt = (now - state.lastTime) / 1000;
    state.lastTime = now;
    dt = Math.min(.032, Math.max(0, dt));
    update(dt); render();
    requestAnimationFrame(frame);
  }

  function toWorldX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const backingX = (clientX - rect.left) * (canvas.width / Math.max(1, rect.width));
    return (backingX - view.offsetX) / view.scale;
  }

  function handlePointerMove(e) {
    state.pointerActive = true;
    state.pointerX = clamp(toWorldX(e.clientX), 0, WORLD.w);
  }

  stage.addEventListener("pointerdown", e => {
    // Capturing here retargets the compatibility mouse events, which would swallow
    // clicks on the overlay buttons that sit inside the stage.
    if (e.target.closest(".overlay")) return;
    stage.setPointerCapture?.(e.pointerId);
    handlePointerMove(e);
    if (state.mode === "playing" && balls.some(b => b.attached)) launchBall();
  });
  stage.addEventListener("pointermove", e => { if (e.pointerType === "mouse" || e.buttons > 0 || state.pointerActive) handlePointerMove(e); });
  stage.addEventListener("pointerup", e => { if (e.pointerType !== "mouse") state.pointerActive = false; stage.releasePointerCapture?.(e.pointerId); });
  stage.addEventListener("pointercancel", () => { state.pointerActive = false; });
  stage.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") state.pointerActive = false; });

  window.addEventListener("keydown", e => {
    if (["ArrowLeft","ArrowRight","Space"].includes(e.code)) e.preventDefault();
    if (e.code === "ArrowLeft" || e.code === "KeyA") { state.keys.left = true; state.pointerActive = false; }
    if (e.code === "ArrowRight" || e.code === "KeyD") { state.keys.right = true; state.pointerActive = false; }
    if (e.code === "Space" && !e.repeat) {
      if (state.mode === "playing" && balls.some(b => b.attached)) launchBall();
      else togglePause();
    }
    if (e.code === "KeyR" && !e.repeat) restartGame();
  }, { passive: false });
  window.addEventListener("keyup", e => {
    if (e.code === "ArrowLeft" || e.code === "KeyA") state.keys.left = false;
    if (e.code === "ArrowRight" || e.code === "KeyD") state.keys.right = false;
  });
  window.addEventListener("blur", () => { if (state.mode === "playing") togglePause(true); });
  window.addEventListener("resize", resize);

  ui.startBtn.addEventListener("click", startGame);
  ui.pauseBtn.addEventListener("click", () => togglePause());
  ui.restartBtn.addEventListener("click", restartGame);
  ui.stateSecondary.addEventListener("click", restartGame);
  ui.statePrimary.addEventListener("click", () => {
    if (state.mode === "paused") togglePause(false);
    else if (state.mode === "gameover" || state.mode === "victory") restartGame();
  });
  ui.soundBtn.addEventListener("click", () => {
    state.sound = !state.sound;
    safeStorage.set("pixelShatterSound", state.sound ? "on" : "off");
    ui.soundBtn.classList.toggle("muted", !state.sound);
    ui.soundBtn.setAttribute("aria-label", state.sound ? "Mute sound" : "Turn sound on");
    if (state.sound) tone(520, .05, "triangle", .02, 80);
  });

  ui.soundBtn.classList.toggle("muted", !state.sound);
  ui.soundBtn.setAttribute("aria-label", state.sound ? "Mute sound" : "Turn sound on");
  initStars();
  resize();
  buildLevel(0);
  updateUI();
  requestAnimationFrame(frame);
})();
