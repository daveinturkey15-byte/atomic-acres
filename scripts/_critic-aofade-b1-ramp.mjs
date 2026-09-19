/**
 * ao-farfade ROUND 1 — CALIBRATION ONLY. One `?post=ao` frame of a build whose debug
 * output is `vec3(uv().x)`: a known linear 0..1 ramp across the screen, pushed through
 * the identical output pass (ACES + sRGB, exposure 1.09) as every other frame in this
 * project. Reading the ramp back gives the exact display <- linear curve, so the
 * scalar diagnostics (|n.v|, view depth) can be inverted instead of guessed at.
 *
 * Shared preview on :4188, one headless Chrome, windowsHide, monitor 2.
 */
import { chromium } from 'playwright';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { readPng, luma } from './_critic-png.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures');
const TAG = process.env.CRITIC_TAG || 'g-ao-farfade-ramp';

const freePort = () => new Promise((res, rej) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  s.on('error', rej);
});
const chromePath = () => [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean).find((p) => existsSync(p)) || null;

const { url } = await usePreview();
mkdirSync(OUT, { recursive: true });
const cdpPort = await freePort();
const exe = chromePath();
if (!exe) { console.error('no installed Chrome'); process.exit(1); }
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-critic-aofade-ramp-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--window-position=2560,0', '--window-size=1600,900', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

let browser = null;
for (let i = 0; i < 200 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!browser) { killTree(chrome.pid); console.error('no CDP'); process.exit(1); }
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
await page.goto(url + '?post=ao', { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
await page.evaluate(() => {
  document.getElementById('start')?.remove();
  const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
  const ch = document.getElementById('crosshair'); if (ch) ch.style.display = 'none';
});
await page.waitForTimeout(2000);
await page.evaluate(() => window.__NT.goto('aerial'));
await page.waitForTimeout(400);
for (let i = 0; i < 5; i++) { await page.evaluate(() => window.__NT.render()); await page.waitForTimeout(110); }
const file = join(OUT, TAG + '.png');
await page.screenshot({ path: file });
await browser.close();
killTree(chrome.pid);

// read the curve back: x/1600 is the exact linear value at column x
const img = readPng(file);
const table = [];
for (let i = 0; i <= 100; i++) {
  const x = Math.min(img.width - 1, Math.round(i / 100 * (img.width - 1)));
  let s = 0; for (let y = 400; y < 500; y++) s += luma(img, x, y);
  table.push({ linear: +((x + 0.5) / img.width).toFixed(4), display: +(s / 100).toFixed(2) });
}
writeFileSync(join(OUT, TAG + '.json'), JSON.stringify(table, null, 2));
console.log('linear -> display');
for (const r of table.filter((_, i) => i % 5 === 0)) console.log('  ' + r.linear.toFixed(3) + '  ' + r.display);
process.exit(0);
