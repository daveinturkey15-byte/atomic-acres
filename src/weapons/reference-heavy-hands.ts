/** Original Minigun-only glove fit against the retained model's real triangles. */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from '../core/materials';
import { PAL } from '../core/palette';
import { createForearmGeometry, createPalmGeometry, type Vec3 } from './hand-geometry-canary';
import type { FirstPersonHandsRig } from './types';

export const HEAVY_HAND_BUDGET = { meshes: 12, triangles: 4000 } as const;
/** Pinned source mesh component centres, in decoded GLB scene coordinates (metres).
 * These are the actual right side handle and thin upper crossbar, not sockets.
 */
const HANDLE_CENTRES = { trigger: [.325, -.095, 0], support: [-.09, .23, .26] } as const;
const FINGER_RADIUS = .0075;
const POLYMER_NAME = 'minigun_FP_LOD0_Runtime_static_MAT_Pass65_minigun_Polymer_PBR';
type Side = 'trigger' | 'support';

/** Tube geometry is constructed once. End caps preserve readable rounded tips. */
function digit(points: THREE.Vector3[], radius: number): THREE.BufferGeometry {
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, false, 'centripetal'), 12, radius, 8, false);
  const cap = new THREE.SphereGeometry(radius, 8, 4);
  cap.translate(...points[points.length - 1].toArray());
  const geometry = mergeGeometries([tube, cap])!;
  tube.dispose(); cap.dispose();
  return geometry;
}

export function createReferenceHeavyHands(
  parent: THREE.Group, model: THREE.Group, mount: THREE.Group, mat: MaterialLibrary,
  reloadTarget: Vec3,
): FirstPersonHandsRig {
  const handle = model.getObjectByName(POLYMER_NAME);
  if (!(handle instanceof THREE.Mesh)) throw new Error('Minigun: missing actual handle mesh');
  parent.updateMatrixWorld(true);
  const root = new THREE.Group(); root.name = 'FirstPersonHands';
  root.userData.heavyFitVersion = 1;
  const contacts: { side: Side; digit: string; point: number[]; centre: number[] }[] = [];
  root.userData.heavyContacts = contacts;
  // Palette materials are shared library singletons. This rig owns geometry only.
  const canvas = mat.painted(PAL.opFatigueTan, .88, 0);
  const rubber = mat.viewmodel.darkGlove;
  const sleeve = mat.viewmodel.sleeve;
  const ray = new THREE.Raycaster();
  const pending = new Set<THREE.BufferGeometry>();
  const handGroups: THREE.Group[] = [], forearms: THREE.Group[] = [];
  const sourcePoint = (p: Vec3): THREE.Vector3 => parent.worldToLocal(
    mount.localToWorld(new THREE.Vector3(...p)),
  );
  const mesh = (owner: THREE.Group, name: string, geo: THREE.BufferGeometry, material: THREE.Material): THREE.Mesh => {
    const result = new THREE.Mesh(geo, material); result.name = name;
    result.frustumCulled = false; result.castShadow = false; result.receiveShadow = false;
    result.renderOrder = 100; owner.add(result); return result;
  };
  try {
    for (const side of ['trigger', 'support'] as const) {
      const trigger = side === 'trigger';
      const centre = sourcePoint(HANDLE_CENTRES[side]);
      // Measured long/short axes of the right handle's decoded component. Its
      // AABB is deceptive: the actual 48mm cross-section is tilted on all axes.
      const along = trigger ? new THREE.Vector3(-.394642, .573981, .717498).normalize() : new THREE.Vector3(1, 0, 0);
      const outward = trigger ? new THREE.Vector3(.876925, .002136, .480622).normalize() : new THREE.Vector3(0, 1, 0);
      outward.addScaledVector(along, -outward.dot(along)).normalize();
      const around = new THREE.Vector3().crossVectors(outward, along).negate();
      const hand = new THREE.Group(); hand.name = trigger ? 'TriggerHand' : 'SupportHand';
      const forearm = new THREE.Group(); forearm.name = trigger ? 'TriggerForearm' : 'SupportForearm';
      hand.add(forearm); root.add(hand); handGroups.push(hand); forearms.push(forearm);
      // Fit every sampled finger ring against a ray/triangle hit on the correct
      // exposed handle. An absent component fails closed to the existing fallback.
      const surface = (angle: number, axial: number, radius: number, name?: string): THREE.Vector3 => {
        const theta = angle * Math.PI / 180;
        const direction = outward.clone().multiplyScalar(Math.cos(theta)).addScaledVector(around, Math.sin(theta));
        const core = centre.clone().addScaledVector(along, axial);
        const origin = core.clone().addScaledVector(direction, trigger ? .14 : .075);
        ray.set(parent.localToWorld(origin), direction.clone().transformDirection(parent.matrixWorld).negate());
        const hit = ray.intersectObject(handle, false)[0];
        if (!hit || hit.distance > (trigger ? .19 : .11)) throw new Error(`Minigun: ${side} handle contact missing at ${angle}/${axial}`);
        const point = parent.worldToLocal(hit.point.clone());
        const padCentre = point.clone().addScaledVector(direction, radius * .98);
        if (name) contacts.push({ side, digit: name, point: point.toArray(), centre: padCentre.toArray() });
        return padCentre;
      };
      const palmCentre = surface(0, 0, .016);
      const palmGeo = createPalmGeometry({ center: [0, 0, 0], size: [.023, .043, .036],
        radialSegments: 12, heightSegments: 8, exponent: .8 });
      // Palm geometry's X is its outward normal; Y spans the four knuckles.
      const third = new THREE.Vector3().crossVectors(outward, along).normalize();
      const basis = new THREE.Matrix4().makeBasis(outward, along, third); basis.setPosition(palmCentre);
      palmGeo.applyMatrix4(basis);
      mesh(hand, `${hand.name}/CanvasPalm`, palmGeo, canvas);
      const fingers: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 4; i++) {
        const axial = .027 - i * .018;
        const name = ['Index', 'Middle', 'Ring', 'Little'][i];
        const points = [-5, 35, 80, 125, 170].map((a, j) => surface(a, axial,
          FINGER_RADIUS, j === 2 ? name : undefined));
        const geo = digit(points, FINGER_RADIUS * (i === 3 ? .9 : 1));
        pending.add(geo); geo.userData.digit = name; fingers.push(geo);
      }
      const fingerGeometry = mergeGeometries(fingers)!;
      mesh(hand, `${hand.name}/FourFingers`, fingerGeometry, rubber);
      for (const geo of fingers) { pending.delete(geo); geo.dispose(); }
      const thumbPoints = [0, -40, -80, -125].map((a, j) => surface(a,
        .033 - j * .006, .009, j === 2 ? 'Thumb' : undefined));
      mesh(hand, `${hand.name}/OpposedThumb`, digit(thumbPoints, .009), rubber);
      const wrist = palmCentre.clone().add(new THREE.Vector3(trigger ? .025 : -.057, trigger ? -.048 : -.010, .058));
      const elbow = centre.clone().add(new THREE.Vector3(trigger ? .16 : -.45, -.30, .43));
      // A short glove bridge visibly joins palm to cuff, then the sleeve joins it.
      mesh(hand, `${hand.name}/ConnectedWrist`, digit([palmCentre, palmCentre.clone().lerp(wrist, .5), wrist], .023), rubber);
      mesh(forearm, `${forearm.name}/Sleeve`, createForearmGeometry({
        elbow: elbow.toArray() as unknown as Vec3, wrist: wrist.toArray() as unknown as Vec3,
        elbowRx: .048, elbowRz: .042, wristRx: .027, wristRz: .025,
        radialSegments: 10, lengthSegments: 8, seed: trigger ? 91 : 92,
      }), sleeve);
      hand.userData.heavyWrist = wrist.toArray();
      hand.userData.heavyPalm = palmCentre.toArray();
      hand.userData.heavyHandleCentre = centre.toArray();
    }
    let meshes = 0, triangles = 0;
    root.traverse(n => {
      if (!(n instanceof THREE.Mesh)) return;
      meshes++; triangles += (n.geometry.index?.count ?? n.geometry.attributes.position.count) / 3;
    });
    if (meshes > HEAVY_HAND_BUDGET.meshes || triangles > HEAVY_HAND_BUDGET.triangles) throw new Error('Minigun: hands exceed frozen budget');
  } catch (error) {
    root.traverse(n => { if (n instanceof THREE.Mesh) n.geometry.dispose(); });
    for (const geometry of pending) geometry.dispose();
    throw error;
  }
  parent.add(root);
  const supportHand = handGroups[1];
  const resetReload = (): void => { supportHand.position.set(0, 0, 0); supportHand.rotation.set(0, 0, 0); };
  const updateReload = (progress: number): void => {
    if (!Number.isFinite(progress) || progress <= 0 || progress >= 1) { resetReload(); return; }
    const reach = Math.sin(progress * Math.PI);
    supportHand.position.set(reloadTarget[0] * reach, reloadTarget[1] * reach, reloadTarget[2] * reach);
    supportHand.rotation.z = -.075 * reach;
  };
  return { root, triggerHand: handGroups[0], supportHand, supportForearm: forearms[1], updateReload, resetReload };
}
