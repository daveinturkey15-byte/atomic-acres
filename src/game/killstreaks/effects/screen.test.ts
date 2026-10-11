/**
 * Nuketown 2025 — Fallout Screen proof. Dependency-free: no test runner, no
 * node builtins (this file must stay clean under the repo's `tsc --noEmit`,
 * which has no @types/node). Run by bundling with the repo's own esbuild
 * and executing the bundle; any failed check throws, so a silent pass IS
 * the pass. Same shape as `mortar.test.ts` / `dart.test.ts`.
 */

import { STREAK_CATALOG, streakById } from '../catalog';
import { StreakRuntime } from '../runtime';
import type { WorldQuery } from '../../events';
import { SMOKE_RADIUS_M } from '../../ordnance';
import { SightField, type SmokeVolume } from '../../world-query';
import {
  SCREEN_RING_M,
  SCREEN_VOLUME_COUNT,
  createScreen,
  publishScreenVolumes,
  screenVolumeEvents,
  screenVolumeId,
  stepScreen,
} from './screen';
let passed = 0;
function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`screen proof failed: ${name}`);
  passed += 1;
}

const WORLD: WorldQuery = Object.freeze({
  lineOfSight: () => true,
  groundY: () => 0,
  inBounds: (x: number, z: number) => Math.abs(x) <= 40 && Math.abs(z) <= 40,
});

function sightWorld(): WorldQuery & { sight: SightField } {
  return Object.freeze({
    lineOfSight: () => true,
    groundY: () => 0,
    inBounds: (x: number, z: number) => Math.abs(x) <= 40 && Math.abs(z) <= 40,
    sight: new SightField(),
  });
}

function volumesOf(w: WorldQuery): readonly SmokeVolume[] {
  const s = (w as Partial<{ sight: SightField }>).sight;
  return s instanceof SightField ? s.activeSmokeVolumes() : [];
}

// 1. Seven volumes: centre plus a 4 m hex ring, all negative ids.
const s0 = createScreen(1, 'owner', 0, 'fallout-screen', 20_000, { x: 10, y: 0, z: 10 }, 100_000);
check('seven volumes', s0.volumes.length === SCREEN_VOLUME_COUNT);
check('ids unique and negative', new Set(s0.volumes.map((v) => v.id)).size === 7 && s0.volumes.every((v) => v.id < 0));
check('centre first', s0.volumes[0].x === 10 && s0.volumes[0].z === 10);
for (let i = 1; i < 7; i += 1) {
  const dx = s0.volumes[i].x - 10;
  const dz = s0.volumes[i].z - 10;
  check(`ring volume ${i} at 4 m`, Math.abs(Math.hypot(dx, dz) - SCREEN_RING_M) < 1e-9);
}
check('chest height', s0.volumes.every((v) => Math.abs(v.y - 1.2) < 1e-9));
check('dies with the instance', s0.diesAt === 120_000 && s0.remainingMs === 20_000);
check('id allocator disjoint from ordnance positives', screenVolumeId(1, 1) === -17 && screenVolumeId(2, 7) === -39);

// 2. Bus announcements: real grenade-kind smoke at the contract radius.
const evs = screenVolumeEvents(s0, 100_000);
check('seven volume events', evs.length === 7);
check('grenade kind at smoke radius', evs.every((e) => e.kind === 'grenade' && e.radius === SMOKE_RADIUS_M));
check('born/die with the screen', evs.every((e) => e.bornAt === 100_000 && e.diesAt === 120_000));

// 3. Publish + withdraw against a real sight field.
const w3 = sightWorld();
publishScreenVolumes(s0, w3, 100_000);
check('sight holds seven', volumesOf(w3).length === 7);
const mid = stepScreen(s0, 5_000, { now: 105_000, world: w3 });
check('mid-life step silent', mid.events.length === 0 && mid.state.remainingMs === 15_000);
check('volumes persist mid-life', volumesOf(w3).length === 7);
const fin = stepScreen(mid.state, 15_000, { now: 120_000, world: w3 });
check('final step ends all seven', fin.events.length === 7 && fin.events.every((e) => e.type === 'smoke-volume-end'));
check('sight withdrawn on expiry', volumesOf(w3).length === 0);
check('remainingMs zero is the retire signal', fin.state.remainingMs === 0);

// 4. Catalog still declares the row the runtime just wired.
check('catalog declares fallout-screen high/7', (() => {
  const def = streakById('fallout-screen', STREAK_CATALOG);
  return def !== null && def.cost === 7 && def.tier === 'high' && def.activation === 'target-point';
})());

// 5. End to end through the runtime: earn, place, wall stands, expiry ends.
const rt = new StreakRuntime({ seed: 7, matchEpoch: 1 });
rt.registerActor('owner', 0, ['recon-sweep', 'tracker-dart', 'sentry-post', 'fallout-screen']);
for (let k = 1; k <= 8; k += 1) rt.recordElimination('owner', k, k * 1_000);
check('screen earned on the ladder', rt.chargesOf('owner', 'fallout-screen') >= 1);
const w5 = sightWorld();
const press = {
  actorId: 'owner', slot: 4, seq: 0, claimId: 'parity-screen-1', life: 0, matchEpoch: 1,
  toggle: false, origin: { x: 0, y: 0, z: 0 }, aimYaw: 0, anchor: { x: 5, y: 0, z: 5 },
  context: {
    alive: true, matchPhase: 'active' as const, inputEnabled: true,
    menuOpen: false, targetingOpen: false, arenaSupported: true, possessionActive: false,
  },
};
const fired = rt.activate(press, 9_000, w5);
check('screen activation accepted', fired.accepted === true);
if (fired.accepted === true) {
  const kinds = fired.events.map((e) => e.type);
  check('activation plus seven volumes on the bus',
    kinds.length === 8 && kinds[0] === 'streak-activated' && kinds.slice(1).every((k) => k === 'smoke-volume'));
  check('host sight holds the wall', volumesOf(w5).length === 7);
}
let t = 9_000;
let ends = 0;
let retired = false;
for (let i = 0; i < 100; i += 1) {
  t += 250;
  for (const e of rt.advance(t, w5, [])) {
    if (e.type === 'smoke-volume-end') ends += 1;
    if (e.type === 'streak-ended') retired = true;
  }
  if (retired) break;
}
check('all seven volumes end on expiry', ends === 7);
check('host sight empty after expiry', volumesOf(w5).length === 0);
check('screen instance retires', retired);

// 6. A blocked marker refuses BEFORE the charge moves: same claim retries.
const rt2 = new StreakRuntime({ seed: 7, matchEpoch: 1 });
rt2.registerActor('owner', 0, ['recon-sweep', 'tracker-dart', 'sentry-post', 'fallout-screen']);
for (let k = 1; k <= 8; k += 1) rt2.recordElimination('owner', k, k * 1_000);
const before = rt2.chargesOf('owner', 'fallout-screen');
const badPress = { ...press, claimId: 'parity-screen-2', anchor: { x: 500, y: 0, z: 500 } };
const refused = rt2.activate(badPress, 9_000, WORLD);
check('out-of-bounds marker refused as no-placement',
  !refused.accepted && refused.reason === 'no-placement');
check('refused placement keeps the charge', rt2.chargesOf('owner', 'fallout-screen') === before);
check('refused placement lit no smoke', volumesOf(WORLD).length === 0);

console.log(`screen proof: ${passed} checks passed`);
