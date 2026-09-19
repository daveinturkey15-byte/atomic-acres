/**
 * SOAK - the long gate. Does the game leak while it is being played?
 *
 * Promoted from the untracked `scripts/_heapleak.mjs` instrument that found the
 * bloom-sampler leak on 2026-09-19 (three r180's `Sampler.set` replaces a
 * texture's `onDispose` closure, so BloomNode's twice-a-frame re-point never
 * unsubscribes: 132,780 dead listeners in two minutes, a post-GC floor climbing
 * 4.44 MB/min). `core/post.ts:repairSamplerUnsubscribe` fixed it and NOTHING
 * GUARDED IT. That shim degrades to a silent no-op the day three renames a
 * private field, and the only harness that could see the leak was a file with
 * an underscore in front of it that no gate ran. This is that harness with a
 * verdict, a threshold and an exit code.
 *
 * ## What it measures, and why it is two series
 *
 *   JS FLOOR. `HeapProfiler.collectGarbage` twice (one pass leaves young-gen
 *   survivors) then `Runtime.getHeapUsage`, every `--every` seconds. The slope
 *   is LEAST SQUARES over every sample after `--slope-from`, not the two-point
 *   slope the old instrument printed: the floor oscillates by about
 *   0.75 MB/min run to run, and a two-point read of that noise is a coin flip.
 *   `r2` is printed beside it so a slope fitted to noise is visible as one.
 *
 *   PROCESS FLOOR. `Runtime.getHeapUsage` is BLIND to typed-array and external
 *   memory - the 2026-09-19 verifier injected a 4.4 MB/min Uint8Array leak and
 *   this metric read FLAT through it. So the renderer process's own working set
 *   is sampled from the OS beside it. `performance.measureUserAgentSpecificMemory`
 *   is tried first and is normally unavailable (it needs cross-origin isolation,
 *   which `vite preview` does not serve); `Performance.getMetrics` gives
 *   JSHeapUsedSize/JSHeapTotalSize, which is still V8's own accounting and so
 *   still blind. The OS number is not blind to anything. Only OUR Chrome is
 *   read - processes are matched on this run's private `--user-data-dir`, so
 *   the owner's browser is never touched or even counted.
 *
 *   RESOURCE COUNTS. geometries / textures / programs and the DOM counters,
 *   because the leak this file exists to guard showed up as a COUNT long before
 *   it showed up as megabytes.
 *
 * ## The verdict
 *
 *   exit 1 if the post-GC JS slope >= --max-slope (0.5 MB/min)
 *   exit 1 if the process series grows monotonically by more than
 *          --max-external-mb (20 MB) across the run
 *   exit 1 if the page did not render (frames must exceed 30 x seconds) or too
 *          few samples survived - a flat reading that measured nothing is the
 *          failure mode this project has paid for more than once
 *
 * PROVE IT CAN FAIL before trusting a green one:
 *
 *   node scripts/soak.mjs --seconds 120 --slope-from 40 --inject-kb-per-s 200
 *
 * which retains on-heap arrays inside the page at a known rate. A gate that has
 * never been seen to fail is not a gate.
 *
 *   npm run soak                                  # 210 s, 22 samples
 *   node scripts/soak.mjs --seconds 300 --snapshots   # + V8 heap snapshots
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, createWriteStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
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
const tag = opt('tag', 'soak');
const query = opt('query', '');
const SECONDS = Number(opt('seconds', '210'));
const EVERY = Number(opt('every', '10'));
/** Samples before this are warm-up: shader compiles, texture uploads, the first
 *  bot bodies. Fitting through them reports the build cost as a leak. */
const SLOPE_FROM = Number(opt('slope-from', '60'));
const MAX_SLOPE = Number(opt('max-slope', '0.5'));
const MAX_EXTERNAL_MB = Number(opt('max-external-mb', '20'));
/** A slope fitted to noise must not fail a healthy build: two clean runs on one
 *  build read 0.265 and 0.378 MB/min at r2 0.05. The JS gate therefore needs the
 *  slope AND a fit (r2 >= MIN_R2), or a slope so large no fit is needed. */
const MIN_R2 = Number(opt('min-r2', '0.25'));
/** Self-test: after the page is ready, drop every requestAnimationFrame callback
 *  except the soak's own tick, so the GAME loop dies while the page stays alive.
 *  The run must then FAIL with MEASURED NOTHING; if it passes, the liveness floor
 *  is measuring the wrong loop. */
const KILL_LOOP = process.argv.includes('--kill-loop');
const INJECT_KB_S = Number(opt('inject-kb-per-s', '0'));
const SNAPSHOTS = argv.includes('--snapshots');
const MARKS = opt('marks', '30,90,150').split(',').map(Number);
/** A frame budget so low that only a dead loop misses it. 60 Hz is 3600/min. */
const MIN_FPS_FOR_A_MEASUREMENT = 30;

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

/**
 * Ordinary least squares of y on t. Returns the slope in y-units per t-unit and
 * the r2 of the fit, so "0.02 MB/min, r2 0.01" reads as the noise it is rather
 * than as a clean flat line.
 */
function leastSquares(points) {
  const n = points.length;
  if (n < 3) return { slope: 0, r2: 0, n };
  let st = 0; let sy = 0;
  for (const p of points) { st += p.t; sy += p.y; }
  const mt = st / n; const my = sy / n;
  let stt = 0; let sty = 0; let syy = 0;
  for (const p of points) {
    stt += (p.t - mt) * (p.t - mt);
    sty += (p.t - mt) * (p.y - my);
    syy += (p.y - my) * (p.y - my);
  }
  if (stt === 0) return { slope: 0, r2: 0, n };
  const slope = sty / stt;
  const r2 = syy === 0 ? 1 : (sty * sty) / (stt * syy);
  return { slope: +slope.toFixed(3), r2: +r2.toFixed(3), n };
}

/**
 * Working set of THIS run's Chrome, from the OS, split by process kind.
 *
 * Matched on the private `--user-data-dir` this run created, which is the one
 * filter that cannot accidentally read the owner's browser. Returns null when
 * the query fails, and null is reported rather than silently treated as zero.
 */
function processMemory(userDataDir) {
  const ps = 'Get-CimInstance Win32_Process -Filter "Name=\'chrome.exe\'" '
    + '| Where-Object { $_.CommandLine -like \'*' + userDataDir + '*\' } '
    + '| ForEach-Object { $k = if ($_.CommandLine -like \'*--type=renderer*\') { \'renderer\' } '
    + 'elseif ($_.CommandLine -like \'*--type=gpu-process*\') { \'gpu\' } else { \'other\' }; '
    + '"$k $($_.ProcessId) $($_.WorkingSetSize)" }';
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  const byKind = { renderer: 0, gpu: 0, other: 0, total: 0, procs: 0 };
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /^(renderer|gpu|other)\s+(\d+)\s+(\d+)$/.exec(line.trim());
    if (m === null) continue;
    const bytes = Number(m[3]);
    byKind[m[1]] += bytes;
    byKind.total += bytes;
    byKind.procs++;
  }
  return byKind.procs === 0 ? null : byKind;
}

const { url: base } = await usePreview();
const url = base + (query ? '?' + query : '');

const exe = chromePath();
if (!exe) { console.error('[soak] no Chrome found; this gate needs a real WebGPU adapter'); process.exit(2); }
const cdpPort = await freePort();
const userDataDir = join(tmpdir(), 'aa-soak-' + cdpPort);
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + userDataDir,
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
if (!browser) { console.error('[soak] Chrome never accepted CDP'); killTree(chrome.pid); process.exit(2); }

const ctx = browser.contexts()[0] ?? await browser.newContext();
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));

console.log('[soak] ' + url + '   ' + SECONDS + 's, sample every ' + EVERY + 's, '
  + 'slope fitted from t+' + SLOPE_FROM + 's'
  + (INJECT_KB_S > 0 ? '   INJECTING ' + INJECT_KB_S + ' KB/s of retained heap' : ''));
await page.goto(url, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });

const cdp = await ctx.newCDPSession(page);
await cdp.send('HeapProfiler.enable');
let perfDomain = true;
try { await cdp.send('Performance.enable'); } catch { perfDomain = false; }
let memoryDomain = true;
try { await cdp.send('Memory.getDOMCounters'); } catch { memoryDomain = false; }

// Our own frame counter. `stats().fps` only updates twice a second and
// `info.render.calls` is reset every frame, so neither proves the loop ran.
await page.evaluate((killLoop) => {
  window.__soakFrames = 0;
  const tick = () => { window.__soakFrames++; requestAnimationFrame(tick); };
  tick.__soak = true;
  requestAnimationFrame(tick);
  if (killLoop) {
    const orig = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => (cb && cb.__soak ? orig(cb) : 0);
  }
}, KILL_LOOP);
// Liveness is proven by the GAME loop, not by our tick: __NT.stats().renderCallsTotal
// is three's session total of render() invocations (main.ts resets only the per-frame
// counters), so it advances only when the post chain actually drew a frame. Our own
// rAF counter would keep climbing on a page whose game loop had thrown and died.
let lastGameCalls = null;
let gameCallsAtStart = null;
const starvedSamples = [];

// The calibrated leak. Retained PLAIN NUMBER ARRAYS, deliberately not typed
// arrays: this injection has to be visible to Runtime.getHeapUsage so the JS
// slope is what fails. (An external-memory leak is what the process series is
// for, and it is the case the old instrument was blind to.)
if (INJECT_KB_S > 0) {
  await page.evaluate((kbPerSecond) => {
    window.__soakSink = [];
    window.__soakInjected = 0;
    const perTick = Math.max(1, Math.round(kbPerSecond / 5));   // five ticks a second
    setInterval(() => {
      const a = new Array(perTick * 128);                        // 128 doubles = 1 KB
      for (let i = 0; i < a.length; i++) a[i] = i * 1.000001;
      window.__soakSink.push(a);
      window.__soakInjected += a.length * 8;
    }, 200);
  }, INJECT_KB_S);
}

// Click to play exactly as a person would - the listener lives on the overlay.
await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
await page.waitForTimeout(1200);

mkdirSync(OUT, { recursive: true });

/** post-GC floor: collectGarbage twice (one pass can leave a young-gen survivor). */
async function floor() {
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(300);
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(300);
  const u = await cdp.send('Runtime.getHeapUsage');
  return { usedMB: MB(u.usedSize), totalMB: MB(u.totalSize) };
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

// PRIME, then start the clock. The first full collectGarbage after a page this
// size loads blocks the main thread for ten-plus seconds - measured. Paying it
// before t0 stops the first three marks landing on top of each other, which is
// how the first draft of this file produced three samples at t+14/15/21 and
// fitted a 14 MB/min "leak" through its own warm-up.
await floor();
const t0 = Date.now();

const rows = [];
let uaMemoryNote = 'not attempted';
for (let mark = 0; mark <= SECONDS; mark += EVERY) {
  const waitMs = t0 + mark * 1000 - Date.now();
  if (waitMs > 0) await page.waitForTimeout(waitMs);

  const heap = await floor();
  const t = +((Date.now() - t0) / 1000).toFixed(1);

  const inPage = await page.evaluate(async () => {
    let st = {};
    try { st = window.__NT.stats(); } catch { /* pre-ready */ }
    let ua = null;
    if (typeof performance.measureUserAgentSpecificMemory === 'function') {
      try { ua = (await performance.measureUserAgentSpecificMemory()).bytes; }
      catch (e) { ua = String(e).slice(0, 80); }
    }
    return {
      frames: window.__soakFrames, injected: window.__soakInjected ?? 0,
      perfUsed: performance.memory ? performance.memory.usedJSHeapSize : null,
      fps: st.fps, calls: st.calls, geometries: st.geometries,
      textures: st.textures, programs: st.programs, ua,
      gameCalls: st.renderCallsTotal ?? null,
    };
  });
  if (typeof inPage.gameCalls === 'number') {
    if (gameCallsAtStart === null) gameCallsAtStart = inPage.gameCalls;
    if (lastGameCalls !== null && inPage.gameCalls - lastGameCalls < MIN_FPS_FOR_A_MEASUREMENT * EVERY) {
      starvedSamples.push(t);
    }
    lastGameCalls = inPage.gameCalls;
  }
  if (typeof inPage.ua === 'number') uaMemoryNote = 'available';
  else if (typeof inPage.ua === 'string') uaMemoryNote = inPage.ua;
  else uaMemoryNote = 'not exposed (needs cross-origin isolation; vite preview sends no COOP/COEP)';

  let metrics = {};
  if (perfDomain) {
    const m = await cdp.send('Performance.getMetrics');
    for (const e of m.metrics) metrics[e.name] = e.value;
  }
  let dom = null;
  if (memoryDomain) {
    try { dom = await cdp.send('Memory.getDOMCounters'); } catch { dom = null; }
  }
  const proc = processMemory(userDataDir);

  const row = {
    t,
    floorMB: heap.usedMB,
    heapTotalMB: heap.totalMB,
    v8HeapTotalMB: metrics.JSHeapTotalSize === undefined ? null : MB(metrics.JSHeapTotalSize),
    rendererMB: proc === null ? null : MB(proc.renderer),
    gpuProcMB: proc === null ? null : MB(proc.gpu),
    chromeTotalMB: proc === null ? null : MB(proc.total),
    uaMemoryMB: typeof inPage.ua === 'number' ? MB(inPage.ua) : null,
    frames: inPage.frames,
    fps: inPage.fps,
    geometries: inPage.geometries,
    textures: inPage.textures,
    programs: inPage.programs,
    nodes: dom === null ? null : dom.nodes,
    listeners: dom === null ? null : dom.jsEventListeners,
    injectedMB: MB(inPage.injected),
  };
  rows.push(row);
  console.log('  t+' + String(Math.round(t)).padStart(3) + 's'
    + '  JS floor ' + String(row.floorMB).padStart(7) + ' MB'
    + '  renderer ' + String(row.rendererMB ?? '?').padStart(7) + ' MB'
    + '  frames ' + String(row.frames).padStart(6)
    + '  fps ' + String(row.fps ?? '?').padStart(3)
    + '  geom ' + String(row.geometries ?? '?').padStart(4)
    + '  tex ' + String(row.textures ?? '?').padStart(4)
    + (INJECT_KB_S > 0 ? '  injected ' + row.injectedMB + ' MB' : ''));

  if (SNAPSHOTS && MARKS.includes(Math.round(t / EVERY) * EVERY)) await snapshot(Math.round(t));
}

const fit = rows.filter((r) => r.t >= SLOPE_FROM);
const js = leastSquares(fit.map((r) => ({ t: r.t / 60, y: r.floorMB })));
const haveProc = fit.every((r) => r.rendererMB !== null) && fit.length >= 3;
const proc = haveProc ? leastSquares(fit.map((r) => ({ t: r.t / 60, y: r.rendererMB }))) : null;

/** Net growth, and how much of it was one-directional. A series that climbs and
 *  falls back is a cache breathing; one that only ever climbs is a leak. */
function monotone(series) {
  if (series.length < 3) return { netMB: 0, upFraction: 0 };
  let up = 0;
  for (let i = 1; i < series.length; i++) if (series[i] >= series[i - 1]) up++;
  return {
    netMB: +(series[series.length - 1] - series[0]).toFixed(2),
    upFraction: +(up / (series.length - 1)).toFixed(2),
  };
}
const procMono = haveProc ? monotone(fit.map((r) => r.rendererMB)) : null;

const last = rows[rows.length - 1];
const elapsed = last.t;
const frames = last.frames;
const minFrames = Math.round(MIN_FPS_FOR_A_MEASUREMENT * elapsed);
const expectedSamples = Math.floor(SECONDS / EVERY) + 1;

const fails = [];
const gameCalls = lastGameCalls !== null && gameCallsAtStart !== null ? lastGameCalls - gameCallsAtStart : null;
if (gameCalls === null) {
  fails.push('MEASURED NOTHING: __NT.stats().renderCallsTotal was never readable, so nothing '
    + 'proves the game loop rendered. A flat heap on a dead page is not a pass.');
} else if (gameCalls <= minFrames || starvedSamples.length > 0) {
  fails.push('MEASURED NOTHING: the game loop made ' + gameCalls + ' render calls in ' + elapsed
    + 's (a live loop owes at least ' + minFrames + ')'
    + (starvedSamples.length ? '; it stalled in ' + starvedSamples.length + ' sample(s) at t=' + starvedSamples.join(',') : '')
    + '. Our own rAF tick counted ' + frames + ' frames - that is the PAGE alive, not the game.');
}
if (rows.length < expectedSamples - 1 || fit.length < 3) {
  fails.push('too few samples: ' + rows.length + ' of ' + expectedSamples
    + ' (' + fit.length + ' after t+' + SLOPE_FROM + 's)');
}
if ((js.slope >= MAX_SLOPE && js.r2 >= MIN_R2) || js.slope >= 2 * MAX_SLOPE) {
  fails.push('JS post-GC floor climbing ' + js.slope + ' MB/min (limit ' + MAX_SLOPE + ' with r2 >= '
    + MIN_R2 + ', or ' + 2 * MAX_SLOPE + ' at any fit), r2 ' + js.r2);
} else if (js.slope >= MAX_SLOPE) {
  console.log('[soak] note: JS slope ' + js.slope + ' MB/min is over ' + MAX_SLOPE + ' but r2 ' + js.r2
    + ' < ' + MIN_R2 + ' - a fit to floor noise, not a trend; widen --seconds if it recurs');
}
// 0.6, not 0.8: the verifier's injected 12.8 MB/min run reached only 67% of steps up
// because the working set breathes; net growth over the limit with a clear majority of
// steps up is the leak signature, 80% was the boundary case.
if (haveProc && procMono.netMB > MAX_EXTERNAL_MB && procMono.upFraction >= 0.6) {
  fails.push('renderer working set grew ' + procMono.netMB + ' MB monotonically ('
    + Math.round(procMono.upFraction * 100) + '% of steps up), limit ' + MAX_EXTERNAL_MB + ' MB');
}
if (!haveProc) {
  fails.push('the process series was not readable - Runtime.getHeapUsage alone is BLIND to '
    + 'typed-array and external memory, so this run cannot claim an external leak did not happen');
}

console.log('\n[soak] ' + rows.length + ' samples, ' + fit.length + ' fitted (t >= ' + SLOPE_FROM + 's)');
console.log('[soak] JS post-GC floor   slope ' + js.slope + ' MB/min   r2 ' + js.r2
  + '   ' + rows[0].floorMB + ' -> ' + last.floorMB + ' MB   (limit ' + MAX_SLOPE + ')');
console.log('[soak] renderer process   '
  + (haveProc
    ? 'slope ' + proc.slope + ' MB/min   r2 ' + proc.r2 + '   net ' + procMono.netMB
      + ' MB over the fit, ' + Math.round(procMono.upFraction * 100) + '% of steps up   (limit '
      + MAX_EXTERNAL_MB + ' MB monotonic)'
    : 'UNREADABLE'));
console.log('[soak] gpu process ' + (last.gpuProcMB ?? '?') + ' MB   whole Chrome '
  + (last.chromeTotalMB ?? '?') + ' MB   V8 committed ' + (last.v8HeapTotalMB ?? '?') + ' MB');
console.log('[soak] measureUserAgentSpecificMemory: ' + uaMemoryNote);
console.log('[soak] resources  geometries ' + rows[0].geometries + ' -> ' + last.geometries
  + '   textures ' + rows[0].textures + ' -> ' + last.textures
  + '   programs ' + rows[0].programs + ' -> ' + last.programs
  + '   DOM nodes ' + (rows[0].nodes ?? '?') + ' -> ' + (last.nodes ?? '?')
  + '   listeners ' + (rows[0].listeners ?? '?') + ' -> ' + (last.listeners ?? '?'));
console.log('[soak] frames ' + frames + ' in ' + elapsed + 's (' + (frames / elapsed).toFixed(1)
  + ' fps average, floor ' + minFrames + '; game render calls ' + (gameCalls ?? 'unreadable') + ')'
  + (INJECT_KB_S > 0 ? '   injected ' + last.injectedMB + ' MB' : ''));
if (errors.length) console.log('[soak] console errors:\n  ' + errors.slice(0, 6).join('\n  '));

writeFileSync(join(OUT, `${tag}-soak.json`), JSON.stringify({
  url, tag, seconds: SECONDS, every: EVERY, slopeFrom: SLOPE_FROM,
  injectKbPerSecond: INJECT_KB_S, limits: { maxSlopeMBPerMin: MAX_SLOPE, maxExternalMB: MAX_EXTERNAL_MB },
  js, proc, procMono, uaMemoryNote, frames, elapsed, fails, rows,
}, null, 2));

await browser.close();
killTree(chrome.pid);

if (fails.length) {
  console.log('[soak] FAIL\n  - ' + fails.join('\n  - '));
  process.exit(1);
}
console.log('[soak] PASS - JS floor flat and the renderer process did not climb');
