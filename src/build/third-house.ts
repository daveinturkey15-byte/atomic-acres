/**
 * THIRD HOUSE - the out-of-bounds landmark beyond the cul-de-sac.
 *
 * Sits at layout.THIRD_HOUSE_X on the street centreline, past the boundary fence, so
 * the player never reaches it. Its whole job is to tell the +x end of the map apart at
 * 25-40 m, which it does by being the ONE building with a real pitched roof: a dark
 * gable whose triangular end faces the turning head, over pale walls with two big white
 * window bands. Its driveway runs back to meet the head, with a red 1950s saloon on it.
 *
 * Silhouette only - no interior. One solid collider block so nothing can be entered.
 */
import * as THREE from 'three';
import { PAL } from '../core/palette';
import {
  THIRD_HOUSE_X, HEAD_CENTER_X, HEAD_RADIUS,
  HOUSE_HALF_LEN, HOUSE_DEPTH, FLOOR_H, UPPER_H,
} from '../core/layout';
import { aabbSlab, extrude, group, slab } from '../core/kit';
import type { AABB, Builder } from '../core/kit';

/** Collects axis-aligned boxes and emits ONE InstancedMesh per material. */
class Batch {
  private rows: number[][] = [];
  add(w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0): void {
    if (w <= 0 || h <= 0 || d <= 0) return;
    this.rows.push([w, h, d, x, y, z, rotY]);
  }
  mesh(material: THREE.Material, name: string): THREE.InstancedMesh | null {
    const n = this.rows.length;
    if (!n) return null;
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, n);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const r = this.rows[i];
      q.setFromAxisAngle(up, r[6]);
      pos.set(r[3], r[4], r[5]);
      scl.set(r[0], r[1], r[2]);
      im.setMatrixAt(i, mtx.compose(pos, q, scl));
    }
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = im.receiveShadow = true;
    im.name = name;
    return im;
  }
}

// ------------------------------------------------------------------ dimensions
const BODY_X = HOUSE_DEPTH * 0.72;              // extent along x (toward the map)
const BODY_Z = HOUSE_HALF_LEN * 1.25;           // extent along z (the long faces)
const WALL_H = FLOOR_H + UPPER_H * 0.28;
const RIDGE = HOUSE_DEPTH * 0.33;               // rise from eave to ridge
const EAVE_OUT = 0.45;
const FACE_X = THIRD_HOUSE_X - BODY_X * 0.5;    // the gable face looking at the map

// driveway: runs from the house back to the lip of the turning head
const DRIVE_X0 = HEAD_CENTER_X + HEAD_RADIUS * 0.45;
const DRIVE_LEN = FACE_X - DRIVE_X0;
const DRIVE_CX = DRIVE_X0 + DRIVE_LEN * 0.5;
const DRIVE_CZ = -HOUSE_HALF_LEN * 0.28;
const DRIVE_W = HOUSE_HALF_LEN * 0.42;

// the parked saloon, broadside-on, nose toward the house
const CAR_L = 4.5, CAR_W = 1.82, CAR_CX = DRIVE_CX - 0.2;
const WHEEL_R = 0.36;

export const buildThirdHouse: Builder = (ctx) => {
  const g = group('third-house');
  const colliders: AABB[] = [];
  const bWall = new Batch(), bBand = new Batch();
  const bCar = new Batch(), bChrome = new Batch();

  // --- driveway slab ---------------------------------------------------------
  g.add(slab(DRIVE_LEN, 0.1, DRIVE_W, ctx.mat.concrete, DRIVE_CX, 0, DRIVE_CZ));

  // --- body + chimney --------------------------------------------------------
  bWall.add(BODY_X, WALL_H, BODY_Z, THIRD_HOUSE_X, WALL_H * 0.5, 0);
  const chX = THIRD_HOUSE_X + BODY_X * 0.22;
  const chZ = BODY_Z * 0.24;
  bWall.add(0.85, RIDGE + 1.0, 0.85, chX, WALL_H + (RIDGE + 1.0) * 0.5, chZ);

  // --- dark pitched roof: gable triangle swept along x -----------------------
  const half = BODY_Z * 0.5 + EAVE_OUT;
  const roof = extrude(
    [[-half, 0], [half, 0], [0, RIDGE]],
    BODY_X + EAVE_OUT * 2,
    ctx.mat.painted(PAL.thirdRoof, 0.78, 0.04),
  );
  roof.rotation.y = Math.PI * 0.5;              // sweep axis -> world x, gable faces +/-x
  roof.position.set(THIRD_HOUSE_X, WALL_H, 0);
  g.add(roof);
  // eave fascia under the roof edge, both long faces
  for (const s of [-1, 1]) {
    bWall.add(BODY_X + EAVE_OUT * 2, 0.2, 0.16, THIRD_HOUSE_X, WALL_H - 0.1, s * half);
  }

  // --- two big white window bands on the face toward the map -----------------
  const bandX = FACE_X - 0.07;
  bBand.add(0.14, FLOOR_H * 0.38, BODY_Z * 0.66, bandX, FLOOR_H * 0.55, 0);
  bBand.add(0.14, FLOOR_H * 0.26, BODY_Z * 0.5, bandX, FLOOR_H * 1.07, 0);
  // and one on the street-side long face so it still reads from the head
  bBand.add(BODY_X * 0.58, FLOOR_H * 0.34, 0.14,
    THIRD_HOUSE_X, FLOOR_H * 0.56, -BODY_Z * 0.5 - 0.07);

  colliders.push(aabbSlab(THIRD_HOUSE_X, 0, 0, BODY_X, WALL_H + RIDGE, BODY_Z));

  // --- red 1950s saloon on the drive -----------------------------------------
  const sill = WHEEL_R + 0.22;
  bCar.add(CAR_L, 0.92, CAR_W, CAR_CX, sill + 0.46, DRIVE_CZ);
  bCar.add(CAR_L * 0.46, 0.72, CAR_W * 0.88, CAR_CX - CAR_L * 0.05, sill + 1.28, DRIVE_CZ);
  // glass band inside the cabin, and a low tailfin blade each side
  const glassBox = new THREE.Mesh(
    new THREE.BoxGeometry(CAR_L * 0.42, 0.44, CAR_W * 0.9),
    ctx.mat.glass);
  glassBox.position.set(CAR_CX - CAR_L * 0.05, sill + 1.34, DRIVE_CZ);
  g.add(glassBox);
  for (const s of [-1, 1]) {
    bCar.add(CAR_L * 0.2, 0.34, 0.1,
      CAR_CX - CAR_L * 0.4, sill + 1.06, DRIVE_CZ + s * CAR_W * 0.44);
  }
  // chrome bumpers and a belt strip
  for (const s of [-1, 1]) {
    bChrome.add(0.22, 0.2, CAR_W * 1.02, CAR_CX + s * CAR_L * 0.5, sill + 0.24, DRIVE_CZ);
  }
  for (const s of [-1, 1]) {
    bChrome.add(CAR_L * 0.92, 0.09, 0.08, CAR_CX, sill + 0.82, DRIVE_CZ + s * CAR_W * 0.51);
  }
  colliders.push(aabbSlab(CAR_CX, 0, DRIVE_CZ, CAR_L, sill + 1.64, CAR_W));

  // wheels: one instanced cylinder, axis rotated onto z
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.26, 14);
  wheelGeo.rotateX(Math.PI * 0.5);
  const wheels = new THREE.InstancedMesh(
    wheelGeo, ctx.mat.painted(PAL.asphalt, 0.95, 0), 4);
  const wm = new THREE.Matrix4();
  let wi = 0;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      wm.makeTranslation(
        CAR_CX + sx * CAR_L * 0.33, WHEEL_R, DRIVE_CZ + sz * (CAR_W * 0.5 - 0.1));
      wheels.setMatrixAt(wi++, wm);
    }
  }
  wheels.instanceMatrix.needsUpdate = true;
  wheels.castShadow = wheels.receiveShadow = true;
  wheels.name = 'th-wheels';
  g.add(wheels);

  // --- one draw call per material --------------------------------------------
  const batched: [Batch, THREE.Material, string][] = [
    [bWall, ctx.mat.painted(PAL.thirdWall, 0.9, 0), 'th-walls'],
    [bBand, ctx.mat.painted(PAL.windowBand, 0.7, 0), 'th-window-bands'],
    [bCar, ctx.mat.painted(PAL.carRed, 0.35, 0.35), 'th-car'],
    [bChrome, ctx.mat.chrome, 'th-car-chrome'],
  ];
  for (const [b, m, n] of batched) {
    const im = b.mesh(m, n);
    if (im) g.add(im);
  }
  return { group: g, colliders };
};
