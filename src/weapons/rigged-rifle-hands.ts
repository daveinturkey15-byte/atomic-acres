/** Independent rifle fitting of the original authored hand asset. Construction
 * only; actual weapon solids and acceptance are frozen in astra-rifle-hand-contract.
 * The accepted pistol factory and shared runtime motion helper remain unchanged. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from '../core/materials';
import { PAL } from '../core/palette';
import type { FirstPersonHandsRig } from './types';
import { createHandMotion } from './first-person-hands-motion';
import { createForearmGeometry, createPalmGeometry, createThumbGeometry, createFingerSetGeometry, type DigitCurve, type Vec3 } from './hand-geometry-canary';

export const RIFLE_HAND_BINDS = {
  trigger: { elbow: [.24, -.36, .31] as Vec3, wrist: [.065, -.163, .086] as Vec3, palm: [.029, -.102, .057] as Vec3 },
  support: { elbow: [-.24, -.31, .02] as Vec3, wrist: [-.061, -.086, -.286] as Vec3, palm: [-.028, -.037, -.357] as Vec3 },
} as const;
export const RIFLE_RELOAD_SEAT: Vec3 = [0, -.20455336467772173, -.10204479799944051];

export function isRiggedRifleRequested(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('hands') === 'rifle-canary';
}

/** Build-time mould reads the live rifle builder's actual bounds/transforms. */
function makeContactMould(parent: THREE.Group): (g: THREE.BufferGeometry) => THREE.BufferGeometry {
  const solids = parent.children.filter((m): m is THREE.Mesh => m instanceof THREE.Mesh).map(m => {
    m.geometry.computeBoundingBox(); m.updateMatrix();
    return { box: m.geometry.boundingBox!.clone(), matrix: m.matrix.clone(), inverse: m.matrix.clone().invert() };
  });
  const p = new THREE.Vector3();
  return geometry => {
    const positions = geometry.getAttribute('position'), oldNormals = geometry.getAttribute('normal').array.slice();
    for (let i = 0; i < positions.count; i++) {
      p.fromBufferAttribute(positions, i);
      for (let pass = 0; pass < 3; pass++) for (const s of solids) {
        p.applyMatrix4(s.inverse);
        if (s.box.containsPoint(p)) {
          const dx = Math.min(p.x - s.box.min.x, s.box.max.x - p.x);
          const dy = Math.min(p.y - s.box.min.y, s.box.max.y - p.y);
          const dz = Math.min(p.z - s.box.min.z, s.box.max.z - p.z);
          if (dx <= dy && dx <= dz) p.x = p.x < 0 ? s.box.min.x - .0006 : s.box.max.x + .0006;
          else if (dy <= dz) p.y = p.y < 0 ? s.box.min.y - .0006 : s.box.max.y + .0006;
          else p.z = p.z < 0 ? s.box.min.z - .0006 : s.box.max.z + .0006;
        }
        p.applyMatrix4(s.matrix);
      }
      positions.setXYZ(i, p.x, p.y, p.z);
    }
    geometry.computeVertexNormals(); const n = geometry.getAttribute('normal');
    for (let i = 0; i < n.count; i++) if (Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) < .5) {
      n.setXYZ(i, oldNormals[i * 3], oldNormals[i * 3 + 1], oldNormals[i * 3 + 2]);
    }
    return geometry;
  };
}

export function rifleGripCurves(side: 'trigger' | 'support'): { thumb: DigitCurve; fingers: DigitCurve[] } {
  if (side === 'trigger') return {
    thumb: { base: [.040, -.055, .063], mid: [.007, -.041, .085], tip: [-.035, -.069, .038], baseRadius: .011, tipRadius: .008 },
    fingers: [
      { base: [.047, -.061, .031], mid: [.048, -.038, -.043], tip: [.012, -.035, -.049], baseRadius: .009, tipRadius: .0065 },
      { base: [.051, -.077, .033], mid: [.050, -.077, -.065], tip: [-.026, -.077, -.042], baseRadius: .010, tipRadius: .0075 },
      { base: [.051, -.100, .035], mid: [.049, -.100, -.068], tip: [-.025, -.100, -.047], baseRadius: .0095, tipRadius: .007 },
      { base: [.045, -.123, .038], mid: [.043, -.122, -.068], tip: [-.022, -.123, -.054], baseRadius: .0085, tipRadius: .0065 },
    ],
  };
  return {
    thumb: { base: [-.048, -.023, -.325], mid: [-.065, .012, -.301], tip: [-.053, .041, -.289], baseRadius: .011, tipRadius: .0075 },
    fingers: [
      { base: [-.045, -.025, -.395], mid: [.035, -.040, -.395], tip: [.054, .020, -.398], baseRadius: .010, tipRadius: .0075 },
      { base: [-.047, -.028, -.371], mid: [.036, -.042, -.371], tip: [.054, .024, -.374], baseRadius: .010, tipRadius: .0075 },
      { base: [-.047, -.030, -.348], mid: [.035, -.043, -.348], tip: [.053, .020, -.351], baseRadius: .0095, tipRadius: .007 },
      { base: [-.044, -.032, -.326], mid: [.031, -.043, -.326], tip: [.051, .013, -.329], baseRadius: .008, tipRadius: .006 },
    ],
  };
}

function pad(center: Vec3, radii: Vec3, rz = 0): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, 12, 6).scale(...radii).rotateZ(rz).translate(...center);
}
function glovePanels(side: 'trigger' | 'support'): THREE.BufferGeometry {
  const trigger = side === 'trigger';
  const pieces = [pad(trigger ? [.035, -.099, .081] : [-.051, -.037, -.357], trigger ? [.024, .029, .004] : [.005, .023, .043], trigger ? -.18 : 0)];
  for (let i = 0; i < 3; i++) pieces.push(pad(
    trigger ? [.058, -.075 - i * .023, .028] : [-.048, -.032, -.390 + i * .023],
    trigger ? [.005, .008, .008] : [.007, .006, .008],
  ));
  const merged = mergeGeometries(pieces); for (const g of pieces) g.dispose();
  if (!merged) throw new Error('rifle glove panel merge failed'); return merged;
}

function buildSide(side: 'trigger' | 'support', mat: MaterialLibrary, fit: (g: THREE.BufferGeometry) => THREE.BufferGeometry) {
  const trigger = side === 'trigger', bind = RIFLE_HAND_BINDS[side], curves = rifleGripCurves(side);
  const hand = new THREE.Group(); hand.name = trigger ? 'TriggerHand' : 'SupportHand';
  const forearm = new THREE.Group(); forearm.name = trigger ? 'TriggerForearm' : 'SupportForearm';
  const sleeve = createForearmGeometry({ ...bind, radialSegments: 18, lengthSegments: 14,
    elbowRx: .052, elbowRz: .043, wristRx: .030, wristRz: .024, bowAmp: .010, foldAmp: .004, seed: trigger ? 31 : 37 });
  const palm = fit(createPalmGeometry({ center: bind.palm, size: trigger ? [.034, .048, .028] : [.028, .028, .055],
    rotationZ: trigger ? -.18 : .05, radialSegments: 16, heightSegments: 12, exponent: .9, knuckleAmp: .001, grooveDepth: .0007 }));
  const thumb = fit(createThumbGeometry({ ...curves.thumb, radialSegments: 10, lengthSegments: 8 }));
  const fingers = fit(createFingerSetGeometry({ digits: curves.fingers, radialSegments: 10, lengthSegments: 8, flatten: .9 }));
  const cuffBase = new THREE.Vector3(...bind.elbow).sub(new THREE.Vector3(...bind.wrist)).normalize().multiplyScalar(.006).add(new THREE.Vector3(...bind.wrist));
  const cuff = fit(createForearmGeometry({ elbow: [cuffBase.x, cuffBase.y, cuffBase.z],
    wrist: trigger ? [.058, -.132, .074] : [-.055, -.057, -.306],
    elbowRx: .032, elbowRz: .026, wristRx: .029, wristRz: .024, radialSegments: 14, lengthSegments: 6, bowAmp: 0, foldAmp: .003, seed: 41 }));
  const panel = mat.painted(PAL.opWebbingDark, .91, 0), meshes: THREE.Mesh[] = [];
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string) => {
    const m = new THREE.Mesh(geometry, material); m.name = `${side}-${name}`; m.castShadow = m.receiveShadow = false; meshes.push(m); return m;
  };
  forearm.add(mesh(sleeve, mat.viewmodel.sleeve, 'sleeve'));
  hand.add(forearm, mesh(palm, mat.viewmodel.darkGlove, 'palm'), mesh(thumb, mat.viewmodel.darkGlove, 'thumb'),
    mesh(fingers, mat.viewmodel.darkGlove, 'four-fingers'), mesh(cuff, panel, 'cuff'), mesh(fit(glovePanels(side)), panel, 'knuckle-panels'));
  hand.userData.riggedRifle = { side, digits: 4, thumb: 1, contract: 'astra-rifle-hand-v1', author: 'Astra' };
  return { hand, forearm, meshes, palm };
}

export function createRiggedRifleHands(parent: THREE.Group, mat: MaterialLibrary): FirstPersonHandsRig {
  const fit = makeContactMould(parent), trigger = buildSide('trigger', mat, fit), support = buildSide('support', mat, fit);
  const root = new THREE.Group(); root.name = 'FirstPersonHands'; root.userData.design = 'rigged-rifle-v1';
  root.add(trigger.hand, support.hand); parent.add(root);
  const positions = support.palm.getAttribute('position');
  const contact: Vec3 = [positions.getX(0), positions.getY(0), positions.getZ(0)];
  const d: Vec3 = [RIFLE_RELOAD_SEAT[0] - contact[0], RIFLE_RELOAD_SEAT[1] - contact[1], RIFLE_RELOAD_SEAT[2] - contact[2]];
  // Release down off the wrapped fore-end before moving back to the magazine.
  // Turn the curled fingers down while safely outboard, then translate beneath
  // the foot. A diagonal reach cuts through it. The physical palm contacts 2mm
  // left of its centre and .5–1mm below its plane, within the frozen surface limit.
  const path = [
    [0, 0, 0, 0, 0, 0, 0],
    [.10, 0, -.080, 0, 0, 0, 0],
    [.22, -.100, -.140, .080, -.30, 0, 0],
    [.30, -.100, d[1] - .020, d[2], -.30, -.60, -.60],
    [.40, d[0] - .002, d[1] - .020, d[2], -.30, -.60, -.60],
    [.46, d[0] - .002, d[1] - .020, d[2], -.30, 0, 0],
    [.50, d[0] - .002, d[1] - .0009553, d[2] + .0002955, -.30, 0, 0],
    [.62, d[0] - .002, d[1] - .0004776, d[2] + .0001477, -.30, 0, 0],
    [.70, d[0] - .002, d[1] - .020, d[2], -.30, 0, 0],
    [.75, d[0] - .002, d[1] - .020, d[2], -.30, -.60, -.60],
    [.83, -.100, d[1] - .020, d[2], -.30, -.60, -.60],
    [.90, -.100, -.140, .080, -.30, 0, 0],
    [.95, 0, -.080, 0, 0, 0, 0],
    [1, 0, 0, 0, 0, 0, 0],
  ] as const;
  const motion = createHandMotion({ triggerHand: trigger.hand, supportHand: support.hand, supportForearm: support.forearm },
    trigger.forearm, RIFLE_HAND_BINDS.trigger, { ...RIFLE_HAND_BINDS.support, palm: contact }, d, path);
  motion.resetReload();
  return { root, triggerHand: trigger.hand, supportHand: support.hand, supportForearm: support.forearm, ...motion };
}
