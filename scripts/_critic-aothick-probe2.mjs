/**
 * ao-thickness round 0 — second probe: halo baseline along sky silhouettes,
 * value-range histogram, and gun-contamination control.
 */
import { readPng, luma } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const TAG = process.env.CRITIC_TAG || 'g-ao-thickness-r0';
const P = (n) => join(CAP, TAG + '-' + n + '.png');

// --- halo baseline: walk a horizontal scanline OUT of a silhouette into open sky
// on the ?post=ao frame. A halo shows as a dark band 2-20 px wide in the sky.
const ao = readPng(P('ao-turningHead'));
const chain = readPng(P('turningHead'));
const SCANS = [
  ['left lamp head, rightward into sky', 350, 70, +1],
  ['left lamp pole, rightward into sky', 175, 300, +1],
  ['white coach roof, upward into sky', 500, 415, 0, -1],
  ['blue bus roof, upward into sky', 1000, 400, 0, -1],
  ['right lamp pole, leftward into sky', 1245, 260, -1],
  ['right lamp head, leftward into sky', 1060, 78, -1],
];
console.log('== halo baseline (?post=ao, 229 = AO doing nothing; a halo = a dip)');
for (const [name, x0, y0, dx, dy] of SCANS) {
  const vals = [];
  for (let i = 0; i <= 24; i++) {
    const x = x0 + (dx || 0) * i, y = y0 + (dy || 0) * i;
    if (x < 0 || y < 0 || x >= ao.width || y >= ao.height) break;
    vals.push(Math.round(luma(ao, x, y)));
  }
  console.log('   ' + name.padEnd(38) + vals.join(' '));
}

console.log('\n== value range (whole frame, chain)');
for (const st of ['interiorOrange', 'whitePoolRoom', 'turningHead', 'spawnA']) {
  const img = readPng(P(st));
  let lo = 0, hi = 0, t = 0;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const v = luma(img, x, y); t++;
    if (v < 51) lo++; if (v > 229.5) hi++;
  }
  console.log('   ' + st.padEnd(16) + ' below 20% luma ' + (100 * lo / t).toFixed(2)
    + ' %   above 90% luma ' + (100 * hi / t).toFixed(2) + ' %');
}

// --- gun-contamination control: my whitePoolRoom frame is a TELEPORT frame with
// the viewmodel overlay explicitly cleared. Prove it is clean the way the brief
// describes the contaminated case: near-black share of the lower-right quadrant.
console.log('\n== viewmodel-overlay control (near-black share, lower-right quadrant 800,450-1600,900)');
for (const st of ['whitePoolRoom', 'interiorOrange']) {
  const img = readPng(P(st));
  let n = 0, t = 0;
  for (let y = 450; y < 900; y++) for (let x = 800; x < 1600; x++) { t++; if (luma(img, x, y) < 12) n++; }
  console.log('   ' + st.padEnd(16) + (100 * n / t).toFixed(3) + ' %');
}

// --- turningHead: does anything in the sky differ from flat?
let skyMin = 255, skyAt = null;
for (let y = 20; y < 200; y++) for (let x = 400; x < 900; x++) {
  const v = luma(ao, x, y); if (v < skyMin) { skyMin = v; skyAt = [x, y]; }
}
console.log('\n   darkest ?post=ao pixel in the clear-sky box 400,20-900,200: '
  + skyMin.toFixed(1) + ' at ' + JSON.stringify(skyAt) + '   (229 = no AO)');
console.log('   same box on the chain frame mean: ' + (() => {
  let s = 0, t = 0; for (let y = 20; y < 200; y++) for (let x = 400; x < 900; x++) { s += luma(chain, x, y); t++; }
  return (s / t).toFixed(2);
})());
