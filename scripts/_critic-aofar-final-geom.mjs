/**
 * ao-farfade INTEGRATION critic — READ-ONLY geometry read over PNGs already on disk.
 *
 * Question the whole round turns on: at the rectangles the brief's two fades are aimed
 * at, what are |n·v| (grazing) and view depth actually WORTH? A fade with edges
 * (0.12, 0.40) on |n·v| and (30, 70) on viewZ can only move a rectangle whose values
 * fall inside those windows.
 *
 * Inputs are frames left in captures/gauntlet/ao-farfade/round-1/ from the builder
 * window: `-diagN-*` (the ?post=ao branch re-pointed at |n·v|), `-diagZ-*` (at
 * viewZ/100) and `-ramp.json` (a uv().x calibration ramp through the identical output
 * path, i.e. linear scalar -> display luma). I did NOT produce them; this script only
 * measures them and says so. The ramp inverts the display mapping so a luma can be
 * read back as the scalar the shader wrote.
 *
 * Every rectangle is carried over VERBATIM from scripts/_critic-aofar-r0-farslab.mjs
 * and scripts/_critic-aotwo-measure.mjs. Nothing renders, nothing is edited.
 */
import { readPng, luma } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const R1 = join(ROOT, 'captures/gauntlet/ao-farfade/round-1');

const ramp = JSON.parse(readFileSync(join(R1, 'g-ao-farfade-ramp.json'), 'utf8'))
  .slice().sort((a, b) => a.display - b.display);

/** display luma -> the linear scalar the shader wrote, by the measured ramp */
function toLinear(d) {
  if (d <= ramp[0].display) return ramp[0].linear;
  if (d >= ramp[ramp.length - 1].display) return ramp[ramp.length - 1].linear;
  for (let i = 1; i < ramp.length; i++) {
    if (ramp[i].display >= d) {
      const a = ramp[i - 1], b = ramp[i];
      const t = (d - a.display) / Math.max(1e-6, b.display - a.display);
      return a.linear + t * (b.linear - a.linear);
    }
  }
  return ramp[ramp.length - 1].linear;
}

const rectMedianLuma = (img, [x0, y0, x1, y1]) => {
  const v = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) v.push(luma(img, x, y));
  v.sort((a, b) => a - b);
  return { p5: v[Math.round(0.05 * (v.length - 1))], p50: v[Math.round(0.5 * (v.length - 1))], p95: v[Math.round(0.95 * (v.length - 1))] };
};

// rectangles VERBATIM from the inherited scripts
const CASES = [
  ['aerial', 'skyline slab TL          (must improve)', [20, 10, 330, 150]],
  ['aerial', 'skyline slab TR          (must improve)', [1440, 10, 1590, 120]],
  ['aerial', 'desert floor mid-left    (clean control)', [60, 200, 400, 330]],
  ['yardWhite', 'ridge right            (must improve)', [1405, 85, 1535, 145]],
  ['yardWhite', 'ridge left             (washed, no field)', [70, 80, 350, 145]],
  ['midStreet', 'coach flank right      (must improve)', [1280, 470, 1480, 530]],
  ['midStreet', 'coach flank left       (frontal control)', [320, 470, 520, 530]],
  ['interiorOrange', 'wall full        (must hold)', [620, 60, 1200, 760]],
  ['whitePoolRoom', 'wall full         (must hold)', [620, 60, 1200, 760]],
  ['spawnA', 'crate base contact        (must hold)', [745, 640, 935, 675]],
];

const open = (tag, st) => {
  const p = join(R1, `g-ao-farfade-${tag}-ao-${st}.png`);
  return existsSync(p) ? readPng(p) : null;
};

console.log('rectangles verbatim from _critic-aofar-r0-farslab.mjs / _critic-aotwo-measure.mjs');
console.log('|n.v| and viewZ read back through the builder window\'s own uv().x calibration ramp\n');
console.log('station / rect                                        |n.v| p5   p50   p95   |  viewZ m p5    p50    p95   | gFade(0.12,0.40)  dFade(30,70)');
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

for (const [st, label, rect] of CASES) {
  const n = open('diagN', st), z = open('diagZ', st);
  if (!n || !z) { console.log((st + '  ' + label).padEnd(54) + '  (no diagnostic frame)'); continue; }
  const nl = rectMedianLuma(n, rect), zl = rectMedianLuma(z, rect);
  const nv = [nl.p5, nl.p50, nl.p95].map(toLinear);
  const vz = [zl.p5, zl.p50, zl.p95].map((d) => toLinear(d) * 100); // diagZ was written as viewZ/100
  const g = ss(0.12, 0.40, nv[1]);
  const d = 1 - ss(30, 70, vz[1]);
  console.log((st + '  ' + label).padEnd(54)
    + nv.map((v) => v.toFixed(3).padStart(6)).join('')
    + '  |' + vz.map((v) => v.toFixed(1).padStart(7)).join('')
    + '   |' + g.toFixed(3).padStart(10) + d.toFixed(3).padStart(14));
}
console.log('\ngFade = smoothstep(0.12, 0.40, |n.v|)   — 1 keeps the far term, 0 removes it');
console.log('dFade = 1 - smoothstep(30, 70, viewZ)   — 1 keeps the term, 0 removes it');
console.log('A fade can only move a rect whose value lies strictly inside its own window.');
