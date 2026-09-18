/**
 * Nuketown 2025 — the deterministic spawn choice.
 *
 * The old project's `spawn-selection.ts` (272 lines) compressed to the rules
 * its tests pinned: recent-use avoidance, a BANDED nearest-threat reward, an
 * enemy line-of-sight veto, the map-trap radius, FFA minimum separation, TDM
 * side preference with an opposite-side fallback, and a stable per-player
 * tie-break seed. Deterministic for a fixed input — no `Math.random`, no
 * `Date.now`, and a total sort order.
 *
 * The world is reached only through the injected `WorldQuery` port, so this
 * file runs in Node against a stub and needs no scene, no colliders, no canvas.
 *
 * Re-exports `./spawn-points`, which holds `SPAWN_POINTS` and its types. Import
 * from here; the pair is two files only because of the 400-line cap.
 */

export * from './spawn-points';

import { EYE_HEIGHT } from '../core/layout';
import type { ActorId, TeamId, Vec3, WorldQuery } from './events';
import { FFA_MIN_SEPARATION_M, type MatchMode } from './rules';
import { SPAWN_POINTS, type SpawnPoint } from './spawn-points';

// ---------------------------------------------------------------------------
// Scoring weights, with their history (IMPORT-PLAN §5.9)
// ---------------------------------------------------------------------------

/**
 * Line of sight is ALSO a hard veto below; this weight only orders points when
 * every survivor is visible. Old value 1_000_000, scaled by mode pressure.
 */
export const LOS_PENALTY = 1_000_000;
/** Old 250_000: a point inside the trap radius of a recent death. */
export const RECENT_DEATH_PENALTY = 250_000;
/** Old 175_000. Also a hard pool filter, below. */
export const RECENT_USE_PENALTY = 175_000;
/** Old 125_000: the point this actor used last time. */
export const REPEAT_PENALTY = 125_000;
/** Old 50_000: a TDM point on the other team's side. */
export const SIDE_PENALTY = 50_000;
/** Old 20_000 per square metre of separation shortfall. */
export const PROXIMITY_WEIGHT = 20_000;

/**
 * Recent-use horizon. Old `RECENT_USE_AVOIDANCE_MS = 12_000`, widened by
 * `ceil(candidateCount / 4)` because a flat 12 s was SHORTER THAN A RESPAWN
 * CYCLE — by the time an actor spawned again the window had emptied and the
 * deterministic argmax returned the same point every time. That is the measured
 * mechanism behind the owner's "bot spawns seem to just spawn in 1 or two
 * places" (HF-456), and it is the reason this is a derived horizon and not 12.
 */
export const RECENT_USE_AVOIDANCE_MS = 12_000;

/**
 * Old `MAP_TRAP_RADIUS['nuketown2'] = 7` m, widened with population by
 * `min(4, max(0, pop - 2) * 0.5)`. It floors the engagement band as well as
 * sizing the recent-death trap.
 */
export const TRAP_RADIUS_M = 7;

/**
 * Old HF-491. The nearest-threat reward used to be raw squared distance:
 * monotone and unbounded, so the winner was always THE POINT FARTHEST FROM THE
 * PLAYER ON THE MAP, deterministically, every single respawn. On an 84 m map
 * with one bot that put the opponent behind two houses and left the owner's
 * half of the arena empty. The reward now rises to an engagement distance
 * derived from the candidate set itself and decays past it, at half the rate so
 * ordering degrades instead of inverting.
 */
export const ENGAGEMENT_QUANTILE = 0.25;
export const ENGAGEMENT_OVERSHOOT_WEIGHT = 0.5;

/** FFA spreads harder because it has no spawn protection to fall back on. */
export const FFA_MODE_PRESSURE = 1.25;
/** Non-FFA occupant separation, old `25` as a squared metre value. */
export const TEAM_MIN_SEPARATION_M = 5;

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export interface SpawnUse {
  readonly index: number;
  readonly at: number;
}

export interface SpawnContext {
  readonly mode: MatchMode;
  /** The spawning actor's team; null in FFA. */
  readonly team: TeamId | null;
  /** Seeds the tie-break so two actors never break a tie the same way. */
  readonly actorId: ActorId;
  readonly now: number;
  readonly world: WorldQuery;
  /**
   * Live enemies, as EYE-HEIGHT points — `lineOfSight` is called with them
   * unchanged, and a foot position would let a candidate hide behind a kerb.
   * The host builds them; the candidate's own eye is derived here.
   */
  readonly threats?: readonly Vec3[];
  /** Everyone alive, including team-mates: the separation term. */
  readonly occupants?: readonly Vec3[];
  /** Where people died recently; a point inside the trap radius of one is penalised. */
  readonly recentDeaths?: readonly Vec3[];
  /** Index + time of the last few spawns, newest last. */
  readonly recentUses?: readonly SpawnUse[];
  /** This actor's previous point, or -1. */
  readonly previousIndex?: number;
  /** Players in the match; widens the trap radius. */
  readonly population?: number;
  /** Defaults to `SPAWN_POINTS`. Injectable so a test can score a fixed set. */
  readonly points?: readonly SpawnPoint[];
}

export interface SpawnScore {
  readonly index: number;
  readonly score: number;
  readonly visibleThreats: number;
  readonly nearestThreatM: number;
  readonly recentUsePressure: number;
  readonly recentDeathPressure: number;
  readonly sidePenalty: number;
}

export interface SpawnSelection {
  readonly index: number;
  readonly point: SpawnPoint;
  /** Where the actor is actually placed: the point, with ground-floor y resolved. */
  readonly placement: { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number };
  readonly score: number;
  /** Every clause that decided it, as one readable line. Refusals are never silent. */
  readonly reason: string;
  /** The surviving pool, in the order it was ranked. The winner is `scores[0]`. */
  readonly scores: readonly SpawnScore[];
  /**
   * Candidates a pool filter removed, best score first.
   *
   * Without this the vetoes are invisible from outside: a caller sorting
   * `scores` sees only what survived and cannot tell whether the veto did
   * anything. That is how a safety rule ends up untested while looking green —
   * the first version of this lane's proof scored the veto as load-bearing on
   * 0 of 400 boards because it could only see the pool the veto had already
   * produced. An invariant you cannot watch fail, you have not measured.
   */
  readonly rejected: readonly SpawnScore[];
}

/** FNV-1a. Old `stableSpawnTieBreakSeed`; stable across sessions and machines. */
export function spawnSeed(id: string): number {
  let hash = 2_166_136_261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function seededRank(index: number, seed: number): number {
  let v = Math.imul((index | 0) ^ (seed | 0), 0x45d9f3b);
  v ^= v >>> 16;
  return v >>> 0;
}

function dist2(ax: number, az: number, b: Vec3): number {
  return (ax - b.x) ** 2 + (az - b.z) ** 2;
}

/** Old `spawnUseMemoryMs`: the horizon widens with the size of the point set. */
export function useMemoryMs(count: number): number {
  return RECENT_USE_AVOIDANCE_MS * Math.max(1, Math.ceil(count / 4));
}

/** Old `spawnEngagementDistance`: a low quantile of what is actually available. */
export function engagementDistance(distances: readonly number[], minimumM: number): number {
  const sorted = distances.filter((d) => Number.isFinite(d)).sort((a, b) => a - b);
  if (sorted.length === 0) return minimumM;
  return Math.max(minimumM, sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ENGAGEMENT_QUANTILE))]!);
}

/** Old `spawnDistanceReward`: rises to the band, then decays at half the rate. */
export function distanceReward(distanceM: number, engagementM: number | null): number {
  if (engagementM === null || distanceM <= engagementM) return distanceM * distanceM;
  return engagementM * engagementM - ENGAGEMENT_OVERSHOOT_WEIGHT * (distanceM - engagementM) ** 2;
}

function eyeOf(p: SpawnPoint, world: WorldQuery): Vec3 {
  const y = p.floor === 1 ? p.y : groundAt(world, p);
  return { x: p.x, y: y + EYE_HEIGHT, z: p.z };
}

function groundAt(world: WorldQuery, p: SpawnPoint): number {
  if (p.floor === 1) return p.y;
  const g = world.groundY(p.x, p.z);
  return Number.isFinite(g) ? g : p.y;
}

/**
 * Choose a spawn.
 *
 * The pools are applied in this order, each falling back to the previous set
 * when it would be empty, so a starved board still returns a point instead of
 * throwing:
 *
 *  1. **in bounds** — `WorldQuery.inBounds`.
 *  2. **unseen** — no live enemy has line of sight. A HARD veto, not a weight:
 *     with the weights alone an FFA proximity term can outgrow the LOS penalty
 *     (8 m of separation shortfall is 1.28M against a 1.25M FFA visibility
 *     penalty), and "never spawn in front of someone when a safe point exists"
 *     is the one property a spawn selector must actually guarantee.
 *  3. **own side** — TDM only, with the opposite-side fallback.
 *  4. **fresh** — not used inside the recent-use horizon. A fresh point is a
 *     hard preference, which is what makes the set rotate.
 *
 * **3 and 4 are swapped relative to the old project, and the swap is measured.**
 * It applied freshness first, and because the recent-use depth is "all but one
 * of the point set", a lone actor exhausts its own side and then finds the only
 * *fresh* points are in the enemy's house. A 1000-respawn histogram over this
 * table put **200 of 1000 TDM respawns on the wrong side of the map** in that
 * order, and 0 in this one. Freshness now rotates within your own side, which
 * is what both rules were separately trying to say.
 *
 * Within the surviving pool the score decides, and ties break on a hash of the
 * actor id, then on index. Nothing here reads a clock or a random number.
 */
export function selectSpawn(ctx: SpawnContext): SpawnSelection {
  const points = ctx.points ?? SPAWN_POINTS;
  if (points.length === 0) throw new Error('spawns: no candidate points');

  const threats = ctx.threats ?? [];
  const occupants = ctx.occupants ?? [];
  const recentDeaths = ctx.recentDeaths ?? [];
  const recentUses = ctx.recentUses ?? [];
  const previousIndex = ctx.previousIndex ?? -1;
  const population = ctx.population ?? occupants.length;
  const isFfa = ctx.mode === 'ffa';

  const trapRadius = TRAP_RADIUS_M + Math.min(4, Math.max(0, population - 2) * 0.5);
  const trapRadius2 = trapRadius * trapRadius;
  const separation = isFfa ? FFA_MIN_SEPARATION_M : TEAM_MIN_SEPARATION_M;
  const separation2 = separation * separation;
  const modePressure = isFfa ? FFA_MODE_PRESSURE : 1;
  const seed = spawnSeed(ctx.actorId);

  const inBounds = points.filter((p) => ctx.world.inBounds(p.x, p.z));
  const usable = inBounds.length > 0 ? inBounds : points;

  const nearestThreatM = (p: SpawnPoint): number =>
    threats.length === 0 ? Infinity : Math.sqrt(Math.min(...threats.map((t) => dist2(p.x, p.z, t))));
  const band =
    threats.length === 0 ? null : engagementDistance(usable.map(nearestThreatM), trapRadius);

  // Depth: all but one of the set counts as recent regardless of age, so the
  // preference is a shuffle bag over the table. A wall clock cannot guarantee a
  // rotation when the respawn cadence is unknown; a count can.
  const depth = Math.max(0, usable.length - 1);
  const horizon = useMemoryMs(usable.length);
  const recentByDepth = new Set(recentUses.slice(-depth).map((u) => u.index));

  const scored: SpawnScore[] = usable.map((p) => {
    const eye = eyeOf(p, ctx.world);
    let visibleThreats = 0;
    for (const t of threats) if (ctx.world.lineOfSight(eye, t)) visibleThreats++;

    const nearest = nearestThreatM(p);
    const recentUsePressure =
      recentUses.filter((u) => u.index === p.index && ctx.now >= u.at && ctx.now - u.at <= horizon).length +
      (recentByDepth.has(p.index) ? 1 : 0);
    const recentDeathPressure = recentDeaths.filter((d) => dist2(p.x, p.z, d) <= trapRadius2).length;

    let proximityPenalty = 0;
    for (const o of occupants) {
      const d2 = dist2(p.x, p.z, o);
      if (d2 < separation2) proximityPenalty += (separation2 - d2) * PROXIMITY_WEIGHT;
    }

    const wrongSide = !isFfa && ctx.team !== null && p.team !== null && p.team !== ctx.team;
    const sidePenalty = wrongSide ? SIDE_PENALTY : 0;

    const score =
      distanceReward(nearest === Infinity ? trapRadius : nearest, band) -
      visibleThreats * LOS_PENALTY * modePressure -
      recentDeathPressure * RECENT_DEATH_PENALTY -
      recentUsePressure * RECENT_USE_PENALTY -
      proximityPenalty -
      sidePenalty -
      (p.index === previousIndex ? REPEAT_PENALTY : 0);

    return { index: p.index, score, visibleThreats, nearestThreatM: nearest, recentUsePressure, recentDeathPressure, sidePenalty };
  });

  const byIndex = new Map(usable.map((p) => [p.index, p]));
  const prefer = (pool: readonly SpawnScore[], keep: (s: SpawnScore) => boolean): readonly SpawnScore[] => {
    const next = pool.filter(keep);
    return next.length > 0 ? next : pool;
  };

  let pool: readonly SpawnScore[] = scored;
  const unseenApplied = pool.some((s) => s.visibleThreats > 0);
  pool = prefer(pool, (s) => s.visibleThreats === 0);
  if (!isFfa && ctx.team !== null) {
    pool = prefer(pool, (s) => byIndex.get(s.index)!.team === ctx.team);
  }
  pool = prefer(pool, (s) => s.recentUsePressure === 0);

  const byScore = (l: SpawnScore, r: SpawnScore): number =>
    r.score - l.score || seededRank(l.index, seed) - seededRank(r.index, seed) || l.index - r.index;
  const ordered = [...pool].sort(byScore);
  const survived = new Set(pool.map((s) => s.index));
  const rejected = scored.filter((s) => !survived.has(s.index)).sort(byScore);
  const best = ordered[0]!;
  const point = byIndex.get(best.index)!;

  const reason = [
    point.id,
    best.visibleThreats === 0 ? (unseenApplied ? 'los-clear(vetoed-visible)' : 'los-clear') : `los-visible:${best.visibleThreats}`,
    best.nearestThreatM === Infinity ? 'threats:none' : `nearest-threat:${best.nearestThreatM.toFixed(1)}m`,
    band === null ? 'band:none' : `band:${band.toFixed(1)}m`,
    best.recentUsePressure === 0 ? 'fresh' : `recent-use:${best.recentUsePressure}`,
    best.recentDeathPressure === 0 ? 'no-trap' : `trap:${best.recentDeathPressure}`,
    best.sidePenalty === 0 ? 'own-side' : 'side-fallback',
    `mode:${ctx.mode}`,
  ].join('|');

  return {
    index: best.index,
    point,
    placement: { x: point.x, y: groundAt(ctx.world, point), z: point.z, yaw: point.yaw },
    score: best.score,
    reason,
    scores: ordered,
    rejected,
  };
}
