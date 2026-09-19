import * as THREE from 'three';

/**
 * Camera-local material singletons for the first-person rigs.
 *
 * The world material library deliberately targets metres of scenery. These maps
 * target the few centimetres to half a metre visible on a held weapon and hand,
 * so their texel scale is independent of the world surface repeats.
 */

type MaterialProfile = {
  name: string;
  base: readonly [number, number, number];
  repeat: number;
  roughness: number;
  roughnessVariation: number;
  metalness: number;
  envMapIntensity: number;
  normalScale: number;
  kind: 'cloth' | 'glove' | 'wood' | 'steel';
};

export interface ViewmodelMaterialStats {
  /** Four shared materials: one per authored surface family. */
  readonly materials: number;
  /** Three DataTextures per material: albedo, roughness, tangent normal. */
  readonly textures: number;
  readonly albedoSize: number;
  readonly detailSize: number;
  /** CPU-side RGBA bytes retained by DataTexture.image.data. */
  readonly cpuTextureBytes: number;
}

export interface ViewmodelMaterialSet {
  /** Olive canvas sleeve with a small woven breakup. */
  readonly sleeve: THREE.MeshStandardMaterial;
  /** Shared by the palm and the separate finger bundle. */
  readonly darkGlove: THREE.MeshStandardMaterial;
  /** Warm close-range wood with longitudinal grain and pores. */
  readonly woodFurniture: THREE.MeshStandardMaterial;
  /** Dark, slightly green parkerized steel rather than mirror chrome. */
  readonly parkerizedSteel: THREE.MeshStandardMaterial;
  /** Alias for the two hand sub-meshes; it is the same singleton. */
  readonly gloveDetail: THREE.MeshStandardMaterial;
  readonly stats: ViewmodelMaterialStats;
  /** Disposes all four materials and their twelve owned textures exactly once. */
  dispose(): void;
}

const ALBEDO_SIZE = 256;
const DETAIL_SIZE = 128;
const TAU = Math.PI * 2;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function byte(value: number): number {
  return Math.round(clamp01(value) * 255);
}

/** Small deterministic integer hash. It avoids Math.random and has no runtime state. */
function hash2(x: number, y: number, seed: number): number {
  let h = Math.imul(x ^ seed, 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ Math.imul(y, 0x27d4eb2d), 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy;
}

function octaveNoise(x: number, y: number, seed: number): number {
  return smoothNoise(x, y, seed) * 0.62
    + smoothNoise(x * 2.03, y * 2.03, seed + 17) * 0.25
    + smoothNoise(x * 4.11, y * 4.11, seed + 41) * 0.13;
}

function materialPixel(profile: MaterialProfile, u: number, v: number, x: number, y: number): {
  albedo: number;
  roughness: number;
  height: number;
} {
  const n = octaveNoise(u * 7, v * 7, profile.name.length * 101);
  const fine = octaveNoise(u * 28, v * 28, profile.name.length * 211 + 9);
  let albedo = 0;
  let roughness = profile.roughness;
  let height = 0.5;

  if (profile.kind === 'cloth') {
    const weaveX = 0.5 + 0.5 * Math.sin(u * TAU * 38);
    const weaveY = 0.5 + 0.5 * Math.sin(v * TAU * 38 + 0.8);
    albedo = 0.72 * n + 0.18 * fine + 0.10 * ((weaveX + weaveY) * 0.5);
    roughness += (n - 0.5) * profile.roughnessVariation + (weaveX * weaveY - 0.25) * 0.04;
    height = 0.48 + 0.12 * (weaveX * 0.58 + weaveY * 0.42) + (fine - 0.5) * 0.08;
  } else if (profile.kind === 'glove') {
    const pebble = octaveNoise(u * 18, v * 18, 907);
    const rib = 0.5 + 0.5 * Math.sin((u + v * 0.38) * TAU * 26);
    albedo = 0.62 * n + 0.26 * pebble + 0.12 * rib;
    roughness += (pebble - 0.5) * profile.roughnessVariation;
    height = 0.46 + (pebble - 0.5) * 0.22 + (rib - 0.5) * 0.07;
  } else if (profile.kind === 'wood') {
    const grainWarp = (octaveNoise(u * 2.3, v * 5.1, 1201) - 0.5) * 0.16;
    const grain = 0.5 + 0.5 * Math.sin((u + grainWarp) * TAU * 8.5 + v * 1.8);
    const pore = octaveNoise(u * 24, v * 3.2, 1307);
    albedo = 0.50 * n + 0.34 * grain + 0.16 * pore;
    roughness += (0.5 - grain) * profile.roughnessVariation + (pore - 0.5) * 0.04;
    height = 0.48 + (grain - 0.5) * 0.18 + (pore - 0.5) * 0.08;
  } else {
    const machining = 0.5 + 0.5 * Math.sin(v * TAU * 72 + n * 2.2);
    const peen = octaveNoise(u * 19, v * 19, 1601);
    albedo = 0.60 * n + 0.24 * peen + 0.16 * machining;
    roughness += (peen - 0.5) * profile.roughnessVariation + (machining - 0.5) * 0.035;
    height = 0.49 + (machining - 0.5) * 0.08 + (peen - 0.5) * 0.10;
  }

  // A tiny pixel-index dither keeps large low-frequency areas from quantising into
  // visible bands after ACES and sRGB conversion.
  albedo = clamp01(albedo + (hash2(x, y, 7331) - 0.5) * 0.018);
  return { albedo, roughness: clamp01(roughness), height: clamp01(height) };
}

function makeAlbedo(profile: MaterialProfile): THREE.DataTexture {
  const [r, g, b] = profile.base;
  const data = new Uint8Array(ALBEDO_SIZE * ALBEDO_SIZE * 4);
  for (let y = 0; y < ALBEDO_SIZE; y++) {
    for (let x = 0; x < ALBEDO_SIZE; x++) {
      const u = x / ALBEDO_SIZE;
      const v = y / ALBEDO_SIZE;
      const p = materialPixel(profile, u, v, x, y);
      const k = (y * ALBEDO_SIZE + x) * 4;
      const shade = 0.84 + p.albedo * 0.32;
      data[k] = byte(r * shade);
      data[k + 1] = byte(g * shade);
      data[k + 2] = byte(b * shade);
      data[k + 3] = 255;
    }
  }
  return configureTexture(new THREE.DataTexture(data, ALBEDO_SIZE, ALBEDO_SIZE, THREE.RGBAFormat), true, profile.repeat);
}

function makeDetailTextures(profile: MaterialProfile): {
  roughness: THREE.DataTexture;
  normal: THREE.DataTexture;
} {
  const count = DETAIL_SIZE * DETAIL_SIZE;
  const heights = new Float32Array(count);
  const roughness = new Uint8Array(count * 4);
  for (let y = 0; y < DETAIL_SIZE; y++) {
    for (let x = 0; x < DETAIL_SIZE; x++) {
      const u = x / DETAIL_SIZE;
      const v = y / DETAIL_SIZE;
      const p = materialPixel(profile, u, v, x, y);
      const i = y * DETAIL_SIZE + x;
      heights[i] = p.height;
      const k = i * 4;
      const r = byte(p.roughness);
      roughness[k] = r;
      roughness[k + 1] = r;
      roughness[k + 2] = r;
      roughness[k + 3] = 255;
    }
  }

  const normal = new Uint8Array(count * 4);
  const at = (x: number, y: number): number => heights[((y + DETAIL_SIZE) % DETAIL_SIZE) * DETAIL_SIZE + ((x + DETAIL_SIZE) % DETAIL_SIZE)];
  for (let y = 0; y < DETAIL_SIZE; y++) {
    for (let x = 0; x < DETAIL_SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * profile.normalScale;
      const dy = (at(x, y + 1) - at(x, y - 1)) * profile.normalScale;
      const nx = -dx;
      const ny = -dy;
      const nz = 1;
      const inv = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);
      const k = (y * DETAIL_SIZE + x) * 4;
      normal[k] = byte(nx * inv * 0.5 + 0.5);
      normal[k + 1] = byte(ny * inv * 0.5 + 0.5);
      normal[k + 2] = byte(nz * inv * 0.5 + 0.5);
      normal[k + 3] = 255;
    }
  }

  return {
    roughness: configureTexture(new THREE.DataTexture(roughness, DETAIL_SIZE, DETAIL_SIZE, THREE.RGBAFormat), false, profile.repeat),
    normal: configureTexture(new THREE.DataTexture(normal, DETAIL_SIZE, DETAIL_SIZE, THREE.RGBAFormat), false, profile.repeat),
  };
}

function configureTexture(texture: THREE.DataTexture, color: boolean, repeat: number): THREE.DataTexture {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeMaterial(profile: MaterialProfile, owned: THREE.Texture[]): THREE.MeshStandardMaterial {
  const map = makeAlbedo(profile);
  const detail = makeDetailTextures(profile);
  owned.push(map, detail.roughness, detail.normal);
  const material = new THREE.MeshStandardMaterial({
    name: `Viewmodel/${profile.name}`,
    map,
    roughness: 1,
    roughnessMap: detail.roughness,
    normalMap: detail.normal,
    normalScale: new THREE.Vector2(profile.normalScale, profile.normalScale),
    metalness: profile.metalness,
    envMapIntensity: profile.envMapIntensity,
  });
  material.needsUpdate = true;
  return material;
}

const PROFILES: Record<'sleeve' | 'glove' | 'wood' | 'steel', MaterialProfile> = {
  sleeve: {
    name: 'Sleeve', base: [0.22, 0.27, 0.18], repeat: 2.25,
    roughness: 0.86, roughnessVariation: 0.10, metalness: 0.01,
    envMapIntensity: 0.25, normalScale: 1.35, kind: 'cloth',
  },
  glove: {
    name: 'DarkGlove', base: [0.055, 0.050, 0.042], repeat: 3,
    roughness: 0.72, roughnessVariation: 0.15, metalness: 0.01,
    envMapIntensity: 0.20, normalScale: 1.65, kind: 'glove',
  },
  wood: {
    name: 'WoodFurniture', base: [0.30, 0.12, 0.045], repeat: 1,
    roughness: 0.54, roughnessVariation: 0.16, metalness: 0.02,
    envMapIntensity: 0.35, normalScale: 0.85, kind: 'wood',
  },
  steel: {
    name: 'ParkerizedSteel', base: [0.12, 0.15, 0.14], repeat: 2,
    roughness: 0.44, roughnessVariation: 0.11, metalness: 0.82,
    envMapIntensity: 0.70, normalScale: 0.55, kind: 'steel',
  },
};

/**
 * Build the four first-person material singletons once and share them across all
 * five weapon rigs. The returned dispose function owns every texture in the set;
 * callers must not dispose an individual material or texture separately.
 */
export function createViewmodelMaterials(): ViewmodelMaterialSet {
  const ownedTextures: THREE.Texture[] = [];
  const sleeve = makeMaterial(PROFILES.sleeve, ownedTextures);
  const darkGlove = makeMaterial(PROFILES.glove, ownedTextures);
  const woodFurniture = makeMaterial(PROFILES.wood, ownedTextures);
  const parkerizedSteel = makeMaterial(PROFILES.steel, ownedTextures);
  let disposed = false;

  return {
    sleeve,
    darkGlove,
    gloveDetail: darkGlove,
    woodFurniture,
    parkerizedSteel,
    stats: {
      materials: 4,
      textures: ownedTextures.length,
      albedoSize: ALBEDO_SIZE,
      detailSize: DETAIL_SIZE,
      cpuTextureBytes: (4 * ALBEDO_SIZE * ALBEDO_SIZE * 4)
        + (8 * DETAIL_SIZE * DETAIL_SIZE * 4),
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      sleeve.dispose();
      darkGlove.dispose();
      woodFurniture.dispose();
      parkerizedSteel.dispose();
      for (const texture of ownedTextures) texture.dispose();
    },
  };
}
