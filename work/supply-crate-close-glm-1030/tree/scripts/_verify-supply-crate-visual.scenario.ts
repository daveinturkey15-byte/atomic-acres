/**
 * _verify-supply-crate-visual scenario — CPU lifecycle + negative controls for
 * the supply crate presentation module, on a synthetic clock. No GPU, no
 * canvas (stencil falls back to painted geometry), no timers beyond asserts.
 *
 * Asserted contract (all against the PUBLIC surface of supply-crate-visual):
 *   creation      landed event draws one group of 3 meshes at (x,y,z)
 *   idempotence   repeated `crate-landed` for the same instanceId is absorbed
 *   negatives     unknown types, malformed events and NaN coordinates are ignored
 *   open          `crate-opened` animates the lid on presentation-local ticks
 *                 and the instance self-disposes after OPEN+LINGER
 *   ended         `streak-ended` disposes an un-opened crate exactly once;
 *                 an opened crate absorbs it (owns its own exit)
 *   max active    admission past SUPPLY_CRATE_MAX_ACTIVE evicts the oldest
 *   epoch         clear() empties everything, pooled geometry is reused by
 *                 the next admission (respawn/reset generation)
 *   terminal      after dispose() the module is inert: apply() cannot
 *                 resurrect the pool, update()/clear() no-op
 */
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createSupplyCrateVisual,
  SUPPLY_CRATE_MAX_ACTIVE,
} from '../src/weapons/supply-crate-visual';

// --- fixture vocabulary: plain structural objects, unconstrained types (the
// visual narrows read-only unknowns), values model the real lane events.
let t = 0;
function landed(instanceId: number, x = 3, y = 0, z = -7) {
  return { type: 'crate-landed', at: t++, instanceId, actorId: 'a1', team: 't1', streakId: 'supply-crate', x, y, z, radius: 2.75, expiresAt: 30_000 };
}
function openedEv(instanceId: number) {
  return { type: 'crate-opened', at: t++, instanceId, actorId: 'a1', team: 't1', streakId: 'supply-crate', collectorId: 'a1', collectorTeam: 't1', reward: 'mortar', rollUnit: 3, contested: false };
}
function endedEv(instanceId: number) {
  return { type: 'streak-ended', at: t++, actorId: 'a1', streakId: 'supply-crate', instanceId, reason: 'expired' };
}

const scene = new THREE.Scene();
const visual = createSupplyCrateVisual({ scene });

// --- creation -------------------------------------------------------------
visual.apply([landed(1, 2, 0, 4)]);
assert.equal(visual.liveCount, 1);
assert.equal(scene.children.length, 1);
const grp = scene.children[0] as THREE.Group;
assert.deepEqual([grp.position.x, grp.position.y, grp.position.z], [2, 0, 4]);
assert.equal(grp.children.length, 3, 'body+lid+stencil = 3 draw calls per crate');
assert.equal((grp.children[0] as THREE.Mesh).name, 'crate-body');
const bodyGeo = (grp.children[0] as THREE.Mesh).geometry;

// --- idempotence + negatives ----------------------------------------------
visual.apply([landed(1, 9, 9, 9)]); // same id: absorbed, original untouched
assert.equal(visual.liveCount, 1);
assert.deepEqual([grp.position.x, grp.position.z], [2, 4]);

visual.apply([landed(2, Number.NaN, 0, 0)]); // NaN anchor: rejected
assert.equal(visual.liveCount, 1);

visual.apply([
  { type: 'crate-landed' },                // missing instanceId
  { type: 'crate-landed', instanceId: 'x' }, // non-numeric id
  null,
  42,
  { type: 'bolt-launched', boltId: 1 },    // real event from another slice
]);
assert.equal(visual.liveCount, 1, 'malformed/foreign events ignored');

// --- max active + oldest eviction ------------------------------------------
for (let id = 11; id <= 11 + SUPPLY_CRATE_MAX_ACTIVE; id++) {
  visual.apply([landed(id, id, 0, 0)]);
}
assert.equal(visual.liveCount, SUPPLY_CRATE_MAX_ACTIVE);
assert.equal(scene.children.length, SUPPLY_CRATE_MAX_ACTIVE);
assert.ok(!scene.children.some((g) => (g as THREE.Group).position.x === 11), 'oldest (id 11) evicted');
assert.ok(scene.children.some((g) => (g as THREE.Group).position.x === 11 + SUPPLY_CRATE_MAX_ACTIVE), 'newest admitted');
for (const g of scene.children) assert.equal((g as THREE.Group).children.length, 3, 'draw budget holds at cap');

// --- open: local-clock animation, self-dispose ------------------------------
// Target the NEWEST crate (still live); the oldest ones got evicted above.
const openId = 11 + SUPPLY_CRATE_MAX_ACTIVE;
const openGrp = scene.children.find((g) => (g as THREE.Group).position.x === openId) as THREE.Group;
const lid = openGrp.children.find((c) => c.name === 'crate-lid') as THREE.Mesh;
visual.apply([openedEv(openId)]);
visual.update(1000); // first tick after open: t0 is pinned HERE, lid still at rest pose
assert.equal(lid.rotation.x, 0, 'first tick only pins the local clock, no motion');
visual.update(1225); // t = 0.5 -> ease 0.75
assert.ok(lid.rotation.x < 0 && lid.rotation.x > -1.16, 'lid tilts open');
assert.ok(lid.position.y > 0, 'lid lifts above its merged rest pose');
visual.update(1000 + 450 + 900 + 1); // past OPEN+LINGER: instance exits itself
assert.equal(visual.liveCount, SUPPLY_CRATE_MAX_ACTIVE - 1);

// --- ended: unopened disposes once; opened absorbs --------------------------
visual.apply([landed(30)]);
visual.apply([endedEv(30)]);
assert.equal(visual.liveCount, SUPPLY_CRATE_MAX_ACTIVE - 1, 'unopened crate removed on streak-ended');
visual.apply([endedEv(30)]); // repeated end notice: no crash, no change
assert.equal(visual.liveCount, SUPPLY_CRATE_MAX_ACTIVE - 1);

visual.apply([landed(31)]);
visual.apply([openedEv(31)]);
visual.apply([endedEv(31)]); // opened crate owns its exit; notice absorbed
assert.equal(visual.liveCount, SUPPLY_CRATE_MAX_ACTIVE, 'opened crate survives the end notice');
visual.update(5000);
visual.update(5000 + 450 + 900 + 1);
assert.equal(visual.liveCount, SUPPLY_CRATE_MAX_ACTIVE - 1, 'opened crate exits via its own animation');

// --- generation reset: clear() reuses the pool ------------------------------
visual.clear();
assert.equal(visual.liveCount, 0);
assert.equal(scene.children.length, 0, 'scene emptied on reset');
visual.apply([landed(77)]);
const grp2 = scene.children[0] as THREE.Group;
assert.equal((grp2.children[0] as THREE.Mesh).geometry, bodyGeo, 'pooled geometry survives clear() (respawn epoch)');
visual.clear();
assert.equal(visual.liveCount, 0);

// --- terminal dispose: module is inert --------------------------------------
visual.apply([landed(50)]);
visual.dispose();
assert.equal(visual.liveCount, 0);
assert.equal(scene.children.length, 0);
visual.apply([landed(51), openedEv(51), endedEv(51)]); // must NOT resurrect the pool
assert.equal(visual.liveCount, 0, 'apply() after dispose() is a no-op');
assert.equal(scene.children.length, 0);
visual.update(9000);
visual.clear();
assert.equal(visual.liveCount, 0);

console.log('supply-crate-visual: all CPU lifecycle + negative controls passed');
