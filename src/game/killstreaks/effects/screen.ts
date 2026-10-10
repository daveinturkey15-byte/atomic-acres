/**
 * Nuketown 2025 — Fallout Screen: the smoke streak, as seven real volumes.
 *
 * Placement, timing and rendering all reuse the existing smoke contract
 * instead of inventing a parallel one: volumes are `grenade`-kind (full
 * density, line-of-sight blocking), born at activation and dying with the
 * instance, laid as a centre plus a hex ring so the disc reads continuous
 * under the volumetric pass. Bots lose sight through it and the atmosphere
 * lane draws it with zero new code — the client path (`ordnance-view` →
 * `ordnance-scene.smokes` → `atmosphere.smoke`) cannot tell who lit it.
 *
 * Ids are negative (`-(instanceId * 16 + slot)`); `host-ordnance` counts up
 * from 1, so the two allocators share the `SightField` without ever meeting.
 * An effect never ends itself: `remainingMs` 0 is the runtime's retire signal,
 * and the final step withdraws the volumes first so no orphan outlives it.
 */

import type { ActorId, GameEvent, TeamId, WorldQuery } from '../../events';
import type { SmokeVolumeEvent, SmokeVolumeEndEvent } from '../../events-ordnance';
import { SMOKE_RADIUS_M } from '../../ordnance';
import { sightOf } from '../../world-query';

/** Volumes per screen: centre plus a hex ring. */
export const SCREEN_VOLUME_COUNT = 7;
/** Hex ring radius, metres. Ring volumes (r=5) overlap centre at 4 m. */
export const SCREEN_RING_M = 4;
/** Volume centre height above placed ground, metres. Chest-high blocks sight. */
export const SCREEN_HEIGHT_M = 1.2;

export interface ScreenVolume {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ScreenState {
  readonly kind: 'screen';
  readonly instanceId: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly remainingMs: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly volumes: readonly ScreenVolume[];
  /** Host time the volumes die. Mirrors the instance clock for the bus. */
  readonly diesAt: number;
}

export interface ScreenTickContext {
  readonly now: number;
  readonly world: WorldQuery;
}

export interface ScreenTick {
  readonly state: ScreenState;
  readonly events: readonly GameEvent[];
}

/** Negative id allocator: disjoint from `host-ordnance`'s 1, 2, 3, … */
export function screenVolumeId(instanceId: number, slot: number): number {
  return -(instanceId * 16 + slot);
}

function layoutVolumes(
  instanceId: number, x: number, y: number, z: number,
): readonly ScreenVolume[] {
  const out: ScreenVolume[] = [{ id: screenVolumeId(instanceId, 1), x, y, z }];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    out.push({
      id: screenVolumeId(instanceId, i + 2),
      x: x + Math.cos(a) * SCREEN_RING_M,
      y,
      z: z + Math.sin(a) * SCREEN_RING_M,
    });
  }
  return Object.freeze(out);
}

export function createScreen(
  instanceId: number,
  actorId: ActorId,
  team: TeamId,
  streakId: string,
  durationMs: number,
  place: { readonly x: number; readonly y: number; readonly z: number },
  nowMs: number,
): ScreenState {
  const y = place.y + SCREEN_HEIGHT_M;
  const volumes = layoutVolumes(instanceId, place.x, y, place.z);
  const lifetime = Math.max(0, durationMs);
  return Object.freeze({
    kind: 'screen' as const,
    instanceId,
    actorId,
    team,
    streakId,
    remainingMs: lifetime,
    x: place.x,
    y: place.y,
    z: place.z,
    volumes,
    diesAt: nowMs + lifetime,
  });
}

/** The bus announcements for a fresh screen, in volume order. */
export function screenVolumeEvents(state: ScreenState, at: number): readonly SmokeVolumeEvent[] {
  return state.volumes.map((v) => Object.freeze({
    type: 'smoke-volume' as const,
    at,
    id: v.id,
    x: v.x,
    y: v.y,
    z: v.z,
    radius: SMOKE_RADIUS_M,
    bornAt: at,
    diesAt: state.diesAt,
    kind: 'grenade' as const,
  }));
}

export function publishScreenVolumes(state: ScreenState, world: WorldQuery, bornAt: number): void {
  const sight = sightOf(world);
  if (sight === null) return;
  for (const v of state.volumes) {
    sight.add({
      id: v.id, x: v.x, y: v.y, z: v.z,
      radius: SMOKE_RADIUS_M, bornAt, diesAt: state.diesAt,
      kind: 'grenade',
    });
  }
}

export function stepScreen(state: ScreenState, dt: number, ctx: ScreenTickContext): ScreenTick {
  const step = dt > 0 ? dt : 0;
  const remainingMs = state.remainingMs - step;
  if (remainingMs > 0) {
    return { state: Object.freeze({ ...state, remainingMs }), events: [] };
  }
  // Final tick: withdraw first, so the bus can never carry a live screen
  // whose volumes still block sight (or vice versa).
  const sight = sightOf(ctx.world);
  if (sight !== null) {
    for (const v of state.volumes) sight.remove(v.id);
  }
  const events: SmokeVolumeEndEvent[] = state.volumes.map((v) => Object.freeze({
    type: 'smoke-volume-end' as const,
    at: ctx.now,
    id: v.id,
  }));
  return { state: Object.freeze({ ...state, remainingMs: 0 }), events };
}
