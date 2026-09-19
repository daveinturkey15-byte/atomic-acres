#!/usr/bin/env node
/**
 * CPU-only transition proof for the locomotion phase handoff.
 *
 * The accepted pre-polish blend resets every incoming loop at t=0. The
 * candidate carries the outgoing action's normalized time into the incoming
 * loop before the existing cross-fade. This harness runs both real CharacterRig
 * sources, samples actual bone world matrices at the handoff, and keeps the
 * accepted source as a negative control.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const BLEND_REL = 'src/characters/blend.ts';
const BLEND_PATH = resolve(ROOT, BLEND_REL);
const BASELINE_REF = '0138f85';
const candidateSource = readFileSync(BLEND_PATH, 'utf8');
const baselineSource = execFileSync('git', ['-C', ROOT, 'show', `${BASELINE_REF}:${BLEND_REL}`], { encoding: 'utf8' });
const baseOut = join(tmpdir(), `nuketown-transition-base-${process.pid}.mjs`);
const candOut = join(tmpdir(), `nuketown-transition-candidate-${process.pid}.mjs`);

const ENTRY = `
  import * as THREE from ${JSON.stringify(join(ROOT, 'node_modules/three'))};
  import { buildStandardSkeleton, BONE_NAMES } from ${JSON.stringify(join(ROOT, 'src/characters/skeleton'))};
  import { buildClipLibrary } from ${JSON.stringify(join(ROOT, 'src/characters/clips'))};
  import { CharacterRig } from ${JSON.stringify(BLEND_PATH)};
  export { THREE, buildStandardSkeleton, BONE_NAMES, buildClipLibrary, CharacterRig };
`;

async function bundle(source, outfile) {
  await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'transition-polish.ts', loader: 'ts' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile,
    logLevel: 'warning',
    plugins: [{
      name: 'substitute-blend-source',
      setup(api) {
        api.onLoad({ filter: /blend\.ts$/ }, (args) => {
          if (resolve(args.path).toLowerCase() !== BLEND_PATH.toLowerCase()) return undefined;
          return { contents: source, loader: 'ts', resolveDir: dirname(BLEND_PATH) };
        });
      },
    }],
  });
}

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const round = (n) => Math.round(n * 1e6) / 1e6;

function snapshot(api, std) {
  std.root.updateMatrixWorld(true);
  const matrices = {};
  const positions = {};
  let minY = Infinity;
  let maxY = -Infinity;
  for (const name of api.BONE_NAMES) {
    const bone = std.bones[name];
    bone.updateWorldMatrix(true, false);
    const matrix = Array.from(bone.matrixWorld.elements);
    const position = bone.getWorldPosition(new api.THREE.Vector3()).toArray();
    for (const value of matrix) assert(Number.isFinite(value), `${name}: non-finite matrix value`);
    for (const value of position) assert(Number.isFinite(value), `${name}: non-finite joint position`);
    matrices[name] = matrix;
    positions[name] = position;
    minY = Math.min(minY, position[1]);
    maxY = Math.max(maxY, position[1]);
  }
  return { matrices, positions, bounds: { minY, maxY, height: maxY - minY } };
}

function maxMatrixDelta(a, b) {
  let max = 0;
  for (const name of Object.keys(a.matrices)) {
    const before = a.matrices[name];
    const after = b.matrices[name];
    for (let i = 0; i < before.length; i++) max = Math.max(max, Math.abs(after[i] - before[i]));
  }
  return max;
}

function maxJointStep(a, b) {
  let max = 0;
  let joint = '';
  for (const name of Object.keys(a.positions)) {
    const p = a.positions[name];
    const q = b.positions[name];
    const step = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
    if (step > max) { max = step; joint = name; }
  }
  return { max, joint };
}

const CASES = [
  {
    name: 'run-to-crouch-walk',
    from: { speed: 3.4, turnRate: 0, crouch: false, prone: false, sprinting: false, aimPitch: 0, aimWeight: 0 },
    to: { speed: 1.3, turnRate: 0, crouch: true, prone: false, sprinting: false, aimPitch: 0, aimWeight: 0 },
  },
  {
    name: 'crouch-to-prone-crawl',
    from: { speed: 1.3, turnRate: 0, crouch: true, prone: false, sprinting: false, aimPitch: 0, aimWeight: 0 },
    to: { speed: 1.25, turnRate: 0, crouch: false, prone: true, sprinting: false, aimPitch: 0, aimWeight: 0 },
  },
  {
    name: 'sprint-to-run',
    from: { speed: 5.5, turnRate: 0, crouch: false, prone: false, sprinting: true, aimPitch: 0, aimWeight: 0 },
    to: { speed: 3.4, turnRate: 0, crouch: false, prone: false, sprinting: false, aimPitch: 0, aimWeight: 0 },
  },
];

function exercise(api, test) {
  const std = api.buildStandardSkeleton();
  const rig = new api.CharacterRig(std.root, std.bones, api.buildClipLibrary());
  const dt = 1 / 60;
  // Let the source loop advance away from frame zero. This makes an unwanted
  // reset observable and avoids accidentally proving only the first key.
  for (let i = 0; i < 37; i++) rig.update(dt, { ...test.from });
  const before = snapshot(api, std);
  rig.update(dt, { ...test.to });
  const after = snapshot(api, std);
  rig.update(dt, { ...test.to });
  const next = snapshot(api, std);
  const handoff = maxJointStep(before, after);
  const oneFrame = maxJointStep(after, next);
  return {
    locomotion: rig.currentLocomotion,
    handoffMatrixDelta: maxMatrixDelta(before, after),
    handoffJointStep: handoff.max,
    handoffJoint: handoff.joint,
    nextJointStep: oneFrame.max,
    matrixProbe: Object.fromEntries(['Hips', 'LeftFoot', 'RightFoot'].map((name) => [
      name,
      after.matrices[name].map(round),
    ])),
    bounds: after.bounds,
  };
}

await bundle(baselineSource, baseOut);
await bundle(candidateSource, candOut);

try {
  const baseline = await import(pathToFileURL(baseOut).href);
  const candidate = await import(pathToFileURL(candOut).href);
  const rows = [];
  for (const test of CASES) {
    const before = exercise(baseline, test);
    const after = exercise(candidate, test);
    assert(before.locomotion === after.locomotion, `${test.name}: locomotion changed`);
    assert(after.bounds.height > 0.1 && after.bounds.height < 2.5,
      `${test.name}: invalid joint bounds ${JSON.stringify(after.bounds)}`);
    assert(after.handoffMatrixDelta < 2, `${test.name}: matrix discontinuity is unbounded`);
    rows.push({
      name: test.name,
      locomotion: after.locomotion,
      baseline: {
        handoffMatrixDelta: round(before.handoffMatrixDelta),
        handoffJointStepCm: round(before.handoffJointStep * 100),
        nextJointStepCm: round(before.nextJointStep * 100),
      },
      candidate: {
        handoffMatrixDelta: round(after.handoffMatrixDelta),
        handoffJointStepCm: round(after.handoffJointStep * 100),
        nextJointStepCm: round(after.nextJointStep * 100),
        matrixProbe: after.matrixProbe,
        bounds: Object.fromEntries(Object.entries(after.bounds).map(([k, v]) => [k, round(v)])),
      },
      handoffMatrixImprovement: round(before.handoffMatrixDelta - after.handoffMatrixDelta),
    });
  }

  const stance = rows.find((row) => row.name === 'run-to-crouch-walk');
  assert(stance.handoffMatrixImprovement > 1e-4,
    `phase handoff did not improve run->crouch matrix continuity: ${JSON.stringify(stance)}`);
  console.log(JSON.stringify({
    baseline: { source: BASELINE_REF, control: 'incoming action reset to phase 0' },
    candidate: { source: 'working tree', control: 'incoming loop receives outgoing normalized phase' },
    rows,
    verdict: 'PASS candidate preserves actual joint matrices and finite bounds while reducing stance-transition discontinuity against the accepted reset-to-zero control',
  }, null, 2));
} finally {
  rmSync(baseOut, { force: true });
  rmSync(candOut, { force: true });
}
