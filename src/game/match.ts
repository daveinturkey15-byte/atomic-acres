/**
 * Nuketown 2025 — the match state machine and its two clock readouts.
 *
 * PURE. No DOM, no THREE, no scene, no host state: every function here takes
 * numbers and returns numbers or a new `MatchState`. It imports `rules.ts`
 * (a leaf) and the vocabulary types, and nothing else. That is what lets the
 * whole match lifecycle — warmup, score limit, time limit, draw, FFA
 * tie-break — be exercised in a node script with no browser, which is how the
 * proof beside this lane runs sixty seconds of match in a few milliseconds.
 *
 * Three conventions, each of which removes a branch somewhere else:
 *
 *  - **`null` = unlimited** (`rules.durationMs`, `rules.scoreLimit`). An
 *    explore mode with no clock and no cap is not a special case here; the
 *    comparison simply never happens. Kept from the old project, where this
 *    one choice is why its explore mode needed no branch in the match machine.
 *  - **`endsAt` is `+Infinity` when the clock is unlimited**, never `null` and
 *    never a sentinel like `0`. `now >= Infinity` is false, so the time check
 *    needs no guard of its own. The WIRE may not carry Infinity — it is not
 *    JSON-able — so `endsAtForWire()` below is the one place that conversion
 *    happens (`game/events.ts` README, "`MatchPhaseEvent.endsAt` may be
 *    `POSITIVE_INFINITY`; `MatchStateMsg.endsAt` may not").
 *  - **Identity is the change signal.** `advanceMatch`/`advanceFfa` return the
 *    SAME object when nothing changed, so a caller emits a `MatchPhaseEvent`
 *    on `next !== state` and never has to diff fields or keep a shadow copy of
 *    the last phase. `game/host.ts` relies on this; do not "helpfully" return
 *    a fresh object every call.
 */

import type { ActorId, MatchEndReason, MatchPhaseName, TeamId } from './events';
import { DEFAULT_RULES, WARMUP_MS, type MatchRules } from './rules';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * The whole match, in six fields. Frozen on construction: a caller that wants
 * a different match calls `advanceMatch`, it does not poke a phase in.
 *
 * `winner` and `winnerId` are not alternatives to each other, they are two
 * different questions. TDM answers the first (`0 | 1 | 'draw'`); FFA answers
 * the second and leaves `winner` null unless the top score is tied, in which
 * case it is `'draw'` with no `winnerId`. That is the old project's shape and
 * it is right: "which team won" has no answer in a free-for-all, and inventing
 * one would put a team badge on a solo scoreboard.
 */
export interface MatchState {
  readonly phase: MatchPhaseName;
  /** Host time this phase began. */
  readonly phaseStartedAt: number;
  /** Host time this phase ends; `Number.POSITIVE_INFINITY` when unlimited. */
  readonly endsAt: number;
  readonly winner: TeamId | 'draw' | null;
  /** FFA winner. null in team modes, and while undecided or drawn. */
  readonly winnerId: ActorId | null;
  readonly endReason: MatchEndReason | null;
}

/** One free-for-all row. `game/scoring.ts:leaderboard()` rows satisfy this. */
export interface FfaStanding {
  readonly id: ActorId;
  readonly kills: number;
}

/** A new match in warmup. `WARMUP_MS` (3 s) is a rules constant, not a local. */
export function createMatch(now: number, _rules: MatchRules = DEFAULT_RULES): MatchState {
  return Object.freeze({
    phase: 'warmup' as const,
    phaseStartedAt: now,
    endsAt: now + WARMUP_MS,
    winner: null,
    winnerId: null,
    endReason: null,
  });
}

/**
 * The active phase starts at the warmup's `endsAt`, NOT at `now`.
 *
 * A 20 Hz host sees `now` 0–50 ms past the boundary, and a tab that was
 * backgrounded can see it seconds past. Anchoring the match clock to the
 * scheduled boundary makes the match length exactly `rules.durationMs` instead
 * of "durationMs plus however late the tick was", so two peers that ticked at
 * different instants still agree on when the match ends.
 */
function activate(state: MatchState, rules: MatchRules): MatchState {
  const startedAt = state.endsAt;
  return Object.freeze({
    phase: 'active' as const,
    phaseStartedAt: startedAt,
    endsAt: rules.durationMs === null ? Number.POSITIVE_INFINITY : startedAt + rules.durationMs,
    winner: null,
    winnerId: null,
    endReason: null,
  });
}

function ended(
  now: number,
  winner: TeamId | 'draw' | null,
  winnerId: ActorId | null,
  endReason: MatchEndReason,
): MatchState {
  return Object.freeze({ phase: 'ended' as const, phaseStartedAt: now, endsAt: now, winner, winnerId, endReason });
}

/**
 * Team modes. `teamScores` is `[team0, team1]` and is the MATCH-DECIDING
 * number — team kills, from `game/scoring.ts:teamTotals()`. It is not the
 * points column on the scoreboard; see that file's header for why the two are
 * different numbers with different owners.
 *
 * Returns `state` itself when nothing changed.
 */
export function advanceMatch(
  state: MatchState,
  now: number,
  teamScores: readonly [number, number],
  rules: MatchRules = DEFAULT_RULES,
): MatchState {
  if (state.phase === 'warmup') return now >= state.endsAt ? activate(state, rules) : state;
  if (state.phase !== 'active') return state;

  const scoreReached =
    rules.scoreLimit !== null && (teamScores[0] >= rules.scoreLimit || teamScores[1] >= rules.scoreLimit);
  const timeReached = rules.durationMs !== null && now >= state.endsAt;
  if (!scoreReached && !timeReached) return state;

  const winner: TeamId | 'draw' = teamScores[0] === teamScores[1] ? 'draw' : teamScores[0] > teamScores[1] ? 0 : 1;
  return ended(now, winner, null, scoreReached ? 'score' : 'time');
}

/**
 * Free-for-all. `standings` may arrive in any order; the sort here is the
 * authority, so a caller cannot change the winner by changing its iteration
 * order. Ties break on kills first, then on id ascending — the same stable
 * `id` tie-break `game/scoring.ts:leaderboard()` uses, so the match machine
 * and the scoreboard can never disagree about who is on top.
 *
 * A tie at the top is a DRAW: `winner: 'draw'`, `winnerId: null`. A single
 * leader sets `winnerId` and leaves `winner` null, because no team won.
 */
export function advanceFfa(
  state: MatchState,
  now: number,
  standings: readonly FfaStanding[],
  rules: MatchRules = DEFAULT_RULES,
): MatchState {
  if (state.phase === 'warmup') return now >= state.endsAt ? activate(state, rules) : state;
  if (state.phase !== 'active') return state;

  let topKills = -1;
  let leaderId: ActorId | null = null;
  let leaders = 0;
  for (const row of standings) {
    if (row.kills > topKills) {
      topKills = row.kills;
      leaderId = row.id;
      leaders = 1;
    } else if (row.kills === topKills) {
      leaders++;
      if (leaderId === null || row.id < leaderId) leaderId = row.id;
    }
  }

  const scoreReached = rules.scoreLimit !== null && topKills >= rules.scoreLimit;
  const timeReached = rules.durationMs !== null && now >= state.endsAt;
  if (!scoreReached && !timeReached) return state;

  const decided = leaders === 1 && leaderId !== null;
  return ended(now, decided ? null : 'draw', decided ? leaderId : null, scoreReached ? 'score' : 'time');
}

// ---------------------------------------------------------------------------
// Readouts
// ---------------------------------------------------------------------------

/**
 * `mm:ss`, floored, clamped at zero. A non-finite input — an unlimited match's
 * `endsAt - now` — reads `--:--` rather than `NaN:NaN`, which is the only
 * reason this is a function and not a template literal at the call site.
 *
 * `ceil` is for the warmup counter, where "3" must stay on screen for the
 * whole of the third second instead of appearing for one frame.
 */
export function formatClock(ms: number, ceil = false): string {
  if (!Number.isFinite(ms)) return '--:--';
  const total = Math.max(0, ceil ? Math.ceil(ms / 1000) : Math.floor(ms / 1000));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm < 10 ? '0' : ''}${mm}:${ss < 10 ? '0' : ''}${ss}`;
}

/** Remaining match time in ms, clamped at 0; `Infinity` when unlimited. */
export function remainingMs(state: MatchState, now: number): number {
  return Number.isFinite(state.endsAt) ? Math.max(0, state.endsAt - now) : Number.POSITIVE_INFINITY;
}

/**
 * The respawn counter, to one decimal. Ported from the old
 * `respawnPresentation` unchanged, including the tenths: at a 2.2 s respawn a
 * whole-second readout sits on "2" for 800 ms and looks frozen.
 */
export function respawnText(endsAt: number, now: number): string {
  return `REDEPLOYING IN ${Math.max(0, (endsAt - now) / 1000).toFixed(1)}s`;
}

/**
 * The ONE place `+Infinity` becomes the wire's `null`. `MatchStateMsg.endsAt`
 * is `number | null` because `JSON.stringify(Infinity)` is `"null"` — the
 * value would arrive as a type error on a real datachannel instead of as a
 * number. Everything inside `src/game/` keeps the Infinity.
 */
export function endsAtForWire(state: MatchState): number | null {
  return Number.isFinite(state.endsAt) ? state.endsAt : null;
}
