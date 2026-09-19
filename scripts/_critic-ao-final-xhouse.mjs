/**
 * Integration-critic cross-house probe, ao-retune FINAL.
 *
 * The ten stock stations contain exactly one interior (interiorOrange) and it is
 * in the orange house. The interiors gauntlet's integration record found the two
 * houses obeying DIFFERENT lighting laws (ceiling/wall 0.30 orange vs 0.98 white),
 * and an occlusion retune is the one lever that reaches both. So this re-shoots the
 * SAME six teleports that record used, at the same coordinates, in chain and in
 * `?post=ao` - giving a matched before/after against
 * captures/gauntlet/interiors/final/ (which was shot at radius 0.9, AO_DEEP 0.35).
 *
 * Nothing under scripts/lib/** or scripts/playcap.mjs is touched. Shared preview on
 * :4188. One headless Chrome, windowsHide, monitor 2.
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
const TAG = 'g-ao-retune-final';

const POSITIONS = [
  { name: 'orangeKitchen', x: -3.5, y: 0, z: -18.2, yaw: -PI / 2 },
  { name: 'orangeLanding', x: 3.0, y: 3.3, z: -22.5, yaw: PI / 2 },
  { name: 'whitePoolRoom', x: 9.0, y: 0, z: 20.0, yaw: PI },
  { name: 'whiteBedroom', x: -3.0, y: 0, z: 19.0, yaw: 0 },
  { name: 'orangeFacade', x: 0, y: 0, z: -12.5, yaw: 0 },
  { name: 'whiteFacade', x: 0, y: 0, z: 12.5, yaw: PI },
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
if (!exe) { console.error('no installed Chrome - refusing the swiftshader path'); process.exit(1); }
const chrome = spawnGuarded(exe, [
  '--headless=new',
  '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-critic-ao-xh-' + cdpPort),
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
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300)); });

const strip = () => page.evaluate(() => {
  document.getElementById('start')?.remove();
  const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
  const ch = document.getElementById('crosshair'); if (ch) ch.style.display = 'none';
  return !document.getElementById('start');
});

const out = { when: new Date().toISOString(), url, viewport: '1600x900', passes: {} };

for (const mode of ['chain', 'ao']) {
  const target = mode === 'ao' ? url + '?post=ao' : url;
  console.log('[critic-xhouse] ' + target);
  await page.goto(target, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
  await strip();
  await page.waitForTimeout(1800);
  const rows = [];
  for (const p of POSITIONS) {
    await page.evaluate((q) => window.__NT.teleport(q.x, q.y, q.z, q.yaw, 0), p);
    await page.waitForTimeout(500);
    await strip();
    // the first frame after a teleport is a settling frame, not a render state
    for (let i = 0; i < 5; i++) { await page.evaluate(() => window.__NT.render()); await page.waitForTimeout(100); }
    const file = join(OUT, TAG + (mode === 'ao' ? '-ao-' : '-') + p.name + '.png');
    await page.screenshot({ path: file });
    const stats = await page.evaluate(() => window.__NT.stats());
    rows.push({ ...p, file, stats });
    console.log('  ' + mode.padEnd(6) + p.name.padEnd(16) + ' calls ' + String(stats.calls).padStart(5)
      + ' fps ' + String(stats.fps).padStart(3) + ' tris ' + String(stats.triangles).padStart(8));
  }
  out.passes[mode] = rows;
}

out.consoleErrors = consoleErrors;
writeFileSync(join(OUT, TAG + '-xhouse.json'), JSON.stringify(out, null, 2));
await browser.close();
killTree(chrome.pid);
console.log('[critic-xhouse] done. console errors: ' + consoleErrors.length);
process.exit(0);
