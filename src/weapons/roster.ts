/**
 * Weapons lane — the playable-roster readiness projection.
 *
 * Three files say three different things about a weapon, on purpose:
 *   `catalog.ts`  — what is DESIGNED (all 20 roster rows stay there);
 *   `families.ts` — how it PLAYS and which rig stands in (behaviour + art axis);
 *   THIS file     — what may reach a player's hands TODAY.
 *
 * The review finding that forced this file: the catalog promises behaviours the
 * controller cannot perform (explosions, burn cones, flare arcs, charge/pierce),
 * because every weapon rides the same hitscan pipeline. Advertising those four
 * as selectable would ship a lie. The gate is structural, not a menu filter:
 * loadout resolution, kit primaries, the bot arsenal and the controller's own
 * weapon list all consume `isPlayableWeapon`/`playableWeapons`, so a prototype
 * cannot re-enter through one lane while another gates it.
 *
 * A prototype leaves this file the day its behaviour lands: delete its GATED
 * row and flip its `exotic` family in families.ts — the load-time invariant
 * below forces both edits together.
 *
 * Deliberately THREE-free (like families.ts) so the CPU invariant harness can
 * bundle it without dragging the renderer in.
 */

import { WEAPONS, type WeaponDef } from './catalog';
import { isNativeRig, weaponFamily } from './families';

export type RosterReadiness = 'playable' | 'prototype';

/**
 * Why a designed weapon is held back from the selectable roster. Authored —
 * the reason is the contract, not the id.
 */
// All twenty delivery paths are implemented by host-firearms/host-crossbow.
// Future catalog prototypes still require an explicit gate here.
const GATED: Readonly<Record<string, readonly string[]>> = Object.freeze({});

// A gate may only name catalog ids, and gating must agree with the `exotic`
// family in families.ts in BOTH directions — an exotic whose behaviour shipped
// but is still gated, or a hitscan gun wrongly marked exotic, is a load-time
// error, not a silent menu lie.
for (const id of Object.keys(GATED)) {
  if (!WEAPONS.some((w) => w.id === id)) {
    throw new Error(`roster: GATED names '${id}', which weapons/catalog.ts does not define`);
  }
}
for (const w of WEAPONS) {
  if ((w.id in GATED) !== (weaponFamily(w.id) === 'exotic')) {
    throw new Error(`roster: prototype gating and 'exotic' family disagree for '${w.id}' — fix GATED and WEAPON_FAMILY together`);
  }
}

/** Catalog ids withheld from the playable roster, in catalog order. */
export const PROTOTYPE_WEAPON_IDS: readonly string[] = Object.freeze(
  WEAPONS.filter((w) => w.id in GATED).map((w) => w.id),
);

/**
 * May this id reach a player's hands (loadout, kit, drop adoption, bot
 * arsenal, the controller's weapon list)? Unknown ids are NOT playable — an
 * unlisted gun is an upstream bug, never an admission.
 */
export function isPlayableWeapon(id: string): boolean {
  return WEAPONS.some((w) => w.id === id) && !(id in GATED);
}

/** The playable roster, in catalog order (the original five stay first). */
export function playableWeapons(): readonly WeaponDef[] {
  return WEAPONS.filter((w) => isPlayableWeapon(w.id));
}

export interface RosterEntry {
  readonly id: string;
  readonly name: string;
  readonly readiness: RosterReadiness;
  /** Non-empty exactly when readiness is 'prototype'. */
  readonly gatedBecause: readonly string[];
  /** True when the weapon renders with a rig built for another weapon (art debt — tracked in families.ts, never a gate). */
  readonly fallbackArt: boolean;
}

/**
 * The full 20-weapon readiness projection, catalog order. This is the one list
 * a menu should derive from: playable rows for selection, prototype rows
 * labelled with their reasons. It is a projection of catalog + families +
 * GATED — not a fourth weapon table to keep in sync.
 */
export function rosterProjection(): readonly RosterEntry[] {
  return WEAPONS.map((w) => {
    const gated = GATED[w.id];
    return {
      id: w.id,
      name: w.name,
      readiness: gated ? 'prototype' : 'playable',
      gatedBecause: gated ?? [],
      fallbackArt: !isNativeRig(w.id),
    };
  });
}
