/** Paired full-frame shadow diagnostics. Static QA-held cameras, NOT gameplay
 * throughput or automatic art acceptance. Serial root-owned browser slot only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stockBrowser } from './lib/stock-browser.mjs';
import { waitForRenderedPage } from './lib/render-ready.mjs';
import { measureFrame, sceneWasMeasured } from './lib/measure-frame.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..'), args = process.argv.slice(2);
const opt = (key, fallback) => { const i = args.indexOf('--' + key); return i < 0 ? fallback : args[i + 1]; };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const D = Math.PI / 180;
const STATIONS = Object.freeze({
  yardOrange: { pos: [10, 8.5, -38], yaw: 149.5 * D, pitch: -14 * D, fov: 62 },
  midStreet: { pos: [0, 1.68, 0], yaw: Math.PI, pitch: 0, fov: 72 },
  interiorOrange: { pos: [0, 1.68, -18.5], yaw: Math.PI, pitch: 0, fov: 72 },
  turningHead: { pos: [-14, 2.6, 1], yaw: -90 * D, pitch: -1 * D, fov: 72 },
});
const SIDES = [
  { label: 'baseline', url: opt('baseline-url', 'http://127.0.0.1:4360/'),
    commit: 'ac3f1d45b31c5516fa9504980ce4aa4828674ffa', entry: '567d233ee689950bebc44f0d535951a140a13d2f6c9def48b5390973e7052180' },
  { label: 'canary', url: opt('canary-url', 'http://127.0.0.1:4361/?shadow-material=canary'),
    commit: '2f4d577227416c0f1a52dc65002534e019d11947', entry: 'f248c20746ecbb205167ab354c803f899910515fb1e925e184b2d1be4f2de71f' },
];
const sameStation = (a, b) => JSON.stringify({ pos: a.pos, yaw: a.yaw, pitch: a.pitch, fov: a.fov ?? 72 }) === JSON.stringify(b);

function resources() {
  const run = (exe, argv) => spawnSync(exe, argv, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const gpu = run('nvidia-smi', ['--query-gpu=name,memory.free,utilization.gpu', '--format=csv,noheader,nounits']);
  const ram = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory']);
  assert.equal(gpu.status, 0); assert.equal(ram.status, 0);
  const freeMiB = Number(gpu.stdout.trim().split('\n')[0].split(',')[1]), freeGiB = Number(ram.stdout.trim()) / 1048576;
  assert(freeMiB >= 4096 && freeGiB >= 14, 'Hold: launch reserves/headroom unavailable');
  return { at: new Date().toISOString(), gpu: gpu.stdout.trim(), freeRamGiB: freeGiB };
}
async function verifyIdentity(side) {
  const response = await fetch(new URL('preview-identity.json', side.url), { signal: AbortSignal.timeout(5000) });
  assert(response.ok); const identity = await response.json();
  assert.equal(identity.project, 'atomic-acres'); assert.equal(identity.sourceCommit, side.commit);
  assert.equal(identity.entrySha256, side.entry);
  const entry = await fetch(new URL(identity.entry, side.url), { signal: AbortSignal.timeout(10000) });
  assert(entry.ok); assert.equal(sha(Buffer.from(await entry.arrayBuffer())), side.entry, 'Actual entry bytes differ');
  return identity;
}
function pageState() {
  const canvas = document.querySelector('canvas[data-nt-backend]');
  const snapshot = window.__NTGAME.snapshot();
  return { effectiveURL: location.href, backend: window.__NT_BACKEND, viewport: [innerWidth, innerHeight, devicePixelRatio],
    buffer: canvas ? [canvas.width, canvas.height] : null, settings: window.__AA_UI.menu.settings(),
    atmosphere: window.__NTATMO.state(), audio: window.__NT.audio(), pose: window.__NT.playerPose(),
    menu: window.__AA_UI.menu.state(), phase: snapshot.match.phase, actorCount: snapshot.actors.length,
    actors: window.__NTGAME.bots(), shadowMaterial: window.__NT.shadowMaterial?.() ?? null };
}
// Full decoded images, no mask, crop, rescale, threshold gate or rewritten output.
async function pixelMetrics(page, a, b) {
  return page.evaluate(async ([first, second]) => {
    async function decode(base64) {
      const image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, rgba: context.getImageData(0, 0, image.width, image.height).data };
    }
    const [x, y] = await Promise.all([decode(first), decode(second)]);
    if (x.width !== y.width || x.height !== y.height) throw Error('Pair dimensions differ');
    let sum = 0, maximum = 0, changed = 0, aLuma = 0, bLuma = 0;
    for (let i = 0; i < x.rgba.length; i += 4) {
      let difference = false;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(x.rgba[i + c] - y.rgba[i + c]); sum += d; maximum = Math.max(maximum, d); difference ||= d > 0;
      }
      if (difference) changed++;
      aLuma += .2126 * x.rgba[i] + .7152 * x.rgba[i + 1] + .0722 * x.rgba[i + 2];
      bLuma += .2126 * y.rgba[i] + .7152 * y.rgba[i + 1] + .0722 * y.rgba[i + 2];
    }
    const pixels = x.width * x.height;
    return { width: x.width, height: x.height, meanAbsoluteRGB: sum / (pixels * 3), maxChannelDifference: maximum,
      changedPixelPercent: 100 * changed / pixels, meanLuma: [aLuma / pixels, bLuma / pixels],
      acceptance: 'UNASSESSED: diagnostic full-frame metrics; human inspection required, including small defects' };
  }, [a.toString('base64'), b.toString('base64')]);
}

if (args.includes('--self-test')) {
  assert(sameStation({ ...STATIONS.midStreet, fov: undefined }, STATIONS.midStreet));
  assert(!sameStation({ ...STATIONS.midStreet, yaw: 0 }, STATIONS.midStreet));
  assert.equal(Object.keys(STATIONS).length, 4); assert(SIDES.every(s => /^[a-f0-9]{40}$/.test(s.commit) && /^[a-f0-9]{64}$/.test(s.entry)));
  console.log('PASS CPU-only frozen station and identity-pin checks; no browser launched'); process.exit(0);
}
const tag = opt('tag', 'overnight-shadow-pixels'); assert(/^[a-z0-9_-]+$/i.test(tag));
const out = join(ROOT, 'captures', 'perf', tag); assert(!existsSync(out), 'Preserve prior captures: choose a fresh tag');
mkdirSync(out, { recursive: true });
const report = { status: 'OPEN', startedAt: new Date().toISOString(), stations: STATIONS,
  disclosure: 'Static QA-held post-chain views, no viewmodel; match simulation held by existing goto API. Full-page PNGs retain HUD. Not gameplay FPS or art acceptance.',
  viewport: [1600, 900], sides: [], pairs: [], errors: [] };
let owned;
const save = () => writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
const deadline = setTimeout(() => { report.errors.push('8-minute wall limit'); save(); process.exit(1); }, 8 * 60000);
try {
  // Verify both identities before creating any browser/GPU workload.
  for (const side of SIDES) side.identity = await verifyIdentity(side);
  for (const side of SIDES) {
    const record = { ...side, resources: resources(), frames: [] }; report.sides.push(record);
    owned = await stockBrowser(`${tag}-${side.label}`); const { page } = owned;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }); await page.bringToFront();
    const browserCDP = await owned.browser.newBrowserCDPSession();
    record.browser = await browserCDP.send('Browser.getVersion'); record.gpuInfo = await browserCDP.send('SystemInfo.getInfo');
    page.on('pageerror', error => report.errors.push(`${side.label}: ${String(error)}`));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(`${side.label}: ${message.text()}`); });
    await page.goto(side.url, { waitUntil: 'load', timeout: 90000 }); await waitForRenderedPage(page, 90000);
    const definitions = await page.evaluate(() => window.__NT.stations);
    for (const [name, station] of Object.entries(STATIONS)) assert(sameStation(definitions[name], station), `Frozen station mismatch: ${name}`);
    await page.getByRole('button', { name: 'Play solo', exact: true }).click();
    await page.getByLabel('Bots', { exact: true }).evaluate(input => { input.value = '1'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.getByRole('radio', { name: 'Recruit', exact: true }).click();
    await page.getByRole('button', { name: 'Deploy', exact: true }).click();
    await page.waitForFunction(() => { try { return window.__NTGAME.snapshot().match.phase === 'active'; } catch { return false; } }, null, { timeout: 30000 });
    for (const [name, station] of Object.entries(STATIONS)) {
      assert.equal(await page.evaluate(name => window.__NT.goto(name), name), true);
      let measured;
      for (let i = 0; i < 3; i++) measured = await measureFrame(page);
      assert(sceneWasMeasured(measured), 'MEASURED NOTHING: a cached quad is not a scene');
      const state = await page.evaluate(pageState);
      assert.equal(state.backend.actual, 'webgpu'); assert.deepEqual(state.viewport, [1600, 900, 1]); assert.deepEqual(state.buffer, [1600, 900]);
      assert.equal(state.menu.surface, 'hidden'); assert.equal(state.audio.state, 'running');
      assert.deepEqual([state.pose.camX, state.pose.camY, state.pose.camZ], station.pos);
      const file = `${side.label}-${name}.png`, bytes = await page.screenshot({ path: join(out, file), type: 'png', fullPage: false });
      record.frames.push({ name, file, sha256: sha(bytes), measured, state });
      if (side.label === 'canary') {
        assert(state.shadowMaterial?.installed && state.shadowMaterial.variants > 0 && state.shadowMaterial.routed > 0,
          'Canary must actually route shadow draws');
        const baseline = report.sides[0].frames.find(f => f.name === name);
        assert.deepEqual(state.settings, baseline.state.settings, 'Quality/settings mismatch');
        for (const key of ['tod', 'weather', 'lighting', 'lights', 'shadow']) assert.deepEqual(state.atmosphere[key], baseline.state.atmosphere[key]);
        const first = new URL(baseline.state.effectiveURL), second = new URL(state.effectiveURL);
        assert.equal(second.searchParams.get('shadow-material'), 'canary'); second.searchParams.delete('shadow-material');
        first.searchParams.sort(); second.searchParams.sort(); assert.equal(first.search, second.search, 'Unexpected query difference');
        report.pairs.push({ name, files: [baseline.file, file], metrics: await pixelMetrics(page, readFileSync(join(out, baseline.file)), bytes) });
      }
      save(); console.log(`[shadow-pixels] ${side.label} ${name}: captured full frame`);
    }
    await owned.close(); owned = null; // Strictly serial: baseline browser closes before canary opens.
  }
  assert.equal(report.errors.length, 0); report.status = 'CAPTURED_FOR_REVIEW';
} catch (error) { report.status = 'FAILED'; report.errors.push(String(error.stack ?? error)); process.exitCode = 1; }
finally { clearTimeout(deadline); if (owned) await owned.close(); report.finishedAt = new Date().toISOString(); save(); console.log(`[shadow-pixels] ${report.status}: ${out}`); }
