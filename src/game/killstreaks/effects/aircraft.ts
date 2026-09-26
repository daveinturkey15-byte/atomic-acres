/** Native host-only support aircraft. Pure bounded simulation; no renderer or wall-clock. */
import type { ActorId, DamageEvent, GameEvent, TeamId, Vec3, WorldQuery } from '../../events';
import type { SentryTarget } from './sentry';
import type { PilotInput } from '../pilot-types';
export type { PilotInput } from '../pilot-types';

export const AIRCRAFT_VARIANTS = ['yardhawk', 'piloted-drone', 'hunter-swarm', 'chopper', 'drone-swarm'] as const;
export type AircraftVariant = (typeof AIRCRAFT_VARIANTS)[number];
export const PILOT_INPUT_HOLD_MS = 250;
export const AIRCRAFT_STEP_MS = 250;
interface Drone extends Vec3 { readonly cooldownMs: number; readonly alive: boolean }
export interface AircraftState {
  readonly kind: 'aircraft'; readonly variant: AircraftVariant;
  readonly instanceId: number; readonly actorId: ActorId; readonly team: TeamId; readonly streakId: string;
  readonly remainingMs: number; readonly elapsedMs: number;
  readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly pitch: number;
  readonly units: number; readonly health: number; readonly controlled: boolean; readonly shots: number;
  readonly anchor: Vec3; readonly phase: number; readonly drones: readonly Drone[];
  readonly input: PilotInput | null; readonly inputAt: number; readonly lastInputSeq: number;
}
export interface AircraftContext { readonly now: number; readonly world: WorldQuery; readonly targets: readonly SentryTarget[]; readonly freeForAll?: boolean }
export interface AircraftTick { readonly state: AircraftState; readonly events: readonly GameEvent[] }

export function isAircraftVariant(id: string): id is AircraftVariant {
  return (AIRCRAFT_VARIANTS as readonly string[]).includes(id);
}
export function createAircraft(instanceId: number, actorId: ActorId, team: TeamId, variant: AircraftVariant,
  durationMs: number, origin: Vec3, yaw: number, seed: number): AircraftState {
  const units = variant === 'hunter-swarm' ? 3 : variant === 'drone-swarm' ? 5 : 1;
  const y = origin.y + (variant === 'chopper' ? 12 : 8);
  return Object.freeze({ kind: 'aircraft', variant, instanceId, actorId, team, streakId: variant,
    remainingMs: durationMs, elapsedMs: 0, x: origin.x, y, z: origin.z, yaw, pitch: 0,
    units, health: 100, controlled: variant === 'piloted-drone', shots: 0,
    anchor: Object.freeze({ ...origin }), phase: (seed % 2048) / 2048 * Math.PI * 2,
    drones: Object.freeze(Array.from({ length: units }, (_, n) => Object.freeze({
      x: origin.x, y: y + n * .4, z: origin.z, alive: true, cooldownMs: 600 + n * 140,
    }))), input: null, inputAt: -Infinity, lastInputSeq: -1,
  });
}

/** Never accept client positions, speed, health, targets or expiry. */
export function acceptPilotInput(state: AircraftState, input: PilotInput, now: number): AircraftState | null {
  if (!state.controlled || state.variant !== 'piloted-drone' || state.remainingMs <= 0 || state.health <= 0
    || !Number.isFinite(now) || now < state.inputAt || !Number.isSafeInteger(input.seq) || input.seq < 0
    || input.seq <= state.lastInputSeq || typeof input.fire !== 'boolean') return null;
  if (![input.forward, input.strafe, input.ascend].every((v) => Number.isFinite(v) && Math.abs(v) <= 1)
    || !Number.isFinite(input.yaw) || Math.abs(input.yaw) > 1_000_000
    || !Number.isFinite(input.pitch) || Math.abs(input.pitch) > Math.PI / 2) return null;
  const yaw = Math.atan2(Math.sin(input.yaw), Math.cos(input.yaw));
  return Object.freeze({ ...state, input: Object.freeze({ ...input, yaw }), inputAt: now, lastInputSeq: input.seq });
}

export function toggleAircraftControl(state: AircraftState): AircraftState {
  return Object.freeze({ ...state, controlled: !state.controlled, input: null, inputAt: -Infinity });
}
export function releaseAircraftControl(state: AircraftState): AircraftState {
  return Object.freeze({ ...state, controlled: false, input: null, inputAt: -Infinity, lastInputSeq: -1 });
}

function moveToward(a: Vec3, b: Vec3, distance: number, world: WorldQuery): Vec3 {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const length = Math.hypot(dx, dy, dz), f = length > 0 ? Math.min(1, distance / length) : 0;
  const next = { x: a.x + dx * f, y: a.y + dy * f, z: a.z + dz * f };
  if (!world.inBounds(next.x, next.z) || !world.lineOfSight(a, next)) return a;
  const ground = world.groundY(next.x, next.z);
  if (!Number.isFinite(ground)) return a;
  return { ...next, y: Math.max(ground + 1.4, Math.min(ground + 24, next.y)) };
}

function hostileTargets(state: AircraftState, ctx: AircraftContext): SentryTarget[] {
  return ctx.targets.filter((t) => t.alive && t.health > 0 && (ctx.freeForAll || t.team !== state.team) && t.id !== state.actorId)
    .sort((a, b) => a.id.localeCompare(b.id));
}
function nearest(drone: Vec3, targets: readonly SentryTarget[], world: WorldQuery): SentryTarget | null {
  let best: SentryTarget | null = null, range = 65;
  for (const t of targets) {
    const d = Math.hypot(t.x - drone.x, t.y + 1.2 - drone.y, t.z - drone.z);
    if (d < range && world.lineOfSight(drone, { x: t.x, y: t.y + 1.2, z: t.z })) { best = t; range = d; }
  }
  return best;
}
function hit(state: AircraftState, from: Vec3, target: SentryTarget, amount: number, now: number, health: number): DamageEvent {
  return Object.freeze({ type: 'damage', at: now, attackerId: state.actorId, attackerTeam: state.team,
    victimId: target.id, victimTeam: target.team, amount, healthAfter: Math.max(0, health - amount),
    cause: 'streak', zone: 'body', weaponId: '', distance: Math.hypot(target.x - from.x, target.y - from.y, target.z - from.z),
    sourceX: from.x, sourceZ: from.z });
}
function aimedTarget(drone: Vec3, input: PilotInput, targets: readonly SentryTarget[], world: WorldQuery): SentryTarget | null {
  const cp = Math.cos(input.pitch);
  const dir = { x: -Math.sin(input.yaw) * cp, y: Math.sin(input.pitch), z: -Math.cos(input.yaw) * cp };
  let best: SentryTarget | null = null, nearestAlong = 65;
  for (const t of targets) {
    const dx = t.x - drone.x, dy = t.y + 1.2 - drone.y, dz = t.z - drone.z;
    const along = dx * dir.x + dy * dir.y + dz * dir.z;
    const missSq = dx * dx + dy * dy + dz * dz - along * along;
    if (along > 0 && along < nearestAlong && missSq <= 1.1 * 1.1
      && world.lineOfSight(drone, { x: t.x, y: t.y + 1.2, z: t.z })) { best = t; nearestAlong = along; }
  }
  return best;
}

export function stepAircraft(state: AircraftState, dt: number, ctx: AircraftContext): AircraftTick {
  const step = Math.min(AIRCRAFT_STEP_MS, Math.max(0, Number.isFinite(dt) ? dt : 0), state.remainingMs);
  if (step <= 0 || state.health <= 0) return { state, events: [] };
  const secs = step / 1000, elapsedMs = state.elapsedMs + step;
  const events: GameEvent[] = [], health = new Map(ctx.targets.map((t) => [t.id, t.health]));
  const targets = hostileTargets(state, ctx);
  const input = state.controlled && state.input && ctx.now >= state.inputAt && ctx.now - state.inputAt <= PILOT_INPUT_HOLD_MS ? state.input : null;
  let shots = state.shots, yaw = state.yaw, pitch = state.pitch;
  const drones = state.drones.map((drone, index): Drone => {
    if (!drone.alive) return drone;
    let position: Vec3 = drone, cooldownMs = Math.max(-600, drone.cooldownMs - step);
    let target = nearest(drone, targets.filter((t) => (health.get(t.id) ?? 0) > 0), ctx.world);
    if (state.variant === 'piloted-drone') {
      if (input) {
        yaw = input.yaw; pitch = input.pitch;
        const flatLength = Math.max(1, Math.hypot(input.forward, input.strafe, input.ascend));
        position = moveToward(drone, {
          x: drone.x + (-Math.sin(yaw) * input.forward + Math.cos(yaw) * input.strafe) / flatLength * 10 * secs,
          y: drone.y + input.ascend / flatLength * 10 * secs,
          z: drone.z + (-Math.cos(yaw) * input.forward - Math.sin(yaw) * input.strafe) / flatLength * 10 * secs,
        }, 10 * secs, ctx.world);
      }
      target = input?.fire ? aimedTarget(position, input, targets.filter((t) => (health.get(t.id) ?? 0) > 0), ctx.world) : null;
      if (input?.fire && cooldownMs <= 0) {
        shots++; cooldownMs = 280;
        if (target) { const e = hit(state, position, target, 32, ctx.now, health.get(target.id)!); health.set(target.id, e.healthAfter); events.push(e); }
      }
    } else if (state.variant === 'hunter-swarm' && target) {
      position = moveToward(drone, { x: target.x, y: target.y + 1.2, z: target.z }, 13 * secs, ctx.world);
      if (Math.hypot(position.x - target.x, position.y - target.y - 1.2, position.z - target.z) < 1.8) {
        let victims = 0;
        for (const t of targets) {
          if ((health.get(t.id) ?? 0) <= 0 || Math.hypot(t.x - position.x, t.y + 1.2 - position.y, t.z - position.z) > 3.5
            || !ctx.world.lineOfSight(position, { x: t.x, y: t.y + 1.2, z: t.z })) continue;
          const e = hit(state, position, t, 80, ctx.now, health.get(t.id)!); health.set(t.id, e.healthAfter); events.push(e); victims++;
        }
        events.unshift({ type: 'mortar-impact', at: ctx.now, instanceId: state.instanceId, actorId: state.actorId, team: state.team,
          streakId: state.streakId, index, x: position.x, y: position.y, z: position.z, victims });
        shots++; return Object.freeze({ ...position, cooldownMs: 0, alive: false });
      }
    } else {
      const angle = state.phase + elapsedMs / (state.variant === 'chopper' ? 3500 : 2200) + index * Math.PI * 2 / state.drones.length;
      const centre = state.variant === 'drone-swarm' && target ? target : state.anchor;
      const radius = state.variant === 'chopper' ? 14 : state.variant === 'drone-swarm' ? 4 : 9;
      position = moveToward(drone, { x: centre.x + Math.cos(angle) * radius,
        y: centre.y + (state.variant === 'chopper' ? 12 : 8), z: centre.z + Math.sin(angle) * radius }, 9 * secs, ctx.world);
      target = nearest(position, targets.filter((t) => (health.get(t.id) ?? 0) > 0), ctx.world);
      if (target && cooldownMs <= 0) {
        const amount = state.variant === 'chopper' ? 22 : state.variant === 'drone-swarm' ? 8 : 17;
        const e = hit(state, position, target, amount, ctx.now, health.get(target.id)!); health.set(target.id, e.healthAfter); events.push(e);
        cooldownMs = state.variant === 'chopper' ? 320 : 550; shots++;
      }
      if (index === 0) { yaw = target ? Math.atan2(position.x - target.x, position.z - target.z) : -angle; pitch = 0; }
    }
    return Object.freeze({ ...position, cooldownMs, alive: true });
  });
  const live = drones.filter((d) => d.alive), lead = live[0] ?? state;
  return { state: Object.freeze({ ...state, x: lead.x, y: lead.y, z: lead.z, yaw, pitch, elapsedMs, shots,
    units: live.length, remainingMs: live.length ? state.remainingMs - step : 0, drones: Object.freeze(drones) }), events };
}
