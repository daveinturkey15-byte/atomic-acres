/**
 * Headless capture harness.
 *
 * Uses the ONE shared preview (`lib/preview.mjs`) so it can never photograph a
 * stale server of its own, drives window.__NT to each camera station,
 * screenshots it, and reports console errors and renderer stats.
 *
 *   node scripts/capture.mjs                  all stations
 *   node scripts/capture.mjs aerial yardOrange   named stations
 *   node scripts/capture.mjs --tag pass2       label the output set
 *
 * ## The draw-call gate, and why it read 0 for its whole life
 *
 * `main.ts:frame()` calls `renderer.info.reset()` at the TOP of every frame
 * (autoReset is off, so the post chain's several renders per frame accumulate
 * into one honest per-frame number). That loop keeps running while the capture
 * holds the camera — it just skips its own render — so every rAF tick zeroes
 * the counters.
 *
 * This harness used to `evaluate(render)`, take a screenshot, and then
 * `evaluate(stats)`. The screenshot is an await: fifteen-odd rAF ticks, and
 * therefore fifteen resets, happen inside it. The read that followed reported
 * the frame the game had NOT drawn — 0 calls, 0 triangles — and the AGENTS.md
 * budget line printed that as if it were a measurement. Two lanes reported it
 * independently. `scripts/playcap.mjs` was never wrong about this because it
 * lets the game's own loop draw, so a read between frames finds the last real
 * frame.
 *
 * The fix is to read the counters in the SAME synchronous evaluate as the
 * render, as a DELTA across one `__NT.render()`. Nothing — no rAF, no reset —
 * can run between the two reads, so the number is exactly one frame's worth
 * whatever the loop is doing. A 0 is now reported as MEASURED NOTHING and
 * fails the process, because a station that renders nothing is a defect and the
 * one thing this file must never do again is print it as a measurement.
 *
 * NOTE when comparing with playcap: these frames are the QA render path with
 * the viewmodel hidden (`goto()` calls `weapons.setVisible(false)`), so the
 * counts sit slightly BELOW playcap's at the same spot, which also draws the
 * gun overlay. Same scene, one fewer pass.
 */
import { chromium } from 'playwright';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures');

/** AGENTS.md "Budgets". Over is a warning here; the gate that FAILS is a zero. */
const CALL_BUDGET = 1200;
const TRIANGLE_BUDGET = 900_000;

const argv = process.argv.slice(2);
let tag = '';
const tagIdx = argv.indexOf('--tag');
if (tagIdx !== -1) {
  tag = argv[tagIdx + 1] ?? '';
  argv.splice(tagIdx, 2);
}
const wanted = argv.filter((a) => !a.startsWith('--'));



// ONE shared preview server for the whole repo - see lib/preview.mjs.
// Previously every harness spawned its own and killed only the vite parent,
// leaving esbuild behind; 52 of them accumulated in three hours.
// Still needed for Chrome's CDP port - only the vite server is shared now.
import net from 'node:net';
function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}

const { url } = await usePreview();

mkdirSync(OUT, { recursive: true });
// Clear only THIS run's own outputs. Wiping the whole directory means two concurrent
// runs silently delete each other's frames - which happened.
const PREFIX = tag ? tag + '-' : '';
for (const f of readdirSync(OUT)) {
  if (!f.startsWith(PREFIX)) continue;
  if (tag === '' && f.includes('-')) continue;   // untagged run owns untagged files only
  if (f.endsWith('.png') || f.endsWith('.json')) rmSync(join(OUT, f), { force: true });
}

/**
 * Drive REAL Chrome over CDP, not `chromium.launch()`.
 *
 * Playwright's bundled Chromium has no WebGPU adapter - `navigator.gpu` is undefined
 * under `chromium.launch()` even with every GPU flag set. This project renders through
 * `THREE.WebGPURenderer`, and `buildPost()` falls back to `enabled: false` when the
 * adapter is missing. So for the whole life of this harness, every frame anyone judged
 * the look from was the fallback path with the entire post chain switched off: no
 * ambient occlusion, no screen-space reflection, no bloom, no vignette.
 *
 * Spawning the installed Chrome with a remote-debugging port and attaching with
 * connectOverCDP gets a real adapter, and it still works headless.
 */
function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

const cdpPort = await freePort();
const exe = chromePath();
let chrome = null;
let browser;
if (exe) {
  // spawnGuarded, not spawn: a plain .kill() on Chrome ends the parent and leaves
  // 8-10 renderer/GPU/network children orphaned. ~600 of those exhausted this
  // machine's ephemeral port pool on 2026-09-17 and cost the owner 15 hours.
  // spawnGuarded kills the tree, and reaps it on a throw or Ctrl-C too.
  chrome = spawnGuarded(exe, [
    '--headless=new',
    '--remote-debugging-port=' + cdpPort,
    '--user-data-dir=' + join(tmpdir(), 'aa-capture-' + cdpPort),
    '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan,UseSkiaRenderer',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
    // keep it off the owner's main screen if it ever runs headful
    '--window-position=2560,0',
    '--window-size=1600,900',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  const cdp = 'http://127.0.0.1:' + cdpPort;
  let connected = null;
  for (let i = 0; i < 160 && !connected; i++) {
    try { connected = await chromium.connectOverCDP(cdp); } catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  if (!connected) {
    console.error('[capture] real Chrome never accepted a CDP connection on ' + cdpPort);
    killTree(chrome.pid);
    chrome = null;
  }
  browser = connected;
}
if (!browser) {
  console.warn('[capture] WARNING: falling back to playwright chromium - NO WebGPU '
    + 'adapter, so the post chain will be OFF and these frames are not what a player sees.');
  browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=d3d11', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  });
}
const ctx = browser.contexts()[0] ?? await browser.newContext({ viewport: { width: 1600, height: 900 } });
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });

const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 400));
});
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)));

console.log('[capture] loading ' + url);
await page.goto(url, { waitUntil: 'load', timeout: 90000 });

// wait for the build to finish and the QA surface to appear
try {
  await page.waitForFunction(() => window.__NT && window.__NT.ready === true,
    null, { timeout: 180000 });
} catch {
  console.error('[capture] window.__NT never became ready.');
  console.error('  page errors: ' + JSON.stringify(pageErrors, null, 2));
  console.error('  console errors: ' + JSON.stringify(consoleErrors.slice(0, 12), null, 2));
  await browser.close();
  process.exit(1);
}

// Dismiss the click-to-play overlay. Without this EVERY screenshot is the overlay -
// the renderer stats still look perfectly healthy, which is exactly how a capture set
// can be green and show nothing.
const stripChrome = () => page.evaluate(() => {
  const el = document.getElementById('start');
  if (el) el.remove();
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = 'none';
  const ch = document.getElementById('crosshair');
  if (ch) ch.style.display = 'none';
  return !document.getElementById('start');
});
await stripChrome();

// let a few frames run so the renderer info is populated and textures have uploaded
await page.waitForTimeout(1200);

const stations = await page.evaluate(() => window.__NT.stations);
const names = wanted.length ? wanted : Object.keys(stations);

const results = [];
const blind = [];
const overBudget = [];
for (const name of names) {
  if (!stations[name]) {
    console.warn('[capture] no such station: ' + name);
    continue;
  }
  const ok = await page.evaluate((n) => window.__NT.goto(n), name);
  if (!ok) { console.warn('[capture] goto failed: ' + name); continue; }
  await page.waitForTimeout(260);
  // an HMR reload mid-run restores the overlay; strip it again every time
  if (!await stripChrome()) {
    console.error('    !! overlay could not be removed at ' + name);
    process.exitCode = 2;
  }

  // ---- THE MEASUREMENT. One synchronous evaluate: render, then read, with
  // nothing in between that could call renderer.info.reset(). The numbers are
  // DELTAS across that one render, so whatever the frame loop left in the
  // counters cancels out. `renderCallsTotal` is the session count of render()
  // invocations (main.ts exposes it under its own name precisely so it is not
  // mistaken for a budget) - its delta proves the chain actually ran.
  const stats = await page.evaluate(() => {
    const before = window.__NT.stats();
    window.__NT.render();
    const after = window.__NT.stats();
    return {
      calls: after.calls - before.calls,
      triangles: after.triangles - before.triangles,
      renders: after.renderCallsTotal - before.renderCallsTotal,
      geometries: after.geometries,
      textures: after.textures,
      programs: after.programs,
    };
  });

  const file = join(OUT, (tag ? tag + '-' : '') + name + '.png');
  await page.screenshot({ path: file });

  const measured = Number.isFinite(stats.calls) && stats.calls > 0 && stats.renders > 0;
  if (!measured) blind.push(name);
  else if (stats.calls > CALL_BUDGET || stats.triangles > TRIANGLE_BUDGET) overBudget.push(name);

  results.push({ station: name, ref: stations[name].ref, note: stations[name].note, file, measured, stats });
  console.log('  ' + name.padEnd(16)
    + (measured
      ? String(stats.calls).padStart(5) + ' calls  '
        + String(Math.round(stats.triangles / 1000)).padStart(5) + 'k tris'
        + (stats.calls > CALL_BUDGET ? '  OVER ' + CALL_BUDGET : '')
        + (stats.triangles > TRIANGLE_BUDGET ? '  OVER ' + TRIANGLE_BUDGET + ' tris' : '')
      : '  MEASURED NOTHING (' + stats.calls + ' calls over ' + stats.renders + ' renders)')
    + (stations[name].ref ? '   ref=' + stations[name].ref.split(' ')[0] : '   (diagnostic)'));
}

const moduleStats = await page.evaluate(() => window.__NT.moduleStats);
const summary = {
  when: new Date().toISOString(),
  url,
  tag,
  viewport: '1600x900',
  budgets: { calls: CALL_BUDGET, triangles: TRIANGLE_BUDGET },
  blind,
  overBudget,
  moduleStats,
  results,
  pageErrors,
  consoleErrors,
};
writeFileSync(join(OUT, (tag ? tag + '-' : '') + 'summary.json'),
  JSON.stringify(summary, null, 2));

await browser.close();

console.log('\n[capture] modules:');
for (const [k, v] of Object.entries(moduleStats)) {
  console.log('  ' + k.padEnd(14) + String(v.objects).padStart(5) + ' objects  '
    + String(v.colliders).padStart(4) + ' colliders  ' + v.ms + ' ms');
}
if (pageErrors.length) {
  console.log('\n[capture] PAGE ERRORS (' + pageErrors.length + '):');
  for (const e of pageErrors.slice(0, 10)) console.log('  ' + e);
}
if (consoleErrors.length) {
  console.log('\n[capture] CONSOLE ERRORS (' + consoleErrors.length + '):');
  for (const e of consoleErrors.slice(0, 10)) console.log('  ' + e);
}
if (overBudget.length) {
  console.log('\n[capture] OVER the ' + CALL_BUDGET + '-call / '
    + TRIANGLE_BUDGET + '-triangle budget at: ' + overBudget.join(', '));
}
if (blind.length) {
  console.log('\n[capture] MEASURED NOTHING at: ' + blind.join(', ')
    + '\n  A station that reports no draw calls has either not rendered or is not being'
    + '\n  read on the frame it rendered. Either way it is not a measurement, and the'
    + '\n  budget line above it means nothing. Do not treat this run as evidence.');
}
console.log('\n[capture] wrote ' + results.length + ' captures to captures/');
process.exit(pageErrors.length || blind.length ? 2 : 0);
