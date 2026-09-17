/**
 * VEHICLES - the Nuketown 2025 street fleet.
 *
 * 1950s/60s American iron in a retro-futurist show town: slab sides, heavy chrome,
 * whitewall tyres, wraparound screens. Every one of these is a cover object the
 * player fights around, so silhouette and a solid collider beat panel detail.
 *
 * References: NT07 (cream/maroon intercity coach - NOT a school bus), NT05 load
 * screen (teal classic with fins on the plaza), NT02 aerial (coach, box truck and
 * a saloon standing on the turning head).
 *
 * All vehicles are authored nose-along-local-+x and then yawed into place, so the
 * wheel cylinders are rotated about X (flat faces point sideways, axle along z).
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

/**
 * Big brightwork - bumpers, grilles, spears, arches, hubcaps.
 *
 * `ctx.mat.chrome` is metalness 0.95 and world.ts lights the map with a sun, a
 * hemisphere and a fill but NO environment map, so a full metal has no indirect
 * specular to reflect and renders black except for one hot spot. Verified by
 * rendering: every bumper and grille came out as a black hole. So the large
 * chrome faces are a low-metal polish off the same palette entry, which reads as
 * brightwork under this rig. Small dark seams (mullions, rivets) keep the real
 * chrome, where near-black is the right answer anyway. Revert to ctx.mat.chrome
 * throughout if an environment map ever lands in world.ts.
 */
function brightwork(ctx: BuildContext): THREE.Material {
  return ctx.mat.painted(PAL.chrome, 0.24, 0.4);
}

type Pt = [number, number];

interface Vehicle {
  obj: THREE.Group;
  /** along the nose axis */
  len: number;
  /** across the body */
  wid: number;
  /** roof height above the road */
  hgt: number;
}

// ------------------------------------------------------------------ helpers

function xform(x: number, y: number, z: number, rx = 0): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)),
    new THREE.Vector3(1, 1, 1),
  );
}

function inst(
  geo: THREE.BufferGeometry, mat: THREE.Material, xf: THREE.Matrix4[],
): THREE.InstancedMesh {
  const m = new THREE.InstancedMesh(geo, mat, xf.length);
  for (let i = 0; i < xf.length; i++) m.setMatrixAt(i, xf[i]);
  m.instanceMatrix.needsUpdate = true;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Whitewall wheels + chrome arches, four instanced draw calls whatever the count. */
function wheels(
  g: THREE.Group, ctx: BuildContext,
  xs: number[], zHalf: number, r: number, w: number,
): void {
  const hubs: THREE.Matrix4[] = [];
  const arches: THREE.Matrix4[] = [];
  for (const x of xs) {
    for (const s of [-1, 1]) {
      hubs.push(xform(x, WHEEL_REST + r, s * zHalf, Math.PI / 2));
      arches.push(xform(x, WHEEL_REST + r, s * (zHalf + w * 0.5 + 0.02)));
    }
  }
  // each ring sits slightly proud of the one inside it, so no coplanar fighting
  g.add(inst(new THREE.CylinderGeometry(r, r, w, 18),
    ctx.mat.painted(PAL.asphalt, 0.95, 0), hubs));
  g.add(inst(new THREE.CylinderGeometry(r * 0.74, r * 0.74, w * 1.04, 18),
    ctx.mat.painted(PAL.kerb, 0.68, 0), hubs));
  g.add(inst(new THREE.CylinderGeometry(r * 0.40, r * 0.40, w * 1.10, 12),
    brightwork(ctx), hubs));
  g.add(inst(new THREE.TorusGeometry(r * 1.07, r * 0.07, 6, 14, Math.PI),
    brightwork(ctx), arches));
}

/** A row of round headlamps: chrome bezel plus a pale lens. */
function lamps(
  g: THREE.Group, ctx: BuildContext,
  x: number, y: number, zs: number[], r: number,
): void {
  const xf = zs.map((z) => xform(x, y, z, 0));
  const bez = new THREE.CylinderGeometry(r, r, 0.1, 12);
  bez.rotateZ(Math.PI / 2);
  const lens = new THREE.CylinderGeometry(r * 0.76, r * 0.76, 0.14, 12);
  lens.rotateZ(Math.PI / 2);
  g.add(inst(bez, brightwork(ctx), xf));
  g.add(inst(lens, ctx.mat.painted(PAL.windowBand, 0.12, 0.3), xf));
}

// ------------------------------------------------------------------ the coach

/** NT07: cream body, maroon swoosh, chrome belt, six wheels. ~11 x 2.6 x 3.2 m. */
function makeCoach(ctx: BuildContext): Vehicle {
  const L = 11.0, W = 2.6, H = 3.2;
  const g = group('coach');
  const cream = ctx.mat.painted(PAL.coachCream, 0.5, 0.12);
  const trim = brightwork(ctx);

  // slab-sided shell: raked screen, slightly domed roof, one draw call
  const shell: Pt[] = [
    [-L / 2 + 0.08, 0.62], [L / 2 - 0.16, 0.62], [L / 2, 1.10], [L / 2 - 0.28, 2.42],
    [L / 2 - 0.58, 2.98], [L / 2 - 1.20, H], [-L / 2 + 1.08, H],
    [-L / 2 + 0.36, 2.94], [-L / 2 + 0.06, 2.36], [-L / 2 + 0.08, 1.00],
  ];
  g.add(extrude(shell, W, cream));

  // the maroon swoosh: one slab 0.03 proud of each flank shows on both sides
  const swoosh: Pt[] = [
    [-L / 2 + 0.10, 0.95], [-0.60, 0.95], [3.00, 1.48], [L / 2 - 0.15, 1.55],
    [L / 2 - 0.15, 1.90], [3.00, 1.83], [-0.60, 1.30], [-L / 2 + 0.10, 1.30],
  ];
  g.add(extrude(swoosh, W + 0.06, ctx.mat.painted(PAL.coachMaroon, 0.42, 0.2)));

  // Chrome belt and rocker trim, proud of the swoosh as well as the shell.
  // The belt stops just inside the raked nose - run it full length and it
  // punches through the front face and lies across the windscreen.
  g.add(box(L - 0.42, 0.08, W + 0.10, trim, -0.01, 1.95, 0));
  g.add(box(L - 0.45, 0.07, W + 0.03, trim, 0, 0.80, 0));

  // long band of side windows with chrome mullions
  g.add(box(8.7, 0.95, W + 0.04, ctx.mat.windowDark, 0.05, 2.45, 0));
  const mull: THREE.Matrix4[] = [];
  for (let i = 0; i < 9; i++) mull.push(xform(-4.0 + i * 0.98, 2.45, 0));
  g.add(inst(new THREE.BoxGeometry(0.07, 0.95, W + 0.09), ctx.mat.chrome, mull));

  // riveted panel seams: two rows of alloy rivets through both flanks
  const rivets: THREE.Matrix4[] = [];
  const rivet = new THREE.CylinderGeometry(0.026, 0.026, W + 0.12, 6);
  for (let i = 0; i < 22; i++) {
    const x = -L / 2 + 0.55 + i * 0.47;
    rivets.push(xform(x, 1.83, 0, Math.PI / 2));
    rivets.push(xform(x, 0.92, 0, Math.PI / 2));
  }
  g.add(inst(rivet, ctx.mat.chrome, rivets));

  // Raked windscreen in the UPPER front only - the panel below it carries the
  // grille and the headlamps, the way an intercity coach is laid out.
  const screen = box(0.1, 0.8, W - 0.36, ctx.mat.painted(PAL.glass, 0.1, 0.35),
    L / 2 - 0.214, 2.01, 0);
  screen.rotation.z = 0.21;
  g.add(screen);
  g.add(box(0.1, 0.95, W - 0.4, ctx.mat.painted(PAL.glass, 0.1, 0.35),
    -L / 2 + 0.08, 2.1, 0));
  g.add(box(0.12, 0.34, 1.9, ctx.mat.painted(PAL.coachMaroon, 0.42, 0.2),
    L / 2 - 0.42, 2.62, 0));

  // bumpers, grille and round headlights on the solid lower nose
  g.add(box(0.22, 0.26, W - 0.12, trim, L / 2 - 0.02, 0.74, 0));
  g.add(box(0.2, 0.24, W - 0.2, trim, -L / 2 + 0.02, 0.74, 0));
  g.add(box(0.1, 0.36, 1.4, trim, L / 2 - 0.02, 1.2, 0));
  lamps(g, ctx, L / 2 - 0.03, 1.2, [-0.98, 0.98], 0.18);

  wheels(g, ctx, [3.75, -2.75, -4.25], 1.18, 0.52, 0.30);
  return { obj: g, len: L, wid: W, hgt: H };
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
  g.add(box(1.0, 0.66, W + 0.03, ctx.mat.windowDark, 2.3, 1.92, 0));
  g.add(box(0.2, 0.26, W - 0.15, trim, L / 2 - 0.02, 0.62, 0));
  g.add(box(0.1, 0.4, 1.7, trim, L / 2 - 0.02, 1.16, 0));
  lamps(g, ctx, L / 2 - 0.03, 1.16, [-1.02, 1.02], 0.15);

  wheels(g, ctx, [2.85, -2.2], 1.08, 0.46, 0.28);
  return { obj: g, len: L, wid: W, hgt: H };
}

// ------------------------------------------------------------------ saloons

interface SaloonOpts {
  /** tail-fin height above the boot lid */
  fin: number;
  /** cream roof, the way every 50s brochure showed it */
  twoTone: boolean;
  /** extra brightwork for the load-screen showpiece */
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

  wheels(g, ctx, [1.52, -1.52], 0.86, 0.34, 0.22);
  return { obj: g, len: L, wid: W, hgt: H };
}

// ------------------------------------------------------------------ placement

export const buildVehicles: Builder = (ctx) => {
  const out = group('vehicles');
  const colliders: AABB[] = [];

  /** nobody parks square */
  const skew = (): number => (ctx.rand() - 0.5) * 0.08;
  const nudge = (): number => (ctx.rand() - 0.5) * 0.35;

  /**
   * Drop a vehicle on the road and give it one tight ground-to-roof AABB.
   * The wheels live inside that footprint, so they never collide separately.
   */
  // `surfaceY` is the height of the surface the wheels rest on. The road is at y=0 but
  // the garage aprons in ground.ts ride on the KERB_HEIGHT plateau, so a car parked on
  // a drive must be lifted by that much or it sits buried to the axles.
  const park = (v: Vehicle, x: number, z: number, yaw: number, surfaceY = 0): void => {
    v.obj.position.set(x, surfaceY, z);
    v.obj.rotation.y = yaw;
    out.add(v.obj);
    const c = Math.abs(Math.cos(yaw));
    const s = Math.abs(Math.sin(yaw));
    colliders.push(aabbSlab(
      x, surfaceY, z, v.len * c + v.wid * s, v.hgt, v.len * s + v.wid * c,
    ));
  };

  const APRON_Y = KERB_HEIGHT + 0.004; // must track ground.ts T_DRIVE

  // 1. the hero coach: turning head, orange (-z) half, nose down the stem
  park(makeCoach(ctx),
    HEAD_CENTER_X - HEAD_RADIUS * 0.10 + nudge(),
    ORANGE.side * HEAD_RADIUS * 0.46,
    NOSE_DOWN_STEM + skew());

  // 2. box truck: turning head, white (+z) half, also nosed down the stem.
  //    The measured 5.5 m gap between it and the coach keeps the head drivable.
  park(makeBoxTruck(ctx),
    HEAD_CENTER_X - HEAD_RADIUS * 0.06 + nudge(),
    WHITE.side * HEAD_RADIUS * 0.42,
    NOSE_DOWN_STEM + skew());

  // 3. dark blue saloon tucked in beside the truck, outboard of it
  park(makeSaloon(ctx, PAL.carBlue, { fin: 0.2, twoTone: false, brightwork: false }),
    HEAD_CENTER_X + HEAD_RADIUS * 0.06 + nudge(),
    WHITE.side * HEAD_RADIUS * 0.76,
    NOSE_DOWN_STEM + skew());

  // 4. the teal showpiece from the load screen, stranded out in the road stem.
  //    Held to the orange kerb side so the far lane stays open.
  park(makeSaloon(ctx, PAL.carTeal, { fin: 0.32, twoTone: true, brightwork: true }),
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
