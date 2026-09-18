/**
 * Nuketown 2025 — match rules and lobby limit tables.
 *
 * A LEAF: imports nothing, not even `events.ts`. Everything here is a number,
 * a table, or a predicate over them, so a test, a menu and the host can all
 * read the same values without pulling a graph in behind them.
 *
 * **The `null = unlimited` convention.** `durationMs` and `scoreLimit` are
 * `number | null` rather than a sentinel or an `unlimited: boolean`. In the old
 * project this one choice is why an explore mode with no clock and no score cap
 * needed no branch anywhere in the match machine: `rules.durationMs === null`
 * simply never reaches a comparison. Keep it.
 *
 * **Tuned numbers carry their history** (IMPORT-PLAN §5.9). Every constant
 * below names where its value came from. A number with no provenance cannot be
 * reviewed, only argued about.
 */

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

/**
 * `domination` is in the type and not in the ship list. IMPORT-PLAN §1.2:
 * ship TDM and FFA, leave the tag so adding the mode is a new case rather than
 * a type change that touches every switch in the project.
 */
export const MATCH_MODES = ['tdm', 'ffa', 'domination'] as const;
export type MatchMode = (typeof MATCH_MODES)[number];

/** Modes with a working implementation today. `domination` is declared, not shipped. */
export const SHIPPED_MATCH_MODES: readonly MatchMode[] = Object.freeze(['tdm', 'ffa'] as const);

export function isMatchMode(v: unknown): v is MatchMode {
  return typeof v === 'string' && (MATCH_MODES as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Teams
// ---------------------------------------------------------------------------

/**
 * Team slots. The TYPE lives in `events.ts` as `TeamId`; these are the names,
 * kept here because a team is a rules concept and because this file must stay
 * import-free. `TEAM_A`/`TEAM_B` infer the literals `0`/`1`, which are exactly
 * `TeamId`, so no cast is ever needed at a call site.
 */
export const TEAM_A = 0;
export const TEAM_B = 1;

/** The other team. Two teams is an assumption of TDM, stated here once. */
export function opposingTeam(team: 0 | 1): 0 | 1 {
  return team === TEAM_A ? TEAM_B : TEAM_A;
}

// ---------------------------------------------------------------------------
// Match rules
// ---------------------------------------------------------------------------

export interface MatchRules {
  readonly mode: MatchMode;
  /** Match length in ms. `null` = no clock. */
  readonly durationMs: number | null;
  /** Kills (TDM: team kills) that end the match. `null` = no cap. */
  readonly scoreLimit: number | null;
  /** Damage between team-mates lands. Off in both shipped modes. */
  readonly friendlyFire: boolean;
}

/**
 * Defaults are the values the owner actually played in the old project:
 * `MATCH_DURATION_MS = 300_000` and `MATCH_SCORE_LIMIT = 25` in its
 * `gameplay.ts`. Both are members of the lobby tables below, so the default is
 * a selectable row rather than a hidden extra value.
 */
export const DEFAULT_RULES: MatchRules = Object.freeze({
  mode: 'tdm',
  durationMs: 300_000,
  scoreLimit: 25,
  friendlyFire: false,
});

// ---------------------------------------------------------------------------
// Lobby limit tables
// ---------------------------------------------------------------------------

/**
 * Lobby kill-limit rows, ported verbatim from the old `private-match.ts`
 * (`LOBBY_KILL_LIMITS`). The leading `null` is the "no cap" row — the same
 * convention as `MatchRules.scoreLimit`, so the menu writes the value straight
 * through with no translation step.
 */
export const KILL_LIMITS: readonly (number | null)[] = Object.freeze([null, 10, 25, 50, 100]);

/** Lobby time-limit rows: 2, 5, 10 and 15 minutes (old `LOBBY_TIME_LIMITS_MS`). */
export const TIME_LIMITS_MS: readonly number[] = Object.freeze([120_000, 300_000, 600_000, 900_000]);

export function isKillLimit(v: unknown): v is number | null {
  return v === null || (typeof v === 'number' && KILL_LIMITS.includes(v));
}

export function isTimeLimitMs(v: unknown): v is number {
  return typeof v === 'number' && TIME_LIMITS_MS.includes(v);
}

/**
 * Build rules from lobby selections. The only sanctioned way to make a
 * `MatchRules` other than `DEFAULT_RULES`, so an out-of-table limit cannot
 * reach the match machine from a menu.
 */
export function rulesFor(
  mode: MatchMode,
  scoreLimit: number | null = DEFAULT_RULES.scoreLimit,
  durationMs: number | null = DEFAULT_RULES.durationMs,
  friendlyFire: boolean = DEFAULT_RULES.friendlyFire,
): MatchRules {
  return Object.freeze({
    mode,
    durationMs: durationMs === null || isTimeLimitMs(durationMs) ? durationMs : DEFAULT_RULES.durationMs,
    scoreLimit: isKillLimit(scoreLimit) ? scoreLimit : DEFAULT_RULES.scoreLimit,
    friendlyFire,
  });
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/** Countdown before a match goes active. Old `MATCH_WARMUP_MS = 3_000`. */
export const WARMUP_MS = 3_000;

/**
 * Death to respawn. Old project: `target.respawnDelayMs ?? 2_200` at every one
 * of its respawn sites — the fallback WAS the value, it just never had a name.
 */
export const RESPAWN_MS = 2_200;

/**
 * Spawn invulnerability in team modes. Old `playerSpawnProtectionMs` returned
 * `1_350`.
 *
 * FFA is 0 and that is not an oversight. BEFORE: FFA also granted per-client
 * immunity, and because it was applied client-side while health stayed
 * host-authoritative, the host became uniquely unkillable. AFTER: FFA safety
 * comes from spatial separation at selection time instead
 * (`FFA_MIN_SEPARATION_M` below). Do not restore FFA immunity without also
 * moving it host-side.
 */
export const SPAWN_PROTECT_MS = 1_350;
export const SPAWN_PROTECT_FFA_MS = 0;

export function spawnProtectMs(mode: MatchMode): number {
  return mode === 'ffa' ? SPAWN_PROTECT_FFA_MS : SPAWN_PROTECT_MS;
}

/** Minimum metres between two FFA deployments. Replaces FFA spawn immunity. */
export const FFA_MIN_SEPARATION_M = 8;

// ---------------------------------------------------------------------------
// Lobby capacity
// ---------------------------------------------------------------------------

/**
 * 4 to 6. The old project offered `ROOM_CAPACITIES = [4, 6]` with no 5; there
 * is no reason a five-player room cannot exist, so the range is contiguous.
 *
 * `net/protocol.ts:MAX_PLAYERS = 8` is the TRANSPORT ceiling and is a different
 * number: it is what the room can carry, this is what a lobby will offer.
 * `LOBBY_MAX_PLAYERS <= MAX_PLAYERS` must hold — asserted in the Wave 0 proof
 * rather than imported, because this file stays a leaf.
 */
export const LOBBY_MIN_PLAYERS = 4;
export const LOBBY_MAX_PLAYERS = 6;
export const LOBBY_CAPACITIES: readonly number[] = Object.freeze([4, 5, 6]);

export function isLobbyCapacity(v: unknown): v is number {
  return typeof v === 'number' && LOBBY_CAPACITIES.includes(v);
}
