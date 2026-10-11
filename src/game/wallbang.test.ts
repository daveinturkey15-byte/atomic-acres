/**
 * Nuketown 2025 — wallbang lane proof. Dependency-free: no test runner, no
 * node builtins (this file must stay clean under the repo's `tsc --noEmit`,
 * which has no @types/node). Run by bundling with the repo's own esbuild
 * and executing the bundle; any failed check throws, so a silent pass IS
 * the pass. See docs/HANDOFF-PARITY.md for the command.
 *
 * What "wallbang" means here: a LOS-blocked ray still lands when the firing
 * gun's `penetrationM` covers `wallThicknessM` from muzzle to hit, at halved
 * damage (the old through-wall rule). A 0 budget never wallbangs, and an
 * over-budget wall stays a silent miss — no new refusal, no new event.
 *
 * Roster note (Option A): the railgun and flamethrower are old-project
 * pickups with no catalog rows in this tree (their slots are reserved for
 * the viewmodel lane), so the deadeye stands in as the deepest-penetrating
 * gun and the railgun clause transfers to its rebase unchanged.
 */

import { GameHost } from './host';
import { createWorldQuery, wallThicknessM } from './world-query';
import { WEAPONS, type WeaponDef } from '../weapons/catalog';
import { resolveDamage } from './damage';
import type { AABB } from '../core/kit';
import type { DamageEvent, GameEvent, WorldQuery } from './events';

let passed = 0;
function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`wallbang proof failed: ${name}`);
  passed += 1;
}

function weapon(id: string): WeaponDef {
  for (const w of WEAPONS) {
    if (w.id === id) return w;
  }
  throw new Error(`wallbang proof failed: weapon ${id} is missing from the catalog`);
}

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): AABB {
  const raw = {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
  return raw as unknown as AABB;
}

/** One wall across the lane: x in [-4, 4], y in [0, 3], z in [-half, half]. */
function wall(half: number): AABB[] {
  return [box(-4, 0, -half, 4, 3, half)];
}

// ---------------------------------------------------------------------------
// 1. The budget table: every gun declares a penetration depth, deepest first.
// ---------------------------------------------------------------------------

check('deadeye defeats 0.4 m', weapon('deadeye').penetrationM === 0.4);
check('longhorn defeats 0.25 m', weapon('longhorn').penetrationM === 0.25);
check('varmint defeats 0.25 m', weapon('varmint').penetrationM === 0.25);
check('stampede defeats 0.2 m', weapon('stampede').penetrationM === 0.2);
check('rattler defeats 0.1 m', weapon('rattler').penetrationM === 0.1);
check('coachman never wallbangs', weapon('coachman').penetrationM === 0);
check('duster never wallbangs', weapon('duster').penetrationM === 0);
for (const w of WEAPONS) {
  check(`${w.id} budget is a finite non-negative depth`,
    Number.isFinite(w.penetrationM) && w.penetrationM >= 0);
}

// ---------------------------------------------------------------------------
// 2. The measure: metres of collider interior along the segment.
// ---------------------------------------------------------------------------

const exactWorld = createWorldQuery([box(2.5, -1, -1, 7.5, 1, 1)]);
const exact = wallThicknessM(exactWorld, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
check('five-metre chord measures bit-exact', exact === 5);
check('an exact budget passes the <= gate', exact !== null && exact <= 5);

const overlapWorld = createWorldQuery([box(2.5, -1, -1, 7.5, 1, 1), box(5, -1, -1, 9, 1, 1)]);
check('overlapping boxes merge to their union', wallThicknessM(overlapWorld,
  { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }) === 6.5);

const disjointWorld = createWorldQuery([box(1, -1, -1, 2, 1, 1), box(4, -1, -1, 6, 1, 1)]);
const disjoint = wallThicknessM(disjointWorld, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
check('disjoint boxes add end to end', disjoint !== null && Math.abs(disjoint - 3) < 1e-9);

const touchWorld = createWorldQuery([box(1, -1, -1, 2, 1, 1), box(2, -1, -1, 3, 1, 1)]);
const touching = wallThicknessM(touchWorld, { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
check('abutting boxes count once across the seam', touching !== null && Math.abs(touching - 2) < 1e-9);

check('open field measures 0', wallThicknessM(createWorldQuery([]),
  { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }) === 0);
check('a zero-length segment measures 0', wallThicknessM(exactWorld,
  { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }) === 0);
check('a segment starting inside exits once', wallThicknessM(exactWorld,
  { x: 3, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }) === 4.5);

// A bare three-method port carries no collider set: unmeasurable, not zero.
const stub: WorldQuery = { lineOfSight: () => true, groundY: () => 0, inBounds: () => true };
check('a port without colliders answers null', wallThicknessM(stub,
  { x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }) === null);
check('a non-finite endpoint answers null', wallThicknessM(exactWorld,
  { x: NaN, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }) === null);

// ---------------------------------------------------------------------------
// 3. The penalty: a wallbang halves, then floors like every landed hit.
// ---------------------------------------------------------------------------

const direct = resolveDamage({
  def: weapon('longhorn'), distance: 5, zone: 'body',
  attackerTeam: 0, victimTeam: 1, victimInvulnUntil: 0, now: 5000,
});
const halved = resolveDamage({
  def: weapon('longhorn'), distance: 5, zone: 'body',
  attackerTeam: 0, victimTeam: 1, victimInvulnUntil: 0, now: 5000, wallbang: true,
});
check('a clear shot does full damage', direct.blocked === undefined && direct.damage === 34);
check('a wallbang halves the scaled amount', halved.blocked === undefined && halved.damage === 17);

const weak = resolveDamage({
  def: weapon('coachman'), distance: 100, zone: 'body',
  attackerTeam: 0, victimTeam: 1, victimInvulnUntil: 0, now: 5000,
  attackerIsBot: true, wallbang: true,
});
check('a halved tickle still floors at 1', weak.blocked === undefined && weak.damage === 1);

const shielded = resolveDamage({
  def: weapon('deadeye'), distance: 5, zone: 'body',
  attackerTeam: 0, victimTeam: 1, victimInvulnUntil: 6000, now: 5000, wallbang: true,
});
check('a wallbang never pierces spawn protection', shielded.blocked === 'invulnerable');

// ---------------------------------------------------------------------------
// 4. Through the host: one duel per shot, muzzle at (0, 1.2, -5), victim at
//    (0, 0, 5), fired long after warmup and spawn protection (t = 5000).
// ---------------------------------------------------------------------------

function duel(colliders: readonly AABB[], seed: number): GameHost {
  const host = new GameHost({ world: createWorldQuery(colliders), now: 0, seed });
  host.addActor('s', 0);
  host.addActor('v', 1);
  host.tick(5000);
  host.updatePose('s', 0, 1.2, -5, 5000);
  host.updatePose('v', 0, 0, 5, 5000);
  return host;
}

function fire(host: GameHost, weaponId: string): GameEvent[] {
  const life = host.lifeOf('s');
  check(`shooter seats for ${weaponId}`, life !== null);
  const admission = host.submitShot('s', {
    type: 'shot', seq: 0, life: life ?? 0, weaponId, firedAt: 5000,
    ox: 0, oy: 1.2, oz: -5, dx: 0, dy: 0, dz: 1,
  }, 5000);
  check(`${weaponId} claim is admitted`, admission.accepted);
  return host.tick(5000);
}

function damageTo(events: readonly GameEvent[]): DamageEvent | null {
  for (const e of events) {
    if (e.type === 'damage' && e.victimId === 'v') return e;
  }
  return null;
}

function victimHp(host: GameHost): number {
  for (const a of host.snapshot().actors) {
    if (a.id === 'v') return a.hp;
  }
  throw new Error('wallbang proof failed: victim left the snapshot');
}

function refused(events: readonly GameEvent[]): boolean {
  for (const e of events) {
    if (e.type === 'shot-rejected') return true;
  }
  return false;
}

// A 0.3 m wall: thin enough for the sniper, cover against every rifle.
const thick = duel(wall(0.15), 7);
const thickRifle = fire(thick, 'longhorn');
check('rifles stop at the thick wall', damageTo(thickRifle) === null && victimHp(thick) === 100);

const thickSniper = duel(wall(0.15), 7);
const thickSniperEvents = fire(thickSniper, 'deadeye');
const thickSniperHit = damageTo(thickSniperEvents);
check('the deadeye defeats the thick wall at half damage',
  thickSniperHit !== null && thickSniperHit.amount === 75 && victimHp(thickSniper) === 25);

// A 0.1 m interior wall: rifles, the marksman and the LMG go through;
// the pump and the pistol never do, whatever the range.
const thinRifle = duel(wall(0.05), 7);
const thinRifleEvents = fire(thinRifle, 'longhorn');
const thinRifleHit = damageTo(thinRifleEvents);
check('rifles pierce the interior wall at half damage',
  thinRifleHit !== null && thinRifleHit.amount === 17 && victimHp(thinRifle) === 83);

const thinMarksman = duel(wall(0.05), 7);
const thinMarksmanHit = damageTo(fire(thinMarksman, 'varmint'));
check('the marksman pierces the interior wall', thinMarksmanHit !== null && thinMarksmanHit.amount === 22.5);

const thinLmg = duel(wall(0.05), 7);
const thinLmgHit = damageTo(fire(thinLmg, 'stampede'));
check('the LMG pierces the interior wall', thinLmgHit !== null && thinLmgHit.amount === 13.5);

const thinPump = duel(wall(0.05), 7);
const thinPumpEvents = fire(thinPump, 'coachman');
check('the shotgun never wallbangs', damageTo(thinPumpEvents) === null && victimHp(thinPump) === 100);

const thinPistol = duel(wall(0.05), 7);
const thinPistolEvents = fire(thinPistol, 'duster');
check('the pistol never wallbangs', damageTo(thinPistolEvents) === null && victimHp(thinPistol) === 100);

// The SMG's 0.1 m budget against a 0.08 m skin: inside by a margin no
// floating-point chord error can cross (chords err at ~1e-16 here).
const smgWall = duel(wall(0.04), 7);
const smgHit = damageTo(fire(smgWall, 'rattler'));
check('the SMG pierces its thin skin', smgHit !== null && smgHit.amount === 12.5);

// The exact-budget boundary, both sides: the chord math errs at ~1e-16, so
// 0.24 lands and 0.26 does not, and §2 pins true equality at the measure.
const underWall = duel(wall(0.12), 7);
const underHit = damageTo(fire(underWall, 'longhorn'));
check('under budget lands', underHit !== null && underHit.amount === 17);

const overWall = duel(wall(0.13), 7);
const overEvents = fire(overWall, 'longhorn');
check('over budget stays a miss', damageTo(overEvents) === null && victimHp(overWall) === 100);

// Open field: no wall, no penalty — the LOS-clear path is untouched.
const openField = duel([], 7);
const openHit = damageTo(fire(openField, 'longhorn'));
check('open-field hits do full damage', openHit !== null && openHit.amount === 34);
check('open-field damage equals a direct resolve',
  openHit !== null && openHit.amount === resolveDamage({
    def: weapon('longhorn'), distance: openHit.distance, zone: 'body',
    attackerTeam: 0, victimTeam: 1, victimInvulnUntil: 0, now: 5000,
  }).damage);

// Determinism: two seeds, one wall, one gun, one number.
const seedA = duel(wall(0.05), 7);
const seedB = duel(wall(0.05), 9999);
const hitA = damageTo(fire(seedA, 'longhorn'));
const hitB = damageTo(fire(seedB, 'longhorn'));
check('wallbangs are seed-deterministic',
  hitA !== null && hitB !== null && hitA.amount === hitB.amount && victimHp(seedA) === victimHp(seedB));

// Over budget and blocked: admitted like any geometry hit-test miss — the
// claim passes, nothing lands, nothing is refused, health never moves.
check('an over-budget wall refuses nothing', !refused(thickRifle) && !refused(overEvents));

console.log(`wallbang proof: ${passed} checks passed`);
