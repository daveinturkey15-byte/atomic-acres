/**
 * MANNEQUINS - the shop dummies that make this a nuclear test town and not a suburb.
 *
 * ONE figure factory, reused 14 times. Every part is a unit primitive pushed into a
 * per-geometry batch, so the population costs one InstancedMesh per geometry+material.
 *
 * FOURTEEN, NOT FORTY (owner, 2026-09-18: "way too many"). The count is not the point
 * on its own - forty figures spread evenly over a 90 m map is wallpaper, and wallpaper
 * that moves in your peripheral vision is worse than wallpaper. Nuketown 2025 puts its
 * dummies in a handful of places you remember: the family on a front lawn, a pair by a
 * porch, a queue at the stop, one toppled in a yard. Every entry in PLACES below now
 * names the reason it is there, and none of them stands in a lane a player runs, on a
 * door approach, or where a silhouette at head height reads as an enemy first and a
 * dummy second.
 *
 * The rig is built in the figure's OWN frame - feet at y=0, facing -z (the camera
 * convention in core/stations.ts), every length a fraction of the figure's height -
 * then multiplied by one root matrix carrying world position, yaw and the pose's
 * tilt/roll/lift. Arms and legs are a forward-kinematic chain: each bone hangs from
 * its joint, swung forward by rx and out to the side by rz. A pose is therefore a
 * TABLE OF ANGLES, never copy-pasted geometry.
 *
 * Placement dodges every parked vehicle, house, garage, fence, hedge and yard prop;
 * nothing stands on a garage apron, on a rear deck, or toppled on the carriageway.
 * `notOurs()` below re-checks that at build time rather than trusting this comment.
 *
 * COLLIDERS: one honest slab per figure, since 2026-09-19. There were none - inherited
 * from yards.ts, where the handful this module replaced had none either - and that is a
 * lie the moment a player walks through a figure, or takes cover behind one and the
 * round goes through it. A standing figure gets a 0.5 m post at its feet (0.38 m for a
 * child) the height of that figure; a toppled one gets a low box the length of the body,
 * laid along the yaw it fell on and centred on the BODY, not on the placement point.
 * The slab is the torso, not the outstretched arms: a raised arm is 60 mm of plastic and
 * collidng with it would read as an invisible wall.
 */
import * as THREE from 'three';
import type { AABB, BuildContext, Builder, BuildResult } from '../core/kit';
import { aabbSlab, group } from '../core/kit';
import { PAL } from '../core/palette';
import type { HouseSide } from '../core/layout';
import {
  BACK_FENCE, CANOPY_OUT, DECK_LEN, DECK_OUT, FRONT_LAWN_OUTER, HOUSE_BACK,
  HOUSE_HALF_LEN, KERB_HEIGHT, KERB_WIDTH, ORANGE, PAVEMENT_OUTER,
  ROAD_HALF_WIDTH, ROAD_X_MAX, ROAD_X_MIN, WHITE, YARD_X_MAX, YARD_X_MIN,
} from '../core/layout';

// ------------------------------------------------- surface y ladder (from ground.ts)
// A figure's feet sit ON the surface named. These must track the y-ladder comment at
// the top of src/build/ground.ts - the same contract vehicles.ts keeps for T_DRIVE.
const Y_PAVE = KERB_HEIGHT;           // straight pavement (T_PAVE)
const Y_LAWN = KERB_HEIGHT + 0.001;   // lawns and back yards (T_LAWN)

// ------------------------------------------------------------------ derived frame
const O = ORANGE, W = WHITE;
const PAVE_MID = (ROAD_HALF_WIDTH + KERB_WIDTH + PAVEMENT_OUTER) / 2;
const KERB_EDGE = ROAD_HALF_WIDTH + KERB_WIDTH + 0.45;   // just behind the kerb face
/** Waiting line at a stop: back from the kerb face, but NOT out in the crossing. */
const STOP_LINE = ROAD_HALF_WIDTH + KERB_WIDTH + 0.55;

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

// ------------------------------------------------------------------ region guard
/**
 * The map is split between three builders. The houses, the garage wings, the porch
 * pads and the rear decks / undercrofts / external stairs belong to the house
 * builders; this module may only dress the back yards, the front lawns, the street
 * and the plaza. Placements here are fractions of the MAP and the deck is a fraction
 * of the HOUSE, so the two drift apart every time layout.ts moves - which is exactly
 * how yards.ts once parked a crate store under a deck and inside a back door. Checked
 * once at build time over 14 entries; it costs nothing and it cannot rot silently.
 *
 * Local dimensions (not in layout.ts, named here per the lane contract):
 *   DECK_KEEP_HALF / DECK_KEEP_D - the rear-deck volume, half-length and depth
 *   PORCH_PAD_Z                  - |z| at which the porch pad starts and the lawn ends
 */
const DECK_KEEP_HALF = DECK_LEN / 2 + 0.5;
const DECK_KEEP_D = DECK_OUT + 1.0;
const PORCH_PAD_Z = FRONT_LAWN_OUTER - CANOPY_OUT;

/** null when (x, z) is ours to dress; otherwise whose it is. */
function notOurs(x: number, z: number): string | null {
  const az = Math.abs(z);
  if (az >= BACK_FENCE) return 'behind the back fence (perimeter)';
  if (az > HOUSE_BACK) {
    if (Math.abs(x) > YARD_X_MAX) return 'outside the yard edge (perimeter)';
    for (const h of [O, W]) {
      if (h.side * z > 0 && az <= HOUSE_BACK + DECK_KEEP_D
        && Math.abs(x - h.deckX) <= DECK_KEEP_HALF) return 'in a rear-deck volume (house)';
    }
    return null;                                          // a back yard
  }
  if (az >= PORCH_PAD_Z) return 'in a house / garage / porch footprint (house)';
  if (az > PAVEMENT_OUTER) {
    return Math.abs(x) > YARD_X_MAX ? 'outside the lawn edge (perimeter)' : null;
  }
  if (x < ROAD_X_MIN) return null;                        // the plaza, past the barrier
  return x > ROAD_X_MAX ? 'past the east apron (perimeter)' : null;
}

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
// applianceRed and applianceBlue came out of this list on 2026-09-18. They are the
// front-lawn appliance banks' two colours - the map's chirality anchor, one per lawn -
// and a dress in the same red standing on the same lawn is the one thing that can make
// that anchor ambiguous. The two sign colours are left: they belong to the show town's
// own signage, so a dressed dummy reads as part of the display.
const DRESS = [PAL.signMaroon, PAL.signTeal];
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
  // --- ORANGE FRONTAGE: the family group, and the only tableau on the map. EAST of
  //     the porch path (yards.ts leaves that gap open at x 1.8..4.0) so it breaks the
  //     look from the circle to the orange front door from the side instead of
  //     standing in it, and 4.4 m clear of the nearest of the six character figures
  //     main.ts spawns at (-6.5, -9.0) and (6.0, -6.0) - see the report. A dummy and
  //     an animated bot standing a metre apart in identical teal is the single worst
  //     thing either of them can do to the other.
  //     Moved east by 0.52 of a house half-length on 2026-09-19: with colliders on,
  //     the group stood across the orange verge at x 4.5..6.5 and traverse's verge
  //     scan dropped from 10.0 m of open boundary to 5.0 m - "this team is walled into
  //     its own half" territory, which the scan exists to catch. At x 8.3..9.9 the
  //     group sits behind the yards verge hedge (x 7.0..12.6), which already closes
  //     that stretch, so the tableau costs the crossing nothing.
  //     Spaced round the lawn tree at x 8.23..9.05 / z -10.93..-10.12 (a yards
  //     collider, 3.2 m tall) - the child stood inside it on the first placement.
  [hx(1.20), fz(O, 0.39), Y_LAWN, Math.PI, 'stand', -1],
  [hx(1.52), fz(O, 0.40), Y_LAWN, 2.72, 'armOut', -1],
  [hx(1.34), fz(O, 0.32), Y_LAWN, 3.02, 'stand', -1],      // the child

  // --- WHITE FRONTAGE: the couple. BESIDE the porch, not on it - the porch pad
  //     belongs to the house builder - clear of the white door path at x -4.0..-1.8,
  //     of the lawn tree at x 3.5, and of the character at (-2.0, 12.0). One more on
  //     the white drive so that half is not bare from the circle.
  [hx(0.20), fz(W, 0.63), Y_LAWN, -0.36, 'stand', -1],
  [hx(0.38), fz(W, 0.57), Y_LAWN, 2.88, 'lean', -1],
  //     The drive figure moved from hx(1.30) to hx(1.55) on 2026-09-19: at x 8.1..8.6
  //     it was the ONLY thing shutting the white verge at x 8, and that one position
  //     took the white boundary from 8.0 m of open crossing to 7.5. Two paces east it
  //     stands behind the drum pair, which already closes x 9.5..10.5.
  [hx(1.55), fz(W, 0.30), Y_LAWN, -1.15, 'stand', -1],

  // --- THE BUS STOP. Two waiting mid-pavement and one at the kerb with an arm up,
  //     on the orange stem pavement facing the coach on the bulb. yards.ts stands
  //     the stop sign at the same x, which is what makes the group read as a joke
  //     and not as three strangers loitering.
  //     The two waiting figures moved from mid-pavement to the STOP_LINE on
  //     2026-09-19: mid-pavement is the middle of the lawn-to-street crossing, and
  //     with colliders on they shut 2.5 m of the orange verge on their own. A figure
  //     waiting for a coach stands at the kerb anyway.
  //     The group also slid ~1.8 m WEST and spread from 0.71 m to 1.0 m apart. At
  //     stx 0.21..0.25 three 0.5 m boxes with 0.21 m between them were a wall across
  //     the pavement exactly where traverse's "west road stem" route crosses it
  //     (the leg (-7,-8.2) -> (-17.4,0) is on the footway between x -8.5 and -11.4),
  //     and the route went 9/10. West of x -11.9 that leg is already out on the road.
  [stx(0.200), O.side * STOP_LINE, Y_PAVE, Math.PI, 'stand', -1],
  [stx(0.144), O.side * STOP_LINE, Y_PAVE, 2.85, 'stand', 0],
  [stx(0.172), O.side * KERB_EDGE, Y_PAVE, 3.05, 'armsUp', -1],

  // --- one on the white pavement by the east apron, so the east half of the street
  //     has a figure in it and the long look down that pavement is broken once.
  [stx(0.80), W.side * PAVE_MID, Y_PAVE, -1.9, 'armOut', -1],

  // --- BACK YARDS, two apiece: a spawn dressing and a joke each. None within
  //     3.5 m of a deck, none on a fence hole, none on the 2.6 m flanking lanes.
  [yx(0.32), yz(O, 0.18), Y_LAWN, 2.8, 'stand', -1],       // beside the crate store
  // Toppled under the carport. Moved from yx(0.74) / yz(0.72) on 2026-09-19: once this
  // figure had the collider it had always been missing, its 1.8 m box lay across the
  // x = +7.1 back-fence hole's approach AND 90 mm into the grey trash can.
  [yx(0.86), yz(O, 0.63), Y_LAWN, 1.6, 'fallen', -1],      // toppled under the carport
  [yx(0.78), yz(W, 0.20), Y_LAWN, 0.4, 'lean', -1],        // hanging out the washing
  [yx(0.28), yz(W, 0.88), Y_LAWN, 0.3, 'stand', -1],       // deep, facing its own house
];

/** indices given a child-sized figure */
const CHILD = new Set([2]);
const ADULT_H = 1.78;

// ================================================================= builder
export const buildMannequins: Builder = (ctx: BuildContext): BuildResult => {
  const { mat, rand } = ctx;
  const g = group('mannequins');

  // Unit primitives. TAP_UP is wide at its base (hips, limb roots), TAP_DN wide at its
  // top (torso tapering to the waist), SHIFT barely tapered so a 1960s dress falls
  // nearly straight instead of belling out.
  // HEAD is detail-0: twenty broad facets catch the sun as flat chips, which is what
  // sells moulded plastic up close; detail-1 shaded smooth and read as skin.
  // HEAD and JOINT were two Batches over an IDENTICAL geometry, so every material
  // they shared paid for two InstancedMeshes instead of one. Same batch now.
  const JOINT = new Batch(new THREE.IcosahedronGeometry(0.5, 0));
  const HEAD = JOINT;
  const CYL = new Batch(new THREE.CylinderGeometry(0.5, 0.5, 1, 10));
  const TAP_UP = new Batch(new THREE.CylinderGeometry(0.35, 0.5, 1, 8));
  const TAP_DN = new Batch(new THREE.CylinderGeometry(0.5, 0.35, 1, 8));
  const SHIFT = new Batch(new THREE.CylinderGeometry(0.44, 0.5, 1, 10));

  // Region guard, once, before anything is placed. Reported rather than dropped: a
  // figure silently removed is a hole nobody can see, and the point of the check is
  // to catch layout.ts moving under the table, not to paper over it.
  const strays = PLACES
    .map((p, i) => ({ i, why: notOurs(p[0], p[1]) }))
    .filter((r) => r.why !== null);
  if (strays.length) {
    console.warn('[mannequins] %d figure(s) outside this module\'s region: %s',
      strays.length, strays.map((r) => `#${r.i} ${r.why}`).join('; '));
  }

  const colliders: AABB[] = [];
  const SKIN = mat.painted(PAL.mannequin, 0.72, 0);
  // Bare limbs run one step darker/richer than the torso so the two read as separate
  // pressings; SEAM is the same warm-grey family sunk to a groove tone for the waist
  // parting and bare wig-blocks. Painted singletons only - new uniform sets, no new
  // programs.
  const LIMB = mat.painted(PAL.sand, 0.72, 0);
  const SEAM = mat.painted(PAL.concreteDark, 0.62, 0);
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
    const bare = wear === BARE;
    const limbA = bare ? LIMB : SKIN;    // arms stay pale sleeves under cloth
    const legMat = bare ? LIMB : body;   // legs follow the suit when suited

    const H = ADULT_H * (CHILD.has(i) ? 0.62 + rand() * 0.10 : 0.94 + rand() * 0.12);
    _e.set(pose.tilt, yaw, pose.roll, 'YXZ');
    _root.compose(
      _p.set(px, py + pose.lift * H, pz), _q.setFromEuler(_e), _s.set(H, H, H));

    // One honest slab. A toppled figure's body lies along the yawed local +z from its
    // feet, so its box is centred half a body-length down that direction - centring it
    // on the placement point would put half the collider behind the figure's heels.
    const cw = CHILD.has(i) ? 0.38 : 0.5;
    if (poseName === 'fallen') {
      const sx = Math.sin(yaw), sz = Math.cos(yaw);
      colliders.push(aabbSlab(px + sx * H * 0.48, py, pz + sz * H * 0.48,
        H * Math.abs(sx) + cw * Math.abs(sz), 0.45, H * Math.abs(sz) + cw * Math.abs(sx)));
    } else {
      colliders.push(aabbSlab(px, py, pz, cw, H * (pose.base ? 1.0 : 0.62), cw));
    }

    const o = pose.hipY - HIP_Y;   // whole upper body rides with the pelvis
    part(HEAD, SKIN, P.headW, P.headH, P.headD, 0, P.headY + o, 0);
    // Wig-block crown: a flattened cap sunk into the skull top, cloth-toned when
    // dressed or suited, groove-toned on bare plastic.
    const crown = wear < DRESS.length ? mat.painted(DRESS[wear], 0.74, 0)
      : suit >= 0 ? body : SEAM;
    part(CYL, crown, P.headW * 0.78, 0.035, P.headD * 0.78,
      0, P.headY + o + P.headH / 2 - 0.008, 0);
    part(CYL, SKIN, P.neckD, P.neckH, P.neckD, 0, P.neckY + o, 0);
    part(TAP_DN, body, P.torW, P.torH, P.torD, 0, P.torY + o, 0);
    part(TAP_UP, body, P.pelW, P.pelH, P.pelD, 0, P.pelY + o, 0);
    // Waist parting: a thin groove ring where the torso pressing meets the pelvis.
    // Slightly proud of the TAP_DN waist so it never z-fights; hides under dresses.
    part(CYL, SEAM, P.torW * 0.78, 0.014, P.torD * 0.78,
      0, P.torY - P.torH / 2 + 0.012 + o, 0);

    for (let k = 0; k < 2; k++) {
      const s = k === 0 ? -1 : 1;
      // arm: shoulder -> elbow -> wrist. Sleeves stay pale even under a suit.
      const sho = new THREE.Vector3(s * P.shoX, P.shoY + o, 0);
      part(JOINT, limbA, P.shoD, P.shoD, P.shoD, sho.x, sho.y, sho.z);
      // Shoulder collar: a thin disc through the ball, limb-toned against the torso.
      part(CYL, limbA, P.shoD * 1.18, 0.022, P.shoD * 1.18, sho.x, sho.y, sho.z);
      const aF = jitter(pose.armF[k]);
      const aS = s * jitter(pose.armS[k]);
      const elb = bone(TAP_UP, limbA, sho, aF, aS, P.uarmL, P.uarmW);
      part(JOINT, limbA, P.elbD, P.elbD, P.elbD, elb.x, elb.y, elb.z);
      bone(TAP_UP, limbA, elb, aF + pose.elb[k], aS + s * pose.elbS[k], P.farmL, P.farmW);

      // leg: hip -> knee -> ankle -> foot, flat on the surface
      const hip = new THREE.Vector3(s * P.hipX, pose.hipY, 0);
      // Hip collar where the thigh root leaves the pelvis, leg-toned either way.
      part(CYL, legMat, P.thighW * 1.18, 0.022, P.thighW * 1.18, hip.x, hip.y, hip.z);
      const lF = jitter(pose.legF[k]);
      const lS = s * jitter(pose.legS[k]);
      const knee = bone(TAP_UP, legMat, hip, lF, lS, P.thighL, P.thighW);
      part(JOINT, legMat, P.kneeD, P.kneeD, P.kneeD, knee.x, knee.y, knee.z);
      const ank = bone(TAP_UP, legMat, knee, lF - pose.knee[k], lS, P.calfL, P.calfW);
      part(JOINT, legMat, P.footW, P.footH, P.footD, ank.x, ank.y, ank.z - 0.022);
    }

    if (wear < DRESS.length) {
      const dh = P.dressTop - P.dressHem, dy = P.dressHem + dh / 2 + o;
      part(SHIFT, mat.painted(DRESS[wear], 0.74, 0), P.dressW, dh, P.dressD, 0, dy, 0);
    }
    // Small dull stand on paving, deck or apron; on grass a disc reads as a manhole.
    if (pose.base && py !== Y_LAWN) part(CYL, DISC, P.discD, P.discH, P.discD, 0, 0.007, 0);
  }

  JOINT.flush(g, 'mq-ico');   // heads and joints, one batch
  CYL.flush(g, 'mq-cyl');
  TAP_UP.flush(g, 'mq-up');
  TAP_DN.flush(g, 'mq-dn');
  SHIFT.flush(g, 'mq-dress');

  // Self-check: two figures inside each other. Reported, never dropped - a collider
  // removed here leaves a solid-looking figure you walk through, the exact bug the
  // slabs were added to end.
  const pairs: AABB[] = [];
  for (let i = 0; i < colliders.length; i++) {
    for (let j = i + 1; j < colliders.length; j++) {
      const a = colliders[i], b = colliders[j];
      if (Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x) <= 0.02) continue;
      if (Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z) <= 0.02) continue;
      pairs.push(a, b);
    }
  }
  if (pairs.length) {
    console.warn('[mannequins] %d figure collider(s) interpenetrate another figure: %s',
      pairs.length, pairs.map((c) => `x ${c.min.x.toFixed(1)}..${c.max.x.toFixed(1)} `
        + `z ${c.min.z.toFixed(1)}..${c.max.z.toFixed(1)}`).join(' | '));
  }
  return { group: g, colliders };
};
