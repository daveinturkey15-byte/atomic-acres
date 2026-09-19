/**
 * Shared staging math for the live motion proof (`verify-motion-live.mjs`)
 * and its CPU falsifier (`_verify-motion-stage.mjs`). PURE: no DOM, no
 * THREE, no game imports, so the geometry contract can be asserted in node
 * alone before any browser is spent.
 *
 * AXIS CONTRACT - the source is authoritative, and revision 2's photo-inferred
 * "-z" was exactly the motion-root-2124 bug:
 *   - `src/characters/skeleton.ts`: "Forward is +z."
 *   - `src/characters/mesh.ts`: "a receiver laid along +z points where the
 *     figure faces."
 *   - `src/characters/blend.ts`: "the weapon must follow actor-forward (+Z)
 *     in the root frame."
 * An actor at yaw 0 faces +Z. Camera yaw follows the `stations.ts`
 * convention (forward = (-sin yaw, 0, -cos yaw)), so a lens parked at offset
 * (dx, dz) from the subject aims back at it with yaw = atan2(dx, dz). Every
 * "front-ish" lens offset therefore carries dz > 0.
 */

/** Eye height of the staged lens above the teleported feet (core/layout.ts). */
export const LENS_HEIGHT = 1.68;
/** Lens stand-off. 3.6 read the operator far too small in the 1935 frames. */
export const D = 2.4;
/** Feet offset of the low lens (teleport y; the lens stays at +1.68). */
export const LOW_Y = -1.3;
/** Design height of the chest bone for sight-line math (adult 1.78 m figure). */
export const CHEST_Y = 1.15;

/**
 * The four lenses, all in the subject's FRONT (+Z) hemisphere or truly
 * lateral. `facing` is the strict expectation for the stand scenario;
 * crouch/prone/moving keep the softer reject-'back' gate in the harness.
 */
export const VIEWS = [
  { name: 'front', dx: 0, dz: D, yaw: 0, pitch: -0.06, y: 0, facing: 'front' },
  { name: 'side', dx: D, dz: 0, yaw: Math.PI / 2, pitch: -0.06, y: 0, facing: 'side' },
  { name: 'threequarter', dx: D * 0.72, dz: D * 0.72, yaw: Math.PI * 0.25, pitch: -0.08, y: 0, facing: 'front' },
  // y is the PLAYER's feet; the lens sits at y + 1.68, so LOW_Y => 0.38 m.
  { name: 'low', dx: D * 0.42, dz: D * 0.52, yaw: Math.atan2(0.42, 0.52), pitch: 0.2, y: LOW_Y, facing: 'front' },
];

export const BEATS = [
  { name: 'windup', scrub: 'windup', phase: 'hold', elapsed: 0.18 },
  { name: 'release', scrub: 'release', phase: 'release', elapsed: 0.45 },
  { name: 'recovery', scrub: 'recovery', phase: 'recovery', elapsed: 0.7 },
];

export const SCENARIOS = [
  { name: 'stand', speed: 0, crouch: false, prone: false, views: ['front', 'side', 'threequarter', 'low'] },
  { name: 'crouch', speed: 0.8, crouch: true, prone: false, views: ['threequarter'] },
  { name: 'prone', speed: 0.5, crouch: false, prone: true, views: ['threequarter'] },
  // Treadmill: pinned on the mark so the overlay stays framed while the blend
  // tree keeps the run gait ticking underneath.
  { name: 'moving', speed: 3.4, crouch: false, prone: false, views: ['threequarter'] },
];

/** `--views bounded` = the 9-frame staging proof; default is the full 21. */
export function pickPlan(mode) {
  if (mode === 'bounded') {
    return [{ name: 'stand', speed: 0, crouch: false, prone: false, views: ['front', 'side', 'threequarter'] }];
  }
  if (mode === 'full') return SCENARIOS;
  throw new Error(`motion-stage: unknown plan mode "${mode}" (expected bounded|full)`);
}

/** stations.ts convention: a lens at offset (dx, dz) aims back with this yaw. */
export function lensYaw(v) {
  return Math.atan2(v.dx, v.dz);
}

/**
 * Design-side chestDotCam for an actor at yaw 0. `visibility()` computes
 * chestFwd . (-camToChest) with chestFwd = +Z of the chest world frame, which
 * at yaw 0 reduces to -(normalised chest - eye).z. This is what the rig gate
 * SHOULD read when the staging is right; revision 2 fed it dz < 0 and read
 * "back" in 18 checks.
 */
export function designChestDot(view, stage = { x: 0, z: 0 }) {
  const ex = stage.x + view.dx;
  const ey = view.y + LENS_HEIGHT;
  const ez = stage.z + view.dz;
  const len = Math.hypot(stage.x - ex, CHEST_Y - ey, stage.z - ez) || 1;
  return -(stage.z - ez) / len;
}

export function designFacingLabel(dot) {
  return dot > 0.35 ? 'front' : dot < -0.35 ? 'back' : 'side';
}

/** The harness' facing gate for one (scenario, view) pair; null = reject-back. */
export function expectedFacingLabel(scenario, view) {
  if (view.facing === 'side') return 'side';
  return scenario === 'stand' ? view.facing : null;
}

/**
 * NAMED candidate stages, tried in order. None is assumed clear: the harness
 * probes every one of these points through `__NT.collidersAt` in the live
 * page and takes the first anchor with zero hits. Vehicles DO park on the
 * turning bulb (vehicles.ts parks the coach across its -z half and the second
 * bus across its +z half), so "the circle is open by construction" is not a
 * fact - it is a measurement.
 */
export const STAGE_ANCHORS = [
  { name: 'turning-circle centre (midStreet station ground)', x: 0, z: 0 },
  { name: 'west road stem (plaza approach)', x: -11.5, z: 0 },
  { name: 'orange-side pavement (streetElevation station ground)', x: -8, z: -8.5 },
];

/**
 * Whole-subject probe set for one stage: the figure's footprint ring, every
 * lens' feet column, and a sampled lens->chest sight-line per view (eye path
 * plus knee/waist/head clearance bands). The harness requires ALL of these to
 * read zero colliders before it stages anything.
 */
export function stagePoints(stage, views = VIEWS) {
  const pts = [];
  const push = (x, y, z, tag) => pts.push({ x, y, z, tag });
  for (let a = 0; a < 8; a++) {
    const px = stage.x + Math.cos((a * Math.PI) / 4) * 0.45;
    const pz = stage.z + Math.sin((a * Math.PI) / 4) * 0.45;
    for (const y of [0.3, 0.9, 1.5]) push(px, y, pz, 'stage-footprint');
  }
  for (const y of [0.3, 0.9, 1.5]) push(stage.x, y, stage.z, 'stage-footprint');
  for (const v of views) {
    const ex = stage.x + v.dx;
    const ez = stage.z + v.dz;
    const ey = v.y + LENS_HEIGHT;
    for (const y of [0.3, 0.9, 1.5]) push(ex, y, ez, `lens:${v.name}`);
    for (const t of [0.15, 0.35, 0.55, 0.75, 0.9]) {
      const px = ex + (stage.x - ex) * t;
      const pz = ez + (stage.z - ez) * t;
      push(px, ey + (CHEST_Y - ey) * t, pz, `los:${v.name}`);
      for (const y of [0.25, 0.65, 1.4]) push(px, y, pz, `los:${v.name}`);
    }
  }
  return pts;
}
