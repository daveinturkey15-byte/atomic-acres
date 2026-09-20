/**
 * Weapons lane — explosive-crossbow projectile runtime (CANARY, gated).
 *
 * The roster gates `explosive-crossbow` because the controller fires plain
 * semi-auto hitscan while the catalog designs a slow bolt. This module is the
 * independently rebuilt intended behavior: a slow gravity-dropped bolt with a
 * bounded flight, single-shot mag, and a fixed-cap live-bolt pool.
 *
 * Deliberately THREE-free and allocation-free on the flight path so the CPU
 * check (`scripts/check-crossbow-runtime.mjs`) exercises the real code in
 * plain node. Rendering is out of scope: a view layer maps live pool slots to
 * its own meshes; `dispose()` below releases only what this module owns.
 *
 * GATING: nothing here self-enables. `isCrossbowCanaryOptIn` requires the
 * explicit `crossbow=canary` opt-in, and the host seam (`game/host-crossbow.ts`)
 * keeps the id refused until the root accepts the behavior. Silently ungating
 * incomplete semantics is the failure this file exists to prevent.
 *
 * Tuning basis (stated, not ported): cadence/ammo/damage mirror the recovery
 * catalog row (`interval` 0.5, mag 1, reserve 12, reload 1.9/2.4, damage
 * 95→40 over 25→55 m) so the bolt lands the designed number through the
 * existing `damageAt`/zone path; flight itself is authored here because the
 * catalog row has no flight numbers (hitscan placeholder). The old project's
 * precedent (`authority: host-projectile-v1`, zero penetration surfaces,
 * mag 1) agrees on shape: the bolt dies on the first wall and never pierces.
 */

export const CROSSBOW_ID = 'explosive-crossbow';

/** Explicit opt-in token. Absent anywhere else means the bolt stays gated. */
export const CROSSBOW_CANARY_TOKEN = 'crossbow=canary';

/**
 * True only with the explicit canary token (URL query, env, or flag string).
 * Never defaults on; an empty/undefined source is a refusal, not a miss.
 * Exact `crossbow=canary` param match via URLSearchParams — a substring
 * `includes` would also accept `crossbow=canaryNO`, which must stay gated.
 */
export function isCrossbowCanaryOptIn(source: string | undefined | null): boolean {
  if (typeof source !== 'string' || source.length === 0) return false;
  let q = source.trim();
  if (q.length === 0) return false;
  const qIdx = q.indexOf('?');
  if (qIdx >= 0) q = q.slice(qIdx + 1);
  const hashIdx = q.indexOf('#');
  if (hashIdx >= 0) q = q.slice(0, hashIdx);
  q = q.trim();
  if (q.length === 0) return false;
  try {
    const params = new URLSearchParams(q);
    const vals = params.getAll('crossbow');
    for (const v of vals) if (v === 'canary') return true;
    return false;
  } catch {
    return false;
  }
}

/** Authored flight/cadence numbers. One place; the host mirrors none of it. */
export interface CrossbowTuning {
  /** Muzzle velocity, m/s. Slow enough to lead a sprint at 40 m, fast enough to feel like a bow. */
  readonly speed: number;
  /** Gravity on the bolt, m/s^2. Real gravity, not the grenade's 20.32 arcade value. */
  readonly gravity: number;
  /** Longest a bolt may fly, seconds. Bounds the integration absolutely. */
  readonly lifetime: number;
  /** Longest a bolt may travel, metres. Past the damage far edge, so range never refuses what falloff already priced. */
  readonly range: number;
  /** Fixed collision substep, seconds. 1/120 keeps a 60 m/s bolt to 0.5 m per step — no tunnelling through a torso. */
  readonly substep: number;
  /** Seconds between trigger pulls (recovery catalog `interval`, ~120 rpm rechamber). */
  readonly interval: number;
  readonly magSize: number;
  readonly startReserve: number;
  readonly reloadTime: number;
  readonly emptyReloadTime: number;
}

export const CROSSBOW_TUNING: CrossbowTuning = Object.freeze({
  speed: 60,
  gravity: 9.81,
  lifetime: 2.5,
  range: 90,
  substep: 1 / 120,
  interval: 0.5,
  magSize: 1,
  startReserve: 12,
  reloadTime: 1.9,
  emptyReloadTime: 2.4,
});

/** One live bolt. Mutated in place by `advanceBolt`; never reallocated in flight. */
export interface CrossbowBolt {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** Seconds since launch. */
  age: number;
  /** Metres travelled since launch. */
  distance: number;
  /** Host claim this bolt was admitted under (exactly-once seq). */
  seq: number;
  live: boolean;
}

/** Zeroed bolt record. Construction-time only. */
export function createBolt(): CrossbowBolt {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, distance: 0, seq: -1, live: false };
}

/**
 * Place a bolt at the admitted muzzle with the admitted aim axis. Direction
 * must be unit-length (the admission seam checks `|d| - 1 <= 1e-3` first).
 * Speed comes from tuning, never from the client.
 */
export function launchBolt(
  b: CrossbowBolt,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  seq: number,
  tuning: CrossbowTuning = CROSSBOW_TUNING,
): void {
  b.x = ox; b.y = oy; b.z = oz;
  b.vx = dx * tuning.speed; b.vy = dy * tuning.speed; b.vz = dz * tuning.speed;
  b.age = 0; b.distance = 0; b.seq = seq; b.live = true;
}

/**
 * One fixed integration step (semi-implicit Euler). Returns false when the
 * bolt's budget is spent (lifetime or range) and the caller must retire it.
 * `dt` is clamped to the tuning substep so a stalled tab owes no tunnelling.
 */
export function advanceBolt(b: CrossbowBolt, dt: number, tuning: CrossbowTuning = CROSSBOW_TUNING): boolean {
  if (!b.live) return false;
  const h = dt > tuning.substep ? tuning.substep : dt;
  b.vy -= tuning.gravity * h;
  const dx = b.vx * h;
  const dy = b.vy * h;
  const dz = b.vz * h;
  b.x += dx; b.y += dy; b.z += dz;
  b.age += h;
  b.distance += Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (b.age >= tuning.lifetime || b.distance >= tuning.range) {
    b.live = false;
    return false;
  }
  return true;
}

/** Why a trigger pull did not produce a bolt. Each is a distinct sentence. */
export type CrossbowFireBlock = 'reloading' | 'cooling' | 'empty' | 'disposed';

/** Single-shot ammo state. One instance per carrier; mutated in place. */
export interface CrossbowAmmo {
  mag: number;
  reserve: number;
  reloading: boolean;
  reloadT: number;
  reloadDur: number;
  /** Earliest time the next pull may fire. */
  coolUntil: number;
  disposed: boolean;
}

export function createCrossbowAmmo(tuning: CrossbowTuning = CROSSBOW_TUNING): CrossbowAmmo {
  return {
    mag: tuning.magSize, reserve: tuning.startReserve,
    reloading: false, reloadT: 0, reloadDur: tuning.reloadTime,
    coolUntil: 0, disposed: false,
  };
}

/**
 * Spend one bolt from the mag when the pull is legal. Returns null on success
 * (the caller launches the bolt), or the block reason. Reload/ammo/cooldown —
 * the cadence the catalog prices — live here, not in the view.
 */
export function tryCrossbowFire(
  a: CrossbowAmmo, now: number,
  tuning: CrossbowTuning = CROSSBOW_TUNING,
): CrossbowFireBlock | null {
  if (a.disposed) return 'disposed';
  if (a.reloading) return 'reloading';
  if (now < a.coolUntil) return 'cooling';
  if (a.mag <= 0) return 'empty';
  a.mag -= 1;
  a.coolUntil = now + tuning.interval;
  return null;
}

/** Begin a tactical/empty reload. Returns false when there is nothing to do. */
export function startCrossbowReload(a: CrossbowAmmo, tuning: CrossbowTuning = CROSSBOW_TUNING): boolean {
  if (a.disposed || a.reloading || a.reserve <= 0 || a.mag >= tuning.magSize) return false;
  a.reloading = true;
  a.reloadT = 0;
  a.reloadDur = a.mag <= 0 ? tuning.emptyReloadTime : tuning.reloadTime;
  return true;
}

/** Advance a reload; completes the transfer when the timer fills. */
export function tickCrossbowReload(a: CrossbowAmmo, dt: number, tuning: CrossbowTuning = CROSSBOW_TUNING): void {
  if (!a.reloading || a.disposed) return;
  a.reloadT += dt;
  if (a.reloadT < a.reloadDur) return;
  const need = tuning.magSize - a.mag;
  const take = need < a.reserve ? need : a.reserve;
  a.mag += take;
  a.reserve -= take;
  a.reloading = false;
  a.reloadT = 0;
}

/**
 * Bounded live-bolt pool. Fixed capacity, preallocated, ring-recycled: a
 * ninth concurrent bolt is refused (`-1`), never grown. Render disposal is
 * the view's job; `dispose()` here retires every live bolt and refuses all
 * future spawns so a torn-down lane cannot leak flight.
 */
export class CrossbowBoltPool {
  private readonly slots: CrossbowBolt[] = [];
  private cursor = 0;
  private disposed = false;
  readonly capacity: number;

  constructor(capacity: number = 8) {
    this.capacity = capacity > 0 ? Math.floor(capacity) : 8;
    const n = this.capacity;
    for (let i = 0; i < n; i++) this.slots.push(createBolt());
  }
  get size(): number {
    return this.slots.length;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /** Live bolts currently in flight. */
  activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i].live) n++;
    return n;
  }

  /** Direct slot access for the host stepper. Construction-sized, never grown. */
  slot(i: number): CrossbowBolt {
    return this.slots[i];
  }

  /**
   * Launch into the next free slot (ring order). Returns the slot index, or
   * -1 when disposed or every slot is live — the caller reports the drop,
   * it never allocates a ninth bolt.
   */
  spawn(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    seq: number,
    tuning: CrossbowTuning = CROSSBOW_TUNING,
  ): number {
    if (this.disposed) return -1;
    for (let k = 0; k < this.slots.length; k++) {
      const i = (this.cursor + k) % this.slots.length;
      if (!this.slots[i].live) {
        launchBolt(this.slots[i], ox, oy, oz, dx, dy, dz, seq, tuning);
        this.cursor = (i + 1) % this.slots.length;
        return i;
      }
    }
    return -1;
  }

  /** Retire a slot after it landed, hit a wall, or expired. Idempotent. */
  retire(i: number): void {
    if (i >= 0 && i < this.slots.length) this.slots[i].live = false;
  }

  /** Retire everything and refuse future spawns. The view drops its meshes on the same call. */
  dispose(): void {
    this.disposed = true;
    for (let i = 0; i < this.slots.length; i++) this.slots[i].live = false;
  }
}
