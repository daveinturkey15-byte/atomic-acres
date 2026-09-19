/**
 * ao-farfade ROUND 1 critic — READ-ONLY attribution check over PNGs already on disk.
 * WHICH TERM is binding at the guard regions? `occlusion = min(mFar, mNear)`, so where
 * the far-ONLY archive is clean and the shipped two-term frame is dark, mNear is binding
 * and a fade applied to mFar alone is a no-op there. Rectangles: the four inherited
 * farslab rects, verbatim, plus my two same-object diagnostic rects.
 */
import { readPng, rectStats, luma } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAG = process.env.CRITIC_TAG || 'g-ao-farfade-r1';
const FARONLY = join(ROOT, 'captures/gauntlet/ao-thickness/final');

const now = (s) => readPng(join(ROOT, 'captures', `${TAG}-ao-${s}.png`));
const far = (s) => readPng(join(FARONLY, `g-ao-thickness-final-ao-${s}.png`));

const rows = [
  ['aerial',    'skyline slab TL   (inherited farslab rect)', [20, 10, 330, 150]],
  ['aerial',    'skyline slab TR   (inherited farslab rect)', [1440, 10, 1590, 120]],
  ['yardWhite', 'ridge right       (inherited farslab rect)', [1405, 85, 1535, 145]],
  ['yardWhite', 'ridge left        (inherited farslab rect)', [70, 80, 350, 145]],
  ['yardWhite', 'ridge right, broad frontal face  (mine)   ', [1500, 80, 1590, 140]],
  ['midStreet', 'coach flank right (inherited measure rect)', [1280, 470, 1480, 530]],
  ['midStreet', 'coach flank left  (inherited, frontal ctrl)', [320, 470, 520, 530]],
];

console.log('  region                                        far-ONLY   two-term   binding term');
for (const [st, label, r] of rows) {
  const a = rectStats(far(st), r, luma).mean;
  const b = rectStats(now(st), r, luma).mean;
  const who = (a - b) > 6 ? 'mNear  (far-only is clean)' : 'mFar   (unchanged by the near term)';
  console.log(`  ${st.padEnd(10)} ${label}  ${a.toFixed(2).padStart(8)}  ${b.toFixed(2).padStart(9)}   ${who}`);
}
