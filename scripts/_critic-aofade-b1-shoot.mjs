/**
 * ao-farfade ROUND 1 (builder's own instrumentation) — shoots the six stations the
 * round-4 guards are defined on, in `chain` and in `?post=ao`, at 1600x900, through
 * installed Chrome over CDP (chromium.launch() has no WebGPU adapter).
 *
 * Route logic is copied VERBATIM from `scripts/_critic-aotwo-r0.mjs` and
 * `scripts/_critic-aothick-final-wide.mjs` — the same settle, the same strip(), the
 * same `goto()` for stock stations and the same `teleport(9, 0, 20, PI)` +
 * `weaponCmd('visible', false)` for `whitePoolRoom` (not in the frozen stations.ts).
 * Only the station list is different, so that one Chrome launch covers every guard
 * rectangle and each probe costs one launch instead of two.
 *
 * Shared preview on :4188 (scripts/lib/preview.mjs, untouched). One headless Chrome,
 * windowsHide, off the owner's monitor. Nothing frozen is read or written.
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
const TAG = process.env.CRITIC_TAG || 'g-ao-farfade-b1';

const GOTO = ['interiorOrange', 'midStreet', 'spawnA', 'aerial', 'yardWhite'];
const FREE = [{ name: 'whitePoolRoom', x: 9.0, y: 0, z: 20.0, yaw: PI }];

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
if (!exe) { console.error('no installed Chrome - refusing the swiftshader path'); process.exit(1); }
const chrome = spawnGuarded(exe, [
  '--headless=new',
  '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-critic-aofade-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--window-position=2560,0', '--window-size=1600,900',
  'about:blank',
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

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });

const strip = () => page.evaluate(() => {
  document.getElementById('start')?.remove();
  const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
  const ch = document.getElementById('crosshair'); if (ch) ch.style.display = 'none';
  return !document.getElementById('start');
});

const out = { when: new Date().toISOString(), url, tag: TAG, viewport: '1600x900', passes: {} };
const backend = {};

for (const mode of ['chain', 'ao']) {
  const target = mode === 'ao' ? url + '?post=ao' : url;
  console.log('[aofade] ' + target);
  await page.goto(target, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
  await strip();
  await page.waitForTimeout(2000);
  backend[mode] = await page.evaluate(() => window.__NT_BACKEND ?? null);

  const rows = [];

  // free positions FIRST: they need cameraHeldByQA still false so the camera
  // follows the player. goto() latches it true for the rest of the pass.
  for (const p of FREE) {
    await page.evaluate((q) => {
      window.__NT.teleport(q.x, q.y, q.z, q.yaw, 0);
      window.__NT.weaponCmd('visible', false);
    }, p);
    await page.waitForTimeout(900);
    await strip();
    await page.evaluate(() => window.__NT.weaponCmd('visible', false));
    for (let i = 0; i < 6; i++) { await page.waitForTimeout(120); }
    const file = join(OUT, TAG + (mode === 'ao' ? '-ao-' : '-') + p.name + '.png');
    await page.screenshot({ path: file });
    const stats = await page.evaluate(() => ({
      ...window.__NT.stats(),
      gun: window.__NT.weaponCmd('visible'),
    }));
    rows.push({ name: p.name, route: 'teleport+weaponHidden', file, stats });
    console.log('  ' + mode.padEnd(5) + ' ' + p.name.padEnd(16)
      + ' calls ' + String(stats.calls).padStart(5)
      + ' fps ' + String(stats.fps).padStart(3) + ' gunVisible=' + stats.gun);
  }

  for (const name of GOTO) {
    const ok = await page.evaluate((n) => window.__NT.goto(n), name);
    if (!ok) { console.warn('  goto failed ' + name); continue; }
    await page.waitForTimeout(400);
    for (let i = 0; i < 5; i++) { await page.evaluate(() => window.__NT.render()); await page.waitForTimeout(110); }
    const file = join(OUT, TAG + (mode === 'ao' ? '-ao-' : '-') + name + '.png');
    await page.screenshot({ path: file });
    const stats = await page.evaluate(() => window.__NT.stats());
    rows.push({ name, route: 'goto', file, stats });
    console.log('  ' + mode.padEnd(5) + ' ' + name.padEnd(16)
      + ' calls ' + String(stats.calls).padStart(5)
      + ' fps ' + String(stats.fps).padStart(3));
  }
  out.passes[mode] = rows;
}

out.backend = backend;
out.consoleErrors = consoleErrors;
writeFileSync(join(OUT, TAG + '-critic.json'), JSON.stringify(out, null, 2));
await browser.close();
killTree(chrome.pid);
console.log('[aofade] done. console errors: ' + consoleErrors.length);
process.exit(0);
