/**
 * Nuketown 2025 — the GAMEPLAY half of the wire protocol.
 *
 * Split out of `protocol.ts` at authoring time, not later: the two together
 * came to 529 lines and AGENTS.md caps a file at 400. `protocol.ts` carries the
 * lobby and transport wire (hello/welcome/roster/input/state) and re-exports
 * everything here, so `import { ... } from './protocol'` still sees the whole
 * protocol and no existing importer changed.
 *
 * It imports the game vocabulary rather than re-spelling it. `game/events.ts`
 * and `game/rules.ts` are leaves, so `net/protocol-game -> game/events` adds no
 * cycle, and a hit zone or a denial reason exists in exactly one place
 * (IMPORT-PLAN §5.5). The host-authored messages carry the event object itself
 * in `e` for the same reason: a second field-by-field shape would be a mirror
 * that goes stale the first time an event grows a field.
 *
 * Trust split, which is why the validators below are uneven: guest-authored
 * messages (`shot`, `streak-intent`) are checked field by field because a peer
 * is not trusted; host-authored payloads are checked structurally plus every
 * number a client will do arithmetic with, because a NaN reaching the HUD is
 * the failure this boundary exists to stop.
 */

import {
  DAMAGE_CAUSES,
  HIT_ZONES,
  MATCH_END_REASONS,
  MATCH_PHASES,
  SHOT_REJECT_REASONS,
  SPAWN_REASONS,
  STREAK_DENIAL_REASONS,
  STREAK_END_REASONS,
  TEAMS,
  type DamageEvent,
  type DeathEvent,
  type KillEvent,
  type MatchEndReason,
  type MatchPhaseName,
  type ShotRejectedEvent,
  type SpawnEvent,
  type StreakActivatedEvent,
  type StreakDeniedEvent,
  type StreakEarnedEvent,
  type StreakEndedEvent,
  type TeamId,
} from '../game/events';
import { isMatchMode, type MatchMode } from '../game/rules';

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/**
 * Guest -> host: a shot CLAIM. Like `InputMsg` it names no shooter and asserts
 * no victim — the host knows the sender and resolves the hit itself. A claim
 * that carried its own kill would be the same bug class as one carrying a
 * position, which is the bug `InputMsg`'s shape already exists to prevent.
 */
export interface ShotMsg {
  type: 'shot';
  /** Per-shooter monotonic claim id; the exactly-once window keys on it. */
  seq: number;
  /** Life epoch, bumped on every respawn: isolates post-death bullets. */
  life: number;
  weaponId: string;
  /** Trigger time in the host clock domain. */
  firedAt: number;
  /** Predicted muzzle, validated against the host's shooter pose at firedAt. */
  ox: number; oy: number; oz: number;
  /** Unit aim direction. */
  dx: number; dy: number; dz: number;
}

/** Host -> shooter: the claim was refused. Label is `SHOT_REJECT_LABELS[reason]`. */
export interface ShotRejectMsg { type: 'shot-reject'; e: ShotRejectedEvent }

/** Host -> all: one applied hit. */
export interface DamageMsg { type: 'damage'; e: DamageEvent }

/**
 * Host -> all: one death. `kill` is null when nothing was credited (a suicide,
 * a fall). One message per death, so a guest cannot count the same one twice.
 */
export interface KillMsg { type: 'kill'; kill: KillEvent | null; death: DeathEvent }

/** Host -> all: an actor placed in the world. */
export interface SpawnMsg { type: 'spawn'; e: SpawnEvent }

/** Guest -> host: a streak slot press. `toggle` is the gate's control-toggle exemption. */
export interface StreakIntentMsg { type: 'streak-intent'; slot: number; toggle: boolean }

/** One slot of the host streak ledger, projected onto the wire. */
export interface StreakSlotState { streakId: string; slot: number; charges: number }

/**
 * Host -> one actor: its streak ledger (level) plus the transition that caused
 * the update (edge). Both, because an edge-only feed drops a refusal that
 * arrives during a stall, and a level-only feed can never show one at all.
 */
export interface StreakStateMsg {
  type: 'streak-state';
  at: number;
  actorId: string;
  /** Consecutive kills this life: the ladder position. */
  kills: number;
  slots: StreakSlotState[];
  cause: StreakEarnedEvent | StreakActivatedEvent | StreakDeniedEvent | StreakEndedEvent | null;
}

/** Wire projection of one ledger row. `game/scoring.ts` remains the only definition of a score. */
export interface ScoreRow { id: string; team: TeamId; kills: number; deaths: number; score: number }

/**
 * Host -> all: the match line. `endsAt` is `number | null`, never Infinity,
 * because Infinity is not JSON-able — it serialises to null and would arrive as
 * a type error on a real datachannel. null = unlimited, the same convention as
 * `game/rules.ts`. `teamScores` is the ledger's authoritative total: render it,
 * never recompute it from `scores` (IMPORT-PLAN §5.6, one number one owner).
 */
export interface MatchStateMsg {
  type: 'match-state';
  at: number;
  mode: MatchMode;
  phase: MatchPhaseName;
  endsAt: number | null;
  scoreLimit: number | null;
  teamScores: [number, number];
  scores: ScoreRow[];
  winner: TeamId | 'draw' | null;
  winnerId: string | null;
  endReason: MatchEndReason | null;
}

/** Every gameplay discriminant. `protocol.ts` routes these tags to `isGameMessage`. */
export const GAME_MESSAGE_TYPES = [
  'shot',
  'shot-reject',
  'damage',
  'kill',
  'spawn',
  'streak-intent',
  'streak-state',
  'match-state',
] as const;
export type GameMessageType = (typeof GAME_MESSAGE_TYPES)[number];

export type GameNetMessage =
  | ShotMsg
  | ShotRejectMsg
  | DamageMsg
  | KillMsg
  | SpawnMsg
  | StreakIntentMsg
  | StreakStateMsg
  | MatchStateMsg;

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/**
 * Twin of `protocol.ts`'s private `isFiniteNum`. Not shared: exporting that one
 * would be a change to existing code, and importing it here would make the two
 * modules circular. One line, stated rather than hidden.
 */
function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function inSet(v: unknown, list: readonly string[]): boolean {
  return typeof v === 'string' && list.includes(v);
}

/** Checked against the same frozen array the `TeamId` type is derived from. */
export function isTeamId(v: unknown): v is TeamId {
  return (TEAMS as readonly unknown[]).includes(v);
}

function isEvent(v: unknown, tag: string): v is Record<string, unknown> {
  return isObj(v) && v['type'] === tag && isNum(v['at']);
}

function isDamageEvent(v: unknown): boolean {
  return (
    isEvent(v, 'damage') &&
    typeof v['victimId'] === 'string' &&
    isNum(v['amount']) &&
    isNum(v['healthAfter']) &&
    isNum(v['sourceX']) &&
    isNum(v['sourceZ']) &&
    inSet(v['zone'], HIT_ZONES) &&
    inSet(v['cause'], DAMAGE_CAUSES)
  );
}

function isKillEvent(v: unknown): boolean {
  return (
    isEvent(v, 'kill') &&
    typeof v['killerId'] === 'string' &&
    typeof v['victimId'] === 'string' &&
    isNum(v['killerStreak']) &&
    inSet(v['zone'], HIT_ZONES) &&
    inSet(v['cause'], DAMAGE_CAUSES)
  );
}

function isDeathEvent(v: unknown): boolean {
  return (
    isEvent(v, 'death') &&
    typeof v['victimId'] === 'string' &&
    isNum(v['streakLost']) &&
    (v['respawnAt'] === null || isNum(v['respawnAt'])) &&
    inSet(v['cause'], DAMAGE_CAUSES)
  );
}

function isSpawnEvent(v: unknown): boolean {
  return (
    isEvent(v, 'spawn') &&
    typeof v['actorId'] === 'string' &&
    isNum(v['x']) &&
    isNum(v['y']) &&
    isNum(v['z']) &&
    isNum(v['yaw']) &&
    isNum(v['protectedUntil']) &&
    inSet(v['reason'], SPAWN_REASONS)
  );
}

function isStreakCause(v: unknown): boolean {
  if (v === null) return true;
  if (!isObj(v) || !isNum(v['at']) || typeof v['streakId'] !== 'string') return false;
  if (v['type'] === 'streak-denied') return inSet(v['reason'], STREAK_DENIAL_REASONS);
  if (v['type'] === 'streak-ended') return inSet(v['reason'], STREAK_END_REASONS);
  return v['type'] === 'streak-earned' || v['type'] === 'streak-activated';
}

function isStreakSlot(v: unknown): boolean {
  return (
    isObj(v) &&
    typeof v['streakId'] === 'string' &&
    Number.isSafeInteger(v['slot']) &&
    Number.isSafeInteger(v['charges'])
  );
}

function isScoreRow(v: unknown): boolean {
  return (
    isObj(v) &&
    typeof v['id'] === 'string' &&
    isTeamId(v['team']) &&
    isNum(v['kills']) &&
    isNum(v['deaths']) &&
    isNum(v['score'])
  );
}

/**
 * Structural check for every gameplay message. Called by `isNetMessage` after
 * it has matched the tag; returns false for any tag it does not own, so a typo
 * in the caller's case list fails closed rather than admitting garbage.
 */
export function isGameMessage(m: Record<string, unknown>): boolean {
  switch (m['type']) {
    case 'shot':
      return (
        Number.isSafeInteger(m['seq']) &&
        Number.isSafeInteger(m['life']) &&
        typeof m['weaponId'] === 'string' &&
        isNum(m['firedAt']) &&
        isNum(m['ox']) && isNum(m['oy']) && isNum(m['oz']) &&
        isNum(m['dx']) && isNum(m['dy']) && isNum(m['dz'])
      );
    case 'shot-reject': {
      const e = m['e'];
      return (
        isEvent(e, 'shot-rejected') &&
        typeof e['shooterId'] === 'string' &&
        Number.isSafeInteger(e['seq']) &&
        inSet(e['reason'], SHOT_REJECT_REASONS)
      );
    }
    case 'damage':
      return isDamageEvent(m['e']);
    case 'kill':
      return (m['kill'] === null || isKillEvent(m['kill'])) && isDeathEvent(m['death']);
    case 'spawn':
      return isSpawnEvent(m['e']);
    case 'streak-intent':
      return Number.isSafeInteger(m['slot']) && typeof m['toggle'] === 'boolean';
    case 'streak-state':
      return (
        isNum(m['at']) &&
        typeof m['actorId'] === 'string' &&
        isNum(m['kills']) &&
        Array.isArray(m['slots']) &&
        (m['slots'] as unknown[]).every(isStreakSlot) &&
        isStreakCause(m['cause'])
      );
    case 'match-state':
      return (
        isNum(m['at']) &&
        isMatchMode(m['mode']) &&
        inSet(m['phase'], MATCH_PHASES) &&
        (m['endsAt'] === null || isNum(m['endsAt'])) &&
        (m['scoreLimit'] === null || isNum(m['scoreLimit'])) &&
        Array.isArray(m['teamScores']) &&
        (m['teamScores'] as unknown[]).length === 2 &&
        (m['teamScores'] as unknown[]).every((v) => isNum(v)) &&
        Array.isArray(m['scores']) &&
        (m['scores'] as unknown[]).every(isScoreRow) &&
        (m['winner'] === null || m['winner'] === 'draw' || isTeamId(m['winner'])) &&
        (m['winnerId'] === null || typeof m['winnerId'] === 'string') &&
        (m['endReason'] === null || inSet(m['endReason'], MATCH_END_REASONS))
      );
    default:
      return false;
  }
}
