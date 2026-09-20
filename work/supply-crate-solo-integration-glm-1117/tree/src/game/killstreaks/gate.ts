/**
 * Nuketown 2025 — the pure killstreak activation gate.
 *
 * Nine enumerated refusals, fixed precedence, one labelled outcome. No state,
 * no clock, no world: same input, same answer, forever.
 *
 * Why it exists at all (IMPORT-PLAN §5.4). In the old project every one of
 * these reasons was an inlined bare `return` inside a 37,000-line main file,
 * so a blocked key press produced ZERO feedback. The owner reported it on
 * 2026-08-30 as *"cant enter them to control them, at least in killstreak
 * range"* — a player-visible dead key that had been shipping for weeks. A
 * refusal with no reason is a bug report you will never get.
 *
 * **The reasons and their labels are not declared here.** They live in the
 * frozen vocabulary (`game/vocab.ts`, re-exported by `events.ts`) as
 * `STREAK_DENIAL_REASONS` and `STREAK_DENIAL_LABELS`, because the wire
 * validator and the HUD need them too and a second copy would be the stale
 * mirror §5.5 is about. This file evaluates them; it does not own them.
 *
 * **Precedence is derived, not re-spelled.** `STREAK_DENIAL_REASONS` is
 * authored in evaluation order, so `denialPrecedence(reason)` is its index and
 * `assertGateOrder()` proves the branches below run in that order. Reordering
 * the branches without reordering the vocabulary fails the assertion.
 *
 * Both sides call this. The HOST calls it inside `runtime.activate` with
 * `hasAuthoritySnapshot: true` — it IS the authority. A GUEST calls it locally
 * for instant feedback with its own projected values; the host's answer still
 * decides, and a guest that disagrees simply shows a label a moment early.
 */

import {
  STREAK_DENIAL_LABELS,
  STREAK_DENIAL_REASONS,
  type MatchPhaseName,
  type StreakDeniedEvent,
  type StreakDenialReason,
} from '../events';

/**
 * Everything the gate may look at. Flat data, no callbacks: a bag of callbacks
 * into the caller is not a module boundary (§5.3).
 */
export interface ActivationGateInput {
  /** The streak occupying the pressed slot, after any reward substitution. */
  readonly streakId: string;
  /** 1-based, as printed on the key. */
  readonly slot: number;
  readonly alive: boolean;
  readonly matchPhase: MatchPhaseName;
  /**
   * The compound "gameplay input is live" result: pointer lock held, no pause
   * surface, not mid-transition. Its causes are not separable from the
   * boolean, so the label is the honest generic lock rather than a guess.
   */
  readonly inputEnabled: boolean;
  readonly menuOpen: boolean;
  /** A crosshair point/corridor targeting session is already open. */
  readonly targetingOpen: boolean;
  /** This build can bring this streak into this arena (it has a live effect). */
  readonly arenaSupported: boolean;
  /** The player is already possessing a streak platform. */
  readonly possessionActive: boolean;
  /** Guest only: the host ledger this availability is projected from has arrived. */
  readonly hasAuthoritySnapshot: boolean;
  /** A charge is banked for this streak. On the host, read from the ledger. */
  readonly earned: boolean;
  /**
   * This press is a CONTROL TOGGLE of a platform the player already owns, not
   * a fresh activation.
   *
   * Exempt from the arena, possession, snapshot and charge checks, and that
   * exemption is the whole owner bug: the charge was spent spawning the
   * platform, so `earned` was false and the second press was refused with NOT
   * EARNED — making it impossible to ever take control of something you had
   * already paid for. Toggling costs nothing and spends nothing, so neither
   * the charge nor an active possession may refuse it. Leaving the platform
   * arrives on this same path.
   */
  readonly controlToggle: boolean;
}

/**
 * The subset a host supplies per press. DERIVED from the input above with
 * `Pick`, not re-listed: the four fields the runtime fills in itself
 * (`streakId`, `slot`, `earned`, `hasAuthoritySnapshot`, `controlToggle`) are
 * exactly the ones a claim must never be trusted to assert.
 */
export type ActivationContext = Pick<
  ActivationGateInput,
  'alive' | 'matchPhase' | 'inputEnabled' | 'menuOpen' | 'targetingOpen' | 'arenaSupported' | 'possessionActive'
>;

/**
 * HOST-INTERNAL refusals, the second vocabulary on the activation path.
 *
 * The nine above are player-facing: a person pressed a key and is owed a
 * label. These are what a FORGED or REPLAYED claim gets — an honest client
 * cannot produce one, so no `StreakDeniedEvent` is emitted and nothing reaches
 * a feed. They are enumerated and labelled anyway, because a host log with a
 * bare `return` in it is the same bug as a HUD with one (§5.4).
 *
 * `instance-cap` and `no-placement` sit here only because the frozen
 * vocabulary (`game/vocab.ts`) has no reason for "the world is full" or "you
 * cannot put it there", and a Wave-1 lane may not add one — see
 * `src/game/README.md`. Both are flagged to the integrator rather than
 * mislabelled as `arena-unsupported`, which would tell the player something
 * untrue about the map.
 */
export const STREAK_CLAIM_REJECTS = [
  'unknown-actor', 'malformed-claim', 'match-epoch', 'life-epoch',
  'replayed-sequence', 'duplicate-claim', 'instance-cap', 'no-placement',
] as const;
export type StreakClaimReject = (typeof STREAK_CLAIM_REJECTS)[number];

export const STREAK_CLAIM_REJECT_LABELS: Readonly<Record<StreakClaimReject, string>> = Object.freeze({
  'unknown-actor': 'NOT IN MATCH',
  'malformed-claim': 'BAD STREAK CLAIM',
  'match-epoch': 'STALE MATCH',
  'life-epoch': 'STALE LIFE',
  'replayed-sequence': 'REPLAYED CLAIM',
  'duplicate-claim': 'DUPLICATE CLAIM',
  'instance-cap': 'TOO MUCH SUPPORT IN PLAY',
  'no-placement': 'NO ROOM THERE',
});

/**
 * The two rejects above that an HONEST client can produce, mapped onto the
 * frozen player-facing nine so the presser gets an answer.
 *
 * `instance-cap` and `no-placement` are not forgeries: a real press at a real
 * moment hits either of them, so returning no reason and no event is the dead
 * key §5.4 exists to stop — and it was one. A `no-placement` reject answered
 * `null` to the presser, so `game/bots.ts`'s 4 s backoff never engaged and a
 * bot re-pressed the same slot at 20 Hz for as long as it stood somewhere a
 * sentry could not go, with every denial counter reading zero throughout.
 *
 * The note above says mislabelling these as `arena-unsupported` tells the
 * player something untrue about the map. That is still true of the LABEL, so
 * the mapping is only half the answer: `runtime.activate` also stamps the
 * precise reject on `StreakDeniedEvent.detail`, and the session log and the
 * feed prefer it. The frozen reason keeps the wire validator, the HUD label
 * table and `BOT_STREAK_TERMINAL_DENIALS` working unchanged; `detail` carries
 * the cause. Nothing here is a gate branch — the gate still cannot produce
 * these, `STREAK_DENIAL_REASONS` is unchanged and `assertGateOrder` is
 * untouched.
 */
export const REJECT_AS_DENIAL: Readonly<Partial<Record<StreakClaimReject, StreakDenialReason>>> =
  Object.freeze({
    'instance-cap': 'arena-unsupported',
    'no-placement': 'arena-unsupported',
  });

/**
 * A refused claim, assembled once so `runtime.activate` stays a decision list.
 *
 * `denial` is the `StreakDeniedEvent` the presser is owed, or `null` for a
 * forgery — which is the whole difference between the two vocabularies, made
 * into one branch instead of scattered `return reject(...)`s that each had to
 * remember it. The caller still owns its own bookkeeping (the ledger's `cause`
 * edge); this owns only the shapes.
 */
export function rejectedOutcome(
  reason: StreakClaimReject,
  at: number,
  actorId: string,
  streakId: string,
  slot: number,
): {
  readonly denial: StreakDeniedEvent | null;
  readonly outcome: {
    readonly accepted: false; readonly outcome: 'rejected';
    readonly reason: StreakClaimReject; readonly label: string;
    readonly events: readonly StreakDeniedEvent[];
  };
} {
  const mapped = REJECT_AS_DENIAL[reason];
  const denial: StreakDeniedEvent | null = mapped === undefined ? null : Object.freeze({
    type: 'streak-denied' as const, at, actorId, streakId, slot, reason: mapped, detail: reason,
  });
  return Object.freeze({
    denial,
    outcome: Object.freeze({
      accepted: false as const, outcome: 'rejected' as const, reason,
      label: STREAK_CLAIM_REJECT_LABELS[reason],
      events: Object.freeze(denial === null ? [] : [denial]),
    }),
  });
}

export type ActivationEvaluation =
  | { readonly allowed: true; readonly streakId: string; readonly slot: number }
  | {
      readonly allowed: false;
      readonly streakId: string;
      readonly slot: number;
      readonly reason: StreakDenialReason;
      /** Short uppercase feed string. Looked up, never authored at a call site. */
      readonly label: string;
    };

/** Index in the frozen reason list = evaluation order. Lower refuses first. */
export function denialPrecedence(reason: StreakDenialReason): number {
  return STREAK_DENIAL_REASONS.indexOf(reason);
}

function deny(input: ActivationGateInput, reason: StreakDenialReason): ActivationEvaluation {
  return Object.freeze({
    allowed: false as const,
    streakId: input.streakId,
    slot: input.slot,
    reason,
    label: STREAK_DENIAL_LABELS[reason],
  });
}

/**
 * The gate. Branch order is the vocabulary's order, which is the old project's
 * observed key-press order: the compound input gate first (dead and match
 * phase attributed before the residual lock), then the surfaces that own the
 * screen, then the toggle exemption, then the authority split. A missing host
 * snapshot is reported BEFORE `not-earned` because availability is projected
 * purely from that snapshot, and blaming the player's kill count without one
 * would be dishonest.
 */
export function evaluateActivation(input: ActivationGateInput): ActivationEvaluation {
  if (!input.alive) return deny(input, 'dead');
  if (input.matchPhase !== 'active') return deny(input, 'match-inactive');
  if (!input.inputEnabled) return deny(input, 'input-disabled');
  if (input.menuOpen) return deny(input, 'menu-open');
  if (input.targetingOpen) return deny(input, 'targeting-open');
  if (input.controlToggle) return Object.freeze({ allowed: true as const, streakId: input.streakId, slot: input.slot });
  if (!input.arenaSupported) return deny(input, 'arena-unsupported');
  if (input.possessionActive) return deny(input, 'possession-active');
  if (!input.hasAuthoritySnapshot) return deny(input, 'no-authority-snapshot');
  if (!input.earned) return deny(input, 'not-earned');
  return Object.freeze({ allowed: true as const, streakId: input.streakId, slot: input.slot });
}

/**
 * An input that allows activation. A caller builds a denial by flipping ONE
 * field, which is how the "every blocking input maps to its single reason"
 * proof stays honest: nothing else is varying.
 */
export const PERMISSIVE_GATE_INPUT: ActivationGateInput = Object.freeze({
  streakId: '',
  slot: 1,
  alive: true,
  matchPhase: 'active' as const,
  inputEnabled: true,
  menuOpen: false,
  targetingOpen: false,
  arenaSupported: true,
  possessionActive: false,
  hasAuthoritySnapshot: true,
  earned: true,
  controlToggle: false,
});

/**
 * The one field that must be flipped on a permissive input to produce each
 * reason. Derived FROM this table by the proof, so adding a reason to the
 * vocabulary without a branch above is caught rather than assumed.
 */
export const DENIAL_TRIGGERS: Readonly<Record<StreakDenialReason, Partial<ActivationGateInput>>> = Object.freeze({
  'dead': { alive: false },
  'match-inactive': { matchPhase: 'warmup' },
  'input-disabled': { inputEnabled: false },
  'menu-open': { menuOpen: true },
  'targeting-open': { targetingOpen: true },
  'arena-unsupported': { arenaSupported: false },
  'possession-active': { possessionActive: true },
  'no-authority-snapshot': { hasAuthoritySnapshot: false },
  'not-earned': { earned: false },
});

/**
 * Proves the branch order above equals the vocabulary order: flipping every
 * field at once must surface reason 0, then reason 1 once reason 0's field is
 * restored, and so on. Throws on the first disagreement. Cheap enough to call
 * from a proof; not called at runtime.
 */
export function assertGateOrder(): void {
  let input: ActivationGateInput = { ...PERMISSIVE_GATE_INPUT, streakId: 'order-check' };
  for (const reason of STREAK_DENIAL_REASONS) input = { ...input, ...DENIAL_TRIGGERS[reason] };
  for (const reason of STREAK_DENIAL_REASONS) {
    const out = evaluateActivation(input);
    if (out.allowed || out.reason !== reason) {
      throw new Error(`gate precedence: expected ${reason}, got ${out.allowed ? 'allowed' : out.reason}`);
    }
    input = { ...input, ...PERMISSIVE_GATE_INPUT_FIELD(reason) };
  }
  if (!evaluateActivation(input).allowed) throw new Error('gate precedence: permissive input was refused');
}

/** The permissive value of whichever field `DENIAL_TRIGGERS[reason]` flips. */
function PERMISSIVE_GATE_INPUT_FIELD(reason: StreakDenialReason): Partial<ActivationGateInput> {
  const key = Object.keys(DENIAL_TRIGGERS[reason])[0] as keyof ActivationGateInput;
  return { [key]: PERMISSIVE_GATE_INPUT[key] } as Partial<ActivationGateInput>;
}
