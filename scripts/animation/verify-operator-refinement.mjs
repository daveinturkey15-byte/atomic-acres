#!/usr/bin/env node
/**
 * verify-operator-refinement.mjs — headless gate for the muse operator-refinement lane.
 *
 * Plain node only: no browser, GPU, server, build, or network. `three` is used
 * for CPU-side geometry math (the same primitive classes mesh.ts uses), never
 * for rendering — there is no renderer, canvas, or shader compilation here.
 *
 * What it proves (the car-gate lesson: a part listed in the source but missing
 * from the merge must fail loudly):
 *  1. Source contracts on the two owned files: one 256 texture, one material,
 *     one draw per figure, no normal map, camo gated to cloth, no Math.random,
 *     no material construction in mesh.ts, cached per-dress geometry, rigid
 *     weight-1 skinning, part-geo/skeleton disposal, unchanged cull sphere,
 *     and byte-identical anchors on every pre-existing part dimension.
 *  2. Textual add-site parity: every `add({` site in operatorParts() has a
 *     1:1 mirror entry below (counted out of both files), so a part that never
 *     reaches the merge — or a mirror that drifted from the source — fails.
 *  3. Assembled-geometry measurement on REAL THREE primitives merged with
 *     bake() semantics (slot-ordered, rebased indices, 3 groups, rigid skin):
 *     per-band triangles, full-vs-base delta vs the 800 budget, attribute
 *     presence/dimensions, index bounds, skinIndex/skinWeight validity, normal
 *     finiteness/units, group coverage, envelope rules per band, disposal.
 *
 * Known limit, stated not hidden: bone rest-world translations live in
 * skeleton.ts (outside this lane), so the merge runs in bone-local frames and
 * there is no absolute full-figure bounds assertion. Envelope preservation is
 * instead proven three ways: every pre-existing dimension anchor is unchanged,
 * every added band carries an explicit radius/height rule check below, and the
 * CULL sphere constants are asserted byte-identical.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';

const HERE = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(HERE), '..', '..');
const mat = fs.readFileSync(path.join(ROOT, 'src/characters/operator-materials.ts'), 'utf8');
const mesh = fs.readFileSync(path.join(ROOT, 'src/characters/mesh.ts'), 'utf8');
const self = fs.readFileSync(HERE, 'utf8');

const failures = [];
const passes = [];
const check = (name, cond, detail = '') => {
  if (cond) passes.push(detail ? `${name} [${detail}]` : name);
  else failures.push(detail ? `${name} :: ${detail}` : name);
};
const occurrences = (src, re) => (src.match(re) ?? []).length;

// ---------------------------------------------------------------------------
// 1. Material source contracts
// ---------------------------------------------------------------------------
check('mat.detail-size-256', mat.includes('const DETAIL_SIZE = 256;'));
check('mat.detail-tiles-10', mat.includes('const DETAIL_TILES = 10;'));
check('mat.single-data-texture', occurrences(mat, /new THREE\.DataTexture/g) === 1,
  `${occurrences(mat, /new THREE\.DataTexture/g)} found`);
check('mat.single-material', occurrences(mat, /new MeshStandardNodeMaterial/g) === 1);
check('mat.stats-one-draw', mat.includes('drawCallsPerFigure: 1,'));
check('mat.stats-one-each', mat.includes('materials: 1,') && mat.includes('textures: 1,'));
check('mat.no-normal-map', !/normalNode|normalScale|\.normal\s*=/.test(mat),
  'prose and the normalMaps: 0 stat may mention it; no normal-map code');
check('mat.repeat-wrap', mat.includes('detail.wrapS = THREE.RepeatWrapping;') &&
  mat.includes('detail.wrapT = THREE.RepeatWrapping;'));
check('mat.data-colorspace', mat.includes('THREE.NoColorSpace'));
check('mat.camo-cloth-gated', mat.includes('blotch.mul(clothMask)'),
  'tonal camo behind clothMask only; webbing/skin/boots keep old response');
check('mat.two-scale-one-map', mat.includes('uv().mul(DETAIL_TILES)') &&
  mat.includes('uv().mul(CAMO_TILES)') && occurrences(mat, /texture\(detail,/g) === 2);
check('mat.roughness-clamped', mat.includes('.clamp(0.34, 0.98)'));
check('mat.seamless-periods', mat.includes('/ N) * TAU'),
  'every baked signal period divides 256, any float repeat tiles seamlessly');
check('mat.no-random', !/Math\.random/.test(mat));
check('mat.dispose-both', mat.includes('material.dispose();') && mat.includes('detail.dispose();'));

// ---------------------------------------------------------------------------
// 2. Mesh source contracts
// ---------------------------------------------------------------------------
check('mesh.no-material-construct',
  !/new THREE\.(MeshStandardMaterial|MeshPhysicalMaterial|ShaderMaterial|Material)\b/.test(mesh) &&
  !/new MeshStandardNodeMaterial/.test(mesh));
check('mesh.no-random', !/Math\.random/.test(mesh));
check('mesh.cached-per-dress', mesh.includes('bakedCache.get(key)') && mesh.includes('bakedCache.set(key, hit)'));
check('mesh.rest-inverses', mesh.includes('REST_INVERSES') && mesh.includes('new THREE.Skeleton('));
check('mesh.rigid-skin', mesh.includes('skinWeight[v4] = 1;'));
check('mesh.part-geo-disposed', mesh.includes('g.dispose();'));
check('mesh.skeleton-disposed', mesh.includes('skeleton.dispose();'));
check('mesh.shared-geo-kept', !/baked\.geometry\.dispose|geometry\.dispose\(\)/.test(
  mesh.slice(mesh.indexOf('export function dressProcedural'))),
  'dressProcedural dispose must not release the shared cached geometry');
check('mesh.qa-surface', mesh.includes('disposeAll()'));
check('mesh.cull-unchanged', mesh.includes('new THREE.Vector3(0, 0.95, 0)') && mesh.includes('CULL_RADIUS = 1.45'));

// Every pre-existing part dimension: byte-identical, this lane changed none.
const EXISTING_ANCHORS = [
  'cap(0.057, 0.19)', 'cap(0.043, 0.18)', 'cap(0.072, 0.29)', 'cap(0.055, 0.28)',
  'cap(0.048, 0.05)', 'tube(0.152, 0.112, 0.40)', 'tube(0.178, 0.166, 0.355)',
  'tube(0.060, 0.053, 0.046)', 'tube(0.074, 0.064, 0.058)',
  'tube(0.062, 0.058, 0.135, 8, true)', 'dome(Math.PI * 0.62, 14)',
  'box(0.082, 0.118, 0.056)', 'box(0.098, 0.064, 0.200)', 'box(0.046, 0.076, 0.30)',
  'box(0.208, 0.034, 0.016)', 'shell(Math.PI * (d.head',
];
for (const a of EXISTING_ANCHORS) check(`mesh.anchor:${a}`, mesh.includes(a));

// New bands present, exactly one textual site each (×2 sides at runtime).
const BAND_ANCHORS = [
  'tube(0.054, 0.052, 0.014, 8, true)',
  'tube(0.047, 0.044, 0.030, 8, true)',
  'tube(0.066, 0.064, 0.016, 8, true)',
];
for (const a of BAND_ANCHORS) {
  check(`mesh.band:${a}`, occurrences(mesh, a.replace(/[()+.,*]/g, (c) => `\\${c}`)) === 1,
    'one textual site, expanded per side');
}

// ---------------------------------------------------------------------------
// 3. Faithful assembly mirror (same helpers, same loop structure as mesh.ts)
// ---------------------------------------------------------------------------
// MIRROR-BEGIN
const cap = (r, len) => new THREE.CapsuleGeometry(r, len, 3, 8);
const ball = () => new THREE.SphereGeometry(1, 10, 8);
const dome = (theta, seg = 12) => new THREE.SphereGeometry(1, seg, 7, 0, Math.PI * 2, 0, theta);
const shell = (from, to, seg = 12) => new THREE.SphereGeometry(1, seg, 4, 0, Math.PI * 2, from, to - from);
const tube = (rt, rb, h, seg = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

function mirrorParts(head, withBands) {
  const parts = [];
  const put = (tag, q) => { parts.push({ tag, ...q }); };
  const S = (side, n) => `${side}${n}`;
  put('head-skull', { bone: 'Head', geo: ball(), slot: 0, pos: [0, 0.045, 0.006], scl: [0.098, 0.115, 0.108] });
  if (head === 'helmet') {
    put('head-dome', { bone: 'Head', geo: dome(Math.PI * 0.62, 14), slot: 1, pos: [0, 0.046, -0.004], scl: [0.121, 0.130, 0.130] });
    put('head-rim', { bone: 'Head', geo: tube(0.124, 0.128, 0.026, 14, true), slot: 1, pos: [0, 0.012, -0.004] });
    put('head-nvg', { bone: 'Head', geo: box(0.052, 0.038, 0.032), slot: 2, pos: [0, 0.082, 0.112] });
  } else {
    put('head-crown', { bone: 'Head', geo: dome(Math.PI * 0.5, 12), slot: 1, pos: [0, 0.052, 0.002], scl: [0.106, 0.082, 0.112] });
    put('head-peak', { bone: 'Head', geo: box(0.168, 0.018, 0.088), slot: 1, pos: [0, 0.056, 0.104] });
  }
  put('head-goggles', { bone: 'Head', geo: box(0.208, 0.034, 0.016), slot: 2, pos: [0, 0.050, 0.092] });
  put('head-balaclava', { bone: 'Head', geo: shell(Math.PI * (head === 'helmet' ? 0.58 : 0.645), Math.PI, 12), slot: 2, pos: [0, 0.045, 0.006], scl: [0.102, 0.119, 0.112] });
  put('neck', { bone: 'Neck', geo: cap(0.048, 0.05), slot: 1, pos: [0, 0.026, 0] });
  put('chest-torso', { bone: 'Chest', geo: tube(0.152, 0.112, 0.40), slot: 1, pos: [0, 0.110, 0], scl: [1, 1, 0.68] });
  put('chest-carrier', { bone: 'Chest', geo: tube(0.178, 0.166, 0.355), slot: 2, pos: [0, 0.126, 0.004], scl: [1, 1, 0.80] });
  for (const x of [-0.088, 0, 0.088]) put('chest-pouch', { bone: 'Chest', geo: box(0.082, 0.118, 0.056), slot: 2, pos: [x, 0.078, 0.128] });
  put('chest-admin', { bone: 'Chest', geo: box(0.132, 0.070, 0.046), slot: 2, pos: [0, 0.188, 0.118] });
  put('chest-radio', { bone: 'Chest', geo: box(0.190, 0.200, 0.086), slot: 2, pos: [0, 0.128, -0.138] });
  for (const x of [-0.102, 0.102]) put('chest-strap', { bone: 'Chest', geo: box(0.062, 0.058, 0.205), slot: 2, pos: [x, 0.276, 0.004] });
  put('chest-collar', { bone: 'Chest', geo: tube(0.074, 0.092, 0.072), slot: 1, pos: [0, 0.290, 0], scl: [1, 1, 0.82] });
  put('spine', { bone: 'Spine', geo: tube(0.114, 0.104, 0.20), slot: 1, pos: [0, 0.020, 0], scl: [1, 1, 0.70] });
  put('hips', { bone: 'Hips', geo: tube(0.114, 0.134, 0.17), slot: 1, pos: [0, 0.052, 0], scl: [1, 1, 0.74] });
  put('belt', { bone: 'Hips', geo: tube(0.138, 0.138, 0.056, 10), slot: 2, pos: [0, 0.114, 0], scl: [1, 1, 0.80] });
  put('dump', { bone: 'Hips', geo: box(0.086, 0.106, 0.078), slot: 2, pos: [-0.146, 0.054, -0.012] });
  for (const side of ['Left', 'Right']) {
    const out = side === 'Left' ? -1 : 1;
    put('shoulder', { bone: S(side, 'Shoulder'), geo: ball(), slot: 1, scl: [0.076, 0.072, 0.076] });
    put('arm', { bone: S(side, 'Arm'), geo: cap(0.057, 0.19), slot: 1, pos: [0, -0.147, 0] });
    put('cuff', { bone: S(side, 'Arm'), geo: tube(0.060, 0.053, 0.046), slot: 1, pos: [0, -0.262, 0] });
    if (withBands) {
      put('band-cuffhem', { bone: S(side, 'Arm'), geo: tube(0.054, 0.052, 0.014, 8, true), slot: 1, pos: [0, -0.286, 0], band: 'cuffhem' });
      put('band-elbow', { bone: S(side, 'ForeArm'), geo: tube(0.047, 0.044, 0.030, 8, true), slot: 1, pos: [0, -0.015, 0], band: 'elbow' });
    }
    put('forearm', { bone: S(side, 'ForeArm'), geo: cap(0.043, 0.18), slot: 0, pos: [0, -0.136, 0] });
    put('hand', { bone: S(side, 'Hand'), geo: box(0.074, 0.104, 0.058), slot: 2, pos: [0, -0.040, 0.004] });
    if (side === 'Right') {
      put('rifle-receiver', { bone: S(side, 'Hand'), geo: box(0.046, 0.076, 0.30), slot: 2, pos: [0, -0.046, 0.128] });
      put('rifle-handguard', { bone: S(side, 'Hand'), geo: box(0.034, 0.038, 0.26), slot: 2, pos: [0, -0.062, 0.312] });
      put('rifle-grip', { bone: S(side, 'Hand'), geo: box(0.030, 0.100, 0.056), slot: 2, pos: [0, -0.112, 0.082] });
      put('rifle-stock', { bone: S(side, 'Hand'), geo: box(0.042, 0.064, 0.165), slot: 2, pos: [0, -0.030, -0.100] });
      put('rifle-sight', { bone: S(side, 'Hand'), geo: box(0.032, 0.034, 0.072), slot: 2, pos: [0, 0.006, 0.108] });
    }
    put('hipball', { bone: S(side, 'UpLeg'), geo: ball(), slot: 1, scl: [0.083, 0.078, 0.083] });
    put('thigh', { bone: S(side, 'UpLeg'), geo: cap(0.072, 0.29), slot: 1, pos: [0, -0.215, 0] });
    put('cargo', { bone: S(side, 'UpLeg'), geo: box(0.056, 0.132, 0.094), slot: 1, pos: [out * 0.070, -0.182, 0.012] });
    if (side === 'Right') put('holster', { bone: S(side, 'UpLeg'), geo: box(0.062, 0.128, 0.052), slot: 2, pos: [0.080, -0.268, 0.016] });
    put('kneepad', { bone: S(side, 'Leg'), geo: box(0.108, 0.118, 0.078), slot: 2, pos: [0, -0.028, 0.046] });
    put('shin', { bone: S(side, 'Leg'), geo: cap(0.055, 0.28), slot: 1, pos: [0, -0.180, 0] });
    put('blouse', { bone: S(side, 'Leg'), geo: tube(0.074, 0.064, 0.058), slot: 1, pos: [0, -0.262, 0] });
    if (withBands) put('band-gather', { bone: S(side, 'Leg'), geo: tube(0.066, 0.064, 0.016, 8, true), slot: 1, pos: [0, -0.296, 0], band: 'gather' });
    put('shaft', { bone: S(side, 'Leg'), geo: tube(0.062, 0.058, 0.135, 8, true), slot: 2, pos: [0, -0.336, 0] });
    put('foot', { bone: S(side, 'Foot'), geo: ball(), slot: 2, pos: [0, -0.004, 0.004], scl: [0.058, 0.050, 0.064] });
    put('toe', { bone: S(side, 'Foot'), geo: box(0.098, 0.064, 0.200), slot: 2, pos: [0, -0.010, 0.086] });
    put('sole', { bone: S(side, 'Foot'), geo: box(0.106, 0.024, 0.234), slot: 2, pos: [0, -0.038, 0.076] });
  }
  return parts;
}
// MIRROR-END

// Textual add-site parity: source `add({` sites vs mirror `put(` sites.
const mirrorBody = self.slice(self.indexOf('// MIRROR-BEGIN'), self.indexOf('// MIRROR-END'));
const sourceSites = occurrences(mesh, /\badd\(\{/g);
const mirrorSites = occurrences(mirrorBody, /\bput\(/g);
check('parity.add-sites', sourceSites === mirrorSites, `source=${sourceSites} mirror=${mirrorSites}`);

// ---------------------------------------------------------------------------
// 4. Assembled-geometry measurement (bake() semantics, bone-local frames)
// ---------------------------------------------------------------------------
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();

function transformLocal(geo, p) {
  const [px, py, pz] = p.pos ?? [0, 0, 0];
  const [rx, ry, rz] = p.rot ?? [0, 0, 0];
  const [sx, sy, sz] = p.scl ?? [1, 1, 1];
  _q.setFromEuler(_e.set(rx, ry, rz));
  _m.compose(_v.set(px, py, pz), _q, _s.set(sx, sy, sz));
  geo.applyMatrix4(_m);
  return geo;
}

function assemble(parts) {
  const bones = [];
  const boneIndex = new Map();
  for (const p of parts) {
    if (!boneIndex.has(p.bone)) {
      boneIndex.set(p.bone, bones.length);
      bones.push(p.bone);
    }
  }
  const ordered = [...parts].sort((a, b) => a.slot - b.slot);
  let vTotal = 0;
  let iTotal = 0;
  const geos = ordered.map((p) => {
    const g = transformLocal(p.geo, p);
    const count = g.getAttribute('position').count;
    const index = g.getIndex();
    // Pre-merge primitive validity on the REAL primitive.
    const ix = index ? index.array : null;
    if (ix) {
      let mx = 0;
      for (let i = 0; i < ix.length; i++) if (ix[i] > mx) mx = ix[i];
      p._indexMax = mx;
      p._indexCount = ix.length;
    } else {
      p._indexMax = count - 1;
      p._indexCount = count;
    }
    p._verts = count;
    vTotal += count;
    iTotal += p._indexCount;
    return { p, g };
  });

  const position = new Float32Array(vTotal * 3);
  const normal = new Float32Array(vTotal * 3);
  const uv = new Float32Array(vTotal * 2);
  const skinIndex = new Uint16Array(vTotal * 4);
  const skinWeight = new Float32Array(vTotal * 4);
  const indices = new Uint32Array(iTotal);
  const groups = [];
  let vOff = 0;
  let iOff = 0;
  let slotStart = 0;
  let slotNow = ordered.length ? ordered[0].slot : 0;
  for (const { p, g } of geos) {
    if (p.slot !== slotNow) {
      groups.push({ start: slotStart, count: iOff - slotStart, materialIndex: slotNow });
      slotStart = iOff;
      slotNow = p.slot;
    }
    const pa = g.getAttribute('position');
    const na = g.getAttribute('normal');
    const ua = g.getAttribute('uv');
    const bone = boneIndex.get(p.bone);
    for (let i = 0; i < p._verts; i++) {
      position[(vOff + i) * 3] = pa.getX(i);
      position[(vOff + i) * 3 + 1] = pa.getY(i);
      position[(vOff + i) * 3 + 2] = pa.getZ(i);
      normal[(vOff + i) * 3] = na.getX(i);
      normal[(vOff + i) * 3 + 1] = na.getY(i);
      normal[(vOff + i) * 3 + 2] = na.getZ(i);
      if (ua) {
        uv[(vOff + i) * 2] = ua.getX(i);
        uv[(vOff + i) * 2 + 1] = ua.getY(i);
      }
      skinIndex[(vOff + i) * 4] = bone;
      skinWeight[(vOff + i) * 4] = 1;
    }
    const srcIndex = g.getIndex();
    if (srcIndex) {
      for (let i = 0; i < srcIndex.count; i++) indices[iOff + i] = srcIndex.getX(i) + vOff;
      iOff += srcIndex.count;
    } else {
      for (let i = 0; i < p._verts; i++) indices[iOff + i] = vOff + i;
      iOff += p._verts;
    }
    vOff += p._verts;
  }
  groups.push({ start: slotStart, count: iOff - slotStart, materialIndex: slotNow });

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  merged.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  merged.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  for (const grp of groups) merged.addGroup(grp.start, grp.count, grp.materialIndex);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return { parts: ordered, geos, merged, bones, groups, vertices: vTotal, triangles: iTotal / 3 };
}

const results = {};
for (const head of ['helmet', 'cap']) {
  for (const withBands of [false, true]) {
    const key = `${head}${withBands ? '+bands' : '-base'}`;
    results[key] = assemble(mirrorParts(head, withBands));
  }
}

// Per-figure band cost: exactly 6 runtime parts (3 sites × 2 sides), 16 tris each.
for (const head of ['helmet', 'cap']) {
  const base = results[`${head}-base`];
  const full = results[`${head}+bands`];
  const bands = full.parts.filter((p) => p.band);
  check(`${head}.band-count`, bands.length === 6, `${bands.length} runtime band parts`);
  for (const b of bands) {
    check(`${head}.band-tris:${b.tag}`, b._indexCount / 3 === 16, `${b._indexCount / 3} tris`);
  }
  const delta = full.triangles - base.triangles;
  check(`${head}.delta-le-800`, delta <= 800, `+${delta} tris (base=${base.triangles} full=${full.triangles})`);
  check(`${head}.groups-3`, full.groups.length === 3 &&
    full.groups.map((g) => g.materialIndex).join(',') === '0,1,2',
    full.groups.map((g) => `${g.materialIndex}:${g.count}`).join(' '));
  const covered = full.groups.reduce((n, g) => n + g.count, 0);
  check(`${head}.groups-cover`, covered === full.triangles * 3, `${covered}/${full.triangles * 3} indices`);
}

// Assembled-attribute validity on the full helmet figure ( strictest part count ).
{
  const { merged, geos, bones, vertices } = results['helmet+bands'];
  const pos = merged.getAttribute('position');
  const nor = merged.getAttribute('normal');
  const tuv = merged.getAttribute('uv');
  const si = merged.getAttribute('skinIndex');
  const sw = merged.getAttribute('skinWeight');
  check('asm.attrs-present', !!(pos && nor && tuv && si && sw));
  check('asm.attr-dims', pos.itemSize === 3 && nor.itemSize === 3 && tuv.itemSize === 2 &&
    si.itemSize === 4 && sw.itemSize === 4 &&
    pos.count === vertices && nor.count === vertices && si.count === vertices && sw.count === vertices,
    `${vertices} verts`);
  const ix = merged.getIndex();
  let mx = 0;
  for (let i = 0; i < ix.count; i++) if (ix.getX(i) > mx) mx = ix.getX(i);
  check('asm.index-bounds', mx < vertices, `max=${mx} verts=${vertices}`);
  let weightsOk = true;
  let bonesOk = true;
  for (let i = 0; i < vertices; i++) {
    if (sw.getX(i) !== 1 || sw.getY(i) !== 0 || sw.getZ(i) !== 0 || sw.getW(i) !== 0) { weightsOk = false; break; }
    const b = si.getX(i);
    if (!Number.isInteger(b) || b < 0 || b >= bones.length) { bonesOk = false; break; }
  }
  check('asm.weights-rigid-1', weightsOk, 'every vertex weight (1,0,0,0)');
  check('asm.skin-bones', bonesOk, `${bones.length} bones: ${bones.join(',')}`);
  let normalsOk = true;
  for (let i = 0; i < vertices; i++) {
    const nx = nor.getX(i);
    const ny = nor.getY(i);
    const nz = nor.getZ(i);
    if (!Number.isFinite(nx + ny + nz)) { normalsOk = false; break; }
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (Math.abs(len - 1) > 1e-3) { normalsOk = false; break; }
  }
  check('asm.normals-unit', normalsOk);
  const bb = merged.boundingBox;
  check('asm.bounds-finite', Number.isFinite(bb.min.x + bb.min.y + bb.min.z + bb.max.x + bb.max.y + bb.max.z));
  let primsOk = true;
  for (const { p } of geos) {
    if (!(p._verts > 0 && p._indexMax < p._verts)) { primsOk = false; break; }
  }
  check('asm.prims-valid', primsOk, `${geos.length} merged parts, none empty or mis-indexed`);
  // Envelope rules per band: thin rings on existing silhouettes, never growth.
  const rules = {
    cuffhem: { maxR: 0.054, maxH: 0.016, bone: 'Arm' },
    elbow: { maxR: 0.047, maxH: 0.032, bone: 'ForeArm' },
    gather: { maxR: 0.066, maxH: 0.016, bone: 'Leg' },
  };
  for (const { p } of geos) {
    if (!p.band) continue;
    const r = rules[p.band];
    const prm = p.geo.parameters;
    const ok = prm.radiusTop <= r.maxR + 1e-6 && prm.radiusBottom <= r.maxR + 1e-6 &&
      prm.height <= r.maxH + 1e-6 && prm.openEnded === true && p.bone.endsWith(r.bone) && p.slot === 1;
    check(`asm.envelope:${p.tag}:${p.bone}`, ok,
      `r=${prm.radiusTop}/${prm.radiusBottom} h=${prm.height} open=${prm.openEnded} slot=${p.slot}`);
  }
  // Disposal: bake() consumes part geos, dressProcedural keeps the shared one.
  let disposed = false;
  try {
    for (const { g } of geos) g.dispose();
    merged.dispose();
    disposed = true;
  } catch { disposed = false; }
  check('asm.dispose-clean', disposed);
}

// ---------------------------------------------------------------------------
// 5. Report
// ---------------------------------------------------------------------------
console.log(`operator-refinement verify: ${passes.length} passed`);
for (const p of passes) console.log(`  ok ${p}`);
console.log('texture: 1x256 RGBA = 262144 bytes, materials = 1, draws/figure = 1, normalMaps = 0');
for (const head of ['helmet', 'cap']) {
  const base = results[`${head}-base`];
  const full = results[`${head}+bands`];
  console.log(`figure.${head}: base=${base.triangles}tris/${base.vertices}v full=${full.triangles}tris/${full.vertices}v delta=+${full.triangles - base.triangles}tris parts=${full.parts.length}`);
}
if (failures.length) {
  console.log(`${failures.length} FAILURES:`);
  for (const f of failures) console.log(`  FAIL ${f}`);
  process.exit(1);
}
console.log('PASS');
