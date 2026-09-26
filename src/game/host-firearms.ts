/** Host-only firearm admission, pellets and bounded rail penetration. */
import { WEAPONS, damageAt, type WeaponDef } from '../weapons/catalog';
import { behaviorFor } from '../weapons/behavior';
import type { ShotMsg } from '../net/protocol';
import type { ActorId, ShotRejectReason, Vec3, WorldQuery } from './events';
import type { HostActor, HostLife } from './host-life';
import type { HostOrdnance } from './host-ordnance';
import { BOT_DAMAGE_MULTIPLIER, admitted, zoneMultiplier } from './damage';
import { pickTarget, type TargetCandidate, type TargetHit } from './host-shot';
import { HostWeaponEffects } from './host-weapon-effects';

const DEFINITIONS = new Map(WEAPONS.map((def) => [def.id, def]));
type FireHistory = { life: number; shots: { at: number; weaponId: string }[] };

/** Segment entry/exit distance; solids stay data on the existing world port. */
function solidInterval(c: ShotMsg, min: Vec3, max: Vec3, range: number): [number, number] | null {
  let near = 0; let far = range;
  for (const [o, d, lo, hi] of [[c.ox, c.dx, min.x, max.x], [c.oy, c.dy, min.y, max.y], [c.oz, c.dz, min.z, max.z]]) {
    if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return null; continue; }
    let a = (lo - o) / d; let b = (hi - o) / d;
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a); far = Math.min(far, b);
    if (near > far) return null;
  }
  return [near, far];
}

export class HostFirearms {
  private readonly histories = new Map<ActorId, FireHistory>();
  private readonly effects: HostWeaponEffects;
  private nextEffect = 1;

  constructor(private readonly life: HostLife, private readonly world: WorldQuery,
    private readonly ordnance: HostOrdnance, now: number) {
    this.effects = new HostWeaponEffects(life, world, now);
  }

  admit(a: HostActor, c: ShotMsg): ShotRejectReason | null {
    const def = DEFINITIONS.get(c.weaponId);
    if (def === undefined) return 'malformed';
    let history = this.histories.get(a.id);
    if (history === undefined || history.life !== a.health.life) {
      history = { life: a.health.life, shots: [] };
      this.histories.set(a.id, history);
    }
    // Compare both neighbours so bounded network reorder does not buy an extra shot.
    const interval = def.interval * 1000;
    const tolerance = Math.min(8, interval * 0.1);
    for (const old of history.shots) {
      if (old.weaponId === c.weaponId && Math.abs(old.at - c.firedAt) < interval - tolerance) return 'shot-cooldown';
    }
    // A one-second window prevents repeated jitter tolerance increasing sustained RPM.
    const inWindow = history.shots.filter((old) => old.weaponId === c.weaponId &&
      old.at > c.firedAt - 1000 && old.at <= c.firedAt).length;
    if (inWindow >= Math.ceil(1000 / interval) + 1) return 'shot-cooldown';
    const reason = this.ordnance.spendShot(a, c.weaponId);
    if (reason !== null) return reason;
    history.shots.push({ at: c.firedAt, weaponId: c.weaponId });
    if (history.shots.length > 64) history.shots.shift();
    return null;
  }

  fire(a: HostActor, c: ShotMsg, now: number): void {
    const def = DEFINITIONS.get(c.weaponId)!;
    const behavior = behaviorFor(c.weaponId);
    if (behavior.kind === 'cone') { this.effects.flame(a, c, now); return; }
    if (behavior.kind === 'projectile') { this.effects.flare(a, c, now); return; }
    const candidates: TargetCandidate[] = [];
    for (const v of this.life.actors.values()) {
      if (v === a || !v.health.alive) continue;
      const pose = v.poses.at(c.firedAt);
      if (pose !== null) candidates.push({ id: v.id, pose });
    }
    if (behavior.kind === 'piercing') { this.rail(a, c, def, candidates, now); return; }
    // One claim is one shell. Pellets are generated on the host, never supplied by a guest.
    // A fixed sunflower pattern has reproducible coverage and no global-RNG coupling.
    const horizontal = Math.hypot(c.dx, c.dz);
    const rx = horizontal > 1e-6 ? -c.dz / horizontal : 1;
    const rz = horizontal > 1e-6 ? c.dx / horizontal : 0;
    const ux = c.dy * rz; const uy = c.dz * rx - c.dx * rz; const uz = -c.dy * rx;
    for (let p = 0; p < def.pellets; p++) {
      const r = p === 0 ? 0 : Math.tan(def.spread.hip) * Math.sqrt(p / (def.pellets - 1));
      const angle = p * 2.399963229728653 + ((c.seq * 0.61803398875) % 1) * Math.PI * 2;
      const side = r * Math.cos(angle); const up = r * Math.sin(angle);
      const dx = c.dx + rx * side + ux * up;
      const dy = c.dy + uy * up;
      const dz = c.dz + rz * side + uz * up;
      const len = Math.hypot(dx, dy, dz);
      const ray = { ...c, dx: dx / len, dy: dy / len, dz: dz / len };
      const hit = pickTarget(ray, candidates);
      if (hit !== null && this.world.lineOfSight({ x: c.ox, y: c.oy, z: c.oz }, hit)) {
        const victim = this.life.actors.get(hit.id);
        if (victim?.health.alive) this.life.hit(victim, a, hit.zone, hit.distance, def.id, 'bullet', now, c.ox, c.oz);
      }
    }
  }

  private rail(a: HostActor, c: ShotMsg, def: WeaponDef, candidates: TargetCandidate[], now: number): void {
    const profile = behaviorFor(def.id);
    const range = profile.range!;
    const intervals: [number, number][] = [];
    for (const box of this.world.solids ?? []) {
      const interval = solidInterval(c, box.min, box.max, range);
      if (interval !== null) intervals.push(interval);
    }
    intervals.sort((x, y) => x[0] - y[0]);
    // Overlapping decorative colliders form one solid wall, not multiple penetration charges.
    const merged: [number, number][] = [];
    for (const interval of intervals) {
      const last = merged[merged.length - 1];
      if (last && interval[0] <= last[1] + 0.001) last[1] = Math.max(last[1], interval[1]);
      else merged.push([...interval]);
    }
    const hits: TargetHit[] = [];
    for (const candidate of candidates) {
      const hit = pickTarget(c, [candidate]);
      if (hit && hit.distance <= range) hits.push(hit);
    }
    hits.sort((x, y) => x.distance - y.distance);
    for (const hit of hits) {
      const cover = merged.filter(([near]) => near < hit.distance).length;
      if (cover > profile.maxPenetrations!) continue;
      // A synthetic port lacking solid data must fail closed through opaque cover.
      if (this.world.solids === undefined && !this.world.lineOfSight({ x: c.ox, y: c.oy, z: c.oz }, hit)) continue;
      const victim = this.life.actors.get(hit.id);
      if (!victim?.health.alive) continue;
      const energy = Math.pow(profile.surfaceRetention!, cover);
      const scale = a.bot && !victim.bot ? BOT_DAMAGE_MULTIPLIER : 1;
      this.life.hit(victim, a, hit.zone, hit.distance, def.id, 'bullet', now, c.ox, c.oz,
        admitted(damageAt(def, hit.distance) * zoneMultiplier(def, hit.zone) * energy * scale));
    }
    this.life.emit({ type: 'weapon-effect', effect: 'rail', at: now, actorId: a.id, team: a.team,
      id: this.nextEffect++, weaponId: def.id, x: c.ox, y: c.oy, z: c.oz,
      dx: c.dx, dy: c.dy, dz: c.dz, radius: range, durationMs: 180 });
  }

  advance(now: number): void { this.effects.advance(now); }
  forget(id: ActorId): void { this.histories.delete(id); this.effects.forget(id); }
  endMatch(): void { this.histories.clear(); this.effects.clear(); }
}
