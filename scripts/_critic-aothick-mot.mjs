/**
 * ao-thickness round 0 — S8 temporal-stability probe.
 * Two consecutive STILL frames (same camera) and one frame after a small camera
 * move, at two stations, in chain and in ?post=ao. AO speckle / dither crawl
 * shows as a non-zero still-to-still delta.
 *
 * whitePoolRoom is reached by teleport + weaponCmd('visible', false); the two
 * stock stations by goto(). A small yaw swing is produced by teleporting the
 * player, so the swing frames are free-camera frames in both cases.
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

const PI = Math.PI;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures');
const TAG = process.env.CRITIC_TAG || 'g-ao-thickness-r0';

const SPOTS = [
  { name: 'interiorOrange', x: 0, y: 0, z: -18.5, yaw: PI },
  { name: 'turningHead', x: -14, y: 0, z: 1.0, yaw: -PI / 2 },
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
if (!exe) { console.error('no installed Chrome'); process.exit(1); }
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-critic-aothick-mot-' + cdpPort),
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
const strip = () => page.evaluate(() => {
  document.getElementById('start')?.remove();
  const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
  const ch = document.getElementById('crosshair'); if (ch) ch.style.display = 'none';
});

const files = [];
for (const mode of ['chain', 'ao']) {
  await page.goto(mode === 'ao' ? url + '?post=ao' : url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
  await strip();
  await page.waitForTimeout(2000);
  for (const s of SPOTS) {
    for (const [suffix, dyaw] of [['still0', 0], ['still1', 0], ['sw0', 0.10]]) {
      await page.evaluate((q) => {
        window.__NT.teleport(q.x, q.y, q.z, q.yaw + q.d, 0);
        window.__NT.weaponCmd('visible', false);
      }, { ...s, d: dyaw });
      await page.waitForTimeout(700);
      await strip();
      await page.evaluate(() => window.__NT.weaponCmd('visible', false));
      await page.waitForTimeout(300);
      const f = join(OUT, TAG + '-mot-' + (mode === 'ao' ? 'ao-' : 'chain-') + s.name + '-' + suffix + '.png');
      await page.screenshot({ path: f });
      files.push(f);
    }
  }
}
await browser.close();
killTree(chrome.pid);

// --- diff
function diff(a, b) {
  const A = readPng(a), B = readPng(b);
  let sum = 0, n = 0, max = 0, over2 = 0;
  for (let y = 0; y < A.height; y += 2) for (let x = 0; x < A.width; x += 2) {
    const d = Math.abs(luma(A, x, y) - luma(B, x, y));
    sum += d; n++; if (d > max) max = d; if (d > 2) over2++;
  }
  return { meanAbs: +(sum / n).toFixed(3), max: +max.toFixed(1), pctOver2: +(100 * over2 / n).toFixed(3) };
}
const res = {};
for (const mode of ['chain', 'ao']) for (const s of SPOTS) {
  const b = join(OUT, TAG + '-mot-' + mode + '-' + s.name + '-');
  res[mode + '/' + s.name] = {
    'still0 vs still1': diff(b + 'still0.png', b + 'still1.png'),
    'still0 vs swing': diff(b + 'still0.png', b + 'sw0.png'),
  };
}
writeFileSync(join(OUT, TAG + '-mot.json'), JSON.stringify(res, null, 2));
for (const [k, v] of Object.entries(res)) {
  console.log(k.padEnd(26) + ' still-to-still meanAbs ' + String(v['still0 vs still1'].meanAbs).padStart(7)
    + ' max ' + String(v['still0 vs still1'].max).padStart(6)
    + ' %>2 ' + String(v['still0 vs still1'].pctOver2).padStart(7)
    + '   |  swing meanAbs ' + String(v['still0 vs swing'].meanAbs).padStart(7));
}
process.exit(0);
