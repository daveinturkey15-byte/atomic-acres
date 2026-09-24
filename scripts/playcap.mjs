/**
 * PLAYCAP - photograph what the PLAYER sees, not what the QA path renders.
 *
 * Why this exists: on 2026-09-18 a build shipped with a black world. Ten captures were
 * green and traverse was clean, because `capture.mjs` drives `__NT.render()` (the QA
 * path) while the game drives its own requestAnimationFrame loop - and the two took
 * different render routes. The harness tested a path the player does not take.
 *
 * This one does what a player does: load the page, click to play, and let the game's
 * OWN frame loop draw. It then screenshots the canvas while that loop is running, at
 * several player positions, and FAILS if any frame is dark - the exact signature of a
 * dead render path. It never calls __NT.render() and never sets cameraHeldByQA.
 *
 * This is the gate for any change to src/core/world.ts, src/core/post.ts or the render
 * block of src/main.ts. Treat its threshold as frozen: lowering it to get green is the
 * mistake this file exists to prevent.
 *
 *   node scripts/playcap.mjs                 # default positions, writes captures/play-*.png
 *   node scripts/playcap.mjs --tag chain --query "post=chain"
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';
import { startSolo } from './lib/start-solo.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures');

const argv = process.argv.slice(2);
const opt = (name, dflt = '') => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const tag = opt('tag', 'play');
const query = opt('query', '');
/** Mean 8-bit luma below this is "the world did not draw". A lit exterior sits 90-140;
 *  the black-screen bug measured 1.4 with the viewmodel off and ~14 with it on. */
const DARK_THRESHOLD = 40;

// Eye-height player positions that see the map: spawn A looking at its house, the
// circle looking east, spawn B, and inside the orange house looking out the door.
const POSITIONS = [
  { name: 'spawnA', x: -4.0, z: -34.3, yaw: Math.PI },
  { name: 'circle', x: -6.0, z: 0.0, yaw: -Math.PI / 2 },
  { name: 'spawnB', x: 1.2, z: 34.3, yaw: 0 },
  { name: 'orangeInside', x: 0.8, z: -20.5, yaw: Math.PI },
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

const { url: base } = await usePreview();
const url = base + (query ? '?' + query : '');

// Real Chrome over CDP: playwright's chromium has no WebGPU adapter.
const exe = chromePath();
if (!exe) { console.error('[playcap] no Chrome found; this harness needs a real WebGPU adapter'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-playcap-' + cdpPort),
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
if (!browser) { console.error('[playcap] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }

const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 300)));

console.log('[playcap] ' + url);
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });

// Click to play exactly as a person would - the listener lives on the overlay.
await startSolo(page);
await page.waitForTimeout(1500);

// Hide the DOM HUD so we measure the CANVAS, then let the loop run.
await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });

mkdirSync(OUT, { recursive: true });
const results = [];
for (const p of POSITIONS) {
  // Move the PLAYER (so the game's own loop renders from here). __NT.teleport moves the
  // controller without holding the camera; release() puts the loop back in charge in
  // case an earlier QA call had claimed it. Never goto(), never probeReset(): both set
  // cameraHeldByQA, which is the QA path this harness exists to avoid.
  await page.evaluate(([x, z, yaw]) => {
    window.__NT.teleport(x, 0, z, yaw, 0);
    if (window.__NT.release) window.__NT.release();
  }, [p.x, p.z, p.yaw]);
  await page.waitForTimeout(900);   // several real frames at 60 Hz

  // Whole-page shot: the HUD is hidden by CSS above, so this IS the game canvas. A
  // `canvas` locator is wrong here - the minimap owns a hidden canvas too, and
  // playwright's `.first()` lands on it and times out on "element is not visible".
  const shot = await page.screenshot({ type: 'png' });
  const file = join(OUT, `${tag}-${p.name}.png`);
  writeFileSync(file, shot);

  // mean luma straight off the PNG, no image library: decode via the page itself
  const luma = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 200; c.height = 112;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 200, 112);
    const d = g.getImageData(0, 0, 200, 112).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4);
  }, shot.toString('base64'));

  const stats = await page.evaluate(() => { try { return window.__NT.stats(); } catch { return {}; } });
  const ok = luma >= DARK_THRESHOLD;
  results.push({ name: p.name, luma: +luma.toFixed(1), ok, calls: stats.calls, tris: stats.triangles });
  console.log(`  ${ok ? 'OK  ' : 'DARK'}  ${p.name.padEnd(13)} luma ${luma.toFixed(1).padStart(6)}   drawCalls ${stats.calls ?? '?'}   -> ${file}`);
}

await browser.close();
killTree(chrome.pid);

const dark = results.filter((r) => !r.ok);
if (errors.length) console.log('[playcap] console errors:\n  ' + errors.slice(0, 8).join('\n  '));
console.log(`[playcap] ${results.length - dark.length}/${results.length} positions lit through the REAL game loop`);
writeFileSync(join(OUT, `${tag}-summary.json`), JSON.stringify({ url, threshold: DARK_THRESHOLD, results, errors }, null, 2));
process.exit(dark.length ? 1 : 0);
