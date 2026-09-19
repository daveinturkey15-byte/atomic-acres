/**
 * Browser capture verification for the Roster Heroes Canary (?heroes=canary).
 *
 * Authored for ROOT execution (DO NOT RUN in sub-agent lane).
 * Root runs it after building:
 *   node scripts/capture-roster-heroes.mjs [--url=http://127.0.0.1:4195/?heroes=canary] [--tag=roster-heroes]
 *
 * Provenance (source-only lane, no browser/GPU/Blender/server ran here):
 *   - Adapted from ROOT read-only scripts/capture-carbine-canary.mjs
 *     (byte-identical in this lane; owns the stockBrowser/overall-bound/backend
 *     conventions below) and ROOT .recovery-roster-acceptance-2216.mjs
 *     (16-id roster sweep, served-bundle sha, base/final __NT.stats()).
 *   - Frozen and untouched: work/roster-heroes-runtime/roster-heroes-loader.ts
 *     and work/roster-heroes-runtime/roster-heroes-integration.patch.
 *     This file makes zero product-code changes.
 *
 * Route discipline (repo-canonical):
 *   - Owned headless stock Chrome via scripts/lib/stock-browser.mjs only.
 *     It owns a temporary nuketown-* profile, runs --headless=new, and removes
 *     its owned tree in close(). This script spawns no browser of its own, so
 *     the owner's profile is never touched and the headless-only contract holds.
 *   - Explicit URL, defaulting to the :4195 candidate with ?heroes=canary
 *     (never the owner's :4173 preview or the shared :4188 preview, both
 *     refused below). Never spawns a preview server.
 *   - Total wall-clock bound: 180 s. Every wait is capped by what is left.
 *   - Owned browser is closed in finally{} even on fatal failure.
 *
 * weaponCmd API truth (proven from root src/weapons/controller.ts command();
 * NOT guessed — there is no 'select' and no 'reset' command, so this script
 * selects with 'switch' and relies on switchTo's reload-pose reset):
 *   used here: 'state' (snapshot incl. heroes/carbine canary status),
 *     'switch' (string id), 'ads' (boolean), 'fire', 'reload', 'refill'
 *     (QA-only top-up, only when a hero's mag reads 0 so a live round exists
 *     to expend — recorded per frame, never silent).
 *
 * What it proves:
 *   - actual heroes adoption: state.heroes.requested === true and adopted[]
 *     holds mp5 + m14-ebr + lmg, each with a *.glb URL and the 4 real anchor
 *     sockets (anchor_muzzle/grip/support/mag). A procedural fallback wearing
 *     a hero name can NOT pass (fallbacks are disposed, never adopted).
 *   - the full 16-id playable roster (catalog order) still switches after the
 *     hero patch, with the carbine canary recorded (asserted only when it was
 *     requested) — adoption is never lost by switching away and back.
 *   - actual WebGPU/post identity from the page (renderer actual + canvas
 *     dataset + __NTPOST backend/enabled), refusing fallback pixels.
 *   - real menu (Play solo + Deploy) into the real active match, then the real
 *     game rAF loop for every photo. No __NT.goto()/teleport() anywhere near
 *     the viewmodel photos: the nine screenshots come straight off the game's
 *     own canvas, where the real GLB models ride hip, ADS and mid-reload.
 *   - one real round expended through weaponCmd('fire') per hero before
 *     reloading, with the actual reload state (reloading/reloadProgress)
 *     asserted at each reload photo. Every frame records its screenshot path
 *     with the live weapon state at the shutter.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from './lib/stock-browser.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const opt = (name, dflt = '') => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return dflt;
  const eq = hit.indexOf('=');
  return eq < 0 ? '1' : hit.slice(eq + 1);
};
const positionalUrl = argv.find((a) => !a.startsWith('--'));
const DEFAULT_URL = 'http://127.0.0.1:4195/?heroes=canary';
const targetUrl = opt('url', positionalUrl ?? DEFAULT_URL);
const tag = (opt('tag', 'roster-heroes').replace(/[^a-zA-Z0-9-_]+/g, '-').slice(0, 64) || 'roster-heroes');
const OUT = join(ROOT, 'captures', tag);
mkdirSync(OUT, { recursive: true });

const OVERALL_MS = 180_000;
const T0 = Date.now();
const left = () => OVERALL_MS - (Date.now() - T0);
const cap = (ms) => Math.max(1_000, Math.min(ms, left()));
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, Math.max(0, left()))));

async function wf(page, fn, timeoutMs, arg) {
  return page.waitForFunction(fn, arg, { timeout: cap(timeoutMs) });
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** The three hero ids, matching ROSTER_HERO_WEAPON_IDS in the frozen loader. */
const HERO_IDS = ['mp5', 'm14-ebr', 'lmg'];
/** Expected GLB filename per hero, from ROSTER_HERO_GLB_URLS (frozen loader). */
const EXPECTED_GLB = { mp5: 'mp5.glb', 'm14-ebr': 'm14-ebr.glb', lmg: 'lmg.glb' };
/** The four real anchors; getPresentRosterHeroSockets reports exactly these. */
const REQUIRED_SOCKETS = ['anchor_muzzle', 'anchor_grip', 'anchor_support', 'anchor_mag'];
/** 16 playable roster ids in src/weapons/catalog.ts order (4 gated exotics excluded). */
const ROSTER_IDS = [
  'longhorn', 'rattler', 'coachman', 'deadeye', 'duster', 'mp5',
  'mini-uzi', 'machine-pistol', 'm4a1', 'ak-47', 'lmg', 'minigun',
  'm14-ebr', 'slug-shotgun', 'magnum', 'flashlight-pistol',
];

const result = {
  url: targetUrl,
  tag,
  errors: [],
  frames: [],
  heroes: null,
  carbine: null,
  backend: null,
  bundle: null,
  baseResources: null,
  finalResources: null,
  rosterSweep: [],
  pass: false,
};

function refuseSharedPreview(url) {
  if (url.includes(':4188/') || url.includes(':4188?') || url.endsWith(':4188')) {
    throw new Error('refusing shared :4188 preview; pass an explicit candidate URL (default :4195 ?heroes=canary)');
  }
  if (url.includes(':4173/') || url.includes(':4173?') || url.endsWith(':4173')) {
    throw new Error("refusing owner's :4173 preview; pass an explicit candidate URL (default :4195 ?heroes=canary)");
  }
}

let owned = null;
try {
  refuseSharedPreview(targetUrl);
  if (left() <= 0) throw new Error('overall 180 s budget already exhausted before launch');

  owned = await stockBrowser('roster-heroes-' + tag);
  const { page } = owned;
  page.on('pageerror', (e) => result.errors.push('PAGEERROR ' + String(e).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error') result.errors.push(m.text().slice(0, 300));
  });

  await page.goto(targetUrl, { waitUntil: 'load', timeout: cap(90_000) });
  await wf(page, () => window.__NT && window.__NT.ready === true, 90_000);

  // Actual WebGPU/post identity from the page; refuse fallback pixels.
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

  // Served-bundle provenance: the live candidate must serve exactly the built JS.
  try {
    const names = readdirSync(join(ROOT, 'dist-heroes-2342', 'assets')).filter((n) => /^index-.*\.js$/.test(n)).sort();
    if (names.length === 0) {
      result.errors.push('no built bundle in dist/assets; root must run this after build');
    } else {
      const asset = names[names.length - 1];
      const sourceSha256 = sha256(readFileSync(join(ROOT, 'dist-heroes-2342', 'assets', asset)));
      const liveBuf = Buffer.from(await (await fetch(new URL(targetUrl).origin + '/assets/' + asset)).arrayBuffer());
      const liveSha256 = sha256(liveBuf);
      result.bundle = { asset, sourceSha256, liveSha256, match: sourceSha256 === liveSha256 };
      if (!result.bundle.match) result.errors.push('served bundle differs from built bundle (' + asset + ')');
    }
  } catch (e) {
    result.errors.push('bundle provenance unreadable: ' + String(e && e.message ? e.message : e).slice(0, 200));
  }

  result.baseResources = await page.evaluate(() => { try { return window.__NT.stats(); } catch { return null; } });

  // Real menu path: Play solo -> Deploy (not any synthetic one-click start).
  const soloBtn = page.getByRole('button', { name: /play solo/i });
  if (await soloBtn.isVisible()) {
    await soloBtn.click({ timeout: cap(15_000) });
    const deployBtn = page.getByRole('button', { name: /deploy/i });
    await deployBtn.waitFor({ state: 'visible', timeout: cap(15_000) });
    await deployBtn.click({ timeout: cap(15_000) });
  }
  // Real active match: the host admits live rounds only in the active phase.
  await wf(page, () => {
    try { return window.__NTGAME?.snapshot?.().match.phase === 'active'; } catch { return false; }
  }, 30_000);

  // Wait for the REAL hero adoption: three GLB rigs, not fallbacks.
  await wf(page, () => {
    try {
      const h = window.__NT?.weaponCmd?.('state')?.heroes;
      if (!h || h.requested !== true || !h.adopted) return false;
      return ['mp5', 'm14-ebr', 'lmg'].every((id) => h.adopted[id] && typeof h.adopted[id].url === 'string');
    } catch {
      return false;
    }
  }, 60_000);

  const heroes = await page.evaluate(() => window.__NT?.weaponCmd?.('state')?.heroes ?? null);
  result.heroes = heroes;
  let heroesOk = !!heroes && heroes.requested === true;
  for (const id of HERO_IDS) {
    const entry = heroes?.adopted?.[id];
    const ok = !!entry
      && typeof entry.url === 'string'
      && entry.url.includes(EXPECTED_GLB[id])
      && Array.isArray(entry.sockets)
      && REQUIRED_SOCKETS.every((s) => entry.sockets.includes(s));
    if (!ok) {
      heroesOk = false;
      result.errors.push('hero adoption assertion failed for ' + id + ': ' + JSON.stringify(entry));
    }
  }
  if (!heroesOk) {
    result.fatal = 'heroes adoption assertion failed (fallback counts as failure by design): ' + JSON.stringify(heroes);
    throw new Error(result.fatal);
  }

  // Carbine canary recorded so a hero run can also prove it did not regress;
  // asserted only when the URL requested it.
  result.carbine = await page.evaluate(() => window.__NT?.weaponCmd?.('state')?.carbine ?? null);
  if (result.carbine?.requested === true) {
    const c = result.carbine;
    const carbineOk = c.active === true && c.isGLTF === true
      && typeof c.url === 'string' && c.url.includes('carbine.glb')
      && Array.isArray(c.sockets) && REQUIRED_SOCKETS.every((s) => c.sockets.includes(s));
    if (!carbineOk) throw new Error('carbine canary lost during hero run: ' + JSON.stringify(c));
  }

  // Sweep the full 16-id playable roster through the real switch command.
  for (const id of ROSTER_IDS) {
    const switched = await page.evaluate((wid) => window.__NT?.weaponCmd?.('switch', wid), id);
    let stateId = null;
    try {
      await wf(page, (wid) => {
        try { return window.__NT?.weaponCmd?.('state')?.id === wid; } catch { return false; }
      }, 8_000, id);
      stateId = id;
    } catch {
      stateId = await page.evaluate(() => { try { return window.__NT?.weaponCmd?.('state')?.id ?? null; } catch { return null; } });
    }
    const ok = switched === true && stateId === id;
    result.rosterSweep.push({ id, switched, stateId, ok });
    if (!ok) throw new Error('roster switch failed for ' + id + ' (switched=' + JSON.stringify(switched) + ' state=' + JSON.stringify(stateId) + ')');
  }

  // Adoption must survive the sweep: all three heroes still adopted.
  const afterSweep = await page.evaluate(() => window.__NT?.weaponCmd?.('state')?.heroes ?? null);
  const kept = HERO_IDS.every((id) => afterSweep?.adopted?.[id]?.url?.includes(EXPECTED_GLB[id]));
  if (!kept) throw new Error('hero adoption lost during roster sweep: ' + JSON.stringify(afterSweep?.adopted));

  // Nine reviewable frames: hip / ADS / mid-reload per hero, off the live loop.
  for (const id of HERO_IDS) {
    const switched = await page.evaluate((wid) => window.__NT?.weaponCmd?.('switch', wid), id);
    if (switched !== true) throw new Error('hero select failed for ' + id);
    await wf(page, (wid) => {
      try { return window.__NT?.weaponCmd?.('state')?.id === wid; } catch { return false; }
    }, 8_000, id);
    await sleep(800); // let the game rAF settle the adopted rig + hands

    const snap = async () => page.evaluate(() => {
      try {
        const s = window.__NT?.weaponCmd?.('state');
        return s ? { id: s.id, mag: s.mag, reserve: s.reserve, ads: s.ads, reloading: s.reloading, reloadProgress: s.reloadProgress, shotsFired: s.shotsFired } : null;
      } catch { return null; }
    });

    // Pose 1: hipfire idle.
    const hipFile = id + '-hip.png';
    await page.screenshot({ path: join(OUT, hipFile), timeout: cap(30_000) });
    result.frames.push({ weapon: id, pose: 'hip', path: 'captures/' + tag + '/' + hipFile, state: await snap(), refilled: false });

    // Pose 2: ADS.
    await page.evaluate(() => window.__NT?.weaponCmd?.('ads', true));
    await sleep(500);
    const adsFile = id + '-ads.png';
    await page.screenshot({ path: join(OUT, adsFile), timeout: cap(30_000) });
    const adsState = await snap();
    result.frames.push({ weapon: id, pose: 'ads', path: 'captures/' + tag + '/' + adsFile, state: adsState, refilled: false });
    await page.evaluate(() => window.__NT?.weaponCmd?.('ads', false));
    if (!adsState || adsState.ads !== true) throw new Error('not actually aiming at the ADS photo for ' + id + ' (got ' + JSON.stringify(adsState) + ')');

    // One live round so the reload below is tactical, not a full-mag no-op.
    let pre = await snap();
    let refilled = false;
    if (pre && pre.mag <= 0) {
      await page.evaluate(() => window.__NT?.weaponCmd?.('refill'));
      refilled = true;
      pre = await snap();
    }
    await wf(page, () => {
      try {
        const s = window.__NT?.weaponCmd?.('state');
        return !!(s && s.reloading === false && (s.cool ?? 0) <= 0 && s.mag > 0);
      } catch {
        return false;
      }
    }, 30_000);
    const before = await snap();
    const fired = await page.evaluate(() => window.__NT?.weaponCmd?.('fire'));
    if (fired !== true) throw new Error('live fire command refused for ' + id + ' (got ' + JSON.stringify(fired) + ')');
    const afterFire = await snap();
    if (!before || !afterFire || afterFire.mag !== before.mag - 1 || afterFire.shotsFired !== before.shotsFired + 1) {
      throw new Error('live round did not expend for ' + id + ' (before=' + JSON.stringify(before) + ' after=' + JSON.stringify(afterFire) + ')');
    }

    // Pose 3: mid-reload; assert the ACTUAL reload state at the photo.
    const reloadStarted = await page.evaluate(() => window.__NT?.weaponCmd?.('reload'));
    if (reloadStarted !== true) throw new Error('live reload command refused for ' + id + ' (got ' + JSON.stringify(reloadStarted) + ')');
    await sleep(500);
    const atPhoto = await snap();
    const reloadFile = id + '-reload.png';
    await page.screenshot({ path: join(OUT, reloadFile), timeout: cap(30_000) });
    result.frames.push({ weapon: id, pose: 'reload', path: 'captures/' + tag + '/' + reloadFile, state: atPhoto, refilled });
    if (!atPhoto || (atPhoto.reloading !== true && !(atPhoto.reloadProgress > 0))) {
      throw new Error('not actually reloading at the reload photo for ' + id + ' (got ' + JSON.stringify(atPhoto) + ')');
    }
    // Leave the gun settled before the next hero; switchTo would reset it anyway.
    try {
      await wf(page, () => {
        try { return window.__NT?.weaponCmd?.('state')?.reloading === false; } catch { return false; }
      }, 15_000);
    } catch { /* recorded below; the next switch resets the pose regardless */ }
    result.frames[result.frames.length - 1].reloadSettled = await page.evaluate(() => {
      try { return window.__NT?.weaponCmd?.('state')?.reloading === false; } catch { return null; }
    });
  }

  result.finalResources = await page.evaluate(() => { try { return window.__NT.stats(); } catch { return null; } });

  const sweepOk = result.rosterSweep.length === ROSTER_IDS.length && result.rosterSweep.every((r) => r.ok);
  result.pass = result.errors.length === 0
    && result.frames.length === 9
    && heroesOk
    && sweepOk
    && !!result.bundle?.match;
} catch (e) {
  if (!result.fatal) result.fatal = String(e && e.message ? e.message : e);
  result.pass = false;
} finally {
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  try { await owned?.close(); } catch {}
}

console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
