/**
 * Atomic Acres — grenades in the world: the thrown casing, the blast flash,
 * and the PLACEHOLDER smoke.
 *
 * Three instanced meshes, one draw each, built once from library singletons
 * and driven by `game/ordnance-view.ts` — the client's projection of what the
 * host said. Flights are replayed here with the same `stepBallistic` the host
 * used against the same `WorldQuery`, so the casing a player watches bounce
 * is the one the host detonates; the detonation event snaps it.
 *
 * THE BLAST IS NOT A LIGHT. PASS 82: the light set is frozen after the first
 * frame, so the flash is an emissive sphere that blooms, plus the effects
 * pool's flash star, dust and sparks (`WeaponEffects.blast`, called through
 * `onBlast`). Nothing here adds, removes or toggles a `THREE.Light`.
 *
 * THE SMOKE IS A PLACEHOLDER, and swappable: it reads only the
 * `smoke-volume` / `smoke-volume-end` events (as `view.smokes`) — the same
 * contract the atmosphere lane will draw volumetric fog from. Puffballs of
 * `mat.glass` (the one transparent library material) jitter inside the
 * sphere, grow to its radius over 1.5 s, drift, and shrink away over the last
 * 5 s. The proper material (`mat.smoke()`: unlit, soft alpha, no depth write)
 * is requested in the lane report; nothing here constructs one.
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '../core/materials';
import { PAL } from '../core/palette';
import type { WorldQuery } from '../game/events';
import { BLAST_RING, FLIGHT_POOL, SMOKE_POOL, type OrdnanceView } from '../game/ordnance-view';
import { stepBallistic } from '../game/ordnance-physics';
import { SMOKE_DISSOLVE_MS, SMOKE_FILL_MS } from '../game/world-query';

/** Puffs per smoke volume. Twelve overlapping spheres read as one cloud. */
export const PUFFS_PER_SMOKE = 12;
/** How long the blast sphere is visible, and how big it gets, in metres. */
export const BLAST_FLASH_S = 0.35;
export const BLAST_FLASH_RADIUS = 2.4;
/** Presentation step for a replayed flight. Sub-stepped so a slow frame does not tunnel. */
const FLIGHT_STEP_S = 1 / 60;
const ZERO = new THREE.Vector3(0, 0, 0);
const ONE = new THREE.Vector3(1, 1, 1);

/** Deterministic jitter per (volume, puff): the same cloud on every peer. */
function hash(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export class GrenadeFx {
  readonly group: THREE.Group;
  private readonly casings: THREE.InstancedMesh;
  private readonly flashes: THREE.InstancedMesh;
  private readonly puffs: THREE.InstancedMesh;
  private readonly blastAt: number[] = [];
  private readonly blastPos: THREE.Vector3[] = [];
  private lastBlastSeq = 0;
  private acc = 0;

  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  constructor(mat: MaterialLibrary, private readonly world: WorldQuery) {
    this.group = new THREE.Group();
    this.group.name = 'atomic-acres-grenades';

    // The same olive as the held grenade in `viewmodel.ts`, so they match.
    this.casings = new THREE.InstancedMesh(new THREE.SphereGeometry(0.085, 10, 8), mat.painted(PAL.hedge, 0.75, 0.25), FLIGHT_POOL);
    this.flashes = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 14, 10), mat.emissive(PAL.sunColor, 6), BLAST_RING);
    this.puffs = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), mat.glass, SMOKE_POOL * PUFFS_PER_SMOKE);
    for (const im of [this.casings, this.flashes, this.puffs]) {
      // Instances travel the whole map; the geometry's own bounding sphere
      // would cull them the moment the group origin left the frustum.
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, this.m.compose(ZERO, this.q.identity(), ZERO));
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
    }
    for (let i = 0; i < BLAST_RING; i++) {
      this.blastAt.push(-Infinity);
      this.blastPos.push(new THREE.Vector3());
    }
  }

  /**
   * One frame. `nowMs` is the host clock domain (`performance.now()`), so
   * smoke ramps read against the volume's own `bornAt`/`diesAt`. `onBlast`
   * fires once per new detonation for the effects pool.
   */
  update(dt: number, nowMs: number, view: OrdnanceView, onBlast: (x: number, y: number, z: number, grenadeId: string) => void): void {
    // ---- flights: replay, sub-stepped, then tumble the casing --------------
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= FLIGHT_STEP_S && steps < 8) {
      this.acc -= FLIGHT_STEP_S;
      steps++;
      for (const f of view.flights) if (f.live && !f.resting) stepBallistic(f, FLIGHT_STEP_S, this.world);
    }
    for (let i = 0; i < FLIGHT_POOL; i++) {
      const f = view.flights[i];
      if (!f.live) {
        this.casings.setMatrixAt(i, this.m.compose(ZERO, this.q.identity(), ZERO));
        continue;
      }
      const age = (nowMs - f.bornAt) / 1000;
      const spin = f.resting ? 0 : age * 9;
      this.e.set(spin, spin * 0.7, 0);
      this.p.set(f.x, f.y, f.z);
      this.casings.setMatrixAt(i, this.m.compose(this.p, this.q.setFromEuler(this.e), ONE));
    }
    this.casings.instanceMatrix.needsUpdate = true;

    // ---- blasts: consume new detonations, run the emissive sphere ----------
    while (this.lastBlastSeq < view.blastSeq) {
      this.lastBlastSeq++;
      const b = view.blasts.find((v) => v.seq === this.lastBlastSeq);
      if (b === undefined) continue;
      const slot = this.lastBlastSeq % BLAST_RING;
      this.blastAt[slot] = nowMs;
      this.blastPos[slot].set(b.x, b.y, b.z);
      onBlast(b.x, b.y, b.z, b.grenadeId);
    }
    for (let i = 0; i < BLAST_RING; i++) {
      const t = (nowMs - this.blastAt[i]) / 1000 / BLAST_FLASH_S;
      if (!(t >= 0 && t < 1)) {
        this.flashes.setMatrixAt(i, this.m.compose(ZERO, this.q.identity(), ZERO));
        continue;
      }
      // Fast out, then gone: radius grows as sqrt, the sphere collapses in the last third.
      const r = BLAST_FLASH_RADIUS * Math.sqrt(t) * (t < 0.66 ? 1 : 1 - (t - 0.66) / 0.34);
      this.s.set(r, r * 0.8, r);
      this.flashes.setMatrixAt(i, this.m.compose(this.blastPos[i], this.q.identity(), this.s));
    }
    this.flashes.instanceMatrix.needsUpdate = true;

    // ---- smoke: the placeholder puffballs ------------------------------------
    let k = 0;
    for (let si = 0; si < SMOKE_POOL; si++) {
      const v = si < view.smokes.length ? view.smokes[si] : null;
      for (let j = 0; j < PUFFS_PER_SMOKE; j++, k++) {
        if (v === null || nowMs >= v.diesAt) {
          this.puffs.setMatrixAt(k, this.m.compose(ZERO, this.q.identity(), ZERO));
          continue;
        }
        const fill = Math.min(1, Math.max(0, (nowMs - v.bornAt) / SMOKE_FILL_MS));
        const fade = Math.min(1, Math.max(0, (v.diesAt - nowMs) / SMOKE_DISSOLVE_MS));
        const grow = Math.sqrt(fill) * fade;
        const u = hash(v.id, j * 3 + 1) * 2 - 1;
        const w = hash(v.id, j * 3 + 2) * 2 - 1;
        const h = hash(v.id, j * 3 + 3);
        // Spread the puffs through the sphere, biased upward, drifting up with age.
        const drift = (nowMs - v.bornAt) / 1000 * 0.12;
        this.p.set(
          v.x + u * v.radius * 0.55 * grow,
          v.y + (0.15 + h * 0.6) * v.radius * grow + drift * grow,
          v.z + w * v.radius * 0.55 * grow,
        );
        const r = v.radius * (0.32 + h * 0.22) * grow;
        this.s.set(r, r * 0.85, r);
        this.e.set(0, h * 6.28, 0);
        this.puffs.setMatrixAt(k, this.m.compose(this.p, this.q.setFromEuler(this.e), this.s));
      }
    }
    this.puffs.instanceMatrix.needsUpdate = true;
  }

  /** Live counts for the QA surface. */
  counts(view: OrdnanceView): { flights: number; smokes: number } {
    let flights = 0;
    for (const f of view.flights) if (f.live) flights++;
    return { flights, smokes: view.smokes.length };
  }
}
