#!/usr/bin/env node
/**
 * CPU-only integration proof for the fitted hand-geometry canary.
 *
 * The viewmodel source remains the anchor authority. This verifier parses its
 * five createFirstPersonHands calls, compares them to the helper's exported
 * anchors, materializes every real hand through the candidate API, checks the
 * actual forearm endpoint matrices/positions, walks the existing reload curve,
 * and disposes the generated resources. No renderer, browser, or scene is
 * required.
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const HANDS_PATH = resolve(ROOT, 'src/weapons/first-person-hands.ts');
const CANARY_PATH = resolve(ROOT, 'src/weapons/hand-geometry-canary.ts');
const VIEWMODEL_PATH = resolve(ROOT, 'src/weapons/viewmodel.ts');
const SOURCE_CANARY_PATH = resolve(ROOT, '..', 'nuketown-muse-vehicle-20260919', 'src/weapons/hand-geometry-canary.ts');
const OUTFILE = join(tmpdir(), `nuketown-hand-integration-${process.pid}.mjs`);

const ENTRY = `
  import * as THREE from ${JSON.stringify(join(ROOT, 'node_modules/three'))};
  import { createFirstPersonHands } from ${JSON.stringify(HANDS_PATH)};
  import { buildCanarySideGeometries, materializeCanarySide, supportJointsFor, TRIGGER_SPEC, WEAPON_ANCHORS, CANARY_MAX_TRIANGLES, CANARY_MAX_MESHES } from ${JSON.stringify(CANARY_PATH)};
  export { THREE, createFirstPersonHands, buildCanarySideGeometries, materializeCanarySide, supportJointsFor, TRIGGER_SPEC, WEAPON_ANCHORS, CANARY_MAX_TRIANGLES, CANARY_MAX_MESHES };
`;

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const near = (actual, expected, tolerance, message) => assert(
  Math.abs(actual - expected) <= tolerance,
  `${message}: ${actual} != ${expected} (tol ${tolerance})`,
);
const parseVec = (source) => source.split(',').map((part) => Number(part.trim()));
const sameVec = (a, b, tolerance = 1e-12) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tolerance);
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'hand-integration.ts', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: OUTFILE,
  logLevel: 'warning',
});

try {
  const api = await import(pathToFileURL(OUTFILE).href);
  const viewmodelSource = readFileSync(VIEWMODEL_PATH, 'utf8');
  const baselineHands = execFileSync('git', ['-C', ROOT, 'show', 'HEAD:src/weapons/first-person-hands.ts'], { encoding: 'utf8' });
  assert(sha256(CANARY_PATH) === sha256(SOURCE_CANARY_PATH), 'candidate canary differs from supplied Muse source helper');

  // The current viewmodel builders are the live anchor authority. Keep this
  // parser deliberately mechanical so duplicated helper literals cannot drift
  // unnoticed in a future weapon builder.
  const callRe = /createFirstPersonHands\(group,\s*mat,\s*([-+]?\d*\.?\d+),\s*([-+]?\d*\.?\d+),\s*\[([^\]]+)\]\)/g;
  const calls = [...viewmodelSource.matchAll(callRe)].map((m) => ({
    supportZ: Number(m[1]),
    supportY: Number(m[2]),
    reloadTarget: parseVec(m[3]),
  }));
  assert(calls.length === api.WEAPON_ANCHORS.length, `viewmodel has ${calls.length} hand calls, helper has ${api.WEAPON_ANCHORS.length} anchors`);
  for (let i = 0; i < calls.length; i++) {
    const actual = calls[i];
    const expected = api.WEAPON_ANCHORS[i];
    near(actual.supportZ, expected.supportZ, 1e-12, `${expected.weapon}.supportZ`);
    near(actual.supportY, expected.supportY, 1e-12, `${expected.weapon}.supportY`);
    assert(sameVec(actual.reloadTarget, expected.reloadTarget), `${expected.weapon}.reloadTarget drift`);
  }

  // Trigger bind points are read from the accepted source, then compared to the
  // helper export. The candidate itself intentionally has no second literal.
  const triggerMatch = baselineHands.match(/sleeve,\s*\n\s*\[([^\]]+)\],\s*\[([^\]]+)\],/);
  assert(triggerMatch, 'accepted trigger sleeve anchors not found');
  near(parseVec(triggerMatch[1])[0], api.TRIGGER_SPEC.elbow[0], 1e-12, 'trigger elbow x');
  assert(sameVec(parseVec(triggerMatch[1]), api.TRIGGER_SPEC.elbow), 'trigger elbow drift');
  assert(sameVec(parseVec(triggerMatch[2]), api.TRIGGER_SPEC.wrist), 'trigger wrist drift');
  assert(baselineHands.includes('palm(glove, 0.010, -0.112, 0.012, -0.16)'), 'accepted trigger palm anchor missing');

  function materials() {
    const created = [];
    const make = (params) => {
      const material = new api.THREE.MeshBasicMaterial(params);
      created.push(material);
      return material;
    };
    return {
      viewmodel: {
        sleeve: make({ color: 0x777766 }),
        darkGlove: make({ color: 0x222222 }),
        gloveDetail: make({ color: 0x333333 }),
      },
      painted() { return make({ color: 0x444444 }); },
      created,
    };
  }

  function centroid(geometry, start, count) {
    const pos = geometry.getAttribute('position');
    const out = new api.THREE.Vector3();
    for (let i = 0; i < count; i++) {
      out.add(new api.THREE.Vector3().fromBufferAttribute(pos, start + i));
    }
    return out.multiplyScalar(1 / count);
  }

  function geometryStats(mesh, label, components = 1) {
    const geo = mesh.geometry;
    const pos = geo.getAttribute('position');
    const nor = geo.getAttribute('normal');
    const idx = geo.getIndex();
    assert(pos && nor && idx && idx.count > 0 && idx.count % 3 === 0, `${label}: invalid geometry attributes`);
    let minArea = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
      assert(p.every(Number.isFinite), `${label}: non-finite position @${i}`);
      const n = [nor.getX(i), nor.getY(i), nor.getZ(i)];
      assert(n.every(Number.isFinite), `${label}: non-finite normal @${i}`);
      near(Math.hypot(...n), 1, 1e-3, `${label}: normal length @${i}`);
    }
    for (let i = 0; i < idx.count; i += 3) {
      const a = new api.THREE.Vector3().fromBufferAttribute(pos, idx.getX(i));
      const b = new api.THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + 1));
      const c = new api.THREE.Vector3().fromBufferAttribute(pos, idx.getX(i + 2));
      minArea = Math.min(minArea, b.clone().sub(a).cross(c.clone().sub(a)).length() * 0.5);
    }
    assert(minArea > 1e-12, `${label}: degenerate triangle area ${minArea}`);
    if (components > 1) assert(pos.count % components === 0, `${label}: components not evenly packed`);
    return idx.count / 3;
  }

  const rows = [];
  for (let i = 0; i < api.WEAPON_ANCHORS.length; i++) {
    const anchor = api.WEAPON_ANCHORS[i];
    const m = materials();
    const parent = new api.THREE.Group();
    const rig = api.createFirstPersonHands(parent, m, anchor.supportZ, anchor.supportY, anchor.reloadTarget);
    const triggerForearm = rig.triggerHand.children.find((child) => child.name === 'TriggerForearm');
    assert(triggerForearm, `${anchor.weapon}: trigger forearm group missing from public hand hierarchy`);
    assert(rig.root.name === 'FirstPersonHands', `${anchor.weapon}: root name`);
    assert(rig.triggerHand.name === 'TriggerHand' && rig.supportHand.name === 'SupportHand', `${anchor.weapon}: hand group names`);
    assert(rig.supportForearm.name === 'SupportForearm', `${anchor.weapon}: support forearm name`);
    assert(rig.triggerHand.children.length === 5 && rig.supportHand.children.length === 5,
      `${anchor.weapon}: cuffs or canary hand meshes missing`);
    assert(triggerForearm.children.length === 1 && rig.supportForearm.children.length === 1,
      `${anchor.weapon}: forearm mesh count changed`);

    const triggerMesh = triggerForearm.children[0];
    const supportMesh = rig.supportForearm.children[0];
    const triggerEnd = centroid(triggerMesh.geometry, 1, 14);
    const triggerWrist = centroid(triggerMesh.geometry, 1 + 10 * 15, 14);
    near(triggerEnd.distanceTo(new api.THREE.Vector3(...api.TRIGGER_SPEC.elbow)), 0, 1e-3, `${anchor.weapon}: trigger elbow endpoint`);
    near(triggerWrist.distanceTo(new api.THREE.Vector3(...api.TRIGGER_SPEC.wrist)), 0, 1e-3, `${anchor.weapon}: trigger wrist endpoint`);
    const support = api.supportJointsFor(anchor);
    const supportEnd = centroid(supportMesh.geometry, 1, 14);
    const supportWrist = centroid(supportMesh.geometry, 1 + 10 * 15, 14);
    near(supportEnd.distanceTo(new api.THREE.Vector3(...support.elbow)), 0, 1e-3, `${anchor.weapon}: support elbow endpoint`);
    near(supportWrist.distanceTo(new api.THREE.Vector3(...support.wrist)), 0, 1e-3, `${anchor.weapon}: support wrist endpoint`);

    const sleeveMat = m.viewmodel.sleeve;
    const gloveMat = m.viewmodel.darkGlove;
    const allMeshes = [...triggerForearm.children, ...rig.triggerHand.children.filter((c) => c.isMesh), ...rig.supportForearm.children, ...rig.supportHand.children.filter((c) => c.isMesh)];
    let triangles = 0;
    for (const mesh of allMeshes) triangles += geometryStats(mesh, `${anchor.weapon}/${mesh.name || 'mesh'}`);
    assert(allMeshes.some((mesh) => mesh.material !== sleeveMat && mesh.material !== gloveMat), `${anchor.weapon}: expected cuff/detail material transition`);
    assert(triangles <= api.CANARY_MAX_TRIANGLES, `${anchor.weapon}: ${triangles} triangles over canary budget`);
    assert(allMeshes.length <= api.CANARY_MAX_MESHES, `${anchor.weapon}: ${allMeshes.length} meshes over canary budget`);

    const samples = [];
    for (const progress of [0, 0.14, 0.35, 0.5, 0.64, 0.9, 1, Number.NaN, 1.2]) {
      rig.updateReload(progress);
      const p = rig.supportHand.position.toArray();
      const r = [rig.supportHand.rotation.x, rig.supportHand.rotation.y, rig.supportHand.rotation.z];
      assert([...p, ...r].every(Number.isFinite), `${anchor.weapon}: reload ${progress} non-finite transform`);
      samples.push({ progress, position: p, rotationZ: r[2] });
    }
    assert(rig.supportHand.position.length() === 0 && [rig.supportHand.rotation.x, rig.supportHand.rotation.y, rig.supportHand.rotation.z].every((v) => v === 0), `${anchor.weapon}: invalid reload does not reset`);
    rig.updateReload(0.5);
    assert(rig.supportHand.position.length() > 0.001, `${anchor.weapon}: reload midpoint did not move support hand`);
    rig.resetReload();
    assert(rig.supportHand.position.length() === 0 && [rig.supportHand.rotation.x, rig.supportHand.rotation.y, rig.supportHand.rotation.z].every((v) => v === 0), `${anchor.weapon}: resetReload did not restore bind transform`);

    for (const mesh of allMeshes) mesh.geometry.dispose();
    for (const material of m.created) material.dispose();
    rows.push({ weapon: anchor.weapon, triangles, meshes: allMeshes.length, reloadSamples: samples.length });
  }

  console.log(JSON.stringify({
    anchors: rows,
    triggerAnchor: api.TRIGGER_SPEC,
    verdict: 'PASS helper anchors match viewmodel source, canary hands preserve cuffs/groups, actual joint endpoints and reload transforms across all five weapons, and CPU geometry integrity/disposal checks pass',
  }, null, 2));
} finally {
  rmSync(OUTFILE, { force: true });
}
