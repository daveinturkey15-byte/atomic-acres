/**
 * _chars-draws - per-figure draw-call cost, measured through the REAL game loop.
 *
 * The question this answers: how many draw calls per FRAME does one character cost,
 * at the station the budget is quoted at (spawnA)? The only honest way to get that is
 * a difference: park the player at spawnA, read drawCalls/frame with every figure
 * VISIBLE, hide them all, read again, and divide by the count. Nothing is inferred
 * from the mesh tree - the renderer's own per-frame counter answers it.
 *
 * Why not renderer.info.render.calls: that is the number of render() invocations since
 * page load (main.ts resets Info at the top of every frame with autoReset off, so
 * drawCalls/triangles are per-frame and calls is not). __NT.stats().calls is already
 * the per-frame drawCalls; this harness only medians it over many frames.
 *
 * Drives the page exactly like scripts/playcap.mjs: real Chrome over CDP (playwright's
 * bundled chromium has no WebGPU adapter), click #start, never __NT.render().
 *
 *   node scripts/_chars-draws.mjs --tag before
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
const tag = opt('tag', 'draws');

// spawnA, exactly as playcap frames it. Camera forward at yaw PI is +z, so the six
// figures main.ts spawns (z -12.5 .. +12) are all down-range and in frustum.
const STATION = { x: -4.0, z: -34.3, yaw: Math.PI };

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
if (!exe) { console.error('[chars] no Chrome'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-chars-' + cdpPort),
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
if (!browser) { console.error('[chars] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }

const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 240)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 240)));

console.log('[chars] ' + url);
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
await page.waitForTimeout(1500);
await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });
await page.evaluate(([x, z, yaw]) => {
  window.__NT.teleport(x, 0, z, yaw, 0);
  if (window.__NT.release) window.__NT.release();
}, [STATION.x, STATION.z, STATION.yaw]);
await page.waitForTimeout(1200);

/** Median drawCalls/frame over `n` samples spread across real frames. */
async function measure(label, n = 41) {
  await page.waitForTimeout(700);
  const rows = await page.evaluate(async (count) => {
    const out = [];
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    for (let i = 0; i < count; i++) {
      await raf(); await raf();
      const s = window.__NT.stats();
      out.push({ calls: s.calls, tris: s.triangles, fps: s.fps, geo: s.geometries, tex: s.textures, prog: s.programs });
    }
    return out;
  }, n);
  const med = (k) => {
    const v = rows.map((r) => r[k]).filter((x) => typeof x === 'number').sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  };
  const r = {
    label, samples: rows.length,
    calls: med('calls'), tris: med('tris'), fps: med('fps'),
    geometries: med('geo'), textures: med('tex'), programs: med('prog'),
    callsMin: Math.min(...rows.map((x) => x.calls)), callsMax: Math.max(...rows.map((x) => x.calls)),
  };
  console.log(`  ${label.padEnd(22)} calls ${String(r.calls).padStart(5)} [${r.callsMin}..${r.callsMax}]  tris ${String(r.tris).padStart(7)}  geo ${r.geometries}  tex ${r.textures}  prog ${r.programs}  fps ${r.fps}`);
  return r;
}

async function shot(name) {
  mkdirSync(OUT, { recursive: true });
  const f = join(OUT, `${tag}-${name}.png`);
  writeFileSync(f, await page.screenshot({ type: 'png' }));
  return f;
}

const meta = await page.evaluate(() => ({
  hasAnim: !!window.__NTANIM,
  n: window.__NTANIM ? window.__NTANIM.count() : -1,
  list: window.__NTANIM ? window.__NTANIM.list() : [],
  mesh: window.__NTMESH ? window.__NTMESH.stats() : null,
}));
console.log('[chars] figures spawned by main.ts: ' + meta.n);

const results = {};
results.show6 = await measure('6 figures visible');
const shot6 = await shot('show6');

// Hide every figure (solo(-1) matches nothing, so it hides all six).
const hidden = await page.evaluate(() => window.__NTANIM.solo(-1));
results.hide0 = await measure(`0 figures (${hidden} hidden)`);
const shot0 = await shot('hide0');

await page.evaluate(() => window.__NTANIM.showAll());
results.show6b = await measure('6 figures visible (b)');

// Twelve: six more on the same ground the traverse already proves walkable, in view.
await page.evaluate(() => {
  const at = [[-7.5, -10.5], [7.0, -7.0], [-9.0, 7.5], [6.5, 10.0], [1.0, -13.5], [-3.0, 13.0]];
  for (const [x, z] of at) window.__NTANIM.spawn(x, z, 0);
});
results.show12 = await measure('12 figures visible');
const shot12 = await shot('show12');

const meshAfter = await page.evaluate(() => (window.__NTMESH ? window.__NTMESH.stats() : null));

// dispose proof: release every figure's mesh and read memory.geometries back.
let disposeProof = null;
if (await page.evaluate(() => !!window.__NTMESH)) {
  disposeProof = await page.evaluate(async () => {
    const before = window.__NT.stats().geometries;
    const n = window.__NTMESH.disposeAll();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { before, disposed: n, after: window.__NT.stats().geometries };
  });
  console.log(`  dispose: ${disposeProof.disposed} figures released, geometries ${disposeProof.before} -> ${disposeProof.after}`);
}

// main.ts spawns six figures and the local match spawns five bots, so the live
// count is whatever __NTANIM reports - dividing by six would have understated
// the per-figure cost by 45%.
const N0 = meta.n;
const per6 = (results.show6.calls - results.hide0.calls) / N0;
const per12 = (results.show12.calls - results.show6b.calls) / 6;
const tri6 = (results.show6.tris - results.hide0.tris) / N0;
const tri12 = (results.show12.tris - results.show6b.tris) / 6;
console.log(`[chars] per-figure draw calls/frame: ${per6.toFixed(2)} (${N0} vs 0)   ${per12.toFixed(2)} (${N0 + 6} vs ${N0})`);
console.log(`[chars] per-figure triangles/frame:  ${tri6.toFixed(0)} (${N0} vs 0)   ${tri12.toFixed(0)} (marginal), main + shadow passes`);
if (errors.length) console.log('[chars] console errors:\n  ' + errors.slice(0, 8).join('\n  '));

mkdirSync(OUT, { recursive: true });
const bundleAfter = statSync(join(ROOT, 'dist', 'index.html')).mtimeMs;
writeFileSync(join(OUT, `${tag}-draws.json`), JSON.stringify({
  url, tag, station: STATION, meta, results, meshAfter, disposeProof,
  liveFigures: N0,
  perFigureCallsAllVsNone: +per6.toFixed(2), perFigureCallsMarginal: +per12.toFixed(2),
  perFigureTriangles: +tri6.toFixed(0), perFigureTrianglesMarginal: +tri12.toFixed(0),
  bundleMtimeBefore: bundleBefore, bundleMtimeAfter: bundleAfter,
  bundleChangedDuringRun: bundleBefore !== bundleAfter,
  shots: [shot6, shot0, shot12], errors,
}, null, 2));
if (bundleBefore !== bundleAfter) console.log('[chars] WARNING dist changed during the run - rerun before believing this');

await browser.close();
killTree(chrome.pid);
