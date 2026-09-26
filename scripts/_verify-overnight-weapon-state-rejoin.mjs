/** Exact host magazine/reserve continuity through two real WebRTC rejoins.
 * Preserves the frozen salvage rejoin gates, adding reliable equip, private
 * ammo splits, and native R followed by offline reload completion. No authority,
 * clock, health, input-message or ammunition injection. Serial browser only. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { stockBrowser } from './lib/stock-browser.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const url = option('url', 'http://127.0.0.1:4193/');
const tag = option('tag', 'overnight-weapon-state-rejoin');
assert(/^[a-z0-9_-]+$/i.test(tag), 'safe report tag required');
const expectedCommit = option('expected-commit', null);
assert(/^[a-f0-9]{40}$/i.test(expectedCommit ?? ''), '--expected-commit must pin the built runtime');
const out = join(root, 'captures');
mkdirSync(out, { recursive: true });
const reportPath = join(out, `${tag}.json`);
assert(!existsSync(reportPath) && !existsSync(join(out, `${tag}-resumed.png`)), 'refusing to overwrite an earlier receipt');
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const report = { url, tag, startedAt: new Date().toISOString(), status: 'OPEN', steps: [], errors: [], samples: {} };
report.focusEvents = [];
report.harnessSha256 = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex');
report.boundaries = { inputs: 'Real menu/keyboard and ordinary non-Rail controller fire; only existing player aim fixture',
  privateHostState: 'GameHost actor snapshot on the host page; HostRoom.loadoutOf remains lobby declaration only',
  reload: 'Native KeyR; positive authoritative progress before document destruction; no timer extension',
  ownership: 'Two owned stock muted-output Chrome processes and one owned relay; WebAudio unchanged' };
const step = (name, evidence) => {
  report.steps.push({ name, evidence });
  console.log(`[rejoin] PASS ${name}`);
};
let host, guest, signal;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}
async function until(read, accept, label, timeout = 15000) {
  const end = Date.now() + timeout;
  let value;
  do {
    value = await read();
    if (accept(value)) return value;
    await pause(150);
  } while (Date.now() < end);
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}
function observe(owned, name) {
  owned.page.setDefaultTimeout(15000);
  owned.page.on('pageerror', error => report.errors.push({ page: name, type: 'pageerror', text: String(error) }));
  owned.page.on('console', message => {
    if (message.type() === 'error') report.errors.push({ page: name, type: 'console', text: message.text().slice(0, 300) });
    if (message.text().startsWith('[weapon-rejoin-observe]')) {
      try {
        report.focusEvents.push({ page: name, receivedAt: new Date().toISOString(), ...JSON.parse(message.text().slice(23)) });
        if (report.focusEvents.length > 100) report.focusEvents.shift();
      } catch { /* diagnostic text never changes the acceptance gates */ }
    }
  });
}
async function menuState(page) {
  return page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Multiplayer');
    const rect = button?.getBoundingClientRect();
    const style = button && getComputedStyle(button);
    return {
      surface: window.__AA_UI?.menu.state(), ready: window.__NT?.ready,
      backend: window.__NT_BACKEND, visibility: document.visibilityState,
      stats: window.__NT?.stats(),
      button: button ? { disabled: button.disabled, display: style.display, visibility: style.visibility,
        opacity: style.opacity, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } } : null,
    };
  });
}
async function openMenu(page, callsign, signalUrl) {
  const bootAt = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await page.waitForFunction(() => window.__NT?.ready && window.__AA_UI && window.__NTGAME, null, { timeout: 90000 });
  assert.equal(await page.evaluate(() => window.__NT_BACKEND?.actual), 'webgpu', 'built native WebGPU page required');
  // Device readiness precedes the first usable frames during cold WebGPU
  // compilation. Require actual render progress before normal DOM interaction;
  // the ordinary click's visibility/stability gate and 15-second timeout remain.
  const firstRender = await page.evaluate(() => window.__NT.stats().renderCallsTotal);
  await page.waitForFunction(before => {
    const stats = window.__NT.stats();
    return stats.fps > 0 && stats.renderCallsTotal > before;
  }, firstRender, { polling: 100, timeout: 90000 });
  report.samples[`menu-${callsign ?? 'rejoin'}`] = await menuState(page);
  report.samples[`menu-${callsign ?? 'rejoin'}`].bootMs = Date.now() - bootAt;
  console.log(`[rejoin] rendered menu ${callsign ?? 'rejoin'} after ${Date.now() - bootAt} ms`);
  await page.getByRole('button', { name: 'Multiplayer', exact: true }).click();
  if (callsign) {
    await page.getByLabel('Link', { exact: true }).selectOption('lan');
    await page.getByLabel('Signal server', { exact: true }).fill(signalUrl);
    await page.getByLabel('Signal server', { exact: true }).dispatchEvent('change');
    await page.getByLabel('Callsign', { exact: true }).fill(callsign);
    await page.getByLabel('Callsign', { exact: true }).dispatchEvent('change');
  }
}
const roster = page => page.evaluate(() => window.__NTGAME.lobby.view().roster);
const hostState = () => host.page.evaluate(() => ({
  roster: window.__NTGAME.lobby.view().roster,
  snapshot: window.__NTGAME.snapshot(), counters: window.__NTGAME.counters(),
  bodies: window.__NT.remoteBodies(), driverBodies: window.__NTGAME.bots().map(b => b.id),
  transport: window.__NTGAME.lobby.netLine(performance.now()),
  log: window.__NTGAME.log().slice(-30),
}));
const guestState = () => guest.page.evaluate(() => ({
  id: window.__NTGAME.localId, mode: window.__NTGAME.mode(),
  gun: window.__NT.weaponCmd('state'), kit: window.__NT.weaponCmd('loadout'),
  ordnance: window.__NT.ordnance().self, counters: window.__NTGAME.counters(),
  weaponState: window.__NTGAME.snapshot().weaponState,
  focus: { focused: document.hasFocus(), visibility: document.visibilityState,
    nativeLock: !!document.pointerLockElement && document.pointerLockElement === document.querySelector('canvas[data-nt-backend="webgpu"]'),
    activeTag: document.activeElement?.tagName, editing: !!document.activeElement?.isContentEditable },
  ordnanceLines: window.__NT.ordnance().lines.slice(-30), log: window.__NTGAME.log().slice(-30),
  ack: window.__NTGAME.lobby.guestClient()?.selfAck(),
  resume: window.__NTGAME.lobby.guestClient()?.resumeState(),
  bodies: window.__NT.remoteBodies(),
  streakNames: Array.from(document.querySelectorAll('.hud-streak-card:not(.hud-hidden) .hud-streak-name')).map(n => n.textContent),
  transport: window.__NTGAME.lobby.netLine(performance.now()),
}));
async function active(page, mode) {
  await page.waitForFunction(wanted => {
    try { return window.__NTGAME.mode() === wanted && window.__NTGAME.snapshot().match.phase === 'active'
      && window.__AA_UI.menu.state().surface === 'hidden'; } catch { return false; }
  }, mode, { timeout: 30000 });
}
async function fireOne(page, key) {
  await equip(page, key);
  await page.waitForFunction(() => window.__NT.weaponCmd('state').cool <= 0);
  assert.equal(await page.evaluate(() => window.__NT.weaponCmd('fire')), true, 'normal controller accepted one trigger');
  await pause(350);
  return page.evaluate(() => window.__NT.weaponCmd('state'));
}
function total(gun) { return gun.mag + gun.reserve; }

async function equip(page, key) {
  const id = key === 'Digit1' ? 'mp5' : 'magnum';
  await page.bringToFront();
  await page.waitForFunction(() => document.hasFocus() && document.visibilityState === 'visible', null, { timeout: 5000 });
  await page.keyboard.press(key);
  await page.waitForFunction(wanted => {
    const w = window.__NTGAME.snapshot().weaponState, gun = window.__NT.weaponCmd('state');
    return w?.activeWeaponId === wanted && w.lastIntentReason === null && gun.id === wanted && !gun.actionPending;
  }, id, { timeout: 15000 });
}
async function acquireNativeLock(page) {
  await page.bringToFront();
  await page.waitForFunction(() => document.hasFocus() && document.visibilityState === 'visible', null, { timeout: 5000 });
  const locked = await page.evaluate(() => !!document.pointerLockElement && document.pointerLockElement === document.querySelector('canvas[data-nt-backend="webgpu"]'));
  if (!locked) await page.locator('canvas[data-nt-backend="webgpu"]').click();
  await page.waitForFunction(() => document.hasFocus() && document.visibilityState === 'visible' && !!document.pointerLockElement
    && document.pointerLockElement === document.querySelector('canvas[data-nt-backend="webgpu"]'), null, { timeout: 5000 });
}
const split = w => ({ life: w.life, primary: { weaponId: w.primary.weaponId, mag: w.primary.mag, reserve: w.primary.reserve },
  sidearm: { weaponId: w.sidearm.weaponId, mag: w.sidearm.mag, reserve: w.sidearm.reserve } });
function hostWeapon(state, id) {
  const w = state.snapshot.actors.find(a => a.id === id)?.weaponState;
  assert(w, 'real host private actor weapon state required'); return w;
}
async function identity() {
  const response = await fetch(new URL('preview-identity.json', url), { signal: AbortSignal.timeout(5000) });
  assert(response.ok, 'preview identity must be readable'); const value = await response.json();
  assert.equal(value.project, 'atomic-acres', 'restart repository required');
  assert.equal(value.sourceCommit, expectedCommit, 'exact built commit required');
  const entry = await fetch(new URL(value.entry, url), { signal: AbortSignal.timeout(10000) });
  assert(entry.ok, 'served entry required'); const bytes = new Uint8Array(await entry.arrayBuffer());
  const hash = createHash('sha256').update(bytes).digest('hex'); assert.equal(hash, value.entrySha256, 'served entry bytes must match stamp');
  return { ...value, fetchedEntrySha256: hash, fetchedEntryBytes: bytes.length };
}

try {
  report.identity = await identity();
  const port = await freePort();
  const signalUrl = `http://127.0.0.1:${port}`;
  report.signalUrl = signalUrl;
  signal = spawnGuarded(process.execPath, [join(root, 'scripts/net-signal.mjs'), '--port', String(port)], {
    cwd: root, stdio: 'ignore', windowsHide: true,
  });
  await until(async () => {
    try { return (await fetch(`${signalUrl}/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { return false; }
  }, Boolean, 'owned signal relay did not start');
  host = await stockBrowser(`${tag}-host`); observe(host, 'host');
  await openMenu(host.page, 'rejoin-host', signalUrl);
  guest = await stockBrowser(`${tag}-guest`); observe(guest, 'guest');
  await guest.page.addInitScript(() => {
    const observe = event => {
      if (event.type === 'keydown' && !['KeyR', 'Digit1', 'Digit2'].includes(event.code)) return;
      let w = null; try { w = window.__NTGAME?.snapshot().weaponState; } catch { /* menu */ }
      console.debug('[weapon-rejoin-observe]' + JSON.stringify({ type: event.type, code: event.code,
        at: performance.now(), focused: document.hasFocus(), visibility: document.visibilityState,
        locked: !!document.pointerLockElement, lastIntentSeq: w?.lastIntentSeq,
        lastIntentReason: w?.lastIntentReason, primary: w?.primary, life: w?.life }));
    };
    for (const type of ['blur', 'focus', 'keydown', 'beforeunload', 'pagehide']) addEventListener(type, observe);
    for (const type of ['pointerlockchange', 'visibilitychange']) document.addEventListener(type, observe);
  });
  const guestCdp = await guest.page.context().newCDPSession(guest.page);
  await guestCdp.send('Emulation.setFocusEmulationEnabled', { enabled: false });
  await guest.page.bringToFront();
  report.focusHarness = 'Cleared Playwright default emulation; ordinary bringToFront and native keyboard, no focus-property override';
  await openMenu(guest.page, 'rejoin-guest', signalUrl);

  // The class is selected through the same visible controls a player uses.
  await guest.page.getByRole('button', { name: 'Loadout & streaks', exact: true }).click();
  await guest.page.locator('.aa-prim').filter({ has: guest.page.locator('.aa-prim-name', { hasText: /^MP5$/ }) }).click();
  await guest.page.getByRole('button', { name: 'Magnum', exact: true }).click();
  await guest.page.locator('.aa-tac').filter({ has: guest.page.locator('.aa-tac-name', { hasText: /^Smoke$/ }) }).click();
  const firstSlot = guest.page.getByLabel('Killstreak slot 1', { exact: true });
  const alternate = await firstSlot.evaluate(select => Array.from(select.options).find(o => !o.disabled && o.value !== select.value)?.value);
  assert(alternate, 'a real alternate streak must be available');
  await firstSlot.selectOption(alternate);
  const chosenStreaks = await guest.page.locator('.aa-streak-select').evaluateAll(selects => selects.map(s => s.value));
  const chosenNames = await guest.page.locator('.aa-streak-select').evaluateAll(selects => selects.map(s => s.selectedOptions[0].textContent));
  await guest.page.getByRole('button', { name: 'Back to lobby', exact: true }).click();

  await host.page.getByRole('button', { name: 'Host a room', exact: true }).click();
  const roomCode = await until(() => host.page.locator('.aa-code').textContent(), s => /^[A-Z0-9]{6}$/.test(s ?? ''), 'room code unavailable');
  await guest.page.getByLabel('Join code', { exact: true }).fill(roomCode);
  await guest.page.getByRole('button', { name: 'Join by code', exact: true }).click();
  await until(() => roster(host.page), rows => rows.length === 2 && rows.every(r => r.connected), 'guest did not join over WebRTC', 30000);
  await host.page.getByLabel('Ready', { exact: true }).check();
  await guest.page.getByLabel('Ready', { exact: true }).check();
  await until(() => roster(host.page), rows => rows.every(r => r.ready), 'ready not received');
  await host.page.getByRole('button', { name: 'Start match', exact: true }).click();
  await active(host.page, 'host'); await active(guest.page, 'guest');
  await pause(1000);
  const initial = await until(guestState, s => !!s.weaponState && s.weaponState.primary.weaponId === 'mp5'
    && s.weaponState.sidearm.weaponId === 'magnum', 'private weapon state did not arrive');
  const guestId = initial.id;
  assert.match(initial.transport, /lan peers 1\b/, 'a real open WebRTC data channel is required');
  assert.deepEqual(initial.kit, { primary: 'mp5', sidearm: 'magnum' });
  assert.equal(initial.ordnance.tacticalId, 'smoke');
  await until(guestState, s => s.streakNames.length === 4, 'all four streak HUD slots did not arrive');
  const admitted = await host.page.evaluate(id => ({ kit: window.__NTGAME.lobby.hostRoom().loadoutOf(id),
    streaks: window.__NTGAME.lobby.hostRoom().streakLoadoutOf(id) }), guestId);
  assert.deepEqual(admitted.kit, { primary: 'mp5', sidearm: 'magnum', grenade: 'smoke' });
  assert.deepEqual(admitted.streaks, chosenStreaks);
  step('real menu class and four streak choices admitted over WebRTC', admitted);

  // Aim at the sky so this check consumes genuine ammo without a damage fixture.
  await guest.page.evaluate(() => {
    const p = window.__NT.playerPose(); window.__NT.teleport(p.x, p.y, p.z, p.yaw, 1.1);
  });
  await pause(250);
  const h0 = await hostState();
  const primary = await fireOne(guest.page, 'Digit1');
  const sidearm = await fireOne(guest.page, 'Digit2');
  assert.equal(primary.id, 'mp5'); assert.equal(sidearm.id, 'magnum');
  await equip(guest.page, 'Digit1');
  await guest.page.keyboard.press('Digit3');
  report.samples.fireAttempt = { host: await hostState(), guest: await guestState() };
  await until(hostState, s => s.snapshot.stats.shotsAdmitted === h0.snapshot.stats.shotsAdmitted + 2
    && s.counters.streakDenied === h0.counters.streakDenied + 1, 'ordinary firearm/streak intent was not admitted');
  const before = await until(guestState, s => s.weaponState?.primary.mag === initial.weaponState.primary.mag - 1
    && s.weaponState.sidearm.mag === initial.weaponState.sidearm.mag - 1,
  'guest did not receive the exact spent primary and sidearm magazines');
  const hostBefore = await hostState();
  assert.deepEqual(split(before.weaponState), split(hostWeapon(hostBefore, guestId)), 'guest split disagrees with host before first silence');
  assert.equal(before.weaponState.primary.mag, initial.weaponState.primary.mag - 1);
  assert.equal(before.weaponState.primary.reserve, initial.weaponState.primary.reserve);
  assert.equal(before.weaponState.sidearm.mag, initial.weaponState.sidearm.mag - 1);
  assert.equal(before.weaponState.sidearm.reserve, initial.weaponState.sidearm.reserve);
  assert.equal(hostBefore.counters.shotRejects, h0.counters.shotRejects, 'pre-silence shots rejected');
  report.samples.before = { guest: before, host: hostBefore, primaryRounds: total(primary), sidearmRounds: total(sidearm) };
  step('real primary/sidearm ammo consumed and unearned streak answered', { primaryRounds: total(primary), sidearmRounds: total(sidearm) });

  // Destroy the guest document/transport without sending the deliberate Leave verb.
  await guest.page.goto('about:blank');
  const silent = await until(hostState, s => s.roster.some(r => r.id === guestId && !r.connected), 'host did not reserve the silent seat', 20000);
  assert.equal(silent.roster.length, 2, 'silence must reserve, not delete or duplicate the seat');
  step('host detects actual peer silence and reserves the same seat', silent.roster);
  await openMenu(guest.page, null, signalUrl);
  const rejoinButton = guest.page.getByRole('button', { name: /^Rejoin room [A-Z0-9]{6}$/ });
  assert(await rejoinButton.isVisible(), 'saved seat must have a visible Rejoin action');
  await rejoinButton.click();
  await active(guest.page, 'guest');
  await until(hostState, s => s.roster.length === 2 && s.roster.every(r => r.connected), 'resumed peer did not reconnect');
  // The host refreshes ledger levels every two seconds. As at cold admission,
  // wait for all four real cards before comparing their exact saved names.
  const resumed = await until(guestState, s => s.streakNames.length === 4 && !!s.weaponState
    && s.gun.id === 'mp5' && s.gun.mag === s.weaponState.primary.mag && s.gun.reserve === s.weaponState.primary.reserve,
  'resumed four-slot HUD and authoritative primary projection did not arrive');
  const hostResumed = await hostState();
  assert.equal(resumed.id, guestId, 'rejoin must preserve the authoritative seat');
  assert.equal(resumed.resume?.life, before.counters.lives, 'life epoch changed on rejoin');
  assert(resumed.resume.shotSeq >= 1, 'consumed shots must survive in the host window');
  assert(resumed.resume.lastSeq >= before.ack.seq, 'input high-water regressed');
  assert(resumed.resume.lastStreakSeq >= 0, 'streak intent high-water was omitted');
  assert.deepEqual(resumed.kit, before.kit);
  assert.deepEqual(split(resumed.weaponState), split(before.weaponState), 'first rejoin changed exact primary/sidearm split');
  assert.deepEqual(split(hostWeapon(hostResumed, guestId)), split(before.weaponState), 'host split changed during first silence');
  assert.equal(total(resumed.gun), total(primary), 'rejoin refilled or lost primary ammunition');
  await equip(guest.page, 'Digit2');
  const resumedSidearm = await guest.page.evaluate(() => window.__NT.weaponCmd('state'));
  assert.equal(resumedSidearm.id, 'magnum');
  assert.equal(total(resumedSidearm), total(sidearm), 'rejoin refilled or lost sidearm ammunition');
  assert.equal(resumed.ordnance.tacticalId, 'smoke');
  assert.equal(resumed.ordnance.lethal, before.ordnance.lethal);
  assert.equal(resumed.ordnance.tactical, before.ordnance.tactical);
  assert.deepEqual(resumed.streakNames.map(s => s.toUpperCase()), chosenNames.map(s => s.toUpperCase()));
  assert.equal(hostResumed.counters.spawns, hostBefore.counters.spawns, 'rejoin fabricated a spawn');
  assert.deepEqual(hostResumed.driverBodies, [guestId], 'host driver retained a stale or duplicate guest');
  assert.deepEqual(hostResumed.bodies.map(b => b.id), [guestId], 'host scene retained a stale or duplicate body');
  assert.deepEqual(resumed.bodies.map(b => b.id), ['host'], 'resumed guest scene retained a stale or duplicate host');
  report.samples.resumed = { guest: resumed, host: hostResumed, sidearm: resumedSidearm };
  step('peer replacement preserves class, ammo, life, four HUD slots and one body per seat', { id: guestId, resume: resumed.resume });

  // Fresh normal actions must advance the retained fences, not be dropped as replays.
  await fireOne(guest.page, 'Digit1');
  await guest.page.keyboard.press('Digit3');
  await until(hostState, s => s.snapshot.stats.shotsAdmitted === hostResumed.snapshot.stats.shotsAdmitted + 1
    && s.counters.streakDenied === hostResumed.counters.streakDenied + 1, 'post-resume action lost to stale sequence fences');
  const after = await guestState();
  const hostAfter = await hostState();
  assert(after.ack.seq > resumed.resume.lastSeq, 'new guest inputs did not advance host acknowledgement');
  assert.equal(hostAfter.counters.shotRejects, hostBefore.counters.shotRejects, 'post-resume shot rejected');
  report.samples.after = { guest: after, host: hostAfter };
  await guest.page.screenshot({ path: join(out, `${tag}-resumed.png`) });
  step('post-resume input, shot and streak sequences continue without rejection', { ack: after.ack, stats: hostAfter.snapshot.stats });

  // Native R pays the ordinary tactical timer. Navigation must not invent a
  // completion or suppress any real blur/lock-loss cancellation emitted by the
  // product. Such a cancellation remains a named failure with observer receipts.
  await guest.page.bringToFront();
  await equip(guest.page, 'Digit1');
  const hostBeforeLock = await hostState();
  await acquireNativeLock(guest.page);
  const reloadBefore = await until(guestState, s => s.weaponState?.primary.mag === before.weaponState.primary.mag - 1,
    'post-resume shot has no exact magazine acknowledgement before native R');
  const hostReloadBefore = await hostState();
  assert.equal(hostReloadBefore.snapshot.stats.shotsAdmitted, hostBeforeLock.snapshot.stats.shotsAdmitted, 'the normal lock-acquisition click must not fire a cartridge');
  assert.deepEqual(split(hostWeapon(hostReloadBefore, guestId)), split(hostWeapon(hostBeforeLock, guestId)), 'lock acquisition changed ammunition');
  assert(reloadBefore.focus.focused && reloadBefore.focus.visibility === 'visible' && reloadBefore.focus.nativeLock,
    'native R requires actual document focus and native gameplay canvas pointer lock');
  assert(!reloadBefore.focus.editing && !['INPUT', 'TEXTAREA', 'SELECT'].includes(reloadBefore.focus.activeTag), 'native R must reach gameplay, not a form field');
  assert.deepEqual(split(reloadBefore.weaponState), split(hostWeapon(hostReloadBefore, guestId)));
  const beforeReloadSplit = split(reloadBefore.weaponState);
  assert(beforeReloadSplit.primary.mag > 0 && beforeReloadSplit.primary.mag < initial.weaponState.primary.mag,
    'second disconnect must start a real partially loaded tactical reload');
  const transferred = Math.min(initial.weaponState.primary.mag - beforeReloadSplit.primary.mag, beforeReloadSplit.primary.reserve);
  assert(transferred > 0, 'reload must transfer real reserve rounds');
  const expectedReloadSplit = { ...beforeReloadSplit, primary: { ...beforeReloadSplit.primary,
    mag: beforeReloadSplit.primary.mag + transferred, reserve: beforeReloadSplit.primary.reserve - transferred } };
  report.samples.reloadBefore = { guest: reloadBefore, host: hostReloadBefore, expectedReloadSplit };
  await guest.page.keyboard.press('KeyR');
  const chargingReload = await until(hostState, s => {
    const w = hostWeapon(s, guestId);
    return w.lastIntentSeq > reloadBefore.weaponState.lastIntentSeq && w.lastIntentReason === null && w.primary.reloadRemainingMs > 0;
  }, 'native R did not produce an acknowledged host reload');
  const startedReload = hostWeapon(chargingReload, guestId);
  assert.deepEqual(split(startedReload), beforeReloadSplit, 'starting reload spent or created ammunition');
  assert(startedReload.primary.reloadDurationMs > 0 && startedReload.primary.reloadRemainingMs <= startedReload.primary.reloadDurationMs);
  report.samples.reloadAcknowledgedBeforeBlank = { at: startedReload.at, state: startedReload, wallAt: new Date().toISOString() };
  await guest.page.goto('about:blank');
  assert.equal(guest.page.url(), 'about:blank', 'second guest document was not destroyed');
  report.samples.secondBlankAt = new Date().toISOString();
  const offlineReload = [];
  const completedOffline = await until(async () => {
    const s = await hostState(), w = hostWeapon(s, guestId);
    offlineReload.push({ at: w.at, revision: w.revision, lastIntentSeq: w.lastIntentSeq,
      lastIntentReason: w.lastIntentReason, primary: w.primary, connected: s.roster.find(r => r.id === guestId)?.connected });
    if (offlineReload.length > 40) offlineReload.shift();
    report.samples.offlineReload = offlineReload;
    return s;
  }, s => {
    const w = hostWeapon(s, guestId);
    return w.primary.reloadRemainingMs === 0 && w.primary.mag === expectedReloadSplit.primary.mag
      && w.primary.reserve === expectedReloadSplit.primary.reserve;
  }, 'host reload did not complete while guest document was absent (inspect blur/lock cancellation)', 15000);
  assert.deepEqual(split(hostWeapon(completedOffline, guestId)), expectedReloadSplit);
  assert.equal(total(expectedReloadSplit.primary), total(beforeReloadSplit.primary), 'offline reload changed total issued ammunition');
  assert.equal(completedOffline.counters.spawns, hostReloadBefore.counters.spawns, 'offline reload fabricated a spawn');
  const secondSilent = await until(hostState, s => s.roster.length === 2 && s.roster.some(r => r.id === guestId && !r.connected),
    'second document loss did not retain the same disconnected seat', 20000);
  assert.deepEqual(split(hostWeapon(secondSilent, guestId)), expectedReloadSplit);
  step('native R acknowledged before actual document loss and host completed the unchanged timer offline',
    { before: beforeReloadSplit, started: startedReload, completed: hostWeapon(completedOffline, guestId) });

  await openMenu(guest.page, null, signalUrl);
  const secondRejoin = guest.page.getByRole('button', { name: /^Rejoin room [A-Z0-9]{6}$/ });
  assert(await secondRejoin.isVisible(), 'second retained seat needs the ordinary visible Rejoin action');
  await secondRejoin.click(); await active(guest.page, 'guest');
  await until(hostState, s => s.roster.length === 2 && s.roster.every(r => r.connected), 'second real peer did not reconnect');
  const reloadResumed = await until(guestState, s => s.streakNames.length === 4 && !!s.weaponState
    && s.gun.id === 'mp5' && s.gun.mag === s.weaponState.primary.mag && s.gun.reserve === s.weaponState.primary.reserve,
  'second resume state/HUD did not arrive');
  const hostReloadResumed = await hostState();
  assert.equal(reloadResumed.id, guestId); assert.equal(reloadResumed.resume?.life, reloadBefore.counters.lives);
  assert.deepEqual(split(reloadResumed.weaponState), expectedReloadSplit, 'second rejoin changed the completed exact split');
  assert.deepEqual(split(hostWeapon(hostReloadResumed, guestId)), expectedReloadSplit);
  assert.equal(reloadResumed.weaponState.primary.reloadRemainingMs, 0);
  assert.equal(reloadResumed.gun.mag, expectedReloadSplit.primary.mag); assert.equal(reloadResumed.gun.reserve, expectedReloadSplit.primary.reserve);
  assert(reloadResumed.resume.shotSeq >= hostWeapon(hostReloadBefore, guestId).lastShotSeq, 'second shot fence regressed');
  assert(reloadResumed.resume.lastSeq >= reloadBefore.ack.seq, 'second input fence regressed');
  assert(reloadResumed.resume.lastStreakSeq >= resumed.resume.lastStreakSeq, 'second streak fence regressed');
  assert(reloadResumed.resume.weaponState.lastIntentSeq >= startedReload.lastIntentSeq, 'reload intent fence regressed');
  assert.deepEqual(reloadResumed.kit, before.kit); assert.equal(reloadResumed.ordnance.tacticalId, 'smoke');
  assert.equal(reloadResumed.ordnance.lethal, before.ordnance.lethal); assert.equal(reloadResumed.ordnance.tactical, before.ordnance.tactical);
  assert.deepEqual(reloadResumed.streakNames.map(s => s.toUpperCase()), chosenNames.map(s => s.toUpperCase()));
  assert.equal(hostReloadResumed.counters.spawns, hostBefore.counters.spawns);
  assert.deepEqual(hostReloadResumed.driverBodies, [guestId]); assert.deepEqual(hostReloadResumed.bodies.map(b => b.id), [guestId]);
  assert.deepEqual(reloadResumed.bodies.map(b => b.id), ['host']);
  assert.equal(hostReloadResumed.counters.shotRejects, hostBefore.counters.shotRejects);
  report.samples.reloadResumed = { guest: reloadResumed, host: hostReloadResumed };
  step('second real rejoin preserves completed magazine/reserve, life, sequences, four HUD slots and one body',
    { split: split(reloadResumed.weaponState), resume: reloadResumed.resume });

  await guest.page.keyboard.press('Escape');
  await guest.page.getByRole('button', { name: 'Leave match', exact: true }).click();
  const left = await until(hostState, s => s.roster.length === 1 && s.driverBodies.length === 0
    && s.bodies.length === 0 && !s.snapshot.actors.some(a => a.id === guestId), 'deliberate leave retained stale seat/body');
  assert.equal(await guest.page.evaluate(() => window.__NTGAME.mode()), 'idle');
  assert.equal(await guest.page.evaluate(() => window.__NTGAME.lobby.rejoinCandidate()), null, 'deliberate leave retained credentials');
  report.samples.left = left;
  step('deliberate leave releases host seat, actor, rendered body and guest rejoin offer', left.roster);
  assert.equal(report.errors.length, 0, 'browser emitted errors');
  report.identityAfter = await identity();
  assert.equal(report.identityAfter.fetchedEntrySha256, report.identity.fetchedEntrySha256, 'served build changed during proof');
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.failure = String(error?.stack ?? error); process.exitCode = 1;
  console.error(`[rejoin] ${report.failure}`);
  for (const [name, owned] of [['host', host], ['guest', guest]]) {
    if (!owned) continue;
    try {
      report.samples[`failure-${name}`] = await Promise.race([
        menuState(owned.page), pause(3000).then(() => ({ diagnostic: 'page did not answer in 3 seconds' })),
      ]);
      report.samples[`failure-match-${name}`] = await Promise.race([
        name === 'host' ? hostState() : guestState(),
        pause(3000).then(() => ({ diagnostic: 'match did not answer in 3 seconds' })),
      ]);
    } catch (diagnosticError) { report.samples[`failure-${name}`] = { diagnostic: String(diagnosticError) }; }
  }
} finally {
  const closed = await Promise.allSettled([guest?.close(), host?.close()]);
  for (const result of closed) if (result.status === 'rejected') {
    report.errors.push({ page: 'cleanup', type: 'close', text: String(result.reason) });
    report.status = 'FAIL'; process.exitCode = 1;
  }
  if (signal) {
    try { killTree(signal.pid); }
    catch (error) { report.errors.push({ page: 'cleanup', type: 'signal', text: String(error) }); }
  }
  if (report.errors.length) { report.status = 'FAIL'; process.exitCode = 1; }
  report.endedAt = new Date().toISOString();
  writeFileSync(reportPath, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, steps: report.steps.length, errors: report.errors.length,
    report: `captures/${tag}.json` }));
}
