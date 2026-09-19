/**
 * Browser-free skinned-surface proof for the prone clips.
 *
 * This samples the real procedural clips on the real standard skeleton and
 * walks every dressed vertex through the same rigid skin transform used by
 * the renderer. It reports floor clearance and leg-chain joint positions over
 * both full cycles; it does not substitute a capsule or a guessed bone-only
 * measurement for the visible surface.
 */
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const outfile = join(tmpdir(), `nuketown-prone-clearance-${process.pid}.mjs`);
const ENTRY = `
  import * as THREE from 'three';
  import { buildClipLibrary } from ${JSON.stringify(join(ROOT, 'src/characters/clips'))};
  import { buildStandardSkeleton, BONE_NAMES } from ${JSON.stringify(join(ROOT, 'src/characters/skeleton'))};
  import { CharacterRig } from ${JSON.stringify(join(ROOT, 'src/characters/blend'))};
  import { dressProcedural } from ${JSON.stringify(join(ROOT, 'src/characters/mesh'))};
  export { THREE, buildClipLibrary, buildStandardSkeleton, BONE_NAMES, CharacterRig, dressProcedural };
`;

const assert = (ok, message) => { if (!ok) throw new Error(message); };

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'prone-clearance.ts', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  logLevel: 'warning',
});

try {
  const { THREE, buildClipLibrary, buildStandardSkeleton, BONE_NAMES, CharacterRig, dressProcedural } =
    await import(pathToFileURL(outfile).href);
  const lib = buildClipLibrary();
  const PRONE_HEIGHT = 0.52;
  const HEAD_TORSO_BONES = [0, 1, 2, 3, 4]; // Hips, Spine, Chest, Neck, Head
  const dress = {
    skin: new THREE.MeshBasicMaterial(),
    cloth: new THREE.MeshBasicMaterial(),
    dark: new THREE.MeshBasicMaterial(),
  };

  function sample(name, time, hipRx = null, forearmRx = null, handRx = null, torsoRx = null, legRx = null, spineRx = null, chestRx = null) {
    const std = buildStandardSkeleton();
    dressProcedural(std.root, std.bones, dress);
    const mixer = new THREE.AnimationMixer(std.root);
    const action = mixer.clipAction(lib[name].clip);
    action.setLoop(THREE.LoopRepeat, Infinity).play();
    mixer.setTime(time);
    if (hipRx !== null) std.bones.Hips.rotation.x = hipRx;
    if (forearmRx !== null) {
      std.bones.LeftForeArm.rotation.x = forearmRx;
      std.bones.RightForeArm.rotation.x = forearmRx;
    }
    if (handRx !== null) {
      std.bones.LeftHand.rotation.x = handRx;
      std.bones.RightHand.rotation.x = handRx;
    }
    if (torsoRx !== null) {
      std.bones.Spine.rotation.x = torsoRx;
      std.bones.Chest.rotation.x = torsoRx;
    }
    if (spineRx !== null) std.bones.Spine.rotation.x = spineRx;
    if (chestRx !== null) std.bones.Chest.rotation.x = chestRx;
    if (legRx !== null) {
      std.bones.LeftLeg.rotation.x = legRx;
      std.bones.RightLeg.rotation.x = legRx;
    }
    std.root.updateMatrixWorld(true);
    let mesh = null;
    std.root.traverse((node) => {
      if (!mesh && node.isSkinnedMesh) mesh = node;
    });
    assert(mesh, `${name}: dressed skinned mesh missing`);
    mesh.skeleton.update();
    const pos = mesh.geometry.getAttribute('position');
    const skin = mesh.geometry.getAttribute('skinIndex');
    const v = new THREE.Vector3();
    let minY = Infinity;
    let maxY = -Infinity;
    let minVertex = null;
    let maxVertex = null;
    let minLegY = Infinity;
    const boneMinY = {};
    const boneMaxY = {};
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      mesh.applyBoneTransform(i, v);
      mesh.localToWorld(v);
      minY = Math.min(minY, v.y);
      maxY = Math.max(maxY, v.y);
      const bone = skin.getX(i);
      if (boneMinY[bone] === undefined || v.y < boneMinY[bone]) boneMinY[bone] = v.y;
      if (boneMaxY[bone] === undefined || v.y > boneMaxY[bone]) boneMaxY[bone] = v.y;
      if (!minVertex || v.y < minVertex.y) minVertex = { x: v.x, y: v.y, z: v.z, bone };
      if (!maxVertex || v.y > maxVertex.y) maxVertex = { x: v.x, y: v.y, z: v.z, bone };
      if (bone >= 13 && bone <= 20 && v.y < minLegY) {
        minLegY = v.y;
      }
    }
    const joints = {};
    for (const n of ['Hips', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToe', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToe', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand']) {
      const p = new THREE.Vector3();
      std.bones[n].getWorldPosition(p);
      joints[n] = { x: p.x, y: p.y, z: p.z };
    }
    std.root.traverse((node) => { if (node.isSkinnedMesh) node.skeleton.dispose(); });
    return { minY, maxY, minLegY, minVertex, maxVertex, boneMinY, boneMaxY, joints };
  }

  const rows = {};
  for (const name of ['prone-idle', 'prone-crawl']) {
    const duration = lib[name].clip.duration;
    const samples = [];
    for (let i = 0; i <= 36; i++) samples.push(sample(name, duration * i / 36));
    const minY = Math.min(...samples.map(s => s.minY));
    const minLegY = Math.min(...samples.map(s => s.minLegY));
    const maxY = Math.max(...samples.map(s => s.maxY));
    const kneeMinY = Math.min(...samples.flatMap(s => [s.joints.LeftLeg.y, s.joints.RightLeg.y]));
    const ankleMinY = Math.min(...samples.flatMap(s => [s.joints.LeftFoot.y, s.joints.RightFoot.y]));
    const toeMinY = Math.min(...samples.flatMap(s => [s.joints.LeftToe.y, s.joints.RightToe.y]));
    const lowest = samples.reduce((a, b) => a.minY < b.minY ? a : b);
    const highest = samples.reduce((a, b) => a.maxY > b.maxY ? a : b);
    const headTorsoMaxY = Math.max(...samples.flatMap(s => HEAD_TORSO_BONES.map(b => s.boneMaxY[b] ?? -Infinity)));
    rows[name] = {
      duration,
      sampleCount: samples.length,
      minSurfaceY: minY,
      minLegSurfaceY: minLegY,
      maxSurfaceY: maxY,
      minKneeJointY: kneeMinY,
      minAnkleJointY: ankleMinY,
      minToeJointY: toeMinY,
      lowestVertex: { ...lowest.minVertex, boneName: BONE_NAMES[lowest.minVertex.bone] },
      highestVertex: { ...highest.maxVertex, boneName: BONE_NAMES[highest.maxVertex.bone] },
      headTorsoMaxY,
      headTorsoLimit: PRONE_HEIGHT,
      highestBoneMaxY: samples.reduce((out, s) => {
        for (const [bone, y] of Object.entries(s.boneMaxY)) out[bone] = Math.max(out[bone] ?? -Infinity, y);
        return out;
      }, {}),
    };
  }

  // Recreate the prior pose as a negative control. These overrides match the
  // pre-clearance values (hip 1.28, trunk 0.10/0.15, lower leg 0.75,
  // forearm -0.72), so a green result cannot come from a relaxed threshold.
  const legacyRows = {};
  for (const name of ['prone-idle', 'prone-crawl']) {
    const duration = lib[name].clip.duration;
    const samples = [];
    for (let i = 0; i <= 36; i++) {
      samples.push(sample(name, duration * i / 36, 1.28, -0.72, -0.08, null, 0.75, 0.10, 0.15));
    }
    legacyRows[name] = {
      minSurfaceY: Math.min(...samples.map(s => s.minY)),
      minLegSurfaceY: Math.min(...samples.map(s => s.minLegY)),
    };
  }

  const clearanceTolerance = -0.005;
  for (const [name, row] of Object.entries(rows)) {
    assert(row.minSurfaceY >= clearanceTolerance,
      `${name}: visible surface clips floor at ${row.minSurfaceY.toFixed(4)} m`);
    assert(row.minLegSurfaceY >= clearanceTolerance,
      `${name}: leg surface clips floor at ${row.minLegSurfaceY.toFixed(4)} m`);
    assert(row.minKneeJointY > 0.05, `${name}: knee joint too close to floor`);
    assert(row.minToeJointY > 0.05, `${name}: toe joint too close to floor`);
    assert(row.headTorsoMaxY <= PRONE_HEIGHT,
      `${name}: head/torso surface exceeds gameplay height ${PRONE_HEIGHT} m`);
  }
  assert(legacyRows['prone-idle'].minSurfaceY < -0.10,
    'legacy idle negative control unexpectedly cleared the floor');
  assert(legacyRows['prone-crawl'].minLegSurfaceY < -0.05,
    'legacy crawl negative control unexpectedly cleared the floor');

  // Weapon carry proof: sample both full prone cycles through the real
  // CharacterRig, rather than checking the IK equations in isolation. The
  // prone clips rotate the chest onto the lawn, so the acceptance direction is
  // actor-root +Z. The support hand must stay near the measured forestock.
  const carryRows = {};
  function runCarryProbe(name, speed, aimWeight) {
    const std = buildStandardSkeleton();
    const rig = new CharacterRig(std.root, std.bones, lib);
    const duration = lib[name].clip.duration;
    const dt = duration / 36;
    const rootForward = new THREE.Vector3(0, 0, 1);
    const rootQ = new THREE.Quaternion();
    std.root.getWorldQuaternion(rootQ);
    rootForward.applyQuaternion(rootQ).normalize();
    const fore = new THREE.Vector3();
    const barrel = new THREE.Vector3();
    const support = new THREE.Vector3();
    const dots = [];
    const supportCm = [];
    const carries = [];
    for (let i = 0; i <= 36; i++) {
      rig.update(dt, {
        speed,
        turnRate: 0,
        crouch: false,
        prone: true,
        sprinting: false,
        aimPitch: 0,
        aimWeight,
      });
      std.root.updateMatrixWorld(true);
      rig.weaponProbe(fore, barrel);
      std.bones.LeftHand.getWorldPosition(support);
      dots.push(barrel.dot(rootForward));
      supportCm.push(support.distanceTo(fore) * 100);
      carries.push(rig.carryWeight);
    }
    return {
      duration,
      sampleCount: dots.length,
      minBarrelForwardDot: Math.min(...dots),
      maxSupportHandToForestockCm: Math.max(...supportCm),
      minCarry: Math.min(...carries),
    };
  }
  for (const [name, speed] of [['prone-idle', 0], ['prone-crawl', 1.25]]) {
    const carry = runCarryProbe(name, speed, 0);
    const aim = runCarryProbe(name, speed, 1);
    carryRows[name] = {
      carry,
      aim,
    };
    for (const [mode, row] of Object.entries({ carry, aim })) {
      assert(row.minBarrelForwardDot >= 0.80,
        `${name}/${mode}: prone barrel left actor-forward cone (${row.minBarrelForwardDot.toFixed(3)})`);
      assert(row.maxSupportHandToForestockCm <= 22,
        `${name}/${mode}: support hand left forestock (${row.maxSupportHandToForestockCm.toFixed(1)} cm)`);
      assert(row.minCarry >= 0.80,
        `${name}/${mode}: prone carry weight faded below the authored constraint (${row.minCarry.toFixed(3)})`);
    }
  }

  dress.skin.dispose();
  dress.cloth.dispose();
  dress.dark.dispose();
  console.log(JSON.stringify({
    rows,
    legacyRows,
    carryRows,
    clearanceTolerance,
    proneHeight: PRONE_HEIGHT,
    verdict: 'PASS corrected prone-idle and prone-crawl skinned surfaces remain above floor and rifle carry stays root-forward with supported hands across full cycles; legacy pose fails negative control',
  }, null, 2));
} finally {
  rmSync(outfile, { force: true });
}
