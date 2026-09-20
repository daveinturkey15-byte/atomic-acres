/**
 * Nuketown 2025 — the CROSSBOW half of the vocabulary: host-authoritative
 * bolt launch + terminal point (CANARY, gated).
 *
 * Mirrors the grenade contract in `events-ordnance.ts` exactly: the launch
 * carries LAUNCH STATE, not a trajectory — presentation replays the same pure
 * stepper (`weapons/crossbow-runtime.ts:advanceBolt`) against the same
 * `WorldQuery`, and the impact event snaps it to the authoritative point.
 * Guests never author one; a guest claim naming these ids is data, never an
 * instruction (same rule as the mortar slice).
 *
 * Folded into `GameEvent` by `events.ts`, NOT into `OrdnanceEvent`, so
 * `ordnance-view.ts` stays untouched and a future `BoltView` owns exactly
 * these two (the mortar precedent). The bounded visual source is the host
 * pool cap (`host-crossbow.ts:CROSSBOW_POOL`, 16 = `ordnance-view.ts`
 * `FLIGHT_POOL`): every live bolt has a visual slot, and a 17th concurrent
 * launch is dropped, never queued.
 */

import type { ActorId, HitZone, TeamId } from './vocab';

/** Host admitted a bolt: draw it NOW, replaying the shared stepper. */
export interface BoltLaunchedEvent {
  readonly type: 'bolt-launched';
  readonly at: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  /** Host-assigned handle for this live bolt. */
  readonly boltId: number;
  /** The exactly-once claim this bolt was admitted under. */
  readonly seq: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  /** Host time the bolt MUST be dead (launch + lifetime). */
  readonly expiresAt: number;
}

/** Authoritative terminal point: one bolt, one conclusion, at most one victim. */
export interface BoltImpactEvent {
  readonly type: 'bolt-impact';
  readonly at: number;
  /** Host handle from the launch. */
  readonly boltId: number;
  /** null when the owner has left the match. */
  readonly actorId: ActorId | null;
  readonly team: TeamId | null;
  /** null for a wall or an expiry — a miss is an impact with no victim. */
  readonly victimId: ActorId | null;
  readonly zone: HitZone | null;
  /** Metres from the admitted muzzle to this point. */
  readonly distance: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly stopped: 'victim' | 'wall' | 'expired';
}

export type CrossbowEvent = BoltLaunchedEvent | BoltImpactEvent;

/** Every crossbow discriminant, frozen. `events.ts` spreads it into the full list. */
export const CROSSBOW_EVENT_TYPES = ['bolt-launched', 'bolt-impact'] as const;
export type CrossbowEventType = (typeof CROSSBOW_EVENT_TYPES)[number];

export function isCrossbowEventType(v: unknown): v is CrossbowEventType {
  return typeof v === 'string' && (CROSSBOW_EVENT_TYPES as readonly string[]).includes(v);
}

/** True for either host-authoritative bolt event. Narrows, so routers fold the event without a cast. */
export function isCrossbowEvent(e: { readonly type: string }): e is CrossbowEvent {
  return e.type === 'bolt-launched' || e.type === 'bolt-impact';
}
