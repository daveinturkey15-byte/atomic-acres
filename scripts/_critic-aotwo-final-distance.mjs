/**
 * ao-twoscale INTEGRATION critic — S5 guard, READ-ONLY.
 *
 * The ten-station read shows the NEAR term firing at every station. S5 asks that the
 * skyline "reads as far" and that aerial perspective falls off with depth; a crease
 * kernel that draws hard lines on a distant ridge destroys exactly that. Round 1
 * checked two bare-ridge patches at turningHead only. These rectangles are on the
 * DISTANT skyline at the three stations that actually show it, plus clean open
 * surfaces at each exterior as the "does it wash an unoccluded plane" control.
 *
 * before = captures/gauntlet/ao-thickness/final (far-only), after = captures/ (two-scale).
 */
import { readPng, rectStats, luma } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const THICK = join(ROOT, 'captures/gauntlet/ao-thickness/final');

// [station, label, rect, kind]   kind: 'distance' | 'openflat'
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

const pctAbove = (img, rect, t) => {
  const [x0, y0, x1, y1] = rect; let n = 0, k = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { k++; if (luma(img, x, y) > t) n++; }
  return +(100 * n / k).toFixed(2);
};

const out = [];
console.log('                                            ?post=ao                  chain');
console.log('station/rect                            before  after   >220%b >220%a   before   after      d%');
for (const [st, label, rect, kind] of PROBES) {
  const bAo = join(THICK, 'g-ao-thickness-final-ao-' + st + '.png');
  const aAo = join(CAP, 'g-ao-twoscale-final-ao-' + st + '.png');
  const bC = join(THICK, 'g-ao-thickness-final-cap-' + st + '.png');
  const aC = join(CAP, 'g-ao-twoscale-final-cap-' + st + '.png');
  if (![bAo, aAo, bC, aC].every(existsSync)) { console.log('  skip ' + st + ' ' + label); continue; }
  const B = readPng(bAo), A = readPng(aAo), BC = readPng(bC), AC = readPng(aC);
  const b = rectStats(B, rect).mean, a = rectStats(A, rect).mean;
  const bc = rectStats(BC, rect).mean, ac = rectStats(AC, rect).mean;
  const row = { station: st, label, kind, rect, aoBefore: b, aoAfter: a,
    aoAbove220Before: pctAbove(B, rect, 220), aoAbove220After: pctAbove(A, rect, 220),
    chainBefore: bc, chainAfter: ac, chainDeltaPct: +(100 * (ac - bc) / bc).toFixed(2) };
  out.push(row);
  console.log('  ' + (st + ' ' + label).padEnd(38)
    + String(b).padStart(7) + String(a).padStart(7)
    + String(row.aoAbove220Before).padStart(8) + String(row.aoAbove220After).padStart(7)
    + String(bc).padStart(9) + String(ac).padStart(8)
    + String(row.chainDeltaPct + '%').padStart(8) + '  ' + kind);
}
writeFileSync(join(CAP, 'g-ao-twoscale-final-distance.json'), JSON.stringify(out, null, 2));
