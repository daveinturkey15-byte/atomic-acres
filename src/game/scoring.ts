/**
 * Nuketown 2025 — THE definition of a score. There is no other.
 *
 * In the old project `authoritativeScores` was merged or copied at eight
 * distinct sites in one 37,000-line file, and also lived in the lobby snapshot
 * and in the host checkpoint. Its test had to assert that *replicas do not
 * mutate replica scores* — an assertion nobody writes until that has already
 * happened. This file exists so that sentence has exactly one place to be true
 * (IMPORT-PLAN §5.6, one number one owner).
 *
 * PURE REDUCER. Every function takes a `Ledger` and returns a new `Ledger`;
 * nothing here mutates its input, so a caller physically cannot write a score
 * it was only shown. `Ledger` is a `ReadonlyMap` and the entries are frozen.
 *
 * ## Two different numbers, on purpose
 *
 * `teamTotals()` returns TEAM KILLS. That is the match-deciding number, the
 * one `game/match.ts:advanceMatch` compares against `rules.scoreLimit` (25 by
 * default, and 25 is a kill count, not a point count).
 *
 * `ScoreEntry.score` is the POINTS column on the scoreboard — 100 a kill, a
 * headshot bonus, a team-kill penalty. It decides nothing. Conflating the two
 * is how a scoreboard ends up ending matches early.
 *
 * ## Why there is no `applyEvent(ledger, event)`
 *
 * It was written and then deleted. A guest folding host events into its own
 * ledger is a second writer, which is the exact defect §5.6 names: guests take
 * `MatchStateMsg.scores`, the host's level feed, and render it. `game/client.ts`
 * must be structurally unable to compute a score, so this file gives it no
 * function that could.
 */

import type { ActorId, HitZone, TeamId } from './events';
import type { ScoreRow } from '../net/protocol';
import { TEAM_A, TEAM_B } from './rules';

// ---------------------------------------------------------------------------
// Points table
// ---------------------------------------------------------------------------
//
// Tuned numbers carry their history (IMPORT-PLAN §5.9). These four are NEW
// here — the old project never had a points column, it showed raw kills — so
// there is no before-value to name. What each one does have is the source it
// came from, which is the next-best reviewable thing.

/** BO2 awards 100 points for an enemy kill in TDM and FFA. No before-value: new here. */
export const KILL_SCORE = 100;

/**
 * Headshot bonus. BO2 itself awards no extra POINTS for a headshot (it awards
 * a medal), so this is ours and it is deliberately small: large enough to read
 * on the scoreboard, small enough that it cannot reorder a leaderboard that
 * kills alone would order differently. No before-value: new here.
 */
export const HEADSHOT_BONUS = 25;

/**
 * A team kill costs the killer what an enemy kill would have paid, so the
 * scoreboard's arithmetic is visible: one team kill undoes one kill. It does
 * NOT credit `kills`, so it also cannot move `teamTotals()` and cannot end a
 * match. No before-value: new here.
 */
export const TEAM_KILL_PENALTY = 100;

/**
 * Suicides and world deaths cost nothing. Stated as a named zero rather than
 * omitted, so "we chose not to penalise falling" is reviewable instead of
 * being an absence nobody can see. Change this, not an `if`.
 */
export const SUICIDE_PENALTY = 0;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface ScoreEntry {
  readonly id: ActorId;
  readonly team: TeamId;
  /** Enemy kills. A team kill is not a kill; see `TEAM_KILL_PENALTY`. */
  readonly kills: number;
  readonly deaths: number;
  /** The points column. Decides nothing; see the header. */
  readonly score: number;
  /**
   * Consecutive kills since this actor last died — the killstreak ladder
   * position, and the ONE owner of that count. `KillEvent.killerStreak` and
   * `DeathEvent.streakLost` are both stamped from here by `game/host.ts`, and
   * `game/killstreaks/runtime.ts` is handed this number rather than keeping
   * its own, so a streak reward and the kill feed can never disagree.
   */
  readonly streak: number;
}

/** The ledger. A map, not a class: there is nothing to encapsulate. */
export type Ledger = ReadonlyMap<ActorId, ScoreEntry>;

export interface LedgerActor {
  readonly id: ActorId;
  readonly team: TeamId;
}

/**
 * A credited kill. It carries no `killerStreak`: the ledger COMPUTES the
 * streak and the host reads it back with `streakOf()` to stamp the event, so
 * the increment has one implementation. It also carries no `weaponId` — the
 * plan's sketch had one, nothing in a score depends on it, and a parameter
 * nobody reads is a mirror waiting to disagree (§5.5).
 */
export interface KillInput {
  readonly killer: ActorId;
  readonly victim: ActorId;
  readonly zone: HitZone;
  /**
   * The host's hostility verdict, NOT a team comparison — which is why it is
   * a parameter and not derived from the two rows here. `TeamId` is `0 | 1`,
   * so a six-player free-for-all necessarily puts several actors on the same
   * team id while every one of them is an enemy of every other. Only
   * `game/host.ts` knows the mode, so only it can answer this
   * (`GameHost.areHostile`). In TDM it is `killerTeam === victimTeam`; in FFA
   * it is always false.
   */
  readonly friendly: boolean;
}

export interface DeathInput {
  readonly victim: ActorId;
  /** null for a suicide, a fall, or an unowned explosion. */
  readonly killer: ActorId | null;
}

function entry(id: ActorId, team: TeamId): ScoreEntry {
  return Object.freeze({ id, team, kills: 0, deaths: 0, score: 0, streak: 0 });
}

function next(ledger: Ledger, updates: readonly ScoreEntry[]): Ledger {
  const out = new Map(ledger);
  for (const e of updates) out.set(e.id, Object.freeze(e));
  return out;
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

/** A zeroed ledger. Insertion order is the caller's; ordering is `leaderboard`'s job. */
export function createLedger(actors: readonly LedgerActor[]): Ledger {
  const out = new Map<ActorId, ScoreEntry>();
  for (const a of actors) out.set(a.id, entry(a.id, a.team));
  return out;
}

/**
 * Add an actor mid-match, or move one between teams. An EXISTING actor keeps
 * its kills, deaths, score and streak: a mid-match team switch must not wipe a
 * scoreboard row, and a reconnect under the same id must not either.
 */
export function withActor(ledger: Ledger, id: ActorId, team: TeamId): Ledger {
  const prev = ledger.get(id);
  if (prev && prev.team === team) return ledger;
  return next(ledger, [prev ? { ...prev, team } : entry(id, team)]);
}

/** Drop a row entirely. Used on disconnect when the match is not keeping the seat. */
export function withoutActor(ledger: Ledger, id: ActorId): Ledger {
  if (!ledger.has(id)) return ledger;
  const out = new Map(ledger);
  out.delete(id);
  return out;
}

// ---------------------------------------------------------------------------
// Reducers
// ---------------------------------------------------------------------------

/**
 * Credit a kill. A friendly kill takes the penalty path: no `kills`, no streak
 * advance, `-TEAM_KILL_PENALTY` points — so it can never move `teamTotals()`
 * and can never end a match. `k.friendly` is the host's verdict; see
 * `KillInput`.
 *
 * Unknown ids are ignored rather than created: an actor that is not in the
 * ledger is not in the match, and inventing a row here would hide that.
 */
export function applyKill(ledger: Ledger, k: KillInput): Ledger {
  const killer = ledger.get(k.killer);
  if (!killer) return ledger;

  if (k.friendly) {
    return next(ledger, [{ ...killer, score: killer.score - TEAM_KILL_PENALTY, streak: 0 }]);
  }
  const bonus = k.zone === 'head' ? HEADSHOT_BONUS : 0;
  return next(ledger, [
    {
      ...killer,
      kills: killer.kills + 1,
      score: killer.score + KILL_SCORE + bonus,
      streak: killer.streak + 1,
    },
  ]);
}

/**
 * Record a death. ALWAYS called, credited or not — `KillEvent` and
 * `DeathEvent` are separate events and both fire, so kills are counted here
 * and deaths there, never both from one (`src/game/README.md`).
 *
 * Resets the victim's streak and no one else's.
 */
export function applyDeath(ledger: Ledger, d: DeathInput): Ledger {
  const victim = ledger.get(d.victim);
  if (!victim) return ledger;
  const selfInflicted = d.killer === null || d.killer === d.victim;
  return next(ledger, [
    {
      ...victim,
      deaths: victim.deaths + 1,
      score: victim.score - (selfInflicted ? SUICIDE_PENALTY : 0),
      streak: 0,
    },
  ]);
}

// ---------------------------------------------------------------------------
// Projections — derived on read, never stored (§5.5)
// ---------------------------------------------------------------------------

/** Consecutive kills this life. 0 for an unknown actor. */
export function streakOf(ledger: Ledger, id: ActorId): number {
  return ledger.get(id)?.streak ?? 0;
}

/**
 * `[team0Kills, team1Kills]` — the match-deciding total, summed on read from
 * the rows. Nothing stores it, so nothing can hold a stale copy of it; this is
 * the whole of §5.5 applied to the number the old project lost track of.
 */
export function teamTotals(ledger: Ledger): [number, number] {
  let a = 0;
  let b = 0;
  for (const e of ledger.values()) {
    if (e.team === TEAM_A) a += e.kills;
    else if (e.team === TEAM_B) b += e.kills;
  }
  return [a, b];
}

/**
 * Scoreboard order: score desc, kills desc, deaths asc, then id ascending.
 * The final key makes the order TOTAL — two rows can never compare equal, so
 * the scoreboard cannot shuffle between frames on a tie, and `advanceFfa`
 * breaks its own tie the same way.
 *
 * Returns `ScoreRow`, the wire's row type, rather than a second row shape of
 * its own: one definition, so `MatchStateMsg.scores` is this list and not a
 * translation of it.
 */
export function leaderboard(ledger: Ledger): ScoreRow[] {
  const rows: ScoreRow[] = [];
  for (const e of ledger.values()) {
    rows.push({ id: e.id, team: e.team, kills: e.kills, deaths: e.deaths, score: e.score });
  }
  rows.sort(
    (x, y) =>
      y.score - x.score ||
      y.kills - x.kills ||
      x.deaths - y.deaths ||
      (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  );
  return rows;
}
