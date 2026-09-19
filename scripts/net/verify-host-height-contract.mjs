#!/usr/bin/env node
/**
 * Host height contract — CPU-only falsifier for the stationary-guest defect.
 *
 * Root's frozen 4192 proof (cfb-guest-stationary-2125-1789849234190) showed the
 * guest stationary at (-3.58, 0.15, 18.4) seeing the host at y=0 while the
 * authoritative host feet were 0.15: `driveHostSeat` voided y and `placeSeat`
 * reset y=0. Body/fatal damage passed, but head aim (rendered y+1.65 = 1.65,
 * only 1.50 above feet, HEAD_Y 1.55) could never crit.
 *
 * This bundles the real HostRoom/GuestClient (esbuild, no browser/GPU/server)
 * and drives a real loopback lobby -> playing room. Every check below FAILS on
 * the old `void y` build (authoritative pose 0, replicated sample 0) and
 * PASSES on the trusted-elevation fix.
 *
 *   node scripts/net/verify-host-height-contract.mjs
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const esbuild = require('esbuild');
const root = fileURLToPath(new URL('../..', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'host-height-contract-'));
const entry = join(tmp, 'entry.ts');
const outfile = join(tmp, 'bundle.mjs');
writeFileSync(entry, [
  `export { HostRoom, GuestClient, liveRoomCount, INPUT_Y_MAX } from ${JSON.stringify(join(root, 'src/net/room.ts'))};`,
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
const eq = (a, b, m) => { if (a !== b) fail(`${m} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`); };

async function admitted(prefix) {
  let now = 0;
  const pair = M.createLoopbackPair({ seed: prefix, impairment: { ...M.CLEAN_LINK }, auto: false });
  const host = new M.HostRoom(pair.a, { hostName: 'host', now: () => now, codeRand: () => 0.5 });
  const guest = new M.GuestClient(pair.b, 'peer-a', host.code, 'scout', {
    now: () => now, onChange: () => undefined, joinTimeoutMs: 3_600_000,
  });
  const pump = (at = now) => { now = at; pair.link.pump(at); };
  pump(0);
  if (guest.getState() !== 'lobby') fail(`[${prefix}] guest did not reach lobby: ${guest.getState()}`);
  return { now: () => now, setNow: (at) => { now = at; }, pair, host, guest, pump };
}

async function playing(prefix) {
  const s = await admitted(prefix);
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

function cleanup(s) {
  s.guest.dispose();
  s.host.dispose();
  s.pair.a.close();
  s.pair.b.close();
}

/** Drive the host seat, tick once, pump, return authoritative pose + guest-seen host sample. */
function driveAndRead(s, x, y, z, yaw, stance) {
  s.host.driveHostSeat(x, y, z, yaw, stance);
  const auth = s.host.poseOf('host');
  s.setNow(s.now() + 50);
  s.host.tickOnce(s.now());
  s.pump();
  const seen = s.guest.latestPlayers().find((p) => p.id === 'host');
  return { auth, seen };
}

const baseline = M.liveRoomCount();

// H1: nonzero street floor (the frozen proof geometry) propagates authoritatively and on the wire.
{
  const s = await playing('street');
  const { auth, seen } = driveAndRead(s, -3.58, 0.15, 24.4, Math.PI, 'stand');
  check('H1', 'street slab 0.15 propagates to authoritative pose and guest-seen sample',
    auth !== null && Math.abs(auth.y - 0.15) < 1e-9 && seen !== undefined && Math.abs(seen.y - 0.15) < 1e-9,
    `auth=${auth?.y} seen=${seen?.y}`);
  cleanup(s);
}

// H2: upstairs host floor (FLOOR_H 3.15) propagates; old build replicates 0.
{
  const s = await playing('upstairs');
  const { auth, seen } = driveAndRead(s, -3.58, 3.15, 24.4, Math.PI, 'stand');
  check('H2', 'upstairs 3.15 propagates to authoritative pose and guest-seen sample',
    auth !== null && Math.abs(auth.y - 3.15) < 1e-9 && seen !== undefined && Math.abs(seen.y - 3.15) < 1e-9,
    `auth=${auth?.y} seen=${seen?.y}`);
  cleanup(s);
}

// H3: stance rides with elevation (crouch at street height keeps both).
{
  const s = await playing('stance');
  const { auth, seen } = driveAndRead(s, -3.58, 0.15, 24.4, Math.PI, 'crouch');
  check('H3', 'crouch stance propagates with street elevation intact',
    auth !== null && auth.stance === 'crouch' && Math.abs(auth.y - 0.15) < 1e-9 &&
    seen !== undefined && seen.stance === 'crouch' && Math.abs(seen.y - 0.15) < 1e-9,
    `auth=${auth?.y}/${auth?.stance} seen=${seen?.y}/${seen?.stance}`);
  cleanup(s);
}

// H4: invalid / non-finite y never poisons the seat; x/z/yaw keep fail-closed bounds.
{
  const s = await playing('invalid');
  s.host.driveHostSeat(-3.58, 0.15, 24.4, Math.PI, 'stand');
  const before = s.host.poseOf('host');
  s.host.driveHostSeat(-3.58, NaN, 24.4, Math.PI, 'stand');
  const nan = s.host.poseOf('host');
  s.host.driveHostSeat(-3.58, Infinity, 24.4, Math.PI, 'stand');
  const inf = s.host.poseOf('host');
  s.host.driveHostSeat(-3.58, -Infinity, 24.4, Math.PI, 'stand');
  const ninf = s.host.poseOf('host');
  const retained = nan !== null && inf !== null && ninf !== null &&
    Math.abs(nan.y - 0.15) < 1e-9 && Number.isFinite(nan.y) &&
    Math.abs(inf.y - 0.15) < 1e-9 && Math.abs(ninf.y - 0.15) < 1e-9;
  check('H4a', 'NaN/Infinity/-Infinity y retains previous feet, never NaN',
    retained, `before=${before?.y} nan=${nan?.y} inf=${inf?.y} ninf=${ninf?.y}`);
  // Non-finite x rejects the whole update (pose unchanged, y retained).
  s.host.driveHostSeat(NaN, 3.15, 24.4, Math.PI, 'stand');
  const rejected = s.host.poseOf('host');
  check('H4b', 'non-finite x rejects the whole drive (pose unchanged)',
    rejected !== null && Math.abs((rejected.x) - (before.x)) < 1e-9 && Math.abs(rejected.y - 0.15) < 1e-9,
    `x=${rejected?.x} y=${rejected?.y}`);
  // Host clamps into the guest band, never publishes out-of-band height.
  s.host.driveHostSeat(-3.58, 10, 24.4, Math.PI, 'stand');
  const high = s.host.poseOf('host');
  s.host.driveHostSeat(-3.58, -2, 24.4, Math.PI, 'stand');
  const low = s.host.poseOf('host');
  check('H4c', 'host y clamps to the 0..INPUT_Y_MAX standable band',
    high !== null && Math.abs(high.y - M.INPUT_Y_MAX) < 1e-9 && low !== null && low.y === 0,
    `high=${high?.y} (max=${M.INPUT_Y_MAX}) low=${low?.y}`);
  cleanup(s);
}

// H5: repeated ticks converge (no drift, no decay back to 0).
{
  const s = await playing('converge');
  let ok = true;
  let lastSeen = -1;
  for (let i = 0; i < 20; i++) {
    const { auth, seen } = driveAndRead(s, -3.58, 0.15, 24.4, Math.PI, 'stand');
    if (auth === null || Math.abs(auth.y - 0.15) > 1e-9) ok = false;
    if (seen === undefined || Math.abs(seen.y - 0.15) > 1e-9) ok = false;
    lastSeen = seen?.y ?? -1;
  }
  check('H5', '20 repeated street drives converge (authoritative + replicated stay 0.15)',
    ok, `lastSeen=${lastSeen}`);
  cleanup(s);
}

// H6: placeSeat keeps deploy/reset semantics (y=0) — distinct from trusted driveHostSeat.
{
  const s = await playing('reset-semantics');
  s.host.driveHostSeat(-3.58, 3.15, 24.4, Math.PI, 'stand');
  const driven = s.host.poseOf('host');
  s.host.placeSeat('host', -3.58, 24.4, Math.PI, 'stand');
  const reset = s.host.poseOf('host');
  check('H6', 'placeSeat still resets y=0 while driveHostSeat preserves elevation',
    driven !== null && Math.abs(driven.y - 3.15) < 1e-9 && reset !== null && reset.y === 0,
    `driven=${driven?.y} reset=${reset?.y}`);
  // x/z bounds survive on the trusted path too (no relaxed constraints).
  s.host.driveHostSeat(999, 0.15, 999, Math.PI, 'stand');
  const clamped = s.host.poseOf('host');
  check('H7', 'trusted drive keeps x/z arena clamps',
    clamped !== null && Number.isFinite(clamped.x) && Number.isFinite(clamped.z) &&
    clamped.x <= 25.0 && clamped.z <= 42 && Math.abs(clamped.y - 0.15) < 1e-9,
    `x=${clamped?.x} z=${clamped?.z} y=${clamped?.y}`);
  cleanup(s);
}

// H8: guest vertical bounds untouched (wire y still clamps 0..INPUT_Y_MAX).
{
  const s = await playing('guest-bounds');
  const gid = s.guest.getPlayerId();
  eq(typeof gid, 'string', 'guest id present');
  s.guest.sendMoveAt(0, 0, 0, 0, false, 0.05, 10, 'stand');
  s.pump();
  s.setNow(s.now() + 50);
  s.host.tickOnce(s.now());
  s.pump();
  const high = s.host.poseOf(gid);
  s.guest.sendMoveAt(0, 0, 0, 0, false, 0.05, -3, 'stand');
  s.pump();
  s.setNow(s.now() + 50);
  s.host.tickOnce(s.now());
  s.pump();
  const low = s.host.poseOf(gid);
  check('H8', 'guest wire y still clamps to 0..INPUT_Y_MAX (bounds not relaxed)',
    high !== null && Math.abs(high.y - M.INPUT_Y_MAX) < 1e-9 && low !== null && low.y === 0,
    `high=${high?.y} low=${low?.y} max=${M.INPUT_Y_MAX}`);
  cleanup(s);
}

const residual = M.liveRoomCount();
check('H9', 'all contract rooms dispose (live-room count returns to baseline)',
  residual === baseline, `baseline=${baseline} residual=${residual}`);

rmSync(tmp, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n[verify-host-height-contract] ${results.length - failed.length}/${results.length} checks passed; ` +
  `baseline liveRoomCount=${baseline}, residual=${residual}`);
process.exit(failed.length === 0 ? 0 : 1);
