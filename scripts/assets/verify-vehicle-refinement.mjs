/**
 * CPU-only verifier for the bounded saloon refinement.
 *
 * This checks profile math and then instantiates the real makeSaloon function
 * from frozen base source and current source in an in-memory esbuild wrapper.
 * The wrapper names body and roof meshes only for this audit; production source
 * is not changed. A negative wrapper removes the body attachment and must fail.
 * No browser, GPU, server, or application build is started.
 */
import * as THREE from 'three';
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const BASE = 'fb7151498ac8e826e3c1066484219420c3c7a8bc';
const W = 1.95;
const SALOON_PLACEMENTS = 3;
const TRI_BUDGET = 5000;
const currentSource = readFileSync(join(ROOT, 'src/build/vehicles.ts'), 'utf8');
const baseSource = execFileSync('git', ['show', `${BASE}:src/build/vehicles.ts`], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 2 ** 24,
});
const sourceHash = createHash('sha256').update(currentSource).digest('hex');

const BASE_BODY = [
  [-2.4, 0.34], [2.4, 0.34], [2.42, 0.78], [1.12, 0.9],
  [-1.6, 0.94], [-2.34, 0.98], [-2.42, 0.76],
];
const BASE_ROOF_BOX = { w: 1.86, h: 0.1, d: W * 0.86, x: -0.3, y: 1.41 };

const sourceSlice = (source) => {
  const start = source.indexOf('function makeSaloon');
  const end = source.indexOf('function makeDisplaySedan');
  if (start < 0 || end < 0) throw new Error('makeSaloon bounds not found');
  return source.slice(start, end);
};
const saloon = sourceSlice(currentSource);

function evalPair(expr, L) {
  const value = Function('L', `'use strict'; return (${expr.trim()});`)(L);
  if (!Number.isFinite(value)) throw new Error(`non-numeric profile expression: ${expr}`);
  return value;
}

function profilePoints(source, name) {
  const section = sourceSlice(source);
  const match = section.match(new RegExp(`const ${name}: Pt\\[\\] = \\[([\\s\\S]*?)\\];`));
  if (!match) throw new Error(`profile '${name}' not found`);
  const pairs = [...match[1].matchAll(/\[([^\[\]]+?),([^\[\]]+?)\]/g)];
  if (!pairs.length) throw new Error(`profile '${name}' has no points`);
  return pairs.map((pair) => [evalPair(pair[1], 4.8), evalPair(pair[2], 4.8)]);
}

function extrudeStats(points, depth) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (const point of points.slice(1)) shape.lineTo(point[0], point[1]);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geometry.translate(0, 0, -depth / 2);
  geometry.computeBoundingBox();
  const triangles = geometry.index
    ? geometry.index.count / 3
    : geometry.attributes.position.count / 3;
  return { triangles, box: geometry.boundingBox.clone() };
}

const ext = (points) => [
  Math.min(...points.map((point) => point[0])), Math.max(...points.map((point) => point[0])),
  Math.min(...points.map((point) => point[1])), Math.max(...points.map((point) => point[1])),
];
const close = (a, b, epsilon = 1e-6) => Math.abs(a - b) <= epsilon;
const boxesEqual = (a, b, epsilon = 1e-6) => Boolean(a && b)
  && close(a.min.x, b.min.x, epsilon) && close(a.min.y, b.min.y, epsilon)
  && close(a.min.z, b.min.z, epsilon) && close(a.max.x, b.max.x, epsilon)
  && close(a.max.y, b.max.y, epsilon) && close(a.max.z, b.max.z, epsilon);

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  ${detail}`);
  if (!ok) failures++;
};

// ---- source/profile checks -------------------------------------------------
check('roof box removed', !saloon.includes('box(1.86'), 'old flat roof box gone');
check('roof extrude added', saloon.includes('extrude(roof'), 'one crowned extrude present');
check('body attachment present', (saloon.match(/g\.add\(extrude\(body/g) || []).length === 1,
  'one lower-body extrude is attached in makeSaloon');
check('no material constructors', !/new THREE\.\w*Material/.test(saloon), 'registry-only materials');
check('display sedan untouched', !currentSource.slice(currentSource.indexOf('function makeDisplaySedan'))
  .includes('const roof: Pt[]'), 'crowned roof is scoped to makeSaloon');

const bodyBefore = extrudeStats(BASE_BODY, W);
const bodyAfterPoints = profilePoints(currentSource, 'body');
const bodyAfter = extrudeStats(bodyAfterPoints, W);
check('body profile bbox preserved', ext(bodyAfterPoints).every((value, index) => close(value, ext(BASE_BODY)[index])),
  `x[${ext(bodyAfterPoints)[0]},${ext(bodyAfterPoints)[1]}] y[${ext(bodyAfterPoints)[2]},${ext(bodyAfterPoints)[3]}]`);
console.log(`INFO  body profile tris: ${bodyBefore.triangles} -> ${bodyAfter.triangles} (n=7->${bodyAfterPoints.length})`);

const roofAfterPoints = profilePoints(currentSource, 'roof');
const roofAfter = extrudeStats(roofAfterPoints, W * 0.86);
const boxGeometry = new THREE.BoxGeometry(BASE_ROOF_BOX.w, BASE_ROOF_BOX.h, BASE_ROOF_BOX.d);
const boxTriangles = boxGeometry.index.count / 3;
const roofMin = new THREE.Vector3(BASE_ROOF_BOX.x - BASE_ROOF_BOX.w / 2,
  BASE_ROOF_BOX.y - BASE_ROOF_BOX.h / 2, -BASE_ROOF_BOX.d / 2);
const roofMax = new THREE.Vector3(BASE_ROOF_BOX.x + BASE_ROOF_BOX.w / 2,
  BASE_ROOF_BOX.y + BASE_ROOF_BOX.h / 2, BASE_ROOF_BOX.d / 2);
check('roof profile bbox preserved', roofAfter.box.min.distanceTo(roofMin) < 1e-6
  && roofAfter.box.max.distanceTo(roofMax) < 1e-6,
  `x[${roofAfter.box.min.x},${roofAfter.box.max.x}] y[${roofAfter.box.min.y},${roofAfter.box.max.y}]`);
console.log(`INFO  roof profile tris: ${boxTriangles} -> ${roofAfter.triangles} (6-point crown)`);

// ---- actual makeSaloon instantiation --------------------------------------
const BODY_SIGNATURE = '  g.add(extrude(body, W, paint));';
const CURRENT_ROOF_SIGNATURE = '  g.add(extrude(roof, W * 0.86, roofPaint));';
const BASE_ROOF_SIGNATURE = '  g.add(box(1.86, 0.1, W * 0.86, roofPaint, -0.3, 1.41, 0));';

function instrument(source, attachBody) {
  let out = source.replace(
    'function makeSaloon(ctx: BuildContext, colour: number, o: SaloonOpts): Vehicle {',
    'export function makeSaloon(ctx: BuildContext, colour: number, o: SaloonOpts): Vehicle {',
  );
  if (!out.includes('export function makeSaloon')) throw new Error('could not export makeSaloon');
  if (!out.includes(BODY_SIGNATURE)) throw new Error('body attachment signature missing');
  out = out.replace(BODY_SIGNATURE, attachBody
    ? "  const bodyAudit = extrude(body, W, paint); bodyAudit.name = 'saloon-body-audit'; g.add(bodyAudit);"
    : '');
  if (out.includes(CURRENT_ROOF_SIGNATURE)) {
    out = out.replace(CURRENT_ROOF_SIGNATURE,
      "  const roofAudit = extrude(roof, W * 0.86, roofPaint); roofAudit.name = 'saloon-roof-audit'; g.add(roofAudit);");
  } else if (out.includes(BASE_ROOF_SIGNATURE)) {
    out = out.replace(BASE_ROOF_SIGNATURE,
      "  const roofAudit = box(1.86, 0.1, W * 0.86, roofPaint, -0.3, 1.41, 0); roofAudit.name = 'saloon-roof-audit'; g.add(roofAudit);");
  } else {
    throw new Error('roof attachment signature missing');
  }
  return out;
}

async function bundleSource(source, label, attachBody = true) {
  const outfile = join(tmpdir(), `nuketown-vehicle-${label}-${process.pid}.mjs`);
  try {
    await build({
      stdin: {
        contents: instrument(source, attachBody), loader: 'ts',
        resolveDir: join(ROOT, 'src', 'build'), sourcefile: `vehicles-${label}-audit.ts`,
      },
      bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile, logLevel: 'warning',
    });
    return await import(`${pathToFileURL(outfile).href}?audit=${label}-${Date.now()}`);
  } finally {
    rmSync(outfile, { force: true });
  }
}

function makeMaterials() {
  const cache = new Map();
  const material = (key, colour) => {
    if (!cache.has(key)) cache.set(key, new THREE.MeshBasicMaterial({ color: colour ?? 0x777777 }));
    return cache.get(key);
  };
  return {
    painted: (colour, roughness, metalness) => material(`painted:${colour}:${roughness}:${metalness}`, colour),
    signText: (options) => material(`sign:${JSON.stringify(options)}`, options.color ?? 0x777777),
    windowDark: material('windowDark', 0x151a22),
  };
}

function triangles(geometry) {
  return geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
}

function sceneSnapshot(group) {
  const sceneBox = new THREE.Box3().setFromObject(group);
  const materials = new Map();
  let draws = 0;
  let rawTriangles = 0;
  let expandedTriangles = 0;
  let body = null;
  let roof = null;
  group.traverse((node) => {
    const mesh = node;
    if (!mesh.isMesh) return;
    draws++;
    const count = triangles(mesh.geometry);
    rawTriangles += count;
    expandedTriangles += count * (mesh.isInstancedMesh ? mesh.count : 1);
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of list) {
      const colour = mat.color?.getHexString?.() ?? '';
      const key = `${mat.type}:${colour}:${mat.opacity}:${mat.transparent}`;
      materials.set(key, (materials.get(key) ?? 0) + 1);
    }
    if (mesh.name === 'saloon-body-audit') body = mesh;
    if (mesh.name === 'saloon-roof-audit') roof = mesh;
  });
  return {
    draws, rawTriangles, expandedTriangles, sceneBox,
    materials: [...materials.entries()].sort(),
    bodyCount: body ? 1 : 0,
    bodyTriangles: body ? triangles(body.geometry) : 0,
    bodyBox: body ? new THREE.Box3().setFromObject(body) : null,
    roofCount: roof ? 1 : 0,
    roofTriangles: roof ? triangles(roof.geometry) : 0,
  };
}

async function instantiate(source, label, attachBody = true) {
  const mod = await bundleSource(source, label, attachBody);
  const result = mod.makeSaloon({ mat: makeMaterials(), rand: () => 0.5 }, 0x345678,
    { fin: 0.32, twoTone: true, brightwork: true });
  return sceneSnapshot(result.obj);
}

const base = await instantiate(baseSource, 'base');
const current = await instantiate(currentSource, 'current');
console.log(`INFO  actual base/current draws: ${base.draws}/${current.draws}`);
console.log(`INFO  actual base/current expanded tris: ${base.expandedTriangles}/${current.expandedTriangles}`);
console.log(`INFO  actual vehicles.ts sha256: ${sourceHash}`);

check('actual base body attached', base.bodyCount === 1 && base.bodyTriangles === 24,
  `count=${base.bodyCount} tris=${base.bodyTriangles}`);
check('actual current body attached', current.bodyCount === 1 && current.bodyTriangles === 32,
  `count=${current.bodyCount} tris=${current.bodyTriangles}`);
check('actual body bounds preserved', boxesEqual(base.bodyBox, current.bodyBox),
  `base=${base.bodyBox?.min.toArray()}..${base.bodyBox?.max.toArray()} current=${current.bodyBox?.min.toArray()}..${current.bodyBox?.max.toArray()}`);
check('actual roof attached', current.roofCount === 1 && current.roofTriangles === 20,
  `count=${current.roofCount} tris=${current.roofTriangles}`);
check('actual scene bounds preserved', boxesEqual(base.sceneBox, current.sceneBox),
  `base=${base.sceneBox.min.toArray()}..${base.sceneBox.max.toArray()} current=${current.sceneBox.min.toArray()}..${current.sceneBox.max.toArray()}`);
check('actual draw count preserved', current.draws === base.draws,
  `base=${base.draws} current=${current.draws}`);
check('actual material usage preserved', JSON.stringify(current.materials) === JSON.stringify(base.materials),
  `base=${base.materials.length} signatures current=${current.materials.length} signatures`);
const actualDelta = current.expandedTriangles - base.expandedTriangles;
check('actual saloon triangle delta', actualDelta === 16, `+${actualDelta} per saloon`);
const worldDelta = actualDelta * SALOON_PLACEMENTS;
check('world tri budget', worldDelta <= TRI_BUDGET, `+${worldDelta} <= +${TRI_BUDGET} world tris`);

const negative = await instantiate(currentSource, 'negative-no-body', false);
const negativeWouldPass = negative.bodyCount === 1
  && negative.draws === base.draws
  && boxesEqual(negative.sceneBox, base.sceneBox)
  && negative.expandedTriangles - base.expandedTriangles === 16;
check('negative control rejects missing body attachment', !negativeWouldPass,
  `body=${negative.bodyCount} draws=${negative.draws} trisDelta=${negative.expandedTriangles - base.expandedTriangles}`);

process.exit(failures ? 1 : 0);
