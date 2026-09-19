/**
 * Ground PBR canary: photo-texture upgrade candidate for the two dominant large
 * ground surfaces (asphalt road, pale concrete). ASSET lane only - this module
 * never touches the scene, the renderer, lights or geometry, and it creates
 * nothing per frame.
 *
 * Ownership contract (explicit, testable):
 *  - the caller loads the six maps once (see public/assets/ground-pbr-canary/)
 *    and hands the THREE.Texture objects to `buildGroundPbrCanaryMaterials` or
 *    applies them via `applyGroundPbrCanaryMaps` / `loadCanarySurfaceSet`;
 *  - the factory configures each map EXACTLY once (wrap, repeat, colorSpace,
 *    anisotropy) and returns material singletons plus one `dispose()`;
 *  - `dispose()` releases every texture and material it received/created, and a
 *    second call is a no-op, so teardown is idempotent;
 *  - repeat is the ONLY tiling multiplier. World tiling lives in geometry UVs
 *    (root `build/ground.ts`: UV_ASPHALT = 40.0 m/unit, UV_PAVING = 67.2 m/unit),
 *    so repeat = metresPerUvUnit / tilePhysicalMetres, set once, never on top of
 *    a rescaled UV. A photo tile must never be repeat-scaled AND uv-scaled.
 *  - no displacement map and no extra draw geometry: same vertex streams as the
 *    procedural ground, one draw call per surface family as before.
 *  - `loadCanarySurfaceSet` lifecycle guarantees:
 *      * immediate cancellation and disposal on dispose token or cancel() call;
 *      * no retention of incomplete textures across failures or cancellation;
 *      * late arrivals after cancellation or partial failure are disposed immediately;
 *      * no double-disposal of previously loaded maps;
 *      * repeated dispose / cancel calls are safe no-ops.
 *
 * Sources: ambientCG Asphalt030 (2.2 m tile) and Concrete046 (2.4 m tile), CC0;
 * provenance, hashes and budgets in public/assets/ground-pbr-canary/provenance.json.
 */
import * as THREE from 'three';

export function resolveAssetUrl(path: string): string {
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

/** One complete PBR set for a single surface family. */
export interface GroundPbrCanaryMaps {
  /** Albedo photo, sRGB. */
  map: THREE.Texture;
  /** OpenGL-tangent normal map, linear. */
  normalMap: THREE.Texture;
  /** Roughness map, linear; multiplies material.roughness (kept at 1). */
  roughnessMap: THREE.Texture;
}

export interface GroundPbrCanarySurfaceSpec {
  maps: GroundPbrCanaryMaps;
  /** Metres of world per one UV unit (root ground.ts convention). */
  uvMetresPerUnit: number;
  /** Native real-world width/height of one texture tile, metres (provenance). */
  tilePhysicalMetres: number;
  /** Base roughness multiplier under the map (root ground family uses 1). */
  roughness?: number;
  /** Tangent-space normal strength (root family: asphalt 0.6, concrete 0.4). */
  normalScale?: number;
  anisotropy?: number;
  /**
   * Optional sRGB hex multiplied onto material.color (material.color * photo).
   * Calibrates the photo's absolute level without touching the authored maps:
   * Asphalt030's mean is a light mid-grey, so a white multiplier renders
   * near-white/blue concrete under hard sun (ground-canary-turningHead.png),
   * losing the believable dark-asphalt vs pale-paving contrast of the baseline.
   * Undefined = leave material.color untouched (existing callers/guards intact).
   */
  albedoTint?: number;
}

export interface GroundPbrCanarySet {
  asphalt: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  /** Disposes all six maps and both materials; idempotent. */
  dispose(): void;
}

export interface CanarySurfaceUrls {
  diffuse: string;
  roughness: string;
  normal: string;
}

export interface CanaryTextureLoaderLike {
  load(
    url: string,
    onLoad: (texture: THREE.Texture) => void,
    onProgress?: (event: unknown) => void,
    onError?: (err: unknown) => void,
  ): void;
}

export interface CanarySurfaceLoaderOptions {
  urls: CanarySurfaceUrls;
  onReady: (maps: GroundPbrCanaryMaps) => void;
  onError?: (err?: unknown) => void;
  isDisposed?: () => boolean;
  textureLoader?: CanaryTextureLoaderLike;
}

export interface CanarySurfaceLoaderHandle {
  /** Abandon the set: dispose completed maps, late-dispose late arrivals. Does
  NOT abort in-flight Image requests — see loadCanarySurfaceSet. Idempotent. */
  cancel: () => void;
}

export function configureOnce(t: THREE.Texture, repeat: number, srgb: boolean, anisotropy: number): void {
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
}

function buildSurface(spec: GroundPbrCanarySurfaceSpec, anisotropy: number): THREE.MeshStandardMaterial {
  const repeat = spec.uvMetresPerUnit / spec.tilePhysicalMetres;
  configureOnce(spec.maps.map, repeat, true, anisotropy);
  configureOnce(spec.maps.normalMap, repeat, false, anisotropy);
  configureOnce(spec.maps.roughnessMap, repeat, false, anisotropy);
  const mat = new THREE.MeshStandardMaterial({
    map: spec.maps.map,
    normalMap: spec.maps.normalMap,
    normalScale: new THREE.Vector2(spec.normalScale ?? 0.5, spec.normalScale ?? 0.5),
    roughness: spec.roughness ?? 1,
    roughnessMap: spec.maps.roughnessMap,
    metalness: 0,
  });
  if (spec.albedoTint !== undefined) mat.color.setHex(spec.albedoTint);
  return mat;
}

/**
 * Build the canary material set. Call once after the maps are loaded; the
 * returned set owns the passed textures.
 */
export function buildGroundPbrCanaryMaterials(
  asphaltSpec: GroundPbrCanarySurfaceSpec,
  concreteSpec: GroundPbrCanarySurfaceSpec,
): GroundPbrCanarySet {
  const anisotropy = asphaltSpec.anisotropy ?? 8;
  const asphalt = buildSurface(asphaltSpec, anisotropy);
  const concrete = buildSurface(concreteSpec, concreteSpec.anisotropy ?? anisotropy);
  let disposed = false;
  const allMaps = [
    asphaltSpec.maps.map, asphaltSpec.maps.normalMap, asphaltSpec.maps.roughnessMap,
    concreteSpec.maps.map, concreteSpec.maps.normalMap, concreteSpec.maps.roughnessMap,
  ];
  return {
    asphalt,
    concrete,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const t of allMaps) {
        try { t.dispose(); } catch {}
      }
      asphalt.dispose();
      concrete.dispose();
    },
  };
}

/**
 * Swap an existing ground-family singleton onto the canary maps without
 * creating a new material (keeps the root one-program-per-surface discipline).
 */
export function applyGroundPbrCanaryMaps(
  material: THREE.MeshStandardMaterial,
  spec: GroundPbrCanarySurfaceSpec,
): void {
  const repeat = spec.uvMetresPerUnit / spec.tilePhysicalMetres;
  configureOnce(spec.maps.map, repeat, true, spec.anisotropy ?? 8);
  configureOnce(spec.maps.normalMap, repeat, false, spec.anisotropy ?? 8);
  configureOnce(spec.maps.roughnessMap, repeat, false, spec.anisotropy ?? 8);
  material.map = spec.maps.map;
  material.normalMap = spec.maps.normalMap;
  material.roughnessMap = spec.maps.roughnessMap;
  material.roughness = spec.roughness ?? 1;
  material.metalness = 0;
  material.normalScale.set(spec.normalScale ?? 0.5, spec.normalScale ?? 0.5);
  if (spec.albedoTint !== undefined) material.color.setHex(spec.albedoTint);
  material.needsUpdate = true;
}

/**
 * First-round art calibration (2026-09-19, paired WebGPU views rejected the
 * white-multiplier asphalt as near-white/blue concrete).
 * Asphalt030 is a light mid-grey photo; multiplying by ~0.56 sRGB restores the
 * dark-asphalt vs pale-paving contrast of the procedural baseline while keeping
 * every authored map, repeat (40/2.2 = 18.18) and normalScale (0.6) intact.
 * This is a gain, not the palette target: PAL.asphalt (0x4a4a4d) * photo would
 * double-darken toward black. Concrete046 is already pale; white preserves it
 * (the root caller additionally tints concrete with PAL.concrete — kept as-is).
 * Roughness stays 1 x map; no exposure/lighting/UV change. Paired views decide
 * the final ±10%.
 */
export const GROUND_CANARY_ALBEDO_TINT = {
  asphalt: 0x8f8f93,
  concrete: 0xffffff,
} as const;

/** Root ground.ts UV scales, mirrored here as the canary's only tiling inputs. */
export const GROUND_CANARY_UV_M = {
  asphalt: 40.0,
  paving: 67.2,
} as const;

/** Native tile sizes recorded from the ambientCG v2 API (see provenance.json). */
export const GROUND_CANARY_TILE_M = {
  asphalt: 2.2,
  concrete: 2.4,
} as const;

/**
 * Asynchronous loader for a 3-channel canary surface set, with strict
 * What `cancel` does and does not do: it disposes every texture that has already
 * arrived via onLoad, marks the set abandoned, and disposes any texture that
 * arrives late (after cancel, after failure, or after `isDisposed` turns true)
 * immediately on arrival. It does NOT abort the underlying Image/HTTP request:
 * `THREE.TextureLoader.load` hands its return value (the placeholder texture)
 * to nothing here on purpose - ownership begins at onLoad, because only the
 * completed texture is a GPU resource this module can release. A cancelled load
 * therefore still fires onLoad later; that arrival is simply disposed instead of
 * delivered, and `onReady` never fires. Never describe this as request
 * cancellation - it is prompt disposal of completed maps plus abandonment.
 */
export function loadCanarySurfaceSet(
  options: CanarySurfaceLoaderOptions,
): CanarySurfaceLoaderHandle {
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
        fail(new Error('Incomplete canary surface set'));
        return;
      }
      finished = true;
      loadedMap.clear();
      onReady({ map, roughnessMap, normalMap });
    }
  };

  loader.load(resolveAssetUrl(urls.diffuse), (t) => finish('map', t), undefined, (err) => fail(err));
  loader.load(resolveAssetUrl(urls.roughness), (t) => finish('roughnessMap', t), undefined, (err) => fail(err));
  loader.load(resolveAssetUrl(urls.normal), (t) => finish('normalMap', t), undefined, (err) => fail(err));

  return { cancel };
}
