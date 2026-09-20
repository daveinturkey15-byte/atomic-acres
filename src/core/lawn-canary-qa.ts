/**
 * lawn-canary-qa.ts — additive harness-only inspection surface for the lawn PBR canary.
 *
 * WHY IT EXISTS. The frozen gate `scripts/capture-lawn-canary.mjs` asserts
 * `renderer.info.memory.textures` gains exactly +3 in `?lawn=canary` mode, but the
 * product swaps the three maps onto the EXISTING lawn singleton in place
 * (`applyGroundPbrCanaryMaps`, one program, zero extra geometry — see
 * `src/core/materials.ts` lawn-canary block + `src/core/lawn-pbr-canary.ts`).
 * Paired run `captures/lawn-canary/lawn-paired-0205` measured 136 -> 136 with
 * pixel meanAbsDiff 4.86 / 2.91 / 0.29: the swap RENDERED while the counter did
 * not move (replacement, not addition). That gate is frozen and must not be
 * edited or weakened. This module gives the separate adoption script what the
 * current `window.__NT` surface cannot: the live bound maps, their exact URLs,
 * repeat/colorspace/wrap, and the material scalars — read off the real
 * singleton, never a copy, never a mock.
 *
 * CONTRACT. Asset lane only: no scene/camera/renderer/light/geometry touch, no
 * per-frame allocation, no aesthetic change. The game never reads this surface;
 * only the `lawn-adoption-0244` acceptance script does. Installed once from
 * `main.ts` right after `buildMaterials()`; a second call is a no-op, and a
 * headless import without `window` returns silently.
 */
import * as THREE from 'three';
import { isLawnCanaryEnabled } from './environment-flags';
import {
  LAWN_CANARY_URLS,
  LAWN_CANARY_UV_M,
  LAWN_CANARY_TILE_M,
  LAWN_CANARY_NORMAL_SCALE,
  LAWN_CANARY_ALBEDO_TINT,
} from './lawn-pbr-canary';

/** Expected canary repeat: the ONLY tiling multiplier (96 / 1.4 = 68.571...). */
export const LAWN_ADOPTION_EXPECTED_REPEAT = LAWN_CANARY_UV_M / LAWN_CANARY_TILE_M;

/** Baseline turf repeat (`src/core/turf-material.ts` REPEAT = 48: 2 m tile at UV_LAWN = 96). */
export const LAWN_BASELINE_REPEAT = 48;

export interface LawnMapDesc {
  present: boolean;
  uuid: string | null;
  isDataTexture: boolean;
  /** Trailing loader filename (`lawn-1k-*.jpg`), or null for DataTexture turf. */
  srcTail: string | null;
  hasLawnCanarySrc: boolean;
  width: number | null;
  height: number | null;
  colorSpace: string;
  repeat: [number, number] | null;
  wrap: [number, number] | null;
  anisotropy: number | null;
}

export interface LawnLiveDesc {
  flag: boolean;
  materialUuid: string | null;
  materialType: string | null;
  colorHex: string | null;
  roughness: number | null;
  metalness: number | null;
  normalScale: [number, number] | null;
  map: LawnMapDesc;
  roughnessMap: LawnMapDesc;
  normalMap: LawnMapDesc;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function tailOf(src: unknown): string | null {
  if (typeof src !== 'string' || src.length === 0) return null;
  const bare = src.split('?')[0];
  const parts = bare.split('/');
  return parts[parts.length - 1] || null;
}

function numField(host: Record<string, unknown>, key: string): number | null {
  if (!(key in host)) return null;
  const value = host[key];
  return typeof value === 'number' ? value : null;
}

function absentMap(): LawnMapDesc {
  return {
    present: false, uuid: null, isDataTexture: false, srcTail: null,
    hasLawnCanarySrc: false, width: null, height: null,
    colorSpace: '', repeat: null, wrap: null, anisotropy: null,
  };
}

function describeMap(input: unknown): LawnMapDesc {
  if (!isRecord(input)) return absentMap();
  const uuid = 'uuid' in input && typeof input.uuid === 'string' ? input.uuid : null;
  const isData = 'isDataTexture' in input && input.isDataTexture === true;
  let srcTail: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  if ('image' in input && isRecord(input.image)) {
    const image = input.image;
    if ('src' in image) srcTail = tailOf(image.src);
    if (srcTail === null && 'currentSrc' in image) srcTail = tailOf(image.currentSrc);
    width = numField(image, 'width');
    height = numField(image, 'height');
  }
  const colorSpace = 'colorSpace' in input && typeof input.colorSpace === 'string' ? input.colorSpace : '';
  let repeat: [number, number] | null = null;
  if ('repeat' in input && isRecord(input.repeat)) {
    const x = numField(input.repeat, 'x');
    const y = numField(input.repeat, 'y');
    if (x !== null && y !== null) repeat = [x, y];
  }
  const wrapS = 'wrapS' in input && typeof input.wrapS === 'number' ? input.wrapS : null;
  const wrapT = 'wrapT' in input && typeof input.wrapT === 'number' ? input.wrapT : null;
  return {
    present: true,
    uuid,
    isDataTexture: isData,
    srcTail,
    hasLawnCanarySrc: srcTail !== null && srcTail.startsWith('lawn-1k-'),
    width,
    height,
    colorSpace,
    repeat,
    wrap: wrapS !== null && wrapT !== null ? [wrapS, wrapT] : null,
    anisotropy: numField(input, 'anisotropy'),
  };
}

/** Read the live lawn singleton. Pure read; never mutates the material. */
export function describeLawnLive(lawn: THREE.Material): LawnLiveDesc {
  if (!isRecord(lawn)) {
    return {
      flag: isLawnCanaryEnabled(), materialUuid: null, materialType: null,
      colorHex: null, roughness: null, metalness: null, normalScale: null,
      map: absentMap(), roughnessMap: absentMap(), normalMap: absentMap(),
    };
  }
  const host = lawn;
  let colorHex: string | null = null;
  if ('color' in host && isRecord(host.color) && 'getHexString' in host.color) {
    const getHex = host.color.getHexString;
    if (typeof getHex === 'function') {
      try {
        const out = (getHex as () => unknown).call(host.color);
        if (typeof out === 'string') colorHex = out;
      } catch { colorHex = null; }
    }
  }
  let normalScale: [number, number] | null = null;
  if ('normalScale' in host && isRecord(host.normalScale)) {
    const x = numField(host.normalScale, 'x');
    const y = numField(host.normalScale, 'y');
    if (x !== null && y !== null) normalScale = [x, y];
  }
  return {
    flag: isLawnCanaryEnabled(),
    materialUuid: 'uuid' in host && typeof host.uuid === 'string' ? host.uuid : null,
    materialType: 'type' in host && typeof host.type === 'string' ? host.type : null,
    colorHex,
    roughness: numField(host, 'roughness'),
    metalness: numField(host, 'metalness'),
    normalScale,
    map: 'map' in host ? describeMap(host.map) : absentMap(),
    roughnessMap: 'roughnessMap' in host ? describeMap(host.roughnessMap) : absentMap(),
    normalMap: 'normalMap' in host ? describeMap(host.normalMap) : absentMap(),
  };
}

export interface LawnQaSurface {
  ready: true;
  expected: () => {
    urls: typeof LAWN_CANARY_URLS;
    repeat: number;
    baselineRepeat: number;
    normalScale: number;
    roughness: number;
    metalness: number;
    albedoTintHex: string;
  };
  live: () => LawnLiveDesc;
}

/**
 * Publish `window.__NTLAWN`. Additive only: one window field, no product state.
 * Pass the SAME `mat.lawn` singleton `buildMaterials()` returned — identity is
 * the point, so never a clone.
 */
export function installLawnCanaryQA(lawn: THREE.Material): void {
  try {
    if (typeof window === 'undefined') return;
    if (!isRecord(window)) return;
    if ('__NTLAWN' in window && window.__NTLAWN !== undefined) return;
    const target = lawn;
    const surface: LawnQaSurface = {
      ready: true,
      expected: () => ({
        urls: { ...LAWN_CANARY_URLS },
        repeat: LAWN_ADOPTION_EXPECTED_REPEAT,
        baselineRepeat: LAWN_BASELINE_REPEAT,
        normalScale: LAWN_CANARY_NORMAL_SCALE,
        roughness: 1.0,
        metalness: 0,
        albedoTintHex: LAWN_CANARY_ALBEDO_TINT.toString(16).padStart(6, '0'),
      }),
      live: () => describeLawnLive(target),
    };
    (window as unknown as Record<string, unknown>).__NTLAWN = surface;
  } catch { /* harness-only; never break the game */ }
}
