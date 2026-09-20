/**
 * Lawn PBR canary: photo-PBR surface candidate for the LAWN family only, behind
 * the opt-in `?lawn=canary` flag. ASSET lane only - never touches the scene,
 * the renderer, lights or geometry, and creates nothing per frame.
 *
 * This lane deliberately does NOT duplicate the ground canary machinery: loading
 * (async, cancel + late-dispose), map configuration and the swap onto an
 * existing singleton are reused verbatim from `ground-pbr-canary.ts`
 * (`loadCanarySurfaceSet` / `applyGroundPbrCanaryMaps`). This module only pins
 * the lawn-specific calibration constants and builds the swap spec from them.
 *
 * Ownership contract (inherited from ground-pbr-canary.ts):
 *  - the caller loads the three maps once (see public/assets/lawn-pbr-canary/)
 *    via `loadCanarySurfaceSet` and hands them to `buildLawnCanarySpec`;
 *  - repeat is the ONLY tiling multiplier. World tiling lives in geometry UVs
 *    (root `build/ground.ts`: UV_LAWN = 96.0 m per UV unit), so
 *    repeat = 96 / 1.4, set once per map by `applyGroundPbrCanaryMaps`;
 *  - the swap retargets the EXISTING lawn singleton (one draw call, one
 *    program; the wetness node graph stays the same shape and is reinstalled by
 *    the caller through `wetRefresh`), so the baseline frame is unchanged when
 *    the flag is absent and the program count does not move when it is on;
 *  - no displacement map, no extra draw geometry, no per-frame allocation.
 *
 * Source: ambientCG Grass001, CC0 (site-wide). Native physical tile 1.4 m
 * (v2 API dimensionX/dimensionY = 140x140 cm). creationMethod is
 * PBRProcedural - ambientCG-authored maps, NOT a photo scan; this is disclosed
 * in provenance.json together with the photo-scan alternatives that were
 * evaluated and rejected (leafy_grass: plant litter/lush meadow; grass_ground
 * and sparse_grass: the bare-soil failure class already rejected once on this
 * lawn). Provenance, hashes and budgets in
 * public/assets/lawn-pbr-canary/provenance.json.
 */
import type { GroundPbrCanaryMaps, GroundPbrCanarySurfaceSpec } from './ground-pbr-canary';

/** Root ground.ts UV_LAWN, mirrored here as the canary's only tiling input. */
export const LAWN_CANARY_UV_M = 96.0;

/** Native tile size recorded from the ambientCG v2 API (see provenance.json). */
export const LAWN_CANARY_TILE_M = 1.4;

/** Root lawn family normal strength (materials.ts lawn wetStd: 0.4). */
export const LAWN_CANARY_NORMAL_SCALE = 0.4;

/**
 * Identity on purpose. Measured color-map mean is sRGB (68.2, 91.7, 40.6) -
 * already darker and more muted than the baseline turf target
 * (channelMix(PAL.lawn, PAL.dirt, 0.18) ~ (87, 121, 59)). material.color is a
 * multiplier, so it can only darken further; 0xffffff keeps the material in
 * exactly the baseline color state. If the root's paired-view gate reads the
 * canary too dark against the baseline, the calibration lever is a brighter
 * source asset (e.g. Grass004) or a gain in the wetness colorNode hook - not
 * this constant.
 */
export const LAWN_CANARY_ALBEDO_TINT = 0xffffff;

/** One texture per slot, three slots, 1024^2 each (see provenance.json). */
export const LAWN_CANARY_URLS = {
  diffuse: 'assets/lawn-pbr-canary/lawn-1k-color.jpg',
  roughness: 'assets/lawn-pbr-canary/lawn-1k-roughness.jpg',
  normal: 'assets/lawn-pbr-canary/lawn-1k-normal.jpg',
} as const;

/** The lawn swap spec: constants above, nothing else. */
export function buildLawnCanarySpec(maps: GroundPbrCanaryMaps): GroundPbrCanarySurfaceSpec {
  return {
    maps,
    uvMetresPerUnit: LAWN_CANARY_UV_M,
    tilePhysicalMetres: LAWN_CANARY_TILE_M,
    normalScale: LAWN_CANARY_NORMAL_SCALE,
    roughness: 1.0,
    albedoTint: LAWN_CANARY_ALBEDO_TINT,
  };
}
