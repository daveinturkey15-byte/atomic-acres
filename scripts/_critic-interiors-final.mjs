/**
 * INTEGRATION CRITIC one-off (interiors gauntlet, final pass).
 *
 * Same harness shape as capture.mjs - real Chrome over CDP so WebGPU and the whole
 * post chain are genuinely on - but drives window.__NT.teleport to positions the
 * stock station list does not cover.
 *
 * Four interior positions named in the brief, plus two INTEGRATION positions that
 * straddle the boundary the interiors work could have broken: the orange front
 * facade seen from the street (does the room now read as a dark hole from outside?)
 * and the garage mouth (does the new interior material clash with the shell?).
 *
 * NOTE on measurement. The round-1 script measured luma by drawImage()ing the live
 * canvas into a 2D context and got byte-identical means on a colour run and an
 * ?post=ao run - it was reading a stale/cleared drawing buffer and measured nothing.
 * This script does NOT do that. It only screenshots; every number is computed from
 * the written PNG afterwards.
 *
 * Throwaway. Not part of the harness. NT_AO=1 for the ?post=ao diagnostic run.
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
const TAG = process.env.NT_AO ? 'g-interiors-final-ao' : 'g-interiors-final';
const PI = Math.PI;

const POSITIONS = [
  { name: 'orangeKitchen', x: -3.5, y: 0, z: -18.2, yaw: -PI / 2, note: 'orange kitchen looking at the garage door' },
  { name: 'orangeLanding', x: 3.0, y: 3.3, z: -22.5, yaw: PI / 2, note: 'orange upper landing looking down the two-storey void' },
  { name: 'whitePoolRoom', x: 9.0, y: 0, z: 20.0, yaw: PI, note: 'white house wading-pool room' },
  { name: 'whiteBedroom', x: -3.0, y: 0, z: 19.0, yaw: 0, note: 'white house upper bedroom position' },
  // --- integration positions: the interior/exterior seam, from the OUTSIDE
  { name: 'orangeFacade', x: 0, y: 0, z: -12.5, yaw: 0, note: 'street side, looking into the orange front door' },
  { name: 'whiteFacade', x: 0, y: 0, z: 12.5, yaw: PI, note: 'street side, looking into the white house front' },
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
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR ' + String(e).slice(0, 300)));

await page.goto(url + (process.env.NT_AO ? '?post=ao' : ''), { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });

const adapter = await page.evaluate(() => ({
  gpu: typeof navigator.gpu !== 'undefined',
  post: window.__NT.postInfo ? window.__NT.postInfo() : null,
}));

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
  await page.waitForTimeout(500);
  await strip();
  await page.evaluate(() => window.__NT.render());
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__NT.render());
  await page.waitForTimeout(150);
  const stats = await page.evaluate(() => window.__NT.stats());
  const file = join(OUT, TAG + '-' + p.name + '.png');
  await page.screenshot({ path: file });
  results.push({ ...p, file, stats });
  console.log('  ' + p.name.padEnd(16)
    + ' calls ' + String(stats.calls).padStart(5)
    + '  fps ' + String(stats.fps).padStart(3)
    + '  tris ' + String(stats.triangles).padStart(8));
}

writeFileSync(join(OUT, TAG + '-interior-metrics.json'),
  JSON.stringify({ when: new Date().toISOString(), url, viewport: '1600x900', adapter, results, consoleErrors }, null, 2));

await browser.close();
killTree(chrome.pid);
console.log('[critic-final] done. console errors: ' + consoleErrors.length);
process.exit(0);
