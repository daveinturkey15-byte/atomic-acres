/**
 * Crossbow bolts in the world: the visible shaft per live bolt.
 *
 * One instanced mesh, one draw, built once from library singletons and driven
 * by `game/crossbow-view.ts` — the client's projection of what the host said.
 * Flights are replayed here with the same `advanceBolt` stepper the host used
 * (`weapons/crossbow-runtime.ts`), so the shaft a player watches fly is the
 * one the host impacts; the `bolt-impact` event snaps it (retires the shaft
 * and fires the effects-pool flash through `onImpact`).
 *
 * THE BLAST IS NOT A LIGHT and NOT A SECOND FLASH: the detonation flash star,
 * dust puff and sparks come from the existing `WeaponEffects.blast` pool
 * (called once per new impact by the owner of this object, currently
 * `weapons/ordnance-scene.ts` via `weapons.blastAt`): one pool, one program
 * set, no second flash implementation to drift. This object draws shafts; the
 * bus decides.
 *
 * Bounds: CROSSBOW_VIEW_POOL instances (must equal the view pool and the host
 * pool, 16). Zero new materials (the mortar telegraph's emissive danger red),
 * zero new lights, zero per-frame allocation. `release()` disposes the one
 * owned geometry; materials are `MaterialLibrary` singletons and are never
 * touched.
 */

import * as THREE from 'three';
import type { MaterialLibrary } from '../core/materials';
import { PAL } from '../core/palette';
import type { BoltView } from '../game/crossbow-view';
import { CROSSBOW_VIEW_POOL } from '../game/crossbow-view';
import {
  advanceBolt,
  CROSSBOW_TUNING,
  launchBolt,
  type CrossbowBolt,
} from './crossbow-runtime';

/**
 * Presentation step: EXACTLY the host substep, so replay matches `advanceBolt`
 * 1:1. A 1/60 step fed to `advanceBolt` clamps to 1/120 and flies at HALF host
 * speed — the failure this constant exists to prevent.
 */
const BOLT_STEP_S = CROSSBOW_TUNING.substep;
/** Per-frame substep cap: 0.1 s clamp / substep = 12, plus margin, still bounded. */
const BOLT_MAX_STEPS = 16;
/** Catch-up cap: lifetime / substep + margin (2.5 s -> 301). Expired bolts retire without stepping. */
const BOLT_MAX_CATCHUP = 320;
const ZERO = new THREE.Vector3(0, 0, 0);

interface ReplayBolt extends CrossbowBolt {
  boltId: number;
  bornAt: number;
  expiresAt: number;
}

export class BoltFx {
  readonly group: THREE.Group;
  private readonly shafts: THREE.InstancedMesh;
  private readonly replay: ReplayBolt[] = [];
  private lastImpactSeq = 0;
  private acc = 0;
  private released = false;

  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private readonly q = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 0, 1);
  private readonly dir = new THREE.Vector3();
  private readonly geo: THREE.BufferGeometry;

  constructor(mat: MaterialLibrary) {
    this.group = new THREE.Group();
    this.group.name = 'nuketown-crossbow-fx';
    // The mortar telegraph's danger red, shared — same singleton, no new program.
    this.geo = new THREE.BoxGeometry(0.07, 0.07, 0.8);
    this.shafts = new THREE.InstancedMesh(this.geo, mat.emissive(PAL.applianceRed, 2), CROSSBOW_VIEW_POOL);
    this.shafts.frustumCulled = false;
    this.shafts.castShadow = false;
    this.shafts.receiveShadow = false;
    this.shafts.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.shafts.count; i++) {
      this.shafts.setMatrixAt(i, this.m.compose(ZERO, this.q.identity(), ZERO));
      this.replay.push({
        x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, age: 0, distance: 0, seq: -1, live: false,
        boltId: 0, bornAt: 0, expiresAt: 0,
      });
    }
    this.shafts.instanceMatrix.needsUpdate = true;
    this.group.add(this.shafts);
  }

  /**
   * One frame. `nowMs` is the host clock domain (`performance.now()`).
   * `onImpact` fires once per NEW authoritative impact for the effects-pool
   * flash; shafts are drawn here. Nothing here decides anything.
   */
  update(dt: number, nowMs: number, view: BoltView, onImpact: (x: number, y: number, z: number) => void): void {
    // Step EXISTING flights first at the host substep, so the shaft matches
    // the host. Adopting first would double-step newcomers (catch-up to
    // nowMs PLUS this frame's dt); stepping first keeps every bolt exact.
    this.acc += Math.min(dt, 0.1);
    let steps = 0;
    while (this.acc >= BOLT_STEP_S && steps < BOLT_MAX_STEPS) {
      this.acc -= BOLT_STEP_S;
      steps++;
      for (const r of this.replay) {
        if (!r.live) continue;
        if (!advanceBolt(r, BOLT_STEP_S, CROSSBOW_TUNING)) r.live = false;
        else if (nowMs > r.expiresAt) r.live = false;
      }
    }
    // Adopt new launches into free replay slots (oldest evicted when full,
    // mirroring the view). The view is the bus; replay owns the positions.
    for (const b of view.bolts) {
      let slot = -1;
      for (let i = 0; i < this.replay.length; i++) {
        if (this.replay[i].live && this.replay[i].boltId === b.boltId) { slot = i; break; }
      }
      if (slot >= 0) continue;
      let free = -1;
      let oldest = 0;
      for (let i = 0; i < this.replay.length; i++) {
        if (!this.replay[i].live) { free = i; break; }
        if (this.replay[i].bornAt < this.replay[oldest].bornAt) oldest = i;
      }
      const i = free >= 0 ? free : oldest;
      const r = this.replay[i];
      const len = Math.hypot(b.vx, b.vy, b.vz) || 1;
      launchBolt(r, b.x, b.y, b.z, b.vx / len, b.vy / len, b.vz / len, b.seq, CROSSBOW_TUNING);
      r.boltId = b.boltId;
      r.bornAt = b.bornAt;
      r.expiresAt = b.expiresAt;
      // Catch up to host-now: the launch arrived (nowMs - bornAt) late
      // (wire latency + clock skew). Restarting at receipt would trail the
      // host by that latency; replay the SAME 1/120 stepper to the current
      // host time, bounded. Expired-by-now retires without stepping.
      const elapsedS = (nowMs - b.bornAt) / 1000;
      if (elapsedS <= 0) {
        // Future-dated (skew/out-of-order): hold at launch, per-frame steps lead.
      } else if (nowMs > r.expiresAt || elapsedS >= CROSSBOW_TUNING.lifetime) {
        r.live = false;
      } else {
        let remaining = elapsedS;
        let caught = 0;
        while (remaining > 1e-9 && caught < BOLT_MAX_CATCHUP) {
          const step = remaining < BOLT_STEP_S ? remaining : BOLT_STEP_S;
          caught++;
          remaining -= step;
          if (!advanceBolt(r, step, CROSSBOW_TUNING)) { r.live = false; break; }
        }
        if (r.live && nowMs > r.expiresAt) r.live = false;
      }
    }
    // Consume new authoritative impacts: retire the shaft, fire the flash once.
    while (this.lastImpactSeq < view.impactSeq) {
      this.lastImpactSeq++;
      const impact = view.impacts.find((v) => v.seq === this.lastImpactSeq);
      if (impact === undefined) continue;
      for (const r of this.replay) {
        if (r.live && r.boltId === impact.boltId) { r.live = false; break; }
      }
      onImpact(impact.x, impact.y, impact.z);
    }
    // Retire replay slots the view already dropped (expiry grace, rematch).
    for (const r of this.replay) {
      if (!r.live) continue;
      let known = false;
      for (const b of view.bolts) {
        if (b.boltId === r.boltId) { known = true; break; }
      }
      if (!known) r.live = false;
    }
    // Draw.
    for (let i = 0; i < CROSSBOW_VIEW_POOL; i++) {
      const r = this.replay[i];
      if (!r.live) {
        this.shafts.setMatrixAt(i, this.m.compose(ZERO, this.q.identity(), ZERO));
        continue;
      }
      this.p.set(r.x, r.y, r.z);
      this.dir.set(r.vx, r.vy, r.vz);
      if (this.dir.lengthSq() > 1e-9) {
        this.dir.normalize();
        this.q.setFromUnitVectors(this.up, this.dir);
      } else {
        this.q.identity();
      }
      this.shafts.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    this.shafts.instanceMatrix.needsUpdate = true;
  }

  /** Sync to the view's stable seq so a rematch never replays old impacts. */
  reset(toSeq = 0): void {
    this.lastImpactSeq = toSeq;
    this.acc = 0;
    for (const r of this.replay) r.live = false;
    for (let i = 0; i < this.shafts.count; i++) {
      this.shafts.setMatrixAt(i, this.m.compose(ZERO, this.q.identity(), ZERO));
    }
    this.shafts.instanceMatrix.needsUpdate = true;
  }

  /**
   * Page/game teardown: dispose the one owned shaft geometry exactly once.
   * Materials are `MaterialLibrary` singletons and are never touched; meshes
   * stay parented so a late frame cannot hit a detached graph. Idempotent.
   */
  release(): void {
    if (this.released) return;
    this.released = true;
    this.geo.dispose();
  }
}
