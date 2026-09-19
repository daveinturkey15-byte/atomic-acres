#!/usr/bin/env node
/**
 * CPU PROOF - orange-house static batching (F1). No browser, no GPU, no server:
 * bundles the ACTUAL src/build/orange-house.ts with esbuild twice and compares the
 * two worlds it builds.
 *
 *   candidate  the real batcher: the builder's `batchStatic(g, 'orange-house')` runs.
 *   control    the SAME builder source with core/static-batch replaced by a no-op
 *              stub - i.e. exactly the new call reverted, nothing else. This is both
 *              the unbatched baseline and the required negative control: any
 *              acceptance criterion that passes on the candidate must FAIL here.
 *
 * Instrumentation is a single, documented source transform of static-batch.ts: the
 * real `batchStatic` is renamed `batchStaticOnce` and a wrapper re-exports the
 * original name while retaining the last report. No assertion of the existing
 * scripts/_verify-static-batch.mjs is touched or repeated.
 *
 * The stub material library mirrors core/materials.ts ONLY in what this proof can
 * see, per key: singleton identity (painted/emissive/signText cached on their
 * arguments like materials.ts:842-936), transparency (glass transparent:0.42,
 * materials.ts:823-826), and MAP PRESENCE - which decides the batcher's UV drop
 * (static-batch.ts usesUV). windowDark (materials.ts:827-829) and emissive
 * (materials.ts:932) carry NO map slots, so their UVs are dropped on merge; every
 * other material the house uses carries a map or roughnessMap and keeps them.
 * Colours and texture pixels are not reproduced and are not read.
 *
 * Checks (candidate vs control):
 *   1. colliders        exact row-for-row equality (6 floats per row, count).
 *   2. RNG              identical ctx.rand call count (batch consumes no randomness).
 *   3. signature        per (material instance, castShadow, receiveShadow) triangle
 *                       totals equal; total triangles equal.
 *   4. world triangles  multiset of world-space triangles equal - position, normal
 *                       (inverse-transpose), and uv for map-bearing materials only
 *                       (mapless UVs are dropped by the batcher by design). Quantised
 *                       at 1e-6 and, for Float32 bake residuals, resolved by semantic
 *                       limits of 1e-5 m position and 1e-6 normal/uv, with each
 *                       maximum reported.
 *   5. hazards          zero - and the bundle runs under import.meta.env.DEV=true,
 *                       where batchStatic itself throws on any hazard case.
 *   6. glass            every transparent material: same meshes, same triangles,
 *                       none merged.
 *   7. windowDark       identity: exactly one windowDark mesh before and after (the
 *                       living-room TV), same material instance - the reflection
 *                       probe (main.ts:475-479) selects meshes by material identity.
 *   8. reduction        opaque mesh-object count strictly smaller after; the control
 *                       shows ZERO reduction, so acceptance fails without the call.
 *   9. non-trivial      >= 2 merged groups and >= 1000 triangles inside them.
 *
 * Usage: node scripts/assets/verify-orange-house-batch.mjs
 */
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as THREE from 'three';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BATCHER = join(ROOT, 'src', 'core', 'static-batch.ts');

// ------------------------------------------------------------------ bundle input
const ENTRY = `
import * as THREE from 'three';
import { buildOrangeHouse } from './src/build/orange-house';
import { makeRng } from './src/core/kit';
import { __ntLastReport } from './src/core/static-batch';

/** Mirrors core/materials.ts where this proof can see it - see the file header. */
function stubMaterials() {
  const cache = new Map();
  const pixel = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  // Keys that carry a map or roughnessMap in materials.ts (map presence decides the
  // batcher's UV drop). windowDark and emissive are deliberately absent. The
  // capsuleWhite slots and normalScale mirror materials.ts:815 exactly where this
  // proof can see them; texture pixels are intentionally not sampled.
  const TEXTURED = new Set(['concrete', 'stuccoCream', 'stuccoTerracotta', 'roofWhite',
    'solar', 'barrelRoof', 'interiorWall', 'timber', 'timberDark', 'deckBoards',
    'chrome', 'steel', 'capsuleWhite']);
  const mk = (name, p) => {
    const m = new THREE.MeshStandardMaterial(p);
    m.name = name;
    if (TEXTURED.has(name)) m.map = pixel; // slot presence only; never sampled here
    if (name === 'capsuleWhite') {
      m.roughnessMap = pixel;
      m.normalMap = pixel;
      m.normalScale.set(0.35, 0.35);
    }
    return m;
  };
  const get = (key, make) => { let m = cache.get(key); if (!m) { m = make(); cache.set(key, m); } return m; };
  const fixed = {
    concrete: { roughness: 1 }, stuccoCream: { roughness: 1 }, stuccoTerracotta: { roughness: 1 },
    roofWhite: { roughness: 1, metalness: 0.05 }, solar: { roughness: 0.25, metalness: 0.35 },
    barrelRoof: { roughness: 1, metalness: 0.15 }, interiorWall: { roughness: 0.85 },
    capsuleWhite: { roughness: 1, metalness: 0.02, envMapIntensity: 0.6 },
    glass: { roughness: 0.08, transparent: true, opacity: 0.42 },
    windowDark: { roughness: 0.12, metalness: 0.16, envMapIntensity: 2 },
    timber: { roughness: 1 }, timberDark: { roughness: 1 }, deckBoards: { roughness: 1 },
    chrome: { roughness: 1, metalness: 0.95 }, steel: { roughness: 1, metalness: 0.7 },
  };
  const lib = {};
  for (const [k, p] of Object.entries(fixed)) lib[k] = get(k, () => mk(k, p));
  const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
  lib.painted = (color, rough = 0.42, metal = 0.25) =>
    get('p' + color + '_' + rough + '_' + metal,
      () => mk('painted(' + hex(color) + ')', { color, roughness: rough, metalness: metal, map: pixel }));
  lib.emissive = (color, strength = 1.4) =>
    get('e' + color + '_' + strength, () => mk('emissive(' + hex(color) + ')', { color, emissive: color, emissiveIntensity: strength, roughness: 0.5 }));
  lib.signText = (o) =>
    get('s' + o.text + '|' + o.color + '|' + o.background + '|' + o.aspect + '|' + o.script + '|' + o.glow,
      () => mk('signText(' + JSON.stringify(o.text) + ')', { color: o.background ?? 0xffffff, roughness: 0.42, metalness: 0.05, side: THREE.DoubleSide, map: pixel }));
  lib.dispose = () => {};
  // An unknown key is still a material, named so the report shows what grew.
  return new Proxy(lib, {
    get(t, k) {
      if (k in t || typeof k !== 'string') return t[k];
      return get('unknown:' + k, () => mk(k + '?', { roughness: 1 }));
    },
  });
}

export function run() {
  const mat = stubMaterials();
  const rng = makeRng('nuketown-2025:orange-house');
  let rngCalls = 0;
  const rand = () => { rngCalls++; return rng(); };
  const res = buildOrangeHouse({ mat, rand });
  res.group.updateMatrixWorld(true);
  return { THREE, res, mat, rngCalls, report: __ntLastReport() };
}
`;

/** Candidate: keep the real batcher, record its report via a one-line rename. */
const instrumentBatcher = {
  name: 'instrument-static-batch',
  setup(b) {
    b.onLoad({ filter: /static-batch\.ts$/ }, async (args) => {
      let src = readFileSync(args.path, 'utf8');
      const marker = 'export function batchStatic(';
      if (!src.includes(marker)) throw new Error('instrumentation failed: batchStatic signature moved');
      src = src.replace(marker, 'function batchStaticOnce(');
      src += `\nlet __ntLast = null;\n` +
        `export function batchStatic(root, tag, keep) { __ntLast = batchStaticOnce(root, tag, keep); return __ntLast; }\n` +
        `export function __ntLastReport() { return __ntLast; }\n`;
      return { contents: src, loader: 'ts' };
    });
  },
};

/** Control: ONLY the new call is reverted - the batcher itself becomes a no-op. */
const noopBatcher = {
  name: 'noop-static-batch',
  setup(b) {
    b.onResolve({ filter: /static-batch$/ }, () => ({ path: 'static-batch-stub', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
      contents: 'export function batchStatic(){ return { meshesBefore:0, meshesAfter:0, groups:0, pruned:0, left:{}, hazards:[] }; }\n' +
        'export function __ntLastReport(){ return null; }\n',
      loader: 'js',
    }));
  },
};

async function bundleVariant(name, plugin) {
  const dir = mkdtempSync(join(tmpdir(), 'nt-orange-batch-'));
  const outfile = join(dir, name + '.mjs');
  await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'proof-entry.ts', loader: 'ts' },
    bundle: true, platform: 'node', format: 'esm', target: 'node20',
    define: { 'import.meta.env.DEV': 'true' }, // hazards throw, exactly as in dev
    plugins: [plugin], outfile, logLevel: 'warning',
  });
  const api = (await import(pathToFileURL(outfile).href)).run();
  rmSync(dir, { recursive: true, force: true });
  return api;
}

// -------------------------------------------------------------------- harvesting
// The merged attributes are Float32. A 1e-6 key keeps the exact path below
// inside the semantic fallback bounds instead of accepting a broad 1e-4 bin.
const q = (v) => { const r = Math.round(v * 1e6); return r === 0 ? 0 : r; };

/** Local-to-root matrix, walked exactly like static-batch.ts localToRoot. */
function localToRoot(THREE_, mesh, root) {
  const out = new THREE_.Matrix4().identity();
  for (let o = mesh; o && o !== root; o = o.parent) out.premultiply(o.matrix);
  return out;
}

/**
 * Every triangle of the sub-tree in WORLD space (the group sits at identity, as
 * main.ts leaves it - it only renames the group). Per mesh: material instance,
 * shadow flags, transparency, and one record per triangle: 9 position + 3 normal
 * (inverse-transpose) floats, plus uv when the material samples through uv.
 */
function harvest(THREE_, res, libWindowDark) {
  const root = res.group;
  const meshes = [];
  const tris = []; // { mat, matName, cast, recv, transparent, pos: f64[9], nrm, uv|null }
  const a = new THREE_.Vector3(), b = new THREE_.Vector3(), c = new THREE_.Vector3();
  const n = new THREE_.Vector3();
  const nMat = new THREE_.Matrix3();
  const world = new THREE_.Matrix4(), instM = new THREE_.Matrix4();

  root.traverse((o) => {
    if (!o.isMesh || o === root) return;
    const mat = o.material;
    const textured = !!(mat.map || mat.roughnessMap || mat.normalMap || mat.alphaMap ||
      mat.emissiveMap || mat.aoMap || mat.bumpMap || mat.metalnessMap);
    const base = localToRoot(THREE_, o, root);
    const g = o.geometry;
    const pos = g.attributes.position;
    const nrm = g.attributes.normal || null;
    const uv = textured && g.attributes.uv ? g.attributes.uv : null;
    const idx = g.index;
    const triCount = (idx ? idx.count : pos.count) / 3;
    meshes.push({
      name: o.name, mat, matName: mat.name || mat.uuid,
      // identity flag: does this mesh still wear the library's own windowDark singleton
      libSingleton: mat === libWindowDark,
      cast: o.castShadow, recv: o.receiveShadow, transparent: !!mat.transparent,
      instanced: !!o.isInstancedMesh, count: o.isInstancedMesh ? o.count : 1,
      tris: triCount, batched: /^orange-house-b/.test(o.name),
    });
    const emit = (i0, i1, i2, worldM) => {
      nMat.getNormalMatrix(worldM);
      a.fromBufferAttribute(pos, i0).applyMatrix4(worldM);
      b.fromBufferAttribute(pos, i1).applyMatrix4(worldM);
      c.fromBufferAttribute(pos, i2).applyMatrix4(worldM);
      const uvv = uv ? [uv.getX(i0), uv.getY(i0), uv.getX(i1), uv.getY(i1), uv.getX(i2), uv.getY(i2)] : null;
      const nrmAt = (vi) => {
        n.fromBufferAttribute(nrm, vi).applyMatrix3(nMat).normalize();
        return [n.x, n.y, n.z];
      };
      tris.push({
        mid: mat.name || mat.uuid, cast: o.castShadow, recv: o.receiveShadow, transparent: !!mat.transparent,
        pos: [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z],
        nrm: [...nrmAt(i0), ...nrmAt(i1), ...nrmAt(i2)], uv: uvv,
      });
    };
    const instances = o.isInstancedMesh ? o.count : 1;
    for (let k = 0; k < instances; k++) {
      if (o.isInstancedMesh) { o.getMatrixAt(k, instM); world.multiplyMatrices(base, instM); }
      else world.copy(base);
      for (let i = 0; i + 2 < (idx ? idx.count : pos.count); i += 3) {
        const j = (v) => (idx ? idx.getX(v) : v);
        emit(j(i), j(i + 1), j(i + 2), world);
      }
    }
  });
  return { meshes, tris };
}

// ------------------------------------------------------------------ comparisons
function failure(msg) { console.error('  FAIL ' + msg); process.exitCode = 1; }
function pass(msg) { console.log('  ok   ' + msg); }

function triangleSignature(tris) {
  const m = new Map();
  for (const t of tris) {
    const k = t.mid + '|' + (t.cast ? 1 : 0) + (t.recv ? 1 : 0);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function triangleMultiset(tris) {
  const m = new Map();
  for (const t of tris) {
    const parts = [t.mid, t.cast ? 1 : 0, t.recv ? 1 : 0];
    for (const v of t.pos) parts.push(q(v));
    for (const v of t.nrm) parts.push(q(v));
    if (t.uv) for (const v of t.uv) parts.push(q(v));
    const k = parts.join(',');
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

const POS_TOL = 1e-5;
const NRM_TOL = 1e-6;
const UV_TOL = 1e-6;

function residuals(t1, t2) {
  let pos = 0, nrm = 0, uv = 0;
  for (let i = 0; i < 9; i++) pos = Math.max(pos, Math.abs(t1.pos[i] - t2.pos[i]));
  for (let i = 0; i < 9; i++) nrm = Math.max(nrm, Math.abs(t1.nrm[i] - t2.nrm[i]));
  if (t1.uv && t2.uv) for (let i = 0; i < 6; i++) uv = Math.max(uv, Math.abs(t1.uv[i] - t2.uv[i]));
  else if (t1.uv !== t2.uv) uv = Infinity;
  return { pos, nrm, uv, ok: pos <= POS_TOL && nrm <= NRM_TOL && uv <= UV_TOL };
}

function compareTriangles(tag, ctrl, cand, { report = true } = {}) {
  const ms = triangleMultiset(ctrl.tris);
  const leftovers = [];
  for (const t of cand.tris) {
    const parts = [t.mid, t.cast ? 1 : 0, t.recv ? 1 : 0];
    for (const v of t.pos) parts.push(q(v));
    for (const v of t.nrm) parts.push(q(v));
    if (t.uv) for (const v of t.uv) parts.push(q(v));
    const k = parts.join(',');
    const c = ms.get(k) || 0;
    if (c > 0) ms.set(k, c - 1); else leftovers.push(t);
  }
  const exactMissing = [...ms.values()].reduce((s, v) => s + v, 0);
  if (!leftovers.length && !exactMissing) {
    if (report) pass(tag + ': all ' + cand.tris.length + ' world triangles match exactly at 1e-6'
      + (cand.tris.some((t) => t.uv) ? ' (uv compared on map-bearing materials)' : ''));
    return true;
  }
  // Tolerance pass: match candidate leftovers to control leftovers 1:1 per material.
  const ctrlLeft = [];
  const cms = triangleMultiset(cand.tris);
  for (const t of ctrl.tris) {
    const parts = [t.mid, t.cast ? 1 : 0, t.recv ? 1 : 0];
    for (const v of t.pos) parts.push(q(v));
    for (const v of t.nrm) parts.push(q(v));
    if (t.uv) for (const v of t.uv) parts.push(q(v));
    const k = parts.join(',');
    const c = cms.get(k) || 0;
    if (c > 0) cms.set(k, c - 1); else ctrlLeft.push(t);
  }
  const used = new Array(ctrlLeft.length).fill(false);
  const worst = { pos: 0, nrm: 0, uv: 0 };
  let unmatched = 0;
  const scores = [];
  for (const t of leftovers) {
    let best = -1, bestScore = Infinity, bestR = null;
    for (let i = 0; i < ctrlLeft.length; i++) {
      if (used[i] || ctrlLeft[i].mid !== t.mid
        || ctrlLeft[i].cast !== t.cast || ctrlLeft[i].recv !== t.recv) continue;
      const r = residuals(t, ctrlLeft[i]);
      const score = Math.max(r.pos / POS_TOL, r.nrm / NRM_TOL, r.uv / UV_TOL);
      if (score < bestScore) { bestScore = score; best = i; bestR = r; }
    }
    if (best >= 0 && bestR && bestR.ok) {
      used[best] = true;
      worst.pos = Math.max(worst.pos, bestR.pos);
      worst.nrm = Math.max(worst.nrm, bestR.nrm);
      worst.uv = Math.max(worst.uv, bestR.uv);
      scores.push(bestScore);
    }
    else unmatched++;
  }
  // surplus control leftovers = size mismatch + every failed candidate match
  const reverse = ctrlLeft.length - used.filter(Boolean).length;
  if (unmatched === 0 && reverse === 0) {
    if (report) pass(tag + ': triangles match within semantic limits (worst position '
      + worst.pos.toExponential(2) + ' m, normal ' + worst.nrm.toExponential(2)
      + ', uv ' + worst.uv.toExponential(2) + '; ' + leftovers.length + '/'
      + cand.tris.length + ' needed the tolerance pass)');
    return true;
  } else {
    scores.sort((a, b) => a - b);
    const pct = (p) => scores.length ? scores[Math.floor(p * (scores.length - 1))].toExponential(2) : '-';
    if (report) failure(tag + ': ' + unmatched + ' candidate triangles unmatched, ' + reverse
      + ' control triangles unmatched; normalized residual min/med/max '
      + pct(0) + ' / ' + pct(0.5) + ' / ' + pct(1));
    return false;
  }
}

function opaqueMeshCount(h) {
  return h.meshes.filter((m) => !m.transparent).length;
}

function cloneForMutation(h, index, mutate) {
  return {
    ...h,
    tris: h.tris.map((t, i) => {
      const copy = { ...t, pos: [...t.pos], nrm: [...t.nrm], uv: t.uv ? [...t.uv] : null };
      if (i === index) mutate(copy);
      return copy;
    }),
  };
}

function assertComparatorRejects(label, baseline, altered) {
  const accepted = compareTriangles(label, baseline, altered, { report: false });
  accepted
    ? failure(label + ': equivalence gate accepted the intentional mutation')
    : pass(label + ': equivalence gate rejected the intentional mutation');
}

// -------------------------------------------------------------------------- main
console.log('[orange-house-batch] building candidate (real batcher) and control (call reverted)...');
const cand = await bundleVariant('candidate', instrumentBatcher);
const ctrl = await bundleVariant('control', noopBatcher);
const ch = harvest(cand.THREE, cand.res, cand.mat.windowDark);
const bh = harvest(ctrl.THREE, ctrl.res, ctrl.mat.windowDark);
console.log('[orange-house-batch] candidate meshes ' + ch.meshes.length
  + ' (control ' + bh.meshes.length + '), triangles ' + ch.tris.length + ' vs ' + bh.tris.length);

// 1. colliders - exact rows
const cj = JSON.stringify(cand.res.colliders.map((c) => [c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z]));
const bj = JSON.stringify(ctrl.res.colliders.map((c) => [c.min.x, c.min.y, c.min.z, c.max.x, c.max.y, c.max.z]));
cj === bj
  ? pass('colliders: ' + cand.res.colliders.length + ' rows identical, row for row')
  : failure('colliders differ between candidate and control');

// 2. RNG - identical call count, non-trivial
cand.rngCalls === ctrl.rngCalls && cand.rngCalls > 0
  ? pass('RNG: ' + cand.rngCalls + ' ctx.rand calls in both runs (batch consumes none)')
  : failure('RNG call count differs: ' + cand.rngCalls + ' vs ' + ctrl.rngCalls);

// 3. signature - per (material, cast, recv) and total triangles
{
  const cs = triangleSignature(ch.tris), bs = triangleSignature(bh.tris);
  const totalOk = ch.tris.length === bh.tris.length;
  let sigOk = cs.size === bs.size;
  if (sigOk) for (const [k, v] of cs) if (bs.get(k) !== v) { sigOk = false; break; }
  (sigOk && totalOk)
    ? pass('signature: ' + cs.size + ' (material, shadow) groups, triangle totals equal ('
      + ch.tris.length + ')')
    : failure('triangle/material/shadow signature changed');
}

// 4. world triangles + attributes
compareTriangles('world triangles', bh, ch);

// 4b. Falsifiers: the same equivalence gate must reject real geometry, UV, and
// shadow mutations. These are expected failures kept quiet inside the comparator;
// the assertion passes only when the gate returns false.
{
  const triIndex = 0;
  if (ch.tris.length > triIndex) {
    const positionCorrupt = cloneForMutation(ch, triIndex, (t) => { t.pos[0] += 1e-2; });
    assertComparatorRejects('negative control: position corruption', ch, positionCorrupt);
    const shadowCorrupt = cloneForMutation(ch, triIndex, (t) => { t.cast = !t.cast; });
    assertComparatorRejects('negative control: shadow flag corruption', ch, shadowCorrupt);
  } else {
    failure('negative controls unavailable: no harvested triangles');
  }
  const uvIndex = ch.tris.findIndex((t) => t.uv);
  if (uvIndex >= 0) {
    const uvCorrupt = cloneForMutation(ch, uvIndex, (t) => { t.uv[0] += 1e-2; });
    assertComparatorRejects('negative control: UV corruption', ch, uvCorrupt);
  } else {
    failure('negative control unavailable: no map-bearing triangle UVs');
  }
}

// 5. hazards
{
  const r = cand.report;
  r && r.hazards.length === 0
    ? pass('hazards: none (DEV gate armed - it throws; report also empty)')
    : failure('batcher reported hazards: ' + JSON.stringify(r && r.hazards));
}

// 6. glass - transparent surfaces untouched
{
  const glassOf = (h) => h.meshes.filter((m) => m.transparent);
  const gSig = (h) => JSON.stringify(glassOf(h).map((m) => [m.matName, m.tris]).sort());
  const cGlass = glassOf(ch), bGlass = glassOf(bh);
  cGlass.length > 0 && gSig(ch) === gSig(bh)
    ? pass('glass: ' + cGlass.length + ' transparent mesh(es) unchanged - same materials, triangles, never merged')
    : failure('transparent surfaces changed: ' + gSig(ch) + ' vs ' + gSig(bh));
}

// 7. windowDark identity (reflection probe selects by material identity, main.ts:475)
{
  const wd = (h) => h.meshes.filter((m) => m.matName === 'windowDark');
  const one = wd(ch).length === 1 && wd(bh).length === 1;
  const singleton = one && wd(ch)[0].libSingleton && wd(bh)[0].libSingleton;
  const same = one && wd(ch)[0].tris === wd(bh)[0].tris;
  one && singleton && same
    ? pass('windowDark: exactly one mesh (the TV), still the library singleton, unmerged - probe set unchanged')
    : failure('windowDark identity changed: ' + JSON.stringify(wd(ch).map((m) => [m.name, m.tris, m.libSingleton])));
}

// 8. reduction - and the negative control must fail it
{
  const before = opaqueMeshCount(bh), after = opaqueMeshCount(ch);
  const reduction = before - after;
  reduction > 0
    ? pass('reduction: opaque draw objects ' + before + ' -> ' + after + ' (-' + reduction + ')')
    : failure('no opaque reduction (' + before + ' -> ' + after + ')');
  // The control IS the baseline: the no-op batch leaves the tree exactly as built,
  // so reduction there must be zero and acceptance (>0) must fail without the call.
  const ctrlBatched = bh.meshes.filter((m) => m.batched).length;
  const ctrlClean = (!ctrl.report || ctrl.report.groups === 0) && ctrlBatched === 0;
  ctrlClean
    ? pass('negative control: zero reduction, zero groups - reduction acceptance FAILS without the call, as required')
    : failure('negative control did not revert cleanly (groups=' + (ctrl.report && ctrl.report.groups)
      + ', batched meshes=' + ctrlBatched + ')');
}

// 9. non-trivial geometry
{
  const r = cand.report;
  const mergedTris = ch.meshes.filter((m) => m.batched).reduce((s, m) => s + m.tris, 0);
  r && r.groups >= 2 && mergedTris >= 1000
    ? pass('non-trivial: ' + r.groups + ' merged groups carry ' + mergedTris + ' triangles')
    : failure('merge too small: groups=' + (r && r.groups) + ' mergedTris=' + mergedTris);
}

console.log('[orange-house-batch] report: ' + JSON.stringify(cand.report));
console.log(process.exitCode ? 'RESULT: FAIL' : 'RESULT: PASS');
