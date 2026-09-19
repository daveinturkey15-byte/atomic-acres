/**
 * ao-thickness INTEGRATION critic — the seven stock stations the subsystem gauntlet
 * never photographed, in `?post=ao`, so the whole-scene coherence question ("does the
 * corrected subsystem clash with its neighbours?") is asked of the occlusion term at
 * every station, not only at the four the subsystem brief named.
 *
 * chain frames for these seven come from `npm run capture -- --tag
 * g-ao-thickness-final-cap`, which already reports real per-frame draw calls. This
 * pass adds only the diagnostic view, through `__NT.goto()` (never `teleport()` — the
 * viewmodel composites after the post chain and poisons every percentile).
 *
 * Shared preview on :4188 (scripts/lib/preview.mjs, untouched). One headless Chrome,
 * windowsHide, monitor 2. Nothing frozen is read or written.
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
const TAG = process.env.CRITIC_TAG || 'g-ao-thickness-final';
const STATIONS = ['aerial', 'yardOrange', 'yardWhite', 'streetElevation', 'plaza', 'spawnB', 'midStreet'];

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
  '--user-data-dir=' + join(tmpdir(), 'aa-critic-aothick-wide-' + cdpPort),
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

const out = { when: new Date().toISOString(), url, tag: TAG, viewport: '1600x900', rows: [] };

const target = url + '?post=ao';
console.log('[aothick-wide] ' + target);
await page.goto(target, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
await strip();
await page.waitForTimeout(2000);
out.backend = await page.evaluate(() => window.__NT_BACKEND ?? null);

for (const name of STATIONS) {
  const ok = await page.evaluate((n) => window.__NT.goto(n), name);
  if (!ok) { console.warn('  goto failed ' + name); continue; }
  await page.waitForTimeout(400);
  for (let i = 0; i < 5; i++) { await page.evaluate(() => window.__NT.render()); await page.waitForTimeout(110); }
  const file = join(OUT, TAG + '-ao-' + name + '.png');
  await page.screenshot({ path: file });
  const stats = await page.evaluate(() => window.__NT.stats());
  out.rows.push({ name, route: 'goto', file, stats });
  console.log('  ao   ' + name.padEnd(16) + ' fps ' + String(stats.fps).padStart(3));
}

out.consoleErrors = consoleErrors;
writeFileSync(join(OUT, TAG + '-wide.json'), JSON.stringify(out, null, 2));
await browser.close();
killTree(chrome.pid);
console.log('[aothick-wide] done. console errors: ' + consoleErrors.length);
process.exit(0);
