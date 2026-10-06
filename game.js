(() => {
  'use strict';

  const W = 390;
  const H = 760;
  const SLOT_COUNT = 6;
  const SLOT_GAP = 5;
  const SLOT_MARGIN_X = 11;
  const SLOT_Y = 78;
  const SLOT_H = 112;
  const SLOT_W = (W - SLOT_MARGIN_X * 2 - SLOT_GAP * (SLOT_COUNT - 1)) / SLOT_COUNT;
  const CAR_W = 27;
  const CAR_H = 49;
  const STORAGE_KEY = 'oneTakeGame002.best.v1';

  const titleScreen = document.getElementById('titleScreen');
  const gameScreen = document.getElementById('gameScreen');
  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas.getContext('2d');
  const startButton = document.getElementById('startButton');
  const retryButton = document.getElementById('retryButton');
  const resultPanel = document.getElementById('resultPanel');
  const resultMain = document.getElementById('resultMain');
  const resultSub = document.getElementById('resultSub');
  const bestDisplay = document.getElementById('bestDisplay');
  const swipeHint = document.getElementById('swipeHint');

  const state = {
    screen: 'title',
    phase: 'idle',
    emptyIndex: 0,
    slots: [],
    player: null,
    pointer: null,
    firstRound: true,
    launchedAt: 0,
    lowMotionTime: 0,
    contactOccurred: false,
    lastTs: 0,
    roundSeed: 0,
    best: loadBest(),
    dpr: 1,
    viewW: W,
    viewH: H,
    rafId: 0
  };

  const palette = {
    asphalt: '#737875',
    asphalt2: '#6d726f',
    line: '#f2f0e7',
    lineSoft: 'rgba(242,240,231,.35)',
    dark: '#283033',
    shadow: 'rgba(20,24,25,.18)',
    target: 'rgba(244, 239, 207, .16)',
    targetLine: 'rgba(255,255,255,.24)',
    player: '#e8b85f',
    playerDark: '#c58b35',
    glass: '#8ca9ad',
    tire: '#202527',
    cat: '#c9a77c',
    catDark: '#5a5147',
    box: '#b88954',
    tape: '#d8b17e'
  };

  const parkedColors = [
    ['#6f9ca5', '#527983'],
    ['#c9756d', '#a4544e'],
    ['#778d6d', '#596f50'],
    ['#7e79a8', '#615c8b'],
    ['#bd9467', '#9f744a']
  ];

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function randInt(max) { return Math.floor(Math.random() * max); }
  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function loadBest() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (!parsed || typeof parsed !== 'object') return { rank: 0, cm: null };
      return {
        rank: clamp(Number(parsed.rank) || 0, 0, 3),
        cm: Number.isFinite(parsed.cm) ? Math.max(1, Math.round(parsed.cm)) : null
      };
    } catch (_) {
      return { rank: 0, cm: null };
    }
  }

  function saveBest() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.best)); } catch (_) {}
  }

  function updateBestDisplay() {
    if (state.best.rank >= 3) bestDisplay.textContent = 'BEST PERFECT!';
    else if (state.best.rank === 2) bestDisplay.textContent = 'BEST PARKING!';
    else if (state.best.cm != null) bestDisplay.textContent = `BEST あと${state.best.cm}cm`;
    else bestDisplay.textContent = 'BEST --';
  }

  function resizeCanvas() {
    const rect = gameScreen.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    state.viewW = rect.width;
    state.viewH = rect.height;
    state.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(rect.width * state.dpr));
    canvas.height = Math.max(1, Math.round(rect.height * state.dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }

  function logicalTransform() {
    const sx = state.viewW / W;
    const sy = state.viewH / H;
    ctx.setTransform(state.dpr * sx, 0, 0, state.dpr * sy, 0, 0);
  }

  function makeSlots() {
    state.emptyIndex = randInt(SLOT_COUNT);
    const occupants = shuffle(['car', 'car', 'car', 'cat', 'box']);
    let occCursor = 0;
    let carColorCursor = randInt(parkedColors.length);
    state.slots = [];

    for (let i = 0; i < SLOT_COUNT; i++) {
      const x = SLOT_MARGIN_X + i * (SLOT_W + SLOT_GAP);
      const slot = {
        i,
        x,
        y: SLOT_Y,
        w: SLOT_W,
        h: SLOT_H,
        cx: x + SLOT_W / 2,
        cy: SLOT_Y + SLOT_H / 2,
        type: i === state.emptyIndex ? 'empty' : occupants[occCursor++],
        cat: null,
        obstacle: null
      };

      if (slot.type === 'car') {
        const colors = parkedColors[carColorCursor++ % parkedColors.length];
        slot.obstacle = {
          kind: 'car',
          x: slot.cx,
          y: slot.cy + 1,
          w: CAR_W,
          h: CAR_H,
          angle: (Math.random() - 0.5) * 0.035,
          colors
        };
      } else if (slot.type === 'box') {
        slot.obstacle = {
          kind: 'box',
          x: slot.cx + (Math.random() - 0.5) * 3,
          y: slot.cy + 6,
          w: 31,
          h: 28,
          angle: (Math.random() - 0.5) * 0.16
        };
      } else if (slot.type === 'cat') {
        slot.cat = {
          x: slot.cx,
          y: slot.cy + 8,
          baseX: slot.cx,
          baseY: slot.cy + 8,
          vx: 0,
          vy: 0,
          fled: false,
          fleeT: 0,
          hop: 0
        };
      }
      state.slots.push(slot);
    }
  }

  function resetRound() {
    makeSlots();
    state.phase = 'aim';
    state.contactOccurred = false;
    state.lowMotionTime = 0;
    state.launchedAt = 0;
    state.pointer = null;
    state.roundSeed++;
    state.player = {
      x: W * 0.25,
      y: H - 103,
      vx: 95,
      vy: 0,
      angle: -0.75,
      omega: Math.PI * 2 / 2.55,
      w: CAR_W,
      h: CAR_H,
      movingDir: 1,
      collisionCooldown: 0
    };
    resultPanel.hidden = true;
    swipeHint.hidden = !state.firstRound;
    updateBestDisplay();
  }

  function startGame() {
    state.screen = 'game';
    titleScreen.hidden = true;
    gameScreen.hidden = false;
    resizeCanvas();
    resetRound();
  }

  function retry() {
    state.firstRound = false;
    resetRound();
  }

  function launch() {
    if (state.phase !== 'aim') return;
    state.phase = 'launched';
    state.launchedAt = performance.now() / 1000;
    state.lowMotionTime = 0;
    state.player.vy = -550;
    // Keep the patrol horizontal velocity and live angular velocity unchanged.
    swipeHint.hidden = true;
  }

  function getPointerLogical(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * W / r.width,
      y: (e.clientY - r.top) * H / r.height
    };
  }

  function onPointerDown(e) {
    if (state.screen !== 'game' || state.phase !== 'aim' || state.pointer) return;
    const p = getPointerLogical(e);
    state.pointer = { id: e.pointerId, x0: p.x, y0: p.y, fired: false };
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!state.pointer || state.pointer.id !== e.pointerId || state.phase !== 'aim') return;
    const p = getPointerLogical(e);
    const dx = p.x - state.pointer.x0;
    const dy = p.y - state.pointer.y0;
    const upward = -dy;
    // Upward intent must clearly dominate. Horizontal motion never affects launch direction/power.
    if (!state.pointer.fired && upward >= 42 && upward > Math.abs(dx) * 0.72) {
      state.pointer.fired = true;
      launch();
    }
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (state.pointer && state.pointer.id === e.pointerId) state.pointer = null;
    e.preventDefault();
  }

  function carCorners(car) {
    const hw = car.w / 2;
    const hh = car.h / 2;
    const c = Math.cos(car.angle);
    const s = Math.sin(car.angle);
    const pts = [
      { x: -hw, y: -hh }, { x: hw, y: -hh },
      { x: hw, y: hh }, { x: -hw, y: hh }
    ];
    return pts.map(p => ({
      x: car.x + p.x * c - p.y * s,
      y: car.y + p.x * s + p.y * c
    }));
  }

  function axesForRect(rect) {
    const c = Math.cos(rect.angle || 0);
    const s = Math.sin(rect.angle || 0);
    return [{ x: c, y: s }, { x: -s, y: c }];
  }

  function projectRect(rect, axis) {
    const pts = carCorners(rect);
    let min = Infinity, max = -Infinity;
    for (const p of pts) {
      const d = p.x * axis.x + p.y * axis.y;
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    return { min, max };
  }

  function rectCollision(a, b) {
    const axes = axesForRect(a).concat(axesForRect(b));
    let minOverlap = Infinity;
    let bestAxis = null;
    for (const axis of axes) {
      const pa = projectRect(a, axis);
      const pb = projectRect(b, axis);
      const overlap = Math.min(pa.max, pb.max) - Math.max(pa.min, pb.min);
      if (overlap <= 0) return null;
      if (overlap < minOverlap) {
        minOverlap = overlap;
        bestAxis = { x: axis.x, y: axis.y };
      }
    }
    const centerDX = a.x - b.x;
    const centerDY = a.y - b.y;
    if (centerDX * bestAxis.x + centerDY * bestAxis.y < 0) {
      bestAxis.x *= -1;
      bestAxis.y *= -1;
    }
    return { nx: bestAxis.x, ny: bestAxis.y, depth: minOverlap };
  }

  function resolveObstacleCollision(player, obstacle, col) {
    state.contactOccurred = true;
    player.x += col.nx * (col.depth + 0.7);
    player.y += col.ny * (col.depth + 0.7);

    const vn = player.vx * col.nx + player.vy * col.ny;
    if (vn < 0) {
      const restitution = obstacle.kind === 'box' ? 0.42 : 0.30;
      player.vx -= (1 + restitution) * vn * col.nx;
      player.vy -= (1 + restitution) * vn * col.ny;
      player.vx *= 0.82;
      player.vy *= 0.82;
    }

    const rx = player.x - obstacle.x;
    const ry = player.y - obstacle.y;
    const side = rx * col.ny - ry * col.nx;
    const impact = Math.min(2.2, Math.abs(vn) / 90);
    player.omega += Math.sign(side || 1) * impact * (obstacle.kind === 'box' ? 1.0 : 0.72);
  }

  function handleWorldBounds(p) {
    const pts = carCorners(p);
    let minX = Infinity, maxX = -Infinity, minY = Infinity;
    for (const q of pts) {
      minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y);
    }
    let hit = false;
    if (minX < 6) {
      p.x += 6 - minX;
      if (p.vx < 0) p.vx *= -0.32;
      p.omega += 0.55;
      hit = true;
    }
    if (maxX > W - 6) {
      p.x -= maxX - (W - 6);
      if (p.vx > 0) p.vx *= -0.32;
      p.omega -= 0.55;
      hit = true;
    }
    if (minY < 42) {
      p.y += 42 - minY;
      if (p.vy < 0) p.vy *= -0.28;
      p.omega += (p.vx >= 0 ? 1 : -1) * 0.45;
      hit = true;
    }
    if (hit) state.contactOccurred = true;
  }

  function handleCat(cat, p) {
    if (cat.fled) return;
    const dx = cat.x - p.x;
    const dy = cat.y - p.y;
    const rr = 24;
    if (dx * dx + dy * dy < rr * rr) {
      cat.fled = true;
      cat.fleeT = 0;
      const len = Math.hypot(dx, dy) || 1;
      cat.vx = (dx / len) * 95 + (cat.x < W / 2 ? -65 : 65);
      cat.vy = -80;
      state.contactOccurred = true;
      // Gentle deflection so contact is visible without implying harm.
      p.vx -= (dx / len) * 24;
      p.vy -= (dy / len) * 16;
      p.omega += (dx >= 0 ? -1 : 1) * 0.35;
    }
  }

  function updateCats(dt) {
    for (const slot of state.slots) {
      const cat = slot.cat;
      if (!cat || !cat.fled) continue;
      cat.fleeT += dt;
      cat.x += cat.vx * dt;
      cat.y += cat.vy * dt;
      cat.vx *= Math.exp(-2.0 * dt);
      cat.vy += 145 * dt;
      cat.vy *= Math.exp(-1.3 * dt);
      cat.hop = Math.sin(Math.min(1, cat.fleeT / 0.7) * Math.PI) * 11;
    }
  }

  function update(dt, nowSec) {
    if (state.screen !== 'game' || !state.player) return;
    const p = state.player;
    updateCats(dt);

    if (state.phase === 'aim') {
      p.x += p.vx * dt;
      const left = 31;
      const right = W - 31;
      if (p.x >= right) {
        p.x = right;
        p.vx = -Math.abs(p.vx);
        p.movingDir = -1;
      } else if (p.x <= left) {
        p.x = left;
        p.vx = Math.abs(p.vx);
        p.movingDir = 1;
      }
      p.angle += p.omega * dt;
      return;
    }

    if (state.phase !== 'launched') return;

    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.angle += p.omega * dt;

    const linearDamp = Math.exp(-1.05 * dt);
    const angularDamp = Math.exp(-1.18 * dt);
    p.vx *= linearDamp;
    p.vy *= linearDamp;
    p.omega *= angularDamp;

    handleWorldBounds(p);

    for (const slot of state.slots) {
      if (slot.obstacle) {
        const col = rectCollision(p, slot.obstacle);
        if (col) resolveObstacleCollision(p, slot.obstacle, col);
      } else if (slot.cat) {
        handleCat(slot.cat, p);
      }
    }

    const speed = Math.hypot(p.vx, p.vy);
    if (speed < 11 && Math.abs(p.omega) < 0.22) state.lowMotionTime += dt;
    else state.lowMotionTime = 0;

    const elapsed = nowSec - state.launchedAt;
    if ((elapsed > 0.9 && state.lowMotionTime > 0.45) || elapsed > 7.0) {
      p.vx = 0;
      p.vy = 0;
      p.omega = 0;
      finishRound();
    }
  }

  function angleErrorToParking(angle) {
    let a = angle % Math.PI;
    if (a < -Math.PI / 2) a += Math.PI;
    if (a > Math.PI / 2) a -= Math.PI;
    return Math.abs(a);
  }

  function pointInRect(p, r, margin = 0) {
    return p.x >= r.x + margin && p.x <= r.x + r.w - margin &&
           p.y >= r.y + margin && p.y <= r.y + r.h - margin;
  }

  function nearMetricPx(car, target) {
    const corners = carCorners(car);
    let overflow = 0;
    for (const c of corners) {
      const dx = c.x < target.x ? target.x - c.x : c.x > target.x + target.w ? c.x - (target.x + target.w) : 0;
      const dy = c.y < target.y ? target.y - c.y : c.y > target.y + target.h ? c.y - (target.y + target.h) : 0;
      overflow = Math.max(overflow, Math.hypot(dx, dy));
    }
    const centerDX = Math.max(0, Math.abs(car.x - target.cx) - target.w * 0.52);
    const centerDY = Math.max(0, Math.abs(car.y - target.cy) - target.h * 0.52);
    return Math.max(overflow, Math.hypot(centerDX, centerDY));
  }

  function evaluateResult() {
    const p = state.player;
    const target = state.slots[state.emptyIndex];
    const corners = carCorners(p);
    const allInside = corners.every(c => pointInRect(c, target, 1.5));
    const comfortablyInside = corners.every(c => pointInRect(c, target, 4.0));
    const insideCount = corners.filter(c => pointInRect(c, target, 0)).length;
    const centerInside = pointInRect({ x: p.x, y: p.y }, target, 0);
    const angleErr = angleErrorToParking(p.angle);
    const nearPx = nearMetricPx(p, target);
    const cm = Math.max(1, Math.round(nearPx * 0.55));

    if (comfortablyInside && angleErr <= 8 * Math.PI / 180 && !state.contactOccurred) {
      return { rank: 3, main: 'PERFECT!', sub: 'ぴったり駐車！', cm: 0 };
    }

    if ((allInside || (centerInside && insideCount >= 3)) && angleErr <= 30 * Math.PI / 180) {
      return { rank: 2, main: 'PARKING!', sub: 'ナイス駐車！', cm: 0 };
    }

    if (nearPx <= 31 && angleErr <= 68 * Math.PI / 180) {
      return { rank: 1, main: `あと${cm}cm！`, sub: 'ほぼ入ってる！', cm };
    }

    if (state.contactOccurred) return { rank: 0, main: 'ゴンッ！', sub: 'ぶつかっちゃった！', cm: null };
    if (p.y > target.y + target.h + 46) return { rank: 0, main: '届かない！', sub: 'もう少し早め！', cm: null };
    if (p.y < target.y - 34) return { rank: 0, main: '行きすぎ！', sub: '勢いありすぎ！', cm: null };
    return { rank: 0, main: 'そこじゃない！', sub: '空いてる枠を狙おう！', cm: null };
  }

  function applyBest(result) {
    if (result.rank >= 3) {
      if (state.best.rank < 3) state.best = { rank: 3, cm: null };
    } else if (result.rank === 2) {
      if (state.best.rank < 2) state.best = { rank: 2, cm: null };
    } else if (result.rank === 1 && state.best.rank < 2) {
      if (state.best.cm == null || result.cm < state.best.cm) state.best = { rank: 1, cm: result.cm };
    }
    saveBest();
    updateBestDisplay();
  }

  function finishRound() {
    if (state.phase !== 'launched') return;
    state.phase = 'result';
    const result = evaluateResult();
    applyBest(result);
    resultMain.textContent = result.main;
    resultSub.textContent = result.sub;
    resultPanel.hidden = false;
  }

  function roundedRectPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawParkingLot() {
    ctx.fillStyle = palette.asphalt;
    ctx.fillRect(0, 0, W, H);

    // Soft asphalt bands give depth without textures/assets.
    ctx.fillStyle = palette.asphalt2;
    ctx.fillRect(0, 45, W, 10);
    ctx.fillRect(0, 208, W, 5);
    ctx.fillRect(0, H - 178, W, 5);

    // Parking bay baseline and dividers.
    ctx.strokeStyle = palette.line;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(SLOT_MARGIN_X, SLOT_Y);
    ctx.lineTo(W - SLOT_MARGIN_X, SLOT_Y);
    ctx.moveTo(SLOT_MARGIN_X, SLOT_Y + SLOT_H);
    ctx.lineTo(W - SLOT_MARGIN_X, SLOT_Y + SLOT_H);
    for (let i = 0; i <= SLOT_COUNT; i++) {
      const x = i === SLOT_COUNT ? W - SLOT_MARGIN_X : SLOT_MARGIN_X + i * (SLOT_W + SLOT_GAP) - (i ? SLOT_GAP / 2 : 0);
      ctx.moveTo(x, SLOT_Y);
      ctx.lineTo(x, SLOT_Y + SLOT_H);
    }
    ctx.stroke();

    const target = state.slots[state.emptyIndex];
    if (target) {
      ctx.fillStyle = palette.target;
      ctx.fillRect(target.x + 3, target.y + 3, target.w - 6, target.h - 6);
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = palette.targetLine;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(target.x + 5, target.y + 5, target.w - 10, target.h - 10);
      ctx.setLineDash([]);
    }

    // Small lane markings lower in the scene.
    ctx.strokeStyle = palette.lineSoft;
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 13]);
    ctx.beginPath();
    ctx.moveTo(18, H - 202);
    ctx.lineTo(W - 18, H - 202);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawCar(car, body, dark, isPlayer = false) {
    ctx.save();
    ctx.translate(car.x + 2.2, car.y + 3.0);
    ctx.rotate(car.angle);
    ctx.fillStyle = palette.shadow;
    roundedRectPath(-car.w / 2, -car.h / 2, car.w, car.h, 6);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);

    ctx.fillStyle = palette.tire;
    const tw = 4.3, th = 11;
    ctx.fillRect(-car.w / 2 - 2.5, -car.h * .31, tw, th);
    ctx.fillRect(car.w / 2 - 1.8, -car.h * .31, tw, th);
    ctx.fillRect(-car.w / 2 - 2.5, car.h * .09, tw, th);
    ctx.fillRect(car.w / 2 - 1.8, car.h * .09, tw, th);

    ctx.fillStyle = body;
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2.2;
    roundedRectPath(-car.w / 2, -car.h / 2, car.w, car.h, 6.5);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = palette.glass;
    roundedRectPath(-car.w * .32, -car.h * .22, car.w * .64, car.h * .25, 3);
    ctx.fill();
    roundedRectPath(-car.w * .32, car.h * .03, car.w * .64, car.h * .21, 3);
    ctx.fill();

    ctx.fillStyle = dark;
    ctx.globalAlpha = .35;
    ctx.fillRect(-car.w * .34, -1, car.w * .68, 2);
    ctx.globalAlpha = 1;

    if (isPlayer) {
      ctx.fillStyle = '#fff2b9';
      ctx.beginPath();
      ctx.arc(-car.w * .24, -car.h * .40, 2.2, 0, Math.PI * 2);
      ctx.arc(car.w * .24, -car.h * .40, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawBox(o) {
    ctx.save();
    ctx.translate(o.x + 2, o.y + 3);
    ctx.rotate(o.angle);
    ctx.fillStyle = palette.shadow;
    ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
    ctx.restore();

    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle);
    ctx.fillStyle = palette.box;
    ctx.strokeStyle = '#7d5a37';
    ctx.lineWidth = 2;
    ctx.fillRect(-o.w / 2, -o.h / 2, o.w, o.h);
    ctx.strokeRect(-o.w / 2, -o.h / 2, o.w, o.h);
    ctx.fillStyle = palette.tape;
    ctx.fillRect(-3.5, -o.h / 2, 7, o.h);
    ctx.restore();
  }

  function drawCat(cat) {
    const y = cat.y - cat.hop;
    ctx.save();
    ctx.translate(cat.x + 1.5, y + 3.5);
    ctx.fillStyle = palette.shadow;
    ctx.beginPath();
    ctx.ellipse(0, 2, 12, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(cat.x, y);
    ctx.fillStyle = palette.cat;
    ctx.strokeStyle = palette.catDark;
    ctx.lineWidth = 2;

    ctx.beginPath();
    ctx.ellipse(0, 5, 10, 13, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, -7, 8, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(-6, -12); ctx.lineTo(-9, -20); ctx.lineTo(-2, -15);
    ctx.moveTo(6, -12); ctx.lineTo(9, -20); ctx.lineTo(2, -15);
    ctx.fill(); ctx.stroke();

    ctx.strokeStyle = palette.catDark;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(9, 8);
    ctx.bezierCurveTo(18, 9, 17, -1, 13, -3);
    ctx.stroke();

    ctx.fillStyle = '#2a302e';
    ctx.beginPath();
    ctx.arc(-3, -8, 1.2, 0, Math.PI * 2);
    ctx.arc(3, -8, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawScene() {
    ctx.save();
    logicalTransform();
    drawParkingLot();

    for (const slot of state.slots) {
      if (slot.obstacle?.kind === 'car') drawCar(slot.obstacle, slot.obstacle.colors[0], slot.obstacle.colors[1]);
      else if (slot.obstacle?.kind === 'box') drawBox(slot.obstacle);
      else if (slot.cat) drawCat(slot.cat);
    }

    if (state.player) drawCar(state.player, palette.player, palette.playerDark, true);

    // Tiny launch-zone cue; intentionally not an aiming meter.
    if (state.phase === 'aim') {
      ctx.strokeStyle = 'rgba(255,255,255,.16)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(W / 2, H - 103, 155, Math.PI * 1.08, Math.PI * 1.92);
      ctx.stroke();
    }
    ctx.restore();
  }

  function frame(ts) {
    if (!state.lastTs) state.lastTs = ts;
    const dt = clamp((ts - state.lastTs) / 1000, 0, 0.033);
    state.lastTs = ts;
    update(dt, ts / 1000);
    if (state.screen === 'game') drawScene();
    state.rafId = requestAnimationFrame(frame);
  }

  startButton.addEventListener('click', startGame);
  retryButton.addEventListener('click', retry);
  canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
  canvas.addEventListener('pointermove', onPointerMove, { passive: false });
  canvas.addEventListener('pointerup', onPointerUp, { passive: false });
  canvas.addEventListener('pointercancel', onPointerUp, { passive: false });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('resize', resizeCanvas, { passive: true });

  updateBestDisplay();
  state.rafId = requestAnimationFrame(frame);

})();
