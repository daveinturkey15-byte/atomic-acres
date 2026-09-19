/**
 * DISTANT MOUNTAINS CANARY — Deterministic Arid Ridge & Strata System
 *
 * Implements a high-fidelity procedural Nevada/Mojave desert mountain backdrop
 * designed to supersede the simplistic smooth/lumpy skyline geometry seen in
 * earlier captures (e.g. Checkpoint J yardWhite).
 *
 * Geomorphological Features:
 * 1. Multi-frequency fault-block ridge silhouettes with power-shaped crests (arêtes,
 *    serrated horns, cols, and flat-topped mesa caps).
 * 2. Stepped horizontal and dipping sedimentary strata ledges (simulating alternating
 *    competent sandstone/limestone cliffs and friable shale benches).
 * 3. Dendritic vertical erosion gullies and couloirs cutting perpendicularly through
 *    strata into alluvial fan skirts.
 * 4. Frontal spur buttresses (flatirons) projecting toward the valley floor.
 * 5. Three distinct atmospheric depth layers (Foothill Scarp, Mid Massifs, Far Horizon)
 *    strictly budgeted to <= 3 draw calls and <= 18,000 triangles total.
 *
 * Constraints:
 * - Budget: <= 18,000 triangles total, <= 3 draw calls total.
 * - Zero canvas allocations, zero per-frame runtime allocations.
 * - Explicit finite bounding box and bounding sphere calculations.
 * - Full unit normal and UV generation.
 * - Clean explicit disposal ownership.
 */

import * as THREE from 'three';
import type { Builder, BuildContext, BuildResult } from '../core/kit';
import { group } from '../core/kit';
import { PAL } from '../core/palette';

export interface RidgeLayerConfig {
  name: string;
  radius: number;           // Mean radial distance in metres
  radiusVariation: number;  // Meander amplitude in metres
  baseY: number;            // Sunk base elevation (e.g. -12m)
  minHeight: number;        // Minimum crest height above baseY
  heightSpan: number;       // Height variation span
  radialWidth: number;      // Front-to-back cross footprint width
  segmentsAngle: number;    // Longitudinal angular subdivisions
  segmentsCross: number;    // Cross-slope profile subdivisions
  frontBias: number;        // Fraction of cross segments devoted to front face
  strataSteps: number;      // Frequency of geological strata steps
  strataStrength: number;   // Amplitude of strata shelf benching
  gullyFrequency: number;   // Angular frequency of erosion chutes
  gullyDepth: number;       // Depth of erosional incision
  seedOffset: number;       // Deterministic phase offset
  materialColor: number;    // Palette color
  roughness: number;        // Surface roughness
  metalness: number;        // Surface metalness
}

export interface DistantMountainsResult {
  group: THREE.Group;
  meshes: THREE.Mesh[];
  geometries: THREE.BufferGeometry[];
  triangleCount: number;
  drawCalls: number;
  boundingBox: THREE.Box3;
  boundingSphere: THREE.Sphere;
  dispose: () => void;
}

/**
 * Standard configuration for the three geological distance rings.
 * Total triangle count: 3,584 + 5,760 + 6,400 = 15,744 (<= 18,000 budget).
 * Total draw calls: exactly 3.
 */
export const DEFAULT_CANARY_LAYERS: RidgeLayerConfig[] = [
  // Layer 0: Near Foothills & Arid Escarpment (Warm dark rock anchor, deepest gullies)
  {
    name: 'foothill_escarpment',
    radius: 310,
    radiusVariation: 18,
    baseY: -12,
    minHeight: 45,
    heightSpan: 35,
    radialWidth: 70,
    segmentsAngle: 128,
    segmentsCross: 14,
    frontBias: 0.75,
    strataSteps: 12,
    strataStrength: 0.32,
    gullyFrequency: 36,
    gullyDepth: 0.35,
    seedOffset: 1.414,
    materialColor: PAL.dirt,
    roughness: 0.98,
    metalness: 0.0,
  },
  // Layer 1: Mid-Range Stratified Massifs (Major skyline massifs, sharp peaks & mesas)
  {
    name: 'mid_massifs',
    radius: 460,
    radiusVariation: 28,
    baseY: -12,
    minHeight: 85,
    heightSpan: 60,
    radialWidth: 105,
    segmentsAngle: 160,
    segmentsCross: 18,
    frontBias: 0.72,
    strataSteps: 18,
    strataStrength: 0.28,
    gullyFrequency: 48,
    gullyDepth: 0.28,
    seedOffset: 2.718,
    materialColor: PAL.mountain,
    roughness: 0.99,
    metalness: 0.0,
  },
  // Layer 2: Far Horizon Jagged Silhouette (High alpine desert peaks catching aerial haze)
  {
    name: 'far_horizon_peaks',
    radius: 660,
    radiusVariation: 40,
    baseY: -12,
    minHeight: 135,
    heightSpan: 75,
    radialWidth: 140,
    segmentsAngle: 160,
    segmentsCross: 20,
    frontBias: 0.70,
    strataSteps: 22,
    strataStrength: 0.22,
    gullyFrequency: 54,
    gullyDepth: 0.22,
    seedOffset: 3.1415,
    materialColor: PAL.mountainFar,
    roughness: 1.0,
    metalness: 0.0,
  },
];

/**
 * Procedural height and profile evaluator for an arid mountain point.
 */
function evaluateMountainPoint(
  theta: number,
  crossRatio: number, // 0 = inner foot (town side), crossCrest = crest peak, 1 = outer back foot
  crossCrest: number,
  cfg: RidgeLayerConfig,
  randOffset: number,
): { x: number; y: number; z: number } {
  // 1. Longitudinal Crest Silhouette Height H(theta)
  // Round 2: layer-decorrelated harmonics. All three rings previously shared
  // one prime set (3/7/13/29 + sharps 5/11), so crest peaks stacked at the
  // same angles and read as parallel ribbons. Key by mean radius — the true
  // layer identity — so no two rings share a partial: foothills roll, mid
  // massifs jag, far peaks swell broad with sparse horns.
  const layerKey = cfg.radius < 400 ? 0 : cfg.radius < 550 ? 1 : 2;
  const HF = [
    { f1: 3, f2: 7, f3: 13, f4: 29, s1: 5, s2: 11, wSharp: 0.55, mesaCap: 0.86, colDepth: 0.10 },
    { f1: 4, f2: 9, f3: 17, f4: 37, s1: 7, s2: 15, wSharp: 1.0, mesaCap: 0.90, colDepth: 0.22 },
    { f1: 2, f2: 5, f3: 11, f4: 23, s1: 4, s2: 9, wSharp: 0.75, mesaCap: 1.10, colDepth: 0.16 },
  ][layerKey];
  // Multi-octave harmonic series with power shaping to avoid soft sine domes.
  // Per-layer phase offsets (layerKey terms) break cross-ring peak alignment.
  const p1 = Math.sin(theta * HF.f1 + randOffset);
  const p2 = Math.cos(theta * HF.f2 + randOffset * 1.37 + layerKey * 1.7);
  const p3 = Math.sin(theta * HF.f3 - randOffset * 0.73 + layerKey * 0.9);
  const p4 = Math.cos(theta * HF.f4 + randOffset * 2.11 + layerKey * 2.3);

  // Sharp, faceted ridge modulation: |sin|^exponent creates crisp peaks and V-cols
  const sharp1 = Math.pow(Math.abs(Math.sin(theta * HF.s1 + randOffset * 0.5 + layerKey)), 1.8);
  const sharp2 = Math.pow(Math.abs(Math.cos(theta * HF.s2 - randOffset * 0.9 + layerKey * 2.0)), 2.2);

  let crestNorm = 0.42 + 0.26 * p1 + 0.15 * p2 + 0.09 * p3 + 0.05 * p4
    + 0.18 * HF.wSharp * sharp1 - 0.12 * HF.wSharp * sharp2;

  // Massif grouping: cluster the ring into ranges separated by low saddles so
  // the skyline is not a continuous even-height band. Distinct low frequency
  // per layer (f1 - 1 -> 2/3/1) keeps group spacing uncorrelated across rings.
  const massifPhase = randOffset * 0.9 + layerKey * 2.4;
  const massif = Math.pow(0.5 + 0.5 * Math.sin(theta * (HF.f1 - 1) + massifPhase), 1.5);
  crestNorm = 0.30 * crestNorm + 0.70 * (crestNorm * (0.45 + 0.55 * massif));

  // V-col carving: deep notches at sharp minima break the crest into uneven
  // horns. Strongest on the mid massifs that own the skyline.
  crestNorm -= HF.colDepth * Math.pow(Math.abs(Math.sin(theta * HF.s2 * 0.5 + randOffset + layerKey)), 3.0);
  crestNorm = Math.max(0.08, Math.min(1.0, crestNorm));

  // Mesa plateau capping on select high summits. The far-ring cap sits above
  // 1.0 (disabled): flat tabular tops up there caught the sun as continuous
  // white stripes, so far horns stay pointed and shade unevenly.
  if (crestNorm > HF.mesaCap) {
    const mesaOver = crestNorm - HF.mesaCap;
    crestNorm = HF.mesaCap + mesaOver * 0.28; // flatten high crowns into tabular mesas
  }

  const peakHeight = cfg.minHeight + crestNorm * cfg.heightSpan;

  // 2. Cross-Slope Profile (Inward facing scarp vs back slope)
  let yRel = 0;
  let slopeFraction = 0; // 0 at foot, 1 at crest

  if (crossRatio <= crossCrest) {
    // Front-facing slope (facing the player/map)
    slopeFraction = crossRatio / crossCrest;
    // Convex-concave erosional slope: steep upper scarp, flared alluvial apron.
    // Round 1 art fix: steeper top (1.45 -> 1.7) so sunlit-vs-shade normals vary
    // across the face instead of reading as one flat band at grazing angles.
    const profileCurve = Math.pow(slopeFraction, 1.7) * 0.72 + Math.pow(slopeFraction, 0.7) * 0.28;
    yRel = profileCurve * peakHeight;
  } else {
    // Back-facing slope (descending outward away from town)
    slopeFraction = (1.0 - crossRatio) / (1.0 - crossCrest);
    const profileCurve = Math.pow(slopeFraction, 1.3);
    yRel = profileCurve * peakHeight;
  }

  // 3. Stepped Sedimentary Strata (Horizontal terraces & structural benches)
  if (yRel > 1.5 && slopeFraction > 0.05) {
    // Tilted strata dip (regional fault-block tilt of ~4 degrees), phase
    // offset per layer so benches do not align into cross-ring bands.
    const dip = Math.sin(theta * (HF.f1 - 1) + randOffset + layerKey * 1.1) * 2.5;
    const strataArg = (yRel + dip) * (Math.PI * 2 * cfg.strataSteps / (cfg.minHeight + cfg.heightSpan));
    // Asymmetric staircase wave: steep cliff face + gentle bench shelf
    const strataMod = (Math.sin(strataArg) - 0.35 * Math.sin(2.0 * strataArg)) * cfg.strataStrength;
    // Strata is most pronounced on mid-slopes and fades at extreme crest/foot.
    // Round 2: angular gate breaks ledges into discontinuous outcrops — the
    // full-ring continuous benches read as white stripe tops at grazing sun.
    const strataEnvelope = Math.sin(Math.PI * Math.min(1.0, slopeFraction));
    const strataGate = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(theta * (HF.s1 + 2) + randOffset * 1.9 + layerKey * 3.1));
    yRel += strataMod * strataEnvelope * 4.0 * strataGate;
  }

  // 4. Dendritic Erosion Gullies & Couloirs
  // Round 2: two-scale carving. Major buttress couloirs (low frequency, front
  // face only) cut deep wide chutes between projecting buttresses — each is
  // ~10+ angular segments wide so it survives vertex-normal smoothing. The
  // inherited fine chutes (high frequency, all faces) keep surface texture.
  // Major frequencies are coprime with the fine frequencies so they never lock.
  const MAJOR_GULLY_FREQ = [9, 13, 7][layerKey];
  const majorPhaseBase = theta * MAJOR_GULLY_FREQ + randOffset * 2.3 + layerKey * 1.2;
  if (slopeFraction > 0.08 && crossRatio < crossCrest) {
    const majorPhase = majorPhaseBase + (1.0 - slopeFraction) * 1.1;
    const majorCut = Math.pow(Math.abs(Math.sin(majorPhase)), 1.5);
    const majorEnvelope = Math.pow(slopeFraction, 0.7) * (1.0 - Math.pow(slopeFraction, 3.0));
    yRel = Math.max(0, yRel - majorCut * majorEnvelope * peakHeight * 0.18);
  }
  if (slopeFraction > 0.08) {
    const gullyPhase = theta * cfg.gullyFrequency + (1.0 - slopeFraction) * 2.5 + randOffset;
    const gullyWave1 = Math.pow(Math.abs(Math.sin(gullyPhase)), 2.6);
    const gullyWave2 = Math.pow(Math.abs(Math.cos(gullyPhase * 1.83 + 0.4)), 3.0);
    const gullyCut = (gullyWave1 * 0.7 + gullyWave2 * 0.3) * cfg.gullyDepth;
    // Chutes deepen down the mid-face and dissipate at alluvial base.
    // Round 1 art fix: 0.35 -> 0.45 (same tris) so couloirs cast readable
    // sunlit-vs-occluded relief once the winding below faces the map again.
    const gullyEnvelope = Math.pow(slopeFraction, 0.8) * (1.0 - Math.pow(slopeFraction, 4.0));
    yRel = Math.max(0, yRel - gullyCut * gullyEnvelope * peakHeight * 0.45);
  }

  // 5. Radial Meander & Frontal Spur Buttresses
  const meander = Math.sin(theta * 4.0 + randOffset) * cfg.radiusVariation
    + Math.cos(theta * 9.0 - randOffset) * (cfg.radiusVariation * 0.4);

  // Round 2: buttresses project BETWEEN major couloirs (cosine vs the gully
  // sine: max protrusion where incision is minimal), scaled with ring size so
  // near flatirons read at 310 m and far massifs at 660 m. The old 6.5 m
  // uniform spur was ~1-2% of ring radius — invisible at map cameras.
  // Mid massifs own the skyline and carry the tallest frontal buttresses;
  // 32 m there stays inside the 105 m ring footprint and well outside R=310.
  const BUTTRESS_AMP = [22, 32, 30][layerKey];
  const buttressPhase = majorPhaseBase + (1.0 - slopeFraction) * 1.1;
  const buttress = Math.pow(0.5 + 0.5 * Math.cos(buttressPhase), 1.6);
  const spurProtrusion = (crossRatio < crossCrest)
    ? (buttress - 0.45) * Math.sin(Math.PI * Math.min(1.0, slopeFraction)) * BUTTRESS_AMP
    : 0;

  // Radial positioning: offset from mean ring radius
  const radialOffset = (crossRatio - crossCrest) * cfg.radialWidth + meander + spurProtrusion;
  const currentRadius = cfg.radius + radialOffset;

  const worldX = Math.cos(theta) * currentRadius;
  const worldY = cfg.baseY + Math.max(0, yRel);
  const worldZ = Math.sin(theta) * currentRadius;

  return { x: worldX, y: worldY, z: worldZ };
}

/**
 * Builds a single continuous, indexed mountain ridge geometry.
 */
export function buildMountainRidgeGeometry(cfg: RidgeLayerConfig): THREE.BufferGeometry {
  const nTheta = cfg.segmentsAngle;
  const nCross = cfg.segmentsCross;
  const nFront = Math.max(2, Math.round(nCross * cfg.frontBias));
  const nBack = nCross - nFront;
  const crossCrest = nFront / nCross;

  const numVertices = (nTheta + 1) * (nCross + 1);
  const positions = new Float32Array(numVertices * 3);
  const uvs = new Float32Array(numVertices * 2);

  let vIdx = 0;
  let uvIdx = 0;

  for (let j = 0; j <= nCross; j++) {
    const crossRatio = j / nCross;
    for (let i = 0; i <= nTheta; i++) {
      const theta = (i / nTheta) * Math.PI * 2;
      const pt = evaluateMountainPoint(theta, crossRatio, crossCrest, cfg, cfg.seedOffset);

      positions[vIdx++] = pt.x;
      positions[vIdx++] = pt.y;
      positions[vIdx++] = pt.z;

      // Parametric UV mapping: u wraps around circumference, v scales with cross-slope
      uvs[uvIdx++] = i / nTheta * 8.0;
      uvs[uvIdx++] = crossRatio * 2.0;
    }
  }

  const numQuads = nTheta * nCross;
  const indices = new Uint16Array(numQuads * 6);
  let idx = 0;
  const rowStride = nTheta + 1;

  for (let j = 0; j < nCross; j++) {
    for (let i = 0; i < nTheta; i++) {
      const a = j * rowStride + i;
      const b = (j + 1) * rowStride + i;
      const c = (j + 1) * rowStride + (i + 1);
      const d = j * rowStride + (i + 1);

      // Front scarp faces the map center (inward) with topsides up. Measured
      // 2026-09-19: the old (a,b,d)/(d,b,c) order put mid-face normals at
      // y~-0.64 / outward +0.76 at theta=0, i.e. pointing DOWN and AWAY, so the
      // FrontSide scarp was backface-culled/inverted from every map camera and
      // read as flat uniform ribbons. Flipped to (a,d,b)/(d,c,b): y~+0.64,
      // inward, sunlit-vs-occluded gully relief visible again. Same tris.
      indices[idx++] = a;
      indices[idx++] = d;
      indices[idx++] = b;

      indices[idx++] = d;
      indices[idx++] = c;
      indices[idx++] = b;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));

  // Compute smooth, unit vertex normals
  geometry.computeVertexNormals();

  // Compute explicit finite bounding volumes
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return geometry;
}

/**
 * Factory creating the 3-layer distant mountain canary system.
 */
export function createDistantMountainsCanary(
  ctx: BuildContext,
  layerConfigs: RidgeLayerConfig[] = DEFAULT_CANARY_LAYERS,
): DistantMountainsResult {
  const g = group('distant_mountains_canary');
  const meshes: THREE.Mesh[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  let totalTriangles = 0;

  for (let i = 0; i < layerConfigs.length; i++) {
    const cfg = layerConfigs[i];
    const geo = buildMountainRidgeGeometry(cfg);
    geometries.push(geo);

    const triCount = (geo.index ? geo.index.count : geo.attributes.position.count) / 3;
    totalTriangles += triCount;

    // Use supplied existing shared material from ctx.mat
    const mat = ctx.mat.painted(cfg.materialColor, cfg.roughness, cfg.metalness);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `mtn_canary_layer_${i}_${cfg.name}`;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    g.add(mesh);
    meshes.push(mesh);
  }

  const overallBox = new THREE.Box3();
  for (const geo of geometries) {
    if (geo.boundingBox) {
      overallBox.union(geo.boundingBox);
    }
  }

  const overallSphere = new THREE.Sphere();
  overallBox.getBoundingSphere(overallSphere);

  let released = false;
  const dispose = () => {
    if (released) return;
    released = true;
    for (const geo of geometries) {
      geo.dispose();
    }
    geometries.length = 0;
    for (const mesh of meshes) {
      mesh.removeFromParent();
    }
    meshes.length = 0;
    g.removeFromParent();
    g.clear();
  };
  g.userData.dispose = dispose;

  return {
    group: g,
    meshes,
    geometries,
    triangleCount: totalTriangles,
    drawCalls: meshes.length,
    boundingBox: overallBox,
    boundingSphere: overallSphere,
    dispose,
  };
}

/**
 * Standard Builder contract export for seamless integration.
 */
export const buildDistantMountainsCanary: Builder = (ctx) => {
  const result = createDistantMountainsCanary(ctx);
  // Mountain backdrops are non-colliding distant scenery
  return {
    group: result.group,
    colliders: [],
  };
};
