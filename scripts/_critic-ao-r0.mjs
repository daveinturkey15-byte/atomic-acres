/**
 * One-off critic harness for the ao-retune gauntlet, round 0.
 *
 * Captures the three named stations twice through the SAME browser session:
 * once through the normal post chain (to read real draw calls - the stock
 * capture.mjs reports 0 at every station, a readback-timing artifact) and once
 * through `?post=ao` so the occlusion term itself can be measured.
 *
 * Nothing under scripts/lib/** or scripts/playcap.mjs is touched. Uses the
 * shared preview server on :4188.
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
const TAG = 'g-ao-retune-r0';
const STATIONS = ['interiorOrange', 'turningHead', 'spawnA'];

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
  '--user-data-dir=' + join(tmpdir(), 'aa-critic-ao-' + cdpPort),
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

const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 300)));

const strip = () => page.evaluate(() => {
  const el = document.getElementById('start'); if (el) el.remove();
  const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
  const ch = document.getElementById('crosshair'); if (ch) ch.style.display = 'none';
  return !document.getElementById('start');
});

const out = { when: new Date().toISOString(), url, viewport: '1600x900', passes: {} };

for (const mode of ['chain', 'ao']) {
  const target = mode === 'ao' ? url + '?post=ao' : url;
  console.log('[critic-ao] loading ' + target);
  await page.goto(target, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
  await strip();
  await page.waitForTimeout(1500);
  const rows = [];
  for (const name of STATIONS) {
    const ok = await page.evaluate((n) => window.__NT.goto(n), name);
    if (!ok) { console.warn('goto failed ' + name); continue; }
    await page.waitForTimeout(320);
    await strip();
    // render several frames, then read stats - one render leaves the info
    // counters at zero on this stack, which is the harness's `calls: 0` bug
    for (let i = 0; i < 4; i++) { await page.evaluate(() => window.__NT.render()); await page.waitForTimeout(90); }
    const file = join(OUT, TAG + (mode === 'ao' ? '-ao-' : '-x-') + name + '.png');
    await page.screenshot({ path: file });
    const stats = await page.evaluate(() => window.__NT.stats());
    rows.push({ station: name, file, stats });
    console.log('  ' + mode + ' ' + name.padEnd(16) + JSON.stringify(stats));
  }
  out.passes[mode] = rows;
}

out.consoleErrors = consoleErrors;
out.pageErrors = pageErrors;
writeFileSync(join(OUT, TAG + '-critic.json'), JSON.stringify(out, null, 2));
await browser.close();
killTree(chrome.pid);
console.log('[critic-ao] done');
