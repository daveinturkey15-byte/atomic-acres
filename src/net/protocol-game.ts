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

import { isPresentationMessage, type PresentationMessage } from './protocol-effects';
import { isPilotInput, type PilotInputMsg } from './protocol-pilot';
import { isWeaponMessage, type WeaponNetMessage } from './protocol-weapons';
export * from './protocol-weapons';
export * from './protocol-pilot';
export * from './protocol-effects';
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
  type CrossbowEvent,
  type DamageEvent,
  type DeathEvent,
  type KillEvent,
  type MatchEndReason,
  type MatchPhaseName,
  type OrdnanceEvent,
  type ShotFiredEvent,
  type ShotRejectedEvent,
  type SpawnEvent,
  type StreakActivatedEvent,
  type StreakDeniedEvent,
  type StreakEarnedEvent,
  type StreakEndedEvent,
  type TeamId,
} from '../game/events';
import { isCrossbowEventType } from '../game/events-crossbow';
import { isOrdnanceEventType } from '../game/events-ordnance';
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

/** Host -> all: one admitted firearm shot, including a miss. */
export interface ShotFiredMsg { type: 'shot-fired'; e: ShotFiredEvent }

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
export interface StreakIntentMsg { type: 'streak-intent'; slot: number; toggle: boolean; seq: number }

/** One slot of the host streak ledger, projected onto the wire. */
export interface StreakSlotState { streakId: string; slot: number; charges: number }

/**
 * Host -> one actor: its streak ledger (level) plus the transition that caused
 * the update (edge). Both, because an edge-only feed drops a refusal that
 * arrives during a stall, and a level-only feed can never show one at all.
 */
export interface StreakStateMsg {
  /** Identity in the host clock, unchanged by guest clock localization. */
  causeId?: string | null;
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

/**
 * Host -> all: one ordnance event (ORDNANCE LANE, additive). Grenades armed,
 * thrown and detonated, flash hits, smoke volumes born and ended, knife
 * swings, drops and pickups, inventory levels and refusals — every one
 * travels as the event object itself, for the same no-mirror reason the
 * kill and damage messages do. The guest side of a throw needs no new
 * message: a throw, a swing and a pickup reach are `ShotMsg` claims whose
 * `weaponId` is an ordnance id (`game/ordnance.ts:ORDNANCE_IDS`), admitted by
 * the same eight rules as a bullet.
 *
 * lobby lane's; until that file adds `| OrdnanceMsg` and `case 'ordnance':`
 * this message validates here and is not yet routed there. Named in the
 * ordnance lane's report.
 */
export interface OrdnanceMsg { type: 'ordnance'; e: OrdnanceEvent }

/**
 * Host -> all: one crossbow bolt event (CROSSBOW CANARY, additive). Launch
 * state plus the authoritative terminal point, as the event object itself,
 * for the same no-mirror reason the kill/damage/ordnance messages do. Guests
 * never author one; a guest claim naming the crossbow id is a `ShotMsg` the
 * host admits through the same eight rules as a bullet.
 */
export interface CrossbowMsg { type: 'crossbow'; e: CrossbowEvent }

/** Every gameplay discriminant. `protocol.ts` routes these tags to `isGameMessage`. */
export const GAME_MESSAGE_TYPES = [
  'weapon-intent', 'weapon-state',
  'shot',
  'shot-reject',
  'shot-fired',
  'damage',
  'kill',
  'spawn',
  'streak-intent',
  'pilot-input',
  'streak-state',
  'match-state',
  'ordnance',
  'crossbow',
  'radar-state', 'streak-effects', 'effect',
] as const;
export type GameMessageType = (typeof GAME_MESSAGE_TYPES)[number];
export type GameNetMessage =
  | WeaponNetMessage
  | PilotInputMsg
  | PresentationMessage
  | ShotMsg
  | ShotRejectMsg
  | ShotFiredMsg
  | DamageMsg
  | KillMsg
  | SpawnMsg
  | StreakIntentMsg
  | StreakStateMsg
  | MatchStateMsg
  | OrdnanceMsg
  | CrossbowMsg;

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
 * Host-authored ordnance event: a known discriminant, a numeric `at`, and
 * every field a scalar with no NaN in it. The per-type field lists live in
 * `game/events-ordnance.ts`; this boundary's job is the one thing a type
 * cannot do — keep a NaN or an object out of a number the HUD will render.
 */
function isOrdnanceEvent(v: unknown): boolean {
  if (!isObj(v) || !isOrdnanceEventType(v['type']) || !isNum(v['at'])) return false;
  if (v.type === 'ordnance-inventory' && (
    (v.speedMultiplier !== undefined && v.speedMultiplier !== 1 && v.speedMultiplier !== 1.25) ||
    (v.rewardWeaponId !== undefined && v.rewardWeaponId !== null && v.rewardWeaponId !== 'crimson-flamethrower') ||
    (v.rewardWeaponRemainingMs !== undefined && (!isNum(v.rewardWeaponRemainingMs) || v.rewardWeaponRemainingMs < 0 || v.rewardWeaponRemainingMs > 45000))
  )) return false;
  for (const key in v) {
    const f = v[key];
    if (f === null || typeof f === 'string' || typeof f === 'boolean') continue;
    if (typeof f === 'number' && Number.isFinite(f)) continue;
    return false;
  }
  return true;
}

/**
 * Host-authored crossbow bolt event — strict per-type shape, not a scalar sweep.
 *
 * Every bound below is justified by the actual host emitter (`game/host-crossbow.ts`):
 * - `bolt-launched` is `HostCrossbow.launch`: `at`/`expiresAt` are host monotonic
 *   ms with `expiresAt = at + lifetime * 1000` (tuning `lifetime` 2.5 s, so
 *   `expiresAt > at` always); `actorId`/`team` are the admitted owner's id and
 *   side; `boltId` is `nextBoltId++` from 1 (never 0, never fractional);
 *   `seq` is the admitted claim's exactly-once seq (a non-negative safe integer);
 *   `x/y/z` and `vx/vy/vz` are the admitted muzzle and launch velocity (finite;
 *   positions may be negative, so no sign bound there).
 * - `bolt-impact` is `strike`/`stop`: `boltId` is the launch handle; `actorId` /
 *   `team` are the owner's or null once the owner has left; `victimId` / `zone`
 *   are set together on a victim hit and null together on a wall or an expiry,
 *   and `stopped` names which — one bolt, one conclusion, at most one victim;
 *   `distance` is accumulated metres, never negative.
 *
 * Anything else — a missing field, a wrong scalar, NaN/Infinity, a bad id, team,
 * zone or stop, a victim/zone/stopped disagreement, or an unknown tag — fails closed.
 */
const BOLT_STOPS = ['victim', 'wall', 'expired'] as const;

function isBoltLaunched(v: unknown): boolean {
  if (!isObj(v) || v['type'] !== 'bolt-launched') return false;
  const at = v['at'];
  const actorId = v['actorId'];
  const team = v['team'];
  const boltId = v['boltId'];
  const seq = v['seq'];
  const x = v['x'];
  const y = v['y'];
  const z = v['z'];
  const vx = v['vx'];
  const vy = v['vy'];
  const vz = v['vz'];
  const expiresAt = v['expiresAt'];
  if (!isNum(at) || at < 0) return false;
  if (typeof actorId !== 'string' || actorId.length === 0) return false;
  if (!isTeamId(team)) return false;
  if (typeof boltId !== 'number' || !Number.isSafeInteger(boltId) || boltId < 1) return false;
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) return false;
  if (!isNum(x) || !isNum(y) || !isNum(z)) return false;
  if (!isNum(vx) || !isNum(vy) || !isNum(vz)) return false;
  if (!isNum(expiresAt) || expiresAt <= at) return false;
  return true;
}

function isBoltImpact(v: unknown): boolean {
  if (!isObj(v) || v['type'] !== 'bolt-impact') return false;
  const at = v['at'];
  const boltId = v['boltId'];
  const actorId = v['actorId'];
  const team = v['team'];
  const victimId = v['victimId'];
  const zone = v['zone'];
  const distance = v['distance'];
  const x = v['x'];
  const y = v['y'];
  const z = v['z'];
  const stopped = v['stopped'];
  if (!isNum(at) || at < 0) return false;
  if (typeof boltId !== 'number' || !Number.isSafeInteger(boltId) || boltId < 1) return false;
  if (!(actorId === null || (typeof actorId === 'string' && actorId.length > 0))) return false;
  if (!(team === null || isTeamId(team))) return false;
  if (!(victimId === null || (typeof victimId === 'string' && victimId.length > 0))) return false;
  if (!(zone === null || inSet(zone, HIT_ZONES))) return false;
  if (!isNum(distance) || distance < 0) return false;
  if (!isNum(x) || !isNum(y) || !isNum(z)) return false;
  if (!inSet(stopped, BOLT_STOPS)) return false;
  const hasVictim = victimId !== null;
  if ((zone !== null) !== hasVictim) return false;
  if ((stopped === 'victim') !== hasVictim) return false;
  return true;
}

function isCrossbowEvent(v: unknown): boolean {
  if (!isObj(v) || !isCrossbowEventType(v['type'])) return false;
  if (v['type'] === 'bolt-launched') return isBoltLaunched(v);
  if (v['type'] === 'bolt-impact') return isBoltImpact(v);
  return false;
}
/**
 * Structural check for every gameplay message. Called by `isNetMessage` after
 * it has matched the tag; returns false for any tag it does not own, so a typo
 * in the caller's case list fails closed rather than admitting garbage.
 */
export function isGameMessage(m: Record<string, unknown>): boolean {
  switch (m['type']) {
    case 'weapon-intent': case 'weapon-state':
      return isWeaponMessage(m);
    case 'radar-state': case 'streak-effects': case 'effect':
      return isPresentationMessage(m);
    case 'ordnance':
      return isOrdnanceEvent(m['e']);
    case 'crossbow':
      return isCrossbowEvent(m['e']);
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
    case 'shot-fired': {
      const e = m['e'];
      return (
        isEvent(e, 'shot-fired') &&
        typeof e['actorId'] === 'string' &&
        Number.isSafeInteger(e['life']) &&
        Number.isSafeInteger(e['seq']) &&
        typeof e['weaponId'] === 'string' &&
        isNum(e['x']) && isNum(e['y']) && isNum(e['z'])
      );
    }
    case 'damage':
      return isDamageEvent(m['e']);
    case 'kill':
      return (m['kill'] === null || isKillEvent(m['kill'])) && isDeathEvent(m['death']);
    case 'spawn':
      return isSpawnEvent(m['e']);
    case 'streak-intent':
      return Number.isSafeInteger(m['slot']) && typeof m['toggle'] === 'boolean' &&
        Number.isSafeInteger(m['seq']) && (m['seq'] as number) >= 0;
    case 'pilot-input':
      return isPilotInput(m);
    case 'streak-state':
      return (
        (m['causeId'] === undefined || m['causeId'] === null || (typeof m['causeId'] === 'string' && m['causeId'].length <= 1024)) &&
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
