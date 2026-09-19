/**
 * ao-thickness INTEGRATION critic — is the new occlusion term SCREEN-SPACE biased?
 *
 * GTAO searches horizons in screen space. A sample that leaves the viewport is not
 * found, so a wider kernel can darken the border of the frame for no reason in the
 * world. The test: mean of the `?post=ao` frame banded by distance to the nearest
 * viewport edge, per station, round-0 state (A) vs shipped (S) vs +AO_CURVE (B).
 *
 * A term free of screen bias has a flat profile across the bands (the world does not
 * know where the frame edge is). Read-only over PNGs already on disk.
 */
import { readPng, luma } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const TAGS = { A: 'g-ao-thickness-probeA', S: 'g-ao-thickness-final', B: 'g-ao-thickness-probeB' };
const STATIONS = ['aerial', 'yardOrange', 'yardWhite', 'streetElevation', 'plaza',
  'turningHead', 'spawnA', 'spawnB', 'midStreet', 'interiorOrange', 'whitePoolRoom'];

const BANDS = [[0, 40], [40, 100], [100, 200], [200, 350], [350, 9999]];

function edgeProfile(img) {
  const W = img.width, H = img.height;
  const acc = BANDS.map(() => ({ s: 0, n: 0 }));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.min(x, y, W - 1 - x, H - 1 - y);
      for (let i = 0; i < BANDS.length; i++) {
        if (d >= BANDS[i][0] && d < BANDS[i][1]) { acc[i].s += luma(img, x, y); acc[i].n++; break; }
      }
    }
  }
  return acc.map((a) => +(a.s / a.n).toFixed(2));
}

const out = {};
for (const st of STATIONS) {
  const row = {};
  for (const [k, tag] of Object.entries(TAGS)) {
    const p = join(CAP, tag + '-ao-' + st + '.png');
    if (!existsSync(p)) continue;
    row[k] = edgeProfile(readPng(p));
  }
  // the interior band (350+) is the reference; how much darker is the outer ring?
  for (const k of Object.keys(row)) {
    const p = row[k];
    row[k + '_edgeDeficit'] = +(p[p.length - 1] - p[0]).toFixed(2);
  }
  out[st] = row;
}

writeFileSync(join(CAP, 'g-ao-thickness-final-edgebias.json'), JSON.stringify(out, null, 2));

const f = (v, w = 8) => String(v).padStart(w);
console.log('\n?post=ao mean by distance to the VIEWPORT EDGE (229 = the term doing nothing)');
console.log('   station          st  0-40   40-100  100-200 200-350   350+   edge deficit (350+ minus 0-40)');
for (const st of STATIONS) {
  for (const k of ['A', 'S', 'B']) {
    const p = out[st][k]; if (!p) continue;
    console.log('   ' + st.padEnd(16) + k.padEnd(4) + p.map((v) => f(v)).join('') + f(out[st][k + '_edgeDeficit'], 12));
  }
  console.log('');
}
