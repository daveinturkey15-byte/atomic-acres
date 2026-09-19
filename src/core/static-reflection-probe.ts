/**
 * Startup-only static environment capture for one opaque reflective material.
 *
 * This is deliberately an integration seam, not a frame-loop feature. The
 * caller supplies the same four-output MRT node used by the scene post pass.
 * Every cube face therefore compiles against the existing output/normal/
 * metalness/roughness contract instead of poisoning r180's material cache with
 * a single-output render.
 *
 * The CubeRenderTarget import is private to the pinned r180 package. It is kept
 * here, rather than pretending that the public `three/webgpu` surface exports
 * this constructor, because that coupling is an explicit canary limitation.
 */
import * as THREE from 'three';
import type MRTNode from 'three/src/nodes/core/MRTNode.js';
import CubeRenderTarget from 'three/src/renderers/common/CubeRenderTarget.js';
import { CubeCamera } from 'three/src/cameras/CubeCamera.js';
import type { WorldRenderer } from './renderer';

const MRT_ATTACHMENT_NAMES = ['output', 'normal', 'metalness', 'roughness'] as const;
const DEFAULT_SIZE = 128;
const MAX_SIZE = 256;
const MAX_TARGET_BYTES = 20 * 1024 * 1024;

type ReflectionMaterial = THREE.Material & {
  envMap?: THREE.Texture | null;
  envMapIntensity?: number;
  needsUpdate: boolean;
};

export interface StaticReflectionProbeOptions {
  renderer: WorldRenderer;
  scene: THREE.Scene;
  /** The selected opaque windowDark material. It is bound after capture. */
  material: ReflectionMaterial;
  /**
   * The MRT tuple used by the scene pass. If omitted, the current renderer MRT
   * is used. Capture is blocked when it is absent or missing any attachment.
   */
  mrt?: MRTNode | null;
  /** Position of the street probe. An Object3D uses its world position. */
  anchor: THREE.Object3D | THREE.Vector3;
  /**
   * Only these reflective meshes may be hidden during the six-face capture.
   * Lights are rejected; no light is ever hidden or changed by this module.
   */
  reflectiveMeshes?: readonly THREE.Object3D[];
  size?: number;
  near?: number;
  far?: number;
}

export type StaticReflectionProbeStatus = 'captured' | 'blocked' | 'already-captured';

export interface StaticReflectionCaptureResult {
  status: StaticReflectionProbeStatus;
  backend: 'webgpu' | 'webgl2' | 'unknown';
  reason?: string;
  size: number;
  cubeFaces: 6;
  extraDrawsPerFrame: 0;
  extraAllocationsPerFrame: 0;
  estimatedTargetBytes: number;
  mrtAttachments: readonly string[];
}

export interface StaticReflectionProbe {
  readonly target: CubeRenderTarget;
  readonly texture: THREE.CubeTexture;
  readonly size: number;
  readonly estimatedTargetBytes: number;
  capture(): Promise<StaticReflectionCaptureResult>;
  dispose(): void;
}

interface SavedRendererState {
  target: ReturnType<WorldRenderer['getRenderTarget']>;
  cubeFace: number;
  mipLevel: number;
  mrt: ReturnType<WorldRenderer['getMRT']>;
  autoClear: boolean;
  xrEnabled: boolean;
  viewport: THREE.Vector4;
  scissor: THREE.Vector4;
  scissorTest: boolean;
}

function backendKind(renderer: WorldRenderer): 'webgpu' | 'webgl2' | 'unknown' {
  const backend = renderer.backend as unknown as { isWebGPUBackend?: boolean };
  if (backend.isWebGPUBackend === true) return 'webgpu';
  if (backend.isWebGPUBackend === false) return 'webgl2';
  return 'unknown';
}

function targetBytes(size: number): number {
  // Four RGBA16F cube attachments plus a conservative six-face 32-bit depth
  // allowance. Mipmaps are disabled, so this is a bounded allocation estimate.
  const pixels = size * size * 6;
  return pixels * (4 * 4 * 2 + 4);
}

function normaliseSize(size: number | undefined): number {
  const requested = size ?? DEFAULT_SIZE;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new RangeError(`static reflection size must be a positive integer, got ${requested}`);
  }
  if (requested > MAX_SIZE) {
    throw new RangeError(`static reflection size ${requested} exceeds the ${MAX_SIZE}px canary cap`);
  }
  const bytes = targetBytes(requested);
  if (bytes > MAX_TARGET_BYTES) {
    throw new RangeError(`static reflection target estimate ${bytes} exceeds the 20 MiB cap`);
  }
  return requested;
}

function makeTarget(size: number): CubeRenderTarget {
  const target = new CubeRenderTarget(size, {
    count: MRT_ATTACHMENT_NAMES.length,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: true,
    generateMipmaps: false,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  // CubeRenderTarget replaces only textures[0] with a CubeTexture. Clone that
  // cube for the other three MRT attachments so every attachment has six array
  // layers. A 2D texture in textures[1..3] would make activeCubeFace > 0 an
  // invalid WebGPU view, even though the target superficially has count=4.
  const output = target.texture as THREE.CubeTexture;
  for (let i = 0; i < MRT_ATTACHMENT_NAMES.length; i++) {
    const texture = (i === 0 ? output : output.clone()) as THREE.CubeTexture;
    texture.name = MRT_ATTACHMENT_NAMES[i];
    texture.isRenderTargetTexture = true;
    texture.renderTarget = target;
    texture.colorSpace = i === 0 ? THREE.LinearSRGBColorSpace : THREE.NoColorSpace;
    target.textures[i] = texture;
  }
  return target;
}

function hasMrtContract(mrt: MRTNode | null): mrt is MRTNode {
  return mrt !== null && MRT_ATTACHMENT_NAMES.every((name) => mrt.has(name));
}

function worldPosition(anchor: THREE.Object3D | THREE.Vector3): THREE.Vector3 {
  if (anchor instanceof THREE.Vector3) return anchor.clone();
  const position = new THREE.Vector3();
  anchor.getWorldPosition(position);
  return position;
}

function isLight(object: THREE.Object3D): boolean {
  return (object as THREE.Object3D & { isLight?: boolean }).isLight === true;
}

function saveRendererState(renderer: WorldRenderer): SavedRendererState {
  return {
    target: renderer.getRenderTarget(),
    cubeFace: renderer.getActiveCubeFace(),
    mipLevel: renderer.getActiveMipmapLevel(),
    mrt: renderer.getMRT(),
    autoClear: renderer.autoClear,
    xrEnabled: renderer.xr.enabled,
    viewport: renderer.getViewport(new THREE.Vector4()).clone(),
    scissor: renderer.getScissor(new THREE.Vector4()).clone(),
    scissorTest: renderer.getScissorTest(),
  };
}

function restoreRendererState(renderer: WorldRenderer, state: SavedRendererState): void {
  renderer.setRenderTarget(state.target, state.cubeFace, state.mipLevel);
  renderer.setMRT(state.mrt);
  renderer.autoClear = state.autoClear;
  renderer.xr.enabled = state.xrEnabled;
  renderer.setViewport(state.viewport);
  renderer.setScissor(state.scissor);
  renderer.setScissorTest(state.scissorTest);
}

export function createStaticReflectionProbe(options: StaticReflectionProbeOptions): StaticReflectionProbe {
  const size = normaliseSize(options.size);
  const target = makeTarget(size);
  const texture = target.texture as THREE.CubeTexture;
  const camera = new CubeCamera(options.near ?? 0.1, options.far ?? 90, target);
  const hidden = [...(options.reflectiveMeshes ?? [])];
  const invalidHidden = hidden.find(isLight);
  if (invalidHidden) {
    target.dispose();
    throw new Error(`static reflection probe refuses to hide light ${invalidHidden.name || invalidHidden.type}`);
  }

  let disposed = false;
  let captureAttempted = false;
  let captureResult: StaticReflectionCaptureResult | undefined;
  let bound = false;
  let previousEnvMap: THREE.Texture | null | undefined;

  const blocked = (backend: 'webgpu' | 'webgl2' | 'unknown', reason: string): StaticReflectionCaptureResult => ({
    status: 'blocked', backend, reason, size, cubeFaces: 6,
    extraDrawsPerFrame: 0, extraAllocationsPerFrame: 0,
    estimatedTargetBytes: targetBytes(size), mrtAttachments: MRT_ATTACHMENT_NAMES,
  });

  const capture = async (): Promise<StaticReflectionCaptureResult> => {
    if (disposed) throw new Error('static reflection probe has been disposed');
    if (captureAttempted) {
      return captureResult ?? blocked(backendKind(options.renderer), 'capture already attempted without a result');
    }
    captureAttempted = true;

    const renderer = options.renderer;
    // r180 init() throws after initialization; use the public readiness guard.
    let backend: 'webgpu' | 'webgl2' | 'unknown' = 'unknown';
    try {
      if (!renderer.hasInitialized()) await renderer.init();
      backend = backendKind(renderer);
    } catch (error) {
      captureResult = blocked('unknown', error instanceof Error ? error.message : String(error));
      return captureResult;
    }
    if (backend !== 'webgpu') {
      captureResult = blocked(backend, 'requires the actual WebGPU backend; WebGL2 fallback is not admitted for this canary');
      return captureResult;
    }

    const activeMrt = options.mrt ?? renderer.getMRT();
    if (!hasMrtContract(activeMrt)) {
      captureResult = blocked(backend, 'requires the existing four-output MRT tuple named output/normal/metalness/roughness');
      return captureResult;
    }

    const state = saveRendererState(renderer);
    const visibility = hidden.map((object) => ({ object, visible: object.visible }));
    try {
      for (const item of visibility) item.object.visible = false;
      renderer.setMRT(activeMrt);
      camera.position.copy(worldPosition(options.anchor));
      camera.updateMatrixWorld();

      // CubeCamera.update() performs exactly six static scene renders. The MRT
      // stays installed for all six faces, and waitForGPU makes completion
      // observable before the texture is bound to windowDark.
      camera.update(renderer, options.scene);
      await renderer.waitForGPU();

      previousEnvMap = options.material.envMap;
      options.material.envMap = texture;
      options.material.needsUpdate = true;
      bound = true;
      captureResult = {
        status: 'captured', backend, size, cubeFaces: 6,
        extraDrawsPerFrame: 0, extraAllocationsPerFrame: 0,
        estimatedTargetBytes: targetBytes(size), mrtAttachments: MRT_ATTACHMENT_NAMES,
      };
      return captureResult;
    } catch (error) {
      captureResult = blocked(backend, error instanceof Error ? error.message : String(error));
      return captureResult;
    } finally {
      for (const item of visibility) item.object.visible = item.visible;
      restoreRendererState(renderer, state);
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (bound) {
      options.material.envMap = previousEnvMap ?? null;
      options.material.needsUpdate = true;
      bound = false;
    }
    target.dispose();
  };

  return {
    target, texture, size, estimatedTargetBytes: targetBytes(size), capture, dispose,
  };
}
