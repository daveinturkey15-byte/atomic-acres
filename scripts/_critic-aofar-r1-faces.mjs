/**
 * ao-farfade ROUND 1 critic — READ-ONLY diagnostic over PNGs already on disk.
 * Adds rectangles that are ONLY used as the comparison pair inside one object;
 * it replaces no inherited rectangle and no inherited threshold.
 * Question: within a SINGLE distant object, does the far term discriminate by
 * face orientation (grazing vs frontal) rather than by distance?
 */
import { readPng, rectStats, luma } from './_critic-png.mjs';

const TAG = process.env.CRITIC_TAG || 'g-ao-farfade-r1';
const P = (n) => `captures/${TAG}-${n}.png`;

const sets = [
  ['ao-yardWhite', [
    ['right ridge — edge-on left flank  ', [1440, 78, 1478, 140]],
    ['right ridge — broad frontal face  ', [1500, 80, 1590, 140]],
    ['left  ridge — frontal face        ', [1360, 70, 1400, 130]],
    ['centre ridge (same haze band)     ', [700, 95, 950, 150]],
  ]],
  ['ao-aerial', [
    ['FAR  TL slab — edge-on side face  ', [60, 40, 300, 130]],
    ['FAR  TL slab — top face           ', [40, 5, 240, 40]],
    ['NEAR BL slab — top face           ', [150, 720, 400, 840]],
    ['desert floor, same far depth      ', [330, 180, 520, 260]],
  ]],
];

for (const [img, rects] of sets) {
  let p;
  try { p = readPng(P(img)); } catch (e) { console.log(`-- ${img}: ${e.message}`); continue; }
  console.log(`\n== ${TAG}-${img}.png   (229 = far+near term doing nothing, 0 = full AO_STRENGTH)`);
  for (const [label, r] of rects) {
    const s = rectStats(p, r, luma);
    console.log(`   ${label} [${r.join(',')}]  mean ${s.mean.toFixed(2)}  p5 ${s.p5.toFixed(0)}  p95 ${s.p95.toFixed(0)}`);
  }
}
