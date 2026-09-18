/**
 * Nuketown 2025 — field kits, custom slots, and the loadout a life starts with.
 *
 * This is the design of the old project's **92-line `loadout.ts`**. Its
 * 849-line `loadout-preset-schema.ts` and that file's 892-line test are
 * deliberately NOT here (IMPORT-PLAN §1.2): versioned-migration machinery for
 * content we do not have is the most expensive kind of code to carry, because
 * every future content change has to satisfy it before it can ship.
 *
 * **What is authored here, and why that is not a mirror.** `weapons/catalog.ts`
 * is the authored weapon list and stays the only one. Two things it cannot tell
 * us are authored here because they are loadout POLICY, not weapon data:
 * which weapons are sidearms (`SIDEARM_IDS`), and which four kits we offer
 * (`FIELD_KITS`). Everything derivable from those plus the catalog IS derived —
 * `PRIMARY_IDS`, each kit's sidearm, and each kit's trait bars — so a sixth
 * weapon appears in the custom-slot pool by existing, and a weapon rebalance
 * moves the bars without anyone editing this file (IMPORT-PLAN §5.5).
 *
 * The module is DOM-free. Persistence goes through a two-method
 * `LoadoutStorage` port that defaults to `localStorage` when one exists, so the
 * same code runs in a headless proof and in the page.
 */

import { WEAPONS, type WeaponDef } from '../weapons/catalog';

// ---------------------------------------------------------------------------
// Content families: the two authored lists
// ---------------------------------------------------------------------------

/**
 * Weapons that occupy the sidearm slot.
 *
 * AUTHORED, and it is one line rather than a field on `WeaponDef` because
 * `weapons/catalog.ts` belongs to another lane and has no slot taxonomy. The
 * old project had two sidearms and a rule — "the marksman kit carries the
 * machine pistol, everyone else the service pistol"; we ship one, so the rule
 * collapses to "the sidearm". `sidearmForPrimary()` keeps the shape of the old
 * rule so restoring the second sidearm is an entry here, not a rewrite.
 *
 * Checked against the catalog at module load: a rename in `catalog.ts` throws
 * here instead of silently producing a kit with no pistol.
 */
export const SIDEARM_IDS: readonly string[] = Object.freeze(['duster']);

/**
 * The tactical slot. DECLARED, NOT IMPLEMENTED: nothing in this project throws
 * a grenade yet, and `weapons/catalog.ts` has no ordnance. The ids exist so a
 * kit row has somewhere to point and so `damage.ts:BLAST_*` has a consumer when
 * the throw lands; a kit with an empty third slot would have to be invented
 * twice. Treat a value here as a label until a lane implements it.
 */
export const GRENADE_IDS = ['frag', 'flash', 'smoke'] as const;
export type GrenadeId = (typeof GRENADE_IDS)[number];

/** Every weapon that is not a sidearm. DERIVED — a new catalog entry joins by existing. */
export const PRIMARY_IDS: readonly string[] = Object.freeze(
  WEAPONS.filter((w) => !SIDEARM_IDS.includes(w.id)).map((w) => w.id),
);

function weaponById(id: string): WeaponDef | undefined {
  return WEAPONS.find((w) => w.id === id);
}

// Fail loud at load rather than shipping a kit whose pistol does not exist.
for (const id of SIDEARM_IDS) {
  if (!weaponById(id)) throw new Error(`loadout: SIDEARM_IDS names '${id}', which weapons/catalog.ts does not define`);
}

// ---------------------------------------------------------------------------
// Field kits
// ---------------------------------------------------------------------------

export type FieldKitId = 'linekeeper' | 'runner' | 'breacher' | 'marksman';

export interface FieldKit {
  readonly id: FieldKitId;
  readonly title: string;
  readonly role: string;
  readonly summary: string;
  readonly primary: string;
  readonly grenade: GrenadeId;
}

/**
 * Four kits, one per primary class in the catalog. Names and copy carry over
 * from the old project's kits, which the owner played; the weapon behind each
 * is this project's equivalent.
 */
export const FIELD_KITS: readonly FieldKit[] = Object.freeze([
  {
    id: 'linekeeper',
    title: 'Linekeeper',
    role: 'CONTROL / MID RANGE',
    summary: 'Stable automatic pressure with the cleanest sight picture.',
    primary: 'longhorn',
    grenade: 'frag',
  },
  {
    id: 'runner',
    title: 'Circuit Runner',
    role: 'MOBILITY / CLOSE RANGE',
    summary: 'Fast handling and dense close-range fire for the side routes.',
    primary: 'rattler',
    grenade: 'flash',
  },
  {
    id: 'breacher',
    title: 'Doorbreaker',
    role: 'BURST / VERY CLOSE',
    summary: 'Heavy short-range impact with a deliberate pump cycle.',
    primary: 'coachman',
    grenade: 'frag',
  },
  {
    id: 'marksman',
    title: 'Marksman',
    role: 'PRECISION / LONG RANGE',
    summary: 'One-shot precision across the street, backed by the sidearm.',
    primary: 'deadeye',
    grenade: 'smoke',
  },
] as const);

export const DEFAULT_FIELD_KIT: FieldKitId = 'linekeeper';

for (const kit of FIELD_KITS) {
  if (!weaponById(kit.primary)) throw new Error(`loadout: kit '${kit.id}' names primary '${kit.primary}', which weapons/catalog.ts does not define`);
}

/**
 * The sidearm a primary is issued with. Old `sidearmForPrimary`: the first
 * sidearm that is not the primary itself, so a player running the pistol as a
 * primary does not end up holding two of it. With one sidearm defined this is
 * always the Duster.
 */
export function sidearmForPrimary(primaryId: string): string {
  return SIDEARM_IDS.find((id) => id !== primaryId) ?? SIDEARM_IDS[0] ?? primaryId;
}

export function fieldKitById(value: unknown): FieldKit {
  return FIELD_KITS.find((k) => k.id === value) ?? FIELD_KITS.find((k) => k.id === DEFAULT_FIELD_KIT)!;
}

// ---------------------------------------------------------------------------
// Trait bars — DERIVED from the catalog, never authored
// ---------------------------------------------------------------------------

/**
 * The old kits carried `traits: ['Range 4', 'Control 4', 'Mobility 3']` as
 * authored strings. Those are a mirror of the weapon table: a rebalance moves
 * the gun and leaves the bar lying (IMPORT-PLAN §5.5). Here a bar is the
 * weapon's RANK among all primaries, scaled to 1..5, so the menu cannot
 * disagree with the gun.
 *
 * Metrics, each the one catalog field that is actually the thing:
 *   range    — `damage.farRange`, where falloff bottoms out (higher is better)
 *   control  — `recoil.pitch`, climb per shot (lower is better)
 *   mobility — `adsMoveScale / adsTime`, speed retained per second of aim-in
 */
export interface KitTraits {
  readonly range: number;
  readonly control: number;
  readonly mobility: number;
}

const MIN_BAR = 1;
const MAX_BAR = 5;

function rankToBar(sorted: readonly WeaponDef[], def: WeaponDef): number {
  if (sorted.length <= 1) return MAX_BAR;
  const i = sorted.findIndex((w) => w.id === def.id);
  if (i < 0) return MIN_BAR;
  return MIN_BAR + Math.round((MAX_BAR - MIN_BAR) * (i / (sorted.length - 1)));
}

/** Trait bars for any catalog weapon, ranked against every other weapon. */
export function weaponTraits(def: WeaponDef): KitTraits {
  const byRange = [...WEAPONS].sort((a, b) => a.damage.farRange - b.damage.farRange);
  const byControl = [...WEAPONS].sort((a, b) => b.recoil.pitch - a.recoil.pitch);
  const byMobility = [...WEAPONS].sort((a, b) => a.adsMoveScale / a.adsTime - b.adsMoveScale / b.adsTime);
  return {
    range: rankToBar(byRange, def),
    control: rankToBar(byControl, def),
    mobility: rankToBar(byMobility, def),
  };
}

/** Trait bars for a kit, i.e. for its primary. */
export function kitTraits(kit: FieldKit): KitTraits {
  const def = weaponById(kit.primary);
  return def ? weaponTraits(def) : { range: MIN_BAR, control: MIN_BAR, mobility: MIN_BAR };
}

// ---------------------------------------------------------------------------
// Custom slots and the stored selection
// ---------------------------------------------------------------------------

/** Three, as in the old project. A fourth is a number change, not a shape change. */
export const CUSTOM_SLOT_COUNT = 3;

export interface CustomLoadout {
  readonly name: string;
  readonly primary: string;
  readonly grenade: GrenadeId;
}

export type LoadoutSelection =
  | { readonly kind: 'kit'; readonly id: FieldKitId }
  | { readonly kind: 'custom'; readonly slot: number };

export interface LoadoutStore {
  readonly version: 1;
  readonly custom: readonly (CustomLoadout | null)[];
  readonly selected: LoadoutSelection;
}

/** What a life is actually issued. Ids, not defs — the host broadcasts ids. */
export interface Loadout {
  readonly primary: string;
  readonly sidearm: string;
  readonly grenade: GrenadeId;
}

export const LOADOUT_STORAGE_KEY = 'nuketown2025.loadout.v1';
export const LOADOUT_VERSION = 1;

export function defaultLoadoutStore(): LoadoutStore {
  return {
    version: LOADOUT_VERSION,
    custom: Object.freeze(new Array<CustomLoadout | null>(CUSTOM_SLOT_COUNT).fill(null)),
    selected: { kind: 'kit', id: DEFAULT_FIELD_KIT },
  };
}

/**
 * Resolve the stored selection into the three weapons a life carries. A custom
 * slot that is empty, or names a weapon the catalog no longer defines, falls
 * back to the default kit rather than issuing nothing — an unarmed spawn is a
 * worse failure than a wrong gun.
 */
export function resolveLoadout(store: LoadoutStore): Loadout {
  if (store.selected.kind === 'custom') {
    const slot = store.custom[store.selected.slot];
    if (slot && weaponById(slot.primary)) {
      return { primary: slot.primary, sidearm: sidearmForPrimary(slot.primary), grenade: slot.grenade };
    }
  } else {
    const kit = fieldKitById(store.selected.id);
    return { primary: kit.primary, sidearm: sidearmForPrimary(kit.primary), grenade: kit.grenade };
  }
  const fallback = fieldKitById(DEFAULT_FIELD_KIT);
  return { primary: fallback.primary, sidearm: sidearmForPrimary(fallback.primary), grenade: fallback.grenade };
}

/**
 * The loadout a NEW LIFE starts with. Old `authoredRespawnLoadout`: it
 * deliberately drops transient pickup and swap state, so a player who died
 * holding a streak weapon respawns with their own class, and always equipped to
 * the authored primary rather than to whatever they last held.
 */
export function respawnLoadoutFor(store: LoadoutStore): Loadout {
  return resolveLoadout(store);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * The storage port. Two methods, both of which a browser's `localStorage`
 * already has, so `main.ts` passes nothing and a test passes an object literal.
 * Keeping it a port is what lets this file stay DOM-free (IMPORT-PLAN §2).
 */
export interface LoadoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function ambientStorage(): LoadoutStorage | null {
  try {
    const s = (globalThis as { localStorage?: LoadoutStorage }).localStorage;
    return s ?? null;
  } catch {
    // Storage access throws outright under some privacy settings.
    return null;
  }
}

function sanitizeCustom(value: unknown): CustomLoadout | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.primary !== 'string' || !weaponById(v.primary)) return null;
  const grenade = (GRENADE_IDS as readonly string[]).includes(v.grenade as string)
    ? (v.grenade as GrenadeId)
    : GRENADE_IDS[0];
  const name = typeof v.name === 'string' && v.name.length > 0 ? v.name.slice(0, 24) : 'CUSTOM';
  return { name, primary: v.primary, grenade };
}

function sanitizeSelection(value: unknown, custom: readonly (CustomLoadout | null)[]): LoadoutSelection {
  if (typeof value === 'object' && value !== null) {
    const v = value as Record<string, unknown>;
    if (v.kind === 'custom' && typeof v.slot === 'number') {
      const slot = Math.trunc(v.slot);
      if (slot >= 0 && slot < CUSTOM_SLOT_COUNT && custom[slot]) return { kind: 'custom', slot };
    }
    if (v.kind === 'kit') return { kind: 'kit', id: fieldKitById(v.id).id };
  }
  return { kind: 'kit', id: DEFAULT_FIELD_KIT };
}

/**
 * Read the stored loadout. **Never throws and never returns a partial store.**
 * A missing key, a truncated write, a JSON payload from an older version, a
 * weapon id the catalog dropped, a storage object that throws on read — every
 * one of them yields the default store, because the caller of this function is
 * a player pressing Deploy.
 */
export function loadLoadout(storage: LoadoutStorage | null = ambientStorage()): LoadoutStore {
  if (!storage) return defaultLoadoutStore();
  let raw: string | null = null;
  try {
    raw = storage.getItem(LOADOUT_STORAGE_KEY);
  } catch {
    return defaultLoadoutStore();
  }
  if (!raw) return defaultLoadoutStore();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== LOADOUT_VERSION) return defaultLoadoutStore();
    const rawCustom = Array.isArray(parsed.custom) ? parsed.custom : [];
    const custom: (CustomLoadout | null)[] = [];
    for (let i = 0; i < CUSTOM_SLOT_COUNT; i++) custom.push(sanitizeCustom(rawCustom[i]));
    return {
      version: LOADOUT_VERSION,
      custom: Object.freeze(custom),
      selected: sanitizeSelection(parsed.selected, custom),
    };
  } catch {
    return defaultLoadoutStore();
  }
}

/** Why a save did not happen. A silent failed save is how a lost class goes unreported. */
export type SaveRefusal = 'no-storage' | 'write-failed';

export interface SaveResult {
  readonly saved: boolean;
  readonly refusal?: SaveRefusal;
}

export const SAVE_REFUSAL_LABELS: Readonly<Record<SaveRefusal, string>> = Object.freeze({
  'no-storage': 'LOADOUT NOT SAVED — NO LOCAL STORAGE',
  'write-failed': 'LOADOUT NOT SAVED — STORAGE FULL OR BLOCKED',
});

/** Write the store. Returns a reason instead of throwing; quota errors are normal. */
export function saveLoadout(store: LoadoutStore, storage: LoadoutStorage | null = ambientStorage()): SaveResult {
  if (!storage) return { saved: false, refusal: 'no-storage' };
  try {
    storage.setItem(LOADOUT_STORAGE_KEY, JSON.stringify(store));
    return { saved: true };
  } catch {
    return { saved: false, refusal: 'write-failed' };
  }
}
