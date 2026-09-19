/**
 * Nuketown 2025 — the host room's seat rules: admission, resumption, input
 * validation and the liveness / rejoin-grace sweep.
 *
 * Split out of `room.ts` (the 400-line cap) as PURE functions over the seat
 * table, so each rule reads as a rule: `admissionRefusal` is the old
 * `private-match.ts` admission with every refusal named, `resumeSeat` is the
 * rejoin-identity idea (a token minted per seat, presented in `hello`),
 * `inputAccepted` is the wire's clamp, `sweepSeats` is the grace window.
 * `HostRoom` owns the table and calls these; nothing here sends a message.
 */
import { SPAWN_A, SPAWN_B } from '../core/layout';
import { REJOIN_GRACE_MS } from '../game/rules';
import { MAX_PLAYERS, createJoinCode, type HelloMsg, type InputMsg, type LobbyPhase, type RejectReason, type RosterEntry } from './protocol';
import { cleanName, createPose, type Pose } from './room-core';
import type { PeerId } from './transport';

/** A guest that has sent nothing for this long is treated as gone (reservation). */
export const LIVENESS_MS = 6_000;
/** Inputs a seat may integrate per host tick. 20 Hz senders use one; jitter two. */
export const INPUTS_PER_TICK_CAP = 3;
/** Standable band a guest may declare for its y. The balcony is 3.3 m. */
export const INPUT_Y_MAX = 5;

export interface HostMember {
  entry: RosterEntry;
  peerId: PeerId | null; // null = the host's own seat
  token: string;
  pose: Pose;
  lastInput: { mx: number; mz: number; yaw: number; sprint: boolean };
  lastSeq: number;
  pingAt: number;
  lastHeardAt: number;
  disconnectedAt: number;
  /** Inputs integrated since the last host tick; the rate cap resets it. */
  inputsThisTick: number;
}

export type SeatTable = Map<string, HostMember>;

/** A fresh seat. Even seats deploy at A, odd at B, until the game host places them. */
export function newMember(
  id: string, name: string, isHost: boolean, peerId: PeerId | null, ordinal: number, now: number, rand: () => number,
): HostMember {
  const slot = ordinal % 2 === 1 ? SPAWN_B : SPAWN_A;
  return {
    entry: { id, name: cleanName(name), ready: false, isHost, connected: true },
    peerId,
    token: createJoinCode(rand) + createJoinCode(rand) + createJoinCode(rand),
    pose: createPose(slot.x, 0, slot.z, slot.yaw),
    lastInput: { mx: 0, mz: 0, yaw: slot.yaw, sprint: false },
    lastSeq: -1,
    pingAt: 0,
    lastHeardAt: now,
    disconnectedAt: 0,
    inputsThisTick: 0,
  };
}

/**
 * A returning seat: the same transport id (a retried hello), or a resume
 * token minted for that seat. Either resumes instead of adding one. A wrong
 * or expired token is not an error - the hello is treated as a fresh join.
 */
export function resumeSeat(members: SeatTable, peerToId: Map<PeerId, string>, from: PeerId, hello: HelloMsg): HostMember | undefined {
  const byPeer = peerToId.get(from);
  if (byPeer !== undefined) return members.get(byPeer);
  const claim = hello.resume;
  if (claim === undefined) return undefined;
  const m = members.get(claim.playerId);
  return m !== undefined && m.peerId !== null && m.token === claim.token ? m : undefined;
}

/** Why a fresh hello is refused, or null. Precedence: code, capacity, phase, name. */
export function admissionRefusal(members: SeatTable, hello: HelloMsg, code: string, capacity: number, phase: LobbyPhase): RejectReason | null {
  if (hello.code !== code) return 'bad-code';
  let seated = 0;
  for (const m of members.values()) if (m.entry.connected || m.peerId !== null) seated++;
  if (seated >= Math.min(MAX_PLAYERS, capacity)) return 'room-full';
  if (phase !== 'lobby') return 'already-started';
  const want = cleanName(hello.name).toLowerCase();
  for (const m of members.values()) if (m.entry.connected && m.entry.name.toLowerCase() === want) return 'duplicate-name';
  return null;
}

/** The wire's clamp on one guest input. Seq monotonic, vector bounded, look sane, rate capped. */
export function inputAccepted(m: HostMember, msg: InputMsg, phase: LobbyPhase): boolean {
  const okSeq = Number.isSafeInteger(msg.seq) && msg.seq > m.lastSeq;
  const okVec = Number.isFinite(msg.mx) && Number.isFinite(msg.mz) && Math.abs(msg.mx) <= 1.5 && Math.abs(msg.mz) <= 1.5;
  const okLook = Number.isFinite(msg.yaw) && Number.isFinite(msg.pitch) && Math.abs(msg.pitch) <= Math.PI / 2 + 0.01;
  const okRate = m.inputsThisTick < INPUTS_PER_TICK_CAP;
  return okSeq && okVec && okLook && okRate && m.entry.connected && phase === 'playing';
}

/**
 * Liveness and grace, once per tick. Quiet → reservation (kept, disconnected);
 * reservation older than the grace → released. Returns whether the roster changed.
 */
export function sweepSeats(members: SeatTable, peerToId: Map<PeerId, string>, nowMs: number): boolean {
  let changed = false;
  for (const [id, m] of members) {
    if (m.peerId === null) continue;
    if (m.entry.connected && nowMs - m.lastHeardAt > LIVENESS_MS) {
      m.entry.connected = false;
      m.disconnectedAt = nowMs;
      changed = true;
    } else if (!m.entry.connected && nowMs - m.disconnectedAt >= REJOIN_GRACE_MS) {
      members.delete(id);
      peerToId.delete(m.peerId);
      changed = true;
    }
  }
  return changed;
}
