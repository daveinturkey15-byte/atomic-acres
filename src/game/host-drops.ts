/**
 * Nuketown 2025 — death drops, host side: the list, the cap, the walk-over
 * and the held-key swap.
 *
 * Part of the host module, split for the 400-line cap; owned by
 * `HostOrdnance`. The RULES are `pickups.ts` (pure); this file decides WHEN
 * and writes the result down — the same split `host-life.ts` has with
 * `damage.ts`. Every mutation of an actor's carried weapon or grenades goes
 * through the `KitLedger`, and every change is announced on the bus, so a
 * client never has to guess what is on the ground.
 *
 * Exactly-once: a pickup claim is a `ShotMsg` and has already passed the
 * shot window by the time it reaches `claim`, so a replayed press is refused
 * `duplicate` upstream and never reaches the drop twice. The distance is
 * checked HERE, against the claimant's pose at the claim time, never against
 * a position the claim asserts.
 */

import type { ActorId, DeathEvent, OrdnanceRejectReason, ShotRejectReason } from './events';
import { ORDNANCE_REJECT_LABELS } from './events';
import type { ShotMsg } from '../net/protocol';
import type { HostActor, HostLife } from './host-life';
import type { ShotAdmission } from './host-ports';
import type { KitLedger } from './host-kit';
import type { WorldQuery } from './events';
import { LETHAL_PER_LIFE, TACTICAL_PER_LIFE } from './ordnance';
import {
  DROP_MAX_LIVE, DROP_PROMPT_RANGE_M, DROP_SWAP_RANGE_M, createDrop, dropExpired,
  inScavengeReach, nearestDrop, oldestDrop, scavenge, swap, type Drop,
} from './pickups';

/** A drop as the snapshot and the bots see it. */
export interface DropSnapshot {
  readonly id: number;
  readonly weaponId: string;
  readonly rounds: number;
  readonly grenades: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly diesAt: number;
}

const ADMITTED: ShotAdmission = Object.freeze({ accepted: true, reason: null, label: null });

export class HostDrops {
  private readonly drops: Drop[] = [];
  private nextId = 1;
  readonly counts = { spawned: 0, expired: 0, culled: 0, scavenges: 0, swaps: 0 };

  constructor(
    private readonly life: HostLife,
    private readonly world: WorldQuery,
    private readonly kits: KitLedger,
  ) {}

  get live(): readonly Drop[] {
    return this.drops;
  }

  private refuse(a: HostActor, msg: ShotMsg, reason: OrdnanceRejectReason, at: number): ShotAdmission {
    this.life.emit({ type: 'ordnance-rejected', at, actorId: a.id, seq: msg.seq, action: 'pickup', reason });
    return { accepted: false, reason: reason as unknown as ShotRejectReason, label: ORDNANCE_REJECT_LABELS[reason] };
  }

  private changed(d: Drop, at: number): void {
    this.life.emit({
      type: 'drop-changed', at, id: d.id, weaponId: d.weaponId, rounds: d.rounds, grenades: d.grenades,
      x: d.x, y: d.y, z: d.z, diesAt: d.diesAt,
    });
  }

  private remove(i: number, reason: 'expired' | 'culled' | 'match-end', at: number): void {
    const d = this.drops[i];
    this.drops.splice(i, 1);
    this.life.emit({ type: 'drop-removed', at, id: d.id, reason });
  }

  /**
   * A body hit the ground: its primary, with the rounds the host estimates it
   * had, and one grenade pouch. Placed at the victim's pose at the moment of
   * death, on the standable surface under it. Past the cap the OLDEST goes,
   * so the newest corpse always leaves something.
   */
  onDeath(e: DeathEvent, now: number): void {
    const victim = this.life.actors.get(e.victimId);
    if (victim === undefined) return;
    const p = victim.poses.at(e.at) ?? victim.poses.at(now);
    if (p === null) return;
    const kit = this.kits.peek(victim.id) ?? this.kits.kitOf(victim);
    while (this.drops.length >= DROP_MAX_LIVE) {
      const old = oldestDrop(this.drops);
      if (old === null) break;
      this.remove(this.drops.indexOf(old), 'culled', now);
      this.counts.culled++;
    }
    const d = createDrop(this.nextId++, victim.id, kit.primaryId, kit.rounds, p.x, this.world.groundY(p.x, p.z), p.z, now);
    this.drops.push(d);
    this.counts.spawned++;
    this.life.emit({
      type: 'drop-spawned', at: now, id: d.id, ownerId: d.ownerId, weaponId: d.weaponId, rounds: d.rounds,
      grenades: d.grenades, x: d.x, y: d.y, z: d.z, diesAt: d.diesAt,
    });
  }

  /** Expiry, then the walk-over for every live actor. Once per host tick. */
  advance(now: number): void {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      if (dropExpired(this.drops[i], now)) {
        this.remove(i, 'expired', now);
        this.counts.expired++;
      }
    }
    if (this.drops.length === 0) return;
    for (const a of this.life.actors.values()) {
      if (!a.health.alive) continue;
      const p = a.poses.at(now);
      if (p === null) continue;
      for (const d of this.drops) {
        if (!inScavengeReach(d, p.x, p.y, p.z)) continue;
        this.takeFrom(a, d, 'scavenge', now);
      }
    }
  }

  /** Apply a walk-over. Returns whether anything was granted. */
  private takeFrom(a: HostActor, d: Drop, kind: 'scavenge', now: number): boolean {
    const kit = this.kits.kitOf(a);
    const taken = scavenge(d, kit, LETHAL_PER_LIFE, TACTICAL_PER_LIFE);
    if (taken.rounds === 0 && taken.lethal === 0 && taken.tactical === 0) return false;
    kit.rounds += taken.rounds;
    kit.lethal += taken.lethal;
    kit.tactical += taken.tactical;
    this.counts.scavenges++;
    this.life.emit({
      type: 'pickup', at: now, actorId: a.id, dropId: d.id, kind, weaponId: kit.primaryId,
      rounds: taken.rounds, grenades: taken.lethal + taken.tactical, leftWeaponId: null,
    });
    this.changed(d, now);
    this.life.emit(this.kits.inventoryEvent(a, now));
    return true;
  }

  /**
   * The held-key claim. The nearest drop within `DROP_SWAP_RANGE_M` of the
   * claimant's pose AT CLAIM TIME; the same gun tops up instead of swapping;
   * a different gun swaps in place and the one left behind gets a fresh
   * lifetime. Each refusal names why (§5.4).
   */
  claim(a: HostActor, msg: ShotMsg, now: number): ShotAdmission {
    const p = a.poses.at(msg.firedAt) ?? a.poses.at(now);
    if (p === null) return this.refuse(a, msg, 'no-drop', now);
    const d = nearestDrop(this.drops, p.x, p.y, p.z, DROP_SWAP_RANGE_M);
    if (d === null) {
      const near = nearestDrop(this.drops, p.x, p.y, p.z, DROP_PROMPT_RANGE_M);
      return this.refuse(a, msg, near === null ? 'no-drop' : 'too-far', now);
    }
    const kit = this.kits.kitOf(a);
    if (d.weaponId === kit.primaryId) {
      return this.takeFrom(a, d, 'scavenge', now) ? ADMITTED : this.refuse(a, msg, 'drop-empty', now);
    }
    const sw = swap(d, kit, p.x, this.world.groundY(p.x, p.z), p.z, now);
    if (sw === null) return this.refuse(a, msg, 'no-drop', now);
    kit.primaryId = sw.weaponId;
    kit.rounds = sw.rounds;
    this.counts.swaps++;
    this.life.emit({
      type: 'pickup', at: now, actorId: a.id, dropId: d.id, kind: 'swap', weaponId: sw.weaponId,
      rounds: sw.rounds, grenades: 0, leftWeaponId: sw.leftWeaponId,
    });
    this.changed(d, now);
    this.life.emit(this.kits.inventoryEvent(a, now));
    return ADMITTED;
  }

  /** Match over: the ground is cleared, with a reason, once. */
  endMatch(now: number): void {
    for (let i = this.drops.length - 1; i >= 0; i--) this.remove(i, 'match-end', now);
  }

  forget(id: ActorId): void {
    void id;
  }

  snapshot(): DropSnapshot[] {
    return this.drops.map((d) => ({
      id: d.id, weaponId: d.weaponId, rounds: d.rounds, grenades: d.grenades, x: d.x, y: d.y, z: d.z, diesAt: d.diesAt,
    }));
  }
}
