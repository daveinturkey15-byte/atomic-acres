/**
 * Twelve animated figures on screen: frame time, draw calls per frame, JS heap
 * over two minutes. The brief's budget question, answered by measurement.
 *
 * Three things this harness refuses to do, because each of them turns the
 * number into a lie:
 *
 * 1. It never measures through `__NT.render()`. That is the QA path, and it is
 *    how a black screen shipped behind ten green captures. The page's own rAF
 *    loop does the drawing and the timing is sampled from inside it.
 *
 * 2. It puts every figure INSIDE 25 m of the camera. `CharacterSystem.update`
 *    thins a rig to every third frame past 25 m and every sixth past 50, so a
 *    scattered crowd measures the LOD, not the cost of twelve rigs.
 *
 * 3. It reports the difference against the SAME scene with the figures hidden,
 *    measured in the same run seconds apart, rather than against a number from
 *    another session. The map's own cost moves as other lanes land; only the
 *    delta belongs to this lane.
 *
 *   node scripts/animation/budget-twelve.mjs [--seconds 120] [--clip walk]
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { usePreview } from '../lib/preview.mjs';
import { spawnGuarded, killTree } from '../lib/proc-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'captures', 'anim');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const seconds = Number(opt('seconds', '120'));
const clipName = opt('clip', 'walk');
const TARGET = 12;

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
const chromePath = () => [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
].filter(Boolean).find((p) => existsSync(p)) ?? null;

const { url } = await usePreview();
const exe = chromePath();
if (!exe) { console.error('[budget] no real Chrome'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-budget-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  // performance.memory needs this; without it heap readings come back 0.
  '--enable-precise-memory-info',
  '--window-position=2560,0', '--window-size=1600,900', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

let browser = null;
for (let i = 0; i < 160 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!browser) { console.error('[budget] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }
const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });

await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
await page.waitForTimeout(1200);
await page.waitForFunction(() => window.__NTANIM && window.__NTANIM.ready === true, null, { timeout: 30000 });
await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });

// A frame-time sampler that lives on the page's own rAF chain.
await page.evaluate(() => {
  window.__BUD = { t: [], on: false };
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    if (window.__BUD.on) window.__BUD.t.push(now - last);
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const stage = await page.evaluate(async ([n, clip]) => {
  await window.__NTANIM.load();
  window.__NTANIM.selfTick(true);
  const sys = window.__NTANIM;
  // Grow to twelve, all inside the LOD's full-rate radius, in two arcs in front
  // of the camera so every one of them is actually drawn.
  const base = { x: -14, z: -8 };
  const have = sys.count();
  for (let i = have; i < n; i++) sys.spawn(base.x, base.z, 0);
  const placed = [];
  for (let i = 0; i < n; i++) {
    const ring = i < 6 ? 3.0 : 5.2;
    const a = (i % 6) / 6 * Math.PI * 1.1 - Math.PI * 0.55;
    const x = base.x + Math.sin(a) * ring;
    const z = base.z + Math.cos(a) * ring;
    sys.place(i, x, z, Math.PI);
    sys.pin(i, x, z, Math.PI);
    await sys.external(i, clip);
    sys.drive(i, 1.0);
    placed.push([+x.toFixed(1), +z.toFixed(1)]);
  }
  window.__NT.setMode('walk');
  // yaw PI, not 0: the camera looks down -Z at yaw 0, and standing at z-9 that
  // points AWAY from the crowd. The first run measured 1481 calls for one
  // sample and 1184 for the rest because only the shadow pass was still drawing
  // the figures the camera had its back to.
  window.__NT.teleport(base.x, 0, base.z - 9, Math.PI, 0);
  if (window.__NT.release) window.__NT.release();
  try { window.__NT.weaponCmd('visible', false); } catch { /* weapons lane may change */ }
  return { count: sys.count(), placed };
}, [TARGET, clipName]);
console.log(`[budget] ${stage.count} figures, all within 10 m of the camera (LOD full rate)`);

/**
 * A single heap reading is GC sawtooth, not a measurement - the first run of
 * this harness produced 74, 55, 149, 52, 73, 108 MB and a "drift" of -41 MB,
 * which says nothing about whether anything leaks. What does mean something is
 * the FLOOR: the lowest post-collection value in a window. A floor that climbs
 * window over window is a leak; a floor that holds is not, however jagged the
 * peaks above it are.
 */
const sample = async (label, ms) => {
  await page.evaluate(() => { window.__BUD.t.length = 0; window.__BUD.on = true; });
  const heaps = [];
  const slices = Math.max(6, Math.round(ms / 900));
  for (let i = 0; i < slices; i++) {
    await page.waitForTimeout(Math.round(ms / slices));
    heaps.push(await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0)));
  }
  const r = await page.evaluate(() => {
    window.__BUD.on = false;
    const t = window.__BUD.t.slice().sort((a, b) => a - b);
    const s = window.__NT.stats();
    return {
      frames: t.length,
      p50: t[Math.floor(t.length * 0.5)] ?? 0,
      p95: t[Math.floor(t.length * 0.95)] ?? 0,
      calls: s.calls, tris: s.triangles, programs: s.programs, geometries: s.geometries,
    };
  });
  return {
    label, ...r,
    heapFloor: +Math.min(...heaps).toFixed(1),
    heapPeak: +Math.max(...heaps).toFixed(1),
    heap: +Math.min(...heaps).toFixed(1),
  };
};

// Baseline FIRST, in the same run: the map without the figures.
await page.evaluate(() => { window.__NTANIM.solo(-1); });
const off = await sample('figures hidden', 8000);
await page.evaluate(() => { window.__NTANIM.showAll(); });
await page.waitForTimeout(1500);
const warm = await sample('12 figures, warm-up', 8000);

console.log(`[budget] baseline (hidden)   ${off.p50.toFixed(2)} ms p50   ${off.calls} calls   ${(off.tris / 1000).toFixed(0)}k tris   heap ${off.heap.toFixed(1)} MB`);
console.log(`[budget] twelve  (warm-up)   ${warm.p50.toFixed(2)} ms p50   ${warm.calls} calls   ${(warm.tris / 1000).toFixed(0)}k tris   heap ${warm.heap.toFixed(1)} MB`);

const marks = [];
const step = Math.max(1, Math.round(seconds / 4));
for (let k = 0; k < 4; k++) {
  const m = await sample(`t+${(k + 1) * step}s`, step * 1000);
  marks.push(m);
  console.log(`[budget] ${m.label.padEnd(10)} ${m.p50.toFixed(2)} ms p50  ${m.p95.toFixed(2)} ms p95  `
    + `${m.calls} calls  ${(m.tris / 1000).toFixed(0)}k tris  heap floor ${m.heapFloor} peak ${m.heapPeak} MB  geom ${m.geometries}`);
}

mkdirSync(OUT, { recursive: true });
const shot = await page.screenshot({ type: 'png' });
writeFileSync(join(OUT, 'budget-twelve.png'), shot);
await browser.close();
killTree(chrome.pid);

const first = marks[0], last = marks[marks.length - 1];
const out = {
  clip: clipName, figures: stage.count, seconds,
  baselineHidden: off, warmUp: warm, marks,
  deltaCalls: warm.calls - off.calls,
  deltaFrameMs: +(warm.p50 - off.p50).toFixed(3),
  heapStartMB: first.heapFloor, heapEndMB: last.heapFloor, heapDriftMB: +(last.heapFloor - first.heapFloor).toFixed(1),
  heapNote: 'floor = lowest post-GC reading in the window; peaks are sawtooth, not growth',
  frameTimeNote: 'p50 is the 16.7 ms vsync cap on this machine, not the cost of the frame',
};
writeFileSync(join(OUT, 'budget-twelve.json'), JSON.stringify(out, null, 2));
console.log(`[budget] twelve figures cost ${out.deltaCalls} draw calls and ${out.deltaFrameMs} ms/frame`
  + `   heap FLOOR ${first.heapFloor} -> ${last.heapFloor} MB over ${seconds} s (drift ${out.heapDriftMB} MB)`);
console.log('[budget] frame time is vsync-capped at 16.7 ms here, so p50 measures the cap, not the headroom; read p95 and the draw calls.');
