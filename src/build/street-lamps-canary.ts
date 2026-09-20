/** Boot-static presentation replacement for the eight existing yard street lamps.
 * Three shared geometries/material roles; no textures, materials, lights or collision.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface StreetLampSpec { x: number; z: number; dx: number; dz: number }
export interface StreetLampMaterials { steel: THREE.Material; housing: THREE.Material; lens: THREE.Material }

export function isStreetLampsCanaryEnabled(search = typeof location === 'undefined' ? '' : location.search): boolean {
  return new URLSearchParams(search).get('street-lamps') === 'canary';
}

const STEM_HEIGHT = 5;
const BEND_RADIUS = 1.45;
const HEAD_X = 1.69;
const RADIAL_SEGMENTS = 16;
const BEND_SEGMENTS = 16;

/** A single welded-looking surface, with analytic tangent frames and taper normals.
 * Local +X points into the road. Both ends are buried in the shoe/housing, so no
 * exposed coplanar caps or sphere elbow are necessary. All samples are build-time.
 */
function sweptPole(): THREE.BufferGeometry {
  const rings: { x: number; y: number; tx: number; ty: number; radius: number }[] = [];
  for (const y of [0.16, 1.6, 3.5, STEM_HEIGHT]) {
    rings.push({ x: 0, y, tx: 0, ty: 1, radius: 0.085 - (y - 0.16) / 4.84 * 0.021 });
  }
  for (let i = 1; i <= BEND_SEGMENTS; i++) {
    const angle = i / BEND_SEGMENTS * Math.PI / 2;
    rings.push({ x: BEND_RADIUS * (1 - Math.cos(angle)),
      y: STEM_HEIGHT + BEND_RADIUS * Math.sin(angle), tx: Math.sin(angle), ty: Math.cos(angle),
      radius: 0.064 - i / BEND_SEGMENTS * 0.012 });
  }
  rings.push({ x: 1.57, y: 6.45, tx: 1, ty: 0, radius: 0.052 });
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], indices: number[] = [];
  const n = new THREE.Vector3();
  for (let ring = 0; ring < rings.length; ring++) {
    const r = rings[ring], prev = rings[Math.max(0, ring - 1)], next = rings[Math.min(rings.length - 1, ring + 1)];
    const slope = (next.radius - prev.radius) / Math.max(0.0001, Math.hypot(next.x - prev.x, next.y - prev.y));
    for (let j = 0; j <= RADIAL_SEGMENTS; j++) {
      const angle = j / RADIAL_SEGMENTS * Math.PI * 2, c = Math.cos(angle), s = Math.sin(angle);
      positions.push(r.x + r.ty * c * r.radius, r.y - r.tx * c * r.radius, s * r.radius);
      n.set(r.ty * c - r.tx * slope, -r.tx * c - r.ty * slope, s).normalize();
      normals.push(n.x, n.y, n.z); uvs.push(j / RADIAL_SEGMENTS, ring / (rings.length - 1));
      if (ring < rings.length - 1 && j < RADIAL_SEGMENTS) {
        const a = ring * (RADIAL_SEGMENTS + 1) + j, b = a + RADIAL_SEGMENTS + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.userData.sweepRings = rings;
  geometry.userData.radialSegments = RADIAL_SEGMENTS;
  return geometry;
}

function lathe(profile: readonly (readonly [number, number])[], x = 0): THREE.BufferGeometry {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 24).translate(x, 0, 0);
}

function steelGeometry(): THREE.BufferGeometry {
  const pole = sweptPole();
  const parts = [pole,
    // Flanged foot with a sloped socket, all inside the old 380 mm base.
    lathe([[0, 0.006], [0.162, 0.006], [0.178, 0.035], [0.178, 0.083],
      [0.17, 0.10], [0.102, 0.10], [0.092, 0.23], [0.081, 0.26]]),
    // Rolled lower rim and sloped reflector underside. The central hole is lens-sized.
    lathe([[0.174, 6.245], [0.205, 6.26], [0.295, 6.295], [0.332, 6.316],
      [0.332, 6.326], [0.326, 6.331]], HEAD_X),
  ];
  for (let bolt = 0; bolt < 4; bolt++) {
    const a = (bolt + 0.5) * Math.PI / 2;
    parts.push(new THREE.CylinderGeometry(0.015, 0.015, 0.022, 6, 1)
      .translate(Math.cos(a) * 0.139, 0.11, Math.sin(a) * 0.139));
  }
  const geometry = mergeGeometries(parts, false)!;
  geometry.userData.sweepRings = pole.userData.sweepRings;
  geometry.userData.radialSegments = RADIAL_SEGMENTS;
  for (const part of parts) part.dispose();
  return geometry;
}

/** Each owner gets its own three geometries; all eight instances share those three.
 * Call only before rendering. The caller retains ownership of all passed materials.
 */
export function buildStreetLampsCanary(materials: StreetLampMaterials, specs: readonly StreetLampSpec[]): THREE.Group {
  for (const spec of specs) {
    if (![spec.x, spec.z, spec.dx, spec.dz].every(Number.isFinite) || Math.hypot(spec.dx, spec.dz) < 0.0001) {
      throw new Error('Street lamp requires finite coordinates and a nonzero direction');
    }
  }
  const group = new THREE.Group(); group.name = 'street-lamps-canary';
  if (!specs.length) return group;
  const steel = steelGeometry();
  const housing = lathe([[0.326, 6.328], [0.33, 6.35], [0.322, 6.387],
    [0.285, 6.445], [0.22, 6.492], [0.12, 6.520], [0, 6.532]], HEAD_X);
  const lens = lathe([[0, 6.214], [0.105, 6.22], [0.172, 6.237],
    [0.175, 6.246], [0.175, 6.286], [0, 6.286]], HEAD_X);
  const roles = [[steel, materials.steel, 'street-lamp-metal'],
    [housing, materials.housing, 'street-lamp-housing'],
    [lens, materials.lens, 'street-lamp-lens']] as const;
  const q = new THREE.Quaternion(), p = new THREE.Vector3(), unit = new THREE.Vector3(1, 1, 1);
  const matrix = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
  for (const [geometry, material, name] of roles) {
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
    const mesh = new THREE.InstancedMesh(geometry, material, specs.length);
    mesh.name = name; mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.farcrysisArt = true;
    specs.forEach((spec, i) => {
      q.setFromAxisAngle(up, -Math.atan2(spec.dz, spec.dx));
      mesh.setMatrixAt(i, matrix.compose(p.set(spec.x, 0, spec.z), q, unit));
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingBox(); mesh.computeBoundingSphere();
    group.add(mesh);
  }
  group.userData.streetLampStats = { lampCount: specs.length, drawGroups: 3,
    triangles: roles.reduce((n, [g]) => n + g.index!.count / 3, 0) * specs.length,
    additionalMaterials: 0, additionalTextures: 0, additionalLights: 0 };
  group.userData.streetLampInputs = specs.map(s => ({ ...s }));
  return group;
}
