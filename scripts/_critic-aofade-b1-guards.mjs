/**
 * ao-farfade ROUND 1 — the round-4 guard table, READ-ONLY over PNGs already on disk.
 *
 * Every rectangle is inherited verbatim:
 *   - the chain/ao rects and the `hband` sampler from `scripts/_critic-aotwo-measure.mjs`
 *   - the slab/ridge rects and the `fieldPct` 3-px erosion from
 *     `scripts/_critic-aotwo-final-farslab.mjs`
 * Nothing here is new geometry; only the tag is a parameter, so a probe and its
 * baseline are measured by identical code on identical pixels.
 *
 *   BASE_TAG=<tag> PROBE_TAG=<tag> node scripts/_critic-aofade-b1-guards.mjs
 */
import { readPng, rectStats, luma } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const BASE = process.env.BASE_TAG || 'g-ao-farfade-b0';
const PROBE = process.env.PROBE_TAG || 'g-ao-farfade-b1';
const P = (tag, n) => join(CAP, tag + '-' + n + '.png');

// --- inherited from _critic-aotwo-final-farslab.mjs -------------------------
const fieldPct = (img, rect, t = 180) => {
  const [x0, y0, x1, y1] = rect;
  const w = x1 - x0, h = y1 - y0;
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) dark[y * w + x] = luma(img, x0 + x, y0 + y) < t ? 1 : 0;
  let n = 0, k = 0;
  const R = 3;
  for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) {
    k++;
    let all = 1;
    for (let dy = -R; dy <= R && all; dy++) for (let dx = -R; dx <= R; dx++) if (!dark[(y + dy) * w + x + dx]) { all = 0; break; }
    n += all;
  }
  return +(100 * n / k).toFixed(2);
};
const hcut = (img, y, x0, x1, step) => {
  const r = [];
  for (let x = x0; x <= x1; x += step) {
    let s = 0, n = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { s += luma(img, x + dx, y + dy); n++; }
    r.push(Math.round(s / n));
  }
  return r;
};
// --- inherited from _critic-aotwo-measure.mjs -------------------------------
const hband = (img, y0, y1, x0, x1, step = 80) => {
  const r = [];
  for (let x = x0; x <= x1; x += step) {
    let s = 0, n = 0;
    for (let yy = y0; yy < y1; yy++) for (let dx = -8; dx <= 8; dx++) { s += luma(img, x + dx, yy); n++; }
    r.push(+(s / n).toFixed(1));
  }
  return r;
};
const junction = (img, x = 760) => {
  const r = [];
  for (let y = 60; y <= 180; y += 12) {
    let s = 0; for (let dx = -12; dx <= 12; dx++) s += luma(img, x + dx, y);
    r.push(+(s / 25).toFixed(1));
  }
  return r;
};
const maxAbsDiff = (a, b, rect) => {
  const [x0, y0, x1, y1] = rect; let m = 0, sum = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * a.width + x) * a.bpp, j = (y * b.width + x) * b.bpp;
    for (let c = 0; c < 3; c++) { const d = Math.abs(a.data[i + c] - b.data[j + c]); if (d > m) m = d; sum += d; n++; }
  }
  return { maxChannelDiff: m, meanChannelDiff: +(sum / n).toFixed(4) };
};

const R = {
  interiorOrangeWall: [620, 260, 900, 700],
  interiorOrangeJunction: [200, 88, 520, 104],
  whitePoolRoomWall: [620, 60, 1200, 760],
  spawnACrate: [745, 640, 935, 675],
  spawnASky: [1150, 30, 1250, 120],
  spawnALawn: [300, 620, 700, 740],
  midStreetFlankRight: [1280, 470, 1480, 530],
  midStreetFlankLeft: [320, 470, 520, 530],
  aerialSlabTL: [20, 10, 330, 150],
  aerialSlabTR: [1440, 10, 1590, 120],
  aerialDesertFloor: [60, 200, 400, 330],
  yardWhiteRidgeRight: [1405, 85, 1535, 145],
  yardWhiteRidgeLeft: [70, 80, 350, 145],
};

function readSet(tag) {
  const g = {};
  for (const n of ['interiorOrange', 'midStreet', 'spawnA', 'aerial', 'yardWhite', 'whitePoolRoom']) {
    g[n] = existsSync(P(tag, n)) ? readPng(P(tag, n)) : null;
    g['ao-' + n] = existsSync(P(tag, 'ao-' + n)) ? readPng(P(tag, 'ao-' + n)) : null;
  }
  return g;
}

function measure(tag) {
  const g = readSet(tag);
  const io = g.interiorOrange, ioa = g['ao-interiorOrange'];
  const ms = g.midStreet, msa = g['ao-midStreet'];
  const sa = g.spawnA, saa = g['ao-spawnA'];
  const ae = g.aerial, aea = g['ao-aerial'];
  const yw = g.yardWhite, ywa = g['ao-yardWhite'];
  const wp = g.whitePoolRoom;
  const band = hband(msa, 470, 530, 320, 1480);
  const ioWall = rectStats(io, R.interiorOrangeWall);
  const wpWall = rectStats(wp, R.whitePoolRoomWall);
  const jn = junction(ioa);
  return {
    tag,
    // MUST IMPROVE
    'midStreet flank band far end (ao, x1480)': band[band.length - 1],
    'midStreet flank band (ao, x320..1480 step80)': band,
    'midStreet coach flank right (ao)': rectStats(msa, R.midStreetFlankRight).mean,
    'midStreet coach flank left (ao)': rectStats(msa, R.midStreetFlankLeft).mean,
    'aerial slab TL solid-field %': fieldPct(aea, R.aerialSlabTL),
    'aerial slab TR solid-field %': fieldPct(aea, R.aerialSlabTR),
    'yardWhite ridge right solid-field %': fieldPct(ywa, R.yardWhiteRidgeRight),
    'yardWhite ridge left solid-field %': fieldPct(ywa, R.yardWhiteRidgeLeft),
    // MUST HOLD
    'interiorOrange wall gradient p95-p5 (chain)': +(ioWall.p95 - ioWall.p5).toFixed(1),
    'interiorOrange wall mean (chain)': ioWall.mean,
    'whitePoolRoom wall gradient p95-p5 (chain)': +(wpWall.p95 - wpWall.p5).toFixed(1),
    'spawnA crate base (chain)': rectStats(sa, R.spawnACrate).mean,
    'interiorOrange junction rect min (ao)': rectStats(ioa, R.interiorOrangeJunction).min,
    'interiorOrange junction rect mean (ao)': rectStats(ioa, R.interiorOrangeJunction).mean,
    'interiorOrange junction cut (ao, x760 y60..180)': jn,
    'interiorOrange junction cut min': Math.min(...jn),
    'spawnA sky patch (chain)': rectStats(sa, R.spawnASky).mean,
    'spawnA sky patch (ao)': rectStats(saa, R.spawnASky).mean,
    'spawnA lawn (ao)': rectStats(saa, R.spawnALawn).mean,
    // context
    'aerial slab TL (ao) mean': rectStats(aea, R.aerialSlabTL).mean,
    'aerial slab TR (ao) mean': rectStats(aea, R.aerialSlabTR).mean,
    'aerial slab TL (chain) mean': rectStats(ae, R.aerialSlabTL).mean,
    'aerial slab TR (chain) mean': rectStats(ae, R.aerialSlabTR).mean,
    'aerial desert floor (ao) mean': rectStats(aea, R.aerialDesertFloor).mean,
    'aerial desert floor solid-field %': fieldPct(aea, R.aerialDesertFloor),
    'yardWhite ridge right (ao) mean': rectStats(ywa, R.yardWhiteRidgeRight).mean,
    'yardWhite ridge right (chain) mean': rectStats(yw, R.yardWhiteRidgeRight).mean,
    'yardWhite ridge left (ao) mean': rectStats(ywa, R.yardWhiteRidgeLeft).mean,
    'aerial cut TL y=20 x20..320 step20 (ao)': hcut(aea, 20, 20, 320, 20),
    'aerial cut TR y=15 x1440..1590 step15 (ao)': hcut(aea, 15, 1440, 1590, 15),
    'frame mean chain aerial': rectStats(ae, [0, 0, ae.width, ae.height]).mean,
    'frame mean chain yardWhite': rectStats(yw, [0, 0, yw.width, yw.height]).mean,
    'frame mean chain midStreet': rectStats(ms, [0, 0, ms.width, ms.height]).mean,
    'frame mean chain interiorOrange': rectStats(io, [0, 0, io.width, io.height]).mean,
    'frame mean chain spawnA': rectStats(sa, [0, 0, sa.width, sa.height]).mean,
    'frame mean chain whitePoolRoom': rectStats(wp, [0, 0, wp.width, wp.height]).mean,
  };
}

const b = measure(BASE);
const p = measure(PROBE);

// sky bit-identity, pixel exact, on the spawnA sky patch in both passes
const skyChain = maxAbsDiff(readPng(P(BASE, 'spawnA')), readPng(P(PROBE, 'spawnA')), R.spawnASky);
const skyAo = maxAbsDiff(readPng(P(BASE, 'ao-spawnA')), readPng(P(PROBE, 'ao-spawnA')), R.spawnASky);

const keys = Object.keys(b);
console.log('\nBASE  = ' + BASE + '\nPROBE = ' + PROBE + '\n');
for (const k of keys) {
  if (k === 'tag') continue;
  const bv = b[k], pv = p[k];
  if (Array.isArray(bv)) {
    console.log('  ' + k);
    console.log('      base  ' + bv.join(' '));
    console.log('      probe ' + pv.join(' '));
  } else {
    const d = (typeof bv === 'number' && typeof pv === 'number') ? (pv - bv) : '';
    console.log('  ' + k.padEnd(50)
      + String(bv).padStart(9) + '  ->' + String(pv).padStart(9)
      + (d === '' ? '' : '   Δ ' + (d > 0 ? '+' : '') + d.toFixed(2)));
  }
}
console.log('\n  sky patch pixel diff  chain ' + JSON.stringify(skyChain) + '  ao ' + JSON.stringify(skyAo));

writeFileSync(join(CAP, PROBE + '-guards.json'),
  JSON.stringify({ base: b, probe: p, skyChain, skyAo }, null, 2));
