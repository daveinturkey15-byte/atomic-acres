/**
 * _heapleak - measure the JS heap post-GC FLOOR through the REAL game loop.
 *
 * Why: an adversarial verifier's control run (2026-09-18 23:40) measured the post-GC
 * floor climbing ~4.2 MB/min with renderer.info.memory.geometries flat. That is not
 * geometry; it is retained JS. This harness reproduces the measurement and captures
 * three V8 heap snapshots so the growth can be attributed to a constructor and a site.
 *
 * It drives the page exactly the way scripts/playcap.mjs does - real Chrome over CDP
 * (playwright's bundled chromium has no WebGPU adapter, so buildPost silently returns
 * enabled:false and you would be profiling the WebGL2 fallback), click #start, then let
 * the game's OWN requestAnimationFrame loop run. It never calls __NT.render().
 *
 *   node scripts/_heapleak.mjs --tag before
 *   node scripts/_heapleak.mjs --tag after --marks 30,90,150
 *
 * Writes captures/leak/<tag>-t{sec}.heapsnapshot and captures/leak/<tag>-timeline.json.
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures', 'leak');

const argv = process.argv.slice(2);
const opt = (name, dflt = '') => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const tag = opt('tag', 'leak');
const query = opt('query', '');
const marks = opt('marks', '30,90,150').split(',').map(Number);
const MB = (b) => +(b / 1048576).toFixed(2);

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

const exe = chromePath();
if (!exe) { console.error('[heapleak] no Chrome found; this harness needs a real WebGPU adapter'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-heapleak-' + cdpPort),
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
if (!browser) { console.error('[heapleak] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }

const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));

console.log('[heapleak] ' + url);
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });

const cdp = await ctx.newCDPSession(page);
await cdp.send('HeapProfiler.enable');

// A frame counter of our own: renderer.info.render.calls is reset every frame, and
// __NT.stats().fps only updates twice a second. This proves the loop really ran.
await page.evaluate(() => {
  window.__leakFrames = 0;
  const tick = () => { window.__leakFrames++; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});

// Click to play exactly as a person would - the listener lives on the overlay.
await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
await page.waitForTimeout(1200);

mkdirSync(OUT, { recursive: true });
const t0 = Date.now();
const timeline = [];

async function sample(label) {
  const usage = await cdp.send('Runtime.getHeapUsage');
  const page_ = await page.evaluate(() => {
    const m = performance.memory;
    let st = {};
    try { st = window.__NT.stats(); } catch { /* pre-ready */ }
    return {
      perfUsed: m ? m.usedJSHeapSize : null,
      perfTotal: m ? m.totalJSHeapSize : null,
      frames: window.__leakFrames,
      fps: st.fps, calls: st.calls, geometries: st.geometries,
      textures: st.textures, programs: st.programs,
    };
  });
  const row = {
    t: +((Date.now() - t0) / 1000).toFixed(1), label,
    usedMB: MB(usage.usedSize), totalMB: MB(usage.totalSize),
    perfUsedMB: page_.perfUsed == null ? null : MB(page_.perfUsed),
    frames: page_.frames, fps: page_.fps, calls: page_.calls,
    geometries: page_.geometries, textures: page_.textures, programs: page_.programs,
  };
  timeline.push(row);
  return row;
}

/** post-GC floor: collectGarbage twice (one pass can leave a young-gen survivor). */
async function floor() {
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(300);
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(300);
  const u = await cdp.send('Runtime.getHeapUsage');
  return MB(u.usedSize);
}

async function snapshot(sec) {
  const file = join(OUT, `${tag}-t${sec}.heapsnapshot`);
  const out = createWriteStream(file);
  const onChunk = ({ chunk }) => out.write(chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await cdp.send('HeapProfiler.takeHeapSnapshot', {
    reportProgress: false, captureNumericValue: false, exposeInternals: false,
  });
  cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await new Promise((r) => out.end(r));
  return file;
}

const sampler = setInterval(() => { sample('tick').catch(() => {}); }, 10000);
const floors = [];
for (const sec of marks) {
  const waitMs = t0 + sec * 1000 - Date.now();
  if (waitMs > 0) await page.waitForTimeout(waitMs);
  const f = await floor();
  const row = await sample('mark' + sec);
  const file = await snapshot(sec);
  floors.push({ sec, floorMB: f, frames: row.frames, fps: row.fps, geometries: row.geometries, file });
  console.log(`  t+${String(sec).padStart(3)}s  post-GC floor ${String(f).padStart(7)} MB   frames ${row.frames}   fps ${row.fps}   geom ${row.geometries}   tex ${row.textures}`);
}
clearInterval(sampler);

const span = (floors[floors.length - 1].sec - floors[0].sec) / 60;
const rate = +(((floors[floors.length - 1].floorMB - floors[0].floorMB) / span)).toFixed(2);
console.log(`[heapleak] floor slope ${rate} MB/min over ${(span * 60).toFixed(0)}s  (flat = < 0.5)`);
if (errors.length) console.log('[heapleak] console errors:\n  ' + errors.slice(0, 6).join('\n  '));

writeFileSync(join(OUT, `${tag}-timeline.json`), JSON.stringify({ url, tag, floors, rateMBperMin: rate, timeline, errors }, null, 2));

await browser.close();
killTree(chrome.pid);
