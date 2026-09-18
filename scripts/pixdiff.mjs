/**
 * THROWAWAY pixel comparator (delete after the report). Loads capture PNGs
 * through the dev server (no file:// taint), downsamples, reports mean-abs
 * channel diffs between every pair. Kills eyeball/cache ambiguity.
 * Usage: node scripts/pixdiff.mjs <fileA> <fileB> [...]
 * Paths relative to repo root, e.g. captures/zz5.png
 */
import { chromium } from 'playwright';
import { spawnGuarded, stopServer } from './lib/proc-guard.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = process.argv.slice(2);
if (!files.length) {
  console.error('usage: node scripts/pixdiff.mjs <png...>');
  process.exit(1);
}

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

const port = await freePort();
// windowsHide: node defaults it to FALSE, and with shell:true on Windows every
// one of these spawns a visible cmd.exe window. Running captures in a loop put
// console windows over the owner's screen and stole his keyboard focus.
// spawnGuarded, not spawn: this one runs the DEV server on purpose (it tests the
// source path, not the built artifact), so it cannot share the preview server -
// but a plain .kill() leaves vite's esbuild child orphaned, and any throw before
// the kill leaked the whole tree. spawnGuarded reaps on exit, SIGINT, SIGTERM and
// unhandled errors alike.
const server = spawnGuarded(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', '--port', String(port), '--strictPort'],
  { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32', windowsHide: true },
);
const base = 'http://localhost:' + port + '/';
for (let i = 0; i < 150; i++) {
  try {
    const r = await fetch(base);
    if (r.ok) break;
  } catch { /* retry */ }
  await new Promise((r) => setTimeout(r, 400));
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');

const sigs = {};
for (const f of files) {
  const url = base + f + '?t=' + Date.now() + Math.random();
  const sig = await page.evaluate(async (u) => {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = u;
    });
    const W = 160;
    const H = 90;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const c = cv.getContext('2d', { willReadFrequently: true });
    c.drawImage(img, 0, 0, W, H);
    const d = c.getImageData(0, 0, W, H).data;
    let r = 0;
    let g = 0;
    let b = 0;
    const n = W * H;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
    }
    return {
      mean: [r / n / 255, g / n / 255, b / n / 255].map((v) => +v.toFixed(4)),
      px: Array.from(d.filter((_, i) => i % 4 < 3)),
    };
  }, url);
  sigs[f] = sig;
  console.log(f, 'meanRGB=' + sig.mean.join(','));
}

const names = Object.keys(sigs);
for (let i = 0; i < names.length; i++) {
  const row = [];
  for (let j = 0; j < names.length; j++) {
    const a = sigs[names[i]].px;
    const b = sigs[names[j]].px;
    let s = 0;
    for (let k = 0; k < a.length; k++) s += Math.abs(a[k] - b[k]);
    row.push((s / a.length / 255).toFixed(4));
  }
  console.log(names[i].padEnd(34) + row.join('  '));
}

await browser.close();
stopServer(server);
