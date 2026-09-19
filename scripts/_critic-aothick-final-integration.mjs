/**
 * ao-thickness INTEGRATION critic — measurement pass over PNGs already on disk.
 * Read-only: opens no browser, renders nothing, writes one JSON.
 *
 * Three states, all captured by me at TODAY's geometry through the same harness:
 *   A  = round-0 AO state  (thickness 0.6, AO_DEEP 0.672)  tag g-ao-thickness-probeA
 *   S  = shipped / round-1 (thickness 3.0, AO_DEEP 0.194)  tag g-ao-thickness-final
 *   B  = candidate curve   (S + AO_CURVE 1.4)              tag g-ao-thickness-probeB
 *
 * A and B were reverted probes; src/core/post.ts was restored byte-identically.
 */
import { readPng, rectStats, luma, rgb } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const S = 'g-ao-thickness-final';
const A = 'g-ao-thickness-probeA';
const B = 'g-ao-thickness-probeB';
const STATIONS = ['aerial', 'yardOrange', 'yardWhite', 'streetElevation', 'plaza',
  'turningHead', 'spawnA', 'spawnB', 'midStreet', 'interiorOrange'];

const capPng = (tag, st) => join(CAP, tag + '-cap-' + st + '.png');
const aoPng = (tag, st) => join(CAP, tag + '-ao-' + st + '.png');

const out = {};

/* ---------------------------------------------------------------- 1. whole-frame,
   all ten stations, three states, chain frames from `npm run capture`. */
const frames = {};
for (const st of STATIONS) {
  const row = {};
  for (const [k, tag] of [['A', A], ['S', S], ['B', B]]) {
    const p = capPng(tag, st);
    if (!existsSync(p)) continue;
    const img = readPng(p);
    const s = rectStats(img, [0, 0, img.width, img.height]);
    row[k] = { mean: +s.mean.toFixed(2), p5: s.p5, p50: s.p50, p95: s.p95 };
  }
  if (row.A && row.S) {
    row.dSA = +(100 * (row.S.mean - row.A.mean) / row.A.mean).toFixed(2);
    row.dBA = row.B ? +(100 * (row.B.mean - row.A.mean) / row.A.mean).toFixed(2) : null;
    row.dBS = row.B ? +(100 * (row.B.mean - row.S.mean) / row.S.mean).toFixed(2) : null;
  }
  frames[st] = row;
}
out.wholeFrameChain = frames;

/* ---------------------------------------------------------------- 2. how much of each
   station the occlusion term actually TOUCHES. Share of the ?post=ao frame below the
   229 plateau by band. Comparable across A and S (both display the linear normalised
   term); for B the view is n^1.4 so it is reported but flagged. */
const aoBands = {};
for (const st of STATIONS.concat(['whitePoolRoom'])) {
  const row = {};
  for (const [k, tag] of [['A', A], ['S', S], ['B', B]]) {
    const p = aoPng(tag, st);
    if (!existsSync(p)) continue;
    const img = readPng(p);
    let n = 0, b225 = 0, b200 = 0, b150 = 0, b8 = 0, sum = 0;
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) {
        const v = luma(img, x, y); n++; sum += v;
        if (v < 225) b225++;
        if (v < 200) b200++;
        if (v < 150) b150++;
        if (v < 8) b8++;
      }
    }
    row[k] = {
      mean: +(sum / n).toFixed(2),
      pctBelow225: +(100 * b225 / n).toFixed(2),
      pctBelow200: +(100 * b200 / n).toFixed(2),
      pctBelow150: +(100 * b150 / n).toFixed(2),
      pctBelow8: +(100 * b8 / n).toFixed(2),
    };
  }
  aoBands[st] = row;
}
out.aoTouchBands = aoBands;

/* ---------------------------------------------------------------- 3. run-to-run noise
   floor: two captures of the SAME shipped state in two different browser sessions
   (`-cap-` from capture.mjs, bare from the critic script) at the three shared stations. */
const noise = {};
for (const st of ['interiorOrange', 'turningHead', 'spawnA']) {
  const a = readPng(capPng(S, st));
  const b = readPng(join(CAP, S + '-' + st + '.png'));
  let diff = 0, moved = 0, n = 0;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const d = Math.abs(luma(a, x, y) - luma(b, x, y));
      diff += d; n++; if (d > 2) moved++;
    }
  }
  noise[st] = {
    meanAbsLuma: +(diff / n).toFixed(3),
    pctMovingOver2: +(100 * moved / n).toFixed(2),
    frameMeanA: +rectStats(a, [0, 0, a.width, a.height]).mean.toFixed(2),
    frameMeanB: +rectStats(b, [0, 0, b.width, b.height]).mean.toFixed(2),
  };
}
out.sameStateRunNoise = noise;

/* ---------------------------------------------------------------- 4. halo test at
   turningHead: sky pixels shared by A and S, banded by distance to the nearest
   silhouette. A halo from a wide `thickness` would DARKEN the near bands. */
function skyMask(img) {
  // sky = blue-dominant, bright, low saturation spread; take the union test used by
  // earlier records: b > r, luma > 120, and no strong green (foliage).
  const m = new Uint8Array(img.width * img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const [r, g, b] = rgb(img, x, y);
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      m[y * img.width + x] = (b > r + 4 && l > 120 && g < b + 6) ? 1 : 0;
    }
  }
  return m;
}
{
  const ia = readPng(capPng(A, 'turningHead'));
  const is = readPng(capPng(S, 'turningHead'));
  const ib = existsSync(capPng(B, 'turningHead')) ? readPng(capPng(B, 'turningHead')) : null;
  const ma = skyMask(ia), ms = skyMask(is);
  const W = ia.width, H = ia.height;
  const shared = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) shared[i] = (ma[i] && ms[i]) ? 1 : 0;
  // distance (chebyshev, capped) from each shared-sky pixel to the nearest non-sky pixel
  const dist = new Int16Array(W * H).fill(999);
  const isSky = (x, y) => (x >= 0 && y >= 0 && x < W && y < H) ? shared[y * W + x] : 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!shared[y * W + x]) continue;
      let d = 999;
      for (let r = 1; r <= 13 && d === 999; r++) {
        let hit = false;
        for (let k = -r; k <= r && !hit; k++) {
          if (!isSky(x + k, y - r) || !isSky(x + k, y + r) || !isSky(x - r, y + k) || !isSky(x + r, y + k)) hit = true;
        }
        if (hit) d = r;
      }
      dist[y * W + x] = d;
    }
  }
  const bands = [[1, 2], [3, 4], [5, 6], [7, 12], [13, 999]];
  const rows = [];
  for (const [lo, hi] of bands) {
    let n = 0, sa = 0, ss = 0, sb = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!shared[i]) continue;
        const d = dist[i]; if (d < lo || d > hi) continue;
        n++; sa += luma(ia, x, y); ss += luma(is, x, y); if (ib) sb += luma(ib, x, y);
      }
    }
    if (!n) continue;
    rows.push({
      band: lo + '-' + (hi === 999 ? '+' : hi) + ' px', n,
      A: +(sa / n).toFixed(2), S: +(ss / n).toFixed(2),
      dSA: +((ss - sa) / n).toFixed(2),
      B: ib ? +(sb / n).toFixed(2) : null,
      dBA: ib ? +((sb - sa) / n).toFixed(2) : null,
    });
  }
  out.haloTurningHead = rows;
}

/* ---------------------------------------------------------------- 5. the vertical
   streak in the AO term, interiorOrange right-hand reveal wall. Column means over a
   band, then the mean absolute SECOND difference along x: a smooth ramp scores ~0,
   a comb scores high. Compared against the same statistic taken along y, which is
   where the real gradient lives. */
function streak(img, [x0, y0, x1, y1]) {
  const cols = [];
  for (let x = x0; x < x1; x++) {
    let s = 0; for (let y = y0; y < y1; y++) s += luma(img, x, y);
    cols.push(s / (y1 - y0));
  }
  const rows = [];
  for (let y = y0; y < y1; y++) {
    let s = 0; for (let x = x0; x < x1; x++) s += luma(img, x, y);
    rows.push(s / (x1 - x0));
  }
  const d2 = (a) => {
    let s = 0; for (let i = 1; i < a.length - 1; i++) s += Math.abs(a[i - 1] - 2 * a[i] + a[i + 1]);
    return +(s / (a.length - 2)).toFixed(3);
  };
  const span = (a) => +(Math.max(...a) - Math.min(...a)).toFixed(2);
  return { colD2: d2(cols), rowD2: d2(rows), colSpan: span(cols), rowSpan: span(rows) };
}
{
  const RECT = [1180, 250, 1520, 650];   // the right-hand recess / reveal wall
  const r = {};
  for (const [k, tag] of [['A', A], ['S', S], ['B', B]]) {
    const p = aoPng(tag, 'interiorOrange');
    if (existsSync(p)) r[k] = streak(readPng(p), RECT);
  }
  out.streakInteriorOrangeRightReveal = { rect: RECT, ...r };
}

/* ---------------------------------------------------------------- 6. static contact
   rects chosen to contain NO bot or mannequin, so they are not polluted by a walker.
   Verified by the same-state run-noise figure printed for each. */
const CONTACT = {
  spawnA: {
    'stepping stone row (lawn contact)': [300, 800, 1100, 880],
    'deck post base, left': [120, 630, 210, 700],
    'crate base contact (brief rect)': [745, 640, 935, 675],
  },
  turningHead: {
    'under the dark coach': [880, 555, 1120, 600],
    'kerb line, right': [1180, 690, 1420, 730],
    'lamp standard base, left': [130, 560, 200, 610],
  },
  midStreet: { 'road/kerb junction': [80, 640, 1520, 700] },
  plaza: { 'lower third': [0, 600, 1600, 900] },
  streetElevation: { 'lower third': [0, 600, 1600, 900] },
  spawnB: { 'lower third': [0, 600, 1600, 900] },
  yardOrange: { 'lower third': [0, 600, 1600, 900] },
  yardWhite: { 'lower third': [0, 600, 1600, 900] },
  aerial: { 'lower third': [0, 600, 1600, 900] },
};
const contact = {};
for (const [st, rects] of Object.entries(CONTACT)) {
  contact[st] = {};
  for (const [name, rect] of Object.entries(rects)) {
    const row = {};
    for (const [k, tag] of [['A', A], ['S', S], ['B', B]]) {
      const p = capPng(tag, st);
      if (!existsSync(p)) continue;
      row[k] = +rectStats(readPng(p), rect).mean.toFixed(2);
    }
    if (row.A) {
      row.dSA = +(100 * (row.S - row.A) / row.A).toFixed(2);
      row.dBA = row.B ? +(100 * (row.B - row.A) / row.A).toFixed(2) : null;
    }
    contact[st][name] = row;
  }
}
out.contactRects = contact;

writeFileSync(join(CAP, S + '-integration.json'), JSON.stringify(out, null, 2));

/* ------------------------------------------------------------------------ print */
const f = (v, w = 8) => String(v).padStart(w);
console.log('\n== whole frame, chain, ten stations   A=r0 state  S=shipped  B=+AO_CURVE 1.4');
console.log('   station          A mean   S mean   B mean    S-A%    B-A%    B-S%');
for (const st of STATIONS) {
  const r = frames[st];
  console.log('   ' + st.padEnd(16) + f(r.A?.mean) + f(r.S?.mean) + f(r.B?.mean)
    + f(r.dSA, 8) + f(r.dBA, 8) + f(r.dBS, 8));
}
console.log('\n== share of the ?post=ao frame the term actually touches (% below 225)');
console.log('   station           A      S      B   |  %<200 A/S/B  |  %<150 A/S/B');
for (const st of Object.keys(aoBands)) {
  const r = aoBands[st]; if (!r.A) continue;
  console.log('   ' + st.padEnd(16) + f(r.A.pctBelow225, 6) + f(r.S?.pctBelow225, 7) + f(r.B?.pctBelow225, 7)
    + '   | ' + f(r.A.pctBelow200, 6) + f(r.S?.pctBelow200, 6) + f(r.B?.pctBelow200, 6)
    + '   | ' + f(r.A.pctBelow150, 6) + f(r.S?.pctBelow150, 6) + f(r.B?.pctBelow150, 6));
}
console.log('\n== same-state run-to-run noise (two sessions, identical build)');
for (const [st, r] of Object.entries(noise)) {
  console.log('   ' + st.padEnd(16) + ' meanAbs ' + f(r.meanAbsLuma, 7) + '  %>2 ' + f(r.pctMovingOver2, 6)
    + '   frame mean ' + f(r.frameMeanA) + ' vs ' + f(r.frameMeanB));
}
console.log('\n== halo, turningHead sky by distance to silhouette');
for (const r of out.haloTurningHead) {
  console.log('   ' + r.band.padEnd(10) + ' n ' + f(r.n, 7) + '   A ' + f(r.A) + '  S ' + f(r.S)
    + '  S-A ' + f(r.dSA, 7) + '   B ' + f(r.B) + '  B-A ' + f(r.dBA, 7));
}
console.log('\n== vertical streak, interiorOrange right reveal (?post=ao)');
for (const k of ['A', 'S', 'B']) {
  const r = out.streakInteriorOrangeRightReveal[k]; if (!r) continue;
  console.log('   ' + k + '  colD2 ' + f(r.colD2) + '  rowD2 ' + f(r.rowD2)
    + '  colSpan ' + f(r.colSpan) + '  rowSpan ' + f(r.rowSpan));
}
console.log('\n== contact rects (chain luma; lower = deeper contact)');
for (const [st, rects] of Object.entries(contact)) {
  for (const [name, r] of Object.entries(rects)) {
    console.log('   ' + (st + ' / ' + name).padEnd(46) + f(r.A) + f(r.S) + f(r.B)
      + '   S-A% ' + f(r.dSA, 7) + '   B-A% ' + f(r.dBA, 7));
  }
}
console.log('\nwrote ' + join(CAP, S + '-integration.json'));
