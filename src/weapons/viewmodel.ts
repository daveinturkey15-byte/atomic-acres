import * as THREE from 'three';
import type { MaterialLibrary } from '../core/materials';
import { PAL } from '../core/palette';
import type { ViewmodelRig } from './types';
export type { ViewmodelRig } from './types';

export function box(
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  rx = 0,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  if (rx !== 0) mesh.rotation.x = rx;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

export function tube(
  radius: number,
  length: number,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 12), material);
  mesh.rotation.x = Math.PI / 2;
  mesh.position.set(x, y, z);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  return mesh;
}

/**
 * Atomic Acres service rifle: BO2-inspired iron-sight rifle built from
 * procedural boxes/cylinders. Origin at the grip/trigger, barrel down -z.
 */
export function buildRifleViewmodel(mat: MaterialLibrary): ViewmodelRig {
  const group = new THREE.Group();
  const body = mat.painted(PAL.truckCab, 0.6, 0.35);
  const furniture = mat.timber;
  const darkMetal = mat.steel;
  const brightMetal = mat.chrome;
  const gripMat = mat.painted(PAL.timberDark, 0.85, 0.0);

  // Receiver: core of the rig, centred just forward of the origin.
  group.add(box(0.06, 0.09, 0.34, body, 0, 0.02, -0.12));
  // Top rail strip the sights sit on.
  group.add(box(0.03, 0.012, 0.3, darkMetal, 0, 0.071, -0.12));

  // Barrel + muzzle device, axis along -z.
  group.add(tube(0.011, 0.3, darkMetal, 0, 0.035, -0.44));
  group.add(tube(0.016, 0.05, brightMetal, 0, 0.035, -0.585));

  // Handguard surrounding the barrel base.
  group.add(box(0.07, 0.07, 0.26, furniture, 0, 0.03, -0.36));
  // Handguard ribs (viewmodel-local detail).
  group.add(box(0.074, 0.012, 0.02, gripMat, 0, 0.03, -0.3));
  group.add(box(0.074, 0.012, 0.02, gripMat, 0, 0.03, -0.36));
  group.add(box(0.074, 0.012, 0.02, gripMat, 0, 0.03, -0.42));

  // Stock + buttpad behind the origin.
  group.add(box(0.055, 0.11, 0.22, furniture, 0, 0.01, 0.16));
  group.add(box(0.06, 0.13, 0.03, gripMat, 0, 0.01, 0.28));

  // Pistol grip angled back from the trigger area.
  group.add(box(0.045, 0.13, 0.055, gripMat, 0, -0.09, 0.0, 0.35));

  // Angled magazine ahead of the trigger.
  group.add(box(0.045, 0.16, 0.07, darkMetal, 0, -0.12, -0.13, -0.3));
  group.add(box(0.048, 0.02, 0.073, body, 0, -0.195, -0.105, -0.3));

  // Trigger + guard from thin boxes.
  group.add(box(0.008, 0.03, 0.01, brightMetal, 0, -0.035, -0.045));
  group.add(box(0.006, 0.006, 0.07, darkMetal, 0, -0.055, -0.035));
  group.add(box(0.006, 0.03, 0.006, darkMetal, 0, -0.04, -0.068));

  // Front post sight near the muzzle end.
  group.add(box(0.01, 0.02, 0.01, darkMetal, 0, 0.075, -0.55));
  group.add(box(0.006, 0.035, 0.006, brightMetal, 0, 0.095, -0.55));

  // Rear notch: two ears with a gap, on the receiver rear.
  group.add(box(0.03, 0.01, 0.03, darkMetal, 0, 0.082, 0.02));
  group.add(box(0.008, 0.025, 0.02, darkMetal, -0.013, 0.095, 0.02));
  group.add(box(0.008, 0.025, 0.02, darkMetal, 0.013, 0.095, 0.02));

  // Charging handle at the receiver rear.
  group.add(box(0.02, 0.015, 0.04, brightMetal, 0, 0.06, 0.06));
  group.add(box(0.05, 0.015, 0.02, brightMetal, 0, 0.06, 0.075));

  // Ejection-port detail on the right side.
  group.add(box(0.004, 0.03, 0.09, brightMetal, 0.031, 0.03, -0.1));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.035, -0.615);
  group.add(muzzle);

  const eject = new THREE.Object3D();
  eject.position.set(0.035, 0.03, -0.1);
  group.add(eject);

  return { group, muzzle, eject };
}

/**
 * Atomic Acres sidearm: compact iron-sight pistol. Origin at grip/trigger,
 * slide running down -z.
 */
export function buildPistolViewmodel(mat: MaterialLibrary): ViewmodelRig {
  const group = new THREE.Group();
  const body = mat.painted(PAL.truckCab, 0.55, 0.4);
  const darkMetal = mat.steel;
  const brightMetal = mat.chrome;
  const gripMat = mat.timber;

  // Slide + frame.
  group.add(box(0.04, 0.045, 0.19, body, 0, 0.02, -0.085));
  group.add(box(0.036, 0.03, 0.17, darkMetal, 0, -0.01, -0.075));
  // Muzzle ring at the slide tip.
  group.add(tube(0.012, 0.012, brightMetal, 0, 0.02, -0.182));

  // Grip canted back, with timber panels.
  group.add(box(0.038, 0.11, 0.05, gripMat, 0, -0.075, 0.0, 0.25));
  group.add(box(0.004, 0.09, 0.042, mat.timberDark, -0.02, -0.075, 0.005, 0.25));
  group.add(box(0.004, 0.09, 0.042, mat.timberDark, 0.02, -0.075, 0.005, 0.25));

  // Trigger guard from 3 thin boxes + trigger.
  group.add(box(0.008, 0.008, 0.07, darkMetal, 0, -0.055, -0.045));
  group.add(box(0.008, 0.035, 0.008, darkMetal, 0, -0.04, -0.08));
  group.add(box(0.008, 0.03, 0.008, darkMetal, 0, -0.042, -0.012));
  group.add(box(0.007, 0.025, 0.009, brightMetal, 0, -0.035, -0.045));

  // Front blade sight.
  group.add(box(0.005, 0.012, 0.005, brightMetal, 0, 0.048, -0.17));
  // Rear notch: two ears at the slide rear.
  group.add(box(0.007, 0.012, 0.012, darkMetal, -0.01, 0.048, 0.0));
  group.add(box(0.007, 0.012, 0.012, darkMetal, 0.01, 0.048, 0.0));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.19);
  group.add(muzzle);

  const eject = new THREE.Object3D();
  eject.position.set(0.022, 0.025, -0.05);
  group.add(eject);

  return { group, muzzle, eject };
}

/**
 * Rattler SMG: compact machine pistol silhouette. Short barrel with a vented
 * shroud, folding wire stock, vertical foregrip, straight stick mag.
 * Origin at the grip/trigger, barrel down -z. Sights kept at the shared
 * ~0.095 line so the one ADS_OFFSET in the controller still centres them.
 */
export function buildSmgViewmodel(mat: MaterialLibrary): ViewmodelRig {
  const group = new THREE.Group();
  const body = mat.painted(PAL.truckCab, 0.6, 0.35);
  const darkMetal = mat.steel;
  const brightMetal = mat.chrome;
  const gripMat = mat.painted(PAL.timberDark, 0.85, 0.0);

  // Short receiver + top rail.
  group.add(box(0.055, 0.075, 0.24, body, 0, 0.02, -0.06));
  group.add(box(0.028, 0.01, 0.2, darkMetal, 0, 0.062, -0.07));
  // Stub barrel + vented shroud (rings read as vents at arm's length).
  group.add(tube(0.01, 0.16, darkMetal, 0, 0.03, -0.26));
  group.add(tube(0.02, 0.1, body, 0, 0.03, -0.24));
  group.add(box(0.044, 0.014, 0.014, gripMat, 0, 0.03, -0.21));
  group.add(box(0.044, 0.014, 0.014, gripMat, 0, 0.03, -0.25));
  // Muzzle nut.
  group.add(tube(0.014, 0.03, brightMetal, 0, 0.03, -0.35));
  // Vertical foregrip under the shroud.
  group.add(box(0.03, 0.09, 0.035, gripMat, 0, -0.055, -0.22, 0.12));
  // Pistol grip + trigger + guard.
  group.add(box(0.042, 0.11, 0.05, gripMat, 0, -0.08, 0.02, 0.3));
  group.add(box(0.007, 0.025, 0.009, brightMetal, 0, -0.03, -0.03));
  group.add(box(0.006, 0.006, 0.06, darkMetal, 0, -0.048, -0.02));
  // Straight stick magazine ahead of the trigger.
  group.add(box(0.038, 0.15, 0.055, darkMetal, 0, -0.115, -0.09, -0.08));
  group.add(box(0.04, 0.02, 0.057, body, 0, -0.185, -0.084, -0.08));
  // Folding wire stock: two thin rails + butt plate behind the origin.
  group.add(box(0.012, 0.012, 0.2, darkMetal, -0.02, 0.03, 0.16));
  group.add(box(0.012, 0.012, 0.2, darkMetal, 0.02, 0.03, 0.16));
  group.add(box(0.055, 0.09, 0.025, gripMat, 0, 0.02, 0.27));
  // Ring sight: two ears + post on the rail.
  group.add(box(0.007, 0.028, 0.014, darkMetal, -0.011, 0.088, -0.02));
  group.add(box(0.007, 0.028, 0.014, darkMetal, 0.011, 0.088, -0.02));
  group.add(box(0.03, 0.008, 0.014, darkMetal, 0, 0.1, -0.02));
  group.add(box(0.005, 0.02, 0.005, brightMetal, 0, 0.085, -0.15));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.03, -0.37);
  group.add(muzzle);

  const eject = new THREE.Object3D();
  eject.position.set(0.031, 0.025, -0.06);
  group.add(eject);

  return { group, muzzle, eject };
}

/**
 * Coachman shotgun: twin-tube pump silhouette. Long barrel over a full-length
 * magazine tube, timber pump grip, timber stock, bead front sight.
 * Origin at the grip/trigger, barrel down -z.
 */
export function buildShotgunViewmodel(mat: MaterialLibrary): ViewmodelRig {
  const group = new THREE.Group();
  const body = mat.painted(PAL.truckCab, 0.6, 0.35);
  const furniture = mat.timber;
  const darkMetal = mat.steel;
  const brightMetal = mat.chrome;
  const gripMat = mat.painted(PAL.timberDark, 0.85, 0.0);

  // Receiver + long barrel over the magazine tube.
  group.add(box(0.06, 0.08, 0.22, body, 0, 0.02, -0.02));
  group.add(tube(0.013, 0.46, darkMetal, 0, 0.045, -0.32));
  group.add(tube(0.011, 0.4, brightMetal, 0, 0.005, -0.3));
  // Barrel band + end cap where the tubes meet the muzzle.
  group.add(box(0.035, 0.05, 0.02, darkMetal, 0, 0.025, -0.5));
  // Timber pump grip riding the magazine tube.
  group.add(box(0.055, 0.055, 0.14, furniture, 0, 0.0, -0.3));
  group.add(box(0.058, 0.014, 0.14, gripMat, 0, 0.026, -0.3));
  // Timber stock + buttpad.
  group.add(box(0.055, 0.1, 0.2, furniture, 0, 0.005, 0.2));
  group.add(box(0.06, 0.12, 0.03, gripMat, 0, 0.005, 0.31));
  // Grip + trigger + guard.
  group.add(box(0.044, 0.11, 0.052, gripMat, 0, -0.085, 0.03, 0.32));
  group.add(box(0.007, 0.025, 0.009, brightMetal, 0, -0.03, -0.005));
  group.add(box(0.006, 0.006, 0.06, darkMetal, 0, -0.048, 0.005));
  // Loading port detail under the receiver.
  group.add(box(0.03, 0.012, 0.12, darkMetal, 0, -0.025, -0.02));
  // Bead front sight + low rear groove.
  group.add(box(0.006, 0.014, 0.006, brightMetal, 0, 0.088, -0.52));
  group.add(box(0.026, 0.008, 0.05, darkMetal, 0, 0.068, 0.06));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.045, -0.56);
  group.add(muzzle);

  const eject = new THREE.Object3D();
  eject.position.set(0.033, 0.03, -0.02);
  group.add(eject);

  return { group, muzzle, eject };
}

/**
 * Deadeye sniper: long thin barrel, tubed scope on high rings, bolt handle
 * on the right, raised cheek rest, folded bipod legs under the forend.
 * Origin at the grip/trigger, barrel down -z. Scope centreline sits on the
 * shared ~0.10 sight line so ADS still centres it.
 */
export function buildSniperViewmodel(mat: MaterialLibrary): ViewmodelRig {
  const group = new THREE.Group();
  const body = mat.painted(PAL.truckCab, 0.6, 0.35);
  const furniture = mat.timber;
  const darkMetal = mat.steel;
  const brightMetal = mat.chrome;
  const gripMat = mat.painted(PAL.timberDark, 0.85, 0.0);
  const lens = mat.glass;

  // Receiver + long free-floated barrel.
  group.add(box(0.058, 0.08, 0.3, body, 0, 0.02, -0.08));
  group.add(tube(0.01, 0.5, darkMetal, 0, 0.04, -0.48));
  group.add(tube(0.015, 0.04, brightMetal, 0, 0.04, -0.72));
  // Forend + folded bipod legs underneath.
  group.add(box(0.06, 0.06, 0.26, furniture, 0, 0.01, -0.32));
  group.add(box(0.012, 0.012, 0.2, darkMetal, -0.028, -0.035, -0.3, 0.06));
  group.add(box(0.012, 0.012, 0.2, darkMetal, 0.028, -0.035, -0.3, 0.06));
  // Scope tube on two high rings, objective bell forward, eyepiece aft.
  group.add(tube(0.021, 0.24, darkMetal, 0, 0.1, -0.08));
  group.add(tube(0.026, 0.05, darkMetal, 0, 0.1, -0.2));
  group.add(tube(0.018, 0.05, darkMetal, 0, 0.1, 0.05));
  group.add(tube(0.019, 0.006, lens, 0, 0.1, -0.226));
  group.add(box(0.014, 0.03, 0.02, darkMetal, 0, 0.075, -0.03));
  group.add(box(0.014, 0.03, 0.02, darkMetal, 0, 0.075, -0.13));
  // Elevation turret cap.
  group.add(tube(0.011, 0.02, brightMetal, 0, 0.128, -0.08));
  // Bolt handle on the right: stem out, knob down.
  group.add(box(0.05, 0.012, 0.012, brightMetal, 0.05, 0.03, 0.02));
  group.add(box(0.02, 0.035, 0.02, gripMat, 0.078, 0.015, 0.02));
  // Stock + cheek rest + buttpad.
  group.add(box(0.055, 0.1, 0.24, furniture, 0, 0.0, 0.2));
  group.add(box(0.058, 0.035, 0.14, gripMat, 0, 0.062, 0.18));
  group.add(box(0.06, 0.12, 0.03, gripMat, 0, 0.0, 0.33));
  // Grip + trigger + guard.
  group.add(box(0.044, 0.11, 0.052, gripMat, 0, -0.085, 0.03, 0.32));
  group.add(box(0.007, 0.025, 0.009, brightMetal, 0, -0.03, -0.005));
  group.add(box(0.006, 0.006, 0.06, darkMetal, 0, -0.048, 0.005));
  // Flush magazine plate.
  group.add(box(0.045, 0.05, 0.09, darkMetal, 0, -0.045, -0.1));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.04, -0.745);
  group.add(muzzle);

  const eject = new THREE.Object3D();
  eject.position.set(0.033, 0.03, -0.05);
  group.add(eject);

  return { group, muzzle, eject };
}

/**
 * Combat knife (ordnance lane): a single-edged blade on a short guard and a
 * wrapped grip. Origin at the grip, blade down -z so the same camera mount
 * the guns use points it forward; `muzzle` is the tip, for the strike frame.
 * Six boxes and one tube from library singletons - no new material.
 */
export function buildKnifeViewmodel(mat: MaterialLibrary): ViewmodelRig {
  const group = new THREE.Group();
  const blade = mat.chrome;
  const guard = mat.steel;
  const grip = mat.painted(PAL.timberDark, 0.85, 0.0);
  const wrap = mat.painted(PAL.truckCab, 0.9, 0.0);

  // Blade: a thin slab with a bevelled tip (a second, narrower slab).
  group.add(box(0.006, 0.03, 0.17, blade, 0, 0.0, -0.145));
  group.add(box(0.005, 0.016, 0.05, blade, 0, -0.005, -0.25));
  // Spine line and fuller, thin dark strips so the flat reads.
  group.add(box(0.008, 0.004, 0.16, guard, 0, 0.014, -0.14));
  // Guard.
  group.add(box(0.014, 0.06, 0.012, guard, 0, 0.0, -0.055));
  // Grip: wrapped, with two bands, and a pommel.
  group.add(tube(0.013, 0.1, grip, 0, 0, 0.005));
  group.add(box(0.03, 0.03, 0.01, wrap, 0, 0, -0.02));
  group.add(box(0.03, 0.03, 0.01, wrap, 0, 0, 0.02));
  group.add(box(0.02, 0.026, 0.014, guard, 0, 0, 0.062));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, -0.275);
  group.add(muzzle);
  const eject = new THREE.Object3D();
  group.add(eject);
  return { group, muzzle, eject };
}

/**
 * A hand grenade for the viewmodel (ordnance lane): the body, a fuse cap,
 * the spoon and a pin ring. Olive is `PAL.hedge`; the world's frag mesh in
 * `weapons/grenades.ts` uses the same material so the thrown one matches the
 * held one. Origin at the body centre.
 */
export function buildGrenadeViewmodel(mat: MaterialLibrary): THREE.Group {
  const group = new THREE.Group();
  const olive = mat.painted(PAL.hedge, 0.75, 0.25);
  const steel = mat.steel;
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 10), olive);
  body.scale.set(0.92, 1.12, 0.92);
  body.castShadow = false;
  body.receiveShadow = false;
  group.add(body);
  group.add(tube(0.012, 0.018, steel, 0, 0.05, 0));
  group.add(box(0.01, 0.055, 0.008, steel, 0.02, 0.055, 0));
  group.add(box(0.03, 0.004, 0.004, steel, 0.04, 0.062, 0));
  return group;
}
