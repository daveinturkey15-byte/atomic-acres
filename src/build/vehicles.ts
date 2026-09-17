/**
 * VEHICLES - the Nuketown 2025 street fleet.
 *
 * 1950s/60s American iron in a retro-futurist show town: heavy chrome, whitewall
 * tyres, wraparound screens. Every one is a cover object, so silhouette and a
 * solid collider beat panel detail.
 *
 * References: NT07 (cream/maroon intercity coach, chrome belt, riveted panels,
 * "Nuketown" in script along the flank - a 1950s Greyhound-style coach, NOT a
 * school bus and NOT a modern transit bus), NT05 (the teal classic on its plinth
 * belongs to plaza.ts; this module must not stand a second one in the road),
 * NT02 aerial (coach, box truck and a saloon standing ON the turning head).
 *
 * The coach hull is a LOFT, not a swept slab: a rounded forward-raked nose, a
 * roofline curving down into it and tumblehome flanks are what separate a coach
 * from a city bus, and none of them survive a constant-section extrusion.
 * Everything is authored nose-along-local-+x and yawed into place, so wheel
 * cylinders are rotated about X (flat faces sideways, axle along z).
 */
import * as THREE from 'three';
import type { AABB, BuildContext, Builder } from '../core/kit';
import { aabbSlab, box, extrude, group } from '../core/kit';
import { PAL } from '../core/palette';
import {
  FRONT_LAWN_OUTER, GARAGE_LEN, HEAD_CENTER_X, HEAD_RADIUS,
  HOUSE_HALF_LEN, KERB_HEIGHT, ORANGE, PAVEMENT_OUTER, ROAD_HALF_WIDTH, WHITE,
} from '../core/layout';

/** tyres rest here; the road surface is essentially y=0 */
const WHEEL_REST = 0.02;
/** local +x is the nose, so facing down the stem toward -x is a half turn */
const NOSE_DOWN_STEM = Math.PI;
/** clear asphalt demanded outside the widest corner of anything on the bulb */
const BULB_MARGIN = 1.15;
/**
 * How far a single collider box may reach past the body it wraps, measured
 * perpendicular to the body's own length axis. A box fitted to a ROTATED
 * vehicle overshoots by (segment length / 2) * |sin 2*yaw| on each side, which
 * is why one AABB per vehicle walled off the turning head: the coach sits at
 * 25 degrees, so an 11.6 m body claimed 7.5 m of z while being 2.9 m wide.
 * Segment the body until the overshoot is under this, capped so an almost
 * square-parked vehicle never pays for boxes it does not need.
 */
const SEG_OVERHANG = 0.35;
const SEG_MAX = 6;

/**
 * Big brightwork - bumpers, grilles, spears, arches, hubcaps. world.ts now
 * provides a PMREM environment map, so `ctx.mat.chrome` (metalness 0.95)
 * reflects properly and suits hero parts (coach front bumper, mirror heads,
 * grille slats). Large flat trim faces still use this low-metal polish off the
 * same palette entry - it holds its value in shade where a full metal goes
 * dark. Small dark seams (mullions, rivets) keep the real chrome, where
 * near-black is right anyway.
 */
function brightwork(ctx: BuildContext): THREE.Material {
  return ctx.mat.painted(PAL.chrome, 0.24, 0.4);
}

type Pt = [number, number];

interface Vehicle {
  obj: THREE.Group;
  /** along the nose axis, bumper to bumper */
  len: number;
  /** across the body, over the wheel arches */
  wid: number;
  /** roof height above the road */
  hgt: number;
}

// ------------------------------------------------------------------ helpers

function xform(x: number, y: number, z: number, rx = 0, ry = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, 0)),
    new THREE.Vector3(1, 1, 1),
  );
}

function inst(
  geo: THREE.BufferGeometry, mat: THREE.Material, xf: THREE.Matrix4[],
): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, xf.length);
  for (let i = 0; i < xf.length; i++) m.setMatrixAt(i, xf[i]);
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();   // instances sit metres off the geometry origin
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A bar bent to the plan radius of a rounded nose or tail - bumpers, screen frame. */
function arcBar(radius: number, tube: number, span: number): THREE.BufferGeometry {
  const geo = new THREE.TorusGeometry(radius, tube, 6, 18, span);
  geo.rotateZ(-span / 2);      // centre the sweep on the +x axis
  geo.rotateX(-Math.PI / 2);   // lay it flat, apex forward
  return geo;
}

/**
 * Whitewall wheels: black tyre, white wall, dark rim, domed chrome hubcap - five
 * instanced draws whatever the count. The old version was a pale disc with a
 * chrome centre of the same value, so it read as a white doughnut with no hub at
 * all; these rings are sized to survive a 20 m read.
 */
function wheels(
  g: THREE.Group, ctx: BuildContext,
  xs: number[], zHalf: number, r: number, w: number,
): void {
  const hubs: THREE.Matrix4[] = [];
  const caps: THREE.Matrix4[] = [];
  const arches: THREE.Matrix4[] = [];
  for (const x of xs) {
    for (const s of [-1, 1]) {
      hubs.push(xform(x, WHEEL_REST + r, s * zHalf, Math.PI / 2));
      // the dome has to face OUT of each flank, so its spin axis flips with the side
      caps.push(xform(x, WHEEL_REST + r, s * zHalf, s * Math.PI / 2));
      arches.push(xform(x, WHEEL_REST + r, s * (zHalf + w * 0.52)));
    }
  }
  // each ring stands slightly proud of the one outside it, so nothing z-fights
  g.add(inst(new THREE.CylinderGeometry(r, r, w, 18),
    ctx.mat.painted(PAL.truckCab, 0.94, 0), hubs));
  g.add(inst(new THREE.CylinderGeometry(r * 0.84, r * 0.84, w * 1.04, 18),
    ctx.mat.painted(PAL.truckWhite, 0.62, 0), hubs));
  g.add(inst(new THREE.CylinderGeometry(r * 0.60, r * 0.60, w * 1.08, 16),
    ctx.mat.painted(PAL.asphalt, 0.55, 0.25), hubs));
  // sidewall bead: a dark torus flat against the outer tyre face, so the
  // whitewall reads as paint on a tyre rather than a pale disc. The torus
  // already lies in the wheel plane (axle along z), hence no rotation.
  const bead = new THREE.TorusGeometry(r * 0.92, r * 0.055, 6, 20);
  const beads: THREE.Matrix4[] = [];
  for (const x of xs) {
    for (const s of [-1, 1]) beads.push(xform(x, WHEEL_REST + r, s * (zHalf + w * 0.53)));
  }
  g.add(inst(bead, ctx.mat.painted(PAL.truckCab, 0.9, 0), beads));
  const dome = new THREE.SphereGeometry(r * 0.46, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.52);
  dome.scale(1, 0.55, 1);
  dome.translate(0, w * 0.56, 0);
  g.add(inst(dome, ctx.mat.painted(PAL.chrome, 0.18, 0.28), caps));
  g.add(inst(new THREE.TorusGeometry(r * 1.10, r * 0.11, 6, 16, Math.PI),
    brightwork(ctx), arches));
}

/**
 * A row of round headlamps with real depth: a dark socket buried in the nose,
 * a bright bezel standing proud of it, and a pale lens domed slightly forward
 * of the bezel so it catches the sun instead of reading as paint. The whole
 * stack spans x +/- 0.08 - park the call x so the socket sits inside the panel
 * and the lens hoods forward of it.
 */
function lamps(
  g: THREE.Group, ctx: BuildContext,
  x: number, y: number, zs: number[], r: number,
): void {
  const dark = ctx.mat.painted(PAL.truckCab, 0.6, 0.2);
  const socket = new THREE.CylinderGeometry(r * 1.14, r * 1.14, 0.06, 12);
  socket.rotateZ(Math.PI / 2);
  g.add(inst(socket, dark, zs.map((z) => xform(x - 0.05, y, z, 0))));
  const bez = new THREE.CylinderGeometry(r, r, 0.12, 12);
  bez.rotateZ(Math.PI / 2);
  g.add(inst(bez, brightwork(ctx), zs.map((z) => xform(x, y, z, 0))));
  const lens = new THREE.CylinderGeometry(r * 0.76, r * 0.62, 0.08, 12);
  lens.rotateZ(Math.PI / 2);
  g.add(inst(lens, ctx.mat.painted(PAL.windowBand, 0.12, 0.3),
    zs.map((z) => xform(x + 0.04, y, z, 0))));
}

/**
 * Round red tail lights reusing the lamp depth trick: dark socket, bright
 * bezel, red lens rearward. `x` is the tail face, lenses point -x.
 */
function tailLamps(
  g: THREE.Group, ctx: BuildContext,
  x: number, y: number, zs: number[], r: number,
): void {
  const dark = ctx.mat.painted(PAL.truckCab, 0.6, 0.2);
  const socket = new THREE.CylinderGeometry(r * 1.14, r * 1.14, 0.06, 12);
  socket.rotateZ(Math.PI / 2);
  g.add(inst(socket, dark, zs.map((z) => xform(x + 0.05, y, z, 0))));
  const bez = new THREE.CylinderGeometry(r, r, 0.12, 12);
  bez.rotateZ(Math.PI / 2);
  g.add(inst(bez, brightwork(ctx), zs.map((z) => xform(x, y, z, 0))));
  const lens = new THREE.CylinderGeometry(r * 0.76, r * 0.62, 0.08, 12);
  lens.rotateZ(Math.PI / 2);
  g.add(inst(lens, ctx.mat.painted(PAL.applianceRed, 0.28, 0.15),
    zs.map((z) => xform(x - 0.04, y, z, 0))));
}
// ------------------------------------------------------------------ the coach

/**
 * Coach cross section, bottom centre up the +z flank to the roof centre. `u` is
 * a fraction of the rib half width, `v` of its height. The squeeze above v=0.5
 * is the tumblehome; the flat run at v=1 is the roof.
 */
const COACH_SECTION: Pt[] = [
  [0.000, 0.000], [0.550, 0.000], [0.840, 0.012], [0.960, 0.055],
  [1.000, 0.140], [1.000, 0.330], [0.998, 0.520], [0.990, 0.680],
  [0.972, 0.800], [0.930, 0.885], [0.840, 0.945], [0.640, 0.985],
  [0.380, 1.000], [0.000, 1.000],
];

/**
 * Longitudinal ribs: [x at the belt, x at the roof, x at the skirt, half width,
 * skirt y, roof y]. Three x values per rib is what buys the raked nose - the
 * roof of the nose ribs sits 0.36 m BEHIND their belt, so the roofline curves
 * down and back into a crowned front instead of standing up as a slab. Every
 * column must increase toward the nose or the hull turns itself inside out.
 */
type Rib = [number, number, number, number, number, number];
const COACH_RIBS: Rib[] = [
  [-5.62, -5.30, -5.44, 0.10, 0.90, 2.78],
  [-5.52, -5.22, -5.36, 0.80, 0.80, 2.98],
  [-5.30, -5.12, -5.22, 1.16, 0.68, 3.13],
  [-4.90, -4.84, -4.88, 1.27, 0.59, 3.21],
  [-3.70, -3.70, -3.70, 1.30, 0.56, 3.25],
  [2.70, 2.70, 2.70, 1.30, 0.56, 3.25],
  [4.30, 4.16, 4.24, 1.30, 0.57, 3.24],
  [5.00, 4.74, 4.84, 1.27, 0.60, 3.19],
  [5.36, 5.02, 5.10, 1.16, 0.64, 3.10],
  [5.56, 5.20, 5.26, 0.94, 0.70, 3.00],
  [5.66, 5.30, 5.34, 0.56, 0.78, 2.88],
  [5.70, 5.34, 5.38, 0.10, 0.86, 2.76],
];
const MID_RIB = COACH_RIBS[4];
const NOSE_RIB = COACH_RIBS[COACH_RIBS.length - 1];

/** 0 at and below the belt, 1 at the roof - drives the raked, crowned nose. */
const roofPull = (v: number): number => Math.pow(Math.max(0, (v - 0.40) / 0.60), 1.45);
/** 1 at the skirt, 0 at the belt - drives the tucked valance under the bumper. */
const skirtPull = (v: number): number => Math.pow(Math.max(0, (0.30 - v) / 0.30), 1.30);

function ribPoint(r: Rib, u: number, v: number): THREE.Vector3 {
  return new THREE.Vector3(
    r[0] + (r[1] - r[0]) * roofPull(v) + (r[2] - r[0]) * skirtPull(v),
    r[4] + (r[5] - r[4]) * v,
    r[3] * u,
  );
}

/** Half width of the parallel mid body at height y - i.e. where the trim goes. */
function flankHalf(y: number): number {
  const v = Math.min(1, Math.max(0, (y - MID_RIB[4]) / (MID_RIB[5] - MID_RIB[4])));
  const s = COACH_SECTION;
  for (let i = 1; i < s.length; i++) {
    if (v <= s[i][1]) {
      const span = s[i][1] - s[i - 1][1];
      const t = span > 0 ? (v - s[i - 1][1]) / span : 0;
      return MID_RIB[3] * (s[i - 1][0] + (s[i][0] - s[i - 1][0]) * t);
    }
  }
  return 0;
}

/** x of the nose centre line at height y - where screen, grille and blind land. */
function noseX(y: number): number {
  const v = Math.min(1, Math.max(0, (y - NOSE_RIB[4]) / (NOSE_RIB[5] - NOSE_RIB[4])));
  return ribPoint(NOSE_RIB, 0, v).x;
}

/** Sweep the section down the ribs into one closed hull - a single draw call. */
function loftHull(): THREE.BufferGeometry {
  // close the loop: the authored half, then its mirror back down
  const loop = COACH_SECTION.slice();
  for (let i = COACH_SECTION.length - 2; i >= 1; i--) {
    loop.push([-COACH_SECTION[i][0], COACH_SECTION[i][1]]);
  }
  const n = loop.length;
  const pos: number[] = [];
  const idx: number[] = [];
  const put = (p: THREE.Vector3): number => {
    pos.push(p.x, p.y, p.z);
    return pos.length / 3 - 1;
  };
  const ring = COACH_RIBS.map((r) => loop.map(([u, v]) => put(ribPoint(r, u, v))));
  for (let i = 0; i < ring.length - 1; i++) {
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      idx.push(ring[i][k], ring[i + 1][k], ring[i + 1][k2]);
      idx.push(ring[i][k], ring[i + 1][k2], ring[i][k2]);
    }
  }
  // Cap both ends onto a point ON the nose profile, not on the ring centroid:
  // a centroid apex sits behind the belt and dishes the middle of the face in.
  for (const end of [0, ring.length - 1]) {
    const apex = put(ribPoint(COACH_RIBS[end], 0, 0.5));
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      if (end === 0) idx.push(apex, ring[end][k], ring[end][k2]);
      else idx.push(apex, ring[end][k2], ring[end][k]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** NT07: cream body, maroon swoosh, chrome belt, split screen, six wheels. */
function makeCoach(ctx: BuildContext): Vehicle {
  const g = group('coach');
  const trim = brightwork(ctx);
  const maroon = ctx.mat.painted(PAL.coachMaroon, 0.42, 0.2);
  const glazing = ctx.mat.windowDark;

  const hull = new THREE.Mesh(loftHull(), ctx.mat.painted(PAL.coachCream, 0.5, 0.12));
  hull.castShadow = true;
  hull.receiveShadow = true;
  g.add(hull);

  // the maroon swoosh: one slab proud of each flank shows on both sides. It stops
  // short of both ends, where the hull turns in faster than a constant sweep can.
  g.add(extrude([
    [-5.00, 0.95], [-0.60, 0.95], [3.00, 1.48], [4.90, 1.55],
    [4.90, 1.90], [3.00, 1.83], [-0.60, 1.30], [-5.00, 1.30],
  ], 2 * (flankHalf(1.40) + 0.030), maroon));

  // chrome belt and rocker trim, proud of the swoosh as well as the hull
  g.add(box(9.6, 0.08, 2 * (flankHalf(1.95) + 0.050), trim, -0.20, 1.95, 0));
  g.add(box(9.5, 0.07, 2 * (flankHalf(0.80) + 0.020), trim, -0.15, 0.80, 0));

  // Side glazing and its mullions follow the tumblehome, so they are authored as
  // a cross section swept along the coach. A plain box would be flush at the belt
  // and burst 6 cm out of the hull at the top of the band.
  const bandSec = (pad: number): Pt[] => {
    const h = (y: number): number => flankHalf(y) + pad;
    return [
      [-h(2.05), 2.05], [h(2.05), 2.05], [h(2.45), 2.45],
      [h(2.82), 2.82], [-h(2.82), 2.82], [-h(2.45), 2.45],
    ];
  };
  const band = extrude(bandSec(0.012), 8.2, glazing);
  band.rotation.y = Math.PI / 2;
  band.position.x = -0.35;
  g.add(band);
  const mullGeo = extrude(bandSec(0.030), 0.07, ctx.mat.chrome).geometry;
  mullGeo.rotateY(Math.PI / 2);
  const mull: THREE.Matrix4[] = [];
  for (let i = 0; i < 9; i++) mull.push(xform(-4.25 + i * 0.98, 0, 0));
  g.add(inst(mullGeo, ctx.mat.chrome, mull));

  // riveted panel seams: two rows of alloy rivets through both flanks
  const rivets: THREE.Matrix4[] = [];
  const rivet = new THREE.CylinderGeometry(0.026, 0.026, 2 * (flankHalf(1.83) + 0.05), 6);
  for (let i = 0; i < 20; i++) {
    const x = -4.6 + i * 0.47;
    rivets.push(xform(x, 1.83, 0, Math.PI / 2));
    rivets.push(xform(x, 0.92, 0, Math.PI / 2));
  }
  g.add(inst(rivet, ctx.mat.chrome, rivets));

  // NT07's single most identifying detail: "Nuketown" in signwriter's script
  // along the flank. One instanced plane per side; the -z copy is turned about y
  // so the word runs left-to-right for a viewer standing on either flank.
  const scriptW = 2.9;
  const scriptZ = flankHalf(1.62) + 0.055;
  const script = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(scriptW, scriptW / 4.5),
    ctx.mat.signText({ text: 'Nuketown', color: PAL.coachMaroon, aspect: 4.5, script: true }),
    2,
  );
  script.setMatrixAt(0, xform(-2.65, 1.62, scriptZ));
  script.setMatrixAt(1, xform(-2.65, 1.62, -scriptZ, 0, Math.PI));
  script.instanceMatrix.needsUpdate = true;
  script.computeBoundingSphere();
  g.add(script);   // no castShadow: the shadow map ignores the alpha cut-out

  // SPLIT windscreen, high over the grille, on a chrome centre pillar. One
  // full-width pane was the loudest "modern transit bus" tell on the old body.
  const sillY = 1.92;
  const headY = 2.64;
  const scrY = (sillY + headY) / 2;
  const rake = Math.atan2(noseX(sillY) - noseX(headY), headY - sillY);
  const scrH = Math.hypot(noseX(sillY) - noseX(headY), headY - sillY) - 0.06;
  for (const s of [-1, 1]) {
    const pane = box(0.06, scrH, 0.84, glazing, noseX(scrY) - 0.02, scrY, s * 0.52);
    pane.rotation.set(0, -s * 0.15, rake);   // Z first, then Y: rake, then plan sweep
    g.add(pane);
  }
  const pillar = box(0.07, scrH + 0.08, 0.12, trim, noseX(scrY) + 0.012, scrY, 0);
  pillar.rotation.z = rake;
  g.add(pillar);
  // sill and header curved to the nose's plan radius rather than cutting it
  const frame = arcBar(2.2, 0.045, 0.893);
  g.add(inst(frame, trim, [
    xform(noseX(sillY - 0.05) + 0.03 - 2.2, sillY - 0.05, 0),
    xform(noseX(headY + 0.05) + 0.03 - 2.2, headY + 0.05, 0),
  ]));

  // destination blind box in the roof fascia above the screen. It has to stay
  // narrow: the crown pulls in fast above the header and a full-width blind
  // would hang off the sides of the hull.
  g.add(box(0.09, 0.24, 1.30, trim, 5.315, 2.80, 0));
  g.add(box(0.08, 0.17, 1.15, ctx.mat.signText({
    text: 'NUKETOWN', color: PAL.windowBand, background: PAL.truckCab, aspect: 6.8,
  }), 5.340, 2.80, 0));

  // Chrome grille, ordered front to back: bars, dark throat, then a surround
  // wide enough to read as a frame and thick enough to bury its back edge in the
  // curved nose. Nesting the throat INSIDE the surround - the first attempt -
  // rendered one blank chrome slab.
  g.add(box(0.12, 0.42, 1.50, trim, 5.625, 1.28, 0));
  g.add(box(0.07, 0.32, 1.36, ctx.mat.painted(PAL.truckCab, 0.6, 0.2), 5.675, 1.28, 0));
  const slats: THREE.Matrix4[] = [];
  for (let i = 0; i < 5; i++) slats.push(xform(5.705, 1.15 + i * 0.065, 0));
  g.add(inst(new THREE.BoxGeometry(0.05, 0.032, 1.30), trim, slats));
  // twin lamps seated on the nose plan curvature (surface runs ~5.50 at this
  // span, so the socket buries and the lens hoods forward of it). A 4-lamp
  // row does not fit: the grille already owns the middle 1.5 m.
  lamps(g, ctx, 5.50, 1.32, [-1.00, 1.00], 0.19);

  // bumpers, bent to the plan radius so they hug the rounded nose and tail.
  // The nose bumper is real chrome - it now has an env map to reflect - with
  // a dark rubber shadow-gap arc under it, so it separates from the cream at
  // distance; the tail bumper is darker steel.
  const shadowGap = ctx.mat.painted(PAL.truckCab, 0.7, 0.1);
  g.add(inst(arcBar(2.2, 0.115, 1.05), ctx.mat.chrome, [
    xform(5.62 - 2.2, 1.00, 0),
  ]));
  g.add(inst(arcBar(2.2, 0.05, 1.0), shadowGap, [
    xform(5.60 - 2.2, 0.855, 0),
  ]));
  g.add(inst(arcBar(2.2, 0.115, 1.05), ctx.mat.steel, [
    xform(-5.52 + 2.2, 1.00, 0, 0, Math.PI),
  ]));
  // rear screen, set into the tail crown
  g.add(box(0.08, 0.72, 1.50, glazing, -5.50, 2.30, 0));
  // four round tail lights across the tail, clear of the rear screen. The tail
  // face runs about -5.46 inboard to -5.39 outboard at this height.
  tailLamps(g, ctx, -5.44, 1.15, [-0.95, -0.65, 0.65, 0.95], 0.10);

  // entry door on the right (+z) flank just ahead of the front axle: cream
  // leaf proud of the swoosh, dark seams bridging the panel gap, a glazing
  // drop and a chrome handle. Kept on the parallel mid-body (hull 1.30) so
  // the leaf never stands off the nose turn-in.
  const cream = ctx.mat.painted(PAL.coachCream, 0.5, 0.12);
  g.add(box(0.90, 1.38, 0.04, cream, 4.10, 1.31, 1.315));
  g.add(box(0.60, 0.40, 0.045, glazing, 4.10, 1.72, 1.33));
  g.add(inst(new THREE.BoxGeometry(0.035, 1.44, 0.045), shadowGap, [
    xform(3.63, 1.31, 1.33), xform(4.57, 1.31, 1.33),
  ]));
  g.add(box(0.94, 0.035, 0.045, shadowGap, 4.10, 2.03, 1.33));
  g.add(box(0.16, 0.045, 0.05, trim, 4.47, 1.28, 1.345));

  // wing mirrors flanking the split screen: each stalk rises from a sill-frame
  // end (5.45, 1.55, +/-0.96), so base and head are one connected fitting with
  // a chrome head and its glass facing the driver (-x)
  for (const s of [-1, 1]) {
    g.add(box(0.05, 0.76, 0.05, shadowGap, 5.446, 1.93, s * 0.955));
    g.add(box(0.06, 0.26, 0.16, ctx.mat.chrome, 5.476, 2.38, s * 0.99));
    g.add(box(0.02, 0.22, 0.12, glazing, 5.44, 2.38, s * 0.99));
  }
  // wipers parked at an angle on each screen pane
  for (const s of [-1, 1]) {
    const wiper = box(0.025, 0.55, 0.03, shadowGap, 5.565, 2.18, s * 0.52);
    wiper.rotation.set(0, -s * 0.15, s * 0.38);
    g.add(wiper);
  }
  // roof pods: low luggage/vent boxes riding the flat mid roofline
  for (const [px, pl] of [[-1.6, 1.3], [1.2, 1.0]] as [number, number][]) {
    g.add(box(pl + 0.04, 0.03, 0.59, shadowGap, px, 3.265, 0));
    g.add(box(pl, 0.10, 0.55, cream, px, 3.33, 0));
  }
  // luggage-bay hatches along both skirts: dark frame bedded in the hull with
  // a cream leaf proud of it (hull runs 1.13 here, so both bury their backs)
  const hatchX = [-3.4, -1.2, 1.0];
  const hatchDark: THREE.Matrix4[] = [];
  const hatchLeaf: THREE.Matrix4[] = [];
  for (const hx of hatchX) {
    for (const s of [-1, 1]) {
      hatchDark.push(xform(hx, 0.62, s * 1.132));
      hatchLeaf.push(xform(hx, 0.62, s * 1.138));
    }
  }
  g.add(inst(new THREE.BoxGeometry(1.50, 0.50, 0.020), shadowGap, hatchDark));
  g.add(inst(new THREE.BoxGeometry(1.44, 0.44, 0.024), cream, hatchLeaf));
  // plates ride the bumper faces, exhaust tucked under the tail
  const plateMat = ctx.mat.signText({
    text: 'NT07', color: PAL.truckCab, background: PAL.windowBand, aspect: 2.4,
  });
  g.add(box(0.05, 0.18, 0.44, plateMat, 5.72, 1.00, 0));
  g.add(box(0.05, 0.18, 0.44, plateMat, -5.61, 1.00, 0));
  const stack = new THREE.CylinderGeometry(0.055, 0.055, 0.5, 10);
  stack.rotateZ(Math.PI / 2);
  const stackMesh = new THREE.Mesh(stack, shadowGap);
  stackMesh.position.set(-5.45, 0.30, -0.85);
  g.add(stackMesh);

  wheels(g, ctx, [3.55, -2.95, -4.45], 1.22, 0.54, 0.30);
  return { obj: g, len: 11.6, wid: 2.87, hgt: 3.40 };
}
// ------------------------------------------------------------------ box truck

/** White box body on a dark snub-nose cab. ~8 x 2.45 x 3.1 m. */
function makeBoxTruck(ctx: BuildContext): Vehicle {
  const L = 8.0, W = 2.45, H = 3.1;
  const g = group('box-truck');
  const trim = brightwork(ctx);
  // pale rib/lip alloy: low metalness so the box still reads white in shade
  const alloy = ctx.mat.painted(PAL.steel, 0.55, 0.12);

  const cab: Pt[] = [
    [1.55, 0.6], [L / 2 - 0.15, 0.6], [L / 2, 0.95], [L / 2 - 0.28, 2.3],
    [L / 2 - 0.8, 2.58], [1.55, 2.58],
  ];
  g.add(extrude(cab, W, ctx.mat.painted(PAL.truckCab, 0.45, 0.2)));
  g.add(box(L - 2.5, 2.32, W, ctx.mat.painted(PAL.truckWhite, 0.62, 0.05),
    -1.25, 1.94, 0));

  // corrugated ribs down the box flanks
  const ribs: THREE.Matrix4[] = [];
  for (let i = 0; i < 6; i++) ribs.push(xform(-3.5 + i * 0.94, 1.94, 0));
  g.add(inst(new THREE.BoxGeometry(0.055, 2.28, W + 0.04), alloy, ribs));
  g.add(box(L - 2.4, 0.1, W + 0.08, alloy, -1.25, 3.05, 0));
  g.add(box(L - 0.6, 0.16, W - 0.55, ctx.mat.steel, -0.2, 0.68, 0));

  // raked screen in the upper cab, cab side glass, bumper, grille, lamps
  const screen = box(0.1, 0.78, W - 0.34, ctx.mat.painted(PAL.glass, 0.1, 0.35),
    L / 2 - 0.235, 1.98, 0);
  screen.rotation.z = 0.2;
  g.add(screen);
  // screen frame: header/sill rails following the same rake, buried just
  // behind the glass so only a trim border shows
  for (const e of [-1, 1]) {
    const rail = box(0.08, 0.07, W - 0.26, trim, L / 2 - 0.235 - e * 0.078, 1.98 + e * 0.382, 0);
    rail.rotation.z = 0.2;
    g.add(rail);
  }
  g.add(box(1.0, 0.66, W + 0.03, ctx.mat.windowDark, 2.3, 1.92, 0));
  // side-glass frames: post/rail borders proud of the cab flanks, instanced
  const cabDark = ctx.mat.painted(PAL.truckCab, 0.6, 0.2);
  const postXf: THREE.Matrix4[] = [];
  const railXf: THREE.Matrix4[] = [];
  for (const s of [-1, 1]) {
    postXf.push(xform(1.77, 1.92, s * (W / 2 + 0.012)));
    postXf.push(xform(2.83, 1.92, s * (W / 2 + 0.012)));
    railXf.push(xform(2.3, 1.56, s * (W / 2 + 0.012)));
    railXf.push(xform(2.3, 2.28, s * (W / 2 + 0.012)));
  }
  g.add(inst(new THREE.BoxGeometry(0.07, 0.78, 0.05), trim, postXf));
  g.add(inst(new THREE.BoxGeometry(1.13, 0.07, 0.05), trim, railXf));
  // cab door seams + handles on both flanks
  const seamXf: THREE.Matrix4[] = [];
  for (const s of [-1, 1]) {
    seamXf.push(xform(1.70, 1.50, s * (W / 2 + 0.006)));
    seamXf.push(xform(2.90, 1.50, s * (W / 2 + 0.006)));
  }
  g.add(inst(new THREE.BoxGeometry(0.045, 1.60, 0.025), cabDark, seamXf));
  g.add(inst(new THREE.BoxGeometry(0.22, 0.05, 0.04), trim, [
    xform(2.62, 1.58, W / 2 + 0.012), xform(2.62, 1.58, -W / 2 - 0.012),
  ]));
  g.add(box(0.2, 0.26, W - 0.15, trim, L / 2 - 0.02, 0.62, 0));
  g.add(box(0.1, 0.4, 1.7, trim, L / 2 - 0.02, 1.16, 0));
  lamps(g, ctx, L / 2 - 0.03, 1.16, [-1.02, 1.02], 0.15);
  // tail lights on the box rear corners, rear bumper, mudflaps, plates
  const tailRed = ctx.mat.painted(PAL.applianceRed, 0.28, 0.15);
  for (const s of [-1, 1]) {
    g.add(box(0.08, 0.22, 0.28, tailRed, -L / 2 - 0.02, 1.00, s * 0.95));
    g.add(box(0.06, 0.42, 0.40, cabDark, -2.78, 0.32, s * 1.05));
  }
  g.add(box(0.15, 0.18, W, ctx.mat.steel, -L / 2 - 0.05, 0.55, 0));
  const plateMat = ctx.mat.signText({
    text: 'NT52', color: PAL.truckCab, background: PAL.windowBand, aspect: 2.4,
  });
  g.add(box(0.06, 0.18, 0.44, plateMat, L / 2 + 0.06, 0.62, 0));
  g.add(box(0.06, 0.18, 0.44, plateMat, -L / 2 - 0.14, 0.55, 0));

  wheels(g, ctx, [2.85, -2.2], 1.08, 0.46, 0.28);
  return { obj: g, len: L + 0.36, wid: W + 0.12, hgt: H };
}
// ------------------------------------------------------------------ saloons

interface SaloonOpts {
  /** tail-fin height above the boot lid */
  fin: number;
  /** cream roof, the way every 50s brochure showed it */
  twoTone: boolean;
  /** extra brightwork for a show-condition car */
  brightwork: boolean;
}

/** Rounded slab-sided 1950s saloon. ~4.8 x 1.95 x 1.5 m. */
function makeSaloon(ctx: BuildContext, colour: number, o: SaloonOpts): Vehicle {
  const L = 4.8, W = 1.95, H = 1.48;
  const g = group('saloon');
  const paint = ctx.mat.painted(colour, 0.34, 0.35);
  const trim = brightwork(ctx);
  const roofPaint = o.twoTone
    ? ctx.mat.painted(PAL.coachCream, 0.36, 0.3)
    : paint;

  // lower body: rocker to beltline, bonnet down at the nose, boot up at the tail
  const body: Pt[] = [
    [-L / 2, 0.34], [L / 2, 0.34], [L / 2 + 0.02, 0.78], [1.12, 0.9],
    [-1.6, 0.94], [-L / 2 + 0.06, 0.98], [-L / 2 - 0.02, 0.76],
  ];
  g.add(extrude(body, W, paint));

  // Greenhouse in two pieces. Glazing alone came out as one featureless black
  // slab, so the rear quarter is a solid body-colour sail panel with a raked
  // C pillar and only the wraparound screen and side band are glass.
  const glass: Pt[] = [[-1.05, 0.88], [0.98, 0.88], [0.56, 1.36], [-1.05, 1.36]];
  g.add(extrude(glass, W * 0.82, ctx.mat.windowDark));
  const quarter: Pt[] = [[-1.6, 0.88], [-1.0, 0.88], [-1.0, 1.37], [-1.18, 1.37]];
  g.add(extrude(quarter, W * 0.84, paint));
  g.add(box(1.86, 0.1, W * 0.86, roofPaint, -0.3, 1.41, 0));

  // tail fins, one blade per quarter, base buried under the boot lid
  const fin: Pt[] = [
    [-L / 2 + 0.1, 0.8], [-1.15, 0.88], [-L / 2 + 0.04, 0.92 + o.fin],
  ];
  for (const s of [-1, 1]) {
    const f = extrude(fin, 0.09, paint);
    f.position.z = s * (W / 2 - 0.05);
    g.add(f);
  }

  // brightwork: side spear, bumpers, grille, lamps
  g.add(box(3.6, 0.07, W + 0.04, trim, 0.1, 0.72, 0));
  g.add(box(0.2, 0.18, W - 0.06, trim, L / 2 - 0.02, 0.46, 0));
  g.add(box(0.2, 0.18, W - 0.12, trim, -L / 2 + 0.02, 0.5, 0));
  g.add(box(0.09, 0.26, 1.5, trim, L / 2 + 0.02, 0.66, 0));
  if (o.brightwork) {
    g.add(box(3.9, 0.05, W + 0.05, trim, 0, 0.4, 0));
    g.add(box(0.62, 0.05, W * 0.87, trim, -1.3, 1.0, 0));
    lamps(g, ctx, L / 2 - 0.01, 0.62, [-0.74, -0.5, 0.5, 0.74], 0.12);
  } else {
    lamps(g, ctx, L / 2 - 0.01, 0.62, [-0.7, 0.7], 0.13);
  }
  // greenhouse frame: belt rail under the side glass, drip rail over it
  g.add(box(2.10, 0.05, W * 0.84 + 0.02, trim, -0.05, 0.895, 0));
  g.add(box(1.90, 0.045, W * 0.86, trim, -0.25, 1.345, 0));
  // door shut-lines (four per flank) and chrome handles, all instanced
  const shutDark = ctx.mat.painted(PAL.truckCab, 0.6, 0.2);
  const shutXf: THREE.Matrix4[] = [];
  for (const hx of [1.02, 0.06, -0.10, -1.52]) {
    shutXf.push(xform(hx, 0.62, W / 2 + 0.004));
    shutXf.push(xform(hx, 0.62, -W / 2 - 0.004));
  }
  g.add(inst(new THREE.BoxGeometry(0.035, 0.52, 0.025), shutDark, shutXf));
  g.add(inst(new THREE.BoxGeometry(0.18, 0.04, 0.03), trim, [
    xform(0.78, 0.82, W / 2 + 0.008), xform(0.78, 0.82, -W / 2 - 0.008),
    xform(-0.38, 0.82, W / 2 + 0.008), xform(-0.38, 0.82, -W / 2 - 0.008),
  ]));
  // red lenses on the fin tips, plates front and rear
  tailLamps(g, ctx, -L / 2 - 0.02, 0.92 + o.fin, [W / 2 - 0.05, -(W / 2 - 0.05)], 0.09);
  const saloonPlate = ctx.mat.signText({
    text: 'NT55', color: PAL.truckCab, background: PAL.windowBand, aspect: 2.4,
  });
  g.add(box(0.05, 0.16, 0.40, saloonPlate, L / 2 + 0.09, 0.46, 0));
  g.add(box(0.05, 0.16, 0.40, saloonPlate, -L / 2 - 0.09, 0.50, 0));

  wheels(g, ctx, [1.52, -1.52], 0.86, 0.34, 0.22);
  return { obj: g, len: L + 0.24, wid: W + 0.09, hgt: H };
}

// ------------------------------------------------------------------ placement

export const buildVehicles: Builder = (ctx) => {
  const out = group('vehicles');
  const colliders: AABB[] = [];

  /** nobody parks square */
  const skew = (): number => (ctx.rand() - 0.5) * 0.08;
  const nudge = (): number => (ctx.rand() - 0.5) * 0.35;

  /**
   * Drop a vehicle and give it one tight ground-to-roof AABB; the wheels live
   * inside that footprint, so they never collide separately. `surfaceY` is the
   * height the wheels rest on - the road is y=0, but the garage aprons in
   * ground.ts ride the KERB_HEIGHT plateau, and a car parked on a drive that is
   * not lifted by that much sits buried to the axles.
   */
  const park = (v: Vehicle, x: number, z: number, yaw: number, surfaceY = 0): void => {
    v.obj.position.set(x, surfaceY, z);
    v.obj.rotation.y = yaw;
    out.add(v.obj);
    // Step the collision along the vehicle's OWN length axis instead of fitting
    // one box to its bounding rectangle, so a rotated vehicle blocks its diagonal
    // and not the whole rectangle around it. The slabs tile the body exactly and
    // each box is the tight AABB of its slab, so the union covers the body with
    // no seam and needs no padding at the joints.
    const n = Math.min(SEG_MAX, Math.max(1, Math.ceil(
      (v.len * Math.abs(Math.sin(2 * yaw))) / (2 * SEG_OVERHANG),
    )));
    const seg = v.len / n;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const w = seg * Math.abs(c) + v.wid * Math.abs(s);
    const d = seg * Math.abs(s) + v.wid * Math.abs(c);
    for (let i = 0; i < n; i++) {
      // local +x is the nose, and rotation.y maps it to (cos yaw, -sin yaw)
      const u = -v.len / 2 + (i + 0.5) * seg;
      colliders.push(aabbSlab(x + u * c, surfaceY, z - u * s, w, v.hgt, d));
    }
  };

  /**
   * Park ON the bulb. The asphalt disc in ground.ts is exactly HEAD_RADIUS, so a
   * corner beyond it is a wheel standing on the kerb. Walk the whole rotated
   * footprint, and if the worst corner is outside the allowance, draw the centre
   * straight back toward HEAD_CENTER_X by the overrun and re-measure.
   */
  const parkOnHead = (v: Vehicle, x: number, z: number, yaw: number): void => {
    const a = v.len / 2, b = v.wid / 2;
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let ox = x - HEAD_CENTER_X, oz = z;
    for (let i = 0; i < 8; i++) {
      let worst = 0;
      for (const sa of [-1, 1]) {
        for (const sb of [-1, 1]) {
          worst = Math.max(worst, Math.hypot(
            ox + sa * a * c + sb * b * s, oz - sa * a * s + sb * b * c,
          ));
        }
      }
      const over = worst - (HEAD_RADIUS - BULB_MARGIN);
      if (over <= 0) break;
      const d = Math.hypot(ox, oz) || 1;
      ox -= (ox / d) * over;
      oz -= (oz / d) * over;
    }
    park(v, HEAD_CENTER_X + ox, oz, yaw);
  };

  const APRON_Y = KERB_HEIGHT + 0.006; // must track ground.ts T_DRIVE

  // 1. The hero coach, on the orange (-z) half of the head, parked ACROSS the
  //    bulb rather than square down the stem. Nosed straight at the turningHead
  //    station it shows nothing but its front, and half of NT07 is the Nuketown
  //    script on the flank; a quarter turn puts nose and flank in one frame.
  parkOnHead(makeCoach(ctx),
    HEAD_CENTER_X - 0.30 + nudge(),
    ORANGE.side * HEAD_RADIUS * 0.33,
    NOSE_DOWN_STEM - 0.44 + skew());

  // 2. box truck: turning head, white (+z) half, nosed down the stem
  parkOnHead(makeBoxTruck(ctx),
    HEAD_CENTER_X - HEAD_RADIUS * 0.06 + nudge(),
    WHITE.side * HEAD_RADIUS * 0.42,
    NOSE_DOWN_STEM + skew());

  // 3. dark blue saloon tucked in beside the truck, outboard of it
  parkOnHead(makeSaloon(ctx, PAL.carBlue, { fin: 0.2, twoTone: false, brightwork: false }),
    HEAD_CENTER_X + HEAD_RADIUS * 0.06 + nudge(),
    WHITE.side * HEAD_RADIUS * 0.76,
    NOSE_DOWN_STEM + skew());

  // 4. A show-condition two-tone in the open road stem, held to the orange kerb
  //    side so the far lane stays open. It used to be teal - but plaza.ts stands
  //    the NT05 teal classic on its plinth with a placard, which is what the load
  //    screen shows, and two identical teal show cars read as a duplicated prop.
  //    Recoloured rather than moved: the stem has no other cover object.
  park(makeSaloon(ctx, PAL.carBlue, { fin: 0.32, twoTone: true, brightwork: true }),
    -HOUSE_HALF_LEN * 0.3 + nudge(),
    ORANGE.side * ROAD_HALF_WIDTH * 0.52,
    0.18 + skew());

  // 5. red saloon on the orange house's driveway apron, nose out to the street
  park(makeSaloon(ctx, PAL.carRed, { fin: 0.26, twoTone: true, brightwork: false }),
    ORANGE.garageX + GARAGE_LEN * 0.1,
    ORANGE.side * (FRONT_LAWN_OUTER + PAVEMENT_OUTER) * 0.5,
    ORANGE.side * Math.PI * 0.5 + skew(),
    APRON_Y);

  return { group: out, colliders };
};
