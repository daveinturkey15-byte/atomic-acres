/**
 * FENCE-BOARD COURSES - one merged, photo-textured mesh for every horizontal
 * fence course board on the map.
 *
 * Why this exists: the course boards used to be instanced unit boxes whose
 * 0..1 box UVs stretched the whole plank photo across each face - across an
 * 84 m boundary run that is a smear, not wood. Here the long faces carry
 * physical local UVs: U and V use one uniform art-scale tile across the board
 * (the Poly Haven wooden_planks set is a declared 2 m x 2 m surface), and V is
 * confined to a MEASURED seam-free plank-interior window of the photo (rows
 * verified against the actual diffuse pixels, see docs/fence-uv-canary.md),
 * so no horizontal photo gap line can appear inside a geometric board. Courses
 * cycle through deterministic 56 px windows. The board uses a uniform art
 * scale: 0.25 m across 56 source pixels implies 4.57142857 m per full UV
 * tile in both axes, deliberately 2.285714x the provider's declared 2 m
 * surface scale so the complete board crop fits without crossing a seam.
 *
 * Deterministic and RNG-free: same inputs give byte-identical buffers. No
 * scene, camera, renderer or light is touched; the caller owns the material
 * (one singleton from core/materials) and the parent group. Every temporary
 * per-box geometry is disposed after the merge, so the steady state is ONE
 * BufferGeometry on ONE Mesh with ONE material.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** One solid segment of a fence run (holes already removed), world-space ends. */
export interface FenceBoardSeg {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** metres from the run start to this segment's start; keeps U continuous across holes */
  u0?: number;
}

/** Board geometry, mirroring the yards.ts fence build it replaced. */
export const FENCE_BOARDS = {
  THICKNESS: 0.06,
  HEIGHT: 0.25,
  COURSES: 5,
  /** 0.25 board + 0.02 gap, as built before this helper existed */
  PITCH: 0.27,
  /** PLINTH_H 0.5 + COPING_H 0.08 - boards start on the coping */
  BASE_Y: 0.58,
  /** uniform art-scale metres per UV tile; 0.25 m / 56 px at 1024² */
  METRES_PER_U_TILE: 4.571428571428571,
} as const;

/**
 * Measured seam-free plank-interior windows, in diffuse-image rows
 * (0 = image top, 1024 px texture). Qualification is measured on the actual
 * diffuse pixels (exact commands + outputs in docs/fence-uv-canary.md):
 * every window row stays outside the complete diffuse scan's measured
 * median<85 dark bands, and each window lies strictly inside a seam-free
 * stretch. The 56 px windows use high-margin clear intervals: 10..66,
 * 289..345, 550..606, 828..884. Dark woodgrain inside a clear interval is
 * legitimate texture and is not classified as a horizontal plank gap.
 */
export const PLANK_WINDOWS = [
  { top: 10, bottom: 66 },
  { top: 289, bottom: 345 },
  { top: 550, bottom: 606 },
  { top: 828, bottom: 884 },
] as const;

export const PLANK_TEXTURE_SIZE = 1024;

/** Image rows -> UV V range (three flips images, v=1 is the image top row). */
export function plankWindowUV(course: number): { vBot: number; vTop: number } {
  const w = PLANK_WINDOWS[course % PLANK_WINDOWS.length];
  return {
    vBot: 1 - w.bottom / PLANK_TEXTURE_SIZE,
    vTop: 1 - w.top / PLANK_TEXTURE_SIZE,
  };
}

/**
 * Rewrite one unit box's UVs before it is scaled/rotated into place.
 * BoxGeometry face/vertex order (pinned by the verify harness): +x, -x,
 * +y, -y, +z, -z, four vertices each. The long faces are +x/-x: U is
 * physical along the run, V is the course's plank-interior window.
 */
function rewriteBoxUVs(geo: THREE.BufferGeometry, len: number, u0: number, course: number): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const { vBot, vTop } = plankWindowUV(course);
  const uRun = (zl: number): number =>
    (u0 + (zl + 0.5) * len) / FENCE_BOARDS.METRES_PER_U_TILE;
  // 4%-wide slice of the same tile for the 6 cm end faces, kept inside (0,1)
  const uSlice = 0.48 + ((u0 / FENCE_BOARDS.METRES_PER_U_TILE) % 1) * 0.04;
  for (let i = 0; i < 24; i++) {
    const xl = pos.getX(i);
    const yl = pos.getY(i);
    const zl = pos.getZ(i);
    if (i < 8) {
      // board faces: physical U along the run, window across the height
      uv.setXY(i, uRun(zl), vBot + (yl + 0.5) * (vTop - vBot));
    } else if (i < 16) {
      // top/bottom edges: physical U along the run, window across the thickness
      uv.setXY(i, uRun(zl), vBot + (xl + 0.5) * (vTop - vBot));
    } else {
      // end faces: fixed slice, window across the height
      uv.setXY(i, uSlice + (xl + 0.5) * 0.04, vBot + (yl + 0.5) * (vTop - vBot));
    }
  }
  uv.needsUpdate = true;
}

export interface FenceBoardsBuild {
  mesh: THREE.Mesh;
  boxes: number;
  triangles: number;
  longestSegMetres: number;
}

/**
 * Merge every course box of every segment into ONE mesh. One draw call for
 * the whole map's fence courses, one material, no per-board mesh or material.
 */
export function buildFenceCourseBoards(
  segs: readonly FenceBoardSeg[],
  material: THREE.Material,
): FenceBoardsBuild {
  const parts: THREE.BufferGeometry[] = [];
  let longest = 0;
  const mtx = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  for (const seg of segs) {
    const dx = seg.x1 - seg.x0;
    const dz = seg.z1 - seg.z0;
    const len = Math.hypot(dx, dz);
    if (!(len > 0)) throw new Error('fence-boards: zero-length segment');
    longest = Math.max(longest, len);
    const ry = Math.atan2(dx, dz); // same yaw convention as the yards Batch.put boxes
    const u0 = seg.u0 ?? 0;
    for (let c = 0; c < FENCE_BOARDS.COURSES; c++) {
      const geo = new THREE.BoxGeometry(1, 1, 1);
      rewriteBoxUVs(geo, len, u0, c);
      euler.set(0, ry, 0);
      quat.setFromEuler(euler);
      mtx.compose(
        pos.set(
          seg.x0 + dx / 2,
          FENCE_BOARDS.BASE_Y + FENCE_BOARDS.HEIGHT / 2 + c * FENCE_BOARDS.PITCH,
          seg.z0 + dz / 2,
        ),
        quat,
        scl.set(FENCE_BOARDS.THICKNESS, FENCE_BOARDS.HEIGHT, len),
      );
      geo.applyMatrix4(mtx);
      parts.push(geo);
    }
  }
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error('fence-boards: mergeGeometries returned null');
  for (const p of parts) p.dispose(); // steady state owns exactly one geometry
  const mesh = new THREE.Mesh(merged, material);
  mesh.name = 'fence-course-boards';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return {
    mesh,
    boxes: parts.length,
    triangles: (merged.index?.count ?? 0) / 3,
    longestSegMetres: longest,
  };
}
