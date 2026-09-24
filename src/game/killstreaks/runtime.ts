/**
 * Nuketown 2025 — HOST authority for killstreaks, and for nothing else.
 *
 * It owns the earn / bank / spend ledger and the live entities that ledger
 * pays for. Health, score, kills, deaths, spawns and the match clock belong to
 * `host.ts`: this is called by the host, returns events, and decides nothing
 * else. Hard cap 400 lines (AGENTS.md); it was written to a self-imposed 380
 * and left no headroom, so the SHAPES of a refusal now live in `gate.ts`
 * beside the vocabulary they belong to, and further growth belongs in
 * `effects/`.
 *
 * The five rules IMPORT-PLAN §1.1 says the old 3,511-line runtime paid for:
 *  1. **Per-life continuity.** Death clears the ladder and the per-cycle
 *     unlock set; it does NOT clear banked charges.
 *  2. **Bounded bank with BACKPRESSURE, not silent discard.** At the cap the
 *     ladder stops advancing: the kill counts, the rung is kept, and a spend
 *     resumes it. Nothing earned is thrown away.
 *  3. **Exactly-once activation**, in a bounded de-dup memory that forgets the
 *     OLDEST claim — one that drops the newest admits the replay it just saw.
 *  4. **Forged and stale claims rejected** on match epoch, life epoch and a
 *     per-actor monotonic sequence, each read from the host's own ledger and
 *     never from what the claim asserts about itself.
 *  5. **Validate before consuming**: a blocked activation retries exactly.
 *
 * Player-facing refusals are the nine frozen `StreakDenialReason`s, emitted as
 * `StreakDeniedEvent`; a FORGED claim gets `gate.ts`'s host-internal
 * `StreakClaimReject` and no event — bar the two WORLD-STATE rejects an honest
 * press can hit, which `gate.ts:rejectedOutcome` maps back to a denial (a press
 * that answers nothing is a dead key, and this one livelocked the bot backoff).
 * Determinism is seed-only: `advance` reads the clock only for its step, and an
 * effect seed hashes the match epoch, the activation ordinal and the streak id.
 */

import {
  STREAK_DENIAL_LABELS,
  type ActorId, type DamageCause, type DamageEvent, type GameEvent,
  type StreakActivatedEvent, type StreakDeniedEvent, type StreakDenialReason, type StreakEarnedEvent,
  type StreakEndReason, type StreakEndedEvent, type TeamId, type Vec3, type WorldQuery,
} from '../events';
import type { StreakSlotState, StreakStateMsg } from '../../net/protocol';
import {
  DEFAULT_STREAK_LOADOUT, STREAK_CATALOG, streakById, validateStreakLoadout,
  type StreakCatalog, type StreakLoadout,
} from './catalog';
import { evaluateActivation, rejectedOutcome, type ActivationContext, type StreakClaimReject } from './gate';
import { createRecon, reconRevealsTo, stepRecon, type ReconState } from './effects/recon';
import { createCounterRecon, jamsTeam, stepCounterRecon, type CounterReconState } from './effects/counter-recon';
import { createSentry, stepSentry, validateSentryPlacement, type SentryState, type SentryTarget } from './effects/sentry';
import { createMortar, stepMortar, type MortarState } from './effects/mortar';
import { createDart, dartPaints, stepDart, type DartState } from './effects/dart';

export { STREAK_CLAIM_REJECTS, STREAK_CLAIM_REJECT_LABELS, type ActivationContext, type StreakClaimReject } from './gate';

/**
 * Bounds, with the old project's value beside each (§5.9). Banked streaks 8 =
 * its `MAX_RETAINED_CARE_REWARDS`, also the strict recipient-snapshot bound;
 * charges 255 = what a byte on the wire carries; seen claims 512 = its
 * checkpoint bound; ladder ceiling = its replication bound. Live instances
 * BEFORE 32 for five aircraft — three ground effects need a third. The dt cap
 * exists because a backgrounded tab returns with a 30 s step and an uncapped
 * sentry would empty its magazine into one frame; the excess is LOST, so a
 * stall lengthens a live window rather than compressing it into one frame.
 */
export const MAX_BANKED_STREAKS = 8;
export const MAX_CHARGES_PER_STREAK = 255;
export const MAX_SEEN_CLAIMS = 512;
export const MAX_LIVE_INSTANCES = 12;
export const ADVANCE_DT_CAP_MS = 250;
export const MAX_LADDER_KILLS = 100_000;

/** The wiring table: the only place a streak id meets a stepper. */
const EFFECT_KIND: Readonly<Record<string, 'recon' | 'counter-recon' | 'sentry' | 'mortar' | 'dart'>> = Object.freeze({
  'recon-sweep': 'recon',
  'signal-jam': 'counter-recon',
  'sentry-post': 'sentry',
  'blast-mortar': 'mortar',
  'tracker-dart': 'dart',
});

/** Derived, never authored: what this build can bring into the world. */
export const WIRED_STREAK_IDS: readonly string[] = Object.freeze(Object.keys(EFFECT_KIND));

export type LiveInstance = ReconState | CounterReconState | SentryState | MortarState | DartState;

/** What the host must know about an actor for a sentry to shoot it. */
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

/** `kills` is the HUD ladder position; `cycle` is progress through the CURRENT ladder cycle and resets at the top rung. */
interface ActorLedger {
  readonly actorId: ActorId;
  team: TeamId;
  loadout: StreakLoadout;
  life: number;
  kills: number;
  cycle: number;
  earned: Set<string>;
  charges: Map<string, number>;
  lastSeq: number;
  cause: StreakStateMsg['cause'];
  at: number;
}

function hash32(seed: number, ordinal: number, text: string): number {
  let h = Math.imul((seed ^ 0x9e3779b9) >>> 0 ^ ordinal, 0x85ebca6b) >>> 0;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

export class StreakRuntime {
  private readonly catalog: StreakCatalog<string>;
  private readonly seed: number;
  private readonly matchEpoch: number;
  private readonly actors = new Map<ActorId, ActorLedger>();
  private readonly live = new Map<number, LiveInstance>();
  private readonly seenClaims = new Set<string>();
  private readonly claimOrder: string[] = [];
  private instances = 0;
  private activations = 0;
  private lastAdvanceAt: number | null = null;
  private nowMs = 0;

  constructor(opts: { seed?: number; matchEpoch?: number; catalog?: StreakCatalog<string> } = {}) {
    this.catalog = opts.catalog ?? STREAK_CATALOG;
    this.seed = (opts.seed ?? 1) >>> 0;
    this.matchEpoch = opts.matchEpoch ?? 0;
  }

  /**
   * An existing actor is a REJOIN: team, loadout and life refresh, the sequence
   * domain restarts, the bank survives. An invalid loadout throws with every
   * error — a substituted default would hide a menu bug.
   */
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

  /**
   * One credited elimination. `streak` is the killer's consecutive-kill count
   * as `game/scoring.ts` computed it, and it is STORED, not recounted: that
   * ledger owns the number (§5.6) and this needs it only for the snapshot.
   * The LADDER below is a different quantity — it resets at the top rung, and
   * a kill BY a streak does not advance it, or a sentry ladders its owner up
   * while they stand still.
   */
  recordElimination(actorId: ActorId, streak: number, at: number, cause: DamageCause = 'bullet'): GameEvent[] {
    const a = this.actors.get(actorId);
    if (!a) return [];
    this.nowMs = at;
    a.at = at;
    a.kills = Number.isFinite(streak) ? Math.max(0, Math.min(MAX_LADDER_KILLS, Math.floor(streak))) : a.kills;
    if (cause === 'streak') return [];
    const next = a.cycle + 1;
    const unlocks: { id: string; slot: number }[] = [];
    a.loadout.forEach((id, i) => {
      const def = streakById(id, this.catalog);
      if (def && !a.earned.has(id) && next >= def.cost) unlocks.push({ id, slot: i + 1 });
    });
    // Rule 2. If any rung about to unlock cannot be banked, the ladder does not
    // advance at all: the kill counts, the rung is kept, and the next
    // elimination after a spend earns it. Nothing is discarded.
    const wouldOverflow = unlocks.some(({ id }) => {
      const held = a.charges.get(id) ?? 0;
      return held >= MAX_CHARGES_PER_STREAK || (held === 0 && a.charges.size >= MAX_BANKED_STREAKS);
    });
    if (wouldOverflow) return [];
    a.cycle = next;
    const events: StreakEarnedEvent[] = [];
    for (const { id, slot } of unlocks) {
      a.earned.add(id);
      const charges = (a.charges.get(id) ?? 0) + 1;
      a.charges.set(id, charges);
      const e: StreakEarnedEvent = Object.freeze({ type: 'streak-earned', at, actorId, team: a.team, streakId: id, slot, charges });
      events.push(e);
      a.cause = e;
    }
    const top = Math.max(...a.loadout.map((id) => streakById(id, this.catalog)?.cost ?? 0));
    if (top > 0 && a.cycle >= top) { a.cycle = 0; a.earned.clear(); }
    return events;
  }

  /** Rule 1. Ladder and cycle reset; the BANK does not, and entities already paid for keep running. Returns [] so a host can splice it into one event list. */
  recordDeath(actorId: ActorId, at: number): GameEvent[] {
    const a = this.actors.get(actorId);
    if (!a) return [];
    this.nowMs = a.at = at;
    a.kills = a.cycle = 0;
    a.life += 1; a.lastSeq = -1; a.earned.clear();
    return [];
  }

  /** A transport drop: the sequence domain restarts so a replacement may begin at 0, while claim ids stay globally replay-protected and the bank is untouched, so a rejoin resumes exactly where it stopped. */
  recordDisconnect(actorId: ActorId, _at?: number): GameEvent[] {
    const a = this.actors.get(actorId);
    if (a) a.lastSeq = -1;
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
    if (!Number.isSafeInteger(intent.slot) || intent.slot < 1 || intent.slot > a.loadout.length) return reject('malformed-claim');
    if (typeof intent.claimId !== 'string' || !/^[A-Za-z0-9_:-]{4,80}$/.test(intent.claimId)) return reject('malformed-claim');
    if (!Number.isSafeInteger(intent.seq)) return reject('malformed-claim');
    if (intent.matchEpoch !== this.matchEpoch) return reject('match-epoch');
    if (intent.life !== a.life) return reject('life-epoch');
    if (intent.seq <= a.lastSeq) return reject('replayed-sequence');
    if (this.seenClaims.has(intent.claimId)) return reject('duplicate-claim');

    this.nowMs = now;
    const streakId = a.loadout[intent.slot - 1];
    const def = streakById(streakId, this.catalog);
    if (!def) return reject('malformed-claim');

    // The gate decides everything a player may see a label for. `earned` and
    // `hasAuthoritySnapshot` come from the LEDGER: a claim asserting its own
    // eligibility is the forgery this exists to stop. `arenaSupported` folds
    // in whether the streak has a stepper, so declared content with no effect
    // refuses with SUPPORT OFFLINE IN THIS ARENA rather than doing nothing.
    const verdict = evaluateActivation({
      ...intent.context,
      streakId,
      slot: intent.slot,
      arenaSupported: intent.context.arenaSupported && EFFECT_KIND[streakId] !== undefined,
      hasAuthoritySnapshot: true,
      earned: (a.charges.get(streakId) ?? 0) >= 1,
      controlToggle: intent.toggle,
    });
    if (!verdict.allowed) {
      const e: StreakDeniedEvent = Object.freeze({ type: 'streak-denied', at: now, actorId: intent.actorId, streakId, slot: intent.slot, reason: verdict.reason });
      a.cause = e;
      a.at = now;
      return Object.freeze({ accepted: false as const, outcome: 'denied' as const, reason: verdict.reason, label: STREAK_DENIAL_LABELS[verdict.reason], events: Object.freeze([e as GameEvent]) });
    }

    if (this.live.size >= MAX_LIVE_INSTANCES) return reject('instance-cap', streakId);
    // Rule 5: everything that can fail resolves BEFORE a charge moves.
    const kind = EFFECT_KIND[streakId];
    const anchor = intent.anchor ?? intent.origin;
    let placed: { x: number; y: number; z: number } | null = null;
    if (kind === 'sentry' || kind === 'mortar' || kind === 'dart') {
      const p = validateSentryPlacement(anchor.x, anchor.z, world);
      if (!p.ok) return reject('no-placement', streakId);
      placed = { x: p.x, y: p.y, z: p.z };
    }

    const instanceId = ++this.instances;
    const seed = hash32(this.seed, this.matchEpoch * 1_000_003 + ++this.activations, streakId);
    const chargesLeft = Math.max(0, (a.charges.get(streakId) ?? 0) - 1);
    if (chargesLeft > 0) a.charges.set(streakId, chargesLeft);
    else a.charges.delete(streakId);
    a.lastSeq = intent.seq;
    this.rememberClaim(intent.claimId);

    this.live.set(instanceId, kind === 'recon'
      ? createRecon(instanceId, a.actorId, a.team, streakId, def.durationMs, seed)
      : kind === 'counter-recon'
        ? createCounterRecon(instanceId, a.actorId, a.team, streakId, def.durationMs)
        : kind === 'mortar'
          ? createMortar(instanceId, a.actorId, a.team, streakId, def.durationMs, placed!, seed)
          : kind === 'dart'
            ? createDart(instanceId, a.actorId, a.team, streakId, def.durationMs, placed!, seed)
            : createSentry(instanceId, a.actorId, a.team, streakId, def.durationMs, placed!, intent.aimYaw, seed));

    const e: StreakActivatedEvent = Object.freeze({ type: 'streak-activated', at: now, actorId: a.actorId, team: a.team, streakId, slot: intent.slot, chargesLeft, instanceId });
    a.cause = e;
    a.at = now;
    return Object.freeze({ accepted: true as const, streakId, instanceId, chargesLeft, events: Object.freeze([e as GameEvent]) });
  }

  /**
   * Steps every live entity. `targets` is the host's own actor list with
   * CURRENT health; the working copy below is decremented as damage is
   * emitted, so two sentries hitting one victim in one tick produce two
   * correct `healthAfter` values instead of two copies of the same one.
   */
  advance(now: number, world: WorldQuery, targets: readonly StreakTarget[] = []): GameEvent[] {
    const dt = Math.min(ADVANCE_DT_CAP_MS, Math.max(0, now - (this.lastAdvanceAt ?? now)));
    this.lastAdvanceAt = now;
    this.nowMs = now;
    if (this.live.size === 0) return [];
    const health = new Map<ActorId, number>(targets.map((t) => [t.id, t.health]));
    const events: GameEvent[] = [];
    for (const [id, instance] of [...this.live]) {
      const aimed = targets.map((t) => ({ ...t, health: health.get(t.id) ?? t.health }));
      const tick = instance.kind === 'recon'
        ? stepRecon(instance, dt, { now })
        : instance.kind === 'counter-recon'
          ? stepCounterRecon(instance, dt, { now })
          : instance.kind === 'mortar'
            ? stepMortar(instance, dt, { now, targets: aimed })
            : instance.kind === 'dart'
              ? stepDart(instance, dt, { now, world, targets: aimed })
              : stepSentry(instance, dt, { now, world, targets: aimed });
      for (const e of tick.events) {
        if (e.type === 'damage') health.set((e as DamageEvent).victimId, (e as DamageEvent).healthAfter);
        events.push(e);
      }
      if (tick.state.remainingMs > 0) this.live.set(id, tick.state);
      else events.push(this.retire(id, tick.state, now, 'expired'));
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

  /** The ONE place recon and counter-recon combine; checking one alone is half the pair. */
  revealedFor(team: TeamId): boolean {
    for (const i of this.live.values()) if (i.kind === 'counter-recon' && jamsTeam(i, team)) return false;
    for (const i of this.live.values()) if (i.kind === 'recon' && reconRevealsTo(i, team)) return true;
    return false;
  }

  /**
   * Every target id a live dart paints right now, sorted. The minimap's
   * future blip reader; until it exists, the tests are the consumer — the
   * same status recon's `revealedFor` shipped with.
   */
  paintedTargetIds(): readonly ActorId[] {
    const out: ActorId[] = [];
    for (const i of this.live.values()) {
      if (i.kind !== 'dart') continue;
      for (const id of i.painted) if (dartPaints(i, id) && !out.includes(id)) out.push(id);
    }
    out.sort();
    return Object.freeze(out);
  }

  /** The bank, one row per slot. Empty for an unknown actor, which is what `host.ts` puts in an `ActorSnapshot`. */
  snapshotFor(actorId: ActorId): StreakSlotState[] {
    const a = this.actors.get(actorId);
    return a ? a.loadout.map((streakId, i) => ({ streakId, slot: i + 1, charges: a.charges.get(streakId) ?? 0 })) : [];
  }

  /** Level plus edge, the whole shape `StreakStateMsg` documents. Null for an unknown actor. */
  streakStateFor(actorId: ActorId, at: number = this.nowMs): StreakStateMsg | null {
    const a = this.actors.get(actorId);
    return a ? { type: 'streak-state', at, actorId, kills: a.kills, slots: this.snapshotFor(actorId), cause: a.cause } : null;
  }

  /** Every terminal path ends the same way: nothing live survives a match end. */
  endMatch(at: number): GameEvent[] {
    this.nowMs = at;
    const events: GameEvent[] = [];
    for (const [id, instance] of [...this.live]) events.push(this.retire(id, instance, at, 'match-end'));
    return events;
  }
}
