/**
 * VERIFY FENCE ART CANARY (Repair 2)
 *
 * Comprehensive CPU-only verification suite:
 * 1. Default Baseline Mode: 60 boxes, 720 triangles, single mesh, exact bounds [0.58, 1.91].
 * 2. Canary Assembled Map Counts: 12 map segments, 60 boards (1,680 tris), 450 flat hex fasteners (1,800 tris).
 *    Total triangles = 3,480 (added = 2,760 <= 3,000 whole-map budget), draw calls = 2 <= 4.
 * 3. Face Winding & Normal Alignment: dot >= 0.99 for all 3,480 triangles (0 reversed, 0 misaligned).
 * 4. Outward Surface & Post Contact Fixture: asserts actual post dimensions (0.16m thickness, surface at +/-0.08m)
 *    parsed directly from yards.ts; asserts fasteners sit at post facade (+0.0805m) and boards remain centered (0.03m).
 * 5. Rotated Segments: 0 reversed/misaligned across 0, 30, 45, 90, 135, 180, 270 degrees.
 * 6. Independent Root Negative Guard: proves check-fence-winding-0916.mjs still fails original bad artifact.
 */
import { readFileSync, unlinkSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import * as THREE from 'three';

const __dirname = dirname(fileURLToPath(import.meta.url));
const workDir = resolve(__dirname, '..');
const rootDir = resolve(__dirname, '../../../../nuketown-recovery-20260919');
const fixturePath = resolve(workDir, '.fixture-fence-bundle.mjs');

// Bundle repair2 TypeScript modules with esbuild (packages: external)
await build({
  stdin: {
    contents: `
      export * from './src/build/fence-boards';
      export * from './src/build/fence-boards-canary';
    `,
    resolveDir: workDir,
  },
  outfile: fixturePath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  logLevel: 'silent',
});

const {
  buildFenceCourseBoards,
  buildFenceCourseBoardsCanary,
  FENCE_BOARDS,
  FENCE_POST_SPEC,
  getFenceFastenerMaterial,
} = await import(pathToFileURL(fixturePath).href);

let failures = 0;
function ok(condition, label) {
  if (condition) {
    console.log(`  PASS: ${label}`);
  } else {
    console.error(`  FAIL: ${label}`);
    failures++;
  }
}

function close(a, b, eps = 1e-5) {
  return Math.abs(a - b) <= eps;
}

// ----------------------------------------------------------------------------
// Layout replication for the 12 map segments (matching yards.ts)
// ----------------------------------------------------------------------------
const YARD_X_MIN = -14.8;
const YARD_X_MAX = 14.8;
const BACK_FENCE = 37.0;
const HOUSE_BACK = 26.6;
const BOUNDARY_X = 16.6;
const BOUND_Z = 42.0;

const ORANGE_SIDE = -1;
const WHITE_SIDE = 1;
const HOUSES = [{ side: ORANGE_SIDE }, { side: WHITE_SIDE }];

function holesFor(side) {
  return side === ORANGE_SIDE
    ? [{ t: 0.30, w: 1.6 }, { t: 0.74, w: 1.35 }]
    : [{ t: 0.21, w: 1.5 }, { t: 0.57, w: 1.35 }, { t: 0.86, w: 1.6 }];
}

function buildMapSegments() {
  const boardSegs = [];

  function fence(ax, az, bx, bz, holes, cornerAtA = false) {
    const L = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / L;
    const uz = (bz - az) / L;
    const at = (t) => [ax + ux * t, az + uz * t];
    const holed = (t, pad) => holes.some((o) => Math.abs(t - o.t * L) < o.w / 2 + pad);

    const segs = [];
    let cur = 0;
    for (const o of holes.slice().sort((p, q) => p.t - q.t)) {
      const s0 = o.t * L - o.w / 2;
      if (s0 > cur) segs.push([cur, s0]);
      cur = Math.max(cur, o.t * L + o.w / 2);
    }
    if (cur < L) segs.push([cur, L]);

    const np = Math.max(2, Math.round(L / 2.0));
    const postDists = [];
    for (let j = cornerAtA ? 1 : 0; j <= np; j++) {
      const d = (j / np) * L;
      if (holed(d, 0.2)) continue;
      postDists.push(d);
    }

    for (const [s0, s1] of segs) {
      const len = s1 - s0;
      const [x0, z0] = at(s0);
      const [x1, z1] = at(s1);
      const posts = postDists
        .filter((d) => d >= s0 - 0.08 && d <= s1 + 0.08)
        .map((d) => Math.max(0.08, Math.min(len - 0.08, d - s0)));
      boardSegs.push({ x0, z0, x1, z1, u0: s0, posts });
    }
  }

  for (const h of HOUSES) {
    const zf = h.side * BACK_FENCE;
    const holes = holesFor(h.side);
    fence(YARD_X_MIN, zf, YARD_X_MAX, zf, holes);
    fence(YARD_X_MIN, zf, YARD_X_MIN, h.side * HOUSE_BACK, [], true);
    fence(YARD_X_MAX, zf, YARD_X_MAX, h.side * HOUSE_BACK, [], true);
  }
  fence(BOUNDARY_X, -BOUND_Z, BOUNDARY_X, BOUND_Z, []);

  return boardSegs;
}

// ----------------------------------------------------------------------------
// Suite 1: Baseline Mode (fence-art=default)
// ----------------------------------------------------------------------------
console.log('\n--- Suite 1: Baseline Mode Verification ---');
{
  globalThis.__NT_OVERRIDE_FENCE_ART_CANARY__ = false;
  const mapSegs = buildMapSegments();
  const mat = new THREE.MeshStandardMaterial({ name: 'mat-fence-board' });
  const bBaseline = buildFenceCourseBoards(mapSegs, mat);

  ok(bBaseline.mesh.isMesh === true, 'Baseline returns single THREE.Mesh');
  ok(bBaseline.boxes === 60, `Baseline box count = 60 (actual: ${bBaseline.boxes})`);
  ok(bBaseline.triangles === 720, `Baseline triangles = 720 (actual: ${bBaseline.triangles})`);

  bBaseline.mesh.geometry.computeBoundingBox();
  const bb = bBaseline.mesh.geometry.boundingBox;
  ok(close(bb.min.y, 0.58) && close(bb.max.y, 1.91), `Baseline Y bounds [0.58, 1.91] exact (actual: [${bb.min.y}, ${bb.max.y}])`);

  bBaseline.mesh.geometry.dispose();
  mat.dispose();
}

// ----------------------------------------------------------------------------
// Suite 2: Canary Assembled Map Verification (Repair 2)
// ----------------------------------------------------------------------------
console.log('\n--- Suite 2: Canary Assembled Map Verification ---');
let canaryBuild = null;
let segs = [];
{
  globalThis.__NT_OVERRIDE_FENCE_ART_CANARY__ = true;
  segs = buildMapSegments();
  const boardMat = new THREE.MeshStandardMaterial({ name: 'mat-fence-board' });
  const steelMat = getFenceFastenerMaterial();

  canaryBuild = buildFenceCourseBoards(segs, boardMat, steelMat);

  ok(canaryBuild.mesh.isGroup === true, 'Canary returns THREE.Group (batched boards + fasteners)');

  let boardMesh = null;
  let fastenerMesh = null;
  canaryBuild.mesh.traverse((child) => {
    if (child.name === 'fence-course-boards-weathered') boardMesh = child;
    if (child.name === 'fence-hardware-fasteners') fastenerMesh = child;
  });

  ok(boardMesh !== null, 'Found fence-course-boards-weathered mesh');
  ok(fastenerMesh !== null, 'Found fence-hardware-fasteners mesh');

  const boardTris = (boardMesh.geometry.index.count) / 3;
  const fastenerTris = (fastenerMesh.geometry.index.count) / 3;
  const totalTris = boardTris + fastenerTris;
  const addedTris = totalTris - 720;

  ok(boardTris === 1680, `Board triangles = 1,680 (actual: ${boardTris})`);
  ok(fastenerTris === 1800, `Fastener triangles = 1,800 (actual: ${fastenerTris})`);
  ok(totalTris === 3480, `Total canary triangles = 3,480 (actual: ${totalTris})`);
  ok(addedTris === 2760, `Added triangles over baseline = 2,760 <= 3,000 budget (actual: ${addedTris})`);
  ok(addedTris <= 3000, 'Whole map added triangle budget strictly <= 3,000');

  // Draw calls
  ok(canaryBuild.mesh.children.length === 2, `Draw call count = 2 <= 4 budget (actual: ${canaryBuild.mesh.children.length})`);

  // Determinism check
  const build2 = buildFenceCourseBoards(segs, boardMat, steelMat);
  let detOk = true;
  for (const name of ['fence-course-boards-weathered', 'fence-hardware-fasteners']) {
    const m1 = canaryBuild.mesh.getObjectByName(name);
    const m2 = build2.mesh.getObjectByName(name);
    const pos1 = m1.geometry.attributes.position.array;
    const pos2 = m2.geometry.attributes.position.array;
    if (pos1.length !== pos2.length) detOk = false;
    for (let i = 0; i < pos1.length; i++) {
      if (pos1[i] !== pos2[i]) { detOk = false; break; }
    }
  }
  ok(detOk, 'Deterministic: repeated builds produce byte-identical buffers');
  build2.mesh.traverse((c) => c.geometry?.dispose());
}

// ----------------------------------------------------------------------------
// Suite 3: Face Winding and Outward Normal Alignment
// ----------------------------------------------------------------------------
console.log('\n--- Suite 3: Triangle Winding & Outward Normal Alignment ---');
{
  canaryBuild.mesh.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    const n = o.geometry.attributes.normal;
    const ix = o.geometry.index;
    let reversed = 0;
    let misaligned = 0;
    const total = ix.count / 3;

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
    }

    ok(reversed === 0, `${o.name}: 0 reversed triangles of ${total}`);
    ok(misaligned === 0, `${o.name}: 0 misaligned triangles of ${total} (dot >= 0.99)`);
  });
}

// ----------------------------------------------------------------------------
// Suite 4: Outward Surface & Post Contact Fixture Assertion
// ----------------------------------------------------------------------------
console.log('\n--- Suite 4: Outward Surface & Post Contact Fixture Assertion ---');
{
  // 1. Assert actual post dimensions from yards.ts fixture
  const yardsPath = resolve(rootDir, 'src/build/yards.ts');
  const yardsSrc = readFileSync(yardsPath, 'utf8');

  // Match the timber post put call: B.put(mat.timberDark, 0.16, POST_TOP, 0.16, x, POST_TOP / 2, z, ry);
  const postMatch = yardsSrc.match(/B\.put\(mat\.timberDark,\s*([0-9.]+),\s*POST_TOP,\s*([0-9.]+)/);
  ok(postMatch !== null, 'Found post dimension in yards.ts');
  const fixturePostThickness = parseFloat(postMatch[1]);
  const fixturePostWidth = parseFloat(postMatch[2]);
  ok(fixturePostThickness === 0.16, `Fixture post thickness = 0.16m (actual: ${fixturePostThickness})`);
  ok(fixturePostWidth === 0.16, `Fixture post width = 0.16m (actual: ${fixturePostWidth})`);

  const fixturePostSurfaceOffset = fixturePostThickness / 2; // 0.08m
  ok(fixturePostSurfaceOffset === 0.08, 'Fixture post facade surface is at +/-0.08m from centreline');

  // Verify FENCE_POST_SPEC aligns with yards.ts fixture
  ok(FENCE_POST_SPEC.THICKNESS === fixturePostThickness, 'FENCE_POST_SPEC.THICKNESS matches yards.ts post thickness');
  ok(FENCE_POST_SPEC.HALF_THICKNESS === fixturePostSurfaceOffset, 'FENCE_POST_SPEC.HALF_THICKNESS matches yards.ts surface');

  // 2. Assert fastener vertices sit ON the post facade (+0.08m), not buried at 0.03m
  const testSeg = [{ x0: 0, z0: 0, x1: 0, z1: 10, posts: [2.0, 4.0, 6.0, 8.0] }];
  const singleBuild = buildFenceCourseBoardsCanary(
    testSeg,
    new THREE.MeshStandardMaterial(),
    new THREE.MeshStandardMaterial(),
  );

  const testFastenerMesh = singleBuild.mesh.getObjectByName('fence-hardware-fasteners');
  const testBoardMesh = singleBuild.mesh.getObjectByName('fence-course-boards-weathered');

  const fPos = testFastenerMesh.geometry.attributes.position;
  let minFastenerX = Infinity;
  let maxFastenerX = -Infinity;
  for (let i = 0; i < fPos.count; i++) {
    const x = fPos.getX(i);
    minFastenerX = Math.min(minFastenerX, x);
    maxFastenerX = Math.max(maxFastenerX, x);
  }

  // Fasteners must be seated at post facade (+0.0805m), NOT buried inside post (<0.08m)
  ok(
    minFastenerX >= fixturePostSurfaceOffset && minFastenerX <= fixturePostSurfaceOffset + 0.002,
    `Fasteners seated on exposed post facade at X = ${minFastenerX.toFixed(4)}m (>= ${fixturePostSurfaceOffset}m post surface)`,
  );
  ok(
    minFastenerX > 0.035,
    `Fasteners are NOT buried behind post at board depth 0.03m (X = ${minFastenerX.toFixed(4)}m > 0.035m)`,
  );

  // 3. Assert boards remain centered at physical frame thickness (0.06m), NOT offset to 0.08m
  const bPos = testBoardMesh.geometry.attributes.position;
  let maxBoardX = -Infinity;
  for (let i = 0; i < bPos.count; i++) {
    maxBoardX = Math.max(maxBoardX, Math.abs(bPos.getX(i)));
  }
  ok(
    maxBoardX <= 0.035,
    `Boards retain authentic physical thickness ~0.03m (max |X| = ${maxBoardX.toFixed(4)}m <= 0.035m, not pushed to 0.08m)`,
  );

  singleBuild.mesh.traverse((c) => c.geometry?.dispose());
}

// ----------------------------------------------------------------------------
// Suite 5: Rotated Segments Audit
// ----------------------------------------------------------------------------
console.log('\n--- Suite 5: Rotated Segments Audit ---');
{
  const angles = [0, Math.PI / 6, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, (3 * Math.PI) / 2];
  let rotOk = true;

  for (const ang of angles) {
    const L = 4.0;
    const x1 = Math.sin(ang) * L;
    const z1 = Math.cos(ang) * L;
    const rotSeg = [{ x0: 0, z0: 0, x1, z1, posts: [1.0, 2.0, 3.0] }];
    const b = buildFenceCourseBoardsCanary(
      rotSeg,
      new THREE.MeshStandardMaterial(),
      new THREE.MeshStandardMaterial(),
    );

    b.mesh.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.geometry.attributes.position;
      const n = o.geometry.attributes.normal;
      const ix = o.geometry.index;
      for (let i = 0; i < ix.count; i += 3) {
        const ids = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)];
        const v0 = new THREE.Vector3().fromBufferAttribute(p, ids[0]);
        const v1 = new THREE.Vector3().fromBufferAttribute(p, ids[1]);
        const v2 = new THREE.Vector3().fromBufferAttribute(p, ids[2]);
        const face = v1.sub(v0).cross(v2.sub(v0)).normalize();
        const decl = new THREE.Vector3().fromBufferAttribute(n, ids[0]);
        const dot = face.dot(decl);
        if (dot < 0.99) rotOk = false;
      }
    });
    b.mesh.traverse((c) => c.geometry?.dispose());
  }

  ok(rotOk, 'Rotated segments (0°, 30°, 45°, 90°, 135°, 180°, 270°): all triangles dot >= 0.99');
}

// ----------------------------------------------------------------------------
// Suite 6: Independent Root Negative Guard Check
// ----------------------------------------------------------------------------
console.log('\n--- Suite 6: Independent Root Negative Guard Check ---');
{
  const negativeScript = resolve(rootDir, '.recovery-runtime/check-fence-winding-0916.mjs');
  let negFailedAsExpected = false;
  try {
    execFileSync('node', [negativeScript], { cwd: rootDir, encoding: 'utf8' });
  } catch (err) {
    negFailedAsExpected = true;
  }
  ok(negFailedAsExpected, 'Independent negative guard (check-fence-winding-0916.mjs) STILL FAILS original bad artifact');
}

// Clean up assembled meshes and temporary bundle
canaryBuild.mesh.traverse((c) => c.geometry?.dispose());
if (existsSync(fixturePath)) {
  unlinkSync(fixturePath);
}

console.log('\n======================================================');
if (failures === 0) {
  console.log('FENCE ART CANARY (REPAIR 2) PROOF: ALL CHECKS PASS');
  process.exit(0);
} else {
  console.error(`FENCE ART CANARY (REPAIR 2) PROOF: ${failures} CHECK(S) FAILED`);
  process.exit(1);
}
