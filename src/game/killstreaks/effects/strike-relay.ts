/**
 * Strike Relay: three deterministic ground bursts along the admitted aim line.
 *
 * Nuketown has no aircraft altitude model, so this is a relay of overhead
 * impacts, not a pretend plane.  The anchor and aim yaw still produce a real
 * target-line: three separated bursts travel in the player's forward bearing.
 * Cover does not block the indirect pulses; the small radius and finite cadence
 * leave a counterplay window between impacts.
 */

import type { ActorId, DamageEvent, GameEvent, TeamId } from '../../events';
import type { SentryTarget } from './sentry';

export const STRIKE_RELAY_PASSES = 3;
export const STRIKE_RELAY_FIRST_MS = 500;
export const STRIKE_RELAY_INTERVAL_MS = 650;
export const STRIKE_RELAY_SPACING_M = 7;
export const STRIKE_RELAY_RADIUS_M = 3.5;
export const STRIKE_RELAY_MAX_DAMAGE = 42;

export interface StrikeRelayState {
  readonly kind: 'strike-relay';
  readonly instanceId: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly remainingMs: number;
  readonly elapsedMs: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly aimYaw: number;
  readonly fired: number;
}

export interface StrikeRelayTickContext {
  readonly now: number;
  readonly targets: readonly SentryTarget[];
}

export interface StrikeRelayTick { readonly state: StrikeRelayState; readonly events: readonly GameEvent[] }

export function createStrikeRelay(
  instanceId: number,
  actorId: ActorId,
  team: TeamId,
  streakId: string,
  durationMs: number,
  place: { readonly x: number; readonly y: number; readonly z: number },
  aimYaw: number,
): StrikeRelayState {
  return Object.freeze({
    kind: 'strike-relay' as const,
    instanceId,
    actorId,
    team,
    streakId,
    remainingMs: Math.max(0, durationMs),
    elapsedMs: 0,
    x: place.x,
    y: place.y,
    z: place.z,
    aimYaw,
    fired: 0,
  });
}

export function strikeRelayPulseTimeMs(index: number): number {
  return STRIKE_RELAY_FIRST_MS + index * STRIKE_RELAY_INTERVAL_MS;
}

export function strikeRelayPulseAt(state: StrikeRelayState, index: number): { x: number; z: number } {
  const distance = index * STRIKE_RELAY_SPACING_M;
  return {
    x: state.x - Math.sin(state.aimYaw) * distance,
    z: state.z - Math.cos(state.aimYaw) * distance,
  };
}

function pulseDamage(distance: number): number {
  if (distance > STRIKE_RELAY_RADIUS_M) return 0;
  const t = distance / STRIKE_RELAY_RADIUS_M;
  return Math.max(1, Math.round(STRIKE_RELAY_MAX_DAMAGE * (1 - 0.62 * t)));
}

export function stepStrikeRelay(state: StrikeRelayState, dt: number, ctx: StrikeRelayTickContext): StrikeRelayTick {
  const step = dt > 0 ? dt : 0;
  const elapsedMs = state.elapsedMs + step;
  const events: GameEvent[] = [];
  const health = new Map<ActorId, number>(ctx.targets.map((target) => [target.id, target.health]));
  let fired = state.fired;
  let firedThisStep = 0;
  while (fired < STRIKE_RELAY_PASSES && firedThisStep < STRIKE_RELAY_PASSES
    && elapsedMs >= strikeRelayPulseTimeMs(fired)) {
    const pulse = strikeRelayPulseAt(state, fired);
    const victims = ctx.targets
      .filter((target) => target.alive && target.health > 0 && target.team !== state.team && target.id !== state.actorId)
      .map((target) => ({ target, distance: Math.hypot(target.x - pulse.x, target.z - pulse.z) }))
      .filter((entry) => entry.distance <= STRIKE_RELAY_RADIUS_M)
      .sort((a, b) => a.distance - b.distance || a.target.id.localeCompare(b.target.id));
    for (const victim of victims) {
      const before = health.get(victim.target.id) ?? victim.target.health;
      if (before <= 0) continue;
      const amount = pulseDamage(victim.distance);
      const after = Math.max(0, before - amount);
      health.set(victim.target.id, after);
      const event: DamageEvent = Object.freeze({
        type: 'damage', at: ctx.now, attackerId: state.actorId, attackerTeam: state.team,
        victimId: victim.target.id, victimTeam: victim.target.team, amount, cause: 'streak',
        zone: 'body', weaponId: '', distance: victim.distance, healthAfter: after,
        sourceX: pulse.x, sourceZ: pulse.z,
      });
      events.push(event);
    }
    fired++;
    firedThisStep++;
  }
  return {
    state: Object.freeze({ ...state, remainingMs: state.remainingMs - step, elapsedMs, fired }),
    events,
  };
}
