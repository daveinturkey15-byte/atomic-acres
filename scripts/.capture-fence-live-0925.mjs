/**
 * Fixed fence-board before/after capture harness.
 *
 * This deliberately makes no visual-quality claim. It puts the shipped QA
 * camera at three fence-side stations, records one fresh measured render and
 * writes the frames for the owner to inspect. Run once against the baseline
 * URL and once against the candidate URL with different --tag values.
 *
 *   node scripts/capture-fence-boards.mjs --url http://127.0.0.1:4192/ --tag fence
 *   node scripts/capture-fence-boards.mjs --url http://127.0.0.1:4192/ --tag fence-textured --require-texture
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from './lib/stock-browser.mjs';
import { measureFrame, sceneWasMeasured } from './lib/measure-frame.mjs';

const ENTRY_TIMEOUT=30000;
function entryRecoveryAction(entry) {
  if (entry.matchMode && entry.matchMode !== 'idle') {
    if (entry.surface === 'hidden') return 'pause';
    if (entry.surface === 'paused-match' || entry.surface === 'match-over') return 'leave';
  }
  if (entry.surface === 'pre-match' && entry.panel && entry.panel !== 'main') return 'back';
  return null;
}
async function enterSolo(page, result) {
  result.entryTrace = [];
  const inspect = async label => {
    const entry = await page.evaluate(() => {
      const overlay = document.getElementById('start');
      const menu = window.__AA_UI?.menu;
      return { t: performance.now(), surface: menu?.state?.().surface ?? null,
        panel: menu?.panel?.() ?? null, matchMode: window.__NTGAME?.mode?.() ?? null,
        overlay: overlay ? { display: getComputedStyle(overlay).display, visibility: getComputedStyle(overlay).visibility, rects: overlay.getClientRects().length } : null,
        visibleButtons: [...document.querySelectorAll('#start button')]
          .filter(b => b.getClientRects().length > 0 && getComputedStyle(b).visibility === 'visible')
          .map(b => b.textContent?.trim()).filter(Boolean) };
    });
    result.entryTrace.push({ label, ...entry }); return entry;
  };
  try {
    // An entry state is observed before choosing any recovery action. Returning
    // via the real menu preserves the same Play solo -> Deploy route for both modes.
    for (let attempt = 0; attempt < 3; attempt++) {
      const entry = await inspect(`entry-${attempt}`), action = entryRecoveryAction(entry);
      if (!action) break;
      result.actions.push({ action: `entry-${action}`, t: entry.t });
      if (action === 'leave') {
        await page.getByRole('button', { name: 'Leave match', exact: true }).click({ timeout: ENTRY_TIMEOUT });
        await page.waitForFunction(() => window.__NTGAME?.mode?.() === 'idle', null, { timeout: ENTRY_TIMEOUT });
      } else {
        await page.keyboard.press('Escape');
        await page.waitForFunction(previous => {
          const m = window.__AA_UI?.menu;
          return m?.state?.().surface !== previous.surface || m?.panel?.() !== previous.panel;
        }, { surface: entry.surface, panel: entry.panel }, { timeout: ENTRY_TIMEOUT });
      }
    }
    const solo = page.getByRole('button', { name: 'Play solo', exact: true });
    await solo.waitFor({ state: 'visible', timeout: ENTRY_TIMEOUT });
    await inspect('before-play-solo'); await solo.click({ timeout: ENTRY_TIMEOUT });
    const deploy = page.getByRole('button', { name: 'Deploy', exact: true });
    await deploy.waitFor({ state: 'visible', timeout: ENTRY_TIMEOUT });
    await inspect('before-deploy'); await deploy.click({ timeout: ENTRY_TIMEOUT });
    await page.waitForFunction(() => {
      try { return window.__NTGAME?.snapshot?.().match?.phase === 'active' && window.__NT?.weaponCmd?.('state')?.visible === true; }
      catch { return false; }
    }, null, { timeout: 45_000 });
    await inspect('deployed');
  } catch (error) {
    try { await inspect('entry-failed'); } catch { /* Preserve the original entry error. */ }
    throw error;
  }
}


const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : fallback;
};

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)));
const BASE_URL = opt('url', 'http://127.0.0.1:4192/');
const TAG = opt('tag', 'fence');
const REQUIRE_TEXTURE = argv.includes('--require-texture');
const OUT = join(ROOT, 'captures', TAG);
const MAX_CALLS = 1200;
const MAX_TRIANGLES = 900_000;
const BASELINE_COLLIDERS = 652;
const WARMUP_FRAMES = 6;
// Match this candidate's maps only. The baseline already loads a different
// painted-planks set, which must not satisfy the new fence-map gate.
const FENCE_ASSET = /\/assets\/wooden-planks\/wooden_planks_(?:diff|rough|nor_gl)_1k\.jpg(?:\?|$)/;

if (!/^[A-Za-z0-9_-]+$/.test(TAG)) throw new Error('Invalid --tag; use letters, numbers, _ or -');
mkdirSync(OUT, { recursive: true });

const STATIONS = [
  {
    name: 'white-back',
    camera: [-10, 1.45, 39.5],
    target: [-10, 1.1, 37],
  },
  {
    name: 'orange-back-grazing',
    camera: [-10, 1.55, -39.5],
    target: [-4, 1.15, -37],
  },
  {
    name: 'white-west-return',
    camera: [-17, 1.5, 31],
    target: [-14.8, 1.1, 33],
  },
].map((station) => {
  const [camX, camY, camZ] = station.camera;
  const [targetX, targetY, targetZ] = station.target;
  const dx = camX - targetX;
  const dz = camZ - targetZ;
  return {
    ...station,
    yaw: Math.atan2(dx, dz),
    pitch: Math.atan2(targetY - camY, Math.hypot(dx, dz)),
    fov: 58,
  };
});

const result = {
  schema: 'nuketown-2025/fence-board-capture/1',
  capturedAt: new Date().toISOString(),
  url: BASE_URL,
  tag: TAG,
  requireTexture: REQUIRE_TEXTURE,
  outputDirectory: OUT,
  qualityClaim: null,
  budgets: { maxCalls: MAX_CALLS, maxTriangles: MAX_TRIANGLES, baselineColliderCount: BASELINE_COLLIDERS },
  warmupFrames: WARMUP_FRAMES,
  stations: STATIONS.map(({ name, camera, target, yaw, pitch, fov }) => ({ name, camera, target, yaw, pitch, fov })),
  frames: [],
  actions: [],
  assetRequests: [],
  failedResponses: [],
  failedRequests: [],
  errors: [],
};

const assetRequests = new Map();
const rememberAssetResponse = (response) => {
  const url = response.url();
  if (!FENCE_ASSET.test(url)) return;
  const request = response.request();
  assetRequests.set(url, {
    url,
    status: response.status(),
    ok: response.status() >= 200 && response.status() < 300,
    resourceType: request.resourceType(),
  });
};

let owned = null;
try {
  owned = await stockBrowser('fence-boards-' + TAG);
  const { page } = owned;
  page.on('pageerror', (error) => result.errors.push('PAGEERROR ' + String(error).slice(0, 400)));
  page.on('console', (message) => {
    if (message.type() === 'error') result.errors.push('CONSOLE ' + message.text().slice(0, 400));
  });
  page.on('response', (response) => {
    rememberAssetResponse(response);
    if (response.status() >= 400) result.failedResponses.push({ url: response.url(), status: response.status() });
  });
  page.on('requestfailed', (request) => {
    result.failedRequests.push({ url: request.url(), failure: request.failure() });
  });

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForFunction(() => window.__NT?.ready === true, null, { timeout: 90_000 });
  await enterSolo(page,result);
  await page.addStyleTag({ content: '#start,#hud,#crosshair{display:none!important}' });

  const pageFacts = await page.evaluate(() => {
    const qa = window.__NT;
    const scriptUrls = Array.from(document.scripts, (script) => script.src).filter(Boolean);
    const resourceUrls = performance.getEntriesByType('resource').map((entry) => entry.name).filter(Boolean);
    const bundleUrl = [...scriptUrls, ...resourceUrls]
      .find((value) => /\/assets\/index-[^/]+\.js(?:\?|$)/.test(value)) ?? null;
    const bundleFilename = bundleUrl === null ? null : new URL(bundleUrl).pathname.split('/').pop() ?? null;
    const fenceResources = resourceUrls.filter((value) => /\/assets\/wooden-planks\/wooden_planks_(?:diff|rough|nor_gl)_1k\.jpg(?:\?|$)/.test(value));
    return {
      pageUrl: location.href,
      bundleUrl,
      bundleFilename,
      backend: { renderer: window.__NT_BACKEND?.actual ?? null, post: window.__NTPOST?.backend ?? null },
      colliderCount: qa?.colliderCount ?? null,
      moduleStats: qa?.moduleStats ?? null,
      fenceResources,
    };
  });
  result.page = pageFacts;
  if (pageFacts.colliderCount !== BASELINE_COLLIDERS) {
    throw new Error(`colliderCount ${pageFacts.colliderCount} != baseline ${BASELINE_COLLIDERS}`);
  }

  for (const station of STATIONS) {
    const found = await page.evaluate((value) => {
      window.__NT.stations[value.name] = {
        pos: value.camera,
        yaw: value.yaw,
        pitch: value.pitch,
        fov: value.fov,
        ref: null,
        note: 'fixed fence-board before/after camera; root must inspect PNGs',
      };
      return window.__NT.goto(value.name);
    }, station);
    if (!found) throw new Error('Unknown QA station: ' + station.name);

    for (let i = 0; i < WARMUP_FRAMES; i++) {
      await measureFrame(page);
      await page.waitForTimeout(60);
    }
    const stats = await measureFrame(page);
    const file = join(OUT, station.name + '.png');
    await page.screenshot({ path: file });
    const measured = sceneWasMeasured(stats);
    const budget = measured && stats.calls <= MAX_CALLS && stats.triangles <= MAX_TRIANGLES;
    result.frames.push({
      name: station.name,
      camera: station.camera,
      target: station.target,
      yaw: station.yaw,
      pitch: station.pitch,
      fov: station.fov,
      file,
      stats,
      measured,
      budget,
    });
  }

  const performanceFenceAssets = await page.evaluate(() => performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((value) => /\/assets\/wooden-planks\/wooden_planks_(?:diff|rough|nor_gl)_1k\.jpg(?:\?|$)/.test(value)));
  for (const url of performanceFenceAssets) {
    if (!assetRequests.has(url)) assetRequests.set(url, { url, status: null, ok: null, resourceType: 'performance-entry' });
  }
  result.assetRequests = [...assetRequests.values()];
  const successfulFenceAssets = result.assetRequests.filter((asset) => asset.ok === true);
  result.assetGate = {
    matchingRequests: result.assetRequests.length,
    successfulResponses: successfulFenceAssets.length,
    required: REQUIRE_TEXTURE ? 3 : 0,
    pass: !REQUIRE_TEXTURE || successfulFenceAssets.length >= 3,
  };
  if (!result.assetGate.pass) {
    throw new Error(`--require-texture needs 3 successful fence asset responses; saw ${successfulFenceAssets.length}`);
  }
  result.pass = result.frames.length === 3
    && result.frames.every((frame) => frame.measured && frame.budget)
    && result.assetGate.pass
    && result.failedResponses.length === 0
    && result.failedRequests.length === 0
    && result.errors.length === 0;
} catch (error) {
  result.fatal = String(error);
  result.pass = false;
} finally {
  result.assetRequests = [...assetRequests.values()];
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  if (owned) await owned.close();
}

console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
