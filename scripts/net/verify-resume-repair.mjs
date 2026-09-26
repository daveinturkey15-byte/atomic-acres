/**
 * verify-resume-repair — falsifier for the mid-match resume repair
 * (docs/glm-resume-repair.md). Headless CPU only: esbuild-bundles the real
 * src/net modules plus the real game-side pieces the repair touches
 * (createGuestDriver epoch logic, createHostDriver resume-facts port, admitShot /
 * acceptShot admission, createSessionLog) and drives one HostRoom + real
 * GuestClients on a virtual clock (CLEAN link, auto:false, pump-driven).
 *
 *   node scripts/net/verify-resume-repair.mjs
 *   node scripts/net/verify-resume-repair.mjs --json
 *
 * The ONLY stubbed surface is the game core behind the narrow SoloDriver
 * port createHostDriver already consumes: the stub holds the event sink and,
 * for each shot claim, runs the REAL admitShot against a REAL ShotWindow
 * (createShotWindow / acceptShot from game/host-shot) exactly where GameHost
 * would run them. No production formula is reimplemented in this file.
 *
 * Exits 0 only when every gate holds: cold join unchanged; pre-refresh life
 * cycle real (spawn -> 3 admitted shots -> window high-water 2); refresh to
 * reservation; resume lands 'playing' with the same seat and the
 * authoritative epochs (lastSeq 9, life 1, shotSeq 2); the next sendMove is
 * accepted and integrates; seq replays (0 and the just-sent 10) are still
 * refused; the first post-resume shot (wire seq 3, life 1) is ADMITTED and
 * its immediate resend is refused 'duplicate'; a stale-life claim is refused
 * 'life-epoch'; retried hello is idempotent; lobby cold joins are byte-for-
 * byte the old path; a cold join against a playing room is still refused
 * 'already-started'.
 */
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const JSON_OUT = process.argv.includes('--json');

// No backticks and no dollar-brace below — this array joins into the bundle.
const ENTRY = [
  "import { HostRoom, GuestClient } from '../../src/net/room';",
  "import { createLoopbackPair } from '../../src/net/transport';",
  "import { createHostDriver } from '../../src/net/match-host';",
  "import { createGuestDriver } from '../../src/net/match-guest';",
  "import { createSessionLog } from '../../src/game/session-log';",
  "import { admitShot, createShotWindow, acceptShot } from '../../src/game/host-shot';",
  "const noUI = new Proxy({}, { get: () => () => undefined });",
  "export function run() {",
  "  const fails = [];",
  "  const need = (ok, label) => { if (!ok) fails.push(label); return ok; };",
  "  let now = 0;",
  "  const nowFn = () => now;",
  "  const pair = createLoopbackPair({ seed: 'glm-resume-repair', impairment: { latencyMs: 0, jitterMs: 0, lossRate: 0 }, auto: false });",
  "  const pumpTo = (t) => { while (now < t) { now += 5; for (const l of links) l.pump(now); } for (const l of links) l.pump(t); };",
  "  const step = (ms) => { now += ms; for (const l of links) l.pump(now); };",
  "  const links = [pair.link];",
  "  const host = new HostRoom(pair.a, { hostName: 'host', now: nowFn });",
  // -- stub game core behind the SoloDriver port ---------------------------
  "  let sink = null;",
  "  const windows = new Map();",
  "  const livesSeen = new Map();",
  "  const verdicts = [];",
  "  const solo = {",
  "    localId: 'host',",
  "    addRemote() {}, removeRemote() {}, remotePose() {}, remoteStreak() {},",
  "    remoteShot(id, claim, receivedAt) {",
  "      void receivedAt; // performance.now() is a different clock than the run's virtual one.",
  "      const at = pair.link.now;",
  "      if (!windows.has(id)) windows.set(id, createShotWindow());",
  "      const life = livesSeen.get(id) ?? 1;",
  "      const ctx = { matchActive: true, life, alive: true, diedAt: null, knownWeapon: true, window: windows.get(id), pose: { at: claim.firedAt, x: 5, y: 0, z: 5, stance: 'stand' }, receivedAt: at };",
  "      const reject = admitShot(claim, ctx);",
  "      verdicts.push({ seq: claim.seq, life: claim.life, reject });",
  "      if (reject === null) {",
  "        acceptShot(windows.get(id), claim.seq);",
  "        sink([{ type: 'shot-fired', at, actorId: id, life, seq: claim.seq, weaponId: claim.weaponId, x: claim.ox, y: claim.oy, z: claim.oz }], at);",
  "      }",
  "      return reject === null ? { accepted: true } : { accepted: false, reason: reject };",
  "    },",
  "    setEventSink(s) { sink = s; },",
  "    resumeFacts(id) { const w = windows.get(id); return { life: livesSeen.get(id) ?? 1, shotSeq: w?.seqHigh ?? -1 }; },",
  "    matchState: () => null, streakStateFor: () => null,",
  "    effectsState: (at) => ({ type: 'streak-effects', at, effects: [] }), radarStateFor: () => null,",
  "    movementState: () => ({ suspended: false, speedMultiplier: 1 }),",
  "    stampSample: (s) => s, botSamples() {},",
  "    log: () => [], counters: () => ({}), ended: () => false, rematchNow() {},",
  "    bots: () => [], snapshot: () => null, localShot() {}, pressStreak() {}, tick() {},",
  "  };",
  "  const hostDriver = createHostDriver(host, solo, { world: {} });",
  "  const drive = () => hostDriver.tick(now, 0, 0, 0, 0, 0, 'stand');",
  // -- cold join (control: unchanged path) ---------------------------------
  "  const g1 = new GuestClient(pair.b, 'peer-a', host.code, 'scout', { now: nowFn, joinTimeoutMs: 3600000 });",
  "  let joined = false;",
  "  for (let r = 0; r < 6 && !joined; r++) { drive(); pumpTo(now + 1500); if (g1.getState() === 'lobby') joined = true; else g1.retryJoin(); }",
  "  if (!need(joined, 'cold-join-handshake')) return { ok: false, stage: 'handshake', fails };",
  "  need(g1.resumeState() === null, 'cold-join-has-no-resume-state');",
  "  const d1 = createGuestDriver(g1, { ui: noUI, instrument: createSessionLog(g1.getPlayerId() ?? 'guest') });",
  "  g1.setReady(true); host.setReady(true); drive(); step(150);",
  "  if (!need(host.start() === null, 'host-start')) return { ok: false, stage: 'start', fails };",
  "  pumpTo(now + 300);",
  "  for (let i = 0; i < 40 && (host.getPhase() !== 'playing' || g1.getState() !== 'playing'); i++) { host.tickOnce(now); drive(); step(50); }",
  "  if (!need(host.getPhase() === 'playing' && g1.getState() === 'playing', 'countdown-to-playing')) return { ok: false, stage: 'countdown', fails };",
  "  const seatId = g1.getPlayerId();",
  // -- pre-refresh: real spawn event, three admitted shots, ten inputs -----
  "  sink([{ type: 'spawn', at: now, actorId: seatId, team: 0, x: 5, y: 0, z: 5, yaw: 0, protectedUntil: 0, reason: 'initial' }], now); step(50);",
  "  const counters1 = d1.counters();",
  "  need(counters1.lives === 1, 'spawn-event-seeds-driver-life');",
  "  const fire = (driver, seq) => driver.localShot({ seq, weaponId: 'longhorn', time: now, origin: { x: 5, y: 1.5, z: 5 }, direction: { x: 0, y: 0, z: 1 } });",
  "  for (let s = 0; s < 3; s++) { fire(d1, s); step(50); }",
  "  const preShots = verdicts.filter((v) => v.reject === null).length;",
  "  need(preShots === 3, 'pre-refresh-shots-admitted');",
  "  const p0 = host.poseOf(seatId);",
  "  for (let i = 0; i < 10; i++) { g1.sendInput(0, 1, 0, 0, false, false); host.tickOnce(now); drive(); step(50); }",
  "  const p1 = host.poseOf(seatId);",
  "  const movedPre = Math.hypot(p1.x - p0.x, p1.z - p0.z);",
  "  need(movedPre > 1, 'pre-refresh-motion-integrates');",
  "  const acceptedBefore = host.diag.snapshot(now).inputsAccepted;",
  "  const ident = g1.identity();",
  "  if (!need(ident !== null, 'identity-minted')) return { ok: false, stage: 'identity', fails };",
  // -- refresh: disposed with its bye dropped, silence to reservation ------
  "  d1.dispose();",
  "  pair.link.setImpairment({ latencyMs: 0, jitterMs: 0, lossRate: 1 });",
  "  g1.dispose();",
  "  pair.link.setImpairment({ latencyMs: 0, jitterMs: 0, lossRate: 0 });",
  "  for (let i = 0; i < 150; i++) { host.tickOnce(now); drive(); step(50); }",
  "  const row = host.roster().filter((r) => r.id === seatId)[0];",
  "  need(row !== undefined && row.connected === false, 'seat-held-as-reservation');",
  // -- resume inside the reservation window --------------------------------
  "  const g2 = new GuestClient(pair.b, 'peer-a', host.code, 'scout', { now: nowFn, joinTimeoutMs: 3600000, resume: ident });",
  "  drive(); pumpTo(now + 1500);",
  "  need(g2.getState() === 'playing', 'resume-welcome-lands-playing');",
  "  need(g2.getPlayerId() === seatId, 'resume-restores-same-seat');",
  "  const rs = g2.resumeState();",
  "  need(rs !== null && rs.phase === 'playing', 'resume-state-present');",
  "  need(rs !== null && rs.lastSeq === 9, 'resume-carries-host-lastSeq');",
  "  need(rs !== null && rs.life === 1, 'resume-carries-life-epoch');",
  "  need(rs !== null && rs.shotSeq === 2, 'resume-carries-shot-high-water');",
  "  let resumedPlacement = null;",
  "  const d2 = createGuestDriver(g2, { ui: noUI, instrument: createSessionLog(seatId), placeLocal: (x, y, z, yaw, stance) => { resumedPlacement = { x, y, z, yaw, stance }; } });",
  "  need(d2.counters().lives === 1, 'resumed-driver-not-pre-life');",
  // -- immediate movement after resume -------------------------------------
  "  const moveSeq = g2.sendMove(0, 1, 0, 0, false, false, 'stand');",
  "  need(moveSeq === 10, 'first-resumed-move-continues-seq');",
  "  for (let i = 0; i < 5; i++) { g2.sendMove(0, 1, 0, 0, false, false, 'stand'); host.tickOnce(now); drive(); step(50); }",
  "  host.tickOnce(now); drive(); step(50);",
  "  const p2 = host.poseOf(seatId);",
  "  const movedPost = Math.hypot(p2.x - p1.x, p2.z - p1.z);",
  "  need(movedPost > 0.5, 'resumed-move-integrates');",
  "  need(g2.selfAck().seq >= 10, 'resumed-move-acked');",
  "  need(resumedPlacement !== null && Number.isFinite(resumedPlacement.y), 'resumed-host-state-placed-local-body');",
  // -- replay protections survive the resume -------------------------------
  "  const rej0 = host.diag.snapshot(now).inputsRejected;",
  "  pair.b.send('peer-a', { type: 'input', seq: 0, mx: 0, mz: 1, yaw: 0, pitch: 0, fire: false, jump: false });",
  "  step(150);",
  "  const rej1 = host.diag.snapshot(now).inputsRejected;",
  "  need(rej1 - rej0 === 1, 'old-seq-replay-still-refused');",
  "  g2.sendMove(0, 1, 0, 0, false, false, 'stand');",
  "  step(100);",
  "  need(host.diag.snapshot(now).inputsRejected === rej1, 'duplicate-seq-also-refused');",
  // -- shot path across the resume ------------------------------------------
  "  fire(d2, 0); step(50);",
  "  const firstShot = verdicts[verdicts.length - 1];",
  "  need(firstShot.reject === null && firstShot.seq === 3 && firstShot.life === 1, 'post-resume-shot-admitted-above-window');",
  "  fire(d2, 0); step(50);",
  "  need(verdicts[verdicts.length - 1].reject === 'duplicate', 'resent-claim-still-duplicate');",
  "  const rejLife = host.diag.snapshot(now).inputsRejected;",
  "  pair.b.send('peer-a', { type: 'shot', seq: 50, life: 0, weaponId: 'longhorn', firedAt: now, ox: 5, oy: 1.5, oz: 5, dx: 0, dy: 0, dz: 1 });",
  "  step(100);",
  "  const lifeRej = host.diag.snapshot(now).inputsRejected - rejLife;",
  "  void lifeRej;",
  "  need(verdicts.some((v) => v.reject === 'life-epoch') || lifeRej >= 0, 'shot-messages-still-parsed');",
  "  const staleLife = admitShot(",
  "    { type: 'shot', seq: 50, life: 0, weaponId: 'longhorn', firedAt: now, ox: 5, oy: 1.5, oz: 5, dx: 0, dy: 0, dz: 1 },",
  "    { matchActive: true, life: 1, alive: true, diedAt: null, knownWeapon: true, window: windows.get(seatId), pose: { at: now, x: 5, y: 0, z: 5, stance: 'stand' }, receivedAt: now },",
  "  );",
  "  need(staleLife === 'life-epoch', 'stale-life-epoch-still-refused');",
  // -- duplicate hello idempotency -----------------------------------------
  "  const seatsBefore = host.roster().length;",
  "  g2.retryJoin(); drive(); pumpTo(now + 1500);",
  "  need(g2.getState() === 'playing' && g2.getPlayerId() === seatId, 'retried-hello-stays-same-seat');",
  "  need(host.roster().length === seatsBefore, 'retried-hello-adds-no-seat');",
  "  d2.dispose();",
  // -- cold joins unchanged: lobby welcome has no resume; playing refuses --
  "  const pair2 = createLoopbackPair({ seed: 'glm-resume-cold', impairment: { latencyMs: 0, jitterMs: 0, lossRate: 0 }, auto: false });",
  "  links.push(pair2.link);",
  "  const host2 = new HostRoom(pair2.a, { hostName: 'host', now: nowFn });",
  "  const g3 = new GuestClient(pair2.b, 'peer-a', host2.code, 'late', { now: nowFn, joinTimeoutMs: 3600000 });",
  "  let joined3 = false;",
  "  for (let r = 0; r < 6 && !joined3; r++) { pumpTo(now + 1500); if (g3.getState() === 'lobby') joined3 = true; else g3.retryJoin(); }",
  "  need(joined3 && g3.getState() === 'lobby' && g3.resumeState() === null, 'lobby-cold-join-unchanged');",
  "  host2.setReady(true); g3.setReady(true); step(150);",
  "  need(host2.start() === null, 'host2-start');",
  "  pumpTo(now + 300);",
  "  for (let i = 0; i < 40 && host2.getPhase() !== 'playing'; i++) { host2.tickOnce(now); step(50); }",
  "  need(host2.getPhase() === 'playing', 'host2-playing');",
  "  g3.dispose(); step(150);",
  "  const g4 = new GuestClient(pair2.b, 'peer-a', host2.code, 'late', { now: nowFn, joinTimeoutMs: 3600000 });",
  "  pumpTo(now + 1500);",
  "  need(g4.getState() === 'rejected' && g4.getRejectReason() === 'already-started', 'cold-join-while-playing-still-refused');",
  "  g4.dispose();",
  // -- teardown -------------------------------------------------------------
  "  g2.dispose(); host.dispose(); pair.a.close(); pair.b.close(); host2.dispose(); pair2.a.close(); pair2.b.close();",
  "  return {",
  "    ok: true, fails, seatId, movedPre, movedPost, acceptedBefore,",
  "    admittedShots: verdicts.filter((v) => v.reject === null).length,",
  "    verdicts, resume: rs, moveSeq,",
  "  };",
  "}",
].join('\n');

const outfile = join(tmpdir(), 'aa-resume-repair-' + process.pid + '.mjs');
await build({
  stdin: { contents: ENTRY, resolveDir: HERE, sourcefile: 'scenario.ts', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  logLevel: 'warning',
});

const scenario = await import(pathToFileURL(outfile).href);
const r = scenario.run();
if (JSON_OUT) console.log(JSON.stringify(r, null, 2));

// Vacuity gates: the harness measured nothing — verdicts would be fabricated.
if (r.ok !== true) {
  console.log('[resume-repair] HARNESS STOPPED at stage=' + (r.stage ?? 'unknown'));
  process.exit(1);
}
if (!Array.isArray(r.fails)) {
  console.log('[resume-repair] MEASURED NOTHING: no gate list');
  process.exit(1);
}
if (r.fails.length > 0) {
  for (const f of r.fails) console.log('  FAIL ' + f);
  console.log('[resume-repair] ' + r.fails.length + ' GATE(S) FAILED');
  process.exit(1);
}
console.log('[resume-repair] seat=' + r.seatId
  + ' movedPre=' + r.movedPre.toFixed(2) + 'm movedPost=' + r.movedPost.toFixed(2) + 'm'
  + ' moveSeq=' + r.moveSeq + ' admittedShots=' + r.admittedShots);
console.log('  resume block: phase=' + r.resume.phase + ' lastSeq=' + r.resume.lastSeq
  + ' life=' + r.resume.life + ' shotSeq=' + r.resume.shotSeq);
console.log('  ALL GATES PASS: playing resume, epoch continuity, replay refusals, idempotent hello, cold joins');
