/**
 * CAR-BODY CANARY (?car-body=canary) - NEW helper, standalone by design.
 *
 * Candidate source: ROOT copies this file to src/build/car-body-canary.ts
 * (this lane never edits ROOT). Precedent is src/build/coach-owned-canary.ts,
 * but this helper does NOT touch the coach lane, the asset registry, or any
 * bus: it owns one GLB (the agy-0923 sedan) behind its own selector.
 *
 * Contract: opt-in only (?car-body=canary, exact, case-sensitive value).
 * Baseline (flag absent) never fetches. Preload resolves 'ready'/'fallback'
 * and never rejects; the visual is handed out exactly once; release is
 * idempotent. Colliders stay procedural (vehicles.ts reuses proc len/wid/hgt).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** The baked candidate. ROOT copies asset bytes, not this lane. */
const CANARY_URL_SEGMENT = 'assets/car-body-agy-0923.consolidated.glb';
const CANARY_URL_RAW = 'assets/car-body-agy-0923.glb';

export type CarBodyCanaryState = 'off' | 'loading' | 'ready' | 'fallback';
export type LoadCarBodyScene = (url: string) => Promise<THREE.Group>;

let state: CarBodyCanaryState = 'off';
let flight: Promise<CarBodyCanaryState> | null = null;
let taken = false;

interface OwnedInstance {
  root: THREE.Group;
  urls: string[];
}

/** The one owned instance. Null once released (or before the first load). */
let owned: OwnedInstance | null = null;

/** Vite `base` is relative, so this stays correct under Pages subpaths. */
function baseUrl(): string {
  try {
    const base: unknown = import.meta.env.BASE_URL;
    if (typeof base === 'string' && base.length > 0) return base;
  } catch {
    /* Non-vite unit context: relative default. */
  }
  return './';
}

/** Opt-in: ?car-body=canary only, or the QA override global. */
export function isCarBodyCanaryOptIn(): boolean {
  const g = globalThis as { __NT_OVERRIDE_CAR_BODY__?: boolean };
  if (typeof g.__NT_OVERRIDE_CAR_BODY__ === 'boolean') return g.__NT_OVERRIDE_CAR_BODY__;
  try {
    if (typeof window !== 'undefined' && window.location?.search) {
      return new URLSearchParams(window.location.search).get('car-body') === 'canary';
    }
  } catch {
    /* Non-browser unit context: baseline. */
  }
  return false;
}

export function carBodyCanaryState(): CarBodyCanaryState {
  return state;
}

export interface CarBodyCanaryReport {
  optIn: boolean;
  state: CarBodyCanaryState;
  mounted: boolean;
  taken: boolean;
  meshes: number;
  materials: number;
}

/** Read-only actual-adoption status. ROOT verifies REAL geometry, not fetch. */
export function carBodyCanaryReport(): CarBodyCanaryReport {
  let meshes = 0;
  const mats = new Set<string>();
  if (owned) {
    owned.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      meshes++;
      const list = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      for (const x of list) mats.add((x as THREE.Material).name || 'unnamed');
    });
  }
  return {
    optIn: isCarBodyCanaryOptIn(),
    state,
    mounted: owned !== null,
    taken,
    meshes,
    materials: mats.size,
  };
}

function defaultLoad(url: string): Promise<THREE.Group> {
  return new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene);
}

function disposeScene(scene: THREE.Object3D): void {
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const geos = [m.geometry].filter(Boolean);
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).filter(Boolean);
    for (const g of geos) (g as THREE.BufferGeometry).dispose();
    for (const x of mats) {
      const mat = x as THREE.Material;
      const rec = mat as unknown as Record<string, unknown>;
      for (const v of Object.values(rec)) {
        if (v && (v as THREE.Texture).isTexture) (v as THREE.Texture).dispose();
      }
      mat.dispose();
    }
  });
}

/** Load, adopt and own the canary visual. Never rejects. */
export function preloadCarBodyCanary(
  timeoutMs = 8000,
  load: LoadCarBodyScene = defaultLoad,
): Promise<CarBodyCanaryState> {
  if (!isCarBodyCanaryOptIn()) {
    state = 'off';
    return Promise.resolve(state);
  }
  if (flight) return flight;
  state = 'loading';
  const url = baseUrl() + CANARY_URL_SEGMENT;
  const rawUrl = baseUrl() + CANARY_URL_RAW;
  let settled = false;
  flight = new Promise<CarBodyCanaryState>((resolve) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      state = 'fallback';
      resolve(state);
    }, timeoutMs);

    const tryAdopt = (scene: THREE.Group, adoptedUrl: string) => {
      if (settled) {
        disposeScene(scene);
        return;
      }
      settled = true;
      clearTimeout(timer);
      scene.traverse((o) => {
        o.castShadow = true;
        o.receiveShadow = true;
      });
      owned = { root: scene, urls: [adoptedUrl] };
      taken = false;
      state = 'ready';
      resolve(state);
    };

    load(url)
      .then((scene) => tryAdopt(scene, url))
      .catch(() => {
        // Attempt raw GLB fallback if consolidated not yet produced
        load(rawUrl)
          .then((scene) => tryAdopt(scene, rawUrl))
          .catch(() => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            state = 'fallback';
            resolve(state);
          });
      });
  }).finally(() => {
    flight = null;
  });
  return flight;
}

/** The owned visual root, handed out exactly once. */
export function carBodyCanaryVisual(): THREE.Group | null {
  if (!owned || taken) return null;
  taken = true;
  owned.root.userData.carBodySource = 'canary';
  return owned.root;
}

/** Explicit disposal of the owned instance. Idempotent. */
export function releaseCarBodyCanary(): void {
  if (owned) {
    disposeScene(owned.root);
    owned = null;
  }
  taken = false;
  if (state === 'ready' || state === 'fallback') state = 'off';
}
