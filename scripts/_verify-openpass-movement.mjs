/** Read-only actual-source CPU movement diagnosis. No browser, renderer, app
 * build, Git or gameplay input. Counterexample PASS means a defect reproduced,
 * never product acceptance. --write creates the sole owned receipt exclusively. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixed = process.argv.includes('--expect-fixed');
const nativeRequire = createRequire(resolve(root, 'package.json'));
const sourceHashes = {};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = file => readFileSync(resolve(root, file));
const listeners = new Map();
const canvas = { addEventListener() {} };
const document = { pointerLockElement: null, hasFocus: () => true, addEventListener() {} };
const context = vm.createContext({ console, document, URLSearchParams, addEventListener(type, fn) {
  const rows = listeners.get(type) ?? []; rows.push(fn); listeners.set(type, rows);
} });
const cache = new Map();
function load(file) {
  file = resolve(root, file);
  if (cache.has(file)) return cache.get(file);
  const source = readFileSync(file);
  sourceHashes[relative(root, file).replaceAll('\\', '/')] = sha(source);
  const code = ts.transpileModule(source.toString('utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText.replaceAll('import.meta.env.DEV', 'false'); // Match production-only diagnostic branches; source bytes remain hashed unchanged.
  const exports = {};
  cache.set(file, exports);
  vm.runInContext('(function(exports, require) {\n' + code + '\n})', context)(exports,
    name => name.startsWith('.') ? load(resolve(dirname(file), name + '.ts')) : nativeRequire(name));
  return exports;
}
const { Player } = load('src/core/player.ts');
const { createWorldQuery } = load('src/game/world-query.ts');
const { stepBot } = load('src/game/bot-nav.ts');
const navigation = fixed ? load('src/game/bot-navigation.ts') : null;
const { botIntent, BOT_ARSENAL, BOT_GOAL_TIMEOUT_MS, BOT_GOAL_REACHED_M } = load('src/game/bot-sense.ts');
const { SPAWN_POINTS } = load('src/game/spawn-points.ts');
const { FLOOR_H } = load('src/core/layout.ts');
const { PerspectiveCamera, Vector3 } = nativeRequire('three');
const checks = [];
function player(colliders = []) {
  const p = new Player(new PerspectiveCamera(), canvas);
  p.setColliders(colliders); p.teleport(0, 0, 0, 0, 0);
  return p;
}
function key(type, code, target = canvas) {
  for (const fn of listeners.get(type) ?? []) fn({ code, target, repeat: false, preventDefault() {} });
}
function solid(min, max) { return { min: new Vector3(...min), max: new Vector3(...max) }; }
function bot(x, z, goalX, goalZ) {
  return { id: 'cpu-navigation', team: 0, weapon: BOT_ARSENAL[0], x, y: 0, z,
    yaw: 0, pitch: 0, speed: 0, alive: true, life: 1, targetId: null,
    targetSince: 0, lastSeen: -Infinity, side: 1, sideWant: 1, sideSince: 0,
    goalX, goalZ, goalAt: 1, strafe: 1, strafeAt: 0, inputSeq: 0, shotSeq: 0,
    cooldown: 0, streakHoldSlot: null, streakHoldUntil: 0, streakBlocked: false };
}
const noTarget = { targetId: null, target: null, distance: Infinity, visible: false };
// Exact standing Player half-width/body-height/feet lift, checked against source.
const playerSource = read('src/core/player.ts').toString();
assert.match(playerSource, /const HALF_W = 0\.3;/);
assert.match(playerSource, /const BODY_H = 1\.78;/);
const HALF = .3, BODY = 1.78;
function overlapsBody(p, solids) {
  return solids.some(c => p.x + HALF > c.min.x && p.x - HALF < c.max.x
    && p.z + HALF > c.min.z && p.z - HALF < c.max.z
    && p.y + BODY > c.min.y && p.y + .02 < c.max.y);
}
function runBot(b, solids, seconds, dt = .05) {
  const started = performance.now(), beforePlans = navigation?.botNavigationStats().plans ?? 0;
  const world = createWorldQuery(solids), samples = [], rows = [];
  let unmoved = 0, slides = 0, firstBodyOverlap = null;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    const old = { x: b.x, y: b.y, z: b.z };
    const intent = botIntent(b, noTarget, i * dt * 1000 + 1, 100, null);
    if (stepBot(b, intent, dt, world)) slides++;
    if (Math.hypot(old.x - b.x, old.z - b.z) < 1e-12) unmoved++;
    const row = { tick: i, x: b.x, y: b.y, z: b.z, speed: b.speed };
    if (firstBodyOverlap === null && overlapsBody(b, solids)) firstBodyOverlap = row;
    if (i % 20 === 0 || i === Math.round(seconds / dt) - 1) samples.push(row);
    rows.push(row);
  }
  return { final: rows.at(-1), unmoved, slides, firstBodyOverlap, samples,
    cpuMs: performance.now() - started, plans: (navigation?.botNavigationStats().plans ?? 0) - beforePlans,
    finalSecondDisplacement: Math.hypot(rows.at(-1).x - rows.at(-21).x, rows.at(-1).z - rows.at(-21).z) };
}
function walk(p, waypoints, solids) {
  const legs = []; let overlap = false;
  for (const [x, z] of waypoints) {
    let frames = 0;
    for (; frames < 1200; frames++) {
      const dx = x - p.state.pos.x, dz = z - p.state.pos.z, distance = Math.hypot(dx, dz);
      if (distance <= .15) break;
      p.setProbeWish(dx / distance, dz / distance); p.update(1 / 60);
      overlap ||= overlapsBody(p.state.pos, solids);
    }
    const remaining = Math.hypot(x - p.state.pos.x, z - p.state.pos.z);
    legs.push({ target: [x, z], frames, remaining });
    if (remaining > .15) break;
  }
  p.setProbeWish(null);
  return { final: p.state.pos.toArray(), legs, overlapsStandingBody: overlap,
    reached: legs.length === waypoints.length && legs.every(row => row.remaining <= .15) };
}
function check(name, claim, fn) {
  const started = performance.now();
  try { const evidence = fn(); checks.push({ name, claimState: 'VERIFIED', claim, elapsedMs: performance.now() - started, evidence }); console.log('VERIFIED ' + name); }
  catch (error) { checks.push({ name, claimState: 'OPEN', error: error.stack }); console.log('OPEN ' + name + '\n' + error.stack); }
}

check('gravity-repair2', 'Previous free-cursor menu gravity regression is closed in actual Player CPU behavior.', () => {
  const p = player(); p.setFreeCursorLook(true); key('keydown', 'KeyW'); p.update(1 / 60);
  p.setMenuInputSuspended(true); const before = p.state.pos.clone();
  key('keydown', 'KeyZ', { tagName: 'INPUT' }); key('keydown', 'Space', { tagName: 'INPUT' }); p.update(1 / 60);
  assert.equal(p.state.pos.distanceTo(before), 0); assert.equal(p.getStance(), 'stand');
  p.teleport(0, 2, 0); p.state.grounded = false; p.state.vel.y = -1;
  p.setMenuInputSuspended(false); p.setMenuInputSuspended(true); assert.equal(p.state.vel.y, -1);
  for (let i = 0; i < 60; i++) p.update(1 / 60);
  assert.equal(p.state.pos.y, 0);
  p.teleport(0, 2, 0); p.state.grounded = false; p.setInputSuspended(true); p.setMenuInputSuspended(false);
  for (let i = 0; i < 60; i++) p.update(1 / 60);
  assert.equal(p.state.pos.y, 2);
  return { menuGravityLandedY: 0, independentPilotSuspensionY: 2, verticalVelocityPreserved: true, typingBlocked: true };
});

check('bot-narrow-gap', fixed ? 'Bot body never penetrates a narrow gap; Player refusal remains unchanged.' : 'Bot chest-point movement passes a 0.4m gap that the real 0.6m-wide Player cannot occupy.', () => {
  const solids = [solid([-2, 0, -.2], [-.2, 4, .2]), solid([.2, 0, -.2], [2, 4, .2])];
  const b = bot(0, -2, 0, 5), result = runBot(b, solids, 2);
  const p = player(solids); p.teleport(0, 0, -2); const human = walk(p, [[0, 2]], solids);
  if (fixed) assert.equal(result.firstBodyOverlap, null);
  else { assert(result.firstBodyOverlap !== null); assert(b.z > .2); }
  assert.equal(human.reached, false);
  return { fixture: { gapMetres: .4, playerWidthMetres: .6, solids }, bot: result, player: human };
});

check('bot-u-wall-trap', fixed ? 'Bot follows a collision-valid detour and reaches the same U-wall goal within the original8-second window.' : 'Bot stays blocked for most of its existing goal window despite a collision-valid Player detour.', () => {
  const solids = [solid([1.8, 0, -2], [2, 4, 2]), solid([-1, 0, -2], [2, 4, -1.8]), solid([-1, 0, 1.8], [2, 4, 2])];
  const target = SPAWN_POINTS.find(p => p.id === 'street-east'); assert(target);
  const b = bot(0, 0, target.x, target.z), result = runBot(b, solids, 8);
  assert(8000 < BOT_GOAL_TIMEOUT_MS);
  if (fixed) { assert(Math.hypot(b.goalX - b.x, b.goalZ - b.z) <= .3); assert.equal(result.firstBodyOverlap, null); }
  else { assert(Math.hypot(b.goalX - b.x, b.goalZ - b.z) > BOT_GOAL_REACHED_M);
    assert.equal(result.finalSecondDisplacement, 0); assert(result.unmoved > 100); }
  const p = player(solids), human = walk(p, [[-1.6, 0], [-1.6, 2.6], [2.6, 2.6], [2.6, 0], [target.x, target.z]], solids);
  assert.equal(human.reached, true); assert.equal(human.overlapsStandingBody, false);
  return { fixture: { solids, targetId: target.id, target: [target.x, target.z] }, bot: result, playerDetour: human,
    goalTimeoutMs: BOT_GOAL_TIMEOUT_MS, measurementMs: 8000, blockedStepsMetricWouldBe: result.slides };
});

check('bot-under-upper-floor', fixed ? 'Bot enters under the upper floor at ground height with no body intersection.' : 'Highest-column groundY makes an overhead upper floor block a bot entering a clear ground-floor corridor.', () => {
  const solids = [solid([0, FLOOR_H - .22, -1], [3, FLOOR_H, 1])];
  const b = bot(-2, 0, 6, 0), result = runBot(b, solids, 2);
  const p = player(solids); p.teleport(-2, 0, 0); const human = walk(p, [[2, 0]], solids);
  if (fixed) { assert(b.x > 3); assert.equal(b.y, 0); assert.equal(result.firstBodyOverlap, null); }
  else { assert(b.x < 0); assert.equal(result.finalSecondDisplacement, 0); }
  assert.equal(human.reached, true); assert.equal(human.overlapsStandingBody, false);
  return { fixture: { floorTop: FLOOR_H, solids }, groundYInside: createWorldQuery(solids).groundY(1, 0), bot: result, player: human };
});

if (process.argv.includes('--house')) check('authored-orange-front-door', fixed ? 'Current authored orange doorway is traversable by bot and Player with no body overlaps.' : 'Current orange-house collider output reproduces the bot ground-floor entrance refusal.', () => {
  // CPU geometry construction only. The real source supplies colliders; material
  // instances are inert substitutes and no canvas, texture, renderer or GPU runs.
  const { authoredPresentationSearch } = load('src/core/presentation-defaults.ts');
  context.window = { location: { search: authoredPresentationSearch('') } };
  const { makeRng } = load('src/core/kit.ts');
  const { buildOrangeHouse } = load('src/build/orange-house.ts');
  const { MeshStandardMaterial } = nativeRequire('three');
  const material = new MeshStandardMaterial();
  const room = new Proxy({}, { get: () => material });
  const mat = new Proxy({ painted: () => material, emissive: () => material,
    signText: () => material, interior: () => room }, { get: (obj, key) => obj[key] ?? material });
  const built = buildOrangeHouse({ mat, rand: makeRng('nuketown-2025:orange-house') });
  try {
    const solids = built.colliders;
    const x = 1.6, startZ = -14, targetZ = -18.4;
    const b = bot(x, startZ, x, targetZ), result = runBot(b, solids, 8);
    const p = player(solids); p.teleport(x, 0, startZ);
    const human = walk(p, [[x, targetZ]], solids);
    const next = { x: b.x, z: b.z - .215 }, world = createWorldQuery(solids);
    const column = solids.map((c, index) => ({ c, index })).filter(({ c }) =>
      next.x >= c.min.x - .01 && next.x <= c.max.x + .01 && next.z >= c.min.z - .01 && next.z <= c.max.z + .01);
    assert.equal(human.reached, true); assert.equal(human.overlapsStandingBody, false);
    if (fixed) { assert(Math.abs(b.z - targetZ) <= .3); assert.equal(result.firstBodyOverlap, null); }
    else { assert.equal(result.finalSecondDisplacement, 0); assert(b.z > targetZ + 1); }
    return { subset: 'current orange-house colliders only; surrounding modules and live rendered pixels untested',
      presentationSearch: context.window.location.search, colliderCount: solids.length,
      colliderSha256: sha(JSON.stringify(solids.map(c => ({ min: c.min.toArray(), max: c.max.toArray() })))),
      start: [x, 0, startZ], target: [x, targetZ], bot: result, player: human,
      refusedNextColumn: { ...next, groundY: world.groundY(next.x, next.z), colliders: column } };
  } finally {
    const geometries = new Set(); built.group.traverse(o => { if (o.geometry) geometries.add(o.geometry); });
    for (const geometry of geometries) geometry.dispose(); material.dispose(); delete context.window;
  }
});

if (fixed) check('headroom-step-speed-cache-and-fallback', 'Headroom and step limits match Player; free travel speed and legacy ports survive; failed searches are bounded and cached.', () => {
  const start = { x: 0, y: 0, z: -1 };
  assert.equal(navigation.botWalkSegment(createWorldQuery([solid([-2, 1.7, -.2], [2, 2, .2])]), start, 0, 1), null);
  assert(navigation.botWalkSegment(createWorldQuery([solid([-2, 1.9, -.2], [2, 2.1, .2])]), start, 0, 1));
  assert(navigation.botWalkSegment(createWorldQuery([solid([-2, 0, 0], [2, .38, 2])]), start, 0, 1));
  assert.equal(navigation.botWalkSegment(createWorldQuery([solid([-2, 0, 0], [2, .4, 2])]), start, 0, 1), null);
  assert.equal(navigation.botWalkSegment(createWorldQuery([solid([0, 0, 0], [.1, 4, .1])]),
    { x: -.31, y: 0, z: -.289 }, -.289, -.31), null, 'short diagonal must not cut a body-sized corner between samples');
  const free = bot(0, 0, 13, 0), beforeFree = navigation.botNavigationStats(); runBot(free, [], 2);
  assert(Math.abs(free.x - 8.6) < 1e-9); assert.equal(navigation.botNavigationStats().plans, beforeFree.plans);
  const oldPort = { inBounds: () => true, groundY: () => 0, lineOfSight: () => true };
  const legacy = bot(0, 0, 13, 0); stepBot(legacy, botIntent(legacy, noTarget, 1, 100, null), .05, oldPort);
  assert.equal(legacy.x, .215);
  const routeWorld = createWorldQuery([solid([1.8, 0, -2], [2, 4, 2]),
    solid([-1, 0, -2], [2, 4, -1.8]), solid([-1, 0, 1.8], [2, 4, 2])]);
  const actorKey = {}, from = { x: 0, y: 0, z: 0 };
  assert(navigation.botDetour(actorKey, routeWorld, from, 13, 0, .215, .05, true, 1));
  assert.equal(navigation.botDetour(actorKey, routeWorld, { x: 12, y: 0, z: 0 }, 13, 0, .215, .05, false, 2), null,
    'new life must not inherit the previous life route');
  const prison = [solid([-1, 0, -1], [1, 4, -.8]), solid([-1, 0, .8], [1, 4, 1]),
    solid([-1, 0, -1], [-.8, 4, 1]), solid([.8, 0, -1], [1, 4, 1])];
  const trapped = bot(0, 0, 13, 0), before = navigation.botNavigationStats(), started = performance.now();
  const result = runBot(trapped, prison, 3), elapsedMs = performance.now() - started;
  const after = navigation.botNavigationStats();
  assert(after.plans - before.plans <= 3); assert(after.maxExpanded <= navigation.BOT_PATH_NODE_LIMIT);
  assert.equal(result.firstBodyOverlap, null); assert(result.slides > 0);
  return { unobstructedDistance2sec: free.x, legacyStep: legacy.x, failedRoutePlans3sec: after.plans - before.plans,
    planNodeLimit: navigation.BOT_PATH_NODE_LIMIT, maximumExpanded: after.maxExpanded, failedRouteCpuMs: elapsedMs,
    newLifeClearsRoute: true, diagonalCornerSweep: true };
});

check('player-descending-slab', 'Root-owned swept landing retains the floor at both allowed50ms and60Hz steps.', () => {
  const rows = [];
  for (const dt of [.05, 1 / 60]) {
    const p = player([solid([-2, 2.93, -2], [2, 3.15, 2])]); p.teleport(0, 5, 0); p.state.grounded = false;
    for (let i = 0; i < Math.round(3 / dt); i++) p.update(dt);
    rows.push({ dt, finalY: p.state.pos.y }); assert.equal(p.state.pos.y, 3.15);
  }
  return { current: rows, retainedNegative: { sourceSha256: '57414221c7ea0acf5fe7eb0716782beaed7d3a834650191a27d4a9c8035ea333',
    dt: .05, startY: 5, crossing: { tick: 8, from: 3.1711999999999994, to: 2.7139999999999995, vy: -9.144 }, finalY: 0 } };
});

for (const file of ['src/main.ts', 'src/ui/menus.ts', 'src/ui/settings-apply.ts', 'src/game/bots.ts', 'scripts/traverse.mjs', 'scripts/paths.mjs']) sourceHashes[file] = sha(read(file));
const result = {
  schema: 'atomic-acres/openpass-movement-audit/1', recordedAt: new Date().toISOString(),
  status: checks.every(c => c.claimState === 'VERIFIED') ? (fixed ? 'CPU_CLOSURE_RUNTIME_OPEN' : 'CPU_COUNTEREXAMPLES_CONFIRMED_RUNTIME_OPEN') : 'CPU_PROBE_INCOMPLETE',
  limits: 'Synthetic AABB fixtures exercise actual current Player, botIntent, stepBot and createWorldQuery. Optional --house adds current authored orange-house collider output using inert material substitutes and CPU geometry only; it is a module subset, not a rendered full-map or browser acceptance. Existing traversal thresholds and historical receipts are unchanged. No browser, UI input, GPU, app build, Git, network or runtime edits.',
  checks, sourceHashes, helperSha256: sha(readFileSync(fileURLToPath(import.meta.url))),
  preparationFailures: [{ at: '2026-09-27T12:44:42.524Z', case: 'authored-orange-front-door',
    error: 'Initial CommonJS CPU loader could not parse import.meta.env.DEV in static-batch.ts; authored geometry did not run.',
    correction: 'Use production-equivalent false for that diagnostic expression in memory only; no runtime source or assertion changed.' }],
  implementationFailures: [{ at: '2026-09-27T12:52:46.847Z', sourceSha256: '919542cfc51bf8bde15911898039651261f81f2f195627fe3cfa13d03c6ad4cd',
    sourceSnapshot: 'captures/openpass-movement-before/attempt1-bot-navigation.ts',
    case: 'grazing corner', from: [-.31, 0, -.289], to: [-.289, 0, -.31],
    box: { min: [0, 0, 0], max: [.1, 4, .1] }, observed: 'destination admitted instead of null',
    repair: 'Localized repair1: full horizontal footprint sweep between floor substeps; original assertion remains.' }],
  originalEvidence: { receipt: 'captures/openpass-movement-audit.json', receiptSha256: '31c677714ab412e65b71a996e43cf1d7298ff035eda4c17fef22cc80970ea8e8',
    helperSnapshot: 'captures/openpass-movement-before/_verify-openpass-movement.mjs', helperSha256: 'ebea53653405ea6faabfbb4195f9e59ac5a29f57a34c36f0c23fc0e0a1eb08b4' },
};
if (process.argv.includes('--write')) {
  const output = resolve(root, fixed ? 'captures/openpass-movement-closure.json' : 'captures/openpass-movement-audit.json');
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log('RECEIPT ' + output);
} else console.log(JSON.stringify(result, null, 2));
if (checks.some(c => c.claimState !== 'VERIFIED')) process.exitCode = 1;
