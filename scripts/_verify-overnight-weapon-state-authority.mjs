/** Actual GameHost weapon-state authority. No DOM, browser, GPU or simulated host. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = p => join(root, p).replaceAll('\\', '/');
const temp = mkdtempSync(join(tmpdir(), 'aa-weapon-authority-'));
const entry = join(temp, 'entry.ts'), bundle = join(temp, 'bundle.mjs');
writeFileSync(entry, `
export { GameHost } from '${src('src/game/host.ts')}';
export { createWorldQuery } from '${src('src/game/world-query.ts')}';
export { ALL_WEAPONS } from '${src('src/weapons/catalog.ts')}';
export { BotDirector } from '${src('src/game/bots.ts')}';
export { RAIL_CHARGE_MS } from '${src('src/game/host-weapon-state.ts')}';
`);
await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { GameHost, createWorldQuery, ALL_WEAPONS, BotDirector, RAIL_CHARGE_MS } = await import(pathToFileURL(bundle).href);
const def = id => ALL_WEAPONS.find(w => w.id === id);
let count = 0;
function test(name, fn) { fn(); count++; console.log(`PASS ${name}`); }
function fixture(primary = 'longhorn', extra = {}) {
  const world = createWorldQuery([]), grants = [];
  let piloting = false;
  const streaks = { registerActor() {}, recordElimination: () => [], recordDeath: () => [],
    recordDisconnect: () => [], activate: () => [], advance: () => [], endMatch: () => [],
    snapshotFor: () => [], drainRewardGrants: () => grants.splice(0), isPiloting: () => piloting };
  const host = new GameHost({ world, now: 0, rules: { mode: 'tdm', scoreLimit: null, durationMs: null, friendlyFire: false },
    deps: { streaks }, ...extra });
  host.addActor('a', 0, { loadout: { primary, sidearm: 'magnum', grenade: 'smoke' } });
  host.addActor('b', 1, { primaryId: 'longhorn' });
  let now = 3000, shotSeq = 0;
  const pose = () => { host.updatePose('a', 0, 0, 0, now); host.updatePose('b', 0, 0, 5, now); };
  pose(); host.tick(now);
  const state = () => host.weaponStateOf('a', now);
  const advance = ms => { now += ms; pose(); return host.tick(now); };
  const intent = (action, weaponId = state().activeWeaponId, changes = {}) => host.submitWeaponIntent('a', {
    action, weaponId, seq: state().lastIntentSeq + 1, life: host.lifeOf('a'), ...changes }, now);
  const shot = (changes = {}, receivedAt = now) => host.submitShot('a', { type: 'shot', seq: ++shotSeq,
    life: host.lifeOf('a'), weaponId: state().activeWeaponId, firedAt: now,
    ox: 0, oy: 1.2, oz: 0, dx: 0, dy: 1, dz: 0, ...changes }, receivedAt);
  return { host, world, grants, state, advance, intent, shot, now: () => now,
    pilot: value => { piloting = value; }, pose };
}
function yes(result, message) { assert.equal(result.accepted, true, message ?? JSON.stringify(result)); }
function no(result, reason) { assert.equal(result.accepted, false); assert.equal(result.reason, reason); }
function rounds(row) { return row.mag + row.reserve; }

test('a full primary issue cannot bypass an empty magazine; exact empty reload transfers once', () => {
  const f = fixture(); const w = def('longhorn');
  for (let i = 0; i < w.magSize; i++) { yes(f.shot()); f.advance(w.interval * 1000); }
  assert.equal(f.state().primary.mag, 0); assert.equal(f.state().primary.reserve, w.startReserve);
  no(f.shot(), 'empty-magazine');
  yes(f.intent('reload')); assert.equal(f.state().primary.reloadRemainingMs, w.emptyReloadTime * 1000);
  no(f.intent('reload'), 'already-reloading');
  f.advance(w.emptyReloadTime * 1000 - 1); no(f.shot(), 'reloading');
  f.advance(1); yes(f.shot());
  assert.equal(f.state().primary.mag, w.magSize - 1); assert.equal(f.state().primary.reserve, w.startReserve - w.magSize);
  f.advance(10000); assert.equal(f.state().primary.reserve, w.startReserve - w.magSize);
});

test('tactical reload preserves issued rounds and cancel/equip never creates a cartridge', () => {
  const f = fixture(); yes(f.shot()); f.advance(100); const total = rounds(f.state().primary);
  yes(f.intent('reload')); assert.equal(f.state().primary.reloadDurationMs, def('longhorn').reloadTime * 1000);
  f.advance(500); yes(f.intent('cancel')); assert.equal(f.state().primary.mag, 29);
  yes(f.intent('reload')); f.advance(500); yes(f.intent('equip', 'magnum'));
  assert.equal(f.state().primary.reloadRemainingMs, 0); assert.equal(rounds(f.state().primary), total);
  no(f.shot({ weaponId: 'longhorn' }), 'weapon-not-active'); yes(f.shot({ weaponId: 'magnum' }));
  yes(f.intent('equip', 'longhorn')); yes(f.intent('reload')); f.advance(2100);
  assert.equal(f.state().primary.mag, 30); assert.equal(f.state().primary.reserve, 119);
  assert.equal(rounds(f.state().primary), total);
});

test('delayed pre-reload and pre-equip shots remain valid while in-reload shots are refused', () => {
  const f = fixture(); yes(f.shot()); f.advance(150); const before = f.now();
  f.advance(50); yes(f.intent('reload'));
  yes(f.shot({ firedAt: before })); assert.equal(f.state().primary.mag, 28);
  f.advance(100); no(f.shot({ firedAt: f.now() }), 'reloading'); f.advance(2000);
  assert.equal(f.state().primary.mag, 30); assert.equal(f.state().primary.reserve, 118);
  no(f.shot({ firedAt: f.now() - 100 }), 'reloading');
  const previous = f.now(); f.advance(50); yes(f.intent('equip', 'magnum'));
  yes(f.shot({ weaponId: 'longhorn', firedAt: previous }));
});

test('intent identity, life, ownership and bounded sequence cannot forge host completion', () => {
  const f = fixture(); no(f.intent('reload'), 'magazine-full');
  const state = f.state(); assert.equal(state.lastIntentSeq, 0);
  no(f.intent('equip', 'magnum', { seq: 0 }), 'duplicate');
  no(f.intent('equip', 'magnum', { seq: 600 }), 'malformed');
  no(f.intent('equip', 'magnum', { life: state.life + 1, seq: 10 }), 'life-epoch');
  assert.equal(f.state().lastIntentSeq, 0);
  no(f.intent('equip', 'railgun'), 'weapon-not-owned'); assert.equal(f.state().lastIntentSeq, 1);
  no(f.intent('reload', 'magnum'), 'weapon-not-active');
  no(f.intent('charge-start'), 'not-charge-weapon');
  yes(f.shot()); f.advance(100); yes(f.intent('reload', 'longhorn', { durationMs: 0, mag: 999, at: -9999 }));
  assert.equal(f.state().primary.reloadRemainingMs, 2100); assert.equal(f.state().primary.mag, 29);
  assert.ok(Object.isFrozen(f.state())); assert.ok(Object.isFrozen(f.state().primary));
});

test('reload-cancel flooding cannot evict an interval and backdate an illegal shot into it', () => {
  const f = fixture(); yes(f.shot()); f.advance(200); const oldReload = f.now();
  for (let i = 0; i < 10; i++) { yes(f.intent('reload')); f.advance(1); yes(f.intent('cancel')); f.advance(1); }
  no(f.shot({ firedAt: oldReload }), 'reloading'); assert.equal(f.state().primary.mag, 29);
  yes(f.shot()); assert.equal(f.state().primary.mag, 28);
});

test('host timed Railgun hold admits one charge, forbids early/backdated/repeated discharge', () => {
  const f = fixture('railgun'); no(f.shot(), 'charge-required');
  yes(f.intent('charge-start')); f.advance(RAIL_CHARGE_MS - 1); no(f.shot(), 'charge-incomplete');
  f.advance(1); no(f.shot({ firedAt: f.now() - 1 }), 'charge-incomplete');
  yes(f.shot()); assert.equal(f.state().primary.mag, 3); assert.equal(f.state().primary.chargeElapsedMs, null);
  f.advance(1250); no(f.shot(), 'charge-required');
  yes(f.intent('charge-start')); f.advance(100); yes(f.intent('cancel')); f.advance(750);
  no(f.shot(), 'charge-required');
  yes(f.intent('charge-start')); f.advance(750); yes(f.intent('equip', 'magnum')); yes(f.intent('equip', 'railgun'));
  f.advance(1); no(f.shot(), 'charge-required');
});

test('charge cancellation on possession and trusted seat resume cannot preserve a charged ticket', () => {
  const f = fixture('railgun'); yes(f.intent('charge-start')); f.advance(800);
  f.pilot(true); f.advance(1); no(f.intent('reload'), 'possessing'); no(f.shot(), 'possessing');
  f.pilot(false); f.advance(1); no(f.shot(), 'charge-required');
  yes(f.intent('charge-start')); f.advance(750); const chargedAt = f.now(), seq = f.state().lastIntentSeq;
  f.host.cancelWeaponCharge('a', f.now()); assert.equal(f.state().lastIntentSeq, seq);
  no(f.shot({ firedAt: chargedAt }), 'charge-required');
  yes(f.intent('charge-start')); f.advance(750); yes(f.shot()); f.advance(1250);
  yes(f.intent('reload')); f.advance(500); const saved = f.state();
  f.host.cancelWeaponCharge('a', f.now());
  assert.deepEqual(f.state().primary, saved.primary); assert.deepEqual(f.state().sidearm, saved.sidearm);
  assert.equal(f.state().lastIntentSeq, saved.lastIntentSeq); assert.ok(f.state().revision >= saved.revision);
  f.advance(saved.primary.reloadRemainingMs); assert.equal(f.state().primary.mag, 4); assert.equal(f.state().primary.reserve, 19);
});

test('reordered accepted and refused shot acknowledgements are exact, bounded and do not replenish', () => {
  const f = fixture(); yes(f.shot({ seq: 2 })); f.advance(100);
  no(f.shot({ seq: 3, ox: 100 }), 'bad-origin'); yes(f.shot({ seq: 1 }));
  assert.deepEqual(f.state().resolvedShotSeqs, [2, 3, 1]); assert.equal(f.state().lastShotSeq, 3);
  assert.equal(f.state().primary.mag, 28);
  for (let seq = 4; seq < 76; seq++) no(f.shot({ seq, ox: 100 }), 'bad-origin');
  assert.equal(f.state().resolvedShotSeqs.length, 64); assert.equal(f.state().resolvedShotSeqs.at(-1), 75);
  assert.equal(f.state().primary.mag, 28);
});

test('Crimson expiry restores the exact suspended split, cancels reload and never issues saved ammo twice', () => {
  const f = fixture(); yes(f.shot()); f.advance(100); yes(f.intent('reload')); f.advance(500);
  const before = f.state().primary;
  f.grants.push({ actorId: 'a', team: 0, reward: 'crimson-flamethrower', instanceId: 92, at: f.now(), durationMs: 45000 });
  f.advance(1); assert.equal(f.state().primary.weaponId, 'crimson-flamethrower'); yes(f.shot());
  f.advance(45000); const restored = f.state().primary;
  assert.equal(restored.weaponId, 'longhorn'); assert.equal(restored.mag, before.mag); assert.equal(restored.reserve, before.reserve);
  assert.equal(restored.reloadRemainingMs, 0); f.advance(10000); assert.deepEqual(f.state().primary, restored);
});

function killA(f) {
  for (let seq = 1; seq <= 3; seq++) {
    yes(f.host.submitShot('b', { type: 'shot', seq, life: f.host.lifeOf('b'), weaponId: 'longhorn',
      firedAt: f.now(), ox: 0, oy: 1.2, oz: 5, dx: 0, dy: 0, dz: -1 }, f.now()));
    if (seq < 3) f.advance(100);
  }
  assert.equal(f.host.snapshot().actors.find(a => a.id === 'a').alive, false);
  f.host.tick(f.now());
}

test('pre-death charged trade remains legal; death cancels outstanding reload and next life is isolated', () => {
  const f = fixture('railgun'); yes(f.intent('charge-start')); f.advance(800); killA(f);
  const death = f.now(), oldLife = f.host.lifeOf('a'); f.advance(50);
  yes(f.shot({ firedAt: death - 50 })); assert.equal(f.state().primary.mag, 3);
  no(f.shot(), 'shooter-dead'); no(f.intent('reload'), 'shooter-dead');
  f.advance(10000); assert.ok(f.host.lifeOf('a') > oldLife);
  assert.equal(f.state().primary.mag, 4); assert.equal(f.state().lastIntentSeq, -1);
  no(f.intent('charge-start', 'railgun', { life: oldLife, seq: 44 }), 'life-epoch');
  no(f.shot({ life: oldLife }), 'life-epoch'); no(f.shot(), 'charge-required');
  const r = fixture(); yes(r.shot()); r.advance(100); yes(r.intent('reload')); killA(r);
  assert.equal(r.state().primary.reloadRemainingMs, 0); assert.equal(r.state().primary.mag, 29);
  r.advance(500); assert.equal(r.state().primary.mag, 29); assert.equal(r.state().primary.reserve, 120);
});

test('a late trade spends exactly one matching corpse cartridge before pickup settlement', () => {
  const f = fixture(); killA(f); const death = f.now();
  let drop = f.host.snapshot().ordnance.drops.find(d => d.ownerId === 'a') ?? f.host.snapshot().ordnance.drops[0];
  assert.ok(drop); const id = drop.id; assert.equal(drop.rounds, 150);
  f.host.addActor('c', 0, { primaryId: 'mp5' }); f.advance(1); f.host.updatePose('c', 0.5, 0, 0, f.now());
  let cs = 0;
  const pickup = () => f.host.submitShot('c', { type: 'shot', seq: ++cs, life: f.host.lifeOf('c'), weaponId: 'pickup',
    firedAt: f.now(), ox: .5, oy: 1.2, oz: 0, dx: 0, dy: 1, dz: 0 }, f.now());
  no(pickup(), 'drop-settling'); f.advance(50); f.host.updatePose('c', .5, 0, 0, f.now());
  yes(f.shot({ firedAt: death - 50, seq: 11 }));
  drop = f.host.snapshot().ordnance.drops.find(d => d.id === id); assert.equal(drop.rounds, 149);
  assert.equal(f.state().primary.mag, 29); no(f.shot({ firedAt: death - 50, seq: 11 }), 'duplicate');
  assert.equal(f.host.snapshot().ordnance.drops.find(d => d.id === id).rounds, 149);
  f.advance(224); f.host.updatePose('c', .5, 0, 0, f.now()); no(pickup(), 'drop-settling');
  f.advance(1); f.host.updatePose('c', .5, 0, 0, f.now()); yes(pickup());
  const equipped = f.host.weaponStateOf('c', f.now()); assert.equal(equipped.primary.weaponId, 'longhorn');
  assert.equal(equipped.primary.mag, 29); assert.equal(equipped.primary.reserve, 120);
  const left = f.host.snapshot().ordnance.drops.find(d => d.id === id); assert.equal(left.weaponId, 'mp5');
  f.advance(1); f.host.updatePose('c', .5, 0, 0, f.now()); yes(pickup());
  assert.equal(f.host.snapshot().ordnance.drops.find(d => d.id === id).rounds, 149);
  f.advance(10000); const saved = f.host.snapshot().ordnance.drops.find(d => d.id === id).rounds;
  no(f.shot({ firedAt: f.now(), life: 1 }), 'life-epoch');
  assert.equal(f.host.snapshot().ordnance.drops.find(d => d.id === id).rounds, saved);
});

test('late sidearm trade never spends the corpse primary, and scavenged ammo goes to reserve', () => {
  const f = fixture(); yes(f.intent('equip', 'magnum')); killA(f); const death = f.now(); f.advance(50);
  yes(f.shot({ firedAt: death - 50, weaponId: 'magnum' }));
  assert.equal(f.host.snapshot().ordnance.drops[0].rounds, 150);
  assert.equal(f.state().sidearm.mag, 5);
  f.host.addActor('c', 0, { primaryId: 'longhorn' });
  f.advance(1);
  f.host.updatePose('c', 3, 0, 0, f.now());
  yes(f.host.submitShot('c', { type: 'shot', seq: 1, life: f.host.lifeOf('c'), weaponId: 'longhorn',
    firedAt: f.now(), ox: 3, oy: 1.2, oz: 0, dx: 0, dy: 1, dz: 0 }, f.now()));
  f.advance(226); f.host.updatePose('c', .5, 0, 0, f.now()); f.host.tick(f.now());
  const c = f.host.weaponStateOf('c', f.now()); assert.equal(c.primary.mag, 29); assert.equal(c.primary.reserve, 121);
  assert.equal(f.host.snapshot().ordnance.drops[0].rounds, 149);
});

test('real BotDirector reloads through the same magazine gate and uses a backup when fully dry', () => {
  const f = fixture(); f.host.removeActor('a'); f.host.removeActor('b');
  const director = new BotDirector({ host: f.host, world: f.world, rand: f.host.rand, maxBots: 1 });
  const bot = director.add(0); bot.x = 0; bot.y = 0; bot.z = 0;
  f.host.addActor('human', 1); const events = []; let reloadSeen = false, secondarySeen = false;
  for (let i = 0; i < 1600; i++) {
    const now = f.now();
    const human = f.host.snapshot().actors.find(a => a.id === 'human');
    if (!human.alive) { f.host.removeActor('human'); f.host.addActor('human', 1); }
    f.host.updatePose('human', 0, 0, 20, now);
    director.tick(now, .05, [{ id: 'human', team: 1, alive: true, x: 0, y: 0, z: 20 }], f.host.snapshot().actors);
    const state = f.host.weaponStateOf(bot.id, now); reloadSeen ||= state.primary.reloadRemainingMs > 0;
    secondarySeen ||= state.activeWeaponId === state.sidearm.weaponId;
    events.push(...f.advance(50));
  }
  const shots = events.filter(e => e.type === 'shot-fired' && e.actorId === bot.id);
  assert.ok(shots.filter(e => e.weaponId === bot.weapon.id).length > bot.weapon.magSize, 'never fired beyond first magazine');
  assert.ok(reloadSeen, 'never submitted a real host reload'); assert.ok(secondarySeen, 'never equipped issued backup after primary exhausted');
  assert.equal(events.filter(e => e.type === 'shot-rejected' && e.shooterId === bot.id).length, 0);
  assert.ok(shots.some(e => e.weaponId !== bot.weapon.id));
});

test('match end cancels actions and removed actors have no recoverable weapon state', () => {
  const f = fixture('railgun', { rules: { mode: 'tdm', scoreLimit: null, durationMs: 1000, friendlyFire: false } });
  yes(f.intent('charge-start')); f.advance(1100); assert.equal(f.state().primary.chargeElapsedMs, null);
  no(f.intent('charge-start'), 'match-inactive'); f.host.removeActor('a'); assert.equal(f.host.weaponStateOf('a'), null);
  no(f.host.submitWeaponIntent('a', { action: 'reload', weaponId: 'railgun', seq: 1, life: 1 }), 'unknown-shooter');
});

test('real Railgun bot waits for a host charge, and earned Crimson stays fireable by bots', () => {
  for (const kind of ['railgun', 'crimson-flamethrower']) {
    const f = fixture(); f.host.removeActor('a');
    const director = new BotDirector({ host: f.host, world: f.world, rand: f.host.rand, maxBots: 20 });
    let bot;
    for (let i = 0; i < 20; i++) {
      bot = director.add(0);
      if (kind !== 'railgun' || bot.weapon.id === kind) break;
      f.host.removeActor(bot.id);
    }
    assert.ok(bot); if (kind === 'railgun') assert.equal(bot.weapon.id, kind);
    bot.x = 0; bot.y = 0; bot.z = 0;
    if (kind === 'crimson-flamethrower') {
      f.grants.push({ actorId: bot.id, team: 0, reward: kind, instanceId: 301, at: f.now(), durationMs: 45000 }); f.advance(1);
    }
    let startedAt = null; const events = [];
    for (let i = 0; i < 60; i++) {
      const now = f.now();
      director.tick(now, .05, [{ id: 'b', team: 1, alive: true, x: 0, y: 0, z: 5 }], f.host.snapshot().actors);
      const charge = f.host.weaponStateOf(bot.id, now).primary.chargeElapsedMs;
      if (charge !== null && startedAt === null) startedAt = now - charge;
      events.push(...f.advance(50));
    }
    const first = events.find(e => e.type === 'shot-fired' && e.actorId === bot.id && e.weaponId === kind);
    assert.ok(first, `${kind} bot never fired`);
    if (kind === 'railgun') assert.ok(startedAt !== null && first.at - startedAt >= 750);
    assert.equal(events.filter(e => e.type === 'shot-rejected' && e.shooterId === bot.id).length, 0);
  }
});

console.log(`VERIFIED ${count} actual host weapon-state authority groups`);
