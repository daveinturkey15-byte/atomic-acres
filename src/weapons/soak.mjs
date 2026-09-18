/**
 * Guns-lane soak + falsifier harness (verification, not a product script).
 *
 * Headless-shell software rendering runs this map at ~1 fps, and the player
 * loop clamps dt to 50 ms, so game time runs ~20x slower than the wall clock.
 * Wall-clock pacing is therefore meaningless here: every wait in this script
 * polls GAME state (refire cooldown, ADS blend, reload flag) instead of
 * sleeping fixed seconds.
 *
 * Drives the BUILT page:
 *  - fires each catalog weapon for a fixed pull count, sampling JS heap
 *  - frame-time sample idle vs firing (delta is the regression signal)
 *  - spread falsifier: 10 m hip vs 40 m ADS dispersion at a fixed wall,
 *    aim high (y=4.5) so the 40 m ray clears the 2.1 m back fence
 *  - AR recoil pattern: first 10 applied aim offsets of a fresh burst
 *  - screenshots: hip pose, ADS pose, stretched muzzle flash
 *
 * Usage: npm run build && node src/weapons/soak.mjs
 * Output: captures/guns-soak.json + captures/guns-hip/ads/flash.png
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'captures');

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

async function waitForServer(url, ms = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pull counts sized so each weapon fires ~2-3 mags with QA refills.
const WEAPONS = [
  { id: 'longhorn', pulls: 60 },
  { id: 'rattler', pulls: 40 },
  { id: 'coachman', pulls: 12 },
  { id: 'deadeye', pulls: 8 },
  { id: 'duster', pulls: 30 },
];

const port = await freePort();
console.log('[soak] starting own dev server on port ' + port);
const server = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'preview', '--port', String(port), '--strictPort'],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' },
);
const url = 'http://localhost:' + port + '/';
if (!await waitForServer(url)) {
  console.error('[soak] server never came up');
  server.kill();
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--expose-gc'] });
const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
const pageErrors = [];
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 400));
});
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)));

await page.goto(url, { waitUntil: 'load', timeout: 90000 });
try {
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true,
    null, { timeout: 180000 });
} catch {
  console.error('[soak] window.__NT never became ready');
  console.error(JSON.stringify(pageErrors, null, 2));
  await browser.close();
  server.kill();
  process.exit(1);
}
await page.evaluate(() => {
  const el = document.getElementById('start');
  if (el) el.remove();
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = 'none';
  const ch = document.getElementById('crosshair');
  if (ch) ch.style.display = 'none';
});
await page.waitForTimeout(1200);
await page.evaluate(() => window.__NT.release());

const heapMB = () => page.evaluate(() => {
  try {
    if (window.gc) window.gc();
  } catch { /* gc unavailable */ }
  const m = performance.memory;
  return m ? +(m.usedJSHeapSize / 1048576).toFixed(2) : -1;
});
const programs = () => page.evaluate(() => window.__NT.stats().programs);
const state = () => page.evaluate(() => window.__NT.weaponCmd('state'));
const prog0 = await programs();

/** One trigger pull if the gun is ready; refills instead of reloading. */
async function pull() {
  return page.evaluate(() => {
    const q = window.__NT;
    const st = q.weaponCmd('state');
    if (st.reloading || st.cool > 0) return { fired: false, shotsFired: st.shotsFired };
    if (st.mag <= 0) q.weaponCmd('refill');
    const ok = q.weaponCmd('fire');
    const st2 = q.weaponCmd('state');
    return { fired: !!ok, shotsFired: st2.shotsFired };
  });
}

/** Fire exactly `n` pulls, waiting on game-time cooldown between them. */
async function firePulls(n) {
  let done = 0;
  let guard = 0;
  while (done < n && guard++ < n * 400) {
    const r = await pull();
    if (r.fired) {
      done++;
      continue;
    }
    await sleep(120);
  }
  return done;
}
async function frameSample() {
  const ds = await page.evaluate(() => new Promise((res) => {
    const out = [];
    let last = performance.now();
    function f(t) {
      out.push(t - last);
      last = t;
      if (out.length < 60) requestAnimationFrame(f);
      else res(out);
    }
    requestAnimationFrame(f);
  }));
  const s = [...ds].sort((a, b) => a - b);
  const mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  return { mean: +mean.toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1) };
}

const report = { heap: {}, frames: {}, accuracy: {}, recoil: null, programs: { before: prog0 } };

await page.evaluate(() => window.__NT.spawn('a'));
await page.waitForTimeout(600);
report.frames.idle = await frameSample();

for (const w of WEAPONS) {
  await page.evaluate((id) => window.__NT.weaponCmd('switch', id), w.id);
  await page.waitForTimeout(300);
  const h0 = await heapMB();
  const s0 = await state();
  const done = await firePulls(w.pulls);
  const s1 = await state();
  const h1 = await heapMB();
  report.heap[w.id] = {
    startMB: h0,
    endMB: h1,
    deltaMB: h0 >= 0 ? +(h1 - h0).toFixed(2) : null,
    pullsRequested: w.pulls,
    pullsDone: done,
    shotsFiredDelta: s1.shotsFired - s0.shotsFired,
  };
  console.log(`[soak] ${w.id}: heap ${h0} -> ${h1} MB, pulls ${done}/${w.pulls}`);
  if (w.id === 'longhorn') {
    // Keep firing in the background of the frame sample: one pull per tick.
    const sampling = (async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 20000) {
        await pull();
        await sleep(60);
      }
    })();
    report.frames.firing = await frameSample();
    await sampling;
  }
}

// Spread falsifier: orange front wall face z=-13.6, aim point (0,4.5,-13.6)
// clears the 2.1 m back fence on the 40 m ray with margin to spare.
async function lane(id, dist, ads, shots) {
  const z = -13.6 - dist;
  const pitch = Math.atan2(4.5 - 1.68, dist);
  await page.evaluate(([x, y, zz, yaw, p]) => window.__NT.teleport(x, y, zz, yaw, p),
    [0, 0, z, Math.PI, pitch]);
  await page.evaluate((wid) => window.__NT.weaponCmd('switch', wid), id);
  await page.evaluate(() => window.__NT.weaponCmd('refill'));
  await page.evaluate((a) => window.__NT.weaponCmd('ads', a), ads);
  // Wait for the ADS blend in GAME time, not wall time.
  if (ads) {
    const t0 = Date.now();
    for (;;) {
      const t = await page.evaluate(() => window.__NT.weaponCmd('hud').adsT);
      if (t >= 0.999) break;
      if (Date.now() - t0 > 60000) break;
      await sleep(200);
    }
  } else {
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => window.__NT.weaponCmd('impacts', true));
  const base = await page.evaluate(() => window.__NT.weaponCmd('hud').spread);
  // Slow cadence in GAME time: let bloom fully decay between pulls so each
  // lane isolates its base spread instead of the sustained-fire equilibrium.
  for (let i = 0; i < shots; i++) {
    const r = await pull();
    if (!r.fired) {
      i--;
      await sleep(150);
      continue;
    }
    const t0 = Date.now();
    for (;;) {
      const s = await page.evaluate(() => window.__NT.weaponCmd('hud').spread);
      if (s <= base * 1.2 + 0.0005) break;
      if (Date.now() - t0 > 30000) break;
      await sleep(200);
    }
  }
  await page.evaluate(() => window.__NT.weaponCmd('ads', false));
  const acc = await page.evaluate(() => window.__NT.weaponCmd('accuracy'));
  const imp = await page.evaluate(() => window.__NT.weaponCmd('impacts', true));
  const hud = await page.evaluate(() => window.__NT.weaponCmd('hud'));
  return { ...acc, impactsLogged: imp.total, lastDistance: hud.lastDistance };
}

for (const w of WEAPONS) {
  const near = await lane(w.id, 10, false, 8);
  const far = await lane(w.id, 40, true, 8);
  report.accuracy[w.id] = { hip10m: near, ads40m: far };
  console.log(`[soak] ${w.id}: 10m n=${near.n} rms=${near.rms} within=${near.within035} mean=${near.mean} | 40m n=${far.n} rms=${far.rms} within=${far.within035} mean=${far.mean} d=${far.lastDistance}`);
}

// AR recoil pattern: fresh log, 10 paced pulls.
await page.evaluate(() => window.__NT.weaponCmd('switch', 'longhorn'));
await page.evaluate(() => window.__NT.weaponCmd('refill'));
await page.evaluate(() => window.__NT.weaponCmd('recoil', true));
await page.evaluate(() => window.__NT.teleport(0, 0, -23.6, Math.PI, 0.08));
await page.waitForTimeout(400);
await firePulls(10);
report.recoil = await page.evaluate(() => window.__NT.weaponCmd('recoil', true));

report.programs.after = await programs();

// Screenshots with the weapon visible (back to full res for inspection).
await page.setViewportSize({ width: 800, height: 600 });
await page.evaluate(() => window.__NT.spawn('a'));
await page.waitForTimeout(600);
await page.evaluate(() => window.__NT.weaponCmd('switch', 'longhorn'));
await page.evaluate(() => window.__NT.weaponCmd('refill'));
await page.waitForTimeout(300);
await page.screenshot({ path: join(OUT, 'guns-hip.png') });
await page.evaluate(() => window.__NT.weaponCmd('ads', true));
await page.waitForTimeout(500);
await page.screenshot({ path: join(OUT, 'guns-ads.png') });
await page.evaluate(() => window.__NT.weaponCmd('ads', false));
await page.waitForTimeout(300);
await page.evaluate(() => window.__NT.weaponCmd('inspect'));
await page.waitForTimeout(120);
await page.screenshot({ path: join(OUT, 'guns-flash.png') });

report.pageErrors = pageErrors;
report.consoleErrors = consoleErrors;
writeFileSync(join(OUT, 'guns-soak.json'), JSON.stringify(report, null, 2));
console.log('[soak] wrote captures/guns-soak.json + guns-hip/ads/flash.png');

await browser.close();
server.kill();
if (pageErrors.length) {
  console.error('[soak] PAGE ERRORS: ' + JSON.stringify(pageErrors.slice(0, 5)));
  process.exit(2);
}
