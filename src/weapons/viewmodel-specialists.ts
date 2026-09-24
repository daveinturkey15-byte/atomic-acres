/** Distinct first-person silhouettes for the belt-fed and marksman archetypes. */
import * as THREE from 'three';
import type { MaterialLibrary } from '../core/materials';
import { PAL } from '../core/palette';
import type { ViewmodelRig } from './types';
import { box, tube } from './viewmodel';

export function buildLmgViewmodel(mat: MaterialLibrary): ViewmodelRig {
  const group = new THREE.Group();
  const body = mat.painted(PAL.truckCab, 0.6, 0.35);
  const grip = mat.painted(PAL.timberDark, 0.85, 0);
  const metal = mat.steel;
  const trim = mat.chrome;

  // The broad side-mounted ammunition box and carry handle must read at hip
  // distance; neither is present on the service rifle.
  group.add(box(0.09, 0.12, 0.32, body, 0, 0.02, -0.1));
  group.add(box(0.095, 0.025, 0.25, metal, 0, 0.09, -0.12));
  group.add(box(0.09, 0.17, 0.19, metal, -0.09, -0.055, -0.16));
  group.add(box(0.08, 0.015, 0.14, trim, -0.09, 0.04, -0.17));
  group.add(box(0.095, 0.08, 0.3, grip, 0, 0.02, -0.37));
  group.add(tube(0.018, 0.36, metal, 0, 0.035, -0.58));
  group.add(tube(0.024, 0.06, trim, 0, 0.035, -0.77));
  group.add(box(0.055, 0.15, 0.25, grip, 0, 0, 0.22));
  group.add(box(0.065, 0.16, 0.035, metal, 0, 0, 0.36));
  group.add(box(0.05, 0.14, 0.06, grip, 0, -0.1, 0.025, 0.25));
  // Silhouette details: carrying arch, folded bipod and high rear aperture.
  group.add(box(0.012, 0.08, 0.015, trim, 0, 0.145, -0.21));
  group.add(box(0.075, 0.015, 0.015, trim, 0, 0.19, -0.21));
  group.add(box(0.012, 0.08, 0.015, trim, 0, 0.145, -0.27));
  group.add(box(0.012, 0.012, 0.2, metal, -0.034, -0.03, -0.54));
  group.add(box(0.012, 0.012, 0.2, metal, 0.034, -0.03, -0.54));
  group.add(box(0.03, 0.025, 0.018, metal, 0, 0.1, 0.02));
  group.add(box(0.012, 0.04, 0.012, trim, 0, 0.085, -0.72));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.035, -0.8);
  group.add(muzzle);
  const eject = new THREE.Object3D();
  eject.position.set(0.055, 0.04, -0.08);
  group.add(eject);
  return { group, muzzle, eject };
}

export function buildMarksmanViewmodel(mat: MaterialLibrary): ViewmodelRig {
  const group = new THREE.Group();
  const body = mat.painted(PAL.truckCab, 0.6, 0.35);
  const grip = mat.painted(PAL.timberDark, 0.85, 0);
  const metal = mat.steel;
  const trim = mat.chrome;

  // A slimmer rifle with an extended precision barrel, short optic and a
  // visible ten-round magazine. This is distinct from the bolt rifle's scope.
  group.add(box(0.052, 0.08, 0.3, body, 0, 0.02, -0.08));
  group.add(box(0.061, 0.058, 0.32, grip, 0, 0.02, -0.36));
  group.add(tube(0.01, 0.47, metal, 0, 0.04, -0.58));
  group.add(tube(0.015, 0.04, trim, 0, 0.04, -0.81));
  group.add(box(0.044, 0.1, 0.23, grip, 0, 0.005, 0.18));
  group.add(box(0.05, 0.12, 0.025, metal, 0, 0.005, 0.31));
  group.add(box(0.042, 0.12, 0.05, grip, 0, -0.075, 0.03, 0.3));
  group.add(box(0.044, 0.11, 0.07, metal, 0, -0.1, -0.13, -0.1));
  group.add(box(0.047, 0.016, 0.074, trim, 0, -0.16, -0.125));
  group.add(box(0.026, 0.022, 0.17, metal, 0, 0.084, -0.11));
  group.add(tube(0.018, 0.16, metal, 0, 0.103, -0.08));
  group.add(tube(0.021, 0.012, trim, 0, 0.103, -0.17));
  group.add(box(0.05, 0.016, 0.024, trim, 0.05, 0.045, -0.015));
  group.add(box(0.01, 0.03, 0.01, metal, 0, 0.085, -0.78));

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.04, -0.83);
  group.add(muzzle);
  const eject = new THREE.Object3D();
  eject.position.set(0.03, 0.03, -0.05);
  group.add(eject);
  return { group, muzzle, eject };
}
