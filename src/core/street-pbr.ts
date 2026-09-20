/**
 * Street & Pavement PBR Surface Factory
 *
 * Authored CC0 photogrammetry PBR scan upgrade candidate for street asphalt
 * and adjoining pavement slabs. ASSET / MATERIAL lane only - touches no scene,
 * camera, lighting, colliders or geometry, and allocates zero per frame.
 *
 * Solves Visual Bar criteria S3 (Surface response) and S4 (Material variation):
 *  - Asphalt: Poly Haven 'asphalt_02' scan by Rob Tuytel (CC0).
 *    Features wide dim specular lobe in raking Nevada sunlight (roughness
 *    mean ~0.77, std ~17.0, range 0.29-1.00), authentic aggregate stones and
 *    bitumen wear tracks without paper-flat chalkiness or mirror reflections.
 *    Native physical tile size: 3.0 m.
 *  - Pavement: Poly Haven 'concrete_pavement_02' scan by Charlotte Baglioni (CC0).
 *    Features authentic sun-baked concrete slabs with honed face and recessed
 *    grit-rough joints (roughness mean ~0.78, std ~6.0, range 0.68-0.95).
 *    Native physical tile size: 1.8 m.
 *
 * UV and Tiling Contract (mirrors root build/ground.ts):
 *  - UV_ASPHALT = 40.0 m per UV unit -> repeat = 40.0 / 3.0 = 13.333333333333334
 *  - UV_PAVING = 67.2 m per UV unit -> repeat = 67.2 / 1.8 = 37.333333333333336
 *  - texture.repeat is the ONLY tiling multiplier; geometry UVs are untouched.
 *
 * Lifecycle & Ownership:
 *  - Async load with cancel handle and idempotent disposal.
 *  - Fallback safety: procedural canvas textures stay active if download fails.
 *  - Preserves wetStd wetness uniform hooks via wetRefresh callback.
 */

import * as THREE from 'three';

export function resolveStreetAssetUrl(path: string): string {
  const relative = path.replace(/^\/+/, '');
  if (typeof document !== 'undefined' && document.baseURI) {
    return new URL(relative, document.baseURI).toString();
  }
  const configuredBase = (globalThis as { __NT_ASSET_BASE__?: unknown }).__NT_ASSET_BASE__;
  if (typeof configuredBase === 'string' && configuredBase.length > 0) {
    const base = configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`;
    try {
      return new URL(relative, base).toString();
    } catch {
      return `${base}${relative}`;
    }
  }
  return relative;
}

/** Root ground.ts UV scales, mirrored here as the street PBR's only tiling inputs. */
export const STREET_PBR_UV_M = {
  asphalt: 40.0,
  paving: 67.2,
} as const;

/** Native tile sizes recorded from Poly Haven CC0 scans. */
export const STREET_PBR_TILE_M = {
  asphalt: 3.0,
  paving: 1.8,
} as const;

/** Derived texture repeat ratios: uvMetresPerUnit / tilePhysicalMetres. */
export const STREET_PBR_REPEAT = {
  asphalt: STREET_PBR_UV_M.asphalt / STREET_PBR_TILE_M.asphalt, // 13.333333333333334
  paving: STREET_PBR_UV_M.paving / STREET_PBR_TILE_M.paving,    // 37.333333333333336
} as const;

export const STREET_PBR_NORMAL_SCALE = {
  asphalt: 0.6,
  paving: 0.7,
} as const;

export const STREET_PBR_ROUGHNESS = {
  asphalt: 1.0,
  paving: 1.0,
} as const;

export const STREET_PBR_METALNESS = 0.0;

export const STREET_PBR_URLS = {
  asphalt: {
    diffuse: 'assets/street-pbr/asphalt_diff_1k.jpg',
    normal: 'assets/street-pbr/asphalt_nor_gl_1k.jpg',
    roughness: 'assets/street-pbr/asphalt_rough_1k.jpg',
  },
  paving: {
    diffuse: 'assets/street-pbr/pavement_diff_1k.jpg',
    normal: 'assets/street-pbr/pavement_nor_gl_1k.jpg',
    roughness: 'assets/street-pbr/pavement_rough_1k.jpg',
  },
} as const;

export interface StreetPbrMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

export interface StreetPbrSurfaceSpec {
  maps: StreetPbrMaps;
  uvMetresPerUnit: number;
  tilePhysicalMetres: number;
  normalScale?: number;
  roughness?: number;
  metalness?: number;
  anisotropy?: number;
  albedoTint?: number;
}

export interface StreetSurfaceUrls {
  diffuse: string;
  roughness: string;
  normal: string;
}

export interface StreetTextureLoaderLike {
  load(
    url: string,
    onLoad: (texture: THREE.Texture) => void,
    onProgress?: (event: unknown) => void,
    onError?: (err: unknown) => void,
  ): void;
}

export interface StreetSurfaceLoaderOptions {
  urls: StreetSurfaceUrls;
  onReady: (maps: StreetPbrMaps) => void;
  onError?: (err?: unknown) => void;
  isDisposed?: () => boolean;
  textureLoader?: StreetTextureLoaderLike;
}

export interface StreetSurfaceLoaderHandle {
  cancel: () => void;
}

export function configureTextureOnce(
  texture: THREE.Texture,
  repeat: number,
  srgb: boolean,
  anisotropy = 8,
): void {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
}

export function applyStreetSurfaceMaps(
  material: THREE.Material,
  spec: StreetPbrSurfaceSpec,
): void {
  const repeat = spec.uvMetresPerUnit / spec.tilePhysicalMetres;
  const anisotropy = spec.anisotropy ?? 8;
  configureTextureOnce(spec.maps.map, repeat, true, anisotropy);
  configureTextureOnce(spec.maps.normalMap, repeat, false, anisotropy);
  configureTextureOnce(spec.maps.roughnessMap, repeat, false, anisotropy);

  const mat = material as THREE.MeshStandardMaterial;
  mat.map = spec.maps.map;
  mat.normalMap = spec.maps.normalMap;
  mat.roughnessMap = spec.maps.roughnessMap;
  mat.roughness = spec.roughness ?? 1.0;
  mat.metalness = spec.metalness ?? 0.0;
  const ns = spec.normalScale ?? 0.6;
  mat.normalScale.set(ns, ns);
  if (spec.albedoTint !== undefined) {
    mat.color.setHex(spec.albedoTint);
  }
  mat.needsUpdate = true;
}

export function loadStreetSurfaceSet(
  options: StreetSurfaceLoaderOptions,
): StreetSurfaceLoaderHandle {
  const { urls, onReady, onError, isDisposed } = options;
  const loader = options.textureLoader ?? new THREE.TextureLoader();

  let cancelled = false;
  let finished = false;
  let remaining = 3;
  const loadedMap = new Map<'map' | 'roughnessMap' | 'normalMap', THREE.Texture>();

  const disposeAllLoaded = (): void => {
    for (const [, t] of loadedMap.entries()) {
      try { t.dispose(); } catch {}
    }
    loadedMap.clear();
  };

  const cancel = (): void => {
    if (cancelled || finished) return;
    cancelled = true;
    disposeAllLoaded();
  };

  const fail = (err?: unknown): void => {
    if (cancelled || finished) return;
    cancelled = true;
    disposeAllLoaded();
    onError?.(err);
  };

  const finish = (key: 'map' | 'roughnessMap' | 'normalMap', t: THREE.Texture): void => {
    if (cancelled || finished || isDisposed?.()) {
      cancelled = true;
      try { t.dispose(); } catch {}
      disposeAllLoaded();
      return;
    }

    if (loadedMap.has(key)) {
      try { loadedMap.get(key)!.dispose(); } catch {}
    }
    loadedMap.set(key, t);
    remaining--;

    if (remaining === 0) {
      if (isDisposed?.()) {
        cancelled = true;
        disposeAllLoaded();
        return;
      }
      const map = loadedMap.get('map');
      const roughnessMap = loadedMap.get('roughnessMap');
      const normalMap = loadedMap.get('normalMap');
      if (!map || !roughnessMap || !normalMap) {
        fail(new Error('Incomplete street surface set'));
        return;
      }
      finished = true;
      loadedMap.clear();
      onReady({ map, roughnessMap, normalMap });
    }
  };

  loader.load(resolveStreetAssetUrl(urls.diffuse), (t) => finish('map', t), undefined, (err) => fail(err));
  loader.load(resolveStreetAssetUrl(urls.roughness), (t) => finish('roughnessMap', t), undefined, (err) => fail(err));
  loader.load(resolveStreetAssetUrl(urls.normal), (t) => finish('normalMap', t), undefined, (err) => fail(err));

  return { cancel };
}

export interface UpgradeStreetPbrOptions {
  asphalt: THREE.Material;
  paving: THREE.Material;
  isDisposed?: () => boolean;
  onApplied?: (material: THREE.Material) => void;
  ownResource?: (resource: { dispose: () => void }) => void;
  textureLoader?: StreetTextureLoaderLike;
}

/**
 * Upgrade asphalt and paving materials with Poly Haven CC0 scans.
 * Preserves wetness uniform integration via onApplied hook.
 */
export function upgradeStreetPbr(options: UpgradeStreetPbrOptions): { cancel: () => void } {
  const { asphalt, paving, isDisposed, onApplied, ownResource, textureLoader } = options;
  const handles: StreetSurfaceLoaderHandle[] = [];

  // Asphalt upgrade
  const asphaltHandle = loadStreetSurfaceSet({
    urls: STREET_PBR_URLS.asphalt,
    textureLoader,
    isDisposed,
    onReady: (maps) => {
      if (isDisposed?.()) {
        maps.map.dispose();
        maps.roughnessMap.dispose();
        maps.normalMap.dispose();
        return;
      }
      ownResource?.(maps.map);
      ownResource?.(maps.roughnessMap);
      ownResource?.(maps.normalMap);
      applyStreetSurfaceMaps(asphalt, {
        maps,
        uvMetresPerUnit: STREET_PBR_UV_M.asphalt,
        tilePhysicalMetres: STREET_PBR_TILE_M.asphalt,
        normalScale: STREET_PBR_NORMAL_SCALE.asphalt,
        roughness: STREET_PBR_ROUGHNESS.asphalt,
        metalness: STREET_PBR_METALNESS,
      });
      onApplied?.(asphalt);
    },
    onError: () => {
      // Graceful fallback: leave procedural/previous maps active
    },
  });
  handles.push(asphaltHandle);

  // Pavement upgrade
  const pavingHandle = loadStreetSurfaceSet({
    urls: STREET_PBR_URLS.paving,
    textureLoader,
    isDisposed,
    onReady: (maps) => {
      if (isDisposed?.()) {
        maps.map.dispose();
        maps.roughnessMap.dispose();
        maps.normalMap.dispose();
        return;
      }
      ownResource?.(maps.map);
      ownResource?.(maps.roughnessMap);
      ownResource?.(maps.normalMap);
      applyStreetSurfaceMaps(paving, {
        maps,
        uvMetresPerUnit: STREET_PBR_UV_M.paving,
        tilePhysicalMetres: STREET_PBR_TILE_M.paving,
        normalScale: STREET_PBR_NORMAL_SCALE.paving,
        roughness: STREET_PBR_ROUGHNESS.paving,
        metalness: STREET_PBR_METALNESS,
      });
      onApplied?.(paving);
    },
    onError: () => {
      // Graceful fallback: leave procedural/previous maps active
    },
  });
  handles.push(pavingHandle);

  return {
    cancel: () => {
      for (const h of handles) h.cancel();
      handles.length = 0;
    },
  };
}
