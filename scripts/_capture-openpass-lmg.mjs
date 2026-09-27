/** Root's serial GPU runner. Real menu/input; only grounded player pose is staged.
 * One compiled entry, fresh owned Chrome per variant, full PNGs, no art-pass claim. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { freemem } from 'node:os';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from './lib/stock-browser.mjs';
import { waitForRenderedPage } from './lib/render-ready.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(`--${name}`); return i < 0 ? null : args[i + 1]; };
const commit = opt('expected-commit'), entryHash = opt('expected-entry-sha256'), tag = opt('tag');
assert(/^[a-f0-9]{40}$/i.test(commit ?? ''), '--expected-commit required');
assert(/^[a-f0-9]{64}$/i.test(entryHash ?? ''), '--expected-entry-sha256 required');
assert(/^[a-z0-9_-]{1,80}$/i.test(tag ?? ''), '--tag required; choose a new output tag');
const baseUrl = new URL(opt('url') ?? 'http://127.0.0.1:4361/');
assert(['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname), 'loopback compiled preview only');
assert(baseUrl.protocol === 'http:' || baseUrl.protocol === 'https:');
for (const key of ['lmg-model', 'heroes']) baseUrl.searchParams.delete(key);
assert(!baseUrl.searchParams.has('art') || baseUrl.searchParams.get('art') !== 'baseline', 'use unchanged current authored presentation');
const variants = args.includes('--include-hero') ? ['family', 'canary', 'retained-hero'] : ['family', 'canary'];
const out = join(root, 'captures', tag);
assert(!existsSync(out), 'overwrite refused; preserve failed evidence'); mkdirSync(out, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const helperHashes = Object.fromEntries(['scripts/lib/stock-browser.mjs', 'scripts/lib/render-ready.mjs', 'scripts/lib/proc-guard.mjs']
  .map(file => [file, hash(readFileSync(join(root, file)))]));
const report = { status: 'OPEN', startedAt: new Date().toISOString(), expectedCommit: commit, expectedEntrySha256: entryHash,
  harnessSha256: hash(readFileSync(fileURLToPath(import.meta.url))), helperHashes, variants: [],
  limits: { totalWallSeconds: 480, minimumFreeVramMiB: 4096, minimumFreeRamGiB: 12 },
  scope: 'Actual-game paired stills; not neutral turntable, motion-cadence, performance, audio quality, gameplay completeness or owner art acceptance',
  view: { width: 1600, height: 900, dpr: 1 },
  controls: 'Real menu selects LMG, one live Recruit, FFA; native focus/pointer lock, mouse ADS/fire/turn and keyboard reload. Grounded player position/aim is the sole QA mutation.',
  comparison: 'One compiled source/entry, same admitted ground pose and settings. Live bots, recoil and timing are recorded, not frozen or claimed pixel-identical.',
  neutralViews: 'OPEN: no standalone viewer or fake neutralized gameplay scene is produced.' };
let owned, cdp, timedOut = false, fixedPose = null;
const deadline = setTimeout(() => { timedOut = true; void owned?.close(); }, 480000);
deadline.unref();
function resourceAdmission() {
  const raw = execFileSync('nvidia-smi.exe', ['--query-gpu=index,name,memory.free,memory.used,utilization.gpu,driver_version', '--format=csv,noheader,nounits'],
    { encoding: 'utf8', windowsHide: true, timeout: 10000 }).trim();
  const gpus = raw.split(/\r?\n/).map(line => { const [index, name, free, used, utilization, driver] = line.split(',').map(v => v.trim());
    return { index: +index, name, freeMiB: +free, usedMiB: +used, utilizationPercent: +utilization, driver }; });
  const memory = freemem() / 1024 ** 3;
  assert(gpus.length === 1 && gpus[0].freeMiB >= 4096, 'single known GPU needs >=4GiB free; no owner process is stopped');
  assert(memory >= 12, '>=12GiB free system RAM required');
  return { at: new Date().toISOString(), gpus, freeRamGiB: memory };
}
async function identity(url) {
  const response = await fetch(new URL('preview-identity.json', url), { signal: AbortSignal.timeout(10000), cache: 'no-store' });
  assert(response.ok, 'preview identity required'); const id = await response.json();
  assert.equal(id.project, 'atomic-acres'); assert.equal(id.sourceCommit, commit); assert.equal(id.entrySha256.toLowerCase(), entryHash.toLowerCase());
  const entry = await fetch(new URL(id.entry, url), { signal: AbortSignal.timeout(10000), cache: 'no-store' }); assert(entry.ok);
  const bytes = new Uint8Array(await entry.arrayBuffer()); assert.equal(hash(bytes), entryHash.toLowerCase());
  return { ...id, fetchedEntryBytes: bytes.length, fetchedEntrySha256: hash(bytes) };
}
async function runVariant(variant) {
  const url = new URL(baseUrl); url.searchParams.set('capture', `${tag}-${variant}`);
  if (variant === 'canary') url.searchParams.set('lmg-model', 'canary');
  if (variant === 'retained-hero') url.searchParams.set('heroes', 'canary');
  const row = { variant, url: url.href, status: 'OPEN', frames: [], errors: [], stages: [], samples: {} };
  report.variants.push(row);
  let initialLife, previousAt = -1, previousRender = -1;
  try {
    row.resources = resourceAdmission(); row.identityBefore = await identity(url);
    owned = await stockBrowser(`${tag}-${variant}`); const { page } = owned;
    await page.setViewportSize({ width: 1600, height: 900 }); page.setDefaultTimeout(15000);
    page.on('pageerror', e => row.errors.push({ kind: 'page', message: String(e) }));
    page.on('console', m => { if (m.type() === 'error') row.errors.push({ kind: 'console', message: m.text().slice(0, 500) }); });
    page.on('response', r => { if (r.status() >= 400) row.errors.push({ kind: 'http', status: r.status(), url: r.url() }); });
    cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: false }); await page.bringToFront();
    row.browser = await cdp.send('Browser.getVersion');
    const entryResponses = [];
    page.on('response', response => { if (response.url().split('?')[0] === new URL(row.identityBefore.entry, url).href.split('?')[0]) entryResponses.push(response); });
    await page.goto(url.href, { waitUntil: 'load', timeout: 90000 }); await waitForRenderedPage(page, 90000);
    const firstRender = await page.evaluate(() => window.__NT.stats().renderCallsTotal);
    await page.waitForFunction(before => window.__NT.stats().renderCallsTotal > before + 2
      && window.__AA_UI.menu.state().surface === 'pre-match' && window.__AA_UI.menu.panel() === 'main', firstRender, { timeout: 90000, polling: 100 });
    row.environment = await page.evaluate(() => ({ backend: window.__NT_BACKEND, flags: window.__NT_FLAGS,
      width: innerWidth, height: innerHeight, dpr: devicePixelRatio, visibility: document.visibilityState,
      focus: document.hasFocus(), canvases: [...document.querySelectorAll('canvas')].map(c => ({ width: c.width, height: c.height, backend: c.dataset.ntBackend })) }));
    assert.equal(row.environment.backend.actual, 'webgpu'); assert.equal(row.environment.dpr, 1);
    assert.equal(row.environment.width, 1600); assert.equal(row.environment.height, 900);
    assert.equal(entryResponses.length, 1, 'exactly one matching compiled script request');
    assert.equal(hash(await entryResponses[0].body()), entryHash.toLowerCase(), 'browser actually loaded pinned entry');
    async function menuFrame(name) {
      const file = `${variant}-${name}.png`, path = join(out, file); await page.screenshot({ path, fullPage: false });
      row.frames.push({ name, file, sha256: hash(readFileSync(path)), menu: await page.evaluate(() => window.__AA_UI.menu.state()) });
    }
    await menuFrame('menu');
    await page.getByRole('button', { name: 'Play solo', exact: true }).click();
    await page.locator('.aa-prim').filter({ has: page.locator('.aa-prim-name', { hasText: /^LMG$/ }) }).click();
    await page.locator('.aa-sidearm').filter({ has: page.locator('.aa-prim-name', { hasText: /^Duster$/ }) }).click();
    await page.getByLabel('Bots', { exact: true }).focus(); await page.keyboard.press('Home');
    assert.equal(await page.getByLabel('Bots', { exact: true }).inputValue(), '1');
    await page.getByRole('radio', { name: 'Recruit', exact: true }).click();
    await page.getByLabel('Mode', { exact: true }).selectOption('ffa');
    await page.getByLabel('Time limit', { exact: true }).selectOption('600000');
    await page.getByLabel('Kill limit', { exact: true }).selectOption('25'); await menuFrame('loadout');
    await page.getByRole('button', { name: 'Deploy', exact: true }).click();
    await page.waitForFunction(() => window.__NTGAME?.snapshot().match.phase === 'active', null, { timeout: 30000 });
    await page.locator('canvas[data-nt-backend="webgpu"]').click();
    await page.waitForFunction(() => document.pointerLockElement === document.querySelector('canvas[data-nt-backend="webgpu"]'), null, { timeout: 5000 });
    async function state(validate = true) {
      const s = await page.evaluate(() => {
        const snap = window.__NTGAME.snapshot(), gun = window.__NT.weaponCmd('state'), hud = window.__NT.weaponCmd('hud');
        return { at: performance.now(), match: snap.match, actor: snap.actors.find(a => a.id === window.__NTGAME.localId),
          actorCount: snap.actors.length, botCount: snap.actors.filter(a => a.bot).length, gun, adsT: hud.adsT,
          kit: window.__NT.weaponCmd('loadout'), pose: window.__NT.playerPose(), stats: window.__NT.stats(),
          audio: window.__NT.audio(), menu: window.__AA_UI.menu.state(), lastShot: window.__NT.lastWeaponShot(),
          nativeLock: document.pointerLockElement === document.querySelector('canvas[data-nt-backend="webgpu"]'),
          focus: document.hasFocus(), visibility: document.visibilityState };
      });
      if (validate) {
        assert(!timedOut, 'bounded total time expired'); assert(s.at > previousAt, 'real observation clock must advance');
        assert(s.stats.renderCallsTotal >= previousRender, 'real render invocation counter must not reset');
        previousAt = s.at; previousRender = s.stats.renderCallsTotal;
        assert.equal(s.match.phase, 'active'); assert(s.actor.alive && s.actor.deaths === 0, 'initial actor must remain alive; no respawn/recovery');
        if (initialLife !== undefined) assert.equal(s.actor.life, initialLife, 'same initial life');
        assert.equal(s.botCount, 1); assert.equal(s.kit.primary, 'lmg'); assert.equal(s.kit.sidearm, 'duster'); assert.equal(s.actor.primaryId, 'lmg');
        assert.equal(s.actor.weaponState?.primary.weaponId, 'lmg', 'actual host weapon state required');
        assert(s.nativeLock && s.focus && s.visibility === 'visible', 'native focused pointer lock required');
        assert.equal(s.audio.state, 'running', 'WebAudio remains active; only Chrome output is muted');
        assert(s.gun.visible, 'real weapon must be visible');
      }
      return s;
    }
    async function until(accept, label, timeout = 15000) {
      const end = Date.now() + timeout; let s;
      do { s = await state(); if (accept(s)) return s; await pause(50); } while (Date.now() < end);
      row.samples.lastWait = { label, state: s }; throw Error(`Timed out: ${label}`);
    }
    const initial = await state(); initialLife = initial.actor.life; row.samples.initial = initial;
    await until(s => s.gun.id === 'lmg' && !s.gun.actionPending && !s.gun.reloading && s.gun.cool <= 0, 'authoritative equipped LMG');
    if (variant === 'retained-hero') await until(s => !!s.gun.heroes?.adopted?.lmg, 'retained GLB really adopted');
    const adoption = await state(); row.samples.adoption = adoption;
    assert.equal(adoption.gun.lmgModelCanary?.requested, variant === 'canary');
    assert.equal(adoption.gun.lmgModelCanary?.adopted, variant === 'canary');
    if (variant === 'canary') {
      assert.equal(adoption.gun.lmgModelCanary.sockets.length, 8);
      assert(adoption.gun.lmgModelCanary.stats.meshes <= 24 && adoption.gun.lmgModelCanary.stats.triangles <= 16000);
    }
    const selection = await page.evaluate(pinned => {
      const bots = window.__NTGAME.bots(), flights = window.__NT.ordnance().flights ?? [];
      const points = pinned ? [pinned] : [{ x: -6, z: 0, yaw: -Math.PI / 2 },
        ...[-17, -12, -6, 6, 16, 22].flatMap(x => [-38, -31, 31, 38].map(z => ({ x, z, yaw: z < 0 ? Math.PI : 0, pitch: 0 })))];
      const candidates = points.map(p => ({ ...p, pitch: 0, y: window.__NTGAME.groundY(p.x, p.z),
        botGap: Math.min(...bots.map(b => Math.hypot(b.x - p.x, b.z - p.z))),
        flightGap: Math.min(...flights.map(f => Math.hypot(f.x - p.x, f.z - p.z))) }))
        .filter(p => Number.isFinite(p.y) && p.y <= .5 && !window.__NT.collidersAt(p.x, p.z, p.y + .9).length
          && p.botGap > 30 && p.flightGap > 15 && bots.every(b => !b.alive || !window.__NTGAME.los(p.x, p.y + 1.1, p.z, b.x, b.y + 1.1, b.z)));
      candidates.sort((a, b) => b.botGap - a.botGap); const selected = candidates[0];
      if (selected) window.__NT.teleport(selected.x, selected.y, selected.z, selected.yaw, 0);
      return { selected: selected ?? null, candidates, bots };
    }, fixedPose);
    row.samples.poseAdmission = selection;
    assert(selection.selected, 'same concealed grounded pose must admit safely; never move bots or choose a different comparison camera');
    if (!fixedPose) { const { x, y, z, yaw, pitch } = selection.selected; fixedPose = { x, y, z, yaw, pitch }; report.fixedPose = fixedPose; }
    row.fixedPose = { ...fixedPose };
    async function stage() {
      const placed = await page.evaluate(p => {
        const y = window.__NTGAME.groundY(p.x, p.z);
        if (!Number.isFinite(y) || Math.abs(y - p.y) > .001 || window.__NT.collidersAt(p.x, p.z, y + .9).length) return false;
        window.__NT.teleport(p.x, y, p.z, p.yaw, p.pitch); return true;
      }, fixedPose); assert(placed, 'ground fixture still valid'); await pause(180);
    }
    async function frame(name, accept) {
      const before = await until(accept, name), file = `${variant}-${name}.png`, path = join(out, file);
      await page.screenshot({ path, fullPage: false });
      const record = { name, file, sha256: hash(readFileSync(path)), before, after: null, status: 'UNVALIDATED' }; row.frames.push(record);
      const after = await state(); record.after = after;
      assert(after.stats.renderCallsTotal > before.stats.renderCallsTotal, 'actual render invocations must advance across screenshot');
      assert(accept(after), `${name} changed state while taking PNG; preserve as rejected evidence`);
      for (const s of [before, after]) {
        assert(Math.hypot(s.pose.x - fixedPose.x, s.pose.z - fixedPose.z) < .05, 'player remains at the fixed ground station');
        if (name === 'hip' || name === 'ads') assert(Math.abs(s.pose.yaw - fixedPose.yaw) < .003 && Math.abs(s.pose.pitch - fixedPose.pitch) < .003,
          'paired rested hip/ADS use the actual fixed player aim');
      }
      record.status = 'CAPTURED_PENDING_PIXEL_REVIEW';
      console.log(`[openpass-lmg] ${variant}/${name}`);
    }
    await stage(); await frame('hip', s => !s.gun.ads && s.adsT < .01 && !s.gun.reloading);
    await page.mouse.down({ button: 'right' });
    try { await frame('ads', s => s.gun.ads && s.adsT >= .995 && !s.gun.reloading); }
    finally { await page.mouse.up({ button: 'right' }); }
    await stage(); await until(s => !s.gun.ads && s.adsT < .01 && !s.gun.actionPending && s.gun.cool <= 0, 'native trigger readiness');
    const preFire = await state(); row.samples.preFire = preFire;
    await page.mouse.down();
    try {
      await until(s => s.gun.mag < preFire.gun.mag && s.actor.rounds < preFire.actor.rounds && s.lastShot.seq > preFire.lastShot.seq, 'native fire admitted by host');
      await frame('firing', s => !s.gun.reloading && s.gun.mag < preFire.gun.mag && s.actor.rounds < preFire.actor.rounds);
    } finally { await page.mouse.up(); }
    const beforeReload = await until(s => !s.gun.actionPending && s.gun.cool <= 0, 'fire released'); row.samples.beforeReload = beforeReload;
    await page.keyboard.press('KeyR');
    for (const [name, lo, hi] of [['reload-25', .18, .36], ['reload-50', .43, .61], ['reload-75', .68, .86]]) {
      await frame(name, s => s.gun.reloading && s.gun.reloadProgress >= lo && s.gun.reloadProgress < hi);
    }
    const loaded = await until(s => !s.gun.reloading && !s.gun.actionPending, 'authoritative reload finished'); row.samples.loaded = loaded;
    const beforeAmmo = beforeReload.actor.weaponState.primary, afterAmmo = loaded.actor.weaponState.primary;
    assert(loaded.gun.mag > beforeReload.gun.mag && afterAmmo.mag > beforeAmmo.mag, 'host and controller refill');
    assert.equal(afterAmmo.mag + afterAmmo.reserve, beforeAmmo.mag + beforeAmmo.reserve, 'reload conserves actual host split');
    assert.equal(loaded.actor.rounds, beforeReload.actor.rounds, 'public rounds is total ammunition, unchanged by reload');
    await stage(); const turnBefore = await state();
    // Native relative pointer motion under the actual lock. No camera override.
    await page.mouse.move(800, 450); await page.mouse.move(940, 450);
    const turn = await until(s => Math.abs(s.pose.yaw - turnBefore.pose.yaw) > .03, 'native turn changes actual player yaw');
    row.samples.turn = { before: turnBefore, after: turn };
    await frame('turn', s => !s.gun.reloading && Math.abs(s.pose.yaw - turnBefore.pose.yaw) > .03);
    row.samples.final = await state(); row.identityAfter = await identity(url);
    for (const [file, expected] of Object.entries(helperHashes)) assert.equal(hash(readFileSync(join(root, file))), expected, 'capture helper changed during run');
    assert.equal(hash(readFileSync(fileURLToPath(import.meta.url))), report.harnessSha256, 'runner changed during run');
    assert.equal(row.errors.length, 0, 'browser/network errors remain failures');
    row.status = 'CAPTURED_PENDING_PIXEL_REVIEW';
  } catch (error) {
    row.status = 'FAIL'; row.failure = String(error?.stack ?? error); throw error;
  } finally {
    try { await cdp?.detach(); } catch { /* owned target may already be closed */ } cdp = undefined;
    await owned?.close(); owned = undefined;
    writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  }
}
try {
  for (const variant of variants) await runVariant(variant);
  assert(!timedOut); report.status = 'CAPTURED_PENDING_PIXEL_REVIEW';
} catch (error) {
  report.status = 'FAIL'; report.failure = String(error?.stack ?? error); process.exitCode = 1; console.error(report.failure);
} finally {
  clearTimeout(deadline); await owned?.close(); report.endedAt = new Date().toISOString();
  writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`[openpass-lmg] ${report.status}: ${join(out, 'report.json')}`);
}
