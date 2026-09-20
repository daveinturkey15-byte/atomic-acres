/**
 * Nuketown 2025 — the streak catalog: ONE authored list, everything else derived.
 *
 * A LEAF. It imports nothing — not `events.ts`, not `rules.ts`. Content data
 * with no dependencies is content a menu, a test and the host can all read
 * without pulling a graph in behind them.
 *
 * This module is the one IMPORT-PLAN §1.1 calls "the best module in the old
 * project", ported as a DESIGN. Its discipline, and why their content edits
 * stayed consistent for a year (§5.5):
 *   - `STREAKS` is the only authored roster. `STREAK_CATALOG`, `SLOT_FAMILIES`
 *     and the reward pool are PROJECTIONS of it, so renaming, repricing,
 *     retiring or reweighting an entry necessarily reruns the projection —
 *     there is no second list to forget.
 *   - A source carrying an authored derived weight THROWS. The old catalog
 *     grew that guard because hardcoded rosters had shipped against them more
 *     than once.
 *   - Slot families derive from `tier`, so "what may go in slot 3" cannot
 *     drift from "what is high tier".
 *
 * **The exact-percentage mechanism** (§1.1, the reason this shape exists at
 * all): no integer base weight can express "exactly 10% of the pool" while
 * another reward stays at "exactly 1%". So a fixed reward carries ZERO base
 * weight and projects as `baseWeightTotal * percent`, while a weighted reward
 * projects as `baseWeightUnits * (100 - Σfixed)`. The pool then totals
 * `baseWeightTotal * 100` by construction and every fixed reward lands on its
 * stated percentage exactly, in integer arithmetic, with no rounding.
 *
 * The roster is ours; no name is taken from any shipped game. Three entries —
 * `recon-sweep`, `signal-jam`, `sentry-post` — have live effects; the rest are
 * declared content whose steppers are not written, and `runtime.ts` refuses
 * them with an enumerated, labelled reason rather than a silent no-op (§5.4).
 * Declaring them is what makes the pool a real pool, not a demonstration.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export const STREAK_TIERS = ['low', 'mid', 'high', 'top'] as const;
export type StreakTier = (typeof STREAK_TIERS)[number];

/**
 * `selectable` takes a loadout slot and may drop from the pool; `reward-only`
 * is pool-only, so it is never bought with kills; `retired` is neither, kept
 * in the roster so its id stays reserved and so the projection can be proven
 * to drop it with no stale mirror behind.
 */
export const STREAK_AVAILABILITIES = ['selectable', 'reward-only', 'retired'] as const;
export type StreakAvailability = (typeof STREAK_AVAILABILITIES)[number];

/** How the player commits the activation. Only the first two ship today. */
export const STREAK_ACTIVATIONS = ['instant', 'target-point', 'target-line', 'possession'] as const;
export type StreakActivation = (typeof STREAK_ACTIVATIONS)[number];

/** The authored row. Nine fields, all of them decisions; nothing computable. */
export interface StreakSource<Id extends string = string> {
  readonly id: Id;
  readonly displayName: string;
  /** Consecutive eliminations this life that unlock it. 0 only for `reward-only`. */
  readonly cost: number;
  readonly tier: StreakTier;
  readonly availability: StreakAvailability;
  readonly activation: StreakActivation;
  readonly durationMs: number;
  /** May be banked more than once from the pool. */
  readonly repeatable: boolean;
  /** Relative pool share BEFORE scaling. 0 for fixed, non-pool and retired rows. */
  readonly baseWeightUnits: number;
}

/** A source plus its projected pool weight. `rewardWeightUnits` is never authored. */
export type StreakDefinition<Id extends string = string> = StreakSource<Id> & { readonly rewardWeightUnits: number };

/** One half-open band of the pool. A roll `unit` lands in exactly one. */
export interface RewardPoolEntry<Id extends string = string> {
  readonly id: Id;
  readonly weightUnits: number;
  readonly startInclusive: number;
  readonly endExclusive: number;
}

export interface RewardPool<Id extends string = string> {
  readonly entries: readonly RewardPoolEntry<Id>[];
  /** Σ authored base weights of the weighted (non-fixed, non-retired) rows. */
  readonly baseWeightTotal: number;
  /** `baseWeightTotal * 100`, by construction. */
  readonly totalUnits: number;
  /** `100 - Σfixed`: what the weighted rows share. */
  readonly weightedScale: number;
  readonly fixedPercents: Readonly<Record<string, number>>;
}

export interface StreakCatalog<Id extends string = string> {
  readonly definitions: readonly StreakDefinition<Id>[];
  readonly rewardPool: RewardPool<Id>;
  /** `slotFamilies[i]` = selectable ids whose tier is `slotTiers[i]`. Derived. */
  readonly slotFamilies: readonly (readonly Id[])[];
}

// ---------------------------------------------------------------------------
// Authored content — the only hand-written data in this file
// ---------------------------------------------------------------------------

/**
 * The reward that rolls the pool. It carries zero base weight because a crate
 * that can contain a crate is a recursion the pool must not express.
 */
export const REWARD_SOURCE_ID = 'supply-crate';

/**
 * Rewards whose pool probability is an EXACT percentage. See the header for
 * why a base weight cannot express this. `last-resort` at 1% is the old
 * project's Nuke band kept as a shape, not as content.
 */
export const FIXED_REWARD_PERCENTS: Readonly<Record<string, number>> = Object.freeze({
  'field-repair': 10,
  'last-resort': 1,
});

/**
 * Loadout shape: four slots, by tier. This array is the ONLY place the slot
 * count and the slot→tier mapping exist; `SLOT_COUNT` and `SLOT_FAMILIES` are
 * both read off it. Slots 3 and 4 share the `high` family on purpose, so the
 * duplicate rule in `validateStreakLoadout` has something to bite on.
 */
export const SLOT_TIERS: readonly StreakTier[] = Object.freeze(['low', 'low', 'mid', 'high'] as const);
export const SLOT_COUNT = SLOT_TIERS.length;

/**
 * Pairs that may not be run together, with the sentence that justifies each.
 * Cross-family by nature: two entries in the same family already cannot share
 * a slot, so an exclusion inside one family would be decoration.
 */
export const MUTUAL_EXCLUSIONS: readonly (readonly [string, string, string])[] = Object.freeze([
  Object.freeze(['signal-jam', 'fallout-screen', 'only one information-denial streak per loadout'] as const),
]);

/**
 * THE ROSTER. Ten rows. Base weights are relative shares, chosen so the
 * weighted total is 100 — which is not required by the arithmetic but makes
 * every projected percentage a terminating decimal, so a review can read the
 * pool without a calculator.
 *
 * Costs are a ladder a player can finish inside one good life on a map this
 * small: 3 / 4 / 4 / 5 / 5 / 7 / 8 / 9. The old project's ladder was 3–15 on a
 * map with aircraft; 15 here would never be reached.
 */
export const STREAKS = Object.freeze([
  { id: 'recon-sweep', displayName: 'Recon Sweep', cost: 3, tier: 'low', availability: 'selectable', activation: 'instant', durationMs: 30_000, repeatable: false, baseWeightUnits: 28 },
  { id: 'signal-jam', displayName: 'Signal Jam', cost: 4, tier: 'low', availability: 'selectable', activation: 'instant', durationMs: 25_000, repeatable: false, baseWeightUnits: 22 },
  { id: 'tracker-dart', displayName: 'Tracker Dart', cost: 4, tier: 'low', availability: 'selectable', activation: 'target-point', durationMs: 20_000, repeatable: false, baseWeightUnits: 20 },
  { id: 'sentry-post', displayName: 'Sentry Post', cost: 5, tier: 'mid', availability: 'selectable', activation: 'target-point', durationMs: 40_000, repeatable: false, baseWeightUnits: 14 },
  { id: 'supply-crate', displayName: 'Supply Crate', cost: 5, tier: 'mid', availability: 'selectable', activation: 'target-point', durationMs: 60_000, repeatable: false, baseWeightUnits: 0 },
  { id: 'fallout-screen', displayName: 'Fallout Screen', cost: 7, tier: 'high', availability: 'selectable', activation: 'target-point', durationMs: 20_000, repeatable: false, baseWeightUnits: 9 },
  { id: 'blast-mortar', displayName: 'Blast Mortar', cost: 8, tier: 'high', availability: 'selectable', activation: 'target-point', durationMs: 15_000, repeatable: false, baseWeightUnits: 5 },
  { id: 'strike-relay', displayName: 'Strike Relay', cost: 9, tier: 'high', availability: 'selectable', activation: 'target-line', durationMs: 18_000, repeatable: false, baseWeightUnits: 2 },
  { id: 'field-repair', displayName: 'Field Repair', cost: 0, tier: 'mid', availability: 'reward-only', activation: 'instant', durationMs: 0, repeatable: true, baseWeightUnits: 0 },
  { id: 'last-resort', displayName: 'Last Resort', cost: 0, tier: 'top', availability: 'reward-only', activation: 'instant', durationMs: 0, repeatable: false, baseWeightUnits: 0 },
] as const satisfies readonly StreakSource[]);

export type StreakId = (typeof STREAKS)[number]['id'];

// ---------------------------------------------------------------------------
// The projection
// ---------------------------------------------------------------------------

const SOURCE_KEYS: readonly string[] = Object.freeze(['id', 'displayName', 'cost', 'tier', 'availability', 'activation', 'durationMs', 'repeatable', 'baseWeightUnits']);

function safeAdd(a: number, b: number, label: string): number {
  const r = a + b;
  if (!Number.isSafeInteger(r)) throw new Error(`${label} exceeds safe-integer range`);
  return r;
}

function safeMul(a: number, b: number, label: string): number {
  const r = a * b;
  if (!Number.isSafeInteger(r)) throw new Error(`${label} exceeds safe-integer range`);
  return r;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Rejects a malformed row AND an authored derived weight: `rewardWeightUnits`
 * is not in `SOURCE_KEYS`, so a source shipping one is an unknown key.
 */
function validateSource(v: unknown, index: number): asserts v is StreakSource {
  if (!isRecord(v)) throw new Error(`streak[${index}] must be an object`);
  const label = typeof v['id'] === 'string' ? String(v['id']) : `streak[${index}]`;
  const unknown = Object.keys(v).filter((k) => !SOURCE_KEYS.includes(k));
  const missing = SOURCE_KEYS.filter((k) => !Object.hasOwn(v, k));
  if (unknown.length > 0 || missing.length > 0) {
    throw new Error(`${label} keys invalid; unknown=[${unknown.join(',')}] missing=[${missing.join(',')}]`);
  }
  if (typeof v['id'] !== 'string' || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(v['id'])) throw new Error(`${label} has an invalid id`);
  const name = v['displayName'];
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > 48) throw new Error(`${label} has an invalid display name`);
  if (!(STREAK_TIERS as readonly unknown[]).includes(v['tier'])) throw new Error(`${label} has an invalid tier`);
  if (!(STREAK_AVAILABILITIES as readonly unknown[]).includes(v['availability'])) throw new Error(`${label} has an invalid availability`);
  if (!(STREAK_ACTIVATIONS as readonly unknown[]).includes(v['activation'])) throw new Error(`${label} has an invalid activation`);
  // A reward-only row is never bought with kills, so 0 is its honest cost
  // there and a lie anywhere else: a slotted streak with cost 0 would be
  // earned by the elimination that registers the actor.
  const minCost = v['availability'] === 'reward-only' ? 0 : 1;
  const cost = v['cost'];
  if (!Number.isSafeInteger(cost) || (cost as number) < minCost || (cost as number) > 30) throw new Error(`${label} has an invalid cost`);
  if (v['availability'] === 'reward-only' && cost !== 0) throw new Error(`${label} is reward-only and must cost 0`);
  const dur = v['durationMs'];
  if (!Number.isSafeInteger(dur) || (dur as number) < 0 || (dur as number) > 600_000) throw new Error(`${label} has an invalid duration`);
  if (typeof v['repeatable'] !== 'boolean') throw new Error(`${label} has an invalid repeat policy`);
  const w = v['baseWeightUnits'];
  if (!Number.isSafeInteger(w) || (w as number) < 0) throw new Error(`${label} has an invalid base weight`);
}

/**
 * Builds the immutable catalog from one authored list. Every caller gets the
 * same projection or an exception; nobody can supply a second eligible-id list
 * or an independently authored weight.
 */
export function createStreakCatalog<const Id extends string>(
  sources: readonly StreakSource<Id>[],
  fixedPercents: Readonly<Record<string, number>> = FIXED_REWARD_PERCENTS,
  slotTiers: readonly StreakTier[] = SLOT_TIERS,
  rewardSourceId: string = REWARD_SOURCE_ID,
): StreakCatalog<Id> {
  if (!Array.isArray(sources) || sources.length === 0) throw new Error('streak catalog must be a non-empty array');
  sources.forEach((s, i) => validateSource(s, i));
  const ids = sources.map((s) => s.id);
  if (new Set(ids).size !== ids.length) throw new Error('streak catalog ids must be unique');

  const roller = sources.find((s) => s.id === rewardSourceId);
  if (!roller) throw new Error(`reward source ${rewardSourceId} is required`);
  if (roller.availability !== 'selectable' || roller.baseWeightUnits !== 0) {
    throw new Error(`${rewardSourceId} must be selectable and carry zero (non-recursive) base weight`);
  }

  // Only fixed rewards PRESENT and not retired claim a percentage; a catalog
  // that omits one simply redistributes its share to the weighted rows.
  const fixed = new Map<string, number>();
  for (const s of sources) {
    const pct = fixedPercents[s.id];
    if (pct === undefined || s.availability === 'retired') continue;
    if (!Number.isSafeInteger(pct) || pct <= 0) throw new Error(`${s.id} has an invalid fixed percent`);
    fixed.set(s.id, pct);
  }
  let fixedTotal = 0;
  for (const pct of fixed.values()) fixedTotal = safeAdd(fixedTotal, pct, 'fixed percent total');
  if (fixedTotal >= 100) throw new Error('fixed rewards cannot claim the whole pool');
  const weightedScale = 100 - fixedTotal;

  let baseWeightTotal = 0;
  for (const s of sources) {
    const weighted = s.availability !== 'retired' && s.id !== rewardSourceId && !fixed.has(s.id);
    if (!weighted) {
      if (s.baseWeightUnits !== 0) throw new Error(`${s.id} must carry zero base weight`);
      continue;
    }
    if (s.baseWeightUnits <= 0) throw new Error(`${s.id} is pool-eligible and requires a positive base weight`);
    baseWeightTotal = safeAdd(baseWeightTotal, s.baseWeightUnits, 'pool base total');
  }
  if (baseWeightTotal <= 0) throw new Error('reward pool requires a positive weighted base total');

  const weightFor = (s: StreakSource<Id>): number => {
    if (s.availability === 'retired' || s.id === rewardSourceId) return 0;
    const pct = fixed.get(s.id);
    if (pct !== undefined) return safeMul(baseWeightTotal, pct, `${s.id} fixed weight`);
    return safeMul(s.baseWeightUnits, weightedScale, `${s.id} derived weight`);
  };

  const definitions = Object.freeze(
    sources.map((s) => Object.freeze({ ...s, rewardWeightUnits: weightFor(s) })),
  ) as readonly StreakDefinition<Id>[];

  let cursor = 0;
  const entries: RewardPoolEntry<Id>[] = [];
  for (const d of definitions) {
    if (d.rewardWeightUnits === 0) continue;
    const startInclusive = cursor;
    cursor = safeAdd(cursor, d.rewardWeightUnits, 'pool total');
    entries.push(Object.freeze({ id: d.id, weightUnits: d.rewardWeightUnits, startInclusive, endExclusive: cursor }));
  }
  const expected = safeMul(baseWeightTotal, 100, 'pool expected total');
  if (cursor !== expected) throw new Error(`reward pool formula mismatch ${cursor}/${expected}`);
  // Each fixed reward must land on its exact percentage, in integers.
  for (const [id, pct] of fixed) {
    const entry = entries.find((e) => e.id === (id as Id));
    if (!entry || safeMul(entry.weightUnits, 100, `${id} exactness`) !== safeMul(cursor, pct, `${id} target`)) {
      throw new Error(`${id} must equal exactly ${pct} percent of the reward pool`);
    }
  }

  const slotFamilies = Object.freeze(slotTiers.map((tier) => {
    const family = Object.freeze(
      definitions.filter((d) => d.availability === 'selectable' && d.tier === tier).map((d) => d.id),
    );
    if (family.length === 0) throw new Error(`slot tier ${tier} has no selectable streak`);
    return family;
  }));
  // A selectable streak with no slot is content nobody can reach.
  for (const d of definitions) {
    if (d.availability !== 'selectable') continue;
    if (!slotFamilies.some((f) => f.includes(d.id))) throw new Error(`${d.id} is selectable but no slot accepts it`);
  }

  return Object.freeze({
    definitions,
    rewardPool: Object.freeze({
      entries: Object.freeze(entries),
      baseWeightTotal,
      totalUnits: cursor,
      weightedScale,
      fixedPercents: Object.freeze(Object.fromEntries(fixed)),
    }),
    slotFamilies,
  });
}

/** The shipped projection. */
export const STREAK_CATALOG: StreakCatalog<StreakId> = createStreakCatalog(STREAKS);
export const SLOT_FAMILIES = STREAK_CATALOG.slotFamilies;

export function streakById(id: string, catalog: StreakCatalog<string> = STREAK_CATALOG): StreakDefinition<string> | null {
  return catalog.definitions.find((d) => d.id === id) ?? null;
}

/** Resolves a roll in `[0, totalUnits)` to its reward. Seed-only; no clock, no RNG. */
export function rewardForUnit<Id extends string>(catalog: StreakCatalog<Id>, unit: number): Id {
  const total = catalog.rewardPool.totalUnits;
  if (!Number.isSafeInteger(unit) || unit < 0 || unit >= total) throw new Error(`reward roll ${unit} out of range`);
  const entry = catalog.rewardPool.entries.find((e) => unit < e.endExclusive);
  if (!entry) throw new Error('reward pool has no entry for an admitted unit');
  return entry.id;
}

// ---------------------------------------------------------------------------
// Loadout
// ---------------------------------------------------------------------------

/** `SLOT_COUNT` ids in slot order. Not a fixed-length tuple: the length lives in `SLOT_TIERS`, and a tuple here would be a second copy of it. */
export type StreakLoadout = readonly StreakId[];

export interface LoadoutValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

/** Legal, and every entry has a live effect except the one high-tier slot. */
export const DEFAULT_STREAK_LOADOUT: StreakLoadout = Object.freeze([
  'recon-sweep', 'signal-jam', 'sentry-post', 'blast-mortar',
] as const);

/**
 * Every refusal is a sentence, and all of them are collected — a menu that
 * shows one error per press makes the player fix a loadout one keystroke at a
 * time (§5.4).
 */
export function validateStreakLoadout(
  value: unknown,
  catalog: StreakCatalog<string> = STREAK_CATALOG,
  exclusions: readonly (readonly [string, string, string])[] = MUTUAL_EXCLUSIONS,
): LoadoutValidation {
  const errors: string[] = [];
  const families = catalog.slotFamilies;
  if (!Array.isArray(value)) return Object.freeze({ valid: false, errors: Object.freeze(['loadout must be an array of streak ids']) });
  if (value.length !== families.length) {
    return Object.freeze({ valid: false, errors: Object.freeze([`loadout must contain exactly ${families.length} slots, got ${value.length}`]) });
  }
  const seen = new Set<unknown>();
  for (const [index, id] of (value as unknown[]).entries()) {
    const slot = index + 1;
    if (typeof id !== 'string') {
      errors.push(`slot ${slot} must contain a streak id`);
      continue;
    }
    if (seen.has(id)) errors.push(`slot ${slot} duplicates ${id}`);
    seen.add(id);
    const def = streakById(id, catalog);
    if (!def) {
      errors.push(`slot ${slot} contains unknown streak ${id}`);
      continue;
    }
    if (def.availability !== 'selectable') errors.push(`slot ${slot} contains non-selectable streak ${id}`);
    else if (!families[index].includes(id)) errors.push(`slot ${slot} does not accept ${id} (${def.tier} tier, slot wants ${families[index].join('/')})`);
  }
  for (const [a, b, why] of exclusions) {
    if (seen.has(a) && seen.has(b)) errors.push(`${a} and ${b} are mutually exclusive: ${why}`);
  }
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

/** Throwing form, for a caller that has already decided a bad loadout is fatal. */
export function parseStreakLoadout(value: unknown, catalog: StreakCatalog<string> = STREAK_CATALOG): StreakLoadout {
  const v = validateStreakLoadout(value, catalog);
  if (!v.valid) throw new Error(v.errors.join('; '));
  return Object.freeze([...(value as StreakId[])]);
}
