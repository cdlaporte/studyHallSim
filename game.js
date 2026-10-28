'use strict';

// =====================================================================
//  Study Hall Simulator
//  Top-down pixel-art game: grade papers at your desk while keeping the
//  cafeteria study hall quiet and phone-free. Don't let the principal
//  see anything!
// =====================================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const W = canvas.width;   // 960
const H = canvas.height;  // 720
const HUD_H = 64;
const P = 3;              // size of one "pixel" in the pixel art
const WALL = 6;

// ---------- Layout: 4 rows x 6 columns of round tables ----------
const COL_X = [105, 255, 405, 555, 705, 855];
const ROW_Y = [160, 318, 476, 634];
const H_AISLES = [239, 397, 555];          // between rows (also the door rows)
const V_AISLES = [180, 330, 480, 630, 780]; // between columns
const TEACHER_ROW = 1, TEACHER_COL = 0;    // 2nd row, 1st column

const TABLE_R = 32;
const SEAT_D = 46;
const SEATS = [[0, -SEAT_D], [SEAT_D, 0], [0, SEAT_D], [-SEAT_D, 0]]; // top, right, bottom, left

const TEACHER_R = 9;
const STUDENT_R = 12;
const TEACHER_SPEED = 170;
const WORK_RANGE = 78;    // how close to your desk you must be to grade
const PHONE_RANGE = 46;   // how close to a student to take their phone
const SHUSH_RANGE = 100;  // how close to a table's center to shush it

const VISION_RANGE = 220;
const VISION_HALF = 0.6;  // radians (~34 degrees each side)

// ---------- Difficulty per level (tweak these to tune the game) ----------
function levelConfig(n) {
  return {
    time: 100,                                         // seconds until the bell
    work: Math.min(60, 30 + (n - 1) * 4),              // seconds of grading needed
    spawn: Math.max(1.6, 5.5 * Math.pow(0.85, n - 1)), // avg seconds between new problems
    maxIssues: 3 + n,
    principalFirst: Math.max(12, 24 - n * 2),
    principalEvery: Math.max(14, 30 - (n - 1) * 3),
    principalSpeed: 55 + n * 5,
    chaosMul: 1 + (n - 1) * 0.12,
  };
}

// ---------- Helpers ----------
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- Sound (tiny WebAudio blips) ----------
let actx = null;
let muted = false;
function audio() {
  if (!actx) {
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
  }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(freq, dur, { type = 'square', vol = 0.05, slide = 0, delay = 0 } = {}) {
  const a = audio();
  if (!a || muted) return;
  const t0 = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.linearRampToValueAtTime(freq + slide, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(a.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}
function noise(dur, vol = 0.08) {
  const a = audio();
  if (!a || muted) return;
  const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  const filt = a.createBiquadFilter();
  filt.type = 'highpass';
  filt.frequency.value = 3000;
  const g = a.createGain();
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(filt).connect(g).connect(a.destination);
  src.start();
}
const sfx = {
  phone: () => { tone(880, 0.06); tone(660, 0.08, { delay: 0.07 }); },
  shush: () => noise(0.45),
  spawn: () => tone(1200, 0.04, { vol: 0.02 }),
  warn: () => { tone(520, 0.15, { vol: 0.06 }); tone(390, 0.2, { delay: 0.18, vol: 0.06 }); },
  caught: () => { tone(400, 0.25, { slide: -200 }); tone(200, 0.4, { delay: 0.25, slide: -100 }); },
  win: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.12, { delay: i * 0.1 })),
  lose: () => [392, 330, 262].forEach((f, i) => tone(f, 0.2, { delay: i * 0.18, type: 'triangle', vol: 0.08 })),
};

// ---------- Pixel sprites ----------
// Each sprite is a list of strings; each character maps to a palette color.
// A dark outline is added automatically around the shape.
const OUTLINE = '#1e1a22';
function makeSprite(rows, pal) {
  const h = rows.length + 2, w = rows[0].length + 2;
  const grid = [];
  for (let y = 0; y < h; y++) {
    grid.push([]);
    for (let x = 0; x < w; x++) {
      const ch = (rows[y - 1] || '')[x - 1];
      grid[y].push(ch && pal[ch] ? pal[ch] : null);
    }
  }
  const c = document.createElement('canvas');
  c.width = w * P;
  c.height = h * P;
  const g = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let col = grid[y][x];
      if (!col) {
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy] && grid[y + dy][x + dx]);
        if (n) col = OUTLINE;
      }
      if (col) { g.fillStyle = col; g.fillRect(x * P, y * P, P, P); }
    }
  }
  return c;
}

const STUDENT_FRONT = [
  '..hhhh..',
  '.hhhhhh.',
  '.hkkkkh.',
  '.kekkek.',
  '..kkkk..',
  '.ssssss.',
  'ssssssss',
  'kssssssk',
];
const STUDENT_BACK = [
  '..hhhh..',
  '.hhhhhh.',
  '.hhhhhh.',
  '.hhhhhh.',
  '..kkkk..',
  '.ssssss.',
  'ssssssss',
  'kssssssk',
];
const TEACHER = [
  '..hhhh..',
  '.hhhhhh.',
  '.hkkkkh.',
  '.kgkkgk.',
  '..kkkk..',
  '.sswwss.',
  'sssttsss',
  'kssttssk',
  'kssssssk',
  '.pppppp.',
  '.pp..pp.',
  '.bb..bb.',
];
const PRINCIPAL = [
  '..hhhh..',
  '.hhhhhh.',
  'hhkkkkhh',
  'hkekkekh',
  'hhkrrkhh',
  'hhswwshh',
  'ssswwsss',
  'kssssssk',
  'kssssssk',
  '.qqqqqq.',
  '..k..k..',
  '..b..b..',
];

const SKINS = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524'];
const HAIRS = ['#2c1b10', '#5a3825', '#a0522d', '#e6c35c', '#151515', '#b5651d', '#7a2e1a', '#d9d9d9'];
const SHIRTS = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f39c12', '#1abc9c', '#e84393', '#34495e', '#fdcb6e', '#6c5ce7'];

const teacherSprite = makeSprite(TEACHER, {
  h: '#4a2f1b', k: '#f1c27d', g: '#222', s: '#2e8b57', w: '#ffffff', t: '#c0392b', p: '#3b3b58', b: '#111',
});
const principalSprite = makeSprite(PRINCIPAL, {
  h: '#7b3f1d', k: '#e0ac69', e: '#222', r: '#c0392b', s: '#7d3c98', w: '#ffffff', q: '#4a235a', b: '#111',
});

// ---------- Game state ----------
let state = 'title'; // title | playing | paused | caught | won | lost
let level = 1;
let cfg = levelConfig(1);
let tables = [];
let students = [];
let teacher = null;
let principal = null;
let work = 0, chaos = 0, timeLeft = 0, spawnTimer = 0;
let gameTime = 0;
let speech = null;      // { text, t }
let caught = null;      // { timer, x, y, reason }
let loseReason = '';
let bgCanvas = null;
let handled = 0;
let bestLevel = 1;
try { bestLevel = parseInt(localStorage.getItem('studyhall-best') || '1', 10) || 1; } catch (e) { /* ignore */ }

function setupLevel(n) {
  level = n;
  cfg = levelConfig(n);
  tables = [];
  students = [];
  for (let r = 0; r < ROW_Y.length; r++) {
    for (let c = 0; c < COL_X.length; c++) {
      const t = {
        x: COL_X[c], y: ROW_Y[r], r, c,
        teacher: r === TEACHER_ROW && c === TEACHER_COL,
        students: [], rowdy: 0, rowdyTimer: 0, spreadTimer: 0, cooldown: 0, rowdyAge: 0,
      };
      tables.push(t);
      if (t.teacher) continue;
      const count = 2 + Math.floor(Math.random() * 3); // 2..4 students
      const seats = shuffle([0, 1, 2, 3]).slice(0, count);
      for (const s of seats) {
        const [dx, dy] = SEATS[s];
        const pal = { h: pick(HAIRS), k: pick(SKINS), e: '#222', s: pick(SHIRTS) };
        const st = {
          x: t.x + dx, y: t.y + dy, seat: s, table: t,
          phone: false, phoneAge: 0, cooldown: 0, phase: Math.random() * 10,
          sprite: makeSprite(s === 2 ? STUDENT_BACK : STUDENT_FRONT, pal),
        };
        t.students.push(st);
        students.push(st);
      }
    }
  }
  teacher = { x: COL_X[TEACHER_COL] + 62, y: ROW_Y[TEACHER_ROW], moving: false, walkT: 0 };
  principal = {
    phase: 'away', next: cfg.principalFirst + rand(0, 8), warn: 0,
    x: -40, y: 0, path: [], idx: 0, facing: 0, pause: 0, lookT: 0, baseFacing: 0,
    suspicion: 0, side: 'left', walkT: 0,
  };
  work = 0;
  chaos = 0;
  timeLeft = cfg.time;
  spawnTimer = 2.5;
  speech = null;
  caught = null;
  handled = 0;
  bgCanvas = renderBackground();
}

// ---------- Background (floor, walls, tables, chairs) ----------
function pixelCircle(g, cx, cy, radius, fill, rim, shine) {
  const R = radius / P;
  const n = Math.ceil(R);
  for (let j = -n; j < n; j++) {
    for (let i = -n; i < n; i++) {
      const d = Math.hypot(i + 0.5, j + 0.5);
      if (d > R) continue;
      let col = fill;
      if (d > R - 1.2) col = rim;
      else if (shine && d < R * 0.55 && i < 0 && j < 0 && i + j < -R * 0.45) col = shine;
      g.fillStyle = col;
      g.fillRect(Math.round(cx + i * P), Math.round(cy + j * P), P, P);
    }
  }
}

function renderBackground() {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');

  // Cafeteria floor tiles
  const T = 48;
  for (let y = HUD_H; y < H; y += T) {
    for (let x = 0; x < W; x += T) {
      const odd = ((x / T) + ((y - HUD_H) / T)) % 2 === 1;
      g.fillStyle = odd ? '#d8cfbd' : '#e9e2d2';
      g.fillRect(x, y, T, T);
      g.fillStyle = 'rgba(0,0,0,0.05)';
      g.fillRect(x, y, T, P);
      g.fillRect(x, y, P, T);
    }
  }

  // Walls with doors on the left and right of each aisle
  g.fillStyle = '#5b4636';
  g.fillRect(0, HUD_H, W, WALL);
  g.fillRect(0, H - WALL, W, WALL);
  g.fillRect(0, HUD_H, WALL, H - HUD_H);
  g.fillRect(W - WALL, HUD_H, WALL, H - HUD_H);
  for (const y of H_AISLES) {
    for (const x of [0, W - WALL]) {
      g.fillStyle = '#a3703d';
      g.fillRect(x, y - 22, WALL, 44);
      g.fillStyle = '#2b1e14';
      g.fillRect(x, y - 24, WALL, 2);
      g.fillRect(x, y + 22, WALL, 2);
    }
  }

  // Chairs (drawn first so tables & students sit on top)
  for (const t of tables) {
    if (t.teacher) continue;
    for (const [dx, dy] of SEATS) {
      const cx = t.x + dx * 1.12, cy = t.y + dy * 1.12;
      g.fillStyle = OUTLINE;
      g.fillRect(cx - 12, cy - 12, 24, 24);
      g.fillStyle = '#6f8fa8';
      g.fillRect(cx - 9, cy - 9, 18, 18);
      g.fillStyle = '#87a8c2';
      g.fillRect(cx - 9, cy - 9, 18, P);
    }
  }

  // Tables
  for (const t of tables) {
    pixelCircle(g, t.x + P, t.y + 2 * P, TABLE_R, 'rgba(0,0,0,0.18)', 'rgba(0,0,0,0.18)');
    if (t.teacher) {
      pixelCircle(g, t.x, t.y, TABLE_R, '#7fb08a', '#3f6b4a', '#a3d1ad');
      // stack of ungraded papers
      g.fillStyle = OUTLINE; g.fillRect(t.x - 22, t.y - 14, 22, 26);
      g.fillStyle = '#ffffff'; g.fillRect(t.x - 19, t.y - 11, 16, 20);
      g.fillStyle = '#9aa4b1';
      for (let i = 0; i < 4; i++) g.fillRect(t.x - 16, t.y - 7 + i * 4, 10, 1.5);
      // red pen
      g.fillStyle = '#c0392b'; g.fillRect(t.x - 1, t.y - 12, 3, 16);
      // coffee mug
      g.fillStyle = OUTLINE; g.fillRect(t.x + 6, t.y - 3, 15, 15);
      g.fillStyle = '#f4f4f4'; g.fillRect(t.x + 9, t.y, 9, 9);
      g.fillStyle = '#6b3e1f'; g.fillRect(t.x + 11, t.y + 2, 5, 5);
      // apple
      g.fillStyle = OUTLINE; g.fillRect(t.x + 4, t.y - 22, 12, 12);
      g.fillStyle = '#e74c3c'; g.fillRect(t.x + 6, t.y - 20, 8, 8);
      g.fillStyle = '#27ae60'; g.fillRect(t.x + 9, t.y - 24, 3, 4);
    } else {
      pixelCircle(g, t.x, t.y, TABLE_R, '#c9a46c', '#7d5c33', '#ddbe8a');
    }
  }
  return c;
}

// ---------- Input ----------
const keys = new Set();
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
  audio();
  if (e.repeat && (k === 'a' || k === 's' || k === 'enter' || k === 'p')) return;
  keys.add(k);

  if (k === 'm') muted = !muted;
  if (k === 'enter' || k === ' ') {
    if (state === 'title') { setupLevel(1); state = 'playing'; }
    else if (state === 'won') { setupLevel(level + 1); state = 'playing'; }
    else if (state === 'lost') { setupLevel(level); state = 'playing'; }
    else if (state === 'paused') state = 'playing';
  }
  if (k === 'r' && state === 'lost') { setupLevel(1); state = 'playing'; }
  if (k === 'p') {
    if (state === 'playing') state = 'paused';
    else if (state === 'paused') state = 'playing';
  }
  if (state === 'playing') {
    if (k === 'a') actionPhone();
    if (k === 's') actionShush();
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => {
  keys.clear();
  if (state === 'playing') state = 'paused';
});

function say(text) { speech = { text, t: 0.9 }; }

function actionPhone() {
  let best = null, bd = PHONE_RANGE;
  for (const s of students) {
    if (!s.phone) continue;
    const d = dist(teacher, s);
    if (d < bd) { bd = d; best = s; }
  }
  if (best) {
    best.phone = false;
    best.cooldown = 8;
    chaos = Math.max(0, chaos - 3);
    handled++;
    say('Phone away!');
    sfx.phone();
  } else {
    say('?');
  }
}

function actionShush() {
  let best = null, bd = SHUSH_RANGE;
  for (const t of tables) {
    if (!t.rowdy) continue;
    const d = dist(teacher, t);
    if (d < bd) { bd = d; best = t; }
  }
  if (best) {
    best.rowdy = 0;
    best.rowdyTimer = 0;
    best.spreadTimer = 0;
    best.cooldown = 8;
    chaos = Math.max(0, chaos - 4);
    handled++;
    say('Shhh!');
    sfx.shush();
  } else {
    say('?');
  }
}

// ---------- Update ----------
function moveTeacher(dt) {
  let dx = 0, dy = 0;
  if (keys.has('arrowleft')) dx -= 1;
  if (keys.has('arrowright')) dx += 1;
  if (keys.has('arrowup')) dy -= 1;
  if (keys.has('arrowdown')) dy += 1;
  teacher.moving = dx !== 0 || dy !== 0;
  if (!teacher.moving) return;
  const len = Math.hypot(dx, dy);
  teacher.x += (dx / len) * TEACHER_SPEED * dt;
  teacher.y += (dy / len) * TEACHER_SPEED * dt;
  teacher.walkT += dt;

  // Push out of tables and seated students
  for (let iter = 0; iter < 2; iter++) {
    for (const t of tables) {
      pushOut(teacher, t, TABLE_R + TEACHER_R);
      for (const s of t.students) pushOut(teacher, s, STUDENT_R + TEACHER_R);
    }
  }
  teacher.x = clamp(teacher.x, WALL + TEACHER_R, W - WALL - TEACHER_R);
  teacher.y = clamp(teacher.y, HUD_H + WALL + TEACHER_R + 6, H - WALL - TEACHER_R);
}

function pushOut(mover, obstacle, minD) {
  const dx = mover.x - obstacle.x, dy = mover.y - obstacle.y;
  const d = Math.hypot(dx, dy);
  if (d < minD && d > 0.0001) {
    mover.x = obstacle.x + (dx / d) * minD;
    mover.y = obstacle.y + (dy / d) * minD;
  }
}

function activeIssueCount() {
  return students.filter((s) => s.phone).length + tables.filter((t) => t.rowdy).length;
}

// Don't spawn trouble right in front of the principal -- that would be unfair.
function nearPrincipal(p) {
  if (principal.phase === 'walking') return dist(p, principal) < 280;
  if (principal.phase === 'warning') return dist(p, principal.path[0]) < 280;
  return false;
}

function spawnIssue() {
  if (activeIssueCount() >= cfg.maxIssues) return;
  if (Math.random() < 0.55) {
    const options = students.filter((s) => !s.phone && s.cooldown <= 0 && !nearPrincipal(s));
    if (!options.length) return;
    const s = pick(options);
    s.phone = true;
    s.phoneAge = 0;
  } else {
    const options = tables.filter((t) => !t.teacher && !t.rowdy && t.cooldown <= 0 && !nearPrincipal(t));
    if (!options.length) return;
    const t = pick(options);
    t.rowdy = 1;
    t.rowdyTimer = 0;
    t.rowdyAge = 0;
  }
  sfx.spawn();
}

function updateIssues(dt) {
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    const slow = principal.phase === 'walking' ? 1.6 : 1; // a bit calmer while she's around
    spawnTimer = cfg.spawn * rand(0.6, 1.4) * slow;
    spawnIssue();
  }

  for (const s of students) {
    if (s.cooldown > 0) s.cooldown -= dt;
    if (s.phone) s.phoneAge += dt;
  }

  for (const t of tables) {
    if (t.cooldown > 0) t.cooldown -= dt;
    if (!t.rowdy) continue;
    t.rowdyAge += dt;
    t.rowdyTimer += dt;
    if (t.rowdy < 3 && t.rowdyTimer > 7) { t.rowdy++; t.rowdyTimer = 0; }
    if (t.rowdy === 3) {
      // Really loud tables get their neighbours riled up too
      t.spreadTimer += dt;
      if (t.spreadTimer > 6) {
        t.spreadTimer = 0;
        const nbrs = tables.filter((o) => !o.teacher && !o.rowdy && o.cooldown <= 0 &&
          Math.abs(o.r - t.r) + Math.abs(o.c - t.c) === 1);
        if (nbrs.length) {
          const o = pick(nbrs);
          o.rowdy = 1; o.rowdyTimer = 0; o.rowdyAge = 0;
        }
      }
    }
  }

  // Chaos meter: rises when lots of trouble is going on, falls when it's calm
  const ROWDY_WEIGHT = [0, 1, 1.5, 2.2];
  let load = 0;
  for (const s of students) if (s.phone) load += 1;
  for (const t of tables) load += ROWDY_WEIGHT[t.rowdy];
  const rate = load * 1.5 - 2.5;
  chaos = clamp(chaos + rate * (rate > 0 ? cfg.chaosMul : 1) * dt, 0, 100);
}

function planPrincipalRoute() {
  const pr = principal;
  const fromLeft = Math.random() < 0.5;
  const turns = Math.random() < 0.6 ? 2 : 1;
  let y = pick(H_AISLES);
  const path = [{ x: fromLeft ? -24 : W + 24, y }];
  const xs = shuffle(V_AISLES.slice()).slice(0, turns).sort((a, b) => (fromLeft ? a - b : b - a));
  for (const x of xs) {
    path.push({ x, y });
    y = pick(H_AISLES.filter((v) => v !== y));
    path.push({ x, y });
  }
  path.push({ x: fromLeft ? W + 24 : -24, y });
  pr.path = path;
  pr.side = fromLeft ? 'left' : 'right';
  pr.x = path[0].x;
  pr.y = path[0].y;
  pr.idx = 1;
  pr.facing = fromLeft ? 0 : Math.PI;
  pr.pause = 0;
  pr.suspicion = 0;
}

function whatPrincipalSees() {
  const pr = principal;
  const inCone = (p) => {
    const d = dist(pr, p);
    if (d > VISION_RANGE) return false;
    const a = Math.atan2(p.y - pr.y, p.x - pr.x);
    return Math.abs(angleDiff(a, pr.facing)) <= VISION_HALF;
  };
  for (const s of students) {
    if (s.phone && inCone(s)) return { x: s.x, y: s.y, reason: 'phone' };
  }
  for (const t of tables) {
    if (!t.rowdy) continue;
    if (inCone(t) || t.students.some(inCone)) return { x: t.x, y: t.y, reason: 'rowdy' };
  }
  return null;
}

function updatePrincipal(dt) {
  const pr = principal;
  if (pr.phase === 'away') {
    pr.next -= dt;
    if (pr.next <= 0) {
      planPrincipalRoute();
      pr.phase = 'warning';
      pr.warn = 3.5;
      sfx.warn();
    }
    return;
  }
  if (pr.phase === 'warning') {
    pr.warn -= dt;
    if (pr.warn <= 0) pr.phase = 'walking';
    return;
  }

  // Walking her patrol route
  let desired = pr.facing;
  if (pr.pause > 0) {
    pr.pause -= dt;
    pr.lookT += dt;
    desired = pr.baseFacing + Math.sin(pr.lookT * 2.4) * 0.95; // look around
  } else {
    const target = pr.path[pr.idx];
    const dx = target.x - pr.x, dy = target.y - pr.y;
    const d = Math.hypot(dx, dy);
    const step = cfg.principalSpeed * dt;
    pr.walkT += dt;
    if (d <= step) {
      pr.x = target.x;
      pr.y = target.y;
      pr.idx++;
      if (pr.idx >= pr.path.length) {
        pr.phase = 'away';
        pr.next = cfg.principalEvery * rand(0.7, 1.3);
        pr.suspicion = 0;
        return;
      }
      const nxt = pr.path[pr.idx];
      pr.baseFacing = Math.atan2(nxt.y - pr.y, nxt.x - pr.x);
      pr.pause = 1.4;
      pr.lookT = 0;
    } else {
      pr.x += (dx / d) * step;
      pr.y += (dy / d) * step;
      desired = Math.atan2(dy, dx);
    }
  }
  const diff = angleDiff(desired, pr.facing);
  const maxTurn = 5 * dt;
  pr.facing += clamp(diff, -maxTurn, maxTurn);

  // Is she seeing something she shouldn't?
  const seen = whatPrincipalSees();
  if (seen) {
    pr.suspicion += dt / 0.45;
    if (pr.suspicion >= 1) {
      caught = { timer: 1.8, ...seen };
      state = 'caught';
      sfx.caught();
    }
  } else {
    pr.suspicion = Math.max(0, pr.suspicion - dt * 1.5);
  }
}

function update(dt) {
  gameTime += dt;
  if (speech) { speech.t -= dt; if (speech.t <= 0) speech = null; }

  if (state === 'caught') {
    caught.timer -= dt;
    if (caught.timer <= 0) {
      loseReason = caught.reason === 'phone'
        ? 'The principal caught a student on their phone!'
        : 'The principal caught a rowdy table!';
      state = 'lost';
      sfx.lose();
    }
    return;
  }
  if (state !== 'playing') return;

  timeLeft -= dt;
  moveTeacher(dt);
  const atDesk = dist(teacher, tables.find((t) => t.teacher)) < WORK_RANGE;
  if (atDesk) work = Math.min(cfg.work, work + dt);
  updateIssues(dt);
  updatePrincipal(dt);
  if (state !== 'playing') return;

  if (work >= cfg.work) {
    state = 'won';
    bestLevel = Math.max(bestLevel, level + 1);
    try { localStorage.setItem('studyhall-best', String(bestLevel)); } catch (e) { /* ignore */ }
    sfx.win();
  } else if (chaos >= 100) {
    loseReason = 'The study hall descended into total chaos!';
    state = 'lost';
    sfx.lose();
  } else if (timeLeft <= 0) {
    timeLeft = 0;
    loseReason = 'The bell rang before you finished grading!';
    state = 'lost';
    sfx.lose();
  }
}

// ---------- Drawing ----------
const FONT = '"Press Start 2P", monospace';
function text(str, x, y, size = 10, color = '#fff', align = 'left', shadow = true) {
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  if (shadow) {
    ctx.fillStyle = '#000';
    ctx.fillText(str, x + 2, y + 2);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function pixelBox(x, y, w, h, fill, outline = OUTLINE) {
  x = Math.round(x); y = Math.round(y);
  ctx.fillStyle = outline;
  ctx.fillRect(x + P, y, w - 2 * P, h);
  ctx.fillRect(x, y + P, w, h - 2 * P);
  ctx.fillStyle = fill;
  ctx.fillRect(x + P, y + P, w - 2 * P, h - 2 * P);
}

// Speech bubble whose tail points at (x, y). If `below` the bubble hangs underneath.
function bubble(x, y, w, h, fill = '#fff', below = false) {
  const bx = Math.round(x - w / 2);
  const by = below ? Math.round(y + 2 * P) : Math.round(y - h - 2 * P);
  pixelBox(bx, by, w, h, fill);
  const cx = Math.round(x);
  ctx.fillStyle = OUTLINE;
  if (below) {
    ctx.fillRect(cx - 2 * P, by - P, 4 * P, 2 * P);
    ctx.fillRect(cx - P, by - 2 * P, 2 * P, P);
    ctx.fillStyle = fill;
    ctx.fillRect(cx - P, by - P, 2 * P, 2 * P);
  } else {
    ctx.fillRect(cx - 2 * P, by + h - P, 4 * P, 2 * P);
    ctx.fillRect(cx - P, by + h + P, 2 * P, P);
    ctx.fillStyle = fill;
    ctx.fillRect(cx - P, by + h - P, 2 * P, 2 * P);
  }
  return { x: bx, y: by };
}

function drawSprite(spr, x, y) {
  ctx.drawImage(spr, Math.round(x - spr.width / 2), Math.round(y - spr.height / 2));
}

function drawWorkZone() {
  const desk = tables.find((t) => t.teacher);
  const inside = dist(teacher, desk) < WORK_RANGE;
  ctx.save();
  ctx.strokeStyle = inside ? 'rgba(46,204,113,0.9)' : 'rgba(46,139,87,0.45)';
  ctx.lineWidth = P;
  ctx.setLineDash([P * 2, P * 2]);
  ctx.lineDashOffset = -gameTime * 12;
  ctx.beginPath();
  ctx.arc(desk.x, desk.y, WORK_RANGE, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  text('YOUR DESK', desk.x, desk.y + WORK_RANGE + 4, 8, inside ? '#2ecc71' : '#3f6b4a', 'center', false);
}

function drawCone() {
  const pr = principal;
  if (pr.phase !== 'walking') return;
  ctx.save();
  const alert = pr.suspicion > 0;
  ctx.fillStyle = alert ? 'rgba(231,76,60,0.28)' : 'rgba(255,221,87,0.28)';
  ctx.strokeStyle = alert ? 'rgba(192,57,43,0.8)' : 'rgba(214,170,30,0.8)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pr.x, pr.y);
  ctx.arc(pr.x, pr.y, VISION_RANGE, pr.facing - VISION_HALF, pr.facing + VISION_HALF);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawPhoneBubble(s) {
  const bob = Math.round(Math.sin(gameTime * 6 + s.phase) * 1.5);
  const below = s.seat === 2;
  const ty = below ? s.y + 14 + bob : s.y - 16 + bob;
  const b = bubble(s.x, ty, 8 * P, 9 * P, '#fff', below);
  // phone icon
  ctx.fillStyle = '#222';
  ctx.fillRect(b.x + 2 * P, b.y + P + P, 4 * P, 6 * P);
  ctx.fillStyle = Math.floor(gameTime * 4) % 2 ? '#5dade2' : '#85c1e9';
  ctx.fillRect(b.x + 3 * P, b.y + 3 * P, 2 * P, 3 * P);
  ctx.fillStyle = '#e74c3c';
  ctx.fillRect(b.x + 3 * P, b.y + 7 * P - 1, 2 * P, 1); // tiny notification light
}

function drawRowdyBubble(t) {
  const shake = t.rowdy === 3 ? Math.round(Math.sin(gameTime * 40) * 2) : 0;
  const bob = Math.round(Math.sin(gameTime * 5 + t.c) * 2);
  const labels = ['', '#@!', '#@!!', 'LOUD!'];
  const w = [0, 14, 16, 18][t.rowdy] * P;
  const fill = t.rowdy === 3 ? '#e74c3c' : t.rowdy === 2 ? '#ffd6a5' : '#fff';
  const b = bubble(t.x + shake, t.y + 6 + bob, w, 9 * P, fill);
  text(labels[t.rowdy], b.x + w / 2, b.y + 9, 10, t.rowdy === 3 ? '#fff' : '#c0392b', 'center', false);
}

function drawKeyHint(key, x, y) {
  const s = 7 * P;
  const yy = y + Math.round(Math.sin(gameTime * 8) * 2);
  pixelBox(x - s / 2, yy - s / 2, s, s, '#fff');
  ctx.fillStyle = '#bbb';
  ctx.fillRect(Math.round(x - s / 2) + P, Math.round(yy + s / 2) - 2 * P, s - 2 * P, P);
  text(key, x + 1, yy - 5, 10, '#222', 'center', false);
}

function drawEntities() {
  const list = [];
  for (const s of students) list.push({ y: s.y, kind: 'student', s });
  list.push({ y: teacher.y, kind: 'teacher' });
  if (principal.phase === 'walking') list.push({ y: principal.y, kind: 'principal' });
  list.sort((a, b) => a.y - b.y);

  for (const e of list) {
    if (e.kind === 'student') {
      const s = e.s;
      let ox = 0, oy = 0;
      if (s.table.rowdy) {
        const amp = s.table.rowdy;
        oy = -Math.abs(Math.sin(gameTime * (8 + amp * 3) + s.phase)) * P * amp;
        ox = Math.sin(gameTime * 13 + s.phase) * amp;
      } else if (!s.phone) {
        oy = Math.sin(gameTime * 1.5 + s.phase) > 0.85 ? -1 : 0; // idle studying fidget
      }
      drawSprite(s.sprite, s.x + ox, s.y + oy);
      if (s.phone) {
        const glow = Math.floor(gameTime * 6 + s.phase) % 2 ? '#5dade2' : '#aed6f1';
        ctx.fillStyle = OUTLINE;
        ctx.fillRect(Math.round(s.x - 2 * P), Math.round(s.y + 2 * P), 4 * P, 3 * P);
        ctx.fillStyle = glow;
        ctx.fillRect(Math.round(s.x - P), Math.round(s.y + 2 * P + 1), 2 * P, 2 * P);
      }
    } else if (e.kind === 'teacher') {
      const bob = teacher.moving && Math.floor(teacher.walkT * 8) % 2 ? -P : 0;
      drawSprite(teacherSprite, teacher.x, teacher.y - 8 + bob);
    } else {
      const pr = principal;
      const bob = pr.pause <= 0 && Math.floor(pr.walkT * 7) % 2 ? -P : 0;
      drawSprite(principalSprite, pr.x, pr.y - 8 + bob);
    }
  }
}

function drawOverheads() {
  // Problem bubbles
  for (const t of tables) if (t.rowdy) drawRowdyBubble(t);
  for (const s of students) if (s.phone) drawPhoneBubble(s);

  // Key hints for whatever the teacher can deal with right now
  if (state === 'playing') {
    let phoneTarget = null, pd = PHONE_RANGE;
    for (const s of students) if (s.phone && dist(teacher, s) < pd) { pd = dist(teacher, s); phoneTarget = s; }
    let rowdyTarget = null, rd = SHUSH_RANGE;
    for (const t of tables) if (t.rowdy && dist(teacher, t) < rd) { rd = dist(teacher, t); rowdyTarget = t; }
    if (phoneTarget) drawKeyHint('A', phoneTarget.x + 22, phoneTarget.y - 30);
    if (rowdyTarget) drawKeyHint('S', rowdyTarget.x + 44, rowdyTarget.y - 30);
  }

  // Teacher speech
  if (speech) {
    ctx.font = `10px ${FONT}`;
    const w = Math.max(10 * P, Math.ceil(ctx.measureText(speech.text).width / P) * P + 6 * P);
    const b = bubble(teacher.x, teacher.y - 26, w, 8 * P, '#fff');
    text(speech.text, b.x + w / 2, b.y + 7, 10, '#222', 'center', false);
  }

  // Principal's reaction
  const pr = principal;
  if (pr.phase === 'walking' && (pr.suspicion > 0 || state === 'caught')) {
    const isCaught = state === 'caught';
    const b = bubble(pr.x, pr.y - 30, 8 * P, 9 * P, isCaught ? '#e74c3c' : '#fff');
    text(isCaught ? '!' : '?', b.x + 4 * P + 1, b.y + 8, 12, isCaught ? '#fff' : '#c0392b', 'center', false);
  }

  if (state === 'caught') {
    ctx.save();
    ctx.strokeStyle = Math.floor(gameTime * 8) % 2 ? '#e74c3c' : '#fff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(caught.x, caught.y, caught.reason === 'phone' ? 26 : 70, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawBar(x, y, w, h, frac, color, back = '#2b2b38') {
  pixelBox(x, y, w, h, back, '#000');
  const inner = Math.max(0, Math.round((w - 2 * P) * clamp(frac, 0, 1)));
  ctx.fillStyle = color;
  ctx.fillRect(x + P, y + P, inner, h - 2 * P);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(x + P, y + P, inner, P);
}

function drawHUD() {
  ctx.fillStyle = '#23202d';
  ctx.fillRect(0, 0, W, HUD_H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, HUD_H - P, W, P);

  text(`LEVEL ${level}`, 14, 14, 12, '#ffd166');
  text(`HANDLED ${handled}`, 14, 38, 8, '#aaa');

  text('GRADING', 150, 12, 8, '#9be7b0');
  drawBar(150, 26, 260, 24, work / cfg.work, '#2ecc71');
  text(`${Math.floor((work / cfg.work) * 100)}%`, 280, 32, 8, '#fff', 'center');

  text('CHAOS', 440, 12, 8, '#ff9a8b');
  const chaosColor = chaos > 75 ? (Math.floor(gameTime * 6) % 2 ? '#e74c3c' : '#ff7675') : chaos > 45 ? '#e67e22' : '#f1c40f';
  drawBar(440, 26, 220, 24, chaos / 100, chaosColor);

  const secs = Math.ceil(timeLeft);
  const tStr = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  text('BELL IN', 690, 12, 8, '#aaa');
  text(tStr, 690, 28, 16, timeLeft < 15 && Math.floor(gameTime * 4) % 2 ? '#e74c3c' : '#fff');

  // Principal status
  const pr = principal;
  let status = 'ALL CLEAR', col = '#7f8c8d';
  if (pr.phase === 'warning') { status = 'INCOMING!'; col = Math.floor(gameTime * 6) % 2 ? '#e74c3c' : '#ffd166'; }
  else if (pr.phase === 'walking') { status = 'ON PATROL'; col = '#e74c3c'; }
  text('PRINCIPAL', 820, 12, 8, '#aaa');
  text(status, 820, 32, 8, col);
  if (muted) text('MUTED', W - 10, 50, 8, '#888', 'right', false);
}

function drawPrincipalWarning() {
  const pr = principal;
  if (pr.phase !== 'warning') return;
  const flash = Math.floor(gameTime * 6) % 2;
  const door = pr.path[0];
  const x = pr.side === 'left' ? WALL + 18 : W - WALL - 18;
  const dir = pr.side === 'left' ? 1 : -1;
  if (flash) {
    ctx.fillStyle = '#e74c3c';
    for (let i = 0; i < 5; i++) {
      ctx.fillRect(x + dir * i * P - (dir < 0 ? P : 0), door.y - (5 - i) * P, P, (5 - i) * 2 * P);
    }
  }
  const msg = `PRINCIPAL INCOMING FROM THE ${pr.side.toUpperCase()}!`;
  ctx.font = `10px ${FONT}`;
  const w = Math.ceil(ctx.measureText(msg).width) + 32;
  pixelBox(W / 2 - w / 2, HUD_H + 12, w, 32, flash ? '#c0392b' : '#7b241c', '#000');
  text(msg, W / 2, HUD_H + 23, 10, '#fff', 'center', false);
}

function overlay(lines, accent = '#ffd166') {
  ctx.fillStyle = 'rgba(10,8,16,0.78)';
  ctx.fillRect(0, 0, W, H);
  let y = H / 2 - (lines.length * 30) / 2;
  for (const l of lines) {
    const [str, size = 10, color = '#ddd'] = Array.isArray(l) ? l : [l];
    if (str) text(str, W / 2, y, size, color === 'accent' ? accent : color, 'center');
    y += Math.max(22, size + 14);
  }
}

function drawTitle() {
  // Draw a calm, empty-ish study hall behind the title
  ctx.drawImage(bgCanvas, 0, 0);
  drawEntities();
  drawHUD();
  overlay([
    ['STUDY HALL', 32, 'accent'],
    ['SIMULATOR', 32, 'accent'],
    '',
    ['You are on cafeteria study hall duty.', 10],
    ['Stand by YOUR DESK to grade papers.', 10],
    ['Fill the GRADING bar before the bell rings!', 10],
    '',
    ['Phone bubble  -> walk to the student, press A', 10, '#85c1e9'],
    ['#@! bubble    -> walk to the table, press S', 10, '#ff9a8b'],
    '',
    ['Too much trouble fills the CHAOS meter.', 10],
    ["If the PRINCIPAL's vision cone sees a phone", 10, '#ff7675'],
    ["or a rowdy table... you're in trouble.", 10, '#ff7675'],
    '',
    ['ARROWS move   A phone   S shush   P pause', 10, '#aaa'],
    '',
    [Math.floor(gameTime * 2) % 2 ? 'PRESS ENTER TO START' : '', 14, '#fff'],
  ]);
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  if (state === 'title') { drawTitle(); return; }

  ctx.drawImage(bgCanvas, 0, 0);
  drawWorkZone();
  drawCone();
  drawEntities();
  drawOverheads();
  drawHUD();
  drawPrincipalWarning();

  if (state === 'paused') {
    overlay([['PAUSED', 24, 'accent'], '', ['Press P or ENTER to resume', 10]]);
  } else if (state === 'won') {
    overlay([
      ['GRADING DONE!', 24, '#2ecc71'],
      '',
      [`Level ${level} complete.`, 12],
      [`Problems handled: ${handled}`, 10, '#aaa'],
      '',
      ['Next level: more students acting up,', 10],
      ['and the principal visits more often.', 10],
      '',
      ['PRESS ENTER FOR NEXT LEVEL', 12, '#fff'],
    ], '#2ecc71');
  } else if (state === 'lost') {
    overlay([
      ['YOU LOST', 24, '#e74c3c'],
      '',
      [loseReason, 10],
      '',
      [`Reached level ${level}  (best: ${bestLevel})`, 10, '#aaa'],
      '',
      ['ENTER retry level    R restart from level 1', 10, '#fff'],
    ]);
  }
}

// ---------- Main loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

setupLevel(1);
canvas.focus();
requestAnimationFrame(frame);
