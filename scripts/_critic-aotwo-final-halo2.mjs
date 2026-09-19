/**
 * ao-twoscale INTEGRATION critic — halo and distant-patch check on MY OWN frames.
 * READ-ONLY. Rectangles are lifted UNCHANGED from scripts/_critic-aotwo-r1-halo2.mjs
 * (round 1's), which hardcodes round 0 vs round 1; this repoints the "after" at the
 * frames I captured so the check is mine, not inherited. Round 1 quoted ridge A and
 * ridge C from these four and concluded aerial perspective was untouched; ridge B is in
 * the same script and is reported here too.
 */
import { readPng, luma } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const C = join(ROOT, 'captures');
const a = readPng(join(C, 'gauntlet/ao-twoscale/round-0/g-ao-twoscale-r0-ao-turningHead.png'));
const s = readPng(join(C, 'g-ao-twoscale-final-ao-turningHead.png'));
const ac = readPng(join(C, 'gauntlet/ao-twoscale/round-0/g-ao-twoscale-r0-turningHead.png'));
const sc = readPng(join(C, 'g-ao-twoscale-final-turningHead.png'));
const band = (img, y0, y1, x0, x1) => {
  let t = 0, n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { t += luma(img, x, y); n++; }
  return +(t / n).toFixed(2);
};

console.log('AO across the left lamp pole, y195-215 (isolated thin silhouette in clean sky)');
const A = [], S = [];
for (let x = 140; x <= 280; x += 10) { A.push(band(a, 195, 215, x, x + 5)); S.push(band(s, 195, 215, x, x + 5)); }
console.log('  r0      ' + A.map((v) => String(v).padStart(7)).join(''));
console.log('  shipped ' + S.map((v) => String(v).padStart(7)).join(''));
console.log('  max |delta| = ' + Math.max(...A.map((v, i) => Math.abs(v - S[i]))).toFixed(2) + ' luma');

const patches = { 'ridge A': [620, 300, 700, 325], 'ridge B': [1290, 296, 1345, 320], 'ridge C': [960, 300, 1000, 322], 'open sky high': [600, 60, 900, 140] };
console.log('\ndistant patch          ?post=ao  r0 ->  shipped            chain  r0 ->  shipped');
for (const [k, [x0, y0, x1, y1]] of Object.entries(patches)) {
  const A2 = band(a, y0, y1, x0, x1), S2 = band(s, y0, y1, x0, x1);
  const A3 = band(ac, y0, y1, x0, x1), S3 = band(sc, y0, y1, x0, x1);
  console.log('  ' + k.padEnd(15) + String(A2).padStart(9) + ' ->' + String(S2).padStart(9)
    + String(((S2 - A2) / A2 * 100).toFixed(2) + '%').padStart(9)
    + '   ' + String(A3).padStart(9) + ' ->' + String(S3).padStart(9)
    + String(((S3 - A3) / A3 * 100).toFixed(2) + '%').padStart(9));
}
