/**
 * ao-twoscale ROUND 0 — halo BASELINE at turningHead, single state, read-only.
 *
 * The sky mask and the distance banding are lifted unchanged from
 * scripts/_critic-aothick-r1-raw.mjs so round 1 can diff band for band. A halo shows
 * as the 1-2 px band darkening relative to the 13+ px field.
 */
import { readPng, luma, rgb } from './_critic-png.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAP = join(ROOT, 'captures');
const TAG = process.env.CRITIC_TAG || 'g-ao-twoscale-r0';
const chain = readPng(join(CAP, TAG + '-turningHead.png'));
const ao = readPng(join(CAP, TAG + '-ao-turningHead.png'));

const W = chain.width, H = chain.height;
const isSky = (img, x, y) => {
  const [r, g, bl] = rgb(img, x, y);
  return bl > r + 6 && bl > 110 && (0.2126 * r + 0.7152 * g + 0.0722 * bl) > 120;
};
const sky = new Uint8Array(W * H);
const top = Math.floor(H * 0.45);
for (let y = 0; y < top; y++) for (let x = 0; x < W; x++) if (isSky(chain, x, y)) sky[y * W + x] = 1;

const DCAP = 12;
const dist = new Int16Array(W * H).fill(-1);
for (let y = 0; y < top; y++) for (let x = 0; x < W; x++) {
  if (!sky[y * W + x]) continue;
  let d = DCAP + 1;
  for (let r = 1; r <= DCAP && d > DCAP; r++) {
    let hit = false;
    for (let dx = -r; dx <= r && !hit; dx++) {
      for (const dy of [-r, r]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= top) { hit = true; break; }
        if (!sky[ny * W + nx]) { hit = true; break; }
      }
    }
    if (!hit) for (const dx of [-r, r]) {
      for (let dy = -r; dy <= r && !hit; dy++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= W || ny < 0 || ny >= top) { hit = true; break; }
        if (!sky[ny * W + nx]) { hit = true; break; }
      }
    }
    if (hit) d = r;
  }
  dist[y * W + x] = d;
}

const bands = [[1, 2], [3, 4], [5, 6], [7, 12], [13, 99]];
const rows = [];
for (const [lo, hi] of bands) {
  let n = 0, a = 0, c = 0;
  for (let y = 0; y < top; y++) for (let x = 0; x < W; x++) {
    const d = dist[y * W + x];
    if (d < lo || d > hi) continue;
    n++; a += luma(ao, x, y); c += luma(chain, x, y);
  }
  if (!n) continue;
  rows.push({ band: lo + '-' + hi, n, ao: +(a / n).toFixed(2), chain: +(c / n).toFixed(2) });
}
let skyN = 0; for (let i = 0; i < sky.length; i++) skyN += sky[i];
console.log('sky mask px: ' + skyN);
for (const r of rows) console.log('  ' + r.band.padEnd(7) + String(r.n).padStart(8)
  + '   ao ' + String(r.ao).padStart(7) + '   chain ' + String(r.chain).padStart(7));
writeFileSync(join(CAP, TAG + '-halo-baseline.json'), JSON.stringify({ tag: TAG, skyPx: skyN, rows }, null, 2));
