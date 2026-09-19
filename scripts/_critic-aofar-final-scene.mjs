/**
 * ao-farfade INTEGRATION critic — whole-scene read, READ-ONLY over PNGs on disk.
 *
 * Nothing here renders and nothing here edits source. It opens two sets of frames
 * that already exist and states them side by side:
 *
 *   BEFORE  captures/gauntlet/ao-farfade/round-0/g-ao-farfade-r0-*   (post.ts 0630578c,
 *           bundle 20e46e22, vehicles module 120 objects)
 *   AFTER   captures/g-ao-farfade-final*                             (post.ts 0630578c,
 *           bundle 280e96e0, vehicles module 120 objects)
 *
 * Every distance / open-flat rectangle below is carried over VERBATIM from
 * scripts/_critic-aotwo-final-distance.mjs (the ao-twoscale integration critic's own
 * script); the ONLY change is which two tags are read. No rectangle is added, moved
 * or replaced, and no threshold is changed.
 *
 *   node scripts/_critic-aofar-final-scene.mjs
 */
import { readPng, luma, rectStats } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const R0 = join(ROOT, 'captures/gauntlet/ao-farfade/round-0');
const AFTER_TAG = 'g-ao-farfade-final';

const STATIONS = ['aerial', 'yardOrange', 'yardWhite', 'streetElevation', 'plaza',
  'turningHead', 'spawnA', 'spawnB', 'midStreet', 'interiorOrange', 'whitePoolRoom'];

const beforeChain = (s) => join(R0, 'g-ao-farfade-r0-' + s + '.png');
const beforeAo = (s) => join(R0, 'g-ao-farfade-r0-ao-' + s + '.png');
const afterChain = (s) => join(CAP, AFTER_TAG + '-' + s + '.png');
const afterAo = (s) => join(CAP, AFTER_TAG + '-ao-' + s + '.png');

const open = (p) => (existsSync(p) ? readPng(p) : null);
const frameMean = (img) => {
  let s = 0, n = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { s += luma(img, x, y); n++; }
  return s / n;
};
const pct = (img, pred) => {
  let n = 0, t = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { t++; if (pred(luma(img, x, y))) n++; }
  return +(100 * n / t).toFixed(2);
};

const out = { when: new Date().toISOString(), chain: {}, ao: {}, probes: [] };

console.log('== whole frame, every station photographed by BOTH sets');
console.log('station           chain before   after      d%   |  ao <225%  before   after   |  ao floor%  before  after');
for (const s of STATIONS) {
  const bC = open(beforeChain(s)), aC = open(afterChain(s));
  const bA = open(beforeAo(s)), aA = open(afterAo(s));
  let chainCell = '        —            —        —';
  if (bC && aC) {
    const b = frameMean(bC), a = frameMean(aC);
    const d = 100 * (a - b) / b;
    out.chain[s] = { before: +b.toFixed(2), after: +a.toFixed(2), dPct: +d.toFixed(2) };
    chainCell = String(b.toFixed(2)).padStart(12) + String(a.toFixed(2)).padStart(9) + String(d.toFixed(2)).padStart(9);
  }
  let aoCell = '        —        —          —       —';
  if (bA && aA) {
    const bb = pct(bA, (v) => v < 225), aa = pct(aA, (v) => v < 225);
    const bf = pct(bA, (v) => v < 110), af = pct(aA, (v) => v < 110);
    out.ao[s] = { below225Before: bb, below225After: aa, floorBefore: bf, floorAfter: af };
    aoCell = String(bb.toFixed(2)).padStart(9) + String(aa.toFixed(2)).padStart(9)
      + '  ' + String(bf.toFixed(2)).padStart(9) + String(af.toFixed(2)).padStart(8);
  }
  console.log(s.padEnd(17) + chainCell + '   |' + aoCell);
}

// ---------------------------------------------------------------------------
// Distance / open-flat probes — rectangles VERBATIM from _critic-aotwo-final-distance.mjs
// ---------------------------------------------------------------------------
const PROBES = [
  ['yardWhite', 'distant ridge left  (bare rock)', [60, 70, 360, 150], 'distance'],
  ['yardWhite', 'distant ridge right (bare rock)', [1400, 80, 1540, 150], 'distance'],
  ['yardWhite', 'skyline block band', [600, 200, 1100, 250], 'distance'],
  ['yardWhite', 'open paving foreground', [900, 790, 1500, 880], 'openflat'],
  ['yardOrange', 'distant ridge band', [120, 60, 900, 140], 'distance'],
  ['yardOrange', 'skyline block band', [420, 240, 1000, 290], 'distance'],
  ['yardOrange', 'open lawn clear of props', [150, 590, 480, 720], 'openflat'],
  ['aerial', 'desert floor beyond fence', [60, 60, 500, 150], 'distance'],
  ['aerial', 'open street centre', [700, 430, 900, 520], 'openflat'],
  ['streetElevation', 'open asphalt', [500, 700, 1100, 860], 'openflat'],
  ['spawnB', 'open lawn', [300, 640, 700, 760], 'openflat'],
  ['plaza', 'open asphalt foreground', [400, 780, 1200, 880], 'openflat'],
];

console.log('');
console.log('== inherited distance / open-flat rectangles, ?post=ao   (229 = the term doing nothing)');
console.log('station/rect                                       before    after     >220%b  >220%a');
const pctAbove = (img, rect, t) => {
  const [x0, y0, x1, y1] = rect; let n = 0, k = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { k++; if (luma(img, x, y) > t) n++; }
  return +(100 * n / k).toFixed(2);
};
for (const [st, label, rect, kind] of PROBES) {
  const b = open(beforeAo(st)), a = open(afterAo(st));
  if (!b || !a) { console.log((st + ' ' + label).padEnd(50) + '  (missing frame)'); continue; }
  const bm = rectStats(b, rect).mean, am = rectStats(a, rect).mean;
  const bp = pctAbove(b, rect, 220), ap = pctAbove(a, rect, 220);
  out.probes.push({ station: st, label, kind, rect, before: +bm.toFixed(2), after: +am.toFixed(2), b220: bp, a220: ap });
  console.log((st + '  ' + label).padEnd(50)
    + String(bm.toFixed(2)).padStart(8) + String(am.toFixed(2)).padStart(9)
    + String(bp.toFixed(2)).padStart(10) + String(ap.toFixed(2)).padStart(8));
}

writeFileSync(join(CAP, AFTER_TAG + '-scene.json'), JSON.stringify(out, null, 2));
console.log('\nwrote ' + AFTER_TAG + '-scene.json');
