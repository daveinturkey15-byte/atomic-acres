/**
 * Nuketown 2025 — THE ONE VOCABULARY.
 *
 * Every game event shape in the project is declared here, once. No other file
 * under `src/game/` may define an event type: four parallel lanes each
 * inventing a `KillEvent` is exactly what IMPORT-PLAN §3 exists to prevent.
 *
 * Import everything from this file. It re-exports `./vocab` — the frozen
 * enumerations, the enumerated refusals and their labels, and the `WorldQuery`
 * port — so there is one import target for the lanes even though the
 * vocabulary is two files (AGENTS.md caps a file at 400 lines; together they
 * were 454).
 *
 * The pair is a LEAF: no THREE, no `net/`, no `core/`, no DOM.
 * `net/protocol.ts` imports *this*, so the wire carries the game vocabulary
 * instead of re-listing it. The dependency edges are
 * `game/host -> net/room -> net/protocol -> game/events -> game/vocab`,
 * acyclic precisely because this end is a leaf. Do not add an import here.
 *
 * Two rules the shapes below obey (IMPORT-PLAN §5.5, §5.4):
 *
 *  - **Nothing derivable is carried.** There is no `headshot` field because
 *    `zone === 'head'` is the derivation; no `fatal` because
 *    `healthAfter <= 0` is; no `friendlyFire` because
 *    `killerTeam === victimTeam` is; no `label` on a refusal because
 *    `STREAK_DENIAL_LABELS[reason]` is. A field that agrees with a computation
 *    today is a stale mirror tomorrow.
 *  - **Every refusal is enumerated and labelled.** A player-initiated action
 *    that fails emits an event carrying a reason from a frozen list, and that
 *    list has a user-facing label beside it. No bare `return`.
 */

export * from './vocab';

import type {
  ActorId,
  DamageCause,
  FeedDestination,
  FeedTone,
  HitZone,
  MatchEndReason,
  MatchPhaseName,
  ShotRejectReason,
  SpawnReason,
  StreakDenialReason,
  StreakEndReason,
  TeamId,
} from './vocab';

// ---------------------------------------------------------------------------
// The event union
// ---------------------------------------------------------------------------
//
// `at` on every event is host monotonic milliseconds. Guests stamp nothing.

/** A landed hit, already admitted and applied by the host. */
export interface DamageEvent {
  readonly type: 'damage';
  readonly at: number;
  /** null for world damage (a fall, an unowned explosion). */
  readonly attackerId: ActorId | null;
  readonly attackerTeam: TeamId | null;
  readonly victimId: ActorId;
  readonly victimTeam: TeamId;
  /** Admitted amount, already floored at 1 for a landed hit. */
  readonly amount: number;
  readonly cause: DamageCause;
  readonly zone: HitZone;
  /** `weapons/catalog.ts` id; empty string for fall and streak damage. */
  readonly weaponId: string;
  readonly distance: number;
  /** Victim health after. Fatal is `healthAfter <= 0`; it is not a field. */
  readonly healthAfter: number;
  /** World source of the hit, for the HUD damage arc (`HudApi.damageFrom`). */
  readonly sourceX: number;
  readonly sourceZ: number;
}

/**
 * A death CREDITED to a killer. Team kills emit this too (same team on both
 * sides) so scoring can subtract; suicides and world deaths emit only
 * `DeathEvent`. Every kill is accompanied by exactly one death — count kills
 * from here and deaths from there, never both from one, or the old project's
 * eight-site score merge is back.
 */
export interface KillEvent {
  readonly type: 'kill';
  readonly at: number;
  readonly killerId: ActorId;
  readonly killerTeam: TeamId;
  readonly victimId: ActorId;
  readonly victimTeam: TeamId;
  readonly weaponId: string;
  readonly zone: HitZone;
  readonly cause: DamageCause;
  readonly distance: number;
  /** Killer's consecutive kills this life, after this one. */
  readonly killerStreak: number;
}

/** Every death, credited or not. */
export interface DeathEvent {
  readonly type: 'death';
  readonly at: number;
  readonly victimId: ActorId;
  readonly victimTeam: TeamId;
  readonly killerId: ActorId | null;
  readonly cause: DamageCause;
  /** Consecutive kills the victim was on. The "ended a streak" feed line. */
  readonly streakLost: number;
  /** Host time the respawn is due; null when nothing is scheduled (match over). */
  readonly respawnAt: number | null;
}

/** An actor placed in the world. */
export interface SpawnEvent {
  readonly type: 'spawn';
  readonly at: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  /** Index into `game/spawns.ts:SPAWN_POINTS`, for recent-use avoidance. */
  readonly spawnIndex: number;
  /** End of the spawn-protection window; equals `at` when protection is off. */
  readonly protectedUntil: number;
  readonly reason: SpawnReason;
}

/** A shot claim the host refused. The shooter's client shows the label. */
export interface ShotRejectedEvent {
  readonly type: 'shot-rejected';
  readonly at: number;
  readonly shooterId: ActorId;
  readonly seq: number;
  readonly reason: ShotRejectReason;
}

/** A streak charge banked. `charges` is the total held for that streak after. */
export interface StreakEarnedEvent {
  readonly type: 'streak-earned';
  readonly at: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly slot: number;
  readonly charges: number;
}

/** A charge spent and an entity brought into the world. */
export interface StreakActivatedEvent {
  readonly type: 'streak-activated';
  readonly at: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly slot: number;
  readonly chargesLeft: number;
  /** Host-assigned handle for the live entity; addresses it in later events. */
  readonly instanceId: number;
}

/** A refused activation. Label is `STREAK_DENIAL_LABELS[reason]`, not a field. */
export interface StreakDeniedEvent {
  readonly type: 'streak-denied';
  readonly at: number;
  readonly actorId: ActorId;
  readonly streakId: string;
  readonly slot: number;
  readonly reason: StreakDenialReason;
  /**
   * Set only when the refusal came from WORLD STATE rather than the gate: the
   * `StreakClaimReject` id (`no-placement`, `instance-cap`) that actually
   * fired, mapped onto `reason` by
   * `killstreaks/gate.ts:REJECT_AS_DENIAL`. Not a stale mirror of `reason` —
   * it is strictly more than `reason` can say, because the frozen nine have no
   * word for "you cannot put it there", and without it a log line would report
   * a map that does not support the streak when the map supports it fine.
   * Typed as a plain string so this file stays the leaf it says it is.
   */
  readonly detail?: string;
}

/** A live streak entity left the world. */
export interface StreakEndedEvent {
  readonly type: 'streak-ended';
  readonly at: number;
  readonly actorId: ActorId;
  readonly streakId: string;
  readonly instanceId: number;
  readonly reason: StreakEndReason;
}

/** A match phase transition. Emitted on change only, never per tick. */
export interface MatchPhaseEvent {
  readonly type: 'match-phase';
  readonly at: number;
  readonly phase: MatchPhaseName;
  /** End of this phase; `Number.POSITIVE_INFINITY` when unlimited. */
  readonly endsAt: number;
  readonly winner: TeamId | 'draw' | null;
  /** FFA winner; null in team modes and while undecided. */
  readonly winnerId: ActorId | null;
  readonly endReason: MatchEndReason | null;
}

/** A ready-to-render feed row. Produced by `game/feed.ts`, never by the HUD. */
export interface FeedLineEvent {
  readonly type: 'feed';
  readonly at: number;
  readonly text: string;
  readonly dest: FeedDestination;
  readonly tone: FeedTone;
}

export type GameEvent =
  | DamageEvent
  | KillEvent
  | DeathEvent
  | SpawnEvent
  | ShotRejectedEvent
  | StreakEarnedEvent
  | StreakActivatedEvent
  | StreakDeniedEvent
  | StreakEndedEvent
  | MatchPhaseEvent
  | FeedLineEvent;

/** Every discriminant, frozen. This IS the list; nothing derives it. */
export const GAME_EVENT_TYPES = [
  'damage',
  'kill',
  'death',
  'spawn',
  'shot-rejected',
  'streak-earned',
  'streak-activated',
  'streak-denied',
  'streak-ended',
  'match-phase',
  'feed',
] as const;
export type GameEventType = (typeof GAME_EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// The bus
// ---------------------------------------------------------------------------

export type GameListener = (e: GameEvent) => void;

/**
 * Typed fan-out with no per-emit allocation beyond the event object itself:
 * no copy of the listener array, no closure, no iterator, no spread.
 *
 * Removal during a dispatch is the case that bites. `off` inside a handler
 * tombstones the slot instead of splicing, so the in-flight index walk cannot
 * skip the listener that follows, and the array is compacted once the
 * outermost `emit` unwinds. Re-entrant `emit` is allowed and counted.
 */
export class GameBus {
  private readonly listeners: (GameListener | null)[] = [];
  private depth = 0;
  private holes = false;

  /** Register once. A listener added twice is called twice — that is your bug. */
  on(fn: GameListener): void {
    this.listeners.push(fn);
  }

  /** Safe from inside a handler, including on itself. */
  off(fn: GameListener): void {
    const ls = this.listeners;
    for (let i = 0; i < ls.length; i++) {
      if (ls[i] === fn) {
        ls[i] = null;
        this.holes = true;
        return;
      }
    }
  }

  /** Drop every listener. Match teardown; safe from inside a handler. */
  clear(): void {
    const ls = this.listeners;
    for (let i = 0; i < ls.length; i++) ls[i] = null;
    this.holes = true;
    if (this.depth === 0) this.compact();
  }

  /** Listeners currently registered; tombstones excluded. */
  get size(): number {
    const ls = this.listeners;
    let n = 0;
    for (let i = 0; i < ls.length; i++) if (ls[i] !== null) n++;
    return n;
  }

  emit(e: GameEvent): void {
    const ls = this.listeners;
    this.depth++;
    for (let i = 0; i < ls.length; i++) {
      const fn = ls[i];
      if (fn !== null) fn(e);
    }
    this.depth--;
    if (this.depth === 0 && this.holes) this.compact();
  }

  private compact(): void {
    const ls = this.listeners;
    let w = 0;
    for (let i = 0; i < ls.length; i++) {
      const fn = ls[i];
      if (fn !== null) ls[w++] = fn;
    }
    ls.length = w;
    this.holes = false;
  }
}
