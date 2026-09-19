#!/usr/bin/env node
/**
 * Focused CPU-only regression: ThrowBodyPresentation.driven must not grow
 * across repeated distinct rigs in one match.
 *
 * Background: `driven` retained every rig until rebind, so repeated
 * despawns in one match accumulated stale references even though each
 * overlay finishes in 0.9 s. The fix prunes completed / dead / disposed /
 * absent rigs on every update() while keeping cancel-on-rebind.
 *
 * No browser, renderer, server, or GPU. Bundles the real `ordnance-view.ts`,
 * `throw-body.ts`, `blend.ts`, `clips.ts` and `skeleton.ts` with esbuild and
 * drives the actual presentation chain headless. Proves:
 *   1. repeated distinct throwers complete and prune back to zero (no growth)
 *   2. overlapping live throws are retained until they finish (no early drop)
 *   3. dead / disposed (root detached) / absent (resolve null) rigs prune
 *   4. cancel-on-rebind still holds and the new view still fires
 *
 * Gameplay is untouched: locomotion, timing beats and watchdog semantics are
 * asserted by verify-throw-presentation.mjs; this file only observes set size.
 */
import { build } from 'esbuild';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const OUT = join(tmpdir(), `nuketown-throw-lifecycle-${process.pid}.mjs`);

const ENTRY = `
  import * as THREE from ${JSON.stringify(join(ROOT, 'node_modules/three'))};
  import { buildStandardSkeleton } from ${JSON.stringify(join(ROOT, 'src/characters/skeleton'))};
  import { buildClipLibrary, THROW_BODY_S } from ${JSON.stringify(join(ROOT, 'src/characters/clips'))};
  import { CharacterRig } from ${JSON.stringify(join(ROOT, 'src/characters/blend'))};
  import { OrdnanceView } from ${JSON.stringify(join(ROOT, 'src/game/ordnance-view'))};
  import { ThrowBodyPresentation } from ${JSON.stringify(join(ROOT, 'src/characters/throw-body'))};
  export { THREE, buildStandardSkeleton, buildClipLibrary, THROW_BODY_S, CharacterRig, OrdnanceView, ThrowBodyPresentation };
`;

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'throw-lifecycle-entry.ts', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: OUT,
  logLevel: 'warning',
});

const api = await import(`file://${OUT}`);
const { THREE, buildStandardSkeleton, buildClipLibrary, THROW_BODY_S, CharacterRig, OrdnanceView, ThrowBodyPresentation } = api;

const assert = (ok, message) => { if (!ok) throw new Error(`throw-lifecycle: ${message}`); };
const DT = 1 / 60;
const lib = buildClipLibrary();
assert(THROW_BODY_S > 0.5 && THROW_BODY_S < 1.5, `unexpected throw duration ${THROW_BODY_S}`);

function makeRig() {
  const std = buildStandardSkeleton();
  const rig = new CharacterRig(std.root, std.bones, lib);
  return { std, rig, input: { speed: 0, turnRate: 0, crouch: false, aimWeight: 0, aimPitch: 0 } };
}
function thrownEvent(at, actorId) {
  return {
    type: 'grenade-thrown', at, actorId, team: 0, grenadeId: 'frag', id: 1,
    x: 1, y: 1.4, z: 1, vx: 12, vy: 3, vz: 4, detonatesAt: at + 1800,
  };
}
const drivenOf = (pres) => pres.qa().drivenRigs;
function tickToSettle(bot, seconds = THROW_BODY_S + 0.4) {
  const n = Math.ceil(seconds / DT);
  for (let i = 0; i < n; i++) bot.rig.update(DT, bot.input);
}

// ---- 1. repeated distinct rigs: no growth after completion
{
  const view = new OrdnanceView('self');
  const pres = new ThrowBodyPresentation();
  pres.bind(view);
  const live = new Map();
  const resolve = (id) => live.get(id)?.rig ?? null;
  let at = 1000;
  let maxSeen = 0;
  const N = 40;
  for (let k = 0; k < N; k++) {
    const id = `bot-${k}`;
    const bot = makeRig();
    // Attach so the disposed check (root.parent === null) does not fire:
    // these are live bodies that finish and prune via phase 'none'.
    const scene = new THREE.Group();
    scene.add(bot.std.root);
    live.set(id, bot);
    view.apply(thrownEvent(at += 50, id));
    pres.update(resolve);
    assert(bot.rig.throwBodyPhase === 'release', `${id} did not enter release`);
    maxSeen = Math.max(maxSeen, drivenOf(pres));
    tickToSettle(bot);
    pres.update(resolve); // prune pass drops the completed rig
    scene.remove(bot.std.root);
  }
  assert(drivenOf(pres) === 0, `completed rigs accumulated: driven=${drivenOf(pres)} after ${N} distinct throwers`);
  assert(maxSeen <= 1, `sequential throws should never hold more than one live rig (saw ${maxSeen})`);
  console.log(`[throw-lifecycle] sequential ${N} distinct rigs -> driven 0 (max live ${maxSeen})`);
}

// ---- 2. overlapping live throws are kept, then all prune together
{
  const view = new OrdnanceView('self');
  const pres = new ThrowBodyPresentation();
  pres.bind(view);
  const live = new Map();
  const resolve = (id) => live.get(id)?.rig ?? null;
  const K = 10;
  for (let k = 0; k < K; k++) {
    const id = `overlap-${k}`;
    const bot = makeRig();
    new THREE.Group().add(bot.std.root);
    live.set(id, bot);
    view.apply(thrownEvent(2000 + k, id));
    pres.update(resolve);
  }
  assert(drivenOf(pres) === K, `live overlays dropped early: driven=${drivenOf(pres)} want ${K}`);
  for (const bot of live.values()) tickToSettle(bot);
  pres.update(resolve);
  assert(drivenOf(pres) === 0, `overlapping completions accumulated: driven=${drivenOf(pres)}`);
  console.log(`[throw-lifecycle] overlap ${K} live -> driven 0 after settle`);
}

// ---- 3. dead / disposed / absent prune even with a live overlay
{
  const view = new OrdnanceView('self');
  const pres = new ThrowBodyPresentation();
  pres.bind(view);
  const live = new Map();
  const resolve = (id) => live.get(id)?.rig ?? null;

  const dead = makeRig();
  new THREE.Group().add(dead.std.root);
  live.set('dead', dead);
  view.apply(thrownEvent(3000, 'dead'));
  pres.update(resolve);
  dead.rig.playDeath();
  pres.update(resolve);
  assert(drivenOf(pres) === 0, `dead rig retained: driven=${drivenOf(pres)}`);

  const scene = new THREE.Group();
  const gone = makeRig();
  scene.add(gone.std.root);
  live.set('gone', gone);
  view.apply(thrownEvent(3100, 'gone'));
  pres.update(resolve);
  assert(drivenOf(pres) === 1, 'disposed fixture never drove');
  scene.remove(gone.std.root); // despawn detaches the root
  pres.update(resolve);
  assert(drivenOf(pres) === 0, `detached root retained: driven=${drivenOf(pres)}`);
  assert(gone.rig.throwBodyPhase === 'none', 'detached rig kept a live overlay');

  const missing = makeRig();
  new THREE.Group().add(missing.std.root);
  live.set('missing', missing);
  view.apply(thrownEvent(3200, 'missing'));
  pres.update(resolve);
  assert(drivenOf(pres) === 1, 'absent fixture never drove');
  live.delete('missing'); // despawned: the actor no longer resolves
  pres.update(resolve);
  assert(drivenOf(pres) === 0, `absent rig retained: driven=${drivenOf(pres)}`);
  assert(missing.rig.throwBodyPhase === 'none', 'absent rig kept a live overlay');
  console.log('[throw-lifecycle] dead/disposed/absent all prune to 0');
}

// ---- 4. cancel-on-rebind is unchanged and the new view still fires
{
  const view = new OrdnanceView('self');
  const pres = new ThrowBodyPresentation();
  pres.bind(view);
  const bot = makeRig();
  new THREE.Group().add(bot.std.root);
  const resolve = (id) => (id === 'bot-1' ? bot.rig : null);
  view.apply(thrownEvent(4000, 'bot-1'));
  pres.update(resolve);
  assert(bot.rig.throwBodyPhase === 'release', 'rebind fixture did not drive');
  assert(drivenOf(pres) === 1, 'rebind fixture not tracked');
  const view2 = new OrdnanceView('self');
  pres.bind(view2);
  assert(bot.rig.throwBodyPhase === 'none', 'rebind left a live overlay running');
  assert(drivenOf(pres) === 0, 'rebind left driven state');
  view2.apply(thrownEvent(5000, 'bot-1'));
  pres.update(resolve);
  assert(bot.rig.throwBodyPhase === 'release', 'new-view cue did not fire after rebind');
  tickToSettle(bot);
  pres.update(resolve);
  assert(drivenOf(pres) === 0, 'post-rebind completion did not prune');
  pres.bind(null);
  assert(drivenOf(pres) === 0, 'unbind left driven state');
  console.log('[throw-lifecycle] cancel-on-rebind preserved, new view fires, completion prunes');
}

console.log(JSON.stringify({ verdict: 'PASS', note: 'repeated distinct rigs prove no growth after completion; dead/disposed/absent prune; rebind intact' }));
