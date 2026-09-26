/** Native special-weapon silhouettes. All geometry is built once; materials are library-owned. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { MaterialLibrary } from '../core/materials';
import { PAL } from '../core/palette';
import { createFirstPersonHands } from './first-person-hands';
import type { ViewmodelRig } from './types';

type Point = readonly [number, number, number];
export const SPECIAL_VIEWMODEL_BUDGET = Object.freeze({ meshes: 64, triangles: 6000 });

function part(parent: THREE.Group, name: string, geometry: THREE.BufferGeometry, material: THREE.Material, p: Point): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.position.set(...p);
  mesh.castShadow = mesh.receiveShadow = false;
  parent.add(mesh);
  return mesh;
}

function block(parent: THREE.Group, name: string, size: Point, material: THREE.Material, p: Point, bevel = 0): THREE.Mesh {
  const geometry = bevel > 0
    ? new RoundedBoxGeometry(...size, 1, Math.min(bevel, ...size.map((s) => s * .4)))
    : new THREE.BoxGeometry(...size);
  return part(parent, name, geometry, material, p);
}

/** Cylinders run along the barrel's Z axis, with the open end facing the player’s aim. */
function barrel(parent: THREE.Group, name: string, radius: number, length: number, material: THREE.Material, p: Point): THREE.Mesh {
  const mesh = part(parent, name, new THREE.CylinderGeometry(radius, radius, length, 12), material, p);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function link(parent: THREE.Group, name: string, a: Point, b: Point, radius: number, material: THREE.Material): THREE.Mesh {
  const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b);
  const direction = to.clone().sub(from);
  const mesh = part(parent, name, new THREE.CylinderGeometry(radius, radius, direction.length(), 8), material, [0, 0, 0]);
  mesh.position.copy(from).add(to).multiplyScalar(.5);
  mesh.quaternion.setFromUnitVectors(THREE.Object3D.DEFAULT_UP, direction.normalize());
  return mesh;
}

function begin(id: string): { group: THREE.Group; gun: THREE.Group } {
  const group = new THREE.Group(); group.name = `Viewmodel/${id}`;
  group.userData.nativeWeaponId = id;
  const gun = new THREE.Group(); gun.name = 'WeaponGeometry';
  group.add(gun);
  return { group, gun };
}

/** Preserve the accepted rifle grip and foregrip contact surfaces for its authored hands. */
function rifleGrip(gun: THREE.Group, mat: MaterialLibrary): void {
  const rubber = mat.viewmodel.darkGlove, steel = mat.viewmodel.parkerizedSteel;
  block(gun, 'PistolGrip', [.045, .13, .055], rubber, [0, -.09, 0], .009).rotation.x = .35;
  block(gun, 'SupportGrip', [.07, .07, .21], rubber, [0, .03, -.36], .012);
  block(gun, 'Trigger', [.008, .03, .01], mat.chrome, [0, -.035, -.045]);
  block(gun, 'GuardBase', [.008, .008, .07], steel, [0, -.055, -.035]);
  block(gun, 'GuardFront', [.008, .03, .008], steel, [0, -.04, -.068]);
}

function sights(gun: THREE.Group, mat: MaterialLibrary, frontZ: number): void {
  const steel = mat.viewmodel.parkerizedSteel;
  block(gun, 'RearSightLeft', [.009, .026, .023], steel, [-.014, .105, .018]);
  block(gun, 'RearSightRight', [.009, .026, .023], steel, [.014, .105, .018]);
  block(gun, 'FrontSight', [.008, .025, .012], mat.chrome, [0, .105, frontZ]);
}

function finish(group: THREE.Group, mat: MaterialLibrary, muzzlePoint: Point, pistol = false): ViewmodelRig {
  const muzzle = new THREE.Object3D(); muzzle.name = 'Muzzle'; muzzle.position.set(...muzzlePoint);
  const eject = new THREE.Object3D(); eject.name = 'Eject'; eject.position.set(.038, .03, -.1);
  group.add(muzzle, eject);
  // The existing optional rifle contact mould reads direct child meshes.
  // Present the same live solids during hand construction, then restore the
  // named geometry group used for bounds/budget inspection. No runtime churn.
  const gun = group.getObjectByName('WeaponGeometry') as THREE.Group;
  const solids = [...gun.children];
  group.add(...solids);
  const hands = pistol
    ? createFirstPersonHands(group, mat, -.08, -.055, [.010, -.020, .080])
    : createFirstPersonHands(group, mat, -.36, -.055, [.010, -.065, .230]);
  gun.add(...solids);
  return { group, muzzle, eject, hands };
}

/** Metal accelerator: separated conductors, six exposed coil rings and a square muzzle cage. */
export function buildRailgunViewmodel(mat: MaterialLibrary): ViewmodelRig {
  const { group, gun } = begin('railgun');
  const steel = mat.viewmodel.parkerizedSteel, metal = mat.chrome;
  const teal = mat.painted(PAL.signTeal, .38, .65);
  const copper = mat.painted(PAL.interiorGold, .35, .8);
  rifleGrip(gun, mat);
  block(gun, 'AcceleratorReceiver', [.092, .09, .24], steel, [0, .038, -.1], .008);
  block(gun, 'CapacitorPack', [.08, .12, .085], teal, [0, -.10, -.15], .008);
  for (let i = 0; i < 3; i++) block(gun, `PackRib${i}`, [.086, .009, .092], metal, [0, -.065 - i * .035, -.15]);
  block(gun, 'StockSpine', [.034, .046, .21], metal, [0, .012, .13], .004);
  block(gun, 'StockButt', [.066, .12, .035], steel, [0, -.005, .24], .008);
  barrel(gun, 'AcceleratorCore', .022, .42, steel, [0, .045, -.40]);
  for (const side of [-1, 1]) {
    block(gun, `Conductor${side}`, [.017, .024, .42], copper, [side * .047, .045, -.40], .003);
    block(gun, `ReceiverInlay${side}`, [.005, .033, .12], teal, [side * .048, .047, -.10]);
  }
  for (let i = 0; i < 6; i++) {
    const ring = part(gun, `EMCoil${i}`, new THREE.TorusGeometry(.041, .007, 6, 16), copper, [0, .045, -.275 - i * .052]);
    ring.scale.y = .84;
  }
  block(gun, 'MuzzleTop', [.10, .016, .036], metal, [0, .077, -.62], .003);
  block(gun, 'MuzzleBottom', [.10, .016, .036], metal, [0, .013, -.62], .003);
  for (const side of [-1, 1]) block(gun, `MuzzleSide${side}`, [.015, .064, .036], steel, [side * .043, .045, -.62]);
  barrel(gun, 'MuzzleBore', .016, .006, mat.viewmodel.darkGlove, [0, .045, -.64]);
  sights(gun, mat, -.57);
  return finish(group, mat, [0, .045, -.646]);
}

/** Wide compound bow arms and a visible drawn string make the bolt weapon readable from the hip. */
export function buildCrossbowViewmodel(mat: MaterialLibrary): ViewmodelRig {
  const { group, gun } = begin('explosive-crossbow');
  const steel = mat.viewmodel.parkerizedSteel, metal = mat.chrome;
  const enamel = mat.painted(PAL.carTeal, .49, .28);
  const string = mat.painted(PAL.coachCream, .9, 0);
  rifleGrip(gun, mat);
  block(gun, 'BoltTrack', [.064, .04, .51], metal, [0, .052, -.23], .004);
  block(gun, 'TrackRecess', [.013, .006, .45], steel, [0, .075, -.245]);
  block(gun, 'TriggerHousing', [.085, .09, .20], enamel, [0, .018, -.09], .008);
  block(gun, 'StockSpine', [.033, .045, .20], steel, [0, .008, .15], .004);
  block(gun, 'StockButt', [.07, .12, .036], enamel, [0, -.008, .26], .008);
  block(gun, 'BowRiser', [.23, .055, .05], steel, [0, .033, -.46], .008);
  for (const side of [-1, 1]) {
    const points: Point[] = [[side * .07, .038, -.46], [side * .16, .046, -.48], [side * .245, .058, -.43], [side * .295, .06, -.36]];
    for (let i = 0; i < points.length - 1; i++) {
      const a = new THREE.Vector3(...points[i]), b = new THREE.Vector3(...points[i + 1]);
      const arm = block(gun, `BowLimb${side}/${i}`, [.028, .021, a.distanceTo(b) + .01], enamel, [0, 0, 0], .004);
      arm.position.copy(a).add(b).multiplyScalar(.5);
      arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), b.sub(a).normalize());
    }
    const cam = barrel(gun, `LimbCam${side}`, .025, .015, steel, [side * .295, .06, -.36]);
    cam.rotation.x = 0;
    link(gun, `DrawnString${side}`, points[3], [0, .079, -.115], .0023, string);
    link(gun, `ReturnCable${side}`, points[3], [side * .073, .038, -.46], .0018, steel);
  }
  barrel(gun, 'LoadedBolt', .004, .30, metal, [0, .083, -.29]);
  barrel(gun, 'ExplosiveBoltHead', .012, .032, mat.painted(PAL.applianceRed, .55, .3), [0, .083, -.455]);
  block(gun, 'BoltVane', [.028, .008, .045], string, [0, .084, -.158]);
  sights(gun, mat, -.43);
  return finish(group, mat, [0, .083, -.485]);
}

/** Self-contained pressure cylinders and a broad burner shroud, using the same two-hand grip. */
export function buildFlamethrowerViewmodel(mat: MaterialLibrary, crimson = false): ViewmodelRig {
  const { group, gun } = begin(crimson ? 'crimson-flamethrower' : 'flamethrower');
  const steel = mat.viewmodel.parkerizedSteel, metal = mat.chrome;
  const yellow = mat.painted(crimson ? PAL.applianceRed : PAL.hazardYellow, .52, .35);
  const red = mat.painted(PAL.applianceRed, .45, .35);
  const rubber = mat.viewmodel.darkGlove;
  rifleGrip(gun, mat);
  block(gun, 'ValveBody', [.085, .09, .20], steel, [0, .026, -.10], .009);
  for (const side of [-1, 1]) {
    barrel(gun, `PressureCylinder${side}`, .048, .23, yellow, [side * .070, -.043, -.12]);
    for (const z of [-.215, -.035]) barrel(gun, `TankBand${side}/${z}`, .050, .017, steel, [side * .070, -.043, z]);
    barrel(gun, `CylinderCap${side}`, .030, .022, metal, [side * .070, -.043, -.245]);
  }
  barrel(gun, 'FeedTube', .026, .31, metal, [0, .049, -.37]);
  barrel(gun, 'BurnerShroud', .054, .13, steel, [0, .049, -.505]);
  barrel(gun, 'BurnerCollar', .056, .022, red, [0, .049, -.558]);
  barrel(gun, 'BurnerRecess', .042, .006, rubber, [0, .049, -.574]);
  barrel(gun, 'FuelJet', .016, .020, metal, [0, .049, -.582]);
  for (let i = 0; i < 4; i++) {
    const angle = Math.PI / 4 + i * Math.PI / 2;
    const vent = block(gun, `ShroudVent${i}`, [.016, .006, .072], rubber, [Math.sin(angle) * .052, .049 + Math.cos(angle) * .052, -.505]);
    vent.rotation.z = -angle;
  }
  const hose: Point[] = [[.105, -.055, -.02], [.125, -.105, -.12], [.112, -.103, -.28], [.06, -.02, -.43]];
  for (let i = 0; i < hose.length - 1; i++) link(gun, `FuelHose${i}`, hose[i], hose[i + 1], .013, rubber);
  const gauge = barrel(gun, 'PressureGauge', .026, .018, metal, [.055, .079, -.065]); gauge.rotation.x = 0;
  const face = barrel(gun, 'GaugeFace', .021, .003, mat.painted(PAL.coachCream, .8, 0), [.055, .09, -.065]); face.rotation.x = 0;
  block(gun, 'GaugeNeedle', [.004, .003, .028], red, [.055, .092, -.07]).rotation.y = -.6;
  link(gun, 'PilotLine', [-.019, .02, -.44], [-.019, .02, -.595], .004, metal);
  sights(gun, mat, -.50);
  return finish(group, mat, [0, .049, -.596]);
}

/** Reward finish on the same flame rig; it is not advertised as another unique silhouette. */
export function buildCrimsonFlamethrowerViewmodel(mat: MaterialLibrary): ViewmodelRig {
  return buildFlamethrowerViewmodel(mat, true);
}

/** Short break-action signal pistol with a brass barrel and a warm enamel receiver. */
export function buildFlareGunViewmodel(mat: MaterialLibrary): ViewmodelRig {
  const { group, gun } = begin('flare-gun');
  const steel = mat.viewmodel.parkerizedSteel, rubber = mat.viewmodel.darkGlove;
  const enamel = mat.painted(PAL.terracotta, .44, .25);
  const brass = mat.painted(PAL.interiorGold, .36, .75);
  block(gun, 'SignalFrame', [.071, .065, .15], enamel, [0, -.003, -.065], .009);
  block(gun, 'PistolGrip', [.038, .11, .05], rubber, [0, -.075, 0], .007).rotation.x = .25;
  for (const side of [-1, 1]) block(gun, `GripPanel${side}`, [.004, .063, .038], enamel, [side * .021, -.08, .003], .002).rotation.x = .25;
  barrel(gun, 'SignalBarrel', .035, .18, brass, [0, .037, -.16]);
  barrel(gun, 'BreechCollar', .040, .03, steel, [0, .037, -.07]);
  barrel(gun, 'MuzzleRim', .038, .018, steel, [0, .037, -.25]);
  barrel(gun, 'MuzzleBore', .026, .004, rubber, [0, .037, -.261]);
  const hinge = barrel(gun, 'BreakActionHinge', .017, .083, mat.chrome, [0, -.007, -.105]); hinge.rotation.set(0, 0, Math.PI / 2);
  block(gun, 'BreechLatch', [.04, .016, .048], steel, [0, .069, -.026], .003);
  block(gun, 'Hammer', [.015, .023, .014], mat.chrome, [0, .044, .015], .002).rotation.x = -.25;
  block(gun, 'Trigger', [.006, .020, .010], brass, [0, -.045, -.033]);
  block(gun, 'GuardBase', [.012, .009, .059], steel, [0, -.062, -.042], .003);
  block(gun, 'GuardFront', [.012, .031, .009], steel, [0, -.047, -.069], .003);
  block(gun, 'FrontSight', [.008, .013, .016], steel, [0, .077, -.225]);
  for (const side of [-1, 1]) block(gun, `RearNotch${side}`, [.007, .015, .018], steel, [side * .012, .077, -.005]);
  return finish(group, mat, [0, .037, -.269], true);
}
