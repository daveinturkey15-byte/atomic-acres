/**
 * VEHICLES - the Nuketown 2025 street fleet.
 *
 * 1950s/60s American iron in a retro-futurist show town: heavy chrome, whitewall
 * tyres, wraparound screens. Every one is a cover object, so silhouette and a
 * solid collider beat panel detail.
 *
 * References: NT07 (cream/maroon intercity coach, chrome belt, riveted panels,
 * the project name in script along the flank, plus a second black/cream/navy civic
 * bus on the same shell), NT02 aerial (coach, box truck and a saloon standing
 * ON the turning head), footage chicane (rigid two-tone box truck + towed
 * cream/blue trailer + buses staggered down the stem leaving ~3 m slots),
 * road-mouth exhibit (deep green/teal sedan on a plinth with a placard by the
 * steel gate - the NT05 plaza dais car belongs to plaza.ts and is not this).
 *
 * The coach hull is a LOFT, not a swept slab: a rounded forward-raked nose, a
 * roofline curving down into it and tumblehome flanks are what separate a coach
 * from a city bus, and none of them survive a constant-section extrusion.
 * Everything is authored nose-along-local-+x and yawed into place, so wheel
 * cylinders are rotated about X (flat faces sideways, axle along z).
 */
import * as THREE from 'three';
import type { AABB, BuildContext, Builder } from '../core/kit';
import { aabbSlab, box, extrude, group, slab } from '../core/kit';
import { batchStatic } from '../core/static-batch';
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
/**
 * Cap on that segment count. It used to be 6, which was below what the one vehicle
 * that actually needs segmenting asks for: the hero coach sits at 2.70 rad on the
 * bulb, wants 13 segments, got 6, and so carried 0.75 m of phantom box down each
 * flank instead of the 0.35 m the constant above promises - 0.4 m of clear asphalt
 * between its collision and the kerb where a player should have 1.15 m. 14 covers the
 * coach exactly; every other vehicle on the map lands on 1-3 segments and pays
 * nothing for the higher cap.
 */
const SEG_MAX = 14;

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

  // NT07's single most identifying detail: a name in signwriter's script - OURS, not the
  // source map's (VISUAL-BAR B5; the project was renamed Atomic Acres on 2026-09-17) -
  // along the flank. One instanced plane per side; the -z copy is turned about y
  // so the word runs left-to-right for a viewer standing on either flank.
  const scriptW = 2.9;
  const scriptZ = flankHalf(1.62) + 0.055;
  const script = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(scriptW, scriptW / 6.0),
    ctx.mat.signText({ text: 'Atomic Acres', color: PAL.coachMaroon, aspect: 6.0, script: true }),
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
    text: 'ATOMIC ACRES', color: PAL.windowBand, background: PAL.truckCab, aspect: 6.8,
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
// ------------------------------------------------------------------ second bus

/** Second bus on the coach shell: near-black top, cream banner, navy lower. */
function makeSecondBus(ctx: BuildContext): Vehicle {
  const g = group('coach-second');
  const trim = brightwork(ctx);
  const navy = ctx.mat.painted(PAL.busNavy, 0.5, 0.15);
  const black = ctx.mat.painted(PAL.busBlack, 0.55, 0.12);
  const cream = ctx.mat.painted(PAL.coachCream, 0.5, 0.12);
  const glazing = ctx.mat.windowDark;
  const shadowGap = ctx.mat.painted(PAL.truckCab, 0.7, 0.1);

  // navy lower hull; black roof cap and cream banner are proud overlays
  const hull = new THREE.Mesh(loftHull(), navy);
  hull.castShadow = true;
  hull.receiveShadow = true;
  g.add(hull);

  // black roof cap: proud slab over the crown, stops short of nose/tail turn-in
  g.add(box(8.6, 0.55, 2 * (flankHalf(3.05) + 0.030), black, -0.30, 3.05, 0));

  // cream swoosh-banner mid-band, both flanks in one extrusion
  const banner = ctx.mat.painted(PAL.coachCream, 0.5, 0.12);
  g.add(extrude([
    [-5.00, 0.95], [-0.60, 0.95], [3.00, 1.48], [4.90, 1.55],
    [4.90, 1.90], [3.00, 1.83], [-0.60, 1.30], [-5.00, 1.30],
  ], 2 * (flankHalf(1.40) + 0.030), banner));

  // dark glazing band + mullions, same tumblehome-following section as makeCoach
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

  // chrome rub-rails above/below the banner + rivet rows through both flanks
  g.add(box(9.6, 0.08, 2 * (flankHalf(1.95) + 0.050), trim, -0.20, 1.95, 0));
  g.add(box(9.5, 0.07, 2 * (flankHalf(0.80) + 0.020), trim, -0.15, 0.80, 0));
  const rivets: THREE.Matrix4[] = [];
  const rivet = new THREE.CylinderGeometry(0.026, 0.026, 2 * (flankHalf(1.83) + 0.05), 6);
  for (let i = 0; i < 20; i++) {
    const x = -4.6 + i * 0.47;
    rivets.push(xform(x, 1.83, 0, Math.PI / 2));
    rivets.push(xform(x, 0.92, 0, Math.PI / 2));
  }
  g.add(inst(rivet, ctx.mat.chrome, rivets));

  // banner lettering: plausible-spirit civic wording, not the reference sentence
  const wordZ = flankHalf(1.62) + 0.055;
  const words = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(3.4, 3.4 / 6.0),
    ctx.mat.signText({ text: 'BUILDING TOMORROW', color: PAL.coachCream, background: PAL.busBlack, aspect: 6.0 }),
    2,
  );
  words.setMatrixAt(0, xform(-0.4, 1.62, wordZ));
  words.setMatrixAt(1, xform(-0.4, 1.62, -wordZ, 0, Math.PI));
  words.instanceMatrix.needsUpdate = true;
  words.computeBoundingSphere();
  g.add(words);

  // running-figure mascot: pure-geometry striding silhouette, one per flank.
  // head disc + leaning torso + stride limbs from thin slabs, cream on black.
  const figure: Pt[] = [
    // torso leaning forward (+x), legs in stride, arms counter-swinging
    [0.00, 0.00], [0.42, 0.02], [0.30, 0.34], [0.62, 0.52], [0.55, 0.62],
    [0.28, 0.48], [0.34, 0.78], [0.52, 0.92], [0.44, 1.00], [0.24, 0.86],
    [0.10, 0.60], [-0.22, 0.72], [-0.30, 0.64], [-0.02, 0.48],
    [-0.30, 0.22], [-0.24, 0.12], [0.02, 0.32],
  ];
  const figGeo = extrude(figure, 0.03, cream).geometry;
  figGeo.scale(0.62, 0.62, 1);
  for (const s of [1, -1]) {
    const m = new THREE.Mesh(figGeo, cream);
    m.position.set(2.55, 1.02, s * (flankHalf(1.20) + 0.045));
    if (s < 0) m.rotation.y = Math.PI;
    g.add(m);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), cream);
    head.position.set(2.55 + 0.36, 1.66, s * (flankHalf(1.20) + 0.045));
    g.add(head);
  }

  // split screen, blind box, grille + lamps, bumpers, tail — same idiom as NT07
  const sillY = 1.92;
  const headY = 2.64;
  const scrY = (sillY + headY) / 2;
  const rake = Math.atan2(noseX(sillY) - noseX(headY), headY - sillY);
  const scrH = Math.hypot(noseX(sillY) - noseX(headY), headY - sillY) - 0.06;
  for (const s of [-1, 1]) {
    const pane = box(0.06, scrH, 0.84, glazing, noseX(scrY) - 0.02, scrY, s * 0.52);
    pane.rotation.set(0, -s * 0.15, rake);
    g.add(pane);
  }
  const pillar = box(0.07, scrH + 0.08, 0.12, trim, noseX(scrY) + 0.012, scrY, 0);
  pillar.rotation.z = rake;
  g.add(pillar);
  g.add(box(0.09, 0.24, 1.30, trim, 5.315, 2.80, 0));
  g.add(box(0.08, 0.17, 1.15, ctx.mat.signText({
    text: 'CIVIC PRIDE', color: PAL.coachCream, background: PAL.busBlack, aspect: 6.8,
  }), 5.340, 2.80, 0));
  g.add(box(0.12, 0.42, 1.50, trim, 5.625, 1.28, 0));
  g.add(box(0.07, 0.32, 1.36, black, 5.675, 1.28, 0));
  const slats: THREE.Matrix4[] = [];
  for (let i = 0; i < 5; i++) slats.push(xform(5.705, 1.15 + i * 0.065, 0));
  g.add(inst(new THREE.BoxGeometry(0.05, 0.032, 1.30), trim, slats));
  lamps(g, ctx, 5.50, 1.32, [-1.00, 1.00], 0.19);
  g.add(inst(arcBar(2.2, 0.115, 1.05), ctx.mat.chrome, [xform(5.62 - 2.2, 1.00, 0)]));
  g.add(inst(arcBar(2.2, 0.05, 1.0), shadowGap, [xform(5.60 - 2.2, 0.855, 0)]));
  g.add(inst(arcBar(2.2, 0.115, 1.05), ctx.mat.steel, [xform(-5.52 + 2.2, 1.00, 0, 0, Math.PI)]));
  g.add(box(0.08, 0.72, 1.50, glazing, -5.50, 2.30, 0));
  tailLamps(g, ctx, -5.44, 1.15, [-0.95, -0.65, 0.65, 0.95], 0.10);

  // entry door, mirrors, wipers, plates
  g.add(box(0.90, 1.38, 0.04, navy, 4.10, 1.31, 1.315));
  g.add(box(0.60, 0.40, 0.045, glazing, 4.10, 1.72, 1.33));
  g.add(inst(new THREE.BoxGeometry(0.035, 1.44, 0.045), shadowGap, [
    xform(3.63, 1.31, 1.33), xform(4.57, 1.31, 1.33),
  ]));
  g.add(box(0.94, 0.035, 0.045, shadowGap, 4.10, 2.03, 1.33));
  g.add(box(0.16, 0.045, 0.05, trim, 4.47, 1.28, 1.345));
  for (const s of [-1, 1]) {
    g.add(box(0.05, 0.76, 0.05, shadowGap, 5.446, 1.93, s * 0.955));
    g.add(box(0.06, 0.26, 0.16, ctx.mat.chrome, 5.476, 2.38, s * 0.99));
    g.add(box(0.02, 0.22, 0.12, glazing, 5.44, 2.38, s * 0.99));
    const wiper = box(0.025, 0.55, 0.03, shadowGap, 5.565, 2.18, s * 0.52);
    wiper.rotation.set(0, -s * 0.15, s * 0.38);
    g.add(wiper);
  }
  const plateMat = ctx.mat.signText({
    text: 'NT08', color: PAL.truckCab, background: PAL.windowBand, aspect: 2.4,
  });
  g.add(box(0.05, 0.18, 0.44, plateMat, 5.72, 1.00, 0));
  g.add(box(0.05, 0.18, 0.44, plateMat, -5.61, 1.00, 0));

  // six dark-tyred wheels with chrome hubs; mute discs cover the whitewalls
  wheels(g, ctx, [3.55, -2.95, -4.45], 1.22, 0.54, 0.30);
  const tyreMute = new THREE.CylinderGeometry(0.86 * 0.54, 0.86 * 0.54, 0.30 * 1.06, 18);
  const mutes: THREE.Matrix4[] = [];
  for (const x of [3.55, -2.95, -4.45]) for (const s of [-1, 1]) mutes.push(xform(x, 0.56, s * 1.22, Math.PI / 2));
  g.add(inst(tyreMute, ctx.mat.painted(PAL.truckCab, 0.9, 0), mutes));
  return { obj: g, len: 11.6, wid: 2.87, hgt: 3.40 };
}
// ------------------------------------------------------------------ box truck

/** Rigid COE box truck: bulbous navy cab, two-tone cream/navy box. ~9.4 x 2.5 x 3.7 m. */
function makeBoxTruck(ctx: BuildContext): Vehicle {
  const L = 9.4, W = 2.5, ROOF = 3.7;
  const g = group('box-truck');
  const trim = brightwork(ctx);
  const navy = ctx.mat.painted(PAL.busNavy, 0.45, 0.2);
  const cabDark = ctx.mat.painted(PAL.truckCab, 0.7, 0.1);
  const cream = ctx.mat.painted(PAL.truckWhite, 0.62, 0.05);
  const alloy = ctx.mat.painted(PAL.steel, 0.55, 0.12);
  const glass = ctx.mat.windowDark;
  const red = ctx.mat.painted(PAL.applianceRed, 0.28, 0.15);

  // chassis + two-tone box shell (navy lower, cream upper, split rail at 2.35)
  g.add(box(7.6, 0.16, W - 0.55, ctx.mat.steel, -0.4, 0.68, 0));
  const BOX_X = -1.45, BOX_L = 6.5; // spans -4.7..1.8: ~6.5 box + ~2.5 cab + nose
  g.add(box(BOX_L, 1.35, W, navy, BOX_X, 1.675, 0));
  g.add(box(BOX_L, 1.35, W, cream, BOX_X, 3.025, 0));
  g.add(box(BOX_L + 0.04, 0.09, W + 0.06, alloy, BOX_X, 2.35, 0));
  g.add(box(BOX_L + 0.04, 0.08, W + 0.06, alloy, BOX_X, ROOF - 0.02, 0));

  // fine-pitch HORIZONTAL corrugation rails, both bands, full length, both flanks
  const railY = [1.22, 1.42, 1.62, 1.82, 2.02, 2.2, 2.56, 2.76, 2.96, 3.16, 3.36, 3.54];
  const rails: THREE.Matrix4[] = [];
  for (const y of railY) for (const s of [-1, 1]) rails.push(xform(BOX_X, y, s * (W / 2 + 0.015)));
  g.add(inst(new THREE.BoxGeometry(BOX_L - 0.1, 0.045, 0.03), alloy, rails));

  // bulbous COE cab: rounded snub nose, high roof (flanks at +-1.22)
  const cab: Pt[] = [
    [2.0, 0.6], [4.3, 0.6], [4.68, 0.95], [4.7, 1.6],
    [4.5, 2.3], [4.0, 2.72], [3.3, 2.88], [2.0, 2.88],
  ];
  g.add(extrude(cab, W - 0.06, navy));

  // raked windscreen + chrome header/sill rails
  const screen = box(0.1, 0.82, W - 0.62, glass, 4.42, 2.2, 0);
  screen.rotation.z = 0.25;
  g.add(screen);
  for (const e of [-1, 1]) {
    const rail = box(0.08, 0.07, W - 0.54, trim, 4.42 - e * 0.10, 2.2 + e * 0.40, 0);
    rail.rotation.z = 0.25;
    g.add(rail);
  }
  // grille throat + slats, chrome bumper, headlamps
  g.add(box(0.08, 0.36, 1.5, cabDark, 4.70, 1.15, 0));
  const slats: THREE.Matrix4[] = [];
  for (let i = 0; i < 3; i++) slats.push(xform(4.74, 1.05 + i * 0.10, 0));
  g.add(inst(new THREE.BoxGeometry(0.05, 0.035, 1.44), trim, slats));
  g.add(box(0.16, 0.26, W - 0.2, trim, L / 2 - 0.02, 0.62, 0));
  lamps(g, ctx, 4.66, 1.15, [-0.95, 0.95], 0.15);

  // 3 thin chrome cowl speed-lines per flank
  const speeds: THREE.Matrix4[] = [];
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) speeds.push(xform(2.62, 1.42 + i * 0.16, s * 1.232));
  g.add(inst(new THREE.BoxGeometry(1.05, 0.035, 0.025), trim, speeds));

  // tall door seams + handle, small upper side window with chrome frame, both flanks
  const seams: THREE.Matrix4[] = [];
  const posts: THREE.Matrix4[] = [];
  const winRails: THREE.Matrix4[] = [];
  for (const s of [-1, 1]) {
    seams.push(xform(2.35, 1.62, s * 1.226));
    seams.push(xform(3.50, 1.62, s * 1.226));
    posts.push(xform(2.50, 2.32, s * 1.232));
    posts.push(xform(3.34, 2.32, s * 1.232));
    winRails.push(xform(2.92, 2.05, s * 1.232));
    winRails.push(xform(2.92, 2.59, s * 1.232));
  }
  g.add(inst(new THREE.BoxGeometry(0.045, 1.90, 0.02), cabDark, seams));
  g.add(box(1.19, 0.045, 0.02, cabDark, 2.925, 2.58, 1.226));
  g.add(box(1.19, 0.045, 0.02, cabDark, 2.925, 2.58, -1.226));
  g.add(box(0.85, 0.50, 0.035, glass, 2.92, 2.32, 1.226));
  g.add(box(0.85, 0.50, 0.035, glass, 2.92, 2.32, -1.226));
  g.add(inst(new THREE.BoxGeometry(0.06, 0.60, 0.03), trim, posts));
  g.add(inst(new THREE.BoxGeometry(0.90, 0.06, 0.03), trim, winRails));
  g.add(inst(new THREE.BoxGeometry(0.22, 0.05, 0.04), trim, [
    xform(3.28, 1.70, 1.238), xform(3.28, 1.70, -1.238),
  ]));

  // ribbed alloy step + rivet row under each door
  g.add(box(1.15, 0.10, 0.30, alloy, 2.92, 0.72, 1.22));
  g.add(box(1.15, 0.10, 0.30, alloy, 2.92, 0.72, -1.22));
  const stepRibs: THREE.Matrix4[] = [];
  for (let i = 0; i < 5; i++) {
    stepRibs.push(xform(2.52 + i * 0.20, 0.78, 1.22));
    stepRibs.push(xform(2.52 + i * 0.20, 0.78, -1.22));
  }
  g.add(inst(new THREE.BoxGeometry(0.06, 0.03, 0.32), trim, stepRibs));
  const truckRivets: THREE.Matrix4[] = [];
  for (let i = 0; i < 8; i++) {
    truckRivets.push(xform(2.42 + i * 0.143, 0.92, 1.226, Math.PI / 2));
    truckRivets.push(xform(2.42 + i * 0.143, 0.92, -1.226, Math.PI / 2));
  }
  g.add(inst(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 6), trim, truckRivets));

  // cream oval-swoosh on the navy lower band, both flanks behind the cab
  const swoosh: Pt[] = [
    [-1.6, -0.05], [0.4, -0.02], [1.6, 0.22], [1.6, 0.40], [0.4, 0.32], [-1.6, 0.24],
  ];
  for (const s of [-1, 1]) {
    const m = extrude(swoosh, 0.024, cream);
    m.position.set(-0.7, 1.62, s * (W / 2 + 0.03));
    g.add(m);
  }

  // running-figure mascot silhouette (abstract: head + leaning torso + limbs) on cream
  const fig = ctx.mat.painted(PAL.busNavy, 0.5, 0.15);
  for (const s of [-1, 1]) {
    const z = s * (W / 2 + 0.035);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.03, 10), fig);
    head.rotation.x = Math.PI / 2;
    head.position.set(1.02, 3.28, z);
    const torso = box(0.14, 0.52, 0.03, fig, 0.82, 2.98, z);
    torso.rotation.z = 0.5;
    const legA = box(0.11, 0.44, 0.03, fig, 0.62, 2.66, z);
    legA.rotation.z = -0.7;
    const legB = box(0.11, 0.44, 0.03, fig, 0.98, 2.64, z);
    legB.rotation.z = 0.9;
    const arm = box(0.09, 0.36, 0.03, fig, 0.86, 3.06, z);
    arm.rotation.z = 1.1;
    for (const m of [head, torso, legA, legB, arm]) { m.castShadow = true; g.add(m); }
  }

  // one small slogan line under the mascot, both flanks (generic haulier patter)
  const slogan = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1.9, 1.9 / 5),
    ctx.mat.signText({ text: 'MOVES THE TOWN', color: PAL.busNavy, aspect: 5 }),
    2,
  );
  slogan.setMatrixAt(0, xform(-1.35, 3.02, W / 2 + 0.045));
  slogan.setMatrixAt(1, xform(-1.35, 3.02, -W / 2 - 0.045, 0, Math.PI));
  slogan.instanceMatrix.needsUpdate = true;
  slogan.computeBoundingSphere();
  g.add(slogan); // no castShadow: alpha cut-out, same idiom as the coach script

  // red corner markers at the box front-top, small square roof vent
  for (const s of [-1, 1]) g.add(box(0.12, 0.12, 0.14, red, 1.76, 3.52, s * (W / 2 - 0.06)));
  g.add(box(0.40, 0.06, 0.40, cabDark, -2.5, ROOF + 0.01, 0));
  g.add(box(0.50, 0.08, 0.50, alloy, -2.5, ROOF + 0.06, 0));

  // open roller-shutter hatch on the +z flank: dark recess, rolled shutter head,
  // ally frame, 2 crates in the mouth + 1 on the ground
  g.add(box(2.2, 1.15, 0.06, cabDark, -1.2, 1.675, W / 2 - 0.02));
  g.add(box(2.2, 0.16, 0.10, alloy, -1.2, 2.18, W / 2 - 0.02));
  g.add(box(2.3, 0.06, 0.05, trim, -1.2, 2.29, W / 2 + 0.01));
  g.add(box(2.3, 0.06, 0.05, trim, -1.2, 1.07, W / 2 + 0.01));
  g.add(box(0.06, 1.28, 0.05, trim, -2.33, 1.68, W / 2 + 0.01));
  g.add(box(0.06, 1.28, 0.05, trim, -0.07, 1.68, W / 2 + 0.01));
  const crateMat = ctx.mat.painted(PAL.timber, 0.85, 0);
  const crateA = box(0.45, 0.45, 0.45, crateMat, -1.62, 1.325, W / 2 - 0.10);
  crateA.rotation.y = (ctx.rand() - 0.5) * 0.3;
  const crateB = box(0.45, 0.45, 0.45, crateMat, -1.10, 1.325, W / 2 - 0.12);
  crateB.rotation.y = (ctx.rand() - 0.5) * 0.3;
  g.add(crateA, crateB);
  const crateC = slab(0.5, 0.5, 0.5, ctx.mat.painted(PAL.timberDark, 0.9, 0), -0.30, 0, W / 2 + 0.28);
  crateC.rotation.y = (ctx.rand() - 0.5) * 0.6;
  g.add(crateC);

  // rear face: tail lamps, steel bumper, mudflaps, plates (front + rear)
  tailLamps(g, ctx, -L / 2, 1.05, [-0.95, 0.95], 0.12);
  g.add(box(0.15, 0.18, W, ctx.mat.steel, -L / 2 - 0.05, 0.55, 0));
  for (const s of [-1, 1]) g.add(box(0.06, 0.42, 0.40, cabDark, -2.55, 0.32, s * 1.0));
  const plateMat = ctx.mat.signText({
    text: 'NT25', color: PAL.truckCab, background: PAL.windowBand, aspect: 2.4,
  });
  g.add(box(0.06, 0.18, 0.44, plateMat, L / 2 + 0.06, 0.62, 0));
  g.add(box(0.06, 0.18, 0.44, plateMat, -L / 2 - 0.14, 0.55, 0));

  // black tyres + chrome domes, NO whitewalls; tight black arches; rear axle aft -3.0
  const tyre = ctx.mat.painted(PAL.truckCab, 0.94, 0);
  const hubs: THREE.Matrix4[] = [];
  const caps: THREE.Matrix4[] = [];
  const arches: THREE.Matrix4[] = [];
  for (const x of [3.3, -3.0]) {
    for (const s of [-1, 1]) {
      hubs.push(xform(x, WHEEL_REST + 0.5, s * 1.02, Math.PI / 2));
      caps.push(xform(x, WHEEL_REST + 0.5, s * 1.02, s * Math.PI / 2));
      arches.push(xform(x, WHEEL_REST + 0.5, s * (1.02 + 0.17)));
    }
  }
  g.add(inst(new THREE.CylinderGeometry(0.5, 0.5, 0.32, 18), tyre, hubs));
  const dome = new THREE.SphereGeometry(0.23, 14, 7, 0, Math.PI * 2, 0, Math.PI * 0.52);
  dome.scale(1, 0.55, 1);
  dome.translate(0, 0.18, 0);
  g.add(inst(dome, ctx.mat.painted(PAL.chrome, 0.18, 0.28), caps));
  g.add(inst(new THREE.TorusGeometry(0.56, 0.05, 6, 14, Math.PI), cabDark, arches));

  return { obj: g, len: L + 0.36, wid: 3.6, hgt: ROOF + 0.1 };
}
// ------------------------------------------------------------------ trailer

/**
 * Towed box trailer: cream corrugated upper over a slate-blue lower band,
 * flat pale roof slab, A-frame drawbar, tandem rear wheels only. ~7.5 x 2.5
 * x 2.9 m body, nose (+x) is the drawbar end. Box-only: no cab, no engine.
 */
function makeTrailer(ctx: BuildContext): Vehicle {
  const L = 7.5, W = 2.5, H = 2.9;
  const floorY = 0.85;                 // body underside
  const bandH = 0.62;                  // slate-blue lower band height
  const bodyH = H - floorY;            // 2.05 of body above the floor
  const upperH = bodyH - bandH;
  const g = group('trailer');
  const trim = brightwork(ctx);
  const steel = ctx.mat.steel;
  const cream = ctx.mat.painted(PAL.trailerBody, 0.68, 0.04);
  // NOTE(palette-mismatch): PAL comments trailerRoof as the "blue-grey roof",
  // but this lane spends it as the LOWER band under the cream upper; the
  // actual roof slab below is pale truckWhite. Rename on a palette pass.
  const band = ctx.mat.painted(PAL.trailerRoof, 0.6, 0.08);
  const dark = ctx.mat.painted(PAL.truckCab, 0.7, 0.1);

  // shell: lower band + cream upper + pale roof slab
  g.add(box(L, bandH, W, band, 0, floorY + bandH / 2, 0));
  g.add(box(L, upperH, W, cream, 0, floorY + bandH + upperH / 2, 0));
  g.add(box(L + 0.08, 0.09, W + 0.08,
    ctx.mat.painted(PAL.truckWhite, 0.62, 0.05), 0, H + 0.045, 0));

  // horizontal siding ribs down both flanks, instanced
  const ribXf: THREE.Matrix4[] = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 6; i++) {
      ribXf.push(xform(0, floorY + bandH + 0.24 + i * 0.24, s * (W / 2 + 0.008)));
    }
  }
  g.add(inst(new THREE.BoxGeometry(L - 0.3, 0.05, 0.035),
    ctx.mat.painted(PAL.steel, 0.55, 0.12), ribXf));

  // rub-rail at the band seam + underbody skirt, both steel
  g.add(box(L + 0.06, 0.1, W + 0.06, steel, 0, floorY + bandH, 0));
  g.add(box(L - 1.2, 0.18, W - 0.6, steel, -0.5, floorY - 0.09, 0));

  // red side markers: 4 upper + 1 lower (forward of the axles) per flank
  const markXf: THREE.Matrix4[] = [];
  for (const s of [-1, 1]) {
    for (const mx of [-2.9, -1.0, 0.9, 2.8]) {
      markXf.push(xform(mx, H - 0.35, s * (W / 2 + 0.02)));
    }
    markXf.push(xform(0.6, floorY + bandH / 2, s * (W / 2 + 0.02)));
  }
  g.add(inst(new THREE.BoxGeometry(0.14, 0.1, 0.05),
    ctx.mat.painted(PAL.trailerTrim, 0.4, 0.1), markXf));
  tailLamps(g, ctx, -L / 2, 1.0, [-0.95, 0.95], 0.09);

  // tall open side doorway, forward half of the +z flank: dark interior mass,
  // dark opening inset, brightwork frame, leaf swung flat alongside (aft side)
  const doorX = 1.55, doorW = 1.25, doorH = 1.8;
  const doorY = floorY + doorH / 2 + 0.06;
  g.add(box(doorW - 0.06, doorH - 0.06, 0.5, dark, doorX, doorY, W / 2 - 0.3));
  g.add(box(doorW, doorH, 0.08, ctx.mat.windowDark, doorX, doorY, W / 2 - 0.01));
  for (const e of [-1, 1]) {
    g.add(box(0.08, doorH + 0.1, 0.06, trim, doorX + e * doorW / 2, doorY, W / 2 + 0.02));
    g.add(box(doorW + 0.16, 0.08, 0.06, trim, doorX, doorY + e * doorH / 2, W / 2 + 0.02));
  }
  g.add(box(doorW - 0.06, doorH - 0.06, 0.06, cream,
    doorX - doorW - 0.12, doorY, W / 2 + 0.07));
  for (const hy of [doorY - 0.6, doorY + 0.6]) {
    g.add(box(0.1, 0.12, 0.08, steel, doorX - doorW / 2 - 0.03, hy, W / 2 + 0.05));
  }

  // rear doorway + deployed ramp (sloped steel slab, sill to ground)
  const rearW = 1.5, rearH = 1.7;
  const rearY = floorY + rearH / 2 + 0.05;
  /**
   * ONE SURFACE, NOT TWO. This used to be a matte `dark` interior mass 0.5 m deep
   * centred on -L/2 + 0.2, with a glossy `windowDark` opening panel 0.08 deep
   * centred on -L/2 - 0.01 in front of it. Both of those put a forward-facing face
   * on EXACTLY the plane x = -L/2 - 0.05, with nothing to arbitrate between them
   * but the draw order. Unbatched the order hid most of the mass (diagonal moire at
   * plaza); core/static-batch.ts changed the order and the doorway broke into a
   * dense dither - 22.2% of the panel and 55.0% of its bottom-right quadrant
   * speckled at the slalom station, against 0.0000% on a same-build control.
   *
   * Two fixes were built and photographed at both stations (both reach 0.0000%
   * speckle, so the tie-break is the READ, not the metric):
   *   A  recess the mass 100 mm behind the panel. The panel then wins everywhere -
   *      and windowDark is roughness 0.12 / envMapIntensity 2, so it reflects the
   *      sky: the doorway went from luma 41.7 to 105.8 and read as a closed glazed
   *      shutter with a ramp propped against it.
   *   B  taken. The panel is the REDUNDANT one: it cannot give the read this
   *      doorway needs, and the matte mass can. So the panel is dropped and the
   *      mass is widened from (rearW - 0.06, rearH - 0.06) to the full opening,
   *      staying on the plane the panel's front face occupied. The doorway keeps
   *      its outline, its 0.05 m proudness and its dark read (luma 31.7), the
   *      module loses 12 triangles, and there is no second surface left for any
   *      draw order to fight over.
   * The +z side doorway above is NOT this shape: its mass already sits behind its
   * panel with 80 mm of separation, so it never tied and is left alone.
   */
  g.add(box(0.5, rearH, rearW, dark, -L / 2 + 0.2, rearY, 0));
  for (const s of [-1, 1]) {
    g.add(box(0.09, rearH + 0.12, 0.09, trim, -L / 2 - 0.02, rearY, s * (rearW / 2 + 0.04)));
  }
  g.add(box(0.09, 0.09, rearW + 0.17, trim, -L / 2 - 0.02, rearY + rearH / 2 + 0.04, 0));
  const rampLen = 2.3;
  const rampAng = Math.asin((floorY - 0.02) / rampLen);
  const ramp = box(rampLen, 0.08, rearW - 0.12, steel,
    -L / 2 - (rampLen * Math.cos(rampAng)) / 2, floorY / 2, 0);
  ramp.rotation.z = rampAng;
  g.add(ramp);

  // INTERPRETIVE: frames never resolved a vent here; a small 3-slat louvre
  // high on the -z flank keeps the aft panel from reading blank. Drop if refs disagree.
  const ventX = -1.6, ventY = H - 0.55;
  g.add(box(0.5, 0.4, 0.06, trim, ventX, ventY, -(W / 2 + 0.01)));
  g.add(inst(new THREE.BoxGeometry(0.42, 0.05, 0.04), dark,
    [0, 1, 2].map((i) => xform(ventX, ventY - 0.11 + i * 0.11, -(W / 2 + 0.045)))));

  // abstract scuff streaks on the lower band, no text; jitter from ctx.rand()
  const scuff = ctx.mat.painted(PAL.truckCab, 0.85, 0);
  const jz = (ctx.rand() - 0.5) * 0.1;
  g.add(box(1.9, 0.1, 0.02, scuff, -0.4, floorY + 0.32 + jz, W / 2 + 0.012));
  g.add(box(1.2, 0.07, 0.02, scuff, 0.2 - jz, floorY + 0.18, -(W / 2 + 0.012)));

  // A-frame drawbar converging to the hitch plate + twin landing legs
  const drawLen = 1.5;               // fleet grounding: ~1.5 m drawbar, collider len ~9.0
  for (const s of [-1, 1]) {
    const arm = box(drawLen + 0.5, 0.12, 0.12, steel, L / 2 + drawLen / 2 - 0.2, 0.62, s * 0.55);
    arm.rotation.y = s * 0.26;
    g.add(arm);
    g.add(box(0.12, 0.75, 0.12, steel, L / 2 - 0.6, 0.38, s * 0.85));
    g.add(box(0.3, 0.06, 0.3, steel, L / 2 - 0.6, 0.05, s * 0.85));
  }
  g.add(box(0.4, 0.1, 0.3, steel, L / 2 + drawLen - 0.05, 0.55, 0));

  // tandem REAR wheels only; whitewall rings come free with wheels()
  wheels(g, ctx, [-1.7, -2.75], 1.08, 0.46, 0.28);
  return { obj: g, len: L + drawLen + 0.15, wid: W + 0.12, hgt: H + 0.09 };
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
// ------------------------------------------------------------------ display exhibit

/**
 * Display-condition 1950s sedan for the -z pavement plinth at the -x mouth.
 * L 5.3 / W 2.0 / H ~1.5. Same construction idioms as makeSaloon (extruded
 * lower body + two-piece greenhouse, fin blades, chrome spear/bumpers/grille,
 * lamps/tailLamps, instanced shut-lines/handles) with single-tone carTeal
 * paint (closest existing key; the reference display green reads deeper),
 * full brightwork, taller fins, and horizontal chrome slats across the rear
 * deck. Nose along local +x; whitewalls via wheels().
 */
function makeDisplaySedan(ctx: BuildContext): Vehicle {
  const L = 5.3, W = 2.0, H = 1.52;
  const g = group('display-sedan');
  const paint = ctx.mat.painted(PAL.carTeal, 0.30, 0.35);
  const trim = brightwork(ctx);

  // lower body: rocker to beltline, bonnet down at the nose, boot up at the tail
  const body: Pt[] = [
    [-L / 2, 0.34], [L / 2, 0.34], [L / 2 + 0.02, 0.78], [1.25, 0.90],
    [-1.75, 0.94], [-L / 2 + 0.06, 0.98], [-L / 2 - 0.02, 0.76],
  ];
  g.add(extrude(body, W, paint));

  // greenhouse: wraparound screen + side band in glass, solid sail quarters
  const glass: Pt[] = [[-1.15, 0.88], [1.08, 0.88], [0.62, 1.36], [-1.15, 1.36]];
  g.add(extrude(glass, W * 0.82, ctx.mat.windowDark));
  const quarter: Pt[] = [[-1.75, 0.88], [-1.10, 0.88], [-1.10, 1.37], [-1.30, 1.37]];
  g.add(extrude(quarter, W * 0.84, paint));
  g.add(box(2.00, 0.10, W * 0.86, paint, -0.33, 1.41, 0));

  // TALLER fins than the road saloons: blades rise 0.42 above the boot lid
  const fin: Pt[] = [
    [-L / 2 + 0.10, 0.80], [-1.25, 0.88], [-L / 2 + 0.04, 0.92 + 0.42],
  ];
  for (const s of [-1, 1]) {
    const f = extrude(fin, 0.09, paint);
    f.position.z = s * (W / 2 - 0.05);
    g.add(f);
  }

  // horizontal chrome slats across the rear deck between the fin roots
  const slats: THREE.Matrix4[] = [];
  for (let i = 0; i < 4; i++) slats.push(xform(-2.02, 1.00 + i * 0.055, 0));
  g.add(inst(new THREE.BoxGeometry(0.55, 0.030, 1.20), trim, slats));

  // full brightwork: side spear, rocker, bumpers, grille, 4-lamp nose
  g.add(box(4.00, 0.07, W + 0.04, trim, 0.10, 0.72, 0));
  g.add(box(4.30, 0.05, W + 0.05, trim, 0, 0.40, 0));
  g.add(box(0.20, 0.18, W - 0.06, trim, L / 2 - 0.02, 0.46, 0));
  g.add(box(0.20, 0.18, W - 0.12, trim, -L / 2 + 0.02, 0.50, 0));
  g.add(box(0.09, 0.26, 1.50, trim, L / 2 + 0.02, 0.66, 0));
  g.add(box(0.62, 0.05, W * 0.87, trim, -1.45, 1.00, 0));
  lamps(g, ctx, L / 2 - 0.01, 0.62, [-0.80, -0.55, 0.55, 0.80], 0.12);
  // greenhouse frame: belt rail under the side glass, drip rail over it
  g.add(box(2.30, 0.05, W * 0.84 + 0.02, trim, -0.05, 0.895, 0));
  g.add(box(2.05, 0.045, W * 0.86, trim, -0.27, 1.345, 0));

  // door shut-lines (four per flank) and chrome handles, all instanced
  const shutDark = ctx.mat.painted(PAL.truckCab, 0.6, 0.2);
  const shutXf: THREE.Matrix4[] = [];
  for (const hx of [1.12, 0.06, -0.12, -1.67]) {
    shutXf.push(xform(hx, 0.62, W / 2 + 0.004));
    shutXf.push(xform(hx, 0.62, -W / 2 - 0.004));
  }
  g.add(inst(new THREE.BoxGeometry(0.035, 0.52, 0.025), shutDark, shutXf));
  g.add(inst(new THREE.BoxGeometry(0.18, 0.04, 0.03), trim, [
    xform(0.86, 0.82, W / 2 + 0.008), xform(0.86, 0.82, -W / 2 - 0.008),
    xform(-0.42, 0.82, W / 2 + 0.008), xform(-0.42, 0.82, -W / 2 - 0.008),
  ]));

  // wing mirrors on stalks at the A-pillars: chrome head, glass facing the driver
  for (const s of [-1, 1]) {
    g.add(box(0.04, 0.04, 0.18, shutDark, 0.95, 1.02, s * (W / 2 + 0.08)));
    g.add(box(0.05, 0.16, 0.12, ctx.mat.chrome, 0.95, 1.12, s * (W / 2 + 0.16)));
    g.add(box(0.02, 0.12, 0.08, ctx.mat.windowDark, 0.92, 1.12, s * (W / 2 + 0.16)));
  }

  // red lenses on the tall fin tips, plates front and rear
  tailLamps(g, ctx, -L / 2 - 0.02, 0.92 + 0.42, [W / 2 - 0.05, -(W / 2 - 0.05)], 0.09);
  const plate = ctx.mat.signText({
    text: 'NT51', color: PAL.truckCab, background: PAL.windowBand, aspect: 2.4,
  });
  g.add(box(0.05, 0.16, 0.40, plate, L / 2 + 0.09, 0.46, 0));
  g.add(box(0.05, 0.16, 0.40, plate, -L / 2 - 0.09, 0.50, 0));

  wheels(g, ctx, [1.68, -1.68], 0.90, 0.36, 0.24);
  return { obj: g, len: L + 0.24, wid: W + 0.09, hgt: H };
}

/** Plinth payload: group origin at ground under the plinth centre, top at 0.4. */
interface DisplayPlinth {
  obj: THREE.Group;
  /** deck height the sedan's wheels rest on (pass as park surfaceY) */
  top: number;
}

/**
 * Display plinth + placard. 6.0 x 0.4 x 2.5 pale pavingWarm deck with a darker
 * lip at its base; placard on two posts at the road-side east corner, board
 * 1.0 x 0.7 sloped ~27 deg, pale face with a generic header + dark line-bars
 * as illegible rows (geometry, never transcribed sentences).
 */
function makeDisplayPlinth(ctx: BuildContext): DisplayPlinth {
  const TOP = 0.4;
  const g = group('display-plinth');
  const deck = ctx.mat.painted(PAL.pavingWarm, 0.9, 0);
  const lip = ctx.mat.painted(PAL.concreteDark, 0.95, 0);

  g.add(slab(6.0, TOP, 2.5, deck, 0, 0, 0));
  g.add(box(6.15, 0.12, 2.65, lip, 0, 0.06, 0));

  // placard at the road-side (+z) east (+x) corner, standing on the pavement
  const post = ctx.mat.steel;
  for (const dx of [-0.35, 0.35]) g.add(box(0.08, 0.90, 0.08, post, 3.60 + dx, 0.45, 0.90));
  const board = box(1.0, 0.7, 0.06, deck, 3.60, 0.95, 0.90);
  board.rotation.x = -0.47; // ~27 deg lectern slope, face tipped to the road
  const head = box(0.50, 0.14, 0.02,
    ctx.mat.signText({ text: 'MOTORS', color: PAL.truckCab, background: PAL.windowBand, aspect: 3.4 }),
    0, 0.18, 0.045);
  board.add(head);
  const rowDark = ctx.mat.painted(PAL.truckCab, 0.7, 0.1);
  const rows: THREE.Matrix4[] = [];
  for (let i = 0; i < 3; i++) rows.push(xform(0, 0.02 - i * 0.11, 0.045));
  board.add(inst(new THREE.BoxGeometry(0.70, 0.045, 0.02), rowDark, rows));
  g.add(board);

  return { obj: g, top: TOP };
}

// ------------------------------------------------------------------ placement

export const buildVehicles: Builder = (ctx) => {
  const out = group('vehicles');
  const colliders: AABB[] = [];

  /** distinguishes the batched meshes of the two identically-named saloons */
  let parked = 0;

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
    // Every vehicle is authored as ~45 loose meshes and finished the moment it is
    // parked: nothing here moves, deforms or is hidden again. Collapse each one into
    // one mesh per (material instance, shadow flags, attribute set) - see
    // core/static-batch.ts. Deliberately PER VEHICLE and not over the whole fleet:
    // a merged mesh is frustum-culled as a unit, and merging the head pair with the
    // stem pair would submit the far half of the street's triangles at every station
    // that can only see the near half.
    batchStatic(v.obj, v.obj.name + parked++);
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

  // SLALOM GATE — rigid truck (south) + towed trailer (north) parked parallel
  // to the kerbs at the same x, noses west, leaving a ~2.6 m central slot at
  // z=0 the player threads straight through. Diagonal gates were tried first
  // and walled the street: a 10 m hull within a metre of the z=0 beeline
  // stalls the traverse walker for the whole route, and any true-3 m far-lane
  // slot covers z=0 by construction on a 9.2 m road. The paired parallel gate
  // is also the footage read (rigid parallel-parked at the kerb, f-FKQOEO-1ceE-153).
  // Truck: x -40.9..-31.1, z -4.85..-1.15. Trailer: x -40.6..-31.4,
  // z +1.46..+4.54. Slot between: ~2.6 m. Route-4 waypoint (-30,-2) stays
  // east of both hulls; route-1 x=-20 leg is 11 m clear.
  park(makeBoxTruck(ctx),
    -36 + nudge(),
    -3.0,
    NOSE_DOWN_STEM + 0.05 + skew());

  // Towed trailer, north side of the slalom, nose west; drawbar runs ahead to
  // ~-42, ramp trails east at kerb height. Ground crate on the truck's hatch
  // side narrows the slot mouth locally to ~2.7 m — still inside the band.
  park(makeTrailer(ctx),
    -36 + nudge(),
    3.0,
    NOSE_DOWN_STEM - 0.05 + skew());
  // Show-condition two-tone in the open road stem, held to the orange kerb
  // side so the far lane stays open. Kept carBlue: the display sedan above is
  // the teal show car now, and plaza.ts owns the NT05 dais car.
  park(makeSaloon(ctx, PAL.carBlue, { fin: 0.32, twoTone: true, brightwork: true }),
    -HOUSE_HALF_LEN * 0.3 + nudge(),
    ORANGE.side * ROAD_HALF_WIDTH * 0.52,
    0.18 + skew());

  // SECOND BUS on the head, white (+z) half, nosed down the stem — the old
  // rigid slot. A stem gate-3 with a true ~3 m slot is geometrically exclusive
  // with the turningHead lens standing mid-road at (6, 2.6, 1.0): any hull
  // pinching the +z lane to 3 m covers z=1.0 and swallows the camera (tried
  // x=9, 14 and 15.5 — inside it, then frame-filling). The head pair per NT02
  // (coach -z, bus +z) keeps every fidelity lens clear; truck + trailer hold
  // the stem slalom with its ~2.6 m central slot.
  parkOnHead(makeSecondBus(ctx),
    HEAD_CENTER_X - HEAD_RADIUS * 0.06 + nudge(),
    WHITE.side * HEAD_RADIUS * 0.42,
    NOSE_DOWN_STEM + skew());

  // The hero coach, on the orange (-z) half of the head, parked ACROSS the
  // bulb rather than square down the stem. Nosed straight at the turningHead
  // station it shows nothing but its front, and half of NT07 is the Nuketown
  // script on the flank; a quarter turn puts nose and flank in one frame.
  parkOnHead(makeCoach(ctx),
    HEAD_CENTER_X - 0.30 + nudge(),
    ORANGE.side * HEAD_RADIUS * 0.33,
    NOSE_DOWN_STEM - 0.44 + skew());

  // dark blue saloon tucked in outboard of the second bus, white (+z) half.
  // The head stays passable: coach -z, bus inner +z, saloon outer +z, with the
  // route-5 end threading between coach and bus.
  parkOnHead(makeSaloon(ctx, PAL.carBlue, { fin: 0.2, twoTone: false, brightwork: false }),
    HEAD_CENTER_X + HEAD_RADIUS * 0.06 + nudge(),
    WHITE.side * HEAD_RADIUS * 0.76,
    NOSE_DOWN_STEM + skew());

  // red saloon on the orange house's driveway apron, nose out to the street
  park(makeSaloon(ctx, PAL.carRed, { fin: 0.26, twoTone: true, brightwork: false }),
    ORANGE.garageX + GARAGE_LEN * 0.1,
    ORANGE.side * (FRONT_LAWN_OUTER + PAVEMENT_OUTER) * 0.5,
    ORANGE.side * Math.PI * 0.5 + skew(),
    APRON_Y);

  return { group: out, colliders };
};
