// CPU verifier for the lawn PBR canary lane. No browser, no server, no GPU.
//
// Checks, in order:
//   1. assets: exactly the 3 provenance maps exist, each 1024^2 JPEG, byte and
//      SHA-256 identical to provenance.json, total on-disk <= 6 MiB;
//   2. UV contract: module constants mirror root ground.ts UV_LAWN and the
//      provenance tile, repeat = 96/1.4, spec fields exact;
//   3. lifetime contract of the SHARED loader this lane reuses
//      (ground-pbr-canary.loadCanarySurfaceSet), exercised through the same
//      injectable fake-loader seam materials.ts will run in the browser:
//      all-arrive, cancel-then-late-arrivals, mid-flight failure, disposed
//      caller, duplicate key re-fire.
import { createHash } from 'node:crypto';
import { statSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const assetDir = join(repo, 'public', 'assets', 'lawn-pbr-canary');
const provenance = JSON.parse(readFileSync(join(assetDir, 'provenance.json'), 'utf8'));

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

// --- 1. assets ---------------------------------------------------------------
const maps = provenance.asset.maps;
check('map count == 3 <= limit', maps.length === 3 && provenance.budgets.mapCountLimit === 3, `${maps.length}`);

let totalBytes = 0;
for (const m of maps) {
  const p = join(assetDir, m.file);
  const buf = readFileSync(p);
  const bytes = statSync(p).size;
  totalBytes += bytes;
  const sha = createHash('sha256').update(buf).digest('hex');
  check(`${m.file} bytes`, bytes === m.bytes, `${bytes} vs ${m.bytes}`);
  check(`${m.file} sha256`, sha === m.sha256, sha.slice(0, 16) + '…');

  // JPEG SOF0/2 dimension parse.
  if (buf[0] !== 0xff || buf[1] !== 0xd8) { check(`${m.file} is JPEG`, false); continue; }
  let dims = null;
  for (let o = 2; o < buf.length - 9;) {
    if (buf[o] !== 0xff) { o++; continue; }
    const marker = buf[o + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      dims = { h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
      break;
    }
    o += 2 + buf.readUInt16BE(o + 2);
  }
  check(`${m.file} dims 1024x1024`, dims !== null && dims.w === 1024 && dims.h === 1024, JSON.stringify(dims));
}
check('on-disk total <= 6 MiB', totalBytes <= 6 * 1024 * 1024 && totalBytes === provenance.budgets.bytesOnDisk, `${totalBytes} B`);
check('download budget disclosed <= 30 MiB', provenance.budgets.totalWireBytes <= 30 * 1024 * 1024, `${provenance.budgets.totalWireBytes} B`);

// --- 2. UV contract ----------------------------------------------------------
const lawn = await import(pathToFileURL(join(repo, 'src', 'core', 'lawn-pbr-canary.ts')).href);
check('UV_M mirrors ground.ts UV_LAWN', lawn.LAWN_CANARY_UV_M === 96.0, `${lawn.LAWN_CANARY_UV_M}`);
check('tile matches provenance', lawn.LAWN_CANARY_TILE_M === provenance.asset.nativePhysicalTileMetres, `${lawn.LAWN_CANARY_TILE_M}`);
const repeat = lawn.LAWN_CANARY_UV_M / lawn.LAWN_CANARY_TILE_M;
check('repeat = 96/1.4 matches provenance', repeat === provenance.uvContract.lawn.repeat, `${repeat}`);
check('normalScale mirrors lawn wetStd', lawn.LAWN_CANARY_NORMAL_SCALE === 0.4);
check('tint is identity (baseline color state)', lawn.LAWN_CANARY_ALBEDO_TINT === 0xffffff);

const fakeMaps = { map: {}, normalMap: {}, roughnessMap: {} };
const spec = lawn.buildLawnCanarySpec(fakeMaps);
check('spec maps passed through', spec.maps === fakeMaps);
check('spec uv/tile/normal/rough/tint',
  spec.uvMetresPerUnit === 96.0 && spec.tilePhysicalMetres === 1.4 &&
  spec.normalScale === 0.4 && spec.roughness === 1.0 && spec.albedoTint === 0xffffff);
check('urls name the shipped files',
  lawn.LAWN_CANARY_URLS.diffuse.endsWith('lawn-1k-color.jpg') &&
  lawn.LAWN_CANARY_URLS.normal.endsWith('lawn-1k-normal.jpg') &&
  lawn.LAWN_CANARY_URLS.roughness.endsWith('lawn-1k-roughness.jpg'));

// --- 3. lifetime contract (shared loader, fake loader seam) ------------------
const ground = await import(pathToFileURL(join(repo, 'src', 'core', 'ground-pbr-canary.ts')).href);

function makeTex() { return { disposed: false, dispose() { this.disposed = true; } }; }
// Scripted loader: load(url, onLoad, _p, onError) records the request; tests
// fire callbacks explicitly.
function makeLoader() {
  const requests = [];
  return {
    requests,
    load(url, onLoad, _p, onError) {
      const r = { url, onLoad, onError, tex: makeTex() };
      requests.push(r);
      return r;
    },
  };
}
function events() { return { ready: 0, error: 0, maps: null }; }

// 3a. all three arrive -> onReady once, nothing disposed.
{
  const loader = makeLoader();
  const ev = events();
  const h = ground.loadCanarySurfaceSet({
    urls: { ...lawn.LAWN_CANARY_URLS },
    onReady: (m) => { ev.ready++; ev.maps = m; },
    onError: () => { ev.error++; },
    textureLoader: loader,
  });
  for (const r of loader.requests) r.onLoad(r.tex);
  check('3a ready fires once with three maps', ev.ready === 1 && ev.maps !== null &&
    ev.maps.map === loader.requests[0].tex && ev.maps.roughnessMap === loader.requests[1].tex &&
    ev.maps.normalMap === loader.requests[2].tex);
  check('3a no dispose on the happy path', loader.requests.every((r) => !r.tex.disposed));
  check('3a requested urls are the lawn files', loader.requests.map((r) => r.url).join(',').includes('lawn-pbr-canary'));
  h.cancel(); // after finish: must be a no-op, not dispose delivered maps
  check('3a cancel after finish is a no-op', loader.requests.every((r) => !r.tex.disposed));
}

// 3b. cancel mid-flight: arrived map disposed, late arrivals disposed, no ready.
{
  const loader = makeLoader();
  const ev = events();
  const h = ground.loadCanarySurfaceSet({
    urls: { ...lawn.LAWN_CANARY_URLS },
    onReady: () => { ev.ready++; },
    onError: () => { ev.error++; },
    textureLoader: loader,
  });
  loader.requests[0].onLoad(loader.requests[0].tex);
  check('3b arrived map alive before cancel', !loader.requests[0].tex.disposed);
  h.cancel();
  check('3b cancel disposes the arrived map', loader.requests[0].tex.disposed);
  loader.requests[1].onLoad(loader.requests[1].tex);
  loader.requests[2].onLoad(loader.requests[2].tex);
  check('3b late arrivals late-disposed', loader.requests[1].tex.disposed && loader.requests[2].tex.disposed);
  check('3b no ready, no error after cancel', ev.ready === 0 && ev.error === 0);
  h.cancel();
}

// 3c. mid-flight failure: error once, already-loaded maps disposed.
{
  const loader = makeLoader();
  const ev = events();
  ground.loadCanarySurfaceSet({
    urls: { ...lawn.LAWN_CANARY_URLS },
    onReady: () => { ev.ready++; },
    onError: () => { ev.error++; },
    textureLoader: loader,
  });
  loader.requests[0].onLoad(loader.requests[0].tex);
  loader.requests[1].onError(new Error('404'));
  check('3c error fires once', ev.error === 1 && ev.ready === 0);
  check('3c failure disposes loaded maps', loader.requests[0].tex.disposed);
}

// 3d. caller disposed before arrival: everything late-disposed, no delivery.
{
  const loader = makeLoader();
  const ev = events();
  ground.loadCanarySurfaceSet({
    urls: { ...lawn.LAWN_CANARY_URLS },
    onReady: () => { ev.ready++; },
    onError: () => { ev.error++; },
    isDisposed: () => true,
    textureLoader: loader,
  });
  for (const r of loader.requests) r.onLoad(r.tex);
  check('3d disposed caller late-disposes all', loader.requests.every((r) => r.tex.disposed));
  check('3d nothing delivered', ev.ready === 0 && ev.error === 0);
}

// 3e. duplicate key re-fire: previous texture disposed, remaining not skewed.
{
  const loader = makeLoader();
  const ev = events();
  ground.loadCanarySurfaceSet({
    urls: { ...lawn.LAWN_CANARY_URLS },
    onReady: () => { ev.ready++; },
    onError: () => { ev.error++; },
    textureLoader: loader,
  });
  const dup = makeTex();
  loader.requests[0].onLoad(loader.requests[0].tex);
  loader.requests[0].onLoad(dup); // same slot twice (loader quirk guard)
  check('3e duplicate slot replaces and disposes old', loader.requests[0].tex.disposed && !dup.disposed);
  // A double-fired slot skews the completion counter (THREE.TextureLoader can
  // never do this). The module must fail LOUD on the inconsistent set rather
  // than silently deliver a wrong triple, and must dispose anything arriving
  // after that failure.
  loader.requests[1].onLoad(loader.requests[1].tex);
  loader.requests[2].onLoad(loader.requests[2].tex);
  check('3e skewed duplicate fails loud, never mis-delivers', ev.ready === 0 && ev.error === 1);
  check('3e post-failure arrival is disposed', loader.requests[2].tex.disposed && dup.disposed);
}

console.log(failures === 0 ? `\nALL CHECKS PASS (${failures} failures)` : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
