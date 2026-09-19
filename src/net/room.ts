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
 * FOUR FILES, ONE MODULE (the 400-line cap): `room-core.ts` holds the shared
 * kinematics and the live-room counter, `room-admit.ts` the seat rules
 * (admission, resume, input clamp, grace sweep), `room-guest.ts` the
 * `GuestClient`, and this file the `HostRoom`. All are re-exported here, so
 * every importer of `./room` sees what it always saw.
 *
 * Lifetime: every timer this file creates is owned by exactly one room object
 * and cleared in dispose(). Proof asserts liveCount() returns to zero.
 *
 * What the lobby lane added (2026-09-19), each as a rule with a reason:
 *  - **Rejoin grace.** A seat whose peer went QUIET is held for
 *    `REJOIN_GRACE_MS` as a reservation (old `private-match.ts`): it keeps its
 *    id, counts against capacity and holds the start fence. A `hello` inside
 *    the window carrying the seat's token gets the same seat back; past it the
 *    seat is released and the roster says so. A `bye` is a deliberate leave
 *    and releases the seat at once.
 *  - **Input-driven integration.** A guest's pose advances by each accepted
 *    input's own `dt` (clamped, rate-limited) rather than by one tick per host
 *    tick, so what the guest's controller walked is what the host believes.
 *    A host tick that sees no input integrates NOTHING. The first version
 *    "coasted" the last wish on such a tick to cover a lost packet; the seeded
 *    loopback proof (40 ms +/-20 ms jitter, 1 % loss) showed why that is
 *    wrong: a packet that is merely late arrives with its own `dt` and is
 *    integrated too, so every jittered tick added travel the guest never
 *    sent - 992 forward snaps and a 4.3 m lead in two virtual minutes. A
 *    genuinely lost input now costs its interval once (<= 0.33 m at sprint,
 *    inside the guest's correction bound), which is the honest price.
 *  - **Start refusals with reasons** (`lobbyStartRefusal`, IMPORT-PLAN §5.4).
 *  - **Game-tag routing.** `shot` / `streak-intent` from a guest go to one
 *    registered handler with the guest's SEAT id, never its peer id; the room
 *    still knows nothing about damage or score.
 */
import { BOUND_X_MAX, BOUND_X_MIN, BOUND_Z } from '../core/layout';
import { LOBBY_MAX_PLAYERS, isLobbyCapacity, lobbyStartRefusal, type LobbyStartRefusal } from '../game/rules';
import { NetDiagnostics } from './diagnostics';
import {
  createJoinCode, isJoinCode, isNetMessage,
  type ByeMsg, type GameNetMessage, type HelloMsg, type HostKey, type InputMsg, type LobbyPhase,
  type NetMessage, type PlayerSample, type RosterEntry,
} from './protocol';
import { admissionRefusal, inputAccepted, newMember, resumeSeat, sweepSeats, INPUT_Y_MAX, type HostMember } from './room-admit';
import { cleanName, integrateInput, roomClosed, roomOpened, type Pose, type TimerId } from './room-core';
import { TICK_DT } from './snapshot';
import type { PeerId, Transport } from './transport';

export * from './room-core';
export { INPUTS_PER_TICK_CAP, INPUT_Y_MAX, LIVENESS_MS } from './room-admit';
export { GuestClient, type GuestOptions, type GuestState, type SelfAck } from './room-guest';

/** Longest interval one input may claim to cover. Two ticks: a dropped frame, not a sprint. */
export const INPUT_DT_CAP = TICK_DT * 2;

// HostKey capability: module-private. Nothing outside this file can name it,
// so nothing outside this file can publish host state.
const HOST_KEY = {} as HostKey;
void HOST_KEY;

export interface HostOptions {
  hostName?: string;
  /** Preset join code (lets the channel name embed it). Generated when absent/invalid. */
  code?: string;
  codeRand?: () => number;
  now?: () => number;
  onChange?: () => void;
  /** Seats offered, `LOBBY_CAPACITIES`. Default `LOBBY_MAX_PLAYERS`. */
  capacity?: number;
}

export class HostRoom {
  readonly code: string;
  readonly hostId = 'host';
  readonly capacity: number;
  readonly diag = new NetDiagnostics();
  private readonly transport: Transport;
  private readonly now: () => number;
  private readonly onChange: () => void;
  private readonly codeRand: () => number;
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
  private rev = 0;
  private gameHandler: ((playerId: string, msg: GameNetMessage) => void) | null = null;
  private stamp: ((s: PlayerSample) => PlayerSample) | null = null;
  private extraSamples: ((into: PlayerSample[]) => void) | null = null;

  constructor(transport: Transport, opts?: HostOptions) {
    this.transport = transport;
    this.now = opts?.now ?? Date.now;
    this.onChange = opts?.onChange ?? (() => undefined);
    this.codeRand = opts?.codeRand ?? Math.random;
    this.code = isJoinCode(opts?.code) ? opts.code : createJoinCode(this.codeRand);
    this.capacity = isLobbyCapacity(opts?.capacity) ? opts.capacity : LOBBY_MAX_PLAYERS;
    roomOpened();
    this.diag.reset('host');
    this.members.set(this.hostId, newMember(this.hostId, opts?.hostName ?? 'host', true, null, 0, this.now(), this.codeRand));
    this.unsubscribe = transport.onMessage((from, msg) => this.handle(from, msg));
  }

  getPhase(): LobbyPhase { return this.phase; }
  getTick(): number { return this.tick; }
  /** Bumps on every roster publish, so a reader can diff by number instead of by copy. */
  rosterRevision(): number { return this.rev; }
  hostName(): string { return this.members.get(this.hostId)?.entry.name ?? 'host'; }

  /** Authoritative pose of a seat, copied. Diagnostic/proof path. */
  poseOf(id: string): Pose | null {
    const m = this.members.get(id);
    return m ? { ...m.pose } : null;
  }

  /** Every guest seat's live pose, allocation-free. The pose is the room's; read it, do not keep it. */
  forEachGuestPose(fn: (id: string, pose: Readonly<Pose>, connected: boolean) => void): void {
    for (const m of this.members.values()) if (m.peerId !== null) fn(m.entry.id, m.pose, m.entry.connected);
  }

  /** The game host deployed this seat somewhere: the room's integration continues from there. */
  placeSeat(id: string, x: number, z: number, yaw: number): void {
    const m = this.members.get(id);
    if (!m || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return;
    m.pose.x = Math.max(BOUND_X_MIN, Math.min(BOUND_X_MAX, x));
    m.pose.z = Math.max(-BOUND_Z, Math.min(BOUND_Z, z));
    m.pose.y = 0;
    m.pose.yaw = yaw;
  }

  /** Drive the host's own seat from the local player. Host-only and safe. */
  driveHostSeat(x: number, y: number, z: number, yaw: number): void {
    void y;
    this.placeSeat(this.hostId, x, z, yaw);
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

  /** Why the host may not start, or null when it may (IMPORT-PLAN §5.4). */
  startRefusal(): LobbyStartRefusal | null {
    return lobbyStartRefusal([...this.members.values()].map((m) => m.entry), this.phase === 'lobby', this.capacity);
  }

  canStart(): boolean { return this.startRefusal() === null; }

  /** Start the match. Returns the refusal, or null when the countdown began. */
  start(): LobbyStartRefusal | null {
    const refusal = this.startRefusal();
    if (refusal !== null) return refusal;
    this.phase = 'starting';
    this.startTick = this.tick + 20; // 1 s at 20 Hz: seats sync before playing
    this.broadcast({ type: 'start', startTick: this.startTick, hostNow: this.now() });
    this.broadcastRoster();
    return null;
  }

  /** One listener for guest game messages, keyed by SEAT id. */
  onGame(handler: ((playerId: string, msg: GameNetMessage) => void) | null): void { this.gameHandler = handler; }
  /** Adds hp/team/alive to the samples the room authors. The game host owns those. */
  setStamp(fn: ((s: PlayerSample) => PlayerSample) | null): void { this.stamp = fn; }
  /** Extra samples (bots) appended to every state broadcast. */
  setExtraSamples(fn: ((into: PlayerSample[]) => void) | null): void { this.extraSamples = fn; }

  /** Send to one seat. False when the seat is unknown or is the host's own. */
  sendToPlayer(id: string, msg: NetMessage): boolean {
    const m = this.members.get(id);
    if (!m || m.peerId === null) return false;
    this.transport.send(m.peerId, msg);
    return true;
  }

  broadcast(msg: NetMessage): void {
    for (const m of this.members.values()) if (m.peerId !== null) this.transport.send(m.peerId, msg);
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
      // Guests integrate per accepted input (`applyInput`); a tick that saw
      // none moves nobody (see the header). The rate cap resets per tick.
      for (const m of this.members.values()) m.inputsThisTick = 0;
      this.broadcastState(nowMs);
    }
    if (sweepSeats(this.members, this.peerToId, nowMs)) this.broadcastRoster();
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
    roomClosed();
    this.onChange();
  }

  // -- internals ------------------------------------------------------------

  private sendTo(m: HostMember, msg: NetMessage): void {
    if (m.peerId !== null) this.transport.send(m.peerId, msg);
  }

  private broadcastRoster(): void {
    this.rev += 1;
    this.broadcast({ type: 'roster', roster: this.roster() });
    this.onChange();
  }

  private broadcastState(nowMs: number): void {
    const players: PlayerSample[] = [];
    for (const m of this.members.values()) {
      if (!m.entry.connected) continue;
      const s: PlayerSample = { id: m.entry.id, x: m.pose.x, y: m.pose.y, z: m.pose.z, yaw: m.pose.yaw, ack: m.lastSeq };
      players.push(this.stamp === null ? s : this.stamp(s));
    }
    this.extraSamples?.(players);
    this.broadcast({ type: 'state', tick: this.tick, hostNow: nowMs, players });
  }

  private handle(from: PeerId, raw: unknown): void {
    if (!isNetMessage(raw)) return;
    const msg = raw;
    const known = this.peerToId.get(from);
    const m = known ? this.members.get(known) : undefined;
    if (m) m.lastHeardAt = this.now();
    switch (msg.type) {
      case 'hello':
        this.admit(from, msg);
        break;
      case 'ready':
        if (!m || m.entry.isHost) return;
        m.entry.ready = msg.ready;
        this.broadcastRoster();
        break;
      case 'input':
        if (m) this.applyInput(m, msg);
        break;
      case 'ping':
        this.transport.send(from, { type: 'pong', t: msg.t, now: this.now() });
        break;
      case 'pong':
        if (m && m.pingAt > 0) {
          this.diag.recordRtt(this.now() - m.pingAt);
          m.pingAt = 0;
        }
        break;
      case 'bye':
        // A deliberate leave releases the seat at once. Only SILENCE earns a
        // reservation: a player who pressed Leave is not coming back for 90 s,
        // and holding the start fence for them would punish everyone else.
        if (m && m.peerId !== null) {
          this.members.delete(m.entry.id);
          this.peerToId.delete(m.peerId);
          this.broadcastRoster();
        }
        break;
      case 'shot':
      case 'streak-intent':
        if (m && m.entry.connected && this.gameHandler !== null) this.gameHandler(m.entry.id, msg);
        break;
      default:
        break;
    }
  }

  private admit(from: PeerId, hello: HelloMsg): void {
    const back = hello.code === this.code ? resumeSeat(this.members, this.peerToId, from, hello) : undefined;
    if (back !== undefined) {
      if (back.peerId !== from) {
        if (back.peerId !== null) this.peerToId.delete(back.peerId);
        back.peerId = from;
        this.peerToId.set(from, back.entry.id);
      }
      back.entry.connected = true;
      back.lastHeardAt = this.now();
      this.transport.send(from, { type: 'welcome', playerId: back.entry.id, hostNow: this.now(), roster: this.roster(), token: back.token });
      this.broadcastRoster();
      return;
    }
    const reason = admissionRefusal(this.members, hello, this.code, this.capacity, this.phase);
    if (reason !== null) {
      this.transport.send(from, { type: 'reject', reason });
      return;
    }
    const id = 'p' + this.nextId++;
    const m = newMember(id, cleanName(hello.name), false, from, this.members.size, this.now(), this.codeRand);
    this.members.set(id, m);
    this.peerToId.set(from, id);
    this.transport.send(from, { type: 'welcome', playerId: id, hostNow: this.now(), roster: this.roster(), token: m.token });
    this.broadcastRoster();
  }

  /** Validate a guest input and store it as the seat's wish. Never a pose. */
  private applyInput(m: HostMember, msg: InputMsg): void {
    const accepted = inputAccepted(m, msg, this.phase);
    this.diag.recordInput(accepted);
    if (!accepted) return;
    m.lastSeq = msg.seq;
    m.inputsThisTick += 1;
    // Sprint is intent, not speed: the host picks the speed. The explicit
    // flag wins; absent, the first wire's fire-and-forward reading applies.
    const sprint = msg.sprint ?? (msg.fire && msg.mz > 0.1);
    m.lastInput.mx = msg.mx; m.lastInput.mz = msg.mz; m.lastInput.yaw = msg.yaw; m.lastInput.sprint = sprint;
    const dt = msg.dt === undefined ? TICK_DT : Math.max(0, Math.min(INPUT_DT_CAP, msg.dt));
    const y = msg.y === undefined ? m.pose.y : Math.max(0, Math.min(INPUT_Y_MAX, msg.y));
    integrateInput(m.pose, msg.mx, msg.mz, msg.yaw, sprint, dt);
    m.pose.y = y;
  }
}
