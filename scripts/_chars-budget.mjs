/**
 * _chars-budget - the characters lane's S9 evidence in one run.
 *
 *   - frame time, two-minute mean, measured BOTH vsync-capped (what a player
 *     gets) and with the frame-rate limiter off (what the frame actually costs;
 *     at 60 fps capped every frame reads 16.7 ms and the number means nothing);
 *   - draw calls and triangles per frame at spawnA;
 *   - post-GC heap FLOOR at t+30/90/150 s, exactly the pattern in
 *     scripts/_heapleak.mjs: HeapProfiler.collectGarbage twice, then
 *     Runtime.getHeapUsage. Floor slope must stay under 0.5 MB/min.
 *   - live frames mid-soak at stations where the bots actually are.
 *
 * Real Chrome over CDP, click #start, the game's own loop. Never __NT.render().
 *
 *   node scripts/_chars-budget.mjs --tag after --marks 30,90,150
 *   node scripts/_chars-budget.mjs --tag after --unlock 0     # keep vsync
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
const tag = opt('tag', 'budget');
const marks = opt('marks', '30,90,150').split(',').map(Number);
const unlock = opt('unlock', '1') !== '0';
const live = opt('live', '0') !== '0';
const MB = (b) => +(b / 1048576).toFixed(2);

const SPAWN_A = { x: -4.0, z: -34.3, yaw: Math.PI };
// Stations where the bots actually walk, for the live frames.
const LIVE = [
  { name: 'circle', x: -6.0, z: 0.0, yaw: -Math.PI / 2 },
  { name: 'midstreet', x: -1.0, z: -14.0, yaw: 0 },
  { name: 'spawnB', x: 1.2, z: 34.3, yaw: 0 },
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

const bundleBefore = statSync(join(ROOT, 'dist', 'index.html')).mtimeMs;
const { url } = await usePreview();
const exe = chromePath();
if (!exe) { console.error('[budget] no Chrome'); process.exit(2); }
const cdpPort = await freePort();
const args = [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-budget-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--js-flags=--expose-gc',
  '--window-position=2560,0', '--window-size=1600,900', 'about:blank',
];
if (unlock) args.splice(8, 0, '--disable-gpu-vsync', '--disable-frame-rate-limit');
const chrome = spawnGuarded(exe, args, { stdio: 'ignore', windowsHide: true });

let browser = null;
for (let i = 0; i < 160 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!browser) { console.error('[budget] no CDP'); killTree(chrome.pid); process.exit(2); }
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));

await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
const cdp = await ctx.newCDPSession(page);
await cdp.send('HeapProfiler.enable');

// Independent frame clock: __NT.stats().fps only updates twice a second and the
// renderer's own counters are reset each frame, so neither proves the loop ran.
await page.evaluate(() => {
  window.__budget = { n: 0, dt: [], last: performance.now() };
  const tick = () => {
    const now = performance.now();
    window.__budget.dt.push(now - window.__budget.last);
    window.__budget.last = now;
    window.__budget.n++;
    if (window.__budget.dt.length > 60000) window.__budget.dt.shift();
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
await page.waitForTimeout(1500);
await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });
await page.evaluate(([x, z, yaw]) => {
  window.__NT.teleport(x, 0, z, yaw, 0);
  if (window.__NT.release) window.__NT.release();
}, [SPAWN_A.x, SPAWN_A.z, SPAWN_A.yaw]);
await page.waitForTimeout(1500);

mkdirSync(OUT, { recursive: true });
const t0 = Date.now();

async function floor() {
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(350);
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(350);
  return MB((await cdp.send('Runtime.getHeapUsage')).usedSize);
}
async function frames() {
  return page.evaluate(() => {
    const d = window.__budget.dt.slice(-3600).filter((x) => x > 0.05 && x < 500);
    const s = [...d].sort((a, b) => a - b);
    return {
      n: window.__budget.n,
      meanMs: d.length ? +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(3) : null,
      p50: s.length ? +s[Math.floor(s.length * 0.5)].toFixed(3) : null,
      p95: s.length ? +s[Math.floor(s.length * 0.95)].toFixed(3) : null,
      stats: window.__NT.stats(),
      figures: window.__NTANIM ? window.__NTANIM.count() : -1,
      mesh: window.__NTMESH ? window.__NTMESH.stats() : null,
    };
  });
}

const floors = [];
const shots = [];
for (const sec of marks) {
  const wait = t0 + sec * 1000 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  const f = await floor();
  const fr = await frames();
  floors.push({
    sec, floorMB: f, rafFrames: fr.n, meanMs: fr.meanMs, p50: fr.p50, p95: fr.p95,
    calls: fr.stats.calls, triangles: fr.stats.triangles,
    renderCallsTotal: fr.stats.renderCallsTotal,
    geometries: fr.stats.geometries, textures: fr.stats.textures,
    figures: fr.figures,
  });
  console.log(`  t+${String(sec).padStart(3)}s  floor ${String(f).padStart(7)} MB   frame ${fr.meanMs} ms (p50 ${fr.p50}, p95 ${fr.p95})   calls ${fr.stats.calls}   tris ${fr.stats.triangles}   geo ${fr.stats.geometries}   figures ${fr.figures}   renders ${fr.stats.renderCallsTotal}`);
  // Live frames mid-soak, from where the bots are, then straight back to spawnA
  // so the draw-call reading at the next mark is the same station.
  // Off by default: three station teleports and three full-page screenshots
  // mid-soak put a 1.5 MB step into the post-GC floor and made the slope read
  // 0.845 MB/min. The heap question and the "show me the bots" question need
  // separate runs.
  if (live && sec === marks[1]) {
    for (const L of LIVE) {
      await page.evaluate(([x, z, yaw]) => {
        window.__NT.teleport(x, 0, z, yaw, 0);
        if (window.__NT.release) window.__NT.release();
      }, [L.x, L.z, L.yaw]);
      await page.waitForTimeout(1100);
      const file = join(OUT, `${tag}-live-${L.name}.png`);
      writeFileSync(file, await page.screenshot({ type: 'png' }));
      const st = await page.evaluate(() => window.__NT.stats());
      shots.push({ file, calls: st.calls, triangles: st.triangles });
      console.log(`     live ${L.name.padEnd(10)} calls ${st.calls}  -> ${file}`);
    }
    await page.evaluate(([x, z, yaw]) => {
      window.__NT.teleport(x, 0, z, yaw, 0);
      if (window.__NT.release) window.__NT.release();
    }, [SPAWN_A.x, SPAWN_A.z, SPAWN_A.yaw]);
    await page.waitForTimeout(1200);
  }
}

const span = (floors[floors.length - 1].sec - floors[0].sec) / 60;
const slope = +(((floors[floors.length - 1].floorMB - floors[0].floorMB) / span)).toFixed(3);
console.log(`[budget] post-GC floor slope ${slope} MB/min over ${(span * 60).toFixed(0)}s  (flat = < 0.5)`);
if (errors.length) console.log('[budget] console errors:\n  ' + errors.slice(0, 8).join('\n  '));
const bundleAfter = statSync(join(ROOT, 'dist', 'index.html')).mtimeMs;
if (bundleBefore !== bundleAfter) console.log('[budget] WARNING dist changed during the run');
writeFileSync(join(OUT, `${tag}-budget.json`), JSON.stringify({
  url, tag, vsyncUnlocked: unlock, marks, floors, slopeMBperMin: slope, shots, errors,
  bundleChangedDuringRun: bundleBefore !== bundleAfter,
}, null, 2));
await browser.close();
killTree(chrome.pid);
