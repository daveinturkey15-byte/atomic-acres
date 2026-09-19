/**
 * Presentation-only lawn dressing for the Sept 17 map.
 *
 * The lawn material already carries the broad mown albedo/roughness/normal
 * response. These two instanced families add the missing near-field silhouette:
 * small clumps at the pavement/fence edges and a lower, sparse field through
 * the open yards. They have no colliders and never alter the ground footprint.
 *
 * Budget at the authored caps: 2 draws, 2,400 instances and 19,200 triangles
 * (the four-blade geometry is eight triangles per instance). Placement is built
 * once with the module RNG and a one-time downward surface test; no frame loop
 * or per-frame allocation is involved.
 */
import * as THREE from 'three';
import type { BuildContext, BuildResult } from '../core/kit';
import {
  BACK_FENCE, FRONT_LAWN_OUTER, HEAD_CENTER_X, HEAD_RADIUS, HOUSE_BACK,
  HOUSE_HALF_LEN, HOUSES, KERB_HEIGHT, PAVEMENT_OUTER, ROAD_HALF_WIDTH,
  YARD_X_MAX, YARD_X_MIN,
} from '../core/layout';
import { PAL } from '../core/palette';

const LAWN_TOP = KERB_HEIGHT + 0.001;
const MARGIN = 0.45;

interface Zone {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  count: number;
  edge: boolean;
}

interface Point {
  x: number;
  z: number;
  h: number;
  w: number;
  yaw: number;
}

type SurfaceGroups = THREE.Object3D[];

/** Four tapered blades with front and back winding, so FrontSide materials work from either view. */
function bladeGeometry(): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const directions = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
  for (let i = 0; i < directions.length; i++) {
    const a = directions[i] + (i % 2 ? 0.12 : -0.08);
    const nx = Math.cos(a);
    const nz = Math.sin(a);
    const tx = -nz;
    const tz = nx;
    const width = 0.15 + (i % 3) * 0.018;
    const lean = (i % 2 ? 0.045 : -0.035);
    const left: [number, number, number] = [-tx * width, 0, -tz * width];
    const right: [number, number, number] = [tx * width, 0, tz * width];
    const tip: [number, number, number] = [nx * lean, 1, nz * lean];
    const push = (p: [number, number, number], n: [number, number, number], uv: [number, number]): void => {
      positions.push(p[0], p[1], p[2]);
      normals.push(n[0], n[1], n[2]);
      uvs.push(uv[0], uv[1]);
    };
    // Front and reversed back triangles. The tip is centred to make the top
    // read as separate blades instead of a box when the camera is close.
    push(left, [nx, 0.12, nz], [0, 0]);
    push(right, [nx, 0.12, nz], [1, 0]);
    push(tip, [nx, 0.12, nz], [0.5, 1]);
    push(left, [-nx, -0.12, -nz], [0, 0]);
    push(tip, [-nx, -0.12, -nz], [0.5, 1]);
    push(right, [-nx, -0.12, -nz], [1, 0]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return g;
}

function clampRange(a: number, b: number): [number, number] {
  return a < b ? [a, b] : [b, a];
}

/** Build the same front-lawn stop as ground.ts, without importing its private mesh helpers. */
function frontLawnMax(): number {
  const headPaveRadius = HEAD_RADIUS + (PAVEMENT_OUTER - ROAD_HALF_WIDTH);
  // HEAD_CENTER_X is 0 in the layout contract, but retaining it here keeps the
  // derived edge readable if that landmark is ever moved.
  return HEAD_CENTER_X - Math.sqrt(Math.max(0, headPaveRadius * headPaveRadius - PAVEMENT_OUTER * PAVEMENT_OUTER));
}

function makeZones(): Zone[] {
  const zones: Zone[] = [];
  const frontMax = frontLawnMax();
  for (const h of HOUSES) {
    const s = h.side;
    const [fz0, fz1] = clampRange(s * (PAVEMENT_OUTER + MARGIN), s * (FRONT_LAWN_OUTER - MARGIN));
    // Frontage is the narrow west-side lawn left by the turning-head pavement.
    zones.push({ x0: YARD_X_MIN + MARGIN, x1: frontMax - MARGIN, z0: fz0, z1: fz1, count: 180, edge: true });

    const [bz0, bz1] = clampRange(s * (HOUSE_BACK + MARGIN), s * (BACK_FENCE - MARGIN));
    const [houseEdge0, houseEdge1] = clampRange(s * (HOUSE_BACK + MARGIN), s * (HOUSE_BACK + MARGIN + 1.15));
    const [fenceEdge0, fenceEdge1] = clampRange(s * (BACK_FENCE - MARGIN - 1.15), s * (BACK_FENCE - MARGIN));
    // A denser fence/house-edge band gives the aerial lawn a broken organic rim.
    zones.push({ x0: YARD_X_MIN + MARGIN, x1: YARD_X_MAX - MARGIN, z0: houseEdge0, z1: houseEdge1, count: 220, edge: true });
    zones.push({ x0: YARD_X_MIN + MARGIN, x1: YARD_X_MAX - MARGIN, z0: fenceEdge0, z1: fenceEdge1, count: 220, edge: true });
    // Candidate back-yard field. The surface test below removes patios, decks,
    // shuffleboard, stepping pads, and any prop that sits over this lawn.
    zones.push({ x0: YARD_X_MIN + MARGIN, x1: YARD_X_MAX - MARGIN, z0: bz0, z1: bz1, count: 380, edge: false });

    // Side strips beside each house are visible in the street and yard frames.
    const sideWidth = HOUSE_HALF_LEN + MARGIN;
    const [sideZ0, sideZ1] = clampRange(s * (FRONT_LAWN_OUTER + MARGIN), s * (HOUSE_BACK - MARGIN));
    zones.push({ x0: YARD_X_MIN + MARGIN, x1: -sideWidth, z0: sideZ0, z1: sideZ1, count: 100, edge: true });
    zones.push({ x0: sideWidth, x1: YARD_X_MAX - MARGIN, z0: sideZ0, z1: sideZ1, count: 100, edge: true });
  }
  return zones;
}

function sampleZones(zones: Zone[], rand: () => number, edge: boolean): Point[] {
  const points: Point[] = [];
  for (const zone of zones) {
    if (zone.edge !== edge) continue;
    const [x0, x1] = clampRange(zone.x0, zone.x1);
    const [z0, z1] = clampRange(zone.z0, zone.z1);
    if (x1 - x0 < 0.2 || z1 - z0 < 0.2) continue;
    for (let i = 0; i < zone.count; i++) {
      // A staggered lattice keeps the grass legible as clumps instead of white
      // noise while the small deterministic jitter prevents visible rows.
      const u = ((i * 0.61803398875 + rand() * 0.24) % 1 + 1) % 1;
      const v = ((i * 0.75487766625 + rand() * 0.24) % 1 + 1) % 1;
      points.push({
        x: x0 + u * (x1 - x0),
        z: z0 + v * (z1 - z0),
        h: edge ? 0.24 + rand() * 0.15 : 0.17 + rand() * 0.11,
        w: edge ? 0.80 + rand() * 0.32 : 0.64 + rand() * 0.24,
        yaw: rand() * Math.PI * 2,
      });
    }
  }
  return points;
}

function isLawnMaterial(value: THREE.Material | THREE.Material[] | undefined, lawn: THREE.Material): boolean {
  return Array.isArray(value) ? value.includes(lawn) : value === lawn;
}

/**
 * Accept only the first downward hit. If a deck, patio, pad, garage floor,
 * prop, or house occupies the sample, its nearer hit rejects the point even if
 * the lawn mesh is underneath it. This is a build-time validation pass, not a
 * runtime raycast system.
 */
function onVisibleLawn(
  x: number,
  z: number,
  groups: SurfaceGroups,
  lawn: THREE.Material,
  raycaster: THREE.Raycaster,
  origin: THREE.Vector3,
  down: THREE.Vector3,
): boolean {
  raycaster.set(origin.set(x, 48, z), down);
  const first = raycaster.intersectObjects(groups, true)[0];
  if (!first || first.point.y < LAWN_TOP - 0.025 || first.point.y > LAWN_TOP + 0.025) return false;
  const mesh = first.object as THREE.Mesh;
  return isLawnMaterial(mesh.material, lawn);
}

function makeMesh(
  name: string,
  points: Point[],
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, points.length);
  mesh.name = name;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.userData.ntPresentationOnly = true;
  mesh.userData.ntLayer = 'ground-detail';
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const scale = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    quat.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
    pos.set(p.x, LAWN_TOP, p.z);
    scale.set(p.w, p.h, p.w);
    mesh.setMatrixAt(i, matrix.compose(pos, quat, scale));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  return mesh;
}

export function buildGroundDetail(ctx: BuildContext, existingGroups: SurfaceGroups): BuildResult {
  const g = new THREE.Group();
  g.name = 'ground-detail';
  // Builders may be handed to us before the first render has propagated parent
  // transforms. Prepare each static group once so every validation ray sees the
  // same world-space mesh the renderer will see; there is no frame-loop update.
  for (const existing of existingGroups) existing.updateMatrixWorld(true);
  const zones = makeZones();
  const candidatesEdge = sampleZones(zones, ctx.rand, true);
  const candidatesField = sampleZones(zones, ctx.rand, false);
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  const rayGroups = existingGroups.slice();
  const accepts = (p: Point): boolean => onVisibleLawn(p.x, p.z, rayGroups, ctx.mat.lawn, raycaster, origin, down);
  const edge = candidatesEdge.filter(accepts);
  const field = candidatesField.filter(accepts);
  // Keep the stronger silhouette on the edges and the low field breakup separate
  // so each material compiles once and no per-instance colour attribute is needed.
  const edgeMaterial = ctx.mat.painted(PAL.lawnLight, 0.94, 0);
  const fieldMaterial = ctx.mat.painted(PAL.lawn, 0.98, 0);
  const geo = bladeGeometry();
  g.add(makeMesh('ground-detail-edge-grass', edge, geo, edgeMaterial));
  g.add(makeMesh('ground-detail-field-grass', field, geo, fieldMaterial));
  g.userData.ntGroundDetailStats = {
    candidates: candidatesEdge.length + candidatesField.length,
    accepted: edge.length + field.length,
    rejected: candidatesEdge.length + candidatesField.length - edge.length - field.length,
  };
  return { group: g, colliders: [] };
}
