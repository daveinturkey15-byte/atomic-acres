/**
 * Nuketown 2025 — Drone Swarm: five orbit-attack drones over a marked point.
 *
 * A `target-point` streak. The anchor is validated like a sentry emplacement
 * (in bounds, on the ground) and five drones take station on one shared
 * orbit: 12 m radius, 9 m above the anchor, advancing at 0.5 rad/s. Every
 * 2.0 s each drone zaps the nearest alive enemy within 15 m horizontal of
 * ITS OWN position for 15 damage — the orbit is coverage, not decoration:
 * a drone on the far side cannot reach what a near-side drone can.
 *
 * The spacing rule is the point of the lane. Five drones on one orbit want
 * to clump — a shared seed with no constraint parks two drones on the same
 * bearing and the "swarm" is four drones plus an echo. So creation deals the
 * orbit like a hand: an even 2π/5 fan from a seeded base, each bearing
 * jittered by a seeded ±0.09-fan share. Neighbour gaps then stay above
 * 0.82 × fan, strictly clear of the 0.8 × fan minimum, and `createDrone`
 * asserts the minimum on the dealt angles: a future tuning of the jitter
 * that breaks the rule fails loudly at creation, not silently in review.
 *
 * No line-of-sight check: the zap is a top-down strike from 9 m up, so
 * street cover does not gate it — the 15 m horizontal leash is the whole
 * range rule. Victim rules are the sentry's otherwise: same-team, owner,
 * dead and drained are skipped; nearest wins, ties break on id; health
 * falls across the volley so one step never double-taps a corpse.
 */

import type { ActorId, DamageEvent, GameEvent, TeamId, WorldQuery } from '../../events';
import type { SentryTarget } from './sentry';

// ---------------------------------------------------------------------------
// Tuning. FIRST VALUES: the old project had orbit-attack drones only as a
// possession platform, never as an autonomous swarm, so none of these has a
// before-value to carry. Each names the number it was reasoned against (§5.9).
// ---------------------------------------------------------------------------

/** Drones on station. Five is the orbit the spacing rule is written for. */
export const DRONE_COUNT = 5;
/** Shared orbit radius. Inside the sentry's 18 m reach on purpose: the swarm outranges no emplacement. */
export const DRONE_ORBIT_RADIUS_M = 12;
/** Station height above the anchor. Above head height, below any rooftop the map ships. */
export const DRONE_HEIGHT_ABOVE_ANCHOR_M = 9;
/** Orbit rate. One lap takes ~12.6 s, a third of the 30 s window. */
export const DRONE_ORBIT_RAD_S = 0.5;
/** Zap cadence per drone. Slower than any shipped weapon, like the sentry's. */
export const DRONE_ZAP_INTERVAL_MS = 2_000;
/** Horizontal leash around EACH drone. 15 damage × 5 drones = 75 per volley: wounds, never one-taps. */
export const DRONE_ZAP_RANGE_M = 15;
/** Damage per zap. Seven volleys (14 s of contact) kill a 100 HP target that never moves. */
export const DRONE_ZAP_DAMAGE = 15;
/**
 * THE spacing rule: minimum neighbour separation on the orbit, 80% of the
 * even 2π/5 fan. Asserted in `createDrone`, pinned across 200 seeds by
 * `drone.test.ts`.
 */
export const DRONE_MIN_SEPARATION_RAD = ((Math.PI * 2) / DRONE_COUNT) * 0.8;
/**
 * Seeded jitter per bearing, as a share of the even fan. Gaps land in
 * fan ± 2 × jitter = fan × (1 ± 0.18), so the worst gap is 0.82 × fan —
 * clear of the 0.8 minimum with room for float dust. Jitter is far below
 * half a fan, so dealing in fan order IS angular order: no wrap to repair.
 */
export const DRONE_JITTER_FAN_SHARE = 0.09;
/** Hard ceiling on damage events one swarm may emit in one step: one zap per drone, no banking. */
export const MAX_DRONE_ZAPS_PER_STEP = DRONE_COUNT;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface DroneUnit {
  readonly angleRad: number;
  readonly radiusM: number;
  readonly heightM: number;
  readonly cooldownMs: number;
}

export interface DroneSwarmState {
  readonly kind: 'drone';
  readonly instanceId: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly remainingMs: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly drones: readonly DroneUnit[];
  readonly seed: number;
}

export interface DroneTickContext {
  readonly now: number;
  /** Carried for dispatch parity with the sentry/dart; the top-down zap does not read it. */
  readonly world: WorldQuery;
  readonly targets: readonly SentryTarget[];
}

export interface DroneTick {
  readonly state: DroneSwarmState;
  readonly events: readonly GameEvent[];
}

export interface DronePosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

// ---------------------------------------------------------------------------
// Determinism. One integer hash, no allocation, no Math.random: the same
// seed deals the same orbit on every host and every replay (mortar rule).
// ---------------------------------------------------------------------------

function hash2(seed: number, index: number, salt: number): number {
  let h = (seed >>> 0) ^ ((index + 1) * 0x9e3779b1) ^ (salt * 0x85ebca6b);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

const TAU = Math.PI * 2;

function normAngle(a: number): number {
  return ((a % TAU) + TAU) % TAU;
}

/** Smallest neighbour gap of the given bearings, radians, wrap included. */
function minNeighbourGap(sortedAngles: readonly number[]): number {
  let min = Infinity;
  for (let i = 0; i < sortedAngles.length; i += 1) {
    const a = sortedAngles[i];
    const b = sortedAngles[(i + 1) % sortedAngles.length];
    const gap = i + 1 < sortedAngles.length ? b - a : b + TAU - a;
    if (gap < min) min = gap;
  }
  return min;
}

export function createDrone(
  instanceId: number,
  actorId: ActorId,
  team: TeamId,
  streakId: string,
  durationMs: number,
  place: { readonly x: number; readonly y: number; readonly z: number },
  seed: number,
): DroneSwarmState {
  const s = seed >>> 0;
  const fan = TAU / DRONE_COUNT;
  const jitter = fan * DRONE_JITTER_FAN_SHARE;
  // One seeded base so two swarms called in the same tick do not share
  // bearings (dart rule, same reason), then the even fan with seeded jitter.
  const base = ((hash2(s, 1024, 7) % 10_000) / 10_000) * TAU;
  const drones: DroneUnit[] = [];
  for (let i = 0; i < DRONE_COUNT; i += 1) {
    drones.push(Object.freeze({
      angleRad: normAngle(base + i * fan + (((hash2(s, i, 11) % 10_000) / 10_000) - 0.5) * 2 * jitter),
      radiusM: DRONE_ORBIT_RADIUS_M,
      heightM: place.y + DRONE_HEIGHT_ABOVE_ANCHOR_M,
      cooldownMs: DRONE_ZAP_INTERVAL_MS,
    }));
  }
  const dealt = drones.map((d) => d.angleRad).sort((a, b) => a - b);
  if (minNeighbourGap(dealt) < DRONE_MIN_SEPARATION_RAD) {
    throw new Error(`drone swarm seed ${s} dealt a clumped orbit`);
  }
  return Object.freeze({
    kind: 'drone' as const,
    instanceId,
    actorId,
    team,
    streakId,
    remainingMs: Math.max(0, durationMs),
    x: place.x,
    y: place.y,
    z: place.z,
    drones: Object.freeze(drones),
    seed: s,
  });
}

/** World position of drone `index` at its current bearing. */
export function dronePositionAt(state: DroneSwarmState, index: number): DronePosition {
  const d = state.drones[index];
  return {
    x: state.x + Math.cos(d.angleRad) * d.radiusM,
    y: d.heightM,
    z: state.z + Math.sin(d.angleRad) * d.radiusM,
  };
}

/** Smallest neighbour gap of the live bearings. The proof pins this above the minimum. */
export function droneMinSeparationRad(state: DroneSwarmState): number {
  return minNeighbourGap(state.drones.map((d) => d.angleRad).sort((a, b) => a - b));
}

/**
 * Nearest hostile inside this drone's horizontal leash. Ties break on id so
 * the choice is a function of the inputs and nothing else (sentry rule).
 */
function acquire(
  state: DroneSwarmState,
  drone: DroneUnit,
  targets: readonly SentryTarget[],
): { target: SentryTarget; flat: number } | null {
  const px = state.x + Math.cos(drone.angleRad) * drone.radiusM;
  const pz = state.z + Math.sin(drone.angleRad) * drone.radiusM;
  let best: SentryTarget | null = null;
  let bestD = Infinity;
  for (const t of targets) {
    if (!t.alive || t.team === state.team || t.id === state.actorId || t.health <= 0) continue;
    const flat = Math.hypot(t.x - px, t.z - pz);
    if (flat > DRONE_ZAP_RANGE_M) continue;
    if (flat < bestD || (flat === bestD && best !== null && t.id < best.id)) {
      best = t;
      bestD = flat;
    }
  }
  return best === null ? null : { target: best, flat: bestD };
}

export function stepDrone(state: DroneSwarmState, dt: number, ctx: DroneTickContext): DroneTick {
  const step = dt > 0 ? dt : 0;
  const secs = step / 1_000;
  // Health falls as the volley lands, so a volley that kills stops on the
  // same tick rather than double-tapping a corpse (sentry rule, same reason).
  const health: Record<ActorId, number> = {};
  const events: DamageEvent[] = [];
  const drones: DroneUnit[] = [];
  for (const d of state.drones) {
    const angleRad = normAngle(d.angleRad + DRONE_ORBIT_RAD_S * secs);
    // One interval of credit carries, like the sentry's cooldown, so the
    // cadence is exact at any tick rate; flooring at one interval keeps a
    // long blind spell from banking a burst.
    let cooldownMs = Math.max(-DRONE_ZAP_INTERVAL_MS, d.cooldownMs - step);
    // One zap per drone per step at most: the excess over a stall is LOST,
    // so a stall lengthens the window rather than compressing it into one
    // frame (runtime dt-cap rule, same reason).
    if (cooldownMs <= 0 && events.length < MAX_DRONE_ZAPS_PER_STEP) {
      const aimed = { ...d, angleRad };
      const found = acquire(state, aimed, ctx.targets);
      if (found !== null) {
        const before = health[found.target.id] ?? found.target.health;
        if (before > 0) {
          health[found.target.id] = before - DRONE_ZAP_DAMAGE;
          const px = state.x + Math.cos(angleRad) * d.radiusM;
          const pz = state.z + Math.sin(angleRad) * d.radiusM;
          const dx = found.target.x - px;
          const dy = found.target.y + 1.35 - d.heightM;
          const dz = found.target.z - pz;
          events.push(Object.freeze({
            type: 'damage',
            at: ctx.now,
            attackerId: state.actorId,
            attackerTeam: state.team,
            victimId: found.target.id,
            victimTeam: found.target.team,
            amount: DRONE_ZAP_DAMAGE,
            cause: 'streak',
            zone: 'body',
            weaponId: '',
            distance: Math.sqrt(dx * dx + dy * dy + dz * dz),
            healthAfter: Math.max(0, before - DRONE_ZAP_DAMAGE),
            sourceX: px,
            sourceZ: pz,
          }) as DamageEvent);
          cooldownMs += DRONE_ZAP_INTERVAL_MS;
        }
      }
    }
    drones.push(Object.freeze({ angleRad, radiusM: d.radiusM, heightM: d.heightM, cooldownMs }));
  }
  // Expiry retires the swarm; the runtime emits the one `streak-ended`.
  // An effect never ends itself: remainingMs 0 is the signal.
  return {
    state: Object.freeze({ ...state, remainingMs: state.remainingMs - step, drones: Object.freeze(drones) }),
    events,
  };
}
