/**
 * Backend selection and renderer boot.
 *
 * One renderer class for every backend. THREE.WebGPURenderer tries WebGPU and
 * falls back to a WebGL2 backend internally when WebGPU is unavailable, so the
 * scene code never branches on backend: the same materials, sky and lights run
 * everywhere, and a machine without WebGPU still gets the full map.
 *
 * Selection:
 *   ?gl=webgl    force the WebGL2 backend (CI, Pages, debugging)
 *   ?gl=webgpu   attempt WebGPU (still falls back silently if it cannot init)
 *   (no param)   attempt WebGPU, silent fallback to WebGL2
 * A WebGPU device lost AFTER boot pins WebGL2 in sessionStorage and reloads,
 * so the next boot comes up on the fallback instead of a black page.
 */
import * as THREE from 'three';
import { WebGPURenderer } from 'three/webgpu';

export type BackendKind = 'webgpu' | 'webgl2';

/**
 * The renderer surface world.ts exposes. The node renderer's Info has no
 * `programs` field, but main.ts reads `info.programs?.length`, so it stays as
 * an optional member and the seam compiles without touching main.ts.
 */
export type WorldRenderer = WebGPURenderer & {
  info: WebGPURenderer['info'] & { programs?: { length: number } };
};

export interface RendererBoot {
  renderer: WorldRenderer;
  /** Backend asked for. `webgpu` means "try WebGPU, accept silent fallback". */
  requested: BackendKind;
  /** Resolves to the backend that actually came up. Rejects only if nothing can render. */
  ready: Promise<BackendKind>;
}

function forcedBackend(): BackendKind | null {
  try {
    const q = new URLSearchParams(window.location.search).get('gl');
    if (q === 'webgl' || q === 'webgl2') return 'webgl2';
    if (q === 'webgpu') return 'webgpu';
  } catch {
    /* no usable location (worker?) — fall through */
  }
  try {
    if (window.sessionStorage.getItem('nt_gl') === 'webgl2') return 'webgl2';
  } catch {
    /* storage blocked — ignore */
  }
  return null;
}

function actualBackend(renderer: WebGPURenderer): BackendKind {
  const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean };
  return backend.isWebGPUBackend === true ? 'webgpu' : 'webgl2';
}

export function bootRenderer(): RendererBoot {
  const requested: BackendKind = forcedBackend() ?? 'webgpu';
  const renderer = new WebGPURenderer({
    antialias: true,
    forceWebGL: requested === 'webgl2',
    powerPreference: 'high-performance',
    // Explicit floor, not a wish list: the sun shadow map is 4096, so require
    // at least that. Far below the WebGPU guaranteed minimum (8192), so this
    // can never fail spuriously — but a device that cannot meet it fails the
    // device request here and takes the silent WebGL2 fallback instead of
    // quietly losing features.
    requiredLimits: { maxTextureDimension2D: 4096 },
  }) as WorldRenderer;

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.09;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  type BackendReport = { requested: BackendKind; actual: BackendKind | null };
  const reportSlot = window as unknown as { __NT_BACKEND?: BackendReport };
  reportSlot.__NT_BACKEND = { requested, actual: null };
  renderer.domElement.dataset.ntBackendRequested = requested;

  let resolveReady!: (b: BackendKind) => void;
  let rejectReady!: (e: unknown) => void;
  const ready = new Promise<BackendKind>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  void renderer.init().then(
    () => {
      const actual = actualBackend(renderer);
      // Async device loss after a good boot: pin the fallback and reload once.
      // sessionStorage keeps the pin to this tab; a plain reload retries WebGPU.
      try {
        const device = renderer.backend as unknown as { device?: { lost?: Promise<unknown> } };
        void device.device?.lost?.then(() => {
          console.warn('[nuketown] GPU device lost; reloading pinned to WebGL2');
          try {
            window.sessionStorage.setItem('nt_gl', 'webgl2');
          } catch {
            /* storage blocked — reload still retries from scratch */
          }
          window.location.reload();
        });
      } catch {
        /* WebGL2 backend exposes no device — nothing to watch */
      }
      console.log(
        `[nuketown] renderer backend: ${actual} (requested ${requested})` +
          (actual === requested ? '' : ' — silent fallback engaged'),
      );
      renderer.domElement.dataset.ntBackend = actual;
      reportSlot.__NT_BACKEND = { requested, actual };
      resolveReady(actual);
    },
    (err: unknown) => {
      console.error('[nuketown] renderer init failed on every backend:', err);
      rejectReady(err);
    },
  );

  return { renderer, requested, ready };
}
