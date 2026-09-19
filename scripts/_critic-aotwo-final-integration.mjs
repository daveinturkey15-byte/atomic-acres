/**
 * ao-twoscale INTEGRATION critic — whole-scene read, READ-ONLY over PNGs on disk.
 *
 * Nothing here renders and nothing here edits. It opens three sets of frames that
 * already exist and states them side by side:
 *
 *   BEFORE-A  captures/gauntlet/ao-thickness/final/g-ao-thickness-final-*     far-only AO
 *             (post.ts ac63f491 — thickness 3.0, AO_DEEP 0.194, ONE kernel),
 *             geometry epoch 1 (pre static-batch, pre B5 destination board)
 *   BEFORE-B  captures/gauntlet/ao-twoscale/round-0/g-ao-twoscale-r0-*        far-only AO,
 *             the SAME post.ts, geometry epoch 2 (pre static-batch)
 *   AFTER     captures/g-ao-twoscale-final-*                                  two-scale AO
 *             (post.ts 0630578c), geometry epoch 3 (today)
 *
 * BEFORE-A vs BEFORE-B is the CONTROL: identical AO, different geometry epoch. Whatever
 * it moves is the geometry confound, and it bounds how much of AFTER − BEFORE can be
 * claimed for the AO change. Without it a ten-station "before vs after" is not honest.
 */
import { readPng, luma, rectStats } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const THICK = join(ROOT, 'captures/gauntlet/ao-thickness/final');
const TWO0 = join(ROOT, 'captures/gauntlet/ao-twoscale/round-0');

const STATIONS = ['aerial', 'yardOrange', 'yardWhite', 'streetElevation', 'plaza',
  'turningHead', 'spawnA', 'spawnB', 'midStreet', 'interiorOrange', 'whitePoolRoom'];

// chain frame for each set, per station (null = that set never photographed it)
const chainPath = {
  A: (s) => join(THICK, 'g-ao-thickness-final-cap-' + s + '.png'),
  B: (s) => join(TWO0, 'g-ao-twoscale-r0-' + s + '.png'),
  S: (s) => join(CAP, 'g-ao-twoscale-final-cap-' + s + '.png'),
};
const aoPath = {
  A: (s) => join(THICK, 'g-ao-thickness-final-ao-' + s + '.png'),
  B: (s) => join(TWO0, 'g-ao-twoscale-r0-ao-' + s + '.png'),
  S: (s) => join(CAP, 'g-ao-twoscale-final-ao-' + s + '.png'),
};
// whitePoolRoom has no capture.mjs frame in any set (not in stations.ts); the critic
// scripts write it under the bare tag.
const chainAlt = {
  A: (s) => join(THICK, 'g-ao-thickness-final-' + s + '.png'),
  B: (s) => join(TWO0, 'g-ao-twoscale-r0-' + s + '.png'),
  S: (s) => join(CAP, 'g-ao-twoscale-final-' + s + '.png'),
};

const pct = (img, pred) => {
  let n = 0, t = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) { t++; if (pred(luma(img, x, y))) n++; }
  return +(100 * n / t).toFixed(2);
};
const open = (p) => (existsSync(p) ? readPng(p) : null);

const out = { when: new Date().toISOString(), chain: {}, ao: {} };

for (const s of STATIONS) {
  out.chain[s] = {}; out.ao[s] = {};
  for (const set of ['A', 'B', 'S']) {
    const c = open(chainPath[set](s)) ?? open(chainAlt[set](s));
    if (c) {
      const st = rectStats(c, [0, 0, c.width, c.height]);
      out.chain[s][set] = { mean: st.mean, p5: st.p5, p95: st.p95,
        below20pct: pct(c, (v) => v < 51), above90pct: pct(c, (v) => v > 229) };
    }
    const a = open(aoPath[set](s));
    if (a) {
      const st = rectStats(a, [0, 0, a.width, a.height]);
      out.ao[s][set] = { mean: st.mean, p5: st.p5,
        below225pct: pct(a, (v) => v < 225), atFloorPct: pct(a, (v) => v < 8) };
    }
  }
}

writeFileSync(join(CAP, 'g-ao-twoscale-final-integration.json'), JSON.stringify(out, null, 2));

const n = (v, w = 8) => (v === undefined ? '     -  ' : String(v).padStart(w));
const d = (x, y) => (x === undefined || y === undefined ? '     -  '
  : String((100 * (y - x) / x).toFixed(2) + '%').padStart(8));

console.log('\n== CHAIN whole-frame mean luma   A=far-only/geom1  B=far-only/geom2  S=two-scale/geom3');
console.log('station           A(far)   B(far)  ctrlB-A     S(two)    S-B');
for (const s of STATIONS) {
  const r = out.chain[s];
  console.log('  ' + s.padEnd(16) + n(r.A?.mean) + n(r.B?.mean) + d(r.A?.mean, r.B?.mean)
    + '   ' + n(r.S?.mean) + d(r.B?.mean, r.S?.mean));
}

console.log('\n== ?post=ao  share of frame below 225 (the share the term touches at all)');
console.log('station           A(far)   B(far)  ctrlB-A     S(two)');
for (const s of STATIONS) {
  const r = out.ao[s];
  console.log('  ' + s.padEnd(16) + n(r.A?.below225pct) + n(r.B?.below225pct)
    + d(r.A?.below225pct, r.B?.below225pct) + '   ' + n(r.S?.below225pct));
}

console.log('\n== ?post=ao  share of frame AT the full-strength floor (<8)');
console.log('station           A(far)   B(far)     S(two)');
for (const s of STATIONS) {
  const r = out.ao[s];
  console.log('  ' + s.padEnd(16) + n(r.A?.atFloorPct) + n(r.B?.atFloorPct) + '   ' + n(r.S?.atFloorPct));
}

console.log('\n== CHAIN value range: share below 20% luma  /  share above 90% luma');
console.log('station          A<20    B<20    S<20  |   A>90    B>90    S>90');
for (const s of STATIONS) {
  const r = out.chain[s];
  console.log('  ' + s.padEnd(16) + n(r.A?.below20pct, 6) + n(r.B?.below20pct, 8) + n(r.S?.below20pct, 8)
    + '  | ' + n(r.A?.above90pct, 6) + n(r.B?.above90pct, 8) + n(r.S?.above90pct, 8));
}
