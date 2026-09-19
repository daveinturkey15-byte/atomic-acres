/**
 * ao-twoscale INTEGRATION critic — is the new darkening on the DISTANT skyline an edge
 * line (correct) or a solid field over the slab's interior (a defect)? READ-ONLY.
 *
 * A rect mean cannot tell those apart, which is how round 1's "mountains" alarm turned
 * out to be rect contamination. So: profiles straight across the slab interiors, plus
 * the share of the rect that is a CONTIGUOUS field rather than a line, computed as the
 * share below 180 after the frame has been eroded by 3 px (an edge line 1-6 px wide
 * erodes away; a field does not).
 */
import { readPng, luma } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const THICK = join(ROOT, 'captures/gauntlet/ao-thickness/final');
const B = (s) => readPng(join(THICK, 'g-ao-thickness-final-ao-' + s + '.png'));
const A = (s) => readPng(join(CAP, 'g-ao-twoscale-final-ao-' + s + '.png'));

const hcut = (img, y, x0, x1, step) => {
  const r = [];
  for (let x = x0; x <= x1; x += step) {
    let s = 0, n = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { s += luma(img, x + dx, y + dy); n++; }
    r.push(Math.round(s / n));
  }
  return r;
};
/** share of rect below `t` AFTER a 3px erosion of the "dark" set: lines vanish, fields stay */
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

const CASES = [
  ['aerial', 'top-left skyline slab', [20, 10, 330, 150], 80, [20, 320, 20]],
  ['aerial', 'top-right skyline slab', [1440, 10, 1590, 120], 60, [1440, 1590, 15]],
  ['aerial', 'desert floor mid-left', [60, 200, 400, 330], 260, [60, 400, 30]],
  ['yardWhite', 'ridge left', [70, 80, 350, 145], 110, [70, 350, 25]],
  ['yardWhite', 'ridge right', [1405, 85, 1535, 145], 115, [1405, 1535, 12]],
  ['yardOrange', 'ridge band', [130, 65, 890, 135], 100, [130, 890, 50]],
  ['turningHead', 'mountains (round 1 rect)', [180, 270, 700, 330], 300, [180, 700, 40]],
  ['midStreet', 'coach flank (known far-term wash)', [320, 470, 1480, 530], 500, [320, 1480, 80]],
];

const out = [];
for (const [st, label, rect, y, [x0, x1, step]] of CASES) {
  const b = B(st), a = A(st);
  const row = { station: st, label, rect,
    fieldPctBefore: fieldPct(b, rect), fieldPctAfter: fieldPct(a, rect),
    cutBefore: hcut(b, y, x0, x1, step), cutAfter: hcut(a, y, x0, x1, step) };
  out.push(row);
  console.log('\n== ' + st + ' — ' + label + '   (solid-field share <180 after 3px erosion)');
  console.log('   before ' + String(row.fieldPctBefore).padStart(6) + ' %      after ' + String(row.fieldPctAfter).padStart(6) + ' %');
  console.log('   cut y=' + y + '  before  ' + row.cutBefore.join(' '));
  console.log('   cut y=' + y + '  after   ' + row.cutAfter.join(' '));
}
writeFileSync(join(CAP, 'g-ao-twoscale-final-farslab.json'), JSON.stringify(out, null, 2));
