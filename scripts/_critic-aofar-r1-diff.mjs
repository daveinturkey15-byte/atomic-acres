/**
 * ao-farfade ROUND 1 critic — READ-ONLY whole-frame diff between two PNGs
 * already on disk. Adds no rectangle, replaces no inherited measurement.
 * Usage: node scripts/_critic-aofar-r1-diff.mjs <a.png> <b.png>
 */
import { readPng } from './_critic-png.mjs';

const [, , A, B] = process.argv;
const a = readPng(A), b = readPng(B);
if (a.width !== b.width || a.height !== b.height) throw new Error('size mismatch');
let sum = 0, max = 0, over2 = 0, over8 = 0, n = a.width * a.height;
for (let i = 0; i < n; i++) {
  const ai = i * a.bpp, bi = i * b.bpp;
  const la = 0.2126 * a.data[ai] + 0.7152 * a.data[ai + 1] + 0.0722 * a.data[ai + 2];
  const lb = 0.2126 * b.data[bi] + 0.7152 * b.data[bi + 1] + 0.0722 * b.data[bi + 2];
  const d = Math.abs(la - lb);
  sum += d; if (d > max) max = d; if (d > 2) over2++; if (d > 8) over8++;
}
console.log(`${A.split(/[\/]/).pop()}  vs  ${B.split(/[\/]/).pop()}`);
console.log(`   meanAbs ${(sum / n).toFixed(4)}   max ${max.toFixed(1)}   %>2 ${(100 * over2 / n).toFixed(3)}   %>8 ${(100 * over8 / n).toFixed(3)}`);
