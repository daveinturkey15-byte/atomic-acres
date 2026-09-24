/**
 * Nuketown 2025 — Tracker Dart: a thrown sensor that paints what moves near
 * where it sticks, for as long as its battery lasts.
 *
 * The honest infantry-map stand-in for the old project's scout family
 * (Scout Sweep: instant map-wide pulse reveal, 12 s; Yardhawk: instant,
 * 15 s). A map-wide reveal keyed to nothing in the world would be free
 * information; a dart has to be THROWN somewhere, so its reveal is a 14 m
 * bubble around where it lands — position matters, and the enemy can leave
 * the bubble. Same vocabulary as recon (a level the minimap will read, not
 * an occurrence), but anchored instead of global.
 *
 * Contract (same stepper shape as `recon.ts`):
 *   - Pulses every 2.5 s (the recon period, not a new number). Each pulse
 *     recomputes the painted set from scratch: hostile, alive, in radius,
 *     with line of sight from the dart. No memory between pulses, so nothing
 *     leaks when a target dies or leaves.
 *   - The owner is never painted; friendlies are never painted.
 *   - Emits nothing. Like recon, the state IS the effect: the runtime's
 *     `paintedTargetIds()` aggregates live darts for whoever draws blips.
 *   - Placement reuses the sentry rule (in-bounds, on the ground),
 *     validated BEFORE a charge moves.
 */

import type { ActorId, GameEvent, TeamId, WorldQuery } from '../../events';
import type { SentryTarget } from './sentry';

// ---------------------------------------------------------------------------
// Tuning. Anchored against the sentry (18 m range) and recon (2.5 s period):
// a dart that outranged the emplacement would be the better sentry. 14 m is
// inside sentry range on purpose — the dart SEES less far than the gun
// shoots, so the pair composes instead of competing.
// ---------------------------------------------------------------------------

/** Paint radius around the stuck dart, metres. */
export const DART_RADIUS_M = 14;
/** Pulse period. The recon period, deliberately: one heartbeat for reveals. */
export const DART_PULSE_MS = 2_500;
/** Sensor height above the ground it stuck to. */
export const DART_SENSOR_M = 0.4;
/** Aim height on a target, matching the sentry's centre-mass convention. */
export const DART_AIM_HEIGHT_M = 1.35;

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface DartState {
  readonly kind: 'dart';
  readonly instanceId: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly remainingMs: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Ms since the last pulse (or activation). The seed offsets the first. */
  readonly pulseMs: number;
  /** Target ids latched by the last pulse. Recomputed, never appended to. */
  readonly painted: readonly ActorId[];
  readonly seed: number;
}

export interface DartTickContext {
  readonly now: number;
  readonly world: WorldQuery;
  readonly targets: readonly SentryTarget[];
}

export interface DartTick {
  readonly state: DartState;
  readonly events: readonly GameEvent[];
}

export function createDart(
  instanceId: number,
  actorId: ActorId,
  team: TeamId,
  streakId: string,
  durationMs: number,
  place: { readonly x: number; readonly y: number; readonly z: number },
  seed: number,
): DartState {
  // Seed-only: the first pulse is offset so two darts thrown in the same
  // tick do not pulse in lockstep (recon rule, same reason).
  const offset = ((seed >>> 0) % 1_000) / 1_000;
  return Object.freeze({
    kind: 'dart' as const,
    instanceId,
    actorId,
    team,
    streakId,
    remainingMs: Math.max(0, durationMs),
    x: place.x,
    y: place.y,
    z: place.z,
    pulseMs: offset * DART_PULSE_MS,
    painted: Object.freeze([]),
    seed: seed >>> 0,
  });
}

function pulsePainted(state: DartState, ctx: DartTickContext): readonly ActorId[] {
  const from = { x: state.x, y: state.y + DART_SENSOR_M, z: state.z };
  const out: ActorId[] = [];
  for (const t of ctx.targets) {
    if (!t.alive || t.team === state.team || t.id === state.actorId || t.health <= 0) continue;
    const flat = Math.hypot(t.x - state.x, t.z - state.z);
    if (flat > DART_RADIUS_M) continue;
    if (!ctx.world.lineOfSight(from, { x: t.x, y: t.y + DART_AIM_HEIGHT_M, z: t.z })) continue;
    out.push(t.id);
  }
  // Sorted: the set is a function of the inputs, and two hosts stepping the
  // same state agree on the order, not just the membership.
  out.sort();
  return Object.freeze(out);
}

export function stepDart(state: DartState, dt: number, ctx: DartTickContext): DartTick {
  const step = dt > 0 ? dt : 0;
  let pulseMs = state.pulseMs + step;
  let painted = state.painted;
  if (pulseMs >= DART_PULSE_MS) {
    pulseMs -= DART_PULSE_MS;
    painted = pulsePainted(state, ctx);
  }
  return {
    state: Object.freeze({
      ...state,
      remainingMs: state.remainingMs - step,
      pulseMs,
      painted,
    }),
    events: [],
  };
}

/** Is `targetId` painted by this dart right now? */
export function dartPaints(state: DartState, targetId: ActorId): boolean {
  return state.remainingMs > 0 && state.painted.includes(targetId);
}
