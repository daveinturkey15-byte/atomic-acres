/**
 * Nuketown 2025 — rooms: host authority and lobby.
 *
 * One peer is host and owns everything contested. The boundary is structural:
 * the host's publish path (poses, roster, start) lives in HostRoom and is
 * never callable from GuestClient; guests send intent-only inputs and render
 * only host-published rosters. There is no setter, flag or back-door through
 * which a guest can write match state — a compromised guest can only lie
 * about its own wish vector, and the host clamps even that.
 *
 * Movement speeds mirror src/core/player.ts (WALK 4.8, SPRINT 6.6) which this
 * lane may not edit; if they drift, prediction error grows and the
 * reconciliation counters show it instead of silently disagreeing. The
 * long-term home for both is one shared tuning module.
 *
 * Lifetime: every timer this file creates is owned by exactly one room object
 * and cleared in dispose(). Proof asserts liveCount() returns to zero.
 */
import { BOUND_X_MAX, BOUND_X_MIN, BOUND_Z, SPAWN_A, SPAWN_B } from '../core/layout';
import { NetDiagnostics } from './diagnostics';
import {
  MAX_PLAYERS,
  createJoinCode,
  isJoinCode,
  isNetMessage,
  type ByeMsg,
  type HostKey,
  type InputMsg,
  type LobbyPhase,
  type NetMessage,
  type PlayerSample,
  type RosterEntry,
} from './protocol';
import { SnapshotRing, TICK_DT, reconcileSelf } from './snapshot';
import type { PeerId, Transport } from './transport';

/** Owned interval/timeout handle. DOM lib types these as numbers. */
type TimerId = number | null;

// ---------------------------------------------------------------------------
// Shared kinematics: host and guest MUST integrate identically. mx is strafe
// (+right), mz is forward. Frame agrees with Player: forward is
// (-sin yaw, 0, -cos yaw), right is (cos yaw, 0, -sin yaw).
// ---------------------------------------------------------------------------

const WALK_SPEED = 4.8;
const SPRINT_SPEED = 6.6;

export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export function createPose(x = 0, y = 0, z = 0, yaw = 0): Pose {
  return { x, y, z, yaw };
}

/** Integrate one input sample. Pure: mutates `pose`, allocates nothing. */
export function integrateInput(pose: Pose, mx: number, mz: number, yaw: number, sprint: boolean, dt: number): void {
  const cx = Math.max(-1, Math.min(1, mx));
  const cz = Math.max(-1, Math.min(1, mz));
  if (!Number.isFinite(yaw) || !Number.isFinite(dt) || dt <= 0) return;
  const speed = sprint ? SPRINT_SPEED : WALK_SPEED;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  pose.x += (rx * cx + fx * cz) * speed * dt;
  pose.z += (rz * cx + fz * cz) * speed * dt;
  pose.yaw = yaw;
  // The host owns position: clamp into the arena instead of trusting anyone.
  if (pose.x < BOUND_X_MIN) pose.x = BOUND_X_MIN;
  else if (pose.x > BOUND_X_MAX) pose.x = BOUND_X_MAX;
  if (pose.z < -BOUND_Z) pose.z = -BOUND_Z;
  else if (pose.z > BOUND_Z) pose.z = BOUND_Z;
  pose.y = 0;
}

// HostKey capability: module-private. Nothing outside this file can name it,
// so nothing outside this file can publish host state. GuestClient shares the
// module but has no reference to the key and no path to mint one.
const HOST_KEY = {} as HostKey;
void HOST_KEY;

let liveRooms = 0;
/** Rooms currently undisposed. Proof asserts this returns to zero. */
export function liveRoomCount(): number {
  return liveRooms;
}

function cleanName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 16) : '';
  return s || 'guest';
}

interface HostMember {
  entry: RosterEntry;
  peerId: PeerId | null; // null = the host's own seat
  pose: Pose;
  lastInput: { mx: number; mz: number; yaw: number; sprint: boolean };
  lastSeq: number;
  pingAt: number;
}
export interface HostOptions {
  hostName?: string;
  /** Preset join code (lets the channel name embed it). Generated when absent/invalid. */
  code?: string;
  codeRand?: () => number;
  now?: () => number;
  onChange?: () => void;
}

export class HostRoom {
  readonly code: string;
  readonly hostId = 'host';
  readonly diag = new NetDiagnostics();
  private readonly transport: Transport;
  private readonly now: () => number;
  private readonly onChange: () => void;
  private readonly members = new Map<string, HostMember>();
  private readonly peerToId = new Map<PeerId, string>();
  private phase: LobbyPhase = 'lobby';
  private tick = 0;
  private startTick = -1;
  private nextId = 1;
  private timer: TimerId = null;
  private readonly unsubscribe: () => void;
  private disposed = false;
  private pingCursor = 0;

  constructor(transport: Transport, opts?: HostOptions) {
    this.transport = transport;
    this.now = opts?.now ?? Date.now;
    this.onChange = opts?.onChange ?? (() => undefined);
    this.code = isJoinCode(opts?.code) ? opts.code : createJoinCode(opts?.codeRand);
    liveRooms += 1;
    this.diag.reset('host');
    const name = cleanName(opts?.hostName ?? 'host');
    this.members.set(this.hostId, {
      entry: { id: this.hostId, name, ready: false, isHost: true, connected: true },
      peerId: null,
      pose: createPose(SPAWN_A.x, 0, SPAWN_A.z, SPAWN_A.yaw),
      lastInput: { mx: 0, mz: 0, yaw: SPAWN_A.yaw, sprint: false },
      lastSeq: -1,
      pingAt: 0,
    });
    this.unsubscribe = transport.onMessage((from, msg) => this.handle(from, msg));
  }

  getPhase(): LobbyPhase {
    return this.phase;
  }

  getTick(): number {
    return this.tick;
  }
  /** Authoritative pose of a seat. Diagnostic/proof path; guests never see it. */
  poseOf(id: string): Pose | null {
    const m = this.members.get(id);
    return m ? { ...m.pose } : null;
  }
  /**
   * Drive the host's own seat from the local player. Host-only and safe: the
   * host already owns every pose. Guests have no equivalent — their motion
   * arrives as inputs. Bounds-clamped like everything else.
   */
  driveHostSeat(x: number, y: number, z: number, yaw: number): void {
    const self = this.members.get(this.hostId);
    if (!self || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return;
    void y;
    self.pose.x = Math.max(BOUND_X_MIN, Math.min(BOUND_X_MAX, x));
    self.pose.z = Math.max(-BOUND_Z, Math.min(BOUND_Z, z));
    self.pose.y = 0;
    self.pose.yaw = yaw;
  }

  roster(): RosterEntry[] {
    return [...this.members.values()].map((m) => ({ ...m.entry }));
  }

  /** Host's own ready flag. Guests use GuestClient.setReady. */
  setReady(ready: boolean): void {
    const self = this.members.get(this.hostId);
    if (!self || self.entry.ready === ready) return;
    self.entry.ready = ready;
    this.broadcastRoster();
  }

  canStart(): boolean {
    if (this.phase !== 'lobby') return false;
    const connected = [...this.members.values()].filter((m) => m.entry.connected);
    return connected.length >= 2 && connected.every((m) => m.entry.ready);
  }

  /** Start the match. Returns false unless every connected seat is ready. */
  start(): boolean {
    if (!this.canStart()) return false;
    this.phase = 'starting';
    this.startTick = this.tick + 20; // 1 s at 20 Hz: seats sync before playing
    this.broadcast({ type: 'start', startTick: this.startTick, hostNow: this.now() });
    this.broadcastRoster();
    return true;
  }

  /** Manual tick for virtual-time proofs. Auto mode calls this on interval. */
  tickOnce(nowMs: number): void {
    if (this.disposed) return;
    this.tick += 1;
    this.diag.tick(nowMs);
    if (this.phase === 'starting' && this.tick >= this.startTick) {
      this.phase = 'playing';
      this.broadcastRoster();
    }
    if (this.phase === 'playing') {
      for (const m of this.members.values()) {
        if (!m.entry.connected) continue;
        integrateInput(m.pose, m.lastInput.mx, m.lastInput.mz, m.lastInput.yaw, m.lastInput.sprint, TICK_DT);
      }
      this.broadcastState(nowMs);
    }
    // One ping per 20 ticks round-robin: a full sweep with no extra timer.
    const guests = [...this.members.values()].filter((m) => m.peerId !== null && m.entry.connected);
    if (guests.length > 0 && this.tick % 20 === 0) {
      const g = guests[this.pingCursor++ % guests.length];
      g.pingAt = nowMs;
      this.sendTo(g, { type: 'ping', t: nowMs });
    }
  }

  startAuto(): void {
    if (this.timer !== null || this.disposed) return;
    this.timer = setInterval(() => this.tickOnce(this.now()), 1000 / 20);
  }

  stopAuto(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopAuto();
    this.unsubscribe();
    try {
      this.broadcast({ type: 'bye' } satisfies ByeMsg);
    } catch {
      /* transport already gone: roster simply stops. */
    }
    liveRooms -= 1;
    this.onChange();
  }

  // -- internals ------------------------------------------------------------

  private sendTo(m: HostMember, msg: NetMessage): void {
    if (m.peerId !== null) this.transport.send(m.peerId, msg);
  }

  private broadcast(msg: NetMessage): void {
    for (const m of this.members.values()) this.sendTo(m, msg);
  }

  private broadcastRoster(): void {
    this.broadcast({ type: 'roster', roster: this.roster() });
    this.onChange();
  }

  private broadcastState(nowMs: number): void {
    const players: PlayerSample[] = [];
    for (const m of this.members.values()) {
      if (!m.entry.connected) continue;
      players.push({ id: m.entry.id, x: m.pose.x, y: m.pose.y, z: m.pose.z, yaw: m.pose.yaw, ack: m.lastSeq });
    }
    this.broadcast({ type: 'state', tick: this.tick, hostNow: nowMs, players });
  }

  private handle(from: PeerId, raw: unknown): void {
    if (!isNetMessage(raw)) return;
    const msg = raw;
    switch (msg.type) {
      case 'hello':
        this.admit(from, msg.code, msg.name);
        break;
      case 'ready': {
        const id = this.peerToId.get(from);
        const m = id ? this.members.get(id) : undefined;
        if (!m || m.entry.isHost) return;
        m.entry.ready = msg.ready;
        this.broadcastRoster();
        break;
      }
      case 'input': {
        const id = this.peerToId.get(from);
        const m = id ? this.members.get(id) : undefined;
        if (!m) return;
        this.applyInput(m, msg);
        break;
      }
      case 'ping':
        this.transport.send(from, { type: 'pong', t: msg.t });
        break;
      case 'pong': {
        const id = this.peerToId.get(from);
        const m = id ? this.members.get(id) : undefined;
        if (m && m.pingAt > 0) {
          this.diag.recordRtt(this.now() - m.pingAt);
          m.pingAt = 0;
        }
        break;
      }
      case 'bye': {
        const id = this.peerToId.get(from);
        const m = id ? this.members.get(id) : undefined;
        if (m) {
          m.entry.connected = false;
          this.broadcastRoster();
        }
        break;
      }
      default:
        break;
    }
  }

  private admit(from: PeerId, code: string, name: string): void {
    if (code !== this.code) {
      this.transport.send(from, { type: 'reject', reason: 'bad-code' });
      return;
    }
    // Rejoin on the same transport id resumes the seat instead of adding one.
    const existing = this.peerToId.get(from);
    if (existing) {
      const m = this.members.get(existing);
      if (m) {
        m.entry.connected = true;
        this.transport.send(from, {
          type: 'welcome',
          playerId: m.entry.id,
          hostNow: this.now(),
          roster: this.roster(),
        });
        this.broadcastRoster();
        return;
      }
    }
    const connected = [...this.members.values()].filter((m) => m.entry.connected).length;
    if (connected >= MAX_PLAYERS) {
      this.transport.send(from, { type: 'reject', reason: 'room-full' });
      return;
    }
    if (this.phase !== 'lobby') {
      this.transport.send(from, { type: 'reject', reason: 'already-started' });
      return;
    }
    const want = cleanName(name).toLowerCase();
    const clash = [...this.members.values()].some(
      (m) => m.entry.connected && m.entry.name.toLowerCase() === want,
    );
    if (clash) {
      this.transport.send(from, { type: 'reject', reason: 'duplicate-name' });
      return;
    }
    const id = 'p' + this.nextId++;
    const slot = this.members.size % 2 === 1 ? SPAWN_B : SPAWN_A;
    this.members.set(id, {
      entry: { id, name: cleanName(name), ready: false, isHost: false, connected: true },
      peerId: from,
      pose: createPose(slot.x, 0, slot.z, slot.yaw),
      lastInput: { mx: 0, mz: 0, yaw: slot.yaw, sprint: false },
      lastSeq: -1,
      pingAt: 0,
    });
    this.peerToId.set(from, id);
    this.transport.send(from, {
      type: 'welcome',
      playerId: id,
      hostNow: this.now(),
      roster: this.roster(),
    });
    this.broadcastRoster();
  }

  /** Validate a guest input and store it as the seat's wish. Never a pose. */
  private applyInput(m: HostMember, msg: InputMsg): void {
    const okSeq = Number.isSafeInteger(msg.seq) && msg.seq > m.lastSeq;
    const okVec =
      Number.isFinite(msg.mx) && Number.isFinite(msg.mz) && Math.abs(msg.mx) <= 1.5 && Math.abs(msg.mz) <= 1.5;
    const okLook =
      Number.isFinite(msg.yaw) && Number.isFinite(msg.pitch) && Math.abs(msg.pitch) <= Math.PI / 2 + 0.01;
    const accepted = okSeq && okVec && okLook && m.entry.connected && this.phase === 'playing';
    this.diag.recordInput(accepted);
    if (!accepted) return;
    m.lastSeq = msg.seq;
    // Sprint is intent (shift key), not speed: the host picks the speed.
    m.lastInput = { mx: msg.mx, mz: msg.mz, yaw: msg.yaw, sprint: msg.fire && msg.mz > 0.1 };
  }
}

// ---------------------------------------------------------------------------
// Guest
// ---------------------------------------------------------------------------

export type GuestState = 'joining' | 'lobby' | 'starting' | 'playing' | 'rejected' | 'closed';

export interface GuestOptions {
  now?: () => number;
  onChange?: () => void;
  joinTimeoutMs?: number;
}

export class GuestClient {
  readonly diag = new NetDiagnostics();
  private readonly transport: Transport;
  private readonly hostPeer: PeerId;
  private readonly now: () => number;
  private readonly onChange: () => void;
  private readonly unsubscribe: () => void;
  private state: GuestState = 'joining';
  private rejectReason: string | null = null;
  private playerId: string | null = null;
  private rosterCache: RosterEntry[] = [];
  private startTick = -1;
  private seq = 0;
  private lastAck = -1;
  /** Divergence of the last accepted ack: the true prediction error. */
  private ackError = 0;
  private readonly self: Pose = createPose();
  /**
   * Prediction history: pose AFTER integrating each sent input, as
   * [seq, x, y, z] quads in a preallocated ring. Reconciliation compares the
   * HISTORICAL prediction for an acked seq against authority — never the
   * live pose, which is legitimately 1-2 ticks ahead and would trip the
   * bound on every sprint step. 128 deep ≈ 6.4 s: far past any plausible ack
   * delay, bounded so a stalled host costs 4 KiB, never growth.
   */
  private readonly predHist = new Float64Array(128 * 4);
  private predHead = 0;
  private predCount = 0;
  /** Scratch for history lookups. Reused so the receive path allocates nothing. */
  private readonly predScratch: Pose = createPose();
  private pingTimer: TimerId = null;
  private joinTimer: TimerId = null;
  private joinCode = '';
  private joinName = '';
  private joinNonce = '';
  private joinAttempts = 0;
  private joinTimeoutMs = 5000;
  private disposed = false;
  // Remote poses, interpolated for render. Bounded: one ring per seat.
  private readonly remotes = new Map<string, SnapshotRing>();

  constructor(transport: Transport, hostPeer: PeerId, code: string, name: string, opts?: GuestOptions) {
    this.transport = transport;
    this.hostPeer = hostPeer;
    this.now = opts?.now ?? Date.now;
    this.onChange = opts?.onChange ?? (() => undefined);
    liveRooms += 1;
    this.diag.reset('guest');
    this.unsubscribe = transport.onMessage((from, msg) => this.handle(from, msg));
    // Join retry: hello/welcome cross lossy links, so one shot is not enough
    // (the in-page proof caught exactly this: a 1% draw ate the only hello).
    // The interval covers live tabs; virtual-time proofs drive retryJoin()
    // by hand because their clock is virtual. Attempt-counted timeout, so
    // both share the deadline logic.
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

  /**
   * (Re)send the admission hello. No-op once the join has settled, so
   * retries are idempotent: the host resumes the same seat by transport id.
   */
  retryJoin(): void {
    if (this.disposed || this.state !== 'joining') return;
    this.transport.send(this.hostPeer, {
      type: 'hello',
      code: this.joinCode,
      name: this.joinName,
      nonce: this.joinNonce,
    });
  }

  getState(): GuestState {
    return this.state;
  }

  getRejectReason(): string | null {
    return this.rejectReason;
  }

  getPlayerId(): string | null {
    return this.playerId;
  }

  roster(): RosterEntry[] {
    return this.rosterCache.map((r) => ({ ...r }));
  }

  selfPose(): Pose {
    return { ...this.self };
  }
  /** True prediction error at the last accepted ack, metres. */
  lastAckError(): number {
    return this.ackError;
  }

  setReady(ready: boolean): void {
    if (this.state !== 'lobby') return;
    this.transport.send(this.hostPeer, { type: 'ready', ready });
  }

  /**
   * Send one input sample AND predict it locally. Sprint binds to fire+moving
   * forward exactly like the host's rule, so prediction uses the same speed.
   */
  sendInput(mx: number, mz: number, yaw: number, pitch: number, fire: boolean, jump: boolean): void {
    if (this.state !== 'playing' && this.state !== 'starting') return;
    // No diag.tick here: the guest's rate is measured off received states in
    // applyState, so one tick is counted per host tick, not two.
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
    if (this.joinTimer !== null) {
      clearTimeout(this.joinTimer);
      this.joinTimer = null;
    }
    this.unsubscribe();
    try {
      this.transport.send(this.hostPeer, { type: 'bye' });
    } catch {
      /* host already gone. */
    }
    this.state = 'closed';
    liveRooms -= 1;
    this.onChange();
  }

  // -- internals ------------------------------------------------------------

  private clearJoinTimer(): void {
    if (this.joinTimer !== null) {
      clearTimeout(this.joinTimer);
      this.joinTimer = null;
    }
  }

  private handle(from: PeerId, raw: unknown): void {
    if (from !== this.hostPeer || !isNetMessage(raw)) return;
    const msg = raw;
    const nowMs = this.now();
    switch (msg.type) {
      case 'welcome':
        this.clearJoinTimer();
        this.playerId = msg.playerId;
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
        // Guests render ONLY this. There is deliberately no merge with local
        // state: the host's word replaces, never patches.
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
        this.transport.send(this.hostPeer, { type: 'pong', t: msg.t });
        break;
      case 'pong':
        this.diag.recordRtt(Math.max(0, nowMs - msg.t));
        break;
      case 'bye':
        this.state = 'closed';
        this.rejectReason = 'host-left';
        this.onChange();
        break;
      default:
        break;
    }
  }

  /**
   * Find the historical prediction for an acked input seq. Writes into
   * predScratch and returns true; false when history does not cover the seq
   * (post-stall). Newest-first with an early break: seqs rise monotonically.
   */
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
    void tick;
    if (this.state === 'starting' && this.startTick >= 0 && tick >= this.startTick) {
      this.state = 'playing';
    }
    if (this.state !== 'playing' && this.state !== 'starting') return;
    this.diag.tick(nowMs);
    this.diag.recordAge(Math.max(0, nowMs - hostNow));
    for (const p of players) {
      if (p.id === this.playerId) {
        if (this.findPrediction(p.ack)) {
          const r = reconcileSelf(this.predScratch, p, p.ack, this.lastAck);
          if (!r.accepted) continue;
          this.lastAck = p.ack;
          this.ackError = r.divergenceM;
          if (r.correction === 'snap') {
            // Shift the LIVE pose by the error, preserving legitimate lead:
            // authority agreed with history everywhere except this delta.
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
          this.diag.recordMiss(nowMs);
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
    this.onChange();
  }
}
