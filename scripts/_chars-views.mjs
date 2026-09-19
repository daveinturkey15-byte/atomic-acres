/**
 * _chars-views - photograph a figure of each faction, four poses x four views,
 * IN THE GAME, through the game's own frame loop.
 *
 * docs/LICENCES-ANIMATION.md obligation 6: a clip is only accepted from the
 * game, from four camera views, never from a preview page that renders on its
 * own body at its own scale. So this drives the shipped bundle: real Chrome over
 * CDP, click #start, and then move the PLAYER (never __NT.goto(), which sets
 * cameraHeldByQA and takes the loop's camera away). The viewmodel is left ON -
 * hiding it drops lights and invalidates the program set (PASS 82), and a frame
 * with the gun in the corner is what a player actually sees.
 *
 * Figures 0 and 1 are the two main.ts spawns nothing else drives, and they are
 * faction 0 (helmet) and faction 1 (patrol cap) because dressProcedural assigns
 * factions round-robin in spawn order.
 *
 *   node scripts/_chars-views.mjs --tag chars
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures', 'chars');
const argv = process.argv.slice(2);
const opt = (n, d = '') => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const tag = opt('tag', 'chars');

// Open sunlit ground mid-map, clear of the houses. The figure faces +z.
const FX = -6.0, FZ = 0.0, FY = 0;
const EYE = 1.68;                       // syncCamera adds this to player.pos.y
const D = 2.35;                         // 72-deg vertical fov: fills ~60% of frame height
const OFF = 0.42;                       // shift the subject left of the viewmodel

/** Camera stations around the figure. y is the CAMERA height; pos.y = y - EYE. */
const VIEWS = [
  { name: 'front', x: FX + OFF, y: 1.12, z: FZ + D, yaw: 0, pitch: -0.07 },
  { name: 'side', x: FX + D, y: 1.12, z: FZ - OFF, yaw: Math.PI / 2, pitch: -0.07 },
  {
    name: 'threequarter',
    x: FX + D * 0.72 + OFF * 0.71, y: 1.20, z: FZ + D * 0.72 - OFF * 0.71,
    yaw: Math.PI / 4, pitch: -0.09,
  },
  { name: 'low', x: FX + OFF, y: 0.40, z: FZ + D * 1.15, yaw: 0, pitch: 0.20 },
];

const POSES = [
  { name: 'idle', speed: 0, aim: 0 },
  { name: 'walk', speed: 1.4, aim: 0 },
  { name: 'run', speed: 3.5, aim: 0 },
  { name: 'aim-rifle', speed: 0, aim: 1 },
];

const FACTIONS = [{ i: 0, name: 'a-helmet' }, { i: 1, name: 'b-cap' }];

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

const bundleBefore = statSync(join(ROOT, 'dist', 'index.html')).mtimeMs;
const { url } = await usePreview();
const exe = chromePath();
if (!exe) { console.error('[views] no Chrome'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-views-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--window-position=2560,0', '--window-size=900,1000', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

let browser = null;
for (let i = 0; i < 160 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!browser) { console.error('[views] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }

const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 820, height: 940 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 240)));

console.log('[views] ' + url);
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
await page.waitForTimeout(1600);
await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });
// noclip: no gravity, no floor clamp, no collision - the camera goes where it is
// put and stays. The loop still drives everything else.
await page.evaluate(() => { window.__NT.setMode('noclip'); if (window.__NT.release) window.__NT.release(); });

mkdirSync(OUT, { recursive: true });
const meshStats = await page.evaluate(() => (window.__NTMESH ? window.__NTMESH.stats() : null));
console.log('[views] mesh: ' + JSON.stringify(meshStats));

const shots = [];
for (const f of FACTIONS) {
  await page.evaluate(([i, x, z, yaw]) => {
    window.__NTANIM.solo(i);
    window.__NTANIM.place(i, x, z, yaw);
    window.__NTANIM.pin(i, x, z, yaw);
  }, [f.i, FX, FZ, FY]);
  for (const pose of POSES) {
    await page.evaluate(([i, speed, aim]) => {
      window.__NTANIM.drive(i, speed, false);
      window.__NTANIM.aim(i, aim, 0);
    }, [f.i, pose.speed, pose.aim]);
    await page.waitForTimeout(1100);      // crossfade settles, gait reaches phase
    for (const v of VIEWS) {
      await page.evaluate(([x, y, z, yaw, pitch, eye]) => {
        window.__NT.teleport(x, y - eye, z, yaw, pitch);
      }, [v.x, v.y, v.z, v.yaw, v.pitch, EYE]);
      await page.waitForTimeout(420);
      const file = join(OUT, `${tag}-${f.name}-${pose.name}-${v.name}.png`);
      writeFileSync(file, await page.screenshot({ type: 'png' }));
      shots.push(file);
      console.log('  ' + file);
    }
  }
  await page.evaluate(() => { window.__NTANIM.unpin(); window.__NTANIM.showAll(); });
}

await page.evaluate(() => { window.__NTANIM.showAll(); });

const bundleAfter = statSync(join(ROOT, 'dist', 'index.html')).mtimeMs;
if (errors.length) console.log('[views] console errors:\n  ' + errors.slice(0, 8).join('\n  '));
if (bundleBefore !== bundleAfter) console.log('[views] WARNING dist changed during the run');
writeFileSync(join(OUT, `${tag}-views.json`), JSON.stringify({
  url, tag, figure: { x: FX, z: FZ, yaw: FY }, views: VIEWS, poses: POSES,
  meshStats, shots, errors,
  bundleChangedDuringRun: bundleBefore !== bundleAfter,
}, null, 2));

await browser.close();
killTree(chrome.pid);
