/**
 * MANNEQUINS - the shop dummies that make this a nuclear test town and not a suburb.
 *
 * ONE figure factory, reused 35 times. Every part is a unit primitive pushed into a
 * per-geometry batch, so the population costs ~16 InstancedMesh draw calls.
 *
 * The rig is built in the figure's OWN frame - feet at y=0, facing -z (the camera
 * convention in core/stations.ts), every length a fraction of the figure's height -
 * then multiplied by one root matrix carrying world position, yaw and the pose's
 * tilt/roll/lift. Arms and legs are a forward-kinematic chain: each bone hangs from
 * its joint, swung forward by rx and out to the side by rz. A pose is therefore a
 * TABLE OF ANGLES, never copy-pasted geometry.
 *
 * Placement dodges every parked vehicle, house, garage, fence, hedge and yard prop;
 * nothing stands on a garage apron or lies toppled on the carriageway.
 *
 * COLLIDERS: none, deliberately. Players walk through the mannequins, exactly as
 * yards.ts chose when it owned the handful this module replaces.
 */
import * as THREE from 'three';
import type { AABB, BuildContext, Builder, BuildResult } from '../core/kit';
import { group } from '../core/kit';
import { PAL } from '../core/palette';
import type { HouseSide } from '../core/layout';
import {
  BACK_FENCE, DECK_LEN, DECK_OUT, DECK_Y, FRONT_LAWN_OUTER, HEAD_CENTER_X,
  HEAD_RADIUS, HOUSE_BACK, HOUSE_HALF_LEN, KERB_HEIGHT, KERB_WIDTH, ORANGE,
  PAVEMENT_OUTER, ROAD_HALF_WIDTH, ROAD_X_MAX, ROAD_X_MIN, WHITE,
  YARD_X_MAX, YARD_X_MIN,
} from '../core/layout';

// ------------------------------------------------- surface y ladder (from ground.ts)
// A figure's feet sit ON the surface named. These must track the y-ladder comment at
// the top of src/build/ground.ts - the same contract vehicles.ts keeps for T_DRIVE.
const Y_APRON = 0;                    // base apron, outside the kerb plateau
const Y_ROAD = 0.030;                 // asphalt strip
const Y_HEAD = 0.044;                 // turning-head disc
const Y_ARC = KERB_HEIGHT - 0.002;    // circular kerb + pavement ring (T_ARC)
const Y_PAVE = KERB_HEIGHT;           // straight pavement (T_PAVE)
const Y_LAWN = KERB_HEIGHT + 0.001;   // lawns and back yards (T_LAWN)

// ------------------------------------------------------------------ derived frame
const O = ORANGE, W = WHITE;
const PAVE_MID = (ROAD_HALF_WIDTH + KERB_WIDTH + PAVEMENT_OUTER) / 2;
const KERB_EDGE = ROAD_HALF_WIDTH + KERB_WIDTH + 0.45;   // just behind the kerb face
const RING_R = HEAD_RADIUS + KERB_WIDTH + 1.1;           // mid pavement ring of the bulb

/** x at fraction t across a back yard */
const yx = (t: number): number => YARD_X_MIN + t * (YARD_X_MAX - YARD_X_MIN);
/** z at fraction t from a house's back wall (0) to its back fence (1) */
const yz = (h: HouseSide, t: number): number =>
  h.side * (HOUSE_BACK + t * (BACK_FENCE - HOUSE_BACK));
/** z at fraction t from the pavement edge (0) to a house's front wall (1) */
const fz = (h: HouseSide, t: number): number =>
  h.side * (PAVEMENT_OUTER + t * (FRONT_LAWN_OUTER - PAVEMENT_OUTER));
/** x at fraction t of the house half-length */
const hx = (t: number): number => t * HOUSE_HALF_LEN;
/** x at fraction t along the road stem */
const stx = (t: number): number => ROAD_X_MIN + t * (ROAD_X_MAX - ROAD_X_MIN);
const ringX = (a: number): number => HEAD_CENTER_X + Math.cos(a) * RING_R;
const ringZ = (a: number): number => Math.sin(a) * RING_R;

// ------------------------------------------------------------------ figure proportions
// All fractions of the figure's height H. The standing pelvis sits at HIP_Y; every pose
// shifts the whole upper body by (pose.hipY - HIP_Y) so the feet always land at y=0.
const HIP_Y = 0.4925;
// Every joint ball is WIDER than both limbs it bridges, and every bone is drawn OVER
// past its own joint into that ball. These primitives are faceted - a detail-0
// icosahedron's inradius is 0.79 of nominal, an 8-sided cylinder's 0.92 - so parts
// that merely abut open a seam and the whole figure reads broken rather than stylised.
const OVER = 0.030;
const P = {
  headW: 0.135, headH: 0.165, headD: 0.145, headY: 0.945,
  neckD: 0.052, neckH: 0.075, neckY: 0.868,
  torW: 0.245, torH: 0.235, torD: 0.155, torY: 0.715,
  pelW: 0.200, pelH: 0.110, pelD: 0.160, pelY: 0.5475,
  shoX: 0.100, shoY: 0.815, shoD: 0.105,
  uarmL: 0.165, uarmW: 0.060, elbD: 0.076, farmL: 0.155, farmW: 0.050,
  hipX: 0.055, thighL: 0.245, thighW: 0.086, kneeD: 0.096,
  calfL: 0.225, calfW: 0.064, footW: 0.078, footH: 0.045, footD: 0.115,
  discD: 0.170, discH: 0.014,
  dressW: 0.285, dressD: 0.215, dressTop: 0.780, dressHem: 0.455,
};

// ------------------------------------------------------------------ poses
/**
 * Per-limb angles; index 0 is the figure's left (x < 0), index 1 its right. `armS`/
 * `legS` abduct out to that side, `armF`/`legF` swing forward. The second segment of
 * each chain inherits both and adds `elb`/`knee` (forward) and `elbS` (sideways) -
 * without the sideways term a raised arm cannot fold upright and reads as a snapped
 * stick.
 */
interface Pose {
  hipY: number; tilt: number; roll: number; lift: number; base: boolean;
  armF: [number, number]; armS: [number, number];
  elb: [number, number]; elbS: [number, number];
  legF: [number, number]; legS: [number, number]; knee: [number, number];
}
type PoseName = 'stand' | 'armsUp' | 'armOut' | 'lean' | 'sit' | 'fallen';

const POSES: Record<PoseName, Pose> = {
  stand: {
    hipY: HIP_Y, tilt: 0, roll: 0, lift: 0, base: true,
    armF: [0.06, -0.04], armS: [0.09, 0.10], elb: [0.10, 0.14], elbS: [0.03, 0.04],
    legF: [0.02, -0.02], legS: [0.05, 0.05], knee: [0, 0],
  },
  // upper arms out to the horizontal, forearms folded upright: hands up
  armsUp: {
    hipY: HIP_Y, tilt: 0, roll: 0, lift: 0, base: true,
    armF: [0.10, 0.08], armS: [1.52, 1.60], elb: [0.05, 0.02], elbS: [1.32, 1.24],
    legF: [0.05, -0.05], legS: [0.09, 0.07], knee: [0, 0],
  },
  armOut: {
    hipY: HIP_Y, tilt: 0, roll: 0, lift: 0, base: true,
    armF: [0.05, 0.18], armS: [0.12, 1.48], elb: [0.12, -0.10], elbS: [0.06, 0.04],
    legF: [0.10, -0.08], legS: [0.04, 0.12], knee: [0, 0],
  },
  lean: {
    hipY: HIP_Y, tilt: -0.17, roll: 0.07, lift: 0.012, base: true,
    armF: [-0.22, -0.30], armS: [0.22, 0.20], elb: [0.30, 0.34], elbS: [0.05, 0.04],
    legF: [-0.10, -0.14], legS: [0.10, 0.06], knee: [0.08, 0.05],
  },
  // Sitting on a kerb or step: pelvis at seat height, thighs forward to the horizontal,
  // knees bent so the calves drop and the feet land back on the surface. Straight legs
  // from a low pelvis read as PRONE, not seated - the knee bend is what sells it.
  sit: {
    hipY: 0.270, tilt: 0, roll: 0, lift: 0, base: false,
    armF: [0.72, 0.66], armS: [0.22, 0.20], elb: [0.22, 0.28], elbS: [0.12, 0.10],
    legF: [1.50, 1.46], legS: [0.13, 0.11], knee: [1.48, 1.46],
  },
  // toppled. tilt ~ +PI/2 lays it on its back; the limb swings stay near zero so the
  // whole rigid body ends up flat on the surface instead of a leg spearing the sky.
  fallen: {
    hipY: HIP_Y, tilt: 1.55, roll: 0.10, lift: 0.085, base: false,
    armF: [0.18, -0.12], armS: [1.15, 1.42], elb: [0.45, 0.15], elbS: [0.22, -0.18],
    legF: [0.10, -0.16], legS: [0.22, 0.42], knee: [0.25, 0.05],
  },
};

// ------------------------------------------------------- dress (flat 1960s colours)
const DRESS = [PAL.signMaroon, PAL.signTeal, PAL.applianceRed, PAL.applianceBlue];
const SUIT = [PAL.truckCab, PAL.carBlue];
const BARE = DRESS.length + SUIT.length;   // wear code for undressed pale plastic

// ------------------------------------------------------------------ instancing
const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _root = new THREE.Matrix4();

/** Collects unit-primitive transforms and emits one InstancedMesh per material. */
class Batch {
  private byMat = new Map<THREE.Material, THREE.Matrix4[]>();
  constructor(private geo: THREE.BufferGeometry) {}

  push(m: THREE.Material, mx: THREE.Matrix4): void {
    const a = this.byMat.get(m) ?? this.byMat.set(m, []).get(m)!;
    a.push(mx.clone());
  }

  flush(parent: THREE.Group, tag: string): void {
    let n = 0;
    for (const [m, arr] of this.byMat) {
      const im = new THREE.InstancedMesh(this.geo, m, arr.length);
      for (let i = 0; i < arr.length; i++) im.setMatrixAt(i, arr[i]);
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = im.receiveShadow = true;
      im.computeBoundingSphere();
      im.name = `${tag}${n++}`;
      parent.add(im);
    }
  }
}

/** An axis-aligned part, centred at (x,y,z) in the figure's own frame. */
function part(b: Batch, m: THREE.Material, w: number, h: number, d: number,
              x: number, y: number, z: number): void {
  _m.makeScale(w, h, d).setPosition(x, y, z);
  b.push(m, _m.premultiply(_root));
}

/**
 * A limb segment hanging from joint `p`: swung forward by rx (+ = toward -z, the way
 * the figure faces) and out to the side by rz. It is drawn from OVER behind `p` so it
 * buries its head in that joint's ball; the returned far end is the true joint
 * position, which the next segment then overlaps backwards into in the same way.
 */
function bone(b: Batch, m: THREE.Material, p: THREE.Vector3,
              rx: number, rz: number, len: number, w: number): THREE.Vector3 {
  _d.set(Math.sin(rz), -Math.cos(rz) * Math.cos(rx), -Math.cos(rz) * Math.sin(rx));
  _q.setFromUnitVectors(UP, _d);
  _m.compose(_p.copy(p).addScaledVector(_d, (len - OVER) / 2), _q, _s.set(w, len + OVER, w));
  b.push(m, _m.premultiply(_root));
  return p.clone().addScaledVector(_d, len);
}

// ------------------------------------------------------------------ the population
/** [x, z, surface y, yaw, pose, wear] - wear: -1 auto, 0-3 dress, 4-5 suit, 6 bare. */
type Place = [number, number, number, number, PoseName, number];

const PLACES: Place[] = [
  // --- orange front lawn and pavement (-z)
  [hx(0.05), fz(O, 0.28), Y_LAWN, 2.9, 'stand', -1],
  [hx(0.30), fz(O, 0.50), Y_LAWN, 3.6, 'armOut', -1],
  [hx(-0.88), fz(O, 0.35), Y_LAWN, 2.2, 'lean', -1],
  [hx(-0.62), O.side * PAVE_MID, Y_PAVE, Math.PI, 'stand', 0],   // NT05's magenta shift
  [hx(-0.30), O.side * KERB_EDGE, Y_PAVE, 2.1, 'armsUp', -1],

  // --- white front lawn and pavement (+z)
  [hx(-0.10), fz(W, 0.40), Y_LAWN, 0.3, 'stand', -1],
  [hx(-0.42), fz(W, 0.62), Y_LAWN, 0.9, 'lean', -1],
  [hx(0.72), fz(W, 0.24), Y_LAWN, -0.4, 'sit', -1],   // clear of the blue appliance bank
  [hx(0.15), W.side * PAVE_MID, Y_PAVE, 0.1, 'armOut', -1],
  [hx(-0.85), W.side * KERB_EDGE, Y_PAVE, -0.7, 'stand', -1],

  // --- the road. Clear of the teal saloon and of the two eye-level stations parked at
  //     x=6. NOTHING TOPPLED on the carriageway: splayed there it reads as a body.
  [stx(0.50), O.side * ROAD_HALF_WIDTH * 0.42, Y_ROAD, 1.5, 'stand', -1],
  [stx(0.94), W.side * ROAD_HALF_WIDTH * 0.62, Y_ROAD, -1.2, 'stand', -1],

  // --- turning head. The coach fills the -z half and the truck + saloon the +z half,
  //     so these take the outboard arc and the +x apex only.
  [HEAD_CENTER_X - HEAD_RADIUS * 0.45, -HEAD_RADIUS * 0.80, Y_HEAD, -1.9, 'stand', -1],
  [HEAD_CENTER_X + HEAD_RADIUS * 0.70, -HEAD_RADIUS * 0.12, Y_HEAD, 1.7, 'armsUp', -1],
  [ringX(-1.15), ringZ(-1.15), Y_ARC, 0.6, 'lean', -1],
  [ringX(1.35), ringZ(1.35), Y_ARC, -2.4, 'stand', -1],

  // --- back yards, a couple apiece, clear of every prop yards.ts puts there.
  //     The toppled ones live here and behind the fences, out of the street frames.
  [yx(0.32), yz(O, 0.18), Y_LAWN, 2.8, 'stand', -1],
  [yx(0.72), yz(O, 0.70), Y_LAWN, 1.6, 'fallen', -1],
  [yx(0.78), yz(W, 0.18), Y_LAWN, 0.4, 'sit', -1],
  [yx(0.72), yz(W, 0.88), Y_LAWN, -0.9, 'fallen', -1],

  // --- one on each rear deck, at upper-floor level, reading over the fence line
  [O.deckX + DECK_LEN * 0.22, O.side * (HOUSE_BACK + DECK_OUT * 0.45), DECK_Y, 3, 'stand', -1],
  [W.deckX - DECK_LEN * 0.22, W.side * (HOUSE_BACK + DECK_OUT * 0.45), DECK_Y, 0.2, 'armsUp', -1],

  // --- just outside the back fences, out on the apron
  [yx(0.30), -(BACK_FENCE + 1.9), Y_APRON, 2.6, 'stand', -1],
  [yx(0.68), -(BACK_FENCE + 2.9), Y_APRON, 3.3, 'lean', -1],
  [yx(0.36), BACK_FENCE + 2.2, Y_APRON, 0.5, 'armOut', -1],
  [yx(0.80), BACK_FENCE + 1.6, Y_APRON, -0.3, 'fallen', -1],

  // --- the plaza end of the stem
  [stx(0.13), O.side * PAVE_MID, Y_PAVE, 1.4, 'stand', -1],
  [stx(0.17), O.side * (PAVEMENT_OUTER + 1.6), Y_APRON, 1.9, 'sit', -1],
  [stx(0.10), W.side * PAVE_MID, Y_PAVE, -1.5, 'armsUp', 1],
  [stx(0.22), W.side * (PAVEMENT_OUTER + 2.4), Y_APRON, -1.1, 'stand', -1],
  [stx(0.05), W.side * (PAVEMENT_OUTER + 1.2), Y_APRON, 0.8, 'armOut', -1],

  // --- along the stem pavements between the plaza and the houses
  [stx(0.48), O.side * PAVE_MID, Y_PAVE, 2.7, 'lean', -1],
  [stx(0.53), O.side * KERB_EDGE, Y_PAVE, 3.5, 'stand', -1],
  [stx(0.66), W.side * PAVE_MID, Y_PAVE, -0.2, 'sit', -1],
  [stx(0.72), W.side * KERB_EDGE, Y_PAVE, -2.6, 'armOut', -1],
];

/** indices given a child-sized figure */
const CHILD = new Set([1, 7, 18, 26]);
const ADULT_H = 1.78;

// ================================================================= builder
export const buildMannequins: Builder = (ctx: BuildContext): BuildResult => {
  const { mat, rand } = ctx;
  const g = group('mannequins');

  // Unit primitives. TAP_UP is wide at its base (hips, limb roots), TAP_DN wide at its
  // top (torso tapering to the waist), SHIFT barely tapered so a 1960s dress falls
  // nearly straight instead of belling out.
  const HEAD = new Batch(new THREE.IcosahedronGeometry(0.5, 1));
  const JOINT = new Batch(new THREE.IcosahedronGeometry(0.5, 0));
  const CYL = new Batch(new THREE.CylinderGeometry(0.5, 0.5, 1, 10));
  const TAP_UP = new Batch(new THREE.CylinderGeometry(0.35, 0.5, 1, 8));
  const TAP_DN = new Batch(new THREE.CylinderGeometry(0.5, 0.35, 1, 8));
  const SHIFT = new Batch(new THREE.CylinderGeometry(0.44, 0.5, 1, 10));

  const SKIN = mat.painted(PAL.mannequin, 0.72, 0);
  const DISC = mat.painted(PAL.concreteDark, 0.88, 0);   // dull stand, never chrome
  const jitter = (a: number): number => a + (rand() - 0.5) * 0.12;

  for (let i = 0; i < PLACES.length; i++) {
    const [px, pz, py, yaw, poseName, wearIn] = PLACES[i];
    const pose = POSES[poseName];

    // Mostly dressed: a street of bare plastic reads as a warehouse, not a show town.
    let wear = wearIn;
    if (wear < 0) {
      const r = rand();
      wear = r < 0.20 ? BARE
        : r < 0.66 ? Math.floor(rand() * DRESS.length)
          : DRESS.length + Math.floor(rand() * SUIT.length);
    }
    const suit = wear >= DRESS.length && wear < BARE ? SUIT[wear - DRESS.length] : -1;
    const body = suit >= 0 ? mat.painted(suit, 0.62, 0.04) : SKIN;

    const H = ADULT_H * (CHILD.has(i) ? 0.62 + rand() * 0.10 : 0.94 + rand() * 0.12);
    _e.set(pose.tilt, yaw, pose.roll, 'YXZ');
    _root.compose(
      _p.set(px, py + pose.lift * H, pz), _q.setFromEuler(_e), _s.set(H, H, H));

    const o = pose.hipY - HIP_Y;   // whole upper body rides with the pelvis
    part(HEAD, SKIN, P.headW, P.headH, P.headD, 0, P.headY + o, 0);
    part(CYL, SKIN, P.neckD, P.neckH, P.neckD, 0, P.neckY + o, 0);
    part(TAP_DN, body, P.torW, P.torH, P.torD, 0, P.torY + o, 0);
    part(TAP_UP, body, P.pelW, P.pelH, P.pelD, 0, P.pelY + o, 0);

    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? -1 : 1;
      // arm: shoulder -> elbow -> wrist. Sleeves stay pale even under a suit.
      const sho = new THREE.Vector3(s * P.shoX, P.shoY + o, 0);
      part(JOINT, SKIN, P.shoD, P.shoD, P.shoD, sho.x, sho.y, sho.z);
      const aF = jitter(pose.armF[k]);
      const aS = s * jitter(pose.armS[k]);
      const elb = bone(TAP_UP, SKIN, sho, aF, aS, P.uarmL, P.uarmW);
      part(JOINT, SKIN, P.elbD, P.elbD, P.elbD, elb.x, elb.y, elb.z);
      bone(TAP_UP, SKIN, elb, aF + pose.elb[k], aS + s * pose.elbS[k], P.farmL, P.farmW);

      // leg: hip -> knee -> ankle -> foot, flat on the surface
      const hip = new THREE.Vector3(s * P.hipX, pose.hipY, 0);
      const lF = jitter(pose.legF[k]);
      const lS = s * jitter(pose.legS[k]);
      const knee = bone(TAP_UP, body, hip, lF, lS, P.thighL, P.thighW);
      part(JOINT, body, P.kneeD, P.kneeD, P.kneeD, knee.x, knee.y, knee.z);
      const ank = bone(TAP_UP, body, knee, lF - pose.knee[k], lS, P.calfL, P.calfW);
      part(JOINT, body, P.footW, P.footH, P.footD, ank.x, ank.y, ank.z - 0.022);
    }

    if (wear < DRESS.length) {
      const dh = P.dressTop - P.dressHem, dy = P.dressHem + dh / 2 + o;
      part(SHIFT, mat.painted(DRESS[wear], 0.74, 0), P.dressW, dh, P.dressD, 0, dy, 0);
    }
    // Small dull stand on paving, deck or apron; on grass a disc reads as a manhole.
    if (pose.base && py !== Y_LAWN) part(CYL, DISC, P.discD, P.discH, P.discD, 0, 0.007, 0);
  }

  HEAD.flush(g, 'mq-head');
  JOINT.flush(g, 'mq-joint');
  CYL.flush(g, 'mq-cyl');
  TAP_UP.flush(g, 'mq-up');
  TAP_DN.flush(g, 'mq-dn');
  SHIFT.flush(g, 'mq-dress');

  // No colliders: the mannequins are scenery you walk through, as yards.ts had them.
  return { group: g, colliders: [] as AABB[] };
};
