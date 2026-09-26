#!/usr/bin/env node
/**
 * Host-silence watchdog verification — CPU-only, virtual time, no browser.
 *
 * Companion to docs/glm-host-watchdog-independent-review.md (2026-09-19).
 * Proves, on the REAL
 * `GuestClient` bundled from source with the repo's own esbuild, that:
 *
 *   W1  valid host traffic keeps an admitted guest alive past LIVENESS_MS
 *   W2  total host silence closes the guest exactly once, reason 'host-left',
 *       through the existing onChange lifecycle, releasing owned timers and
 *       the transport listener, creating no extra polling timer
 *   W3  foreign-peer and wire-invalid messages cannot refresh liveness
 *   W4  a late welcome/state/game traffic after close or reject cannot
 *       resurrect the seat or reach the game handler
 *   W5  'joining' is untouched by the watchdog and still ends via the
 *       existing join-retry timeout
 *   W6  dispose() stays idempotent, including after a watchdog close (the
 *       listener is unsubscribed exactly once)
 *   W7  the watchdog is driven by guest-local time only: wildly skewed host
 *       clock stamps cannot cause or prevent the close
 *
 * Exit 0 = every expectation holds. Exit 1 = the fix regressed; re-read
 * docs/glm-host-watchdog.md before touching anything.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

// --- fake timers, installed BEFORE anything can create one -----------------
// GuestClient owns two real intervals (join retry, auto ping). Neither may
// run on wall time here: the harness pumps them by hand, so every tick is
// deterministic and "the watchdog released its timer" is directly observable.
const liveTimers = new Map();
let timerCreates = 0;
let timerClears = 0;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;
globalThis.setInterval = (fn, ms) => {
  const handle = ++timerCreates;
  liveTimers.set(handle, { fn, ms });
  return handle;
};
globalThis.clearInterval = (handle) => {
  if (liveTimers.delete(handle)) timerClears += 1;
};

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const root = fileURLToPath(new URL('../..', import.meta.url));

const tmp = mkdtempSync(join(tmpdir(), 'nt-host-silence-'));
const entry = join(tmp, 'entry.ts');
const outfile = join(tmp, 'bundle.mjs');
writeFileSync(entry, [
  `export { GuestClient } from ${JSON.stringify(join(root, 'src/net/room-guest.ts'))};`,
  `export { LIVENESS_MS } from ${JSON.stringify(join(root, 'src/net/room-admit.ts'))};`,
].join('\n'));
await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
const { GuestClient, LIVENESS_MS } = await import(pathToFileURL(outfile).href);

const results = [];
const check = (id, label, ok, detail) => {
  results.push({ id, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${label}${detail ? '  — ' + detail : ''}`);
};

// --- fake transport: the guest talks to one expected host peer -------------
const HOST_PEER = 'host-peer-a';
function fakeTransport() {
  const sent = [];
  let handler = null;
  let unsubCalls = 0;
  const t = {
    localId: 'guest-end',
    closed: false,
    send(_to, msg) { if (!t.closed) sent.push({ at: clock.now, msg }); },
    onMessage(h) { handler = h; return () => { unsubCalls += 1; }; },
    close() { t.closed = true; },
    deliver(from, raw) { if (handler !== null && !t.closed) handler(from, raw); },
    get unsubCalls() { return unsubCalls; },
    sent,
  };
  return t;
}

// The guest's clock is a harness-owned cell; host stamps below are chosen to
// be poison (millions of seconds off) — W7 depends on them being ignorable.
const clock = { now: 1_812_345_678_901 };
const hostStamp = () => clock.now - 4_000_000_000;

const rosterEntry = (id, name, isHost) => ({ id, name, ready: true, isHost, connected: true });

function newGuest(opts = {}) {
  const t = fakeTransport();
  let changes = 0;
  const guest = new GuestClient(t, HOST_PEER, 'NTXQ', 'scout', {
    now: () => clock.now,
    onChange: () => { changes += 1; },
    joinTimeoutMs: 3_600_000,
    ...opts,
  });
  return { t, guest, changes: () => changes, sent: t.sent };
}

const sentCount = (s, type) => s.sent.filter((f) => f.msg.type === type).length;

function deliverWelcome(s, playerId = 'g1') {
  s.t.deliver(HOST_PEER, {
    type: 'welcome', weaponStateProtocol: 1, playerId, hostNow: hostStamp(),
    roster: [rosterEntry(playerId, 'scout', false), rosterEntry(HOST_PEER, 'host', true)],
  });
}

/** welcome -> start -> one state at/after startTick: the seat is 'playing'. */
function driveToPlaying(s) {
  deliverWelcome(s);
  s.t.deliver(HOST_PEER, { type: 'start', startTick: 100, hostNow: hostStamp() });
  s.t.deliver(HOST_PEER, {
    type: 'state', tick: 200, hostNow: hostStamp(),
    players: [{ id: s.guest.getPlayerId(), x: 1, y: 0, z: 2, yaw: 0, ack: 0 }],
  });
}

/** The app's 2 s auto-ping interval, pumped by hand against virtual time. */
function startAutoPing(s) {
  const before = timerCreates;
  s.guest.startAutoPing();
  return before + 1;
}
const pumpTimer = (handle) => { const tm = liveTimers.get(handle); if (tm) tm.fn(); };

/** Advance `ticks` * `tickMs` of guest-local silence, pumping auto-ping. */
function runSilence(s, autoPingHandle, ticks, tickMs = 1000) {
  for (let k = 0; k < ticks; k++) {
    clock.now += tickMs;
    pumpTimer(autoPingHandle);
  }
}

// --- W1: valid host traffic holds the seat alive past LIVENESS_MS ----------
{
  const s = newGuest();
  driveToPlaying(s);
  const h = startAutoPing(s);
  // Far more than LIVENESS_MS of wall time, but the host speaks every tick:
  // one pong (with a poison stamp) and one state per virtual 2 s.
  for (let k = 0; k < 10; k++) {
    clock.now += 2000;
    s.t.deliver(HOST_PEER, { type: 'pong', t: clock.now - 2000, now: hostStamp() + 555_555 });
    pumpTimer(h);
    s.t.deliver(HOST_PEER, { type: 'state', tick: 300 + k, hostNow: hostStamp(), players: [] });
  }
  check('W1', `valid host traffic keeps the guest alive past ${LIVENESS_MS} ms`,
    s.guest.getState() === 'playing' && s.guest.getRejectReason() === null,
    `state=${s.guest.getState()} reason=${s.guest.getRejectReason()}`);
  s.guest.dispose();
}

// --- W2: silence closes exactly once, host-left, timers/listeners released -
{
  const s = newGuest();
  driveToPlaying(s);
  const joinedAt = clock.now; // last valid host word just arrived
  const h = startAutoPing(s);
  const before = s.changes();
  let closedAtElapsed = -1;
  for (let k = 1; k <= 10; k++) {
    clock.now += 1000;
    pumpTimer(h);
    if (closedAtElapsed < 0 && s.guest.getState() === 'closed') closedAtElapsed = clock.now - joinedAt;
  }
  const pingsDuringSilence = sentCount(s, 'ping'); // none were sent before the silence loop
  check('W2a', `silence closes at ${LIVENESS_MS} ms < elapsed <= ${LIVENESS_MS + 1000} ms, once`,
    closedAtElapsed === LIVENESS_MS + 1000,
    `closedAt=${closedAtElapsed} elapsed resolution 1 s`);
  check('W2b', 'close is the existing lifecycle: state closed, reason host-left, onChange fired',
    s.guest.getState() === 'closed' && s.guest.getRejectReason() === 'host-left' && s.changes() - before === 1,
    `state=${s.guest.getState()} reason=${s.guest.getRejectReason()} onChange=+${s.changes() - before}`);
  check('W2c', 'auto-ping timer released on close; no ping frame leaves afterwards',
    !liveTimers.has(h) && pingsDuringSilence === 6,
    `timerAlive=${liveTimers.has(h)} pingFramesInSilence=${pingsDuringSilence}`);
  startAutoPing(s);
  check('W2d', 'no extra polling timer exists after close (startAutoPing refuses)',
    timerCreates === timerClears,
    `created=${timerCreates} cleared=${timerClears}`);
  s.guest.dispose();
}

// --- W3: foreign / wire-invalid messages cannot refresh liveness -----------
{
  const s = newGuest();
  driveToPlaying(s);
  const joinedAt = clock.now;
  const h = startAutoPing(s);
  clock.now += 4000;
  // Foreign peer, valid shape: must be dropped on identity, not refresh.
  s.t.deliver('not-the-host', { type: 'roster', roster: [rosterEntry('x', 'ghost', false)] });
  // Expected peer, invalid bytes: dropped by isNetMessage at the boundary.
  s.t.deliver(HOST_PEER, { type: 'roster', roster: 'garbage' });
  s.t.deliver(HOST_PEER, { type: 'made-up-tag', x: 1 });
  pumpTimer(h);
  const stillOpenAtLimit = s.guest.getState() === 'playing' && clock.now - joinedAt === 4000;
  runSilence(s, h, 3); // -> elapsed 7000: must close HERE if nothing refreshed
  const closedAt7000 = s.guest.getState() === 'closed' && s.guest.getRejectReason() === 'host-left';
  check('W3', 'foreign/invalid traffic neither refreshes nor revives; silence still closes on time',
    stillOpenAtLimit && closedAt7000,
    `open@4s=${stillOpenAtLimit} closed@7s=${closedAt7000}`);
  check('W3b', 'foreign roster never touched the rendered cache',
    JSON.stringify(s.guest.roster()) === JSON.stringify([rosterEntry('g1', 'scout', false), rosterEntry(HOST_PEER, 'host', true)]),
    `roster=${JSON.stringify(s.guest.roster())}`);
  s.guest.dispose();
}

// --- W4: late traffic after close/reject cannot resurrect ------------------
{
  const s = newGuest();
  driveToPlaying(s);
  const h = startAutoPing(s);
  runSilence(s, h, 8); // watchdog closes
  const changesAtClose = s.changes();
  let gameCalls = 0;
  s.guest.onGame(() => { gameCalls += 1; });
  // Everything a stale queue might still hold, all well-formed:
  deliverWelcome(s, 'g2');
  s.t.deliver(HOST_PEER, { type: 'start', startTick: 100, hostNow: hostStamp() });
  s.t.deliver(HOST_PEER, {
    type: 'state', tick: 900, hostNow: hostStamp(),
    players: [{ id: 'g2', x: 5, y: 0, z: 5, yaw: 1, ack: 3 }],
  });
  s.t.deliver(HOST_PEER, {
    type: 'spawn', e: {
      type: 'spawn', at: 1, actorId: 'g2', x: 0, y: 1.6, z: 0, yaw: 0, protectedUntil: 0, reason: 'initial',
    },
  });
  check('W4a', 'late welcome/start/state/spawn after watchdog close are all ignored',
    s.guest.getState() === 'closed' && s.guest.getRejectReason() === 'host-left' &&
    s.guest.getPlayerId() === 'g1' && gameCalls === 0 && s.changes() === changesAtClose,
    `state=${s.guest.getState()} pid=${s.guest.getPlayerId()} gameCalls=${gameCalls} onChange=+${s.changes() - changesAtClose}`);

  const r = newGuest();
  r.t.deliver(HOST_PEER, { type: 'reject', reason: 'bad-code' });
  deliverWelcome(r, 'g9');
  check('W4b', 'late welcome after reject cannot resurrect either',
    r.guest.getState() === 'rejected' && r.guest.getRejectReason() === 'bad-code' && r.guest.getPlayerId() === null,
    `state=${r.guest.getState()} pid=${r.guest.getPlayerId()}`);
  s.guest.dispose();
  r.guest.dispose();
}

// --- W5: joining keeps the existing retry-timeout, immune to the watchdog --
{
  // Fresh timers so handles are addressable per guest.
  const s = newGuest({ joinTimeoutMs: 1500 });
  const joinTimerHandle = timerCreates; // first interval this guest created
  clock.now += 60_000;
  s.guest.ping(clock.now); // an eternity of silence — must NOT close a joiner
  check('W5a', 'watchdog never fires while joining; ping still goes out',
    s.guest.getState() === 'joining' && sentCount(s, 'ping') === 1,
    `state=${s.guest.getState()} pings=${sentCount(s, 'ping')}`);
  pumpTimer(joinTimerHandle); // attempt 2: 2*750 = 1500 >= 1500 → retry timeout fires here
  pumpTimer(joinTimerHandle); // second pump is a no-op: the timer already closed the guest
  check('W5b', 'joining still ends through the existing retry timeout, not host-left',
    s.guest.getState() === 'closed' && s.guest.getRejectReason() === 'timeout',
    `state=${s.guest.getState()} reason=${s.guest.getRejectReason()}`);
  s.guest.dispose();
}

// --- W6: dispose idempotent, including after a watchdog close --------------
{
  const s = newGuest();
  driveToPlaying(s);
  s.guest.dispose();
  s.guest.dispose();
  const plainUnsubs = s.t.unsubCalls;
  const plainByes = sentCount(s, 'bye');
  check('W6a', 'dispose twice: one unsubscribe, one bye, no throw',
    plainUnsubs === 1 && plainByes === 1 && s.guest.getState() === 'closed',
    `unsubs=${plainUnsubs} byes=${plainByes}`);

  const w = newGuest();
  driveToPlaying(w);
  const h = startAutoPing(w);
  runSilence(w, h, 8);
  w.guest.dispose(); // after watchdog close: listener must NOT be unsubscribed twice
  check('W6b', 'dispose after watchdog close: exactly one unsubscribe and no second bye',
    w.t.unsubCalls === 1 && sentCount(w, 'bye') === 0 && w.guest.getState() === 'closed',
    `unsubs=${w.t.unsubCalls} byes=${sentCount(w, 'bye')}`);
  check('W6c', 'no leaked intervals anywhere in the run',
    timerCreates === timerClears, `created=${timerCreates} cleared=${timerClears}`);
}

// --- W7: guest-local clock only; skewed host stamps are irrelevant ---------
{
  // clock.now already sits at a huge epoch; hostNow is 4e9 ms in the past and
  // pong stamps are 555_555 ms in the future — the NTP estimator eats all of
  // it while liveness must stay a pure guest-local measurement.
  const s = newGuest();
  deliverWelcome(s);
  const offsetBefore = s.guest.hostClockOffset();
  s.t.deliver(HOST_PEER, { type: 'start', startTick: 100, hostNow: hostStamp() });
  const h = startAutoPing(s);
  for (let k = 0; k < 4; k++) {
    clock.now += 2000;
    s.t.deliver(HOST_PEER, { type: 'pong', t: clock.now - 2000, now: hostStamp() + 555_555 });
    pumpTimer(h);
    s.t.deliver(HOST_PEER, { type: 'state', tick: 110 + k, hostNow: hostStamp(), players: [] });
  }
  const alive = s.guest.getState() === 'playing';
  const lastWord = clock.now;
  runSilence(s, h, 7); // exactly LIVENESS_MS + 1000 of guest-local silence
  check('W7', `huge host clock skew: traffic holds, guest-local ${LIVENESS_MS} ms silence still closes`,
    alive && offsetBefore < 0 && s.guest.getState() === 'closed' && s.guest.getRejectReason() === 'host-left' &&
    clock.now - lastWord === LIVENESS_MS + 1000,
    `aliveUnderTraffic=${alive} offset=${offsetBefore} state=${s.guest.getState()} elapsed=${clock.now - lastWord}`);
  s.guest.dispose();
}

// --- teardown ---------------------------------------------------------------
globalThis.setInterval = realSetInterval;
globalThis.clearInterval = realClearInterval;
rmSync(tmp, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n[verify-host-silence] ${results.length - failed.length}/${results.length} expectations hold` +
  (failed.length === 0 ? ' — watchdog verified (exit 0).' : ' — REGRESSION (exit 1).'));
process.exit(failed.length === 0 ? 0 : 1);
