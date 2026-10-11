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
  DROP_MAX_LIVE, DROP_PROMPT_RANGE_M, DROP_SWAP_RANGE_M, RARE_PICKUP_RANGE_M, createDrop, createMapDrop, dropExpired,
  fullRounds, inScavengeReach, nearestDrop, scavenge, swap, type Drop,
} from './pickups';
import { PICKUP_ONLY_IDS } from './loadout';
import { RARE_PICKUP_SITES } from './spawn-points';

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

/**
 * Rare map pickups: one railgun and one flamethrower per match, on the
 * house upper-room pedestals (`game/spawn-points.ts:RARE_PICKUP_SITES`).
 *
 * Timing is old-policy scaled to this map: the old project spawned its rare
 * at 150 s ± 30 s into multi-minute matches so nobody could camp the clock;
 * Nuketown matches are score-capped (kill limits 10–25) and typically end
 * around 90 s, with 120 s the shortest legal clock — so the base is 45 s
 * with up to 30 s of seeded jitter, landing both guns mid-match, after the
 * opening house fights and inside every legal duration. A finite clock
 * additionally clamps each spawn to 15 s before the horn. The jitter and the
 * sites both derive from one-shot integer hashes of the match seed (never
 * `Math.random`), so a seeded replay replays the same pedestals.
 */
export const RARE_BASE_DELAY_MS = 45_000;
export const RARE_JITTER_MS = 30_000;

/** One-shot integer hash to [0, 1): names the seeded-jitter computation. */
function hash01(h: number): number {
  let x = (h >>> 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b);
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

interface RarePending {
  weaponId: string;
  at: number;
  x: number; y: number; z: number;
  rounds: number;
}

export class HostDrops {
  private readonly drops: Drop[] = [];
  private nextId = 1;
  readonly counts = { spawned: 0, expired: 0, culled: 0, scavenges: 0, swaps: 0 };
  private rare: RarePending[] = [];
  private rareBegun = false;

  constructor(
    private readonly life: HostLife,
    private readonly world: WorldQuery,
    private readonly kits: KitLedger,
  ) {}

  /**
   * Match start: schedule one of each pickup-only rare at a seeded delay on
   * two distinct house sites. Replaces any schedule, so re-calling (rematch,
   * late hook) never doubles the pedestals.
   */
  beginMatch(now: number, seed: number, durationMs: number | null): void {
    this.rare.length = 0;
    const latest = durationMs === null ? Number.POSITIVE_INFINITY : Math.max(5_000, durationMs - 15_000);
    const sites = RARE_PICKUP_SITES.length;
    const first = Math.floor(hash01((seed ^ 0x85ebca6b) >>> 0) * sites) % sites;
    for (let i = 0; i < PICKUP_ONLY_IDS.length; i++) {
      const delay = Math.min(RARE_BASE_DELAY_MS + hash01((seed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0) * RARE_JITTER_MS, latest);
      const step = 1 + Math.floor(hash01((seed ^ Math.imul(i + 7, 0x27d4eb2f)) >>> 0) * (sites - 1));
      const site = RARE_PICKUP_SITES[(first + i * step) % sites];
      const weaponId = PICKUP_ONLY_IDS[i];
      this.rare.push({ weaponId, at: now + delay, x: site.x, y: site.y, z: site.z, rounds: fullRounds(weaponId) });
    }
    this.rareBegun = true;
  }

  /**
   * A house-spawned rare pickup: full issue, no corpse, no expiry, outside
   * the death cap. Returns the drop id. The schedule calls this when a rare
   * becomes available; a test or a debug console can call it directly.
   */
  spawnMapPickup(weaponId: string, rounds: number, x: number, y: number, z: number, now: number): number {
    const d = createMapDrop(this.nextId++, weaponId, rounds, x, y, z, now);
    this.drops.push(d);
    this.counts.spawned++;
    this.life.emit({
      type: 'drop-spawned', at: now, id: d.id, ownerId: d.ownerId, weaponId: d.weaponId, rounds: d.rounds,
      grenades: d.grenades, x: d.x, y: d.y, z: d.z, diesAt: d.diesAt,
    });
    return d.id;
  }

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
    // The cap counts death loot only: pedestals are never culled, and the
    // victim's gun always lands even under a full ground.
    for (;;) {
      let deaths = 0;
      for (const d of this.drops) if (!d.isMapPickup) deaths++;
      if (deaths < DROP_MAX_LIVE) break;
      let old: Drop | null = null;
      for (const d of this.drops) {
        if (d.isMapPickup) continue;
        if (old === null || d.bornAt < old.bornAt || (d.bornAt === old.bornAt && d.id < old.id)) old = d;
      }
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

  /** Fires due rares (announcing each on the feed), then expiry, then the walk-over. Once per host tick. */
  advance(now: number): void {
    if (!this.rareBegun && this.life.phase === 'active') {
      // No explicit beginMatch reached this match, and this lane owns no hook
      // through the host to the drops: self-schedule off the opening tick so
      // the houses still stock. An explicit beginMatch replaces this.
      this.beginMatch(now, Math.floor(now), null);
    }
    for (let i = this.rare.length - 1; i >= 0; i--) {
      if (now >= this.rare[i].at) {
        const r = this.rare[i];
        this.rare.splice(i, 1);
        this.spawnMapPickup(r.weaponId, r.rounds, r.x, r.y, r.z, now);
        const text = r.weaponId === 'flamethrower' ? 'FLAMETHROWER ON THE FIELD' : 'RAILGUN ON THE FIELD';
        this.life.emit({ type: 'feed', at: now, text, dest: 'events', tone: 'neutral' });
      }
    }
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
   * The held-key claim. The nearest drop within reach of the claimant's pose
   * AT CLAIM TIME: `DROP_SWAP_RANGE_M` for death loot, the wider
   * `RARE_PICKUP_RANGE_M` for a house pedestal. The same gun tops up instead
   * of swapping; a different gun swaps in place and the one left behind gets
   * a fresh lifetime. Each refusal names why (§5.4).
   */
  claim(a: HostActor, msg: ShotMsg, now: number): ShotAdmission {
    const p = a.poses.at(msg.firedAt) ?? a.poses.at(now);
    if (p === null) return this.refuse(a, msg, 'no-drop', now);
    let d: Drop | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const cand of this.drops) {
      const range = cand.isMapPickup ? RARE_PICKUP_RANGE_M : DROP_SWAP_RANGE_M;
      const dist = Math.hypot(p.x - cand.x, p.y - cand.y, p.z - cand.z);
      if (dist <= range && dist < bestD) { d = cand; bestD = dist; }
    }
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

  /** Match over: the ground is cleared, with a reason, once — pedestals and all. */
  endMatch(now: number): void {
    for (let i = this.drops.length - 1; i >= 0; i--) this.remove(i, 'match-end', now);
    this.rare.length = 0;
    this.rareBegun = false;
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
