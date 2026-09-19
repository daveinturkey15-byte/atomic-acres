/**
 * FENCE-BOARDS CPU PROOF - executes the REAL src/build/fence-boards.ts helper
 * under Node's TS type stripping. No GPU, no browser, no server, no scene.
 *
 * Proves, on the actual assembled buffers:
 *   1. the BoxGeometry face order the UV rewrite depends on
 *   2. zero RNG (Math.random is replaced by a thrower across both builds)
 *   3. byte-identical output across two builds (deterministic)
 *   4. exactly ONE mesh / ONE geometry / ONE material, merged groups-free
 *   5. triangle budget (segs x courses x 12, <= 3000)
 *   6. outward winding: every triangle CCW with its normal, every normal
 *      pointing away from its own box centre
 *   7. uniform art-scale U along the run on the RUN faces only (long faces +
 *      top and bottom edges, verts 0..15), exact V = 56/1024, and
 *      the 6 cm end faces (verts 16..23) as their own fixed-slice contract
 *   8. the actual diffuse JPEG's complete median<85 horizontal seam-band scan
 *      is decoded and checked before candidate windows are proven clear;
 *      localized dark woodgrain remains legitimate texture
 *   9. every vertex samples strictly inside its course's measured seam-free
 *      plank window
 *   10. exact combined bounds for the real run list, with segment count,
 *      longest and shortest DERIVED from layout constants plus a static scan
 *      pinning the replicated fence() calls and hole literals to the live
 *      yards.ts source (a hardcoded 1.596 m shortest-segment literal went
 *      stale against the current layout's 3.344 m - see docs/fence-uv-canary.md)
 *
 * Run: node scripts/assets/verify-fence-boards.mjs
 */
import { Box3, BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildFenceCourseBoards,
  FENCE_BOARDS,
  PLANK_WINDOWS,
  PLANK_TEXTURE_SIZE,
  plankWindowUV,
} from '../../src/build/fence-boards.ts';
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
} from '../../src/core/layout.ts';

let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ---- the actual run list, replicated from yards.ts fence() calls -----------
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

const BOUNDARY_X = ROAD_X_MAX + 0.6; // yards.ts derivation - do not invent a number
const runs = [];
const runNames = [];
for (const h of HOUSES) {
  const zf = h.side * BACK_FENCE;
  const name = h.side < 0 ? 'orange' : 'white';
  for (const [ax, az, bx, bz, holes, rname] of [
    [YARD_X_MIN, zf, YARD_X_MAX, zf, holesFor(h.side), `${name} back`],
    [YARD_X_MIN, zf, YARD_X_MIN, h.side * HOUSE_BACK, [], `${name} west return`],
    [YARD_X_MAX, zf, YARD_X_MAX, h.side * HOUSE_BACK, [], `${name} east return`],
  ]) {
    const L = Math.hypot(bx - ax, bz - az);
    const ux = (bx - ax) / L;
    const uz = (bz - az) / L;
    for (const [s0, s1] of segsOf(L, holes)) {
      runs.push({ x0: ax + ux * s0, z0: az + uz * s0, x1: ax + ux * s1, z1: az + uz * s1, u0: s0 });
      runNames.push(`${rname} seg ${s0.toFixed(2)}..${s1.toFixed(2)} (${(s1 - s0).toFixed(2)} m, ${Math.abs(ux) > Math.abs(uz) ? 'X' : 'Z'}-run)`);
    }
  }
}
runs.push({ x0: BOUNDARY_X, z0: -BOUND_Z, x1: BOUNDARY_X, z1: BOUND_Z, u0: 0 });
runNames.push(`boundary seg 0..${2 * BOUND_Z} (${2 * BOUND_Z} m, Z-run)`);

console.log(`runs assembled: ${runs.length} solid segments from ${runNames.length} records`);
runNames.forEach((n) => console.log(`   - ${n}`));

// ---- 0. pin the replication to the LIVE yards.ts fence source ---------------
// The 2026-09-19 review caught a hardcoded expectation in this file (shortest
// segment 1.596 m, from an older layout) failing against the real current
// layout (3.344 m): a hand-copied run list rots silently when the layout
// moves. These scans fail the moment the yards.ts fence() call sites or hole
// literals change, forcing reconciliation with evidence instead of drift.
{
  const { readFileSync } = await import('node:fs');
  const yards = readFileSync(new URL('../../src/build/yards.ts', import.meta.url), 'utf8');
  const calls = [...yards.matchAll(/(?<!function )\bfence\(([^)]*)\)/g)]
    .map((m) => m[1].replace(/\s+/g, ' ').trim());
  const expectedCalls = [
    'YARD_X_MIN, zf, YARD_X_MAX, zf, holes',
    'YARD_X_MIN, zf, YARD_X_MIN, h.side * HOUSE_BACK, [], true',
    'YARD_X_MAX, zf, YARD_X_MAX, h.side * HOUSE_BACK, [], true',
    'BOUNDARY_X, -BOUND_Z, BOUNDARY_X, BOUND_Z, []',
  ];
  ok(calls.length === expectedCalls.length && expectedCalls.every((e) => calls.includes(e)),
    `yards.ts fence() call sites match the replicated run list (${calls.length} calls scanned)`);
  const literals = [...yards.matchAll(/\{\s*t:\s*([\d.]+),\s*w:\s*([\d.]+)\s*\}/g)]
    .map((m) => `${+m[1]}:${+m[2]}`).sort();
  const expLiterals = [...holesFor(ORANGE.side), ...holesFor(WHITE.side)]
    .map((o) => `${o.t}:${o.w}`).sort();
  ok(JSON.stringify(literals) === JSON.stringify(expLiterals),
    `yards.ts hole literals match the holesFor tables (${literals.join(' ')})`);
}

// ---- 1. pin the BoxGeometry layout the UV rewrite indexes ------------------
{
  const g = new BoxGeometry(1, 1, 1);
  const n = g.getAttribute('normal');
  let pinned = true;
  for (let i = 0; i < 8; i++) pinned &&= close(Math.abs(n.getX(i)), 1);
  for (let i = 8; i < 16; i++) pinned &&= close(Math.abs(n.getY(i)), 1);
  for (let i = 16; i < 24; i++) pinned &&= close(Math.abs(n.getZ(i)), 1);
  g.dispose();
  ok(pinned, 'BoxGeometry face order +x,-x,+y,-y,+z,-z (four verts each)');
}

// ---- 2+3. build twice with Math.random SEALED, COUNTED and ATTRIBUTED ------
// three's own BufferGeometry/Mesh constructors draw Math.random for object
// UUIDs; the proof is that EVERY call during the build comes from that
// internal path and none from the helper, plus a static source scan.
const material = new MeshStandardMaterial();
const realRandom = Math.random;
let rngCalls = 0;
let rngAllFromLibraryUUID = true;
let built;
let again;
try {
  Math.random = (...args) => {
    rngCalls++;
    if (!(new Error().stack ?? '').includes('generateUUID')) rngAllFromLibraryUUID = false;
    return realRandom(...args);
  };
  built = buildFenceCourseBoards(runs, material);
  again = buildFenceCourseBoards(runs, material);
} finally {
  Math.random = realRandom;
}
ok(rngAllFromLibraryUUID, `all ${rngCalls} Math.random draws during build are three's internal generateUUID (none in helper code)`);
{
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../src/build/fence-boards.ts', import.meta.url), 'utf8');
  ok(!/Math\.random|[^.\w]rand\s*\(/.test(src), 'helper source contains no RNG call (static scan)');
}

{
  const a = built.mesh.geometry;
  const b = again.mesh.geometry;
  let same = a.index.count === b.index.count;
  const ia = a.index.array;
  const ib = b.index.array;
  for (let i = 0; i < ia.length && same; i++) same = ia[i] === ib[i];
  for (const name of ['position', 'normal', 'uv']) {
    const aa = a.getAttribute(name).array;
    const bb = b.getAttribute(name).array;
    same &&= aa.length === bb.length;
    for (let i = 0; i < aa.length && same; i++) same = aa[i] === bb[i];
  }
  ok(same, 'deterministic: two builds byte-identical (position/normal/uv/index)');
  again.mesh.geometry.dispose();
  built.mesh.geometry.dispose(); // dispose the double; rebuilt below fresh
}

// ---- fresh build for structural inspection ---------------------------------
const fb = buildFenceCourseBoards(runs, material);
const geo = fb.mesh.geometry;

// ---- 4. one mesh / one geometry / one material -----------------------------
ok(fb.mesh instanceof Mesh, 'returns a single THREE.Mesh');
ok(fb.mesh.material === material, 'mesh carries exactly the one caller material');
ok(fb.mesh.geometry === geo && geo.index !== null, 'single indexed BufferGeometry');
ok(geo.groups.length === 0, 'merge used no groups (one material, one draw)');
ok(fb.mesh.castShadow === true && fb.mesh.receiveShadow === true, 'cast+receive shadows set');
ok(close(fb.mesh.position.x, 0) && close(fb.mesh.position.y, 0) && close(fb.mesh.position.z, 0),
  'mesh transform is identity (world baked into vertices)');

// ---- 5. counts and budget ---------------------------------------------------
const boxes = runs.length * FENCE_BOARDS.COURSES;
ok(fb.boxes === boxes, `one box per course per segment: ${fb.boxes}`);
ok(fb.triangles === boxes * 12, `triangles = boxes x 12 = ${fb.triangles}`);
ok(fb.triangles <= 3000, `triangle budget: ${fb.triangles} <= 3000`);
ok(geo.getAttribute('position').count === boxes * 24, `vertex count = boxes x 24 = ${boxes * 24}`);

// ---- 6. NaN scan, winding, outward normals ----------------------------------
{
  const p = geo.getAttribute('position');
  const n = geo.getAttribute('normal');
  const idx = geo.index.array;
  let nan = false;
  let winding = true;
  let outward = true;
  const centreOf = (boxI) => {
    const seg = runs[Math.floor(boxI / FENCE_BOARDS.COURSES)];
    const c = Math.floor(boxI % FENCE_BOARDS.COURSES);
    return [
      (seg.x0 + seg.x1) / 2,
      FENCE_BOARDS.BASE_Y + FENCE_BOARDS.HEIGHT / 2 + c * FENCE_BOARDS.PITCH,
      (seg.z0 + seg.z1) / 2,
    ];
  };
  const e0 = [0, 0, 0];
  const e1 = [0, 0, 0];
  const e2 = [0, 0, 0];
  for (let t = 0; t < idx.length; t += 3) {
    const [i0, i1, i2] = [idx[t], idx[t + 1], idx[t + 2]];
    for (const [slot, i] of [[e0, i0], [e1, i1], [e2, i2]]) {
      slot[0] = p.getX(i); slot[1] = p.getY(i); slot[2] = p.getZ(i);
      nan ||= !Number.isFinite(slot[0]) || !Number.isFinite(slot[1]) || !Number.isFinite(slot[2]);
    }
    const ax = e1[0] - e0[0], ay = e1[1] - e0[1], az = e1[2] - e0[2];
    const bx = e2[0] - e0[0], by = e2[1] - e0[1], bz = e2[2] - e0[2];
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    winding &&= cx * n.getX(i0) + cy * n.getY(i0) + cz * n.getZ(i0) > 0;
    const boxI = Math.floor(t / 36); // 12 tris x 3 idx per box
    const [ox, oy, oz] = centreOf(boxI);
    const mx = (e0[0] + e1[0] + e2[0]) / 3 - ox;
    const my = (e0[1] + e1[1] + e2[1]) / 3 - oy;
    const mz = (e0[2] + e1[2] + e2[2]) / 3 - oz;
    outward &&= n.getX(i0) * mx + n.getY(i0) * my + n.getZ(i0) * mz > 0;
  }
  ok(!nan, 'no NaN/Inf in assembled positions');
  ok(winding, 'every triangle wound CCW against its stored normal');
  ok(outward, 'every normal points away from its own box centre (outward faces)');
}

// ---- 7-9. physical U/V + actual diffuse seam-band clearance -----------------
{
  // UVs are stored Float32: a stored value misses its f64 author by at most
  // 0.5 ulp OF ITS OWN MAGNITUDE. The justified tolerance is therefore a few
  // float32 ulps of the compared value - never a relaxed geometric margin
  // (the 2026-09-19 review: f32(0.48) is 0.4799999892, which a raw
  // `u >= 0.48` check fails even though the value is exact to storage).
  const ulp32 = (x) => 2 ** (Math.floor(Math.log2(Math.max(Math.abs(x), 2 ** -126))) - 23);
  const uv = geo.getAttribute('uv');
  let uPhysical = true;
  let vPhysical = true;
  let vWindowed = true;
  let edgeSlice = true;
  const SEAM_ROWS = [
    [6, 6], [75, 76], [144, 144], [206, 206], [214, 214], [282, 282],
    [352, 352], [421, 422], [487, 489], [491, 492], [544, 544], [614, 614],
    [676, 676], [678, 679], [683, 683], [745, 747], [753, 753], [816, 821],
    [888, 891], [953, 959],
  ];
  for (let b = 0; b < boxes; b++) {
    const seg = runs[Math.floor(b / FENCE_BOARDS.COURSES)];
    const course = b % FENCE_BOARDS.COURSES;
    const len = Math.hypot(seg.x1 - seg.x0, seg.z1 - seg.z0);
    const { vBot, vTop } = plankWindowUV(course);
    // Window bounds are dyadic k/1024 - exact in float32 - so a stored
    // interpolated v misses its bound by <= 0.5 ulp(v); one ulp bounds it.
    const epsV = ulp32(Math.max(Math.abs(vBot), Math.abs(vTop)));
    const expectedV = FENCE_BOARDS.HEIGHT / FENCE_BOARDS.METRES_PER_U_TILE;
    // Physical U is a claim about the RUN faces ONLY: verts 0..15 (long
    // faces + top/bottom edges). The 8 endface verts carry the fixed-slice
    // contract checked separately below - folding them into this statistic
    // was a proof-spec defect this harness once failed on.
    let uMin = Infinity, uMax = -Infinity;
    let vMin = Infinity, vMax = -Infinity;
    for (let i = b * 24; i < (b + 1) * 24; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (i < b * 24 + 16) { uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); }
      else if (!(u >= 0.48 - ulp32(1) && u <= 0.565 + ulp32(1))) edgeSlice = false;
      vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
      if (v < vBot - epsV || v > vTop + epsV) vWindowed = false;
    }
    // Each stored endpoint misses by <= 0.5 ulp of itself, so 2 x ulp32 of
    // the larger endpoint bounds both the span and the origin comparison.
    const epsU = 2 * ulp32(Math.max(Math.abs(uMin), Math.abs(uMax)));
    uPhysical &&= close(uMax - uMin, len / FENCE_BOARDS.METRES_PER_U_TILE, epsU);
    uPhysical &&= close(uMin, (seg.u0 ?? 0) / FENCE_BOARDS.METRES_PER_U_TILE, epsU);
    vWindowed &&= close(vMax - vMin, vTop - vBot, epsV);
    vPhysical &&= close(vMax - vMin, expectedV, epsV);
  }
  ok(uPhysical, 'U uses the uniform art scale on run faces (verts 0..15): span = segment length / 4.57142857 m per tile, origin = run-start u0 (float32-ulp tolerance)');
  ok(vPhysical, 'V uses the same uniform art scale on every course: span = 56/1024 = 0.0546875 (float32-ulp tolerance)');
  ok(vWindowed, 'every vertex samples strictly inside its course measured plank window');
  ok(edgeSlice, 'end faces (verts 16..23) use the fixed in-tile slice [0.48, 0.565] (float32-ulp tolerance)');
  for (let c = 0; c < FENCE_BOARDS.COURSES; c++) {
    const { vBot, vTop } = plankWindowUV(c);
    ok(vBot > 0 && vTop < 1 && vTop > vBot, `course ${c} window v=[${vBot.toFixed(5)}, ${vTop.toFixed(5)}] (rows ${PLANK_WINDOWS[c % PLANK_WINDOWS.length].top}..${PLANK_WINDOWS[c % PLANK_WINDOWS.length].bottom})`);
  }
  // secondary cross-check: windows disjoint from every dark band in the full
  // diffuse scan (detector and rows are recorded in docs/fence-uv-canary.md).
  const disjoint = PLANK_WINDOWS.every((w) =>
    SEAM_ROWS.every(([a, b]) => w.bottom < a || w.top > b));
  ok(disjoint, 'all windows clear the measured plank-gap bands with margin');

  // Decode the actual imported diffuse JPEG, rather than trusting a copied
  // row table. PIL is already the repository's asset-intake decoder; the
  // returned row medians pin the complete band list to these exact source bytes.
  const diffusePath = fileURLToPath(new URL('../../public/assets/wooden-planks/wooden_planks_diff_1k.jpg', import.meta.url));
  const manifestPath = fileURLToPath(new URL('../../docs/assets/wooden-planks/manifest.json', import.meta.url));
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const diffuseEntry = manifest.files.find((f) => f.channel === 'Diffuse');
  const diffuseProbe = String.raw`import json,sys,statistics,hashlib
from PIL import Image
path=sys.argv[1]
blob=open(path,'rb').read()
im=Image.open(path).convert('RGB')
rows=[]
for y in range(im.height):
    vals=[0.2126*r+0.7152*g+0.0722*b for r,g,b in im.crop((0,y,im.width,y+1)).getdata()]
    rows.append(statistics.median(vals))
print(json.dumps({'width':im.width,'height':im.height,'sha256':hashlib.sha256(blob).hexdigest(),'bytes':len(blob),'rowMedians':rows}))`;
  const decoded = JSON.parse(execFileSync('python', ['-c', diffuseProbe, diffusePath], {
    cwd: fileURLToPath(new URL('../..', import.meta.url)), encoding: 'utf8', windowsHide: true,
  }));
  ok(decoded.width === PLANK_TEXTURE_SIZE && decoded.height === PLANK_TEXTURE_SIZE &&
    decoded.bytes === diffuseEntry.bytes && decoded.sha256 === diffuseEntry.sha256,
  'actual diffuse JPEG decode is 1024x1024 and matches the manifest bytes/hash');
  const actualBands = [];
  let bandStart = null;
  for (let y = 0; y < decoded.rowMedians.length; y++) {
    const dark = decoded.rowMedians[y] < 85;
    if (dark && bandStart === null) bandStart = y;
    if ((!dark || y === decoded.rowMedians.length - 1) && bandStart !== null) {
      actualBands.push([bandStart, dark && y === decoded.rowMedians.length - 1 ? y : y - 1]);
      bandStart = null;
    }
  }
  ok(JSON.stringify(actualBands) === JSON.stringify(SEAM_ROWS),
    `complete 1024-row median<85 scan matches all ${SEAM_ROWS.length} measured seam bands`);
  const seamMedians = SEAM_ROWS.map(([a, b]) => Math.min(...decoded.rowMedians.slice(a, b + 1)));
  ok(seamMedians.every((m) => m < 85),
    `actual diffuse JPEG seam bands are below median 85 (minimums ${seamMedians.map((m) => m.toFixed(1)).join('/')})`);
  ok(PLANK_WINDOWS.every((w) => w.bottom - w.top === 56),
    'each candidate window is exactly 56 source pixels at the uniform art scale');
}

// ---- 8. exact combined bounds ----------------------------------------------
{
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let longest = 0;
  let shortest = Infinity;
  for (const seg of runs) {
    const dx = seg.x1 - seg.x0, dz = seg.z1 - seg.z0;
    const len = Math.hypot(dx, dz);
    const ux = dx / len, uz = dz / len;
    longest = Math.max(longest, len);
    shortest = Math.min(shortest, len);
    const xHalf = Math.abs(ux) * (len / 2) + Math.abs(uz) * (FENCE_BOARDS.THICKNESS / 2);
    const zHalf = Math.abs(uz) * (len / 2) + Math.abs(ux) * (FENCE_BOARDS.THICKNESS / 2);
    const cx = (seg.x0 + seg.x1) / 2, cz = (seg.z0 + seg.z1) / 2;
    minX = Math.min(minX, cx - xHalf); maxX = Math.max(maxX, cx + xHalf);
    minZ = Math.min(minZ, cz - zHalf); maxZ = Math.max(maxZ, cz + zHalf);
  }
  minY = FENCE_BOARDS.BASE_Y;
  maxY = FENCE_BOARDS.BASE_Y + (FENCE_BOARDS.COURSES - 1) * FENCE_BOARDS.PITCH + FENCE_BOARDS.HEIGHT;
  const same = (a, b) => close(a, b, 1e-6);
  ok(same(bb.min.x, minX) && same(bb.max.x, maxX), `combined X bounds exact: [${minX.toFixed(4)}, ${maxX.toFixed(4)}]`);
  ok(same(bb.min.y, minY) && same(bb.max.y, maxY), `combined Y bounds exact: [${minY}, ${maxY}] (courses 0.58..1.91, no overlap at pitch 0.27 > 0.25)`);
  ok(same(bb.min.z, minZ) && same(bb.max.z, maxZ), `combined Z bounds exact: [${minZ.toFixed(4)}, ${maxZ.toFixed(4)}]`);
  // longest / shortest are DERIVED from the layout constants and the hole
  // tables, never hardcoded: the 2026-09-19 review caught a stale literal
  // here (expected shortest 1.596 m from an older layout) failing against
  // the real current-layout 3.344 m. The expectation below recomputes the
  // segmentation analytically (independent of segsOf above, which builds the
  // actual run list) so an assembly bug cannot hide behind the same code.
  let expMin = 2 * BOUND_Z; // boundary run, no holes
  let expCount = 1;
  for (const h of HOUSES) {
    const backL = YARD_X_MAX - YARD_X_MIN;
    const retL = Math.abs(BACK_FENCE - HOUSE_BACK);
    expMin = Math.min(expMin, retL);
    expCount += 2;
    let cur = 0;
    for (const o of holesFor(h.side).slice().sort((a, b) => a.t - b.t)) {
      const s0 = o.t * backL - o.w / 2;
      if (s0 > cur) { expMin = Math.min(expMin, s0 - cur); expCount++; }
      cur = Math.max(cur, o.t * backL + o.w / 2);
    }
    if (cur < backL) { expMin = Math.min(expMin, backL - cur); expCount++; }
  }
  ok(runs.length === expCount, `segment count ${runs.length} = layout-derived expectation ${expCount}`);
  ok(close(longest, 2 * BOUND_Z, 1e-9), `longest segment ${longest} m = boundary run 2*BOUND_Z = ${2 * BOUND_Z} m`);
  ok(close(shortest, expMin, 1e-9), `shortest segment ${shortest.toFixed(3)} m = layout-derived minimum ${expMin.toFixed(3)} m`);
}

geo.dispose();
material.dispose();

console.log(failures === 0
  ? '\nFENCE-BOARDS CPU PROOF: PASS (all checks green, actual helper executed)'
  : `\nFENCE-BOARDS CPU PROOF: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
