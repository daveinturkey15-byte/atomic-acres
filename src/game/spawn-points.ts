/**
 * Nuketown 2025 — the spawn point TABLE, derived from `core/layout.ts`.
 *
 * This is the leaf half of `spawns.ts`, which re-exports all of it. Import from
 * `spawns.ts`; this file exists because the table plus the selector came to 441
 * lines and AGENTS.md caps a file at 400 — the same split, for the same reason,
 * as `game/events.ts` and `game/vocab.ts`.
 *
 * `SPAWN_A`/`SPAWN_B` are carried verbatim as the two initial deployment
 * anchors. Every other point is authored ONCE in the orange house's frame and
 * rotated 180° about the origin to produce the white house's, which is the
 * project's one invariant expressed as code rather than re-typed as a second
 * table (AGENTS.md; IMPORT-PLAN §5.5). If `garageIsOnTheRight()` ever flips,
 * this table flips with it for free.
 *
 * Interior coordinates cite `docs/INTERIORS-TOPOLOGY.md` §6.1/§6.2, which gives
 * every room's extent in exactly these coordinates.
 */

import {
  BACK_FENCE,
  BOUND_X_MAX,
  BOUND_X_MIN,
  BOUND_Z,
  FLOOR_H,
  FRONT_LAWN_OUTER,
  GARAGE_DEPTH,
  HOUSE_BACK,
  HOUSE_HALF_LEN,
  ORANGE,
  ROAD_X_MAX,
  ROAD_X_MIN,
  SPAWN_A,
  SPAWN_B,
} from '../core/layout';
import type { TeamId } from './events';
import { TEAM_A, TEAM_B } from './rules';


// ---------------------------------------------------------------------------
// The point table
// ---------------------------------------------------------------------------

export type SpawnArea = 'yard' | 'house' | 'garage' | 'street';

export interface SpawnPoint {
  readonly index: number;
  /** Stable human name; appears in `selectSpawn`'s reason string. */
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  /** null = neutral, usable by either team with no side penalty. */
  readonly team: TeamId | null;
  readonly area: SpawnArea;
  /** 0 = ground (y comes from `WorldQuery.groundY`), 1 = upper floor (y is authored). */
  readonly floor: 0 | 1;
}

/**
 * Camera forward is `(-sin yaw, 0, -cos yaw)` (`core/layout.ts`). This yaw
 * faces the map centre, which from a back yard is your own house, from inside a
 * house is the street, and from the street is the turning circle.
 */
function yawTowardCentre(x: number, z: number): number {
  return Math.atan2(x, z);
}

/** One template row, in the ORANGE house's frame (`side = -1`, z negative). */
interface Template {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly area: SpawnArea;
  readonly floor: 0 | 1;
}

/**
 * Authored once, for the orange side. Coordinates are offsets from
 * `core/layout.ts` anchors; the room each interior point sits in is cited from
 * INTERIORS-TOPOLOGY §6, which gives extents in exactly these coordinates.
 */
const TEMPLATE: readonly Template[] = [
  // Back yard, garage end — behind the garage wing, the flank route's mouth.
  { id: 'yard-garage', x: ORANGE.garageX, z: -(HOUSE_BACK + 4.0), area: 'yard', floor: 0 },
  // Back yard, deck end — clear of the deck, which projects to HOUSE_BACK + DECK_OUT.
  { id: 'yard-deck', x: HOUSE_HALF_LEN + 2.6, z: -(HOUSE_BACK + 2.4), area: 'yard', floor: 0 },
  // Back yard, fence line — the same 2.7 m stand-off from the fence as SPAWN_A,
  // at the opposite end of it.
  { id: 'yard-fence', x: HOUSE_HALF_LEN - 1.4, z: -(BACK_FENCE - 2.7), area: 'yard', floor: 0 },
  // Living room. §6.1: x [-1.0, 6.4], z [-15.4, -21.2].
  { id: 'house-living', x: HOUSE_HALF_LEN * 0.56, z: -(FRONT_LAWN_OUTER + 3.0), area: 'house', floor: 0 },
  // Kitchen, clear of the dining table at (-4.0, -18.0). §6.1: x [-6.4, -1.0], z [-15.4, -21.2].
  { id: 'house-kitchen', x: -HOUSE_HALF_LEN * 0.5, z: -(FRONT_LAWN_OUTER + 4.6), area: 'house', floor: 0 },
  // Garage, mid-bay. §6.1: the wing spans GARAGE_DEPTH back from the street wall.
  { id: 'house-garage', x: ORANGE.garageX, z: -(FRONT_LAWN_OUTER + GARAGE_DEPTH * 0.6), area: 'garage', floor: 0 },
  // Back room, beside the back door. §6.1: x [-6.4, 1.8], z [-21.2, -26.6].
  { id: 'house-back-room', x: -HOUSE_HALF_LEN * 0.375, z: -(HOUSE_BACK - 2.2), area: 'house', floor: 0 },
  // Upper front room, over the living room. §6.2: x [-6.4, -0.5], z [-15.4, -20.6].
  { id: 'house-upper', x: -HOUSE_HALF_LEN * 0.55, z: -(FRONT_LAWN_OUTER + 2.8), area: 'house', floor: 1 },
];

/** Neutral street points. FFA needs somewhere that is nobody's yard. */
const STREET: readonly Template[] = [
  { id: 'street-east', x: ROAD_X_MAX - 3.0, z: 0, area: 'street', floor: 0 },
  { id: 'street-west', x: ROAD_X_MIN + 4.0, z: 0, area: 'street', floor: 0 },
];

function buildPoints(): readonly SpawnPoint[] {
  const out: SpawnPoint[] = [];
  const push = (p: Omit<SpawnPoint, 'index'>): void => {
    out.push({ ...p, index: out.length });
  };

  // The two authored anchors first, so index 0 and 1 are the deployment points
  // the layout contract names and a log line reading "spawn 0" is readable.
  push({ id: 'anchor-a', x: SPAWN_A.x, y: SPAWN_A.y, z: SPAWN_A.z, yaw: SPAWN_A.yaw, team: TEAM_A, area: 'yard', floor: 0 });
  push({ id: 'anchor-b', x: SPAWN_B.x, y: SPAWN_B.y, z: SPAWN_B.z, yaw: SPAWN_B.yaw, team: TEAM_B, area: 'yard', floor: 0 });

  for (const t of TEMPLATE) {
    const y = t.floor === 1 ? FLOOR_H : 0;
    // Orange, as authored.
    push({ id: `a-${t.id}`, x: t.x, y, z: t.z, yaw: yawTowardCentre(t.x, t.z), team: TEAM_A, area: t.area, floor: t.floor });
    // White: the same plan rotated 180° about the origin, which is what a
    // rotational pair means. NOT a mirror — a mirror would put the garage on
    // the wrong hand and break the project's one invariant.
    const rx = -t.x;
    const rz = -t.z;
    push({ id: `b-${t.id}`, x: rx, y, z: rz, yaw: yawTowardCentre(rx, rz), team: TEAM_B, area: t.area, floor: t.floor });
  }

  for (const s of STREET) {
    push({ id: s.id, x: s.x, y: 0, z: s.z, yaw: yawTowardCentre(s.x, s.z), team: null, area: s.area, floor: s.floor });
  }

  return Object.freeze(out);
}

export const SPAWN_POINTS: readonly SpawnPoint[] = buildPoints();

// A point outside the arena box is a table error, and a table error that only
// shows up as "the bot spawned in the skybox" costs an evening. Fail at load.
for (const p of SPAWN_POINTS) {
  if (!(p.x > BOUND_X_MIN && p.x < BOUND_X_MAX && Math.abs(p.z) < BOUND_Z)) {
    throw new Error(`spawns: '${p.id}' at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) is outside the arena bounds`);
  }
}
