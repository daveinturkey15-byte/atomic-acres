/**
 * Mortar in the world: the warning disc and the dust rings.
 *
 * Two capped mesh sets, zero new materials, zero new lights, zero per-frame
 * allocation. Telegraph discs are `mat.emissive(PAL.applianceRed)` — the
 * project's danger red, shared with the lawn appliances — laid flat on the
 * anchor, pulsing by scale only (materials are singletons: nothing here
 * touches opacity, which would need a clone and a new program). Dust rings
 * are `mat.painted(PAL.dirt)` expanding from each impact to its splash radius
 * over 0.6 s, then holding as a stain marker until `MORTAR_DUST_MS`.
 *
 * THE FLASH IS NOT HERE. The detonation flash star, dust puff and sparks come
 * from the existing `WeaponEffects.blast` pool through `weapons.mortarFlash`
 * (called once per new impact by the owner of this object): one pool, one
 * program set, no second flash implementation to drift. The lingering smoke
 * is VISUAL-ONLY dust: it never enters the smoke contract and never blinds
 * bots. This object draws rings; the bus decides.
 */

import * as THREE from 'three';
import type { MaterialLibrary } from '../core/materials';
import { PAL } from '../core/palette';
import { MORTAR_SPLASH_M } from '../game/killstreaks/effects/mortar';
import { MORTAR_DUST_MS, type MortarView } from '../game/killstreaks/effects/mortar-view';

/** Telegraph discs drawn (must equal `MORTAR_MAX_TELEGRAPHS`). */
export const MORTAR_TELEGRAPH_MESHES = 4;
/** Dust rings drawn (must equal `MORTAR_MAX_IMPACTS`). */
export const MORTAR_DUST_MESHES = 8;
/** Dust ring expansion time, s. After this the ring holds until expiry. */
export const MORTAR_RING_GROW_S = 0.6;
/** Ring lift above ground, m: above the lawn, below a boot sole. */
const RING_LIFT_M = 0.06;

export class MortarFx {
  readonly group: THREE.Group;
  private readonly telegraphs: THREE.Mesh[] = [];
  private readonly dusts: THREE.Mesh[] = [];
  private readonly dustAt: number[] = [];
  private readonly dustPos: THREE.Vector3[] = [];
  private lastImpactSeq = 0;
  private readonly teleGeo: THREE.BufferGeometry;
  private readonly dustGeo: THREE.BufferGeometry;
  private released = false;

  constructor(mat: MaterialLibrary) {
    this.group = new THREE.Group();
    this.group.name = 'nuketown-mortar-fx';
    const teleMat = mat.emissive(PAL.applianceRed, 2);
    const dustMat = mat.painted(PAL.dirt, 1, 0);
    this.teleGeo = new THREE.RingGeometry(0.9, 1.0, 48);
    this.dustGeo = new THREE.RingGeometry(0.72, 1.0, 40);
    const teleGeo = this.teleGeo;
    const dustGeo = this.dustGeo;
    for (let i = 0; i < MORTAR_TELEGRAPH_MESHES; i++) {
      const m = new THREE.Mesh(teleGeo, teleMat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.castShadow = false;
      m.receiveShadow = false;
      this.telegraphs.push(m);
      this.group.add(m);
    }
    for (let i = 0; i < MORTAR_DUST_MESHES; i++) {
      const m = new THREE.Mesh(dustGeo, dustMat);
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.castShadow = false;
      m.receiveShadow = false;
      this.dusts.push(m);
      this.group.add(m);
      this.dustAt.push(-Infinity);
      this.dustPos.push(new THREE.Vector3());
    }
  }

  /**
   * One frame. `onImpact` fires once per NEW authoritative impact for the
   * effects-pool flash (`weapons.mortarFlash`); rings are drawn here. `nowMs` is
   * the host clock domain (`performance.now()`).
   */
  update(nowMs: number, view: MortarView, onImpact: (x: number, y: number, z: number) => void): void {
    for (let i = 0; i < MORTAR_TELEGRAPH_MESHES; i++) {
      const m = this.telegraphs[i];
      const t = i < view.telegraphs.length ? view.telegraphs[i] : null;
      if (t === null) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      m.position.set(t.x, t.y + RING_LIFT_M, t.z);
      const pulse = 1 + 0.045 * Math.sin(nowMs * 0.006 + t.instanceId);
      const s = Math.max(0.01, t.radius * pulse);
      m.scale.set(s, s, 1);
    }
    while (this.lastImpactSeq < view.impactSeq) {
      this.lastImpactSeq++;
      const impact = view.impacts.find((v) => v.seq === this.lastImpactSeq);
      if (impact === undefined) continue;
      const slot = this.lastImpactSeq % MORTAR_DUST_MESHES;
      this.dustAt[slot] = nowMs;
      this.dustPos[slot].set(impact.x, impact.y, impact.z);
      onImpact(impact.x, impact.y, impact.z);
    }
    for (let i = 0; i < MORTAR_DUST_MESHES; i++) {
      const m = this.dusts[i];
      const ageMs = nowMs - this.dustAt[i];
      if (!(ageMs >= 0 && ageMs < MORTAR_DUST_MS)) {
        m.visible = false;
        continue;
      }
      m.visible = true;
      const grow = Math.min(1, ageMs / 1000 / MORTAR_RING_GROW_S);
      const r = Math.max(0.3, MORTAR_SPLASH_M * (0.25 + 0.75 * grow));
      m.position.set(this.dustPos[i].x, this.dustPos[i].y + RING_LIFT_M, this.dustPos[i].z);
      m.scale.set(r, r, 1);
    }
  }
  reset(toSeq = 0): void {
    this.lastImpactSeq = toSeq;
    this.dustAt.fill(-Infinity);
    for (const m of this.telegraphs) m.visible = false;
    for (const m of this.dusts) m.visible = false;
  }

  /**
   * Page/game teardown: dispose the two owned ring geometries exactly once.
   * Materials are `MaterialLibrary` singletons and are never touched; meshes
   * stay parented so a late frame cannot hit a detached graph. Called from
   * `OrdnanceScene.dispose`, which the pagehide lifecycle owns. Idempotent.
   */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.teleGeo.dispose();
    this.dustGeo.dispose();
  }
}
