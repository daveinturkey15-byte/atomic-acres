/** Reward-only support effects. The runtime owns when a reward is granted. */

import type { ActorId, DamageEvent, TeamId } from '../../events';
import type { SentryTarget } from './sentry';

/** Field Repair is a host-side health adjustment; this is the bounded amount. */
export const FIELD_REPAIR_HEAL = 35;
/** Last Resort keeps the old top-band shape without inventing an aircraft. */
export const LAST_RESORT_DAMAGE = 1_000;
export const DEFAULT_MAX_HEALTH = 100;

export interface RewardGrant {
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly reward: 'field-repair' | 'adrenaline' | 'crimson-flamethrower';
  readonly durationMs?: number;
  readonly instanceId: number;
  readonly at: number;
}

export function fieldRepairHealth(current: number, maxHealth = DEFAULT_MAX_HEALTH): number {
  if (!Number.isFinite(current) || !Number.isFinite(maxHealth)) return 0;
  return Math.min(Math.max(0, maxHealth), Math.max(0, current) + FIELD_REPAIR_HEAL);
}

/** A deterministic host event list for the reward's map-wide hostile strike. */
export function lastResortEvents(
  actorId: ActorId,
  team: TeamId,
  now: number,
  targets: readonly SentryTarget[],
): readonly DamageEvent[] {
  const out: DamageEvent[] = [];
  for (const target of [...targets].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!target.alive || target.health <= 0 || target.team === team || target.id === actorId) continue;
    out.push(Object.freeze({
      type: 'damage', at: now, attackerId: actorId, attackerTeam: team,
      victimId: target.id, victimTeam: target.team, amount: Math.min(LAST_RESORT_DAMAGE, target.health),
      cause: 'streak', zone: 'body', weaponId: '', distance: 0, healthAfter: 0,
      sourceX: target.x, sourceZ: target.z,
    }));
  }
  return Object.freeze(out);
}
