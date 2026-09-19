/**
 * Nuketown 2025 — net wire protocol.
 *
 * The authority boundary lives in these types, not in comments. Anything the
 * host owns can only be CONSTRUCTED with a HostKey, which only HostRoom holds;
 * guests never see one. Anything a guest asserts (inputs) is validated by the
 * host on receipt — position is derived server-side, never trusted.
 *
 * All messages are plain JSON-able data. `isNetMessage` is the single receive
 * boundary: unknown wire bytes become a NetMessage or are dropped, so a
 * malformed peer can at worst be ignored, never crash the room.
 *
 * WAVE 0 ADDITION (2026-09-18): the gameplay message set lives in
 * `./protocol-game` — the two files together were 529 lines and AGENTS.md caps
 * one at 400. It is re-exported here, so every existing importer of
 * `./protocol` still sees the whole protocol and nothing existing changed.
 */

import type { TeamId } from '../game/events';
import {
  isGameMessage,
  isTeamId,
  type DamageMsg,
  type KillMsg,
  type MatchStateMsg,
  type OrdnanceMsg,
  type ShotMsg,
  type ShotRejectMsg,
  type SpawnMsg,
  type StreakIntentMsg,
  type StreakStateMsg,
} from './protocol-game';

export * from './protocol-game';

/** Opaque host capability. Created by HostRoom; never serialized, never sent. */
export type HostKey = { readonly __host: unique symbol };

/** Anything the host publishes is stamped with a key only the host holds. */
export type HostAuthored<T> = T & { readonly __fromHost: true };

/** Max players in a room. Small on purpose: the map is ~60 m spawn to spawn. */
export const MAX_PLAYERS = 8;

/** Join codes are 6 chars of Crockford32 (no I/L/O/U): readable over voice. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function createJoinCode(rand: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  }
  return code;
}

export function isJoinCode(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9A-HJKMNP-TV-Z]{6}$/.test(v);
}

export type LobbyPhase = 'lobby' | 'starting' | 'playing';

export interface RosterEntry {
  id: string;
  name: string;
  ready: boolean;
  /** True for the host's own entry. */
  isHost: boolean;
  connected: boolean;
}

/**
 * A seat's resume credential (old `room-rejoin-identity.ts`, the idea not the
 * module): the host mints a token per seat and hands it back in `welcome`; a
 * guest that reconnects inside `REJOIN_GRACE_MS` presents it in `hello` and
 * gets the SAME seat — id, team, score — instead of a new one. A wrong or
 * expired token is not an error: the hello is treated as a fresh join.
 */
export interface ResumeClaim {
  playerId: string;
  token: string;
}

/** Guest -> host: request admission. */
export interface HelloMsg {
  type: 'hello';
  code: string;
  name: string;
  /** Client nonce so a stale retry is not mistaken for a second player. */
  nonce: string;
  /** Present when the guest is coming back for a seat it already held. */
  resume?: ResumeClaim;
}

/** Host -> guest: admission granted. Carries the guest's authoritative id. */
export interface WelcomeMsg {
  type: 'welcome';
  playerId: string;
  hostNow: number;
  roster: RosterEntry[];
  /** Resume credential for this seat. Optional so pre-grace peers still validate. */
  token?: string;
}

/** Every reason a host can refuse a hello, frozen; the labels beside it are the UI's. */
export const REJECT_REASONS = ['bad-code', 'room-full', 'already-started', 'duplicate-name'] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

export const REJECT_LABELS: Readonly<Record<RejectReason, string>> = Object.freeze({
  'bad-code': 'NO ROOM WITH THAT CODE',
  'room-full': 'ROOM IS FULL',
  'already-started': 'MATCH ALREADY STARTED',
  'duplicate-name': 'THAT NAME IS TAKEN',
});

/** Host -> guest: admission refused. Terminal for this join attempt. */
export interface RejectMsg {
  type: 'reject';
  reason: RejectReason;
}

/** Host -> all: current roster. The ONLY roster source guests may render. */
export interface RosterMsg {
  type: 'roster';
  roster: RosterEntry[];
}

/** Either side -> host: readiness. Guests send their own; host sets its own. */
export interface ReadyMsg {
  type: 'ready';
  ready: boolean;
}

/** Host -> all: match starts at the given host tick. */
export interface StartMsg {
  type: 'start';
  startTick: number;
  hostNow: number;
}

/**
 * Guest -> host: one input sample. NOTE what is missing: no position. The
 * guest asserts intent (move dir, look, buttons); the host integrates it into
 * the authoritative position itself. A client that claims a position is
 * ignored — that is the bug this shape exists to prevent.
 */
export interface InputMsg {
  type: 'input';
  seq: number;
  /** -1..1 strafe/right, -1..1 forward. Clamped by the host. */
  mx: number;
  mz: number;
  yaw: number;
  pitch: number;
  fire: boolean;
  jump: boolean;
  /**
   * Sprint INTENT. Optional: the first wire bound sprint to `fire && mz > 0.1`
   * (there was no sprint key on the proof's scripted guest) and that reading
   * is kept when this is absent, so the loopback proof is unchanged. A real
   * guest sends it explicitly, because a guest that fires while walking is
   * not sprinting.
   */
  sprint?: boolean;
  /**
   * Seconds this sample covers, so the host integrates each accepted input by
   * the interval the guest actually moved for instead of one fixed tick per
   * input. Without it two 20 Hz clocks that drift 0.4 % apart put one extra
   * or one missing tick of travel (0.24 m) into the host's belief every
   * twelve seconds of walking, and the guest rubber-bands on a schedule.
   * Optional (absent = `TICK_DT`, the first wire's reading); the host clamps
   * it to two ticks and admits at most a few inputs per tick, so a peer
   * cannot buy speed with a bigger number or with more messages.
   */
  dt?: number;
  /**
   * The guest's standing height, metres. Position stays host-integrated in x
   * and z; y is the one axis the wire's flat kinematics cannot know (stairs,
   * the balcony) and the one axis that buys no speed. Clamped by the host to
   * the arena's standable band.
   */
  y?: number;
}

/** One authoritative player sample inside a state broadcast. */
export interface PlayerSample {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Last guest input seq the host integrated for this player. */
  ack: number;
  /**
   * WAVE 0, optional on purpose. `room.ts` broadcasts state before a GameHost
   * exists and is not this lane's file, so these cannot be required without
   * breaking the lobby path. Absent means "no game authority yet", NOT a
   * default: a reader must branch on `undefined`, never substitute 100/0/true.
   */
  hp?: number;
  team?: TeamId;
  alive?: boolean;
}

/** Host -> all: fixed-tick world snapshot. */
export interface StateMsg {
  type: 'state';
  tick: number;
  hostNow: number;
  players: PlayerSample[];
}

/** Either side: liveness probe. Carries the sender's clock. */
export interface PingMsg {
  type: 'ping';
  t: number;
}

/**
 * Either side: liveness reply. Echoes the ping's t. `now` is the REPLIER's
 * clock at reply time, so the pinger can estimate the offset between the two
 * clocks NTP-style: `offset = now - (t + received) / 2`. Optional because a
 * pong without it still measures RTT, which is all the first wire needed.
 */
export interface PongMsg {
  type: 'pong';
  t: number;
  now?: number;
}

/** Either side -> other: graceful leave. Lets the roster update at once. */
export interface ByeMsg {
  type: 'bye';
}

export type NetMessage =
  | HelloMsg
  | WelcomeMsg
  | RejectMsg
  | RosterMsg
  | ReadyMsg
  | StartMsg
  | InputMsg
  | StateMsg
  | PingMsg
  | PongMsg
  | ByeMsg
  | ShotMsg
  | ShotRejectMsg
  | DamageMsg
  | KillMsg
  | SpawnMsg
  | StreakIntentMsg
  | StreakStateMsg
  | MatchStateMsg
  | OrdnanceMsg;

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isResumeClaim(v: unknown): v is ResumeClaim {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r['playerId'] === 'string' && typeof r['token'] === 'string' && r['token'].length >= 12;
}

function isRosterEntry(v: unknown): v is RosterEntry {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r['id'] === 'string' &&
    typeof r['name'] === 'string' &&
    typeof r['ready'] === 'boolean' &&
    typeof r['isHost'] === 'boolean' &&
    typeof r['connected'] === 'boolean'
  );
}

/**
 * Single receive boundary. Returns true only for well-formed messages with a
 * known type tag; anything else is dropped by the caller. Deliberately
 * structural, not exhaustive per-field: bounds (speed clamps, arena limits)
 * are the host's job at admission time, not the parser's.
 */
export function isNetMessage(v: unknown): v is NetMessage {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  switch (m['type']) {
    case 'hello':
      return (
        typeof m['code'] === 'string' && typeof m['name'] === 'string' && typeof m['nonce'] === 'string' &&
        (m['resume'] === undefined || isResumeClaim(m['resume']))
      );
    case 'welcome':
      return (
        typeof m['playerId'] === 'string' &&
        isFiniteNum(m['hostNow']) &&
        Array.isArray(m['roster']) &&
        (m['roster'] as unknown[]).every(isRosterEntry) &&
        (m['token'] === undefined || typeof m['token'] === 'string')
      );
    case 'reject':
      return typeof m['reason'] === 'string' && (REJECT_REASONS as readonly string[]).includes(m['reason']);
    case 'roster':
      return Array.isArray(m['roster']) && (m['roster'] as unknown[]).every(isRosterEntry);
    case 'ready':
      return typeof m['ready'] === 'boolean';
    case 'start':
      return isFiniteNum(m['startTick']) && isFiniteNum(m['hostNow']);
    case 'input':
      return (
        Number.isSafeInteger(m['seq']) &&
        isFiniteNum(m['mx']) &&
        isFiniteNum(m['mz']) &&
        isFiniteNum(m['yaw']) &&
        isFiniteNum(m['pitch']) &&
        typeof m['fire'] === 'boolean' &&
        typeof m['jump'] === 'boolean' &&
        (m['sprint'] === undefined || typeof m['sprint'] === 'boolean') &&
        (m['dt'] === undefined || isFiniteNum(m['dt'])) &&
        (m['y'] === undefined || isFiniteNum(m['y']))
      );
    case 'state':
      if (!Number.isSafeInteger(m['tick']) || !isFiniteNum(m['hostNow']) || !Array.isArray(m['players'])) {
        return false;
      }
      return (m['players'] as unknown[]).every((p) => {
        if (!p || typeof p !== 'object') return false;
        const s = p as Record<string, unknown>;
        return (
          typeof s['id'] === 'string' &&
          isFiniteNum(s['x']) &&
          isFiniteNum(s['y']) &&
          isFiniteNum(s['z']) &&
          isFiniteNum(s['yaw']) &&
          Number.isSafeInteger(s['ack']) &&
          // Wave 0 optional game fields: absent is legal, malformed is not.
          (s['hp'] === undefined || isFiniteNum(s['hp'])) &&
          (s['team'] === undefined || isTeamId(s['team'])) &&
          (s['alive'] === undefined || typeof s['alive'] === 'boolean')
        );
      });
    // Gameplay tags: shapes and validators live in ./protocol-game so this
    // file stays inside the 400-line cap. `isGameMessage` fails closed on any
    // tag it does not own, so this list cannot admit an unchecked message.
    case 'shot':
    case 'shot-reject':
    case 'damage':
    case 'kill':
    case 'spawn':
    case 'streak-intent':
    case 'streak-state':
    case 'match-state':
    case 'ordnance':
      return isGameMessage(m);
    case 'ping':
      return isFiniteNum(m['t']);
    case 'pong':
      return isFiniteNum(m['t']) && (m['now'] === undefined || isFiniteNum(m['now']));
    case 'bye':
      return true;
    default:
      return false;
  }
}
