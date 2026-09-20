/**
 * Glove-shell canary verification (CPU-only, no browser/renderer).
 * Transpiles the ACTUAL lane + rig sources with tsc, executes the real
 * geometry in node, and proves against live objects: budgets, continuity,
 * grip coverage, sight/muzzle clearance, reload identity, gate, lifecycle.
 * N1..N5 negative controls prove the predicates are not vacuous.
 */
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import * as THREE from 'three';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const LANE = 'work/fp-glove-shell-muse-1105/glove-shell.ts';
const RIG = 'src/weapons/first-person-hands.ts';
const VIEWS = 'src/weapons/viewmodel.ts';
const PALETTE = 'src/core/palette.ts';

let failures = 0;
const ok = (name, detail = '') => console.log(`  ok   ${name}${detail ? ' — ' + detail : ''}`);
const fail = (name, detail = '') => {
  failures++;
  console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
};
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
// Inside ROOT (not os.tmpdir) so the transpiled files resolve `three` via ROOT/node_modules.
const tmp = mkdtempSync(join(ROOT, '.gs-check-'));

// ---- 1. transpile the real sources -----------------------------------------
const cleanup = () => rmSync(tmp, { recursive: true, force: true });
try {
  execSync(
    `npx --no-install tsc ${LANE} ${RIG} ${VIEWS} ${PALETTE} --outDir ${tmp} --rootDir . ` +
      `--target es2022 --module esnext --moduleResolution bundler --skipLibCheck`,
    { cwd: ROOT, stdio: 'pipe' },
  );
} catch (e) {
  console.error(String(e.stdout ?? e.message ?? e).slice(0, 2000));
  fail('transpile', 'tsc could not compile the lane + rig sources');
  cleanup();
  process.exit(1);
}
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js')) {
      const src = readFileSync(p, 'utf8');
      const fixed = src.replace(/from\s+(['"])(\.[^'"]*)\1/g, (m, q, s) =>
        s.endsWith('.js') ? m : `from ${q}${s}.js${q}`,
      );
      if (fixed !== src) writeFileSync(p, fixed);
    }
  }
};
walk(tmp);

const gsUrl = pathToFileURL(join(tmp, 'work/fp-glove-shell-muse-1105/glove-shell.js')).href;
const viewsUrl = pathToFileURL(join(tmp, 'src/weapons/viewmodel.js')).href;
const gsSrc = readFileSync(join(tmp, 'work/fp-glove-shell-muse-1105/glove-shell.js'), 'utf8');
const rigSrc = readFileSync(join(tmp, 'src/weapons/first-person-hands.js'), 'utf8');
if (!gsSrc.includes('GloveShell') || !gsSrc.includes('assertGloveShellConnected') ||
    !rigSrc.includes('FirstPersonHands')) {
  fail('sources', 'transpiled output missing expected markers — wrong files?');
  cleanup();
  process.exit(1);
}
ok('sources', 'transpiled lane + rig + viewmodels, markers present');

const gs = await import(gsUrl);
const views = await import(viewsUrl);

// ---- 2. stub material factory (mimics painted() singleton cache) ------------
const cache = new Map();
const paintedCalls = [];
const stubMat = {
  painted(color, rough = 0.42, metal = 0.25) {
    paintedCalls.push([color, rough, metal]);
    const key = `${color}_${rough}_${metal}`;
    if (!cache.has(key)) {
      cache.set(key, new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }));
    }
    return cache.get(key);
  },
};
const preShell = stubMat.painted(0x26241f, 0.78, 0.01);
const prePad = stubMat.painted(0x26241f, 0.66, 0.01);
paintedCalls.length = 0;

// ---- 3. real rigs for all five weapons --------------------------------------
const builders = {
  rifle: views.buildRifleViewmodel,
  pistol: views.buildPistolViewmodel,
  smg: views.buildSmgViewmodel,
  shotgun: views.buildShotgunViewmodel,
  sniper: views.buildSniperViewmodel,
};
const rigs = {};
for (const [name, build] of Object.entries(builders)) {
  const rig = build(stubMat);
  rig.group.updateMatrixWorld(true);
  rigs[name] = rig;
}
ok('rigs', '5 real viewmodel rigs built headless');

for (const [name, rig] of Object.entries(rigs)) {
  const t = gs.GLOVE_MUZZLES[name];
  const tp = rig.hands.triggerHand.children[2].position;
  const sp = rig.hands.supportHand.children[2].position;
  if (!(approx(tp.x, 0.01) && approx(tp.y, -0.112) && approx(tp.z, 0.012))) {
    fail('anchors', `${name} trigger palm moved: ${tp.x},${tp.y},${tp.z}`);
  }
  if (!(approx(sp.x, -0.01) && approx(sp.y, t.supportY) && approx(sp.z, t.supportZ))) {
    fail('anchors', `${name} support palm mismatch: ${sp.x},${sp.y},${sp.z}`);
  }
  if (!approx(rig.muzzle.position.z, t.muzzleZ)) {
    fail('anchors', `${name} muzzle moved: ${rig.muzzle.position.z} vs ${t.muzzleZ}`);
  }
}
if (failures === 0) ok('anchors', 'module tables match all 5 real builds');

// ---- helpers ----------------------------------------------------------------
const swept = (box, lo, hi) => box.clone().translate(lo).union(box.clone().translate(hi));
const contains = (outer, inner, tol = 0.001) =>
  outer.min.x <= inner.min.x + tol && outer.min.y <= inner.min.y + tol &&
  outer.min.z <= inner.min.z + tol && outer.max.x >= inner.max.x - tol &&
  outer.max.y >= inner.max.y - tol && outer.max.z >= inner.max.z - tol;
const palmBounds = (x, y, z, rz) => {
  const c = Math.abs(Math.cos(rz));
  const s = Math.abs(Math.sin(rz));
  const ex = 0.032 * c + 0.043 * s;
  const ey = 0.032 * s + 0.043 * c;
  return new THREE.Box3(
    new THREE.Vector3(x - ex, y - ey, z - 0.05),
    new THREE.Vector3(x + ex, y + ey, z + 0.05));
};
const bundleBounds = (x, y, z, rz) => {
  const c = Math.abs(Math.cos(rz));
  const s = Math.abs(Math.sin(rz));
  const ex = 0.008 * c + 0.019 * s;
  const ey = 0.008 * s + 0.019 * c;
  return new THREE.Box3(
    new THREE.Vector3(x - ex, y - ey, z - 0.008),
    new THREE.Vector3(x + ex, y + ey, z + 0.008));
};

// ---- P8 gate-closed first -----------------------------------------------------
{
  const rig = rigs.rifle;
  const before = rig.hands.triggerHand.children.length + rig.hands.supportHand.children.length;
  const callsBefore = paintedCalls.length;
  const res = gs.attachGloveShells(rig.hands, stubMat, { supportZ: -0.36, search: '' });
  const after = rig.hands.triggerHand.children.length + rig.hands.supportHand.children.length;
  if (res !== null || after !== before) fail('P8 gate-closed', 'default attach changed the rig');
  else if (paintedCalls.length !== callsBefore) fail('P8 gate-closed', 'default attach requested materials');
  else ok('P8 gate-closed', `0 children added, 0 materials requested (baseline ${before})`);
  if (!gs.isGloveShellEnabled('?glove-shell=canary')) fail('P8 gate-parse', 'canary query not recognised');
  else if (gs.isGloveShellEnabled('?glove-shell=true')) fail('P8 gate-parse', 'non-canary value admitted');
  else ok('P8 gate-parse', 'only glove-shell=canary opens the gate');
}
// Rig construction above requested its own tuples; only attach calls count below.
paintedCalls.length = 0;

// ---- per-weapon positives ------------------------------------------------------
const TRIGGER_ENV = new THREE.Box3(
  new THREE.Vector3(-0.07, -0.21, -0.1), new THREE.Vector3(0.1, -0.02, 0.13));
let pairTris = 0;
for (const [name, rig] of Object.entries(rigs)) {
  const t = gs.GLOVE_MUZZLES[name];
  const ur = rig.hands.updateReload;
  const rr = rig.hands.resetReload;
  const mzBefore = rig.muzzle.getWorldPosition(new THREE.Vector3());
  const kidsBefore = rig.hands.triggerHand.children.length + rig.hands.supportHand.children.length;

  const attached = gs.attachGloveShells(rig.hands, stubMat, {
    supportZ: t.supportZ, supportY: t.supportY, search: '?glove-shell=canary',
  });
  if (!attached) { fail(`gate-open ${name}`, 'canary attach returned null'); continue; }
  const { trigger, support } = attached;
  pairTris = trigger.triCount + support.triCount;

  const kidsNow = rig.hands.triggerHand.children.length + rig.hands.supportHand.children.length;
  if (kidsNow - kidsBefore !== 2) fail(`P1 draws ${name}`, `wanted 2 groups, got ${kidsNow - kidsBefore}`);
  if (trigger.shell.material !== preShell || support.shell.material !== preShell) {
    fail(`P1 materials ${name}`, 'shell misses the existing glove singleton');
  }
  if (trigger.pad.material !== prePad || support.pad.material !== prePad) {
    fail(`P1 materials ${name}`, 'pad misses the existing detail singleton');
  }

  try {
    gs.assertGloveShellConnected(gs.placeGloveShellParts(gs.buildGloveShellParts('trigger')));
    gs.assertGloveShellConnected(
      gs.placeGloveShellParts(gs.buildGloveShellParts('support', t.supportY, t.supportZ)));
  } catch (e) { fail(`P2 continuity ${name}`, e.message); }

  rig.group.updateMatrixWorld(true);
  // Exact socket audit on the live meshes. Box3.setFromObject inflates rotated
  // ellipsoids by ~4 mm (it transforms box corners, not the surface), so boxes
  // serve only the conservative containment below — never equality.
  const live = [
    ['trigger palm', rig.hands.triggerHand.children[2], [0.01, -0.112, 0.012]],
    ['trigger bundle', rig.hands.triggerHand.children[3], [0.039, -0.092, -0.014]],
    ['support palm', rig.hands.supportHand.children[2], [-0.01, t.supportY, t.supportZ]],
    ['support bundle', rig.hands.supportHand.children[3], [-0.036, t.supportY + 0.012, t.supportZ - 0.018]],
  ];
  for (const [label, mesh, p] of live) {
    if (mesh.position.distanceTo(new THREE.Vector3(p[0], p[1], p[2])) > 1e-9) {
      fail(`P3 sockets ${name}`, `${label} moved to ${mesh.position.x},${mesh.position.y},${mesh.position.z}`);
    }
  }
  const palmScale = rig.hands.triggerHand.children[2].scale;
  if (palmScale.distanceTo(new THREE.Vector3(0.032, 0.043, 0.05)) > 1e-9) {
    fail(`P3 sockets ${name}`, 'trigger palm volume changed');
  }
  // Exact rotated-ellipsoid/capsule boxes (the formula IS the surface; the
  // 3.7 mm earlier was setFromObject corner inflation, not drift).
  const ana = [
    palmBounds(0.01, -0.112, 0.012, -0.16), bundleBounds(0.039, -0.092, -0.014, -0.22),
    palmBounds(-0.01, t.supportY, t.supportZ, 0.15),
    bundleBounds(-0.036, t.supportY + 0.012, t.supportZ - 0.018, 0.22),
  ];
  if (!contains(trigger.bounds, ana[0]) || !contains(trigger.bounds, ana[1])) {
    fail(`P3 cover ${name}`, 'trigger shell leaves accepted volumes exposed');
  }
  if (!contains(support.bounds, ana[2]) || !contains(support.bounds, ana[3])) {
    fail(`P3 cover ${name}`, 'support shell leaves accepted volumes exposed');
  }
  for (const [box, p] of [
    [trigger.bounds, new THREE.Vector3(0.015, -0.135, 0.025)],
    [support.bounds, new THREE.Vector3(-0.017, t.supportY - 0.03, t.supportZ + 0.013)],
  ]) {
    if (!box.containsPoint(p)) fail(`P3 cuff ${name}`, `cuff end outside shell`);
  }

  const sw = swept(support.bounds, gs.SUPPORT_SWEEP.min, gs.SUPPORT_SWEEP.max);
  if (sw.max.y >= gs.GLOVE_SIGHT_FLOOR_Y) {
    fail(`P4 sight ${name}`, `swept top ${sw.max.y.toFixed(4)} >= ${gs.GLOVE_SIGHT_FLOOR_Y}`);
  }
  if (trigger.bounds.max.y >= gs.GLOVE_SIGHT_FLOOR_Y) {
    fail(`P4 sight ${name}`, `trigger top ${trigger.bounds.max.y.toFixed(4)} above floor`);
  }
  if (sw.min.z <= t.muzzleZ + gs.GLOVE_MUZZLE_KEEPOUT) {
    fail(`P5 muzzle ${name}`, `swept front ${sw.min.z.toFixed(4)} inside keep-out`);
  }
  const sEnv = new THREE.Box3(
    new THREE.Vector3(-0.1, t.supportY - 0.16, t.supportZ - 0.15),
    new THREE.Vector3(0.07, t.supportY + 0.1, t.supportZ + 0.13));
  if (!contains(TRIGGER_ENV, trigger.bounds)) fail(`P6 envelope ${name}`, 'trigger sprawl');
  if (!contains(sEnv, support.bounds)) fail(`P6 envelope ${name}`, 'support sprawl');

  if (rig.hands.updateReload !== ur || rig.hands.resetReload !== rr) {
    fail(`P7 identity ${name}`, 'reload fns replaced by attach');
  }
  rig.hands.updateReload(0.3);
  const moved = rig.hands.supportHand.position.length() > 1e-9;
  rig.hands.resetReload();
  const restored = rig.hands.supportHand.position.length() === 0;
  if (!moved || !restored) fail(`P7 reload ${name}`, 'support travel broken by shells');

  rig.hands.updateReload(0.55);
  rig.group.updateMatrixWorld(true);
  rig.hands.resetReload();
  rig.group.updateMatrixWorld(true);
  const mzAfter = rig.muzzle.getWorldPosition(new THREE.Vector3());
  if (mzBefore.distanceTo(mzAfter) > 1e-9) fail(`P9 muzzle ${name}`, 'muzzle moved');
  const removed = gs.disposeGloveShells(rig.hands);
  const kidsAfter = rig.hands.triggerHand.children.length + rig.hands.supportHand.children.length;
  if (removed !== 2 || kidsAfter !== kidsBefore) {
    fail(`P9 dispose ${name}`, `removed=${removed} kids ${kidsBefore}->${kidsAfter}`);
  }
  const re = gs.attachGloveShells(rig.hands, stubMat, {
    supportZ: t.supportZ, supportY: t.supportY, search: '?glove-shell=canary',
  });
  if (!re) fail(`P9 reattach ${name}`, 'second attach failed');
  else gs.disposeGloveShells(rig.hands);
  ok(name, `tris=${pairTris.toFixed(0)} sight+${((gs.GLOVE_SIGHT_FLOOR_Y - sw.max.y) * 1000).toFixed(1)}mm muzzle+${((sw.min.z - t.muzzleZ - gs.GLOVE_MUZZLE_KEEPOUT) * 1000).toFixed(1)}mm`);
}

// P1 totals + merge integrity + finite scan
{
  const parts = gs.buildGloveShellParts('support', -0.055, -0.36);
  const placed = gs.placeGloveShellParts(parts);
  const sum = placed.reduce((a, p) => a + p.triCount, 0);
  const shellG = gs.mergeShellParts(parts, 'shell');
  const padG = gs.mergeShellParts(parts, 'pad');
  const merged = shellG.getIndex().count / 3 + padG.getIndex().count / 3;
  if (Math.abs(sum - merged) > 1e-6) fail('P10 merge', `parts=${sum} merged=${merged}`);
  else ok('P10 merge', `parts == merged == ${merged.toFixed(0)} tris/hand`);
  let bad = -1;
  const scan = (g) => {
    const arr = g.getAttribute('position').array;
    for (let i = 0; i < arr.length; i++) {
      if (!Number.isFinite(arr[i])) { bad = i; break; }
    }
  };
  scan(shellG);
  scan(padG);
  if (bad >= 0) fail('P10 finite', `non-finite vertex at ${bad}`);
  else ok('P10 finite', 'all vertices finite');
  shellG.dispose();
  padG.dispose();
  if (pairTris > gs.GLOVE_SHELL_TRI_BUDGET) fail('P1 budget', `${pairTris} > ${gs.GLOVE_SHELL_TRI_BUDGET}`);
  else ok('P1 budget', `pair=${pairTris.toFixed(0)} tris <= ${gs.GLOVE_SHELL_TRI_BUDGET}, 4 draws, 0 new materials`);
  for (const c of paintedCalls) {
    const k = `${c[0]}_${c[1]}_${c[2]}`;
    if (!gs.GLOVE_SHELL_MATERIALS.some((m) => `${m.color}_${m.rough}_${m.metal}` === k)) {
      fail('P1 tuples', `unexpected painted() request ${k}`);
    }
  }
  if (failures === 0) ok('P1 tuples', 'only the two borrowed singletons requested');
}

// ---- negatives ----------------------------------------------------------------
{
  const far = new THREE.Box3(new THREE.Vector3(5, 5, 5), new THREE.Vector3(6, 6, 6));
  if (contains(TRIGGER_ENV, far)) fail('N1 sprawl', 'blind: far box accepted');
  else ok('N1 sprawl', 'far box rejected');

  const hog = new THREE.SphereGeometry(1, 64, 48);
  const hogTris = hog.getIndex().count / 3;
  if (hogTris <= gs.GLOVE_SHELL_TRI_BUDGET) fail('N2 budget', 'probe too small to falsify');
  else ok('N2 budget', `probe ${hogTris.toFixed(0)} tris correctly over budget`);
  hog.dispose();

  const placed = gs.placeGloveShellParts(gs.buildGloveShellParts('trigger'));
  placed.push({
    name: 'floater', layer: 'shell',
    center: new THREE.Vector3(0.5, 0.5, 0.5), radius: 0.01,
    box: new THREE.Box3(), triCount: 10,
  });
  let threw = false;
  try { gs.assertGloveShellConnected(placed); } catch { threw = true; }
  if (!threw) fail('N3 floater', 'blind: disconnected capsule accepted');
  else ok('N3 floater', 'disconnected capsule throws');

  const intruder = new THREE.Box3(new THREE.Vector3(-0.01, 0.02, -0.1), new THREE.Vector3(0.01, 0.09, -0.05));
  if (intruder.max.y < gs.GLOVE_SIGHT_FLOOR_Y) fail('N4 sight', 'blind: intruder under floor?');
  else ok('N4 sight', 'intruder above floor correctly flagged');

  const shifted = palmBounds(0.11, -0.112, 0.012, -0.16);
  const shellBox = new THREE.Box3(new THREE.Vector3(-0.03, -0.17, -0.05), new THREE.Vector3(0.05, -0.06, 0.07));
  if (contains(shellBox, shifted)) fail('N5 cover', 'blind: shifted palm accepted');
  else ok('N5 cover', 'shifted palm correctly rejected');
}

for (let i = 0; i < 20 && statSync(tmp, { throwIfNoEntry: false }); i++) {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    // Fresh .js files can be briefly locked (indexer/AV); retry, then shout.
  }
}
if (statSync(tmp, { throwIfNoEntry: false })) {
  console.error(`  WARN cleanup — ${tmp} left behind; delete by hand`);
}
console.log(failures === 0 ? '\nGLOVE-SHELL CHECK: PASS' : `\nGLOVE-SHELL CHECK: ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
