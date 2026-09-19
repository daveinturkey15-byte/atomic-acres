#!/usr/bin/env node
/* Verify the Operator Sand candidate GLB. Plain node, no deps, no
 * browser/GPU/build/network. Fails closed: a missing file, an unreadable
 * chunk, or any single failed check exits 1.
 *
 * Run (after a root build):
 *   node scripts/assets/verify-operator-sand.mjs [work/operator-sand/operator-sand.glb]
 */
import fs from 'node:fs';
import path from 'node:path';

const GLB = process.argv[2] || path.join('work', 'operator-sand', 'operator-sand.glb');

const BONE_NAMES = [
  'Hips', 'Spine', 'Chest', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToe',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToe',
];
const REST_OFFSETS = {
  Hips: [0, 0.877, 0], Spine: [0, 0.195, 0], Chest: [0, 0.2, 0],
  Neck: [0, 0.27, 0], Head: [0, 0.14, 0],
  LeftShoulder: [-0.18, 0.18, 0], LeftArm: [0, -0.02, 0],
  LeftForeArm: [0, -0.294, 0], LeftHand: [0, -0.276, 0],
  RightShoulder: [0.18, 0.18, 0], RightArm: [0, -0.02, 0],
  RightForeArm: [0, -0.294, 0], RightHand: [0, -0.276, 0],
  LeftUpLeg: [-0.098, 0, 0], LeftLeg: [0, -0.436, 0],
  LeftFoot: [0, -0.401, 0], LeftToe: [0, -0.02, 0.16],
  RightUpLeg: [0.098, 0, 0], RightLeg: [0, -0.436, 0],
  RightFoot: [0, -0.401, 0], RightToe: [0, -0.02, 0.16],
};
const EXPECT_PARENT = {
  Hips: null, Spine: 'Hips', Chest: 'Spine', Neck: 'Chest', Head: 'Neck',
  LeftShoulder: 'Chest', LeftArm: 'LeftShoulder', LeftForeArm: 'LeftArm',
  LeftHand: 'LeftForeArm', RightShoulder: 'Chest', RightArm: 'RightShoulder',
  RightForeArm: 'RightArm', RightHand: 'RightForeArm', LeftUpLeg: 'Hips',
  LeftLeg: 'LeftUpLeg', LeftFoot: 'LeftLeg', LeftToe: 'LeftFoot',
  RightUpLeg: 'Hips', RightLeg: 'RightUpLeg', RightFoot: 'RightLeg',
  RightToe: 'RightFoot',
};

let failures = 0;
function check(id, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ' -- ' + detail : ''}`);
  if (!ok) failures++;
}

if (!fs.existsSync(GLB)) {
  console.log(`FAIL container -- missing ${GLB}; build it with the root command first`);
  process.exit(1);
}
const buf = fs.readFileSync(GLB);
check('container.size', buf.length > 1000, `${buf.length} bytes`);
check('container.magic', buf.readUInt32LE(0) === 0x46546c67, 'GLTF magic');
check('container.version', buf.readUInt32LE(4) === 2, 'version 2');
const jsonLen = buf.readUInt32LE(12);
check('container.json-chunk', buf.readUInt32LE(16) === 0x4e4f534a, `len=${jsonLen}`);
let doc = null;
try {
  doc = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen));
  check('container.json-parse', true, 'parsed');
} catch (e) {
  check('container.json-parse', false, String(e).slice(0, 120));
  process.exit(1);
}
check('asset.version',
  typeof doc.asset?.version === 'string' && doc.asset.version.startsWith('2'),
  doc.asset?.version);
let binStart = 20 + jsonLen, binLen = 0;
if (buf.length > binStart + 8) {
  binLen = buf.readUInt32LE(binStart);
  check('container.bin-chunk', buf.readUInt32LE(binStart + 4) === 0x004e4942, `len=${binLen}`);
  binStart += 8;
} else {
  check('container.bin-chunk', false, 'no BIN chunk');
}
check('extensions.required-empty',
  !doc.extensionsRequired || doc.extensionsRequired.length === 0,
  JSON.stringify(doc.extensionsRequired || []));
for (const sec of ['buffers', 'images', 'textures']) {
  const arr = doc[sec] || [];
  check(`embedded.${sec}`, arr.every((e) => typeof e?.uri !== 'string'), `${arr.length} entries`);
}

const CT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const T_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
let plumbingOk = true;
for (const [vi, v] of (doc.bufferViews || []).entries()) {
  const s = v.byteOffset || 0;
  if (!(s >= 0 && s + v.byteLength <= binLen)) {
    plumbingOk = false;
    check(`plumbing.bufferView[${vi}]`, false, `[${s},${s + v.byteLength}) vs BIN ${binLen}`);
  }
}
check('plumbing.bufferViews-in-BIN', plumbingOk, `${(doc.bufferViews || []).length} views`);

function readAccessor(ai) {
  const a = doc.accessors[ai];
  if (!a || !CT_SIZE[a.componentType] || !T_COUNT[a.type]) return null;
  const v = doc.bufferViews[a.bufferView];
  if (!v) return null;
  const cs = CT_SIZE[a.componentType], tc = T_COUNT[a.type], n = a.count;
  const stride = v.byteStride || cs * tc;
  const base = binStart + (v.byteOffset || 0) + (a.byteOffset || 0);
  if (base + (n - 1) * stride + cs * tc > binStart + binLen) return null;
  const out = new Array(n * tc);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < tc; k++) {
      const o = base + i * stride + k * cs;
      let val;
      switch (a.componentType) {
        case 5121: val = buf.readUInt8(o); break;
        case 5123: val = buf.readUInt16LE(o); break;
        case 5125: val = buf.readUInt32LE(o); break;
        case 5126: val = buf.readFloatLE(o); break;
        case 5120: val = buf.readInt8(o); break;
        case 5122: val = buf.readInt16LE(o); break;
        default: return null;
      }
      if (a.normalized) {
        if (a.componentType === 5121) val /= 255;
        else if (a.componentType === 5123) val /= 65535;
        else if (a.componentType === 5120) val = Math.max(val / 127, -1);
        else if (a.componentType === 5122) val = Math.max(val / 32767, -1);
      }
      out[i * tc + k] = val;
    }
  }
  return { def: a, data: out };
}

let accOk = true;
for (const [ai, a] of (doc.accessors || []).entries()) {
  if (readAccessor(ai) === null) {
    accOk = false;
    check(`plumbing.accessor[${ai}]`, false, 'unreadable or escapes BIN');
  }
}
check('plumbing.accessors-in-views', accOk, `${(doc.accessors || []).length} accessors`);

const skins = doc.skins || [];
check('skin.count', skins.length === 1, `${skins.length} skins`);
const skin = skins[0] || {};
const jointNames = (skin.joints || []).map((ni) => doc.nodes[ni]?.name);
check('skin.joint-names',
  jointNames.length === 21 && jointNames.every((n, i) => n === BONE_NAMES[i]),
  `${jointNames.length} joints`);
const parentOf = new Map();
(doc.nodes || []).forEach((n, i) => (n.children || []).forEach((c) => parentOf.set(c, i)));
let restOk = true, restWorst = 0;
for (const ni of skin.joints || []) {
  const name = doc.nodes[ni]?.name;
  const n = doc.nodes[ni] || {};
  const t = n.translation || [0, 0, 0];
  const r = n.rotation || [0, 0, 0, 1];
  const s = n.scale || [1, 1, 1];
  const exp = REST_OFFSETS[name] || [0, 0, 0];
  const d = Math.hypot(t[0] - exp[0], t[1] - exp[1], t[2] - exp[2]);
  restWorst = Math.max(restWorst, d);
  const rotBad = Math.abs(r[0]) + Math.abs(r[1]) + Math.abs(r[2]) + Math.abs(r[3] - 1);
  const scBad = Math.abs(s[0] - 1) + Math.abs(s[1] - 1) + Math.abs(s[2] - 1);
  if (!(d <= 2e-4 && rotBad <= 1e-6 && scBad <= 1e-6 && !n.matrix)) restOk = false;
  const pi = parentOf.get(ni);
  if ((pi == null ? null : doc.nodes[pi]?.name) !== EXPECT_PARENT[name]) restOk = false;
}
check('skin.rest-offsets', restOk, `worst drift ${restWorst.toExponential(1)} m`);

function matMul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}
function nodeMatrix(i) {
  const n = doc.nodes[i];
  if (n.matrix) return n.matrix.slice();
  const t = n.translation || [0, 0, 0];
  const q = n.rotation || [0, 0, 0, 1];
  const s = n.scale || [1, 1, 1];
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}
const worldCache = new Map();
function worldOf(i) {
  if (worldCache.has(i)) return worldCache.get(i);
  const pi = parentOf.get(i);
  const w = pi == null ? nodeMatrix(i) : matMul(worldOf(pi), nodeMatrix(i));
  worldCache.set(i, w);
  return w;
}
let ibmOk = true, ibmWorst = 0, ibmDetail = '';
const ibmAcc = skin.inverseBindMatrices != null ? readAccessor(skin.inverseBindMatrices) : null;
if (!ibmAcc || ibmAcc.def.count !== 21 || ibmAcc.def.type !== 'MAT4' ||
    ibmAcc.def.componentType !== 5126) {
  ibmOk = false;
  ibmDetail = 'IBM accessor must be 21xMAT4 FLOAT';
} else {
  for (let j = 0; j < 21; j++) {
    const ibm = ibmAcc.data.slice(j * 16, j * 16 + 16);
    if (!ibm.every(Number.isFinite)) { ibmOk = false; ibmDetail = `joint ${j} non-finite`; break; }
    const prod = matMul(ibm, worldOf(skin.joints[j]));
    let worst = 0;
    for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(prod[k] - (k % 5 === 0 ? 1 : 0)));
    ibmWorst = Math.max(ibmWorst, worst);
    if (worst > 1e-3) { ibmOk = false; ibmDetail = `joint ${BONE_NAMES[j]} drifts ${worst}`; }
  }
}
check('skin.inverseBindMatrices', ibmOk, ibmDetail || `IBM*world==I worst ${ibmWorst.toExponential(1)}`);

const prims = [];
for (const m of doc.meshes || []) for (const p of m.primitives || []) prims.push(p);
check('mesh.primitive-budget', prims.length >= 1 && prims.length <= 2,
  `${prims.length} primitives in ${doc.meshes?.length || 0} meshes`);
check('material.budget', (doc.materials || []).length <= 2,
  `${(doc.materials || []).length} materials`);
check('image.budget', (doc.images || []).length >= 1 && (doc.images || []).length <= 3,
  `${(doc.images || []).length} images`);
let imgBytes = 0, imgOk = true;
for (const im of doc.images || []) {
  if (im.mimeType !== 'image/png') imgOk = false;
  const bv = doc.bufferViews[im.bufferView];
  if (!bv || bv.byteLength > 4.5 * 1024 * 1024) imgOk = false;
  else imgBytes += bv.byteLength;
}
check('image.png-1K-embedded', imgOk, `${(imgBytes / 1048576).toFixed(2)} MiB PNG`);
check('image.total-cap', imgBytes <= 12 * 1024 * 1024, `${imgBytes} bytes`);
let primOk = true, triCount = 0;
for (const p of prims) {
  for (const k of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) {
    if (p.attributes?.[k] == null) primOk = false;
  }
  if (p.indices == null || p.material == null || !doc.materials?.[p.material]) primOk = false;
  if (p.mode != null && p.mode !== 4) primOk = false;
  const idx = p.indices != null ? readAccessor(p.indices) : null;
  if (!idx) primOk = false;
  else triCount += idx.data.length / 3;
  if (!doc.materials?.[p.material]?.pbrMetallicRoughness?.baseColorTexture) primOk = false;
}
check('primitive.attributes', primOk, 'indices+PNJWT+material on every prim');
check('budget.triangles', triCount >= 12000 && triCount <= 22000, `${triCount} tris`);

const boneIdx = Object.fromEntries(BONE_NAMES.map((n, i) => [n, i]));
let wSumWorst = 0, wCountBad = 0, wRangeBad = 0, vTotal = 0;
const pairCount = new Map(), rigidCount = new Map();
for (const p of prims) {
  const J = readAccessor(p.attributes.JOINTS_0);
  const W = readAccessor(p.attributes.WEIGHTS_0);
  if (!J || !W) { check('weights.decode', false, 'unreadable skin attributes'); continue; }
  vTotal += J.def.count;
  for (let i = 0; i < J.def.count; i++) {
    const js = [0, 1, 2, 3].map((k) => J.data[i * 4 + k]);
    const ws = [0, 1, 2, 3].map((k) => W.data[i * 4 + k]);
    for (const j of js) if (!(j >= 0 && j < 21)) wRangeBad++;
    const nz = [0, 1, 2, 3].filter((k) => ws[k] > 1e-6);
    if (nz.length === 0 || nz.length > 4) wCountBad++;
    wSumWorst = Math.max(wSumWorst, Math.abs(nz.reduce((a, k) => a + ws[k], 0) - 1));
    const bones = nz.map((k) => js[k]).sort((a, b) => a - b);
    if (bones.length === 1) rigidCount.set(bones[0], (rigidCount.get(bones[0]) || 0) + 1);
    if (bones.length === 2) {
      const key = bones.join('+');
      pairCount.set(key, (pairCount.get(key) || 0) + 1);
    }
  }
}
check('weights.normalized', wSumWorst <= 0.02 && wCountBad === 0 && wRangeBad === 0,
  `${vTotal} verts worst|sum-1|=${wSumWorst.toExponential(1)}`);
for (const [label, a, b] of [
  ['elbow.L', 'LeftArm', 'LeftForeArm'], ['elbow.R', 'RightArm', 'RightForeArm'],
  ['knee.L', 'LeftUpLeg', 'LeftLeg'], ['knee.R', 'RightUpLeg', 'RightLeg'],
]) {
  const key = [boneIdx[a], boneIdx[b]].sort((x, y) => x - y).join('+');
  const got = pairCount.get(key) || 0;
  check(`weights.blend.${label}`, got >= 100, `${got} two-joint verts`);
}
for (const b of ['Head', 'Chest', 'LeftFoot', 'RightFoot']) {
  const got = rigidCount.get(boneIdx[b]) || 0;
  check(`weights.rigid.${b}`, got >= 100, `${got} rigid verts`);
}

let uvOk = true, uvWorst = 0;
for (const p of prims) {
  const uv = readAccessor(p.attributes.TEXCOORD_0);
  if (!uv || uv.def.type !== 'VEC2') { uvOk = false; break; }
  for (const c of uv.data) {
    if (!Number.isFinite(c)) { uvOk = false; break; }
    if (c < -0.01 || c > 1.01) uvWorst = Math.max(uvWorst, Math.abs(c > 1 ? c - 1 : c));
  }
}
check('uv.range', uvOk && uvWorst <= 0.01, `worst overshoot ${uvWorst.toFixed(3)}`);

let bOk = true, mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
for (const p of prims) {
  const pos = readAccessor(p.attributes.POSITION);
  if (!pos) { bOk = false; break; }
  for (let i = 0; i < pos.def.count; i++) {
    for (let k = 0; k < 3; k++) {
      const v = pos.data[i * 3 + k];
      if (!Number.isFinite(v)) bOk = false;
      mn[k] = Math.min(mn[k], v); mx[k] = Math.max(mx[k], v);
    }
  }
}
let bDetail = `x[${mn[0].toFixed(3)},${mx[0].toFixed(3)}] y[${mn[1].toFixed(3)},${mx[1].toFixed(3)}] z[${mn[2].toFixed(3)},${mx[2].toFixed(3)}]`;
if (!(mn[1] >= -0.02 && mn[1] <= 0.05)) { bOk = false; bDetail += ' feet!=0'; }
if (!(mx[1] >= 1.78 && mx[1] <= 1.95)) { bOk = false; bDetail += ' crown!=1.78-class'; }
if (!(mx[2] >= 0.15)) { bOk = false; bDetail += ' no +Z forward reach'; }
if (!(Math.abs(mn[0] + mx[0]) <= 0.02)) { bOk = false; bDetail += ' x-asymmetric'; }
check('bounds.actor', bOk, bDetail);

console.log(failures === 0 ? `\nOPERATOR_SAND_VERIFY PASS -- ${GLB}` : `\nOPERATOR_SAND_VERIFY FAIL (${failures}) -- ${GLB}`);
process.exit(failures === 0 ? 0 : 1);
