/** Single native effect dispatch table, kept out of the earn/spend ledger. */
import type { ActorId, GameEvent, TeamId, Vec3, WorldQuery } from '../events';
import type { StreakCatalog } from './catalog';
import { createRecon, stepRecon, type ReconState } from './effects/recon';
import { createCounterRecon, stepCounterRecon, type CounterReconState } from './effects/counter-recon';
import { createSentry, stepSentry, type SentryState, type SentryTarget } from './effects/sentry';
import { createMortar, stepMortar, type MortarState } from './effects/mortar';
import { createDart, stepDart, type DartState } from './effects/dart';
import { createFallout, stepFallout, type FalloutState } from './effects/fallout';
import { createStrikeRelay, stepStrikeRelay, type StrikeRelayState } from './effects/strike-relay';
import { createSupplyCrate, stepSupplyCrate, type SupplyCrateState } from './effects/supply-crate';
import { createAircraft, isAircraftVariant, stepAircraft, type AircraftState } from './effects/aircraft';
import { createCarpet, stepCarpet, type CarpetState } from './effects/carpet';
import { createTimedSupport, type TimedSupportState } from './effects/timed-support';
import { lastResortEvents } from './effects/rewards';

export const EFFECT_KIND = Object.freeze({
  'recon-sweep': 'recon', 'signal-jam': 'counter-recon', 'sentry-post': 'sentry', 'blast-mortar': 'mortar',
  'tracker-dart': 'dart', 'fallout-screen': 'fallout', 'strike-relay': 'strike-relay', 'supply-crate': 'supply-crate',
  adrenaline: 'timed-support', 'last-resort': 'timed-support', yardhawk: 'aircraft', 'piloted-drone': 'aircraft',
  'hunter-swarm': 'aircraft', chopper: 'aircraft', 'drone-swarm': 'aircraft', 'carpet-bomber': 'carpet-bomber',
} as const);
export type EffectKind = (typeof EFFECT_KIND)[keyof typeof EFFECT_KIND];
export function effectKind(id: string): EffectKind | undefined { return (EFFECT_KIND as Readonly<Record<string, EffectKind>>)[id]; }
export const WIRED_STREAK_IDS: readonly string[] = Object.freeze(Object.keys(EFFECT_KIND));
export type LiveInstance = ReconState | CounterReconState | SentryState | MortarState | DartState | FalloutState
  | StrikeRelayState | SupplyCrateState | AircraftState | CarpetState | TimedSupportState;

export function createEffect(p: {
  instanceId: number; actorId: ActorId; team: TeamId; streakId: string; durationMs: number;
  seed: number; anchor: Vec3; aimYaw: number; catalog: StreakCatalog<string>; corridor: readonly Vec3[] | null;
}): LiveInstance {
  const { instanceId: id, actorId: actor, team, streakId: streak, durationMs: duration, seed, anchor, aimYaw } = p;
  if (isAircraftVariant(streak)) return createAircraft(id, actor, team, streak, duration, anchor, aimYaw, seed);
  switch (effectKind(streak)) {
    case 'recon': return createRecon(id, actor, team, streak, duration, seed);
    case 'counter-recon': return createCounterRecon(id, actor, team, streak, duration);
    case 'mortar': return createMortar(id, actor, team, streak, duration, anchor, seed);
    case 'dart': return createDart(id, actor, team, streak, duration, anchor, seed);
    case 'fallout': return createFallout(id, actor, team, streak, duration, anchor);
    case 'strike-relay': return createStrikeRelay(id, actor, team, streak, duration, anchor, aimYaw);
    case 'supply-crate': return createSupplyCrate(id, actor, team, streak, duration, anchor, seed, p.catalog);
    case 'carpet-bomber': return createCarpet(id, actor, team, duration, anchor, aimYaw, p.corridor!);
    case 'timed-support': return createTimedSupport(id, actor, team, streak, duration);
    case 'sentry': return createSentry(id, actor, team, streak, duration, anchor, aimYaw, seed);
    default: throw new Error(`Unwired effect ${streak}`);
  }
}

export function stepEffect(state: LiveInstance, dt: number, ctx: {
  now: number; world: WorldQuery; targets: readonly SentryTarget[]; freeForAll: boolean;
}): { readonly state: LiveInstance; readonly events: readonly GameEvent[] } {
  switch (state.kind) {
    case 'recon': return stepRecon(state, dt, ctx);
    case 'counter-recon': return stepCounterRecon(state, dt, ctx);
    case 'mortar': return stepMortar(state, dt, ctx);
    case 'dart': return stepDart(state, dt, ctx);
    case 'fallout-screen': return stepFallout(state, dt);
    case 'strike-relay': return stepStrikeRelay(state, dt, ctx);
    case 'supply-crate': return stepSupplyCrate(state, dt, ctx);
    case 'sentry': return stepSentry(state, dt, ctx);
    case 'aircraft': return stepAircraft(state, dt, ctx);
    case 'carpet-bomber': return stepCarpet(state, dt, ctx);
    case 'timed-support': return { state: Object.freeze({ ...state, remainingMs: state.remainingMs - dt }),
      events: state.streakId === 'last-resort' && dt > 0 ? lastResortEvents(state.actorId, state.team, ctx.now, ctx.targets) : [] };
  }
}
