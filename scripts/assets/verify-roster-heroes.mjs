#!/usr/bin/env node
/**
 * Roster heroes GLB verifier — measures the exported files, not build receipts.
 *
 * Correct GLB binary-chunk decoding: bufferView.byteOffset is relative to the
 * start of the BIN chunk body (binStart = 20 + jsonLen + 8: header + JSON chunk
 * header + BIN chunk header), never to the whole file. The carbine lane's
 * verify_glb.mjs shipped an 8-byte-shift bug here; this verifier does not.
 *
 * Checks per gun (mp5, m14-ebr, lmg) in public/assets/roster-heroes/:
 *   presence, TRIANGLES-only modes, tris/draw/material/image budgets,
 *   embedded PNG dimensions (IHDR, <=1024), actual PBR wiring
 *   (baseColorTexture + metallicRoughnessTexture on EVERY material),
 *   the 4 anchor_* sockets within tolerance of the design table,
 *   a real magazine/ammo-box node with anchor_mag inside its bounds
 *   (usable reload pivot), sane world bounds, UV presence/finiteness/[0,1].
 *
 * Usage:
 *   node scripts/assets/verify-roster-heroes.mjs [--strict] [--out <json>]
 * Exit 0 only when every gun passes. Missing GLBs fail in ALL modes
 * (strict included) so a source-only checkout is honestly red.
 * --strict additionally turns budget/socket warnings into failures.
 */
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const PUB = join(ROOT, 'public', 'assets', 'roster-heroes');

const GUNS = {
  'mp5': {
    sockets: {
      anchor_muzzle: [0.0, 0.345, 0.030],
      anchor_grip: [0.0, -0.020, -0.075],
      anchor_support: [0.0, 0.150, -0.005],
      anchor_mag: [0.0, 0.045, -0.045],
    },
    bounds: { x: 0.10, y: [-0.36, 0.40], z: [-0.26, 0.14] },
  },
  'm14-ebr': {
    sockets: {
      anchor_muzzle: [0.0, 0.630, 0.038],
      anchor_grip: [0.0, -0.150, -0.075],
      anchor_support: [0.0, 0.330, 0.005],
      anchor_mag: [0.0, 0.060, -0.055],
    },
    bounds: { x: 0.10, y: [-0.44, 0.70], z: [-0.28, 0.18] },
  },
  'lmg': {
    sockets: {
      anchor_muzzle: [0.0, 0.575, 0.040],
      anchor_grip: [0.0, -0.170, -0.080],
      anchor_support: [0.0, 0.300, -0.010],
      anchor_mag: [-0.060, 0.060, 0.020],
    },
    bounds: { x: 0.18, y: [-0.50, 0.64], z: [-0.28, 0.20] },
  },
};

// glTF Y-up viewmodel contract: Blender +Y forward -> glTF -Z forward.
const BUDGET = { tris: 14000, draws: 18, mats: 3, images: 2, px: 1024 };
const SOCK_TOL = 0.008; // m, glTF float32 rounding
const PIVOT_TOL = 0.012; // anchor_mag must sit at the mag feed-top interface

const COMP_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const COMP_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function parseGLB(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not glTF binary');
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binLen = buf.readUInt32LE(20 + jsonLen);
  const binStart = 20 + jsonLen + 8; // +8: BIN chunk length+type header
  const bin = buf.subarray(binStart, binStart + binLen);
  return { buf, gltf, bin };
}

function accessorFloats(gltf, bin, idx) {
  const acc = gltf.accessors[idx];
  const bv = gltf.bufferViews[acc.bufferView];
  // CORRECT: bufferView.byteOffset is relative to the BIN chunk body.
  const base = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const n = COMP_COUNT[acc.type];
  const stride = bv.byteStride ?? COMP_SIZE[acc.componentType] * n;
  if (acc.componentType !== 5126) throw new Error(`non-float accessor ${idx}`);
  const out = [];
  for (let v = 0; v < acc.count; v++) {
    const row = [];
    for (let c = 0; c < n; c++) row.push(bin.readFloatLE(base + v * stride + c * 4));
    out.push(row);
  }
  return { acc, rows: out };
}

function pngDims(bin, gltf, img) {
  if (img.bufferView === undefined) return { embedded: false };
  const bv = gltf.bufferViews[img.bufferView];
  const bytes = bin.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  if (bytes.length < 33 || bytes.readUInt32BE(0) !== 0x89504e47) {
    return { embedded: true, png: false };
  }
  return {
    embedded: true,
    png: true,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bytes: bv.byteLength,
  };
}

function checkGun(gun, strict) {
  const fails = [];
  const warns = [];
  const path = join(PUB, `${gun}.glb`);
  if (!existsSync(path)) {
    fails.push(`ASSETS_MISSING: ${gun}.glb not built (source-only checkout)`);
    return { gun, path, ok: false, fails, warns, stats: null };
  }
  let gltf, bin;
  try {
    ({ gltf, bin } = parseGLB(path));
  } catch (e) {
    fails.push(`unparseable GLB: ${e.message}`);
    return { gun, path, ok: false, fails, warns, stats: null };
  }

  // --- triangles / draws ---
  let tris = 0;
  const prims = gltf.meshes?.flatMap((m) => m.primitives ?? []) ?? [];
  for (const p of prims) {
    if (p.mode !== undefined && p.mode !== 4) fails.push(`non-triangle mode ${p.mode}`);
    tris += gltf.accessors[p.indices].count / 3;
  }
  const draws = prims.length;
  const stats = { tris, draws };
  if (tris > BUDGET.tris) fails.push(`tris ${tris} > ${BUDGET.tris}`);
  if (draws > BUDGET.draws) fails.push(`draws ${draws} > ${BUDGET.draws}`);

  // --- materials: count + ACTUAL PBR texture wiring on every material ---
  const mats = gltf.materials ?? [];
  stats.materials = mats.map((m) => m.name);
  if (mats.length > BUDGET.mats) fails.push(`materials ${mats.length} > ${BUDGET.mats}`);
  if (mats.length === 0) fails.push('no materials');
  for (const m of mats) {
    const pbr = m.pbrMetallicRoughness ?? {};
    if (!pbr.baseColorTexture) fails.push(`material ${m.name}: missing baseColorTexture`);
    if (!pbr.metallicRoughnessTexture) fails.push(`material ${m.name}: missing metallicRoughnessTexture`);
  }

  // --- images: count + real embedded PNG dims ---
  const imgs = gltf.images ?? [];
  stats.images = [];
  if (imgs.length > BUDGET.images) fails.push(`images ${imgs.length} > ${BUDGET.images}`);
  if (imgs.length === 0) fails.push('no embedded textures (PBR needs actual textures)');
  for (const im of imgs) {
    const d = pngDims(bin, gltf, im);
    stats.images.push({ name: im.name, mimeType: im.mimeType, ...d });
    if (!d.embedded) (strict ? fails : warns).push(`image ${im.name}: not buffer-embedded`);
    else if (!d.png) (strict ? fails : warns).push(`image ${im.name}: not PNG`);
    else if (d.width > BUDGET.px || d.height > BUDGET.px) {
      (strict ? fails : warns).push(`image ${im.name}: ${d.width}x${d.height} > ${BUDGET.px}`);
    }
  }

  // --- sockets: presence + position (glTF coords: muzzle -Z, up +Y) ---
  const nodes = gltf.nodes ?? [];
  const byName = new Map(nodes.map((n) => [n.name, n]));
  stats.anchors = {};
  // Blender (x,y,z) -> glTF (x,z,-y): flip the design table the same way.
  const toGltf = ([x, y, z]) => [x, z, -y];
  for (const [nm, expB] of Object.entries(GUNS[gun].sockets)) {
    const n = byName.get(nm);
    if (!n) {
      fails.push(`missing socket ${nm} (never fabricate: reject asset)`);
      continue;
    }
    const exp = toGltf(expB);
    const got = n.translation ?? [0, 0, 0];
    stats.anchors[nm] = got;
    const err = Math.max(...got.map((v, i) => Math.abs(v - exp[i])));
    if (err > SOCK_TOL) fails.push(`socket ${nm} off by ${err.toFixed(4)}m`);
  }

  // --- real magazine with usable reload pivot ---
  // glTF node.mesh is an INDEX, not a name; and the exporter may wrap the
  // named mag in an empty with the geometry on a child. Collect the whole
  // subtree, transform every descendant POSITION by its accumulated TRS
  // chain, and test the union bounds. Never invent a mesh, never skip pivot.
  const magIdx = nodes.findIndex((n) => /magazine|ammo_box/.test(n.name ?? ''));
  if (magIdx < 0) {
    fails.push('no real magazine/ammo-box mesh object');
  } else {
    const magNode = nodes[magIdx];
    const parent = new Array(nodes.length).fill(-1);
    nodes.forEach((n, i) => (n.children ?? []).forEach((c) => { parent[c] = i; }));
    const sub = new Set([magIdx]);
    const stack = [magIdx];
    while (stack.length) {
      const cur = stack.pop();
      for (const c of nodes[cur].children ?? []) { sub.add(c); stack.push(c); }
    }
    const meshIdxs = [...sub].filter((i) => typeof nodes[i].mesh === 'number');
    const nodeMatrix = (i) => {
      const chain = [];
      for (let c = i; c >= 0; c = parent[c]) chain.unshift(nodes[c]);
      let m = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
      const mul = (A, B) => {
        const C = new Array(16).fill(0);
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++)
          for (let k = 0; k < 4; k++) C[r*4+c] += A[r*4+k] * B[k*4+c];
        return C;
      };
      const quatToMat = (q) => {
        const [x,y,z,w] = q;
        return [1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),0, 2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),0, 2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y),0, 0,0,0,1];
      };
      for (const n of chain) {
        let local = n.matrix;
        if (!local) {
          const t = n.translation ?? [0,0,0];
          const q = n.rotation ?? [0,0,0,1];
          const s = n.scale ?? [1,1,1];
          const R = quatToMat(q);
          local = [R[0]*s[0],R[1]*s[0],R[2]*s[0],0, R[4]*s[1],R[5]*s[1],R[6]*s[1],0, R[8]*s[2],R[9]*s[2],R[10]*s[2],0, t[0],t[1],t[2],1];
        }
        const colMaj = (r, c) => local[c*4+r];
        const rowMaj = []; for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) rowMaj.push(colMaj(r, c));
        m = mul(m, rowMaj);
      }
      return m;
    };
    const applyMat = (m, [x,y,z]) => [m[0]*x+m[1]*y+m[2]*z+m[3], m[4]*x+m[5]*y+m[6]*z+m[7], m[8]*x+m[9]*y+m[10]*z+m[11]];
    let mn = [Infinity,Infinity,Infinity], mx = [-Infinity,-Infinity,-Infinity];
    let primsSeen = 0;
    try {
      for (const i of meshIdxs) {
        const mesh = (gltf.meshes ?? [])[nodes[i].mesh];
        if (!mesh) continue;
        const M = nodeMatrix(i);
        for (const p of mesh.primitives ?? []) {
          if (p.attributes.POSITION === undefined) continue;
          primsSeen++;
          const { rows } = accessorFloats(gltf, bin, p.attributes.POSITION);
          for (const r of rows) {
            const w = applyMat(M, r);
            for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); }
          }
        }
      }
    } catch (e) {
      fails.push(`mag geometry read failed: ${e.message}`);
    }
    if (!primsSeen) {
      fails.push(`mag node ${magNode.name} has no mesh`);
    } else {
      const anchor = byName.get('anchor_mag')?.translation;
      if (anchor) {
        const inside = anchor.every((v, i) => v >= mn[i] - PIVOT_TOL && v <= mx[i] + PIVOT_TOL);
        if (!inside) fails.push('anchor_mag not at mag feed interface (reload pivot unusable)');
        stats.magPivotOk = inside;
        stats.magBounds = { min: mn, max: mx, meshNodes: meshIdxs.length, prims: primsSeen };
      }
    }
    }

  // --- bounds sanity (no stray unit cubes) ---
  try {
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of prims) {
      const { rows } = accessorFloats(gltf, bin, p.attributes.POSITION);
      for (const r of rows) for (let i = 0; i < 3; i++) {
        mn[i] = Math.min(mn[i], r[i]); mx[i] = Math.max(mx[i], r[i]);
      }
    }
    stats.bounds = { min: mn, max: mx };
    const B = GUNS[gun].bounds;
    // glTF axes: x=right, y=up, z=-forward. Length check runs on z.
    if (Math.max(Math.abs(mn[0]), Math.abs(mx[0])) > B.x) fails.push('stray X extent');
    if (mn[2] < -B.y[1] || mx[2] > -B.y[0]) fails.push('stray length (Z) extent');
    if (mn[1] < B.z[0] || mx[1] > B.z[1]) fails.push('stray height (Y) extent');
  } catch (e) {
    fails.push(`bounds read failed: ${e.message}`);
  }

  // --- UVs: present on every prim, finite, in [0,1] ---
  try {
    for (const p of prims) {
      if (p.attributes.TEXCOORD_0 === undefined) {
        fails.push('primitive without TEXCOORD_0');
        break;
      }
      const { rows } = accessorFloats(gltf, bin, p.attributes.TEXCOORD_0);
      for (const [u, v] of rows) {
        if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) {
          fails.push(`UV out of range [${u},${v}]`);
          break;
        }
      }
    }
  } catch (e) {
    fails.push(`UV read failed: ${e.message}`);
  }

  const ok = fails.length === 0 && (!strict || warns.length === 0);
  return { gun, path, ok, fails, warns: strict ? [] : warns, strictFails: strict ? warns : [], stats };
}

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? resolve(args[outIdx + 1]) : null;

const results = Object.keys(GUNS).map((g) => checkGun(g, strict));
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'} ${r.gun}: ${r.stats ? `${r.stats.tris} tris, ${r.stats.draws} draws, ${r.stats.materials.length} mats, ${r.stats.images.length} tex` : 'no asset'}`);
  for (const f of [...r.fails, ...(r.strictFails ?? [])]) console.log(`  - ${f}`);
  for (const w of r.warns ?? []) console.log(`  ~ warn: ${w}`);
}
if (outPath) writeFileSync(outPath, JSON.stringify({ strict, results }, null, 1));
const missing = results.some((r) => r.fails.some((f) => f.startsWith('ASSETS_MISSING')));
if (missing) console.log('ROSTER_HEROES: source-only — no GLBs built yet; run the Blender recipe first.');
process.exit(results.every((r) => r.ok) ? 0 : missing ? 2 : 1);
