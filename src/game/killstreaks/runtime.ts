/** Host-only earn/spend ledger. Effects and read-only projections live in sibling modules.
 * Death clears the ladder but retains the bank; full banks apply backpressure.
 * Match/life epochs, monotonic sequence and bounded claim IDs reject replay.
 * All placement/capacity checks precede payment. Streak damage cannot farm the ladder.
 * Effects are seeded, capped to12 live instances and stepped at most250ms per call.
 * The host alone writes health/score; this module emits admitted events.
 */

import {
  STREAK_DENIAL_LABELS,
  type ActorId, type DamageCause, type DamageEvent, type GameEvent,
  type StreakActivatedEvent, type StreakDeniedEvent, type StreakDenialReason,
  type StreakEndReason, type StreakEndedEvent, type TeamId, type Vec3, type WorldQuery,
} from '../events';
import type { StreakSlotState, StreakStateMsg } from '../../net/protocol';
import {
  DEFAULT_STREAK_LOADOUT, STREAK_CATALOG, streakById, validateStreakLoadout,
  type StreakCatalog, type StreakLoadout,
} from './catalog';
import { evaluateActivation, rejectedOutcome, type ActivationContext, type StreakClaimReject } from './gate';
import { validateSentryPlacement, type SentryTarget } from './effects/sentry';
import { validateMortarPlacement } from './effects/mortar';
import { crateGrantFits } from './effects/supply-crate';
import { lastResortEvents, type RewardGrant } from './effects/rewards';
import type { RadarSample } from './effects/reveal';
import type { StreakEffectView } from './effect-view';
import { effectSnapshot, revealedFor, radarFor } from './projections';
import { earnElimination, type ActorLedger } from './earning';
import { createEffect, effectKind, stepEffect, type LiveInstance } from './behaviors';
import { acceptPilotInput, releaseAircraftControl, toggleAircraftControl, type AircraftState } from './effects/aircraft';
import { carpetCorridor } from './effects/carpet';
import type { PilotInput, AircraftTarget } from './pilot-types';
export { WIRED_STREAK_IDS, type LiveInstance } from './behaviors';

export { STREAK_CLAIM_REJECTS, STREAK_CLAIM_REJECT_LABELS, type ActivationContext, type StreakClaimReject } from './gate';

/** Bank8, claims512, live12; stalled frames lose excess time rather than banking bursts. */
export const MAX_BANKED_STREAKS = 8;
export const MAX_CHARGES_PER_STREAK = 255;
export const MAX_SEEN_CLAIMS = 512;
export const MAX_LIVE_INSTANCES = 12;
export const ADVANCE_DT_CAP_MS = 250;
export const MAX_LADDER_KILLS = 100_000;

export type StreakTarget = SentryTarget;

/**
 * A press. `slot` is 1-based as on the key; `seq` is per-actor monotonic and
 * advances only on an ACCEPTED activation; `claimId` is the globally unique
 * exactly-once key; `anchor` places a `target-point` streak, else `origin`.
 */
export interface StreakIntent {
  readonly actorId: ActorId;
  readonly slot: number;
  readonly seq: number;
  readonly claimId: string;
  readonly life: number;
  readonly matchEpoch: number;
  readonly toggle: boolean;
  readonly origin: Vec3;
  readonly aimYaw: number;
  readonly anchor?: Vec3 | null;
  readonly context: ActivationContext;
}

export type ActivationOutcome =
  | { readonly accepted: true; readonly streakId: string; readonly instanceId: number; readonly chargesLeft: number; readonly events: readonly GameEvent[] }
  | { readonly accepted: false; readonly outcome: 'denied'; readonly reason: StreakDenialReason; readonly label: string; readonly events: readonly GameEvent[] }
  | { readonly accepted: false; readonly outcome: 'rejected'; readonly reason: StreakClaimReject; readonly label: string; readonly events: readonly GameEvent[] };

function hash32(seed: number, ordinal: number, text: string): number {
  let h = Math.imul((seed ^ 0x9e3779b9) >>> 0 ^ ordinal, 0x85ebca6b) >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

export class StreakRuntime {
  effectSnapshot(): readonly StreakEffectView[] { return effectSnapshot(this.liveInstances()); }
  private readonly catalog: StreakCatalog<string>;
  private readonly seed: number;
  private readonly matchEpoch: number;
  private readonly freeForAll: boolean;
  private readonly actors = new Map<ActorId, ActorLedger>();
  private readonly live = new Map<number, LiveInstance>();
  private readonly seenClaims = new Set<string>();
  private readonly claimOrder: string[] = [];
  private instances = 0;
  private activations = 0;
  private lastAdvanceAt: number | null = null;
  private nowMs = 0;
  private readonly pendingRewards: RewardGrant[] = [];

  constructor(opts: { seed?: number; matchEpoch?: number; catalog?: StreakCatalog<string>; mode?: 'tdm' | 'ffa' | 'domination' } = {}) {
    this.catalog = opts.catalog ?? STREAK_CATALOG;
    this.seed = (opts.seed ?? 1) >>> 0;
    this.matchEpoch = opts.matchEpoch ?? 0;
    this.freeForAll = opts.mode === 'ffa';
  }

  /** Rejoin refreshes identity/sequence while preserving earned bank; invalid classes fail explicitly. */
  registerActor(actorId: ActorId, team: TeamId, loadout: StreakLoadout = DEFAULT_STREAK_LOADOUT, life = 0): void {
    const check = validateStreakLoadout(loadout, this.catalog);
    if (!check.valid) throw new Error(`streak loadout for ${actorId}: ${check.errors.join('; ')}`);
    const frozen = Object.freeze([...loadout]);
    const a = this.actors.get(actorId);
    if (a) {
      a.team = team; a.loadout = frozen; a.life = life; a.lastSeq = -1;
      return;
    }
    this.actors.set(actorId, {
      actorId, team, loadout: frozen, life, kills: 0, cycle: 0,
      earned: new Set(), charges: new Map(), lastSeq: -1, cause: null, at: this.nowMs,
    });
  }

  /** HUD total comes from scoring; the separate per-cycle ladder ignores streak-caused kills. */
  recordElimination(actorId: ActorId, streak: number, at: number, cause: DamageCause = 'bullet'): GameEvent[] {
    const a = this.actors.get(actorId);
    if (!a) return [];
    this.nowMs = at;
    return earnElimination(a, streak, at, cause, this.catalog,
      { ladder: MAX_LADDER_KILLS, bank: MAX_BANKED_STREAKS, charges: MAX_CHARGES_PER_STREAK });
  }

  /** Rule 1. Ladder and cycle reset; the BANK does not, and entities already paid for keep running. Returns [] so a host can splice it into one event list. */
  recordDeath(actorId: ActorId, at: number): GameEvent[] {
    const a = this.actors.get(actorId);
    if (!a) return [];
    this.nowMs = a.at = at;
    a.kills = a.cycle = 0;
    a.life += 1; a.lastSeq = -1; a.earned.clear();
    this.releasePilot(actorId);
    for (const [id, instance] of this.live) if (instance.actorId === actorId && instance.kind === 'timed-support') this.live.delete(id);
    for (let i = this.pendingRewards.length - 1; i >= 0; i--) if (this.pendingRewards[i].actorId === actorId) this.pendingRewards.splice(i, 1);
    return [];
  }

  /** A transport drop: the sequence domain restarts so a replacement may begin at 0, while claim ids stay globally replay-protected and the bank is untouched, so a rejoin resumes exactly where it stopped. */
  recordDisconnect(actorId: ActorId, _at?: number): GameEvent[] {
    const a = this.actors.get(actorId);
    if (a) a.lastSeq = -1;
    this.releasePilot(actorId);
    return [];
  }

  /** Life epoch the host must echo in a claim. */
  lifeOf(actorId: ActorId): number | null {
    return this.actors.get(actorId)?.life ?? null;
  }

  /** Charges banked. The gate's `earned` is read from here, never from a claim. */
  chargesOf(actorId: ActorId, streakId: string): number {
    return this.actors.get(actorId)?.charges.get(streakId) ?? 0;
  }

  /** The fifth HUD row is the oldest unslotted crate reward, never saved as a class slot. */
  private bonusFor(a: ActorLedger): string | null {
    for (const [id, charges] of a.charges) if (charges > 0 && !a.loadout.includes(id as StreakLoadout[number])) return id;
    return null;
  }

  pilotFor(actorId: ActorId): AircraftState | null {
    for (const s of this.live.values()) if (s.kind === 'aircraft' && s.variant === 'piloted-drone'
      && s.actorId === actorId && s.controlled && s.remainingMs > 0 && s.health > 0) return s;
    return null;
  }
  private releasePilot(actorId: ActorId): void {
    for (const [id, s] of this.live) if (s.kind === 'aircraft' && s.actorId === actorId && s.controlled) this.live.set(id, releaseAircraftControl(s));
  }
  submitPilotInput(actorId: ActorId, input: PilotInput, now: number, _world: WorldQuery): boolean {
    const state = this.pilotFor(actorId);
    const next = state && acceptPilotInput(state, input, now);
    if (!next) return false;
    this.live.set(next.instanceId, next); return true;
  }
  aircraftTargets(): readonly AircraftTarget[] {
    const out: AircraftTarget[] = [];
    for (const s of this.live.values()) if (s.kind === 'aircraft' && s.remainingMs > 0 && s.health > 0) {
      for (const d of s.drones) if (d.alive) out.push(Object.freeze({ instanceId: s.instanceId, actorId: s.actorId,
        team: s.team, x: d.x, y: d.y, z: d.z, radius: s.variant === 'chopper' ? 2.1 : .85, health: s.health }));
    }
    return Object.freeze(out);
  }
  damageAircraft(instanceId: number, attackerId: ActorId, attackerTeam: TeamId, amount: number, now: number): GameEvent[] {
    const s = this.live.get(instanceId);
    if (!s || s.kind !== 'aircraft' || s.actorId === attackerId || (!this.freeForAll && s.team === attackerTeam)
      || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(now)) return [];
    const health = Math.max(0, s.health - Math.min(100, amount));
    if (health <= 0) return [this.retire(instanceId, s, now, 'destroyed')];
    this.live.set(instanceId, Object.freeze({ ...s, health })); return [];
  }

  private rememberClaim(claimId: string): void {
    this.seenClaims.add(claimId);
    this.claimOrder.push(claimId);
    while (this.claimOrder.length > MAX_SEEN_CLAIMS) this.seenClaims.delete(this.claimOrder.shift() as string);
  }

  activate(intent: StreakIntent, now: number, world: WorldQuery): ActivationOutcome {
    // `streakId` is known only once the slot resolves; a forgery refused before
    // that has none to name, and gets no event either way.
    const reject = (reason: StreakClaimReject, streakId = ''): ActivationOutcome => {
      const r = rejectedOutcome(reason, now, intent.actorId, streakId, intent.slot);
      const owner = r.denial === null ? undefined : this.actors.get(intent.actorId);
      if (owner !== undefined) { owner.cause = r.denial; owner.at = now; }
      return r.outcome;
    };
    const a = this.actors.get(intent.actorId);
    if (!a) return reject('unknown-actor');
    if (!Number.isFinite(now)) return reject('malformed-claim');
    if (!Number.isSafeInteger(intent.slot) || intent.slot < 1 || intent.slot > a.loadout.length + 1) return reject('malformed-claim');
    if (typeof intent.claimId !== 'string' || !/^[A-Za-z0-9_:-]{4,80}$/.test(intent.claimId)) return reject('malformed-claim');
    if (!Number.isSafeInteger(intent.seq)) return reject('malformed-claim');
    if (intent.matchEpoch !== this.matchEpoch) return reject('match-epoch');
    if (intent.life !== a.life) return reject('life-epoch');
    if (intent.seq <= a.lastSeq) return reject('replayed-sequence');
    if (this.seenClaims.has(intent.claimId)) return reject('duplicate-claim');

    this.nowMs = now;
    const bonusPilot = intent.toggle && [...this.live.values()].find((i) => i.kind === 'aircraft' && i.actorId === a.actorId
      && i.variant === 'piloted-drone' && !a.loadout.includes('piloted-drone'));
    const streakId = intent.slot === a.loadout.length + 1 ? (bonusPilot ? 'piloted-drone' : this.bonusFor(a)) : a.loadout[intent.slot - 1];
    if (!streakId) return reject('malformed-claim');
    const def = streakById(streakId, this.catalog);
    if (!def) return reject('malformed-claim');

    // Eligibility comes from the ledger, never from claim assertions.
    const verdict = evaluateActivation({
      ...intent.context,
      streakId,
      slot: intent.slot,
      arenaSupported: intent.context.arenaSupported && effectKind(streakId) !== undefined,
      hasAuthoritySnapshot: true,
      earned: (a.charges.get(streakId) ?? 0) >= 1,
      controlToggle: intent.toggle && [...this.live.values()].some((i) => i.kind === 'aircraft' && i.variant === 'piloted-drone' && i.actorId === a.actorId && i.streakId === streakId),
      possessionActive: this.pilotFor(a.actorId) !== null,
    });
    if (!verdict.allowed) {
      const e: StreakDeniedEvent = Object.freeze({ type: 'streak-denied', at: now, actorId: intent.actorId, streakId, slot: intent.slot, reason: verdict.reason });
      a.cause = e;
      a.at = now;
      return Object.freeze({ accepted: false as const, outcome: 'denied' as const, reason: verdict.reason, label: STREAK_DENIAL_LABELS[verdict.reason], events: Object.freeze([e as GameEvent]) });
    }

    const existingPilot = [...this.live.values()].find((i): i is AircraftState => i.kind === 'aircraft' && i.variant === 'piloted-drone' && i.actorId === a.actorId && i.streakId === streakId);
    if (intent.toggle && existingPilot) {
      this.live.set(existingPilot.instanceId, toggleAircraftControl(existingPilot));
      a.lastSeq = intent.seq; this.rememberClaim(intent.claimId);
      return Object.freeze({ accepted: true, streakId, instanceId: existingPilot.instanceId, chargesLeft: a.charges.get(streakId) ?? 0, events: Object.freeze([]) });
    }
    if (intent.toggle) return reject('malformed-claim', streakId);
    if (this.live.size >= MAX_LIVE_INSTANCES || (streakId === 'adrenaline' && this.pendingRewards.length >= 16)) return reject('instance-cap', streakId);

    // Rule 5: everything that can fail resolves BEFORE a charge moves.
    const kind = effectKind(streakId);
    const anchor = intent.anchor ?? intent.origin;
    let placed: { x: number; y: number; z: number } | null = null;
    let corridor: readonly Vec3[] | null = null;
    if (!Number.isFinite(intent.aimYaw)) return reject('malformed-claim', streakId);
    if (kind === 'sentry' || kind === 'dart' || kind === 'fallout' || kind === 'strike-relay' || kind === 'supply-crate' || kind === 'aircraft' || kind === 'carpet-bomber') {
      const p = validateSentryPlacement(anchor.x, anchor.z, world);
      if (!p.ok) return reject('no-placement', streakId);
      placed = { x: p.x, y: p.y, z: p.z };
    } else if (kind === 'mortar') {
      const p = validateMortarPlacement(anchor.x, anchor.z, world);
      if (!p.ok) return reject('no-placement', streakId);
      placed = { x: p.x, y: p.y, z: p.z };
    }
    if (kind === 'carpet-bomber') { corridor = carpetCorridor(placed!, intent.aimYaw, world); if (!corridor) return reject('no-placement', streakId); }

    const instanceId = ++this.instances;
    const seed = hash32(this.seed, this.matchEpoch * 1_000_003 + ++this.activations, streakId);
    const chargesLeft = Math.max(0, (a.charges.get(streakId) ?? 0) - 1);
    if (chargesLeft > 0) a.charges.set(streakId, chargesLeft);
    else a.charges.delete(streakId);
    a.lastSeq = intent.seq;
    this.rememberClaim(intent.claimId);

    this.live.set(instanceId, createEffect({ instanceId, actorId: a.actorId, team: a.team, streakId,
      durationMs: def.durationMs, seed, anchor: placed ?? intent.origin, aimYaw: intent.aimYaw, catalog: this.catalog, corridor }));
    if (streakId === 'adrenaline') this.pendingRewards.push(Object.freeze({ actorId: a.actorId, team: a.team, reward: 'adrenaline', durationMs: def.durationMs, instanceId, at: now }));

    const e: StreakActivatedEvent = Object.freeze({ type: 'streak-activated', at: now, actorId: a.actorId, team: a.team, streakId, slot: intent.slot, chargesLeft, instanceId });
    a.cause = e;
    a.at = now;
    return Object.freeze({ accepted: true as const, streakId, instanceId, chargesLeft, events: Object.freeze([e as GameEvent]) });
  }

  /** Working health is decremented between effects, so simultaneous damage composes correctly. */
  advance(now: number, world: WorldQuery, targets: readonly StreakTarget[] = []): GameEvent[] {
    const dt = Math.min(ADVANCE_DT_CAP_MS, Math.max(0, now - (this.lastAdvanceAt ?? now)));
    this.lastAdvanceAt = now;
    this.nowMs = now;
    if (this.live.size === 0) return [];
    const health = new Map<ActorId, number>(targets.map((t) => [t.id, t.health]));
    const events: GameEvent[] = [];
    for (const [id, instance] of [...this.live]) {
      const aimed = targets.map((t) => ({ ...t, health: health.get(t.id) ?? t.health,
        team: this.freeForAll && t.id !== instance.actorId ? (1 - instance.team) as TeamId : t.team }));
      const tick = stepEffect(instance, dt, { now, world, targets: aimed, freeForAll: this.freeForAll });
      for (const original of tick.events) {
        const e = original.type === 'damage' && this.freeForAll ? { ...original, victimTeam: targets.find((t) => t.id === original.victimId)!.team } : original;
        if (e.type === 'damage') health.set((e as DamageEvent).victimId, (e as DamageEvent).healthAfter);
        events.push(e);
      }
      let nextState = tick.state;
      if (instance.kind === 'supply-crate' && tick.state.kind === 'supply-crate' && tick.state.opened) {
        const crate = tick.state;
        const collector = targets.find((target) => target.id === crate.captureActorId && target.alive && target.health > 0);
        const owner = collector === undefined ? undefined : this.actors.get(collector.id);
        const special = crate.reward === 'field-repair' || crate.reward === 'last-resort' || crate.reward === 'crimson-flamethrower';
        const canGrant = collector !== undefined && owner !== undefined
          && (special ? (crate.reward === 'last-resort' || this.pendingRewards.length < 16) : crateGrantFits(owner.charges, crate.reward, MAX_BANKED_STREAKS, MAX_CHARGES_PER_STREAK));
        if (canGrant && collector !== undefined && owner !== undefined) {
          if (crate.reward === 'field-repair' || crate.reward === 'crimson-flamethrower') {
            this.pendingRewards.push(Object.freeze({ actorId: collector.id, team: collector.team, reward: crate.reward, durationMs: streakById(crate.reward, this.catalog)?.durationMs ?? 0, instanceId: crate.instanceId, at: now }));
          } else if (crate.reward === 'last-resort') {
            for (const raw of lastResortEvents(collector.id, collector.team, now, targets.map((target) => ({ ...target, health: health.get(target.id) ?? target.health,
              team: this.freeForAll && target.id !== collector.id ? (1 - collector.team) as TeamId : target.team })))) {
              const event = this.freeForAll ? { ...raw, victimTeam: targets.find((t) => t.id === raw.victimId)!.team } : raw;
              health.set(event.victimId, event.healthAfter);
              events.push(event);
            }
          } else {
            const charges = (owner.charges.get(crate.reward) ?? 0) + 1;
            owner.charges.set(crate.reward, charges);
            const selected = owner.loadout.indexOf(crate.reward as StreakLoadout[number]);
            events.push(Object.freeze({ type: 'streak-earned', at: now, actorId: collector.id, team: collector.team, streakId: crate.reward, slot: selected < 0 ? owner.loadout.length + 1 : selected + 1, charges }));
          }
          events.push(this.retire(id, tick.state, now, 'destroyed'));
          continue;
        }
        // Full bank or a transiently invalid holder: reset the hold and keep
        // the crate live until the next valid capture or expiry.
        nextState = Object.freeze({ ...tick.state, opened: false, captureActorId: null, captureProgressMs: 0 });
      }
      if (nextState.remainingMs > 0) this.live.set(id, nextState);
      else events.push(this.retire(id, nextState, now, 'expired'));
    }
    return events;
  }

  private retire(id: number, state: LiveInstance, at: number, reason: StreakEndReason): StreakEndedEvent {
    this.live.delete(id);
    const e: StreakEndedEvent = Object.freeze({ type: 'streak-ended', at, actorId: state.actorId, streakId: state.streakId, instanceId: id, reason });
    const a = this.actors.get(state.actorId);
    if (a) { a.cause = e; a.at = at; }
    return e;
  }

  /** Read-only view of what is in the world, for presentation to draw. */
  liveInstances(): readonly LiveInstance[] {
    return [...this.live.values()];
  }

  revealedFor(team: TeamId): boolean { return revealedFor(this.liveInstances(), team); }
  revealedTargetIds(team: TeamId, targets: readonly StreakTarget[]): readonly ActorId[] {
    return Object.freeze(this.radarFor(team, targets).map((s) => s.id).filter((id, i, all) => i === all.indexOf(id)));
  }
  paintedTargetIds(team: TeamId, targets: readonly StreakTarget[]): readonly ActorId[] {
    return Object.freeze(this.radarFor(team, targets).filter((s) => s.source === 'dart').map((s) => s.id)
      .filter((id, i, all) => i === all.indexOf(id)).sort());
  }
  radarFor(team: TeamId, targets: readonly StreakTarget[], observerId?: ActorId): readonly RadarSample[] {
    return radarFor(this.liveInstances(), this.nowMs, team, targets, this.freeForAll, observerId);
  }

  /** Reward-only health adjustments are deliberately explicit for host integration. */
  drainRewardGrants(): readonly RewardGrant[] {
    const out = Object.freeze(this.pendingRewards.slice());
    this.pendingRewards.length = 0;
    return out;
  }

  /** The bank, one row per slot. Empty for an unknown actor, which is what `host.ts` puts in an `ActorSnapshot`. */
  snapshotFor(actorId: ActorId): StreakSlotState[] {
    const a = this.actors.get(actorId);
    if (!a) return [];
    const rows = a.loadout.map((streakId, i) => ({ streakId: streakId as string, slot: i + 1, charges: a.charges.get(streakId) ?? 0 }));
    const bonus = this.bonusFor(a);
    if (bonus) rows.push({ streakId: bonus, slot: a.loadout.length + 1, charges: a.charges.get(bonus) ?? 0 });
    return rows;
  }

  /** Level plus edge, the whole shape `StreakStateMsg` documents. Null for an unknown actor. */
  streakStateFor(actorId: ActorId, at: number = this.nowMs): StreakStateMsg | null {
    const a = this.actors.get(actorId);
    return a ? { type: 'streak-state', at, actorId, kills: a.kills, slots: this.snapshotFor(actorId), cause: a.cause,
      causeId: a.cause === null ? null : JSON.stringify(a.cause) } : null;
  }

  /** Every terminal path ends the same way: nothing live survives a match end. */
  endMatch(at: number): GameEvent[] {
    this.nowMs = at;
    const events: GameEvent[] = [];
    for (const [id, instance] of [...this.live]) events.push(this.retire(id, instance, at, 'match-end'));
    this.pendingRewards.length = 0;
    return events;
  }
}
