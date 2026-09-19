/**
 * ao-twoscale INTEGRATION critic — WHY does the near term blacken distant surfaces?
 * READ-ONLY, no source edit, no new capture.
 *
 * GTAONode marches `sampleViewOffset = sampleDir * radius * pow((j+1)/STEPS,
 * distanceExponent)` (GTAONode.js:346) where `sampleDir` is a SCREEN-PARALLEL view-space
 * direction, then projects it. A view-space offset of world length L at depth D projects
 * to about L * f / D pixels. For the NEAR term (radius 0.9, distanceExponent 1.4,
 * samples 16 -> DIRECTIONS 3 -> STEPS 6) the innermost step is 0.9 * (1/6)^1.4 = 0.079
 * world units, so it falls under one pixel once D exceeds roughly 0.079 * f. Sub-pixel
 * samples read the shading point's OWN depth, `viewDelta` collapses toward zero, it
 * passes `abs(viewDelta.z) < thickness` (:357) and `normalize(viewDelta)` of a near-zero
 * vector is numerically arbitrary, so the horizon can close on nothing.
 *
 * If that is the mechanism the signature is a MONOTONE ramp with DEPTH on one continuous
 * unoccluded plane, present in the near term's state and absent in the far term's. This
 * samples exactly that: a column down the aerial desert floor (screen y is monotone in
 * ground distance for a pitched-down camera) and the same down the turningHead road.
 */
import { readPng, luma } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const THICK = join(ROOT, 'captures/gauntlet/ao-thickness/final');

const patch = (img, x, y, r = 6) => {
  let s = 0, n = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { s += luma(img, x + dx, y + dy); n++; }
  return +(s / n).toFixed(1);
};

// [station, label, x, yFar -> yNear, n]  — on a pitched-down camera, SMALLER y is FURTHER
const COLUMNS = [
  ['aerial', 'desert floor, left flank (far -> near)', 225, 175, 515, 8],
  ['aerial', 'desert floor, right flank (far -> near)', 1390, 120, 330, 6],
  ['turningHead', 'road + verge running away (far -> near)', 760, 420, 860, 8],
];

const out = [];
for (const [st, label, x, y0, y1, n] of COLUMNS) {
  const b = readPng(join(THICK, 'g-ao-thickness-final-ao-' + st + '.png'));
  const a = readPng(join(CAP, 'g-ao-twoscale-final-ao-' + st + '.png'));
  const ys = [], bb = [], aa = [];
  for (let i = 0; i < n; i++) {
    const y = Math.round(y0 + (y1 - y0) * i / (n - 1));
    ys.push(y); bb.push(patch(b, x, y)); aa.push(patch(a, x, y));
  }
  out.push({ station: st, label, x, ys, before: bb, after: aa });
  console.log('\n== ' + st + ' — ' + label + '   x=' + x);
  console.log('   screen y   ' + ys.map((v) => String(v).padStart(7)).join(''));
  console.log('   before     ' + bb.map((v) => String(v).padStart(7)).join(''));
  console.log('   after      ' + aa.map((v) => String(v).padStart(7)).join(''));
  console.log('   delta      ' + aa.map((v, i) => String((v - bb[i]).toFixed(1)).padStart(7)).join(''));
}
writeFileSync(join(CAP, 'g-ao-twoscale-final-depthramp.json'), JSON.stringify(out, null, 2));
