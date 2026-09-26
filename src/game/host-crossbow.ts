/**
 * Host-owned explosive bolts: ticked ballistic flight against current poses,
 * strict segment occlusion, one direct hit and bounded four-metre splash.
 *
 * The shared shot gate admits the claim and HostFirearms spends one carried
 * round before launch. Speed, gravity, lifetime and range are host tuning;
 * claims supply no damage or impact position. Bolts survive the owner's death
 * but retire on disconnect, match end, range or lifetime expiry.
 *
 * Launch/impact events drive remote presentation; weapon-effect describes the
 * explosion. HostLife still enforces protection, hostility and score exactly
 * once. A fixed sixteen-bolt pool bounds simulation and presentation work.
 */

import { WEAPONS, damageAt, type WeaponDef } from '../weapons/catalog';
import {
  CROSSBOW_ID,
  CROSSBOW_TUNING,
  advanceBolt,
  launchBolt,
  type CrossbowBolt,
  type CrossbowTuning,
} from '../weapons/crossbow-runtime';
import { BOT_DAMAGE_MULTIPLIER, admitted, zoneMultiplier } from './damage';
import type { ActorId, HitZone, ShotRejectReason, TeamId, WorldQuery } from './events';
import { admitShot, pickTarget, type ShotAdmissionCtx, type TargetCandidate } from './host-shot';
import type { ShotMsg } from '../net/protocol';
import type { HostActor, HostLife } from './host-life';

export { CROSSBOW_ID };

/** Live bolts the host holds. 16 matches the client FLIGHT_POOL, so every live bolt has a visual slot. */
export const CROSSBOW_POOL = 16;
/** Longest step the host integrates bolts over; a stalled host owes no tunnel. */
const MAX_STEP_S = 0.1;
const SEG_EPS = 1e-6;
/** Authored explosive tip: lethal on direct hit, bounded splash with strict occlusion. */
const BLAST_RADIUS = 4;
const BLAST_DAMAGE = 65;

function mustCrossbowDef(): WeaponDef {
  const found = WEAPONS.find((w) => w.id === CROSSBOW_ID);
  if (found === undefined) throw new Error("[host-crossbow] catalog has no 'explosive-crossbow' row");
  return found;
}
const CROSSBOW_DEF: WeaponDef = mustCrossbowDef();
interface LiveBolt extends CrossbowBolt {
  boltId: number;
  ownerId: ActorId;
  ownerTeam: TeamId;
  ownerBot: boolean;
  ox: number;
  oy: number;
  oz: number;
  launchedAt: number;
  expiresAt: number;
}

export interface CrossbowCounts {
  launched: number;
  impacts: number;
  victims: number;
  walls: number;
  expired: number;
  dropped: number;
}

export interface CrossbowSnapshot {
  readonly live: number;
  readonly counts: Readonly<CrossbowCounts>;
}

/**
 * Admit a crossbow launch claim. The eight `host-shot` rules run unchanged;
 * two refusals sit in front: a claim for this id while the canary is off, or
 * any other id reaching this seam, is `malformed` — a gated id on the wire is
 * a forged claim. `knownWeapon` is forced true here because the roster gates
 * the id until root accepts the behavior; the host computes the same verdict
 * through its own `knownWeapon` flag and this helper mirrors it for tests.
 */
export function admitCrossbowLaunch(
  c: ShotMsg,
  ctx: ShotAdmissionCtx | null,
  canaryOn: boolean,
): ShotRejectReason | null {
  if (!canaryOn) return 'malformed';
  if (c.weaponId !== CROSSBOW_ID) return 'malformed';
  if (ctx === null) return 'unknown-shooter';
  return admitShot(c, { ...ctx, knownWeapon: true });
}

/**
 * The admitted damage number for a landed bolt. Host-measured distance and
 * host-resolved zone through the catalog row falloff and the shared zone
 * multiplier, then the bot scalar, then clamped. There is no input for a
 * client number because there is no parameter for one.
 */
export function computeCrossbowDamage(
  distance: number,
  zone: HitZone,
  attackerIsBot: boolean,
): number {
  const base = damageAt(CROSSBOW_DEF, distance);
  const zoned = base * zoneMultiplier(CROSSBOW_DEF, zone);
  const scaled = attackerIsBot ? zoned * BOT_DAMAGE_MULTIPLIER : zoned;
  return admitted(scaled);
}

export class HostCrossbow {
  private readonly pool: LiveBolt[] = [];
  private nextBoltId = 1;
  private lastAdvance: number;
  readonly counts: CrossbowCounts = { launched: 0, impacts: 0, victims: 0, walls: 0, expired: 0, dropped: 0 };
  private readonly scratchFrom = { x: 0, y: 0, z: 0 };
  private readonly scratchTo = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly life: HostLife,
    private readonly world: WorldQuery,
    now: number,
    private readonly tuning: CrossbowTuning = CROSSBOW_TUNING,
    poolSize: number = CROSSBOW_POOL,
  ) {
    this.lastAdvance = now;
    const n = poolSize > 0 ? Math.floor(poolSize) : CROSSBOW_POOL;
    for (let i = 0; i < n; i++) {
      this.pool.push({
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, distance: 0, seq: -1, live: false,
        boltId: 0, ownerId: '', ownerTeam: 0, ownerBot: false,
        ox: 0, oy: 0, oz: 0, launchedAt: 0, expiresAt: 0,
      });
    }
  }

  /**
   * Spawn an ADMITTED claim as a live bolt. The shot window has already
   * accepted its seq — this never re-checks admission, it only bounds the
   * pool. Returns the host bolt id, or -1 when every slot is live: the claim
   * stays admitted (window consumed) but no bolt flies, exactly the
   * grenade-pool exhaustion shape.
   */
  launch(owner: HostActor, msg: ShotMsg, now: number): number {
    const slot = this.acquire();
    if (slot === null) {
      this.counts.dropped++;
      return -1;
    }
    const len = Math.hypot(msg.dx, msg.dy, msg.dz) || 1;
    const dx = msg.dx / len;
    const dy = msg.dy / len;
    const dz = msg.dz / len;
    launchBolt(slot, msg.ox, msg.oy, msg.oz, dx, dy, dz, msg.seq, this.tuning);
    slot.boltId = this.nextBoltId++;
    slot.ownerId = owner.id;
    slot.ownerTeam = owner.team;
    slot.ownerBot = owner.bot;
    slot.ox = msg.ox;
    slot.oy = msg.oy;
    slot.oz = msg.oz;
    slot.launchedAt = now;
    slot.expiresAt = now + this.tuning.lifetime * 1000;
    this.counts.launched++;
    this.life.emit({
      type: 'bolt-launched', at: now, actorId: owner.id, team: owner.team,
      boltId: slot.boltId, seq: msg.seq,
      x: slot.x, y: slot.y, z: slot.z, vx: slot.vx, vy: slot.vy, vz: slot.vz,
      expiresAt: slot.expiresAt,
    });
    return slot.boltId;
  }

  /** Once per host tick, after ordnance and before the event drain. */
  advance(now: number): void {
    const dt = Math.min(MAX_STEP_S, Math.max(0, now - this.lastAdvance) / 1000);
    this.lastAdvance = now;
    if (dt <= 0) return;
    // CURRENT poses, rebuilt every tick — the whole fix over the frozen
    // `firedAt` snapshot: a sprinting target moves between ticks and the bolt
    // meets it where it is.
    const candidates: TargetCandidate[] = [];
    for (const v of this.life.actors.values()) {
      if (!v.health.alive) continue;
      const p = v.poses.at(now);
      if (p === null) continue;
      candidates.push({ id: v.id, pose: p });
    }
    const h = this.tuning.substep;
    let remaining = dt;
    while (remaining > 1e-9) {
      const step = remaining < h ? remaining : h;
      remaining -= step;
      for (const b of this.pool) {
        if (!b.live) continue;
        this.stepBolt(b, step, now, candidates);
        if (!b.live) continue;
      }
    }
  }

  private stepBolt(
    b: LiveBolt, step: number, now: number,
    candidates: readonly TargetCandidate[],
  ): void {
    if (now >= b.expiresAt) { this.stop(b, 'expired', b.distance, b.x, b.y, b.z, now); return; }
    const from = this.scratchFrom;
    const to = this.scratchTo;
    from.x = b.x; from.y = b.y; from.z = b.z;
    const alive = advanceBolt(b, step, this.tuning);
    to.x = b.x; to.y = b.y; to.z = b.z;
    const segLen = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
    if (segLen > SEG_EPS) {
      const ux = (to.x - from.x) / segLen;
      const uy = (to.y - from.y) / segLen;
      const uz = (to.z - from.z) / segLen;
      // Victim entry against CURRENT poses, excluding the owner (no self-hit;
      // self-harm is the explosion-only rule in `host-life.ts:hit`).
      let best: { id: string; zone: HitZone; distance: number; x: number; y: number; z: number } | null = null;
      for (const cand of candidates) {
        if (cand.id === b.ownerId) continue;
        const probe = {
          type: 'shot' as const, seq: b.seq, life: 0, weaponId: CROSSBOW_ID, firedAt: now,
          ox: from.x, oy: from.y, oz: from.z, dx: ux, dy: uy, dz: uz,
        };
        const hit = pickTarget(probe, [cand]);
        if (hit === null || hit.distance > segLen + SEG_EPS) continue;
        if (best !== null && hit.distance >= best.distance) continue;
        best = hit;
      }
      if (best !== null) {
        const total = b.distance - segLen + best.distance;
        if (this.world.lineOfSight(from, { x: best.x, y: best.y, z: best.z })) {
          this.strike(b, best.id, best.zone, total, best.x, best.y, best.z, now);
          return;
        }
        this.stop(b, 'wall', b.distance - segLen, from.x, from.y, from.z, now);
        return;
      }
      if (!this.world.lineOfSight(from, to)) {
        this.stop(b, 'wall', b.distance - segLen, from.x, from.y, from.z, now);
        return;
      }
    }
    const ground = this.world.groundY(b.x, b.z);
    if (b.y <= ground && from.y >= ground) {
      this.stop(b, 'wall', b.distance, b.x, ground + 0.04, b.z, now);
      return;
    }
    if (!this.world.inBounds(b.x, b.z)) { this.stop(b, 'expired', b.distance, b.x, b.y, b.z, now); return; }
    if (!alive) {
      this.stop(b, 'expired', b.distance, b.x, b.y, b.z, now);
    }
  }

  private strike(
    b: LiveBolt, victimId: string, zone: HitZone, distance: number,
    x: number, y: number, z: number, now: number,
  ): void {
    const victim = this.life.actors.get(victimId);
    const owner = this.life.actors.get(b.ownerId) ?? null;
    b.live = false;
    this.counts.impacts++;
    this.counts.victims++;
    if (victim !== undefined && victim.health.alive) {
      const amount = computeCrossbowDamage(distance, zone, (owner?.bot ?? false) && !victim.bot);
      this.life.hit(victim, owner, zone, distance, CROSSBOW_ID, 'bullet', now, b.ox, b.oz, amount);
    }
    this.life.emit({
      type: 'bolt-impact', at: now, boltId: b.boltId,
      actorId: owner === null || owner === undefined ? null : owner.id,
      team: owner === null || owner === undefined ? null : owner.team,
      victimId, zone, distance, x, y, z, stopped: 'victim',
    });
    this.explode(b, x, y, z, now);
  }

  private stop(
    b: LiveBolt, stopped: 'wall' | 'expired', distance: number,
    x: number, y: number, z: number, now: number,
  ): void {
    const owner = this.life.actors.get(b.ownerId) ?? null;
    b.live = false;
    this.counts.impacts++;
    if (stopped === 'wall') this.counts.walls++;
    else this.counts.expired++;
    this.life.emit({
      type: 'bolt-impact', at: now, boltId: b.boltId,
      actorId: owner === null ? null : owner.id,
      team: owner === null ? null : owner.team,
      victimId: null, zone: null, distance, x, y, z, stopped,
    });
    this.explode(b, x, y, z, now);
  }

  private explode(b: LiveBolt, x: number, y: number, z: number, now: number): void {
    const owner = this.life.actors.get(b.ownerId);
    if (!owner) return;
    const origin = { x, y, z };
    for (const victim of this.life.actors.values()) {
      if (!victim.health.alive) continue;
      const p = victim.poses.at(now);
      if (!p) continue;
      const target = { x: p.x, y: p.y + (p.stance === 'prone' ? 0.25 : p.stance === 'crouch' ? 0.6 : 0.9), z: p.z };
      const distance = Math.hypot(target.x - x, target.y - y, target.z - z);
      if (distance >= BLAST_RADIUS || !this.world.lineOfSight(origin, target)) continue;
      const scale = owner.bot && !victim.bot ? BOT_DAMAGE_MULTIPLIER : 1;
      this.life.hit(victim, owner, 'body', distance, CROSSBOW_ID, 'explosion', now, x, z,
        admitted(BLAST_DAMAGE * (1 - distance / BLAST_RADIUS) * scale));
    }
    this.life.emit({ type: 'weapon-effect', effect: 'crossbow-blast', at: now,
      actorId: owner.id, team: owner.team, id: b.boltId, weaponId: CROSSBOW_ID,
      x, y, z, dx: 0, dy: 0, dz: 0, radius: BLAST_RADIUS, durationMs: 350 });
  }

  private acquire(): LiveBolt | null {
    for (const b of this.pool) {
      if (!b.live) {
        b.live = true;
        return b;
      }
    }
    return null;
  }

  /** Disconnect: retire that owner's in-flight bolts. Death does NOT retire. */
  forget(id: ActorId): void {
    for (const b of this.pool) {
      if (b.live && b.ownerId === id) b.live = false;
    }
  }

  /** Match over: drop every live bolt silently — no post-match damage. */
  endMatch(_now: number): void {
    for (const b of this.pool) b.live = false;
  }

  snapshot(): CrossbowSnapshot {
    let live = 0;
    for (const b of this.pool) if (b.live) live++;
    return { live, counts: { ...this.counts } };
  }
}
