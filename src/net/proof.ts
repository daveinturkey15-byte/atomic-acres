/**
 * Nuketown 2025 — headless loopback proof.
 *
 * Drives a HostRoom plus one GuestClient through the loopback transport on a
 * VIRTUAL clock (no wall waiting, fully deterministic for a given seed) and
 * reports the numbers the brief asks for: ticks exchanged, snapshot age
 * distribution, reconciliation corrections, and JS heap at start and end.
 *
 * Runs in Node (`node src/net/run-proof.ts`) AND in the browser (exposed on
 * window.__NT by wire.ts) because it touches no DOM. Virtual time means the
 * "two minutes" below is 2400 simulated ticks at 20 Hz, not 120 s of wall
 * clock — the report says so explicitly.
 */
import { readHeapBytes } from './diagnostics';
import { GuestClient, HostRoom, createPose, liveRoomCount, type Pose } from './room';
import { INTERP_DELAY_MS, TICK_DT } from './snapshot';
import { NORMAL_LINK, createLoopbackPair, hashSeed, mulberry32 } from './transport';

export interface ProofOptions {
  seed?: string;
  /** Simulated ticks at 20 Hz. Default 2400 = two simulated minutes. */
  ticks?: number;
}

export interface ProofReport {
  seed: string;
  virtualMs: number;
  ticksExchanged: number;
  messagesSent: number;
  messagesDelivered: number;
  messagesDroppedLoss: number;
  ageMin: number;
  ageP50: number;
  ageP95: number;
  ageMax: number;
  ageN: number;
  snaps: number;
  misses: number;
  correctionsPerSec: number;
  hostTickHz: number;
  guestTickHz: number;
  hostRttMs: number | null;
  guestRttMs: number | null;
  inputsAccepted: number;
  inputsRejectedStarting: number;
  inputsRejectedCheat: number;
  finalDivergenceM: number;
  /** Prediction error at the last ack: true accuracy minus latency lead. */
  ackErrorM: number;
  heapStart: number | null;
  heapEnd: number | null;
  liveBefore: number;
  liveAfter: number;
  guestInterpolationOk: boolean;
}

function dist(a: Pose, b: Pose): number {
  return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.z - b.z) * (a.z - b.z));
}

export function runLoopbackProof(opts?: ProofOptions): ProofReport {
  const seed = opts?.seed ?? 'nuketown-netcode-1';
  const totalTicks = opts?.ticks ?? 2400;
  const heapStart = readHeapBytes();
  const liveBefore = liveRoomCount();

  let now = 0;
  const nowFn = (): number => now;
  const pair = createLoopbackPair({ seed, impairment: { ...NORMAL_LINK }, auto: false });
  const codeRand = mulberry32(hashSeed(seed + ':code'));
  const host = new HostRoom(pair.a, { hostName: 'host', now: nowFn, codeRand });
  const guest = new GuestClient(pair.b, 'peer-a', host.code, 'scout', {
    now: nowFn,
    joinTimeoutMs: 3600_000,
  });

  const pumpTo = (t: number): void => {
    while (now < t) {
      now += 5;
      pair.link.pump(now);
    }
    pair.link.pump(t);
  };
  const step = (ms: number): void => {
    now += ms;
    pair.link.pump(now);
  };

  // -- handshake (lossy: drive the guest's hello retry on virtual time) -----
  let joined = false;
  for (let r = 0; r < 6 && !joined; r++) {
    pumpTo(now + 1500);
    if (guest.getState() === 'lobby') joined = true;
    else guest.retryJoin();
  }
  if (!joined) {
    throw new Error('[net-proof] guest never reached lobby (state=' + guest.getState() + ')');
  }
  guest.setReady(true);
  host.setReady(true);
  step(150);
  if (!host.canStart()) throw new Error('[net-proof] host cannot start with all seats ready');
  const refusal = host.start();
  if (refusal !== null) throw new Error('[net-proof] host.start() refused a ready room: ' + refusal);
  pumpTo(now + 300);
  // The start tick is 20 host ticks out: advance the host until both sides
  // observe playing. The guest sends nothing until then, like a real client
  // waiting on the countdown.
  for (let i = 0; i < 40 && (host.getPhase() !== 'playing' || guest.getState() !== 'playing'); i++) {
    host.tickOnce(now);
    step(TICK_DT * 1000);
  }
  if (host.getPhase() !== 'playing') throw new Error('[net-proof] host never reached playing');
  if (guest.getState() !== 'playing') throw new Error('[net-proof] guest never reached playing');

  const rejectedAtStart = host.diag.snapshot(now).inputsRejected;

  // -- hostile inputs: must be rejected, must not move the seat -------------
  pair.b.send('peer-a', { type: 'input', seq: 5_000_000, mx: 99, mz: -99, yaw: 0, pitch: 0, fire: true, jump: false });
  pair.b.send('peer-a', { type: 'garbage' } as unknown as { type: 'bye' });
  step(150);

  const rejectedAfterCheat = host.diag.snapshot(now).inputsRejected;

  // -- main loop: scripted circle-walk, alternating walk/sprint --------------
  const interpProbe = createPose();
  let interpOk = false;
  for (let i = 0; i < totalTicks; i++) {
    const yaw = i * 0.02;
    const sprintBlock = Math.floor(i / 400) % 2 === 1;
    if (guest.getState() === 'playing' || guest.getState() === 'starting') {
      guest.sendInput(0, 1, yaw, 0, sprintBlock, false);
    }
    if (i % 20 === 0) guest.ping(now);
    host.tickOnce(now);
    step(TICK_DT * 1000);
    // Interpolation probe: can we render the HOST's own (remote-to-guest)
    // seat from the guest's buffer at the standard render offset?
    const gid = guest.getPlayerId();
    void gid;
    if (i === totalTicks - 1) {
      interpOk = guest.remotePose('host', now - INTERP_DELAY_MS, interpProbe);
    }
  }

  const endStats = pair.link.stats();
  const hostSnap = host.diag.snapshot(now);
  const guestSnap = guest.diag.snapshot(now);
  const ages = guest.diag.ageWindowSorted();
  const sorted = [...ages].sort((a, b) => a - b);
  const q = (f: number): number => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] : NaN);

  const guestId = guest.getPlayerId() ?? 'p1';
  const hostPose = host.poseOf(guestId) ?? createPose();
  const finalLeadM = dist(guest.selfPose(), hostPose);
  const ackErrorM = guest.lastAckError();

  guest.dispose();
  host.dispose();
  pair.a.close();
  pair.b.close();
  const liveAfter = liveRoomCount();
  // Heap AFTER teardown: retained growth is the leak signal, not the garbage
  // one run's packets leave for the collector.
  const heapEnd = readHeapBytes();

  return {
    seed,
    virtualMs: totalTicks * TICK_DT * 1000,
    ticksExchanged: host.getTick(),
    messagesSent: endStats.sent,
    messagesDelivered: endStats.delivered,
    messagesDroppedLoss: endStats.droppedLoss,
    ageMin: sorted.length ? sorted[0] : NaN,
    ageP50: q(0.5),
    ageP95: q(0.95),
    ageMax: sorted.length ? sorted[sorted.length - 1] : NaN,
    ageN: sorted.length,
    snaps: guestSnap.snaps,
    misses: guestSnap.misses,
    correctionsPerSec: guestSnap.correctionsPerSec,
    hostTickHz: hostSnap.tickHz,
    guestTickHz: guestSnap.tickHz,
    hostRttMs: hostSnap.rttMs,
    guestRttMs: guestSnap.rttMs,
    inputsAccepted: hostSnap.inputsAccepted,
    inputsRejectedStarting: rejectedAtStart,
    inputsRejectedCheat: rejectedAfterCheat - rejectedAtStart,
    finalDivergenceM: Math.round(finalLeadM * 1000) / 1000,
    ackErrorM: Math.round(ackErrorM * 1000) / 1000,
    heapStart,
    heapEnd,
    liveBefore,
    liveAfter,
    guestInterpolationOk: interpOk,
  };
}

/** Human-readable rendering of a proof report. Render path: may allocate. */
export function formatProofReport(r: ProofReport): string {
  const heap = (v: number | null): string =>
    v === null ? 'n/a' : (v / 1048576).toFixed(1) + ' MiB';
  const heapDelta =
    r.heapStart !== null && r.heapEnd !== null
      ? ((r.heapEnd - r.heapStart) / 1024).toFixed(0) + ' KiB'
      : 'n/a';
  return [
    `[net-proof] seed=${r.seed} virtual=${(r.virtualMs / 1000).toFixed(0)}s (${r.ticksExchanged} ticks @20Hz)`,
    `[net-proof] wire: sent=${r.messagesSent} delivered=${r.messagesDelivered} dropped-loss=${r.messagesDroppedLoss}`,
    `[net-proof] reconciliation: snaps=${r.snaps} (full ${r.misses}) corr/s=${r.correctionsPerSec} final-lead=${r.finalDivergenceM}m ack-error=${r.ackErrorM}m`,
    `[net-proof] snapshot age (steady-state window, n=${r.ageN}): min=${r.ageMin.toFixed(0)}ms p50=${r.ageP50.toFixed(0)}ms p95=${r.ageP95.toFixed(0)}ms max=${r.ageMax.toFixed(0)}ms`,
    `[net-proof] tick: host=${r.hostTickHz.toFixed(1)}Hz guest=${r.guestTickHz.toFixed(1)}Hz rtt host/guest=${r.hostRttMs ?? '--'}/${r.guestRttMs ?? '--'}ms`,
    `[net-proof] authority: inputs accepted=${r.inputsAccepted} rejected(starting-phase)=${r.inputsRejectedStarting} rejected(cheat)=${r.inputsRejectedCheat}`,
    `[net-proof] interp probe (host seat @-100ms): ${r.guestInterpolationOk ? 'OK' : 'FAIL'}`,
    `[net-proof] heap: start=${heap(r.heapStart)} end=${heap(r.heapEnd)} delta=${heapDelta}`,
    `[net-proof] rooms: live before=${r.liveBefore} after=${r.liveAfter} (must be 0/0)`,
  ].join('\n');
}
