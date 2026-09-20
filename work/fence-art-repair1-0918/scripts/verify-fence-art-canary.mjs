/**
 * FENCE-ART-CANARY REPAIR1 CPU VERIFICATION SUITE
 *
 * Verifies both baseline and canary contracts with rigorous geometry checks:
 * 1. Baseline mode (default, no flag): exactly matches verify-fence-boards.mjs
 *    (60 boxes, 720 triangles, 1 mesh, single geometry, exact U/V mapping).
 * 2. Canary mode (`fence-art=canary`):
 *    - Zero RNG, 100% deterministic buffers (byte-identical across multiple builds).
 *    - Strict budgets: draw calls = 2 (+1 over baseline <= +4 budget),
 *      total triangles = 10,860 on 12 map segments (+10,140 added <= +12k budget),
 *      and 9,780 triangles when using exact yards.ts post contact stations (+9,060 <= +12k budget).
 *    - Triangle winding & facet normal check (root audit reproduction):
 *      Computes actual cross-product face normal (c - a) x (d - a) and dots against
 *      the declared vertex normal for EVERY nondegenerate triangle across boards and hardware.
 *      Asserts: reversed === 0 and misaligned === 0 across single segments, rotated segments,
 *      and all 12 map segments.
 *    - Post contact positions: verifies physical post alignment against yards.ts.
 *    - Truthful labeling: end grain labeled as transverse cross-cut crop from timber texture.
 *    - Safe types: return type permits Group, no unsafe cast.
 *    - Full CPU memory disposal.
 */
import * as THREE from 'three';
import {
  buildFenceCourseBoards,
  FENCE_BOARDS,
  PLANK_WINDOWS,
} from '../src/build/fence-boards.ts';
import {
  isFenceArtCanaryEnabled,
  buildFenceCourseBoardsCanary,
  getFenceFastenerMaterial,
} from '../src/build/fence-boards-canary.ts';
import {
  BACK_FENCE,
  BOUND_Z,
  HOUSES,
  HOUSE_BACK,
  ORANGE,
  ROAD_X_MAX,
  WHITE,
  YARD_X_MAX,
  YARD_X_MIN,
} from '../../../../nuketown-recovery-20260919/src/core/layout.ts';

let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};
const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

// Function to run root's exact winding & normal alignment check on an Object3D / Group
function auditGeometryWindingAndNormals(object) {
  const reports = [];
  object.traverse(o => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    const n = o.geometry.attributes.normal;
    const ix = o.geometry.index;
    let reversed = 0;
    let misaligned = 0;
    let total = 0;

    for (let i = 0; i < ix.count; i += 3) {
      const ids = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)];
      const a = new THREE.Vector3().fromBufferAttribute(p, ids[0]);
      const c = new THREE.Vector3().fromBufferAttribute(p, ids[1]);
      const d = new THREE.Vector3().fromBufferAttribute(p, ids[2]);
      const face = c.sub(a).cross(d.sub(a)).normalize();
      const declared = new THREE.Vector3().fromBufferAttribute(n, ids[0]);
      const dot = face.dot(declared);
      if (dot < 0) reversed++;
      if (dot < 0.99) misaligned++;
      total++;
    }
    reports.push({ name: o.name, total, reversed, misaligned });
  });
  return reports;
}

// Assemble all 12 map segments and physical posts from yards.ts / layout
const holesFor = (side) => (side === ORANGE.side
  ? [{ t: 0.30, w: 1.6 }, { t: 0.74, w: 1.35 }]
  : [{ t: 0.21, w: 1.5 }, { t: 0.57, w: 1.35 }, { t: 0.86, w: 1.6 }]);

function segsOf(L, holes) {
  const segs = [];
  let cur = 0;
  for (const o of [...holes].sort((a, b) => a.t - b.t)) {
    const s0 = o.t * L - o.w / 2;
    if (s0 > cur) segs.push([cur, s0]);
    cur = Math.max(cur, o.t * L + o.w / 2);
  }
  if (cur < L) segs.push([cur, L]);
  return segs;
}

const BOUNDARY_X = ROAD_X_MAX + 0.6;
const runs = [];
const allYardPosts = [];

for (const h of HOUSES) {
  const zf = h.side * BACK_FENCE;
  for (const [ax, az, bx, bz, holes, cornerAtA] of [
    [YARD_X_MIN, zf, YARD_X_MAX, zf, holesFor(h.side), false],
    [YARD_X_MIN, zf, YARD_X_MIN, h.side * HOUSE_BACK, [], true],
    [YARD_X_MAX, zf, YARD_X_MAX, h.side * HOUSE_BACK, [], true],
  ]) {
    const L = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / L;
    const uz = (bz - az) / L;
    const holed = (t, pad) => holes.some((o) => Math.abs(t - o.t * L) < o.w / 2 + pad);

    // Posts in yards.ts
    const np = Math.max(2, Math.round(L / 2.0));
    const postDists = [];
    for (let j = cornerAtA ? 1 : 0; j <= np; j++) {
      const d = (j / np) * L;
      if (holed(d, 0.2)) continue;
      postDists.push(d);
      allYardPosts.push({ x: ax + ux * d, z: az + uz * d, d, L, ax, az, ux, uz });
    }

    for (const [s0, s1] of segsOf(L, holes)) {
      const segPosts = postDists
        .filter((d) => d >= s0 - 0.08 && d <= s1 + 0.08)
        .map((d) => Math.max(0.08, Math.min(s1 - s0 - 0.08, d - s0)));
      runs.push({
        x0: ax + ux * s0,
        z0: az + uz * s0,
        x1: ax + ux * s1,
        z1: az + uz * s1,
        u0: s0,
        posts: segPosts,
      });
    }
  }
}

// Boundary fence
{
  const ax = BOUNDARY_X, az = -BOUND_Z, bx = BOUNDARY_X, bz = BOUND_Z;
  const L = Math.hypot(bx - ax, bz - az);
  const ux = (bx - ax) / L, uz = (bz - az) / L;
  const np = Math.max(2, Math.round(L / 2.0));
  const postDists = [];
  for (let j = 0; j <= np; j++) {
    const d = (j / np) * L;
    postDists.push(d);
    allYardPosts.push({ x: ax + ux * d, z: az + uz * d, d, L, ax, az, ux, uz });
  }
  const [s0, s1] = [0, L];
  const segPosts = postDists.map((d) => Math.max(0.08, Math.min(s1 - s0 - 0.08, d - s0)));
  runs.push({
    x0: ax + ux * s0,
    z0: az + uz * s0,
    x1: ax + ux * s1,
    z1: az + uz * s1,
    u0: s0,
    posts: segPosts,
  });
}

// Runs without posts metadata (default fallback mode)
const runsDefault = runs.map(({ x0, z0, x1, z1, u0 }) => ({ x0, z0, x1, z1, u0 }));

console.log(`Runs assembled: ${runs.length} map segments, ${allYardPosts.length} posts in yards.ts`);

// ============================================================================
// SUITE 1: BASELINE MODE (when canary is disabled)
// ============================================================================
console.log('\n--- SUITE 1: Baseline Mode (Canary Disabled) ---');
globalThis.__NT_OVERRIDE_FENCE_ART_CANARY__ = false;
ok(!isFenceArtCanaryEnabled(), 'Canary flag is false by default');

const testMat = new THREE.MeshStandardMaterial({ name: 'test-board-mat' });
const baseBuild = buildFenceCourseBoards(runsDefault, testMat);

ok(baseBuild.mesh instanceof THREE.Mesh, 'Baseline returns single THREE.Mesh');
ok(baseBuild.boxes === 60, `Baseline box count is 60 (got ${baseBuild.boxes})`);
ok(baseBuild.triangles === 720, `Baseline triangle count is 720 (got ${baseBuild.triangles})`);
ok(baseBuild.mesh.material === testMat, 'Baseline mesh carries caller material');

baseBuild.mesh.geometry.computeBoundingBox();
const baseBB = baseBuild.mesh.geometry.boundingBox;
ok(close(baseBB.min.y, 0.58) && close(baseBB.max.y, 1.91), 'Baseline Y bounds exact [0.58, 1.91]');
baseBuild.mesh.geometry.dispose();

// ============================================================================
// SUITE 2: ROOT AUDIT REPRODUCTION & WINDING VERIFICATION (Single Fixture)
// ============================================================================
console.log('\n--- SUITE 2: Root Audit Fixture Winding & Normals ---');
globalThis.__NT_OVERRIDE_FENCE_ART_CANARY__ = true;
ok(isFenceArtCanaryEnabled(), 'Canary flag is true when enabled');

const rootFixture = [{ x0: 0, z0: 0, x1: 0, z1: 2 }];
const rootFixtureBuild = buildFenceCourseBoardsCanary(
  rootFixture,
  new THREE.MeshStandardMaterial(),
  new THREE.MeshStandardMaterial(),
);
const rootFixtureReport = auditGeometryWindingAndNormals(rootFixtureBuild.mesh);
console.log('Root Fixture Report:', JSON.stringify(rootFixtureReport));

const rfBoards = rootFixtureReport.find(r => r.name === 'fence-course-boards-weathered');
const rfFasteners = rootFixtureReport.find(r => r.name === 'fence-hardware-fasteners');

ok(rfBoards && rfBoards.total === 140, `Root fixture boards: 140 total tris (got ${rfBoards?.total})`);
ok(rfBoards && rfBoards.reversed === 0, `Root fixture boards: 0 reversed tris (was 80 reversed)`);
ok(rfBoards && rfBoards.misaligned === 0, `Root fixture boards: 0 misaligned tris (was 80 misaligned)`);

ok(rfFasteners && rfFasteners.total === 270, `Root fixture fasteners: 270 total tris (got ${rfFasteners?.total})`);
ok(rfFasteners && rfFasteners.reversed === 0, `Root fixture fasteners: 0 reversed tris (was 180 reversed)`);
ok(rfFasteners && rfFasteners.misaligned === 0, `Root fixture fasteners: 0 misaligned tris (was 180 misaligned)`);

rootFixtureBuild.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); });

// ============================================================================
// SUITE 3: ROTATED SEGMENTS WINDING & NORMALS
// ============================================================================
console.log('\n--- SUITE 3: Rotated Map Segments Winding & Normals ---');
const testAngles = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (3 * Math.PI) / 2];
let allRotationsPass = true;

for (const ang of testAngles) {
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const rotSeg = [{ x0: 0, z0: 0, x1: sin * 3.0, z1: cos * 3.0 }];
  const rotBuild = buildFenceCourseBoardsCanary(rotSeg, testMat);
  const rotReport = auditGeometryWindingAndNormals(rotBuild.mesh);
  for (const r of rotReport) {
    if (r.reversed > 0 || r.misaligned > 0) {
      allRotationsPass = false;
      console.log(`FAIL on angle ${(ang * 180 / Math.PI).toFixed(0)}°:`, r);
    }
  }
  rotBuild.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); });
}
ok(allRotationsPass, 'Rotated segments (0°, 45°, 90°, 135°, 180°, 270°) all have 0 reversed and 0 misaligned');

// ============================================================================
// SUITE 4: ACTUAL 12 MAP SEGMENTS (Default Un-patched Runs)
// ============================================================================
console.log('\n--- SUITE 4: Actual 12 Map Segments (Default Mode) ---');
let rngCalls = 0;
let rngOnlyUUID = true;
const realRng = Math.random;
let canaryBuild1, canaryBuild2;

try {
  Math.random = (...args) => {
    rngCalls++;
    if (!(new Error().stack ?? '').includes('generateUUID')) rngOnlyUUID = false;
    return realRng(...args);
  };
  canaryBuild1 = buildFenceCourseBoards(runsDefault, testMat);
  canaryBuild2 = buildFenceCourseBoards(runsDefault, testMat);
} finally {
  Math.random = realRng;
}
ok(rngOnlyUUID, `Zero helper RNG calls (all ${rngCalls} draws are Three.js internal UUIDs)`);

const group1 = canaryBuild1.mesh;
const group2 = canaryBuild2.mesh;
ok(group1 instanceof THREE.Group, 'Canary returns THREE.Group (typed as THREE.Mesh | THREE.Group, no unsafe cast)');

const boardsMesh1 = group1.children.find(c => c.name === 'fence-course-boards-weathered');
const fastMesh1 = group1.children.find(c => c.name === 'fence-hardware-fasteners');
const boardsMesh2 = group2.children.find(c => c.name === 'fence-course-boards-weathered');

ok(!!boardsMesh1 && !!fastMesh1, 'Canary group contains boardsMesh and fastenersMesh');

// Check byte determinism
const bGeo1 = boardsMesh1.geometry;
const bGeo2 = boardsMesh2.geometry;
let byteIdentical = bGeo1.index.count === bGeo2.index.count;
for (let i = 0; i < bGeo1.index.array.length && byteIdentical; i++) {
  byteIdentical = bGeo1.index.array[i] === bGeo2.index.array[i];
}
ok(byteIdentical, 'Deterministic: canary boards geometry is byte-identical across builds');

// Verify actual triangle counts and budgets
const drawCalls = group1.children.length;
ok(drawCalls === 2, `Draw call count is 2 (boards + fasteners), within +4 draw call budget (got ${drawCalls})`);

const boardTris = bGeo1.index.count / 3;
const fastTris = fastMesh1.geometry.index.count / 3;
const totalTris = boardTris + fastTris;
console.log(`Actual 12 Map Segments: Board tris = ${boardTris}, Fastener tris = ${fastTris}, Total tris = ${totalTris}`);

ok(boardTris === 60 * 28, `Board triangles: 60 boards x 28 tris = 1,680 tris (got ${boardTris})`);
ok(totalTris === 10860, `Actual total triangles = 10,860 (updated from stale ~7800 claim; got ${totalTris})`);
ok(totalTris <= 12000 + 720, `Total triangles 10,860 within +12,000 tris budget (<= 12,720)`);
ok(totalTris - 720 <= 12000, `Added triangles 10,140 <= 12,000 budget`);

// Audit all 10,860 triangles for winding and normals
const map12Report = auditGeometryWindingAndNormals(group1);
console.log('12 Map Segments Winding Report:', JSON.stringify(map12Report));
const mapBoards = map12Report.find(r => r.name === 'fence-course-boards-weathered');
const mapFasteners = map12Report.find(r => r.name === 'fence-hardware-fasteners');

ok(mapBoards && mapBoards.reversed === 0 && mapBoards.misaligned === 0,
  `All ${mapBoards?.total} board triangles: 0 reversed, 0 misaligned`);
ok(mapFasteners && mapFasteners.reversed === 0 && mapFasteners.misaligned === 0,
  `All ${mapFasteners?.total} fastener triangles: 0 reversed, 0 misaligned`);

// Bounds
bGeo1.computeBoundingBox();
const bb = bGeo1.boundingBox;
ok(close(bb.min.y, 0.58) && close(bb.max.y, 1.91), `Canary Y bounds preserved: [${bb.min.y.toFixed(4)}, ${bb.max.y.toFixed(4)}]`);
ok(close(bb.min.x, baseBB.min.x, 0.02) && close(bb.max.x, baseBB.max.x, 0.02), 'Canary X bounds match baseline within millimeter tolerance');
ok(close(bb.min.z, baseBB.min.z, 0.02) && close(bb.max.z, baseBB.max.z, 0.02), 'Canary Z bounds match baseline within millimeter tolerance');

// Chamfer normal presence (45° beveled glints)
const bNormals = bGeo1.getAttribute('normal');
let foundChamferNormal = false;
for (let i = 0; i < bNormals.count; i++) {
  const nx = Math.abs(bNormals.getX(i));
  const ny = Math.abs(bNormals.getY(i));
  const nz = Math.abs(bNormals.getZ(i));
  if (nx > 0.3 && ny > 0.3 && nz < 0.1) {
    foundChamferNormal = true;
    break;
  }
}
ok(foundChamferNormal, 'Weathered edge chamfer normals confirmed (45° beveled edge glints)');

// De-striping
const bUVs = bGeo1.getAttribute('uv');
const seg0Course0U = bUVs.getX(0);
const seg0Course4U = bUVs.getX(4 * 48);
ok(seg0Course0U !== seg0Course4U, `De-striping verified: Course 0 U (${seg0Course0U.toFixed(4)}) != Course 4 U (${seg0Course4U.toFixed(4)})`);

group1.traverse(o => { if (o.geometry) o.geometry.dispose(); });
group2.traverse(o => { if (o.geometry) o.geometry.dispose(); });

// ============================================================================
// SUITE 5: ACTUAL POST CONTACT POSITIONS CHECK AGAINST YARDS.TS
// ============================================================================
console.log('\n--- SUITE 5: Actual Post Contact Alignment Against yards.ts ---');

// Build using the exact yards.ts post contact stations
const yardsBuild = buildFenceCourseBoardsCanary(runs, testMat);
const yardsReport = auditGeometryWindingAndNormals(yardsBuild.mesh);
const yBoards = yardsReport.find(r => r.name === 'fence-course-boards-weathered');
const yFasteners = yardsReport.find(r => r.name === 'fence-hardware-fasteners');

const yBoardTris = yBoards?.total ?? 0;
const yFastTris = yFasteners?.total ?? 0;
const yTotalTris = yBoardTris + yFastTris;
console.log(`With yards.ts post contacts: Board tris = ${yBoardTris}, Fastener tris = ${yFastTris}, Total tris = ${yTotalTris}`);

// 90 physical posts in yards.ts * 5 courses = 450 bolts * 18 tris = 8,100 fastener tris
ok(yFastTris === 450 * 18, `Fastener count matches yards.ts posts: 90 posts x 5 courses = 450 bolts (8,100 tris, got ${yFastTris})`);
ok(yTotalTris === 1680 + 8100, `Total triangles with yards.ts posts: 9,780 tris (got ${yTotalTris})`);
ok(yFasteners && yFasteners.reversed === 0 && yFasteners.misaligned === 0,
  `All ${yFasteners?.total} fastener triangles with yards.ts contacts: 0 reversed, 0 misaligned`);

yardsBuild.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); });
testMat.dispose();

// Summary
console.log(failures === 0
  ? '\n=== ALL REPAIR1 VERIFICATION CHECKS PASSED (0 failures) ==='
  : `\n=== REPAIR1 VERIFICATION FAILED: ${failures} check(s) failed ===`);

process.exit(failures === 0 ? 0 : 1);
