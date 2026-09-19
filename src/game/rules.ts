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
  /**
   * Death-to-respawn delay for this match, one of `RESPAWN_DELAYS_MS`. Optional
   * and absent means `RESPAWN_MS`, so every existing construction still type-
   * checks. CONSUMER NOTE (lobby lane, 2026-09-19): `host-life.ts:kill()` calls
   * `scheduleRespawn` without a `delayMs`, so today this field is carried by
   * the rules and shown in the menu but the host still uses `RESPAWN_MS`; the
   * one-line pass-through is requested in that lane's report rather than
   * edited here, because `host-life.ts` is not this lane's file.
   */
  readonly respawnMs?: number;
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
  respawnMs: number = RESPAWN_MS,
): MatchRules {
  return Object.freeze({
    mode,
    durationMs: durationMs === null || isTimeLimitMs(durationMs) ? durationMs : DEFAULT_RULES.durationMs,
    scoreLimit: isKillLimit(scoreLimit) ? scoreLimit : DEFAULT_RULES.scoreLimit,
    friendlyFire,
    respawnMs: isRespawnDelayMs(respawnMs) ? respawnMs : RESPAWN_MS,
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

// ---------------------------------------------------------------------------
// Solo-vs-bots setup: the pre-match panel's tables (lobby lane, 2026-09-19)
// ---------------------------------------------------------------------------

/**
 * Respawn rows the pre-match panel offers. `RESPAWN_MS` (2.2 s) is the old
 * project's one value and sits in the table so the default is a selectable
 * row. 1 s is "arcade", 5 s is the longest that does not read as a penalty box
 * on a map you cross in twelve seconds.
 */
export const RESPAWN_DELAYS_MS: readonly number[] = Object.freeze([1_000, 2_200, 3_500, 5_000]);

export function isRespawnDelayMs(v: unknown): v is number {
  return typeof v === 'number' && RESPAWN_DELAYS_MS.includes(v);
}

/**
 * Bot count offered for a solo match, in bots (the human is extra). The
 * ceiling is `net/protocol.ts:MAX_PLAYERS - 1` — spelled here as a number
 * because this file is a leaf; `session.ts` clamps against the real constant
 * as well, so the two cannot silently disagree in the dangerous direction.
 */
export const SOLO_MIN_BOTS = 1;
export const SOLO_MAX_BOTS = 7;

export function isSoloBotCount(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= SOLO_MIN_BOTS && v <= SOLO_MAX_BOTS;
}

/**
 * Bot difficulty presets. `regular` IS the play-tested pair from the old
 * `bot-ai.ts` (`REACTION_DELAY_MS = 650`, `BOT_FIRE_RANGE_M = 22`) with the
 * perfect aim bots have had since the gameplay wave — choosing it changes
 * nothing about today's match. The other two move each number the way the
 * name says: recruit reacts slower, shoots shorter and misses more; veteran
 * the opposite. `aimErrorRad` is the half-angle of a uniform cone applied per
 * shot in `bots.ts:shoot()`: 0.06 rad at 22 m is ±1.3 m against a 0.35 m
 * capsule, roughly one hit in four; 0.008 rad is ±0.18 m, nearly every one.
 */
export const BOT_DIFFICULTIES = ['recruit', 'regular', 'veteran'] as const;
export type BotDifficulty = (typeof BOT_DIFFICULTIES)[number];

export interface BotDifficultyPreset {
  readonly id: BotDifficulty;
  readonly label: string;
  readonly reactionMs: number;
  readonly fireRangeM: number;
  readonly aimErrorRad: number;
}

export const BOT_DIFFICULTY_PRESETS: Readonly<Record<BotDifficulty, BotDifficultyPreset>> = Object.freeze({
  recruit: Object.freeze({ id: 'recruit', label: 'Recruit', reactionMs: 1_100, fireRangeM: 16, aimErrorRad: 0.06 }),
  regular: Object.freeze({ id: 'regular', label: 'Regular', reactionMs: 650, fireRangeM: 22, aimErrorRad: 0 }),
  veteran: Object.freeze({ id: 'veteran', label: 'Veteran', reactionMs: 400, fireRangeM: 30, aimErrorRad: 0.008 }),
});

export function isBotDifficulty(v: unknown): v is BotDifficulty {
  return typeof v === 'string' && (BOT_DIFFICULTIES as readonly string[]).includes(v);
}

/**
 * How bots are dealt onto teams in TDM. `balanced` is the old project's
 * auto-balance (the human counts as one seat, bots fill the smaller side);
 * `enemies` puts every bot on the other team — "me against the machine".
 * Ignored in FFA, where everyone is everyone's enemy.
 */
export const BOT_TEAM_LAYOUTS = ['balanced', 'enemies'] as const;
export type BotTeamLayout = (typeof BOT_TEAM_LAYOUTS)[number];

export function isBotTeamLayout(v: unknown): v is BotTeamLayout {
  return typeof v === 'string' && (BOT_TEAM_LAYOUTS as readonly string[]).includes(v);
}

/** Everything the pre-match panel chooses. Every field comes from a table above. */
export interface SoloSetup {
  readonly mode: MatchMode;
  readonly bots: number;
  readonly difficulty: BotDifficulty;
  readonly scoreLimit: number | null;
  readonly durationMs: number;
  readonly friendlyFire: boolean;
  readonly respawnMs: number;
  readonly teams: BotTeamLayout;
}

/**
 * The one-click default: what `#start` launches and what every harness
 * measures. Five bots and a 10-kill TDM are the values the gameplay wave
 * shipped and proved (`session.ts:DEFAULT_BOTS`, `LOCAL_SCORE_LIMIT`), kept so
 * "press play" is bit-for-bit the match the verifiers already know.
 */
export const DEFAULT_SOLO_SETUP: SoloSetup = Object.freeze({
  mode: 'tdm',
  bots: 5,
  difficulty: 'regular',
  scoreLimit: KILL_LIMITS[1],
  durationMs: DEFAULT_RULES.durationMs as number,
  friendlyFire: false,
  respawnMs: RESPAWN_MS,
  teams: 'balanced',
});

/**
 * Sanitise an untrusted setup (storage, a URL, a guest) against the tables.
 * Field by field: an out-of-table value falls back to the default for THAT
 * field, never the whole object, so one bad row in storage does not silently
 * reset every other choice the player made.
 */
export function sanitizeSoloSetup(raw: unknown): SoloSetup {
  const d = DEFAULT_SOLO_SETUP;
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const mode = r['mode'];
  return Object.freeze({
    mode: isMatchMode(mode) && SHIPPED_MATCH_MODES.includes(mode) ? mode : d.mode,
    bots: isSoloBotCount(r['bots']) ? r['bots'] : d.bots,
    difficulty: isBotDifficulty(r['difficulty']) ? r['difficulty'] : d.difficulty,
    scoreLimit: isKillLimit(r['scoreLimit']) ? r['scoreLimit'] : d.scoreLimit,
    durationMs: isTimeLimitMs(r['durationMs']) ? r['durationMs'] : d.durationMs,
    friendlyFire: typeof r['friendlyFire'] === 'boolean' ? r['friendlyFire'] : d.friendlyFire,
    respawnMs: isRespawnDelayMs(r['respawnMs']) ? r['respawnMs'] : d.respawnMs,
    teams: isBotTeamLayout(r['teams']) ? r['teams'] : d.teams,
  });
}

/** The `MatchRules` a setup asks for. The only bridge from the panel to the host. */
export function rulesForSetup(s: SoloSetup): MatchRules {
  return rulesFor(s.mode, s.scoreLimit, s.durationMs, s.friendlyFire, s.respawnMs);
}

// ---------------------------------------------------------------------------
// Multiplayer lobby rules, ported from the old `private-match.ts` (lobby lane)
// ---------------------------------------------------------------------------

/**
 * How long a disconnected seat is held for the same player to come back. Old
 * `REJOIN_GRACE_MS = 90_000`, unchanged. Inside the window the seat is a
 * reservation: it keeps its id, score and team, counts against capacity and
 * holds the start fence; past it the seat is released.
 */
export const REJOIN_GRACE_MS = 90_000;

/**
 * Why a host may not start yet. Every refusal the lobby can give has a reason
 * here and a label beside it (IMPORT-PLAN §5.4) — the old `canHostStart` was a
 * boolean and the button just stayed grey.
 */
export const LOBBY_START_REFUSALS = ['not-in-lobby', 'too-few', 'not-ready', 'over-capacity', 'reservation-held'] as const;
export type LobbyStartRefusal = (typeof LOBBY_START_REFUSALS)[number];

export const LOBBY_START_LABELS: Readonly<Record<LobbyStartRefusal, string>> = Object.freeze({
  'not-in-lobby': 'MATCH ALREADY RUNNING',
  'too-few': 'NEED ONE MORE PLAYER',
  'not-ready': 'WAITING FOR READY',
  'over-capacity': 'TOO MANY FOR THIS ROOM',
  'reservation-held': 'A PLAYER IS REJOINING',
});

/** One seat as the start rule sees it. A projection of the roster, not a copy. */
export interface LobbySeatView {
  readonly connected: boolean;
  readonly ready: boolean;
}

/**
 * Old `canHostStart`, with the reason it said no. Precedence is the order a
 * host can act on: phase, then head-count, then capacity, then reservations,
 * then readiness — so the label names the thing to fix next, not the first
 * predicate that happened to be false.
 */
export function lobbyStartRefusal(
  seats: readonly LobbySeatView[],
  inLobby: boolean,
  capacity: number,
): LobbyStartRefusal | null {
  if (!inLobby) return 'not-in-lobby';
  const connected = seats.filter((s) => s.connected);
  if (connected.length < 2) return 'too-few';
  if (connected.length > capacity) return 'over-capacity';
  if (seats.some((s) => !s.connected)) return 'reservation-held';
  if (!connected.every((s) => s.ready)) return 'not-ready';
  return null;
}

/**
 * Deterministic team assignment: the host first, then stable id order,
 * alternate fill onto the smaller side. Old `balanceLobbyTeams`, minus the
 * squad-colour stamping. Returns id → team so the caller applies it however
 * its roster is shaped; the order of `ids` is the order seats were admitted.
 */
export function balanceTeams(hostId: string, ids: readonly string[]): Map<string, 0 | 1> {
  const sorted = ids.slice().sort((a, b) => Number(b === hostId) - Number(a === hostId) || a.localeCompare(b));
  const out = new Map<string, 0 | 1>();
  let a = 0;
  let b = 0;
  for (const id of sorted) {
    const team: 0 | 1 = a <= b ? TEAM_A : TEAM_B;
    out.set(id, team);
    if (team === TEAM_A) a++;
    else b++;
  }
  return out;
}
