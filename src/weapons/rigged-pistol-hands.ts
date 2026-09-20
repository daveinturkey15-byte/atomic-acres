/**
 * Original two-hand pistol grip; independent of rejected Muse0558. Build-time
 * geometry only. The pistol solids/acceptance envelope are frozen in
 * docs/astra-hand-contract.json. No source game mesh or video motion extracted.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from '../core/materials';
import { PAL } from '../core/palette';
import type { FirstPersonHandsRig } from './types';
import { createHandMotion } from './first-person-hands-motion';
import { createForearmGeometry, createPalmGeometry, createThumbGeometry, createFingerSetGeometry, type DigitCurve, type Vec3 } from './hand-geometry-canary';

export const PISTOL_HAND_BINDS = {
  trigger: { elbow: [0.24, -0.36, 0.31] as Vec3, wrist: [0.055, -0.151, 0.070] as Vec3, palm: [0.024, -0.090, 0.047] as Vec3 },
  support: { elbow: [-0.26, -0.35, 0.32] as Vec3, wrist: [-0.070, -0.151, 0.075] as Vec3, palm: [-0.045, -0.101, 0.044] as Vec3 },
} as const;

export const PISTOL_RELOAD_SEAT: Vec3 = [0, -0.133, 0];

export function isRiggedPistolRequested(): boolean {
  return typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('hands') === 'rigged';
}

// Build-time contact mould for the actual current weapon, including its panels.
// The verifier independently reads the eight mesh bounds from the real builder.
const SOLIDS: ReadonlyArray<readonly [Vec3, Vec3, number]> = [
  [[0, -.075, 0], [.019, .055, .025], .25],
  [[-.020, -.075, .005], [.002, .045, .021], .25],
  [[.020, -.075, .005], [.002, .045, .021], .25],
  [[0, .020, -.085], [.020, .0225, .095], 0],
  [[0, -.010, -.075], [.018, .015, .085], 0],
  [[0, -.055, -.045], [.004, .004, .035], 0],
  [[0, -.040, -.080], [.004, .0175, .004], 0],
  [[0, -.042, -.012], [.004, .015, .004], 0],
];

/** Carve a shallow contact surface, instead of drawing the glove through a grip. */
function fitContact(geometry: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = geometry.getAttribute('position');
  const originalNormals = geometry.getAttribute('normal').array.slice();
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    for (let pass = 0; pass < 3; pass++) for (const [c, h, rx] of SOLIDS) {
      const cos = Math.cos(rx), sin = Math.sin(rx);
      let lx = x - c[0], ly = (y - c[1]) * cos + (z - c[2]) * sin;
      let lz = -(y - c[1]) * sin + (z - c[2]) * cos;
      const dx = h[0] - Math.abs(lx), dy = h[1] - Math.abs(ly), dz = h[2] - Math.abs(lz);
      if (dx <= 0 || dy <= 0 || dz <= 0) continue;
      if (dx <= dy && dx <= dz) lx = (lx < 0 ? -1 : 1) * (h[0] + .0006);
      else if (dy <= dz) ly = (ly < 0 ? -1 : 1) * (h[1] + .0006);
      else lz = (lz < 0 ? -1 : 1) * (h[2] + .0006);
      x = c[0] + lx; y = c[1] + ly * cos - lz * sin; z = c[2] + ly * sin + lz * cos;
    }
    p.setXYZ(i, x, y, z);
  }
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i < normals.count; i++) {
    // Sphere pole duplicates unused by its index have no accumulated face normal.
    // Retain their authored unit normal instead of exporting zero vectors.
    if (Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)) < .5) {
      normals.setXYZ(i, originalNormals[i * 3], originalNormals[i * 3 + 1], originalNormals[i * 3 + 2]);
    }
  }
  return geometry;
}

export function pistolGripCurves(side: 'trigger' | 'support'): { thumb: DigitCurve; fingers: DigitCurve[] } {
  if (side === 'trigger') return {
    thumb: { base: [.035, -.046, .045], mid: [-.004, -.037, .064], tip: [-.034, -.057, .014], baseRadius: .011, tipRadius: .008 },
    fingers: [
      { base: [.041, -.052, .020], mid: [.044, -.038, -.041], tip: [.006, -.037, -.049], baseRadius: .009, tipRadius: .0065 },
      { base: [.047, -.068, .022], mid: [.044, -.068, -.055], tip: [-.022, -.067, -.031], baseRadius: .010, tipRadius: .0075 },
      { base: [.047, -.089, .025], mid: [.043, -.089, -.059], tip: [-.021, -.089, -.037], baseRadius: .0095, tipRadius: .007 },
      { base: [.040, -.111, .026], mid: [.038, -.110, -.059], tip: [-.018, -.110, -.042], baseRadius: .0085, tipRadius: .0065 },
    ],
  };
  return {
    thumb: { base: [-.049, -.072, .036], mid: [-.046, -.045, -.008], tip: [-.033, -.034, -.042], baseRadius: .011, tipRadius: .0075 },
    fingers: [
      { base: [-.054, -.076, .017], mid: [-.053, -.073, -.067], tip: [.010, -.075, -.053], baseRadius: .010, tipRadius: .0075 },
      { base: [-.060, -.097, .026], mid: [-.057, -.096, -.067], tip: [.008, -.097, -.055], baseRadius: .010, tipRadius: .0075 },
      { base: [-.057, -.119, .032], mid: [-.055, -.117, -.060], tip: [.004, -.119, -.054], baseRadius: .0095, tipRadius: .007 },
      { base: [-.051, -.136, .038], mid: [-.049, -.135, -.035], tip: [-.006, -.135, -.020], baseRadius: .008, tipRadius: .006 },
    ],
  };
}

function pad(center: Vec3, radii: Vec3, rz = 0): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, 12, 6).scale(...radii).rotateZ(rz).translate(...center);
}

function glovePanels(side: 'trigger' | 'support'): THREE.BufferGeometry {
  const trigger = side === 'trigger';
  const pieces = [pad(trigger ? [.030, -.087, .068] : [-.049, -.102, .063], trigger ? [.025, .029, .009] : [.022, .030, .008], trigger ? -.20 : .15)];
  // Three raised knuckle pads are merged into the back panel draw, not tiny stitches.
  for (let i = 0; i < 3; i++) pieces.push(pad(
    trigger ? [.054, -.065 - i * .021, .022] : [-.068, -.075 - i * .021, .023],
    [.009, .008, .012],
  ));
  const merged = mergeGeometries(pieces);
  for (const g of pieces) g.dispose();
  if (merged === null) throw new Error('pistol glove panel merge failed');
  return fitContact(merged);
}

export function buildPistolHandSide(side: 'trigger' | 'support', mat: MaterialLibrary): {
  hand: THREE.Group; forearm: THREE.Group; meshes: THREE.Mesh[];
} {
  const bind = PISTOL_HAND_BINDS[side];
  const trigger = side === 'trigger';
  const hand = new THREE.Group(); hand.name = trigger ? 'TriggerHand' : 'SupportHand';
  const forearm = new THREE.Group(); forearm.name = trigger ? 'TriggerForearm' : 'SupportForearm';
  const curves = pistolGripCurves(side);
  const sleeve = createForearmGeometry({
    ...bind, radialSegments: 18, lengthSegments: 14, elbowRx: .052, elbowRz: .043,
    wristRx: .030, wristRz: .024, bowAmp: .010, foldAmp: .004, seed: trigger ? 31 : 37,
  });
  const palm = fitContact(createPalmGeometry({
    center: bind.palm, size: trigger ? [.034, .047, .025] : [.026, .041, .025],
    rotationZ: trigger ? -.18 : .14, radialSegments: 16, heightSegments: 12,
    exponent: .9, knuckleAmp: .001, grooveDepth: .0007,
  }));
  const thumb = fitContact(createThumbGeometry({ ...curves.thumb, radialSegments: 10, lengthSegments: 8 }));
  const fingers = fitContact(createFingerSetGeometry({ digits: curves.fingers, radialSegments: 10, lengthSegments: 8, flatten: .9 }));
  const cuffEnd: Vec3 = [bind.wrist[0] * .88, bind.wrist[1] + .032, bind.wrist[2] - .010];
  const cuff = fitContact(createForearmGeometry({ elbow: bind.wrist, wrist: cuffEnd,
    elbowRx: .032, elbowRz: .026, wristRx: .029, wristRz: .024,
    radialSegments: 14, lengthSegments: 6, bowAmp: 0, foldAmp: .003, seed: 41,
  }));
  const panel = mat.painted(PAL.opWebbingDark, .91, 0);
  const meshes: THREE.Mesh[] = [];
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string): THREE.Mesh => {
    const m = new THREE.Mesh(geometry, material); m.name = name;
    m.castShadow = false; m.receiveShadow = false; meshes.push(m); return m;
  };
  forearm.add(mesh(sleeve, mat.viewmodel.sleeve, `${side}-sleeve`));
  hand.add(forearm,
    mesh(palm, mat.viewmodel.darkGlove, `${side}-palm`),
    mesh(thumb, mat.viewmodel.darkGlove, `${side}-thumb`),
    mesh(fingers, mat.viewmodel.darkGlove, `${side}-four-fingers`),
    mesh(cuff, panel, `${side}-cuff`),
    mesh(glovePanels(side), panel, `${side}-knuckle-panels`),
  );
  hand.userData.riggedPistol = { side, digits: 4, thumb: 1, author: 'Astra', contract: 'astra-hand-contract-v1' };
  return { hand, forearm, meshes };
}

export function createRiggedPistolHands(parent: THREE.Group, mat: MaterialLibrary): FirstPersonHandsRig {
  const root = new THREE.Group(); root.name = 'FirstPersonHands';
  root.userData.design = 'rigged-pistol-v1';
  const trigger = buildPistolHandSide('trigger', mat);
  const support = buildPistolHandSide('support', mat);
  root.add(trigger.hand, support.hand); parent.add(root);
  const bind = PISTOL_HAND_BINDS.support;
  const palmGeometry = support.meshes.find(m => m.name === 'support-palm')!.geometry;
  const surface = palmGeometry.getAttribute('position');
  const contact: Vec3 = [surface.getX(0), surface.getY(0), surface.getZ(0)];
  const delta: Vec3 = [PISTOL_RELOAD_SEAT[0] - contact[0], PISTOL_RELOAD_SEAT[1] - contact[1], PISTOL_RELOAD_SEAT[2] - contact[2]];
  // The wrapped fingers release left before the wrist descends. Approach and
  // retreat are vertical below the magazine, so the closed hand never crosses
  // the grip. All values are presentation-only; reload events stay in controller.
  const path = [
    [0, 0, 0, 0, 0, 0, 0],
    [.12, -.090, 0, 0, 0, 0, 0],
    [.30, -.090, -.120, 0, -.12, .05, -.05],
    [.42, delta[0], delta[1] - .060, delta[2], -.10, 0, 0],
    [.50, delta[0], delta[1], delta[2], -.10, 0, 0],
    [.62, delta[0], delta[1] + .001, delta[2], -.10, 0, 0],
    [.72, delta[0], delta[1] - .060, delta[2], -.10, 0, 0],
    [.84, -.090, -.120, 0, -.12, .05, -.05],
    [.93, -.090, 0, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0, 0],
  ] as const;
  const motion = createHandMotion({ triggerHand: trigger.hand, supportHand: support.hand, supportForearm: support.forearm }, trigger.forearm, PISTOL_HAND_BINDS.trigger, { ...bind, palm: contact }, delta, path);
  motion.resetReload();
  return { root, triggerHand: trigger.hand, supportHand: support.hand, supportForearm: support.forearm, ...motion };
}
