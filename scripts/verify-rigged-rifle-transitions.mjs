/** Additional offhand/low-stance audit; run frozen hand verifier first. CPU only. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'work/astra-motion/rifle');
const api = await import(pathToFileURL(resolve(out, 'api.mjs')));
const { THREE } = api;
const cache = new Map();
const material = color => { if (!cache.has(color)) cache.set(color, new THREE.MeshBasicMaterial({ color })); return cache.get(color); };
const mat = new Proxy({ painted: material, viewmodel: { sleeve: material(0x557044), darkGlove: material(0x151613), gloveDetail: material(0x151613), woodFurniture: material(0x8d543a), parkerizedSteel: material(0x444944) } }, { get: (a, k) => a[k] ?? material(0x888888) });
globalThis.window = { location: { search: '?hands=rifle-canary&motion=canary' } };
const rig = api.buildRifleViewmodel(mat);
assert.equal(rig.hands.root.userData.design, 'rigged-rifle-v1');
const contract = JSON.parse(readFileSync(resolve(root, 'docs/astra-rifle-hand-contract.json'), 'utf8'));
const solids = contract.weapon_solids.map(s => {
  const mesh = rig.group.children.filter(n => n.isMesh)[s.meshIndex];
  assert.ok(mesh); mesh.updateMatrix(); return { ...s, inverse: mesh.matrix.clone().invert() };
});
const points = [];
rig.hands.supportHand.traverse(m => {
  if (!m.isMesh || m.name.endsWith('-sleeve')) return;
  const p = m.geometry.attributes.position, ix = m.geometry.index;
  for (let i = 0; i < p.count; i++) points.push({ part: m.name, point: new THREE.Vector3().fromBufferAttribute(p, i) });
  for (let i = 0; i < ix.count; i += 3) {
    const point = new THREE.Vector3();
    for (let j = 0; j < 3; j++) point.add(new THREE.Vector3().fromBufferAttribute(p, ix.getX(i + j)));
    points.push({ part: m.name, point: point.multiplyScalar(1 / 3) });
  }
});
const local = new THREE.Vector3(), posed = new THREE.Vector3();
let bad = 0, worst = null, maxPenetration = 0;
for (const offHand of [0, .25, .5, .75, 1]) for (let frame = 0; frame <= 240; frame++) {
  rig.hands.updateReload(frame / 240); rig.hands.updatePose(.5, .5, offHand); rig.group.updateMatrixWorld(true);
  let frameBad = false;
  for (const sample of points) {
    posed.copy(sample.point).applyMatrix4(rig.hands.supportHand.matrixWorld);
    for (const solid of solids) {
      local.copy(posed).applyMatrix4(solid.inverse);
      const penetration = Math.min(solid.half[0] - Math.abs(local.x), solid.half[1] - Math.abs(local.y), solid.half[2] - Math.abs(local.z));
      const limit = solid.maxPenetrationM;
      if (penetration > limit) {
        frameBad = true;
        if (penetration > maxPenetration) { maxPenetration = penetration; worst = { offHand, phase: frame / 240, part: sample.part, solid: solid.id, penetration }; }
      }
    }
  }
  if (frameBad) bad++;
}
const motion = new api.ViewmodelMotion(), box = new THREE.Box3();
let minimumWorldY = Infinity, floorWorst = null;
for (const prone of [false, true]) for (const ads of [0, 1]) for (const offHand of [0, .25, .5, .75, 1]) for (let frame = 0; frame <= 48; frame++) {
  const phase = frame / 48;
  // Actual main.ts crouched sample is getStance() !== 'stand', including prone.
  motion.reset(); motion.update(1 / 60, 1, 'rifle', ads, 0, 0, 0, phase, offHand, 0, 0, 0, true, prone);
  rig.hands.updateReload(phase); rig.hands.updatePose(motion.crouch, motion.prone, offHand);
  rig.group.position.copy(motion.offset); rig.group.position.y += prone ? .5 : 1.05;
  rig.group.rotation.copy(motion.rotation); rig.group.updateMatrixWorld(true);
  box.setFromObject(rig.group, true);
  if (box.min.y < minimumWorldY) { minimumWorldY = box.min.y; floorWorst = { prone, ads, offHand, phase }; }
}
const result = { result: bad === 0 && minimumWorldY >= .02 ? 'PASS' : 'FAIL', contact: { frames: 1205, badFrames: bad, maxExcessPenetration: maxPenetration, worst }, floor: { levelCameraOnly: true, frames: 980, minimumWorldY, threshold: .02, worst: floorWorst }, visualAcceptance: 'OPEN' };
writeFileSync(resolve(out, 'transitions.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (result.result !== 'PASS') process.exitCode = 1;
