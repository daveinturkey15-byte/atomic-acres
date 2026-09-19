/**
 * Nuketown 2025 — the guest side of a room.
 *
 * Split out of `room.ts` (the 400-line cap); `room.ts` re-exports this class
 * so every existing importer is unchanged. Guests send intent-only inputs and
 * render only host-published rosters. There is no setter, flag or back-door
 * through which a guest can write match state.
 *
 * Two ways a guest moves, both kept:
 *  - `sendInput` PREDICTS with the wire kinematics into `self` and reconciles
 *    against acks. The loopback proof and the in-page proof console use it.
 *  - `sendMove` sends the same message with NO prediction: the real controller
 *    already moved the body (with collision), the intent is derived from its
 *    velocity (`intentFromVelocity`), and `net/match-guest.ts` compares the
 *    host's acked position against the body's own recorded one. Prediction
 *    here would be a second, collision-free body.
 *
 * Clock offset: pongs carry the host's `now`, so the guest learns
 * `hostNow - localNow` NTP-style and can stamp a shot's `firedAt` in the
 * host's domain and render remotes at the right host time across machines,
 * where `Date.now()` on two boxes is not one clock.
 */
import { NetDiagnostics } from './diagnostics';
import {
  isNetMessage,
  type GameNetMessage,
  type NetMessage,
  type PlayerSample,
  type RejectReason,
  type ResumeClaim,
  type RosterEntry,
  type ShotMsg,
  type StreakIntentMsg,
} from './protocol';
import { cleanName, createPose, integrateInput, roomClosed, roomOpened, type Pose, type TimerId } from './room-core';
import { SnapshotRing, TICK_DT, reconcileSelf } from './snapshot';
import type { PeerId, Transport } from './transport';

export type GuestState = 'joining' | 'lobby' | 'starting' | 'playing' | 'rejected' | 'closed';

export interface GuestOptions {
  now?: () => number;
  onChange?: () => void;
  joinTimeoutMs?: number;
  /** A seat this guest held before: resumed by the host inside the rejoin grace. */
  resume?: ResumeClaim | null;
}

/** The host's last word on the guest's own seat. Mutated in place, never reallocated. */
export interface SelfAck {
  seq: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
}

/** Game-tag message tags a guest forwards to its match driver. */
const GAME_TAGS: ReadonlySet<string> = new Set([
  'shot-reject', 'damage', 'kill', 'spawn', 'streak-state', 'match-state', 'ordnance',
]);

export class GuestClient {
  readonly diag = new NetDiagnostics();
  private readonly transport: Transport;
  private readonly hostPeer: PeerId;
  private readonly now: () => number;
  private readonly onChange: () => void;
  private readonly unsubscribe: () => void;
  private state: GuestState = 'joining';
  private rejectReason: RejectReason | 'timeout' | 'host-left' | null = null;
  private playerId: string | null = null;
  private token: string | null = null;
  private rosterCache: RosterEntry[] = [];
  private startTick = -1;
  private seq = 0;
  private lastAck = -1;
  /** Divergence of the last accepted ack: the true prediction error. */
  private ackError = 0;
  private readonly self: Pose = createPose();
  private readonly ack: SelfAck = { seq: -1, x: 0, y: 0, z: 0, yaw: 0 };
  /**
   * Prediction history: pose AFTER integrating each sent input, as
   * [seq, x, y, z] quads in a preallocated ring. 128 deep ≈ 6.4 s.
   */
  private readonly predHist = new Float64Array(128 * 4);
  private predHead = 0;
  private predCount = 0;
  private readonly predScratch: Pose = createPose();
  private pingTimer: TimerId = null;
  private joinTimer: TimerId = null;
  private joinCode = '';
  private joinName = '';
  private joinNonce = '';
  private joinAttempts = 0;
  private joinTimeoutMs = 5000;
  private readonly resume: ResumeClaim | null;
  private disposed = false;
  private clockOffset = 0;
  private clockSamples = 0;
  private players: readonly PlayerSample[] = [];
  private gameHandler: ((msg: GameNetMessage) => void) | null = null;
  private stateHandler: ((players: readonly PlayerSample[], hostNow: number) => void) | null = null;
  // Remote poses, interpolated for render. Bounded: one ring per seat.
  private readonly remotes = new Map<string, SnapshotRing>();

  constructor(transport: Transport, hostPeer: PeerId, code: string, name: string, opts?: GuestOptions) {
    this.transport = transport;
    this.hostPeer = hostPeer;
    this.now = opts?.now ?? Date.now;
    this.onChange = opts?.onChange ?? (() => undefined);
    this.resume = opts?.resume ?? null;
    roomOpened();
    this.diag.reset('guest');
    this.unsubscribe = transport.onMessage((from, msg) => this.handle(from, msg));
    // Join retry: hello/welcome cross lossy links, so one shot is not enough
    // (the in-page proof caught exactly this: a 1% draw ate the only hello).
    const timeoutMs = opts?.joinTimeoutMs ?? 5000;
    this.joinCode = code;
    this.joinName = cleanName(name);
    this.joinNonce = Math.floor(this.now() % 1e9).toString(36);
    this.joinAttempts = 1;
    this.joinTimeoutMs = timeoutMs;
    this.retryJoin();
    this.joinTimer = setInterval(() => {
      if (this.state !== 'joining') {
        this.clearJoinTimer();
        return;
      }
      this.joinAttempts += 1;
      if (this.joinAttempts * 750 >= this.joinTimeoutMs) {
        this.clearJoinTimer();
        this.state = 'closed';
        this.rejectReason = 'timeout';
        this.onChange();
        return;
      }
      this.retryJoin();
    }, 750);
  }

  /** (Re)send the admission hello. No-op once the join has settled. */
  retryJoin(): void {
    if (this.disposed || this.state !== 'joining') return;
    this.transport.send(this.hostPeer, {
      type: 'hello', code: this.joinCode, name: this.joinName, nonce: this.joinNonce,
      ...(this.resume === null ? {} : { resume: this.resume }),
    });
  }

  getState(): GuestState { return this.state; }
  getRejectReason(): RejectReason | 'timeout' | 'host-left' | null { return this.rejectReason; }
  getPlayerId(): string | null { return this.playerId; }
  /** The resume credential the host handed this seat, or null before welcome. */
  identity(): ResumeClaim | null {
    return this.playerId !== null && this.token !== null ? { playerId: this.playerId, token: this.token } : null;
  }
  roster(): RosterEntry[] { return this.rosterCache.map((r) => ({ ...r })); }
  selfPose(): Pose { return { ...this.self }; }
  /** True prediction error at the last accepted ack, metres. */
  lastAckError(): number { return this.ackError; }
  /** The host's newest sample of THIS seat. Same object every call. */
  selfAck(): Readonly<SelfAck> { return this.ack; }
  /** `hostNow - localNow`, NTP-estimated from pongs. 0 until the first sample. */
  hostClockOffset(): number { return this.clockOffset; }
  /** The players array of the newest state message; not copied. */
  latestPlayers(): readonly PlayerSample[] { return this.players; }

  /** One listener for game-tag messages; a second call replaces the first. */
  onGame(handler: ((msg: GameNetMessage) => void) | null): void { this.gameHandler = handler; }
  /** One listener for state broadcasts, after the rings have been fed. */
  onState(handler: ((players: readonly PlayerSample[], hostNow: number) => void) | null): void {
    this.stateHandler = handler;
  }

  setReady(ready: boolean): void {
    if (this.state !== 'lobby') return;
    this.transport.send(this.hostPeer, { type: 'ready', ready });
  }

  /** Send one input sample AND predict it locally (the proof path). */
  sendInput(mx: number, mz: number, yaw: number, pitch: number, fire: boolean, jump: boolean): void {
    if (this.state !== 'playing' && this.state !== 'starting') return;
    const seq = this.seq++;
    const sprint = fire && mz > 0.1;
    integrateInput(this.self, mx, mz, yaw, sprint, TICK_DT);
    const o = this.predHead * 4;
    this.predHist[o] = seq;
    this.predHist[o + 1] = this.self.x;
    this.predHist[o + 2] = this.self.y;
    this.predHist[o + 3] = this.self.z;
    this.predHead = (this.predHead + 1) % 128;
    if (this.predCount < 128) this.predCount += 1;
    this.transport.send(this.hostPeer, { type: 'input', seq, mx, mz, yaw, pitch, fire, jump });
  }

  /** Send one input sample with NO local prediction. Returns its seq, or -1. */
  sendMove(mx: number, mz: number, yaw: number, pitch: number, sprint: boolean, fire: boolean): number {
    if (this.state !== 'playing' && this.state !== 'starting') return -1;
    const seq = this.seq++;
    this.transport.send(this.hostPeer, { type: 'input', seq, mx, mz, yaw, pitch, fire, jump: false, sprint });
    return seq;
  }

  /**
   * `sendMove` with the interval the sample covers and the body's height, so
   * the host integrates exactly what the controller walked. Returns the seq.
   */
  sendMoveAt(mx: number, mz: number, yaw: number, pitch: number, sprint: boolean, dt: number, y: number): number {
    if (this.state !== 'playing' && this.state !== 'starting') return -1;
    const seq = this.seq++;
    this.transport.send(this.hostPeer, { type: 'input', seq, mx, mz, yaw, pitch, fire: false, jump: false, sprint, dt, y });
    return seq;
  }

  /** A shot claim or a streak press, to the host. */
  sendGame(msg: ShotMsg | StreakIntentMsg): void {
    if (this.state !== 'playing' && this.state !== 'starting') return;
    this.transport.send(this.hostPeer, msg);
  }

  /** Manual liveness ping (auto interval calls this every 2 s). */
  ping(nowMs: number): void {
    if (this.disposed || this.state === 'closed' || this.state === 'rejected') return;
    this.transport.send(this.hostPeer, { type: 'ping', t: nowMs });
  }

  startAutoPing(): void {
    if (this.pingTimer !== null || this.disposed) return;
    this.pingTimer = setInterval(() => this.ping(this.now()), 2000);
  }

  remotePose(id: string, renderHostNow: number, out: Pose): boolean {
    const ring = this.remotes.get(id);
    if (!ring) return false;
    return ring.sampleAt(renderHostNow, out);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearJoinTimer();
    this.unsubscribe();
    try {
      this.transport.send(this.hostPeer, { type: 'bye' });
    } catch {
      /* host already gone. */
    }
    this.state = 'closed';
    roomClosed();
    this.onChange();
  }

  // -- internals ------------------------------------------------------------

  private clearJoinTimer(): void {
    if (this.joinTimer !== null) {
      clearInterval(this.joinTimer);
      this.joinTimer = null;
    }
  }

  private handle(from: PeerId, raw: unknown): void {
    if (from !== this.hostPeer || !isNetMessage(raw)) return;
    const msg = raw;
    const nowMs = this.now();
    if (GAME_TAGS.has(msg.type)) {
      this.gameHandler?.(msg as GameNetMessage);
      return;
    }
    switch (msg.type) {
      case 'welcome':
        this.clearJoinTimer();
        this.playerId = msg.playerId;
        this.token = msg.token ?? null;
        this.rosterCache = msg.roster;
        this.state = 'lobby';
        this.onChange();
        break;
      case 'reject':
        this.clearJoinTimer();
        this.state = 'rejected';
        this.rejectReason = msg.reason;
        this.onChange();
        break;
      case 'roster':
        // Guests render ONLY this: the host's word replaces, never patches.
        this.rosterCache = msg.roster;
        this.onChange();
        break;
      case 'start':
        this.startTick = msg.startTick;
        this.state = 'starting';
        this.onChange();
        break;
      case 'state':
        this.applyState(msg.tick, msg.hostNow, msg.players, nowMs);
        break;
      case 'ping':
        this.transport.send(this.hostPeer, { type: 'pong', t: msg.t, now: nowMs });
        break;
      case 'pong': {
        const rtt = Math.max(0, nowMs - msg.t);
        this.diag.recordRtt(rtt);
        if (msg.now !== undefined) {
          // NTP: the host replied halfway through the round trip. EMA after
          // the first sample, so one late pong cannot drag remotes a tick off.
          const sample = msg.now - (msg.t + nowMs) / 2;
          this.clockOffset = this.clockSamples === 0 ? sample : this.clockOffset + 0.2 * (sample - this.clockOffset);
          this.clockSamples += 1;
        }
        break;
      }
      case 'bye':
        this.state = 'closed';
        this.rejectReason = 'host-left';
        this.onChange();
        break;
      default:
        break;
    }
  }

  /** Newest-first with an early break: seqs rise monotonically. */
  private findPrediction(seq: number): boolean {
    for (let k = 0; k < this.predCount; k++) {
      const o = (((this.predHead - 1 - k) % 128) + 128) % 128 * 4;
      const s = this.predHist[o];
      if (s === seq) {
        this.predScratch.x = this.predHist[o + 1];
        this.predScratch.y = this.predHist[o + 2];
        this.predScratch.z = this.predHist[o + 3];
        return true;
      }
      if (s < seq) break;
    }
    return false;
  }

  private applyState(tick: number, hostNow: number, players: PlayerSample[], nowMs: number): void {
    if (this.state === 'starting' && this.startTick >= 0 && tick >= this.startTick) {
      this.state = 'playing';
    }
    if (this.state !== 'playing' && this.state !== 'starting') return;
    this.diag.tick(nowMs);
    // Age in the host's clock domain, so a cross-machine offset does not read as lag.
    this.diag.recordAge(Math.max(0, nowMs + this.clockOffset - hostNow));
    this.players = players;
    for (const p of players) {
      if (p.id === this.playerId) {
        if (Number.isSafeInteger(p.ack) && p.ack >= this.ack.seq) {
          this.ack.seq = p.ack; this.ack.x = p.x; this.ack.y = p.y; this.ack.z = p.z; this.ack.yaw = p.yaw;
        }
        if (this.findPrediction(p.ack)) {
          const r = reconcileSelf(this.predScratch, p, p.ack, this.lastAck);
          if (!r.accepted) continue;
          this.lastAck = p.ack;
          this.ackError = r.divergenceM;
          if (r.correction === 'snap') {
            // Shift the LIVE pose by the error, preserving legitimate lead.
            this.self.x += p.x - this.predScratch.x;
            this.self.y += p.y - this.predScratch.y;
            this.self.z += p.z - this.predScratch.z;
            this.diag.recordCorrection(nowMs, true);
          }
        } else {
          // No history for this ack: stale/foreign acks never apply, and a
          // post-stall ack fails safe by taking authority as-is.
          if (!Number.isSafeInteger(p.ack) || p.ack <= this.lastAck) continue;
          this.lastAck = p.ack;
          this.self.x = p.x;
          this.self.y = p.y;
          this.self.z = p.z;
          this.self.yaw = p.yaw;
          if (this.predCount > 0) this.diag.recordMiss(nowMs);
        }
        continue;
      }
      let ring = this.remotes.get(p.id);
      if (!ring) {
        ring = new SnapshotRing();
        this.remotes.set(p.id, ring);
      }
      ring.push({ tick, hostNow, x: p.x, y: p.y, z: p.z, yaw: p.yaw, ack: p.ack });
    }
    this.stateHandler?.(players, hostNow);
    this.onChange();
  }
}
