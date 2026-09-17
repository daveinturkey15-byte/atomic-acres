/**
 * NUKETOWN 2025 - LAYOUT CONTRACT (single source of truth)
 *
 * Frame: y-up, right-handed. Plan view looks down -y; +x is right of page, +z is down.
 *   Street = CENTRAL turning circle between the houses (BO2 minimap/aerial): the bulb
 *   is the middle of the map, with a single road stem leaving it westward (-x) off-map
 *   to the entrance plaza. The east side is the bulb tangent + driveway apron to the
 *   boundary fence, NOT a through road; +x beyond the fence = THIRD HOUSE end.
 *   -z house = ORANGE  (terracotta upper / cream lower, butterfly roof). Garage at its -x end.
 *   +z house = WHITE   (rounded modernist capsules). Garage at its +x end.
 *
 * Invariant (the one bit): from either back yard, facing your own house, the garage is
 * on your RIGHT. This is a 180-degree rotational pair, NOT a mirror pair.
 *
 * Every builder module imports from here. Never hardcode a dimension in a builder.
 * Units are metres.
 */

// ---------------------------------------------------------------- street
export const ROAD_HALF_WIDTH = 4.6;
export const KERB_HEIGHT = 0.15;
export const KERB_WIDTH = 0.3;
export const PAVEMENT_OUTER = 7.2;        // |z| where pavement ends and lawn begins
export const ROAD_X_MIN = -52;            // single west stem off-map to the plaza (preserved end)
export const ROAD_X_MAX = 10.5;           // = HEAD_CENTER_X + HEAD_RADIUS, bulb east tangent + driveway apron to fence, no through road (same construction as before)

// central turning circle between the houses per BO2 minimap/aerial (was lollipop at +x end - corrected error inherited from FINDINGS.md cul-de-sac claim)
export const HEAD_CENTER_X = 0.0;
export const HEAD_RADIUS = 10.5;          // 85px diameter x 0.25m/px = 21.25m diameter = 86% of 99px house gap, large fraction per minimap

// ---------------------------------------------------------------- houses
export const FRONT_LAWN_OUTER = 13.6;     // |z| of the house front wall
export const HOUSE_DEPTH = 9.2;           // front wall -> back wall
export const HOUSE_BACK = FRONT_LAWN_OUTER + HOUSE_DEPTH;  // 22.8
export const HOUSE_HALF_LEN = 9.6;        // main block spans x in [-9.6, +9.6]
export const FLOOR_H = 3.15;              // ground floor height
export const UPPER_H = 3.05;              // upper floor height
export const EAVE_Y = FLOOR_H + UPPER_H;  // 6.20 - top of upper wall

// garage wing (attached to one end of the main block)
export const GARAGE_LEN = 7.6;
export const GARAGE_DEPTH = 8.0;
export const GARAGE_H = 3.65;
export const GARAGE_BAYS = 3;

// rear deck at upper-floor level, opposite end from the garage
export const DECK_Y = FLOOR_H;
export const DECK_LEN = 7.2;
export const DECK_OUT = 3.4;              // projection into the back yard
export const RAIL_H = 1.05;

// deep cantilevered porch canopy on the street face
export const CANOPY_Y = 3.35;
export const CANOPY_LEN = 6.4;
export const CANOPY_OUT = 2.9;

// ---------------------------------------------------------------- yards
export const BACK_FENCE = 34.0;           // |z| of the timber back fence
export const FENCE_H = 2.1;
export const YARD_X_MIN = -20.0;
export const YARD_X_MAX = 20.0;

// ---------------------------------------------------------------- bounds
export const BOUND_X_MIN = -54;
export const BOUND_X_MAX = 46;
export const BOUND_Z = 38;
// Far enough east that the house body clears the central turning head's pavement ring
// (HEAD_CENTER_X + HEAD_RADIUS + kerb + pavement ~ 10.5 + kerb + pavement, ring edge ~18).
// At 40 the gable face landed at x 36.7, clear of the recentred ring; kept at 44.5.
// Ends preserved: road -x/plaza, third house +x (kept to avoid blast radius).
export const THIRD_HOUSE_X = 44.5;        // east of the central head, past the boundary fence

// ---------------------------------------------------------------- spawns
// Camera forward is (-sin(yaw), 0, -cos(yaw)): yaw 0 faces -z, yaw PI faces +z.
// A spawn stands in its own back yard and must look AT its own house, i.e. inward
// toward z=0 - spawn A from -z looks +z (PI), spawn B from +z looks -z (0).
// Stand back near the fence, not under the deck: at z=+/-29 the spawn was ~3 m from
// the rear deck's outer edge and the whole frame was stair. Offset in x away from each
// house's deck (ORANGE.deckX is +x, WHITE.deckX is -x) so the house reads on spawn.
export const SPAWN_A = { x: -4.0, y: 0, z: -31.8, yaw: Math.PI }; // orange, faces +z
// x=+4 put spawn B INSIDE the white yard's sand pit (x 2.8..6.8, z 30.0..33.0) -
// the first thing that team saw was a timber kerb across the bottom of frame.
// -1.2 clears both the pit and the deck at WHITE.deckX = -6.
export const SPAWN_B = { x: -1.2, y: 0, z: 31.2, yaw: 0 };        // white,  faces -z

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
}

export const ORANGE: HouseSide = {
  side: -1,
  frontZ: -FRONT_LAWN_OUTER,
  backZ: -HOUSE_BACK,
  garageEnd: -1,
  garageX: -(HOUSE_HALF_LEN + GARAGE_LEN / 2),
  deckX: HOUSE_HALF_LEN - DECK_LEN / 2,
};

export const WHITE: HouseSide = {
  side: 1,
  frontZ: FRONT_LAWN_OUTER,
  backZ: HOUSE_BACK,
  garageEnd: 1,
  garageX: HOUSE_HALF_LEN + GARAGE_LEN / 2,
  deckX: -(HOUSE_HALF_LEN - DECK_LEN / 2),
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
