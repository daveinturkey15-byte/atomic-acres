/** One opt-in, original-source LMG canary. Registration/adoption belongs to the controller. */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { MaterialLibrary } from '../core/materials';
import { createRiggedRifleHands, RIFLE_HAND_BINDS, RIFLE_RELOAD_SEAT } from './rigged-rifle-hands';
import { createHandMotion } from './first-person-hands-motion';
import { poseEase } from './viewmodel-motion';
import type { ViewmodelRig } from './types';

// Includes the existing articulated hands; no material/texture/light allocations.
export const OPENPASS_RIG_BUDGET = Object.freeze({ meshes: 24, triangles: 16_000, geometryBytes: 2 * 1024 * 1024 });
export const OPENPASS_RIG_IDS = ['lmg'] as const;
export const OPENPASS_SOCKET_NAMES = [
  'grip-socket-r', 'support-socket-l', 'reload-socket-l', 'magazine-socket',
  'muzzle-socket', 'eject-socket', 'rear-sight-socket', 'front-sight-socket',
] as const;
type SocketName = typeof OPENPASS_SOCKET_NAMES[number];
export interface OpenpassWeaponRig extends ViewmodelRig {
  readonly weaponId: 'lmg';
  readonly sockets: Readonly<Record<SocketName, THREE.Object3D>>;
  /** Additive correction to the controller's existing (0,-.148,-.3) ADS mount. */
  readonly adsMount: Readonly<{ offsetX: number; offsetY: number; pitch: number; yaw: number }>;
  readonly adsSightNames: readonly ['rear-sight-socket', 'front-sight-socket'];
  readonly stats: Readonly<{ meshes: number; triangles: number; geometryBytes: number; ownedTextures: 0 }>;
  dispose(): void;
}

/** Bake only gun parts sharing one library material. Hands retain their articulated geometry. */
function mergeParts(parent: THREE.Group, parts: THREE.Mesh[], label: string): void {
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const part of parts) {
    part.updateMatrix();
    const indexed = part.geometry;
    const geometry = indexed.index ? indexed.toNonIndexed() : indexed;
    if (geometry !== indexed) indexed.dispose();
    geometry.applyMatrix4(part.matrix);
    const material = part.material as THREE.Material;
    const batch = batches.get(material) ?? [];
    batch.push(geometry); batches.set(material, batch);
    part.removeFromParent();
  }
  for (const [material, geometries] of batches) {
    const merged = mergeGeometries(geometries, false);
    for (const geometry of geometries) geometry.dispose();
    if (!merged) throw new Error('Openpass LMG: incompatible static geometry attributes');
    merged.computeBoundingBox(); merged.computeBoundingSphere();
    const mesh = new THREE.Mesh(merged, material);
    mesh.name = `${label}/${material.name || material.type}`;
    parent.add(mesh);
  }
}

export function buildOpenpassLmg(mat: MaterialLibrary): OpenpassWeaponRig {
  const group = new THREE.Group(); group.name = 'Viewmodel/OpenpassLMG';
  group.userData.nativeWeaponId = 'lmg'; group.userData.artStatus = 'unreviewed-canary';
  const steel = mat.viewmodel.parkerizedSteel, rubber = mat.viewmodel.darkGlove;
  const furniture = mat.viewmodel.woodFurniture, canvas = mat.viewmodel.sleeve;
  const staticParts: THREE.Mesh[] = [], magazineParts: THREE.Mesh[] = [];
  const magazine = new THREE.Group(); magazine.name = 'AmmoPouchReload';
  // The bottom face matches the accepted rifle hand's authored reload contact.
  magazine.position.set(0, -.135, -.112); group.add(magazine);
  const add = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material,
    x: number, y: number, z: number, parent = group, parts = staticParts): THREE.Mesh => {
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name;
    mesh.position.set(x, y, z); parent.add(mesh); parts.push(mesh); return mesh;
  };
  const box = (name: string, w: number, h: number, d: number, material: THREE.Material,
    x: number, y: number, z: number, radius = .003) => add(name,
    new RoundedBoxGeometry(w, h, d, 1, Math.min(radius, w * .4, h * .4, d * .4)), material, x, y, z);
  const tube = (name: string, radius: number, length: number, material: THREE.Material,
    x: number, y: number, z: number) => {
    const part = add(name, new THREE.CylinderGeometry(radius, radius, length, 12, 1, name === 'HeavyBarrel'), material, x, y, z);
    part.rotation.x = Math.PI / 2; return part;
  };
  const rod = (name: string, a: THREE.Vector3, b: THREE.Vector3, radius: number, material = steel) => {
    const part = add(name, new THREE.CylinderGeometry(radius, radius, a.distanceTo(b), 8), material,
      (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    part.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.sub(a).normalize());
  };

  // Broad stamped receiver and closed feed cover distinguish the 75-round weapon.
  box('Receiver', .096, .105, .34, steel, 0, .026, -.154, .009);
  box('FeedCover', .103, .018, .254, steel, 0, .088, -.157, .004);
  box('CoverRearHinge', .113, .021, .022, steel, 0, .079, -.028);
  box('FeedTray', .13, .023, .088, steel, -.010, .045, -.180);
  box('RightEjectionRecess', .002, .032, .088, rubber, .0488, .020, -.145, .0005);
  box('EjectionLowerLip', .008, .008, .091, steel, .052, .000, -.145, .001);
  box('ChargingTrack', .005, .017, .120, rubber, .050, .059, -.12, .001);
  box('ChargingKnob', .038, .015, .022, steel, .069, .059, -.067, .004);
  box('FeedLatch', .020, .025, .037, rubber, -.065, .048, -.115);

  // Preserve the proven grip and support wrapping surfaces, in metres.
  box('PistolGrip', .045, .13, .055, rubber, 0, -.09, 0, .009).rotation.x = .35;
  box('Foregrip', .070, .070, .205, furniture, 0, .030, -.368, .010);
  for (const z of [-.302, -.350, -.400]) box('ForegripBand', .074, .012, .014, rubber, 0, .030, z, .002);
  box('Trigger', .008, .030, .010, mat.chrome, 0, -.035, -.045, .001);
  box('GuardBase', .006, .006, .070, steel, 0, -.055, -.035, .001);
  box('GuardFront', .006, .030, .006, steel, 0, -.040, -.068, .001);
  box('StockNeck', .043, .055, .125, steel, 0, .020, .080, .005);
  box('ShoulderStock', .062, .115, .198, furniture, 0, .008, .214, .010);
  box('ButtPad', .068, .133, .027, rubber, 0, .008, .327, .006);

  tube('HeavyBarrel', .014, .480, steel, 0, .048, -.584);
  tube('BarrelLock', .024, .035, steel, 0, .048, -.455);
  tube('GasPiston', .008, .290, steel, 0, .010, -.585);
  tube('GasRegulator', .014, .037, steel, 0, .010, -.737);
  // Open longitudinal cooling slots; these are actual negative space, not black decals.
  for (const x of [-.030, .030]) {
    box('ShroudUpperRail', .009, .013, .155, steel, x, .078, -.534);
    box('ShroudLowerRail', .009, .013, .155, steel, x, .023, -.534);
    for (const z of [-.474, -.519, -.564, -.609]) box('ShroudRib', .009, .058, .009, steel, x, .050, z, .001);
  }
  // An annular muzzle has a real bore rather than a bright closed cylinder cap.
  const muzzleRing = add('MuzzleBore', new THREE.TorusGeometry(.016, .004, 6, 16), steel, 0, .048, -.828);
  muzzleRing.rotation.set(0, 0, 0);
  for (const x of [-.018, .018]) box('FlashHiderProng', .006, .007, .041, steel, x, .048, -.815, .001);
  for (const y of [.030, .066]) box('FlashHiderProng', .007, .006, .041, steel, 0, y, -.815, .001);

  // Folded legs stay forward of the hand; no deployable bipod gameplay is implied.
  for (const sign of [-1, 1]) {
    rod('FoldedBipodLeg', new THREE.Vector3(sign * .024, -.006, -.700), new THREE.Vector3(sign * .061, -.045, -.465), .007);
    box('BipodFoot', .027, .012, .035, rubber, sign * .061, -.045, -.458);
  }
  // Carry handle lies left of the sight corridor and has a visible opening.
  rod('CarryHandleRear', new THREE.Vector3(-.050, .073, -.07), new THREE.Vector3(-.077, .143, -.10), .006);
  rod('CarryHandleFront', new THREE.Vector3(-.050, .073, -.29), new THREE.Vector3(-.077, .143, -.26), .006);
  rod('CarryHandleGrip', new THREE.Vector3(-.077, .143, -.10), new THREE.Vector3(-.077, .143, -.26), .010, rubber);

  add('CanvasAmmunitionPouch', new RoundedBoxGeometry(.104, .132, .123, 1, .012), canvas,
    0, 0, 0, magazine, magazineParts);
  add('PouchBase', new RoundedBoxGeometry(.108, .012, .126, 1, .003), rubber,
    0, -.060, 0, magazine, magazineParts);
  add('PouchWebbing', new THREE.BoxGeometry(.024, .130, .004), rubber,
    0, 0, .064, magazine, magazineParts);
  // Short exposed belt enters the left feed tray. No hidden rounds or ammo state are inferred.
  for (let i = 0; i < 6; i++) {
    const x = -.058 - Math.sin(i / 5 * Math.PI) * .022, y = .030 - i * .019;
    tube('BeltCartridge', .0045, .055, mat.chrome, x, y, -.183);
    box('BeltLink', .012, .004, .009, steel, x, y + .004, -.175, .0005);
  }

  // Rear notch aperture and front blade stop 1.5mm beneath the exact aim ray.
  box('RearSightBase', .045, .012, .031, steel, 0, .106, .008);
  for (const x of [-.017, .017]) box('RearNotchEar', .009, .033, .018, steel, x, .129, .008, .001);
  box('FrontSightTower', .016, .058, .019, steel, 0, .091, -.700, .002);
  box('FrontBlade', .004, .016, .009, mat.chrome, 0, .1205, -.700, .0007);
  for (const x of [-.019, .019]) box('FrontSightGuard', .005, .044, .011, steel, x, .120, -.700, .001);

  // The existing fitter sees individual solids, never a merged receiver-wide AABB.
  const hands = createRiggedRifleHands(group, mat);
  const gun = new THREE.Group(); gun.name = 'WeaponGeometry'; group.add(gun);
  group.userData.partNames = staticParts.map(p => p.name).concat(magazineParts.map(p => p.name));
  mergeParts(gun, staticParts, 'LMGStatic'); mergeParts(magazine, magazineParts, 'LMGAmmo');
  gun.add(magazine);
  const sockets = {} as Record<SocketName, THREE.Object3D>;
  const socket = (name: SocketName, x: number, y: number, z: number, parent: THREE.Object3D = group) => {
    const node = new THREE.Object3D(); node.name = name; node.position.set(x, y, z);
    parent.add(node); sockets[name] = node; return node;
  };
  socket('grip-socket-r', ...RIFLE_HAND_BINDS.trigger.palm);
  socket('support-socket-l', ...RIFLE_HAND_BINDS.support.palm);
  socket('reload-socket-l', ...RIFLE_RELOAD_SEAT);
  socket('magazine-socket', 0, 0, 0, magazine);
  const muzzle = socket('muzzle-socket', 0, .048, -.839);
  const eject = socket('eject-socket', .056, .020, -.145); eject.rotation.y = -Math.PI / 2;
  socket('rear-sight-socket', 0, .130, .008);
  socket('front-sight-socket', 0, .130, -.700);

  // Reuse the public sleeve solver, with a pouch withdrawal inside the accepted outside reach.
  const palmPositions = (hands.supportHand.getObjectByName('support-palm') as THREE.Mesh).geometry.getAttribute('position');
  const contact: [number, number, number] = [palmPositions.getX(0), palmPositions.getY(0), palmPositions.getZ(0)];
  const d: [number, number, number] = [RIFLE_RELOAD_SEAT[0] - contact[0], RIFLE_RELOAD_SEAT[1] - contact[1], RIFLE_RELOAD_SEAT[2] - contact[2]];
  const seatedY = d[1] - .0009553, seatedZ = d[2] + .0002955;
  const motion = createHandMotion(hands, hands.triggerHand.getObjectByName('TriggerForearm') as THREE.Group,
    RIFLE_HAND_BINDS.trigger, { ...RIFLE_HAND_BINDS.support, palm: contact }, d, [
      [0, 0, 0, 0, 0, 0, 0], [.10, 0, -.080, 0, 0, 0, 0],
      [.22, -.100, -.140, .080, -.30, 0, 0], [.30, -.100, d[1] - .020, d[2], -.30, -.60, -.60],
      [.40, d[0] - .002, d[1] - .020, d[2], -.30, -.60, -.60],
      [.46, d[0] - .002, d[1] - .020, d[2], -.30, 0, 0],
      [.50, d[0] - .002, seatedY, seatedZ, -.30, 0, 0],
      [.56, d[0] - .002, seatedY - .082, seatedZ, -.30, 0, 0],
      [.62, d[0] - .002, seatedY - .082, seatedZ, -.30, 0, 0],
      [.70, d[0] - .002, seatedY, seatedZ, -.30, 0, 0],
      [.75, d[0] - .002, d[1] - .020, d[2], -.30, -.60, -.60],
      [.83, -.100, d[1] - .020, d[2], -.30, -.60, -.60],
      [.90, -.100, -.140, .080, -.30, 0, 0], [.95, 0, -.080, 0, 0, 0, 0], [1, 0, 0, 0, 0, 0, 0],
    ]);
  let reloadPhase = 0, handLower = 0;
  const movePouch = () => {
    const p = reloadPhase * (1 - handLower);
    const withdrawal = p >= .50 && p < .70
      ? .082 * (p < .56 ? poseEase((p - .50) / .06) : p <= .62 ? 1 : 1 - poseEase((p - .62) / .08)) : 0;
    magazine.position.y = -.135 - withdrawal;
    sockets['reload-socket-l'].position.y = RIFLE_RELOAD_SEAT[1] - withdrawal;
  };
  hands.updateReload = (progress: number) => {
    reloadPhase = Number.isFinite(progress) && progress > 0 && progress < 1 ? progress : 0;
    motion.updateReload(reloadPhase); movePouch();
  };
  hands.updatePose = (crouch, prone, lower) => {
    handLower = Number.isFinite(lower) ? THREE.MathUtils.clamp(lower, 0, 1) : 0;
    motion.updatePose!(crouch, prone, handLower); movePouch();
  };
  hands.resetReload = () => { reloadPhase = 0; motion.resetReload(); movePouch(); };
  const geometries = new Set<THREE.BufferGeometry>();
  const stats = { meshes: 0, triangles: 0, geometryBytes: 0, ownedTextures: 0 as const };
  group.traverse(node => {
    if (!(node instanceof THREE.Mesh)) return;
    node.castShadow = node.receiveShadow = false; node.frustumCulled = false; node.renderOrder = 100;
    stats.meshes++; const geometry: THREE.BufferGeometry = node.geometry; geometries.add(geometry);
    stats.triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
    stats.geometryBytes += geometry.index?.array.byteLength ?? 0;
    for (const attribute of Object.values(geometry.attributes)) stats.geometryBytes += attribute.array.byteLength;
  });
  let disposed = false;
  const dispose = () => {
    if (disposed) return; disposed = true;
    group.removeFromParent(); for (const geometry of geometries) geometry.dispose();
  };
  for (const key of ['meshes', 'triangles', 'geometryBytes'] as const) {
    if (stats[key] > OPENPASS_RIG_BUDGET[key]) { dispose(); throw new Error(`Openpass LMG ${key} budget exceeded: ${stats[key]}`); }
  }
  return { group, hands, muzzle, eject, weaponId: 'lmg', sockets: Object.freeze(sockets),
    adsMount: Object.freeze({ offsetX: 0, offsetY: .148 - .130, pitch: 0, yaw: 0 }),
    adsSightNames: ['rear-sight-socket', 'front-sight-socket'], stats: Object.freeze(stats), dispose };
}

/** Deliberately one entry: the other seven fallbacks await this canary's pixel review. */
export const OPENPASS_RIG_BUILDERS = Object.freeze({ lmg: buildOpenpassLmg });
