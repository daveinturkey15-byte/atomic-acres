/**
 * Tracker Dart: an anchored, host-owned sensor.
 *
 * The dart is deliberately a level, not an event stream.  Every pulse rebuilds
 * its target set from the host's current actor table, so a dead actor or an
 * actor that leaves the bubble disappears at the next pulse.  The runtime
 * exposes the set only through a team-scoped query.
 */

import type { ActorId, GameEvent, TeamId, WorldQuery } from '../../events';
import type { SentryTarget } from './sentry';
import type { RevealSample } from './reveal';

export const DART_RADIUS_M = 14;
export const DART_PULSE_MS = 2_500;
export const DART_SENSOR_M = 0.4;
export const DART_AIM_HEIGHT_M = 1.35;

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
  readonly pulseMs: number;
  /** Monotonic sensor pulses; unlike `pulseMs`, this never wraps. */
  readonly pulses: number;
  readonly painted: readonly ActorId[];
  readonly samples: readonly RevealSample[];
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
    pulses: 0,
    painted: Object.freeze([]),
    samples: Object.freeze([]),
    seed: seed >>> 0,
  });
}

function pulsePainted(state: DartState, ctx: DartTickContext): readonly RevealSample[] {
  const from = { x: state.x, y: state.y + DART_SENSOR_M, z: state.z };
  const out: RevealSample[] = [];
  for (const target of ctx.targets) {
    if (!target.alive || target.health <= 0 || target.team === state.team || target.id === state.actorId) continue;
    if (Math.hypot(target.x - state.x, target.z - state.z) > DART_RADIUS_M) continue;
    if (!ctx.world.lineOfSight(from, { x: target.x, y: target.y + DART_AIM_HEIGHT_M, z: target.z })) continue;
    out.push(Object.freeze({ id: target.id, x: target.x, y: target.y, z: target.z }));
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return Object.freeze(out);
}

export function stepDart(state: DartState, dt: number, ctx: DartTickContext): DartTick {
  const step = dt > 0 ? dt : 0;
  const total = state.pulseMs + step;
  const pulses = Math.floor(total / DART_PULSE_MS);
  const samples = pulses > 0 ? pulsePainted(state, ctx) : state.samples;
  return {
    state: Object.freeze({
      ...state,
      remainingMs: state.remainingMs - step,
      pulseMs: total - pulses * DART_PULSE_MS,
      pulses: state.pulses + pulses,
      painted: pulses > 0 ? Object.freeze(samples.map((sample) => sample.id)) : state.painted,
      samples,
    }),
    events: [],
  };
}

export function dartPaints(state: DartState, targetId: ActorId): boolean {
  return state.remainingMs > 0 && state.painted.includes(targetId);
}
