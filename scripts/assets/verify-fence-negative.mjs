/**
 * Independent fence UV canary. CPU only: executes the live fence-board helper,
 * derives the 12 solid segments from layout/hole data, checks the imported CC0
 * maps, and proves that wrong physical-U and rotated-geometry helper copies fail
 * the same numeric contracts. Temporary copies live under work/ only.
 */
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as THREE from 'three';
import {
  buildFenceCourseBoards,
  FENCE_BOARDS,
  PLANK_WINDOWS,
  PLANK_TEXTURE_SIZE,
  plankWindowUV,
} from '../../src/build/fence-boards.ts';
import {
  BACK_FENCE, BOUND_Z, HOUSES, HOUSE_BACK, ORANGE, ROAD_X_MAX, WHITE,
  YARD_X_MAX, YARD_X_MIN,
} from '../../src/core/layout.ts';

const SEAM_ROWS = [
  [6, 6], [75, 76], [144, 144], [206, 206], [214, 214], [282, 282],
  [352, 352], [421, 422], [487, 489], [491, 492], [544, 544], [614, 614],
  [676, 676], [678, 679], [683, 683], [745, 747], [753, 753], [816, 821],
  [888, 891], [953, 959],
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const work = resolve(root, 'work/fence-uv-negative');
let failures = 0;
function ok(value, label) {
  console.log(`${value ? 'PASS' : 'FAIL'}  ${label}`);
  if (!value) failures++;
}
function close(a, b, eps = 1e-6) { return Math.abs(a - b) <= eps; }
function ulp32(x) {
  return 2 ** (Math.floor(Math.log2(Math.max(Math.abs(x), 2 ** -126))) - 23);
}
function makeRuns() {
  const holesFor = (side) => side === ORANGE.side
    ? [{ t: 0.30, w: 1.6 }, { t: 0.74, w: 1.35 }]
    : [{ t: 0.21, w: 1.5 }, { t: 0.57, w: 1.35 }, { t: 0.86, w: 1.6 }];
  const segsOf = (length, holes) => {
    const out = [];
    let cur = 0;
    for (const hole of [...holes].sort((a, b) => a.t - b.t)) {
      const s0 = hole.t * length - hole.w / 2;
      if (s0 > cur) out.push([cur, s0]);
      cur = Math.max(cur, hole.t * length + hole.w / 2);
    }
    if (cur < length) out.push([cur, length]);
    return out;
  };
  const runs = [];
  for (const h of HOUSES) {
    const zf = h.side * BACK_FENCE;
    const holes = holesFor(h.side);
    for (const [ax, az, bx, bz, hs] of [
      [YARD_X_MIN, zf, YARD_X_MAX, zf, holes],
      [YARD_X_MIN, zf, YARD_X_MIN, h.side * HOUSE_BACK, []],
      [YARD_X_MAX, zf, YARD_X_MAX, h.side * HOUSE_BACK, []],
    ]) {
      const length = Math.hypot(bx - ax, bz - az);
      const ux = (bx - ax) / length, uz = (bz - az) / length;
      for (const [s0, s1] of segsOf(length, hs)) {
        runs.push({ x0: ax + ux * s0, z0: az + uz * s0,
          x1: ax + ux * s1, z1: az + uz * s1, u0: s0 });
      }
    }
  }
  const boundaryX = ROAD_X_MAX + 0.6;
  runs.push({ x0: boundaryX, z0: -BOUND_Z, x1: boundaryX, z1: BOUND_Z, u0: 0 });
  return { runs, holesFor };
}
function runUV(build, boxes, length) {
  const uv = build.mesh.geometry.getAttribute('uv');
  let spanOk = true, windowOk = true, physicalVOk = true, seamClear = true;
  for (let b = 0; b < boxes; b++) {
    const course = b % FENCE_BOARDS.COURSES;
    const { vBot, vTop } = plankWindowUV(course);
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (let i = b * 24; i < (b + 1) * 24; i++) {
      const u = uv.getX(i), v = uv.getY(i);
      if (i < b * 24 + 16) { uMin = Math.min(uMin, u); uMax = Math.max(uMax, u); }
      vMin = Math.min(vMin, v); vMax = Math.max(vMax, v);
    }
    const epsU = 2 * ulp32(Math.max(Math.abs(uMin), Math.abs(uMax)));
    const epsV = ulp32(Math.max(Math.abs(vBot), Math.abs(vTop)));
    spanOk &&= close(uMin, 0, epsU) && close(uMax - uMin, length / FENCE_BOARDS.METRES_PER_U_TILE, epsU);
    windowOk &&= vMin >= vBot - epsV && vMax <= vTop + epsV && close(vMax - vMin, vTop - vBot, epsV);
    physicalVOk &&= close(vMax - vMin, FENCE_BOARDS.HEIGHT / FENCE_BOARDS.METRES_PER_U_TILE, epsV);
    const rowTop = (1 - vMax) * PLANK_TEXTURE_SIZE;
    const rowBottom = (1 - vMin) * PLANK_TEXTURE_SIZE;
    seamClear &&= SEAM_ROWS.every(([a, b]) => rowBottom <= a || rowTop >= b);
  }
  return { spanOk, windowOk, physicalVOk, seamClear };
}
function bounds(build) {
  build.mesh.geometry.computeBoundingBox();
  const b = build.mesh.geometry.boundingBox;
  return { minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z };
}

const { runs } = makeRuns();
const yards = await readFile(resolve(root, 'src/build/yards.ts'), 'utf8');
const callSites = [...yards.matchAll(/(?<!function )\bfence\(([^)]*)\)/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
ok(callSites.length === 4, `yards.ts contains the four live fence() call sites (found ${callSites.length})`);
ok(runs.length === 12, 'independent layout/hole replication produces exactly 12 solid segments');
ok(callSites.includes('YARD_X_MIN, zf, YARD_X_MAX, zf, holes') &&
  callSites.includes('BOUNDARY_X, -BOUND_Z, BOUNDARY_X, BOUND_Z, []'),
  'replication is pinned to the live back-run and boundary source calls');

const material = new THREE.MeshStandardMaterial();
const actual = buildFenceCourseBoards(runs, material);
ok(actual.boxes === 60 && actual.triangles === 720, `actual helper emits 60 boxes / 720 triangles for 12 segments`);
const simple = buildFenceCourseBoards([{ x0: 0, z0: 0, x1: 4, z1: 0, u0: 0 }], material);
const uvResult = runUV(simple, 5, 4);
ok(uvResult.spanOk, 'actual helper U span uses uniform art scale: 4 m / 4.57142857 m per tile');
ok(uvResult.windowOk, 'actual helper V values stay within measured course windows at float32 ULP tolerance');
ok(uvResult.physicalVOk, 'actual helper V span uses uniform art scale: 56/1024 = 0.0546875');
ok(uvResult.seamClear, 'actual helper windows clear every known horizontal seam band');
const actualBounds = bounds(buildFenceCourseBoards([{ x0: 0, z0: 0, x1: 3, z1: 4, u0: 0 }], material));
const correctHalfX = 0.6 * 2.5 + 0.8 * FENCE_BOARDS.THICKNESS / 2;
const correctHalfZ = 0.8 * 2.5 + 0.6 * FENCE_BOARDS.THICKNESS / 2;
ok(close(actualBounds.minX, 1.5 - correctHalfX) && close(actualBounds.maxX, 1.5 + correctHalfX) &&
  close(actualBounds.minZ, 2 - correctHalfZ) && close(actualBounds.maxZ, 2 + correctHalfZ),
  'actual helper diagonal world bounds match the rotated 3x4 run envelope');

const manifest = JSON.parse(await readFile(resolve(root, 'docs/assets/wooden-planks/manifest.json'), 'utf8'));
ok(manifest.license?.name === 'CC0 1.0', 'wooden_planks manifest records CC0 1.0');
ok(manifest.asset?.physicalSizeMeters?.[0] === 2 && manifest.asset?.physicalSizeMeters?.[1] === 2,
  'wooden_planks manifest records the provider 2 m x 2 m physical surface');
ok(manifest.totalBytes === 1427922 && manifest.budget?.withinBudget === true,
  `three imported maps total ${manifest.totalBytes} bytes within the 3 MB budget`);
for (const f of manifest.files) {
  const bytes = await readFile(resolve(root, f.file));
  const sha = createHash('sha256').update(bytes).digest('hex');
  ok(bytes.length === f.bytes && sha === f.sha256, `${f.channel} bytes/hash match its manifest`);
}
const vSpan = PLANK_WINDOWS.map((w) => (w.bottom - w.top) / PLANK_TEXTURE_SIZE);
ok(vSpan.every((v) => close(v, FENCE_BOARDS.HEIGHT / FENCE_BOARDS.METRES_PER_U_TILE)),
  `V crop matches uniform art scale ${vSpan.map((v) => v.toFixed(6)).join('/')} = 0.25/4.57142857`);
ok(PLANK_WINDOWS.every((w) => w.bottom - w.top === 56),
  'all four candidate windows are 56 px uniform-scale strips');

await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
const helperPath = resolve(root, 'src/build/fence-boards.ts');
const helper = await readFile(helperPath, 'utf8');
const wrongUPath = resolve(work, 'fence-boards-wrong-u.ts');
const wrongRotPath = resolve(work, 'fence-boards-wrong-rotation.ts');
const wrongVPath = resolve(work, 'fence-boards-wrong-v.ts');
const wrongSeamPath = resolve(work, 'fence-boards-crosses-seam.ts');
await writeFile(wrongUPath, helper.replace('METRES_PER_U_TILE: 4.571428571428571', 'METRES_PER_U_TILE: 2.0'));
await writeFile(wrongRotPath, helper.replace('Math.atan2(dx, dz)', 'Math.atan2(dz, dx)'));
await writeFile(wrongVPath, helper.replace('top: 10, bottom: 66', 'top: 10, bottom: 40'));
await writeFile(wrongSeamPath, helper.replace('top: 10, bottom: 66', 'top: 50, bottom: 106'));
const wrongU = await import(pathToFileURL(wrongUPath).href + `?wrong-u-${Date.now()}`);
const wrongRot = await import(pathToFileURL(wrongRotPath).href + `?wrong-rot-${Date.now()}`);
const wrongV = await import(pathToFileURL(wrongVPath).href + `?wrong-v-${Date.now()}`);
const wrongSeam = await import(pathToFileURL(wrongSeamPath).href + `?wrong-seam-${Date.now()}`);
const wrongUBuild = wrongU.buildFenceCourseBoards([{ x0: 0, z0: 0, x1: 4, z1: 0, u0: 0 }], material);
const wrongUv = runUV(wrongUBuild, 5, 4);
ok(!wrongUv.spanOk, 'negative control: wrong 2 m provider-U constant is rejected by the 4.57142857 uniform-scale contract');
const wrongVBuild = wrongV.buildFenceCourseBoards([{ x0: 0, z0: 0, x1: 4, z1: 0, u0: 0 }], material);
const wrongVResult = runUV(wrongVBuild, 5, 4);
ok(!wrongVResult.physicalVOk, 'negative control: 30 px V strip is rejected by the exact 56 px uniform-scale contract');
const wrongSeamBuild = wrongSeam.buildFenceCourseBoards([{ x0: 0, z0: 0, x1: 4, z1: 0, u0: 0 }], material);
const wrongSeamResult = runUV(wrongSeamBuild, 5, 4);
ok(!wrongSeamResult.seamClear, 'negative control: a 56 px strip crossing the known 75..76 seam band is rejected');
const wrongRotBuild = wrongRot.buildFenceCourseBoards([{ x0: 0, z0: 0, x1: 3, z1: 4, u0: 0 }], material);
const bad = bounds(wrongRotBuild);
ok(!(close(bad.minX, 1.5 - correctHalfX) && close(bad.maxX, 1.5 + correctHalfX) &&
  close(bad.minZ, 2 - correctHalfZ) && close(bad.maxZ, 2 + correctHalfZ)),
  'negative control: rotated-geometry replacement fails the diagonal world-bounds contract');
for (const b of [actual, simple, wrongUBuild, wrongVBuild, wrongSeamBuild, wrongRotBuild]) b.mesh.geometry.dispose();
material.dispose();
await rm(work, { recursive: true, force: true });
console.log(failures === 0 ? '\nFENCE UV INDEPENDENT CANARY: PASS' : `\nFENCE UV INDEPENDENT CANARY: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
