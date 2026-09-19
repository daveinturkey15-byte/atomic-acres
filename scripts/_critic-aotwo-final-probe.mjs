/**
 * ao-twoscale INTEGRATION critic — the ONE probe, measured. READ-ONLY over PNGs.
 *
 * Probe N3: `aoNear.thickness 0.6 -> 0.3`, one numeric field on the NEAR node, nothing
 * else. Built, photographed, then src/core/post.ts restored byte-exact from a copy taken
 * before the edit (md5 verified both ways) and the bundle rebuilt to the graded hash.
 *
 * Question it has to answer: does shrinking the near term's occluder-admission band
 * remove the NEW false field on grazing planes (aerial skyline flanks, yardWhite ridge)
 * WITHOUT giving back the crease and the contact the round bought?
 */
import { readPng, luma, rectStats } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const THICK = join(ROOT, 'captures/gauntlet/ao-thickness/final');
const F = (s) => join(CAP, 'g-ao-twoscale-final-ao-' + s + '.png');
const P = (s) => join(CAP, 'g-aotwo-pN3-ao-' + s + '.png');
const B = (s) => join(THICK, 'g-ao-thickness-final-ao-' + s + '.png');

const fieldPct = (img, rect, t = 180) => {
  const [x0, y0, x1, y1] = rect; const w = x1 - x0, h = y1 - y0;
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) dark[y * w + x] = luma(img, x0 + x, y0 + y) < t ? 1 : 0;
  let n = 0, k = 0; const R = 3;
  for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) {
    k++; let all = 1;
    for (let dy = -R; dy <= R && all; dy++) for (let dx = -R; dx <= R; dx++) if (!dark[(y + dy) * w + x + dx]) { all = 0; break; }
    n += all;
  }
  return +(100 * n / k).toFixed(2);
};
const junction = (img, x = 760) => {
  const r = [];
  for (let y = 60; y <= 180; y += 12) { let s = 0; for (let dx = -12; dx <= 12; dx++) s += luma(img, x + dx, y); r.push(+(s / 25).toFixed(1)); }
  return r;
};

const ROWS = [
  ['MUST FIX  aerial skyline slab TL  solid-field %', 'aerial', [20, 10, 330, 150], 'field'],
  ['MUST FIX  aerial skyline slab TR  solid-field %', 'aerial', [1440, 10, 1590, 120], 'field'],
  ['MUST FIX  yardWhite ridge right   solid-field %', 'yardWhite', [1405, 85, 1535, 145], 'field'],
  ['MUST FIX  yardWhite ridge left    mean', 'yardWhite', [70, 80, 350, 145], 'mean'],
  ['MUST HOLD interiorOrange wall right of doorway  mean', 'interiorOrange', [620, 260, 900, 700], 'mean'],
  ['MUST HOLD whitePoolRoom wall full  mean', 'whitePoolRoom', [620, 60, 1200, 760], 'mean'],
  ['MUST HOLD spawnA crate base  mean', 'spawnA', [745, 640, 935, 675], 'mean'],
  ['MUST HOLD interiorOrange ceiling junction  mean', 'interiorOrange', [200, 88, 520, 104], 'mean'],
  ['UNCHANGED midStreet coach flank right (far term)', 'midStreet', [1280, 470, 1480, 530], 'mean'],
  ['CONTROL   spawnA lawn (open, must stay 229)', 'spawnA', [300, 620, 700, 740], 'mean'],
];

console.log('metric                                              r0(far)  SHIPPED   probeN3');
for (const [label, st, rect, kind] of ROWS) {
  const get = (p) => {
    if (!existsSync(p)) return '   n/a';
    const im = readPng(p);
    return kind === 'field' ? fieldPct(im, rect) : rectStats(im, rect).mean;
  };
  console.log('  ' + label.padEnd(50)
    + String(get(B(st))).padStart(8) + String(get(F(st))).padStart(9) + String(get(P(st))).padStart(10));
}

console.log('\n== interiorOrange wall/ceiling junction, ?post=ao, x=760 y=60..180 (0.0 = an ink line)');
for (const [k, p] of [['r0 far-only', B('interiorOrange')], ['SHIPPED    ', F('interiorOrange')], ['probe N3   ', P('interiorOrange')]]) {
  console.log('   ' + k + '  ' + junction(readPng(p)).join(' '));
}

console.log('\n== chain-side check is NOT possible for the probe (only ?post=ao frames were taken)');
