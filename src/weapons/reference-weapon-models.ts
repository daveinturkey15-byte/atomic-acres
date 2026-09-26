/** Owner-approved public asset intake; independently authored restart adapter. */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import type { MaterialLibrary } from '../core/materials';
import { createFirstPersonHands } from './first-person-hands';
import { TRIGGER_SPEC } from './hand-geometry-canary';
import { collectGltfResources, disposeResourceSet, disposeOwnedGeometries } from './catalog-carbine-loader';
import type { ViewmodelRig, FirstPersonHandsRig } from './types';

export const REFERENCE_WEAPON_IDS = ['mini-uzi', 'magnum', 'minigun'] as const;
export type ReferenceWeaponId = typeof REFERENCE_WEAPON_IDS[number];
export const REFERENCE_MODEL_SCALES: Readonly<Record<ReferenceWeaponId, number>> = {
  'mini-uzi': 0.70, magnum: 0.48, minigun: 0.52,
};
export const REFERENCE_MODEL_BUDGET = { meshes: 16, triangles: 16000, textures: 8 } as const;
export const REFERENCE_SOCKETS = [
  'grip-socket-r', 'support-socket-l', 'reload-socket-l', 'magazine-socket',
  'muzzle-socket', 'eject-socket', 'rear-sight-socket', 'front-sight-socket',
] as const;

export interface ReferenceWeaponRig extends ViewmodelRig {
  readonly weaponId: ReferenceWeaponId;
  readonly assetUrl: string;
  readonly adsMount: { offsetX: number; offsetY: number; pitch: number; yaw: number };
  readonly stats: { meshes: number; triangles: number; textures: number };
  readonly adsSightNames: readonly [string, string];
  dispose(): void;
}

/** Fresh loader and owned resources per rig: no disposed global cache can be reused. */
export function createReferenceWeaponLoader(): GLTFLoader {
  return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
}

/** Releases GPU resources AND ImageBitmaps; material-library hands are separate owners. */
function releaseModel(scene: THREE.Group): void {
  const resources = collectGltfResources(scene);
  const images = new Set<{ close?: () => void }>();
  for (const texture of resources.textures) {
    if (texture.image && typeof texture.image === 'object') images.add(texture.image);
  }
  disposeResourceSet(resources);
  for (const image of images) image.close?.();
}

/** Parse seam takes the same GLTFLoader result as network loading, never fabricated sockets. */
export function adaptReferenceWeaponModel(
  weaponId: ReferenceWeaponId,
  gltf: Pick<GLTF, 'scene'>,
  mat?: MaterialLibrary,
): ReferenceWeaponRig {
  if (!REFERENCE_WEAPON_IDS.includes(weaponId)) throw new Error('Unregistered reference weapon');
  const model = gltf.scene;
  const group = new THREE.Group();
  group.name = `ReferenceWeapon:${weaponId}`;
  group.userData.referenceWeaponId = weaponId;
  group.userData.sourceProvenance = './assets/reference-weapons/source-provenance.json';
  let hands: FirstPersonHandsRig | undefined;
  let sightAssembly: THREE.Group | undefined;
  try {
    for (const name of REFERENCE_SOCKETS) {
      if (!model.getObjectByName(name)) throw new Error(`${weaponId}: missing ${name}`);
    }
    let meshes = 0, triangles = 0;
    model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      meshes++;
      const positions = node.geometry.getAttribute('position');
      if (!positions) throw new Error(`${weaponId}: missing vertices`);
      triangles += (node.geometry.index?.count ?? positions.count) / 3;
      node.frustumCulled = false;
      node.castShadow = false;
      node.receiveShadow = false;
      node.renderOrder = 100;
      // The retained Minigun exports its separate optic pane as opaque.
      // A transparent polycarbonate finish preserves the actual pane geometry.
      if (weaponId === 'minigun' && node.name.endsWith('_Lens')) {
        const pane = node.material as THREE.MeshStandardMaterial;
        pane.transparent = true; pane.opacity = .16; pane.depthWrite = false;
      }
    });
    const textures = collectGltfResources(model).textures.size;
    if (!meshes || meshes > REFERENCE_MODEL_BUDGET.meshes || textures < 5
      || triangles > REFERENCE_MODEL_BUDGET.triangles || textures > REFERENCE_MODEL_BUDGET.textures) {
      throw new Error(`${weaponId}: model exceeds bounded intake budget`);
    }
    // A wrapper preserves the authored root rotation (the source already points -Z).
    const mount = new THREE.Group();
    mount.name = 'ReferenceGripMount';
    mount.scale.setScalar(REFERENCE_MODEL_SCALES[weaponId]);
    mount.add(model);
    group.add(mount);
    group.updateMatrixWorld(true);
    const socket = (name: string) => model.getObjectByName(name)!;
    const localPoint = (name: string) => group.worldToLocal(socket(name).getWorldPosition(new THREE.Vector3()));
    mount.position.copy(new THREE.Vector3(...TRIGGER_SPEC.palm).sub(localPoint('grip-socket-r')));
    group.updateMatrixWorld(true);
    const support = localPoint('support-socket-l');
    const reload = localPoint('reload-socket-l').sub(support);
    if (mat) {
      hands = createFirstPersonHands(group, mat, support.z, support.y, [reload.x, reload.y, reload.z]);
      // Existing geometry's support palm is x=-.01. A parent correction survives
      // resetReload/updatePose, which intentionally overwrite the hand transform.
      const supportFit = new THREE.Group();
      supportFit.name = 'ReferenceSupportFit';
      supportFit.position.x = support.x + 0.01;
      hands.root.add(supportFit);
      supportFit.add(hands.supportHand);
      hands.root.traverse((node) => {
        if (node instanceof THREE.Mesh) { node.frustumCulled = false; node.renderOrder = 100; }
      });
    }
    const rear = localPoint('rear-sight-socket');
    const front = localPoint('front-sight-socket');
    const line = front.clone().sub(rear);
    if (line.length() < .05 || line.z >= 0) throw new Error(`${weaponId}: invalid sight line`);
    const rotation = new THREE.Quaternion().setFromUnitVectors(line.normalize(), new THREE.Vector3(0, 0, -1));
    const euler = new THREE.Euler().setFromQuaternion(rotation, 'YXZ');
    let adsSightNames: readonly [string, string] = ['rear-sight-socket', 'front-sight-socket'];
    if (weaponId !== 'minigun') {
      // Imported sight markers sit inside solid geometry. Preserve that mesh;
      // build a physically mounted open notch above its measured silhouette.
      let top = -Infinity;
      const vertex = new THREE.Vector3();
      model.traverse((node) => {
        if (!(node instanceof THREE.Mesh)) return;
        const positions = node.geometry.getAttribute('position');
        for (let i = 0; i < positions.count; i++) {
          vertex.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld).applyQuaternion(rotation);
          top = Math.max(top, vertex.y);
        }
      });
      const lift = top - rear.clone().applyQuaternion(rotation).y + .012;
      if (lift < .021 || lift > .075) throw new Error(`${weaponId}: sight mount outside bounded fit`);
      const inverse = rotation.clone().invert();
      const raised = new THREE.Vector3(0, lift, 0).applyQuaternion(inverse);
      const oldRear = rear.clone(), oldFront = front.clone();
      rear.add(raised); front.add(raised);
      sightAssembly = new THREE.Group();
      sightAssembly.name = 'RestartRaisedIronSights';
      group.add(sightAssembly);
      const metal = new THREE.MeshStandardMaterial({ color: 0x263034, metalness: .75, roughness: .43 });
      const part = (name: string, anchor: THREE.Vector3, x: number, y: number, w: number, h: number, d: number) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), metal);
        mesh.name = name;
        mesh.position.copy(new THREE.Vector3(x, y, 0).applyQuaternion(inverse).add(anchor));
        mesh.quaternion.copy(inverse); mesh.frustumCulled = false; mesh.renderOrder = 100;
        sightAssembly!.add(mesh); meshes++; triangles += 12;
      };
      part('RestartRearNotchLeft', rear, -.014, 0, .006, .025, .012);
      part('RestartRearNotchRight', rear, .014, 0, .006, .025, .012);
      part('RestartRearNotchBase', rear, 0, -.016, .034, .010, .014);
      part('RestartRearSightMount', oldRear, 0, (lift - .021) / 2, .022, lift - .021, .020);
      part('RestartFrontSightMount', oldFront, 0, (lift - .021) / 2, .022, lift - .021, .020);
      // Front blade tip sits 1.5mm below the sight ray, as a usable six-o'clock hold.
      part('RestartFrontBlade', front, 0, -.01125, .006, .0195, .010);
      for (const [name, position] of [['restart-rear-aperture', rear], ['restart-front-aim', front]] as const) {
        const anchor = new THREE.Object3D(); anchor.name = name; anchor.position.copy(position); sightAssembly.add(anchor);
      }
      adsSightNames = ['restart-rear-aperture', 'restart-front-aim'];
      group.userData.sightLiftMeters = lift;
      if (meshes > REFERENCE_MODEL_BUDGET.meshes || triangles > REFERENCE_MODEL_BUDGET.triangles) {
        throw new Error(`${weaponId}: raised sights exceed unchanged model budget`);
      }
    }
    rear.applyQuaternion(rotation);
    // The correction is added to the controller's -0.148m shared ADS height.
    const adsMount = { offsetX: -rear.x, offsetY: .148 - rear.y, pitch: euler.x, yaw: euler.y };
    const muzzle = socket('muzzle-socket'), eject = socket('eject-socket');
    if (localPoint('muzzle-socket').z >= -.1) throw new Error(`${weaponId}: muzzle not forward of grip`);
    const assetUrl = `./assets/reference-weapons/${weaponId}/${weaponId}-fp-lod0.glb`;
    let disposed = false;
    return {
      group, muzzle, eject, hands, weaponId, assetUrl, adsMount,
      stats: { meshes, triangles, textures },
      adsSightNames,
      dispose() {
        if (disposed) return;
        disposed = true;
        group.removeFromParent();
        if (hands) { disposeOwnedGeometries(hands.root); hands.root.removeFromParent(); }
        releaseModel(model);
        if (sightAssembly) releaseModel(sightAssembly);
      },
    };
  } catch (error) {
    if (hands) disposeOwnedGeometries(hands.root);
    releaseModel(model);
    if (sightAssembly) releaseModel(sightAssembly);
    throw error;
  }
}

export async function loadReferenceWeaponRig(weaponId: ReferenceWeaponId, mat: MaterialLibrary): Promise<ReferenceWeaponRig> {
  if (!REFERENCE_WEAPON_IDS.includes(weaponId)) throw new Error('Unregistered reference weapon');
  const url = `./assets/reference-weapons/${weaponId}/${weaponId}-fp-lod0.glb`;
  const gltf = await createReferenceWeaponLoader().loadAsync(url);
  return adaptReferenceWeaponModel(weaponId, gltf, mat);
}
