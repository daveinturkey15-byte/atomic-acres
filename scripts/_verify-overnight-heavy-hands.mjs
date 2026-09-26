/** CPU geometry/contact proof. Pixel, motion and 60 FPS acceptance remain separate. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const folder = mkdtempSync(join(tmpdir(), 'aa-heavy-hands-'));
const baselineRef = 'ac3f1d45b31c5516fa9504980ce4aa4828674ffa';
const retained = execFileSync('git', ['show', `${baselineRef}:src/weapons/reference-weapon-models.ts`], { cwd: root, encoding: 'utf8' });
const initialRef = '6d5fde72042cf6492ca438056bba55d5cc46e113';
const initialSources = Object.fromEntries(['reference-weapon-models', 'reference-heavy-hands'].map(name => [name,
  execFileSync('git', ['show', `${initialRef}:src/weapons/${name}.ts`], { cwd: root, encoding: 'utf8' })]));
const entry = `export * as THREE from 'three'; export * from './src/weapons/reference-weapon-models';
 export {collectGltfResources} from './src/weapons/catalog-carbine-loader';`;
const modules = [];
for (const baseline of [false, true, 'initial']) {
  const outfile = join(folder, baseline === 'initial' ? 'initial.mjs' : baseline ? 'baseline.mjs' : 'candidate.mjs');
  await build({ stdin: { contents: entry, resolveDir: root, loader: 'ts' }, outfile,
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent', plugins: baseline ? [{
      name: 'retained-adapter', setup(b) { b.onLoad({ filter: /reference-(weapon-models|heavy-hands)\.ts$/ }, args => ({
        contents: baseline === 'initial' ? initialSources[args.path.endsWith('reference-heavy-hands.ts') ? 'reference-heavy-hands' : 'reference-weapon-models'] : retained,
        loader: 'ts', resolveDir: join(root, 'src/weapons'),
      })); },
    }] : [] });
  modules.push(await import(pathToFileURL(outfile).href));
}
globalThis.self = globalThis;
const images = [];
globalThis.createImageBitmap = async (blob) => {
  const bytes = Buffer.from(await blob.arrayBuffer());
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  const image = { width: 512, height: 512, closes: 0, close() { this.closes++; } };
  images.push(image); return image;
};
const [api, oldApi, initialApi] = modules, { THREE } = api;
assert.equal(api.isHeavyHandsCanaryRequested(), false, 'headless/default path preserves accepted rig');
globalThis.location = { search: '?heavy-hands=canary' };
assert.equal(api.isHeavyHandsCanaryRequested(), true, 'actual browser query admits only the explicit canary');
globalThis.location = { search: '?heavy-hands=off' };
assert.equal(api.isHeavyHandsCanaryRequested(), false);
delete globalThis.location;
const manifest = JSON.parse(readFileSync(join(root, 'public/assets/reference-weapons/source-provenance.json')));
for (const row of manifest.files) {
  const bytes = readFileSync(join(root, row.targetPath));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, 'original asset byte identity');
}
const material = new THREE.MeshStandardMaterial(); let materialDisposed = 0;
material.addEventListener('dispose', () => materialDisposed++);
const mat = { viewmodel: { sleeve: material, darkGlove: material, gloveDetail: material }, painted: () => material };
const parse = async (a, id) => {
  const b = readFileSync(join(root, `public/assets/reference-weapons/${id}/${id}-fp-lod0.glb`));
  return a.createReferenceWeaponLoader().parseAsync(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), '');
};
const signature = rig => {
  const hash = createHash('sha256');
  rig.group.updateMatrixWorld(true);
  rig.group.traverse(n => {
    hash.update(n.name); hash.update(JSON.stringify(n.matrixWorld.elements));
    if (n.isMesh) {
      hash.update(Buffer.from(n.geometry.attributes.position.array.buffer));
      if (n.geometry.index) hash.update(Buffer.from(n.geometry.index.array.buffer));
    }
  });
  return { geometry: hash.digest('hex'), ads: rig.adsMount, stats: rig.stats };
};
for (const id of ['mini-uzi', 'magnum', 'minigun']) {
  const before = oldApi.adaptReferenceWeaponModel(id, await parse(oldApi, id), mat);
  const after = api.adaptReferenceWeaponModel(id, await parse(api, id), mat);
  assert.deepEqual(signature(after), signature(before), `${id} geometry, hand placement, sights and budget unchanged`);
  assert.equal(after.cameraOffset, undefined);
  before.dispose(); after.dispose();
}
const model = await parse(api, 'minigun');
assert.equal(model.animations.length, 13);
const rig = api.adaptReferenceWeaponModel('minigun', model, mat, { heavyHands: true });
const handMeshes = [];
rig.hands.root.traverse(n => { if (n.isMesh) handMeshes.push(n); });
const handTris = handMeshes.reduce((n, m) => n + (m.geometry.index?.count ?? m.geometry.attributes.position.count) / 3, 0);
assert(handMeshes.length <= 12 && handTris <= 4000, `hands exceed frozen budget ${handMeshes.length}/${handTris}`);
assert(rig.stats.meshes <= 16 && rig.stats.triangles <= 16000);
assert.equal(rig.stats.textures, 5, 'the original five embedded textures are unchanged');
rig.group.updateMatrixWorld(true);
for (const m of handMeshes) {
  const p = m.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) assert([p.getX(i), p.getY(i), p.getZ(i)].every(Number.isFinite));
}
// Independent closest-point test against actual glove triangles at each actual
// handle surface sample. Socket coincidence alone cannot satisfy this test.
function nearest(mesh, point) {
  const p = mesh.geometry.attributes.position, idx = mesh.geometry.index;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), closest = new THREE.Vector3();
  const triangle = new THREE.Triangle(); let distance = Infinity;
  for (let i = 0; i < (idx?.count ?? p.count); i += 3) {
    a.fromBufferAttribute(p, idx ? idx.getX(i) : i).applyMatrix4(mesh.matrixWorld);
    b.fromBufferAttribute(p, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
    c.fromBufferAttribute(p, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
    triangle.set(a, b, c).closestPointToPoint(point, closest);
    distance = Math.min(distance, closest.distanceTo(point));
  }
  return distance;
}
const contacts = rig.hands.root.userData.heavyContacts;
assert.equal(contacts.length, 10, 'four fingers plus separate opposed thumb on each hand');
const oldRig = oldApi.adaptReferenceWeaponModel('minigun', await parse(oldApi, 'minigun'), mat);
oldRig.group.updateMatrixWorld(true);
const oldHands = []; oldRig.hands.root.traverse(n => { if (n.isMesh) oldHands.push(n); });
const oldContactGaps = contacts.map(c => Math.min(...oldHands.map(m => nearest(m, new THREE.Vector3(...c.point)))));
assert(oldContactGaps.every(g => g > .01), 'negative control: retained socket-fit rig must fail the new actual-handle contacts');
oldRig.dispose();
const polymer = model.scene.getObjectByName('minigun_FP_LOD0_Runtime_static_MAT_Pass65_minigun_Polymer_PBR');
const contactResults = [];
for (const c of contacts) {
  const group = c.side === 'trigger' ? rig.hands.triggerHand : rig.hands.supportHand;
  const glove = group.getObjectByName(`${group.name}/${c.digit === 'Thumb' ? 'OpposedThumb' : 'FourFingers'}`);
  const point = new THREE.Vector3(...c.point);
  const modelGap = nearest(polymer, point), gloveGap = nearest(glove, point);
  assert(modelGap < .00001, `${c.side}/${c.digit} did not use a decoded handle triangle`);
  assert(gloveGap < .002, `${c.side}/${c.digit} visible glove separated from handle by ${gloveGap}`);
  contactResults.push({ side: c.side, digit: c.digit, gapMm: +(gloveGap * 1000).toFixed(3) });
}
for (const hand of [rig.hands.triggerHand, rig.hands.supportHand]) {
  const wrist = new THREE.Vector3(...hand.userData.heavyWrist);
  const sleeve = hand.getObjectByName(`${hand.name === 'TriggerHand' ? 'TriggerForearm' : 'SupportForearm'}/Sleeve`);
  const bridge = hand.getObjectByName(`${hand.name}/ConnectedWrist`);
  assert(nearest(sleeve, wrist) < .00001, 'sleeve closes exactly at wrist centre');
  assert(nearest(bridge, wrist) < .024, 'glove bridge reaches wrist');
  const palm = new THREE.Vector3(...hand.userData.heavyPalm);
  assert(nearest(bridge, palm) < .024, 'glove bridge joins palm');
}
const beforeReload = rig.hands.supportHand.matrixWorld.clone();
const supportPalm = rig.hands.supportHand.getObjectByName('SupportHand/CanvasPalm');
const supportThumb = rig.hands.supportHand.getObjectByName('SupportHand/OpposedThumb');
const palmBounds = new THREE.Box3().setFromObject(supportPalm);
const thumbBounds = new THREE.Box3().setFromObject(supportThumb);
assert(thumbBounds.max.x > palmBounds.max.x + .012, 'opposed support thumb must emerge beyond palm silhouette');
const initialRig = initialApi.adaptReferenceWeaponModel('minigun', await parse(initialApi, 'minigun'), mat, { heavyHands: true });
initialRig.group.updateMatrixWorld(true);
const initialPalm = new THREE.Box3().setFromObject(initialRig.hands.supportHand.getObjectByName('SupportHand/CanvasPalm'));
const initialThumb = new THREE.Box3().setFromObject(initialRig.hands.supportHand.getObjectByName('SupportHand/OpposedThumb'));
assert(initialThumb.max.x - initialPalm.max.x < .012, 'retained initial take must fail the new visible-thumb silhouette requirement');
assert.deepEqual(signature({group:rig.hands.triggerHand}), signature({group:initialRig.hands.triggerHand}),
  'right-hand geometry and fit must remain unchanged pending neutral inspection');
const supportFingerContact = contacts.find(c => c.side === 'support' && c.digit === 'Index');
const supportThumbContact = contacts.find(c => c.side === 'support' && c.digit === 'Thumb');
const bar = new THREE.Vector3(...rig.hands.supportHand.userData.heavyHandleCentre);
assert(supportFingerContact.point[2] > bar.z && supportThumbContact.point[2] < bar.z,
  'thumb and fingers must contact opposite sides of the actual bar');
rig.hands.updateReload(.5); assert(rig.hands.supportHand.position.length() > .03);
rig.group.updateMatrixWorld(true);
const reloadContact = new THREE.Vector3(...rig.hands.root.userData.heavyReloadContact.point);
const drum = model.scene.getObjectByName('minigun_FP_LOD0_Runtime_magazine_MAT_Pass65_minigun_Gunmetal');
assert(nearest(drum, reloadContact) < .00001, 'reload target is a real exposed drum triangle');
const supportMeshes = rig.hands.supportHand.children.filter(n => n.isMesh);
const reloadGap = Math.min(...supportMeshes.map(m => nearest(m, reloadContact)));
assert(reloadGap < .014, `seated reload glove must reach real drum rim: ${reloadGap}`);
const drumBounds = new THREE.Box3().setFromObject(drum);
initialRig.hands.updateReload(.5); initialRig.group.updateMatrixWorld(true);
const initialReloadBounds = new THREE.Box3();
for (const m of initialRig.hands.supportHand.children.filter(n=>n.isMesh)) initialReloadBounds.union(new THREE.Box3().setFromObject(m));
assert(initialReloadBounds.max.x > drumBounds.min.x + .03 && initialReloadBounds.min.y < drumBounds.max.y,
  'retained initial direct reach must fail the outside-drum reload requirement');
initialRig.dispose();
const reloadSweep = [];
for (let n = 1; n < 40; n++) {
  const progress = n / 40;
  rig.hands.updateReload(progress); rig.group.updateMatrixWorld(true);
  const bounds = new THREE.Box3(); for (const m of supportMeshes) bounds.union(new THREE.Box3().setFromObject(m));
  // Once the glove descends into the drum's height range, it stays entirely
  // outside the exposed side plane rather than crossing into the housing.
  if (bounds.min.y < drumBounds.max.y && progress > .1 && progress < .9)
    assert(bounds.max.x <= drumBounds.min.x + .006, `reload glove enters drum at ${progress}`);
  reloadSweep.push({ progress, minY: bounds.min.y, maxX: bounds.max.x });
}
rig.hands.resetReload(); rig.group.updateMatrixWorld(true);
assert.deepEqual(rig.hands.supportHand.matrixWorld.elements, beforeReload.elements);
const { offsetX, offsetY, pitch, yaw } = rig.adsMount;
rig.group.position.set(offsetX, -.148 + offsetY, -.3 + rig.cameraOffset.z);
rig.group.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ')); rig.group.updateMatrixWorld(true);
const rear = rig.group.getObjectByName(rig.adsSightNames[0]).getWorldPosition(new THREE.Vector3());
const ray = new THREE.Raycaster();
for (const [x, y] of [[0, 0], [-.003, 0], [.003, 0], [-.003, .003], [.003, .003]]) {
  ray.set(new THREE.Vector3(), new THREE.Vector3(x, y, rear.z).normalize());
  assert.equal(ray.intersectObject(rig.group, true).filter(h => !h.object.material.transparent || h.object.material.opacity > .2).length, 0, 'unchanged ADS centre/margin aperture');
}
const outline = rig.group.getObjectByName('HeavyAimOutline'), inset = rig.group.getObjectByName('HeavyAimInset');
const lum = m => .2126 * m.color.r + .7152 * m.color.g + .0722 * m.color.b;
const contrast = (lum(inset.material) + .05) / (lum(outline.material) + .05);
assert(contrast >= 7, 'dual-tone aim reference lacks light/dark contrast');
const camera = new THREE.PerspectiveCamera(55, 1600 / 900, .08, 1400);
camera.updateMatrixWorld(true);
const markBounds = new THREE.Box3().setFromObject(outline);
const a = markBounds.min.clone().project(camera), b = markBounds.max.clone().project(camera);
const markWidthPx = Math.abs(b.x - a.x) * 800;
assert(markWidthPx >= 8 && markWidthPx <= 28, 'ADS aiming mark projected width outside readable bounded target');
assert(markBounds.max.y < -.003, 'mark must not cover exact aim centre');
// Verify framing with decoded gun vertices: moving depth, not shrinking geometry.
rig.group.quaternion.identity(); rig.group.position.set(.22, -.2, -.45); rig.group.updateMatrixWorld(true);
const nearBefore = new THREE.Box3().setFromObject(model.scene).max.z;
rig.group.position.z += rig.cameraOffset.z; rig.group.updateMatrixWorld(true);
const nearAfter = new THREE.Box3().setFromObject(model.scene).max.z;
assert(nearBefore > -.02 && nearAfter < -.30, 'retained near-camera crop must be corrected by depth alone');
const resources = api.collectGltfResources(rig.group); let geoDisposes = 0, matDisposes = 0, texDisposes = 0;
for (const g of resources.geometries) g.addEventListener('dispose', () => geoDisposes++);
for (const m of resources.materials) if (m !== material) m.addEventListener('dispose', () => matDisposes++);
for (const t of resources.textures) t.addEventListener('dispose', () => texDisposes++);
rig.dispose(); rig.dispose();
assert.equal(geoDisposes, resources.geometries.size); assert.equal(matDisposes, resources.materials.size - 1);
assert.equal(texDisposes, resources.textures.size); assert.equal(materialDisposed, 0);
assert(images.every(i => i.closes === 1), 'owned image resources disposed exactly once');
console.log(JSON.stringify({ status: 'PASS', baselineRef, hands: { meshes: handMeshes.length, triangles: handTris },
  gun: rig.stats, contacts: contactResults, cameraOffset: rig.cameraOffset,
  repair1: { thumbBeyondPalmMm: (thumbBounds.max.x - palmBounds.max.x) * 1000, reloadGapMm: reloadGap * 1000, reloadSweep },
  retainedHandContactGapMm: oldContactGaps.map(g => +(g * 1000).toFixed(2)),
  nearestGunZ: { before: nearBefore, after: nearAfter }, aim: { contrast, markWidthPx },
  visualAcceptance: 'OPEN: real neutral/gameplay hip/ADS/firing/reload/turn capture required' }, null, 2));
