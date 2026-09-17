/**
 * Atomic Acres — first-person weapon effects (fan project inspired by BO2).
 *
 * Fully pooled, zero-allocation-after-construction feedback kit: one muzzle
 * flash quad, tracer slugs, ejected shell cases, and impact sparks + flashes.
 * Lifetimes advance through visible/scale/position/quaternion changes only —
 * never opacity, color, or material work. Exhausted pools reuse the oldest
 * slot (round-robin), so sustained fire never throws.
 */
import * as THREE from 'three';
import { PAL } from '../core/palette';
import type { MaterialLibrary } from '../core/materials';
import type { WeaponSnapshot } from './types';

const FLASH_LIFE = 0.05;
const TRACER_LIFE = 0.07;
const SHELL_LIFE = 0.9;
const IMPACT_LIFE = 0.12;
const GRAVITY = 9.8;
const FULL_CIRCLE = Math.PI * 2;

const TRACER_COUNT = 8;
const SHELL_COUNT = 24;
const SPARK_COUNT = 12;
const IMPACT_QUAD_COUNT = 4;
const SPARKS_PER_IMPACT = 3;

export class WeaponEffects {
  readonly group: THREE.Group;

  // Shared geometries — one instance per pool, reused by every slot.
  private readonly flashGeo: THREE.PlaneGeometry;
  private readonly tracerGeo: THREE.BoxGeometry;
  private readonly shellGeo: THREE.BoxGeometry;
  private readonly sparkGeo: THREE.BoxGeometry;
  private readonly impactGeo: THREE.PlaneGeometry;

  // Library singletons — resolved once here, never per frame / per state.
  private readonly flashMat: THREE.Material;
  private readonly tracerMat: THREE.Material;
  private readonly shellMat: THREE.Material;
  private readonly sparkMat: THREE.Material;
  private readonly impactMat: THREE.Material;

  // Muzzle flash (single quad).
  private readonly flash: THREE.Mesh;
  private flashLife = 0;

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

    this.flashGeo = new THREE.PlaneGeometry(0.24, 0.24);
    this.tracerGeo = new THREE.BoxGeometry(0.02, 0.02, 1);
    this.shellGeo = new THREE.BoxGeometry(0.012, 0.012, 0.032);
    this.sparkGeo = new THREE.BoxGeometry(0.014, 0.014, 0.07);
    this.impactGeo = new THREE.PlaneGeometry(0.2, 0.2);

    this.flash = new THREE.Mesh(this.flashGeo, this.flashMat);
    this.flash.visible = false;
    this.group.add(this.flash);

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
  }

  /** Pop the muzzle flash at the barrel tip with a random roll. */
  flashAt(pos: THREE.Vector3, quat: THREE.Quaternion): void {
    this.flash.position.copy(pos);
    this.flash.quaternion.copy(quat);
    this.flash.rotateZ(Math.random() * FULL_CIRCLE);
    this.flash.scale.set(1, 1, 1);
    this.flash.visible = true;
    this.flashLife = FLASH_LIFE;
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

  /** Pop an impact flash + spark burst aligned to the surface normal. */
  impact(point: THREE.Vector3, normal: THREE.Vector3): void {
    this._b.copy(normal);
    if (this._b.lengthSq() < 1e-8) this._b.set(0, 1, 0);
    this._b.normalize();

    const q = this.impactNext;
    this.impactNext = (this.impactNext + 1) % IMPACT_QUAD_COUNT;
    const qm = this.impactMeshes[q];
    qm.position.copy(point).addScaledVector(this._b, 0.012);
    qm.quaternion.setFromUnitVectors(this._zAxis, this._b);
    qm.rotateZ(q * 1.7);
    qm.scale.set(1, 1, 1);
    qm.visible = true;
    this.impactLife[q] = IMPACT_LIFE;

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
  }

  /** Advance every live slot. Visible/scale/position/quaternion only. */
  update(dt: number): void {
    if (!(dt > 0)) return;

    if (this.flash.visible) {
      this.flashLife -= dt;
      if (this.flashLife <= 0) {
        this.flash.visible = false;
      } else {
        const s = 0.55 + 0.45 * (this.flashLife / FLASH_LIFE);
        this.flash.scale.set(s, s, 1);
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
      m.scale.set(s, s, 1);
    }
  }

  /** Count of currently visible pooled objects across every pool. */
  liveCount(): number {
    let n = 0;
    if (this.flash.visible) n++;
    for (let i = 0; i < TRACER_COUNT; i++) if (this.tracerMeshes[i].visible) n++;
    for (let i = 0; i < SHELL_COUNT; i++) if (this.shellMeshes[i].visible) n++;
    for (let i = 0; i < SPARK_COUNT; i++) if (this.sparkMeshes[i].visible) n++;
    for (let i = 0; i < IMPACT_QUAD_COUNT; i++) if (this.impactMeshes[i].visible) n++;
    return n;
  }
}
