/** Static geometry-derived directional ambient visibility. Not GI.
 * Two tiny Blender CPU-baked volumes; no new lights or runtime ray casts.
 * Install before the first material adaptation/render. Defaults off.
 */
import * as THREE from 'three';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import { float, normalWorldGeometry, positionWorld, smoothstep, texture3D, vec3 } from 'three/tsl';
import type { MaterialLibrary } from './materials';
import { ROOM_VISIBILITY_ARTIFACT as artifact } from './room-visibility-artifact';

export const ROOM_VOLUME = { ...artifact.bounds, dimensions: artifact.dimensions };
const FILES = ['positive.bin', 'negative.bin'] as const;
type Surface = THREE.MeshStandardMaterial & Pick<MeshStandardNodeMaterial, 'aoNode'>;
export interface RoomVisibility { textures: THREE.Data3DTexture[]; bytes: number; dispose(): void }
const active = new WeakMap<MaterialLibrary, Promise<RoomVisibility | null>>();
export function roomVisibilityEnabled(search = globalThis.location?.search ?? '') {
  const p = new URLSearchParams(search);
  return p.get('room') === 'authored' && p.get('room-light') === 'baked';
}

function visibilityNode(textures: THREE.Data3DTexture[]) {
  const lo = vec3(...ROOM_VOLUME.min), hi = vec3(...ROOM_VOLUME.max);
  const n = normalWorldGeometry.normalize();
  // Offset toward the visible side prevents a wall texel reading its solid core.
  const p = positionWorld.add(n.mul(.14));
  const uvw = p.sub(lo).div(hi.sub(lo));
  const positive = texture3D(textures[0], uvw).rgb;
  const negative = texture3D(textures[1], uvw).rgb;
  const weight = n.abs();
  const visibility = positive.dot(n.max(0)).add(negative.dot(n.negate().max(0)))
    .div(weight.x.add(weight.y).add(weight.z).max(.0001));
  // Keep shared exterior/other-house materials exactly unchanged outside the
  // sampled volume; fade in over one voxel to avoid a hard material boundary.
  const edge = p.sub(lo).min(hi.sub(p));
  const inside = smoothstep(0, .23, edge.x).mul(smoothstep(0, .23, edge.y))
    .mul(smoothstep(0, .23, edge.z));
  return float(1).sub(float(1).sub(visibility).mul(inside));
}

export function installRoomVisibility(library: MaterialLibrary, enabled = roomVisibilityEnabled(),
  load?: (url: string) => Promise<ArrayBuffer>): Promise<RoomVisibility | null> {
  if (!enabled) return Promise.resolve(null);
  const existing = active.get(library); if (existing) return existing;
  const task = install(library, load); active.set(library, task); return task;
}

async function install(library: MaterialLibrary, load?: (url: string) => Promise<ArrayBuffer>) {
  let disposed = false, controller: RoomVisibility | undefined;
  const originalDispose = library.dispose;
  const wrapped = () => { disposed = true; controller?.dispose();
    if (library.dispose === wrapped) library.dispose = originalDispose;
    originalDispose.call(library); };
  library.dispose = wrapped;
  const textures: THREE.Data3DTexture[] = [];
  const fetchBinary = load ?? (async (url: string) => {
    const r = await fetch(url); if (!r.ok) throw Error(`Room visibility HTTP ${r.status}`); return r.arrayBuffer();
  });
  try {
    const data = await Promise.all(FILES.map(async name => {
      const bytes = await fetchBinary(`/assets/room-visibility/${name}`);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      if (hash !== artifact.files[name].sha256 || bytes.byteLength !== 86016) throw Error('Room visibility artifact mismatch');
      return new Uint8Array(bytes);
    }));
    if (disposed) { active.delete(library); return null; }
    for (const bytes of data) {
      const t = new THREE.Data3DTexture(bytes, ...ROOM_VOLUME.dimensions);
      t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
      t.minFilter = t.magFilter = THREE.LinearFilter; t.colorSpace = THREE.NoColorSpace;
      t.generateMipmaps = false; t.needsUpdate = true; textures.push(t);
    }
    const room = library.interior();
    const materials = [...new Set([
      library.stuccoCream, library.stuccoTerracotta, library.interiorWall,
      library.roofWhite, library.timber, library.timberDark, library.capsuleWhite,
      ...Object.values(room).filter((v): v is THREE.Material => (v as THREE.Material)?.isMaterial === true),
    ])] as Surface[];
    const saved = materials.map(m => ({ m, ao: Object.getOwnPropertyDescriptor(m, 'aoNode'), key: m.customProgramCacheKey }));
    const ao = visibilityNode(textures);
    for (const { m, key } of saved) {
      m.aoNode = m.aoNode ? float(m.aoNode).mul(ao) : ao;
      const stableKey = `${key.call(m)}|room-bvh-v1/${textures.map(t => t.uuid).join('/')}`;
      m.customProgramCacheKey = () => stableKey; m.needsUpdate = true;
    }
    controller = { textures, bytes: data.reduce((s, v) => s + v.byteLength, 0), dispose() {
      if (disposed && !active.has(library)) return;
      disposed = true; active.delete(library);
      for (const { m, ao: before, key } of saved) {
        if (before) Object.defineProperty(m, 'aoNode', before); else Reflect.deleteProperty(m, 'aoNode');
        m.customProgramCacheKey = key; m.needsUpdate = true;
      }
      textures.forEach(t => t.dispose());
      if (library.dispose === wrapped) library.dispose = originalDispose;
    } };
    return controller;
  } catch (error) {
    textures.forEach(t => t.dispose()); active.delete(library);
    if (library.dispose === wrapped) library.dispose = originalDispose;
    if (!disposed) console.warn('Baked room visibility unavailable; baseline retained', error);
    return null;
  }
}
