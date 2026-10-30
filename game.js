'use strict';

// =====================================================================
//  Study Hall Simulator -- starring Mr. Laporte
//  A top-down pixel-art roguelike: grade papers at your desk while keeping
//  the cafeteria study hall quiet and phone-free. Chaos costs Mr. Laporte
//  his hair. Don't let the principal see anything! Beat a level to pick a
//  stat upgrade and an active item.
// =====================================================================

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
ctx.imageSmoothingEnabled = false;

const PANEL_W = 300;      // left side panel (portrait, hair, stats, items)
const W = 960;            // width of the cafeteria play area
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
// Walkable aisle grid used by the teaching assistant to get around
const NAV_X = [27, 180, 330, 480, 630, 780, 933];
const NAV_Y = [86, 239, 397, 555, 703];

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

const ITEM_KEYS = ['q', 'w', 'e', 'a', 's', 'd'];
const MAX_ITEMS = ITEM_KEYS.length; // item slots
const MAX_ITEM_LEVEL = 4;
const MAX_STAT_PICKS = 5;

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
const nearestOf = (arr, v) => arr.reduce((b, a) => (Math.abs(a - v) < Math.abs(b - v) ? a : b));
const lastBelow = (arr, v) => arr.filter((a) => a < v).pop();
const firstAbove = (arr, v) => arr.find((a) => a > v);

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
  item: () => { tone(660, 0.06, { type: 'triangle', vol: 0.07 }); tone(990, 0.08, { delay: 0.06, type: 'triangle', vol: 0.07 }); },
  nope: () => tone(160, 0.12, { vol: 0.04 }),
  squeak: () => tone(1400, 0.18, { type: 'sawtooth', vol: 0.04, slide: -700 }),
  whistle: () => tone(2300, 0.5, { type: 'sine', vol: 0.06, slide: 120 }),
  pick: () => tone(740, 0.08, { type: 'triangle', vol: 0.07 }),
  pluck: () => tone(1800, 0.03, { vol: 0.015 }),
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
// Red and gray striped quarter-zip, collar down, undershirt peeking out
const TEACHER_BODY = [
  '.kgkkgk.',
  '..dddd..',
  '.ccwwcc.',
  'rrrzzrrr',
  'kyyyyyyk',
  'krrrrrrk',
  '.pppppp.',
  '.pp..pp.',
  '.bb..bb.',
];
// Mr. Laporte's in-game sprite loses hair along with the portrait
const TEACHER_HEADS = [
  ['..kkkk..', '.kkkkkk.', '.kkkkkk.'], // bald
  ['..kkkk..', '.hkkkkh.', '.hkkkkh.'], // horseshoe
  ['..hkkh..', '.hhkkhh.', '.hkkkkh.'], // receding a lot
  ['..hhhh..', '.hhhhhh.', '.hkkkkh.'], // full(ish)
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
const TA_SPRITE = [
  '..hhhh..',
  '.hhhhhh.',
  '.hkkkkhh',
  '.kekkekh',
  '..kkkk.h',
  '.oowwoo.',
  'oooboooo',
  'kooboook',
  'kooooook',
  '.pppppp.',
  '.pp..pp.',
  '.bb..bb.',
];
const GUARD = [
  '.rrrrrr.',
  'dddddddd',
  '.kkkkkk.',
  '.kekkek.',
  '..kkkk..',
  '.rrwwrr.',
  'rrryrrrr',
  'krrrrrrk',
  'krrrrrrk',
  '.pppppp.',
  '.pp..pp.',
  '.bb..bb.',
];
const CUTOUT_BOARD = '#c8a165';
const CHICKEN = [
  '...rr..',
  '..yyyy.',
  '.yykyoo',
  'yyyyyy.',
  'yyyyyy.',
  '.yyyy..',
  '..o.o..',
];

const SKINS = ['#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524'];
const HAIRS = ['#2c1b10', '#5a3825', '#a0522d', '#e6c35c', '#151515', '#b5651d', '#7a2e1a', '#d9d9d9'];
const SHIRTS = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f39c12', '#1abc9c', '#e84393', '#34495e', '#fdcb6e', '#6c5ce7'];

const LAPORTE_PAL = {
  h: '#6b4423', k: '#f6cfa6', g: '#222', d: '#9c7458', r: '#b5302a', y: '#8f9399', c: '#a3a7ad', w: '#ffffff',
  z: '#d0d4d6', p: '#3b3b58', b: '#111',
};
const teacherSprites = TEACHER_HEADS.map((head) => makeSprite([...head, ...TEACHER_BODY], LAPORTE_PAL));
const principalSprite = makeSprite(PRINCIPAL, {
  h: '#7b3f1d', k: '#e0ac69', e: '#222', r: '#c0392b', s: '#7d3c98', w: '#ffffff', q: '#4a235a', b: '#111',
});
const taSprite = makeSprite(TA_SPRITE, {
  h: '#e6c35c', k: '#ffdbac', e: '#222', o: '#e67e22', w: '#ffffff', b: '#2980b9', p: '#2c3e50',
});
const guardSprite = makeSprite(GUARD, {
  r: '#c0392b', d: '#7b241c', k: '#e0ac69', e: '#222', w: '#ffffff', y: '#f1c40f', p: '#1c1c1c', b: '#111',
});
const chickenSprite = makeSprite(CHICKEN, { y: '#f4d03f', r: '#e74c3c', k: '#222', o: '#e67e22' });

// ---------- Upgrade icons (8x8) ----------
const icon = (rows, pal) => makeSprite(rows, pal);
const ICONS = {
  shoe: icon(['........', '........', '.rr.....', '.rrr....', '.rrrrrr.', 'rrrrrrrr', 'wwwwwwww', '........'], { r: '#e74c3c', w: '#ffffff' }),
  pen: icon(['......rr', '.....rrr', '....rrr.', '...rrr..', '..rrr...', '.ggr....', '.gg.....', 'k.......'], { r: '#c0392b', g: '#ecf0f1', k: '#222' }),
  desk: icon(['........', '.wwww...', '.wwww...', 'bbbbbbbb', 'bbbbbbbb', '.b....b.', '.b....b.', '.b....b.'], { w: '#ffffff', b: '#a0703d' }),
  voice: icon(['......y.', '....yyy.', '..yyyyy.', 'yyyyyyy.', 'yyyyyyy.', '..yyyyy.', '....yyy.', '......y.'], { y: '#f1c40f' }),
  hand: icon(['..k.k...', '.kkkkk..', '.kkkkk.k', '.kkkkkkk', '.kkkkkk.', '..kkkk..', '..kkkk..', '..ssss..'], { k: '#f6cfa6', s: '#b5302a' }),
  badge: icon(['...yy...', '...yy...', 'yyyyyyyy', '.yyyyyy.', '..yyyy..', '.yyyyyy.', '.yy..yy.', 'y......y'], { y: '#f39c12' }),
  music: icon(['...kkkkk', '...kkkkk', '...k...k', '...k...k', '...k...k', '.kkk.kkk', 'kkkkkkkk', '.kk..kk.'], { k: '#9b59b6' }),
  zen: icon(['...gg...', '..gggg..', '.gggggg.', 'gggggggg', '.gggggg.', '..gggg..', '...gg...', '...gg...'], { g: '#2ecc71' }),
  hair: icon(['.h.h.h..', '.h.h.h.h', 'hh.h.hh.', '.hhhhhh.', 'kkkkkkkk', 'kkkkkkkk', '.kkkkkk.', '........'], { h: '#6b4423', k: '#f6cfa6' }),
  heart: icon(['.rr..rr.', 'rrrrrrrr', 'rrrrrrrr', 'rrrrrrrr', '.rrrrrr.', '..rrrr..', '...rr...', '........'], { r: '#e84393' }),
  radio: icon(['..k.....', '..k.....', '.kkkkk..', '.kgggk..', '.kkkkk..', '.kbkbk..', '.kkkkk..', '.kbkbk..'], { k: '#34495e', g: '#2ecc71', b: '#95a5a6' }),
  clock: icon(['..kkkk..', '.kwwwwk.', 'kwwkwwwk', 'kwwkwwwk', 'kwwkkkwk', 'kwwwwwwk', '.kwwwwk.', '..kkkk..'], { k: '#2c3e50', w: '#ffffff' }),
  folder: icon(['........', '.yyy....', 'yyyyyyyy', 'yyyyyyyy', 'yyyyyyyy', 'yyyyyyyy', 'yyyyyyyy', '........'], { y: '#f5b041' }),
  snow: icon(['...b....', '.b.b.b..', '..bbb...', 'bbbbbbb.', '..bbb...', '.b.b.b..', '...b....', '........'], { b: '#85c1e9' }),
  ta: icon(['..hhhh..', '.hkkkkh.', '.kkkkkk.', '..kkkk..', '.oobboo.', 'oooboooo', 'ooobbooo', '.oo..oo.'], { h: '#e6c35c', k: '#ffdbac', o: '#e67e22', b: '#2980b9' }),
  chicken: icon(['...rr...', '..yyyy..', '.yykyyoo', '.yyyyy..', 'yyyyyyy.', 'yyyyyyy.', '.yyyyy..', '..o.o...'], { y: '#f4d03f', r: '#e74c3c', k: '#222', o: '#e67e22' }),
  escort: icon(['.rrrrrr.', 'dddddddd', '..kkkk..', '.kekkek.', '..kkkk..', '.rryrrr.', 'rrrrrrrr', 'rrrrrrrr'], { r: '#c0392b', d: '#7b241c', k: '#e0ac69', e: '#222', y: '#f1c40f' }),
  whistle: icon(['........', '.....k..', '....k...', '.sssss..', 'sswssss.', 'ssssssss', '.ssss...', '........'], { s: '#bdc3c7', w: '#2c3e50', k: '#e74c3c' }),
  wifi: icon(['.k..k...', '.k..k...', 'kkkkkk..', 'kkkkkk..', '.kkkk...', '..kk....', '..kk..r.', '..kkkkr.'], { k: '#ecf0f1', r: '#e74c3c' }),
  quiz: icon(['.wwwwww.', '.wwkkww.', '.wkwwkw.', '.wwwkww.', '.wwkwww.', '.wwwwww.', '.wwkwww.', '.wwwwww.'], { w: '#ffffff', k: '#c0392b' }),
  espresso: icon(['..s..s..', '...s..s.', '........', 'wwwwww..', 'wkkkkwww', 'wwwwww.w', 'wwwwwww.', '.wwww...'], { w: '#ecf0f1', k: '#6b3e1f', s: '#bdc3c7' }),
  chair: icon(['.bbbbb..', '.bbbbb..', '.bbbbb..', 'bbbbbbb.', '...k....', '...k....', '.kkkkk..', '.o.o.o..'], { b: '#2c3e50', k: '#7f8c8d', o: '#111' }),
  apple: icon(['....g...', '...gg...', '.rr.rr..', 'rrrrrrr.', 'rrwrrrr.', 'rrrrrrr.', '.rrrrr..', '..r.r...'], { r: '#e74c3c', g: '#27ae60', w: '#ffffff' }),
  stress: icon(['..oooo..', '.oooooo.', 'oowooooo', 'oooooooo', 'oooooooo', 'oooooooo', '.oooooo.', '..oooo..'], { o: '#e67e22', w: '#ffffff' }),
  clipboard: icon(['..kkkk..', '.bkkkkb.', '.bwwwwb.', '.bwkkwb.', '.bwwwwb.', '.bwkkwb.', '.bwwwwb.', '.bbbbbb.'], { b: '#a0703d', k: '#7f8c8d', w: '#ffffff' }),
  cutout: icon(['..hhhh..', '.hkkkkh.', '.kkkkkk.', '..dddd..', '.ccwwcc.', '.rrrrrr.', '...bb...', '.bbbbbb.'], { h: '#6b4423', k: '#f6cfa6', d: '#9c7458', c: '#a3a7ad', r: '#b5302a', w: '#ffffff', b: CUTOUT_BOARD }),
  memo: icon(['.......w', '.....www', '...wwwgw', '.wwwwgw.', 'wwwwgw..', '...wgw..', '....ww..', '.....w..'], { w: '#ffffff', g: '#bdc3c7' }),
  pizza: icon(['cccccccc', 'yyryyyry', '.yyyyyy.', '.yryyry.', '..yyyy..', '..yryy..', '...yy...', '...y....'], { c: '#d35400', y: '#f4d03f', r: '#c0392b' }),
  tonic: icon(['...kk...', '...gg...', '..gggg..', '.gggggg.', '.gwwwwg.', '.gwggwg.', '.gwwwwg.', '.gggggg.'], { k: '#6b3e1f', g: '#27ae60', w: '#ffffff' }),
};

// ---------- Stats (straight upgrades) ----------
const BASE_STATS = {
  speed: 1, grade: 1, desk: 1, shush: 1, reach: 1, calm: 1, escalate: 1,
  hairLoss: 1, regrow: 5, rapport: 0, warn: 0, time: 0, cooldown: 1, decay: 0,
};
const STAT_UPGRADES = [
  { id: 'speed', icon: 'shoe', name: 'Comfy Sneakers', desc: 'Walk 12% faster.', apply: (s) => { s.speed += 0.12; } },
  { id: 'grade', icon: 'pen', name: 'Red Pen Pro', desc: 'Grade papers 15% faster.', apply: (s) => { s.grade += 0.15; } },
  { id: 'desk', icon: 'desk', name: 'Bigger Desk', desc: 'Your desk zone is 20% bigger.', apply: (s) => { s.desk += 0.2; } },
  { id: 'shush', icon: 'voice', name: 'Teacher Voice', desc: 'Shush tables from 25% farther away.', apply: (s) => { s.shush += 0.25; } },
  { id: 'reach', icon: 'hand', name: 'Long Arms', desc: 'Take phones from 30% farther away.', apply: (s) => { s.reach += 0.3; } },
  { id: 'calm', icon: 'badge', name: 'Stern Reputation', desc: 'Problems show up 10% less often.', apply: (s) => { s.calm += 0.1; } },
  { id: 'escalate', icon: 'music', name: 'Lo-fi Playlist', desc: 'Rowdy tables get louder 25% slower.', apply: (s) => { s.escalate *= 0.75; } },
  { id: 'hairLoss', icon: 'zen', name: 'Zen Breathing', desc: 'Mr. Laporte loses hair 15% slower.', apply: (s) => { s.hairLoss *= 0.85; } },
  { id: 'regrow', icon: 'hair', name: 'Rogaine', desc: 'Regrow 15 hair now, plus 6 more hair after every round.', apply: (s) => { s.regrow += 6; run.hair = Math.min(100, run.hair + 15); } },
  { id: 'rapport', icon: 'heart', name: 'Good Rapport', desc: 'Every problem you fix lowers chaos by 3 more.', apply: (s) => { s.rapport += 3; } },
  { id: 'warn', icon: 'radio', name: 'Walkie-Talkie', desc: 'Get warned 1.5s earlier when the principal is coming.', apply: (s) => { s.warn += 1.5; } },
  { id: 'time', icon: 'clock', name: 'Overtime', desc: '+8 seconds before the bell rings.', apply: (s) => { s.time += 8; } },
  { id: 'cooldown', icon: 'folder', name: 'Organized Desk', desc: 'Item cooldowns are 12% shorter.', apply: (s) => { s.cooldown *= 0.88; } },
  { id: 'decay', icon: 'snow', name: 'Classroom Mgmt', desc: 'Chaos drains 1 point per second faster.', apply: (s) => { s.decay += 1; } },
];

function statLines() {
  const s = run.stats, out = [];
  const pct = (v) => `${Math.round(v * 100)}%`;
  if (s.speed !== 1) out.push(`SPEED +${pct(s.speed - 1)}`);
  if (s.grade !== 1) out.push(`GRADING +${pct(s.grade - 1)}`);
  if (s.desk !== 1) out.push(`DESK +${pct(s.desk - 1)}`);
  if (s.shush !== 1) out.push(`SHUSH +${pct(s.shush - 1)}`);
  if (s.reach !== 1) out.push(`REACH +${pct(s.reach - 1)}`);
  if (s.calm !== 1) out.push(`CALM +${pct(s.calm - 1)}`);
  if (s.escalate !== 1) out.push(`LOUDNESS -${pct(1 - s.escalate)}`);
  if (s.hairLoss !== 1) out.push(`HAIR LOSS -${pct(1 - s.hairLoss)}`);
  if (s.regrow !== BASE_STATS.regrow) out.push(`REGROW ${s.regrow}/RND`);
  if (s.rapport) out.push(`RAPPORT +${s.rapport}`);
  if (s.warn) out.push(`WARNING +${s.warn}S`);
  if (s.time) out.push(`BELL +${s.time}S`);
  if (s.cooldown !== 1) out.push(`COOLDOWN -${pct(1 - s.cooldown)}`);
  if (s.decay) out.push(`CHILL +${s.decay}/S`);
  return out;
}

// ---------- Active items ----------
const durAt = (def, l) => Math.round(def.dur * (1 + 0.25 * (l - 1)) * 10) / 10;
const cdAt = (def, l) => Math.round(def.cd * Math.pow(0.8, l - 1));
const usesAt = (def, l) => def.uses + (l - 1);
const whistleRadius = (l) => 240 + 50 * (l - 1);
const tonicAmount = (l) => 12 + 4 * (l - 1);

const ITEM_DEFS = [
  { id: 'ta', name: 'Teaching Assistant', cd: 45, dur: 15,
    desc: (l, d) => `A TA walks the aisles fixing phones and noise for ${durAt(d, l)}s.` },
  { id: 'chair', name: 'Rolling Chair', cd: 9, dur: 2.5,
    desc: (l, d) => `Hop in your rolling chair and zoom around 90% faster for ${durAt(d, l)}s.` },
  { id: 'chicken', name: 'Rubber Chicken', cd: 25, dur: 5,
    desc: (l, d) => `Throw it the way you're facing. The principal stops and stares at it for ${durAt(d, l)}s.` },
  { id: 'escort', name: 'Security Escort', uses: 1,
    desc: () => 'Two security guards march the closest table out of the cafeteria for the rest of the round.' },
  { id: 'whistle', name: 'Coach Whistle', cd: 20,
    desc: (l) => `Instantly quiets every rowdy table within ${whistleRadius(l)} pixels of you.` },
  { id: 'wifi', name: 'Unplug the Wi-Fi', cd: 40, dur: 8,
    desc: (l, d) => `Every phone goes away, and no new phones for ${durAt(d, l)}s.` },
  { id: 'quiz', name: 'Pop Quiz', cd: 40, dur: 10,
    desc: (l, d) => `No new problems for ${durAt(d, l)}s, and loud tables stop getting louder.` },
  { id: 'espresso', name: 'Espresso Shot', cd: 30, dur: 6,
    desc: (l, d) => `Grade 3x faster for ${durAt(d, l)}s.` },
  { id: 'clipboard', name: 'Clipboard', cd: 35, dur: 8,
    desc: (l, d) => `Take your grading with you. Grade anywhere for ${durAt(d, l)}s.` },
  { id: 'cutout', name: 'Cardboard Cutout', cd: 40, dur: 15,
    desc: (l, d) => `Leave a life-size cardboard Mr. Laporte where you stand. Nearby students behave for ${durAt(d, l)}s.` },
  { id: 'memo', name: 'Fake Memo', uses: 1,
    desc: () => 'An "urgent memo" sends the principal straight back to her office. She reads it the whole way out.' },
  { id: 'pizza', name: 'Pizza Party', uses: 1,
    desc: () => 'Bribery works. Every problem in the room is fixed instantly, and chaos drops by 20.' },
  { id: 'apple', name: 'Shiny Apple', uses: 1, passive: true,
    desc: () => 'Automatic: when the principal is about to catch you, she takes the apple instead.' },
  { id: 'stress', name: 'Stress Ball', cd: 30, dur: 6,
    desc: (l, d) => `Squeeze! Chaos drops by 35 and no hair loss for ${durAt(d, l)}s.` },
  { id: 'tonic', name: 'Hair Tonic', uses: 1,
    desc: (l) => `Rub it in. Regrows ${tonicAmount(l)} hair.` },
];

function itemMeta(def, l) {
  if (def.passive) return `AUTOMATIC  ${usesAt(def, l)}X PER ROUND`;
  if (def.uses !== undefined) return `${usesAt(def, l)}X PER ROUND`;
  return `COOLDOWN ${cdAt(def, l)}S`;
}

// ---------- Game state ----------
let state = 'title'; // title | playing | paused | caught | upgrade | lost
let level = 1;
let cfg = levelConfig(1);
let run = null;          // { stats, statPicks, items, hair, handled }
let tables = [];
let students = [];
let teacher = null;
let principal = null;
let ta = null;           // teaching assistant helper
let chicken = null;      // thrown rubber chicken
let cutout = null;       // cardboard Mr. Laporte
let escorts = [];        // security escorts in progress
let fx = {};             // timers for active item effects
let work = 0, chaos = 0, timeLeft = 0, spawnTimer = 0;
let gameTime = 0;
let speeches = [];       // { who, text, t }
let caught = null;       // { timer, x, y, reason }
let loseReason = '';
let bgCanvas = null;
let handled = 0;
let offer = null;        // upgrade screen state
let faceEvent = null;    // { type, t } short-lived expression on the portrait
let hairParticles = [];
let prevHair = null;     // hair pixels visible last frame (for falling-hair effect)
let bestLevel = 0;
try { bestLevel = parseInt(localStorage.getItem('studyhall-best-cleared') || '0', 10) || 0; } catch (e) { /* ignore */ }

function newRun() {
  run = { stats: { ...BASE_STATS }, statPicks: {}, items: [], hair: 100, handled: 0 };
  prevHair = null;
  hairParticles = [];
}

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
        students: [], rowdy: 0, rowdyTimer: 0, spreadTimer: 0, cooldown: 0,
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
          phone: false, cooldown: 0, phase: Math.random() * 10,
          sprite: makeSprite(s === 2 ? STUDENT_BACK : STUDENT_FRONT, pal),
        };
        t.students.push(st);
        students.push(st);
      }
    }
  }
  teacher = { x: COL_X[TEACHER_COL] + 62, y: ROW_Y[TEACHER_ROW], moving: false, walkT: 0, dir: { x: 1, y: 0 } };
  principal = {
    phase: 'away', next: cfg.principalFirst + rand(0, 8), warn: 0,
    x: -40, y: 0, path: [], idx: 0, facing: 0, pause: 0, lookT: 0, baseFacing: 0,
    suspicion: 0, side: 'left', walkT: 0, hold: 0, blind: 0, leaving: false,
  };
  for (const it of run.items) {
    it.cdLeft = 0;
    it.cdMax = 1;
    it.usesLeft = it.def.uses !== undefined ? usesAt(it.def, it.level) : 0;
  }
  ta = null;
  chicken = null;
  cutout = null;
  escorts = [];
  fx = { chair: 0, wifi: 0, quiz: 0, espresso: 0, clipboard: 0, stress: 0 };
  work = 0;
  chaos = 0;
  timeLeft = cfg.time + run.stats.time;
  spawnTimer = 2.5;
  speeches = [];
  caught = null;
  faceEvent = null;
  handled = 0;
  bgCanvas = renderBackground();
}

function startRun() {
  newRun();
  setupLevel(1);
  state = 'playing';
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
  if (e.repeat && k !== 'arrowup' && k !== 'arrowdown' && k !== 'arrowleft' && k !== 'arrowright') return;
  keys.add(k);

  if (k === 'm') muted = !muted;
  if (state === 'upgrade') { upgradeKey(k); return; }
  if (state === 'playing') {
    if (k === ' ') action();
    else if (k === 'p') state = 'paused';
    else if (ITEM_KEYS.includes(k)) useItem(ITEM_KEYS.indexOf(k));
  } else if (k === 'enter' || k === ' ') {
    if (state === 'title' || state === 'lost') startRun();
    else if (state === 'paused') state = 'playing';
  } else if (k === 'p' && state === 'paused') {
    state = 'playing';
  }
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => {
  keys.clear();
  if (state === 'playing') state = 'paused';
});

// Mouse support for the upgrade cards
function canvasPoint(e) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) * (canvas.width / r.width) - PANEL_W,
    y: (e.clientY - r.top) * (canvas.height / r.height),
  };
}
canvas.addEventListener('mousemove', (e) => {
  if (state !== 'upgrade') return;
  const hit = cardAt(canvasPoint(e));
  if (hit && hit.row === offer.step) offer.sel = hit.i;
});
canvas.addEventListener('click', (e) => {
  audio();
  if (state === 'title' || state === 'lost') { startRun(); return; }
  if (state !== 'upgrade') return;
  const hit = cardAt(canvasPoint(e));
  if (hit && hit.row === offer.step) { offer.sel = hit.i; confirmPick(); }
});

// ---------- Speech bubbles ----------
function sayAt(who, text, t = 0.9) {
  speeches = speeches.filter((s) => s.who !== who);
  speeches.push({ who, text, t });
}
function say(text) { sayAt(teacher, text); }

// ---------- Fixing problems (teacher, TA and items all use these) ----------
function fixPhone(s) {
  s.phone = false;
  s.cooldown = 8;
  chaos = Math.max(0, chaos - 3 - run.stats.rapport);
  handled++;
  run.handled++;
}
function fixRowdy(t) {
  t.rowdy = 0;
  t.rowdyTimer = 0;
  t.spreadTimer = 0;
  t.cooldown = 8;
  chaos = Math.max(0, chaos - 4 - run.stats.rapport);
  handled++;
  run.handled++;
}

function nearestPhone(from, range) {
  let best = null, bd = range;
  for (const s of students) {
    if (!s.phone) continue;
    const d = dist(from, s);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}
function nearestRowdy(from, range) {
  let best = null, bd = range;
  for (const t of tables) {
    if (!t.rowdy) continue;
    const d = dist(from, t);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}

// Space does whatever is needed nearby: takes a phone, shushes a table, or both
function action() {
  const s = nearestPhone(teacher, PHONE_RANGE * run.stats.reach);
  const t = nearestRowdy(teacher, SHUSH_RANGE * run.stats.shush);
  if (s) { fixPhone(s); sfx.phone(); }
  if (t) { fixRowdy(t); sfx.shush(); }
  say(s && t ? 'Shhh! Phone away!' : s ? 'Phone away!' : t ? 'Shhh!' : '?');
}

// ---------- Items ----------
function itemActiveTime(it) {
  switch (it.def.id) {
    case 'ta': return ta ? ta.t : 0;
    case 'chicken': return chicken ? chicken.stare : 0;
    case 'cutout': return cutout ? cutout.t : 0;
    default: return fx[it.def.id] || 0;
  }
}

const ITEM_USE = {
  ta(it) {
    const d = durAt(it.def, it.level);
    if (ta) { ta.t = Math.max(ta.t, d); ta.max = Math.max(ta.max, d); return true; }
    let node = null, bd = Infinity;
    for (const x of NAV_X) {
      for (const y of NAV_Y) {
        const dd = Math.hypot(teacher.x - x, teacher.y - y);
        if (dd < bd) { bd = dd; node = { x, y }; }
      }
    }
    ta = { x: node.x, y: node.y, t: d, max: d, path: [], target: null, walkT: 0, moving: false };
    sayAt(ta, "I'm on it!", 1.2);
    say('Help!');
    return true;
  },
  chair(it) {
    fx.chair = durAt(it.def, it.level);
    say('Wheee!');
    return true;
  },
  chicken(it) {
    // Land on open floor: shorten the throw until it clears tables and students
    let tx = teacher.x, ty = teacher.y;
    for (let d = 190; d >= 30; d -= 10) {
      const x = clamp(teacher.x + teacher.dir.x * d, 24, W - 24);
      const y = clamp(teacher.y + teacher.dir.y * d, HUD_H + 24, H - 24);
      const blocked = tables.some((t) => dist({ x, y }, t) < TABLE_R + 12 || t.students.some((s) => dist({ x, y }, s) < 24));
      if (!blocked) { tx = x; ty = y; break; }
    }
    chicken = { sx: teacher.x, sy: teacher.y - 10, x: tx, y: ty, fly: 0, landed: false, life: 20,
      stare: durAt(it.def, it.level), noticed: false };
    say('Hey, look!');
    return true;
  },
  escort() {
    let best = null, bd = 130;
    for (const t of tables) {
      if (t.teacher || !t.students.length || t.escorted) continue;
      const d = dist(teacher, t);
      if (d < bd) { bd = d; best = t; }
    }
    if (!best) { say('No table close!'); return false; }
    startEscort(best);
    say('Security!');
    return true;
  },
  whistle(it) {
    const r = whistleRadius(it.level);
    const near = tables.filter((t) => t.rowdy && dist(teacher, t) < r);
    if (!near.length) { say('All quiet!'); return false; }
    near.forEach(fixRowdy);
    say('TWEEET!');
    sfx.whistle();
    return true;
  },
  wifi(it) {
    students.filter((s) => s.phone).forEach(fixPhone);
    fx.wifi = durAt(it.def, it.level);
    say('Oops, Wi-Fi!');
    return true;
  },
  quiz(it) {
    fx.quiz = durAt(it.def, it.level);
    say('POP QUIZ!');
    return true;
  },
  espresso(it) {
    fx.espresso = durAt(it.def, it.level);
    say('*sip*');
    return true;
  },
  clipboard(it) {
    fx.clipboard = durAt(it.def, it.level);
    say('Grading on the go!');
    return true;
  },
  cutout(it) {
    cutout = { x: teacher.x, y: teacher.y, t: durAt(it.def, it.level), max: durAt(it.def, it.level) };
    say("I'm watching!");
    return true;
  },
  memo() {
    const pr = principal;
    if (pr.phase === 'warning') {
      pr.phase = 'away';
      pr.next = cfg.principalEvery * rand(0.8, 1.2);
      say('Memo sent!');
      return true;
    }
    if (pr.phase !== 'walking' || pr.leaving) { say('Nobody to fool!'); return false; }
    // She turns around and heads for the nearest door, nose in the memo
    pr.path = navRoute(pr, { x: pr.x < W / 2 ? -24 : W + 24, y: nearestOf(H_AISLES, pr.y), h: true });
    if (!pr.path.length) pr.path = [{ x: pr.x, y: pr.y }];
    pr.idx = 0;
    pr.pause = 0;
    pr.hold = 0;
    pr.leaving = true;
    pr.suspicion = 0;
    sayAt(pr, 'An urgent memo?!', 1.6);
    say('Memo for you!');
    return true;
  },
  pizza() {
    if (!activeIssueCount()) { say('Save it for later!'); return false; }
    students.filter((s) => s.phone).forEach(fixPhone);
    tables.filter((t) => t.rowdy).forEach(fixRowdy);
    chaos = Math.max(0, chaos - 20);
    say('PIZZA PARTY!');
    return true;
  },
  stress(it) {
    chaos = Math.max(0, chaos - 35);
    fx.stress = durAt(it.def, it.level);
    say('*squeeze*');
    return true;
  },
  tonic(it) {
    if (run.hair >= 100) { say('Hair is perfect!'); return false; }
    run.hair = Math.min(100, run.hair + tonicAmount(it.level));
    faceEvent = { type: 'happy', t: 1.2 };
    say('Ahh, better.');
    return true;
  },
};

function useItem(i) {
  const it = run.items[i];
  if (!it) return;
  const d = it.def;
  if (d.passive) { say('Automatic!'); return; }
  if (it.cdLeft > 0) { say('Not ready!'); sfx.nope(); return; }
  if (d.uses !== undefined && it.usesLeft <= 0) { say('All used up!'); sfx.nope(); return; }
  if (ITEM_USE[d.id](it) === false) { sfx.nope(); return; }
  if (d.cd) { it.cdMax = cdAt(d, it.level) * run.stats.cooldown; it.cdLeft = it.cdMax; }
  if (d.uses !== undefined) it.usesLeft--;
  it.flash = 0.4;
  sfx.item();
}

function updateItems(dt) {
  for (const it of run.items) {
    if (it.cdLeft > 0) it.cdLeft = Math.max(0, it.cdLeft - dt);
    if (it.flash > 0) it.flash -= dt;
  }
  for (const k in fx) if (fx[k] > 0) fx[k] = Math.max(0, fx[k] - dt);
  if (cutout) { cutout.t -= dt; if (cutout.t <= 0) cutout = null; }
}

// ---------- Teaching assistant (walks the aisle grid) ----------
// Every aisle line is free of tables, so a route of straight aisle segments
// (horizontal, then vertical, then horizontal) always gets there.
function onLineY(p) { return NAV_Y.some((y) => Math.abs(y - p.y) < 0.5); }
function onLineX(p) { return NAV_X.some((x) => Math.abs(x - p.x) < 0.5); }

function navRoute(from, goal) {
  const onH = onLineY(from), onV = onLineX(from);
  if (onH && goal.h && Math.abs(goal.y - from.y) < 0.5) return [{ x: goal.x, y: goal.y }];
  if (onV && !goal.h && Math.abs(goal.x - from.x) < 0.5) return [{ x: goal.x, y: goal.y }];
  let n0;
  if (onH && onV) n0 = { x: from.x, y: from.y };
  else if (onH) n0 = { x: nearestOf(NAV_X, from.x), y: from.y };
  else n0 = { x: from.x, y: nearestOf(NAV_Y, from.y) };
  const pts = [n0];
  if (goal.h) {
    const nx = nearestOf(NAV_X, goal.x);
    pts.push({ x: nx, y: n0.y }, { x: nx, y: goal.y }, { x: goal.x, y: goal.y });
  } else {
    pts.push({ x: goal.x, y: n0.y }, { x: goal.x, y: goal.y });
  }
  return pts.filter((p, i) => {
    const prev = i === 0 ? from : pts[i - 1];
    return Math.abs(p.x - prev.x) > 0.5 || Math.abs(p.y - prev.y) > 0.5;
  });
}

// A spot on the aisle grid close enough to deal with the problem
function approachPoint(target) {
  if (target.kind === 'phone') {
    const s = target.s, t = s.table;
    if (s.seat === 0) return { x: s.x, y: lastBelow(NAV_Y, t.y), h: true };
    if (s.seat === 2) return { x: s.x, y: firstAbove(NAV_Y, t.y), h: true };
    if (s.seat === 1) return { x: firstAbove(NAV_X, t.x), y: s.y, h: false };
    return { x: lastBelow(NAV_X, t.x), y: s.y, h: false };
  }
  const t = target.t;
  const up = lastBelow(NAV_Y, t.y), down = firstAbove(NAV_Y, t.y);
  return { x: t.x, y: Math.abs(ta.y - up) < Math.abs(ta.y - down) ? up : down, h: true };
}

function targetValid(target) {
  return target.kind === 'phone' ? target.s.phone && students.includes(target.s) : target.t.rowdy > 0;
}

function updateTA(dt) {
  if (!ta) return;
  ta.t -= dt;
  if (ta.t <= 0) {
    speeches = speeches.filter((s) => s.who !== ta);
    ta = null;
    return;
  }
  if (ta.target && !targetValid(ta.target)) { ta.target = null; ta.path = []; }
  if (!ta.target) {
    let best = null, bd = Infinity;
    for (const s of students) {
      if (s.phone && dist(ta, s) < bd) { bd = dist(ta, s); best = { kind: 'phone', s }; }
    }
    for (const t of tables) {
      if (t.rowdy && dist(ta, t) < bd) { bd = dist(ta, t); best = { kind: 'rowdy', t }; }
    }
    if (best) {
      ta.target = best;
      ta.path = navRoute(ta, approachPoint(best));
    }
  }
  if (followPath(ta, 150, dt) && ta.target) {
    if (ta.target.kind === 'phone') { fixPhone(ta.target.s); sayAt(ta, 'Phone, please!'); sfx.phone(); }
    else { fixRowdy(ta.target.t); sayAt(ta, 'Shhh!'); sfx.shush(); }
    ta.target = null;
  }
}

// Walk along `e.path` (after an optional `e.delay`). Returns true once there.
function followPath(e, speed, dt) {
  if (e.delay > 0) { e.delay -= dt; e.moving = false; return false; }
  e.moving = e.path.length > 0;
  if (!e.moving) return true;
  let step = speed * dt;
  e.walkT += dt;
  while (step > 0 && e.path.length) {
    const p = e.path[0];
    const d = Math.hypot(p.x - e.x, p.y - e.y);
    if (d <= step) { e.x = p.x; e.y = p.y; e.path.shift(); step -= d; }
    else { e.x += ((p.x - e.x) / d) * step; e.y += ((p.y - e.y) / d) * step; step = 0; }
  }
  return e.path.length === 0;
}

// ---------- Security escort ----------
// Two guards come in the nearest door, stand above and below the table, then
// march its students out of the cafeteria for the rest of the round.
function startEscort(t) {
  t.escorted = true;
  for (const s of t.students) if (s.phone) fixPhone(s);
  if (t.rowdy) fixRowdy(t);
  const door = { x: t.x < W / 2 ? -30 : W + 30, y: nearestOf(H_AISLES, t.y), h: true };
  const lines = [lastBelow(NAV_Y, t.y), firstAbove(NAV_Y, t.y)];
  const guards = lines.map((ly, i) => ({
    x: door.x, y: door.y, walkT: 0, delay: i * 0.5, moving: false,
    path: navRoute(door, { x: t.x, y: ly, h: true }),
  }));
  escorts.push({ table: t, door, lines, guards, walkers: [], phase: 'arrive' });
}

function updateEscorts(dt) {
  for (const es of escorts) {
    if (es.phase === 'arrive') {
      const arrived = es.guards.map((g) => followPath(g, 140, dt));
      if (!arrived.every(Boolean)) continue;
      es.phase = 'leave';
      sayAt(es.guards[0], "Let's go.", 1.4);
      const t = es.table;
      const queue = [0, 0];
      for (const s of t.students) {
        const side = s.seat === 2 ? 1 : 0; // the bottom seat follows the lower guard
        const first = { x: s.x, y: es.lines[side] };
        queue[side]++;
        es.walkers.push({
          x: s.x, y: s.y, sprite: s.sprite, walkT: 0, moving: false,
          delay: 0.25 + queue[side] * 0.4, path: [first, ...navRoute(first, es.door)],
        });
      }
      for (const g of es.guards) g.path = navRoute(g, es.door);
      students = students.filter((s) => s.table !== t);
      t.students = [];
    } else {
      const done = [...es.guards, ...es.walkers].map((w) => followPath(w, 115, dt));
      if (done.every(Boolean)) es.finished = true;
    }
  }
  escorts = escorts.filter((e) => !e.finished);
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
  teacher.dir = { x: dx / len, y: dy / len };
  const speed = TEACHER_SPEED * run.stats.speed * (fx.chair > 0 ? 1.9 : 1);
  teacher.x += teacher.dir.x * speed * dt;
  teacher.y += teacher.dir.y * speed * dt;
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

// Students near the cardboard Mr. Laporte think he's watching
const CUTOUT_RANGE = 230;
function nearCutout(p) { return cutout && dist(p, cutout) < CUTOUT_RANGE; }

function spawnIssue() {
  if (fx.quiz > 0) return;
  if (activeIssueCount() >= cfg.maxIssues) return;
  if (Math.random() < 0.55 && fx.wifi <= 0) {
    const options = students.filter((s) => !s.phone && s.cooldown <= 0 && !s.table.escorted &&
      !nearPrincipal(s) && !nearCutout(s));
    if (!options.length) return;
    pick(options).phone = true;
  } else {
    const options = tables.filter((t) => !t.teacher && !t.rowdy && t.cooldown <= 0 && !t.escorted &&
      t.students.length >= 2 && !nearPrincipal(t) && !nearCutout(t));
    if (!options.length) return;
    const t = pick(options);
    t.rowdy = 1;
    t.rowdyTimer = 0;
  }
  sfx.spawn();
}

function updateIssues(dt) {
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    const slow = principal.phase === 'walking' ? 1.6 : 1; // a bit calmer while she's around
    spawnTimer = cfg.spawn * rand(0.6, 1.4) * slow * run.stats.calm;
    spawnIssue();
  }

  for (const s of students) if (s.cooldown > 0) s.cooldown -= dt;

  for (const t of tables) {
    if (t.cooldown > 0) t.cooldown -= dt;
    if (!t.rowdy || fx.quiz > 0) continue;
    t.rowdyTimer += dt * run.stats.escalate;
    if (t.rowdy < 3 && t.rowdyTimer > 7) {
      t.rowdy++;
      t.rowdyTimer = 0;
      if (t.rowdy === 3) {
        // A table going full LOUD costs Mr. Laporte some hair
        if (fx.stress <= 0) run.hair = Math.max(0, run.hair - 2 * run.stats.hairLoss);
        faceEvent = { type: 'furious', t: 1.2 };
      }
    }
    if (t.rowdy === 3) {
      // Really loud tables get their neighbours riled up too
      t.spreadTimer += dt;
      if (t.spreadTimer > 6) {
        t.spreadTimer = 0;
        const nbrs = tables.filter((o) => !o.teacher && !o.rowdy && o.cooldown <= 0 && o.students.length >= 2 &&
          !o.escorted && !nearCutout(o) &&
          Math.abs(o.r - t.r) + Math.abs(o.c - t.c) === 1);
        if (nbrs.length) {
          const o = pick(nbrs);
          o.rowdy = 1; o.rowdyTimer = 0;
        }
      }
    }
  }

  // Chaos meter: rises when lots of trouble is going on, falls when it's calm
  const ROWDY_WEIGHT = [0, 1, 1.5, 2.2];
  let load = 0;
  for (const s of students) if (s.phone) load += 1;
  for (const t of tables) load += ROWDY_WEIGHT[t.rowdy];
  const rate = load * 1.5 - 2.5 - run.stats.decay;
  chaos = clamp(chaos + rate * (rate > 0 ? cfg.chaosMul : 1) * dt, 0, 100);
}

// Chaos stresses Mr. Laporte out, and stress makes his hair fall out.
function updateHair(dt) {
  if (fx.stress > 0 || chaos <= 15) return;
  const k = (chaos - 15) / 85;
  run.hair = Math.max(0, run.hair - 2.5 * k * k * run.stats.hairLoss * dt);
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
  pr.hold = 0;
  pr.blind = 0;
  pr.leaving = false;
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
      pr.warn = 3.5 + run.stats.warn;
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
  const distracted = !pr.leaving && chicken && chicken.landed && chicken.stare > 0 && pr.x > 0 && pr.x < W;
  if (pr.blind > 0) pr.blind -= dt;
  if (pr.hold > 0) {
    pr.hold -= dt;
  } else if (distracted) {
    desired = Math.atan2(chicken.y - pr.y, chicken.x - pr.x);
    chicken.stare -= dt;
    if (!chicken.noticed) { chicken.noticed = true; sayAt(pr, 'A chicken?!', 1.6); sfx.squeak(); }
  } else if (pr.pause > 0) {
    pr.pause -= dt;
    pr.lookT += dt;
    desired = pr.baseFacing + Math.sin(pr.lookT * 2.4) * 0.95; // look around
  } else {
    const target = pr.path[pr.idx];
    const dx = target.x - pr.x, dy = target.y - pr.y;
    const d = Math.hypot(dx, dy);
    const step = cfg.principalSpeed * (pr.leaving ? 1.5 : 1) * dt;
    pr.walkT += dt;
    if (d <= step) {
      pr.x = target.x;
      pr.y = target.y;
      pr.idx++;
      if (pr.idx >= pr.path.length) {
        pr.phase = 'away';
        pr.next = cfg.principalEvery * rand(0.7, 1.3);
        pr.suspicion = 0;
        pr.leaving = false;
        speeches = speeches.filter((s) => s.who !== pr);
        return;
      }
      const nxt = pr.path[pr.idx];
      pr.baseFacing = Math.atan2(nxt.y - pr.y, nxt.x - pr.x);
      pr.pause = pr.leaving ? 0 : 1.4;
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
  const seen = pr.blind > 0 || pr.leaving ? null : whatPrincipalSees();
  if (seen) {
    pr.suspicion += dt / 0.45;
    if (pr.suspicion >= 1) {
      const apple = run.items.find((i) => i.def.id === 'apple' && i.usesLeft > 0);
      if (apple) {
        apple.usesLeft--;
        apple.flash = 0.6;
        pr.suspicion = 0;
        pr.blind = 3;
        pr.hold = 2;
        sayAt(pr, 'Ooh, an apple!', 2);
        sfx.item();
      } else {
        caught = { timer: 1.8, ...seen };
        state = 'caught';
        sfx.caught();
      }
    }
  } else {
    pr.suspicion = Math.max(0, pr.suspicion - dt * 1.5);
  }
}

function updateChicken(dt) {
  if (!chicken) return;
  if (!chicken.landed) {
    chicken.fly += dt / 0.45;
    if (chicken.fly >= 1) { chicken.landed = true; sfx.squeak(); }
    return;
  }
  chicken.life -= dt;
  if (chicken.life <= 0 || chicken.stare <= 0) chicken = null;
}

function updatePortraitFx(dt) {
  if (faceEvent) { faceEvent.t -= dt; if (faceEvent.t <= 0) faceEvent = null; }
  for (const p of hairParticles) {
    p.vy += 18 * dt;
    p.y += p.vy * dt;
    p.x += Math.sin(p.y * 1.3 + p.seed) * 2 * dt;
    p.life -= dt;
  }
  hairParticles = hairParticles.filter((p) => p.life > 0 && p.y < 32);
}

function lose(reason) {
  loseReason = reason;
  state = 'lost';
  sfx.lose();
}

function winLevel() {
  bestLevel = Math.max(bestLevel, level);
  try { localStorage.setItem('studyhall-best-cleared', String(bestLevel)); } catch (e) { /* ignore */ }
  sfx.win();
  const before = run.hair;
  run.hair = Math.min(100, run.hair + run.stats.regrow);
  offer = makeOffer(Math.round(run.hair - before));
  state = 'upgrade';
}

function update(dt) {
  gameTime += dt;
  updatePortraitFx(dt);
  for (const s of speeches) s.t -= dt;
  speeches = speeches.filter((s) => s.t > 0);

  if (state === 'caught') {
    caught.timer -= dt;
    if (caught.timer <= 0) {
      lose(caught.reason === 'phone'
        ? 'The principal caught a student on their phone!'
        : 'The principal caught a rowdy table!');
    }
    return;
  }
  if (state !== 'playing') return;

  timeLeft -= dt;
  updateItems(dt);
  moveTeacher(dt);
  const desk = tables.find((t) => t.teacher);
  const atDesk = fx.clipboard > 0 || dist(teacher, desk) < WORK_RANGE * run.stats.desk;
  if (atDesk) work = Math.min(cfg.work, work + dt * run.stats.grade * (fx.espresso > 0 ? 3 : 1));
  updateIssues(dt);
  updateTA(dt);
  updateEscorts(dt);
  updateChicken(dt);
  updatePrincipal(dt);
  updateHair(dt);
  if (state !== 'playing') return;

  if (work >= cfg.work) {
    winLevel();
  } else if (run.hair <= 0) {
    lose('Mr. Laporte ran out of hair. He has gone home to lie down.');
  } else if (timeLeft <= 0) {
    timeLeft = 0;
    lose('The bell rang before you finished grading!');
  }
}

// ---------- Upgrade screen ----------
function makeOffer(regrew) {
  const statPool = STAT_UPGRADES.filter((u) => (run.statPicks[u.id] || 0) < MAX_STAT_PICKS);
  const stats = shuffle(statPool.slice()).slice(0, 3);
  const itemPool = [];
  for (const def of ITEM_DEFS) {
    const owned = run.items.find((i) => i.def === def);
    if (owned) {
      if (owned.level < MAX_ITEM_LEVEL) itemPool.push({ def, owned, level: owned.level + 1 });
    } else if (run.items.length < MAX_ITEMS) {
      itemPool.push({ def, owned: null, level: 1 });
    }
  }
  const items = shuffle(itemPool).slice(0, 3);
  return { stats, items, step: 0, sel: 0, pickedStat: -1, regrew };
}

const CARD_W = 290, CARD_H = 170, CARD_GAP = 15;
const CARD_X0 = (W - (CARD_W * 3 + CARD_GAP * 2)) / 2;
const CARD_ROW_Y = [128, 372];

function cardAt(p) {
  for (let row = 0; row < 2; row++) {
    const n = row === 0 ? offer.stats.length : offer.items.length;
    for (let i = 0; i < n; i++) {
      const x = CARD_X0 + i * (CARD_W + CARD_GAP), y = CARD_ROW_Y[row];
      if (p.x >= x && p.x <= x + CARD_W && p.y >= y && p.y <= y + CARD_H) return { row, i };
    }
  }
  return null;
}

function upgradeKey(k) {
  const n = offer.step === 0 ? offer.stats.length : offer.items.length;
  if (k === 'arrowleft') { offer.sel = (offer.sel + n - 1) % n; sfx.pick(); }
  if (k === 'arrowright') { offer.sel = (offer.sel + 1) % n; sfx.pick(); }
  if (k >= '1' && k <= String(n)) { offer.sel = Number(k) - 1; confirmPick(); return; }
  if (k === 'enter' || k === ' ') confirmPick();
}

function confirmPick() {
  if (offer.step === 0) {
    const u = offer.stats[offer.sel];
    if (u) {
      u.apply(run.stats);
      run.statPicks[u.id] = (run.statPicks[u.id] || 0) + 1;
      offer.pickedStat = offer.sel;
    }
    sfx.item();
    offer.step = 1;
    offer.sel = 0;
    if (!offer.items.length) finishUpgrade();
    return;
  }
  const choice = offer.items[offer.sel];
  if (choice.owned) choice.owned.level++;
  else run.items.push({ def: choice.def, level: 1, cdLeft: 0, cdMax: 1, usesLeft: 0, flash: 0 });
  sfx.item();
  finishUpgrade();
}

function finishUpgrade() {
  offer = null;
  setupLevel(level + 1);
  state = 'playing';
}

// ---------- Mr. Laporte's portrait (32x32 pixels, drawn procedurally) ----------
const PORTRAIT_SIZE = 224; // 32 pixels x 7
const PS = PORTRAIT_SIZE / 32;
const pcv = document.createElement('canvas');
pcv.width = pcv.height = 32;
const pctx = pcv.getContext('2d');

const HAIR_COL = '#6b4423', HAIR_HI = '#8b5a2b', HAIR_DK = '#4a2e17';
const BROW_COL = '#4a2e17';
const MOUTH_COL = '#6e2c1f', MOUTH_IN = '#4a1414', TEETH = '#f8f4ec';

// Every hair pixel gets a "keep score": the hairline recedes from the front,
// then the top thins, and the sides go last -- so he ends up with the classic
// horseshoe before going fully bald.
const HAIR_PIXELS = (() => {
  const out = [];
  const hash = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  for (let y = 2; y < 15; y++) {
    for (let x = 0; x < 32; x++) {
      const dx = Math.abs(x + 0.5 - 16);
      const inHair = (dx / 9.6) ** 2 + ((y + 0.5 - 14) / 11) ** 2 <= 1;
      // "M" hairline: widow's peak in the middle, temples pushed well back,
      // short sides that stop above the ears and clear of the eyebrows
      const hairline = dx < 2 ? 7 : dx < 3 ? 6 : dx < 4 ? 5 : dx < 6 ? 4 : dx < 7 ? 6 : 12;
      if (!inHair || y >= hairline) continue;
      const side = clamp((dx - 1) / 7, 0, 1);
      const low = clamp((y - 2) / 10, 0, 1);
      // Middle: the front hairline goes first and the top follows. Sides: sideburns stay longest.
      const vert = side * low + (1 - side) * (1 - low);
      const keep = clamp(0.6 * side + 0.28 * vert + 0.12 * hash(x, y), 0.02, 0.97);
      let col = HAIR_COL;
      if (y === hairline - 1 || dx > 7.5) col = HAIR_DK;
      else if (y <= 4 && x % 3 === 0) col = HAIR_HI;
      out.push({ x, y, keep, col, idx: y * 32 + x });
    }
  }
  return out;
})();

function faceExpression() {
  if (state === 'lost') return 'defeated';
  if (state === 'upgrade') return 'happy';
  if (state === 'title') return 'calm';
  if (state === 'caught') return 'shocked';
  if (faceEvent) return faceEvent.type;
  if (principal.phase === 'warning' || (principal.phase === 'walking' && principal.suspicion > 0.15)) return 'shocked';
  if (chaos >= 75) return 'furious';
  if (chaos >= 50) return 'frustrated';
  if (chaos >= 25) return 'annoyed';
  return 'calm';
}

function buildFace() {
  const g = [], fig = [];
  for (let y = 0; y < 32; y++) { g.push(new Array(32).fill(null)); fig.push(new Array(32).fill(false)); }
  const set = (x, y, c, figure = true) => {
    if (x < 0 || y < 0 || x > 31 || y > 31) return;
    g[y][x] = c;
    if (figure) fig[y][x] = true;
  };
  const row = (x0, x1, y, c) => { for (let x = x0; x <= x1; x++) set(x, y, c); };
  const expr = faceExpression();
  const hairFrac = run.hair / 100;
  const red = expr === 'furious';
  const skin = red ? '#f2a48a' : '#f6cfa6';
  const skinSh = red ? '#dc8668' : '#e2ae88';

  // Background: cafeteria wall
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      g[y][x] = y < 21 ? ((x + y) % 8 === 0 ? '#41607f' : '#3b5875') : y === 21 ? '#27394d' : '#2f4760';
    }
  }
  // Neck
  for (let y = 21; y < 26; y++) row(12, 19, y, skinSh);
  // Red and gray striped quarter-zip: undershirt in the open zip, collar folded down, zipper
  const STRIPES = [['#b5302a', '#8e241f'], ['#8f9399', '#6e7277']]; // [color, edge shade]
  const COLLAR = '#a3a7ad', COLLAR_EDGE = '#55595f', COLLAR_FOLD = '#c6cacf';
  const sweaterW = [5, 7, 9, 11, 12, 12, 12];
  for (let y = 25; y < 32; y++) {
    const hw = sweaterW[y - 25];
    const [col, shade] = STRIPES[Math.floor((y - 25) / 2) % 2];
    for (let x = 0; x < 32; x++) {
      const dx = Math.abs(x + 0.5 - 16);
      if (dx <= hw) set(x, y, dx > hw - 1.5 ? shade : col);
    }
  }
  row(14, 17, 23, '#d5dbdf');
  row(14, 17, 24, '#ecf0f1');
  row(14, 17, 25, '#ecf0f1');
  row(15, 16, 26, '#ecf0f1');
  // Collar lying flat, its points running down beside the opening
  const collarL = [[23, 9, 13], [24, 10, 13], [25, 11, 13], [26, 12, 13], [27, 13, 13]];
  for (const [y, x0, x1] of collarL) {
    const c = y === 23 ? COLLAR_FOLD : COLLAR;
    row(x0, x1, y, c);
    row(31 - x1, 31 - x0, y, c);
    set(x0, y, COLLAR_EDGE);
    set(31 - x0, y, COLLAR_EDGE);
  }
  set(15, 27, '#d0d4d6'); set(16, 27, '#d0d4d6');
  for (let y = 28; y < 32; y++) { set(15, y, '#3a3d42'); set(16, y, '#b9bec2'); }
  // Ears
  for (const [ex, sh] of [[6, 7], [25, 24]]) {
    for (let y = 13; y <= 16; y++) set(ex, y, skin);
    set(ex === 6 ? 5 : 26, 14, skin); set(ex === 6 ? 5 : 26, 15, skin);
    set(ex, 14, skinSh); set(ex, 15, skinSh);
  }
  // Head
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const e = ((x + 0.5 - 16) / 8.5) ** 2 + ((y + 0.5 - 14) / 10) ** 2;
      if (e <= 1) set(x, y, e > 0.7 && x + 0.5 > 16 ? skinSh : skin);
    }
  }
  // Nose
  set(16, 15, skinSh); set(16, 16, skinSh); set(15, 17, skinSh); set(16, 17, skinSh);
  // Stubble: mustache and chin only (no cheeks)
  const stub = (x, y) => set(x, y, (x + y) % 2 ? '#a07a5e' : '#b88f70');
  for (let x = 13; x <= 18; x++) if ((x + 18) % 2 === 0) stub(x, 18);
  for (let x = 12; x <= 19; x++) stub(x, 19);
  // stubble running down past the corners of the mouth joins the chin (goatee)
  stub(12, 20); stub(12, 21); stub(19, 20); stub(19, 21); stub(13, 21); stub(18, 21);
  stub(15, 21); stub(16, 21);
  for (let x = 13; x <= 18; x++) stub(x, 22);
  for (let x = 14; x <= 17; x++) stub(x, 23);

  // Eyes and eyebrows
  const blink = (gameTime % 3.7) < 0.13;
  const eyes = (style) => {
    for (const [x0, pupil] of [[10, 11], [19, 20]]) {
      if (style === 'closed') { row(x0, x0 + 2, 14, BROW_COL); continue; }
      if (style === 'happy') { row(x0, x0 + 2, 13, BROW_COL); set(x0, 14, BROW_COL); set(x0 + 2, 14, BROW_COL); continue; }
      if (style === 'wide') {
        for (let y = 12; y <= 14; y++) row(x0, x0 + 2, y, '#ffffff');
        set(x0 + 1, 13, '#1b1b1b');
        continue;
      }
      const top = style === 'squint' ? 14 : 13;
      for (let y = top; y <= 14; y++) row(x0, x0 + 2, y, '#ffffff');
      for (let y = top; y <= 14; y++) set(pupil, y, '#1b1b1b');
      if (style === 'lidded') row(x0, x0 + 2, 13, skinSh);
      if (style === 'down') { set(pupil, 13, '#ffffff'); }
    }
  };
  const brows = (style) => {
    const L = [10, 11, 12], R = [21, 20, 19]; // outer -> inner
    const ys = {
      flat: [11, 11, 11], low: [12, 12, 12], angry: [11, 12, 13], raised: [10, 9, 10], sad: [12, 11, 10],
    }[style];
    for (let i = 0; i < 3; i++) { set(L[i], ys[i], BROW_COL); set(R[i], ys[i], BROW_COL); }
  };
  // Mouths are drawn as rows of pixels around the center (x = 15/16)
  const mouth = (style) => {
    const D = MOUTH_COL;
    switch (style) {
      case 'smile': set(13, 20, D); row(14, 17, 21, D); set(18, 20, D); break;
      case 'flat': row(13, 18, 21, D); break;
      case 'grimace':
        row(13, 18, 20, D); set(13, 21, D); row(14, 17, 21, TEETH); set(18, 21, D); row(13, 18, 22, D);
        set(15, 21, '#d5cfc4');
        break;
      case 'yell':
        row(13, 18, 20, D);
        set(13, 21, D); row(14, 17, 21, TEETH); set(18, 21, D);
        set(13, 22, D); row(14, 17, 22, MOUTH_IN); set(18, 22, D);
        row(14, 17, 23, D);
        break;
      case 'o':
        set(15, 20, D); set(16, 20, D);
        set(14, 21, D); set(15, 21, MOUTH_IN); set(16, 21, MOUTH_IN); set(17, 21, D);
        set(14, 22, D); set(15, 22, MOUTH_IN); set(16, 22, MOUTH_IN); set(17, 22, D);
        set(15, 23, D); set(16, 23, D);
        break;
      case 'grin':
        set(12, 20, D); set(19, 20, D);
        set(13, 21, D); row(14, 17, 21, TEETH); set(18, 21, D);
        row(14, 17, 22, D);
        break;
      case 'frown': row(14, 17, 21, D); set(13, 22, D); set(18, 22, D); break;
      default: break;
    }
  };
  const FACES = {
    calm: ['normal', 'flat', 'smile'],
    annoyed: ['lidded', 'low', 'flat'],
    frustrated: ['squint', 'angry', 'grimace'],
    furious: ['squint', 'angry', 'yell'],
    shocked: ['wide', 'raised', 'o'],
    happy: ['happy', 'raised', 'grin'],
    defeated: ['down', 'sad', 'frown'],
  };
  const [eyeStyle, browStyle, mouthStyle] = FACES[expr];
  const canBlink = ['normal', 'lidded', 'squint', 'down'].includes(eyeStyle);
  eyes(blink && canBlink ? 'closed' : eyeStyle);
  brows(browStyle);
  mouth(mouthStyle);

  // Hair (what's left of it)
  const visible = new Set();
  for (const hp of HAIR_PIXELS) {
    if (hairFrac >= 1 - hp.keep) { set(hp.x, hp.y, hp.col); visible.add(hp.idx); }
  }
  if (prevHair && state === 'playing') {
    let spawned = 0;
    for (const hp of HAIR_PIXELS) {
      if (prevHair.has(hp.idx) && !visible.has(hp.idx) && spawned < 6) {
        hairParticles.push({ x: hp.x, y: hp.y, vy: 1, life: 2.2, seed: Math.random() * 6, col: hp.col });
        spawned++;
      }
    }
    if (spawned) sfx.pluck();
  }
  prevHair = visible;
  // Shiny scalp once enough hair is gone
  if (hairFrac < 0.6) {
    for (const [x, y] of [[12, 6], [13, 5], [14, 5]]) if (!visible.has(y * 32 + x)) set(x, y, '#fff1dc');
  }

  // Dark outline around the figure
  const out = g.map((r) => r.slice());
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      if (fig[y][x]) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => fig[y + dy] && fig[y + dy][x + dx]);
      if (near) out[y][x] = OUTLINE;
    }
  }

  // Extras on top: anger mark, sweat, tears
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < 32 && y < 32) out[y][x] = c; };
  if (expr === 'furious' && Math.floor(gameTime * 4) % 2) {
    for (const [x, y] of [[25, 2], [27, 2], [26, 3], [25, 4], [27, 4]]) put(x, y, '#e74c3c');
  }
  if (expr === 'frustrated' || expr === 'furious' || expr === 'shocked') {
    const dy = Math.floor(gameTime * 3) % 3;
    put(26, 7 + dy, '#d6f0ff'); put(25, 8 + dy, '#aee3ff'); put(26, 8 + dy, '#aee3ff');
    put(25, 9 + dy, '#7fc8f8'); put(26, 9 + dy, '#7fc8f8');
  }
  if (expr === 'defeated') {
    const dy = Math.floor(gameTime * 2) % 4;
    put(10, 15 + dy, '#7fc8f8'); put(21, 15 + ((dy + 2) % 4), '#7fc8f8');
  }
  return out;
}

function drawPortrait(x, y) {
  const g = buildFace();
  for (let j = 0; j < 32; j++) {
    for (let i = 0; i < 32; i++) {
      pctx.fillStyle = g[j][i];
      pctx.fillRect(i, j, 1, 1);
    }
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(pcv, x, y, PORTRAIT_SIZE, PORTRAIT_SIZE);
  for (const p of hairParticles) {
    ctx.fillStyle = p.col;
    ctx.fillRect(Math.round(x + p.x * PS), Math.round(y + p.y * PS), PS, PS);
  }
}

// ---------- Drawing helpers ----------
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

function wrapText(str, maxW, size) {
  ctx.font = `${size}px ${FONT}`;
  const words = str.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
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

function drawKeyCap(key, x, y, s = 7 * P, w = s) {
  pixelBox(x, y, w, s, '#fff');
  ctx.fillStyle = '#bbb';
  ctx.fillRect(Math.round(x) + P, Math.round(y + s) - 2 * P, w - 2 * P, P);
  const size = key.length > 1 ? 8 : 10;
  text(key, x + w / 2 + 1, y + s / 2 - size / 2, size, '#222', 'center', false);
}

function drawBar(x, y, w, h, frac, color, back = '#2b2b38') {
  pixelBox(x, y, w, h, back, '#000');
  const inner = Math.max(0, Math.round((w - 2 * P) * clamp(frac, 0, 1)));
  ctx.fillStyle = color;
  ctx.fillRect(x + P, y + P, inner, h - 2 * P);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(x + P, y + P, inner, P);
}

// ---------- Drawing: play area ----------
function drawWorkZone() {
  const desk = tables.find((t) => t.teacher);
  const rolling = fx.clipboard > 0;
  const center = rolling ? teacher : desk;
  const r = WORK_RANGE * run.stats.desk;
  const inside = rolling || dist(teacher, desk) < r;
  ctx.save();
  ctx.strokeStyle = inside ? 'rgba(46,204,113,0.9)' : 'rgba(46,139,87,0.45)';
  if (fx.espresso > 0 && inside) ctx.strokeStyle = 'rgba(241,196,15,0.95)';
  ctx.lineWidth = P;
  ctx.setLineDash([P * 2, P * 2]);
  ctx.lineDashOffset = -gameTime * (fx.espresso > 0 ? 40 : 12);
  ctx.beginPath();
  ctx.arc(center.x, center.y, rolling ? 40 : r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  if (!rolling) text('YOUR DESK', desk.x, desk.y + r + 4, 8, inside ? '#2ecc71' : '#3f6b4a', 'center', false);
}

function drawCutoutZone() {
  if (!cutout) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(160,112,61,0.55)';
  ctx.lineWidth = 2;
  ctx.setLineDash([P * 2, P * 3]);
  ctx.beginPath();
  ctx.arc(cutout.x, cutout.y, CUTOUT_RANGE, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawCone() {
  const pr = principal;
  if (pr.phase !== 'walking') return;
  ctx.save();
  const alert = pr.suspicion > 0;
  const blind = pr.blind > 0 || pr.leaving;
  ctx.fillStyle = blind ? 'rgba(180,180,180,0.18)' : alert ? 'rgba(231,76,60,0.28)' : 'rgba(255,221,87,0.28)';
  ctx.strokeStyle = blind ? 'rgba(150,150,150,0.5)' : alert ? 'rgba(192,57,43,0.8)' : 'rgba(214,170,30,0.8)';
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
  const s = 7 * P, w = key.length > 1 ? 18 * P : s;
  drawKeyCap(key, x - w / 2, y - s / 2 + Math.round(Math.sin(gameTime * 8) * 2), s, w);
}

function teacherSprite() {
  const h = run.hair;
  return teacherSprites[h <= 0 ? 0 : h < 30 ? 1 : h < 65 ? 2 : 3];
}

function drawEntities() {
  const list = [];
  for (const s of students) list.push({ y: s.y, kind: 'student', s });
  list.push({ y: teacher.y, kind: 'teacher' });
  if (principal.phase === 'walking') list.push({ y: principal.y, kind: 'principal' });
  if (ta) list.push({ y: ta.y, kind: 'ta' });
  if (cutout) list.push({ y: cutout.y, kind: 'cutout' });
  for (const es of escorts) {
    for (const g of es.guards) list.push({ y: g.y, kind: 'walker', w: g, spr: guardSprite });
    for (const w of es.walkers) list.push({ y: w.y, kind: 'walker', w, spr: w.sprite });
  }
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
      const spr = teacherSprite();
      if (fx.chair > 0 && teacher.moving) {
        ctx.globalAlpha = 0.25;
        drawSprite(spr, teacher.x - teacher.dir.x * 18, teacher.y - 8 - teacher.dir.y * 18);
        ctx.globalAlpha = 0.45;
        drawSprite(spr, teacher.x - teacher.dir.x * 9, teacher.y - 8 - teacher.dir.y * 9);
        ctx.globalAlpha = 1;
      }
      if (fx.chair > 0) {
        ctx.fillStyle = OUTLINE; ctx.fillRect(Math.round(teacher.x - 14), Math.round(teacher.y + 2), 28, 18);
        ctx.fillStyle = '#2c3e50'; ctx.fillRect(Math.round(teacher.x - 11), Math.round(teacher.y + 5), 22, 12);
      }
      const bob = teacher.moving && Math.floor(teacher.walkT * 8) % 2 ? -P : 0;
      drawSprite(spr, teacher.x, teacher.y - 8 + bob);
    } else if (e.kind === 'walker') {
      const w = e.w;
      if (w.x < -20 || w.x > W + 20) continue;
      const bob = w.moving && Math.floor(w.walkT * 8) % 2 ? -P : 0;
      drawSprite(e.spr, w.x, w.y - (e.spr === guardSprite ? 8 : 0) + bob);
    } else if (e.kind === 'cutout') {
      if (cutout.t < 2 && Math.floor(gameTime * 10) % 2) continue; // flicker before it's packed up
      const sway = Math.round(Math.sin(gameTime * 2) * 1);
      const spr = teacherSprites[3];
      ctx.fillStyle = OUTLINE;
      ctx.fillRect(Math.round(cutout.x - spr.width / 2 - 5 + sway), Math.round(cutout.y - 8 - spr.height / 2 - 5), spr.width + 10, spr.height + 10);
      ctx.fillStyle = CUTOUT_BOARD;
      ctx.fillRect(Math.round(cutout.x - spr.width / 2 - 2 + sway), Math.round(cutout.y - 8 - spr.height / 2 - 2), spr.width + 4, spr.height + 4);
      drawSprite(spr, cutout.x + sway, cutout.y - 8);
    } else if (e.kind === 'ta') {
      const bob = ta.moving && Math.floor(ta.walkT * 8) % 2 ? -P : 0;
      if (ta.t < 2 && Math.floor(gameTime * 10) % 2) continue; // flicker before leaving
      drawSprite(taSprite, ta.x, ta.y - 8 + bob);
      text('TA', ta.x, ta.y + 16, 8, '#e67e22', 'center');
    } else {
      const pr = principal;
      const bob = pr.pause <= 0 && pr.hold <= 0 && Math.floor(pr.walkT * 7) % 2 ? -P : 0;
      drawSprite(principalSprite, pr.x, pr.y - 8 + bob);
    }
  }
}

function drawChicken() {
  if (!chicken) return;
  if (chicken.landed) {
    const wob = Math.round(Math.sin(gameTime * 10));
    drawSprite(chickenSprite, chicken.x + wob, chicken.y);
    if (chicken.noticed && Math.floor(gameTime * 3) % 2) text('SQUEAK', chicken.x, chicken.y - 30, 8, '#e67e22', 'center');
    return;
  }
  const f = clamp(chicken.fly, 0, 1);
  const x = chicken.sx + (chicken.x - chicken.sx) * f;
  const y = chicken.sy + (chicken.y - chicken.sy) * f - Math.sin(Math.PI * f) * 70;
  drawSprite(chickenSprite, x, y);
}

function drawOverheads() {
  // Problem bubbles
  for (const t of tables) if (t.rowdy) drawRowdyBubble(t);
  for (const s of students) if (s.phone) drawPhoneBubble(s);
  drawChicken();

  // Key hints for whatever the teacher can deal with right now
  if (state === 'playing') {
    const phoneTarget = nearestPhone(teacher, PHONE_RANGE * run.stats.reach);
    const rowdyTarget = nearestRowdy(teacher, SHUSH_RANGE * run.stats.shush);
    if (phoneTarget) drawKeyHint('SPACE', phoneTarget.x, phoneTarget.y - 44);
    else if (rowdyTarget) drawKeyHint('SPACE', rowdyTarget.x, rowdyTarget.y - 44);
  }

  // Speech bubbles
  const pr = principal;
  for (const s of speeches) {
    const who = s.who;
    if (who === ta && !ta) continue;
    if (who === pr && pr.phase !== 'walking') continue;
    ctx.font = `10px ${FONT}`;
    const w = Math.max(10 * P, Math.ceil(ctx.measureText(s.text).width / P) * P + 6 * P);
    const bx = clamp(who.x, w / 2 + 8, W - w / 2 - 8);
    const b = bubble(bx, who.y - (who === pr ? 30 : 26), w, 8 * P, '#fff');
    text(s.text, b.x + w / 2, b.y + 7, 10, '#222', 'center', false);
  }

  // Principal's reaction
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

function drawEffectStrip() {
  const labels = [];
  if (fx.quiz > 0) labels.push([`POP QUIZ ${Math.ceil(fx.quiz)}`, '#9b59b6']);
  if (fx.wifi > 0) labels.push([`WI-FI DOWN ${Math.ceil(fx.wifi)}`, '#2980b9']);
  if (fx.espresso > 0) labels.push([`ESPRESSO x3 ${Math.ceil(fx.espresso)}`, '#8e5a2b']);
  if (fx.chair > 0) labels.push([`ROLLING CHAIR ${Math.ceil(fx.chair)}`, '#2c3e50']);
  if (fx.clipboard > 0) labels.push([`CLIPBOARD ${Math.ceil(fx.clipboard)}`, '#a0703d']);
  if (cutout) labels.push([`CUTOUT ${Math.ceil(cutout.t)}`, '#8a6a3a']);
  if (principal.leaving) labels.push(['READING MEMO', '#7d3c98']);
  if (fx.stress > 0) labels.push([`ZEN ${Math.ceil(fx.stress)}`, '#27ae60']);
  if (ta) labels.push([`TA ${Math.ceil(ta.t)}`, '#e67e22']);
  if (!labels.length) return;
  ctx.font = `8px ${FONT}`;
  const widths = labels.map(([s]) => Math.ceil(ctx.measureText(s).width) + 18);
  let x = W / 2 - (widths.reduce((a, b) => a + b, 0) + (labels.length - 1) * 6) / 2;
  labels.forEach(([s, col], i) => {
    pixelBox(x, H - 34, widths[i], 22, col, '#000');
    text(s, x + widths[i] / 2, H - 27, 8, '#fff', 'center', false);
    x += widths[i] + 6;
  });
}

function drawHUD() {
  ctx.fillStyle = '#23202d';
  ctx.fillRect(0, 0, W, HUD_H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, HUD_H - P, W, P);

  text(`LEVEL ${level}`, 14, 14, 12, '#ffd166');
  text(`HANDLED ${handled}`, 14, 38, 8, '#aaa');

  text('GRADING', 150, 12, 8, '#9be7b0');
  drawBar(150, 26, 260, 24, work / cfg.work, fx.espresso > 0 ? '#f1c40f' : '#2ecc71');
  text(`${Math.floor((work / cfg.work) * 100)}%`, 280, 32, 8, '#fff', 'center');

  text('CHAOS', 440, 12, 8, '#ff9a8b');
  const chaosColor = chaos > 75 ? (Math.floor(gameTime * 6) % 2 ? '#e74c3c' : '#ff7675') : chaos > 45 ? '#e67e22' : '#f1c40f';
  drawBar(440, 26, 220, 24, chaos / 100, chaosColor);

  const secs = Math.ceil(timeLeft);
  const tStr = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  text('BELL IN', 690, 12, 8, '#aaa');
  text(tStr, 690, 28, 16, timeLeft < 15 && Math.floor(gameTime * 4) % 2 ? '#e74c3c' : '#fff');

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
  ctx.fillStyle = 'rgba(10,8,16,0.8)';
  ctx.fillRect(0, 0, W, H);
  let y = H / 2 - (lines.length * 30) / 2;
  for (const l of lines) {
    const [str, size = 10, color = '#ddd'] = Array.isArray(l) ? l : [l];
    if (str) text(str, W / 2, y, size, color === 'accent' ? accent : color, 'center');
    y += Math.max(22, size + 14);
  }
}

function drawCard(x, y, opts) {
  const { selected, chosen, dim, iconSpr, name, tag, tagCol, desc, meta, num } = opts;
  const lift = selected ? -6 : 0;
  y += lift;
  if (selected) pixelBox(x - 4, y - 4, CARD_W + 8, CARD_H + 8, '#ffd166', '#000');
  if (chosen) pixelBox(x - 4, y - 4, CARD_W + 8, CARD_H + 8, '#2ecc71', '#000');
  pixelBox(x, y, CARD_W, CARD_H, dim ? '#1f1c28' : '#2f2b3d', '#000');
  ctx.globalAlpha = dim ? 0.4 : 1;
  pixelBox(x + 10, y + 10, 40, 40, '#4a4560', '#000');
  ctx.drawImage(iconSpr, x + 15, y + 15);
  text(name, x + 60, y + 14, 10, '#fff');
  text(tag, x + 60, y + 32, 8, tagCol);
  wrapText(desc, CARD_W - 28, 8).slice(0, 5).forEach((line, i) => text(line, x + 14, y + 64 + i * 16, 8, '#ddd', 'left', false));
  if (meta) text(meta, x + 14, y + CARD_H - 20, 8, '#85c1e9', 'left', false);
  drawKeyCap(String(num), x + CARD_W - 30, y + 8, 6 * P);
  ctx.globalAlpha = 1;
}

function drawUpgrade() {
  ctx.fillStyle = 'rgba(10,8,16,0.88)';
  ctx.fillRect(0, 0, W, H);
  text(`LEVEL ${level} COMPLETE!`, W / 2, 22, 20, '#2ecc71', 'center');
  const hairMsg = offer.regrew > 0 ? `Mr. Laporte regrew ${offer.regrew} hair over the weekend.` : 'Mr. Laporte made it through another one.';
  text(hairMsg, W / 2, 56, 8, '#e6c35c', 'center');

  const labels = ['STEP 1: PICK A STAT UPGRADE', 'STEP 2: PICK AN ITEM'];
  for (let row = 0; row < 2; row++) {
    const active = offer.step === row;
    text(labels[row], CARD_X0, CARD_ROW_Y[row] - 28, 10, active ? '#ffd166' : '#777');
  }
  offer.stats.forEach((u, i) => {
    const picks = run.statPicks[u.id] || 0;
    drawCard(CARD_X0 + i * (CARD_W + CARD_GAP), CARD_ROW_Y[0], {
      selected: offer.step === 0 && offer.sel === i,
      chosen: offer.pickedStat === i,
      dim: offer.step === 1 && offer.pickedStat !== i,
      iconSpr: ICONS[u.icon], name: u.name,
      tag: picks ? `STAT  (OWNED x${picks})` : 'STAT', tagCol: '#9be7b0',
      desc: u.desc, meta: '', num: i + 1,
    });
  });
  offer.items.forEach((c, i) => {
    const slot = c.owned ? run.items.indexOf(c.owned) + 1 : run.items.length + 1;
    drawCard(CARD_X0 + i * (CARD_W + CARD_GAP), CARD_ROW_Y[1], {
      selected: offer.step === 1 && offer.sel === i,
      chosen: false,
      dim: offer.step === 0,
      iconSpr: ICONS[c.def.id], name: c.def.name,
      tag: c.owned ? `UPGRADE TO LV${c.level}  (KEY ${ITEM_KEYS[slot - 1].toUpperCase()})`
        : `NEW ITEM  (KEY ${ITEM_KEYS[slot - 1].toUpperCase()})`,
      tagCol: c.owned ? '#ffd166' : '#ff9ff3',
      desc: c.def.desc(c.level, c.def), meta: itemMeta(c.def, c.level), num: i + 1,
    });
  });
  if (!offer.items.length && offer.step === 1) text('No items left to offer!', W / 2, CARD_ROW_Y[1] + 60, 10, '#aaa', 'center');
  text('ARROWS + ENTER, number keys, or click to choose', W / 2, 600, 8, '#aaa', 'center');
  text(`Next up: level ${level + 1}. More trouble, more grading, more principal.`, W / 2, 624, 8, '#777', 'center');
}

function drawTitle() {
  ctx.drawImage(bgCanvas, 0, 0);
  drawEntities();
  drawHUD();
  overlay([
    ['STUDY HALL', 32, 'accent'],
    ['SIMULATOR', 32, 'accent'],
    ['starring MR. LAPORTE', 10, '#e6c35c'],
    '',
    ['Stand by YOUR DESK to grade papers.', 10],
    ['Fill the GRADING bar before the bell rings!', 10],
    ['Phone or #@! bubble -> walk over, press SPACE', 10, '#85c1e9'],
    ['Chaos makes Mr. Laporte lose his HAIR.', 10, '#e6c35c'],
    ['No hair left, or the PRINCIPAL sees trouble:', 10, '#ff7675'],
    ['the run is over.', 10, '#ff7675'],
    ['Beat a level: pick a stat AND an item.', 10, '#9be7b0'],
    ['Use items with Q W E / A S D.', 10, '#9be7b0'],
    '',
    [Math.floor(gameTime * 2) % 2 ? 'PRESS ENTER TO START' : '', 14, '#fff'],
  ]);
}

function drawPlayArea() {
  if (state === 'title') { drawTitle(); return; }

  ctx.drawImage(bgCanvas, 0, 0);
  drawWorkZone();
  drawCutoutZone();
  drawCone();
  drawEntities();
  drawOverheads();
  drawEffectStrip();
  drawHUD();
  drawPrincipalWarning();

  if (state === 'paused') {
    overlay([['PAUSED', 24, 'accent'], '', ['Press P or ENTER to resume', 10]]);
  } else if (state === 'upgrade') {
    drawUpgrade();
  } else if (state === 'lost') {
    overlay([
      ['RUN OVER', 24, '#e74c3c'],
      '',
      [loseReason, 10],
      '',
      [`Made it to level ${level}`, 12, '#fff'],
      [`Problems handled this run: ${run.handled}`, 10, '#aaa'],
      [`Items: ${run.items.length}   Stat upgrades: ${Object.values(run.statPicks).reduce((a, b) => a + b, 0)}`, 10, '#aaa'],
      [`Best: cleared level ${bestLevel}`, 10, '#ffd166'],
      '',
      ['PRESS ENTER FOR A NEW RUN', 12, '#fff'],
    ]);
  }
}

// ---------- Drawing: side panel ----------
function drawItemSlot(i, y) {
  const it = run.items[i];
  const x = 10, w = PANEL_W - 20, h = 42;
  const flash = it && it.flash > 0;
  pixelBox(x, y, w, h, flash ? '#4d4766' : it ? '#2f2b3d' : '#1c1a24', '#000');
  ctx.globalAlpha = it ? 1 : 0.35;
  drawKeyCap(ITEM_KEYS[i].toUpperCase(), x + 8, y + 10, 6 * P);
  ctx.globalAlpha = 1;
  if (!it) {
    text('- empty -', x + 44, y + 17, 8, '#555', 'left', false);
    return;
  }
  ctx.drawImage(ICONS[it.def.id], x + 34, y + 6);
  const name = it.level > 1 ? `${it.def.name} ${it.level}` : it.def.name;
  text(name, x + 70, y + 8, 8, '#fff', 'left', false);

  const bx = x + 70, by = y + 24, bw = w - 80;
  const active = itemActiveTime(it);
  const d = it.def;
  if (active > 0) {
    const max = d.id === 'ta' && ta ? ta.max : durAt(d, it.level);
    drawBar(bx, by, bw, 12, active / max, '#2ecc71');
    text('ACTIVE', bx + bw / 2, by + 2, 8, '#fff', 'center', false);
  } else if (d.passive) {
    text(it.usesLeft > 0 ? 'AUTO: READY' : 'AUTO: USED', bx, by + 2, 8, it.usesLeft > 0 ? '#2ecc71' : '#e74c3c', 'left', false);
  } else if (it.cdLeft > 0) {
    drawBar(bx, by, bw, 12, 1 - it.cdLeft / it.cdMax, '#7f8c8d');
    text(`${Math.ceil(it.cdLeft)}s`, bx + bw / 2, by + 2, 8, '#fff', 'center', false);
  } else if (d.uses !== undefined) {
    text(it.usesLeft > 0 ? `READY  (${it.usesLeft} LEFT)` : 'USED UP', bx, by + 2, 8, it.usesLeft > 0 ? '#2ecc71' : '#e74c3c', 'left', false);
  } else {
    text('READY', bx, by + 2, 8, '#2ecc71', 'left', false);
  }
}

function drawPanel() {
  ctx.fillStyle = '#23202d';
  ctx.fillRect(0, 0, PANEL_W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(PANEL_W - P, 0, P, H);

  text('MR. LAPORTE', PANEL_W / 2, 8, 12, '#ffd166', 'center');

  // Portrait in a wooden frame
  const px = (PANEL_W - PORTRAIT_SIZE) / 2, py = 35;
  pixelBox(px - 9, py - 9, PORTRAIT_SIZE + 18, PORTRAIT_SIZE + 18, '#8a5a2b', '#000');
  ctx.fillStyle = '#000';
  ctx.fillRect(px - 3, py - 3, PORTRAIT_SIZE + 6, PORTRAIT_SIZE + 6);
  drawPortrait(px, py);

  // Hair meter
  const hair = run.hair;
  text(fx.stress > 0 ? 'HAIR (ZEN)' : 'HAIR', 14, 276, 8, '#e6c35c');
  text(`${Math.ceil(hair)}%`, PANEL_W - 14, 276, 8, '#fff', 'right');
  const hairCol = hair > 60 ? '#8b5a2b' : hair > 30 ? '#d68910' : (Math.floor(gameTime * 4) % 2 ? '#e74c3c' : '#c0392b');
  drawBar(14, 290, PANEL_W - 28, 20, hair / 100, hairCol);

  // Stats
  text('STATS', 14, 320, 8, '#9be7b0');
  const lines = statLines();
  if (!lines.length) text('No upgrades yet', 14, 338, 8, '#555', 'left', false);
  lines.slice(0, 14).forEach((l, i) => {
    text(l, 14 + (i % 2) * 140, 338 + Math.floor(i / 2) * 13, 8, '#ddd', 'left', false);
  });

  // Items
  text('ITEMS', 14, 434, 8, '#ff9ff3');
  text('Q W E / A S D', PANEL_W - 14, 434, 8, '#666', 'right', false);
  for (let i = 0; i < MAX_ITEMS; i++) drawItemSlot(i, 450 + i * 44);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawPanel();
  ctx.save();
  ctx.translate(PANEL_W, 0);
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  drawPlayArea();
  ctx.restore();
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

newRun();
setupLevel(1);
canvas.focus();
requestAnimationFrame(frame);
