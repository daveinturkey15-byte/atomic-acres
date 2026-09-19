#!/usr/bin/env node
/**
 * CPU-only audit for the Quiver Tree 02 GLB and the shipped placement builder.
 *
 * This gate bundles and imports the actual TypeScript desert-tree module, then
 * decodes every GLB POSITION vertex and applies a real THREE Y-rotation matrix.
 * It never trusts accessor min/max for the enclosure proof and never starts a
 * browser, renderer, server, or application build.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import * as THREE from 'three';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const assetPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(root, 'public', 'assets', 'quiver-tree', 'quiver-tree.glb');
const expectedSha = '2d65c167548c1d4d47d56ae457516cc074bc18a5fb22d67ac03604f2fe6c546e';
const expectedBounds = {
  min: [-0.4359820783, 0, -0.4402450323],
  max: [0.4359820783, 1.4688606262, 0.4402450323],
};

function fail(message) {
  throw new Error(message);
}
function close(a, b, epsilon = 1e-5) {
  return Math.abs(a - b) <= epsilon;
}
function assert(condition, message) {
  if (!condition) fail(message);
}
function aabbOfPoints(points) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  return { min, max };
}
function boxToArrays(box) {
  return {
    min: [box.min.x, box.min.y, box.min.z],
    max: [box.max.x, box.max.y, box.max.z],
  };
}

async function importActualBuilder() {
  // Keep the temporary module under the project so Node resolves the real
  // project node_modules when the bundle imports external `three` modules.
  const outfile = path.join(root, 'work', `nuketown-quiver-tree-${process.pid}.mjs`);
  try {
    await build({
      entryPoints: [path.join(root, 'src', 'build', 'desert-trees.ts')],
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      external: ['three', 'three/*'],
      outfile,
      logLevel: 'silent',
    });
    return await import(`${pathToFileURL(outfile).href}?audit=${Date.now()}`);
  } finally {
    fs.rmSync(outfile, { force: true });
  }
}

function parseGlb(buffer) {
  assert(buffer.readUInt32LE(0) === 0x46546c67, 'bad GLB magic');
  assert(buffer.readUInt32LE(4) === 2, 'unexpected GLB version');
  let offset = 12;
  let json;
  let bin;
  while (offset < buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const payload = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(payload.toString('utf8'));
    if (type === 0x004e4942) bin = payload;
    offset += 8 + length;
  }
  assert(json && bin, 'GLB is missing JSON or BIN chunk');
  return { json, bin };
}

function readPositions(gl, accessorIndex) {
  const accessor = gl.json.accessors[accessorIndex];
  assert(accessor.componentType === 5126 && accessor.type === 'VEC3', 'POSITION is not float VEC3');
  const view = gl.json.bufferViews[accessor.bufferView];
  const base = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const stride = view.byteStride ?? 12;
  const points = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < accessor.count; i++) {
    const offset = base + i * stride;
    const point = [gl.bin.readFloatLE(offset), gl.bin.readFloatLE(offset + 4), gl.bin.readFloatLE(offset + 8)];
    points.push(point);
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  return { accessor, points, min, max };
}

function nodeMatrix(node) {
  if (node.matrix) return new THREE.Matrix4().fromArray(node.matrix);
  const position = new THREE.Vector3(...(node.translation ?? [0, 0, 0]));
  const quaternion = new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1]));
  const scale = new THREE.Vector3(...(node.scale ?? [1, 1, 1]));
  return new THREE.Matrix4().compose(position, quaternion, scale);
}

function meshNodeMatrices(gltf) {
  const scene = gltf.scenes[gltf.scene ?? 0];
  const meshes = [];
  const walk = (nodeIndex, parent) => {
    const node = gltf.nodes[nodeIndex];
    const world = parent.clone().multiply(nodeMatrix(node));
    if (node.mesh !== undefined) meshes.push({ mesh: node.mesh, matrix: world });
    for (const child of node.children ?? []) walk(child, world);
  };
  for (const rootNode of scene.nodes) walk(rootNode, new THREE.Matrix4());
  return meshes;
}

const bytes = fs.readFileSync(assetPath);
const sha = crypto.createHash('sha256').update(bytes).digest('hex');
assert(sha === expectedSha, `unexpected SHA-256: ${sha}`);
const gl = parseGlb(bytes);
const gltf = gl.json;
assert(gltf.scenes?.length === 1 && gltf.scene === 0, 'expected one default scene');
assert(gltf.nodes?.length === 1 && gltf.nodes[0].mesh === 0, 'expected one mesh node');
assert(gltf.meshes?.length === 1 && gltf.meshes[0].primitives?.length === 1, 'expected one primitive');
assert(gltf.materials?.length === 1, 'expected one material');
assert(gltf.images?.length === 3, 'expected three embedded images');

const primitive = gltf.meshes[0].primitives[0];
const indexAccessor = gltf.accessors[primitive.indices];
const decoded = readPositions(gl, primitive.attributes.POSITION);
assert(decoded.accessor.count === 25488, `unexpected position count: ${decoded.accessor.count}`);
assert(indexAccessor.count === 112500, `unexpected index count: ${indexAccessor.count}`);
assert(indexAccessor.count % 3 === 0 && indexAccessor.count / 3 === 37500, 'unexpected triangle count');
for (let axis = 0; axis < 3; axis++) {
  assert(close(decoded.min[axis], expectedBounds.min[axis]), `decoded position min ${axis} drifted`);
  assert(close(decoded.max[axis], expectedBounds.max[axis]), `decoded position max ${axis} drifted`);
  assert(close(decoded.accessor.min[axis], decoded.min[axis]), `accessor min ${axis} disagrees with decoded vertices`);
  assert(close(decoded.accessor.max[axis], decoded.max[axis]), `accessor max ${axis} disagrees with decoded vertices`);
}

const imageBytes = gltf.images.map((image) => {
  const view = gltf.bufferViews[image.bufferView];
  const start = gl.bin.byteOffset + (view.byteOffset ?? 0);
  return bytes.subarray(start, start + view.byteLength);
});
assert(imageBytes.every((value) => value.length > 1000), 'embedded image unexpectedly empty');

const meshNodes = meshNodeMatrices(gltf);
assert(meshNodes.length === 1 && meshNodes[0].mesh === 0, 'expected one mesh node in scene chain');
const meshNodeMatrix = meshNodes[0].matrix;
const identity = new THREE.Matrix4();
for (let i = 0; i < 16; i++) assert(close(meshNodeMatrix.elements[i], identity.elements[i]), 'mesh node transform drifted');

// Explicitly pin the convention used by THREE.Matrix4 and Quaternion Y rotation:
// +X rotated +90 degrees points toward -Z.
const orientationProbe = new THREE.Vector3(1, 0, 0).applyMatrix4(
  new THREE.Matrix4().makeRotationY(Math.PI / 2),
);
assert(close(orientationProbe.x, 0) && close(orientationProbe.z, -1), 'THREE Y rotation convention changed');

const actual = await importActualBuilder();
const placements = actual.DESERT_TREE_PLACEMENTS;
assert(Array.isArray(placements) && placements.length === 2, `expected two actual placements, found ${placements?.length}`);
const actualColliders = placements.map((placement) => actual.desertTreeCollider(placement));
assert(actualColliders.length === placements.length, 'actual placement/collider count mismatch');

const transformed = [];
const transformedAabbs = [];
for (let index = 0; index < placements.length; index++) {
  const placement = placements[index];
  const placementMatrix = new THREE.Matrix4().compose(
    new THREE.Vector3(placement.x, 0.151, placement.z),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), placement.yaw),
    new THREE.Vector3(1, 1, 1),
  );
  const worldMatrix = placementMatrix.clone().multiply(meshNodeMatrix);
  const worldPoints = decoded.points.map((point) => new THREE.Vector3(...point).applyMatrix4(worldMatrix));
  const worldArrays = worldPoints.map((point) => [point.x, point.y, point.z]);
  const worldAabb = aabbOfPoints(worldArrays);
  const collider = boxToArrays(actualColliders[index]);
  for (let axis = 0; axis < 3; axis++) {
    assert(worldAabb.min[axis] >= collider.min[axis] - 1e-5,
      `${placement.name} actual vertices escape collider min axis ${axis}`);
    assert(worldAabb.max[axis] <= collider.max[axis] + 1e-5,
      `${placement.name} actual vertices escape collider max axis ${axis}`);
  }
  transformed.push({ name: placement.name, vertices: worldPoints.length });
  transformedAabbs.push({ name: placement.name, bounds: worldAabb, collider });
}

console.log(JSON.stringify({
  asset: path.relative(root, assetPath),
  bytes: bytes.length,
  sha256: sha,
  triangles: indexAccessor.count / 3,
  vertices: decoded.points.length,
  materials: gltf.materials.length,
  images: imageBytes.map((value) => ({ bytes: value.length, sha256: crypto.createHash('sha256').update(value).digest('hex') })),
  node: { name: gltf.nodes[0].name, transform: 'identity' },
  decodedBounds: { min: decoded.min, max: decoded.max },
  placements: placements.map((placement) => ({ ...placement })),
  transformed,
  enclosure: transformedAabbs,
  proof: 'actual TypeScript placements/colliders + every decoded POSITION vertex + THREE Y matrix',
}, null, 2));
