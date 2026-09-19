/**
 * ao-thickness ROUND 1 critic — two things the display-value tables cannot answer.
 *
 * 1. RAW-TERM COMPARISON. `?post=ao` shows (raw - AO_DEEP)/(1 - AO_DEEP) through the
 *    output pass, so when AO_DEEP moves the debug view is RESCALED and "AO mean below
 *    200" is not comparable round to round. Grey survives both ACES matrices, so for a
 *    grey debug image the pipe is scalar: RRTAndODTFit(x * 1.09 / 0.6) then sRGB encode,
 *    which lands linear 1.0 on display 228.95. Inverting that curve recovers the
 *    normalised view value, and raw = AO_DEEP + (1 - AO_DEEP) * view.
 *    Round 0 was AO_DEEP 0.672, round 1 is AO_DEEP 0.194.
 *
 * 2. HALO TEST. Sky pixels next to a near silhouette are where a wide `thickness`
 *    classically invents occlusion. Sky is masked from the CHAIN frame and the AO term
 *    is read over that mask, r0 against r1, banded by distance to the silhouette.
 *
 * Read-only over PNGs already on disk. Touches nothing under scripts/lib/**.
 */
import { readPng, luma, rgb } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const R0DIR = join(ROOT, 'captures/gauntlet/ao-thickness/round-0');

const R0 = (n) => join(R0DIR, 'g-ao-thickness-r0-' + n + '.png');
const R1 = (n) => join(CAP, 'g-ao-thickness-r1-' + n + '.png');

// ---- display <-> linear, grey only -------------------------------------------------
const srgbDecode = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const rrt = (v) => {
  const a = v * (v + 0.0245786) - 0.000090537;
  const b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
};
const acesGrey = (x) => Math.min(1, Math.max(0, rrt(x * 1.09 / 0.6)));
// invert ACES by bisection over the grey scalar curve
function displayToLinear(d255) {
  const target = srgbDecode(Math.min(1, Math.max(0, d255 / 255)));
  let lo = 0, hi = 8;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (acesGrey(mid) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
// display 0..255 lookup, built once
const LUT = new Float64Array(256);
for (let i = 0; i < 256; i++) LUT[i] = displayToLinear(i);

function rawAt(img, x, y, aoDeep) {
  const v = Math.min(1, LUT[Math.round(Math.min(255, Math.max(0, luma(img, x, y))))]);
  return aoDeep + (1 - aoDeep) * v;
}
function rawStats(img, rect, aoDeep) {
  const [x0, y0, x1, y1] = rect;
  const vals = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) vals.push(rawAt(img, x, y, aoDeep));
  vals.sort((a, b) => a - b);
  const q = (f) => vals[Math.round(f * (vals.length - 1))];
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  const belowT = (t) => +(100 * vals.filter((v) => v < t).length / vals.length).toFixed(2);
  return {
    mean: +mean.toFixed(3), p5: +q(0.05).toFixed(3), p20: +q(0.20).toFixed(3),
    p50: +q(0.50).toFixed(3), p95: +q(0.95).toFixed(3),
    pctBelow095: belowT(0.95), pctBelow080: belowT(0.80),
  };
}

const RECTS = {
  interiorOrange: {
    'wall FIELD right of doorway': [620, 260, 900, 700],
    'wall FIELD below sill': [620, 700, 900, 880],
    'ceiling beam band': [200, 10, 900, 60],
    'whole frame': null,
  },
  whitePoolRoom: {
    'wall field upper': [620, 60, 1200, 380],
    'wall field mid': [620, 380, 1200, 620],
    'wall field lower': [620, 620, 1200, 760],
    'wall full': [620, 60, 1200, 760],
    'whole frame': null,
  },
  turningHead: {
    'sky centre': [640, 40, 960, 180],
    'mountains': [180, 270, 700, 330],
    'asphalt foreground': [400, 700, 1100, 870],
    'under white coach': [380, 545, 720, 585],
    'whole frame': null,
  },
  spawnA: {
    'lawn field': [300, 620, 700, 740],
    'crate base contact': [745, 640, 935, 675],
    'pale wall left of door': [20, 380, 180, 540],
    'whole frame': null,
  },
};

const out = { note: 'raw GTAO term recovered from the ?post=ao PNGs', rounds: {} };
console.log('RAW GTAO TERM (display curve inverted; r0 AO_DEEP 0.672, r1 AO_DEEP 0.194)');
console.log('a value of 1.000 = NO occlusion at all.\n');

for (const st of Object.keys(RECTS)) {
  let a, b;
  try { a = readPng(R0('ao-' + st)); b = readPng(R1('ao-' + st)); } catch (e) { console.log('skip ' + st + ': ' + e.message); continue; }
  console.log('== ' + st);
  console.log('   ' + 'region'.padEnd(30) + '   r0 mean   r1 mean |   r0 p50   r1 p50 |  r0 p5    r1 p5 | r0 %<0.95  r1 %<0.95');
  out.rounds[st] = {};
  for (const [name, rect] of Object.entries(RECTS[st])) {
    const rc = rect ?? [0, 0, a.width, a.height];
    const sa = rawStats(a, rc, 0.672);
    const sb = rawStats(b, rc, 0.194);
    out.rounds[st][name] = { r0: sa, r1: sb };
    console.log('   ' + name.padEnd(30)
      + String(sa.mean).padStart(9) + String(sb.mean).padStart(10) + ' |'
      + String(sa.p50).padStart(9) + String(sb.p50).padStart(9) + ' |'
      + String(sa.p5).padStart(8) + String(sb.p5).padStart(9) + ' |'
      + String(sa.pctBelow095).padStart(10) + String(sb.pctBelow095).padStart(11));
  }
  console.log('');
}

// ---- halo test at turningHead ------------------------------------------------------
const chain0 = readPng(R0('turningHead'));
const chain1 = readPng(R1('turningHead'));
const ao0 = readPng(R0('ao-turningHead'));
const ao1 = readPng(R1('ao-turningHead'));

// sky mask: upper 45% of frame, blue-dominant, bright, in BOTH rounds (so a moving bot
// cannot enter the mask)
const W = chain1.width, H = chain1.height;
const isSky = (img, x, y) => {
  const [r, g, bl] = rgb(img, x, y);
  return bl > r + 6 && bl > 110 && (0.2126 * r + 0.7152 * g + 0.0722 * bl) > 120;
};
const sky = new Uint8Array(W * H);
const top = Math.floor(H * 0.45);
for (let y = 0; y < top; y++) for (let x = 0; x < W; x++) {
  if (isSky(chain0, x, y) && isSky(chain1, x, y)) sky[y * W + x] = 1;
}
// distance (in px, chebyshev, capped) to the nearest NON-sky pixel inside the top band
const DCAP = 12;
const dist = new Int16Array(W * H).fill(-1);
for (let y = 0; y < top; y++) for (let x = 0; x < W; x++) {
  if (!sky[y * W + x]) continue;
  let d = DCAP + 1;
  for (let r = 1; r <= DCAP && d > DCAP; r++) {
    let hit = false;
    for (let dx = -r; dx <= r && !hit; dx++) {
      for (const dy of [-r, r]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= top) { hit = true; break; }
        if (!sky[ny * W + nx]) { hit = true; break; }
      }
    }
    for (let dy = -r + 1; dy <= r - 1 && !hit; dy++) {
      for (const dx of [-r, r]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= top) { hit = true; break; }
        if (!sky[ny * W + nx]) { hit = true; break; }
      }
    }
    if (hit) d = r;
  }
  dist[y * W + x] = d;
}

const bands = [[1, 2], [3, 4], [5, 6], [7, 12], [13, 99]];
console.log('HALO TEST, turningHead — sky pixels only, banded by px distance to the nearest silhouette');
console.log('   band     n      ao r0 mean  ao r1 mean   Δ     ao r1 min   chain r0 mean  chain r1 mean   Δ');
const halo = [];
for (const [lo, hi] of bands) {
  let n = 0, a0 = 0, a1 = 0, c0 = 0, c1 = 0, min1 = 999;
  for (let y = 0; y < top; y++) for (let x = 0; x < W; x++) {
    const d = dist[y * W + x];
    if (d < lo || d > hi) continue;
    n++;
    const v1 = luma(ao1, x, y);
    a0 += luma(ao0, x, y); a1 += v1; if (v1 < min1) min1 = v1;
    c0 += luma(chain0, x, y); c1 += luma(chain1, x, y);
  }
  if (!n) continue;
  const row = {
    band: lo + '-' + hi, n,
    aoR0: +(a0 / n).toFixed(2), aoR1: +(a1 / n).toFixed(2), aoMinR1: +min1.toFixed(1),
    chainR0: +(c0 / n).toFixed(2), chainR1: +(c1 / n).toFixed(2),
  };
  halo.push(row);
  console.log('   ' + row.band.padEnd(7) + String(n).padStart(7)
    + String(row.aoR0).padStart(13) + String(row.aoR1).padStart(12)
    + String((row.aoR1 - row.aoR0).toFixed(2)).padStart(8)
    + String(row.aoMinR1).padStart(12)
    + String(row.chainR0).padStart(15) + String(row.chainR1).padStart(15)
    + String((row.chainR1 - row.chainR0).toFixed(2)).padStart(8));
}
out.halo = halo;
let skyN = 0; for (let i = 0; i < sky.length; i++) skyN += sky[i];
console.log('   sky mask: ' + skyN + ' px shared by both rounds\n');

writeFileSync(join(ROOT, 'captures', 'g-ao-thickness-r1-raw-and-halo.json'), JSON.stringify(out, null, 2));
console.log('wrote captures/g-ao-thickness-r1-raw-and-halo.json');
