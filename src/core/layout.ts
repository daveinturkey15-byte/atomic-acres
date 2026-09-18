/**
 * ATOMIC ACRES - LAYOUT CONTRACT (single source of truth)
 *
 * Frame: y-up, right-handed. Plan view looks down -y; +x is right of page, +z is down.
 *   Street = CENTRAL turning circle between the houses. One road stem leaves it WEST
 *   (-x) through a barrier to the out-of-bounds entrance plaza; the east side is an
 *   apron to the boundary fence, with the third structure beyond it as a landmark.
 *   -z house = ORANGE  (terracotta upper / cream lower, butterfly roof). Garage at its -x end.
 *   +z house = WHITE   (rounded modernist capsules). Garage at its +x end.
 *
 * Invariant (the one bit): from either back yard, facing your own house, the garage is
 * on your RIGHT. This is a 180-degree rotational pair, NOT a mirror pair.
 *
 * Every builder module imports from here. Never hardcode a dimension in a builder.
 * Units are metres.
 *
 * ---------------------------------------------------------------------------------
 * PROVENANCE OF THESE NUMBERS  (2026-09-18)
 *
 * Measured off the official BO2 minimap, `docs/reference/img/nt2025-minimap-boii.png`,
 * which is an orthographic plan - the only rotation-free source we have. It is a real
 * download this time: the previous copies of every file in that directory were 5.8 kB
 * HTML error pages, because the fetch had no browser User-Agent and nobody opened the
 * result. Any claim sourced from "the minimap" before 2026-09-18 is void.
 *
 * SCALE: 0.19 m per minimap pixel.  This is the one assumption everything else rides
 * on, so it is stated rather than buried. It was chosen where two independent
 * estimates meet: the parked coach measures ~60 px (a period coach is ~11-12 m), and
 * the long axis measures 425 px, which at 0.19 gives 81 m - about 12 s of sprinting at
 * the BO2 sprint speed in `player.ts`, which matches how long the real map takes to
 * cross. FALSIFIER: if a reliable source gives any single real dimension of Nuketown
 * 2025, divide it by the pixel count below and this whole table rescales by that ratio.
 *
 * Measured, in minimap pixels, circle centre at (271, 281):
 *   turning circle radius            48 px   -> 9.12 m   (fitted, not eyeballed)
 *   house front wall from centre     81 px   -> 15.4 m
 *   house depth front->back          59 px   -> 11.2 m
 *   house overall width              93 px   -> 17.7 m   (main block + garage wing)
 *   yard band width                 119 px   -> 22.6 m
 *   long axis, fence to fence       425 px   -> 80.8 m
 *   short axis, at the circle       180 px   -> 34.2 m
 *
 * WHAT THIS CHANGED. The previous table had the street axis spanning 100 m against a
 * 76 m house axis. The minimap says the opposite: the house-to-house axis is the LONG
 * one and the street is SHORT - the turning circle is most of it. The map was roughly
 * 2.8x too long along the street, which is why it read as an empty boulevard instead
 * of the tight cul-de-sac it should be.
 */

// ---------------------------------------------------------------- street
export const ROAD_HALF_WIDTH = 4.4;
export const KERB_HEIGHT = 0.15;
export const KERB_WIDTH = 0.3;
export const PAVEMENT_OUTER = 7.0; // |z| where pavement ends and lawn begins
export const ROAD_X_MIN = -19.5; // west barrier; the stem continues past it as out-of-bounds scenery
export const ROAD_X_MAX = 16.0; // east apron to the boundary fence, no through road

// central turning circle between the houses per BO2 minimap/aerial (was lollipop at +x end - corrected error inherited from FINDINGS.md cul-de-sac claim)
export const HEAD_CENTER_X = 0.0;
export const HEAD_RADIUS = 9.2; // 48 px fitted radius x 0.19 m/px

// ---------------------------------------------------------------- houses
export const FRONT_LAWN_OUTER = 15.4; // |z| of the house front wall (81 px)
export const HOUSE_DEPTH = 11.2; // front wall -> back wall (59 px)
export const HOUSE_BACK = FRONT_LAWN_OUTER + HOUSE_DEPTH;  // 26.6
export const HOUSE_HALF_LEN = 6.4; // main block spans x in [-6.4, +6.4]
export const FLOOR_H = 3.15;              // ground floor height
export const UPPER_H = 3.05;              // upper floor height
export const EAVE_Y = FLOOR_H + UPPER_H;  // 6.20 - top of upper wall

// garage wing (attached to one end of the main block)
export const GARAGE_LEN = 4.8; // wing outside the main block; overall house width 17.6 m
export const GARAGE_DEPTH = 7.4;
export const GARAGE_H = 3.65;
export const GARAGE_BAYS = 3;

// rear deck at upper-floor level, opposite end from the garage
export const DECK_Y = FLOOR_H;
export const DECK_LEN = 6.0;
export const DECK_OUT = 3.4;              // projection into the back yard
export const RAIL_H = 1.05;

// deep cantilevered porch canopy on the street face
export const CANOPY_Y = 3.35;
export const CANOPY_LEN = 5.6;
export const CANOPY_OUT = 2.9;

// ---------------------------------------------------------------- yards
export const BACK_FENCE = 37.0; // |z| of the timber back fence
export const FENCE_H = 2.1;
export const YARD_X_MIN = -13.2;
export const YARD_X_MAX = 13.2; // garage end leaves a 2.0 m squeeze, the far end a 6.8 m flank

// ---------------------------------------------------------------- bounds
export const BOUND_X_MIN = -19.5;
export const BOUND_X_MAX = 25.0;
export const BOUND_Z = 42;
// The third structure is scenery beyond the east boundary fence, not cover: it gives
// the east flank something to read against so the fence is not the end of the world.
// It must stay clear of ROAD_X_MAX (the apron) and of BOUND_X_MAX (the collider wall).
export const THIRD_HOUSE_X = 21.0; // out-of-bounds landmark beyond the east fence

// ---------------------------------------------------------------- spawns
// Camera forward is (-sin(yaw), 0, -cos(yaw)): yaw 0 faces -z, yaw PI faces +z.
// A spawn stands in its own back yard and must look AT its own house, i.e. inward
// toward z=0 - spawn A from -z looks +z (PI), spawn B from +z looks -z (0).
// Stand back near the fence, not under the deck, and offset in x away from each
// house's deck (ORANGE.deckX is +x, WHITE.deckX is -x) so the house reads on spawn.
// z = +/-34.3 is 2.7 m off the back fence at its new |z| of 37.
export const SPAWN_A = { x: -4.0, y: 0, z: -34.3, yaw: Math.PI }; // orange, faces +z
// Mirrored from SPAWN_A through the origin, which is what a 180-degree pair requires:
// each team stands on the deck-free side of its own yard.
export const SPAWN_B = { x: 1.2, y: 0, z: 34.3, yaw: 0 };        // white,  faces -z

export const EYE_HEIGHT = 1.68;

/** House side descriptor. side = -1 is the ORANGE house, +1 is the WHITE house. */
export interface HouseSide {
  side: -1 | 1;
  /** z of the street-facing front wall (signed) */
  frontZ: number;
  /** z of the rear wall (signed) */
  backZ: number;
  /** x of the garage-wing centre. Orange: -x end. White: +x end. */
  garageX: number;
  /** sign of the x end the garage sits on */
  garageEnd: -1 | 1;
  /** x of the rear deck centre (opposite end from the garage) */
  deckX: number;
  /** x of the street-face door centre */
  frontDoorX: number;
  /** x of the yard-face door centre */
  backDoorX: number;
}

/**
 * Keep-clear apron in front of every door. Nothing - prop, planter, crate, shed - may
 * stand in it, and the house's own interior dressing may not back onto it either.
 *
 * This exists because door positions used to be private to each house builder, so the
 * yard had no way to know where they were. After the 2026-09-18 re-proportioning a
 * crate store landed 2.7 m outside the orange back door and a sofa 0.6 m inside it,
 * and the house reported "no way through this face" - a sealed house that no single
 * module was wrong about. The doors live here now so everyone can avoid them.
 */
export const DOOR_APRON_HALF_W = 1.35;   // half-width, centred on the door
export const DOOR_APRON_DEPTH = 3.2;     // how far out from the wall it reaches

export const ORANGE: HouseSide = {
  side: -1,
  frontZ: -FRONT_LAWN_OUTER,
  backZ: -HOUSE_BACK,
  garageEnd: -1,
  garageX: -(HOUSE_HALF_LEN + GARAGE_LEN / 2),
  deckX: HOUSE_HALF_LEN - DECK_LEN / 2,
  frontDoorX: HOUSE_HALF_LEN * 0.24,
  backDoorX: -HOUSE_HALF_LEN * 0.32,
};

export const WHITE: HouseSide = {
  side: 1,
  frontZ: FRONT_LAWN_OUTER,
  backZ: HOUSE_BACK,
  garageEnd: 1,
  garageX: HOUSE_HALF_LEN + GARAGE_LEN / 2,
  deckX: -(HOUSE_HALF_LEN - DECK_LEN / 2),
  frontDoorX: -HOUSE_HALF_LEN * 0.16,
  backDoorX: HOUSE_HALF_LEN * 0.26,
};

export const HOUSES = [ORANGE, WHITE] as const;

/**
 * Handedness assertion, derived - never copied from a document.
 * Stand in the back yard, face your own house, check the garage falls to your right.
 * Returns true when both houses agree, which a 180-degree pair must.
 */
export function garageIsOnTheRight(h: HouseSide): boolean {
  // yard -> house is the facing direction; in plan (x,z) with y up,
  // "right" of a heading (dx,dz) is (-dz, dx) rotated for a y-up right-handed frame.
  const facingZ = -h.side;                 // from yard, walk toward z=0
  const rightX = -facingZ;                 // right-hand vector's x component
  return Math.sign(h.garageX) === Math.sign(rightX);
}
