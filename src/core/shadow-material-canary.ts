/** r180 shadow CPU canary. The shared shadow override's alphaTest setter bumps
 * its version whenever opaque/cutout casters alternate. Keep a single cutout
 * sibling per light's override; let Three perform the entire normal draw.
 * No shader, pass, quality or animation changes. Opt-in and conservatively fenced. */
import * as THREE from 'three';
import { NodeMaterial } from 'three/webgpu';
import type { WorldRenderer } from './renderer';

type ShadowMaterial = NodeMaterial & { isShadowPassMaterial?: boolean };
type RenderArgs = Parameters<WorldRenderer['renderObject']>;
type Entry = { base: ShadowMaterial; variant: ShadowMaterial; version: number;
  values: unknown[]; release: () => void };
export const SHADOW_MATERIAL_VARIANT_CAP = 8;
export interface ShadowMaterialCanary {
  readonly installed: boolean;
  readonly reason: string;
  counts(): { variants: number; routed: number; bypassed: Record<string, number> };
  dispose(): void;
}
const active = new WeakMap<WorldRenderer, ShadowMaterialCanary>();
const CUSTOM_SHADOW_KEYS = ['positionNode', 'depthNode', 'castShadowNode', 'castShadowPositionNode'];
// These are copied by NodeMaterial.copy/Material.copy, except fog/lights, which
// are explicit below. Per-caster alphaTest/alphaMap/side/transparent are always
// written by the original renderObject. Referenced node/uniform values stay live.
const BASE_KEYS = [
  'colorNode', 'depthNode', 'positionNode', 'mrtNode', 'outputNode', 'fragmentNode', 'vertexNode',
  'lightsNode', 'envNode', 'normalNode', 'opacityNode', 'backdropNode', 'backdropAlphaNode',
  'alphaTestNode', 'maskNode', 'geometryNode', 'receivedShadowPositionNode', 'castShadowPositionNode',
  'receivedShadowNode', 'castShadowNode', 'fog', 'lights', 'depthFunc', 'depthTest', 'depthWrite',
  'colorWrite', 'blending', 'blendSrc', 'blendDst', 'blendEquation', 'blendSrcAlpha', 'blendDstAlpha',
  'blendEquationAlpha', 'blendAlpha', 'stencilWrite', 'stencilWriteMask', 'stencilFunc', 'stencilRef',
  'stencilFuncMask', 'stencilFail', 'stencilZFail', 'stencilZPass', 'polygonOffset',
  'polygonOffsetFactor', 'polygonOffsetUnits', 'dithering', 'alphaHash', 'alphaToCoverage',
  'premultipliedAlpha', 'forceSinglePass', 'toneMapped', 'vertexColors', 'opacity', 'precision',
] as const;

export function installShadowMaterialCanary(renderer: WorldRenderer,
  search = globalThis.location?.search ?? ''): ShadowMaterialCanary {
  const previous = active.get(renderer); if (previous) return previous;
  const enabled = new URLSearchParams(search).get('shadow-material') === 'canary';
  const supported = THREE.REVISION === '180' && typeof renderer.renderObject === 'function';
  let disposed = false, routed = 0;
  const bypassed: Record<string, number> = {};
  const entries = new Set<Entry>(), owned = new WeakSet<ShadowMaterial>();
  let byBase = new WeakMap<ShadowMaterial, Entry>();
  const original = renderer.renderObject, descriptor = Object.getOwnPropertyDescriptor(renderer, 'renderObject');
  const handle: ShadowMaterialCanary = {
    installed: enabled && supported,
    reason: !enabled ? 'disabled' : supported ? 'r180 instance renderObject delegation' : 'unsupported revision/API',
    counts: () => ({ variants: entries.size, routed, bypassed: { ...bypassed } }),
    dispose() {
      if (disposed) return; disposed = true;
      if (renderer.renderObject === wrapped) {
        if (descriptor) Object.defineProperty(renderer, 'renderObject', descriptor);
        else Reflect.deleteProperty(renderer, 'renderObject');
      }
      for (const entry of [...entries]) entry.release();
      byBase = new WeakMap(); active.delete(renderer);
    },
  };
  function bypass(reason: string) { bypassed[reason] = (bypassed[reason] ?? 0) + 1; }
  function sync(entry: Entry, threshold: number) {
    const base = entry.base as unknown as Record<string, unknown>;
    let changed = entry.version !== entry.base.version;
    for (let i = 0; i < BASE_KEYS.length; i++) if (entry.values[i] !== base[BASE_KEYS[i]]) changed = true;
    if (!changed) return;
    entry.variant.copy(entry.base);
    entry.variant.fog = entry.base.fog; entry.variant.lights = entry.base.lights;
    entry.variant.isShadowPassMaterial = true; entry.variant.alphaTest = threshold;
    entry.variant.needsUpdate = true;
    entry.version = entry.base.version;
    for (let i = 0; i < BASE_KEYS.length; i++) entry.values[i] = base[BASE_KEYS[i]];
  }
  function wrapped(this: WorldRenderer, ...args: RenderArgs): void {
    const [object, scene, , , material] = args;
    const base = scene.overrideMaterial as ShadowMaterial | null;
    if (disposed || this !== renderer || (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend !== true || !base?.isShadowPassMaterial
      || owned.has(base) || material.allowOverride !== true) return original.apply(this, args);
    if (!(material.alphaTest > 0)) return original.apply(this, args);
    // The native callback runs after our selection. Custom hooks may change the
    // threshold or observe material identity, so leave their entire path native.
    if (object.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender
      || object.onAfterRender !== THREE.Object3D.prototype.onAfterRender) {
      bypass('custom-object-hook'); return original.apply(this, args);
    }
    if (Object.getPrototypeOf(base) !== NodeMaterial.prototype || base.customProgramCacheKey !== NodeMaterial.prototype.customProgramCacheKey
      || base.alphaHash || base.alphaToCoverage || base.clippingPlanes !== null
      || material.alphaHash || material.alphaToCoverage || material.clippingPlanes !== null
      || material.transparent || ('transmission' in material && Number(material.transmission) > 0)) {
      bypass('special-material'); return original.apply(this, args);
    }
    // Custom per-caster node overrides keep Three's original shared material and
    // restoration behavior. Ordinary point-light depth nodes on base are copied.
    const source = material as unknown as Record<string, unknown>;
    for (const key of CUSTOM_SHADOW_KEYS) if (source[key]) {
      bypass('custom-shadow-node'); return original.apply(this, args);
    }
    let entry = byBase.get(base);
    if (!entry) {
      if (entries.size >= SHADOW_MATERIAL_VARIANT_CAP) { bypass('variant-cap'); return original.apply(this, args); }
      const variant = base.clone() as ShadowMaterial;
      entry = { base, variant, version: -1, values: [], release: () => {
        base.removeEventListener('dispose', entry!.release);
        entries.delete(entry!); byBase.delete(base); variant.dispose();
      } };
      byBase.set(base, entry); entries.add(entry); owned.add(variant);
      base.addEventListener('dispose', entry.release);
    }
    sync(entry, material.alphaTest);
    const variant = entry.variant;
    // Preserve mutable color components even when the Color object's identity is stable.
    variant.blendColor.copy(base.blendColor);
    scene.overrideMaterial = variant; routed++;
    try { return original.apply(this, args); }
    finally { scene.overrideMaterial = base; }
  }
  if (handle.installed) { renderer.renderObject = wrapped; active.set(renderer, handle); }
  return handle;
}
