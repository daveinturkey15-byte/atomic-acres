/** Presence macro overlay — opt-in two-scale surface detail for broad exteriors.
 *
 * ROOT PATH when accepted: `src/core/architectural-presence-macro.ts` (copy verbatim;
 * imports are root-relative `./materials`, `three/tsl`, `three/webgpu`).
 * Private candidacy: `work/surface-presence-muse-1035/` in nuketown-materials.
 *
 * Problem (viewed 2026-09-20 `captures/art-live-1035/mountain-before/yardWhite.png`
 * + `yardOrange.png`): the accepted Astra scan gives superb 1 m micro grain, but at
 * gameplay distance (8–15 m) broad cream / terracotta / roof-white planes read flat
 * and plastic. `roofWhite` runs contrast 0.07 + normal 0.16, so roofs blow to uniform
 * white. Fine detail has no presence at range; the map looks toy-like.
 *
 * What this does: wraps the SAME installed base graph with a SECOND metric scale —
 * the same four licensed maps re-sampled at a 4 m macro tile through the same
 * world-space triplanar recipe — plus one coherent construction rhythm (2 m membrane
 * bay joints on the two roof whites only). Macro terms are small bounded deltas on
 * top of the accepted base output: albedo ×(1±1.5–3%), roughness ±0.035–0.05,
 * macro normal at ~0.2× each surface's own micro strength. Palette, silhouette,
 * topology, colliders, HUD, combat untouched. No grime stripes, no exposure retune.
 *
 * Why the macro reads as trowel/bay relief, not stain: provenance
 * (`public/assets/architecture-pbr/provenance.json`) records σ=24 px local
 * luminance normalization + normal high-pass on every derivation — broad captured
 * staining and bias were removed at pack time. The 4 m re-sample carries only
 * trowel-scale undulation. Worst-case stack (micro + macro + wear) stays inside
 * ±6% albedo on stucco, ±4% on roof whites. Bay joints are fract-free soft lines
 * on a 2 m world-x rhythm, −2.5% albedo / +0.04 roughness, no normal carve.
 *
 * Safety contract (mirrors `architectural-materials.ts`, never edits it):
 * - Default OFF. No flag → null, touches nothing. Requires the base canary first:
 *   all six materials must already carry node hooks, else throw (fail loud).
 * - Same atomic pre-first-render slot: after `await installArchitecturalMaterials`,
 *   before builders/first frame. Program keys are extended, never forked: the same
 *   6 pipelines, `|presence-macro-v1/<key>` over the base key (which already carries
 *   texture uuids). `interiorWall` keeps its base key — 7 distinct programs total.
 *   No program-set mutation after the first frame.
 * - Owns NOTHING: textures arrive borrowed from the base controller (`textures`:
 *   plaster-surface, plaster-normal, timber-surface, timber-normal in
 *   `ARCHITECTURE_TEXTURE_FILES` order). Dispose restores base nodes + base keys;
 *   texture disposal stays with the base controller.
 * - No per-frame allocation: all TSL nodes built once here; repeat calls share one
 *   pending/result controller. Zero new textures, materials, lights, draw calls.
 * - TSL surface is the already-accepted subset only (`texture`, `positionWorld`,
 *   `normalWorldGeometry`, `cameraViewMatrix`, `vec2/3/4`, scalar/vector arithmetic,
 *   `.sin/.abs/.pow/.max/.dot/.normalize`, swizzles `.r/.g/.rgb/.xyz`, `.toVar()`).
 */

import * as THREE from 'three';
import type { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  cameraViewMatrix,
  nodeObject,
  normalWorldGeometry,
  positionWorld,
  texture,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import type { MaterialLibrary } from './materials';

type Surface = THREE.MeshStandardMaterial & Pick<MeshStandardNodeMaterial,
  'colorNode' | 'roughnessNode' | 'normalNode'>;
type PresenceKey =
  | 'stuccoCream' | 'stuccoTerracotta' | 'capsuleWhite'
  | 'roofWhite' | 'timber' | 'timberDark';
type Library = Pick<MaterialLibrary, PresenceKey | 'dispose'>;

const KEYS: readonly PresenceKey[] = [
  'stuccoCream', 'stuccoTerracotta', 'capsuleWhite',
  'roofWhite', 'timber', 'timberDark',
];

/** Per-surface macro deltas. `interiorWall` is deliberately excluded: sealed
 * partitions gain nothing legible at 4 m, so they keep the exact base program. */
const MACRO: Record<PresenceKey, {
  albedo: number; rough: number; normal: number; bays: boolean; timber: boolean;
}> = {
  stuccoCream:      { albedo: 0.025, rough: 0.05,  normal: 0.22, bays: false, timber: false },
  stuccoTerracotta: { albedo: 0.025, rough: 0.05,  normal: 0.22, bays: false, timber: false },
  capsuleWhite:     { albedo: 0.018, rough: 0.04,  normal: 0.20, bays: true,  timber: false },
  roofWhite:        { albedo: 0.015, rough: 0.035, normal: 0.18, bays: true,  timber: false },
  timber:           { albedo: 0.03,  rough: 0.05,  normal: 0.15, bays: false, timber: true },
  timberDark:       { albedo: 0.03,  rough: 0.05,  normal: 0.15, bays: false, timber: true },
};

const active = new WeakMap<Library, Promise<PresenceController | null>>();

export interface PresenceController {
  readonly materialCount: number;
  /** Always zero: macro re-samples the base controller's four maps. */
  readonly addedTextures: 0;
  dispose(): void;
}

export function isPresenceEnabled(search = globalThis.location?.search ?? ''): boolean {
  return new URLSearchParams(search).get('presence') === 'macro';
}

/** Opt-in, atomic, pre-first-render. `textures` is the base controller's
 * `textures` array (never re-loaded, never re-owned). See header for contract. */
export function installArchitecturalPresence(
  library: Library,
  textures: readonly THREE.Texture[] | null | undefined,
  enabled = isPresenceEnabled(),
): Promise<PresenceController | null> {
  if (!enabled) return Promise.resolve(null);
  const existing = active.get(library);
  if (existing) return existing;
  const task = install(library, textures);
  active.set(library, task);
  return task;
}

async function install(
  library: Library,
  textures: readonly THREE.Texture[] | null | undefined,
): Promise<PresenceController | null> {
  const materials = KEYS.map((k) => library[k]);
  const hooked = materials.every(
    (m): m is Surface => m.isMeshStandardMaterial
      && !!m.colorNode && !!m.roughnessNode && !!m.normalNode
      && typeof m.customProgramCacheKey === 'function',
  );
  if (!hooked || new Set(materials).size !== materials.length) {
    active.delete(library);
    throw new Error(
      'Presence macro requires installArchitecturalMaterials() first: six hooked shared materials',
    );
  }
  if (!textures || textures.length !== 4) {
    active.delete(library);
    throw new Error('Presence macro requires the base controller textures (four shared maps)');
  }
  const p = positionWorld;
  const n = normalWorldGeometry;
  const weight = n.abs().pow(4);
  const w = weight.div(weight.x.add(weight.y).add(weight.z).max(0.00001));
  const saved = materials.map((m) => ({
    colorNode: m.colorNode,
    roughnessNode: m.roughnessNode,
    normalNode: m.normalNode,
    programKey: m.customProgramCacheKey(),
  }));

  for (let i = 0; i < materials.length; ++i) {
    const m = materials[i];
    const tune = MACRO[KEYS[i]];
    // Base packing: surface R = normalized luminance, G = roughness (see base
    // `nodes()`); plaster tile is 1 m, timber crop 700x123 px of a 1 m tile.
    // Macro re-tiles to 4 m (timber: 4 m along the board, one pitch across).
    const surfTex = tune.timber ? textures[2] : textures[0];
    const normTex = tune.timber ? textures[3] : textures[1];
    const tileS = tune.timber ? vec2(700 / 1024, 123 / 1024) : vec2(1, 1);
    const macroS = tune.timber ? vec2(4, 1) : vec2(4, 4);
    const sc = tileS.mul(macroS);
    const mxUV = (tune.timber ? p.yz : p.zy).div(sc);
    const myUV = p.xz.div(sc);
    const mzUV = (tune.timber ? p.yx : p.xy).div(sc);
    const ms = texture(surfTex, mxUV).mul(w.x)
      .add(texture(surfTex, myUV).mul(w.y))
      .add(texture(surfTex, mzUV).mul(w.z)).toVar();
    const macroAlbedo = ms.r.mul(2).sub(1).mul(tune.albedo).add(1).toVar();
    const macroRough = ms.g.mul(2).sub(1).mul(tune.rough);
    // Macro relief: same surface-gradient construction as the base, sampled at
    // the macro tile, projected off the geometric normal, nudged in view space.
    const nx = texture(normTex, mxUV).xyz.mul(2).sub(1);
    const ny = texture(normTex, myUV).xyz.mul(2).sub(1);
    const nz = texture(normTex, mzUV).xyz.mul(2).sub(1);
    const ngx = (tune.timber ? vec3(0, nx.x, nx.y) : vec3(0, nx.y, nx.x)).div(nx.z.max(0.25));
    const ngy = vec3(ny.x, 0, ny.y).div(ny.z.max(0.25));
    const ngz = (tune.timber ? vec3(nz.y, nz.x, 0) : vec3(nz.x, nz.y, 0)).div(nz.z.max(0.25));
    const mgrad = ngx.mul(w.x).add(ngy.mul(w.y)).add(ngz.mul(w.z));
    const mrelief = mgrad.sub(n.mul(mgrad.dot(n)));
    const viewDelta = cameraViewMatrix.mul(vec4(mrelief, 0)).xyz;
    // Roof membrane bays: 2 m world-x rhythm, soft ~2 cm joints. `|sin|^48`
    // peaks mid-bay, so invert first: the line is 1.0 exactly on the joint.
    // `nodeObject` re-wraps the installed base hooks into the typed TSL surface
    // (method chaining + swizzles); runtime returns the same node objects.
    const c0 = m.colorNode;
    const r0 = m.roughnessNode;
    const n0 = m.normalNode;
    if (!c0 || !r0 || !n0) {
      active.delete(library);
      throw new Error(`Presence macro lost base hooks mid-install on ${KEYS[i]}`);
    }
    const baseColor = nodeObject(c0);
    const baseRough = nodeObject(r0);
    const baseNormal = nodeObject(n0);
    let nextColor = vec4(baseColor.rgb.mul(macroAlbedo), 1);
    let nextRough = baseRough.add(macroRough);
    if (tune.bays) {
      const bayLine = p.x.mul(Math.PI / 2).sin().abs().mul(-1).add(1).pow(48);
      nextColor = vec4(nextColor.rgb.mul(bayLine.mul(-0.025).add(1)), 1);
      nextRough = nextRough.add(bayLine.mul(0.04));
    }
    m.colorNode = nextColor;
    m.roughnessNode = nextRough;
    m.normalNode = baseNormal.add(viewDelta.mul(tune.normal)).normalize();
    // Extend, never fork: base key already carries texture uuids + surface key.
    const programKey = `${saved[i].programKey}|presence-macro-v1/${KEYS[i]}`;
    m.customProgramCacheKey = () => programKey;
    m.needsUpdate = true;
  }

  const controller: PresenceController = {
    materialCount: materials.length,
    addedTextures: 0,
    dispose() {
      if (!active.has(library)) return;
      active.delete(library);
      for (let i = 0; i < materials.length; ++i) {
        const before = saved[i];
        materials[i].colorNode = before.colorNode;
        materials[i].roughnessNode = before.roughnessNode;
        materials[i].normalNode = before.normalNode;
        const key = before.programKey;
        materials[i].customProgramCacheKey = () => key;
        materials[i].needsUpdate = true;
      }
    },
  };
  return Promise.resolve(controller);
}
