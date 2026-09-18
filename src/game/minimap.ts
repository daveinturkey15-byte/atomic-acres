/**
 * Nuketown 2025 — the ONE map projection.
 *
 * Pure: no canvas, no context, no colour, no DOM. It answers "where on the map
 * frame is this world point", "where in the world is this map pixel", "how is
 * the frame oriented for a player-up minimap", and "may this enemy be drawn".
 * `ui/hud-map.ts` is the only renderer; it reads this and paints.
 *
 * IT REPLACES TWO PROJECTIONS (IMPORT-PLAN §5.12). `ui/hud.ts:drawMap()` and
 * `ui/menus.ts:drawNuketownThumb()` were two independent top-down projections
 * of the same `core/layout.ts` constants, with two colour sets and no shared
 * code, in a project that was one day old. Both now call this. If a third
 * appears, this file failed.
 *
 * TWO THINGS THE OLD PROJECT GOT WRONG TWICE, and how they are fixed here:
 *
 *  1. **The reflection belongs to the layer, not to the markers.** A player-up
 *     minimap is rotation *plus*, on some projections, a horizontal reflection.
 *     Their fix was `playerUpScaleX() === -1` applied to the composited layer,
 *     with markers positioned through the same scalar chain but drawn upright —
 *     so a label is never mirrored. Here the reflection is not authored at all:
 *     `MAP_HANDEDNESS` is MEASURED from this file's own projection (below), so
 *     if the projection ever flips its z axis the transform follows it and no
 *     second place needs editing. On today's projection it measures +1 and no
 *     reflection is applied; fed their axis convention the same code measures
 *     −1 and reproduces their published constant.
 *  2. **Rotation is continuous.** `playerUpRotation` is a closed-form angle of
 *     the camera-forward direction. Nothing is rounded, quantised or snapped to
 *     a compass point, so a sub-degree camera movement moves the map.
 */

import {
  BACK_FENCE,
  BOUND_X_MAX,
  BOUND_X_MIN,
  BOUND_Z,
  GARAGE_DEPTH,
  GARAGE_LEN,
  HEAD_CENTER_X,
  HEAD_RADIUS,
  HOUSES,
  HOUSE_HALF_LEN,
  ROAD_HALF_WIDTH,
  ROAD_X_MAX,
  ROAD_X_MIN,
  YARD_X_MAX,
  YARD_X_MIN,
} from '../core/layout';

// ---------------------------------------------------------------------------
// The frame
// ---------------------------------------------------------------------------

/** World rectangle the map frame shows. Derived; never re-typed elsewhere. */
export const MAP_BOUNDS = Object.freeze({
  minX: BOUND_X_MIN,
  maxX: BOUND_X_MAX,
  minZ: -BOUND_Z,
  maxZ: BOUND_Z,
});

/** Metres across and down. Nuketown is TALL: ~44.5 m wide by ~84 m deep. */
export const MAP_WORLD_W = MAP_BOUNDS.maxX - MAP_BOUNDS.minX;
export const MAP_WORLD_D = MAP_BOUNDS.maxZ - MAP_BOUNDS.minZ;

/** Inset, in px, between the frame edge and the arena rectangle. */
export const MAP_PAD = 6;

/** A map frame in pixels. `pad` keeps the arena off the border stroke. */
export interface MapView {
  readonly width: number;
  readonly height: number;
  readonly pad: number;
  /**
   * Multiplies the fitted scale. 1 letterboxes the whole arena into the frame
   * (what a thumbnail wants); above 1 the arena overflows and the frame shows a
   * window around the player (what a live minimap wants). It is a property of
   * the VIEW rather than a parameter of the transform so that `worldToMap`,
   * `mapToWorld` and the player-up chain cannot disagree about it.
   */
  readonly zoom?: number;
}

/** A frame plus the player it is centred on — what `playerUpTransform` needs. */
export interface PlayerView extends MapView {
  readonly playerX: number;
  readonly playerZ: number;
}

export function mapView(width: number, height: number, pad: number = MAP_PAD, zoom = 1): MapView {
  return { width, height, pad, zoom };
}

/**
 * Metres → pixels. UNIFORM on both axes, on purpose: a per-axis fit would make
 * the thumbnail a different shape from the live minimap and neither would match
 * the arena. The frame letterboxes instead.
 */
export function mapScale(view: MapView): number {
  const w = Math.max(1, view.width - view.pad * 2);
  const h = Math.max(1, view.height - view.pad * 2);
  return Math.min(w / MAP_WORLD_W, h / MAP_WORLD_D) * (view.zoom ?? 1);
}

function originX(view: MapView, s: number): number {
  return view.pad + (view.width - view.pad * 2 - MAP_WORLD_W * s) / 2;
}

function originY(view: MapView, s: number): number {
  return view.pad + (view.height - view.pad * 2 - MAP_WORLD_D * s) / 2;
}

/**
 * World (x, z) → frame pixels, north up. +x is right, −z is up: the same plan
 * convention `core/layout.ts` declares, so a reader of that file can predict
 * this one.
 */
export function worldToMap(x: number, z: number, view: MapView): [number, number] {
  const s = mapScale(view);
  return [originX(view, s) + (x - MAP_BOUNDS.minX) * s, originY(view, s) + (z - MAP_BOUNDS.minZ) * s];
}

/**
 * Frame pixels → world, clamped into the arena rectangle. Round-trips
 * `worldToMap` exactly for any in-bounds point; a click outside the arena
 * returns the nearest in-bounds position rather than a coordinate off the map.
 */
export function mapToWorld(px: number, py: number, view: MapView): { x: number; z: number } {
  const s = mapScale(view);
  const x = MAP_BOUNDS.minX + (px - originX(view, s)) / s;
  const z = MAP_BOUNDS.minZ + (py - originY(view, s)) / s;
  return {
    x: Math.min(MAP_BOUNDS.maxX, Math.max(MAP_BOUNDS.minX, x)),
    z: Math.min(MAP_BOUNDS.maxZ, Math.max(MAP_BOUNDS.minZ, z)),
  };
}

/** A world DIRECTION in frame-pixel axes. Translation-free, scale-free. */
function worldDirToMap(wx: number, wz: number): [number, number] {
  const v = mapView(1000, 1000, 0);
  const [ax, ay] = worldToMap(0, 0, v);
  const [bx, by] = worldToMap(wx, wz, v);
  return [bx - ax, by - ay];
}

// ---------------------------------------------------------------------------
// Player-up orientation
// ---------------------------------------------------------------------------

/**
 * +1 when this projection preserves the camera's left/right handedness and −1
 * when it reverses it. MEASURED from `worldToMap` by the sign of the cross
 * product of the +x and +z pixel directions — never authored, so the two can
 * never disagree (IMPORT-PLAN §5.5).
 *
 * Today it measures +1: `worldToMap` puts +x right and +z DOWN, which is the
 * same handedness screen space uses, so a player-up map needs rotation alone.
 * The old project's projection put +z UP and therefore measured −1, which is
 * exactly the `playerUpScaleX() === -1` it had to publish as a constant. The
 * value moved into the derivation; the RULE it serves did not change: the
 * reflection is applied to the composited layer, and markers get their
 * positions from `viewPoint` and are then drawn upright.
 */
export const MAP_HANDEDNESS: 1 | -1 = (() => {
  const [ex, ey] = worldDirToMap(1, 0);
  const [fx, fy] = worldDirToMap(0, 1);
  return ex * fy - ey * fx > 0 ? 1 : -1;
})();

/** Camera forward in world xz. Matches `core/layout.ts`: yaw 0 faces −z. */
function forwardXZ(yaw: number): [number, number] {
  return [-Math.sin(yaw), -Math.cos(yaw)];
}

const TAU = Math.PI * 2;

/**
 * Canvas rotation, in radians, that puts camera-forward at the top of the
 * frame once `MAP_HANDEDNESS` has been applied.
 *
 * Closed form, not a table: rotate the (already reflected) forward direction
 * onto screen-up, which is angle −π/2 in a y-down frame. Normalised into
 * [0, 2π) only so the number is readable; the value is continuous in yaw and
 * nothing here rounds.
 */
export function playerUpRotation(yaw: number): number {
  const [fx, fy] = worldDirToMap(...forwardXZ(yaw));
  const phi = Math.atan2(fy, fx * MAP_HANDEDNESS);
  return ((-Math.PI / 2 - phi) % TAU + TAU) % TAU;
}

/** The affine the renderer applies to the STATIC LAYER, as plain numbers. */
export interface PlayerUpTransform {
  /** Radians for `ctx.rotate`. */
  readonly rotation: number;
  /** ±1 for `ctx.scale(scaleX, 1)`. See `MAP_HANDEDNESS`. */
  readonly scaleX: 1 | -1;
  /** Frame centre the player sits at. */
  readonly centerX: number;
  readonly centerY: number;
  /** The player's own position in north-up frame pixels. */
  readonly playerPx: number;
  readonly playerPy: number;
}

/**
 * The chain the 2D context is given, stated once:
 *
 *   translate(centerX, centerY)
 *   rotate(rotation)
 *   scale(scaleX, 1)
 *   translate(-playerPx, -playerPy)
 *
 * `viewPoint` is the same chain in scalar form. Markers use THAT and are drawn
 * in unrotated screen space, which is how a label stays upright and unmirrored.
 */
export function playerUpTransform(yaw: number, view: PlayerView): PlayerUpTransform {
  const [px, py] = worldToMap(view.playerX, view.playerZ, view);
  return {
    rotation: playerUpRotation(yaw),
    scaleX: MAP_HANDEDNESS,
    centerX: view.width / 2,
    centerY: view.height / 2,
    playerPx: px,
    playerPy: py,
  };
}

/** A north-up frame point through the player-up chain, as screen pixels. */
export function viewPoint(t: PlayerUpTransform, px: number, py: number): [number, number] {
  const dx = (px - t.playerPx) * t.scaleX;
  const dy = py - t.playerPy;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  return [t.centerX + dx * cos - dy * sin, t.centerY + dx * sin + dy * cos];
}

/** A world point straight through the player-up chain. */
export function worldToView(t: PlayerUpTransform, view: MapView, x: number, z: number): [number, number] {
  const [px, py] = worldToMap(x, z, view);
  return viewPoint(t, px, py);
}

/**
 * Where the N pip sits on the rim. North is −z; it travels the rim as the
 * player turns and reads straight up when the player faces north.
 */
export function northMarker(yaw: number, width: number, height: number, inset = 10): [number, number] {
  const radius = Math.max(0, Math.min(width, height) / 2 - Math.max(0, inset));
  const [nx, ny] = worldDirToMap(0, -1);
  const len = Math.hypot(nx, ny) || 1;
  const sx = (nx / len) * MAP_HANDEDNESS;
  const sy = ny / len;
  const rot = playerUpRotation(yaw);
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  return [width / 2 + (sx * cos - sy * sin) * radius, height / 2 + (sx * sin + sy * cos) * radius];
}

// ---------------------------------------------------------------------------
// Enemy reveal — this IS the BO2 minimap feel
// ---------------------------------------------------------------------------

/**
 * Close enemies and recent gunfire show; distant quiet ones do not.
 *
 * Ported unchanged from the old `minimap.ts:254`, whose test pinned exactly
 * that sentence. The two numbers are its numbers: a 15 m proximity ring and a
 * 3 s memory of the last shot. They are the difference between "the minimap is
 * a wallhack" and "the minimap rewards listening".
 */
export const REVEAL_RADIUS_M = 15;
export const REVEAL_GUNFIRE_MS = 3_000;

export function shouldRevealEnemy(distance: number, now: number, lastShotAt: number): boolean {
  if (!Number.isFinite(distance)) return false;
  if (distance <= REVEAL_RADIUS_M) return true;
  return lastShotAt > 0 && Number.isFinite(lastShotAt) && now - lastShotAt <= REVEAL_GUNFIRE_MS;
}

// ---------------------------------------------------------------------------
// Blips
// ---------------------------------------------------------------------------

export const BLIP_KINDS = ['self', 'ally', 'enemy'] as const;
export type BlipKind = (typeof BLIP_KINDS)[number];

/** One thing to draw on the map. Produced by `game/client.ts`, never by the HUD. */
export interface MapBlip {
  readonly id: string;
  readonly kind: BlipKind;
  readonly x: number;
  readonly z: number;
  /** Facing, for the arrow; omitted for a gunfire ping with no known heading. */
  readonly yaw?: number;
}

// ---------------------------------------------------------------------------
// Footprints — DERIVED from core/layout.ts, never authored
// ---------------------------------------------------------------------------

export type FootprintKind = 'bounds' | 'yard' | 'road' | 'circle' | 'house' | 'garage' | 'fence';

export interface MapRect {
  readonly shape: 'rect';
  readonly kind: FootprintKind;
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  /** −1 ORANGE, +1 WHITE; absent for anything not owned by a house. */
  readonly side?: -1 | 1;
}

export interface MapDisc {
  readonly shape: 'disc';
  readonly kind: FootprintKind;
  readonly cx: number;
  readonly cz: number;
  readonly r: number;
}

export interface MapSeg {
  readonly shape: 'seg';
  readonly kind: FootprintKind;
  readonly x1: number;
  readonly z1: number;
  readonly x2: number;
  readonly z2: number;
}

export type MapFootprint = MapRect | MapDisc | MapSeg;

function rect(kind: FootprintKind, x0: number, x1: number, z0: number, z1: number, side?: -1 | 1): MapRect {
  return {
    shape: 'rect',
    kind,
    minX: Math.min(x0, x1),
    maxX: Math.max(x0, x1),
    minZ: Math.min(z0, z1),
    maxZ: Math.max(z0, z1),
    ...(side === undefined ? {} : { side }),
  };
}

/**
 * Everything the map draws, in paint order, projected by nobody.
 *
 * The old project needed 185 lines of name-pattern classification here because
 * its arena was a name-soup and the minimap kept drawing the furniture. Ours
 * does not have that problem: `core/layout.ts` holds the footprints already, so
 * this is a projection of it and a new dimension lands on the map for free.
 * Their default-hidden rule still stands if we ever auto-derive from the scene.
 *
 * Not here and deliberately: the coach and the third structure. `layout.ts`
 * gives the third structure one x and no footprint, and it is out of bounds
 * scenery; a vehicle class needs a vehicle dimension to derive from first.
 */
export const MAP_FOOTPRINTS: readonly MapFootprint[] = Object.freeze([
  rect('bounds', MAP_BOUNDS.minX, MAP_BOUNDS.maxX, MAP_BOUNDS.minZ, MAP_BOUNDS.maxZ),
  rect('yard', YARD_X_MIN, YARD_X_MAX, -BACK_FENCE, BACK_FENCE),
  rect('road', ROAD_X_MIN, ROAD_X_MAX, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH),
  { shape: 'disc', kind: 'circle', cx: HEAD_CENTER_X, cz: 0, r: HEAD_RADIUS } as MapDisc,
  ...HOUSES.map((h) => rect('house', -HOUSE_HALF_LEN, HOUSE_HALF_LEN, h.frontZ, h.backZ, h.side)),
  ...HOUSES.map((h) =>
    rect(
      'garage',
      h.garageX - GARAGE_LEN / 2,
      h.garageX + GARAGE_LEN / 2,
      h.frontZ,
      h.frontZ + h.side * GARAGE_DEPTH,
      h.side,
    ),
  ),
  { shape: 'seg', kind: 'fence', x1: YARD_X_MIN, z1: -BACK_FENCE, x2: YARD_X_MAX, z2: -BACK_FENCE } as MapSeg,
  { shape: 'seg', kind: 'fence', x1: YARD_X_MIN, z1: BACK_FENCE, x2: YARD_X_MAX, z2: BACK_FENCE } as MapSeg,
]);
