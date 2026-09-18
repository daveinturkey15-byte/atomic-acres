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
 */

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

/** Guest -> host: request admission. */
export interface HelloMsg {
  type: 'hello';
  code: string;
  name: string;
  /** Client nonce so a stale retry is not mistaken for a second player. */
  nonce: string;
}

/** Host -> guest: admission granted. Carries the guest's authoritative id. */
export interface WelcomeMsg {
  type: 'welcome';
  playerId: string;
  hostNow: number;
  roster: RosterEntry[];
}

/** Host -> guest: admission refused. Terminal for this join attempt. */
export interface RejectMsg {
  type: 'reject';
  reason: 'bad-code' | 'room-full' | 'already-started' | 'duplicate-name';
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

/** Either side: liveness reply. Echoes the ping's t. */
export interface PongMsg {
  type: 'pong';
  t: number;
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
  | ByeMsg;

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
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
      return typeof m['code'] === 'string' && typeof m['name'] === 'string' && typeof m['nonce'] === 'string';
    case 'welcome':
      return (
        typeof m['playerId'] === 'string' &&
        isFiniteNum(m['hostNow']) &&
        Array.isArray(m['roster']) &&
        (m['roster'] as unknown[]).every(isRosterEntry)
      );
    case 'reject':
      return (
        m['reason'] === 'bad-code' ||
        m['reason'] === 'room-full' ||
        m['reason'] === 'already-started' ||
        m['reason'] === 'duplicate-name'
      );
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
        typeof m['jump'] === 'boolean'
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
          Number.isSafeInteger(s['ack'])
        );
      });
    case 'ping':
    case 'pong':
      return isFiniteNum(m['t']);
    case 'bye':
      return true;
    default:
      return false;
  }
}
