/**
 * Environment Comparison Harness — 4-flag A/B over the REAL game bundle.
 *
 * AUTHORED FOR ROOT TO RUN. DO NOT LAUNCH IN SUB-AGENT WORKTREE.
 *
 * Compares baseline against the two environment candidates across the six
 * canonical fidelity stations in `src/core/stations.ts` (read off the live
 * page — no hardcoded coordinates, so no in-wall cameras):
 *   1. baseline         (?env=baseline)
 *   2. ground-canary    (?ground=canary)
 *   3. mountains-canary (?mountains=canary)
 *   4. combined-canary  (?env=canary)
 *
 * Route discipline (repo-canonical, same as scripts/capture.mjs):
 * - Owned stock Chrome via `scripts/lib/stock-browser.mjs` (real WebGPU
 *   adapter; Playwright's bundled Chromium has none and would measure the
 *   WebGL2 fallback with the post chain off).
 * - Shared preview on :4188 via `scripts/lib/preview.mjs`, or --url.
 * - `window.__NT.ready`, then `__NT.goto(station)` (QA render path, viewmodel
 *   hidden) with `measureFrame()` render-delta stats — a station that reports
 *   no draw calls prints MEASURED NOTHING and fails.
 * - Backend proof is the page's own report: `window.__NT_BACKEND.actual` plus
 * - This harness performs no teardown of the live session: disposal is proven by
 *   the CPU verifier through the real skyline registration, not by releasing a
 *   live session mid-run.
 *
 *   node scripts/assets/environment-comparison-harness.mjs
 *   node scripts/assets/environment-comparison-harness.mjs --url http://127.0.0.1:4192 --dist dist-night-environment
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from '../lib/stock-browser.mjs';
import { measureFrame, sceneWasMeasured } from '../lib/measure-frame.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'captures', 'env-comparison');

/** Mean 8-bit luma below this is "the world did not draw" (playcap gate). */
const DARK_THRESHOLD = 40;

/** Canonical fidelity stations only — a station with ref null is diagnostic. */
const FIDELITY_STATIONS = [
  'aerial',
  'yardOrange',
  'yardWhite',
  'streetElevation',
  'plaza',
  'turningHead',
];

const MODES = [
  {
    id: 'baseline',
    query: 'env=baseline',
    expected: { groundPbr: false, distantMountains: false },
  },
  {
    id: 'ground-canary',
    query: 'ground=canary',
    expected: { groundPbr: true, distantMountains: false },
  },
  {
    id: 'mountains-canary',
    query: 'mountains=canary',
    expected: { groundPbr: false, distantMountains: true },
  },
  {
    id: 'combined-canary',
    query: 'env=canary',
    expected: { groundPbr: true, distantMountains: true },
  },
];

const argv = process.argv.slice(2);
const opt = (name, dflt = '') => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? (argv[i + 1] ?? '') : dflt;
};
const urlOpt = opt('url', 'http://127.0.0.1:4192');
const distOpt = opt('dist', 'dist-next');

if (urlOpt.includes(':4188')) {
  console.error('[env-cmp] 4188 preview is disallowed; comparison uses explicit 4192 URL/dist-next.');
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
  console.error(`[env-cmp] ${distOpt}/index.html is missing — build the candidate first.`);
  process.exit(2);
}
const bundleBefore = {
  digest: distDigest(distDir),
  mtime: statSync(join(distDir, 'index.html')).mtimeMs,
};

const base = urlOpt.replace(/\/+$/, '');
console.log(`[env-cmp] target ${base}/ (${distOpt} sha256:${bundleBefore.digest.slice(0, 12)}…)`);

const { browser, page, close } = await stockBrowser('envcmp');

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
  viewport: '1600x900',
  modes: {},
  consoleErrors,
  pageErrors,
};
let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('  !! ' + msg);
};

try {
  mkdirSync(OUT, { recursive: true });
  for (const mode of MODES) {
    console.log(`\n[env-cmp] --- ${mode.id} (?${mode.query}) ---`);
    const target = `${base}/?${mode.query}`;
    await page.goto(target, { waitUntil: 'load', timeout: 90000 });
    try {
      await page.waitForFunction(() => window.__NT && window.__NT.ready === true,
        null, { timeout: 180000 });
    } catch {
      fail(`${mode.id}: window.__NT never became ready`);
      continue;
    }

    const backend = await page.evaluate(() => ({
      report: window.__NT_BACKEND ?? null,
      canvas: document.querySelector('canvas[data-nt-backend]')?.dataset?.ntBackend ?? null,
    }));
    console.log(`  backend requested=${backend.report?.requested} actual=${backend.report?.actual} canvas=${backend.canvas}`);
    if (backend.report?.actual !== 'webgpu' || backend.canvas !== 'webgpu') {
      fail(`${mode.id}: not on real WebGPU (report=${backend.report?.actual} canvas=${backend.canvas}) — fallback frames are not evidence`);
      continue;
    }

    const flags = await page.evaluate(() => window.__NT_FLAGS ?? window.__NT_ENV ?? {});
    console.log(`  flags groundPbr=${flags.groundPbr} distantMountains=${flags.distantMountains} mode=${flags.mode}`);
    if (flags.groundPbr !== mode.expected.groundPbr
      || flags.distantMountains !== mode.expected.distantMountains) {
      fail(`${mode.id}: flags do not match expected ${JSON.stringify(mode.expected)}`);
      continue;
    }

    await stripChrome();
    await page.waitForTimeout(1200);

    const stations = await page.evaluate(() => window.__NT.stations);
    const rows = [];
    for (const name of FIDELITY_STATIONS) {
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
        luma: +luma.toFixed(1),
      });
      console.log(`  ${name.padEnd(16)} ${measured ? String(stats.calls).padStart(5) + ' calls ' + String(Math.round(stats.triangles / 1000)).padStart(5) + 'k tris' : 'MEASURED NOTHING'}  luma ${luma.toFixed(1).padStart(6)}  progs ${stats.programs}  -> ${file}`);
    }
    report.modes[mode.id] = { query: mode.query, flags, backend, stations: rows };
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
writeFileSync(join(OUT, 'env-comparison-report.json'), JSON.stringify(report, null, 2));

console.log(`\n[env-cmp] ${failed ? 'FAILED' : 'PASS'} — report captures/env-comparison/env-comparison-report.json`);
console.log('[env-cmp] NOTE: visual acceptance is a looked-at frame, not this exit code. Open each fidelity station against its ref.');
process.exit(failed ? 1 : 0);
