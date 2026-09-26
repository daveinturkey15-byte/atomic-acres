/**
 * Weapons lane — roster20 families and the TEMPORARY viewmodel fallback map.
 *
 * The catalog is the only weapon table; this file adds the one axis it does
 * not carry: which behaviour family a weapon plays as, and which first-person
 * rig represents it. Four special weapons now have native silhouettes.
 * It is deliberately THREE-free so the CPU invariant harness can bundle it
 * without dragging the renderer in.
 *
 * FALLBACKS ARE LABELED ART DEBT, not finished viewmodels. Nothing here claims
 * 20 unique 3D guns: eleven weapons still borrow one of the five original
 * rigs. The original five and four special builders provide nine native rigs.
 * Per-weapon overrides belong in SPECIAL_RIG; family motion/audio stay separate.
 */

import { ALL_WEAPONS } from './catalog';

/** Coarse behaviour family. Drives audio voice and the temporary viewmodel. */
export type WeaponFamily =
  | 'rifle'    // full-length automatic carbines
  | 'smg'      // compact automatics
  | 'lmg'      // belt-fed sustained automatics
  | 'dmr'      // scoped semi-auto precision
  | 'sniper'   // bolt precision
  | 'shotgun'  // pellet and slug shotguns
  | 'pistol'   // sidearm-class
  | 'special' // shipped distinct delivery and native special-weapon rigs
  | 'exotic';  // reserved unsupported prototype family

/** One of the five shipped `viewmodel.ts` rigs, by builder name. */
export type FallbackRig = 'rifle' | 'smg' | 'shotgun' | 'sniper' | 'pistol';
export type WeaponRigId = FallbackRig | 'railgun' | 'crossbow' | 'flamethrower' | 'flaregun' | 'crimson-flamethrower';

const SPECIAL_RIG: Readonly<Partial<Record<string, WeaponRigId>>> = Object.freeze({
  railgun: 'railgun',
  'explosive-crossbow': 'crossbow',
  flamethrower: 'flamethrower',
  'flare-gun': 'flaregun',
  'crimson-flamethrower': 'crimson-flamethrower',
});

/**
 * The explicit per-weapon table. One row per catalog id — a weapon without a
 * row is a load-time throw, not a silent rifle voice.
 */
export const WEAPON_FAMILY: Readonly<Record<string, WeaponFamily>> = Object.freeze({
  // original five (stable ids; families describe what already ships)
  longhorn: 'rifle',
  rattler: 'smg',
  coachman: 'shotgun',
  deadeye: 'sniper',
  duster: 'pistol',
  // roster20
  mp5: 'smg',
  'mini-uzi': 'smg',
  'machine-pistol': 'smg',
  m4a1: 'rifle',
  'ak-47': 'rifle',
  lmg: 'lmg',
  minigun: 'lmg',
  'm14-ebr': 'dmr',
  'slug-shotgun': 'shotgun',
  magnum: 'pistol',
  'flashlight-pistol': 'pistol',
  railgun: 'special',
  'explosive-crossbow': 'special',
  flamethrower: 'special',
  'flare-gun': 'special',
  'crimson-flamethrower': 'special',
});

/**
 * Family → standing-in rig and motion profile. Native per-id overrides are
 * resolved by viewmodelForWeapon; the DMR still borrows the sniper and slug
 * borrows the pump shotgun. Special motion retains the original rifle profile.
 */
export const FAMILY_FALLBACK: Readonly<Record<WeaponFamily, FallbackRig>> = Object.freeze({
  rifle: 'rifle',
  smg: 'smg',
  lmg: 'rifle',
  dmr: 'sniper',
  sniper: 'sniper',
  shotgun: 'shotgun',
  pistol: 'pistol',
  special: 'rifle',
  exotic: 'rifle',
});

/**
 * The weapon each shipped rig was BUILT for — the native art owner. A weapon
 * whose fallback rig is owned by another id is standing in (art debt); the
 * owner itself is not. `roster.ts` reads this for its `fallbackArt` flag.
 */
export const RIG_OWNER: Readonly<Record<FallbackRig, string>> = Object.freeze({
  rifle: 'longhorn',
  smg: 'rattler',
  shotgun: 'coachman',
  sniper: 'deadeye',
  pistol: 'duster',
});

/** True when `id` renders with the rig originally built for it — no borrowed silhouette. */
export function isNativeRig(id: string): boolean {
  const family = weaponFamily(id);
  return (SPECIAL_RIG[id] !== undefined && id !== 'crimson-flamethrower') || RIG_OWNER[FAMILY_FALLBACK[family]] === id;
}

/** The actual builder key; distinct from the coarse animation/audio family. */
export function viewmodelForWeapon(id: string): WeaponRigId {
  const family = weaponFamily(id);
  return SPECIAL_RIG[id] ?? FAMILY_FALLBACK[family];
}

/** Audio lane vocabulary — the five shipped `AudioService` shot families. */
export type AudioVoice = 'longhorn' | 'rattler' | 'coachman' | 'deadeye' | 'duster';

/** Family → nearest shipped shot voice. Revisit when per-family audio lands. */
export const FAMILY_VOICE: Readonly<Record<WeaponFamily, AudioVoice>> = Object.freeze({
  rifle: 'longhorn',
  smg: 'rattler',
  lmg: 'longhorn',
  dmr: 'deadeye',
  sniper: 'deadeye',
  shotgun: 'coachman',
  pistol: 'duster',
  special: 'duster',
  exotic: 'duster',
});

// Fail loud at load rather than shipping a weapon no family covers.
for (const w of ALL_WEAPONS) {
  if (!(w.id in WEAPON_FAMILY)) {
    throw new Error(`families: catalog weapon '${w.id}' has no WEAPON_FAMILY row`);
  }
}
const EXTRA = Object.keys(WEAPON_FAMILY).filter((id) => !ALL_WEAPONS.some((w) => w.id === id));
if (EXTRA.length > 0) {
  throw new Error(`families: WEAPON_FAMILY names ids the catalog does not define: ${EXTRA.join(', ')}`);
}

/**
 * Family for a catalog id. Throws on an unknown id — callers never guess.
 * Consumers index `FAMILY_FALLBACK` / `FAMILY_VOICE` with the result.
 */
export function weaponFamily(id: string): WeaponFamily {
  const f = WEAPON_FAMILY[id];
  if (!f) throw new Error(`families: unknown weapon id '${id}'`);
  return f;
}
