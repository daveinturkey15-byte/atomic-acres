/** Retained neutral component only: no rebuild, gameplay, audio or throughput claim. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { stockBrowser } from './lib/stock-browser.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RETAINED = 'captures/overnight-heavy-neutral-repair1';
const args = process.argv.slice(2);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const MODEL = 'assets/reference-weapons/minigun/minigun-fp-lod0.glb';
const PINS = Object.freeze({
  'index.html': 'ec9e1a7ca1ed63c24035f8b9cd30760ff11be88f11a681ea932299b612c3774f',
  'inspection-identity.json': '1cd713808af7746b287d41bb17f529b459b7e188b93033072e3483d1b1ec3507',
  'inspection.js': '04f5a92b515b9927b3fe1187a852e40475d5076477a0ab92629a342d56795497',
  [MODEL]: 'bc7c965c3931ca2cce575a98552532b46fae11f41e313d3b03940cf726583a3b',
});
// buildMaterials() requests these even though this viewer has no vegetation meshes.
// Exact additional public-file routes approved by the integrator; no directory fallback.
const TEXTURES = Object.freeze({
  'island_tree_01_leaves_alpha_1k.png': 'f4341f147988dbe6b58d9ca841a8f0e4bcff25bc40d05f9877da82006d489c39',
  'island_tree_01_leaves_diff_1k.png': '63d3563a22a62151f338ceb4e992de7c31b62e8e3582e2762d5071f02d286349',
  'island_tree_01_leaves_nor_gl_1k.png': 'e58402f30c7108ec6321e0c689009508f6ab138c81612d9a67238038ac108211',
  'island_tree_01_leaves_rough_1k.png': 'b7e9a1857f63617344968bb43693786bfed7dd15bedca3193ce333f233fbab78',
});
// Repair 1: exactly the additional 404 routes retained in pixels-v1/report.json.
const MATERIAL_TEXTURES = Object.freeze({
  'assets/street-pbr/asphalt_diff_1k.jpg': '1aa5ce99f58a625c71d48cfc3e68b65ca85ccb00f39e045c0a928608a0ea25ed',
  'assets/street-pbr/asphalt_rough_1k.jpg': '70ba3edc65525eb4dc366cf010ca7ae0bd34e0251ff0225c2dad627a873d0712',
  'assets/street-pbr/asphalt_nor_gl_1k.jpg': '42a1c381b53204e83a982db2864479a30bc127bbdeebb1006f8ee51bff099df3',
  'assets/street-pbr/pavement_diff_1k.jpg': 'e129ee6b59b6ed7f65b4c4c5ba9eb583d13d040ec26bef5d5d4e0080fe342e7a',
  'assets/street-pbr/pavement_rough_1k.jpg': '966ee3d1a6d343e5e72d5536fde7c04ecd32e6e95efc879a102effc527f5b679',
  'assets/street-pbr/pavement_nor_gl_1k.jpg': '26c09320b3373da7f55edb8165562f16d36c07161c9c715787a09daf5910450c',
  'textures/polyhaven/concrete-pavement-03/diffuse.jpg': '0c23759579103fc334bb9211c71fd026322b44fceb9cdeba8f2d7e0b17fefc8e',
  'textures/polyhaven/concrete-pavement-03/rough.jpg': '89876ea83fe2e8e14a0349607f3fd9174c14a7e9a01b56d91e49adb0b7484c09',
  'textures/polyhaven/concrete-pavement-03/normal.jpg': 'b3d20510e5f6625c264a6491c343d025cfff8ab525d08363a42f21afb0e1d5e0',
  'textures/polyhaven/distressed-painted-planks/diffuse.jpg': 'ec8d54700e32d583ec3cd64089de73810de1e177874266fe29e931d33ab5ca1e',
  'textures/polyhaven/distressed-painted-planks/rough.jpg': 'e264068652b135ed477ea123a751c83bb33d6693e16f4c4458dc57bca6ae675c',
  'textures/polyhaven/distressed-painted-planks/normal.jpg': '65372398238b1a4d723e414b195e94900e076fa63d9409c5acc9b55d795abe88',
  'assets/wooden-planks/wooden_planks_diff_1k.jpg': '1273876d6f92fb1a1d29c1bb28f548a9256154187531e84f993b56e347f1d17b',
  'assets/wooden-planks/wooden_planks_rough_1k.jpg': 'c1b1a7e3266a082d66f1c786a28a05674227158684d655e42ab2420e47ae746e',
  'assets/wooden-planks/wooden_planks_nor_gl_1k.jpg': '6c85ff0a410a2993cc09d25859d7d735bc05e9f15dc51393d2e58aa2ce8a0916',
});
const SHOTS = Object.freeze([
  ...['front', 'left', 'right', 'threeQuarter'].map(view => ({ name: view, view, reload: 0 })),
  ...[.25, .5, .75].map(reload => ({ name: `threeQuarter-reload-${reload}`, view: 'threeQuarter', reload })),
]);
function verifyBytes(bytes, expected, label) {
  assert.equal(sha(bytes), expected, `Identity mismatch: ${label}`); return bytes;
}
function preflight() {
  const routes = new Map(), files = [];
  function add(route, path, expected) {
    const bytes = verifyBytes(readFileSync(join(ROOT, path)), expected, path);
    routes.set(route, bytes); files.push({ route, path, sha256: sha(bytes), bytes: bytes.length });
  }
  for (const [file, expected] of Object.entries(PINS)) add('/' + file, `${RETAINED}/${file}`, expected);
  routes.set('/', routes.get('/index.html'));
  for (const [file, expected] of Object.entries(TEXTURES)) {
    const path = `textures/vegetation/${file}`; add('/' + path, `public/${path}`, expected);
  }
  for (const [path, expected] of Object.entries(MATERIAL_TEXTURES)) add('/' + path, `public/${path}`, expected);
  const manifest = JSON.parse(routes.get('/inspection-identity.json').toString('utf8'));
  assert.equal(manifest.bundleSha256, PINS['inspection.js']); assert.equal(manifest.modelSha256, PINS[MODEL]);
  assert.deepEqual(manifest.viewport, [1600, 900]); assert.equal(manifest.DPR, 1);
  assert.equal(Object.keys(manifest.sourceHashes).length, 4);
  const sourceHashes = {};
  for (const [path, expected] of Object.entries(manifest.sourceHashes)) {
    verifyBytes(readFileSync(join(ROOT, path)), expected, path); sourceHashes[path] = expected;
  }
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 5000 });
  assert.equal(git.status, 0);
  return { routes, identity: { retained: RETAINED, manifest, currentHead: git.stdout.trim(), sourceHashes, files,
    note: 'Manifest commit is retained build metadata. All four current source-content hashes must match, regardless of later commits.' } };
}
function resources() {
  const run = (exe, argv) => spawnSync(exe, argv, { encoding: 'utf8', windowsHide: true, timeout: 15000 });
  const gpu = run('nvidia-smi', ['--query-gpu=name,memory.free,utilization.gpu', '--format=csv,noheader,nounits']);
  const ram = run('powershell', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory']);
  assert.equal(gpu.status, 0, 'Cannot measure GPU headroom'); assert.equal(ram.status, 0, 'Cannot measure RAM');
  const freeMiB = Number(gpu.stdout.trim().split('\n')[0].split(',')[1]);
  const freeGiB = Number(ram.stdout.trim()) / 1048576;
  assert(freeMiB >= 4096 && freeGiB >= 14, 'HOLD: requires at least 4 GiB free VRAM and 14 GiB free RAM');
  return { at: new Date().toISOString(), gpu: gpu.stdout.trim(), freeRamGiB: freeGiB };
}
function routePath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.includes('\\') || raw.includes('%') || raw.includes('..')) return null;
  return raw.split('?')[0];
}
function makeServer(routes, requests) {
  return createServer((req, res) => {
    const path = routePath(req.url), bytes = routes.get(path);
    const methodOK = req.method === 'GET' || req.method === 'HEAD';
    const status = !methodOK ? 405 : path === '/favicon.ico' ? 204 : bytes ? 200 : 404;
    requests.push({ at: new Date().toISOString(), method: req.method, path: req.url, status });
    const type = path?.endsWith('.js') ? 'text/javascript' : path?.endsWith('.json') ? 'application/json'
      : path?.endsWith('.png') ? 'image/png' : path?.endsWith('.jpg') ? 'image/jpeg'
      : path?.endsWith('.glb') ? 'model/gltf-binary' : 'text/html';
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(status === 200 && req.method !== 'HEAD' ? bytes : undefined);
  });
}
function stateInPage() {
  const canvas = document.querySelector('canvas');
  return { ...window.__HEAVY_INSPECT.stats(), ready: document.documentElement.dataset.ready,
    viewport: [innerWidth, innerHeight, devicePixelRatio], buffer: [canvas.width, canvas.height],
    header: document.querySelector('header').textContent.trim(), effectiveURL: location.href };
}
if (args.includes('--self-test')) {
  const { routes, identity } = preflight();
  assert.equal(routes.size, 24); assert.equal(SHOTS.length, 7);
  const failure = JSON.parse(readFileSync(join(ROOT, 'captures/overnight-heavy-neutral-pixels-v1/report.json'), 'utf8'));
  const missing = [...new Set(failure.requests.filter(r => r.status === 404).map(r => r.path.slice(1)))].sort();
  assert.deepEqual(Object.keys(MATERIAL_TEXTURES).sort(), missing, 'Repair must add exactly the observed missing routes');
  for (const path of missing) assert(routes.has('/' + path));
  for (const path of ['/../secret', '/%2e%2e/secret', '/textures\\secret', 'http://outside/']) assert.equal(routePath(path), null);
  assert.equal(routePath('/inspection.js?x=1'), '/inspection.js');
  assert.throws(() => verifyBytes(Buffer.from('tampered'), PINS['inspection.js'], 'negative fixture'));
  assert(!routes.has('/src/core/materials.ts')); assert(!routes.has('/textures/vegetation/unknown.png'));
  console.log(JSON.stringify({ status: 'PASS CPU only', files: identity.files.length, sourceHashes: identity.sourceHashes,
    head: identity.currentHead, shots: SHOTS, negativeChecks: ['hash tampering', 'path escape', 'unlisted source/asset'],
    launches: 'No server, browser, renderer, build or GPU work' }, null, 2)); process.exit(0);
}

const tagIndex = args.indexOf('--tag'), tag = tagIndex < 0 ? '' : args[tagIndex + 1];
assert(/^[a-z0-9][a-z0-9-]{2,79}$/.test(tag ?? ''), 'Provide unique --tag with lowercase letters, numbers and hyphens');
const out = join(ROOT, 'captures', tag); assert(!existsSync(out), 'Refusing to overwrite retained capture directory');
const { routes, identity } = preflight(), resourceBefore = resources();
mkdirSync(out);
const report = { label: 'NEUTRAL UI COMPONENT CAPTURE ONLY', status: 'RUNNING', startedAt: new Date().toISOString(),
  limitations: 'Neutral lights and camera differ from gameplay. No gameplay, audio, authority, motion throughput, performance or anatomy/art acceptance. Seven discrete poses, not a reload animation recording. No geometry/material/node overrides.',
  identity, resourceBefore, chromeLaunchWindow: [1600, 900], viewport: [1600, 900], DPR: 1,
  requests: [], errors: [], warnings: [], captures: [] };
const server = makeServer(routes, report.requests);
let owned;
const deadline = Date.now() + 300000;
const remaining = () => { const ms = deadline - Date.now(); assert(ms > 0, 'Five-minute wall budget expired'); return ms; };
const timer = setTimeout(() => { report.errors.push('Five-minute wall budget expired'); void owned?.close(); server.closeAllConnections(); }, 300000);
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`; report.origin = origin;
  owned = await stockBrowser('heavy-neutral'); const { page, browser } = owned;
  report.chromeVersion = browser.version(); page.setDefaultTimeout(Math.min(30000, remaining()));
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); if (m.type() === 'warning') report.warnings.push(m.text()); });
  page.on('requestfailed', r => report.errors.push(`Request failed: ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', r => { if (r.status() >= 400) report.errors.push(`HTTP ${r.status()}: ${r.url()}`); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return route.continue();
    report.errors.push(`Unexpected network origin: ${url.origin}`); return route.abort();
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }); await page.bringToFront();
  await page.goto(origin, { waitUntil: 'networkidle', timeout: Math.min(90000, remaining()) });
  await page.waitForFunction(() => document.documentElement.dataset.ready === 'true' && !!window.__HEAVY_INSPECT,
    undefined, { timeout: Math.min(90000, remaining()) });
  for (const shot of SHOTS) {
    remaining();
    await page.evaluate(async s => { await window.__HEAVY_INSPECT.reload(s.reload); await window.__HEAVY_INSPECT.view(s.view); }, shot);
    const state = await page.evaluate(stateInPage);
    assert.equal(state.backend, 'webgpu'); assert.equal(state.view, shot.view); assert.equal(state.reload, shot.reload);
    assert.deepEqual(state.viewport, [1600, 900, 1]); assert.deepEqual(state.buffer, [1600, 900]);
    assert(state.calls > 0 && state.triangles > 0, 'No actual rendered component');
    assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
    const path = join(out, shot.name + '.png');
    const bytes = await page.screenshot({ path, fullPage: false, timeout: Math.min(30000, remaining()) });
    assert.equal(bytes.readUInt32BE(16), 1600); assert.equal(bytes.readUInt32BE(20), 900);
    report.captures.push({ ...shot, path, sha256: sha(bytes), bytes: bytes.length, state });
  }
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  assert(report.requests.every(r => r.status < 400), 'Unknown or refused viewer dependency');
  report.status = 'CAPTURED; VISUAL REVIEW OPEN';
} catch (error) { report.status = 'FAILED'; report.errors.push(error.stack ?? String(error)); process.exitCode = 1; }
finally {
  try { if (owned) await Promise.race([owned.page.evaluate(() => window.__HEAVY_INSPECT?.dispose()),
    new Promise((_, reject) => setTimeout(() => reject(Error('Viewer disposal exceeded two seconds')), 2000))]); }
  catch (e) { report.warnings.push(`Dispose: ${e.message}`); }
  try { await owned?.close(); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  clearTimeout(timer);
  report.finishedAt = new Date().toISOString(); writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ status: report.status, out, captures: report.captures.length, errors: report.errors.length, warnings: report.warnings.length }));
