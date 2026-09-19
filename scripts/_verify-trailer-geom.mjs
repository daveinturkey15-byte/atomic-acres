/**
 * _verify-trailer-geom - the NON-pixel half of the trailer-doorway proof.
 *
 * `src/build/vehicles.ts` depends on three, kit, static-batch, palette and layout
 * at run time and on `core/materials` only as a TYPE, so the whole fleet can be
 * built in node with esbuild and a stub material library. That buys three things a
 * browser measurement cannot give at full precision:
 *
 *   1. THE COLLIDER LIST at full double precision, not the two decimal places
 *      `__NT.collidersAt` rounds to. The doorway fix must not move one of them.
 *   2. THE TRIANGLE COUNT of the module, so "the geometry did not grow" is a
 *      number rather than a claim.
 *   3. THE TWO SURFACES' ACTUAL EXTENTS in trailer-local x, which is the thing
 *      that was wrong: the interior mass's front face and the opening panel's
 *      front face were the same plane.
 *
 * It runs the module four times - {old, new} doorway x {batched, unbatched} -
 * through the same temporary `?olddoor=` / `?nobatch=` switches the pixel harness
 * uses, by setting globalThis.location before the bundle's top-level code runs.
 *
 * The material stub mirrors core/materials.ts where the batcher can see it:
 * painted()/signText() cache on their arguments the same way, chrome and steel
 * carry a roughnessMap (so `usesUV` keeps the uv attribute, as in the real build),
 * painted and windowDark carry none, and signText is transparent when it has no
 * background. Colours and textures are not reproduced and are not read here.
 *
 *   node scripts/_verify-trailer-geom.mjs
 *   node scripts/_verify-trailer-geom.mjs --json
 *
 * Exit 0 only if the collider lists of all four variants are identical.
 */
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const JSON_OUT = process.argv.includes('--json');

// No backticks and no dollar-brace below - this is a template literal.
const ENTRY = `
import * as THREE from 'three';
import { makeRng } from '../src/core/kit';
import { buildVehicles } from '../src/build/vehicles';

function stubMaterials() {
  const cache = new Map();
  const mapped = () => { const t = new THREE.Texture(); return t; };
  const get = (key, make) => { let m = cache.get(key); if (!m) { m = make(); cache.set(key, m); } return m; };
  return {
    chrome: get('chrome', () => new THREE.MeshStandardMaterial({ roughnessMap: mapped() })),
    steel: get('steel', () => new THREE.MeshStandardMaterial({ roughnessMap: mapped() })),
    windowDark: get('windowDark', () => new THREE.MeshStandardMaterial()),
    painted: (color, rough = 0.42, metal = 0.25) =>
      get('p' + color + '_' + rough + '_' + metal,
        () => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal })),
    emissive: (color, strength = 1.4) =>
      get('e' + color + '_' + strength, () => new THREE.MeshStandardMaterial({ color })),
    signText: (o) => get('s' + o.text + o.color + o.background + o.aspect + o.script + o.glow,
      () => new THREE.MeshStandardMaterial({
        map: mapped(), transparent: o.background === undefined, side: THREE.DoubleSide,
      })),
    dispose: () => {},
  };
}

function tris(o) {
  let n = 0;
  o.traverse((c) => {
    if (!c.isMesh || !c.geometry) return;
    const g = c.geometry;
    const per = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    n += per * (c.isInstancedMesh ? c.count : 1);
  });
  return n;
}

/** Trailer-local x extent of a box mesh, so the two doorway surfaces can be compared. */
function xSpan(m) {
  m.geometry.computeBoundingBox();
  const b = m.geometry.boundingBox;
  return [m.position.x + b.min.x, m.position.x + b.max.x];
}

export function run() {
  const mat = stubMaterials();
  const res = buildVehicles({ mat, rand: makeRng('nuketown-2025:vehicles') });

  let objects = 0;
  res.group.traverse(() => objects++);
  let meshes = 0;
  res.group.traverse((o) => { if (o.isMesh) meshes++; });

  // The trailer, and - only in the unbatched arm, where the parts still exist -
  // the two surfaces at the rear doorway. windowDark is used ONLY by the two
  // doorway panels on this vehicle (side and rear); the rear one is the more
  // negative in x, because local -x is the rear.
  const trailer = res.group.children.find((c) => c.name === 'trailer');
  let doorway = null;
  if (trailer) {
    const panels = [];
    const masses = [];
    trailer.traverse((o) => {
      // The REAR doorway pair only: local -x is the rear, and the +z side doorway's
      // pair sits at local x ~ +1.55, so a simple x < -2 gate separates them.
      if (!o.isMesh || o.isInstancedMesh || o.position.x > -2) return;
      const m = o.material;
      if (m === mat.windowDark) panels.push(o);
      if (m === mat.painted(0x2e3238, 0.7, 0.1)) masses.push(o);
    });
    const byX = (a, b) => a.position.x - b.position.x;
    panels.sort(byX);
    masses.sort(byX);
    if (masses.length) {
      doorway = {
        panel: panels.length ? xSpan(panels[0]).map((v) => +v.toFixed(6)) : null,
        mass: xSpan(masses[0]).map((v) => +v.toFixed(6)),
      };
      doorway.gapMm = doorway.panel ? +((doorway.mass[0] - doorway.panel[1]) * 1000).toFixed(3) : null;
      doorway.frontFaceGapMm = doorway.panel
        ? +((doorway.mass[0] - doorway.panel[0]) * 1000).toFixed(3) : null;
      // The opening panel's OUTER face as four WORLD points, so the pixel harness
      // can project the doorway instead of a human guessing a rectangle. Order:
      // bottom-left, bottom-right, top-right, top-left as seen from outside
      // (local -z is 'left' when standing behind the trailer looking along +x).
      res.group.updateMatrixWorld(true);
      const p0 = panels.length ? panels[0] : masses[0];
      p0.geometry.computeBoundingBox();
      const bb = p0.geometry.boundingBox;
      const corners = [
        [bb.min.x, bb.min.y, bb.min.z], [bb.min.x, bb.min.y, bb.max.z],
        [bb.min.x, bb.max.y, bb.max.z], [bb.min.x, bb.max.y, bb.min.z],
      ].map(([x, y, z]) => {
        const v = new THREE.Vector3(x, y, z);
        p0.localToWorld(v);
        return [+v.x.toFixed(6), +v.y.toFixed(6), +v.z.toFixed(6)];
      });
      doorway.worldQuad = corners;
      doorway.trailerPos = [+trailer.position.x.toFixed(6), +trailer.position.y.toFixed(6),
        +trailer.position.z.toFixed(6)];
      doorway.trailerYaw = +trailer.rotation.y.toFixed(6);
    }
  }

  return {
    objects,
    meshes,
    colliders: res.colliders.length,
    triangles: tris(res.group),
    trailerTriangles: trailer ? tris(trailer) : -1,
    // full precision, no rounding: this is the thing that must not move
    colliderDump: res.colliders.map((c) => [
      c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z,
    ].join(',')),
    doorway,
  };
}
`;

const outDir = join(tmpdir(), 'aa-verify-trailer-geom');
mkdirSync(outDir, { recursive: true });

const outfile = join(outDir, 'fleet-' + Date.now() + '.mjs');
await build({
  stdin: { contents: ENTRY, resolveDir: HERE, sourcefile: 'fleet.ts', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // --dev bundles the batcher's dev-throw live, which answers a question the
  // falsifier cannot: does the REAL fleet trip any of the five hazards? If it did,
  // 'npm run dev' would throw and the vehicles module would drop out of the map.
  define: { 'import.meta.env.DEV': process.argv.includes('--dev') ? 'true' : 'false' },
  outfile,
  logLevel: 'warning',
});

/** The A/B switches are read at module scope, so location must exist before import. */
async function variant(search) {
  globalThis.location = { search };
  // a fresh copy per variant; node caches by URL, so vary the query
  const mod = await import(pathToFileURL(outfile).href + '?v=' + encodeURIComponent(search));
  return mod.run();
}

const runs = {
  'shipped+batched': await variant(''),
  'shipped+unbatched': await variant('?nobatch=1'),
  'recess+batched': await variant('?recess=1'),
  'old+batched': await variant('?olddoor=1'),
  'old+unbatched': await variant('?olddoor=1&nobatch=1'),
};

/**
 * The PRE-FIX collider list, written once from the flagged build with
 * `--write-baseline` and then frozen. Diffing against a baseline this run could
 * also have produced would let the check bless itself.
 */
const BASELINE = join(ROOT, 'captures', '_trailer-colliders-prefix.json');
if (process.argv.includes('--write-baseline')) {
  writeFileSync(BASELINE, JSON.stringify({
    note: 'colliders of src/build/vehicles.ts BEFORE the rear-doorway fix '
      + '(?olddoor=1&nobatch=1 arm of the flagged build), full double precision',
    when: new Date().toISOString(),
    dump: runs['old+unbatched'].colliderDump,
  }, null, 2));
  console.log('[trailer-geom] wrote the pre-fix collider baseline');
}

const fails = [];
let base = runs['old+unbatched'].colliderDump;
let baseFrom = 'this run (?olddoor=1&nobatch=1)';
if (existsSync(BASELINE)) {
  base = JSON.parse(readFileSync(BASELINE, 'utf8')).dump;
  baseFrom = 'the frozen pre-fix baseline in captures/_trailer-colliders-prefix.json';
}
for (const [name, r] of Object.entries(runs)) {
  if (r.colliderDump.length !== base.length) {
    fails.push(name + ': ' + r.colliderDump.length + ' colliders, baseline has ' + base.length);
    continue;
  }
  const moved = [];
  for (let i = 0; i < base.length; i++) if (r.colliderDump[i] !== base[i]) moved.push(i);
  if (moved.length) {
    fails.push(name + ': ' + moved.length + ' collider(s) differ from the pre-fix unbatched '
      + 'baseline at index ' + moved.slice(0, 8).join(', '));
  }
}
const triDelta = runs['shipped+unbatched'].trailerTriangles - runs['old+unbatched'].trailerTriangles;
if (triDelta > 0) {
  fails.push('the trailer module GAINED ' + triDelta + ' triangles; the fix removes one panel '
    + 'and moves nothing else, so it may only lose them');
}

writeFileSync(join(ROOT, 'captures', '_trailer-geom.json'), JSON.stringify(runs, null, 2));

if (JSON_OUT) {
  console.log(JSON.stringify({ runs, fails }, null, 2));
} else {
  console.log('[trailer-geom] variant           objects  meshes  colliders  triangles  trailer-tris');
  for (const [name, r] of Object.entries(runs)) {
    console.log('  ' + name.padEnd(17)
      + String(r.objects).padStart(7) + String(r.meshes).padStart(8)
      + String(r.colliders).padStart(11) + String(r.triangles).padStart(11)
      + String(r.trailerTriangles).padStart(14));
  }
  console.log('');
  console.log('[trailer-geom] REAR doorway surfaces, trailer-local x (unbatched arms only - a');
  console.log('               batched arm has already baked its parts into one mesh):');
  for (const name of ['old+unbatched', 'shipped+unbatched']) {
    const d = runs[name] && runs[name].doorway;
    if (!d) { console.log('  ' + name.padEnd(18) + ' (not found)'); continue; }
    console.log('  ' + name.padEnd(18)
      + ' opening panel '
      + (d.panel ? 'x ' + d.panel[0].toFixed(3) + '..' + d.panel[1].toFixed(3) : 'DROPPED        ')
      + '   interior mass x ' + d.mass[0].toFixed(3) + '..' + d.mass[1].toFixed(3));
    if (d.panel) {
      console.log('                     mass front face vs panel front face: '
        + d.frontFaceGapMm.toFixed(1) + ' mm  (0.0 = one plane = the z-fight)');
    }
  }
  console.log('');
  console.log('[trailer-geom] collider lists, full double precision, every variant vs');
  console.log('               ' + baseFrom + ':');
  console.log('               ' + (fails.length ? 'DIFFER' : 'IDENTICAL (' + base.length + ' boxes)'));
  console.log('[trailer-geom] trailer triangles, pre-fix -> shipped: '
    + runs['old+unbatched'].trailerTriangles + ' -> ' + runs['shipped+unbatched'].trailerTriangles
    + '   (module total ' + runs['old+unbatched'].triangles + ' -> '
    + runs['shipped+unbatched'].triangles + ')');
}

if (fails.length) {
  console.error('');
  console.error('[trailer-geom] ' + fails.length + ' FAILURE(S):');
  for (const f of fails) console.error('  - ' + f);
  process.exit(1);
}
console.log('');
console.log('[trailer-geom] colliders byte-identical against ' + baseFrom + '.');
