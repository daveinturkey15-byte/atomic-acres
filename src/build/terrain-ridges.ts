/**
 * Deterministic, indexed terrain surfaces for the skyline builder.
 *
 * Each massif is a small 2D heightfield: longitudinal samples describe the
 * silhouette and cross-slope samples describe weathered gullies from the foot
 * to the crest and back down. Shared vertices and computed normals keep the
 * result continuous; separate stripe overlays are intentionally avoided.
 */
import * as THREE from 'three';

interface RidgeSample {
  x: number;
  h: number;
  zc: number;
  front: number;
  back: number;
}

const CROSS_SEGMENTS = 12;

function sampleRidge(rand: () => number, seg: number): { samples: RidgeSample[]; phase: number } {
  const nSum = 2 + Math.floor(rand() * 2);
  const sums: [number, number, number][] = [];
  for (let i = 0; i < nSum; i++) {
    sums.push([
      (i + 0.5) / nSum + (rand() - 0.5) * 0.26,
      0.46 + rand() * 0.40,
      0.30 + rand() * 0.28,
    ]);
  }
  const f1 = 3 + rand() * 3, p1 = rand() * Math.PI * 2;
  const f2 = 8 + rand() * 6, p2 = rand() * Math.PI * 2;
  const fz = 1.2 + rand() * 1.6, pz = rand() * Math.PI * 2;
  const pb1 = rand() * Math.PI * 2, pb2 = rand() * Math.PI * 2;
  // Do not consume a new random value here: skyline RNG order is shared with
  // the existing builder. The derived phase still decorrelates the gully field.
  const erosionP = (p1 * 1.71 + pb2 * 0.73) % (Math.PI * 2);
  const out: RidgeSample[] = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    let h = 0.36 * Math.pow(Math.sin(Math.PI * t), 0.5);
    for (const [p, a, w] of sums) {
      h = Math.max(h, a * Math.exp(-(Math.abs((t - p) / w) ** 2.6)));
    }
    h *= 1 + 0.11 * Math.sin(t * Math.PI * f1 + p1)
      + 0.05 * Math.sin(t * Math.PI * f2 + p2);
    // Broad erosion notches alter the skyline without creating a repeated
    // horizontal band. The higher frequency component becomes gullies below.
    h *= 1 - 0.075 * Math.abs(Math.sin(t * Math.PI * 2.7 + erosionP))
      - 0.035 * Math.abs(Math.sin(t * Math.PI * 6.2 + p1 * 0.7));
    h *= Math.min(1, t / 0.12, (1 - t) / 0.12);
    const zc = 0.30 * Math.sin(t * Math.PI * fz + pz);
    const x = t * 2 - 1;
    out.push({
      x,
      h: Math.max(h, 0),
      zc,
      front: zc + 0.62 + 0.34 * Math.sin(t * 5.1 + pb1),
      back: zc - 0.62 - 0.34 * Math.sin(t * 4.3 + pb2),
    });
  }
  return { samples: out, phase: erosionP };
}

function vertex(sample: RidgeSample, cross: number, phase: number): [number, number, number] {
  // cross -1 is the front foot, 0 the crest, and +1 the far foot.
  const q = 1 - Math.abs(cross);
  const z = cross <= 0
    ? sample.front + (sample.zc - sample.front) * (cross + 1)
    : sample.back + (sample.zc - sample.back) * (1 - cross);

  // Two incommensurate waves produce shallow drainage channels rather than
  // visible contour lines. Both vanish at the foot and crest, where the
  // silhouette must remain stable.
  const relief = Math.sin(Math.PI * q);
  const gullies = 0.010 * Math.sin(sample.x * 15.0 + cross * 7.0 + phase)
    + 0.005 * Math.sin(sample.x * 29.0 - cross * 11.0 + phase * 1.37);
  const y = sample.h * Math.pow(q, 0.82) + gullies * relief * (0.28 + q * 0.72);
  return [sample.x, Math.max(0, y), z];
}

function buildSurface(samples: RidgeSample[], phase: number, crossSegments: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const rows = crossSegments + 1;
  for (let i = 0; i <= samples.length - 1; i++) {
    for (let j = 0; j <= crossSegments; j++) {
      const cross = j / crossSegments * 2 - 1;
      positions.push(...vertex(samples[i], cross, phase));
    }
  }

  const indices: number[] = [];
  for (let i = 0; i < samples.length - 1; i++) {
    for (let j = 0; j < crossSegments; j++) {
      const a = i * rows + j;
      const b = a + rows;
      const c = b + 1;
      const d = a + 1;
      // Cross samples run continuously from +z to -z on BOTH slopes.
      // The same winding keeps the entire upper surface facing outward.
      indices.push(a, b, c, a, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Unit-space geometry: x [-1,1], base z about +/-1, crest y <= 1. */
export function buildRidgeGeometry(rand: () => number, segments = 30): THREE.BufferGeometry {
  if (!Number.isInteger(segments) || segments < 8) {
    throw new Error(`ridge segments must be an integer >= 8, got ${segments}`);
  }
  const { samples, phase } = sampleRidge(rand, segments);
  return buildSurface(samples, phase, CROSS_SEGMENTS);
}
