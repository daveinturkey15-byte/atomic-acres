/**
 * ao-retune round 1 - temporal stability probe (S8).
 *
 * Round 0's critic flagged that raising the GTAO radius is exactly the change
 * that can reintroduce speckle / dither crawl, and asked round 1 to capture a
 * MOVING sequence rather than stills. This does that: at two stations it takes
 * a burst of frames with the camera held still (pure temporal noise), then a
 * short yaw sweep (crawl under motion). Frames are written for eyeballing and
 * the deltas are measured offline with PIL.
 *
 * Shared preview on :4188, one headless Chrome, windowsHide, monitor 2.
 * Touches nothing under scripts/lib/**.
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
const TAG = 'g-ao-retune-r1-mot';

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
  '--user-data-dir=' + join(tmpdir(), 'aa-critic-ao-r1m-' + cdpPort),
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

await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
await strip();
await page.waitForTimeout(1500);

const api = await page.evaluate(() => Object.keys(window.__NT));
console.log('[motion] __NT keys: ' + api.join(','));

for (const st of ['interiorOrange', 'turningHead']) {
  await page.evaluate((n) => window.__NT.goto(n), st);
  await page.waitForTimeout(400);
  await strip();
  // still burst: same camera, consecutive frames
  for (let i = 0; i < 4; i++) {
    for (let k = 0; k < 2; k++) { await page.evaluate(() => window.__NT.render()); await page.waitForTimeout(70); }
    await page.screenshot({ path: join(OUT, `${TAG}-${st}-still${i}.png`) });
  }
  // yaw sweep: nudge the camera a little between frames
  const yawed = await page.evaluate(() => typeof window.__NT.nudge === 'function' || typeof window.__NT.setYaw === 'function');
  for (let i = 0; i < 4; i++) {
    await page.evaluate((d) => {
      const NT = window.__NT;
      if (typeof NT.setYaw === 'function' && typeof NT.getYaw === 'function') NT.setYaw(NT.getYaw() + d);
      else if (NT.camera) { NT.camera.rotation.y += d; }
    }, 0.035);
    for (let k = 0; k < 2; k++) { await page.evaluate(() => window.__NT.render()); await page.waitForTimeout(70); }
    await page.screenshot({ path: join(OUT, `${TAG}-${st}-yaw${i}.png`) });
  }
  console.log(`[motion] ${st} done (yaw api available: ${yawed})`);
}

await browser.close();
killTree(chrome.pid);
console.log('[motion] done');
