/**
 * Facade detail canary A/B — baseline vs ?facade=canary over the REAL game bundle.
 *
 * AUTHORED FOR ROOT TO RUN. DO NOT LAUNCH IN SUB-AGENT WORKTREE.
 * SOURCE script only: root runs it, then LOOKS at the frames.
 *
 * Stations (fixed, read off the live page — never hardcoded coordinates):
 *   yardWhite, yardOrange, streetElevation (all fidelity stations with refs).
 * Compare each canary frame against:
 *   docs/reference/refinement-targets/yard-white.png, and the
 *   captures/connected-terrain-relief-0004/{baseline,old-canary}-*.png set.
 *
 * Route discipline (same as scripts/assets/environment-comparison-harness.mjs):
 * - Owned stock Chrome via scripts/lib/stock-browser.mjs (real WebGPU adapter;
 *   Playwright's bundled Chromium has none and would measure the WebGL2
 *   fallback with the post chain off).
 * - Explicit --url/--dist (4188 preview disallowed, same reason as env-cmp).
 * - window.__NT.ready, then __NT.goto(station) (QA render path, viewmodel
 *   hidden) with measureFrame() render-delta stats — a station that reports
 *   no draw calls prints MEASURED NOTHING and fails.
 *
 * Asserts per station, both modes:
 * - real WebGPU renderer + post: window.__NT_BACKEND.actual plus
 *   window.__NTPOST.backend (renderer.ts actualBackend + post.ts buildPost,
 *   same proof as scripts/capture-mortar-live.mjs). navigator.gpu alone is
 *   API existence, not backend proof; the canvas dataset mirror is never read
 *   (querySelector('canvas') hits the HUD minimap canvas, not the renderer, so
 *   it reported null on a real WebGPU frame and failed the run pre-capture).
 * - rendered frame (luma >= 40, the playcap dark-frame gate)
 * - draws/triangles measured; absolute budgets <1200 calls / <900k tris
 * - canary-vs-baseline delta is exactly +8 draws / +2208 tris (CPU proof:
 *   node scripts/assets/verify-facade-detail-canary.mjs ->
 *   {draws: 8, instances: 184, triangles: 2208, colliders: 0}).
 *   NOTE: CPU mesh count is not necessarily the rendered delta (per-station
 *   frustum/shadow culling); the exact gate stands until the first real frame
 *   run measures it — document, never silently change it.
 * - colliderSnapshot() byte-identical across modes (canary returns zero colliders)
 * - programs identical across modes (ctx.mat singletons only, no new program)
 * - moduleStats['facade-detail-canary'] absent in baseline, present in canary
 *   (asset adoption status: procedural only — no GLB, no textures, no preload)
 * - served HTML/JS|CSS bytes == explicit --dist bytes (stale server refused),
 *   plus exact dist SHA-256 before/after (bundle must not change mid-run)
 * - zero console errors, zero page errors
 *
 *   node scripts/assets/capture-facade.mjs
 *   node scripts/assets/capture-facade.mjs --url http://127.0.0.1:4192 --dist dist-next
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from '../lib/stock-browser.mjs';
import { measureFrame, sceneWasMeasured } from '../lib/measure-frame.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'captures', 'facade');

/** Mean 8-bit luma below this is "the world did not draw" (playcap gate). */
const DARK_THRESHOLD = 40;

/** CPU proof identity: the canary adds exactly this over baseline. */
const CPU_DRAWS = 8;
const CPU_TRIS = 2208;

/** Repo budgets (AGENTS.md): under 1200 draw calls and 900k triangles. */
const MAX_CALLS = 1200;
const MAX_TRIS = 900000;

/** Fixed stations for this A/B — all fidelity stations with refs. */
const STATIONS = ['yardWhite', 'yardOrange', 'streetElevation'];

const MODES = [
  { id: 'baseline', query: '', facade: false },
  { id: 'facade-canary', query: 'facade=canary', facade: true },
];

const argv = process.argv.slice(2);
const opt = (name, dflt = '') => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? (argv[i + 1] ?? '') : dflt;
};
const urlOpt = opt('url', 'http://127.0.0.1:4192');
const distOpt = opt('dist', 'dist-next');

if (urlOpt.includes(':4188')) {
  console.error('[facade] 4188 preview is disallowed; facade A/B uses explicit 4192 URL/dist-next.');
  process.exit(2);
}

/** SHA-256 identity over every file in the served build directory. */
function distDigest(dir) {
  const hash = createHash('sha256');
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else {
        hash.update(full.slice(dir.length + 1).replace(/\\/g, '/'));
        hash.update(readFileSync(full));
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

const distDir = join(ROOT, distOpt);
if (!existsSync(join(distDir, 'index.html'))) {
  console.error(`[facade] ${distOpt}/index.html is missing — build the candidate first.`);
  process.exit(2);
}
const bundleBefore = {
  digest: distDigest(distDir),
  mtime: statSync(join(distDir, 'index.html')).mtimeMs,
};

const base = urlOpt.replace(/\/+$/, '');
console.log(`[facade] target ${base}/ (${distOpt} sha256:${bundleBefore.digest.slice(0, 12)}…)`);

const sha = (b) => createHash('sha256').update(b).digest('hex');
const expectJsSha = opt('expect-js-sha', '');
// Served==local parity (same proof as scripts/capture-mortar-live.mjs): the served
// HTML names the exact JS/CSS set; every served byte must equal the explicit
// --dist file. Local digest alone cannot catch a stale server photograph.
const servedHtml = await (await fetch(base + '/')).text();
const servedRefs = [...servedHtml.matchAll(/(?:src|href)="(?:\.\/)?(\/?assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1].replace(/^\//, ''));
if (!servedRefs.length) {
  console.error('[facade] served HTML names no assets/*.js|css - cannot prove served==local');
  process.exit(2);
}
const servedShas = { 'index.html': sha(Buffer.from(servedHtml, 'utf8')) };
for (const r of servedRefs) {
  servedShas[r] = sha(Buffer.from(await (await fetch(new URL(r, base + '/'))).arrayBuffer()));
}
{
  let stale = false;
  for (const [r, h] of Object.entries(servedShas)) {
    let local;
    try { local = sha(readFileSync(join(distDir, r))); }
    catch { console.error(`[facade] local dist missing served asset: ${r}`); process.exit(2); }
    if (local !== h) { console.error(`[facade] served!=local: ${r} (stale server photograph refused)`); stale = true; }
  }
  if (stale) process.exit(2);
}
const servedJsPath = servedRefs.find((r) => r.endsWith('.js')) ?? null;
if (expectJsSha && servedJsPath) {
  if (servedShas[servedJsPath] !== expectJsSha) {
    console.error(`[facade] served JS sha != pinned --expect-js-sha (${servedJsPath})`);
    process.exit(2);
  } else console.log(`  served JS ${servedJsPath} sha matches pinned candidate`);
}
console.log(`  served==local: ${servedRefs.length} asset(s) + index.html from ${distOpt}`);

const { browser, page, close } = await stockBrowser('facade');

const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 400));
});
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)));

const stripChrome = () => page.evaluate(() => {
  const el = document.getElementById('start');
  if (el) el.remove();
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = 'none';
  const ch = document.getElementById('crosshair');
  if (ch) ch.style.display = 'none';
  return !document.getElementById('start');
});

async function lumaOf(shot) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 200; c.height = 112;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 200, 112);
    const d = g.getImageData(0, 0, 200, 112).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4);
  }, shot.toString('base64'));
}

const report = {
  when: new Date().toISOString(),
  url: base,
  dist: distOpt,
  distDigest: bundleBefore.digest,
  servedShas,
  servedJs: servedJsPath,
  viewport: '1600x900',
  cpuProof: { draws: CPU_DRAWS, triangles: CPU_TRIS },
  modes: {},
  consoleErrors,
  pageErrors,
};
let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('  !! ' + msg);
};

const snapshots = {};

try {
  mkdirSync(OUT, { recursive: true });
  for (const mode of MODES) {
    console.log(`\n[facade] --- ${mode.id}${mode.query ? ' (?' + mode.query + ')' : ' (no flag)'} ---`);
    const target = mode.query ? `${base}/?${mode.query}` : `${base}/`;
    await page.goto(target, { waitUntil: 'load', timeout: 90000 });
    try {
      await page.waitForFunction(() => window.__NT && window.__NT.ready === true,
        null, { timeout: 180000 });
    } catch {
      fail(`${mode.id}: window.__NT never became ready`);
      continue;
    }

    // Renderer proof (scripts/capture-mortar-live.mjs): the actual renderer plus the
    // enabled WebGPU post chain. Never navigator.gpu alone, never the canvas
    // dataset mirror. world.ts publishes __NTPOST = post (post.ts: backend
    // 'webgpu' only when the chain built; 'off'/'webgl2' on any fallback).
    const gpuApi = await page.evaluate(() => typeof navigator.gpu !== 'undefined');
    const backend = await page.evaluate(() => ({
      renderer: window.__NT_BACKEND?.actual ?? null,
      requested: window.__NT_BACKEND?.requested ?? null,
      post: window.__NTPOST?.backend ?? null,
      postEnabled: window.__NTPOST?.enabled ?? null,
    }));
    console.log(`  backend requested=${backend.requested} actual=${backend.renderer} post=${backend.post} enabled=${backend.postEnabled} gpuApi=${gpuApi}`);
    if (!gpuApi) {
      fail(`${mode.id}: no navigator.gpu API - this is the fallback path, not the player path`);
      continue;
    }
    if (backend.renderer !== 'webgpu' || backend.post !== 'webgpu') {
      fail(`${mode.id}: not the actual WebGPU renderer+post (got renderer=${backend.renderer} post=${backend.post}) - fallback refused`);
      continue;
    }

    const adoption = await page.evaluate(() => ({
      facade: ('facade-detail-canary' in (window.__NT.moduleStats ?? {}))
        ? window.__NT.moduleStats['facade-detail-canary'] : null,
      modules: Object.keys(window.__NT.moduleStats ?? {}),
    }));
    console.log(`  adoption facade-detail-canary: ${adoption.facade ? JSON.stringify(adoption.facade) : 'absent'}`);
    if ((adoption.facade !== null) !== mode.facade) {
      fail(`${mode.id}: facade-detail-canary module ${adoption.facade ? 'present' : 'absent'}, expected ${mode.facade ? 'present' : 'absent'}`);
      continue;
    }

    await stripChrome();
    await page.waitForTimeout(1200);

    const stations = await page.evaluate(() => window.__NT.stations);
    const colliders = await page.evaluate(() => window.__NT.colliderSnapshot());
    snapshots[mode.id] = JSON.stringify(colliders);
    const rows = [];
    for (const name of STATIONS) {
      if (!stations[name]) {
        fail(`${mode.id}: station ${name} missing on page`);
        continue;
      }
      const ok = await page.evaluate((n) => window.__NT.goto(n), name);
      if (!ok) {
        fail(`${mode.id}: goto(${name}) failed`);
        continue;
      }
      await page.waitForTimeout(260);
      await stripChrome();

      const stats = await measureFrame(page);
      const shot = await page.screenshot({ type: 'png' });
      const file = join(OUT, `${mode.id}-${name}.png`);
      writeFileSync(file, shot);
      const luma = await lumaOf(shot);
      const measured = sceneWasMeasured(stats);
      const dark = luma < DARK_THRESHOLD;
      if (!measured) fail(`${mode.id}/${name}: MEASURED NOTHING (${stats.calls} calls over ${stats.renders} renders)`);
      if (dark) fail(`${mode.id}/${name}: dark frame (luma ${luma.toFixed(1)} < ${DARK_THRESHOLD})`);
      if (stats.calls > MAX_CALLS) fail(`${mode.id}/${name}: ${stats.calls} calls > ${MAX_CALLS} budget`);
      if (stats.triangles > MAX_TRIS) fail(`${mode.id}/${name}: ${stats.triangles} tris > ${MAX_TRIS} budget`);
      rows.push({
        station: name,
        ref: stations[name].ref,
        file,
        measured,
        calls: stats.calls,
        triangles: stats.triangles,
        renders: stats.renders,
        geometries: stats.geometries,
        textures: stats.textures,
        programs: stats.programs,
        colliders: colliders.count,
        luma: +luma.toFixed(1),
      });
      console.log(`  ${name.padEnd(16)} ${measured ? String(stats.calls).padStart(5) + ' calls ' + String(Math.round(stats.triangles / 1000)).padStart(5) + 'k tris' : 'MEASURED NOTHING'}  luma ${luma.toFixed(1).padStart(6)}  progs ${stats.programs}  colliders ${colliders.count}  -> ${file}`);
    }
    report.modes[mode.id] = {
      query: mode.query || '(none)',
      facadeAdopted: adoption.facade !== null,
      facadeModule: adoption.facade,
      backend,
      colliderCount: colliders.count,
      stations: rows,
    };
  }

  // Cross-mode gates: zero new colliders, zero new programs, exact CPU delta.
  const ids = Object.keys(report.modes);
  if (ids.length === 2) {
    const [a, b] = [report.modes[ids[0]], report.modes[ids[1]]];
    if (snapshots[ids[0]] !== snapshots[ids[1]]) {
      fail('collider footprints differ between modes — canary must add zero colliders');
    } else {
      console.log('[facade] collider footprints identical across modes');
    }
    for (const rowB of b.stations) {
      const rowA = a.stations.find((r) => r.station === rowB.station);
      if (!rowA) continue;
      const dCalls = rowB.calls - rowA.calls;
      const dTris = rowB.triangles - rowA.triangles;
      if (rowA.measured && rowB.measured && (dCalls !== CPU_DRAWS || dTris !== CPU_TRIS)) {
        fail(`${rowB.station}: canary delta +${dCalls} calls / +${dTris} tris, expected +${CPU_DRAWS} / +${CPU_TRIS} (CPU proof)`);
      }
      if (rowB.programs !== rowA.programs) {
        fail(`${rowB.station}: programs ${rowA.programs} -> ${rowB.programs} — canary must reuse ctx.mat singletons`);
      }
      if (rowB.textures !== rowA.textures) {
        fail(`${rowB.station}: textures ${rowA.textures} -> ${rowB.textures} — canary ships no textures`);
      }
    }
  }
} finally {
  await close();
}

const bundleAfter = {
  digest: distDigest(distDir),
  mtime: statSync(join(distDir, 'index.html')).mtimeMs,
};
report.bundleChangedDuringRun = bundleAfter.digest !== bundleBefore.digest;
if (report.bundleChangedDuringRun) fail('dist changed during the run — rerun before believing this');
if (consoleErrors.length) fail(`${consoleErrors.length} console error(s)`);
if (pageErrors.length) fail(`${pageErrors.length} page error(s)`);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'facade-report.json'), JSON.stringify(report, null, 2));

console.log(`\n[facade] ${failed ? 'FAILED' : 'PASS'} — report captures/facade/facade-report.json`);
console.log('[facade] NOTE: visual acceptance is a looked-at frame, not this exit code. Open each canary frame against docs/reference/refinement-targets/yard-white.png and captures/connected-terrain-relief-0004 baselines.');
process.exit(failed ? 1 : 0);
