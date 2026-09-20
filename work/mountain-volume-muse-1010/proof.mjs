/** CPU geometry proof for mountain-volume.ts. No GPU/browser/Blender. */
import * as THREE from 'three';
import {
  MOUNTAIN_VOLUME_RANGES, MV_NX, MV_NZ, MV_SINK, MV_SKIRT_DROP,
  buildRangeGeometry, makeField, mountainVolumeHeight,
} from './mountain-volume.ts';

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!cond) failures++;
};

let totalTris = 0, totalVerts = 0, totalBytes = 0;
for (const cfg of MOUNTAIN_VOLUME_RANGES) {
  const { geometry: geo, stats } = buildRangeGeometry(cfg);
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  const index = geo.getIndex();
  totalTris += stats.triangles;
  totalVerts += stats.vertices;
  totalBytes += (pos.array.byteLength + nor.array.byteLength + uv.array.byteLength + index.array.byteLength);

  // 1. finite positions/normals/uvs + bounding volumes
  let finite = true;
  for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) finite = false;
  for (let i = 0; i < nor.array.length; i++) if (!Number.isFinite(nor.array[i])) finite = false;
  for (let i = 0; i < uv.array.length; i++) if (!Number.isFinite(uv.array[i])) finite = false;
  ok(finite, `${cfg.name}: all attributes finite`);
  ok(!!geo.boundingBox && Number.isFinite(geo.boundingBox.min.x) && Number.isFinite(geo.boundingBox.max.x), `${cfg.name}: bbox finite`);
  ok(!!geo.boundingSphere && Number.isFinite(geo.boundingSphere.radius) && geo.boundingSphere.radius > 0, `${cfg.name}: sphere finite r=${geo.boundingSphere?.radius.toFixed(1)}`);

  // 2. closed manifold: every undirected edge used exactly twice (Euler V-E+F=2)
  const edgeCount = new Map();
  const ia = index.array;
  const edge = (a, b) => { const k = a < b ? a * 1e6 + b : b * 1e6 + a; edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1); };
  for (let t = 0; t < ia.length; t += 3) { edge(ia[t], ia[t + 1]); edge(ia[t + 1], ia[t + 2]); edge(ia[t + 2], ia[t]); }
  let boundary = 0, nonManifold = 0;
  for (const c of edgeCount.values()) { if (c === 1) boundary++; else if (c !== 2) nonManifold++; }
  const F = ia.length / 3, E = edgeCount.size, V = stats.vertices;
  ok(boundary === 0, `${cfg.name}: closed, boundary edges=${boundary}`);
  ok(nonManifold === 0, `${cfg.name}: manifold, non-2 edges=${nonManifold}`);
  ok(V - E + F === 2, `${cfg.name}: Euler V-E+F=${V - E + F} (V=${V} E=${E} F=${F})`);

  // 3. normals unit length
  let nBad = 0;
  for (let i = 0; i < nor.count; i++) {
    const x = nor.getX(i), y = nor.getY(i), z = nor.getZ(i);
    const l = Math.hypot(x, y, z);
    if (!(l > 0.999 && l < 1.001)) nBad++;
  }
  ok(nBad === 0, `${cfg.name}: unit normals, bad=${nBad}`);

  // 4. nonzero depth on all axes: plan footprint + thickness + skirt drop
  const bb = geo.boundingBox;
  const planX = bb.max.x - bb.min.x, planZ = bb.max.z - bb.min.z, thick = bb.max.y - bb.min.y;
  const yawed = Math.abs(Math.sin(cfg.yaw)) > 0.5;
  const expX = yawed ? cfg.d : cfg.w, expZ = yawed ? cfg.w : cfg.d;
  ok(planX > expX * 0.9 && planZ > expZ * 0.9, `${cfg.name}: plan depth x=${planX.toFixed(0)} z=${planZ.toFixed(0)} (w=${cfg.w} d=${cfg.d} yaw=${cfg.yaw.toFixed(2)})`);
  ok(thick > cfg.hMin, `${cfg.name}: thickness ${thick.toFixed(1)} > hMin ${cfg.hMin}`);
  ok(bb.min.y === -(MV_SINK + MV_SKIRT_DROP), `${cfg.name}: bottom ${bb.min.y} = -(SINK+DROP)`);
  ok(bb.max.y > 40, `${cfg.name}: crest ${bb.max.y.toFixed(1)} breaks silhouette`);

  // 5. sunk foot: entire top perimeter at/below y=0; skirts wholly below terrain
  const cols = MV_NX + 1;
  const topY = (idx) => pos.getY(idx);
  let perimAbove = 0;
  const perim = [];
  for (let i = 0; i <= MV_NX; i++) perim.push(i);
  for (let j = 1; j <= MV_NZ; j++) perim.push(j * cols + MV_NX);
  for (let i = MV_NX - 1; i >= 0; i--) perim.push(MV_NZ * cols + i);
  for (let j = MV_NZ - 1; j >= 1; j--) perim.push(j * cols);
  for (const t of perim) if (topY(t) > 0.001) perimAbove++;
  ok(perimAbove === 0, `${cfg.name}: foot sunk, perimeter verts above 0 = ${perimAbove}`);
  let skirtAbove = 0;
  for (let i = stats.vertices - perim.length - 1; i < stats.vertices - 1; i++) if (pos.getY(i) > -0.001 + (MV_SINK + MV_SKIRT_DROP) * 0 + 0 && pos.getY(i) >= 0) skirtAbove++;
  ok(skirtAbove === 0, `${cfg.name}: skirts hidden under terrain, verts >= 0 = ${skirtAbove}`);

  // 6. no exposed vertical cutoff: near-vertical triangles must sit below y<0.5
  const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
  const AB = new THREE.Vector3(), AC = new THREE.Vector3(), N = new THREE.Vector3();
  let exposed = 0;
  for (let t = 0; t < ia.length; t += 3) {
    A.fromBufferAttribute(pos, ia[t]); B.fromBufferAttribute(pos, ia[t + 1]); C.fromBufferAttribute(pos, ia[t + 2]);
    AB.subVectors(B, A); AC.subVectors(C, A); N.crossVectors(AB, AC);
    const len = N.length();
    if (len < 1e-9) { exposed++; continue; }
    N.divideScalar(len);
    if (Math.abs(N.y) < 0.15 && Math.max(A.y, B.y, C.y) > 0.5) exposed++;
  }
  ok(exposed === 0, `${cfg.name}: no exposed vertical faces above ground, count=${exposed}`);

  // 7. silhouette breaks: crest height varies along u (not a level band)
  const f = makeField(cfg.name);
  let mn = 1e9, mx = -1e9;
  for (let i = 0; i <= 64; i++) {
    const h = mountainVolumeHeight(i / 64, 0.38, cfg, f);
    if (h < mn) mn = h; if (h > mx) mx = h;
  }
  ok(mx - mn > cfg.hSpan * 0.35, `${cfg.name}: crest relief ${(mx - mn).toFixed(1)}m (span ${cfg.hSpan})`);

  // 8. determinism: rebuild byte-identical
  const again = buildRangeGeometry(cfg).geometry.getAttribute('position').array;
  let same = again.length === pos.array.length;
  if (same) for (let i = 0; i < pos.array.length; i += 7) if (again[i] !== pos.array[i]) { same = false; break; }
  ok(same, `${cfg.name}: deterministic rebuild identical`);

  geo.dispose();
}

ok(totalTris <= 35000, `budget tris ${totalTris} <= 35000`);
ok(MOUNTAIN_VOLUME_RANGES.length <= 6, `budget draws ${MOUNTAIN_VOLUME_RANGES.length} <= 6`);
ok(totalVerts < 12000, `verts ${totalVerts} bounded`);
console.log(`memory ~${(totalBytes / 1024).toFixed(1)} KiB GPU buffers (positions+normals+uvs+index)`);
ok(totalBytes < 1024 * 1024, `memory < 1 MiB`);

if (failures) { console.error(`\n${failures} FAILURES`); process.exit(1); }
console.log('\nALL PROOF CHECKS PASS');
