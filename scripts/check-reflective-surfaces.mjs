// CPU-only finite, ownership, cache and refresh controls. Does not claim pixels.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from 'three';

const out = resolve('captures/astra-shading-cpu');
mkdirSync(out, { recursive: true });
const fixture = resolve(out, 'fixture.mjs');
await build({ entryPoints: ['src/core/reflective-surfaces.ts'], outfile: fixture,
  bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
const mod = await import(pathToFileURL(fixture));
const { installReflectiveSurfaces: install, updateReflectiveSurfaces: update,
  disposeReflectiveSurfaces: dispose, reflectionBoxHit: hit } = mod;
assert.equal(mod.isReflectiveSurfacesEnabled(''), false);
assert.equal(mod.isReflectiveSurfacesEnabled('?glazing=canary'), true);
assert.equal(mod.isReflectiveSurfacesEnabled('?glazing=off'), false);
assert.deepEqual(hit([0, 2, 0], [0, 0, 1], [-1, 1, 2], [1, 3, 3]), [2, -3]);
assert.deepEqual(hit([2, 2, 0], [0, 0, 1], [-1, 1, 2], [1, 3, 3]), [-1, 0]);
assert.deepEqual(hit([0, 2, 2.5], [0, 0, 1], [-1, 1, 2], [1, 3, 3]), [-1, 0]);
assert.deepEqual(hit([0, 2, 0], [0, 0, 0], [-1, 1, 2], [1, 3, 3]), [-1, 0]);
assert.throws(() => hit([NaN, 0, 0], [0, 0, 1], [-1, -1, -1], [1, 1, 1]), /non-finite/);

const scene = new THREE.Scene();
const skyBytes = new Uint8Array(32 * 16 * 4).fill(128);
const sky = new THREE.DataTexture(skyBytes, 32, 16);
scene.environment = sky;
const light = new THREE.DirectionalLight(); scene.add(light);
const material = (colour, opacity, roughness) => new THREE.MeshStandardMaterial({
  color: colour, opacity, transparent: opacity < 1, roughness,
});
const surfaces = { glass: material(0x9fc0cf, 0.42, 0.08),
  roofGlazing: material(0x93b3c6, 0.86, 0.14), windowDark: material(0x66808e, 1, 0.12),
  chrome: material(0xc8ccd0, 1, 0.15) };
const geometry = new THREE.BoxGeometry();
const pane = new THREE.Mesh(geometry, surfaces.glass);
const multi = new THREE.Mesh(geometry, [surfaces.roofGlazing, surfaces.windowDark]);
const originalMulti = multi.material;
const unrelated = new THREE.Mesh(geometry, material(0x808080, 1, 0.8));
const unrelatedMaterial = unrelated.material;
scene.add(pane, multi, unrelated);
const vehicle = new THREE.Group(); vehicle.name = 'coach';
const vehicleGeo = new THREE.BoxGeometry(8.2, 0.9, 2.5); vehicleGeo.translate(0, 2.4, 0);
const vehiclePane = new THREE.Mesh(vehicleGeo, surfaces.windowDark);
const vertexBefore = new Float32Array(vehicleGeo.attributes.position.array);
vehicle.add(vehiclePane); scene.add(vehicle);
const state = { sunDir: new THREE.Vector3(58, 72, -92).normalize(), sunIntensity: 3.35,
  sunColor: new THREE.Color(0xfff2dc), hemiIntensity: 0.95, envIntensity: 0.9 };
const atmosphere = { effective: () => state };
assert.equal(install(scene, surfaces, atmosphere, false), null);
assert.equal(pane.material, surfaces.glass);
const probe = install(scene, surfaces, atmosphere, true);
assert.ok(probe);
assert.equal(probe.changedMeshes, 3);
assert.equal(probe.materials.length, 4);
assert.equal(probe.bakeCount, 1);
assert.equal(probe.bytes, 786432);
assert.equal(unrelated.material, unrelatedMaterial);
assert.equal(pane.material, probe.materials[0]);
assert.equal(pane.material.transparent, true);
assert.equal(pane.material.depthWrite, false);
assert.equal(probe.materials[2].transparent, false);
for (const material of probe.materials) {
  assert.equal(material.mrtNode, null, 'material must not override a single-output fallback target');
  assert.ok(material.outputNode, 'auxiliary properties are set through the output hook');
}
assert.equal(vehiclePane.material, probe.materials[3]);
assert.equal(vehiclePane.material.userData.reflectiveSurfaces.virtualCabin, true);
const cabin = vehiclePane.userData.reflectiveCabin;
assert.equal(cabin.cells, 8);
assert.ok([...cabin.min.toArray(), ...cabin.max.toArray()].every(Number.isFinite));
assert.deepEqual(vehicleGeo.attributes.position.array, vertexBefore);
assert.equal(surfaces.chrome.envMap, probe.street);
assert.equal(install(scene, surfaces, atmosphere, true), probe);
const keys = probe.materials.map(m => m.customProgramCacheKey());
const versions = probe.materials.map(m => m.version);
const atlasData = probe.atlas.image.data;
const streetData = probe.street.image.data;
const textureVersion = probe.atlas.version;
const baselineBytes = new Uint8Array(atlasData);
for (let i = 0; i < 10000; i++) update(scene);
assert.equal(probe.bakeCount, 1);
assert.equal(probe.atlas.version, textureVersion);
assert.equal(probe.atlas.image.data, atlasData);
assert.equal(probe.street.image.data, streetData);
assert.equal(vehiclePane.userData.reflectiveCabin, cabin);
assert.deepEqual(probe.materials.map(m => m.customProgramCacheKey()), keys);
assert.deepEqual(probe.materials.map(m => m.version), versions);
assert.deepEqual(atlasData, baselineBytes);
assert.equal(scene.children.filter(o => o.isLight).length, 1);
assert.equal(light.visible, true);

// Positive control: a sky/TOD transition must change pixels in the SAME buffers,
// without swapping material nodes or increasing their version/cache key.
skyBytes.fill(36); state.sunIntensity = 0.25; sky.needsUpdate = true;
update(scene);
assert.equal(probe.bakeCount, 2);
assert.equal(probe.atlas.image.data, atlasData);
assert.notDeepEqual(atlasData, baselineBytes);
assert.deepEqual(probe.materials.map(m => m.customProgramCacheKey()), keys);
assert.deepEqual(probe.materials.map(m => m.version), versions);
const events = new Map();
for (const resource of [...probe.materials, probe.atlas, probe.street]) {
  events.set(resource, 0);
  resource.addEventListener('dispose', () => events.set(resource, events.get(resource) + 1));
}
let borrowedDisposed = 0;
for (const resource of [...Object.values(surfaces), sky, geometry]) {
  resource.addEventListener('dispose', () => borrowedDisposed++);
}
dispose(scene); dispose(scene); probe.dispose(); update(scene);
assert.equal(probe.disposed, true);
assert.equal(pane.material, surfaces.glass);
assert.equal(multi.material, originalMulti);
assert.equal(surfaces.chrome.envMap, null);
assert.equal(vehiclePane.material, surfaces.windowDark);
assert.equal(vehiclePane.userData.reflectiveCabin, undefined);
assert.equal(borrowedDisposed, 0);
assert.deepEqual([...events.values()], [1, 1, 1, 1, 1, 1]);
assert.equal(probe.bakeCount, 2);

// Half-float compatibility with lighting=authored: preserve radiance above 1,
// correct half-float alpha, and reuse the HDR storage across TOD transitions.
const hdrScene = new THREE.Scene();
const hdrSkyData = new Uint16Array(32 * 16 * 4);
for (let i = 0; i < hdrSkyData.length; i += 4) {
  hdrSkyData[i] = THREE.DataUtils.toHalfFloat(8);
  hdrSkyData[i + 1] = THREE.DataUtils.toHalfFloat(4);
  hdrSkyData[i + 2] = THREE.DataUtils.toHalfFloat(2);
  hdrSkyData[i + 3] = THREE.DataUtils.toHalfFloat(1);
}
const hdrSky = new THREE.DataTexture(hdrSkyData, 32, 16, THREE.RGBAFormat, THREE.HalfFloatType);
hdrScene.environment = hdrSky;
const hdrProbe = install(hdrScene, surfaces, atmosphere, true);
assert.equal(hdrProbe.bytes, 1572864);
assert.equal(hdrProbe.atlas.type, THREE.HalfFloatType);
const hdrBuffer = hdrProbe.atlas.image.data;
const zenith = (127 * 256 + 128) * 4;
assert.equal(THREE.DataUtils.fromHalfFloat(hdrBuffer[zenith]), 8);
assert.equal(THREE.DataUtils.fromHalfFloat(hdrBuffer[zenith + 3]), 1);
for (let i = 0; i < 1000; i++) update(hdrScene);
assert.equal(hdrProbe.bakeCount, 1);
hdrSkyData.fill(THREE.DataUtils.toHalfFloat(16)); hdrSky.needsUpdate = true;
update(hdrScene);
assert.equal(hdrProbe.bakeCount, 2);
assert.equal(hdrProbe.atlas.image.data, hdrBuffer);
assert.equal(THREE.DataUtils.fromHalfFloat(hdrBuffer[zenith]), 16);
const hdrBakeMs = hdrProbe.lastBakeMs;
dispose(hdrScene);

const report = { state: 'CPU_VERIFIED_GPU_OPEN', assertions: 'finite miss/hit, opt-in, identity scope, source ownership, 10000 idle updates, TOD positive control, idempotent disposal',
  bytes: probe.bytes, materials: probe.materials.length, changedMeshes: probe.changedMeshes,
  hdrBytes: hdrProbe.bytes, hdrPeakPreserved: 16, hdrBakeMs,
  bakeCount: probe.bakeCount, lastBakeMs: probe.lastBakeMs, gpu: 'repair not run; no lease',
  visualAcceptance: 'OPEN; actual same-station captures and movement required' };
writeFileSync(resolve(out, 'receipt.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
