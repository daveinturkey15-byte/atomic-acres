/**
 * ao-thickness gauntlet, ROUND 0 (baseline) — fresh critic's OWN captures.
 *
 * Shoots the four stations the brief names, in `chain` and in `?post=ao`, at
 * 1600x900, through installed Chrome over CDP (WebGPU adapter present).
 *
 * `whitePoolRoom` is not in stations.ts (which I must not edit), so it is reached
 * with the public QA surface: `__NT.teleport(9, 0, 20, PI)` followed by
 * `__NT.weaponCmd('visible', false)`. That second call is the SAME thing
 * `__NT.goto()` does on every stock capture — it clears the viewmodel overlay, which
 * composites AFTER the post chain and otherwise covers ~6 % of the frame near-black
 * and poisons any percentile taken from it. It does not add, remove or hide a light
 * in the world scene, so PASS 82 / blocker B2 is not in play.
 *
 * Shared preview on :4188 (scripts/lib/preview.mjs, untouched). One headless Chrome,
 * windowsHide, off the owner's monitor.
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
const TAG = process.env.CRITIC_TAG || 'g-ao-thickness-r0';

const GOTO = ['interiorOrange', 'turningHead', 'spawnA'];
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
  '--user-data-dir=' + join(tmpdir(), 'aa-critic-aothick-' + cdpPort),
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
  console.log('[aothick-r0] ' + target);
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
      + ' tris ' + String(stats.triangles).padStart(8)
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
      + ' tris ' + String(stats.triangles).padStart(8)
      + ' fps ' + String(stats.fps).padStart(3));
  }
  out.passes[mode] = rows;
}

out.backend = backend;
out.consoleErrors = consoleErrors;
writeFileSync(join(OUT, TAG + '-critic.json'), JSON.stringify(out, null, 2));
await browser.close();
killTree(chrome.pid);
console.log('[aothick-r0] done. console errors: ' + consoleErrors.length);
process.exit(0);
