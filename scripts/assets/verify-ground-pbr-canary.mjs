/**
 * CPU verification for the ground PBR canary. No browser, no server, no GPU.
 *   bun scripts/assets/verify-ground-pbr-canary.mjs
 *   node --experimental-strip-types scripts/assets/verify-ground-pbr-canary.mjs  (node >= 22.6)
 * Checks: asset budget + hashes + dimensions on disk, and the factory contract
 * (single repeat, colorspace split, no displacement, geometry untouched,
 * idempotent disposal, existing-singleton swap).
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const ASSET_URL = new URL('../../public/assets/ground-pbr-canary/', import.meta.url);
const ASSET_DIR = fileURLToPath(ASSET_URL);
const FACTORY_URL = new URL('../../src/core/ground-pbr-canary.ts', import.meta.url);

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// --- JPEG SOF dimension parse (no decoder deps) ---
function jpegDims(b) {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let p = 2;
  while (p + 9 < b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const m = b[p + 1];
    if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
      return { h: b.readUInt16BE(p + 5), w: b.readUInt16BE(p + 7) };
    }
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd9)) { p += 2; continue; }
    p += 2 + b.readUInt16BE(p + 2);
  }
  return null;
}

// --- 1. assets on disk vs provenance ---
const prov = JSON.parse(await readFile(new URL('provenance.json', ASSET_URL), 'utf8'));
const files = (await readdir(ASSET_DIR)).filter((f) => f.endsWith('.jpg'));
check(files.length === 6, 'map count is exactly 6', `${files.length}: ${files.join(', ')}`);
check(prov.budgets.mapCountLimit === 6 && prov.budgets.dimensionLimitPx === 1024, 'budget constants present');

let diskTotal = 0;
for (const asset of prov.assets) {
  for (const m of asset.maps) {
    const buf = await readFile(new URL(m.file, ASSET_URL));
    diskTotal += buf.length;
    const dims = jpegDims(buf);
    const sha = createHash('sha256').update(buf).digest('hex');
    check(dims && dims.w === 1024 && dims.h === 1024, `${m.file} is 1024x1024 (1K LOD, within limit)`, dims ? `${dims.w}x${dims.h}` : 'unreadable');
    check(buf.length === m.bytes, `${m.file} byte count matches provenance`, `${buf.length}`);
    check(sha === m.sha256, `${m.file} sha256 matches provenance`);
    check(m.colorSpace.startsWith('sRGB') === m.file.endsWith('color.jpg'), `${m.file} colorspace role sane`, m.colorSpace);
  }
}
check(diskTotal === prov.budgets.bytesOnDisk, 'provenance bytesOnDisk matches disk', `${diskTotal}`);
check(prov.budgets.deliveryFetchPassWireBytes <= prov.budgets.downloadLimitBytes, 'delivery fetch pass within 12 MB budget', `${prov.budgets.deliveryFetchPassWireBytes}`);
check(prov.assets.every((a) => a.license === 'CC0-1.0' && a.nativePhysicalTileMetres > 0), 'CC0 + native physical tile recorded per asset');

// --- 2. factory contract ---
let canary;
try {
  canary = await import(FACTORY_URL);
} catch (e) {
  console.error('Cannot import the TS factory with this runtime. Re-run with: bun scripts/assets/verify-ground-pbr-canary.mjs');
  console.error(String(e));
  process.exit(2);
}

const mk = () => new THREE.Texture();

function specSet() {
  const asphalt = { map: mk(), normalMap: mk(), roughnessMap: mk() };
  const concrete = { map: mk(), normalMap: mk(), roughnessMap: mk() };
  const spied = [];
  const spy = (t) => {
    const orig = t.dispose.bind(t);
    let n = 0;
    t.dispose = () => { n++; orig(); };
    spied.push(() => n);
  };
  Object.values(asphalt).concat(Object.values(concrete)).forEach(spy);
  return { asphalt, concrete, spied };
}

const { asphalt, concrete, spied } = specSet();
const set = canary.buildGroundPbrCanaryMaterials(
  {
    maps: asphalt, uvMetresPerUnit: canary.GROUND_CANARY_UV_M.asphalt,
    tilePhysicalMetres: canary.GROUND_CANARY_TILE_M.asphalt, normalScale: 0.6,
  },
  {
    maps: concrete, uvMetresPerUnit: canary.GROUND_CANARY_UV_M.paving,
    tilePhysicalMetres: canary.GROUND_CANARY_TILE_M.concrete, normalScale: 0.4,
  },
);

const repA = canary.GROUND_CANARY_UV_M.asphalt / canary.GROUND_CANARY_TILE_M.asphalt;
const repC = canary.GROUND_CANARY_UV_M.paving / canary.GROUND_CANARY_TILE_M.concrete;
const near = (a, b) => Math.abs(a - b) < 1e-9;
for (const [k, want] of [['map', repA], ['normalMap', repA], ['roughnessMap', repA]]) {
  check(near(asphalt[k].repeat.x, want) && near(asphalt[k].repeat.y, want), `asphalt ${k} repeat = uvM/tileM, set once`, `${asphalt[k].repeat.x} vs ${want}`);
  check(asphalt[k].wrapS === THREE.RepeatWrapping, `asphalt ${k} RepeatWrapping`);
}
check(near(concrete.map.repeat.x, repC) && near(repC, 28), 'concrete repeat = 67.2/2.4 = 28', `${concrete.map.repeat.x}`);

check(asphalt.map.colorSpace === THREE.SRGBColorSpace, 'asphalt color map is sRGB');
check(asphalt.normalMap.colorSpace === THREE.NoColorSpace && asphalt.roughnessMap.colorSpace === THREE.NoColorSpace, 'asphalt data maps are linear');
check(concrete.map.colorSpace === THREE.SRGBColorSpace && concrete.roughnessMap.colorSpace === THREE.NoColorSpace, 'concrete colorspace split');

for (const [name, mat] of [['asphalt', set.asphalt], ['concrete', set.concrete]]) {
  check(mat.isMeshStandardMaterial, `${name} is MeshStandardMaterial`);
  check(mat.roughness === 1 && !!mat.roughnessMap, `${name} roughness 1 x map`);
  check(mat.metalness === 0, `${name} metalness 0`);
  check(mat.displacementMap == null, `${name} no displacement map`);
  check(!!mat.map && !!mat.normalMap, `${name} maps assigned`);
}
check(set.asphalt.normalScale.x === 0.6 && set.concrete.normalScale.x === 0.4, 'normalScale family values (0.6 / 0.4)');
// --- 2b. art-round1 albedo tint contract (additive; existing defaults untouched) ---
check(canary.GROUND_CANARY_ALBEDO_TINT.asphalt === 0x8f8f93 && canary.GROUND_CANARY_ALBEDO_TINT.concrete === 0xffffff, 'calibrated tint constants present (asphalt 0x8f8f93, concrete white)');
check(set.asphalt.color.getHex() === 0xffffff && set.concrete.color.getHex() === 0xffffff, 'no-tint specs leave material.color white (existing callers unchanged)');
{
  const t = { map: mk(), normalMap: mk(), roughnessMap: mk() };
  const tinted = canary.buildGroundPbrCanaryMaterials(
    { maps: t, uvMetresPerUnit: canary.GROUND_CANARY_UV_M.asphalt, tilePhysicalMetres: canary.GROUND_CANARY_TILE_M.asphalt, normalScale: 0.6, albedoTint: canary.GROUND_CANARY_ALBEDO_TINT.asphalt },
    { maps: { map: mk(), normalMap: mk(), roughnessMap: mk() }, uvMetresPerUnit: canary.GROUND_CANARY_UV_M.paving, tilePhysicalMetres: canary.GROUND_CANARY_TILE_M.concrete, normalScale: 0.4 },
  );
  check(tinted.asphalt.color.getHex() === 0x8f8f93, 'buildSurface applies albedoTint to material.color');
  check(tinted.concrete.color.getHex() === 0xffffff, 'absent tint leaves concrete white');
  const target = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
  const beforeHex = target.color.getHex();
  canary.applyGroundPbrCanaryMaps(target, { maps: t, uvMetresPerUnit: canary.GROUND_CANARY_UV_M.asphalt, tilePhysicalMetres: canary.GROUND_CANARY_TILE_M.asphalt, normalScale: 0.6 });
  check(target.color.getHex() === beforeHex, 'apply() without tint preserves existing singleton color');
  canary.applyGroundPbrCanaryMaps(target, { maps: t, uvMetresPerUnit: canary.GROUND_CANARY_UV_M.asphalt, tilePhysicalMetres: canary.GROUND_CANARY_TILE_M.asphalt, normalScale: 0.6, albedoTint: 0x8f8f93 });
  check(target.color.getHex() === 0x8f8f93, 'apply() with tint sets singleton color (live asphalt path)');
  tinted.dispose();
}
// geometry untouched by apply(): position + uv buffers byte-identical
const geo = new THREE.PlaneGeometry(40, 20);
const posBefore = Buffer.from(geo.getAttribute('position').array.slice(0));
const uvBefore = Buffer.from(geo.getAttribute('uv').array.slice(0));
const lib = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
canary.applyGroundPbrCanaryMaps(lib, {
  maps: concrete, uvMetresPerUnit: canary.GROUND_CANARY_UV_M.paving,
  tilePhysicalMetres: canary.GROUND_CANARY_TILE_M.concrete, normalScale: 0.4,
});
check(Buffer.compare(posBefore, Buffer.from(geo.getAttribute('position').array.slice(0))) === 0, 'apply() leaves position buffer untouched');
check(Buffer.compare(uvBefore, Buffer.from(geo.getAttribute('uv').array.slice(0))) === 0, 'apply() leaves uv buffer untouched (no double-repeat)');
check(lib.map === concrete.map && lib.roughnessMap === concrete.roughnessMap, 'apply() swaps maps on the EXISTING singleton material');

// disposal: six textures once, second call no-op
const before = spied.reduce((a, f) => a + f(), 0);
set.dispose();
const afterFirst = spied.reduce((a, f) => a + f(), 0);
set.dispose();
const afterSecond = spied.reduce((a, f) => a + f(), 0);
check(before === 0, 'nothing disposed before dispose()');
check(afterFirst === 6, 'dispose() releases all six maps exactly once', `${afterFirst}`);
check(afterSecond === 6, 'second dispose() is a no-op', `${afterSecond}`);

// --- 3. loadCanarySurfaceSet lifecycle & disposal guarantees ---
function createMockTexture() {
  let disposes = 0;
  return {
    isTexture: true,
    repeat: { set: () => {} },
    get disposes() { return disposes; },
    dispose: () => { disposes++; },
  };
}

function createMockLoader() {
  const callbacks = new Map();
  const calls = [];
  return {
    calls,
    load(url, onLoad, _onProgress, onError) {
      calls.push(url);
      callbacks.set(url, { onLoad, onError });
    },
    triggerLoad(url, texture) {
      const cb = callbacks.get(url);
      if (cb) cb.onLoad(texture);
    },
    triggerError(url, err) {
      const cb = callbacks.get(url);
      if (cb) cb.onError(err);
    },
  };
}

// 3.1 Normal complete load
{
  const loader = createMockLoader();
  let readyMaps = null;
  const handle = canary.loadCanarySurfaceSet({
    urls: { diffuse: 'd.jpg', roughness: 'r.jpg', normal: 'n.jpg' },
    textureLoader: loader,
    onReady: (maps) => { readyMaps = maps; },
  });
  const tD = createMockTexture();
  const tR = createMockTexture();
  const tN = createMockTexture();
  loader.triggerLoad('d.jpg', tD);
  loader.triggerLoad('r.jpg', tR);
  loader.triggerLoad('n.jpg', tN);
  check(readyMaps !== null && readyMaps.map === tD && readyMaps.roughnessMap === tR && readyMaps.normalMap === tN, 'loader completes normal load');
  check(tD.disposes === 0 && tR.disposes === 0 && tN.disposes === 0, 'textures not disposed on success');
  handle.cancel();
  check(tD.disposes === 0, 'cancel after ready does not dispose delivered maps (caller owns)');
}

// 3.2 Release before full load (abandonment with partial textures resident).
// Precise ownership: cancel() never touches the loader — there is no abort, so
// the in-flight request still completes through the loader and the late arrival
// is disposed on arrival instead of delivered. "Cancellation" here is prompt
// disposal of completed maps plus abandonment, never request cancellation.
{
  const loader = createMockLoader();
  let readyMaps = null;
  const handle = canary.loadCanarySurfaceSet({
    urls: { diffuse: 'd2.jpg', roughness: 'r2.jpg', normal: 'n2.jpg' },
    textureLoader: loader,
    onReady: (maps) => { readyMaps = maps; },
  });
  check(loader.calls.length === 3, 'loader issued exactly 3 requests (return values intentionally unowned)');
  const tD = createMockTexture();
  const tR = createMockTexture();
  loader.triggerLoad('d2.jpg', tD);
  check(tD.disposes === 0, 'partial texture resident before cancel');
  const callsBeforeCancel = loader.calls.length;
  handle.cancel();
  check(loader.calls.length === callsBeforeCancel, 'cancel performs no loader call (in-flight request NOT aborted)');
  check(tD.disposes === 1, 'cancel immediately disposes resident texture (no retention)');
  loader.triggerLoad('r2.jpg', tR);
  check(tR.disposes === 1, 'late completion after cancel disposed immediately (request ran, arrival abandoned)');
  check(readyMaps === null, 'onReady not called when cancelled');
}

// 3.3 Partial failure (error during download) + late arrival
{
  const loader = createMockLoader();
  let readyMaps = null;
  let errorFired = false;
  canary.loadCanarySurfaceSet({
    urls: { diffuse: 'd3.jpg', roughness: 'r3.jpg', normal: 'n3.jpg' },
    textureLoader: loader,
    onReady: (maps) => { readyMaps = maps; },
    onError: () => { errorFired = true; },
  });
  const tD = createMockTexture();
  const tN = createMockTexture();
  loader.triggerLoad('d3.jpg', tD);
  check(tD.disposes === 0, 'texture loaded before error');
  loader.triggerError('r3.jpg', new Error('Network error'));
  check(errorFired, 'onError callback invoked on partial failure');
  check(tD.disposes === 1, 'partial failure immediately disposes loaded textures');
  // Late arrival
  loader.triggerLoad('n3.jpg', tN);
  check(tN.disposes === 1, 'late success after failure disposed immediately');
  check(tD.disposes === 1, 'no double dispose of previously loaded map');
  check(readyMaps === null, 'onReady not called on failure');
}

// 3.4 Repeated dispose / cancel idempotency
{
  const loader = createMockLoader();
  const handle = canary.loadCanarySurfaceSet({
    urls: { diffuse: 'd4.jpg', roughness: 'r4.jpg', normal: 'n4.jpg' },
    textureLoader: loader,
    onReady: () => {},
  });
  const tD = createMockTexture();
  loader.triggerLoad('d4.jpg', tD);
  handle.cancel();
  check(tD.disposes === 1, 'first cancel disposes texture once');
  handle.cancel();
  handle.cancel();
  check(tD.disposes === 1, 'repeated cancel is idempotent, zero double-dispose');
}

console.log(failures === 0 ? '\nALL CHECKS PASS' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

