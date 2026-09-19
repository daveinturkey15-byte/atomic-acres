/**
 * ROUND-1 CRITIC one-off: four interior camera positions the stock station list
 * does not cover. Mirrors capture.mjs (real Chrome over CDP so WebGPU + post chain
 * are actually on) but drives window.__NT.teleport instead of goto.
 *
 * Throwaway. Not part of the harness. Writes captures/g-interiors-r1-<name>.png
 */
import { chromium } from 'playwright';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures');
const TAG = process.env.NT_AO ? 'g-interiors-r1-ao' : 'g-interiors-r1';
const PI = Math.PI;

const POSITIONS = [
  { name: 'orangeKitchen',  x: -3.5, y: 0,   z: -18.2, yaw: -PI / 2, note: 'orange kitchen looking at the garage door' },
  { name: 'orangeLanding',  x: 3.0,  y: 3.3, z: -22.5, yaw: PI / 2,  note: 'orange upper landing looking down the two-storey void' },
  { name: 'whitePoolRoom',  x: 9.0,  y: 0,   z: 20.0,  yaw: PI,      note: 'white house wading-pool room' },
  { name: 'whiteBedroom',   x: -3.0, y: 0,   z: 19.0,  yaw: 0,       note: 'white house upper bedroom position' },
];

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
function chromePath() {
  const c = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  for (const p of c) if (existsSync(p)) return p;
  return null;
}

const { url } = await usePreview();
mkdirSync(OUT, { recursive: true });

const cdpPort = await freePort();
const exe = chromePath();
if (!exe) { console.error('no Chrome'); process.exit(1); }
const chrome = spawnGuarded(exe, [
  '--headless=new',
  '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-critic-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--window-position=2560,0', '--window-size=1600,900',
  'about:blank',
], { stdio: 'ignore', windowsHide: true });

let browser = null;
for (let i = 0; i < 160 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!browser) { killTree(chrome.pid); console.error('no CDP'); process.exit(1); }

const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });

await page.goto(url + (process.env.NT_AO ? '?post=ao' : ''), { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });

const strip = () => page.evaluate(() => {
  document.getElementById('start')?.remove();
  const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
  const ch = document.getElementById('crosshair'); if (ch) ch.style.display = 'none';
  return !document.getElementById('start');
});
await strip();
await page.waitForTimeout(1500);

const results = [];
for (const p of POSITIONS) {
  await page.evaluate((q) => window.__NT.teleport(q.x, q.y, q.z, q.yaw, 0), p);
  await page.waitForTimeout(400);
  await strip();
  await page.evaluate(() => window.__NT.render());
  await page.waitForTimeout(120);
  await page.evaluate(() => window.__NT.render());
  const file = join(OUT, TAG + '-' + p.name + '.png');
  await page.screenshot({ path: file });
  const stats = await page.evaluate(() => window.__NT.stats());
  // luma of the frame, measured the same way playcap does it
  const luma = await page.evaluate(async () => {
    const c = document.querySelector('canvas');
    const b = document.createElement('canvas');
    b.width = 160; b.height = 90;
    const g = b.getContext('2d');
    g.drawImage(c, 0, 0, 160, 90);
    const d = g.getImageData(0, 0, 160, 90).data;
    let s = 0;
    const hist = new Array(16).fill(0);
    for (let i = 0; i < d.length; i += 4) {
      const L = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      s += L;
      hist[Math.min(15, Math.floor(L / 16))]++;
    }
    return { mean: s / (d.length / 4), hist };
  });
  results.push({ ...p, file, stats, luma });
  console.log('  ' + p.name.padEnd(16) + ' luma ' + luma.mean.toFixed(1).padStart(6)
    + '   calls ' + String(stats.calls).padStart(5) + '   fps ' + stats.fps);
}

writeFileSync(join(OUT, TAG + '-interior-metrics.json'),
  JSON.stringify({ when: new Date().toISOString(), url, viewport: '1600x900', results, consoleErrors }, null, 2));

await browser.close();
killTree(chrome.pid);
console.log('[critic-r1] done');
process.exit(0);
