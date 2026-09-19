/**
 * _zfight-pixels - the PIXEL half of the z-fight sweep.
 *
 * scripts/coplanar.mjs says which faces share a plane; this shows the dither going
 * away on screen for the largest pairs the sweep fixed. Ten viewpoints, each 3-10 m
 * from one fixed pair, capture the built page through real Chrome (WebGPU) with
 * Math.random seeded from an init script (core/materials.ts paints 43 random textures
 * per load, so unseeded runs differ on 15-21% of pixels and any comparison is noise).
 *
 * THE RECTANGLE IS NOT TYPED IN. Each viewpoint names the pair(s) it looks at by a
 * predicate over the instrument's BEFORE report; their overlap rectangles come out of
 * that JSON as four world points (`quad`) and are projected through the viewpoint's own
 * camera parameters. The measured region is the coplanar overlap itself, wherever it
 * lands on screen, and it is the same region for the before and the after frame.
 *
 * THE METRIC is the vehicles lane's: a pixel is SPECKLED when its luma differs from
 * the median of its eight neighbours by >= T (T = 4, 6, 10). Z-fighting is
 * salt-and-pepper by construction; a flat panel, a gradient or an even grain scores
 * near zero. A same-build control (two loads of one dist) bounds the residual noise.
 *
 *   node scripts/_zfight-pixels.mjs --tag before --pairs captures/_zfight-before-quads.json
 *   node scripts/_zfight-pixels.mjs --tag after  --pairs captures/_zfight-before-quads.json
 *   node scripts/_zfight-pixels.mjs --tag control --pairs ...     (a repeat load of the after build)
 *   node scripts/_zfight-pixels.mjs --report                       (table from the three JSONs)
 *
 * Writes captures/_zfight-px-<tag>-<view>.png (frames), captures/_zfight-crop-<view>-<tag>.png
 * (3x nearest-neighbour crops of the region) and captures/_zfight-pixels-<tag>.json.
 */
import { chromium } from 'playwright';
import * as THREE from 'three';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';
import { readPng, luma } from './_critic-png.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures');
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : d; };
const TAG = opt('--tag', 'before');
const PAIRS = opt('--pairs', join(OUT, '_zfight-before-quads.json'));
const REPORT = argv.includes('--report');

const W = 1600, H = 900;
const D = Math.PI / 180;
const THRESHOLDS = [4, 6, 10];

/** yaw such that the camera at `from` looks at `to` (forward = (-sin yaw, 0, -cos yaw)). */
function aim(from, to) {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  return { yaw, pitch };
}
/**
 * `floor` is an optional world rectangle of the SAME material known to be one surface
 * (a metre of the same wall, away from the pair). The metric reads a mapped texture's
 * own grain as speckle - stucco is painted with 5000 dots - so a region that stops
 * fighting does not read 0, it reads the floor. The report prints both.
 */
function view(name, from, to, fov, note, match, floor = null) {
  return { name, pos: from, ...aim(from, to), fov, note, match, at: to, floor };
}
const rectX = (x, z0, z1, y0, y1) => [[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]];
const rectZ = (z, x0, x1, y0, y1) => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
const rectY = (y, x0, x1, z0, z1) => [[x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]];
const near = (p, c, r) => Math.hypot(p.centre[0] - c[0], p.centre[1] - c[1], p.centre[2] - c[2]) < r;
const mat = (p, a, b) => (p.a.material.startsWith(a) && p.b.material.startsWith(b)) || (p.a.material.startsWith(b) && p.b.material.startsWith(a));
const mods = (p, a, b) => (p.a.module === a && p.b.module === b) || (p.a.module === b && p.b.module === a);

/**
 * The ten viewpoints, each 3-10 m from the pair(s) it measures. `match` picks those
 * pairs out of the BEFORE report; the union of their overlap rectangles is measured.
 */
const VIEWS = [
  view('apronCornerNW', [-28.5, 2.6, 52.0], [-36.1, 0.0, 59.7], 60,
    'desert fringe on paving, apron NW corner (ragged outline self-crossing)',
    (p) => p.axis === 'y' && Math.abs(p.offset) < 1e-4 && mods(p, 'ground', 'ground') && mat(p, 'paving', 'painted(#8a7a5e'),
    rectY(0, -31.5, -30.0, 54.5, 56.0)),
  view('garageCornerWest', [-17.0, 1.6, -19.0], [-12.6, 1.8, -22.8], 66,
    'orange garage end wall: back wall end face + roof slab edge on its outer plane',
    (p) => mods(p, 'orange-house', 'orange-house') && mat(p, 'stuccoCream', 'stuccoCream')
      && p.plane.startsWith('x=-12.6000') && p.centre[1] < 3.6,
    rectX(-12.6, -20.6, -19.4, 1.0, 3.0)),
  view('thirdHouseRear', [30.5, 1.7, 0.4], [24.3, 0.5, 0.1], 62,
    'third house rear hedge flush with the back wall',
    (p) => mods(p, 'third-house', 'third-house') && p.plane.startsWith('x=24.3040') && mat(p, 'painted(#2f4a24', 'painted(#d8d2c6')),
  view('upstairsFrontWallTop', [0.6, 4.7, -20.6], [0.6, 3.15, -16.2], 64,
    'orange upper floor: ground-floor front wall top on the slab top (the band the timber floor leaves bare)',
    (p) => mods(p, 'orange-house', 'orange-house') && p.plane.startsWith('y=3.1500') && mat(p, 'interiorWall', 'stuccoCream')
      && p.centre[2] > -16.6 && p.centre[2] < -15.9 && p.centre[0] > -0.6 && p.centre[0] < 1.9,
    rectY(3.15, -0.4, 1.6, -17.3, -16.7)),
  view('garageCornerSouth', [-15.6, 1.6, -27.6], [-12.5, 1.8, -22.8], 66,
    'orange garage rear corner from the yard side: the end wall end face and the back wall face on one plane',
    (p) => mods(p, 'orange-house', 'orange-house') && mat(p, 'stuccoCream', 'stuccoCream')
      && p.plane.startsWith('z=-22.8000') && p.centre[1] < 3.6 && p.centre[0] < -12.0,
    rectZ(-22.8, -11.0, -9.6, 1.0, 3.0)),
  view('frontHedgeJoint', [-6.0, 1.6, 5.0], [-9.81, 1.15, 7.67], 64,
    'orange frontage hedge joint: the taller west block, its rounded-top cap on its own end face, above the east block',
    (p) => mods(p, 'yards', 'yards') && mat(p, 'hedge', 'hedge') && p.plane.startsWith('x=-9.8100') && near(p, [-9.81, 0.77, 7.67], 0.6),
    rectZ(7.25, -9.2, -8.2, 0.3, 0.9)),
  view('whiteDriveLip', [10.8, 1.55, 1.9], [9.9, 0.07, 7.0], 62,
    'white drive apron lip on the frontage pad lip, east apron',
    (p) => mods(p, 'ground', 'ground') && p.plane.startsWith('z=7.0000') && mat(p, 'painted(#c6bba6', 'painted(#cfc4ad')),
  view('rearStairStringer', [8.4, 1.6, -33.1], [8.4, 1.45, -28.9], 62,
    'orange external stair: stringer face on the tread ends',
    (p) => mods(p, 'orange-house', 'orange-house') && mat(p, 'deckBoards', 'timberDark') && p.plane.startsWith('z=-28.8750'),
    rectZ(-29.92, 6.0, 6.2, 0.5, 2.5)),   // the nearest deck leg: the same timberDark, one surface
  view('innerStairNosings', [5.4, 1.65, -18.9], [5.4, 1.1, -22.4], 64,
    'orange internal stair: yellow nosings on the tread tops',
    (p) => mods(p, 'orange-house', 'orange-house') && mat(p, 'painted(#6d8d8b', 'painted(#d8b23a') && p.plane.startsWith('y=')),
  view('slabEdgeFromYard', [-3.2, 1.65, -31.6], [-3.2, 3.04, -26.6], 64,
    'orange back elevation, west of the deck: upper slab edge on the back wall plane',
    (p) => mods(p, 'orange-house', 'orange-house') && p.plane.startsWith('z=-26.6000') && mat(p, 'interiorWall', 'stuccoCream') && p.centre[0] < 0.3,
    rectZ(-26.6, -4.6, -2.0, 2.55, 2.9)),
];

// ---------------------------------------------------------------- png writing
function crc32(buf) {
  let c; const t = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let crc = 0xffffffff;
  for (const b of buf) crc = t[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}
function writePng(path, w, h, rgb) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (stride + 1)] = 0; rgb.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]));
}
/** Nearest-neighbour only: a resample kernel invents values a speckle test would read. */
function crop(img, path, x0, y0, x1, y1, s, outline) {
  x0 = Math.max(0, x0); y0 = Math.max(0, y0);
  x1 = Math.min(img.width, x1); y1 = Math.min(img.height, y1);
  const w = (x1 - x0) * s, h = (y1 - y0) * s;
  if (w <= 0 || h <= 0) return null;
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x0 + Math.floor(x / s), sy = y0 + Math.floor(y / s);
      const i = (sy * img.width + sx) * img.bpp, o = (y * w + x) * 3;
      const edge = outline && outline(sx, sy);
      out[o] = edge ? 255 : img.data[i]; out[o + 1] = edge ? 0 : img.data[i + 1]; out[o + 2] = edge ? 255 : img.data[i + 2];
    }
  }
  writePng(path, w, h, out);
  return { w, h };
}

// ------------------------------------------------------------- projection
function camera(v) {
  const cam = new THREE.PerspectiveCamera(v.fov, W / H, 0.1, 500);
  cam.position.set(v.pos[0], v.pos[1], v.pos[2]);
  cam.rotation.set(0, 0, 0, 'YXZ');
  cam.rotation.y = v.yaw;
  cam.rotation.x = v.pitch;
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}
function projectQuad(cam, quad) {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
  return quad.map(([x, y, z]) => {
    const v = new THREE.Vector3(x, y, z);
    const inFront = v.clone().sub(cam.position).dot(fwd) > 0.05;
    const dist = v.distanceTo(cam.position);
    v.project(cam);
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, inFront, dist };
  });
}
function inQuad(q, x, y) {
  let sign = 0;
  for (let i = 0; i < q.length; i++) {
    const a = q[i], b = q[(i + 1) % q.length];
    const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
    if (c === 0) continue;
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s; else if (s !== sign) return false;
  }
  return true;
}
/** Shrink a convex quad toward its centroid so edge pixels (real contrast) stay out. */
function inset(pts, f) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return pts.map((p) => ({ x: cx + (p.x - cx) * f, y: cy + (p.y - cy) * f }));
}

// ------------------------------------------------------------- the speckle metric
/** |luma - median(8 neighbours)| >= T over the union of the quads. */
function speckle(img, quads, box) {
  const n = [];
  const counts = THRESHOLDS.map(() => 0);
  let total = 0, sum = 0;
  for (let y = Math.max(1, box.y0); y < Math.min(img.height - 1, box.y1); y++) {
    for (let x = Math.max(1, box.x0); x < Math.min(img.width - 1, box.x1); x++) {
      if (!quads.some((q) => inQuad(q, x + 0.5, y + 0.5))) continue;
      n.length = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx || dy) n.push(luma(img, x + dx, y + dy));
      }
      n.sort((a, b) => a - b);
      const med = (n[3] + n[4]) / 2;
      const d = Math.abs(luma(img, x, y) - med);
      for (let i = 0; i < THRESHOLDS.length; i++) if (d >= THRESHOLDS[i]) counts[i]++;
      total++; sum += luma(img, x, y);
    }
  }
  const out = { pixels: total, meanLuma: total ? +(sum / total).toFixed(2) : 0 };
  THRESHOLDS.forEach((t, i) => { out['t' + t] = total ? +(100 * counts[i] / total).toFixed(3) : 0; });
  return out;
}

// ------------------------------------------------------------- regions from the report
function regions() {
  const rep = JSON.parse(readFileSync(PAIRS, 'utf8'));
  const out = {};
  for (const v of VIEWS) {
    const pairs = rep.pairs.filter((p) => p.fight && p.area > 0.002 && v.match(p));
    const cam = camera(v);
    const quads = [], raw = [];
    let minDist = Infinity, maxDist = 0, area = 0;
    for (const p of pairs) {
      // A pair whose overlap is several separate patches (the two apron corners of the
      // desert/paving sheet) has a bounding quad spanning the map; measure its patches
      // instead - a square of the patch's own area round the instrument's centroid.
      const wide = Math.max(...p.extent) > 20;
      const quadsOf = wide && p.patches && p.axis
        ? p.patches.filter((t) => t.area > 0.5).map((t) => {
          const h = Math.sqrt(t.area) / 2, [x, y, z] = t.at;
          if (p.axis === 'y') return [[x - h, y, z - h], [x + h, y, z - h], [x + h, y, z + h], [x - h, y, z + h]];
          if (p.axis === 'x') return [[x, y - h, z - h], [x, y + h, z - h], [x, y + h, z + h], [x, y - h, z + h]];
          return [[x - h, y - h, z], [x + h, y - h, z], [x + h, y + h, z], [x - h, y + h, z]];
        })
        : [p.quad];
      for (const wq of quadsOf) {
        const q = projectQuad(cam, wq);
        if (!q.every((c) => c.inFront)) continue;
        if (!q.some((c) => c.x >= 0 && c.x <= W && c.y >= 0 && c.y <= H)) continue;
        for (const c of q) { minDist = Math.min(minDist, c.dist); maxDist = Math.max(maxDist, c.dist); }
        raw.push(q.map((c) => [Math.round(c.x), Math.round(c.y)]));
        quads.push(inset(q, 0.85));
        area += wide ? 0 : p.area;
      }
      if (wide) area += p.area;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of quads) for (const c of q) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); }
    const box = quads.length ? { x0: Math.floor(x0), y0: Math.floor(y0), x1: Math.ceil(x1), y1: Math.ceil(y1) } : null;
    let floorQ = null, floorBox = null;
    if (v.floor) {
      const fq = projectQuad(cam, v.floor);
      if (fq.every((c) => c.inFront)) {
        floorQ = [inset(fq, 0.85)];
        const xs = floorQ[0].map((c) => c.x), ys = floorQ[0].map((c) => c.y);
        floorBox = { x0: Math.floor(Math.min(...xs)), y0: Math.floor(Math.min(...ys)), x1: Math.ceil(Math.max(...xs)), y1: Math.ceil(Math.max(...ys)) };
      }
    }
    out[v.name] = { view: { pos: v.pos, yaw: v.yaw, pitch: v.pitch, fov: v.fov, note: v.note }, pairs: pairs.length, areaM2: +area.toFixed(3), quads, quadsPx: raw, box, distM: quads.length ? [+minDist.toFixed(1), +maxDist.toFixed(1)] : null, floorQ, floorBox };
  }
  return out;
}

// ------------------------------------------------------------- report mode
if (REPORT) {
  const load = (t) => { const f = join(OUT, '_zfight-pixels-' + t + '.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };
  const before = load('before'), after = load('after'), control = load('control');
  if (!before || !after) { console.error('need before and after JSONs'); process.exit(2); }
  const f = (x, w) => String(x).padStart(w);
  console.log('view                    pairs  area m2  dist m     px   before t4/t6/t10 %     after t4/t6/t10 %    floor(after) t4/t6/t10  ctrl-vs-after t4  verdict');
  for (const v of VIEWS) {
    const b = before.results[v.name], a = after.results[v.name], c = control && control.results[v.name];
    if (!b || !a || !b.speckle.pixels) { console.log(v.name.padEnd(24) + ' (no region in frame)'); continue; }
    const bs = b.speckle, as = a.speckle, cs = c && c.speckle, fl = a.floor;
    // the after must be within a point of the material's own grain (or under 1% flat)
    const okAfter = as.t6 < 1 || (fl && as.t6 <= fl.t6 + 1.0 && as.t10 <= fl.t10 + 0.5);
    const verdict = okAfter ? (bs.t6 > 5 ? 'PASS (>5% -> floor)' : 'clean (before ' + bs.t6 + '%)') : 'FAIL after ' + as.t6 + '%';
    console.log(v.name.padEnd(24) + f(b.pairs, 5) + f(b.areaM2.toFixed(3), 9) + f((b.distM || ['-', '-']).join('-'), 10)
      + f(bs.pixels, 7) + '   ' + f(bs.t4, 6) + '/' + f(bs.t6, 6) + '/' + f(bs.t10, 6)
      + '   ' + f(as.t4, 6) + '/' + f(as.t6, 6) + '/' + f(as.t10, 6)
      + '   ' + (fl ? f(fl.t4, 6) + '/' + f(fl.t6, 6) + '/' + f(fl.t10, 6) : f('(flat colour)', 20))
      + '   ' + f(cs ? cs.t4 : '-', 8) + (c ? ' (diff ' + control.frameDiff[v.name] + '%)' : '')
      + '   ' + verdict);
  }
  process.exit(0);
}

// ------------------------------------------------------------- capture
function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
function chromePath() {
  const c = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  return c.find((p) => existsSync(p)) ?? null;
}
function distStamp() {
  const d = join(ROOT, 'dist', 'assets');
  if (!existsSync(d)) return 'none';
  return readdirSync(d).map((f) => f + ':' + statSync(join(d, f)).mtimeMs).sort().join('|');
}

const REG = regions();
const stampStart = distStamp();
const { url: base } = await usePreview();
const cdpPort = await freePort();
const exe = chromePath();
if (!exe) throw new Error('no real Chrome found; playwright chromium has no WebGPU adapter');
const chrome = spawnGuarded(exe, [
  '--headless=new',
  '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-zfight-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--window-position=2560,0', '--window-size=1600,900',
  'about:blank',
], { stdio: 'ignore', windowsHide: true });

let browser = null;
for (let i = 0; i < 160 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!browser) { killTree(chrome.pid); throw new Error('real Chrome never accepted CDP'); }

try {
  const ctx = browser.contexts()[0] ?? await browser.newContext();
  const page = ctx.pages()[0] ?? await ctx.newPage();
  await page.setViewportSize({ width: W, height: H });

  // SEED Math.random before any page script runs (materials.ts draws 43 textures from it).
  await page.addInitScript(() => {
    let a = 0x9e3779b9;
    Math.random = () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));

  await page.goto(base + '?zfight=' + TAG, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
  const inject = {};
  for (const v of VIEWS) inject[v.name] = { pos: v.pos, yaw: v.yaw, pitch: v.pitch, fov: v.fov, ref: null, note: v.note };
  await page.evaluate((inj) => {
    for (const [k, v] of Object.entries(inj)) window.__NT.stations[k] = v;
    const el = document.getElementById('start'); if (el) el.remove();
    const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
    const ch = document.getElementById('crosshair'); if (ch) ch.style.display = 'none';
  }, inject);
  await page.waitForTimeout(1500);

  const results = {};
  const frames = {};
  for (const v of VIEWS) {
    const ok = await page.evaluate((n) => window.__NT.goto(n), v.name);
    if (!ok) throw new Error('goto failed: ' + v.name);
    await page.waitForTimeout(300);
    const file = join(OUT, '_zfight-px-' + TAG + '-' + v.name + '.png');
    await page.screenshot({ path: file });
    frames[v.name] = file;
    const r = REG[v.name];
    const img = readPng(file);
    const sp = r.box ? speckle(img, r.quads, r.box) : { pixels: 0 };
    const fl = r.floorBox ? speckle(img, r.floorQ, r.floorBox) : null;
    results[v.name] = { ...r, quads: undefined, floorQ: undefined, speckle: sp, floor: fl, file };
    if (r.box) {
      const pad = 24, s = 3;
      const bw = r.box.x1 - r.box.x0, bh = r.box.y1 - r.box.y0;
      const sc = Math.max(1, Math.min(4, Math.floor(420 / Math.max(bw + 2 * pad, bh + 2 * pad))));
      const edge = (x, y) => r.quads.some((q) => {
        // 1-px magenta outline of the measured region, drawn only in the crop
        const inside = inQuad(q, x + 0.5, y + 0.5);
        if (!inside) return false;
        return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !inQuad(q, x + dx + 0.5, y + dy + 0.5));
      });
      crop(img, join(OUT, '_zfight-crop-' + v.name + '-' + TAG + '.png'),
        r.box.x0 - pad, r.box.y0 - pad, r.box.x1 + pad, r.box.y1 + pad, sc || s, edge);
    }
    process.stdout.write('  ' + TAG.padEnd(8) + v.name.padEnd(24) + (r.box ? 'px ' + String(sp.pixels).padStart(6) + '  t4 ' + sp.t4 + '%  t6 ' + sp.t6 + '%  t10 ' + sp.t10 + '%  (' + r.pairs + ' pairs, ' + r.areaM2 + ' m2, ' + (r.distM || []).join('-') + ' m)' : 'NO REGION IN FRAME')
      + (fl ? '  floor t4/t6/t10 ' + fl.t4 + '/' + fl.t6 + '/' + fl.t10 + '% (' + fl.pixels + ' px)' : '') + '\n');
  }

  // same-build control: compare whole frames against the after run, pixel for pixel
  const frameDiff = {};
  if (TAG === 'control') {
    for (const v of VIEWS) {
      const af = join(OUT, '_zfight-px-after-' + v.name + '.png');
      if (!existsSync(af)) continue;
      const a = readPng(af), b = readPng(frames[v.name]);
      let diff = 0, tot = 0;
      for (let y = 0; y < a.height; y++) for (let x = 0; x < a.width; x++) {
        const i = (y * a.width + x) * a.bpp, j = (y * b.width + x) * b.bpp;
        tot++;
        if (a.data[i] !== b.data[j] || a.data[i + 1] !== b.data[j + 1] || a.data[i + 2] !== b.data[j + 2]) diff++;
      }
      frameDiff[v.name] = +(100 * diff / tot).toFixed(3);
    }
  }
  const stampEnd = distStamp();
  const out = { tag: TAG, when: new Date().toISOString(), pairsReport: PAIRS, distChangedDuringRun: stampStart !== stampEnd, pageErrors, results, frameDiff };
  writeFileSync(join(OUT, '_zfight-pixels-' + TAG + '.json'), JSON.stringify(out, null, 1));
  console.log('[zfight-pixels] ' + TAG + ': wrote captures/_zfight-pixels-' + TAG + '.json'
    + (stampStart !== stampEnd ? '   ** dist/assets CHANGED during the run - rerun **' : '')
    + (pageErrors.length ? '   page errors: ' + pageErrors.length : ''));
} finally {
  await browser.close().catch(() => {});
  killTree(chrome.pid);
}
