#!/usr/bin/env node
/**
 * Guest host-watchdog falsifier. CPU-only, virtual time, no browser/server.
 *
 * This bundles the actual recovery sources into a temporary Node module, then
 * drives the real HostRoom/GuestClient loopback with a manual clock. The
 * messages injected below are wire-valid but intentionally adversarial: a
 * guest-authored input arriving from the host peer, duplicate welcome/start,
 * and a duplicate state tick. The checks are useful only if those messages
 * reach the real GuestClient receive boundary.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const root = fileURLToPath(new URL('../..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'host-watchdog-proof-'));
const entry = join(tmp, 'entry.ts');
const outfile = join(tmp, 'bundle.mjs');
writeFileSync(entry, [
  `export { HostRoom, GuestClient, liveRoomCount, LIVENESS_MS } from ${JSON.stringify(join(root, 'src/net/room.ts'))};`,
  `export { createLoopbackPair, CLEAN_LINK } from ${JSON.stringify(join(root, 'src/net/transport.ts'))};`,
].join('\n'));
await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
const M = await import(pathToFileURL(outfile).href);

const results = [];
const check = (id, label, ok, detail = '') => {
  results.push({ id, label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? `  — ${detail}` : ''}`);
};
const fail = (message) => { throw new Error(message); };

/** Make an admitted room with no real timers and leave it in the lobby. */
async function admitted(prefix, onChange = () => undefined) {
  let now = 0;
  const pair = M.createLoopbackPair({ seed: prefix, impairment: { ...M.CLEAN_LINK }, auto: false });
  const host = new M.HostRoom(pair.a, { hostName: 'host', now: () => now, codeRand: () => 0.5 });
  const guest = new M.GuestClient(pair.b, 'peer-a', host.code, 'scout', {
    now: () => now,
    onChange,
    joinTimeoutMs: 3_600_000,
  });
  const pump = (at = now) => { now = at; pair.link.pump(at); };
  pump(0);
  if (guest.getState() !== 'lobby') fail(`[${prefix}] guest did not reach lobby: ${guest.getState()}`);
  return { now: () => now, setNow: (at) => { now = at; }, pair, host, guest, pump };
}

async function playing(prefix, onChange = () => undefined) {
  const s = await admitted(prefix, onChange);
  s.guest.setReady(true);
  s.pump();
  s.host.setReady(true);
  s.pump();
  if (s.host.start() !== null) fail(`[${prefix}] host start refused`);
  s.pump();
  for (let i = 0; i < 24; i++) {
    s.setNow(s.now() + 50);
    s.host.tickOnce(s.now());
    s.pump();
  }
  if (s.host.getPhase() !== 'playing' || s.guest.getState() !== 'playing') {
    fail(`[${prefix}] did not reach playing: host=${s.host.getPhase()} guest=${s.guest.getState()}`);
  }
  return s;
}

function hostToGuest(s, msg) {
  s.pair.a.send('peer-b', msg);
  s.pump();
}

function cleanup(s) {
  s.guest.dispose();
  s.host.dispose();
  s.pair.a.close();
  s.pair.b.close();
}

const baseline = M.liveRoomCount();

// A structurally valid guest message must not count as host liveness merely
// because it arrived from the expected peer id.
{
  const s = await admitted('direction');
  const invalidInput = { type: 'input', seq: 0, mx: 0, mz: 0, yaw: 0, pitch: 0, fire: false, jump: false };
  s.setNow(4_000);
  hostToGuest(s, invalidInput);
  s.setNow(6_001);
  s.guest.ping(s.now());
  check('W1', 'guest-authored input is not an inbound host heartbeat',
    s.guest.getState() === 'closed' && s.guest.getRejectReason() === 'host-left',
    `state=${s.guest.getState()} reason=${s.guest.getRejectReason()}`);
  cleanup(s);
}

// A fresh state tick is a valid host word in the lobby, even though the
// separate resume/start protocol is intentionally outside this patch.
{
  const s = await admitted('fresh-state');
  const id = s.guest.getPlayerId();
  hostToGuest(s, { type: 'state', tick: 10, hostNow: s.now(), players: [
    { id, x: 0, y: 0, z: 0, yaw: 0, ack: -1 },
  ] });
  s.setNow(5_999);
  s.guest.ping(s.now());
  check('W2', 'fresh lobby state tick refreshes admitted liveness without promoting phase',
    s.guest.getState() === 'lobby', `state=${s.guest.getState()}`);
  s.setNow(6_002);
  s.guest.ping(s.now());
  check('W3', 'fresh lobby state eventually expires on host silence',
    s.guest.getState() === 'closed' && s.guest.getRejectReason() === 'host-left',
    `state=${s.guest.getState()} reason=${s.guest.getRejectReason()}`);
  cleanup(s);
}

// Duplicate welcome and an old start are valid host shapes, but neither is a
// new phase transition. In particular, a late welcome cannot demote a player.
{
  const s = await playing('phase-guards');
  const id = s.guest.getPlayerId();
  const identity = s.guest.identity();
  hostToGuest(s, { type: 'welcome', weaponStateProtocol: 1, playerId: id, token: identity?.token, hostNow: s.now(), roster: s.host.roster() });
  check('W4', 'duplicate welcome preserves the current playing phase', s.guest.getState() === 'playing', `state=${s.guest.getState()}`);
  hostToGuest(s, { type: 'start', startTick: 0, hostNow: s.now() });
  check('W5', 'out-of-order start cannot demote the current playing phase', s.guest.getState() === 'playing', `state=${s.guest.getState()}`);
  cleanup(s);
}

// A state tick is monotonic at the guest boundary. The duplicate tick must
// not re-run state delivery or refresh the watchdog.
{
  let stateCalls = 0;
  const s = await playing('state-ticks', () => undefined);
  s.guest.onState(() => { stateCalls += 1; });
  const id = s.guest.getPlayerId();
  const state = (tick, x) => ({ type: 'state', tick, hostNow: s.now(), players: [
    { id, x, y: 0, z: 0, yaw: 0, ack: -1 },
  ] });
  hostToGuest(s, state(100, 4));
  hostToGuest(s, state(100, 9));
  const position = s.guest.latestPlayers()[0]?.x;
  check('W6', 'duplicate state tick is ignored at the GuestClient boundary',
    stateCalls === 1 && position === 4, `stateCalls=${stateCalls} x=${position}`);
  s.setNow(s.now() + M.LIVENESS_MS + 1);
  s.guest.ping(s.now());
  check('W7', 'duplicate state tick does not keep a silent host alive',
    s.guest.getState() === 'closed' && s.guest.getRejectReason() === 'host-left',
    `state=${s.guest.getState()} reason=${s.guest.getRejectReason()}`);
  cleanup(s);
}

// Host silence is a terminal operation, not merely a state flip: listener,
// timer and room-count bookkeeping are all released, and repeated dispose or
// late queued traffic cannot fire roomClosed/onChange a second time.
{
  let changes = 0;
  const s = await playing('exact-once', () => { changes += 1; });
  const before = M.liveRoomCount();
  const changesBeforeSilence = changes;
  s.setNow(s.now() + M.LIVENESS_MS + 1);
  s.guest.ping(s.now());
  const afterSilence = M.liveRoomCount();
  s.guest.dispose();
  hostToGuest(s, { type: 'welcome', weaponStateProtocol: 1, playerId: s.guest.getPlayerId(), hostNow: s.now(), roster: s.host.roster() });
  check('W8', 'host silence closes exactly once and releases one room',
    afterSilence === before - 1 && changes === changesBeforeSilence + 1 && s.guest.getState() === 'closed',
    `live=${before}->${afterSilence} changes=${changesBeforeSilence}->${changes} state=${s.guest.getState()}`);
  check('W9', 'late welcome and repeated dispose cannot reopen or double-close',
    changes === changesBeforeSilence + 1 && s.guest.getState() === 'closed' && M.liveRoomCount() === before - 1,
    `changes=${changesBeforeSilence}->${changes} state=${s.guest.getState()} live=${M.liveRoomCount()}`);
  cleanup(s);
}

const residual = M.liveRoomCount();
check('W10', 'all watchdog proof rooms return to the original live-room count',
  residual === baseline, `baseline=${baseline} residual=${residual}`);

rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n[verify-host-silence-semantics] ${results.length - failed.length}/${results.length} checks passed; ` +
  `baseline liveRoomCount=${baseline}, residual=${residual}`);
process.exit(failed.length === 0 ? 0 : 1);
