/**
 * Atomic Acres — first-person weapon effects (fan project inspired by BO2).
 *
 * Fully pooled, zero-allocation-after-construction feedback kit: a crossed-quad
 * muzzle flash, tracer slugs, ejected shell cases, impact sparks, dust puffs by
 * surface, and persistent impact decals. Lifetimes advance through
 * visible/scale/position/quaternion changes only — never opacity, color, or
 * material work. Exhausted pools reuse the oldest slot (round-robin), so
 * sustained fire never throws.
 *
 * Materials are library singletons resolved once at construction, and the two
 * pools added after the skeleton (decals, dust) deliberately reuse cache keys
 * the viewmodels already warm — this file introduces zero new materials and
 * zero new shader programs.
 */
import * as THREE from 'three';
import { PAL } from '../core/palette';
import type { MaterialLibrary } from '../core/materials';

const FLASH_LIFE = 0.05;
const TRACER_LIFE = 0.07;
const SHELL_LIFE = 0.9;
const IMPACT_LIFE = 0.12;
const DUST_LIFE = 0.5;
const DECAL_LIFE = 20;
const GRAVITY = 9.8;
const DUST_GRAVITY = 2.0;
const FULL_CIRCLE = Math.PI * 2;
/** golden-angle step: deterministic per-pop roll, no Math.random in the pool */
const ROLL_STEP = 2.399963;

const TRACER_COUNT = 8;
const SHELL_COUNT = 24;
const SPARK_COUNT = 12;
const IMPACT_QUAD_COUNT = 4;
const SPARKS_PER_IMPACT = 3;
const DUST_COUNT = 10;
const DUST_PER_IMPACT = 3;
const DECAL_COUNT = 48;

export class WeaponEffects {
  readonly group: THREE.Group;

  // Shared geometries — one instance per pool, reused by every slot.
  private readonly flashGeo: THREE.PlaneGeometry;
  private readonly tracerGeo: THREE.BoxGeometry;
  private readonly shellGeo: THREE.BoxGeometry;
  private readonly sparkGeo: THREE.BoxGeometry;
  private readonly impactGeo: THREE.PlaneGeometry;

  // Library singletons — resolved once here, never per frame / per state.
  // decalMat reuses the rifle-body cache key, dustMat the shell key.
  private readonly flashMat: THREE.Material;
  private readonly tracerMat: THREE.Material;
  private readonly shellMat: THREE.Material;
  private readonly sparkMat: THREE.Material;
  private readonly impactMat: THREE.Material;
  private readonly decalMat: THREE.Material;
  private readonly dustMat: THREE.Material;

  // Muzzle flash (crossed pair — reads as a flash star, never a white square).
  private readonly flashA: THREE.Mesh;
  private readonly flashB: THREE.Mesh;
  private flashLife = 0;
  private flashTick = 0;
  /** The pop the flash is running on: a muzzle pop is 1 / FLASH_LIFE; a blast is bigger and longer. */
  private flashScale = 1;
  private flashSpan = FLASH_LIFE;

  // Tracer pool.
  private readonly tracerMeshes: THREE.Mesh[] = [];
  private readonly tracerFrom: THREE.Vector3[] = [];
  private readonly tracerDir: THREE.Vector3[] = [];
  private readonly tracerLen: number[] = [];
  private readonly tracerLife: number[] = [];
  private tracerNext = 0;

  // Shell pool — each slot owns its velocity + spin, allocated up front.
  private readonly shellMeshes: THREE.Mesh[] = [];
  private readonly shellVel: THREE.Vector3[] = [];
  private readonly shellSpin: THREE.Vector3[] = [];
  private readonly shellAge: number[] = [];
  private shellNext = 0;

  // Impact pools.
  private readonly sparkMeshes: THREE.Mesh[] = [];
  private readonly sparkVel: THREE.Vector3[] = [];
  private readonly sparkLife: number[] = [];
  private sparkNext = 0;
  private readonly impactMeshes: THREE.Mesh[] = [];
  private readonly impactLife: number[] = [];
  private impactNext = 0;

  // Dust puffs for ground-ish surfaces (normal.y > 0.5 picks dust over sparks).
  private readonly dustMeshes: THREE.Mesh[] = [];
  private readonly dustVel: THREE.Vector3[] = [];
  private readonly dustLife: number[] = [];
  private dustNext = 0;

  // Persistent impact decals — ring buffer, overwritten when full.
  private readonly decalMeshes: THREE.Mesh[] = [];
  private readonly decalAge: number[] = [];
  private decalNext = 0;

  // Preallocated scratch — every hot-path write goes through these.
  private readonly _a = new THREE.Vector3();
  private readonly _b = new THREE.Vector3();
  private readonly _zAxis = new THREE.Vector3(0, 0, 1);

  constructor(scene: THREE.Scene, mat: MaterialLibrary) {
    // The caller owns scene membership and adds `group` itself.
    void scene;

    this.group = new THREE.Group();
    this.group.name = 'atomic-acres-weapon-effects';

    this.flashMat = mat.emissive(PAL.sunColor, 2.4);
    this.tracerMat = mat.emissive(PAL.sunColor, 1.8);
    this.shellMat = mat.painted(PAL.sand, 0.35, 0.8);
    this.sparkMat = mat.emissive(PAL.sunColor, 1.6);
    this.impactMat = mat.emissive(PAL.sunColor, 2.0);
    this.decalMat = mat.painted(PAL.truckCab, 0.6, 0.35);
    this.dustMat = mat.painted(PAL.sand, 0.35, 0.8);

    this.flashGeo = new THREE.PlaneGeometry(0.24, 0.24);
    this.tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
    this.shellGeo = new THREE.BoxGeometry(0.012, 0.012, 0.032);
    this.sparkGeo = new THREE.BoxGeometry(0.014, 0.014, 0.07);
    this.impactGeo = new THREE.PlaneGeometry(0.2, 0.2);

    this.flashA = new THREE.Mesh(this.flashGeo, this.flashMat);
    this.flashB = new THREE.Mesh(this.flashGeo, this.flashMat);
    this.flashA.visible = false;
    this.flashB.visible = false;
    this.group.add(this.flashA);
    this.group.add(this.flashB);

    for (let i = 0; i < TRACER_COUNT; i++) {
      const m = new THREE.Mesh(this.tracerGeo, this.tracerMat);
      m.visible = false;
      this.group.add(m);
      this.tracerMeshes.push(m);
      this.tracerFrom.push(new THREE.Vector3());
      this.tracerDir.push(new THREE.Vector3(0, 0, -1));
      this.tracerLen.push(1);
      this.tracerLife.push(0);
    }

    for (let i = 0; i < SHELL_COUNT; i++) {
      const m = new THREE.Mesh(this.shellGeo, this.shellMat);
      m.visible = false;
      this.group.add(m);
      this.shellMeshes.push(m);
      this.shellVel.push(new THREE.Vector3());
      // Deterministic per-slot tumble so the brass reads as tumbling, not sliding.
      this.shellSpin.push(
        new THREE.Vector3(6 + (i % 4) * 3, (i % 3) * 4 - 4, (i % 5) * 2.5 - 5),
      );
      this.shellAge.push(SHELL_LIFE);
    }

    for (let i = 0; i < SPARK_COUNT; i++) {
      const m = new THREE.Mesh(this.sparkGeo, this.sparkMat);
      m.visible = false;
      this.group.add(m);
      this.sparkMeshes.push(m);
      this.sparkVel.push(new THREE.Vector3());
      this.sparkLife.push(0);
    }

    for (let i = 0; i < IMPACT_QUAD_COUNT; i++) {
      const m = new THREE.Mesh(this.impactGeo, this.impactMat);
      m.visible = false;
      this.group.add(m);
      this.impactMeshes.push(m);
      this.impactLife.push(0);
    }

    for (let i = 0; i < DUST_COUNT; i++) {
      const m = new THREE.Mesh(this.impactGeo, this.dustMat);
      m.visible = false;
      this.group.add(m);
      this.dustMeshes.push(m);
      this.dustVel.push(new THREE.Vector3());
      this.dustLife.push(0);
    }

    for (let i = 0; i < DECAL_COUNT; i++) {
      const m = new THREE.Mesh(this.impactGeo, this.decalMat);
      m.visible = false;
      this.group.add(m);
      this.decalMeshes.push(m);
      this.decalAge.push(DECAL_LIFE);
    }
  }

  /**
   * Pop the muzzle flash at the barrel tip. The quads billboard to the camera
   * (a muzzle-aligned plane is edge-on from behind the gun and vanishes), with
   * a deterministic golden-angle roll per pop — no per-shot randomness.
   */
  flashAt(pos: THREE.Vector3, camQuat: THREE.Quaternion, scale = 1, life = FLASH_LIFE): void {
    this.flashTick++;
    const roll = this.flashTick * ROLL_STEP;
    for (let k = 0; k < 2; k++) {
      const m = k === 0 ? this.flashA : this.flashB;
      m.position.copy(pos);
      m.quaternion.copy(camQuat);
      m.rotateZ(k === 0 ? roll : roll + Math.PI / 2);
      if (k === 0) m.scale.set(0.55 * scale, 1.6 * scale, 1);
      else m.scale.set(1.6 * scale, 0.55 * scale, 1);
      m.visible = true;
    }
    this.flashScale = scale;
    this.flashSpan = life;
    this.flashLife = life;
  }

  /**
   * A grenade going off (ordnance lane): the flash star at eight times a
   * muzzle pop for a quarter second, a dust puff off the ground and a spark
   * burst off it - all from the pools this class already owns, so a blast
   * adds no material, no light and no allocation. The lingering smoke is NOT
   * here: that is a `smoke-volume` on the bus, drawn by `grenades.ts`.
   */
  blast(point: THREE.Vector3, camQuat: THREE.Quaternion): void {
    this._b.set(0, 1, 0);
    this.flashAt(point, camQuat, 8, 0.25);
    for (let k = 0; k < 3; k++) this.impact(point, this._b, true);
  }

  /** Stretch a tracer slug from `from` along `dir` for `len` metres. */
  tracer(from: THREE.Vector3, dir: THREE.Vector3, len: number): void {
    const i = this.tracerNext;
    this.tracerNext = (this.tracerNext + 1) % TRACER_COUNT;
    const m = this.tracerMeshes[i];
    this._a.copy(dir);
    if (this._a.lengthSq() < 1e-8) this._a.set(0, 0, -1);
    this._a.normalize();
    const full = len > 0.05 ? len : 0.05;
    this.tracerFrom[i].copy(from);
    this.tracerDir[i].copy(this._a);
    this.tracerLen[i] = full;
    this.tracerLife[i] = TRACER_LIFE;
    m.quaternion.setFromUnitVectors(this._zAxis, this._a);
    m.position.copy(from).addScaledVector(this._a, full * 0.5);
    m.scale.set(1, 1, full);
    m.visible = true;
  }

  /** Eject a shell case with right+up velocity off the ejection frame. */
  shell(pos: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3): void {
    const i = this.shellNext;
    this.shellNext = (this.shellNext + 1) % SHELL_COUNT;
    const m = this.shellMeshes[i];
    const v = this.shellVel[i];
    v.copy(right).multiplyScalar(1.5 + (i % 5) * 0.12);
    v.addScaledVector(up, 2.0 + (i % 7) * 0.09);
    v.y += 0.6;
    m.position.copy(pos);
    m.rotation.set((i * 1.3) % FULL_CIRCLE, (i * 2.1) % FULL_CIRCLE, 0);
    m.scale.set(1, 1, 1);
    m.visible = true;
    this.shellAge[i] = 0;
  }

  /**
   * Pop an impact flash + spark burst aligned to the surface normal, stamp a
   * persistent decal, and puff dust when the surface faces up (ground, patio,
   * lawn — normal.y > 0.5) instead of throwing extra sparks off a wall.
   */
  impact(point: THREE.Vector3, normal: THREE.Vector3, dusty: boolean): void {
    this._b.copy(normal);
    if (this._b.lengthSq() < 1e-8) this._b.set(0, 1, 0);
    this._b.normalize();

    const q = this.impactNext;
    this.impactNext = (this.impactNext + 1) % IMPACT_QUAD_COUNT;
    const qm = this.impactMeshes[q];
    qm.position.copy(point).addScaledVector(this._b, 0.016);
    qm.quaternion.setFromUnitVectors(this._zAxis, this._b);
    qm.rotateZ(q * 1.7);
    qm.scale.set(0.6, 0.6, 1);
    qm.visible = true;
    this.impactLife[q] = IMPACT_LIFE;

    const d = this.decalNext;
    this.decalNext = (this.decalNext + 1) % DECAL_COUNT;
    const dm = this.decalMeshes[d];
    dm.position.copy(point).addScaledVector(this._b, 0.009);
    dm.quaternion.setFromUnitVectors(this._zAxis, this._b);
    dm.rotateZ(d * ROLL_STEP);
    const ds = 0.35 + (d % 4) * 0.06;
    dm.scale.set(ds, ds, 1);
    dm.visible = true;
    this.decalAge[d] = 0;

    for (let k = 0; k < SPARKS_PER_IMPACT; k++) {
      const i = this.sparkNext;
      this.sparkNext = (this.sparkNext + 1) % SPARK_COUNT;
      const sm = this.sparkMeshes[i];
      const sv = this.sparkVel[i];
      sm.position.copy(point).addScaledVector(this._b, 0.01);
      sv.copy(this._b).multiplyScalar(2.0 + (i % 4) * 0.6);
      // Deterministic per-slot fan so bursts vary without per-frame randomness.
      sv.x += ((((i * 37 + k * 11) % 10) + 10) % 10 / 10 - 0.5) * 4;
      sv.y += ((((i * 53 + k * 17) % 10) + 10) % 10 / 10) * 3;
      sv.z += ((((i * 29 + k * 7) % 10) + 10) % 10 / 10 - 0.5) * 4;
      this._a.copy(sv);
      if (this._a.lengthSq() < 1e-8) this._a.copy(this._b);
      this._a.normalize();
      sm.quaternion.setFromUnitVectors(this._zAxis, this._a);
      sm.scale.set(1, 1, 1);
      sm.visible = true;
      this.sparkLife[i] = IMPACT_LIFE;
    }

    if (dusty) {
      for (let k = 0; k < DUST_PER_IMPACT; k++) {
        const i = this.dustNext;
        this.dustNext = (this.dustNext + 1) % DUST_COUNT;
        const um = this.dustMeshes[i];
        const uv = this.dustVel[i];
        um.position.copy(point).addScaledVector(this._b, 0.03);
        uv.copy(this._b).multiplyScalar(0.9 + (i % 3) * 0.25);
        uv.x += ((((i * 41 + k * 13) % 10) + 10) % 10 / 10 - 0.5) * 1.6;
        uv.y += 0.7 + ((((i * 47 + k * 19) % 10) + 10) % 10 / 10) * 0.9;
        uv.z += ((((i * 31 + k * 5) % 10) + 10) % 10 / 10 - 0.5) * 1.6;
        um.scale.set(0.6, 0.6, 1);
        um.visible = true;
        this.dustLife[i] = DUST_LIFE;
      }
    }
  }

  /**
   * QA-only: stretch every live transient lifetime so a screenshot can catch
   * the flash/tracer/impact mid-flight. No allocation, no new objects.
   */
  stretchLives(mult: number): void {
    if (!(mult > 1)) return;
    this.flashLife *= mult;
    for (let i = 0; i < TRACER_COUNT; i++) this.tracerLife[i] *= mult;
    for (let i = 0; i < SPARK_COUNT; i++) this.sparkLife[i] *= mult;
    for (let i = 0; i < IMPACT_QUAD_COUNT; i++) this.impactLife[i] *= mult;
    for (let i = 0; i < DUST_COUNT; i++) this.dustLife[i] *= mult;
  }

  /** Advance every live slot. Visible/scale/position/quaternion only. */
  update(dt: number): void {
    if (!(dt > 0)) return;

    if (this.flashA.visible) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) {
        this.flashA.visible = false;
        this.flashB.visible = false;
      } else {
        const s = (0.55 + 0.45 * (this.flashLife / this.flashSpan)) * this.flashScale;
        this.flashA.scale.set(0.55 * s, 1.6 * s, 1);
        this.flashB.scale.set(1.6 * s, 0.55 * s, 1);
      }
    }

    for (let i = 0; i < TRACER_COUNT; i++) {
      const m = this.tracerMeshes[i];
      if (!m.visible) continue;
      const life = this.tracerLife[i] - dt;
      this.tracerLife[i] = life;
      if (life <= 0) {
        m.visible = false;
        continue;
      }
      const f = life / TRACER_LIFE;
      const full = this.tracerLen[i];
      const cur = full * f;
      m.scale.set(f, f, cur > 0.001 ? cur : 0.001);
      // Anchor the hit end so the slug collapses into the impact point.
      m.position.copy(this.tracerFrom[i]).addScaledVector(this.tracerDir[i], full - cur * 0.5);
    }

    for (let i = 0; i < SHELL_COUNT; i++) {
      const m = this.shellMeshes[i];
      if (!m.visible) continue;
      const age = this.shellAge[i] + dt;
      this.shellAge[i] = age;
      if (age >= SHELL_LIFE) {
        m.visible = false;
        continue;
      }
      const v = this.shellVel[i];
      v.y -= GRAVITY * dt;
      m.position.addScaledVector(v, dt);
      const sp = this.shellSpin[i];
      m.rotation.x += sp.x * dt;
      m.rotation.y += sp.y * dt;
      m.rotation.z += sp.z * dt;
      const t = age / SHELL_LIFE;
      if (t > 0.7) {
        const s = 1 - (t - 0.7) / 0.3;
        m.scale.set(s, s, s);
      }
    }

    for (let i = 0; i < SPARK_COUNT; i++) {
      const m = this.sparkMeshes[i];
      if (!m.visible) continue;
      const life = this.sparkLife[i] - dt;
      this.sparkLife[i] = life;
      if (life <= 0) {
        m.visible = false;
        continue;
      }
      const v = this.sparkVel[i];
      v.y -= GRAVITY * dt;
      m.position.addScaledVector(v, dt);
      this._a.copy(v);
      if (this._a.lengthSq() > 1e-8) {
        this._a.normalize();
        m.quaternion.setFromUnitVectors(this._zAxis, this._a);
      }
      const s = life / IMPACT_LIFE;
      m.scale.set(s, s, s);
    }

    for (let i = 0; i < IMPACT_QUAD_COUNT; i++) {
      const m = this.impactMeshes[i];
      if (!m.visible) continue;
      const life = this.impactLife[i] - dt;
      this.impactLife[i] = life;
      if (life <= 0) {
        m.visible = false;
        continue;
      }
      const s = 0.25 + 0.75 * (life / IMPACT_LIFE);
      m.scale.set(0.6 * s, 0.6 * s, 1);
    }

    for (let i = 0; i < DUST_COUNT; i++) {
      const m = this.dustMeshes[i];
      if (!m.visible) continue;
      const life = this.dustLife[i] - dt;
      this.dustLife[i] = life;
      if (life <= 0) {
        m.visible = false;
        continue;
      }
      const v = this.dustVel[i];
      v.y -= DUST_GRAVITY * dt;
      if (v.y < 0.25) v.y = 0.25;
      m.position.addScaledVector(v, dt);
      const t = 1 - life / DUST_LIFE;
      const s = 0.6 + t * 1.6;
      m.scale.set(s, s, 1);
    }

    for (let i = 0; i < DECAL_COUNT; i++) {
      const m = this.decalMeshes[i];
      if (!m.visible) continue;
      const age = this.decalAge[i] + dt;
      this.decalAge[i] = age;
      if (age >= DECAL_LIFE) m.visible = false;
    }
  }

  /** Count of currently visible transient objects (decals excluded). */
  liveCount(): number {
    let n = 0;
    if (this.flashA.visible) n += 2;
    for (let i = 0; i < TRACER_COUNT; i++) if (this.tracerMeshes[i].visible) n++;
    for (let i = 0; i < SHELL_COUNT; i++) if (this.shellMeshes[i].visible) n++;
    for (let i = 0; i < SPARK_COUNT; i++) if (this.sparkMeshes[i].visible) n++;
    for (let i = 0; i < IMPACT_QUAD_COUNT; i++) if (this.impactMeshes[i].visible) n++;
    for (let i = 0; i < DUST_COUNT; i++) if (this.dustMeshes[i].visible) n++;
    return n;
  }

  /** Stamped decals currently on surfaces (persistent, ring buffer). */
  decalCount(): number {
    let n = 0;
    for (let i = 0; i < DECAL_COUNT; i++) if (this.decalMeshes[i].visible) n++;
    return n;
  }
}
