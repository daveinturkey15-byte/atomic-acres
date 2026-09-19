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
  // Multi-octave harmonic series with power shaping to avoid soft sine domes
  const p1 = Math.sin(theta * 3.0 + randOffset);
  const p2 = Math.cos(theta * 7.0 + randOffset * 1.37);
  const p3 = Math.sin(theta * 13.0 - randOffset * 0.73);
  const p4 = Math.cos(theta * 29.0 + randOffset * 2.11);

  // Sharp, faceted ridge modulation: |sin|^exponent creates crisp peaks and V-cols
  const sharp1 = Math.pow(Math.abs(Math.sin(theta * 5.0 + randOffset * 0.5)), 1.8);
  const sharp2 = Math.pow(Math.abs(Math.cos(theta * 11.0 - randOffset * 0.9)), 2.2);

  let crestNorm = 0.42 + 0.26 * p1 + 0.15 * p2 + 0.09 * p3 + 0.05 * p4 + 0.18 * sharp1 - 0.12 * sharp2;
  crestNorm = Math.max(0.08, Math.min(1.0, crestNorm));

  // Mesa plateau capping on select high summits
  if (crestNorm > 0.82) {
    const mesaOver = crestNorm - 0.82;
    crestNorm = 0.82 + mesaOver * 0.28; // flatten high crowns into tabular mesas
  }

  const peakHeight = cfg.minHeight + crestNorm * cfg.heightSpan;

  // 2. Cross-Slope Profile (Inward facing scarp vs back slope)
  let yRel = 0;
  let slopeFraction = 0; // 0 at foot, 1 at crest

  if (crossRatio <= crossCrest) {
    // Front-facing slope (facing the player/map)
    slopeFraction = crossRatio / crossCrest;
    // Convex-concave erosional slope: steep upper face, flared alluvial apron
    const profileCurve = Math.pow(slopeFraction, 1.45) * 0.65 + Math.pow(slopeFraction, 0.75) * 0.35;
    yRel = profileCurve * peakHeight;
  } else {
    // Back-facing slope (descending outward away from town)
    slopeFraction = (1.0 - crossRatio) / (1.0 - crossCrest);
    const profileCurve = Math.pow(slopeFraction, 1.3);
    yRel = profileCurve * peakHeight;
  }

  // 3. Stepped Sedimentary Strata (Horizontal terraces & structural benches)
  if (yRel > 1.5 && slopeFraction > 0.05) {
    // Tilted strata dip (regional fault-block tilt of ~4 degrees)
    const dip = Math.sin(theta * 2.0 + randOffset) * 2.5;
    const strataArg = (yRel + dip) * (Math.PI * 2 * cfg.strataSteps / (cfg.minHeight + cfg.heightSpan));
    // Asymmetric staircase wave: steep cliff face + gentle bench shelf
    const strataMod = (Math.sin(strataArg) - 0.35 * Math.sin(2.0 * strataArg)) * cfg.strataStrength;
    // Strata is most pronounced on mid-slopes and fades at extreme crest/foot
    const strataEnvelope = Math.sin(Math.PI * Math.min(1.0, slopeFraction));
    yRel += strataMod * strataEnvelope * 4.0;
  }

  // 4. Dendritic Erosion Gullies & Couloirs
  if (slopeFraction > 0.08) {
    const gullyPhase = theta * cfg.gullyFrequency + (1.0 - slopeFraction) * 2.5 + randOffset;
    const gullyWave1 = Math.pow(Math.abs(Math.sin(gullyPhase)), 2.6);
    const gullyWave2 = Math.pow(Math.abs(Math.cos(gullyPhase * 1.83 + 0.4)), 3.0);
    const gullyCut = (gullyWave1 * 0.7 + gullyWave2 * 0.3) * cfg.gullyDepth;
    // Chutes deepen down the mid-face and dissipate at alluvial base
    const gullyEnvelope = Math.pow(slopeFraction, 0.8) * (1.0 - Math.pow(slopeFraction, 4.0));
    yRel = Math.max(0, yRel - gullyCut * gullyEnvelope * peakHeight * 0.35);
  }

  // 5. Radial Meander & Frontal Spur Buttresses
  const meander = Math.sin(theta * 4.0 + randOffset) * cfg.radiusVariation
    + Math.cos(theta * 9.0 - randOffset) * (cfg.radiusVariation * 0.4);

  // Frontal spur projection (flatirons extending outward between washes)
  const spurProtrusion = (crossRatio < crossCrest)
    ? Math.cos(theta * (cfg.gullyFrequency * 0.5) + randOffset) * Math.sin(Math.PI * slopeFraction) * 6.5
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

      // Inward-facing scarp faces inward towards the map center; winding keeps
      // visible faces pointing up and towards the player
      indices[idx++] = a;
      indices[idx++] = b;
      indices[idx++] = d;

      indices[idx++] = d;
      indices[idx++] = b;
      indices[idx++] = c;
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
