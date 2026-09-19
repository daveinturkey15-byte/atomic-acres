/**
 * _verify-trailer-door - the PIXEL half of the trailer rear-doorway proof.
 *
 * THE DEFECT. `makeTrailer` put the dark interior mass's front face on EXACTLY the
 * plane of the dark opening panel's front face at the rear doorway. Unbatched, the
 * draw order happened to hide most of it; `core/static-batch.ts` changed the order
 * and the tie broke the other way, so the doorway dithered. A draw order is not a
 * depth test, so the fix is geometric separation and the proof has to show the
 * speckle going away at both stations that see the doorway.
 *
 * WHY ONE DIST WITH SWITCHES. core/materials.ts calls Math.random() 43 times to
 * paint its procedural textures, so two BUILDS of the same source differ on 15-21%
 * of pixels: a before/after measured across two dists measures the noise. All four
 * arms - pre-fix, candidate A, candidate B, each batched and unbatched - therefore
 * come out of ONE dist through the temporary `?olddoor=` / `?recess=` / `?nobatch=`
 * switches in vehicles.ts,
 * and Math.random is seeded from an init script so even the within-build texture
 * noise is frozen. A same-build control run proves that seeding worked before any
 * difference is read as signal.
 *
 * WHY THE RECTANGLE IS NOT TYPED IN BY HAND. `scripts/_verify-trailer-geom.mjs`
 * emits the opening panel's outer face as four WORLD points; this harness projects
 * them through each station's own camera parameters. The measured region is the
 * doorway itself, at whatever pixels it lands on, and it cannot drift in a
 * measurer's favour between arms.
 *
 * THE METRIC. A pixel is SPECKLED when its luma differs from the median of its
 * eight neighbours by at least T. Z-fighting is salt-and-pepper by construction -
 * two surfaces alternating per pixel - so an isolated-outlier test is what reads
 * it; a smooth panel, a gradient and an even procedural grain all score near zero.
 * Reported at T = 4, 6 and 10 so the conclusion cannot rest on one threshold.
 *
 *   node scripts/_verify-trailer-door.mjs            every arm, flagged build
 *   node scripts/_verify-trailer-door.mjs --final    shipped + control only
 *
 * Writes captures/_td-<arm>-<station>.png (full frames), captures/_td-crop-*.png
 * (3x nearest-neighbour crops of the doorway) and captures/_trailer-door.json.
 */
import { chromium } from 'playwright';
import * as THREE from 'three';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';
import { readPng, luma } from './_critic-png.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures');
mkdirSync(OUT, { recursive: true });

const W = 1600, H = 900;
const D = Math.PI / 180;
const THRESHOLDS = [4, 6, 10];

// The doorway quad is FROZEN from the flagged build, where the parts still exist
// unbatched. It is the same four points for the pre-fix and the shipped geometry -
// the mass now occupies exactly the plane and the size the panel had - so one
// rectangle measures every arm and cannot be re-derived in anyone favour.
const GEOMF = join(OUT, '_trailer-geom-flagged.json');
const geom = JSON.parse(readFileSync(existsSync(GEOMF) ? GEOMF : join(OUT, '_trailer-geom.json'), 'utf8'));
const QUAD = (geom['shipped+unbatched'] || geom['old+unbatched']).doorway.worldQuad;
if (!QUAD) throw new Error('run scripts/_verify-trailer-geom.mjs first');

/**
 * The stations. `plaza` is the repo's own (read back from the page so it cannot
 * drift from src/core/stations.ts). `tdSlalomW` is the slalom station: eye height
 * in the west road stem at (-28, 2.2, 0). It looks WEST (yaw +90 deg, forward
 * -x) and not east, because the trailer's rear doorway is at world x = -32.3 -
 * WEST of the station. `tdSlalomE` is the same point looking east, captured once
 * on the shipped arm purely to show what is in that frame instead.
 */
const INJECT = {
  tdSlalomW: { pos: [-28, 2.2, 0], yaw: 90 * D, pitch: -1 * D, fov: 72, ref: null, note: 'slalom gate, looking west' },
  tdSlalomE: { pos: [-28, 2.2, 0], yaw: -90 * D, pitch: -1 * D, fov: 72, ref: null, note: 'slalom gate, looking east' },
};
const STATIONS = ['tdSlalomW', 'plaza'];

/**
 * Every arm out of ONE dist, plus a repeat of the shipped arm as the control.
 *   old      the pre-fix geometry: matte interior mass coplanar with the glossy
 *            windowDark opening panel - the z-fight
 *   recess   candidate A: keep the panel, recess the mass 100 mm behind it
 *   shipped  candidate B, the one taken: drop the redundant panel, keep the matte
 *            mass at the plane the panel's front face occupied
 * `--final` runs only the shipped arm and the control, for the flag-free build
 * after the switches have been removed from vehicles.ts.
 */
const FINAL = process.argv.includes('--final');
const ARMS = FINAL ? [
  { name: 'shipped', query: '' },
  { name: 'control', query: '' },
] : [
  { name: 'shipped', query: '' },
  { name: 'shipped-unbatched', query: '?nobatch=1' },
  { name: 'recess', query: '?recess=1' },
  { name: 'recess-unbatched', query: '?recess=1&nobatch=1' },
  { name: 'old', query: '?olddoor=1' },
  { name: 'old-unbatched', query: '?olddoor=1&nobatch=1' },
  { name: 'control', query: '' },
];
const CROP_ARMS = FINAL ? ['shipped'] : ['old-unbatched', 'old', 'recess', 'shipped'];

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
function crop(img, path, x0, y0, x1, y1, s) {
  x0 = Math.max(0, x0); y0 = Math.max(0, y0);
  x1 = Math.min(img.width, x1); y1 = Math.min(img.height, y1);
  const w = (x1 - x0) * s, h = (y1 - y0) * s;
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x0 + Math.floor(x / s), sy = y0 + Math.floor(y / s);
      const i = (sy * img.width + sx) * img.bpp, o = (y * w + x) * 3;
      out[o] = img.data[i]; out[o + 1] = img.data[i + 1]; out[o + 2] = img.data[i + 2];
    }
  }
  writePng(path, w, h, out);
  return { w, h };
}

// ------------------------------------------------------------- the projection
function project(station) {
  const cam = new THREE.PerspectiveCamera(station.fov ?? 72, W / H, 0.1, 500);
  cam.position.set(station.pos[0], station.pos[1], station.pos[2]);
  cam.rotation.set(0, 0, 0, 'YXZ');
  cam.rotation.y = station.yaw;
  cam.rotation.x = station.pitch;
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  const pts = QUAD.map(([x, y, z]) => {
    const v = new THREE.Vector3(x, y, z);
    const inFront = v.clone().sub(cam.position).dot(
      new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion)) > 0;
    v.project(cam);
    return { x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, inFront };
  });
  return pts;
}
/** Shrink a convex quad toward its centroid; keeps the brightwork frame out. */
function inset(pts, f) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return pts.map((p) => ({ x: cx + (p.x - cx) * f, y: cy + (p.y - cy) * f }));
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
function bbox(q) {
  return {
    x0: Math.floor(Math.min(...q.map((p) => p.x))), y0: Math.floor(Math.min(...q.map((p) => p.y))),
    x1: Math.ceil(Math.max(...q.map((p) => p.x))), y1: Math.ceil(Math.max(...q.map((p) => p.y))),
  };
}

// ------------------------------------------------------------- the speckle metric
/** |luma - median(8 neighbours)| >= T. Salt-and-pepper is what z-fighting looks like. */
function speckle(img, q, box) {
  const n = [];
  const counts = THRESHOLDS.map(() => 0);
  let total = 0;
  let sum = 0;
  for (let y = Math.max(1, box.y0); y < Math.min(img.height - 1, box.y1); y++) {
    for (let x = Math.max(1, box.x0); x < Math.min(img.width - 1, box.x1); x++) {
      if (!inQuad(q, x + 0.5, y + 0.5)) continue;
      n.length = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          n.push(luma(img, x + dx, y + dy));
        }
      }
      n.sort((a, b) => a - b);
      const med = (n[3] + n[4]) / 2;
      const v = luma(img, x, y);
      const d = Math.abs(v - med);
      for (let i = 0; i < THRESHOLDS.length; i++) if (d >= THRESHOLDS[i]) counts[i]++;
      total++;
      sum += v;
    }
  }
  const out = { pixels: total, meanLuma: total ? +(sum / total).toFixed(2) : 0 };
  THRESHOLDS.forEach((t, i) => { out['t' + t] = total ? +(100 * counts[i] / total).toFixed(4) : 0; });
  return out;
}

// -------------------------------------------------------------------- the browser
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

const { url: base } = await usePreview();
const cdpPort = await freePort();
const exe = chromePath();
if (!exe) throw new Error('no real Chrome found; playwright chromium has no WebGPU adapter');
const chrome = spawnGuarded(exe, [
  '--headless=new',
  '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-td-' + cdpPort),
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

const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: W, height: H });

// SEED Math.random before any page script runs. core/materials.ts calls it 43
// times; without this two loads of the same build differ on 15-21% of pixels and
// every number below would be noise.
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

const frames = {};
let repoPlaza = null;
for (const arm of ARMS) {
  await page.goto(base + (arm.query || ''), { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
  repoPlaza = await page.evaluate(() => window.__NT.stations.plaza);
  await page.evaluate((inj) => {
    for (const [k, v] of Object.entries(inj)) window.__NT.stations[k] = v;
    const el = document.getElementById('start'); if (el) el.remove();
    const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
    const ch = document.getElementById('crosshair'); if (ch) ch.style.display = 'none';
  }, INJECT);
  await page.waitForTimeout(1400);
  const want = arm.name === 'shipped' ? [...STATIONS, 'tdSlalomE'] : STATIONS;
  for (const st of want) {
    const ok = await page.evaluate((n) => window.__NT.goto(n), st);
    if (!ok) throw new Error('goto failed: ' + st);
    await page.waitForTimeout(280);
    const file = join(OUT, '_td-' + arm.name + '-' + st + '.png');
    await page.screenshot({ path: file });
    frames[arm.name + '/' + st] = file;
    process.stdout.write('  shot ' + arm.name + ' ' + st + '\n');
  }
}
await browser.close();
killTree(chrome.pid);

// --------------------------------------------------------------------- measure
const stationParams = {
  tdSlalomW: INJECT.tdSlalomW,
  tdSlalomE: INJECT.tdSlalomE,
  plaza: repoPlaza,
};
const results = {};
const regions = {};
for (const st of STATIONS) {
  const raw = project(stationParams[st]);
  const q = inset(raw, 0.88);
  const box = bbox(q);
  regions[st] = {
    station: stationParams[st],
    quadPx: raw.map((p) => [Math.round(p.x), Math.round(p.y), p.inFront]),
    insetBox: box,
    inFront: raw.every((p) => p.inFront),
  };
  // bottom-right quadrant of the inset quad, in screen space
  const mx = (box.x0 + box.x1) / 2, my = (box.y0 + box.y1) / 2;
  const brBox = { x0: Math.floor(mx), y0: Math.floor(my), x1: box.x1, y1: box.y1 };
  regions[st].brBox = brBox;

  for (const arm of ARMS) {
    const f = frames[arm.name + '/' + st];
    const img = readPng(f);
    const whole = speckle(img, q, box);
    const br = speckle(img, q, brBox);
    results[arm.name + '/' + st] = { panel: whole, bottomRight: br, file: f };
  }
}

// same-build control: two loads of the identical arm, pixel for pixel
const control = {};
for (const st of STATIONS) {
  const a = readPng(frames['shipped/' + st]);
  const b = readPng(frames['control/' + st]);
  let diff = 0, tot = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * a.bpp, j = (y * b.width + x) * b.bpp;
      tot++;
      if (a.data[i] !== b.data[j] || a.data[i + 1] !== b.data[j + 1] || a.data[i + 2] !== b.data[j + 2]) diff++;
    }
  }
  control[st] = { differingPixelsPct: +(100 * diff / tot).toFixed(4), pixels: tot };
}

// crops of the doorway, padded, 3x nearest neighbour
const crops = [];
for (const st of STATIONS) {
  const b = regions[st].insetBox;
  const padX = Math.round((b.x1 - b.x0) * 0.35), padY = Math.round((b.y1 - b.y0) * 0.2);
  for (const arm of CROP_ARMS) {
    const img = readPng(frames[arm + '/' + st]);
    const path = join(OUT, '_td-crop-' + st + '-' + arm + '.png');
    const s = (b.x1 - b.x0) < 120 ? 4 : 2;
    crop(img, path, b.x0 - padX, b.y0 - padY, b.x1 + padX, b.y1 + padY, s);
    crops.push(path);
  }
}

const summary = {
  when: new Date().toISOString(), url: base, viewport: W + 'x' + H,
  thresholds: THRESHOLDS, worldQuad: QUAD, regions, control, results, crops, pageErrors,
};
writeFileSync(join(OUT, '_trailer-door.json'), JSON.stringify(summary, null, 2));

console.log('\n[trailer-door] doorway rectangle, projected (not typed in):');
for (const st of STATIONS) {
  const r = regions[st];
  console.log('  ' + st.padEnd(11) + ' inset bbox x ' + r.insetBox.x0 + '..' + r.insetBox.x1
    + '  y ' + r.insetBox.y0 + '..' + r.insetBox.y1
    + '   (' + (r.insetBox.x1 - r.insetBox.x0) + 'x' + (r.insetBox.y1 - r.insetBox.y0) + ' px)'
    + (r.inFront ? '' : '   BEHIND THE CAMERA'));
}
console.log('\n[trailer-door] same-build control (two loads of the shipped arm, seeded):');
for (const st of STATIONS) console.log('  ' + st.padEnd(11) + ' ' + control[st].differingPixelsPct + '% of pixels differ');

for (const scope of ['panel', 'bottomRight']) {
  console.log('\n[trailer-door] SPECKLED PIXELS, ' + (scope === 'panel' ? 'whole doorway panel' : 'bottom-right quadrant')
    + ' (% of the region)');
  console.log('  arm                station      px      T>=4     T>=6    T>=10   meanLuma');
  for (const st of STATIONS) {
    for (const arm of ARMS) {
      const r = results[arm.name + '/' + st][scope];
      console.log('  ' + arm.name.padEnd(18) + st.padEnd(12)
        + String(r.pixels).padStart(6)
        + String(r.t4).padStart(10) + String(r.t6).padStart(9) + String(r.t10).padStart(9)
        + String(r.meanLuma).padStart(11));
    }
  }
}
if (pageErrors.length) console.log('\n[trailer-door] page errors: ' + JSON.stringify(pageErrors.slice(0, 5)));
console.log('\n[trailer-door] wrote ' + Object.keys(frames).length + ' frames and ' + crops.length + ' crops to captures/');
