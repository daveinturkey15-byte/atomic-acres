/**
 * _chars-close - close-up frames of one figure, for reading detail the four
 * standard views are too far away to settle. Same route as _chars-views.mjs:
 * real Chrome over CDP, click #start, move the PLAYER, never __NT.goto().
 *
 *   node scripts/_chars-close.mjs --tag close --pose idle --figure 0
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
const OUT = join(ROOT, 'captures', 'chars');
const argv = process.argv.slice(2);
const opt = (n, d = '') => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const tag = opt('tag', 'close');
const figure = Number(opt('figure', '0'));
const pose = opt('pose', 'idle');
const SPEED = { idle: 0, walk: 1.4, run: 3.5, aim: 0, crouch: 0, 'crouch-walk': 0.8 }[pose] ?? 0;
const AIM = pose === 'aim' ? 1 : 0;
const CROUCH = pose.startsWith('crouch');

const FX = -6.0, FZ = 0.0;
const EYE = 1.68;

// Head at ~1.73 m, hands at ~0.86 m in rest. Close enough to read a 2 cm part.
const SHOTS = (process.argv.includes('--whole')) ? [
  { name: 'whole-34', x: FX + 1.70, y: 1.15, z: FZ + 1.70, yaw: Math.PI / 4, pitch: -0.08 },
  { name: 'whole-side', x: FX + 2.35, y: 1.12, z: FZ - 0.42, yaw: Math.PI / 2, pitch: -0.07 },
] : [
  { name: 'head', x: FX + 0.02, y: 1.70, z: FZ + 0.72, yaw: 0, pitch: -0.02 },
  { name: 'head-34', x: FX + 0.52, y: 1.72, z: FZ + 0.56, yaw: Math.PI * 0.26, pitch: -0.03 },
  { name: 'torso', x: FX + 0.05, y: 1.32, z: FZ + 1.25, yaw: 0, pitch: -0.04 },
  { name: 'hands', x: FX + 0.75, y: 1.02, z: FZ + 0.95, yaw: Math.PI * 0.22, pitch: -0.10 },
  { name: 'hands-side', x: FX + 1.25, y: 1.00, z: FZ + 0.10, yaw: Math.PI / 2, pitch: -0.05 },
  { name: 'legs', x: FX + 0.05, y: 0.62, z: FZ + 1.45, yaw: 0, pitch: -0.05 },
];

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
function chromePath() {
  return [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean).find((p) => existsSync(p)) ?? null;
}

const { url } = await usePreview();
const exe = chromePath();
if (!exe) { console.error('[close] no Chrome'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-close-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--window-position=2560,0', '--window-size=900,900', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

let browser = null;
for (let i = 0; i < 160 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!browser) { console.error('[close] no CDP'); killTree(chrome.pid); process.exit(2); }
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 760, height: 760 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));

await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
await page.waitForTimeout(1600);
await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });
await page.evaluate(() => { window.__NT.setMode('noclip'); if (window.__NT.release) window.__NT.release(); });

console.log('[close] mesh: ' + JSON.stringify(await page.evaluate(() => window.__NTMESH.stats())));
await page.evaluate(([i, x, z, speed, aim, crouch]) => {
  window.__NTANIM.solo(i);
  window.__NTANIM.place(i, x, z, 0);
  window.__NTANIM.pin(i, x, z, 0);
  window.__NTANIM.drive(i, speed, crouch);
  window.__NTANIM.aim(i, aim, 0);
}, [figure, FX, FZ, SPEED, AIM, CROUCH]);
await page.waitForTimeout(1200);

mkdirSync(OUT, { recursive: true });
for (const s of SHOTS) {
  await page.evaluate(([x, y, z, yaw, pitch, eye]) => {
    window.__NT.teleport(x, y - eye, z, yaw, pitch);
  }, [s.x, s.y, s.z, s.yaw, s.pitch, EYE]);
  await page.waitForTimeout(380);
  const f = join(OUT, `${tag}-f${figure}-${pose}-${s.name}.png`);
  writeFileSync(f, await page.screenshot({ type: 'png' }));
  console.log('  ' + f);
}
if (errors.length) console.log('[close] console errors:\n  ' + errors.slice(0, 6).join('\n  '));
await browser.close();
killTree(chrome.pid);
