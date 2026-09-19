/**
 * _chars-compare - the two shots that answer the owner's actual complaint.
 *
 *  1. spawnA from the real game with the bots running and nothing posed.
 *  2. a set-dressing mannequin and an operator in the SAME frame, both inside
 *     20 m of the camera - the "can a stranger tell a bot from a shop dummy?"
 *     test. The mannequin is found from the collider list by owner, not from a
 *     hard-coded coordinate, so it stays right when dressing.ts moves them.
 *
 * Same route as playcap: real Chrome over CDP, click #start, move the PLAYER.
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
const tag = opt('tag', 'cmp');
const EYE = 1.68;

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
if (!exe) { console.error('[cmp] no Chrome'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-cmp-' + cdpPort),
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
if (!browser) { console.error('[cmp] no CDP'); killTree(chrome.pid); process.exit(2); }
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1400, height: 900 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));

await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
await page.waitForTimeout(1800);
await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });
mkdirSync(OUT, { recursive: true });

// ---- 1. spawnA, real game, bots running, nothing posed.
await page.evaluate(() => {
  window.__NT.teleport(-4.0, 0, -34.3, Math.PI, 0);
  if (window.__NT.release) window.__NT.release();
});
await page.waitForTimeout(2500);        // let the bots actually move off spawn
const gameShot = join(OUT, `${tag}-spawnA-live.png`);
writeFileSync(gameShot, await page.screenshot({ type: 'png' }));
const liveStats = await page.evaluate(() => ({
  stats: window.__NT.stats(),
  figures: window.__NTANIM.list(),
}));
console.log('[cmp] spawnA live: calls ' + liveStats.stats.calls + '  figures ' + liveStats.figures.length);

// ---- 2. find a set-dressing mannequin by collider OWNER, then stand an
//         operator beside it. Never a hard-coded coordinate.
const dummies = await page.evaluate(() => {
  const seen = new Map();
  for (let x = -18; x <= 18; x += 0.75) {
    for (let z = -36; z <= 36; z += 0.75) {
      for (const h of window.__NT.collidersAt(x, z, 1.0)) {
        if (h.owner !== 'mannequins') continue;
        if (!seen.has(h.i)) {
          seen.set(h.i, {
            i: h.i,
            x: +(((h.min[0] + h.max[0]) / 2)).toFixed(2),
            z: +(((h.min[2] + h.max[2]) / 2)).toFixed(2),
            height: h.height,
          });
        }
      }
    }
  }
  return [...seen.values()];
});
console.log('[cmp] mannequin colliders found: ' + dummies.length
  + '  ' + JSON.stringify(dummies.slice(0, 6)));

const shots = [gameShot];
if (dummies.length) {
  // Pick a dummy on OPEN ground. "Furthest from another dummy" chose one inside
  // the orange house and put the camera in a bedroom; the real requirement is
  // that the camera can stand 5 m and 18 m back from it with clear air between,
  // so score each dummy by how much of that corridor is collider-free.
  const pick = await page.evaluate((list) => {
    let best = null;
    for (const d of list) {
      let clear = 0;
      for (let b = 1.5; b <= 19; b += 1.0) {
        const hits = window.__NT.collidersAt(d.x + 0.8, d.z + b, 1.4);
        if (hits.length === 0) clear++;
      }
      if (!best || clear > best.clear) best = { ...d, clear };
    }
    return best;
  }, dummies);
  console.log('[cmp] comparing against dummy ' + JSON.stringify(pick));

  for (const [name, gap, back] of [['near', 1.6, 5.0], ['twentym', 1.9, 18.0]]) {
    const placed = await page.evaluate(([i, mx, mz, g]) => {
      window.__NTANIM.place(i, mx + g, mz, Math.PI);
      window.__NTANIM.pin(i, mx + g, mz, Math.PI);
      window.__NTANIM.drive(i, 0, false);
      return window.__NTANIM.list()[i];
    }, [0, pick.x, pick.z, gap]);
    // Camera on the far side, both subjects centred, at `back` metres.
    await page.evaluate(([mx, mz, g, b, eye]) => {
      const cx = mx + g / 2;
      window.__NT.teleport(cx, 1.55 - eye, mz + b, 0, -0.03);
      if (window.__NT.release) window.__NT.release();
    }, [pick.x, pick.z, gap, back, EYE]);
    await page.waitForTimeout(900);
    const f = join(OUT, `${tag}-dummy-vs-operator-${name}.png`);
    writeFileSync(f, await page.screenshot({ type: 'png' }));
    shots.push(f);
    console.log('  ' + f + '  operator at ' + JSON.stringify(placed));
  }
  await page.evaluate(() => window.__NTANIM.unpin());
}

const bundleAfter = statSync(join(ROOT, 'dist', 'index.html')).mtimeMs;
if (errors.length) console.log('[cmp] console errors:\n  ' + errors.slice(0, 6).join('\n  '));
if (bundleBefore !== bundleAfter) console.log('[cmp] WARNING dist changed during the run');
writeFileSync(join(OUT, `${tag}-compare.json`), JSON.stringify({
  url, tag, liveStats, dummies, shots, errors,
  bundleChangedDuringRun: bundleBefore !== bundleAfter,
}, null, 2));
await browser.close();
killTree(chrome.pid);
