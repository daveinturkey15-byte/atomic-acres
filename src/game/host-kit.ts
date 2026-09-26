/**
 * Host-owned equipment for each life. Primary and sidearm total ammunition,
 * grenade counts and the selected tactical are authoritative. The local
 * controller owns magazine/reserve split and reload timing because the wire
 * carries no reload intent. A firearm claim never changes the held weapon;
 * only an explicit admitted pickup can swap it. Respawn issues the authored
 * next-life hints and a fresh ammo allowance. Current-life hints are immutable.
 */

import { WEAPONS } from '../weapons/catalog';
import type { ActorId, OrdnanceInventoryEvent, ShotRejectReason } from './events';
import { DEFAULT_FIELD_KIT, fieldKitById, sidearmForPrimary } from './loadout';
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
  sidearmId: string;
  sidearmRounds: number;
  tacticalId: string;
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
    const sidearmId = a.sidearmHint ?? sidearmForPrimary(primaryId);
    const fresh: Kit = {
      life: a.health.life, lethal: LETHAL_PER_LIFE, tactical: TACTICAL_PER_LIFE,
      primaryId, rounds: fullRounds(primaryId), sidearmId, sidearmRounds: fullRounds(sidearmId),
      tacticalId: a.tacticalHint ?? 'flash', armed: null, meleeReadyAt: 0,
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

  /** Validate the carried id and spend exactly one total round per trigger pull. */
  spendShot(a: HostActor, weaponId: string): ShotRejectReason | null {
    const kit = this.kitOf(a);
    if (weaponId !== kit.primaryId && weaponId !== kit.sidearmId) return 'malformed';
    const key = weaponId === kit.primaryId ? 'rounds' : 'sidearmRounds';
    if (kit[key] <= 0) return 'empty-magazine';
    kit[key]--;
    return null;
  }

  /** The ledger row as the wire carries it. */
  inventoryEvent(a: HostActor, at: number): OrdnanceInventoryEvent {
    const k = this.kitOf(a);
    return {
      type: 'ordnance-inventory', at, actorId: a.id,
      lethal: k.lethal, tactical: k.tactical, primaryId: k.primaryId, rounds: k.rounds,
      tacticalId: k.tacticalId,
      sidearmId: k.sidearmId, sidearmRounds: k.sidearmRounds,
      armed: k.armed === null ? null : k.armed.grenadeId,
    };
  }
}
