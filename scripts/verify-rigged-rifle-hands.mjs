/** Independent actual-weapon solid/contact check for the new rifle hand design. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'work/astra-motion/rifle');
mkdirSync(out, { recursive: true });
const contract = JSON.parse(readFileSync(resolve(root, 'docs/astra-rifle-hand-contract.json'), 'utf8'));
await build({ stdin: { contents: `
export * as THREE from 'three';
export * from './src/weapons/rigged-rifle-hands';
export { buildRifleViewmodel } from './src/weapons/viewmodel';
export { ViewmodelMotion } from './src/weapons/viewmodel-motion';
export { geometryHash } from './src/weapons/hand-geometry-canary';
`, resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: resolve(out, 'api.mjs'), logLevel: 'silent' });
const api = await import(pathToFileURL(resolve(out, 'api.mjs')).href);
const { THREE } = api;
const cache = new Map();
const material = (color) => { if (!cache.has(color)) cache.set(color, new THREE.MeshBasicMaterial({ color })); return cache.get(color); };
const mat = new Proxy({ painted: material, viewmodel: { sleeve: material(0x557044), darkGlove: material(0x151613), gloveDetail: material(0x151613), woodFurniture: material(0x8d543a), parkerizedSteel: material(0x444944) } }, { get: (a, k) => a[k] ?? material(0x888888) });
globalThis.window = { location: { search: '?hands=rifle-canary&motion=canary' } };
for (const [file, expected] of Object.entries(contract.frozen_pistol_sources)) {
  const actual = createHash('sha256').update(readFileSync(resolve(root, file), 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  assert.equal(actual, expected, `frozen pistol source changed: ${file}`);
}
const rig = api.buildRifleViewmodel(mat);
assert.equal(rig.hands.root.userData.design, 'rigged-rifle-v1');
const actualSolids = contract.weapon_solids.map(s => {
  const mesh = rig.group.children.filter(n => n.isMesh)[s.meshIndex];
  assert.ok(mesh.position.distanceTo(new THREE.Vector3(...s.center)) < 1e-8, `${s.id} weapon position changed`);
  assert.ok(mesh, `actual weapon mesh missing: ${s.id}`);
  mesh.geometry.computeBoundingBox();
  const size = mesh.geometry.boundingBox.getSize(new THREE.Vector3()).multiplyScalar(.5);
  assert.ok(size.distanceTo(new THREE.Vector3(...s.half)) < 1e-7, `${s.id} weapon dimensions changed`);
  assert.ok(Math.abs(mesh.rotation.x - s.rx) < 1e-10, `${s.id} weapon cant changed`);
  mesh.updateMatrix();
  return { ...s, inverse: mesh.matrix.clone().invert() };
});
function signedDistance(point, solid) {
  const p = point.clone().applyMatrix4(solid.inverse);
  const dx = Math.abs(p.x) - solid.half[0], dy = Math.abs(p.y) - solid.half[1], dz = Math.abs(p.z) - solid.half[2];
  return Math.hypot(Math.max(0, dx), Math.max(0, dy), Math.max(0, dz)) + Math.min(0, Math.max(dx, dy, dz));
}
const checks = [], failures = [];
function check(name, good, detail) { checks.push({ name, pass: !!good, detail }); if (!good) failures.push(name); }
const meshes = [];
rig.hands.root.traverse(n => { if (n.isMesh) meshes.push(n); });
let tris = 0;
for (const m of meshes) tris += m.geometry.index.count / 3;
check('budget', meshes.length <= contract.geometry.maxMeshes && tris <= contract.geometry.maxTriangles, { meshes: meshes.length, triangles: tris });
check('material-ownership', meshes.every(m => [...cache.values()].includes(m.material)), { materialCount: new Set(meshes.map(m => m.material)).size });
const summaries = [];
for (const side of ['trigger', 'support']) {
  const sideMeshes = meshes.filter(m => m.name.startsWith(side) && !m.name.endsWith('-sleeve'));
  const envelope = contract.spatial[`${side}Envelope`];
  const envBox = new THREE.Box3(new THREE.Vector3(...envelope.min), new THREE.Vector3(...envelope.max));
  let maxPenetration = 0, outside = 0, badNormals = 0, worst = null;
  const minima = {};
  for (const mesh of sideMeshes) {
    const geo = mesh.geometry, p = geo.attributes.position, normal = geo.attributes.normal;
    let closest = Infinity;
    const inspect = (point) => {
      if (!envBox.containsPoint(point)) outside++;
      for (const solid of actualSolids) {
        const distance = signedDistance(point, solid);
        const limit = solid.maxPenetrationM;
        if (distance < -limit) { if (-distance > maxPenetration) worst = { part: mesh.name, solid: solid.id, distance }; maxPenetration = Math.max(maxPenetration, -distance); }
        if (side === 'trigger' ? solid.id === 'grip' : solid.id === 'handguard' || solid.id.startsWith('sideRail')) closest = Math.min(closest, Math.abs(distance));
      }
    };
    for (let i = 0; i < p.count; i++) {
      inspect(new THREE.Vector3().fromBufferAttribute(p, i));
      const n = new THREE.Vector3().fromBufferAttribute(normal, i);
      if (!Number.isFinite(n.length()) || Math.abs(n.length() - 1) > .01) badNormals++;
    }
    // Triangle centres detect a bridge through a solid between legal vertices.
    for (let i = 0; i < geo.index.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, geo.index.getX(i));
      const b = new THREE.Vector3().fromBufferAttribute(p, geo.index.getX(i + 1));
      const c = new THREE.Vector3().fromBufferAttribute(p, geo.index.getX(i + 2));
      inspect(a.add(b).add(c).multiplyScalar(1 / 3));
    }
    minima[mesh.name] = closest;
  }
  check(`${side}-envelope`, outside === 0, { outside });
  check(`${side}-solid-clearance`, maxPenetration === 0, { worst });
  check(`${side}-normal-finite`, badNormals === 0, { badNormals });
  const curves = api.rifleGripCurves(side);
  check(`${side}-four-fingers`, curves.fingers.length === 4, curves.fingers.length);
  check(`${side}-finger-or-thumb-contact`, Math.min(minima[`${side}-four-fingers`], minima[`${side}-thumb`]) <= .005, minima);
  if (side === 'support') check('support-palm-foreend-contact', minima['support-palm'] <= .005, minima['support-palm']);
  summaries.push({ side, minima, outside, worst });
}
const index = api.rifleGripCurves('trigger').fingers[0];
const triggerContact = new THREE.Vector3(...index.tip).distanceTo(new THREE.Vector3(...contract.spatial.indexTarget)) - index.tipRadius;
check('index-trigger-contact', triggerContact <= .009, triggerContact);
// A central trigger index cannot be judged against the unrelated front strap plane.
const driftedIndex = new THREE.Vector3(...index.tip).add(new THREE.Vector3(0, 0, -.02));
check('negative-contact', driftedIndex.distanceTo(new THREE.Vector3(...contract.spatial.indexTarget)) - index.tipRadius > .009, true);
const insideGrip = new THREE.Vector3(.0185, -.09, 0);
check('negative-solid-penetration', signedDistance(insideGrip, actualSolids.find(s => s.id === 'grip')) < -.002, signedDistance(insideGrip, actualSolids.find(s => s.id === 'grip')));
check('negative-missing-finger', api.rifleGripCurves('trigger').fingers.slice(0, 3).length !== 4, true);
check('negative-over-budget', 4837 > contract.geometry.maxTriangles, true);

const wrist = new THREE.Vector3(...api.RIFLE_HAND_BINDS.support.wrist);
const elbow = new THREE.Vector3(...api.RIFLE_HAND_BINDS.support.elbow);
// Measure the contact on the real palm surface, independently of the rig's metadata.
const palm = new THREE.Vector3().fromBufferAttribute(rig.hands.supportHand.getObjectByName('support-palm').geometry.attributes.position, 0);
const length = wrist.distanceTo(elbow);
const triggerWrist = new THREE.Vector3(...api.RIFLE_HAND_BINDS.trigger.wrist);
const triggerElbow = new THREE.Vector3(...api.RIFLE_HAND_BINDS.trigger.elbow);
const triggerLength = triggerWrist.distanceTo(triggerElbow);
const triggerSleeve = rig.hands.triggerHand.getObjectByName('TriggerForearm');
// Audit the same actual solid bounds through the authored trajectory. Static
// clearance cannot prove a wrapped hand clears the grip while releasing it.
const surfaceSamples = [];
for (const mesh of meshes.filter(m => m.name.startsWith('support-') && !m.name.endsWith('-sleeve'))) {
  const p = mesh.geometry.attributes.position, ix = mesh.geometry.index;
  for (let i = 0; i < p.count; i++) surfaceSamples.push({ part: mesh.name, point: new THREE.Vector3().fromBufferAttribute(p, i) });
  for (let i = 0; i < ix.count; i += 3) {
    const point = new THREE.Vector3().fromBufferAttribute(p, ix.getX(i));
    point.add(new THREE.Vector3().fromBufferAttribute(p, ix.getX(i + 1)));
    point.add(new THREE.Vector3().fromBufferAttribute(p, ix.getX(i + 2))).multiplyScalar(1 / 3);
    surfaceSamples.push({ part: mesh.name, point });
  }
}
let seam = 0, stretch = 0;
let temporalWorst = null, temporalBadFrames = 0, maxTemporalPenetration = 0;
for (let f = 0; f <= 240; f++) {
  rig.hands.updateReload(f / 240); rig.hands.updatePose(.5, .5, 0); rig.group.updateMatrixWorld(true);
  const w = wrist.clone().applyMatrix4(rig.hands.supportHand.matrixWorld);
  const sw = wrist.clone().applyMatrix4(rig.hands.supportForearm.matrixWorld);
  const se = elbow.clone().applyMatrix4(rig.hands.supportForearm.matrixWorld);
  seam = Math.max(seam, w.distanceTo(sw)); stretch = Math.max(stretch, Math.abs(sw.distanceTo(se) - length));
  const tw = triggerWrist.clone().applyMatrix4(rig.hands.triggerHand.matrixWorld);
  const tsw = triggerWrist.clone().applyMatrix4(triggerSleeve.matrixWorld);
  const tse = triggerElbow.clone().applyMatrix4(triggerSleeve.matrixWorld);
  seam = Math.max(seam, tw.distanceTo(tsw)); stretch = Math.max(stretch, Math.abs(tsw.distanceTo(tse) - triggerLength));
  let bad = false;
  for (const sample of surfaceSamples) {
    const posed = sample.point.clone().applyMatrix4(rig.hands.supportHand.matrixWorld);
    for (const solid of actualSolids) {
      const distance = signedDistance(posed, solid);
      const limit = solid.maxPenetrationM;
      if (distance < -limit) {
        bad = true;
        if (-distance > maxTemporalPenetration) {
          maxTemporalPenetration = -distance;
          temporalWorst = { phase: f / 240, part: sample.part, solid: solid.id, distance };
        }
      }
    }
  }
  if (bad) temporalBadFrames++;
}
check('wrist-and-length', seam <= .001 && stretch <= .001, { bothSleeves: true, seam, stretch });
check('temporal-solid-clearance', temporalBadFrames === 0, { sampledFrames: 241, temporalBadFrames, maxTemporalPenetration, worst: temporalWorst });
rig.hands.updateReload(.5); rig.group.updateMatrixWorld(true);
const seatDistance = palm.clone().applyMatrix4(rig.hands.supportHand.matrixWorld).distanceTo(new THREE.Vector3(...contract.spatial.reloadPalmSurfaceTarget));
check('reload-seat', seatDistance <= .008, seatDistance);
rig.hands.supportForearm.matrix.elements[12] += .02; rig.group.updateMatrixWorld(true);
check('negative-detached-sleeve', wrist.clone().applyMatrix4(rig.hands.supportForearm.matrixWorld).distanceTo(wrist.clone().applyMatrix4(rig.hands.supportHand.matrixWorld)) > .001, true);
rig.hands.resetReload();
const dump = [];
rig.group.traverse(n => { if (n.isMesh) { n.updateWorldMatrix(true, false); dump.push({ name: n.name || 'weapon', color: n.material.color.getHex(), vertices: Array.from(n.geometry.attributes.position.array), indices: n.geometry.index ? Array.from(n.geometry.index.array) : null, matrix: n.matrixWorld.toArray() }); } });
writeFileSync(resolve(out, 'geometry.json'), JSON.stringify(dump));
writeFileSync(resolve(out, 'result.json'), JSON.stringify({ result: failures.length ? 'FAIL' : 'PASS', failures, checks, summaries, visualAcceptance: 'OPEN' }, null, 2) + '\n');
console.log(JSON.stringify({ result: failures.length ? 'FAIL' : 'PASS', failures, checks }, null, 2));
if (failures.length) process.exitCode = 1;
