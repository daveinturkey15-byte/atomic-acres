/** Small, owned material family for authored interiors. All distances are metres.
 * Photo maps: Poly Haven CC0, exact originals/hashes in docs/assets/orange-room-surface-provenance.json.
 * Textile weave is original deterministic code. No image is claimed as a 3D asset.
 */
import * as THREE from 'three';
import { MeshPhysicalNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';

export interface InteriorMaterials {
  leather: THREE.Material;
  walnut: THREE.Material;
  carpet: THREE.Material;
  linen: THREE.Material;
  plaster: THREE.Material;
  brass: THREE.Material;
  seam: THREE.Material;
  readonly status: { loaded: number; expected: number; errors: string[] };
  dispose(): void;
}

export function createInteriorMaterials(): InteriorMaterials {
  const resources = new Set<{ dispose(): void }>();
  const own = <T extends { dispose(): void }>(v: T): T => { resources.add(v); return v; };
  const status = { loaded: 0, expected: 6, errors: [] as string[] };
  let disposed = false;
  const loader = new THREE.TextureLoader();
  const configure = (t: THREE.Texture, color = false): THREE.Texture => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = 4;
    t.needsUpdate = true;
    return own(t);
  };
  const photo = (asset: string, channel: string, fallback: string): THREE.Texture => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 2;
    const ctx = cv.getContext('2d')!; ctx.fillStyle = fallback; ctx.fillRect(0, 0, 2, 2);
    // The binding exists before compilation and its identity never changes on load.
    const t = configure(new THREE.Texture(cv), channel === 'diff');
    const url = `${import.meta.env.BASE_URL}textures/polyhaven/${asset}/${asset}_${channel}_1k.jpg`;
    loader.load(url, loaded => {
      if (!disposed) { t.image = loaded.image; t.needsUpdate = true; status.loaded++; }
      loaded.dispose();
    }, undefined, () => { if (!disposed) status.errors.push(url); });
    return t;
  };
  const set = (asset: string, base: string) => ({
    map: photo(asset, 'diff', base), normalMap: photo(asset, 'nor_gl', '#8080ff'),
    roughnessMap: photo(asset, 'rough', '#aaaaaa'),
  });
  const leather = own(new MeshPhysicalNodeMaterial({
    ...set('fabric_leather_02', '#9c6142'), roughness: 0.87, metalness: 0,
    normalScale: new THREE.Vector2(0.28, 0.28), clearcoat: 0.12,
    clearcoatRoughness: 0.66, envMapIntensity: 0.32,
  }));
  const walnut = own(new MeshStandardNodeMaterial({
    ...set('wood_table_001', '#6b452c'), roughness: 0.76, metalness: 0,
    normalScale: new THREE.Vector2(0.22, 0.22), envMapIntensity: 0.4,
  }));

  // 32 interlaced yarns per 8cm tile: two physical scales without huge normal bumps.
  const size = 256, height = new Float32Array(size * size);
  const color = new Uint8Array(size * size * 4), rough = new Uint8Array(color.length), normal = new Uint8Array(color.length);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x, k = i * 4;
    const warp = (Math.floor(x / 8) + Math.floor(y / 8)) % 2;
    const thread = Math.cos((warp ? y : x) * Math.PI / 4);
    const grain = (((x * 73 ^ y * 193) * 13) & 255) / 255;
    height[i] = 0.55 + thread * 0.13 + grain * 0.045;
    const tone = Math.round(203 + thread * 8 + grain * 15);
    color.set([tone, tone, tone, 255], k);
    const r = Math.round(225 + grain * 25); rough.set([r, r, r, 255], k);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const h = (u: number, v: number) => height[((v + size) % size) * size + (u + size) % size];
    const n = new THREE.Vector3((h(x - 1, y) - h(x + 1, y)) * 0.65,
      (h(x, y - 1) - h(x, y + 1)) * 0.65, 1).normalize();
    normal.set([Math.round(n.x * 127 + 128), Math.round(n.y * 127 + 128), Math.round(n.z * 127 + 128), 255], (y * size + x) * 4);
  }
  const tex = (data: Uint8Array, srgb = false) => configure(new THREE.DataTexture(data, size, size, THREE.RGBAFormat), srgb);
  const weave = { map: tex(color, true), normalMap: tex(normal), roughnessMap: tex(rough) };
  for (const t of Object.values(weave)) { t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; }
  const carpet = own(new MeshStandardNodeMaterial({ ...weave, color: 0x787c6c,
    roughness: 1, normalScale: new THREE.Vector2(0.4, 0.4), envMapIntensity: 0.2 }));
  const linen = own(new MeshPhysicalNodeMaterial({ ...weave, color: 0xc8bda5,
    roughness: 1, normalScale: new THREE.Vector2(0.24, 0.24), sheen: 0.5,
    sheenColor: new THREE.Color(0xaca086), sheenRoughness: 0.9, envMapIntensity: 0.2 }));
  const plaster = own(new MeshStandardNodeMaterial({ color: 0x69715c, roughness: 0.94, envMapIntensity: 0.2 }));
  const brass = own(new MeshStandardNodeMaterial({ color: 0x89744a, metalness: 0.76, roughness: 0.38, envMapIntensity: 0.6 }));
  const seam = own(new MeshStandardNodeMaterial({ color: 0x503623, roughness: 0.9, envMapIntensity: 0.2 }));
  return { leather, walnut, carpet, linen, plaster, brass, seam, status,
    dispose() { if (disposed) return; disposed = true; for (const r of resources) r.dispose(); resources.clear(); },
  };
}
