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
  type ResumeState,
  type RosterEntry,
  type ShotMsg,
  type StreakIntentMsg,
} from './protocol';
// The guest's inbound-host liveness uses the SAME constant the host uses to
// sweep quiet seats, so neither side of the wire outlives the other's patience.
import { LIVENESS_MS } from './room-admit';
import {
  cleanName, createPose, integrateInput, roomClosed, roomOpened,
  type PlayerStance, type Pose, type TimerId,
} from './room-core';
import { SnapshotRing, TICK_DT, reconcileSelf } from './snapshot';
import type { PeerId, Transport } from './transport';
import type { Loadout } from '../game/loadout';
import { WEAPON_STATE_PROTOCOL } from './protocol-weapons';
import type { StreakLoadout } from '../game/killstreaks/catalog';

export type GuestState = 'joining' | 'lobby' | 'starting' | 'playing' | 'rejected' | 'closed';

export interface GuestOptions {
  now?: () => number;
  onChange?: () => void;
  joinTimeoutMs?: number;
  /** The current menu primary, read when hello/ready is sent. */
  localPrimaryId?: string | (() => string | undefined);
  localLoadout?: () => Loadout;
  localStreakLoadout?: () => StreakLoadout;
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
  'weapon-state',
  'shot-reject', 'shot-fired', 'damage', 'kill', 'spawn', 'streak-state', 'match-state', 'ordnance', 'crossbow',
  'radar-state', 'streak-effects', 'effect',
]);
/** Directional receive allow-list. Guest-authored wire shapes are never host heartbeats. */
const HOST_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'welcome', 'reject', 'roster', 'start', 'state', 'ping', 'pong', 'bye', ...GAME_TAGS,
]);
/** Game tags can arrive during the short frame between welcome and driver bind. */
const PENDING_GAME_CAP = 128;

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
  private streakSeq = 0;
  private pilotSeq = 0;
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
  /** Authoritative live-match resume block from welcome; null on a cold join. */
  private resumeEpoch: ResumeState | null = null;
  private readonly localPrimaryId: string | (() => string | undefined) | undefined;
  private readonly localLoadout: (() => Loadout) | undefined;
  private readonly localStreakLoadout: (() => StreakLoadout) | undefined;
  private disposed = false;
  /** Guest-local time of the last VALID host message while admitted; -1 until welcome. */
  private lastHostMsgAt = -1;
  /** The inbound-silence watchdog has fired; it closes exactly once. */
  private hostSilenceFired = false;
  /** Guards the transport unsubscribe so teardown paths can share one call. */
  private detached = false;
  /** Newest host state tick admitted; stale/duplicate states do not refresh liveness. */
  private lastHostStateTick = -1;
  private clockOffset = 0;
  private clockSamples = 0;
  private players: readonly PlayerSample[] = [];
  private gameHandler: ((msg: GameNetMessage) => void) | null = null;
  /** Bounded handoff queue for game tags received before createGuestDriver binds. */
  private readonly pendingGame: Array<GameNetMessage | undefined> = new Array(PENDING_GAME_CAP);
  private pendingGameHead = 0;
  private pendingGameCount = 0;
  private stateHandler: ((players: readonly PlayerSample[], hostNow: number) => void) | null = null;
  // Remote poses, interpolated for render. Bounded: one ring per seat.
  private readonly remotes = new Map<string, SnapshotRing>();

  constructor(transport: Transport, hostPeer: PeerId, code: string, name: string, opts?: GuestOptions) {
    this.transport = transport;
    this.hostPeer = hostPeer;
    this.now = opts?.now ?? Date.now;
    this.onChange = opts?.onChange ?? (() => undefined);
    this.resume = opts?.resume ?? null;
    this.localPrimaryId = opts?.localPrimaryId;
    this.localLoadout = opts?.localLoadout;
    this.localStreakLoadout = opts?.localStreakLoadout;
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
        this.closeTerminal('closed', 'timeout', false);
        return;
      }
      this.retryJoin();
    }, 750);
  }

  /** (Re)send the admission hello. No-op once the join has settled. */
  retryJoin(): void {
    if (this.disposed || this.state !== 'joining') return;
    const primaryId = typeof this.localPrimaryId === 'function' ? this.localPrimaryId() : this.localPrimaryId;
    this.transport.send(this.hostPeer, {
      type: 'hello', code: this.joinCode, name: this.joinName, nonce: this.joinNonce,
      weaponStateProtocol: WEAPON_STATE_PROTOCOL,
      ...(primaryId === undefined ? {} : { primaryId }),
      loadout: this.localLoadout?.(), streakLoadout: this.localStreakLoadout?.(),
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
  /** Authoritative live-match state carried by a resumed welcome, or null on a cold join. */
  resumeState(): ResumeState | null { return this.resumeEpoch; }
  /** `hostNow - localNow`, NTP-estimated from pongs. 0 until the first sample. */
  hostClockOffset(): number { return this.clockOffset; }
  /** The players array of the newest state message; not copied. */
  latestPlayers(): readonly PlayerSample[] { return this.players; }

  /** One listener for game-tag messages; a second call replaces the first. */
  onGame(handler: ((msg: GameNetMessage) => void) | null): void {
    this.gameHandler = handler;
    if (handler === null) {
      this.clearPendingGame();
      return;
    }
    while (this.pendingGameCount > 0) {
      const index = this.pendingGameHead;
      const msg = this.pendingGame[index];
      this.pendingGame[index] = undefined;
      this.pendingGameHead = (index + 1) % PENDING_GAME_CAP;
      this.pendingGameCount--;
      if (msg !== undefined) handler(msg);
    }
    this.pendingGameHead = 0;
  }
  /** One listener for state broadcasts, after the rings have been fed. */
  onState(handler: ((players: readonly PlayerSample[], hostNow: number) => void) | null): void {
    this.stateHandler = handler;
  }

  setReady(ready: boolean): void {
    if (this.state !== 'lobby') return;
    const primaryId = typeof this.localPrimaryId === 'function' ? this.localPrimaryId() : this.localPrimaryId;
    this.transport.send(this.hostPeer, {
      type: 'ready', ready, ...(primaryId === undefined ? {} : { primaryId }),
      loadout: this.localLoadout?.(), streakLoadout: this.localStreakLoadout?.(),
    });
  }

  /** Send one input sample AND predict it locally (the proof path). */
  sendInput(
    mx: number, mz: number, yaw: number, pitch: number, fire: boolean, jump: boolean,
    stance: PlayerStance = 'stand', primaryId?: string,
  ): void {
    if (this.state !== 'playing' && this.state !== 'starting') return;
    const seq = this.seq++;
    const sprint = fire && mz > 0.1;
    integrateInput(this.self, mx, mz, yaw, sprint, TICK_DT, stance);
    const o = this.predHead * 4;
    this.predHist[o] = seq;
    this.predHist[o + 1] = this.self.x;
    this.predHist[o + 2] = this.self.y;
    this.predHist[o + 3] = this.self.z;
    this.predHead = (this.predHead + 1) % 128;
    if (this.predCount < 128) this.predCount += 1;
    this.transport.send(this.hostPeer, { type: 'input', seq, mx, mz, yaw, pitch, fire, jump, stance, primaryId });
  }

  /** Send one input sample with NO local prediction. Returns its seq, or -1. */
  sendMove(
    mx: number, mz: number, yaw: number, pitch: number, sprint: boolean, fire: boolean,
    stance: PlayerStance = 'stand', primaryId?: string,
  ): number {
    if (this.state !== 'playing' && this.state !== 'starting') return -1;
    const seq = this.seq++;
    this.transport.send(this.hostPeer, {
      type: 'input', seq, mx, mz, yaw, pitch, fire, jump: false, sprint, stance, primaryId,
    });
    return seq;
  }

  /**
   * `sendMove` with the interval the sample covers and the body's height, so
   * the host integrates exactly what the controller walked. Returns the seq.
   */
  sendMoveAt(
    mx: number, mz: number, yaw: number, pitch: number, sprint: boolean, dt: number, y: number,
    stance: PlayerStance = 'stand', primaryId?: string,
  ): number {
    if (this.state !== 'playing' && this.state !== 'starting') return -1;
    const seq = this.seq++;
    this.transport.send(this.hostPeer, {
      type: 'input', seq, mx, mz, yaw, pitch, fire: false, jump: false, sprint, dt, y, stance,
      primaryId,
    });
    return seq;
  }

  /** A shot claim or a streak press, to the host. */
  sendGame(msg: ShotMsg | import('./protocol-weapons').WeaponIntentMsg | Omit<StreakIntentMsg, 'seq'>): void {
    if (this.state !== 'playing' && this.state !== 'starting') return;
    this.transport.send(this.hostPeer, msg.type === 'streak-intent' ? { ...msg, seq: this.streakSeq++ } : msg);
  }

  sendPilot(controls: import('../game/killstreaks/pilot-types').PilotControls): void {
    if (this.state !== 'playing') return;
    this.transport.send(this.hostPeer, { type: 'pilot-input', ...controls, seq: this.pilotSeq++ });
  }

  /**
   * Manual liveness ping (auto interval calls this every 2 s). This is also
   * the inbound-host watchdog's only heartbeat: if no VALID host word has
   * arrived for LIVENESS_MS (guest-local now) while admitted, the guest
   * closes once with `host-left` — a host whose uplink died never gets to
   * send the bye this guest would otherwise wait for forever.
   */
  ping(nowMs: number): void {
    if (this.disposed || this.state === 'closed' || this.state === 'rejected') return;
    const admitted = this.state === 'lobby' || this.state === 'starting' || this.state === 'playing';
    if (admitted && this.lastHostMsgAt >= 0 && nowMs - this.lastHostMsgAt > LIVENESS_MS) {
      this.onHostSilence();
      return;
    }
    this.transport.send(this.hostPeer, { type: 'ping', t: nowMs });
  }

  startAutoPing(): void {
    if (this.pingTimer !== null || this.disposed || this.hostSilenceFired) return;
    this.pingTimer = setInterval(() => this.ping(this.now()), 2000);
  }

  remotePose(id: string, renderHostNow: number, out: Pose): boolean {
    const ring = this.remotes.get(id);
    if (!ring) return false;
    return ring.sampleAt(renderHostNow, out);
  }

  dispose(): void {
    this.closeTerminal('closed', this.rejectReason, true);
  }

  // -- internals ------------------------------------------------------------

  private clearJoinTimer(): void {
    if (this.joinTimer !== null) {
      clearInterval(this.joinTimer);
      this.joinTimer = null;
    }
  }

  /**
   * One-way host loss without a bye. Same teardown shape as dispose(): the
   * transport listener and every owned timer are released HERE, no new
   * polling timer is created, and the transition fires exactly once. A later
   * dispose() is a no-op because the terminal path already released the
   * listener, room count, callback, and any optional bye.
   */
  private onHostSilence(): void {
    if (this.hostSilenceFired || this.disposed) return;
    this.hostSilenceFired = true;
    this.closeTerminal('closed', 'host-left', false);
  }

  /** The sole terminal path: one room close, one callback, and no timer/listener left. */
  private closeTerminal(
    nextState: 'rejected' | 'closed',
    reason: RejectReason | 'timeout' | 'host-left' | null,
    sendBye: boolean,
  ): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.clearJoinTimer();
    if (this.pingTimer !== null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.clearPendingGame();
    if (sendBye) {
      try {
        this.transport.send(this.hostPeer, { type: 'bye' });
      } catch {
        /* host already gone. */
      }
    }
    this.state = nextState;
    this.rejectReason = reason;
    roomClosed();
    this.onChange();
  }

  private detach(): void {
    if (this.detached) return;
    this.detached = true;
    this.unsubscribe();
  }

  private handle(from: PeerId, raw: unknown): void {
    if (from !== this.hostPeer || !isNetMessage(raw)) return;
    // A closed, rejected or disposed guest ignores ALL late traffic: a queued
    // welcome must never resurrect a seat the host already ended.
    if (this.disposed || this.state === 'closed' || this.state === 'rejected') return;
    const msg = raw;
    const nowMs = this.now();
    // isNetMessage is structural and admits both wire directions. Keep the
    // heartbeat boundary directional: host-peer inputs/claims are invalid here.
    if (!HOST_MESSAGE_TYPES.has(msg.type)) return;
    if (GAME_TAGS.has(msg.type)) {
      if (this.state === 'joining') return;
      this.lastHostMsgAt = nowMs;
      const game = msg as GameNetMessage;
      if (this.gameHandler !== null) this.gameHandler(game);
      else if (this.pendingGameCount < PENDING_GAME_CAP) {
        const index = (this.pendingGameHead + this.pendingGameCount) % PENDING_GAME_CAP;
        this.pendingGame[index] = game;
        this.pendingGameCount++;
      }
      return;
    }
    switch (msg.type) {
      case 'welcome':
        if (msg.weaponStateProtocol !== WEAPON_STATE_PROTOCOL) {
          if (this.state === 'joining') this.closeTerminal('rejected', 'incompatible-build', false);
          break;
        }
        if (this.state !== 'joining') {
          const sameSeat = msg.playerId === this.playerId &&
            (msg.token === undefined || (this.token !== null && msg.token === this.token));
          if (!sameSeat) return;
          this.lastHostMsgAt = nowMs;
          this.rosterCache = msg.roster;
          this.onChange();
          break;
        }
        this.clearJoinTimer();
        this.lastHostMsgAt = nowMs;
        this.playerId = msg.playerId;
        this.token = msg.token ?? null;
        this.lastHostStateTick = -1;
        // Seed immediately so events arriving before the first scheduled pong
        // use the right epoch; the first NTP sample replaces this estimate.
        this.clockOffset = msg.hostNow - nowMs;
        this.rosterCache = msg.roster;
        // A live-match resume carries the host's phase and high-water marks so
        // the new driver does not restart input or shot numbering from zero.
        if (msg.resume !== undefined) {
          this.startTick = msg.resume.startTick;
          this.seq = msg.resume.lastSeq + 1;
          this.streakSeq = (msg.resume.lastStreakSeq ?? -1) + 1;
          this.pilotSeq = (msg.resume.lastPilotSeq ?? -1) + 1;
          this.resumeEpoch = msg.resume;
          this.state = msg.resume.phase;
        } else {
          this.state = 'lobby';
        }
        this.onChange();
        break;
      case 'reject':
        if (this.state === 'joining') this.closeTerminal('rejected', msg.reason, false);
        break;
      case 'roster':
        if (this.state === 'joining') break;
        // Guests render ONLY this: the host's word replaces, never patches.
        this.rosterCache = msg.roster;
        this.lastHostMsgAt = nowMs;
        this.onChange();
        break;
      case 'start':
        if (this.state !== 'lobby' && this.state !== 'starting') break;
        if (this.startTick >= 0 && msg.startTick <= this.startTick) break;
        this.startTick = msg.startTick;
        if (this.clockSamples === 0) this.clockOffset = msg.hostNow - nowMs;
        this.state = 'starting';
        this.lastHostMsgAt = nowMs;
        this.onChange();
        break;
      case 'state':
        if (this.state !== 'joining' && this.applyState(msg.tick, msg.hostNow, msg.players, nowMs)) {
          this.lastHostMsgAt = nowMs;
        }
        break;
      case 'ping':
        if (this.state === 'joining') break;
        this.lastHostMsgAt = nowMs;
        this.transport.send(this.hostPeer, { type: 'pong', t: msg.t, now: nowMs });
        break;
      case 'pong': {
        if (this.state === 'joining') break;
        this.lastHostMsgAt = nowMs;
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
        this.closeTerminal('closed', 'host-left', false);
        break;
      default:
        break;
    }
  }

  private clearPendingGame(): void {
    for (let i = 0; i < PENDING_GAME_CAP; i++) this.pendingGame[i] = undefined;
    this.pendingGameHead = 0;
    this.pendingGameCount = 0;
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

  private applyState(tick: number, hostNow: number, players: PlayerSample[], nowMs: number): boolean {
    if (!Number.isSafeInteger(tick) || tick <= this.lastHostStateTick) return false;
    this.lastHostStateTick = tick;
    // An admitted lobby guest can use a fresh state as a liveness word while
    // waiting for the separate resume/start protocol to place it in a phase.
    if (this.state === 'lobby') return true;
    if (this.state === 'starting' && this.startTick >= 0 && tick >= this.startTick) {
      this.state = 'playing';
    }
    if (this.state !== 'playing' && this.state !== 'starting') return false;
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
      ring.push({ tick, hostNow, x: p.x, y: p.y, z: p.z, yaw: p.yaw, ack: p.ack, stance: p.stance });
    }
    this.stateHandler?.(players, hostNow);
    this.onChange();
    return true;
  }
}
