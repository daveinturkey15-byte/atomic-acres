/** Real WebRTC guest silence -> reserved seat -> visible Rejoin -> clean leave.
 * Two owned stock Chrome instances, ordinary menu admission and controller fire.
 * No fabricated health, damage, charge, authority or protocol messages.
 * Run only in the serial browser slot against the freshly built preview:
 * node scripts/_verify-salvage-net-rejoin.mjs --url http://127.0.0.1:4193/
 */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { stockBrowser } from './lib/stock-browser.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); return i < 0 ? fallback : args[i + 1]; };
const url = option('url', 'http://127.0.0.1:4193/');
const tag = option('tag', 'salvage-net-rejoin');
assert(/^[a-z0-9_-]+$/i.test(tag), 'safe report tag required');
const expectedCommit = option('expected-commit', null);
const out = join(root, 'captures');
mkdirSync(out, { recursive: true });
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const report = { url, tag, startedAt: new Date().toISOString(), status: 'OPEN', steps: [], errors: [], samples: {} };
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
  await page.keyboard.press(key);
  await page.waitForFunction(() => window.__NT.weaponCmd('state').cool <= 0);
  assert.equal(await page.evaluate(() => window.__NT.weaponCmd('fire')), true, 'normal controller accepted one trigger');
  await pause(350);
  return page.evaluate(() => window.__NT.weaponCmd('state'));
}
function total(gun) { return gun.mag + gun.reserve; }

try {
  const identityResponse = await fetch(new URL('preview-identity.json', url), { signal: AbortSignal.timeout(5000) });
  assert(identityResponse.ok, 'preview identity must be readable');
  report.identity = await identityResponse.json();
  assert.equal(report.identity.project, 'atomic-acres', 'restart repository required');
  if (expectedCommit) assert.equal(report.identity.sourceCommit, expectedCommit, 'exact built commit required');
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
  const initial = await guestState();
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
  await guest.page.keyboard.press('Digit1');
  await guest.page.keyboard.press('Digit3');
  report.samples.fireAttempt = { host: await hostState(), guest: await guestState() };
  await until(hostState, s => s.snapshot.stats.shotsAdmitted === h0.snapshot.stats.shotsAdmitted + 2
    && s.counters.streakDenied === h0.counters.streakDenied + 1, 'ordinary firearm/streak intent was not admitted');
  const before = await guestState();
  const hostBefore = await hostState();
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
  const resumed = await until(guestState, s => s.streakNames.length === 4, 'resumed four-slot HUD did not arrive');
  const hostResumed = await hostState();
  assert.equal(resumed.id, guestId, 'rejoin must preserve the authoritative seat');
  assert.equal(resumed.resume?.life, before.counters.lives, 'life epoch changed on rejoin');
  assert(resumed.resume.shotSeq >= 1, 'consumed shots must survive in the host window');
  assert(resumed.resume.lastSeq >= before.ack.seq, 'input high-water regressed');
  assert(resumed.resume.lastStreakSeq >= 0, 'streak intent high-water was omitted');
  assert.deepEqual(resumed.kit, before.kit);
  assert.equal(total(resumed.gun), total(primary), 'rejoin refilled or lost primary ammunition');
  await guest.page.keyboard.press('Digit2');
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

  await guest.page.keyboard.press('Escape');
  await guest.page.getByRole('button', { name: 'Leave match', exact: true }).click();
  const left = await until(hostState, s => s.roster.length === 1 && s.driverBodies.length === 0
    && s.bodies.length === 0 && !s.snapshot.actors.some(a => a.id === guestId), 'deliberate leave retained stale seat/body');
  assert.equal(await guest.page.evaluate(() => window.__NTGAME.mode()), 'idle');
  assert.equal(await guest.page.evaluate(() => window.__NTGAME.lobby.rejoinCandidate()), null, 'deliberate leave retained credentials');
  report.samples.left = left;
  step('deliberate leave releases host seat, actor, rendered body and guest rejoin offer', left.roster);
  assert.equal(report.errors.length, 0, 'browser emitted errors');
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
  if (signal) killTree(signal.pid);
  report.endedAt = new Date().toISOString();
  writeFileSync(join(out, `${tag}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, steps: report.steps.length, errors: report.errors.length,
    report: `captures/${tag}.json` }));
}
