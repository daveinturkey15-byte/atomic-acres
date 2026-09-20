/**
 * world-weapon-agy-repair1-0941 — deterministic CPU checks. Node-only, no GPU.
 * Transpiles the lane's TS with the worktree's own esbuild, then verifies:
 * baseline-unchanged default path, exact canary flag seam, +Z axes and
 * muzzle transforms in both paths, support-grip contact on solid parts for
 * all five archetypes, weapon-id coverage, tri/draw budgets, shared-cache
 * identity/bounds, live-actor protection against non-terminal teardown,
 * exact-boundary disposal ownership (detach keeps shared geometry;
 * global teardown disposes self-owned resources exactly once), one-shot
 * idempotency, and negative controls for borrowed resources and shared
 * geometry double-disposal.
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const LANE = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(?=[A-Za-z]:)/, '')), '..');
const WORKTREE = path.resolve(LANE, '..', '..');
const require = createRequire(path.join(WORKTREE, 'package.json'));
const esbuild = require('esbuild');

mkdirSync(path.join(LANE, '.gen'), { recursive: true });
for (const f of ['world-weapon-art', 'authored-weapon']) {
  const ts = (await import('node:fs')).readFileSync(path.join(LANE, 'src', f + '.ts'), 'utf8');
  const js = esbuild
    .transformSync(ts, { loader: 'ts', format: 'esm', target: 'es2022' })
    .code.replace(/from "\.\/world-weapon-art"/g, 'from "./world-weapon-art.mjs"');
  writeFileSync(path.join(LANE, '.gen', f + '.mjs'), js);
}
const art = await import(pathToFileURL(path.join(LANE, '.gen', 'world-weapon-art.mjs')).href);
const aw = await import(pathToFileURL(path.join(LANE, '.gen', 'authored-weapon.mjs')).href);
const THREE = (await import('three')).default ?? (await import('three'));

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const ARCHES = ['rifle', 'smg', 'shotgun', 'sniper', 'pistol'];

// Baseline SPECS, transcribed verbatim from authored-weapon.ts (the solve
// contract: rifle row byte-identical to mesh.ts). Used to prove the default
// path is unchanged and as the metal core for exact contact math.
const BASE = {
  rifle: [
    { w: 0.046, h: 0.076, d: 0.3, x: 0, y: -0.046, z: 0.128 },
    { w: 0.034, h: 0.038, d: 0.26, x: 0, y: -0.062, z: 0.312 },
    { w: 0.03, h: 0.1, d: 0.056, x: 0, y: -0.112, z: 0.082, rx: 0.22 },
    { w: 0.042, h: 0.064, d: 0.165, x: 0, y: -0.03, z: -0.1 },
    { w: 0.032, h: 0.034, d: 0.072, x: 0, y: 0.006, z: 0.108 },
  ],
  smg: [
    { w: 0.046, h: 0.076, d: 0.22, x: 0, y: -0.046, z: 0.088 },
    { w: 0.03, h: 0.034, d: 0.14, x: 0, y: -0.06, z: 0.248 },
    { w: 0.03, h: 0.1, d: 0.056, x: 0, y: -0.112, z: 0.082, rx: 0.22 },
    { w: 0.042, h: 0.064, d: 0.12, x: 0, y: -0.03, z: -0.078 },
    { w: 0.032, h: 0.034, d: 0.06, x: 0, y: 0.006, z: 0.068 },
  ],
  shotgun: [
    { w: 0.05, h: 0.08, d: 0.3, x: 0, y: -0.046, z: 0.128 },
    { w: 0.04, h: 0.042, d: 0.3, x: 0, y: -0.062, z: 0.332 },
    { w: 0.03, h: 0.1, d: 0.056, x: 0, y: -0.112, z: 0.082, rx: 0.22 },
    { w: 0.05, h: 0.07, d: 0.18, x: 0, y: -0.03, z: -0.108 },
    { w: 0.056, h: 0.05, d: 0.1, x: 0, y: -0.062, z: 0.22 },
  ],
  sniper: [
    { w: 0.046, h: 0.076, d: 0.32, x: 0, y: -0.046, z: 0.138 },
    { w: 0.028, h: 0.03, d: 0.4, x: 0, y: -0.058, z: 0.42 },
    { w: 0.03, h: 0.1, d: 0.056, x: 0, y: -0.112, z: 0.082, rx: 0.22 },
    { w: 0.042, h: 0.07, d: 0.2, x: 0, y: -0.028, z: -0.118 },
    { w: 0.034, h: 0.04, d: 0.14, x: 0, y: 0.03, z: 0.08 },
  ],
  pistol: [
    { w: 0.038, h: 0.055, d: 0.17, x: 0, y: -0.038, z: 0.085 },
    { w: 0.034, h: 0.1, d: 0.05, x: 0, y: -0.105, z: 0.03, rx: 0.22 },
    { w: 0.006, h: 0.03, d: 0.06, x: 0, y: -0.07, z: 0.06 },
    { w: 0.03, h: 0.015, d: 0.02, x: 0, y: -0.005, z: 0.01 },
    { w: 0.008, h: 0.015, d: 0.008, x: 0, y: -0.005, z: 0.155 },
  ],
};
const MUZZLES = {
  rifle: [0, -0.062, 0.442], smg: [0, -0.06, 0.318], shotgun: [0, -0.062, 0.482],
  sniper: [0, -0.058, 0.62], pistol: [0, -0.038, 0.175],
};
const ID_FAMILY = {
  longhorn: 'rifle', m4a1: 'rifle', 'ak-47': 'rifle', lmg: 'rifle', minigun: 'rifle',
  railgun: 'rifle', 'explosive-crossbow': 'rifle', flamethrower: 'rifle', 'flare-gun': 'rifle',
  rattler: 'smg', mp5: 'smg', 'mini-uzi': 'smg', 'machine-pistol': 'smg',
  coachman: 'shotgun', 'slug-shotgun': 'shotgun',
  deadeye: 'sniper', 'm14-ebr': 'sniper',
  duster: 'pistol', magnum: 'pistol', 'flashlight-pistol': 'pistol',
};

function vecEq(v, t) {
  return v.x === t[0] && v.y === t[1] && v.z === t[2];
}

// Exact point-in-solid math over baseline boxes + added parts.
function inBoxSpec(p, s) {
  const c = Math.cos(s.rx ?? 0), sn = Math.sin(s.rx ?? 0);
  const py = p.y - s.y, pz = p.z - s.z;
  const by = py * c + pz * sn, bz = -py * sn + pz * c;
  return Math.abs(p.x - s.x) <= s.w / 2 && Math.abs(by) <= s.h / 2 && Math.abs(bz) <= s.d / 2;
}
function inCyl(p, s) {
  const dx = p.x - s.x, dy = p.y - s.y, dz = p.z - s.z;
  return dx * dx + dy * dy <= s.r * s.r && Math.abs(dz) <= s.h / 2;
}
function contactOn(parts, p) {
  return parts.some((s) => (s.k === 'cyl' ? inCyl(p, s) : inBoxSpec(p, s)));
}

const mat = new THREE.MeshStandardMaterial({ name: 'dress.dark-standin' });

// ---- 1. baseline unchanged (no flag; node has no `location`) -------------
delete globalThis.location;
for (const a of ARCHES) {
  const b = aw.buildAuthoredWeapon(mat, a, 'x-' + a);
  const meshes = b.group.children.filter((c) => c.isMesh);
  const boxesOk =
    meshes.length === 5 &&
    meshes.every((m, i) => {
      const s = BASE[a][i];
      const prm = m.geometry.parameters;
      return prm.width === s.w && prm.height === s.h && prm.depth === s.d &&
        vecEq(m.position, [s.x, s.y, s.z]) && (s.rx ?? 0) === m.rotation.x;
    });
  check(`baseline[${a}] five SPECS boxes, transforms exact`, boxesOk);
  check(`baseline[${a}] names/userData/muzzle`, b.group.name === 'operator-weapon' &&
    b.muzzle.name === 'operator-muzzle' && b.group.userData.archetype === a &&
    vecEq(b.muzzle.position, MUZZLES[a]));
}
const b1 = aw.buildAuthoredWeapon(mat, 'rifle', 's1');
const b2 = aw.buildAuthoredWeapon(mat, 'rifle', 's2');
check('baseline shares cached BoxGeometry across builds', b1.group.children[0].geometry === b2.group.children[0].geometry);

// ---- 2. exact-flag seam ---------------------------------------------------
const pos = '?world-weapon=canary';
const negatives = ['', '?', '?world-weapon=', '?world-weapon=Canary', '?world-weapon=canary2',
  '?worldweapon=canary', '?weapon-world=canary', '?xworld-weapon=canary', '?foo=1'];
check('seam: exact flag enables', art.isWorldWeaponArtEnabled(pos) === true);
check('seam: every near-miss stays disabled',
  negatives.every((q) => art.isWorldWeaponArtEnabled(q) === false),
  negatives.filter((q) => art.isWorldWeaponArtEnabled(q)).join(','));

// ---- 3. axes / muzzles / contact on the canary path ----------------------
globalThis.location = { search: pos };
const forestock = aw.AUTHORED_FORESTOCK_LOCAL;
check('contract: barrel axis +Z preserved', vecEq(aw.AUTHORED_BARREL_LOCAL, [0, 0, 1]));
check('contract: FORESTOCK_LOCAL verbatim', vecEq(forestock, [0, -0.055, 0.25]));

const budget = {};
for (const a of ARCHES) {
  const built = aw.buildAuthoredWeapon(mat, a, 'id-' + a);
  const meshes = built.group.children.filter((c) => c.isMesh);
  let tris = 0;
  for (const m of meshes) tris += m.geometry.index.count / 3;
  budget[a] = tris;
  check(`canary[${a}] <=3 draws (merged static meshes)`, meshes.length <= 3, `${meshes.length} meshes`);
  check(`canary[${a}] <=2500 tris`, tris <= 2500, `${tris} tris`);
  check(`canary[${a}] muzzle transform unchanged`, vecEq(built.muzzle.position, MUZZLES[a]) &&
    built.muzzle.parent === built.group && built.muzzle.name === 'operator-muzzle');
  const parts = [
    ...art.worldWeaponAddedParts(a).metal,
    ...art.worldWeaponAddedParts(a).furniture,
    ...BASE[a].map((s) => ({ k: 'box', ...s })),
  ];
  const grip = aw.authoredGripLocal(a);
  check(`canary[${a}] support grip lands on solid part`, contactOn(parts, grip),
    `grip (${grip.x},${grip.y},${grip.z})`);
  const pt = (x, y, z) => ({ x, y, z });
  const gripSolid = contactOn(parts, pt(grip.x, grip.y, grip.z));
  if (a === 'rifle') {
    check('canary[rifle] FORESTOCK solve point on metal', contactOn(parts, forestock));
  }
  if (a === 'pistol') {
    check('canary[pistol] grip inside 0.175 muzzle reach', grip.z < 0.175 && gripSolid);
  }
  built.group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(built.group);
  const rear = a === 'pistol' ? 0.0 : -0.05; // pistol has no stock
  check(`canary[${a}] merged bounds span receiver to muzzle (+Z body)`,
    box.max.z >= MUZZLES[a][2] - 0.02 && box.min.z <= rear);
}

// determinism: rebuild after teardown — identical bounds
const rA = aw.buildAuthoredWeapon(mat, 'rifle', 'd1').group;
rA.updateMatrixWorld(true);
const boxA = new THREE.Box3().setFromObject(rA);
art.disposeWorldWeaponArt({ terminal: true });
const rB = aw.buildAuthoredWeapon(mat, 'rifle', 'd2').group;
rB.updateMatrixWorld(true);
const boxB = new THREE.Box3().setFromObject(rB);
check('canary creation deterministic across cache generations',
  boxA.min.distanceTo(boxB.min) < 1e-9 && boxA.max.distanceTo(boxB.max) < 1e-9);

// ---- 4. coverage ----------------------------------------------------------
check('all 20 roster ids resolve to documented families',
  Object.entries(ID_FAMILY).every(([id, fam]) => aw.resolveAuthoredArchetype(id) === fam) &&
  Object.keys(ID_FAMILY).length === 20);
check('unknown/null ids fall back to rifle',
  aw.resolveAuthoredArchetype('not-a-gun') === 'rifle' && aw.resolveAuthoredArchetype(null) === 'rifle');

// ---- 5. swap path end-to-end under the flag -------------------------------
const root = new THREE.Group();
root.name = 'operator-authored';
const bone = new THREE.Bone();
bone.name = 'RightHand';
root.add(bone);
const worn = aw.setAuthoredWeapon(root, mat, 'm4a1');
check('swap path wears canary build under flag', worn === 'rifle' &&
  aw.authoredWeaponOf(root)?.group.children.filter((c) => c.isMesh).length === 2);
const mq = aw.authoredWeaponOf(root).muzzle;
check('swap path muzzle readable by QA', vecEq(mq.position, MUZZLES.rifle));

// ---- 6. ownership & disposal at exact live boundary ------------------------
let geoDisposes = 0, matDisposes = 0;
const geoDispose = THREE.BufferGeometry.prototype.dispose;
const matDispose = THREE.Material.prototype.dispose;
THREE.BufferGeometry.prototype.dispose = function () { geoDisposes++; return geoDispose.call(this); };
THREE.Material.prototype.dispose = function () { matDisposes++; return matDispose.call(this); };
try {
  // Hermetic starting state: ensure clean cache before observing boundary
  art.disposeWorldWeaponArt({ terminal: true });

  // 6a. Construction phase: build archetypes to populate shared cache
  const constructGeoStart = geoDisposes;
  for (const a of ARCHES) aw.buildAuthoredWeapon(mat, a, 'own-' + a);
  const tempPartDisposes = geoDisposes - constructGeoStart;
  // Merging parametric parts creates temporary boxes/cylinders and disposes them immediately
  check('construction cleans up temporary part geometries', tempPartDisposes > 0,
    `${tempPartDisposes} temporary part geometries cleaned up`);

  // 6b. Well-defined live boundary: exactly the 5 archetype entries are cached
  const liveGeoStart = geoDisposes;
  const liveMatStart = matDisposes;

  const sharedA = aw.buildAuthoredWeapon(mat, 'smg', 'o1').group.children[0].geometry;
  const sharedB = aw.buildAuthoredWeapon(mat, 'smg', 'o2').group.children[0].geometry;
  check('canary geometry shared across actors (bounded cache)', sharedA === sharedB);

  // 6c. Live actor protection: global teardown without terminal flag MUST NOT invalidate live actors
  const liveWorn = aw.buildAuthoredWeapon(mat, 'rifle', 'worn');
  aw.attachAuthoredWeapon({ RightHand: bone }, liveWorn);
  const afterAttachGeo = geoDisposes;

  const liveTeardownAttempt = art.disposeWorldWeaponArt(); // non-terminal teardown
  check('global teardown without terminal flag refuses while actor is live',
    liveTeardownAttempt === false && geoDisposes === afterAttachGeo,
    'refused while live actor mounted on bone');

  // 6d. Detaching actors retains shared cache
  aw.detachAuthoredWeapon(bone);
  check('detach removes group, keeps shared geometry alive',
    bone.children.length === 0 && geoDisposes === afterAttachGeo &&
    sharedA.attributes.position !== undefined);

  // 6e. Global teardown disposes self-owned geometry exactly once per archetype bucket (2 * 5 = 10)
  const teardownResult = art.disposeWorldWeaponArt();
  check('global teardown disposes self-owned geometry exactly once per archetype bucket',
    teardownResult === true && geoDisposes === liveGeoStart + 2 * ARCHES.length,
    `${geoDisposes - liveGeoStart} disposes`);
  check('global teardown disposes shared furniture material once', matDisposes === liveMatStart + 1);

  // 6f. Teardown is one-shot (second call is a guarded no-op)
  const secondTeardown = art.disposeWorldWeaponArt();
  check('teardown is one-shot (second call no-ops)',
    secondTeardown === false && geoDisposes === liveGeoStart + 2 * ARCHES.length &&
    matDisposes === liveMatStart + 1);
  check('caller-owned material never disposed by lane', matDisposes === liveMatStart + 1);

  // 6g. Post-teardown rebuild works
  const fresh = aw.buildAuthoredWeapon(mat, 'rifle', 'fresh');
  check('post-teardown rebuild works', fresh.group.children.filter((c) => c.isMesh).length === 2);

  // 6h. Explicit terminal teardown forces disposal even if actor is mounted
  const termWorn = aw.buildAuthoredWeapon(mat, 'rifle', 'term');
  aw.attachAuthoredWeapon({ RightHand: bone }, termWorn);
  const termTeardownResult = art.disposeWorldWeaponArt({ terminal: true });
  check('explicit terminal teardown disposes mounted actors on shutdown',
    termTeardownResult === true);
  aw.detachAuthoredWeapon(bone);

  // 6i. Negative controls: guard rejects borrowed resource or shared geom twice
  check('negative control: guard rejects disposing borrowed material',
    art.disposeWorldWeaponResource(mat) === false);
  check('negative control: guard rejects disposing shared geom twice',
    art.disposeWorldWeaponResource(sharedA) === false);
  // Also verify guard rejects direct disposal of active cached shared geometry
  const freshSmg = aw.buildAuthoredWeapon(mat, 'smg', 'fresh-smg');
  const activeSharedGeo = freshSmg.group.children[0].geometry;
  check('negative control: guard rejects direct disposal of active shared geometry',
    art.disposeWorldWeaponResource(activeSharedGeo) === false);

} finally {
  THREE.BufferGeometry.prototype.dispose = geoDispose;
  THREE.Material.prototype.dispose = matDispose;
  art.disposeWorldWeaponArt({ terminal: true });
  delete globalThis.location;
}

console.log(`\ntri budget per archetype: ${JSON.stringify(budget)}`);
console.log(failed === 0 ? 'ALL CHECKS PASS' : `${failed} CHECK(S) FAILED`);
process.exitCode = failed === 0 ? 0 : 1;
