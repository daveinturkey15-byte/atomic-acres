/**
 * Atomic Acres — death drops on the ground: a lying weapon silhouette per
 * drop, instanced, with a slow bob so the eye finds it.
 *
 * Two instanced meshes (body and magazine), one draw each, sized to
 * `game/pickups.ts:DROP_MAX_LIVE` and driven by the client's projection
 * (`game/ordnance-view.ts:drops`). The silhouette is deliberately generic —
 * every weapon's viewmodel is a few dozen boxes and twelve of each per
 * weapon would be a draw-call budget on its own. The prompt names the gun;
 * the ground shows there is one.
 *
 * Presentation is never authority: `nearestDropView` is what the HUD prompt
 * reads, and the host re-checks the distance on the claim.
 */
import * as THREE from 'three';
import type { MaterialLibrary } from '../core/materials';
import { PAL } from '../core/palette';
import type { DropView, OrdnanceView } from '../game/ordnance-view';
import { DROP_MAX_LIVE } from '../game/pickups';

const ZERO = new THREE.Vector3(0, 0, 0);
const ONE = new THREE.Vector3(1, 1, 1);

/** Nearest live drop within `range` (3-D) of a point, or null. Pure. */
export function nearestDropView(view: OrdnanceView, x: number, y: number, z: number, range: number): DropView | null {
  let best: DropView | null = null;
  let bestD = range;
  for (const d of view.drops) {
    const dist = Math.hypot(d.x - x, d.y - y, d.z - z);
    if (dist <= bestD) { best = d; bestD = dist; }
  }
  return best;
}

export class DropFx {
  readonly group: THREE.Group;
  private readonly bodies: THREE.InstancedMesh;
  private readonly mags: THREE.InstancedMesh;
  private readonly m = new THREE.Matrix4();
  private readonly p = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  constructor(mat: MaterialLibrary) {
    this.group = new THREE.Group();
    this.group.name = 'atomic-acres-drops';
    this.bodies = new THREE.InstancedMesh(new THREE.BoxGeometry(0.66, 0.07, 0.06), mat.steel, DROP_MAX_LIVE);
    this.mags = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.13, 0.05), mat.painted(PAL.truckCab, 0.6, 0.35), DROP_MAX_LIVE);
    for (const im of [this.bodies, this.mags]) {
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, this.m.compose(ZERO, this.q.identity(), ZERO));
      im.instanceMatrix.needsUpdate = true;
      this.group.add(im);
    }
  }

  update(nowMs: number, view: OrdnanceView): void {
    for (let i = 0; i < DROP_MAX_LIVE; i++) {
      const d = i < view.drops.length ? view.drops[i] : null;
      if (d === null) {
        this.bodies.setMatrixAt(i, this.m.compose(ZERO, this.q.identity(), ZERO));
        this.mags.setMatrixAt(i, this.m.compose(ZERO, this.q.identity(), ZERO));
        continue;
      }
      // Lying flat, a hand's width off the ground, turning slowly and rising a
      // little in the last five seconds so an expiring drop reads as leaving.
      const left = d.diesAt - nowMs;
      const lift = left < 5000 ? (1 - Math.max(0, left) / 5000) * 0.25 : 0;
      const yaw = (d.id * 1.7 + nowMs / 2400) % (Math.PI * 2);
      this.p.set(d.x, d.y + 0.08 + lift, d.z);
      this.e.set(0, yaw, 0.08);
      this.bodies.setMatrixAt(i, this.m.compose(this.p, this.q.setFromEuler(this.e), ONE));
      this.p.set(d.x - Math.sin(yaw) * 0.04, d.y + 0.03 + lift, d.z - Math.cos(yaw) * 0.04);
      this.e.set(0.35, yaw, 0.08);
      this.mags.setMatrixAt(i, this.m.compose(this.p, this.q.setFromEuler(this.e), ONE));
    }
    this.bodies.instanceMatrix.needsUpdate = true;
    this.mags.instanceMatrix.needsUpdate = true;
  }
}
