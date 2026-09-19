/**
 * Browser capture verification for the Catalog Carbine Canary.
 *
 * Authored for ROOT execution (DO NOT RUN in sub-agent lane).
 * Root runs it against a live build:
 *   node scripts/capture-carbine-canary.mjs [--url=http://127.0.0.1:4194/?carbine=canary&tod=noon&weather=clear]
 *
 * Route discipline (repo-canonical):
 *   - Owned headless stock Chrome via scripts/lib/stock-browser.mjs only.
 *     It owns a temporary nuketown-* profile, runs --headless=new, and removes
 *     its owned tree in close(). This script spawns no browser of its own, so
 *     the owner's profile is never touched and the headless-only contract holds.
 *   - Explicit URL, defaulting to :4194 (never the owner's :4173 preview or
 *     the shared :4188 preview). Never spawns a preview server.
 *   - Total wall-clock bound: 150 s. Every wait is capped by what is left.
 *
 * What it proves:
 *   - actual canary-status assertion (isGLTF + carbine.glb URL + 4 sockets),
 *     so a procedural fallback wearing the Longhorn name can NOT pass;
 *   - actual WebGPU/post identity from the page (renderer actual + canvas
 *     dataset + __NTPOST backend/enabled), refusing fallback pixels;
 *   - real menu (Play solo + Deploy) and the real game rAF loop for every photo;
 *   - No QA render-step path anywhere near the viewmodel photos: the three
 *     screenshots come straight off the game's own canvas, where the real GLB
 *     model and the factory hands are visible in hip, ADS and mid-reload poses;
 *   - one real round expended through weaponCmd('fire') before reloading, with
 *     the actual reload state (reloading/reloadProgress) asserted at the photo.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from './lib/stock-browser.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures', 'carbine-canary');
mkdirSync(OUT, { recursive: true });

const argv = process.argv.slice(2);
const opt = (name, dflt = '') => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const eq = hit.indexOf('=');
  return eq < 0 ? '1' : hit.slice(eq + 1);
};
const positionalUrl = argv.find((a) => !a.startsWith('--'));
const DEFAULT_URL = 'http://127.0.0.1:4194/?carbine=canary&tod=noon&weather=clear';
const targetUrl = opt('url', positionalUrl ?? DEFAULT_URL);

const OVERALL_MS = 150_000;
const T0 = Date.now();
const left = () => OVERALL_MS - (Date.now() - T0);
const cap = (ms) => Math.max(1_000, Math.min(ms, left()));
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, Math.max(0, left()))));

async function wf(page, fn, timeoutMs, arg) {
  return page.waitForFunction(fn, arg, { timeout: cap(timeoutMs) });
}

const result = { url: targetUrl, errors: [], frames: [], canary: null, backend: null, pass: false };

function refuseSharedPreview(url) {
  if (url.includes(':4188/') || url.includes(':4188?') || url.endsWith(':4188')) {
    throw new Error('refusing shared :4188 preview; pass an explicit candidate URL (default :4194)');
  }
  if (url.includes(':4173/') || url.includes(':4173?') || url.endsWith(':4173')) {
    throw new Error("refusing owner's :4173 preview; pass an explicit candidate URL (default :4194)");
  }
}

let owned = null;
try {
  refuseSharedPreview(targetUrl);
  if (left() <= 0) throw new Error('overall 150 s budget already exhausted before launch');

  owned = await stockBrowser('carbine-canary');
  const { page } = owned;
  page.on('pageerror', (e) => result.errors.push('PAGEERROR ' + String(e).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error') result.errors.push(m.text().slice(0, 300));
  });

  await page.goto(targetUrl, { waitUntil: 'load', timeout: cap(90_000) });
  await wf(page, () => window.__NT && window.__NT.ready === true, 90_000);

  // Actual WebGPU/post identity from the page; refuse fallback pixels.
  // __NT_BACKEND shape: { requested, actual } where actual is 'webgpu'|'webgl2';
  // the render canvas mirrors it in dataset.ntBackend (a bare canvas selector
  // hits the UI overlay canvas, which has no dataset — hence the attribute filter).
  result.backend = await page.evaluate(() => ({
    report: window.__NT_BACKEND ?? null,
    canvas: document.querySelector('canvas[data-nt-backend]')?.dataset?.ntBackend ?? null,
    post: (() => { try { const p = window.__NTPOST; return p ? { backend: p.backend, enabled: p.enabled } : null; } catch { return null; } })(),
  }));
  const bid = result.backend;
  if (bid?.report?.actual !== 'webgpu' || bid?.canvas !== 'webgpu') {
    throw new Error('not the real WebGPU renderer path (got ' + JSON.stringify(bid?.report) + ' canvas=' + bid?.canvas + '); refusing fallback pixels');
  }
  if (!bid?.post || bid.post.backend !== 'webgpu' || bid.post.enabled !== true) {
    throw new Error('not the WebGPU post path (got ' + JSON.stringify(bid?.post) + '); refusing fallback pixels');
  }

  // Real menu path: Play solo -> Deploy (not any synthetic one-click start).
  const soloBtn = page.getByRole('button', { name: /play solo/i });
  if (await soloBtn.isVisible()) {
    await soloBtn.click({ timeout: cap(15_000) });
    const deployBtn = page.getByRole('button', { name: /deploy/i });
    await deployBtn.waitFor({ state: 'visible', timeout: cap(15_000) });
    await deployBtn.click({ timeout: cap(15_000) });
  }

  // Wait for the REAL canary swap: GLTF adopted, not fallback.
  await wf(page, () => {
    try {
      const s = window.__NT?.weaponCmd?.('state');
      return !!(s && s.carbine && s.carbine.active === true && s.carbine.isGLTF === true);
    } catch {
      return false;
    }
  }, 45_000);

  const canary = await page.evaluate(() => window.__NT?.weaponCmd?.('state')?.carbine ?? null);
  result.canary = canary;

  const required = ['anchor_muzzle', 'anchor_grip', 'anchor_support', 'anchor_mag'];
  const canaryOk = !!canary
    && canary.active === true
    && canary.isGLTF === true
    && typeof canary.url === 'string'
    && canary.url.includes('carbine.glb')
    && Array.isArray(canary.sockets)
    && required.every((s) => canary.sockets.includes(s));
  if (!canaryOk) {
    result.fatal = 'canary status assertion failed (fallback counted as failure by design): ' + JSON.stringify(canary);
    throw new Error(result.fatal);
  }

  // Let the game rAF settle the swapped rig + hands before photographing.
  await sleep(1000);

  // Capture 1: hipfire idle through the game loop (no QA rendering).
  await page.screenshot({ path: join(OUT, 'carbine-hip.png'), timeout: cap(30_000) });
  result.frames.push({ pose: 'hip' });

  // Capture 2: ADS through the game loop.
  await page.evaluate(() => window.__NT?.weaponCmd?.('ads', true));
  await sleep(400);
  await page.screenshot({ path: join(OUT, 'carbine-ads.png'), timeout: cap(30_000) });
  result.frames.push({ pose: 'ads' });
  await page.evaluate(() => window.__NT?.weaponCmd?.('ads', false));

  // Expend exactly one live round through the supported weapon command so the
  // reload below is a real tactical reload (mag < magSize), not a no-op that
  // returns false with the gun still full. Wait for the fire gate in game
  // terms (not reloading, cooldown elapsed) inside the overall budget.
  const before = await page.evaluate(() => {
    const s = window.__NT?.weaponCmd?.('state');
    return s ? { mag: s.mag, shotsFired: s.shotsFired } : null;
  });
  await wf(page, () => {
    try {
      const s = window.__NT?.weaponCmd?.('state');
      return !!(s && s.reloading === false && (s.cool ?? 0) <= 0 && s.mag > 0);
    } catch {
      return false;
    }
  }, 30_000);
  const fired = await page.evaluate(() => window.__NT?.weaponCmd?.('fire'));
  if (fired !== true) throw new Error('live fire command refused (got ' + JSON.stringify(fired) + ')');
  const afterFire = await page.evaluate(() => {
    const s = window.__NT?.weaponCmd?.('state');
    return s ? { mag: s.mag, shotsFired: s.shotsFired } : null;
  });
  if (!before || !afterFire || afterFire.mag !== before.mag - 1 || afterFire.shotsFired !== before.shotsFired + 1) {
    throw new Error('live round did not expend (before=' + JSON.stringify(before) + ' after=' + JSON.stringify(afterFire) + ')');
  }

  // Capture 3: mid-reload reach through the game loop; assert the ACTUAL reload
  // state at the photo, not a sleep that hopes the animation is mid-flight.
  const reloadStarted = await page.evaluate(() => window.__NT?.weaponCmd?.('reload'));
  if (reloadStarted !== true) throw new Error('live reload command refused (got ' + JSON.stringify(reloadStarted) + ')');
  await sleep(500);
  const atPhoto = await page.evaluate(() => {
    const s = window.__NT?.weaponCmd?.('state');
    return s ? { reloading: s.reloading, reloadProgress: s.reloadProgress, mag: s.mag } : null;
  });
  await page.screenshot({ path: join(OUT, 'carbine-reload.png'), timeout: cap(30_000) });
  result.frames.push({ pose: 'reload', reloadState: atPhoto });
  if (!atPhoto || (atPhoto.reloading !== true && !(atPhoto.reloadProgress > 0))) {
    throw new Error('not actually reloading at the reload photo (got ' + JSON.stringify(atPhoto) + ')');
  }

  result.pass = result.errors.length === 0 && result.frames.length === 3 && canaryOk;
} catch (e) {
  if (!result.fatal) result.fatal = String(e && e.message ? e.message : e);
  result.pass = false;
} finally {
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  try { await owned?.close(); } catch {}
}

console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
