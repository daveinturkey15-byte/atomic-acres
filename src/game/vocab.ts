/**
 * Nuketown 2025 — vocabulary primitives: the frozen enumerations, the
 * enumerated refusals and their labels, and the one injected port.
 *
 * This is the leaf half of `events.ts`, which re-exports all of it. Import
 * from `events.ts`; this file exists because the vocabulary plus the event
 * union plus the bus came to 454 lines and AGENTS.md caps a file at 400.
 * Nothing here imports anything.
 *
 * Enumerations are authored as frozen runtime arrays with the union types
 * *derived* from them, so `net/protocol.ts:isNetMessage` validates a wire value
 * against the same list the type came from instead of re-spelling it
 * (IMPORT-PLAN §5.5: a roster written out by hand in a second file is a defect
 * even while it agrees).
 */

// ---------------------------------------------------------------------------
// Identity and geometry primitives
// ---------------------------------------------------------------------------

/** Stable per-connection actor id. Players, guests and bots share the space. */
export type ActorId = string;

/**
 * Structural 3-vector. Declared here rather than imported from THREE so this
 * file stays a leaf; `THREE.Vector3` is structurally assignable to it, so a
 * caller may pass one straight in.
 */
export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// ---------------------------------------------------------------------------
// Frozen enumerations — authored once, types derived
// ---------------------------------------------------------------------------

/** Team slots. `rules.ts` names them `TEAM_A`/`TEAM_B`; this is their type. */
export const TEAMS = [0, 1] as const;
export type TeamId = (typeof TEAMS)[number];

/** Hit zones. `limb` exists so a damage table can down-weight it later. */
export const HIT_ZONES = ['head', 'body', 'limb'] as const;
export type HitZone = (typeof HIT_ZONES)[number];

/** What did the damage. `streak` covers every killstreak-owned source. */
export const DAMAGE_CAUSES = ['bullet', 'explosion', 'melee', 'fall', 'streak'] as const;
export type DamageCause = (typeof DAMAGE_CAUSES)[number];

/** Match phases. `match.ts` owns the state; this is the name of the phase. */
export const MATCH_PHASES = ['warmup', 'active', 'ended'] as const;
export type MatchPhaseName = (typeof MATCH_PHASES)[number];

/** Why a match ended. `null` on the event while it has not. */
export const MATCH_END_REASONS = ['score', 'time'] as const;
export type MatchEndReason = (typeof MATCH_END_REASONS)[number];

/** First deployment vs a death-driven respawn. */
export const SPAWN_REASONS = ['initial', 'respawn'] as const;
export type SpawnReason = (typeof SPAWN_REASONS)[number];

/** How a live streak entity left the world. */
export const STREAK_END_REASONS = ['expired', 'destroyed', 'match-end'] as const;
export type StreakEndReason = (typeof STREAK_END_REASONS)[number];

/**
 * Feed routing, taken whole from the old project's `hud-feed.ts` (17 lines,
 * the one module IMPORT-PLAN §1.4 calls "exactly right").
 */
export const FEED_DESTINATIONS = ['events', 'damage-done', 'damage-taken'] as const;
export type FeedDestination = (typeof FEED_DESTINATIONS)[number];

/**
 * Whose event a feed line is about. The old awareness module's test pinned
 * "names the killstreak and tells own, friendly and enemy apart"; that is why
 * this is a field on the event rather than a colour chosen at render time.
 */
export const FEED_TONES = ['neutral', 'own', 'friendly', 'enemy'] as const;
export type FeedTone = (typeof FEED_TONES)[number];

// ---------------------------------------------------------------------------
// Enumerated refusals (IMPORT-PLAN §5.4)
// ---------------------------------------------------------------------------

/**
 * Killstreak activation denials, in the old gate's precedence order. Every one
 * of these was an inlined bare `return` in the old 37k-line main file, so a
 * blocked key-3 press produced zero feedback and shipped that way for weeks
 * (owner report 2026-08-30: "cant enter them to control them").
 *
 * `game/killstreaks/gate.ts` evaluates them; it does not re-declare them.
 */
export const STREAK_DENIAL_REASONS = [
  'dead',
  'match-inactive',
  'input-disabled',
  'menu-open',
  'targeting-open',
  'arena-unsupported',
  'possession-active',
  'no-authority-snapshot',
  'not-earned',
] as const;
export type StreakDenialReason = (typeof STREAK_DENIAL_REASONS)[number];

/**
 * Short uppercase feed strings. A denial event carries only the reason; the
 * label is looked up here, so a reason can never ship without one and the two
 * can never disagree.
 */
export const STREAK_DENIAL_LABELS: Readonly<Record<StreakDenialReason, string>> = Object.freeze({
  'dead': 'UNAVAILABLE WHILE DOWN',
  'match-inactive': 'MATCH NOT ACTIVE',
  'input-disabled': 'INPUT LOCKED',
  'menu-open': 'MENU OPEN',
  'targeting-open': 'TARGETING ALREADY OPEN',
  'arena-unsupported': 'SUPPORT OFFLINE IN THIS ARENA',
  'possession-active': 'EXIT SUPPORT CONTROL FIRST',
  'no-authority-snapshot': 'AWAITING HOST SYNC',
  'not-earned': 'NOT EARNED YET',
});

/**
 * Host shot-admission refusals. Compressed from the old project's 22-value
 * union to the ten that name a rule its tests actually pinned — exactly-once
 * window, bounded reorder tolerance, the 250 ms fire-age ceiling, the pre-death
 * trade allowed / post-death bullet rejected split, life-and-connection epoch
 * isolation, and the predicted muzzle validated against the shooter pose at
 * fire time.
 */
export const SHOT_REJECT_REASONS = [
  'malformed',
  'unknown-shooter',
  'match-inactive',
  'shooter-dead',
  'life-epoch',
  'duplicate',
  'stale',
  'future',
  'bad-origin',
  'empty-magazine',
] as const;
export type ShotRejectReason = (typeof SHOT_REJECT_REASONS)[number];

export const SHOT_REJECT_LABELS: Readonly<Record<ShotRejectReason, string>> = Object.freeze({
  'malformed': 'BAD SHOT CLAIM',
  'unknown-shooter': 'NOT IN MATCH',
  'match-inactive': 'MATCH NOT ACTIVE',
  'shooter-dead': 'FIRED AFTER DEATH',
  'life-epoch': 'STALE LIFE',
  'duplicate': 'DUPLICATE SHOT',
  'stale': 'SHOT TOO OLD',
  'future': 'SHOT AHEAD OF CLOCK',
  'bad-origin': 'MUZZLE MISMATCH',
  'empty-magazine': 'MAGAZINE EMPTY',
});

// ---------------------------------------------------------------------------
// The WorldQuery port
// ---------------------------------------------------------------------------

/**
 * The ONE injection `src/game/` accepts (IMPORT-PLAN §2, §5.3). `main.ts`
 * builds it from the collider set; everything else in `src/game/` sees the
 * world only through these three methods, which is what keeps the directory
 * scene-free and testable without a browser.
 *
 * It is three methods on purpose. The old project's equivalents were bags of
 * 12–16 fields, 11–12 of them callbacks back into the caller — "not modules;
 * `legacy-main` with the body moved and the coupling made explicit". If a
 * proposed port grows a fourth callback, the split is in the wrong place.
 *
 * Implementations must be free of game state and cheap enough to call per
 * actor per tick.
 */
export interface WorldQuery {
  /** True when nothing solid sits between the two points. Colliders only — never characters. */
  lineOfSight(from: Vec3, to: Vec3): boolean;
  /** Walkable surface height at a column, in metres. */
  groundY(x: number, z: number): number;
  /** Inside the playable arena footprint. */
  inBounds(x: number, z: number): boolean;
}
