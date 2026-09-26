/**
 * Host-owned equipment for each life. Primary and sidearm total ammunition,
 * grenade counts and the selected tactical are authoritative. The local
 * host also owns magazine/reserve split and reload/charge timing. A firearm claim never changes the held weapon;
 * only an explicit admitted pickup can swap it. Respawn issues the authored
 * next-life hints and a fresh ammo allowance. Current-life hints are immutable.
 */

import { WEAPONS, REWARD_WEAPONS, CRIMSON_FLAMETHROWER_ID } from '../weapons/catalog';
import type { ActorId, OrdnanceInventoryEvent, ShotRejectReason } from './events';
import { DEFAULT_FIELD_KIT, fieldKitById, sidearmForPrimary } from './loadout';
import type { HostActor } from './host-life';
import { LETHAL_PER_LIFE, TACTICAL_PER_LIFE } from './ordnance';
import type { RewardGrant } from './killstreaks/effects/rewards';
import { HostWeaponState, type MagazineContents } from './host-weapon-state';

export interface RewardReadout {
  speedMultiplier: 1 | 1.25;
  rewardWeaponId: 'crimson-flamethrower' | null;
  rewardWeaponRemainingMs: number;
}

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
  readonly weapons: HostWeaponState;
  readonly primaryId: string;
  readonly rounds: number;
  readonly sidearmId: string;
  readonly sidearmRounds: number;
  tacticalId: string;
  armed: Armed | null;
  /** Host time the next knife swing is admitted. */
  meleeReadyAt: number;
  adrenalineUntil: number;
  reward: { until: number; primary: MagazineContents } | null;
  /** Bounded per-life dedupe for host-owned grants; never a client supplied id. */
  rewardInstances: number[];
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
    const primaryId = a.primaryHint ?? cur?.reward?.primary.weaponId ?? cur?.primaryId ?? ASSUMED_PRIMARY_ID;
    const sidearmId = a.sidearmHint ?? sidearmForPrimary(primaryId);
    const weapons = new HostWeaponState(a.health.life, primaryId, sidearmId);
    const fresh: Kit = {
      life: a.health.life, lethal: LETHAL_PER_LIFE, tactical: TACTICAL_PER_LIFE,
      weapons,
      get primaryId() { return weapons.primary.weaponId; },
      get rounds() { return weapons.primary.mag + weapons.primary.reserve; },
      get sidearmId() { return weapons.sidearm.weaponId; },
      get sidearmRounds() { return weapons.sidearm.mag + weapons.sidearm.reserve; },
      tacticalId: a.tacticalHint ?? 'flash', armed: null, meleeReadyAt: 0,
      adrenalineUntil: 0, reward: null, rewardInstances: [],
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

  /** Expiry/death restores exactly the suspended gun and ammunition, never a fresh issue. */
  refreshRewards(a: HostActor, now: number, end = false): boolean {
    const kit = this.kitOf(a);
    if (end || !a.health.alive) kit.weapons.cancelActions(a.health.diedAt ?? now);
    else kit.weapons.advance(now);
    let changed = false;
    if (kit.adrenalineUntil && (end || !a.health.alive || now >= kit.adrenalineUntil)) {
      kit.adrenalineUntil = 0; changed = true;
    }
    if (kit.reward && (end || !a.health.alive || now >= kit.reward.until)) {
      kit.weapons.replacePrimary(kit.reward.primary, now);
      kit.reward = null; changed = true;
    }
    return changed;
  }

  grantReward(a: HostActor, grant: RewardGrant, now: number): boolean {
    if (!a.health.alive || a.team !== grant.team || grant.actorId !== a.id) return false;
    const kit = this.kitOf(a);
    if (kit.rewardInstances.includes(grant.instanceId)) return false;
    if (grant.reward !== 'adrenaline' && grant.reward !== 'crimson-flamethrower') return false;
    const cap = grant.reward === 'adrenaline' ? 15000 : 45000;
    const duration = Math.max(0, Math.min(cap, grant.durationMs ?? cap));
    const until = Math.min(now, grant.at) + duration;
    if (!Number.isFinite(until) || until <= now) return false;
    kit.rewardInstances.push(grant.instanceId);
    if (kit.rewardInstances.length > 64) kit.rewardInstances.shift();
    if (grant.reward === 'adrenaline') kit.adrenalineUntil = Math.max(kit.adrenalineUntil, until);
    else {
      // Another earned crate extends the charge but never nests/restocks the saved primary.
      if (kit.reward === null) {
        const { weaponId, mag, reserve } = kit.weapons.primary;
        kit.reward = { until, primary: { weaponId, mag, reserve } };
      }
      else kit.reward.until = Math.max(kit.reward.until, until);
      const def = REWARD_WEAPONS.find((weapon) => weapon.id === CRIMSON_FLAMETHROWER_ID)!;
      kit.weapons.replacePrimary({ weaponId: CRIMSON_FLAMETHROWER_ID, mag: def.magSize, reserve: def.startReserve }, now);
    }
    return true;
  }

  rewardReadout(a: HostActor, now: number): RewardReadout {
    const kit = this.kitOf(a);
    const remaining = a.health.alive && kit.reward ? Math.max(0, kit.reward.until - now) : 0;
    return { speedMultiplier: a.health.alive && kit.adrenalineUntil > now ? 1.25 : 1,
      rewardWeaponId: remaining > 0 ? CRIMSON_FLAMETHROWER_ID : null, rewardWeaponRemainingMs: remaining };
  }

  /** Exactly one round from the admitted magazine, never a reserve shortcut. */
  spendShot(a: HostActor, weaponId: string, firedAt: number, now: number): ShotRejectReason | null {
    return this.kitOf(a).weapons.spend(weaponId, firedAt, now);
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
      ...this.rewardReadout(a, at),
    };
  }
}
