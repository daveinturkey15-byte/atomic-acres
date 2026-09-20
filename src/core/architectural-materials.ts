/** Metre-scale architectural PBR canary. Install before builders/first render.
 * Owns four downloaded/derived CC0 textures, never the library's borrowed maps.
 * Source maps and technical packing are recorded in architecture-pbr/provenance.json.
 */
import * as THREE from 'three';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  cameraViewMatrix, materialColor, normalWorldGeometry, positionWorld,
  texture, vec2, vec3, vec4,
} from 'three/tsl';
import type { MaterialLibrary } from './materials';
import { PAL } from './palette';
import { orangeRoomAmbientNode } from './orange-room-ambient';

type Surface = THREE.MeshStandardMaterial & Pick<MeshStandardNodeMaterial,
  'colorNode' | 'roughnessNode' | 'normalNode' | 'aoNode'>;
type SurfaceKey = 'stuccoCream' | 'stuccoTerracotta' | 'capsuleWhite' |
  'interiorWall' | 'roofWhite' | 'timber' | 'timberDark';
type Library = Pick<MaterialLibrary, SurfaceKey | 'dispose'>;
type Profile = { key: SurfaceKey; palette: number; timber?: boolean;
  normal: number; contrast: number; roughMin: number; roughMax: number };

const PROFILES: readonly Profile[] = [
  { key: 'stuccoCream', palette: PAL.houseCream, normal: 0.95, contrast: 0.42, roughMin: 0.78, roughMax: 0.98 },
  { key: 'stuccoTerracotta', palette: PAL.terracotta, normal: 1.15, contrast: 0.5, roughMin: 0.78, roughMax: 0.98 },
  { key: 'capsuleWhite', palette: PAL.capsuleWhite, normal: 0.4, contrast: 0.24, roughMin: 0.7, roughMax: 0.92 },
  // Painted partitions/slab soffits and the pale roof have a finer sealed finish
  // than bare exterior render. The same measured grain scale is retained.
  { key: 'interiorWall', palette: PAL.houseCream, normal: 0.16, contrast: 0.075, roughMin: 0.8, roughMax: 0.94 },
  { key: 'roofWhite', palette: PAL.roofWhite, normal: 0.16, contrast: 0.07, roughMin: 0.76, roughMax: 0.91 },
  { key: 'timber', palette: PAL.timber, timber: true, normal: 0.65, contrast: 0.78, roughMin: 0.62, roughMax: 0.94 },
  { key: 'timberDark', palette: PAL.timberDark, timber: true, normal: 0.55, contrast: 0.68, roughMin: 0.64, roughMax: 0.95 },
];

export const ARCHITECTURE_TEXTURE_FILES = [
  'plaster-surface.png', 'plaster-normal.png', 'timber-surface.png', 'timber-normal.png',
] as const;
const DIMENSIONS = [[1024, 1024], [1024, 1024], [1024, 256], [1024, 256]] as const;
const active = new WeakMap<Library, Promise<ArchitecturalMaterials | null>>();

export interface ArchitecturalMaterials {
  readonly textures: readonly THREE.Texture[];
  readonly materialCount: number;
  readonly runtimeBytes: number;
  dispose(): void;
}

export function isArchitectureEnabled(search = globalThis.location?.search ?? ''): boolean {
  return new URLSearchParams(search).get('architecture') === 'canary';
}

/** World-space samples, with a surface-gradient normal rather than blending
 * tangent normals as if their three coordinate frames were the same.
 * Squared/squared weights keep planar detail crisp and capsule joins smooth.
 */
function nodes(surface: THREE.Texture, normal: THREE.Texture, profile: Profile) {
  const p = positionWorld;
  const n = normalWorldGeometry;
  const weight = n.abs().pow(4);
  const w = weight.div(weight.x.add(weight.y).add(weight.z).max(0.00001));
  // Plaster scan is 1 m square. Timber crop is 700 x 123 source pixels out of
  // the publisher's measured 1024 px / 1 m tile. Grain runs vertically on walls.
  const wood = !!profile.timber;
  const tile = wood ? vec2(700 / 1024, 123 / 1024) : vec2(1, 1);
  const xUV = (wood ? p.yz : p.zy).div(tile);
  const yUV = p.xz.div(tile);
  const zUV = (wood ? p.yx : p.xy).div(tile);
  const scan = texture(surface, xUV).mul(w.x)
    .add(texture(surface, yUV).mul(w.y))
    .add(texture(surface, zUV).mul(w.z)).toVar();
  const x = texture(normal, xUV).xyz.mul(2).sub(1);
  const y = texture(normal, yUV).xyz.mul(2).sub(1);
  const z = texture(normal, zUV).xyz.mul(2).sub(1);
  const gx = (wood ? vec3(0, x.x, x.y) : vec3(0, x.y, x.x)).div(x.z.max(0.25));
  const gy = vec3(y.x, 0, y.y).div(y.z.max(0.25));
  const gz = (wood ? vec3(z.y, z.x, 0) : vec3(z.x, z.y, 0)).div(z.z.max(0.25));
  // Tangent normal XY is minus the height gradient. Remove the component along
  // the geometric normal; flat maps therefore reproduce n on every face.
  const gradient = gx.mul(w.x).add(gy.mul(w.y)).add(gz.mul(w.z));
  const relief = gradient.sub(n.mul(gradient.dot(n)));
  const perturbed = n.add(relief.mul(profile.normal)).normalize();
  // Scan packing removes broad captured staining and normal bias. Application
  // wear therefore lives at building scale, not in a repeating one-metre tile.
  // Two oblique long waves have no aligned repeat over a house; amplitude is
  // bounded to +/-1.7%, so they cannot become dark wet/mould stripes.
  const wear = p.dot(vec3(0.11, 0.07, 0.17)).sin().mul(0.012)
    .add(p.dot(vec3(0.31, 0.23, 0.13)).sin().mul(0.005));
  const variation = scan.r.mul(2).sub(1).mul(profile.contrast).add(1).add(wear);
  return {
    colorNode: vec4(materialColor.rgb.mul(variation), 1),
    roughnessNode: scan.g.mul(profile.roughMax - profile.roughMin).add(profile.roughMin),
    normalNode: cameraViewMatrix.mul(vec4(perturbed, 0)).xyz.normalize(),
  };
}

/** Default-off, atomic installation. Repeated calls share one pending/result
 * controller. Await before building objects so r180's first material adaptation
 * sees the node hooks. Both WebGPURenderer backends use that same adaptation.
 */
export function installArchitecturalMaterials(
  library: Library,
  enabled = isArchitectureEnabled(),
  loadTexture?: (url: string) => Promise<THREE.Texture>,
): Promise<ArchitecturalMaterials | null> {
  if (!enabled) return Promise.resolve(null);
  const existing = active.get(library);
  if (existing) return existing;
  const task = install(library, loadTexture);
  active.set(library, task);
  return task;
}

async function install(library: Library, loadTexture?: (url: string) => Promise<THREE.Texture>) {
  const roomAmbient = new URLSearchParams(globalThis.location?.search ?? '').get('room') === 'authored';
  const materials = PROFILES.map(p => library[p.key] as Surface);
  if (materials.some(m => !m.isMeshStandardMaterial) || new Set(materials).size !== materials.length) {
    throw new Error('Architecture canary requires seven distinct shared standard materials');
  }
  const originalDispose = library.dispose;
  let disposed = false;
  let controller: ArchitecturalMaterials | undefined;
  const wrappedDispose = () => {
    disposed = true;
    controller?.dispose();
    if (library.dispose === wrappedDispose) library.dispose = originalDispose;
    originalDispose.call(library);
  };
  library.dispose = wrappedDispose;
  const textureLoader = new THREE.TextureLoader();
  const loader = loadTexture ?? textureLoader.loadAsync.bind(textureLoader);
  const outcomes = await Promise.allSettled(ARCHITECTURE_TEXTURE_FILES.map(name =>
    Promise.resolve().then(() => loader(`/assets/architecture-pbr/${name}`))));
  const textures = outcomes.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
  const dimensionsValid = textures.length === 4 && textures.every((t, i) =>
    t.image?.width === DIMENSIONS[i][0] && t.image?.height === DIMENSIONS[i][1]);
  if (disposed || !dimensionsValid || outcomes.some(r => r.status === 'rejected')) {
    for (const t of new Set(textures)) t.dispose();
    if (library.dispose === wrappedDispose) library.dispose = originalDispose;
    active.delete(library);
    if (!disposed) console.warn('Architecture canary unavailable; original material maps retained');
    return null;
  }
  for (const t of textures) {
    t.colorSpace = THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 4;
    t.needsUpdate = true;
  }
  const saved = materials.map(m => ({ color: m.color.clone(), map: m.map,
    roughnessMap: m.roughnessMap, normalMap: m.normalMap,
    nodes: ['colorNode', 'roughnessNode', 'normalNode', 'aoNode', 'customProgramCacheKey'].map(key => ({
      key, descriptor: Object.getOwnPropertyDescriptor(m, key),
    })),
  }));
  for (let i = 0; i < materials.length; ++i) {
    const m = materials[i];
    const profile = PROFILES[i];
    // The authored palette used to live inside the procedural albedo map.
    // Preserve any material tint as well (notably the interior wall multiplier).
    m.color.multiply(new THREE.Color(profile.palette));
    m.map = m.roughnessMap = m.normalMap = null;
    const offset = profile.timber ? 2 : 0;
    Object.assign(m, nodes(textures[offset], textures[offset + 1], profile));
    if (roomAmbient) m.aoNode = orangeRoomAmbientNode();
    // r180 RenderObject hashes arbitrary object-valued properties as '{}'. The
    // borrowed standard material's default key does NOT hash these node hooks,
    // so plaster and timber otherwise alias one shader despite different nodes.
    // Cache the complete key once: stable across frames, no per-draw allocation.
    // Texture identities also prevent a rebuilt library from inheriting a cached
    // node-builder state whose literal texture bindings belonged to its disposer.
    const programKey = `${m.customProgramCacheKey()}|architecture-v2/${profile.key}/${textures[offset].uuid}/${textures[offset + 1].uuid}${roomAmbient ? '/room-ambient-v1' : ''}`;
    m.customProgramCacheKey = () => programKey;
    m.needsUpdate = true;
  }
  controller = {
    textures, materialCount: materials.length,
    runtimeBytes: Math.ceil(DIMENSIONS.reduce((total, [w, h]) => total + w * h * 4 * 4 / 3, 0)),
    dispose() {
      if (!active.has(library)) return;
      active.delete(library);
      disposed = true;
      for (let i = 0; i < materials.length; ++i) {
        const m = materials[i], before = saved[i];
        m.color.copy(before.color);
        m.map = before.map; m.normalMap = before.normalMap; m.roughnessMap = before.roughnessMap;
        for (const { key, descriptor } of before.nodes) {
          if (descriptor) Object.defineProperty(m, key, descriptor);
          else Reflect.deleteProperty(m, key);
        }
        m.needsUpdate = true;
      }
      for (const t of new Set(textures)) t.dispose();
      if (library.dispose === wrappedDispose) library.dispose = originalDispose;
    },
  };
  return controller;
}
