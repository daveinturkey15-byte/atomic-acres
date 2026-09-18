/**
 * Nuketown 2025 — death to redeployment: the queue, the countdown, the
 * invulnerability window and the loadout re-grant.
 *
 * Pure. Every function returns a new `RespawnState`; nothing here reads a
 * clock, touches storage or emits an event. `game/host.ts` schedules on a
 * `DeathEvent`, drains once per tick, and turns each drained entry into a
 * `SpawnEvent` — so the ONE place a respawn time is decided is
 * `scheduleRespawn`, and `DeathEvent.respawnAt` is the same number the queue
 * holds rather than a second calculation that agrees today.
 *
 * The queue is a sorted array, not a Map. At `LOBBY_MAX_PLAYERS = 6` plus bots
 * the linear scan is free, and an array has a total order — so draining is
 * deterministic, which a Map's insertion order only accidentally is.
 */

import type { Loadout, LoadoutStore } from './loadout';
import { respawnLoadoutFor } from './loadout';
import type { ActorId, MatchPhaseName, TeamId } from './events';
import { RESPAWN_MS, spawnProtectMs, type MatchMode } from './rules';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface RespawnEntry {
  readonly actorId: ActorId;
  readonly team: TeamId | null;
  readonly diedAt: number;
  /** Host time the actor becomes eligible. `DeathEvent.respawnAt` is this number. */
  readonly dueAt: number;
  /** The life epoch that ENDED. The new life is this + 1, assigned by `health.revive`. */
  readonly life: number;
}

export interface RespawnState {
  /** Ascending by `dueAt`, then by actor id. Never mutated in place. */
  readonly queue: readonly RespawnEntry[];
}

export function createRespawnState(): RespawnState {
  return { queue: Object.freeze([]) };
}

export function isPending(s: RespawnState, actorId: ActorId): boolean {
  return s.queue.some((e) => e.actorId === actorId);
}

/** The next entry due, or null. Cheap because the queue is sorted. */
export function nextDue(s: RespawnState): RespawnEntry | null {
  return s.queue[0] ?? null;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

/**
 * Why a respawn was not queued. A bare `return` here would be the dead-key
 * failure of IMPORT-PLAN §5.4 wearing a different hat: the player sees a
 * countdown that never arrives and has nothing to report.
 *
 * These are function-local reasons, not `GameEvent` shapes — the frozen
 * vocabulary carries no respawn refusal and this lane does not add one.
 */
export type RespawnRefusal = 'already-queued' | 'match-ended';

export const RESPAWN_REFUSAL_LABELS: Readonly<Record<RespawnRefusal, string>> = Object.freeze({
  'already-queued': 'ALREADY AWAITING DEPLOYMENT',
  'match-ended': 'MATCH OVER',
});

export interface ScheduleInput {
  readonly actorId: ActorId;
  readonly team: TeamId | null;
  /** Host time of the death. The delay counts from here, not from "now". */
  readonly diedAt: number;
  /** `health.ts:ActorHealth.life` at the moment of death. */
  readonly life: number;
  readonly phase: MatchPhaseName;
  /** Override the delay. Defaults to `rules.RESPAWN_MS`. */
  readonly delayMs?: number;
}

export interface ScheduleResult {
  readonly state: RespawnState;
  /** The queued entry, or null when refused. */
  readonly entry: RespawnEntry | null;
  readonly refusal?: RespawnRefusal;
}

/**
 * Queue a respawn.
 *
 * Refused when the match has ended — a corpse at the final whistle stays a
 * corpse, and `DeathEvent.respawnAt` is null for exactly this case — and when
 * the actor is already queued, which is the double-death a late damage message
 * can otherwise produce.
 *
 * `warmup` schedules normally: a warmup death is rare but it must not strand
 * the player for the whole match.
 */
export function scheduleRespawn(s: RespawnState, input: ScheduleInput): ScheduleResult {
  if (input.phase === 'ended') return { state: s, entry: null, refusal: 'match-ended' };
  if (isPending(s, input.actorId)) return { state: s, entry: null, refusal: 'already-queued' };

  const delay = Number.isFinite(input.delayMs) ? Math.max(0, input.delayMs as number) : RESPAWN_MS;
  const entry: RespawnEntry = {
    actorId: input.actorId,
    team: input.team,
    diedAt: input.diedAt,
    dueAt: input.diedAt + delay,
    life: input.life,
  };
  const queue = [...s.queue, entry].sort(
    (l, r) => l.dueAt - r.dueAt || (l.actorId < r.actorId ? -1 : l.actorId > r.actorId ? 1 : 0),
  );
  return { state: { queue: Object.freeze(queue) }, entry };
}

/** Drop one actor: a disconnect, or a host-authorised redeploy that jumped the queue. */
export function cancelRespawn(s: RespawnState, actorId: ActorId): RespawnState {
  if (!isPending(s, actorId)) return s;
  return { queue: Object.freeze(s.queue.filter((e) => e.actorId !== actorId)) };
}

/**
 * Drop everything. Match end, or a mode change. Returned rather than mutated so
 * the host can still read the entries it is abandoning if it wants to feed them.
 */
export function clearRespawns(s: RespawnState): RespawnState {
  return s.queue.length === 0 ? s : createRespawnState();
}

export interface DueResult {
  readonly state: RespawnState;
  /** Entries whose time has come, in due order. Removed from `state`. */
  readonly due: readonly RespawnEntry[];
}

/**
 * Drain everything due at `now`.
 *
 * Returns the SAME state object when nothing is due, so the host's tick can
 * skip the rest of the respawn path by identity. Draining is level-triggered,
 * not edge-triggered: a tick that was late by a second still yields every entry
 * it slept through, in order, instead of losing all but the last.
 */
export function dueRespawns(s: RespawnState, now: number): DueResult {
  if (s.queue.length === 0 || s.queue[0]!.dueAt > now) return { state: s, due: [] };
  const due: RespawnEntry[] = [];
  const rest: RespawnEntry[] = [];
  for (const e of s.queue) {
    if (e.dueAt <= now) due.push(e);
    else rest.push(e);
  }
  return { state: { queue: Object.freeze(rest) }, due: Object.freeze(due) };
}

// ---------------------------------------------------------------------------
// Countdown
// ---------------------------------------------------------------------------

/** Milliseconds left, floored at 0. */
export function countdownMs(entry: RespawnEntry, now: number): number {
  return Math.max(0, entry.dueAt - now);
}

/**
 * The number the HUD shows. CEILED, so a 2.2 s wait reads "3, 2, 1" and never
 * flashes a 0 that the player then waits through — the old project's
 * `respawnPresentation` made the same choice for the same reason.
 */
export function countdownSeconds(entry: RespawnEntry, now: number): number {
  return Math.ceil(countdownMs(entry, now) / 1000);
}

// ---------------------------------------------------------------------------
// The new life
// ---------------------------------------------------------------------------

/**
 * End of the spawn-protection window for a spawn placed at `spawnAt`.
 *
 * FFA returns `spawnAt` — a zero-length window, deliberately. In the old
 * project FFA granted per-client immunity while health stayed host-
 * authoritative, which made the HOST uniquely unkillable. FFA safety is now
 * `FFA_MIN_SEPARATION_M` at selection time instead (`rules.ts`). Do not restore
 * an FFA window here without moving it host-side as well.
 */
export function invulnerableUntil(spawnAt: number, mode: MatchMode): number {
  return spawnAt + spawnProtectMs(mode);
}

/**
 * The weapons a new life is issued.
 *
 * Old `authoredRespawnLoadout`: it deliberately drops transient pickup and
 * swap state, so a player who died holding a streak weapon comes back with
 * their own class, equipped to the authored primary rather than to whatever
 * they last held. The rule lives in `loadout.ts`; this is the respawn path's
 * name for it, so a caller reading the respawn code sees the re-grant happen.
 */
export function respawnGrant(store: LoadoutStore): Loadout {
  return respawnLoadoutFor(store);
}
