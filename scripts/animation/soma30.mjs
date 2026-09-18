/**
 * SOMA-30 skeleton, transcribed from the Kimodo port's own source of truth:
 * `C:\Users\david\projects\kimodo.cpp\src\skeleton.hpp` -> `soma30_names`,
 * `soma30_parents`, `soma30_offsets` (which that file records as copied from
 * NVIDIA Kimodo's Apache-2.0 `kimodo/skeleton/definitions.py` plus offsets
 * extracted from the reference `joints.p`).
 *
 * WHY THIS FILE EXISTS AND WHY IT IS NOT "SMPL-X".
 * The port's README says Kimodo "gives you SMPL-X". That sentence is true only
 * of the SMPL-X RP checkpoint, which this project may not obtain (see
 * docs/LICENCES-ANIMATION.md). `soma-rp-v1.1` emits THIRTY joints, and the two
 * layouts disagree about almost everything - joint count, naming, and, fatally,
 * what "Leg" means:
 *
 *     SOMA-30      Hips -> LeftLeg  (THIGH) -> LeftShin (CALF) -> LeftFoot -> LeftToeBase
 *     our rig      Hips -> LeftUpLeg(THIGH) -> LeftLeg  (CALF) -> LeftFoot -> LeftToe
 *
 * A name-equality map therefore attaches SOMA's thigh to our calf and puts the
 * knee in the hip. That is a silent, plausible-looking defect: the figure walks,
 * but with legs one segment too short and a knee that bends at the pelvis.
 *
 * HANDEDNESS. Read the rest offsets, do not assume. LeftShoulder is at +X,
 * LeftEye is at +X, the jaw and both toes are at +Z, and the spine runs +Y. The
 * ankle also sits slightly BEHIND the knee (-Z), which independently confirms
 * that +Z is forward rather than backward.
 *
 * A right-handed Y-up frame in which a figure faces +Z puts that figure's LEFT
 * at -X (right = up x forward = +X). SOMA puts its Left-labelled joints at +X.
 * So reading SOMA straight into three.js renders a MIRRORED human: the joint
 * NVIDIA calls LeftHand appears on the rendered figure's right.
 *
 * There are exactly two self-consistent repairs and they differ by a mirror:
 *
 *   A  reflect X, keep the labels    -> SOMA Left drives OUR Left
 *   B  keep the geometry, swap labels -> SOMA Left drives OUR Right
 *
 * Both produce an unbroken figure, so a pose sheet cannot tell them apart - only
 * chirality differs, and a mirrored walk still looks like a walk. We take A,
 * because NVIDIA's own `definitions.py` labels are anatomical and it is the
 * FRAME that is left-handed, not the naming. `calib-right-arm` is the falsifier
 * that keeps this honest: under A a clip asking for the right arm raises OUR
 * right arm, under B it raises our left.
 *
 * CROSSING THE SIDES ON TOP OF THE REFLECTION IS A THIRD, BROKEN OPTION and it
 * was the first thing tried here. Reflection sends SOMA's RightShoulder to +X;
 * feeding that to our LeftShoulder at -X is positionally inconsistent, and the
 * rest correction then swings both arms across the chest. It is visible in
 * captures/anim/diag-walk-v1.png and it is why that file is kept.
 */

/** Joint names, index-aligned with the model's output channels. */
export const SOMA30_NAMES = [
  'Hips', 'Spine1', 'Spine2', 'Chest', 'Neck1', 'Neck2', 'Head', 'Jaw',
  'LeftEye', 'RightEye', 'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'LeftHandThumbEnd', 'LeftHandMiddleEnd', 'RightShoulder', 'RightArm', 'RightForeArm',
  'RightHand', 'RightHandThumbEnd', 'RightHandMiddleEnd', 'LeftLeg', 'LeftShin', 'LeftFoot',
  'LeftToeBase', 'RightLeg', 'RightShin', 'RightFoot', 'RightToeBase',
];

/** Parent index per joint; -1 is the root. */
export const SOMA30_PARENTS = [
  -1, 0, 1, 2, 3, 4, 5, 6, 6, 6, 3, 10, 11, 12, 13, 13, 3, 16, 17, 18, 19, 19, 0, 22, 23, 24, 0, 26, 27, 28,
];

/** Parent-local rest offset per joint, metres, in SOMA's own (mirrored) frame. */
export const SOMA30_OFFSETS = [
  [0, 0, 0],
  [-0.00013727, 0.0500376256, -0.00053726669],
  [-1.86574103e-9, 0.0712530139, -0.000298248546],
  [-5.75188398e-9, 0.0755006305, -0.00815970992],
  [-0.00181676517, 0.263112953, -0.00553348292],
  [-2.85102231e-8, 0.0770939664, 0.0230258546],
  [-4.5975437e-8, 0.0612891595, 0.0195370861],
  [2.63687901e-5, 0.0047559225, 0.0309494062],
  [0.0320638079, 0.0538020513, 0.0758688308],
  [-0.0322244017, 0.05361869, 0.0755823359],
  [0.0162165175, 0.232371641, 0.0511341324],
  [0.149198457, 2.19397873e-8, -0.0550232576],
  [0.287393078, 2.50268389e-9, -2.58787737e-5],
  [0.270939812, -7.06625108e-9, 2.60897248e-5],
  [0.122686267, -0.0322017573, 0.0483306876],
  [0.190119595, -0.00312878387, -0.000339570373],
  [-0.0138011824, 0.231803086, 0.0521415786],
  [-0.150371962, 1.17387901e-7, -0.0554560437],
  [-0.287366393, 1.87628082e-8, -2.59709359e-5],
  [-0.271336198, -1.16767401e-9, 2.61269368e-5],
  [-0.122642483, -0.0321145448, 0.0480403904],
  [-0.190005945, -0.00306615542, -0.0003157343],
  [0.10043214, -0.0843452671, 0.0259565473],
  [-1e-8, -0.432217537, -0.00802912805],
  [1e-8, -0.421550959, -0.0348152298],
  [0, -0.0505947206, 0.132315294],
  [-0.10047278, -0.0829525995, 0.0262031695],
  [1e-8, -0.433622059, -0.00805555828],
  [2e-8, -0.421173943, -0.0347839785],
  [-3.42907669e-9, -0.0507960932, 0.132841956],
];

export const SOMA30_JOINTS = SOMA30_NAMES.length;

/** Index by name, for the retarget map. */
export const SOMA30_INDEX = Object.fromEntries(SOMA30_NAMES.map((n, i) => [n, i]));

/**
 * SOMA-30 joint -> our standard bone (src/characters/skeleton.ts).
 *
 * Sides are NOT crossed - the X reflection in retarget-soma.mjs already puts
 * SOMA's Left chain on our -X side, which is where our Left bones live.
 *
 * The SEGMENT names are the trap instead: SOMA's "Leg" is the thigh and its
 * "Shin" is what we call "Leg". A name-equality map attaches SOMA's thigh to our
 * calf and puts the knee in the pelvis - a defect that still walks, so nothing
 * catches it except measuring limb lengths.
 *
 * The spine is 3+2 segments in SOMA against our 2+1. World rotations are what
 * gets transferred, so an unmapped intermediate (Spine1, Neck2) is not lost -
 * its rotation is already inside the world rotation of the joint below it. The
 * mapping picks the SOMA joint that sits at the same anatomical height as ours:
 * SOMA's Chest carries the shoulders and the neck, exactly like our Chest, and
 * SOMA's Neck1 stands 0.263 m above it against our 0.27 m.
 *
 * SOMA joints with no counterpart in our 21-bone rig (Jaw, eyes, finger ends)
 * are absent on purpose - they carry no game read and every extra bone is
 * per-character cost twelve times over.
 */
export const SOMA30_TO_STANDARD = {
  Hips: 'Hips',
  Spine1: null,
  Spine2: 'Spine',
  Chest: 'Chest',
  Neck1: 'Neck',
  Neck2: null,
  Head: 'Head',
  Jaw: null,
  LeftEye: null,
  RightEye: null,
  LeftShoulder: 'LeftShoulder',
  LeftArm: 'LeftArm',
  LeftForeArm: 'LeftForeArm',
  LeftHand: 'LeftHand',
  LeftHandThumbEnd: null,
  LeftHandMiddleEnd: null,
  RightShoulder: 'RightShoulder',
  RightArm: 'RightArm',
  RightForeArm: 'RightForeArm',
  RightHand: 'RightHand',
  RightHandThumbEnd: null,
  RightHandMiddleEnd: null,
  LeftLeg: 'LeftUpLeg',     // SOMA "Leg" is the THIGH.
  LeftShin: 'LeftLeg',      // SOMA "Shin" is our "Leg".
  LeftFoot: 'LeftFoot',
  LeftToeBase: 'LeftToe',
  RightLeg: 'RightUpLeg',
  RightShin: 'RightLeg',
  RightFoot: 'RightFoot',
  RightToeBase: 'RightToe',
};

/**
 * Forward kinematics in SOMA's own frame.
 * `rot` is T x J x 4 xyzw parent-local, `root` is T x 3. Returns T x J x 3
 * world positions (root translation applied) and T x J x 4 world quaternions.
 */
export function somaForwardKinematics(root, rot, frames) {
  const J = SOMA30_JOINTS;
  const pos = new Float64Array(frames * J * 3);
  const wq = new Float64Array(frames * J * 4);
  for (let t = 0; t < frames; t++) {
    for (let j = 0; j < J; j++) {
      const p = SOMA30_PARENTS[j];
      const qi = (t * J + j) * 4;
      const lx = rot[qi], ly = rot[qi + 1], lz = rot[qi + 2], lw = rot[qi + 3];
      if (p < 0) {
        wq[qi] = lx; wq[qi + 1] = ly; wq[qi + 2] = lz; wq[qi + 3] = lw;
        pos[(t * J + j) * 3] = root[t * 3];
        pos[(t * J + j) * 3 + 1] = root[t * 3 + 1];
        pos[(t * J + j) * 3 + 2] = root[t * 3 + 2];
        continue;
      }
      const pq = (t * J + p) * 4;
      // world = parentWorld * local
      const ax = wq[pq], ay = wq[pq + 1], az = wq[pq + 2], aw = wq[pq + 3];
      wq[qi] = aw * lx + ax * lw + ay * lz - az * ly;
      wq[qi + 1] = aw * ly - ax * lz + ay * lw + az * lx;
      wq[qi + 2] = aw * lz + ax * ly - ay * lx + az * lw;
      wq[qi + 3] = aw * lw - ax * lx - ay * ly - az * lz;
      // offset rotated by the PARENT's world rotation, added to the parent
      const [ox, oy, oz] = SOMA30_OFFSETS[j];
      const tx = 2 * (ay * oz - az * oy);
      const ty = 2 * (az * ox - ax * oz);
      const tz = 2 * (ax * oy - ay * ox);
      pos[(t * J + j) * 3] = pos[(t * J + p) * 3] + ox + aw * tx + (ay * tz - az * ty);
      pos[(t * J + j) * 3 + 1] = pos[(t * J + p) * 3 + 1] + oy + aw * ty + (az * tx - ax * tz);
      pos[(t * J + j) * 3 + 2] = pos[(t * J + p) * 3 + 2] + oz + aw * tz + (ax * ty - ay * tx);
    }
  }
  return { pos, wq };
}
