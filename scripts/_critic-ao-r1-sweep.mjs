/**
 * ao-retune round 1 - motion sweep for S8.
 *
 * The still burst showed zero frame-to-frame delta, so any AO crawl can only
 * appear under camera motion. This teleports the camera through a short yaw +
 * dolly sweep at interiorOrange and turningHead and writes the frames, so the
 * per-frame occlusion pattern can be compared where the geometry is unchanged.
 *
 * Shared preview on :4188, one headless Chrome, windowsHide, monitor 2.
 */
import { chromium } from 'playwright';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures');
const TAG = 'g-ao-retune-r1-sw';
const D = Math.PI / 180;

const SWEEPS = {
  interiorOrange: { x: 0, y: 1.68, z: -18.5, yaw: Math.PI, pitch: 0, dz: 0.25, dyaw: 3 * D },
  turningHead:    { x: -14, y: 2.6, z: 1.0, yaw: -90 * D, pitch: -1 * D, dz: 0.0, dyaw: 3 * D },
};

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
  '--headless=new',
  '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-critic-ao-r1s-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
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
const strip = () => page.evaluate(() => {
  const el = document.getElementById('start'); if (el) el.remove();
  const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
  const ch = document.getElementById('crosshair'); if (ch) ch.style.display = 'none';
});

for (const mode of ['chain', 'ao']) {
  await page.goto(mode === 'ao' ? url + '?post=ao' : url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
  await strip();
  await page.waitForTimeout(1200);
  for (const [st, s] of Object.entries(SWEEPS)) {
    for (let i = 0; i < 5; i++) {
      await page.evaluate((a) => window.__NT.teleport(a.x, a.y, a.z, a.yaw, a.pitch),
        { x: s.x, y: s.y, z: s.z + s.dz * i, yaw: s.yaw + s.dyaw * i, pitch: s.pitch });
      await page.waitForTimeout(160);
      await strip();
      for (let k = 0; k < 3; k++) { await page.evaluate(() => window.__NT.render()); await page.waitForTimeout(70); }
      await page.screenshot({ path: join(OUT, `${TAG}-${mode}-${st}-${i}.png`) });
    }
    console.log(`[sweep] ${mode} ${st} 5 frames`);
  }
}

await browser.close();
killTree(chrome.pid);
console.log('[sweep] done');
