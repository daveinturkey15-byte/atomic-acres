/**
 * Shared alpha-tested vegetation material factory.
 *
 * The root material library owns this singleton in the integration lane. The
 * factory is kept separate from the tree builder so tree geometry never creates
 * a material per instance or per frame. The maps are local, hash-pinned CC0
 * Poly Haven files under public/textures/vegetation/.
 */
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';

export const VEGETATION_LEAF_TEXTURES = {
  map: 'textures/vegetation/island_tree_01_leaves_diff_1k.png',
  alphaMap: 'textures/vegetation/island_tree_01_leaves_alpha_1k.png',
  normalMap: 'textures/vegetation/island_tree_01_leaves_nor_gl_1k.png',
  roughnessMap: 'textures/vegetation/island_tree_01_leaves_rough_1k.png',
} as const;

export interface VegetationMaterialSet {
  leafCards: MeshStandardNodeMaterial;
  dispose: () => void;
}

function configure(texture: THREE.Texture, colorSpace: THREE.ColorSpace): THREE.Texture {
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  texture.colorSpace = colorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Build one shared PBR cutout material for every tree leaf card. */
export function createVegetationMaterials(
  manager?: THREE.LoadingManager,
): VegetationMaterialSet {
  const loader = new THREE.TextureLoader(manager);
  const map = configure(loader.load(VEGETATION_LEAF_TEXTURES.map), THREE.SRGBColorSpace);
  const alphaMap = configure(loader.load(VEGETATION_LEAF_TEXTURES.alphaMap), THREE.NoColorSpace);
  const normalMap = configure(loader.load(VEGETATION_LEAF_TEXTURES.normalMap), THREE.NoColorSpace);
  const roughnessMap = configure(loader.load(VEGETATION_LEAF_TEXTURES.roughnessMap), THREE.NoColorSpace);
  const leafCards = new MeshStandardNodeMaterial({
    name: 'vegetation-leaf-cards-cc0',
    color: 0xffffff,
    map,
    alphaMap,
    normalMap,
    normalScale: new THREE.Vector2(0.36, 0.36),
    roughness: 1,
    roughnessMap,
    metalness: 0,
    alphaTest: 0.42,
    transparent: false,
    depthWrite: true,
    side: THREE.DoubleSide,
  });
  // Double-sided alpha-tested foliage does not need a second transparent pass.
  leafCards.forceSinglePass = true;

  return {
    leafCards,
    dispose() {
      leafCards.dispose();
      map.dispose();
      alphaMap.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}
