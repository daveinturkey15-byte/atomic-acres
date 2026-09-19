/**
 * Nuketown 2025 — what each actor is carrying, as the host knows it.
 *
 * Part of the host module (`host.ts` / `host-life.ts` / `host-ordnance.ts` /
 * `host-drops.ts` / this), split for the 400-line cap. Owned by
 * `HostOrdnance`; nothing else constructs one.
 *
 * ## What this ledger is, honestly
 *
 * Grenade charges are AUTHORITATIVE: the host issues them per life and spends
 * them per admitted throw, and the HUD renders the host's number.
 *
 * The primary weapon and its rounds are an ESTIMATE. The host sees no reload
 * and no magazine (`host-shot.ts` says so under `empty-magazine`), so it
 * cannot count what is in the gun. What it can count is admitted claims: the
 * primary is the last primary-class weapon an actor fired this life, and its
 * rounds are the weapon's full issue minus admitted shots plus scavenged
 * ammo. That is what a corpse drops and what a swap hands over. The
 * controller's own count stays what the player actually fires; the two agree
 * to within the reloads the host cannot see, and the drop is the only place
 * the host's number is spent.
 */

import { WEAPONS } from '../weapons/catalog';
import type { ActorId, OrdnanceInventoryEvent } from './events';
import { DEFAULT_FIELD_KIT, PRIMARY_IDS, fieldKitById } from './loadout';
import type { HostActor } from './host-life';
import { LETHAL_PER_LIFE, TACTICAL_PER_LIFE } from './ordnance';
import { fullRounds } from './pickups';

/** The primary an actor is assumed to carry before it has fired one. Derived from the default kit. */
export const ASSUMED_PRIMARY_ID: string = fieldKitById(DEFAULT_FIELD_KIT).primary;

if (!WEAPONS.some((w) => w.id === ASSUMED_PRIMARY_ID)) {
  throw new Error('[host-kit] the default kit names a primary the catalog does not define');
}

/** A grenade in hand with its pin out. */
export interface Armed {
  readonly grenadeId: string;
  readonly armedAt: number;
  /** Host time it goes off in the hand; null when the fuse starts at release. */
  readonly fuseAt: number | null;
}

export interface Kit {
  /** The life this kit was issued for. A new life gets a new kit. */
  life: number;
  lethal: number;
  tactical: number;
  primaryId: string;
  rounds: number;
  armed: Armed | null;
  /** Host time the next knife swing is admitted. */
  meleeReadyAt: number;
}

export class KitLedger {
  private readonly kits = new Map<ActorId, Kit>();

  /**
   * The actor's kit for its CURRENT life, issued fresh when the life epoch has
   * moved. `health.ts` bumps the epoch at revive, so this is the whole respawn
   * re-grant with no spawn hook: one charge of each, the assumed primary with
   * its full issue, nothing armed, knife ready.
   *
   * The primary a NEW life is issued is the seat's declared one
   * (`HostActor.primaryHint`, from `addActor`) when there is one - a bot's
   * corpse then drops the gun the director gave it even if it never fired -
   * else whatever the last life ended holding, else the default kit's.
   */
  kitOf(a: HostActor): Kit {
    const cur = this.kits.get(a.id);
    if (cur !== undefined && cur.life === a.health.life) return cur;
    const primaryId = a.primaryHint ?? cur?.primaryId ?? ASSUMED_PRIMARY_ID;
    const fresh: Kit = {
      life: a.health.life, lethal: LETHAL_PER_LIFE, tactical: TACTICAL_PER_LIFE,
      primaryId, rounds: fullRounds(primaryId), armed: null, meleeReadyAt: 0,
    };
    this.kits.set(a.id, fresh);
    return fresh;
  }

  /** The kit as last issued, without re-issuing. For a corpse, whose life has not yet moved. */
  peek(id: ActorId): Kit | null {
    return this.kits.get(id) ?? null;
  }

  forget(id: ActorId): void {
    this.kits.delete(id);
  }

  /**
   * An admitted bullet. A primary-class weapon the actor has not fired this
   * life becomes its primary at the weapon's full issue; every admitted round
   * then comes off the estimate. A sidearm round changes nothing.
   */
  noteShot(a: HostActor, weaponId: string): void {
    if (!PRIMARY_IDS.includes(weaponId)) return;
    const kit = this.kitOf(a);
    if (kit.primaryId !== weaponId) {
      kit.primaryId = weaponId;
      kit.rounds = fullRounds(weaponId);
    }
    if (kit.rounds > 0) kit.rounds -= 1;
  }

  /** The ledger row as the wire carries it. */
  inventoryEvent(a: HostActor, at: number): OrdnanceInventoryEvent {
    const k = this.kitOf(a);
    return {
      type: 'ordnance-inventory', at, actorId: a.id,
      lethal: k.lethal, tactical: k.tactical, primaryId: k.primaryId, rounds: k.rounds,
      armed: k.armed === null ? null : k.armed.grenadeId,
    };
  }
}
