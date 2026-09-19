/**
 * ONE-OFF critic capture for the interiors gauntlet, round 0.
 *
 * Photographs four INTERIOR player positions through the game's OWN frame loop
 * (teleport + release, never goto/render), exactly the way scripts/playcap.mjs does,
 * so the critic is not judging the QA render path.
 *
 * Disposable. Not part of the harness. Do not import from it.
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures');
const TAG = 'g-interiors-r0';

const POSITIONS = [
  { name: 'orangeKitchen',   x: -3.5, y: 0,   z: -18.2, yaw: -Math.PI / 2 },
  { name: 'orangeLanding',   x:  3.0, y: 3.3, z: -22.5, yaw:  Math.PI / 2 },
  { name: 'whitePoolRoom',   x:  9.0, y: 0,   z:  20.0, yaw:  Math.PI },
  { name: 'whiteBedroom',    x: -3.0, y: 0,   z:  19.0, yaw:  0 },
  { name: 'whiteBedroomUp',  x: -3.0, y: 3.3, z:  19.0, yaw:  0 },
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
  return c.find((p) => existsSync(p)) ?? null;
}

const { url } = await usePreview();
const exe = chromePath();
if (!exe) { console.error('[critic] no real Chrome -> no WebGPU adapter; refusing to judge a fallback frame'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-critic-' + cdpPort),
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
if (!browser) { console.error('[critic] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }

const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 300)));

console.log('[critic] ' + url);
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
await page.waitForTimeout(1500);
await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });

mkdirSync(OUT, { recursive: true });
const results = [];
for (const p of POSITIONS) {
  await page.evaluate(([x, y, z, yaw]) => {
    window.__NT.teleport(x, y, z, yaw, 0);
    if (window.__NT.release) window.__NT.release();
  }, [p.x, p.y, p.z, p.yaw]);
  await page.waitForTimeout(900);

  const shot = await page.screenshot({ type: 'png' });
  const file = join(OUT, `${TAG}-${p.name}.png`);
  writeFileSync(file, shot);

  // luma histogram straight off the PNG, decoded by the page
  const m = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 400; c.height = 225;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 400, 225);
    const d = g.getImageData(0, 0, 400, 225).data;
    const L = [];
    for (let i = 0; i < d.length; i += 4) L.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
    L.sort((a, b) => a - b);
    const q = (f) => L[Math.min(L.length - 1, Math.floor(f * L.length))];
    const mean = L.reduce((a, b) => a + b, 0) / L.length;
    // saturation mean, to catch a colour cast
    let sat = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      if (mx > 0) { sat += (mx - mn) / mx; n++; }
    }
    return {
      mean: +mean.toFixed(1),
      p01: +q(0.01).toFixed(1), p05: +q(0.05).toFixed(1), p50: +q(0.5).toFixed(1),
      p95: +q(0.95).toFixed(1), p99: +q(0.99).toFixed(1),
      below20: +(L.filter((v) => v < 51).length / L.length * 100).toFixed(1),
      above90: +(L.filter((v) => v > 229).length / L.length * 100).toFixed(1),
      sat: +(sat / n).toFixed(3),
    };
  }, shot.toString('base64'));

  const stats = await page.evaluate(() => { try { return window.__NT.stats(); } catch { return {}; } });
  // Where did the player ACTUALLY settle? A y the floor does not support falls to ground
  // and the frame is then a different room than the one named. Identical readings from
  // two different y values is the tell.
  const settled = await page.evaluate(() => {
    try { return window.__NT.probePos().map((v) => +v.toFixed(2)); } catch (e) { return String(e); }
  });
  console.log('      settled camera: ' + JSON.stringify(settled));
  results.push({ ...p, ...m, settled, calls: stats.calls, tris: stats.triangles, file });
  console.log(`  ${p.name.padEnd(16)} mean ${String(m.mean).padStart(6)}  p05 ${String(m.p05).padStart(5)}  p50 ${String(m.p50).padStart(5)}  p95 ${String(m.p95).padStart(5)}  <20% ${String(m.below20).padStart(5)}%  >90% ${String(m.above90).padStart(4)}%  sat ${m.sat}  calls ${stats.calls}`);
}

await browser.close();
killTree(chrome.pid);
if (errors.length) console.log('[critic] console errors:\n  ' + errors.slice(0, 8).join('\n  '));
writeFileSync(join(OUT, `${TAG}-interior-metrics.json`), JSON.stringify({ url, results, errors }, null, 2));
console.log('[critic] wrote ' + results.length + ' interior frames');
