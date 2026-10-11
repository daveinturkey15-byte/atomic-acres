/**
 * Nuketown 2025 — Chopper Gunner: an AI-flown orbit gunship the owner can possess.
 *
 * The platform flies itself on a CLOSED-FORM elliptical orbit: the state
 * carries `elapsedMs` and the pose is a pure function of it, so stepping in
 * one 30 s jump lands exactly where 120 quarter-second steps do — there is no
 * integrator and therefore no drift to bound. Phases are fractions of the
 * window: inbound 8% (a smoothstep spiral from an entry point onto the
 * ellipse), orbit 82%, outbound 10% (a smoothstep spiral off to an exit).
 *
 * Autopilot (no owner input needed): after a 2 s arm the gunship fires guided
 * rockets at the nearest visible hostile inside 90 m on a 2.6 s cadence, up to
 * 6 of its 12 rockets. The cannon fires only while the owner possesses the
 * platform, at the nearest visible hostile inside 60 m on a 240 ms cadence.
 * The gunner's own aim (crosshair anchor) arrives on a later input lane; until
 * then the cannon is slaved to the nearest hostile, which is why possession
 * still matters day one: no possession, no cannon.
 *
 * Blast falloff is mortar's linear shape re-spelled locally rather than
 * imported: `effects/` leaves never import values from each other, and a
 * shared import would make this file's tuning hostage to the mortar's.
 */

import { BOUND_X_MAX, BOUND_X_MIN, BOUND_Z } from '../../../core/layout';
import type { ActorId, DamageEvent, GameEvent, TeamId, WorldQuery } from '../../events';
import type { SentryTarget } from './sentry';

// ---------------------------------------------------------------------------
// Tuning. FIRST VALUES for this project (§5.9): reasoned against OUR numbers,
// not carried from anywhere.
// ---------------------------------------------------------------------------

export const CHOPPER_DURATION_MS = 30_000;
/** Revolutions per window. 1.35: the exit heading differs from the entry one. */
export const CHOPPER_REVOLUTIONS = 1.35;
/** Orbit radii, as a share of the arena half-extents. */
export const CHOPPER_RADIUS_SHARE = 0.36;
/** Radial wobble, ± share of the radius, at three lobes per revolution. */
export const CHOPPER_WOBBLE_SHARE = 0.045;
/** Cruise height above the orbit-centre ground, metres. */
export const CHOPPER_ALTITUDE_M = 22;
/** Altitude bob, ± metres, at two lobes per revolution. */
export const CHOPPER_BOB_M = 1.25;
/** Inbound share of the window: spiral from the entry point onto the ellipse. */
export const CHOPPER_INBOUND_SHARE = 0.08;
/** Outbound share: spiral off to the exit point. */
export const CHOPPER_OUTBOUND_SHARE = 0.10;
/** Autopilot arm: no rockets before this, so the entry is never a kill. */
export const CHOPPER_ARM_MS = 2_000;
/** Autopilot rocket cadence. Slower than the mortar's 800 ms: one guided kill per pass. */
export const CHOPPER_ROCKET_CADENCE_MS = 2_600;
/** Autopilot targeting range, metres slant from the pose. */
export const CHOPPER_ROCKET_RANGE_M = 90;
/** Autopilot budget: 6 of the 12 rockets. The rest is the manual reserve the input lane will fire. */
export const CHOPPER_AI_ROCKET_BUDGET = 6;
/** Rockets carried. HUD `rockets-left` = this minus rockets spent. */
export const CHOPPER_ROCKETS = 12;
/** Rocket blast radius, metres. Inside the mortar's 6 m on purpose: guided, so it needs less. */
export const CHOPPER_ROCKET_BLAST_M = 4.5;
/** Rocket damage at the impact point. A centre hit kills a 100 HP target outright: cost 9 must feel like it. */
export const CHOPPER_ROCKET_MAX_DAMAGE = 240;
/** Rocket damage at the blast edge. Two edge hits kill; one only wounds. First value. */
export const CHOPPER_ROCKET_MIN_DAMAGE = 50;
/** Cannon cadence while possessed. Just under the sentry's 220 ms: the gunner's aim is worse than the machine's. */
export const CHOPPER_CANNON_CADENCE_MS = 240;
/** Cannon range, metres slant from the pose. Inside the rocket range: the cannon is the close weapon. */
export const CHOPPER_CANNON_RANGE_M = 60;
/** Cannon direct damage. Eight centre hits (~1.9 s on target) kill: weaker per-hit than the sentry's 14. */
export const CHOPPER_CANNON_DAMAGE = 12.75;
/** Cannon splash radius for everyone else near the impact, metres. */
export const CHOPPER_CANNON_SPLASH_M = 2.6;
/** Cannon splash at the impact point. First value; the brief is silent on it. */
export const CHOPPER_CANNON_SPLASH_MAX = 16;
/** Cannon splash at the edge. A graze, like the mortar's minimum. First value. */
export const CHOPPER_CANNON_SPLASH_MIN = 4;
/**
 * Hard ceiling on weapon releases one gunship may emit in one step. Rocket
 * cadence (2.6 s) can never hit it; the cannon (240 ms vs the runtime's
 * 250 ms dt cap) lands at most 2. The excess is LOST, same rule as the other
 * effects: a stall lengthens the window instead of compressing it.
 */
export const MAX_CHOPPER_ROCKETS_PER_STEP = 1;
export const MAX_CHOPPER_CANNON_PER_STEP = 2;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export type ChopperPhase = 'inbound' | 'orbit' | 'outbound';

export interface ChopperState {
  readonly kind: 'chopper';
  readonly instanceId: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly remainingMs: number;
  /** Ms since activation. The pose is a pure function of this: no integration, no drift. */
  readonly elapsedMs: number;
  readonly phase: ChopperPhase;
  /** Orbit centre: the anchor, clamped so the whole ellipse stays in-bounds. */
  readonly centreX: number;
  readonly centreY: number;
  readonly centreZ: number;
  readonly radiusX: number;
  readonly radiusZ: number;
  /** Orbit angle at activation, from the seed: two gunships never stack. */
  readonly phase0: number;
  /** Wobble and bob phases, from the seed. */
  readonly wobblePhase: number;
  readonly bobPhase: number;
  readonly ammoRockets: number;
  /** Autopilot rockets spent. Capped at CHOPPER_AI_ROCKET_BUDGET; the manual reserve is untouched. */
  readonly aiRocketsSpent: number;
  /** Ms until the next autopilot rocket may release. */
  readonly rocketTimerMs: number;
  /** Ms until the cannon may fire again. Read by the gunner HUD bar. */
  readonly gunCooldownMs: number;
  readonly seed: number;
  /** True while the owner holds the platform. Flipped by the runtime toggle path, never by stepping. */
  readonly ownerPossessing: boolean;
}

export interface ChopperTickContext {
  readonly now: number;
  readonly world: WorldQuery;
  readonly targets: readonly SentryTarget[];
}

export interface ChopperTick {
  readonly state: ChopperState;
  readonly events: readonly GameEvent[];
}

/** Where the gunship is and where it looks, at a moment. All closed-form. */
export interface ChopperPose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly phase: ChopperPhase;
}

// ---------------------------------------------------------------------------
// Determinism. Integer hashes, no Math.random: the same seed flies the same
// orbit on every host and every replay.
// ---------------------------------------------------------------------------

function hashUnit(seed: number, salt: number): number {
  let h = (Math.imul((seed >>> 0) ^ (salt * 0x9e3779b1 >>> 0), 0x85ebca6b) ^ (salt * 0x27d4eb2f >>> 0)) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return (h % 10_000) / 10_000;
}

/** Orbit radii from the one bound source (`core/layout`, via the same import `world-query.ts` uses). */
export function chopperRadii(): { readonly rx: number; readonly rz: number } {
  return Object.freeze({
    rx: CHOPPER_RADIUS_SHARE * ((BOUND_X_MAX - BOUND_X_MIN) / 2),
    rz: CHOPPER_RADIUS_SHARE * BOUND_Z,
  });
}

/** Clamp a centre so the whole ellipse stays inside the arena. Pure arithmetic, no world needed. */
export function chopperClampCentre(x: number, z: number): { readonly x: number; readonly z: number } {
  const { rx, rz } = chopperRadii();
  const loX = BOUND_X_MIN + rx;
  const hiX = BOUND_X_MAX - rx;
  const loZ = -BOUND_Z + rz;
  const hiZ = BOUND_Z - rz;
  return Object.freeze({
    x: loX > hiX ? (BOUND_X_MIN + BOUND_X_MAX) / 2 : Math.min(hiX, Math.max(loX, x)),
    z: loZ > hiZ ? 0 : Math.min(hiZ, Math.max(loZ, z)),
  });
}

export function createChopper(
  instanceId: number,
  actorId: ActorId,
  team: TeamId,
  streakId: string,
  durationMs: number,
  place: { readonly x: number; readonly y: number; readonly z: number },
  seed: number,
): ChopperState {
  const clamped = chopperClampCentre(place.x, place.z);
  const { rx, rz } = chopperRadii();
  const s = seed >>> 0;
  return Object.freeze({
    kind: 'chopper' as const,
    instanceId,
    actorId,
    team,
    streakId,
    remainingMs: Math.max(0, durationMs),
    elapsedMs: 0,
    phase: 'inbound' as ChopperPhase,
    centreX: clamped.x,
    centreY: place.y,
    centreZ: clamped.z,
    radiusX: rx,
    radiusZ: rz,
    phase0: hashUnit(s, 1) * Math.PI * 2,
    wobblePhase: hashUnit(s, 2) * Math.PI * 2,
    bobPhase: hashUnit(s, 3) * Math.PI * 2,
    ammoRockets: CHOPPER_ROCKETS,
    aiRocketsSpent: 0,
    rocketTimerMs: CHOPPER_ARM_MS,
    gunCooldownMs: 0,
    seed: s,
    ownerPossessing: false,
  });
}

/** Phase at an elapsed time. Fractions of the window, so a retuned duration keeps the shape. */
export function chopperPhaseAt(elapsedMs: number, durationMs: number): ChopperPhase {
  const total = Math.max(1, durationMs);
  const u = Math.min(1, Math.max(0, elapsedMs / total));
  if (u < CHOPPER_INBOUND_SHARE) return 'inbound';
  if (u > 1 - CHOPPER_OUTBOUND_SHARE) return 'outbound';
  return 'orbit';
}

function smoothstep(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
}

/** Point on the wobbling ellipse at an angle. Exported: the runtime's pose projection is built on it. */
export function chopperEllipseAt(
  state: ChopperState,
  angle: number,
  wobbleAngle: number,
  bobAngle: number,
): { readonly x: number; readonly y: number; readonly z: number } {
  const wobble = 1 + CHOPPER_WOBBLE_SHARE * Math.sin(wobbleAngle + state.wobblePhase);
  return Object.freeze({
    x: state.centreX + Math.cos(angle) * state.radiusX * wobble,
    y: state.centreY + CHOPPER_ALTITUDE_M + CHOPPER_BOB_M * Math.sin(bobAngle + state.bobPhase),
    z: state.centreZ + Math.sin(angle) * state.radiusZ * wobble,
  });
}

/** Position on the flight path at an elapsed time, no yaw. One definition; the pose below reads it three times. */
function chopperPositionAt(
  state: ChopperState,
  t: number,
  total: number,
): { readonly x: number; readonly y: number; readonly z: number } {
  const rev = (CHOPPER_REVOLUTIONS * Math.PI * 2) / total;
  const angle = state.phase0 + rev * t;
  const onEllipse = chopperEllipseAt(state, angle, 3 * rev * t, 2 * rev * t);
  const phase = chopperPhaseAt(t, total);
  if (phase === 'inbound') {
    const entry = chopperEllipseAt(state, state.phase0 - 0.6, 0, 0);
    const far = { x: state.centreX + (entry.x - state.centreX) * 2, y: state.centreY + 38, z: state.centreZ + (entry.z - state.centreZ) * 2 };
    const u = smoothstep(t / (total * CHOPPER_INBOUND_SHARE));
    return {
      x: far.x + (onEllipse.x - far.x) * u,
      y: far.y + (onEllipse.y - far.y) * u,
      z: far.z + (onEllipse.z - far.z) * u,
    };
  }
  if (phase === 'outbound') {
    const near = chopperEllipseAt(state, state.phase0 + CHOPPER_REVOLUTIONS * Math.PI * 2 + 0.6, 0, 0);
    const far = { x: state.centreX + (near.x - state.centreX) * 2, y: state.centreY + 38, z: state.centreZ + (near.z - state.centreZ) * 2 };
    const v = smoothstep((t - total * (1 - CHOPPER_OUTBOUND_SHARE)) / (total * CHOPPER_OUTBOUND_SHARE));
    return {
      x: onEllipse.x + (far.x - onEllipse.x) * v,
      y: onEllipse.y + (far.y - onEllipse.y) * v,
      z: onEllipse.z + (far.z - onEllipse.z) * v,
    };
  }
  return onEllipse;
}

/**
 * The pose at an elapsed time. Inbound blends the entry point onto the
 * ellipse, outbound blends off to the exit; orbit rides it. A pure function
 * of (state, elapsedMs): advancing 1 × 30 s and 120 × 250 ms agree exactly,
 * which is what the proof pins.
 */
export function chopperPoseAt(state: ChopperState, elapsedMs: number, durationMs: number): ChopperPose {
  const total = Math.max(1, durationMs);
  const t = Math.min(total, Math.max(0, elapsedMs));
  const p = chopperPositionAt(state, t, total);
  // Yaw along velocity: an epsilon-difference of the pure position function.
  // Deterministic like everything else here, and it adds no state to drift.
  const ahead = chopperPositionAt(state, Math.min(total, t + 50), total);
  const behind = chopperPositionAt(state, Math.max(0, t - 50), total);
  const dx = ahead.x - behind.x;
  const dz = ahead.z - behind.z;
  const yaw = dx * dx + dz * dz < 1e-9 ? state.phase0 : Math.atan2(-dx, -dz);
  return Object.freeze({ x: p.x, y: p.y, z: p.z, yaw, phase: chopperPhaseAt(t, total) });
}

/** Linear blast falloff, centre to edge, floored at 1 per the DamageEvent contract. */
function rocketBlast(distM: number): number {
  if (distM >= CHOPPER_ROCKET_BLAST_M) return 0;
  const t = distM / CHOPPER_ROCKET_BLAST_M;
  return Math.max(1, Math.round(CHOPPER_ROCKET_MAX_DAMAGE + (CHOPPER_ROCKET_MIN_DAMAGE - CHOPPER_ROCKET_MAX_DAMAGE) * t));
}

/** Cannon splash falloff, same shape, its own numbers. */
function cannonSplash(distM: number): number {
  if (distM >= CHOPPER_CANNON_SPLASH_M) return 0;
  const t = distM / CHOPPER_CANNON_SPLASH_M;
  return Math.max(1, Math.round(CHOPPER_CANNON_SPLASH_MAX + (CHOPPER_CANNON_SPLASH_MIN - CHOPPER_CANNON_SPLASH_MAX) * t));
}

/**
 * Nearest hostile the gunship can see from `from`, inside `rangeM` slant.
 * Sentry victim rules: skip same-team, the owner, the dead and the drained;
 * nearest first, ties on id, so two hosts stepping the same state agree.
 */
function acquire(
  state: ChopperState,
  ctx: ChopperTickContext,
  from: { readonly x: number; readonly y: number; readonly z: number },
  rangeM: number,
): SentryTarget | null {
  let best: SentryTarget | null = null;
  let bestD = rangeM;
  for (const t of ctx.targets) {
    if (!t.alive || t.team === state.team || t.id === state.actorId || t.health <= 0) continue;
    const dx = t.x - from.x;
    const dy = t.y + 1.35 - from.y;
    const dz = t.z - from.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > rangeM) continue;
    if (best !== null && (dist > bestD || (dist === bestD && t.id >= best.id))) continue;
    if (!ctx.world.lineOfSight(from, { x: t.x, y: t.y + 1.35, z: t.z })) continue;
    best = t;
    bestD = dist;
  }
  return best;
}

function damageEvent(
  state: ChopperState,
  ctx: ChopperTickContext,
  victim: SentryTarget,
  amount: number,
  dist: number,
  healthBefore: number,
  pose: { readonly x: number; readonly z: number },
  zone: 'head' | 'body' | 'limb',
): DamageEvent {
  return Object.freeze({
    type: 'damage',
    at: ctx.now,
    attackerId: state.actorId,
    attackerTeam: state.team,
    victimId: victim.id,
    victimTeam: victim.team,
    amount,
    cause: 'streak',
    zone,
    weaponId: '',
    distance: dist,
    healthAfter: Math.max(0, healthBefore - amount),
    sourceX: pose.x,
    sourceZ: pose.z,
  }) as DamageEvent;
}

export function stepChopper(state: ChopperState, dt: number, ctx: ChopperTickContext): ChopperTick {
  const step = dt > 0 ? dt : 0;
  const durationMs = Math.max(1, state.remainingMs + state.elapsedMs);
  const elapsedMs = state.elapsedMs + step;
  const remainingMs = state.remainingMs - step;
  const pose = chopperPoseAt(state, elapsedMs, durationMs);
  const events: DamageEvent[] = [];
  // Health falls as releases land, so a volley that kills stops on the same
  const health: Record<ActorId, number> = {};
  const beforeOf = (t: SentryTarget): number => health[t.id] ?? t.health;
  const hurt = (t: SentryTarget, amount: number, dist: number, zone: 'head' | 'body' | 'limb'): void => {
    const before = beforeOf(t);
    if (before <= 0) return;
    health[t.id] = before - amount;
    events.push(damageEvent(state, ctx, t, amount, dist, before, pose, zone));
  };

  // Autopilot rockets: armed at 2 s, every 2.6 s after, budget 6 of 12. Guided:
  // the impact is the target's own position, and the blast takes everyone else near it.
  let aiRocketsSpent = state.aiRocketsSpent;
  let rocketTimerMs = state.rocketTimerMs - step;
  let rocketsFired = 0;
  while (
    aiRocketsSpent < CHOPPER_AI_ROCKET_BUDGET &&
    rocketTimerMs <= 0 &&
    rocketsFired < MAX_CHOPPER_ROCKETS_PER_STEP &&
    remainingMs > 0
  ) {
    const aim = acquire(state, ctx, pose, CHOPPER_ROCKET_RANGE_M);
    if (aim === null) break;
    const victims: { t: SentryTarget; dist: number; amount: number }[] = [];
    for (const t of ctx.targets) {
      if (!t.alive || t.team === state.team || t.id === state.actorId || beforeOf(t) <= 0) continue;
      const dx = t.x - aim.x;
      const dy = t.y + 1.35 - (aim.y + 1.35);
      const dz = t.z - aim.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const amount = rocketBlast(dist);
      if (amount <= 0) continue;
      victims.push({ t, dist, amount });
    }
    victims.sort((a, b) => (a.dist === b.dist ? (a.t.id < b.t.id ? -1 : 1) : a.dist - b.dist));
    for (const v of victims) hurt(v.t, v.amount, v.dist, 'body');
    aiRocketsSpent += 1;
    rocketsFired += 1;
    rocketTimerMs += CHOPPER_ROCKET_CADENCE_MS;
  }

  // Cannon: possessed fire only. Nearest visible hostile inside 60 m takes the
  // direct round; everyone else inside 2.6 m of the impact takes splash.
  let gunCooldownMs = state.gunCooldownMs - step;
  let cannonFired = 0;
  while (state.ownerPossessing && gunCooldownMs <= 0 && cannonFired < MAX_CHOPPER_CANNON_PER_STEP && remainingMs > 0) {
    const aim = acquire(state, ctx, pose, CHOPPER_CANNON_RANGE_M);
    if (aim === null) break;
    const dx = aim.x - pose.x;
    const dy = aim.y + 1.35 - pose.y;
    const dz = aim.z - pose.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    hurt(aim, CHOPPER_CANNON_DAMAGE, dist, 'body');
    for (const t of ctx.targets) {
      if (t.id === aim.id || !t.alive || t.team === state.team || t.id === state.actorId || beforeOf(t) <= 0) continue;
      const sx = t.x - aim.x;
      const sy = t.y - aim.y;
      const sz = t.z - aim.z;
      const sdist = Math.sqrt(sx * sx + sy * sy + sz * sz);
      const amount = cannonSplash(sdist);
      if (amount <= 0) continue;
      hurt(t, amount, sdist, 'body');
    }
    cannonFired += 1;
    gunCooldownMs += CHOPPER_CANNON_CADENCE_MS;
  }

  return {
    state: Object.freeze({
      ...state,
      remainingMs,
      elapsedMs,
      phase: chopperPhaseAt(elapsedMs, durationMs),
      aiRocketsSpent,
      rocketTimerMs,
      gunCooldownMs,
    }),
    events,
  };
}
