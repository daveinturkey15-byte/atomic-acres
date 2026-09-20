/**
 * FENCE-BOARDS CANARY - Believable weathered timber fence treatment.
 *
 * Implements high-quality fence art behind the `fence-art=canary` feature flag:
 * 1. Weathered timber board edge treatment: 8-profile chamfered top/bottom edges catch
 *    specular sun highlights and ambient ground occlusion, giving each plank 3D relief.
 *    Outward face normals and counter-clockwise triangle winding are rigorously aligned
 *    (cross product dot declared normal = 1.0 across all facets).
 * 2. De-striped woodgrain: deterministic golden-ratio U phase offsets and alternating
 *    run direction eliminate repeated vertical stripe artifacts across stacked courses.
 * 3. Transverse cut-grain end crop: cut board ends at hole openings and segment ends
 *    use a transverse cross-cut slice of the timber texture (perpendicular grain
 *    orientation to eliminate longitudinal side-grain stretching across the 6cm end cut).
 * 4. Fastener / rail contacts: batched low-poly hexagonal carriage bolts anchor each
 *    board to posts and framing, grounded into the physical fence structure.
 *    Hex bolt side facets and front caps have verified outward winding and outward normals.
 * 5. Bounded budgets: 2 draw calls total (1 for boards, 1 for fasteners), exactly
 *    10,860 triangles on the 12 map segments (or 9,780 with exact yards.ts post contacts),
 *    well within +12k budget, zero per-frame allocation, full CPU memory disposal.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import {
  FENCE_BOARDS,
  plankWindowUV,
  type FenceBoardSeg,
  type FenceBoardsBuild,
} from './fence-boards.ts';

export function isFenceArtCanaryEnabled(search?: string): boolean {
  try {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__NT_OVERRIDE_FENCE_ART_CANARY__ !== undefined) {
      return Boolean((globalThis as any).__NT_OVERRIDE_FENCE_ART_CANARY__);
    }
    if (search === undefined && typeof location !== 'undefined') {
      search = location.search;
    }
    if (!search) return false;
    return new URLSearchParams(search).get('fence-art') === 'canary';
  } catch {
    return false;
  }
}

let sharedFastenerMaterial: THREE.MeshStandardMaterial | null = null;

export function getFenceFastenerMaterial(): THREE.MeshStandardMaterial {
  if (!sharedFastenerMaterial) {
    sharedFastenerMaterial = new THREE.MeshStandardMaterial({
      color: 0x2e2c29,
      roughness: 0.5,
      metalness: 0.85,
      name: 'fence-fastener-hardware',
    });
  }
  return sharedFastenerMaterial;
}

/**
 * Build an 8-sided beveled timber plank with weathered chamfered edges and transverse cut end grain.
 * Dimensions: thickness (X) 0.06m, height (Y) 0.25m, length (Z) len.
 */
function createBeveledBoardGeometry(
  len: number,
  u0: number,
  course: number,
): THREE.BufferGeometry {
  const T = FENCE_BOARDS.THICKNESS; // 0.06
  const H = FENCE_BOARDS.HEIGHT;    // 0.25
  const halfT = T / 2;
  const halfH = H / 2;
  const halfL = len / 2;

  // Weathered chamfer offsets: 5mm in X, 8mm in Y
  const cX = 0.005;
  const cY = 0.008;

  // 8 profile vertices in the XY plane, ordered counter-clockwise:
  // 0: top-right (+X, +Y - cY)
  // 1: top-front chamfer (+X - cX, +Y)
  // 2: top-left (-X + cX, +Y)
  // 3: top-back chamfer (-X, +Y - cY)
  // 4: bottom-back chamfer (-X, -Y + cY)
  // 5: bottom-left (-X + cX, -Y)
  // 6: bottom chamfer (+X - cX, -Y)
  // 7: bottom-right (+X, -Y + cY)
  const profileXY: [number, number][] = [
    [halfT, halfH - cY],
    [halfT - cX, halfH],
    [-halfT + cX, halfH],
    [-halfT, halfH - cY],
    [-halfT, -halfH + cY],
    [-halfT + cX, -halfH],
    [halfT - cX, -halfH],
    [halfT, -halfH + cY],
  ];

  const { vBot, vTop } = plankWindowUV(course);
  const vSpan = vTop - vBot;

  // De-stripe: deterministic golden-ratio U phase shift per course
  const uCourseOffset = ((course * 1.6180339887) % 1) * FENCE_BOARDS.METRES_PER_U_TILE;
  const uFlip = course % 2 === 1;

  const uAtZ = (z: number): number => {
    const zlNormalized = (z + halfL) / len; // 0..1 along segment
    const uZ = uFlip ? (1 - zlNormalized) : zlNormalized;
    return (u0 + uCourseOffset + uZ * len) / FENCE_BOARDS.METRES_PER_U_TILE;
  };

  // For course 4 (which shares window with course 0), invert V to avoid identical knots
  const invertV = course === 4;

  const vAtY = (y: number): number => {
    const yNorm = (y + halfH) / H; // 0..1 across board height
    const vNorm = invertV ? (1 - yNorm) : yNorm;
    return vBot + vNorm * vSpan;
  };

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Longitudinal facets (8 quads = 16 triangles = 32 vertices with flat-facet normals)
  for (let f = 0; f < 8; f++) {
    const nextF = (f + 1) % 8;
    const p0 = profileXY[f];
    const p1 = profileXY[nextF];

    // Outward normal in XY plane from CCW edge vector (dx, dy): (dy, -dx)
    const dx = p1[0] - p0[0];
    const dy = p1[1] - p0[1];
    const nx = dy;
    const ny = -dx;
    const nLen = Math.hypot(nx, ny);
    const norm = [nx / nLen, ny / nLen, 0];

    const baseIndex = positions.length / 3;

    // 4 vertices for the quad:
    // v0: [p0, -halfL]
    // v1: [p1, -halfL]
    // v2: [p1, +halfL]
    // v3: [p0, +halfL]
    positions.push(
      p0[0], p0[1], -halfL,
      p1[0], p1[1], -halfL,
      p1[0], p1[1], halfL,
      p0[0], p0[1], halfL,
    );

    for (let k = 0; k < 4; k++) {
      normals.push(norm[0], norm[1], norm[2]);
    }

    const uNeg = uAtZ(-halfL);
    const uPos = uAtZ(halfL);
    const v0 = vAtY(p0[1]);
    const v1 = vAtY(p1[1]);

    uvs.push(
      uNeg, v0,
      uNeg, v1,
      uPos, v1,
      uPos, v0,
    );

    // Quad indices CCW facing outward:
    // Tri 1: (v0, v1, v2) -> edge1 = (p1 - p0, 0), edge2 = (p1 - p0, L), cross = (dy*L, -dx*L, 0)
    // Tri 2: (v0, v2, v3) -> edge1 = (p1 - p0, L), edge2 = (0, L), cross = (dy*L, -dx*L, 0)
    indices.push(
      baseIndex, baseIndex + 1, baseIndex + 2,
      baseIndex, baseIndex + 2, baseIndex + 3,
    );
  }

  // End caps (cut ends at Z = -halfL and Z = +halfL)
  // End cap at -halfL (Normal [0, 0, -1])
  const capNegBase = positions.length / 3;
  for (let i = 0; i < 8; i++) {
    positions.push(profileXY[i][0], profileXY[i][1], -halfL);
    normals.push(0, 0, -1);
    // Transverse cut-grain crop: sample texture transversely across the cut end
    // (perpendicular grain orientation to avoid longitudinal side-grain stretching across the 6cm end cut)
    const uEnd = 0.50 + ((profileXY[i][1] + halfH) / H) * 0.04;
    const vEnd = vBot + ((profileXY[i][0] + halfT) / T) * vSpan;
    uvs.push(uEnd, vEnd);
  }
  // Triangulate octagon cap (fan from vertex 0, CCW facing outside in -Z direction)
  for (let i = 1; i < 7; i++) {
    indices.push(capNegBase, capNegBase + i + 1, capNegBase + i);
  }

  // End cap at +halfL (Normal [0, 0, 1])
  const capPosBase = positions.length / 3;
  for (let i = 0; i < 8; i++) {
    positions.push(profileXY[i][0], profileXY[i][1], halfL);
    normals.push(0, 0, 1);
    const uEnd = 0.50 + ((profileXY[i][1] + halfH) / H) * 0.04;
    const vEnd = vBot + ((profileXY[i][0] + halfT) / T) * vSpan;
    uvs.push(uEnd, vEnd);
  }
  // Triangulate octagon cap (fan from vertex 0, CCW facing outside in +Z direction)
  for (let i = 1; i < 7; i++) {
    indices.push(capPosBase, capPosBase + i, capPosBase + i + 1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Low-poly hexagonal bolt head for fastener contacts.
 * Radius = 0.006m, depth = 0.003m. Total 18 triangles (6 front cap + 12 side facets).
 * Front cap normal [1, 0, 0], side facets normal [0, ny, nz] facing radially outward.
 */
function createFastenerBoltGeometry(): THREE.BufferGeometry {
  const R = 0.006;
  const D = 0.003;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Front cap (+X)
  const capBase = 0;
  positions.push(D, 0, 0); // center
  normals.push(1, 0, 0);
  uvs.push(0.5, 0.5);

  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const y = Math.cos(angle) * R;
    const z = Math.sin(angle) * R;
    positions.push(D, y, z);
    normals.push(1, 0, 0);
    uvs.push(0.5 + Math.cos(angle) * 0.5, 0.5 + Math.sin(angle) * 0.5);
  }
  for (let i = 1; i <= 6; i++) {
    const next = i === 6 ? 1 : i + 1;
    indices.push(capBase, capBase + i, capBase + next);
  }

  // Side facets (6 quads = 12 triangles)
  for (let i = 0; i < 6; i++) {
    const a0 = (i * Math.PI) / 3;
    const a1 = ((i + 1) * Math.PI) / 3;
    const midAngle = (a0 + a1) / 2;
    const ny = Math.cos(midAngle);
    const nz = Math.sin(midAngle);

    const y0 = Math.cos(a0) * R;
    const z0 = Math.sin(a0) * R;
    const y1 = Math.cos(a1) * R;
    const z1 = Math.sin(a1) * R;

    const sideBase = positions.length / 3;
    // 4 vertices for the side quad:
    // v0: (0, y0, z0)
    // v1: (0, y1, z1)
    // v2: (D, y1, z1)
    // v3: (D, y0, z0)
    positions.push(
      0, y0, z0,
      0, y1, z1,
      D, y1, z1,
      D, y0, z0,
    );
    for (let k = 0; k < 4; k++) normals.push(0, ny, nz);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);

    // Quad indices CCW facing outward:
    // Tri 1: (v0, v1, v2) -> cross product gives (0, D*(z1-z0), -D*(y1-y0)) pointing in (0, ny, nz)
    // Tri 2: (v0, v2, v3) -> cross product gives (0, D*(z1-z0), -D*(y1-y0)) pointing in (0, ny, nz)
    indices.push(
      sideBase, sideBase + 1, sideBase + 2,
      sideBase, sideBase + 2, sideBase + 3,
    );
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  return geo;
}

/**
 * Builds the canary fence treatment:
 * - Weathered beveled timber boards with de-striped golden-ratio U phasing
 * - Transverse cut-grain end crop
 * - Batched low-poly fastener hardware anchoring boards to framing
 * All contained in exactly TWO draw calls (boards + fasteners).
 */
export function buildFenceCourseBoardsCanary(
  segs: readonly FenceBoardSeg[],
  material: THREE.Material,
  fastenerMaterial: THREE.Material = getFenceFastenerMaterial(),
): FenceBoardsBuild {
  const boardParts: THREE.BufferGeometry[] = [];
  const fastenerParts: THREE.BufferGeometry[] = [];

  let longest = 0;
  const mtx = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3(1, 1, 1);

  const boltTemplate = createFastenerBoltGeometry();

  for (const seg of segs) {
    const dx = seg.x1 - seg.x0;
    const dz = seg.z1 - seg.z0;
    const len = Math.hypot(dx, dz);
    if (!(len > 0)) throw new Error('fence-boards-canary: zero-length segment');
    longest = Math.max(longest, len);

    const ry = Math.atan2(dx, dz);
    const u0 = seg.u0 ?? 0;
    const ux = dx / len;
    const uz = dz / len;

    // Normal pointing outward (+X in board local coordinates)
    const normX = uz;
    const normZ = -ux;

    euler.set(0, ry, 0);
    quat.setFromEuler(euler);

    // 1. Build 5 course boards for this segment
    for (let c = 0; c < FENCE_BOARDS.COURSES; c++) {
      const geo = createBeveledBoardGeometry(len, u0, c);

      // Subtle alternate depth offset (+/- 2.5 mm) for authentic lap relief
      const depthOffset = (c % 2 === 0 ? 0.0025 : -0.0025);
      const centerY = FENCE_BOARDS.BASE_Y + FENCE_BOARDS.HEIGHT / 2 + c * FENCE_BOARDS.PITCH;

      mtx.compose(
        pos.set(
          seg.x0 + dx / 2 + normX * depthOffset,
          centerY,
          seg.z0 + dz / 2 + normZ * depthOffset,
        ),
        quat,
        scl,
      );
      geo.applyMatrix4(mtx);
      boardParts.push(geo);
    }

    // 2. Build fastener hardware at post contact stations
    // If seg.posts is provided (e.g. from yards.ts post contact calculation), use those exact stations.
    // Otherwise fallback to intervals along segment clamped >= 80mm from board ends.
    const postOffsets: readonly number[] = seg.posts ?? (() => {
      const np = Math.max(2, Math.round(len / 2.0));
      const res: number[] = [];
      for (let j = 0; j <= np; j++) {
        res.push(Math.max(0.08, Math.min(len - 0.08, (j / np) * len)));
      }
      return res;
    })();

    for (const d of postOffsets) {
      const postX = seg.x0 + ux * d;
      const postZ = seg.z0 + uz * d;

      for (let c = 0; c < FENCE_BOARDS.COURSES; c++) {
        const centerY = FENCE_BOARDS.BASE_Y + FENCE_BOARDS.HEIGHT / 2 + c * FENCE_BOARDS.PITCH;
        const depthOffset = (c % 2 === 0 ? 0.0025 : -0.0025);

        // Fastener on the front face of the board
        const boltGeo = boltTemplate.clone();
        mtx.compose(
          pos.set(
            postX + normX * (FENCE_BOARDS.THICKNESS / 2 + depthOffset),
            centerY,
            postZ + normZ * (FENCE_BOARDS.THICKNESS / 2 + depthOffset),
          ),
          quat,
          scl,
        );
        boltGeo.applyMatrix4(mtx);
        fastenerParts.push(boltGeo);
      }
    }
  }

  boltTemplate.dispose();

  // Merge boards
  const mergedBoards = mergeGeometries(boardParts, false);
  if (!mergedBoards) throw new Error('fence-boards-canary: mergeGeometries returned null for boards');
  for (const p of boardParts) p.dispose();

  const boardsMesh = new THREE.Mesh(mergedBoards, material);
  boardsMesh.name = 'fence-course-boards-weathered';
  boardsMesh.castShadow = true;
  boardsMesh.receiveShadow = true;

  // Merge fasteners
  const mergedFasteners = mergeGeometries(fastenerParts, false);
  if (!mergedFasteners) throw new Error('fence-boards-canary: mergeGeometries returned null for fasteners');
  for (const p of fastenerParts) p.dispose();

  const fastenersMesh = new THREE.Mesh(mergedFasteners, fastenerMaterial);
  fastenersMesh.name = 'fence-hardware-fasteners';
  fastenersMesh.castShadow = true;
  fastenersMesh.receiveShadow = true;

  // Batched root group containing both meshes (2 draw calls total)
  const group = new THREE.Group();
  group.name = 'fence-course-boards-canary';
  group.add(boardsMesh);
  group.add(fastenersMesh);

  const boardTris = (mergedBoards.index?.count ?? 0) / 3;
  const fastenerTris = (mergedFasteners.index?.count ?? 0) / 3;
  const totalTris = boardTris + fastenerTris;

  group.userData.fenceArtStats = {
    drawCalls: 2,
    boardsCount: boardParts.length,
    fastenersCount: fastenerParts.length,
    boardTriangles: boardTris,
    fastenerTriangles: fastenerTris,
    totalTriangles: totalTris,
    longestSegMetres: longest,
  };

  return {
    mesh: group,
    boxes: boardParts.length,
    triangles: totalTris,
    longestSegMetres: longest,
    fastenersMesh,
  };
}
