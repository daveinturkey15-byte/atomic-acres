#!/usr/bin/env node
/**
 * Lawn canary A/B — default vs ?lawn=canary over ONE served build.
 *
 * Acceptance FIXTURE for the lawn-PBR patch (docs/lawn-canary-handoff.md). It
 * gates facts, not art: the art judgement is a looked-at frame by the root
 * agent against captures/lawn-canary/<QA_TAG>/*.png. Counters prove identity
 * and budget only.
 *
 * What it proves, per gate:
 *   - SAME BUILD: every served byte of index.html + assets/*.js|css is
 *     sha256-identical to the explicit local --dist tree (a stale server
 *     photograph is refused), and the dist digest is unchanged start->end.
 *   - SAME PATH: stock Chrome, actual WebGPU renderer + actual WebGPU post
 *     chain (__NT_BACKEND.actual / __NTPOST.backend). The WebGL2 fallback is
 *     refused, not measured.
 *   - REAL LOADS: all three lawn maps (lawn-1k-color/roughness/normal.jpg,
 *     public/assets/lawn-pbr-canary/) appear as completed resource loads in
 *     canary mode and NEVER load in baseline mode. This is the product's own
 *     loader path — nothing was added to the page to make it observable.
 *   - RENDERER STATE: renderer.info.textures gains exactly +3 in canary mode
 *     (one texture per slot; every other load is identical between modes).
 *   - SAME WORLD: colliderSnapshot and the per-module object/collider census
 *     are byte-identical across modes; every station renders identical
 *     triangles and geometries (the swap mutates the shared lawn singleton in
 *     place — zero extra geometry, zero colliders). Draw-call deltas are
 *     RECORDED, never asserted: a material swap does not have a known
 *     per-mesh call delta and renderer.info counts whole-frame calls anyway.
 *   - SAME LOOK: __NTATMO state (tod/weather/lights/smokes/shadow) and
 *     __NT.look({}) (exposure/environment/glass, read-only call) are
 *     identical across modes; screenshots at the fixed stations are taken
 *     through the same goto -> settle -> render path both times.
 *   - BUDGETS (repo AGENTS.md, frozen): every measured frame < 1200 draw
 *     calls and < 900k triangles, luma >= 40, no console/page errors.
 *
 *   Bounded: 240 s wall clock. On the watchdog the process exits; proc-guard
 *   reaps the owned Chrome tree on every exit path. close() also runs in
 *   finally. No product file is touched by this script.
 *
 * Provenance note: src/core/lawn-pbr-canary.ts already discloses that the
 * maps are ambientCG PBRProcedural, not a photo scan (header + provenance.json).
 * No provenance-comment patch is included here.
 *
 * Usage:
 *   RECOVERY_URL=http://127.0.0.1:4191 DIST_DIR=dist-next QA_TAG=lawn-r0 \
 *     node scripts/capture-lawn-canary.mjs [--expect-js-sha <sha256>]
 * Output: captures/lawn-canary/<QA_TAG>/{baseline,lawn-canary}-<station>.png
 *         captures/lawn-canary/<QA_TAG>/lawn-canary-report.json
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from './lib/stock-browser.mjs';
import { measureFrame, sceneWasMeasured } from './lib/measure-frame.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TAG = (process.env.QA_TAG || '').trim() ||
  `lawn-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16)}`;
const OUT = join(ROOT, 'captures', 'lawn-canary', TAG);

/** Repo budgets (AGENTS.md). Frozen — lowering one to get green is the failure. */
const MAX_CALLS = 1200;
const MAX_TRIS = 900000;
/** Mean 8-bit luma below this is "the world did not draw" (playcap gate). */
const DARK_THRESHOLD = 40;

/** The canary ships exactly three textures and zero geometry. */
const LAWN_URL_PART = 'assets/lawn-pbr-canary/';
const LAWN_FILES = ['lawn-1k-color.jpg', 'lawn-1k-roughness.jpg', 'lawn-1k-normal.jpg'];

/** Fixed stations for this A/B (task: yardOrange, yardWhite, street). */
const STATIONS = ['yardOrange', 'yardWhite', 'streetElevation'];

const MODES = [
  { id: 'baseline', query: '', lawn: false },
  { id: 'lawn-canary', query: 'lawn=canary', lawn: true },
];

// ------------------------------------------------------------------ bounds
const WALL_BUDGET_MS = 240_000;
const startedAt = Date.now();
const remainingMs = () => WALL_BUDGET_MS - (Date.now() - startedAt);
setTimeout(() => {
  console.error(`[lawn-canary] ${WALL_BUDGET_MS / 1000}s wall bound hit — exiting; proc-guard reaps the owned Chrome tree`);
  process.exit(3);
}, WALL_BUDGET_MS);

// ------------------------------------------------------------------ options
const argv = process.argv.slice(2);
const opt = (name, dflt = '') => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? (argv[i + 1] ?? '') : dflt;
};
const urlOpt = opt('url', process.env.RECOVERY_URL || 'http://127.0.0.1:4191');
const distOpt = opt('dist', process.env.DIST_DIR || 'dist-next');
const expectJsSha = opt('expect-js-sha', '');

if (urlOpt.includes(':4188')) {
  console.error('[lawn-canary] the :4188 preview is the shared harness port; point --url/RECOVERY_URL at the dedicated live server instead.');
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
  console.error(`[lawn-canary] ${distOpt}/index.html is missing — DIST_DIR must name the built candidate.`);
  process.exit(2);
}
const bundleBefore = { digest: distDigest(distDir), mtime: statSync(join(distDir, 'index.html')).mtimeMs };

const base = urlOpt.replace(/\/+$/, '');
console.log(`[lawn-canary] target ${base}/ (dist ${distOpt} sha256:${bundleBefore.digest.slice(0, 12)}… tag ${TAG})`);
console.log(`[lawn-canary] wall budget ${WALL_BUDGET_MS / 1000}s, remaining ${Math.round(remainingMs() / 1000)}s`);

const sha = (b) => createHash('sha256').update(b).digest('hex');
// Served==local parity: the served HTML names the exact asset set; every served
// byte must equal the explicit --dist file. Local digest alone cannot catch a
// stale server photograph.
if (remainingMs() < 30_000) { console.error('[lawn-canary] no time left for parity pin'); process.exit(3); }
const servedHtml = await (await fetch(base + '/')).text();
const servedRefs = [...servedHtml.matchAll(/(?:src|href)="(?:\.\/)?(\/?assets\/[^"]+\.(?:js|css))"/g)].map((m) => m[1].replace(/^\//, ''));
if (!servedRefs.length) {
  console.error('[lawn-canary] served HTML names no assets/*.js|css — cannot prove served==local');
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
    catch { console.error(`[lawn-canary] local dist missing served asset: ${r}`); process.exit(2); }
    if (local !== h) { console.error(`[lawn-canary] served!=local: ${r} — stale server photograph refused`); stale = true; }
  }
  if (stale) process.exit(2);
}
const servedJsPath = servedRefs.find((r) => r.endsWith('.js')) ?? null;
const servedJsSha = servedJsPath ? servedShas[servedJsPath] : null;
if (expectJsSha && servedJsSha) {
  if (servedJsSha !== expectJsSha) {
    console.error(`[lawn-canary] served JS sha != pinned --expect-js-sha (${servedJsPath})`);
    process.exit(2);
  }
}
console.log(`  served==local: ${servedRefs.length} asset(s) + index.html; JS ${servedJsPath} ${servedJsSha?.slice(0, 12)}…`);

// ------------------------------------------------------------------ browser
const { browser, page, close } = await stockBrowser('lawn-canary');

const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 400)); });
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

/** Luma over the whole frame, green dominance over the lawn half. */
async function frameMetrics(shot) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 200; c.height = 112;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 200, 112);
    const d = g.getImageData(0, 0, 200, 112).data;
    let luma = 0, n = 0, green = 0, gn = 0;
    for (let i = 0; i < d.length; i += 4) {
      luma += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++;
      if (i / 4 >= 200 * 56) { green += d[i + 1] - (d[i] + d[i + 2]) / 2; gn++; }
    }
    return { luma: +(luma / n).toFixed(1), lawnGreen: +(green / gn).toFixed(1) };
  }, shot.toString('base64'));
}

/** Mean abs channel diff between two same-camera frames (adoption sanity). */
async function pixelDiff(aB64, bB64) {
  return page.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = 'data:image/png;base64,' + src;
    });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c = document.createElement('canvas');
    c.width = 200; c.height = 112;
    const g = c.getContext('2d');
    g.drawImage(ia, 0, 0, 200, 112);
    const da = g.getImageData(0, 0, 200, 112).data;
    g.clearRect(0, 0, 200, 112);
    g.drawImage(ib, 0, 0, 200, 112);
    const db = g.getImageData(0, 0, 200, 112).data;
    let s = 0;
    for (let i = 0; i < da.length; i += 4) {
      s += Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
    }
    return +(s / (da.length / 4) / 3).toFixed(2);
  }, [aB64, bB64]);
}

/** Completed resource loads under the lawn-canary asset directory. */
const lawnResourceEntries = () => page.evaluate((part) =>
  performance.getEntriesByType('resource')
    .map((e) => ({ name: e.name, status: e.responseStatus ?? 0, decoded: e.decodedBodySize, transferred: e.transferSize }))
    .filter((e) => e.name.includes(part)), LAWN_URL_PART);
/** A load counts as completed when the response was 200 or any byte landed.
 * Some Chrome/three fetch paths report decodedBodySize 0 for consumed bodies. */
const loadDone = (e) => e.status === 200 || e.decoded > 0 || e.transferred > 0;

const report = {
  when: new Date().toISOString(),
  qaTag: TAG,
  url: base,
  dist: distOpt,
  distDigest: bundleBefore.digest,
  servedShas,
  servedJs: servedJsPath,
  servedJsSha,
  budget: { maxCalls: MAX_CALLS, maxTri: MAX_TRIS, darkLuma: DARK_THRESHOLD },
  wallBudgetMs: WALL_BUDGET_MS,
  stations: STATIONS,
  modes: {},
  identity: {},
  consoleErrors,
  pageErrors,
};
let failed = false;
const fail = (msg) => { failed = true; console.error('  !! ' + msg); };

const colliderStrings = {};
const censusStrings = {};
const shots = {};

try {
  mkdirSync(OUT, { recursive: true });
  for (const mode of MODES) {
    if (remainingMs() < 40_000) { fail(`${mode.id}: out of wall budget before mode start`); break; }
    console.log(`\n[lawn-canary] --- ${mode.id}${mode.query ? ` (?${mode.query})` : ' (no flag)'} ---`);
    const target = mode.query ? `${base}/?${mode.query}` : `${base}/`;
    await page.goto(target, { waitUntil: 'load', timeout: Math.max(5_000, Math.min(90_000, remainingMs() - 5_000)) });
    try {
      await page.waitForFunction(() => window.__NT && window.__NT.ready === true,
        null, { timeout: Math.max(5_000, Math.min(120_000, remainingMs() - 10_000)) });
    } catch {
      fail(`${mode.id}: window.__NT never became ready`);
      continue;
    }

    // Flag adoption echo (the product's own parse, not a page-side override).
    const flags = await page.evaluate(() => ({
      flags: window.__NT_FLAGS ?? null,
      env: window.__NT_ENV ?? null,
    }));
    const adopted = flags.flags?.lawnCanary === mode.lawn && flags.env?.lawnCanary === mode.lawn;
    console.log(`  flag echo lawnCanary=${flags.flags?.lawnCanary} (want ${mode.lawn})`);
    if (!adopted) { fail(`${mode.id}: __NT_FLAGS.lawnCanary=${flags.flags?.lawnCanary}, expected ${mode.lawn}`); continue; }

    // Actual renderer + actual post, never the fallback path.
    const gpuApi = await page.evaluate(() => typeof navigator.gpu !== 'undefined');
    const backend = await page.evaluate(() => ({
      renderer: window.__NT_BACKEND?.actual ?? null,
      requested: window.__NT_BACKEND?.requested ?? null,
      post: window.__NTPOST?.backend ?? null,
      postEnabled: window.__NTPOST?.enabled ?? null,
    }));
    console.log(`  backend requested=${backend.requested} actual=${backend.renderer} post=${backend.post} enabled=${backend.postEnabled} gpuApi=${gpuApi}`);
    if (!gpuApi) { fail(`${mode.id}: no navigator.gpu — fallback path, not the player path`); continue; }
    if (backend.renderer !== 'webgpu' || backend.post !== 'webgpu') {
      fail(`${mode.id}: not the actual WebGPU renderer+post (renderer=${backend.renderer} post=${backend.post})`);
      continue;
    }

    // Loader diagnostics: the product's own loadCanarySurfaceSet requests.
    if (mode.lawn) {
      const deadline = Date.now() + Math.min(20_000, remainingMs() - 5_000);
      let entries = [];
      while (Date.now() < deadline) {
        entries = await lawnResourceEntries();
        const done = new Set(entries.filter(loadDone).map((e) => e.name));
        if (LAWN_FILES.every((f) => [...done].some((n) => n.endsWith(f)))) break;
        await page.waitForTimeout(250);
      }
      const doneNames = new Set(entries.filter(loadDone).map((e) => e.name));
      const missing = LAWN_FILES.filter((f) => ![...doneNames].some((n) => n.endsWith(f)));
      console.log(`  lawn loads: ${doneNames.size ? [...doneNames].map((n) => n.split('/').pop()).join(', ') : 'NONE'}`);
      if (missing.length) { fail(`${mode.id}: lawn maps never completed: ${missing.join(', ')}`); continue; }
      mode.resources = entries;
    } else {
      await page.waitForTimeout(1_500);
      const entries = await lawnResourceEntries();
      if (entries.length) {
        fail(`${mode.id}: lawn canary assets loaded WITHOUT the flag: ${entries.map((e) => e.name).join(', ')}`);
        continue;
      }
      mode.resources = [];
    }

    await stripChrome();
    await page.waitForTimeout(1_200);

    // Same time/day/exposure pin — read-only (look({}) mutates nothing).
    const look = await page.evaluate(() => window.__NT.look({}));
    const atmo = await page.evaluate(() => {
      const s = window.__NTATMO?.state?.() ?? null;
      if (s && 'bakeMs' in s) delete s.bakeMs; // wall-clock measurement, not state
      return s;
    });
    const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
    const frameMs = await page.evaluate(() => new Promise((resolve) => {
      const deltas = [];
      let last = performance.now();
      const tick = () => {
        const now = performance.now();
        deltas.push(now - last); last = now;
        if (deltas.length < 6) requestAnimationFrame(tick);
        else { deltas.sort((a, b) => a - b); resolve(+deltas[3].toFixed(2)); }
      };
      requestAnimationFrame(tick);
    }));

    const colliders = await page.evaluate(() => window.__NT.colliderSnapshot());
    colliderStrings[mode.id] = JSON.stringify(colliders);
    const census = await page.evaluate(() => {
      const out = {};
      for (const [k, v] of Object.entries(window.__NT.moduleStats ?? {})) out[k] = `${v.objects}/${v.colliders}`;
      return out;
    });
    censusStrings[mode.id] = JSON.stringify(census);

    const stationsPage = await page.evaluate(() => window.__NT.stations);
    const rows = [];
    for (const name of STATIONS) {
      if (remainingMs() < 8_000) { fail(`${mode.id}: out of wall budget mid-stations`); break; }
      if (!stationsPage[name]) { fail(`${mode.id}: station ${name} missing on page`); continue; }
      const ok = await page.evaluate((n) => window.__NT.goto(n), name);
      if (!ok) { fail(`${mode.id}: goto(${name}) failed`); continue; }
      await page.waitForTimeout(260);
      await stripChrome();

      const stats = await measureFrame(page);
      const shot = await page.screenshot({ type: 'png' });
      const file = join(OUT, `${mode.id}-${name}.png`);
      writeFileSync(file, shot);
      shots[`${mode.id}/${name}`] = shot.toString('base64');
      const metrics = await frameMetrics(shot);
      const measured = sceneWasMeasured(stats);
      if (!measured) fail(`${mode.id}/${name}: MEASURED NOTHING (${stats.calls} calls over ${stats.renders} renders)`);
      if (metrics.luma < DARK_THRESHOLD) fail(`${mode.id}/${name}: dark frame (luma ${metrics.luma} < ${DARK_THRESHOLD})`);
      if (stats.calls >= MAX_CALLS) fail(`${mode.id}/${name}: ${stats.calls} calls >= ${MAX_CALLS} budget`);
      if (stats.triangles >= MAX_TRIS) fail(`${mode.id}/${name}: ${stats.triangles} tris >= ${MAX_TRIS} budget`);
      rows.push({
        station: name,
        ref: stationsPage[name].ref,
        file,
        measured,
        calls: stats.calls,
        triangles: stats.triangles,
        renders: stats.renders,
        geometries: stats.geometries,
        textures: stats.textures,
        programs: stats.programs,
        luma: metrics.luma,
        lawnGreen: metrics.lawnGreen,
      });
      console.log(`  ${name.padEnd(16)} ${measured ? `${String(stats.calls).padStart(5)} calls ${String(Math.round(stats.triangles / 1000)).padStart(5)}k tris` : 'MEASURED NOTHING'}  luma ${String(metrics.luma).padStart(6)}  lawnGreen ${String(metrics.lawnGreen).padStart(6)}  tex ${stats.textures}  progs ${stats.programs}`);
    }
    report.modes[mode.id] = {
      query: mode.query || '(none)',
      lawnCanary: mode.lawn,
      backend, look, atmo,
      heapUsedJs: heap,
      frameMs,
      colliderCount: colliders.count,
      lawnResources: mode.resources.map((e) => ({ file: e.name.split('/').pop(), status: e.status, decoded: e.decoded, transferred: e.transferred })),
      stations: rows,
    };
  }

  // ---------------- cross-mode identity + adoption gates
  const ids = Object.keys(report.modes).filter((k) => report.modes[k].stations.length === STATIONS.length);
  if (ids.length === 2) {
    const [aId, bId] = ids;
    const a = report.modes[aId];
    const b = report.modes[bId];

    report.identity.collidersIdentical = colliderStrings[aId] === colliderStrings[bId];
    report.identity.moduleCensusIdentical = censusStrings[aId] === censusStrings[bId];
    if (!report.identity.collidersIdentical) fail('collider footprints differ between modes — the lawn swap must add zero colliders');
    if (!report.identity.moduleCensusIdentical) fail('module object/collider census differs between modes — no extra geometry allowed');
    if (JSON.stringify(a.atmo) !== JSON.stringify(b.atmo)) fail(`atmosphere state differs: ${JSON.stringify(a.atmo)} vs ${JSON.stringify(b.atmo)} — same time/day required`);
    if (JSON.stringify(a.look) !== JSON.stringify(b.look)) fail(`exposure/environment/glass differ: ${JSON.stringify(a.look)} vs ${JSON.stringify(b.look)}`);

    if (!Number.isFinite(a.stations[0].textures) || !Number.isFinite(b.stations[0].textures)) {
      fail('renderer.info.textures not finite — renderer state unavailable on this backend');
    } else {
      const texturesDelta = b.stations[0].textures - a.stations[0].textures;
      const programsDelta = b.stations[0].programs - a.stations[0].programs;
      report.identity.texturesDelta = texturesDelta;
      report.identity.programsDelta = programsDelta;
      if (texturesDelta !== 3) fail(`renderer textures ${a.stations[0].textures} -> ${b.stations[0].textures} (delta ${texturesDelta}) — canary ships exactly 3`);
      console.log(`[lawn-canary] renderer textures +${texturesDelta}, programs ${programsDelta >= 0 ? '+' : ''}${programsDelta} (recorded)`);
    }

    report.identity.pixel = {};
    for (const rowB of b.stations) {
      const rowA = a.stations.find((r) => r.station === rowB.station);
      if (!rowA) continue;
      const dCalls = rowB.calls - rowA.calls;
      const dTris = rowB.triangles - rowA.triangles;
      const dGeo = rowB.geometries - rowA.geometries;
      // Draw-call delta is RECORDED, never asserted: renderer.info counts the
      // whole measured frame (scene + post), not a per-mesh identity.
      report.identity.pixel[rowB.station] = { dCalls, dTris, dGeometries: dGeo };
      if (dTris !== 0 || dGeo !== 0) fail(`${rowB.station}: geometry changed (tris ${dTris >= 0 ? '+' : ''}${dTris}, geometries ${dGeo >= 0 ? '+' : ''}${dGeo}) — swap is material-only`);
      const diff = await pixelDiff(shots[`${aId}/${rowB.station}`], shots[`${bId}/${rowB.station}`]);
      report.identity.pixel[rowB.station].meanAbsDiff = diff;
      if (diff <= 0.05) fail(`${rowB.station}: canary frame is pixel-identical to baseline (diff ${diff}) — the swap did not render`);
      console.log(`  ${rowB.station.padEnd(16)} Δ ${dCalls >= 0 ? '+' : ''}${dCalls} calls, ${dTris} tris, ${dGeo} geo, pixels ${diff}`);
    }
  }
} finally {
  await close();
}

const bundleAfter = { digest: distDigest(distDir), mtime: statSync(join(distDir, 'index.html')).mtimeMs };
report.bundleChangedDuringRun = bundleAfter.digest !== bundleBefore.digest;
if (report.bundleChangedDuringRun) fail('dist changed during the run — rerun before believing this');
if (consoleErrors.length) fail(`${consoleErrors.length} console error(s): ${consoleErrors[0]}`);
if (pageErrors.length) fail(`${pageErrors.length} page error(s): ${pageErrors[0]}`);

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'lawn-canary-report.json'), JSON.stringify(report, null, 2));

console.log(`\n[lawn-canary] ${failed ? 'FAILED' : 'PASS'} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — report ${join('captures', 'lawn-canary', TAG, 'lawn-canary-report.json')}`);
console.log('[lawn-canary] counters prove identity and budget only. Open both modes of every station before judging the lawn: visual acceptance is a looked-at frame.');
process.exit(failed ? 1 : 0);
