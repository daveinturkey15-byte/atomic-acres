/**
 * ao-farfade ROUND 0 (baseline) — solid-field share on distant / grazing planes.
 * READ-ONLY over PNGs already on disk. Nothing renders, nothing is edited.
 *
 * Every rectangle, the 180 threshold, the 3 px erosion and the cut rows are carried
 * over VERBATIM from scripts/_critic-aotwo-final-farslab.mjs (the ao-twoscale
 * INTEGRATION critic's own script). The ONLY change is which tag is read, so that a
 * fresh critic photographs its own frames instead of inheriting the last round's.
 * No rectangle is added, moved or replaced.
 *
 *   CRITIC_TAG=g-ao-farfade-r0 node scripts/_critic-aofar-r0-farslab.mjs
 */
import { readPng, luma } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const TAG = process.env.CRITIC_TAG || 'g-ao-farfade-r0';
const THICK = join(ROOT, 'captures/gauntlet/ao-thickness/final');

/** the far-only reference set (ao-thickness FINAL) — the state that read 0 % field */
const B = (s) => {
  const p = join(THICK, 'g-ao-thickness-final-ao-' + s + '.png');
  return existsSync(p) ? readPng(p) : null;
};
/** my own frames, this round */
const A = (s) => {
  const p = join(CAP, TAG + '-ao-' + s + '.png');
  return existsSync(p) ? readPng(p) : null;
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
const rectMean = (img, rect) => {
  const [x0, y0, x1, y1] = rect; let s = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += luma(img, x, y); n++; }
  return +(s / n).toFixed(2);
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
  if (!a) { console.log('skip ' + st + ' — no frame for tag ' + TAG); continue; }
  const row = {
    station: st, label, rect,
    fieldPctFarOnly: b ? fieldPct(b, rect) : null,
    fieldPctNow: fieldPct(a, rect),
    meanFarOnly: b ? rectMean(b, rect) : null,
    meanNow: rectMean(a, rect),
    cutFarOnly: b ? hcut(b, y, x0, x1, step) : null,
    cutNow: hcut(a, y, x0, x1, step),
  };
  out.push(row);
  console.log('\n== ' + st + ' — ' + label + '   (solid-field share <180 after 3px erosion)');
  console.log('   far-only ' + String(row.fieldPctFarOnly).padStart(6) + ' %   mean ' + String(row.meanFarOnly).padStart(7)
    + '      NOW ' + String(row.fieldPctNow).padStart(6) + ' %   mean ' + String(row.meanNow).padStart(7));
  if (row.cutFarOnly) console.log('   cut y=' + y + '  far-only  ' + row.cutFarOnly.join(' '));
  console.log('   cut y=' + y + '  NOW       ' + row.cutNow.join(' '));
}
writeFileSync(join(CAP, TAG + '-farslab.json'), JSON.stringify(out, null, 2));
