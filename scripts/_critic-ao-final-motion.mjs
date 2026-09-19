/**
 * Integration-critic temporal probe, ao-retune FINAL.
 *
 * S8 and "motion coherence" are the integration pass's business, and a wider AO
 * kernel is the classic source of dither crawl. Two measurements, both on the
 * GRADED state (radius 3.0, thickness 0.6):
 *   - a still burst with the camera locked: any per-pixel variance is the pass
 *     itself, not the scene;
 *   - a yaw+dolly sweep through an interior and an exterior, in chain and in
 *     `?post=ao`, so speckle can be seen in the term as well as in the frame.
 *
 * Nothing under scripts/lib/** or scripts/playcap.mjs is touched. Shared preview
 * on :4188. One headless Chrome, windowsHide, monitor 2.
 */
import { chromium } from 'playwright';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const PI = Math.PI;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures');
const TAG = 'g-ao-retune-final-mot';

// interior and exterior, dollied along the view axis with a small yaw drift
const SWEEPS = [
  { name: 'interiorOrange', x: 0, y: 1.68, z: -18.5, yaw: PI, dz: -0.45, dyaw: 0.030 },
  { name: 'turningHead', x: -14, y: 2.6, z: 1.0, yaw: -PI / 2, dz: 0.0, dx: 1.1, dyaw: 0.022 },
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
  '--user-data-dir=' + join(tmpdir(), 'aa-critic-ao-mot-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--window-position=2560,0', '--window-size=1600,900', 'about:blank',
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
  document.getElementById('start')?.remove();
  const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
  const ch = document.getElementById('crosshair'); if (ch) ch.style.display = 'none';
  return !document.getElementById('start');
});

const out = { when: new Date().toISOString(), url, sweeps: {} };
for (const mode of ['chain', 'ao']) {
  await page.goto(mode === 'ao' ? url + '?post=ao' : url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
  await strip();
  await page.waitForTimeout(1800);
  for (const s of SWEEPS) {
    // still burst first: camera locked, four frames
    await page.evaluate((q) => window.__NT.teleport(q.x, q.y, q.z, q.yaw, 0), s);
    await page.waitForTimeout(500);
    await strip();
    for (let i = 0; i < 4; i++) { await page.evaluate(() => window.__NT.render()); await page.waitForTimeout(110); }
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.__NT.render());
      await page.waitForTimeout(110);
      await page.screenshot({ path: join(OUT, `${TAG}-${mode}-${s.name}-still${i}.png`) });
    }
    // sweep
    for (let i = 0; i < 5; i++) {
      const q = {
        x: s.x + (s.dx ?? 0) * i, y: s.y, z: s.z + (s.dz ?? 0) * i, yaw: s.yaw + (s.dyaw ?? 0) * i,
      };
      await page.evaluate((p) => window.__NT.teleport(p.x, p.y, p.z, p.yaw, 0), q);
      await page.waitForTimeout(260);
      await strip();
      for (let k = 0; k < 4; k++) { await page.evaluate(() => window.__NT.render()); await page.waitForTimeout(90); }
      await page.screenshot({ path: join(OUT, `${TAG}-${mode}-${s.name}-sw${i}.png`) });
    }
    console.log('  ' + mode + ' ' + s.name + ' done');
  }
}
writeFileSync(join(OUT, TAG + '.json'), JSON.stringify(out, null, 2));
await browser.close();
killTree(chrome.pid);
console.log('[critic-motion] done');
process.exit(0);
