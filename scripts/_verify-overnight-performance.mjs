/** Profiling-only observer. Run in the root-owned serial GPU slot against a
 * built preview with matching external source maps. Never starts a server. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import sourceMap from 'source-map-js';
import { stockBrowser } from './lib/stock-browser.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (key, fallback) => { const i = argv.indexOf('--' + key); return i < 0 ? fallback : argv[i + 1]; };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(r => setTimeout(r, ms));
const distribution = values => {
  if (!values.length) return { status: 'unavailable', samples: 0 };
  const s = [...values].sort((a, b) => a - b);
  return { status: 'measured', samples: s.length, medianMs: s[Math.floor((s.length - 1) / 2)],
    p95Ms: s[Math.ceil(s.length * .95) - 1], over16_67: s.filter(x => x > 16.67).length,
    over33_33: s.filter(x => x > 33.33).length, maxMs: s.at(-1) };
};
const intervals = times => times.slice(1).map((t, i) => t - times[i]);

// Installed before modules load. Native scheduling handles and timestamp arguments
// pass through unchanged. No callbacks are skipped, added to the game, or delayed.
function installObservers() {
  const nativeRAF = window.requestAnimationFrame.bind(window), ids = new WeakMap();
  const p = window.__OVERNIGHT_PERF = { callbacks: [], selected: -1, recording: false,
    game: [], page: [], submittedCpuMs: [], skipped: 0, configuredDevices: [], errors: [] };
  window.requestAnimationFrame = function (callback) {
    if (typeof callback !== 'function') return nativeRAF(callback);
    if (!ids.has(callback)) { ids.set(callback, p.callbacks.length); p.callbacks.push(callback); }
    const id = ids.get(callback);
    return nativeRAF(function (timestamp) {
      if (!p.recording || id !== p.selected) return callback.call(window, timestamp);
      const before = window.__NT.stats().renderCallsTotal, start = performance.now();
      try { return callback.call(window, timestamp); }
      finally {
        const end = performance.now(), after = window.__NT.stats().renderCallsTotal;
        if (after > before) { p.game.push(start); p.submittedCpuMs.push(end - start); }
        else p.skipped++;
      }
    });
  };
  function pageObserver() { if (p.recording) p.page.push(performance.now()); nativeRAF(pageObserver); }
  nativeRAF(pageObserver);
  // Observe the device actually configured on the game's canvas; do not request
  // another adapter and mistake it for the one selected by Three.
  try {
    const devices = new WeakMap(), request = GPUAdapter.prototype.requestDevice;
    GPUAdapter.prototype.requestDevice = async function (...args) {
      const device = await request.apply(this, args), info = this.info;
      devices.set(device, { adapter: info ? { vendor: info.vendor, architecture: info.architecture,
        device: info.device, description: info.description, isFallbackAdapter: this.isFallbackAdapter ?? null } : null,
      adapterFeatures: [...this.features], deviceFeatures: [...device.features],
      request: { requiredFeatures: [...(args[0]?.requiredFeatures ?? [])], requiredLimits: args[0]?.requiredLimits ?? {} } });
      return device;
    };
    const configure = GPUCanvasContext.prototype.configure;
    GPUCanvasContext.prototype.configure = function (descriptor) {
      const result = configure.call(this, descriptor);
      p.configuredDevices.push({ ...(devices.get(descriptor.device) ?? { adapter: null }),
        format: descriptor.format, canvas: { width: this.canvas.width, height: this.canvas.height } });
      return result;
    };
  } catch (error) { p.errors.push('Adapter observation unavailable: ' + String(error)); }
}

function command(exe, args) {
  const r = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  return r.status === 0 ? r.stdout.trim() : null;
}
function loads() {
  const gpu = command('nvidia-smi', ['--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu', '--format=csv,noheader,nounits']);
  const processRows = command('nvidia-smi', ['--query-compute-apps=pid,process_name,used_gpu_memory', '--format=csv,noheader,nounits']);
  const memoryText = command('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    '$m=Get-CimInstance Win32_OperatingSystem; [PSCustomObject]@{freeKiB=$m.FreePhysicalMemory;totalKiB=$m.TotalVisibleMemorySize}|ConvertTo-Json -Compress']);
  let memory = null; try { memory = JSON.parse(memoryText); } catch { /* unknown must stay unknown */ }
  return { at: new Date().toISOString(), gpu, memory, computeProcesses: processRows,
    attributionLimit: 'nvidia-smi compute list omits some graphics workloads; utilization is whole GPU, not this browser' };
}
function admission(sample, launch = false) {
  const free = Number(sample.gpu?.split('\n')[0]?.split(',').at(-2)?.trim());
  assert(sample.memory && Number.isFinite(free), 'Resource readings unavailable; hold owned browser');
  assert(Number(sample.memory.freeKiB) / 1048576 >= (launch ? 14 : 12), 'RAM reserve/headroom hold');
  assert(free >= (launch ? 4096 : 3072), 'VRAM reserve/headroom hold');
}
function stateInPage() {
  const match = window.__NTGAME.snapshot(), canvas = document.querySelector('canvas[data-nt-backend]');
  return { at: performance.now(), effectiveURL: location.href, atmosphere: window.__NTATMO?.state(), phase: match.match.phase, actorCount: match.actors.length,
    self: match.actors.find(a => a.id === window.__NTGAME.localId), stats: window.__NT.stats(),
    pose: window.__NT.playerPose(), audio: window.__NT.audio(), menu: window.__AA_UI.menu.state(),
    shadowMaterial: window.__NT.shadowMaterial?.() ?? null,
    settings: window.__AA_UI.menu.settings(), environment: window.__NT_ENV, backend: window.__NT_BACKEND,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    canvas: canvas ? { width: canvas.width, height: canvas.height, cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight } : null };
}
async function readJSON(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) }); assert(r.ok, `${url}: ${r.status}`); return r.json();
}

if (argv.includes('--self-test')) {
  assert.equal(distribution([1, 2, 40]).p95Ms, 40); assert.deepEqual(intervals([10, 26, 60]), [16, 34]);
  assert.equal(distribution([]).status, 'unavailable');
  assert.throws(() => admission({ gpu: null, memory: null }));
  const g = new sourceMap.SourceMapGenerator({ file: 'test.js' });
  g.addMapping({ generated: { line: 1, column: 5 }, original: { line: 564, column: 0 }, source: '../../src/main.ts', name: 'frame' });
  const c = new sourceMap.SourceMapConsumer(g.toJSON());
  assert.equal(c.originalPositionFor({ line: 1, column: 5 }).line, 564);
  console.log('PASS CPU-only summary, missing-resource refusal, source-map coordinate checks');
  process.exit(0);
}

const url = opt('url', 'http://127.0.0.1:4360/'), tag = opt('tag', 'overnight-perf-pass1');
const expected = opt('expected-commit', ''), mapDir = resolve(opt('source-map-dir', 'dist-perf-baseline'));
assert(/^[a-z0-9_-]+$/i.test(tag)); assert(/^[a-f0-9]{40}$/.test(expected), 'Exact --expected-commit required');
assert(existsSync(mapDir), 'Matching --source-map-dir required');
const out = join(root, 'captures', 'perf', tag); assert(!existsSync(join(out, 'report.json')), 'Preserve previous report; choose a fresh tag');
mkdirSync(out, { recursive: true });
const report = { status: 'OPEN', startedAt: new Date().toISOString(), url, expected, mapDir,
  sourceBaseline: command('git', ['rev-parse', 'HEAD']), ownerContext: opt('owner-context', 'OPEN: no operator-supplied context'),
  instrumentation: 'Harness-only callback wrapper; two stats reads per selected game frame. Profiler in separate 10s run. No GPU timestamp tracking enabled.',
  runs: [], resources: [], errors: [], mapReceipts: [], callbackCandidates: [], selection: null,
  gpuTiming: { status: 'unavailable', reason: 'r180 trackTimestamp defaults false; this harness changes no renderer/device settings' },
  canary: { status: 'OPEN', reason: 'A human must inspect mapped trace attribution and dependency order before choosing one reversible change' } };
let owned, cdp, browserCDP; const scripts = new Map(), maps = new Map();
const save = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
const deadline = setTimeout(() => { report.errors.push('12-minute harness wall limit'); save(); process.exit(1); }, 12 * 60000);

async function mappedScript(scriptId) {
  const script = scripts.get(scriptId); if (!script?.url?.startsWith(new URL(url).origin)) return null;
  if (maps.has(script.url)) return maps.get(script.url);
  const mapURL = script.sourceMapURL ? new URL(script.sourceMapURL, script.url) : new URL(script.url + '.map');
  const localMap = join(mapDir, 'assets', basename(mapURL.pathname));
  const localJS = join(mapDir, 'assets', basename(new URL(script.url).pathname));
  if (!existsSync(localMap) || !existsSync(localJS)) { maps.set(script.url, null); return null; }
  const response = await fetch(script.url, { signal: AbortSignal.timeout(10000) });
  assert(response.ok); const served = Buffer.from(await response.arrayBuffer()), local = readFileSync(localJS);
  assert.equal(hash(served), hash(local), 'Served JS differs from source-map build');
  const raw = readFileSync(localMap), parsed = JSON.parse(raw), consumer = new sourceMap.SourceMapConsumer(parsed);
  const value = { consumer, parsed, url: script.url };
  report.mapReceipts.push({ url: script.url, jsSha256: hash(served), map: localMap, mapSha256: hash(raw) });
  maps.set(script.url, value); return value;
}
async function selectGameCallback() {
  const length = await owned.page.evaluate(() => window.__OVERNIGHT_PERF.callbacks.length);
  for (let i = 0; i < length; i++) {
    const r = await cdp.send('Runtime.evaluate', { expression: `window.__OVERNIGHT_PERF.callbacks[${i}]` });
    const props = await cdp.send('Runtime.getProperties', { objectId: r.result.objectId, ownProperties: false });
    const location = props.internalProperties?.find(p => p.name === '[[FunctionLocation]]')?.value?.value;
    await cdp.send('Runtime.releaseObject', { objectId: r.result.objectId });
    if (!location) continue;
    const map = await mappedScript(location.scriptId); if (!map) continue;
    const original = map.consumer.originalPositionFor({ line: location.lineNumber + 1, column: location.columnNumber });
    report.callbackCandidates.push({ index: i, location, original });
    if (!original.source?.replaceAll('\\', '/').endsWith('/src/main.ts')) continue;
    const content = map.consumer.sourceContentFor(original.source, true), lines = content?.split('\n') ?? [];
    const declaration = lines.findIndex(l => /^function frame\(\): void/.test(l)) + 1;
    if (!declaration || Math.abs(original.line - declaration) > 1) continue;
    assert.equal(report.selection, null, 'Multiple game callback candidates; refuse ambiguous timing');
    report.selection = { index: i, original, declaration, method: 'CDP FunctionLocation mapped to exact src/main.ts frame declaration' };
  }
  if (report.selection) await owned.page.evaluate(i => { window.__OVERNIGHT_PERF.selected = i; }, report.selection.index);
}
async function route(milliseconds, collect = false) {
  const points = [{ name: 'spawnA', x: -4, z: -34.3, yaw: Math.PI },
    { name: 'circle', x: -6, z: 0, yaw: -Math.PI / 2 }, { name: 'orangeInside', x: .8, z: -20.5, yaw: Math.PI }];
  const samples = [], started = performance.now();
  for (let k = 0; k < points.length; k++) {
    const p = points[k];
    await owned.page.evaluate(point => { window.__NT.teleport(point.x, 0, point.z, point.yaw, 0); window.__NT.release(); }, p);
    const stop = started + milliseconds * (k + 1) / points.length;
    let n = 0;
    while (performance.now() < stop) {
      const key = n++ % 2 === 0 ? 'KeyA' : 'KeyD';
      await owned.page.keyboard.down(key);
      await pause(Math.max(0, Math.min(1000, stop - performance.now())));
      await owned.page.keyboard.up(key);
      const s = await owned.page.evaluate(stateInPage);
      assert.equal(s.phase, 'active', 'Active gameplay required throughout route');
      assert.equal(s.menu.surface, 'hidden', 'Menu/pause frames are not gameplay');
      assert.equal(s.stats.mode, 'walk'); assert(s.actorCount > 1, 'Actual bots required');
      assert.equal(s.audio.state, 'running', 'WebAudio must remain active while browser output is muted');
      if (collect) samples.push({ station: p.name, ...s });
    }
  }
  return { elapsedMs: performance.now() - started, samples };
}
async function profile() {
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  await cdp.send('Profiler.start'); const routeResult = await route(10000);
  const { profile: raw } = await cdp.send('Profiler.stop'); await cdp.send('Profiler.disable');
  writeFileSync(join(out, 'active-route.cpuprofile'), JSON.stringify(raw));
  const nodes = new Map(raw.nodes.map(n => [n.id, n])), parents = new Map(), aggregate = new Map();
  for (const n of raw.nodes) for (const child of n.children ?? []) parents.set(child, n.id);
  for (const n of raw.nodes) {
    const m = await mappedScript(n.callFrame.scriptId);
    n.original = m?.consumer.originalPositionFor({ line: n.callFrame.lineNumber + 1, column: n.callFrame.columnNumber }) ?? null;
  }
  writeFileSync(join(out, 'active-route-mapped.json'), JSON.stringify(raw));
  let totalUs = 0, mappedUs = 0;
  for (let i = 0; i < (raw.samples?.length ?? 0); i++) {
    const us = raw.timeDeltas[i] ?? 0, leaf = nodes.get(raw.samples[i]); totalUs += us;
    if (leaf?.original?.source) mappedUs += us;
    let id = raw.samples[i]; const visited = new Set(), locations = new Set();
    while (id && !visited.has(id)) {
      visited.add(id); const node = nodes.get(id); if (!node) break;
      const f = node.original, key = f?.source ? `${f.source}:${f.line}:${f.column} ${f.name ?? node.callFrame.functionName}`
        : `${node.callFrame.url || '(V8/native)'}:${node.callFrame.lineNumber + 1} ${node.callFrame.functionName}`;
      if (locations.has(key)) { id = parents.get(id); continue; } locations.add(key);
      const a = aggregate.get(key) ?? { location: key, mapped: !!f?.source, selfUs: 0, inclusiveUs: 0 };
      if (id === raw.samples[i]) a.selfUs += us; a.inclusiveUs += us; aggregate.set(key, a); id = parents.get(id);
    }
  }
  const rows = [...aggregate.values()];
  return { elapsedMs: routeResult.elapsedMs, samplingIntervalUs: 1000, sampledUs: totalUs, mappedLeafPercent: 100 * mappedUs / Math.max(1, totalUs),
    topSelf: rows.sort((a, b) => b.selfUs - a.selfUs).slice(0, 40),
    topInclusive: rows.sort((a, b) => b.inclusiveUs - a.inclusiveUs).slice(0, 40),
    gcSampleUs: rows.filter(x => x.location.includes('(garbage collector)')).reduce((sum, x) => sum + x.selfUs, 0),
    limit: 'Sampling attribution, not exact function duration or GPU completion. GC sample time is not a complete GC-event census.' };
}

try {
  report.identity = await readJSON(new URL('preview-identity.json', url));
  assert.equal(report.identity.project, 'atomic-acres'); assert.equal(report.identity.sourceCommit, expected);
  report.resources.push(loads()); admission(report.resources.at(-1), true);
  owned = await stockBrowser(tag); const { page } = owned;
  await page.setViewportSize({ width: 1920, height: 1080 });
  cdp = await page.context().newCDPSession(page); browserCDP = await owned.browser.newBrowserCDPSession();
  // Clear Playwright's focus emulation; test Chrome's native focus/lock path.
  // This is a profiling-harness hypothesis, not a product repair or lock spoof.
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await page.bringToFront();
  await cdp.send('Debugger.enable'); cdp.on('Debugger.scriptParsed', s => scripts.set(s.scriptId, s));
  report.browserVersion = await browserCDP.send('Browser.getVersion'); report.systemInfo = await browserCDP.send('SystemInfo.getInfo');
  report.launchFlags = ['--headless=new', '--mute-audio', '--remote-debugging-port=<owned>', '--user-data-dir=<temporary owned>',
    '--no-first-run', '--no-default-browser-check', '--window-size=1600,900', 'about:blank'];
  report.focusHandling = { emulationEnabled: false, broughtToFront: true,
    permissionOverride: false, pointerLock: 'Required from ordinary trusted Deploy/canvas clicks' };
  report.requestedViewport = { width: 1920, height: 1080, launchWindowFlag: '1600,900' };
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text().slice(0, 500)); });
  await page.addInitScript(installObservers); await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT?.ready && window.__NT.stats().fps > 0, null, { timeout: 90000 });
  await page.getByRole('button', { name: 'Play solo', exact: true }).click();
  report.setup = await page.locator('input,select').evaluateAll(elements => elements.map(e => ({ label: e.getAttribute('aria-label') || e.id, value: e.value })));
  await page.getByLabel('Time limit', { exact: true }).selectOption('600000');
  await page.getByLabel('Kill limit', { exact: true }).selectOption('100');
  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  await page.waitForFunction(() => { try { return window.__NTGAME.snapshot().match.phase === 'active'; } catch { return false; } }, null, { timeout: 30000 });
  await page.locator('canvas[data-nt-backend]').click();
  await page.waitForFunction(() => !!document.pointerLockElement, null, { timeout: 5000 });
  report.initial = await page.evaluate(stateInPage); assert.equal(report.initial.backend.actual, 'webgpu');
  await selectGameCallback();
  report.deviceObservation = await page.evaluate(() => ({ configured: window.__OVERNIGHT_PERF.configuredDevices, errors: window.__OVERNIGHT_PERF.errors }));
  for (let i = 0; i < 3; i++) {
    console.log(`[perf] warm-up ${i + 1}/3 (10s)`); await route(10000);
    await page.evaluate(() => { const p = window.__OVERNIGHT_PERF; p.game = []; p.page = []; p.submittedCpuMs = []; p.skipped = 0; p.recording = true; });
    console.log(`[perf] baseline ${i + 1}/3 (45s)`); const result = await route(45000, true);
    const measured = await page.evaluate(() => { const p = window.__OVERNIGHT_PERF; p.recording = false; return { game: p.game, page: p.page, submittedCpuMs: p.submittedCpuMs, skipped: p.skipped }; });
    if (report.selection) assert(measured.game.length >= 2, 'MEASURED NOTHING: identified game callback did not render');
    report.runs.push({ ...result, ...measured, gameFrames: report.selection ? distribution(intervals(measured.game)) : { status: 'unavailable', reason: 'Exact game callback not identified' },
      gameObservedFramesPerSecond: report.selection ? measured.game.length / (result.elapsedMs / 1000) : null,
      gameSubmittedCpu: distribution(measured.submittedCpuMs), pageRaf: distribution(intervals(measured.page)),
      pageRafCallbacksPerSecond: measured.page.length / (result.elapsedMs / 1000),
      gameHudFpsSamples: result.samples.map(s => s.stats.fps) });
    await page.screenshot({ path: join(out, `run-${i + 1}-interior.png`) });
    report.resources.push(loads()); admission(report.resources.at(-1)); save();
  }
  console.log('[perf] separate source-mapped CPU sample (10s)'); report.profile = await profile();
  report.final = await page.evaluate(stateInPage);
  report.status = report.errors.length ? 'FAILED' : report.selection && report.mapReceipts.length ? 'MEASURED' : 'PARTIAL';
  report.acceptance = 'No 60 FPS or performance-canary acceptance inferred automatically; inspect trace, distributions and frames';
  assert.equal(report.errors.length, 0, 'Browser errors retained in report');
} catch (error) { report.status = 'FAILED'; report.errors.push(String(error.stack ?? error)); process.exitCode = 1; }
finally {
  clearTimeout(deadline); report.finishedAt = new Date().toISOString(); save();
  if (owned) await owned.close();
  console.log(`[perf] ${report.status}: ${join(out, 'report.json')}`);
}
