/**
 * Live remote-audio proof on the already-running candidate and signalling
 * relay. This deliberately follows the real two-stock-browser lobby path from
 * _verify-net-refinement.mjs, but never starts a preview, relay, or server.
 * Root runs it on candidate 4192 with relay 4310 after the integration build.
 *
 * Gates:
 *   - a trusted menu gesture unlocks both peers and decodes the real 21-entry
 *     bank (5 recorded shots, 8 recorded foley entries);
 *   - one accepted host miss increments only the remote listener's playback
 *     counter, exactly once;
 *   - the shooter's own predicted playback does not become a remote echo;
 *   - remote diagnostics expose distance/pan/occlusion and voices stay <= 16;
 *   - both peers remain active clients while the edge is observed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from './lib/stock-browser.mjs';

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const CANDIDATE = opt('url', 'http://127.0.0.1:4192/');
const SIGNAL_URL = opt('signal-url', 'http://127.0.0.1:' + opt('signal-port', '4310'));
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RESULT_PATH = join(ROOT, 'captures', 'remote-audio-live', 'result.json');
const RUN_TAG = 'remote-audio-live-' + Date.now();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cacheBusted = (url) => {
  const value = new URL(url);
  value.searchParams.set('qa', RUN_TAG);
  return value.href;
};

const report = {
  candidate: CANDIDATE,
  signalUrl: SIGNAL_URL,
  steps: [],
  errors: {},
};
let code = 0;
const step = (name, pass, detail) => {
  report.steps.push({ name, state: pass ? 'VERIFIED' : 'FAIL', detail });
  if (!pass) code = 1;
  console.log(`[remote-audio-live] ${pass ? 'OK   ' : 'FAIL '}${name}${detail ? '  ' + detail : ''}`);
};
const waitFor = async (fn, timeoutMs, intervalMs = 100) => {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    last = await fn();
    if (last) return last;
    await sleep(intervalMs);
  }
  return last;
};

async function openMultiplayer(peer, callsign, url) {
  await peer.page.goto(url, { waitUntil: 'load', timeout: 90_000 });
  await peer.page.waitForFunction(
    () => window.__NT?.ready === true && window.__AA_UI && window.__NTGAME,
    null,
    { timeout: 180_000 },
  );
  await peer.page.getByRole('button', { name: 'Multiplayer' }).click();
  await peer.page.getByLabel('Link').selectOption('lan');
  await peer.page.getByLabel('Signal server').fill(SIGNAL_URL);
  await peer.page.getByLabel('Signal server').dispatchEvent('change');
  await peer.page.getByLabel('Callsign').fill(callsign);
  await peer.page.getByLabel('Callsign').dispatchEvent('change');
}

const roster = (peer) => peer.page.evaluate(() => window.__NTGAME.lobby.view().roster.map((r) => ({
  id: r.id, name: r.name, connected: r.connected, ready: r.ready,
})));
const audio = (peer) => peer.page.evaluate(() => window.__NT.audio());
const snapshot = (peer) => peer.page.evaluate(() => {
  const g = window.__NTGAME;
  const s = g.snapshot();
  const self = s.actors.find((a) => a.id === g.localId) ?? null;
  return { mode: g.mode(), phase: s.match.phase, self, stats: s.stats ?? null };
});

let A = null;
let B = null;
try {
  A = await stockBrowser('remote-audio-live-A');
  B = await stockBrowser('remote-audio-live-B');
  const errorsA = [];
  const errorsB = [];
  A.page.on('console', (message) => { if (message.type() === 'error') errorsA.push(message.text().slice(0, 240)); });
  B.page.on('console', (message) => { if (message.type() === 'error') errorsB.push(message.text().slice(0, 240)); });
  A.page.on('pageerror', (error) => errorsA.push('PAGEERROR ' + String(error).slice(0, 240)));
  B.page.on('pageerror', (error) => errorsB.push('PAGEERROR ' + String(error).slice(0, 240)));

  const url = cacheBusted(CANDIDATE);
  await Promise.all([openMultiplayer(A, 'alpha', url), openMultiplayer(B, 'bravo', url)]);
  await A.page.getByRole('button', { name: 'Host a room' }).click();
  await A.page.waitForFunction(
    () => /^[0-9A-Z]{6}$/.test(document.querySelector('#start .aa-code')?.textContent ?? ''),
    null,
    { timeout: 10_000 },
  );
  const roomCode = await A.page.evaluate(() => document.querySelector('#start .aa-code')?.textContent ?? '');
  step('host room code appears in the real multiplayer UI', /^[0-9A-Z]{6}$/.test(roomCode), roomCode);

  await B.page.getByLabel('Join code').fill(roomCode);
  await B.page.getByRole('button', { name: 'Join by code' }).click();
  await Promise.all([
    A.page.waitForFunction(() => document.querySelectorAll('#start .aa-seat:not(.aa-empty)').length === 2, null, { timeout: 30_000 }),
    B.page.waitForFunction(() => document.querySelectorAll('#start .aa-seat:not(.aa-empty)').length === 2, null, { timeout: 30_000 }),
  ]);
  step('guest joins over WebRTC and both rosters show two seats', (await roster(A)).length === 2 && (await roster(B)).length === 2);

  // Each Ready click is a trusted menu gesture. The start overlay's pointerdown
  // hook is the product unlock path, so this does not call a service directly.
  await A.page.getByLabel('Ready').check();
  await B.page.getByLabel('Ready').check();
  await A.page.waitForFunction(() => !document.querySelector('#start .aa-lobby-room button.aa-primary')?.disabled, null, { timeout: 10_000 });
  await Promise.all([
    A.page.waitForFunction(() => window.__NT.audio()?.buffers === 21, null, { timeout: 20_000 }),
    B.page.waitForFunction(() => window.__NT.audio()?.buffers === 21, null, { timeout: 20_000 }),
  ]);
  const decodedA = await audio(A);
  const decodedB = await audio(B);
  step('trusted gestures unlock both peers and decode the 21-entry bank',
    decodedA.unlocked && decodedB.unlocked && decodedA.buffers === 21 && decodedB.buffers === 21,
    JSON.stringify({ A: decodedA, B: decodedB }));
  step('real recorded shot and foley counts are present',
    decodedA.recordedShots === 5 && decodedA.recordedFoley === 8
      && decodedB.recordedShots === 5 && decodedB.recordedFoley === 8,
    JSON.stringify({ A: { shots: decodedA.recordedShots, foley: decodedA.recordedFoley }, B: { shots: decodedB.recordedShots, foley: decodedB.recordedFoley } }));

  await A.page.getByRole('button', { name: 'Start match' }).click();
  await Promise.all([
    A.page.waitForFunction(() => window.__NTGAME.mode() === 'host' && document.getElementById('start').style.display === 'none', null, { timeout: 20_000 }),
    B.page.waitForFunction(() => window.__NTGAME.mode() === 'guest' && document.getElementById('start').style.display === 'none', null, { timeout: 20_000 }),
    A.page.waitForFunction(() => window.__NTGAME.snapshot().match.phase === 'active', null, { timeout: 20_000 }),
    B.page.waitForFunction(() => {
      try { return window.__NTGAME.snapshot().match.phase === 'active'; }
      catch (error) {
        if (String(error).includes('[session] guest has no match line yet')) return false;
        throw error;
      }
    }, null, { timeout: 20_000 }),
  ]);
  await sleep(500);
  step('both peers are active clients',
    (await snapshot(A)).mode === 'host' && (await snapshot(B)).mode === 'guest'
      && (await snapshot(A)).phase === 'active' && (await snapshot(B)).phase === 'active',
    JSON.stringify({ A: await snapshot(A), B: await snapshot(B) }));

  const guestPos = await B.page.evaluate(() => window.__NT.probePos());
  const spot = await A.page.evaluate(([bx, bz]) => {
    const tries = [[0, 5], [5, 0], [0, -5], [-5, 0], [3.5, 3.5], [-3.5, 3.5], [3.5, -3.5], [-3.5, -3.5]];
    for (const [dx, dz] of tries) {
      const x = bx + dx;
      const z = bz + dz;
      if (window.__NT.collidersAt(x, z, 1.0).length === 0) return { x, z };
    }
    return null;
  }, [guestPos[0], guestPos[2]]);
  step('an open firing spot exists beside the guest', spot !== null, JSON.stringify(spot));
  if (spot === null) throw new Error('no open firing spot for miss proof');

  await A.page.evaluate(([x, z, bx, bz]) => {
    // Face away from B: the claim is valid and admitted, but deliberately misses.
    const toward = Math.atan2(-(bx - x), -(bz - z));
    window.__NT.teleport(x, 0, z, toward + Math.PI, 0);
  }, [spot.x, spot.z, guestPos[0], guestPos[2]]);
  await sleep(600);
  const beforeA = await audio(A);
  const beforeB = await audio(B);
  const beforeHost = await snapshot(A);
  const beforeGuest = await snapshot(B);
  const fired = await A.page.evaluate(() => window.__NT.weaponCmd('fire'));
  const hostAdmission = await waitFor(async () => {
    const value = await snapshot(A);
    const stats = value.stats;
    return stats && (stats.shotsAdmitted > (beforeHost.stats?.shotsAdmitted ?? 0)
      || stats.shotsRejected > (beforeHost.stats?.shotsRejected ?? 0)) ? value : null;
  }, 3_000, 100);
  const hostShotLog = await A.page.evaluate(() => window.__NTGAME.log().slice(-8));
  step('host trigger pull reaches authoritative admission',
    hostAdmission?.stats?.shotsAdmitted === (beforeHost.stats?.shotsAdmitted ?? 0) + 1,
    JSON.stringify({ fired, before: beforeHost.stats, after: hostAdmission?.stats ?? null, hostShotLog, beforeA, beforeB }));

  const afterB = await waitFor(async () => {
    const value = await audio(B);
    return value.remoteAdmitted === beforeB.remoteAdmitted + 1 ? value : null;
  }, 8_000, 100);
  const afterA = await audio(A);
  const afterGuest = await snapshot(B);
  step('one accepted remote miss increments remote playback exactly once',
    afterB !== null && afterB.remoteAdmitted === beforeB.remoteAdmitted + 1,
    JSON.stringify({ before: beforeB.remoteAdmitted, after: afterB?.remoteAdmitted ?? null, fired, host: hostAdmission?.stats ?? null }));
  step('own predicted shot is not replayed as a remote echo',
    afterA.remoteAdmitted === beforeA.remoteAdmitted,
    JSON.stringify({ before: beforeA.remoteAdmitted, after: afterA.remoteAdmitted }));
  step('remote diagnostics report a spatial presentation and bounded voices',
    afterB !== null && afterB.lastRemoteDistance > 2
      && Number.isFinite(afterB.lastRemotePan)
      && typeof afterB.lastRemoteOccluded === 'boolean'
      && afterB.voices <= 16 && afterA.voices <= 16,
    JSON.stringify({ A: afterA, B: afterB }));
  step('miss does not damage the guest',
    beforeGuest.self?.hp === afterGuest.self?.hp,
    JSON.stringify({ before: beforeGuest.self?.hp ?? null, after: afterGuest.self?.hp ?? null }));

  report.errors = { A: errorsA.slice(0, 8), B: errorsB.slice(0, 8) };
  step('both stock Chrome pages stayed free of console/page errors', errorsA.length === 0 && errorsB.length === 0, report.errors);
} catch (error) {
  report.fatal = String(error);
  code = 1;
} finally {
  try { if (A) await A.close(); } catch (error) { report.cleanupA = String(error); code = 1; }
  try { if (B) await B.close(); } catch (error) { report.cleanupB = String(error); code = 1; }
  report.exitCode = code;
  report.finishedAt = new Date().toISOString();
  mkdirSync(dirname(RESULT_PATH), { recursive: true });
  writeFileSync(RESULT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(report));
}
process.exit(code);
