#!/usr/bin/env node
/**
 * CPU-only equivalence and allocation proof for the two blend-tree reductions.
 *
 * The frozen fc8c4c8 blend source is bundled as one module and the current
 * candidate as another. Both are exercised through the real CharacterRig,
 * standard skeleton and procedural ClipLibrary. No renderer, browser, server,
 * asset fetch, or application build is involved.
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const BLEND_REL = 'src/characters/blend.ts';
const BLEND_PATH = resolve(ROOT, BLEND_REL);
const candidateSource = readFileSync(BLEND_PATH, 'utf8');
const baselineSource = execFileSync('git', ['-C', ROOT, 'show', `fc8c4c8:${BLEND_REL}`], { encoding: 'utf8' });
const baseOut = join(tmpdir(), `nuketown-blend-base-${process.pid}.mjs`);
const candOut = join(tmpdir(), `nuketown-blend-candidate-${process.pid}.mjs`);

const ENTRY = `
  import * as THREE from ${JSON.stringify(join(ROOT, 'node_modules/three'))};
  import { buildStandardSkeleton, BONE_NAMES } from ${JSON.stringify(join(ROOT, 'src/characters/skeleton'))};
  import { buildClipLibrary } from ${JSON.stringify(join(ROOT, 'src/characters/clips'))};
  import { CharacterRig } from ${JSON.stringify(BLEND_PATH)};
  export { THREE, buildStandardSkeleton, BONE_NAMES, buildClipLibrary, CharacterRig };
`;

async function bundle(source, outfile) {
  await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'blend-allocation-proof.ts', loader: 'ts' },
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
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const maxDiff = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b);
  if (Array.isArray(a) && Array.isArray(b)) {
    assert(a.length === b.length, `array length ${a.length} != ${b.length}`);
    let max = 0;
    for (let i = 0; i < a.length; i++) max = Math.max(max, maxDiff(a[i], b[i]));
    return max;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    assert(JSON.stringify(ka) === JSON.stringify(kb), `object keys differ: ${ka} / ${kb}`);
    let max = 0;
    for (const key of ka) max = Math.max(max, maxDiff(a[key], b[key]));
    return max;
  }
  assert(a === b, `value differs: ${String(a)} / ${String(b)}`);
  return 0;
};

const STATES = [
  { name: 'walk', input: { speed: 1.97, turnRate: 0.11, crouch: false, prone: false, sprinting: false, aimPitch: 0, aimWeight: 0 } },
  { name: 'run', input: { speed: 2.67, turnRate: -0.14, crouch: false, prone: false, sprinting: false, aimPitch: 0, aimWeight: 0 } },
  { name: 'sprint', input: { speed: 2.84, turnRate: 0.19, crouch: false, prone: false, sprinting: true, aimPitch: 0, aimWeight: 0 } },
  { name: 'crouch', input: { speed: 1.3, turnRate: -0.08, crouch: true, prone: false, sprinting: false, aimPitch: 0, aimWeight: 0 } },
  { name: 'prone', input: { speed: 1.25, turnRate: 0.04, crouch: false, prone: true, sprinting: false, aimPitch: 0, aimWeight: 0 } },
  { name: 'aim', input: { speed: 1.97, turnRate: 0, crouch: false, prone: false, sprinting: false, aimPitch: 0.18, aimWeight: 1 } },
  { name: 'aim-tiny-positive', input: { speed: 1.97, turnRate: 0, crouch: false, prone: false, sprinting: false, aimPitch: 5e-5, aimWeight: 1 } },
  { name: 'aim-tiny-negative', input: { speed: 1.97, turnRate: 0, crouch: false, prone: false, sprinting: false, aimPitch: -5e-5, aimWeight: 1 } },
  { name: 'fire', input: { speed: 1.97, turnRate: 0, crouch: false, prone: false, sprinting: false, aimPitch: -0.12, aimWeight: 1 }, fire: true },
];

function takeSnapshot(api, std, rig) {
  std.root.updateMatrixWorld(true);
  const bones = {};
  for (const name of api.BONE_NAMES) {
    const bone = std.bones[name];
    bones[name] = {
      q: bone.quaternion.toArray(),
      p: bone.position.toArray(),
      world: bone.getWorldPosition(new api.THREE.Vector3()).toArray(),
    };
  }
  const feet = {};
  for (const side of ['Left', 'Right']) {
    feet[side] = std.bones[`${side}Foot`].getWorldPosition(new api.THREE.Vector3()).toArray();
  }
  return { root: std.root.position.toArray(), bones, feet, debug: rig.debugSkate() };
}

function exercise(api, state) {
  const library = api.buildClipLibrary();
  const std = api.buildStandardSkeleton();
  const rig = new api.CharacterRig(std.root, std.bones, library);
  if (state.fire) rig.fire();
  const rows = [];
  for (let frame = 0; frame < 72; frame++) {
    rig.update(1 / 60, { ...state.input });
    rows.push(takeSnapshot(api, std, rig));
  }
  return {
    locomotion: rig.currentLocomotion,
    rows,
    final: rows[rows.length - 1],
  };
}

function sourceStats(source) {
  const upperStart = source.indexOf('    const w = input.aimWeight;');
  const upperEnd = source.indexOf('    // ---- weapon carry.', upperStart);
  const upper = source.slice(upperStart, upperEnd);
  return {
    upperQuaternionConstructors: (upper.match(/new THREE\.Quaternion\s*\(/g) ?? []).length,
    upperEulerConstructors: (upper.match(/new THREE\.Euler\s*\(/g) ?? []).length,
    perFrameFootCloneSite: /this\.footPrev\.set\(side, this\.footWorld\.clone\(\)\)/.test(source),
    reusesFootVector: /const slot = this\.footPrev\.get\(side\)[\s\S]*?slot\.copy\(this\.footWorld\)/.test(source),
    totalNewQuaternion: (source.match(/new THREE\.Quaternion\s*\(/g) ?? []).length,
    totalNewEuler: (source.match(/new THREE\.Euler\s*\(/g) ?? []).length,
  };
}

await bundle(baselineSource, baseOut);
await bundle(candidateSource, candOut);

try {
  const base = await import(pathToFileURL(baseOut).href);
  const cand = await import(pathToFileURL(candOut).href);
  const rows = [];
  let maxStateDiff = 0;
  for (const state of STATES) {
    const before = exercise(base, state);
    const after = exercise(cand, state);
    assert(before.locomotion === after.locomotion,
      `${state.name}: locomotion ${before.locomotion} != ${after.locomotion}`);
    const diff = maxDiff(before, after);
    maxStateDiff = Math.max(maxStateDiff, diff);
    rows.push({ state: state.name, locomotion: after.locomotion, maxFloatDiff: diff, frames: after.rows.length });
  }

  const beforeStats = sourceStats(baselineSource);
  const afterStats = sourceStats(candidateSource);
  assert(afterStats.upperQuaternionConstructors === 0,
    `candidate still constructs quaternions in the upper-body loop: ${afterStats.upperQuaternionConstructors}`);
  assert(afterStats.upperEulerConstructors === 0,
    `candidate still constructs Eulers in the upper-body loop: ${afterStats.upperEulerConstructors}`);
  assert(afterStats.reusesFootVector, 'candidate does not show the retained foot vector copy path');
  assert(maxStateDiff <= 1e-6, `pose/position/foot metric drift ${maxStateDiff} exceeds 1e-6`);

  console.log(JSON.stringify({
    baseline: { commit: 'fc8c4c8', sha256: sha256(baselineSource), sourceStats: beforeStats },
    candidate: { sha256: sha256(candidateSource), sourceStats: afterStats },
    allocationDelta: {
      upperQuaternionConstructors: `${beforeStats.upperQuaternionConstructors} -> ${afterStats.upperQuaternionConstructors}`,
      upperEulerConstructors: `${beforeStats.upperEulerConstructors} -> ${afterStats.upperEulerConstructors}`,
      footPath: 'clone on first observation per foot, copy thereafter',
      scope: 'source-counted target sites only; this does not claim zero allocations in the whole rig',
    },
    states: rows,
    maxStateDiff,
    verdict: 'PASS real CharacterRig CPU states preserve locomotion, bone quaternions/positions, and deterministic foot metrics within 1e-6',
  }, null, 2));
} finally {
  rmSync(baseOut, { force: true });
  rmSync(candOut, { force: true });
}
