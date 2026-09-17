import * as THREE from 'three';
import type { MaterialLibrary } from '../core/materials';
import { PAL } from '../core/palette';
import type { ViewmodelRig } from './types';
export type { ViewmodelRig } from './types';

function box(
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

function tube(
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
