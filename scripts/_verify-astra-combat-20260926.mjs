/** CPU verification of the real host: no DOM, graphics or browser claims. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = (path) => join(root, path).replaceAll('\\', '/');
const folder = mkdtempSync(join(tmpdir(), 'aa-astra-combat-'));
const entry = join(folder, 'entry.ts');
const bundle = join(folder, 'bundle.mjs');
writeFileSync(entry, `
export { GameHost } from '${src('src/game/host.ts')}';
export { createWorldQuery } from '${src('src/game/world-query.ts')}';
export { WEAPONS } from '${src('src/weapons/catalog.ts')}';
export { SIDEARM_IDS } from '${src('src/game/loadout.ts')}';
export { isPlayableWeapon } from '${src('src/weapons/roster.ts')}';
export { BotDirector, botIntent } from '${src('src/game/bots.ts')}';
export { StreakRuntime } from '${src('src/game/killstreaks/runtime.ts')}';
export { streakPort } from '${src('src/game/session-streaks.ts')}';
`);
await build({ entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { GameHost, createWorldQuery, WEAPONS, SIDEARM_IDS, isPlayableWeapon, BotDirector, botIntent, StreakRuntime, streakPort } = await import(pathToFileURL(bundle).href);
let cases = 0;
const test = (name, fn) => { fn(); cases++; process.stdout.write(`PASS ${name}\n`); };
const def = (id) => WEAPONS.find((w) => w.id === id);
const wall = (z) => ({ min: { x: -3, y: 0, z }, max: { x: 3, y: 3, z: z + 0.2 } });

function fixture(weapon, targets = [{ id: 'target', x: 0, z: 5, team: 1 }], boxes = [], extra = {}) {
  const host = new GameHost({ world: createWorldQuery(boxes), now: 0,
    rules: { mode: 'tdm', scoreLimit: null, durationMs: null, friendlyFire: false }, ...extra });
  host.addActor('shooter', 0, { loadout: {
    primary: SIDEARM_IDS.includes(weapon) ? 'longhorn' : weapon,
    sidearm: SIDEARM_IDS.includes(weapon) ? weapon : 'duster', grenade: 'smoke',
  } });
  for (const t of targets) host.addActor(t.id, t.team ?? 1);
  let now = 3000;
  host.tick(now);
  const pose = () => {
    host.updatePose('shooter', 0, 0, 0, now);
    for (const t of targets) host.updatePose(t.id, t.x, 0, t.z, now, t.stance ?? 'stand');
  };
  pose();
  let seq = 0;
  const shot = (changes = {}) => host.submitShot('shooter', { type: 'shot', life: host.lifeOf('shooter'),
    seq: ++seq, weaponId: weapon, firedAt: now, ox: 0, oy: 1.2, oz: 0, dx: 0, dy: 0, dz: 1, ...changes }, now);
  const advance = (ms = 20) => { now += ms; pose(); return host.tick(now); };
  const intent = (action) => {
    const state = host.weaponStateOf('shooter', now);
    return host.submitWeaponIntent('shooter', { action, weaponId: weapon,
      life: state.life, seq: state.lastIntentSeq + 1 }, now);
  };
  // The stronger host contract requires real equip/hold/reload admission.
  // The combat and conservation assertions below remain the same.
  if (SIDEARM_IDS.includes(weapon)) assert.equal(intent('equip').accepted, true);
  if (weapon === 'railgun') { assert.equal(intent('charge-start').accepted, true); advance(750); }
  const drain = () => host.tick(now);
  const actor = (id = 'target') => host.snapshot().actors.find((a) => a.id === id);
  return { host, targets, shot, advance, drain, actor, intent, now: () => now };
}

test('all 20 roster guns admit one carried shot and deal real damage', () => {
  assert.equal(WEAPONS.length, 20);
  for (const weapon of WEAPONS) {
    assert.ok(isPlayableWeapon(weapon.id), `${weapon.id} still gated`);
    const f = fixture(weapon.id);
    assert.equal(f.shot().accepted, true, weapon.id);
    let events = f.drain();
    for (let i = 0; i < 60 && !events.some((e) => e.type === 'damage'); i++) events.push(...f.advance());
    assert.ok(events.some((e) => e.type === 'damage' && e.weaponId === weapon.id), `${weapon.id} caused no damage`);
    const kit = f.host.loadoutOf('shooter');
    assert.equal(SIDEARM_IDS.includes(weapon.id) ? kit.sidearmRounds : kit.rounds,
      weapon.magSize + weapon.startReserve - 1, `${weapon.id} did not consume exactly one round`);
  }
});

test('shotgun pull resolves multiple pellets but spends one shell', () => {
  const f = fixture('coachman');
  f.shot();
  const hits = f.drain().filter((e) => e.type === 'damage');
  assert.ok(hits.length > 1, `only ${hits.length} pellets landed`);
  assert.ok(hits.reduce((sum, e) => sum + e.amount, 0) > def('coachman').damage.base);
  assert.equal(f.host.loadoutOf('shooter').rounds, def('coachman').magSize + def('coachman').startReserve - 1);
});

test('hitscan respects walls, prone height and friendly teams', () => {
  const blocked = fixture('longhorn', undefined, [wall(2)]); blocked.shot();
  assert.equal(blocked.drain().filter((e) => e.type === 'damage').length, 0);
  const prone = fixture('longhorn', [{ id: 'target', x: 0, z: 5, stance: 'prone' }]); prone.shot();
  assert.equal(prone.drain().filter((e) => e.type === 'damage').length, 0);
  const friendly = fixture('longhorn', [{ id: 'target', x: 0, z: 5, team: 0 }]); friendly.shot();
  assert.equal(friendly.actor().hp, 100);
});

test('rail pierces two merged surfaces with reduced damage, never a third', () => {
  const f = fixture('railgun', [
    { id: 'clear', x: 0, z: 2 }, { id: 'one', x: 0, z: 5 },
    { id: 'two', x: 0, z: 8 }, { id: 'three', x: 0, z: 11 },
  ], [wall(3), wall(3.05), wall(6), wall(9)]);
  f.shot();
  const hits = f.drain().filter((e) => e.type === 'damage');
  assert.ok(hits.some((e) => e.victimId === 'clear'));
  const first = hits.find((e) => e.victimId === 'one'); const second = hits.find((e) => e.victimId === 'two');
  assert.ok(first && second && second.amount < first.amount);
  assert.equal(f.actor('three').hp, 100);
});

test('flame cone hits off-axis coverage, excludes cover and burns after release', () => {
  const f = fixture('flamethrower', [
    { id: 'near', x: 0.3, z: 5 }, { id: 'far', x: 0, z: 8 }, { id: 'outside', x: 3, z: 5 },
  ], [wall(6)]);
  f.shot(); f.drain();
  const initial = f.actor('near').hp;
  assert.ok(initial < 100);
  assert.equal(f.actor('far').hp, 100); assert.equal(f.actor('outside').hp, 100);
  for (let i = 0; i < 20; i++) f.advance(20);
  assert.ok(f.actor('near').hp < initial, 'no afterburn');
});

test('flare flies against current target poses and leaves an admitted fire', () => {
  const f = fixture('flare-gun', [{ id: 'target', x: 4, z: 5 }]);
  f.shot(); const launch = f.drain();
  assert.ok(launch.some((e) => e.type === 'weapon-effect' && e.effect === 'flare-launch'));
  assert.equal(f.actor().hp, 100, 'instant flare damage');
  f.advance(60); f.targets[0].x = 0;
  const events = [];
  for (let i = 0; i < 30; i++) events.push(...f.advance());
  assert.ok(events.some((e) => e.type === 'weapon-effect' && e.effect === 'flare-impact'));
  assert.ok(events.some((e) => e.type === 'damage' && e.weaponId === 'flare-gun'));
});

test('crossbow flight is delayed and explosive splash respects cover', () => {
  const f = fixture('explosive-crossbow', [{ id: 'target', x: 0, z: 5 }, { id: 'splash', x: 1, z: 5 }]);
  f.shot(); f.drain(); assert.equal(f.actor().hp, 100);
  const events = []; for (let i = 0; i < 15; i++) events.push(...f.advance());
  assert.ok(events.some((e) => e.type === 'bolt-impact'));
  assert.ok(events.some((e) => e.type === 'drop-spawned'), 'projectile death failed to drop the carried gun');
  assert.ok(events.some((e) => e.type === 'damage' && e.victimId === 'splash' && e.cause === 'explosion'));
  const behind = fixture('explosive-crossbow', undefined, [wall(2)]); behind.shot();
  for (let i = 0; i < 20; i++) behind.advance();
  assert.equal(behind.actor().hp, 100);
});

test('duplicate, cadence, uncarried gun and invalid direction are refused', () => {
  const f = fixture('longhorn', []);
  assert.equal(f.shot().accepted, true);
  assert.equal(f.shot({ seq: 1 }).reason, 'duplicate');
  assert.equal(f.shot().reason, 'shot-cooldown');
  assert.equal(f.shot({ weaponId: 'railgun' }).reason, 'malformed');
  assert.equal(f.shot({ dx: NaN }).reason, 'malformed');
  assert.equal(f.host.loadoutOf('shooter').primaryId, 'longhorn');
  assert.equal(f.host.loadoutOf('shooter').rounds, 149);
});

test('bounded network reorder preserves real cadence', () => {
  const f = fixture('longhorn', []);
  f.advance(200);
  assert.equal(f.shot({ seq: 2, firedAt: f.now() }).accepted, true);
  assert.equal(f.shot({ seq: 1, firedAt: f.now() - 100 }).accepted, true);
  assert.equal(f.shot({ seq: 3, firedAt: f.now() - 40 }).reason, 'shot-cooldown');
});

test('primary and selected sidearm cannot exceed total issued ammunition', () => {
  for (const weapon of ['explosive-crossbow', 'magnum']) {
    const f = fixture(weapon, []); const w = def(weapon);
    for (let i = 0; i < w.magSize + w.startReserve; i++) {
      const state = f.host.weaponStateOf('shooter', f.now());
      const row = state.primary.weaponId === weapon ? state.primary : state.sidearm;
      if (row.mag === 0 && row.reserve > 0) {
        assert.equal(f.intent('reload').accepted, true);
        f.advance(w.emptyReloadTime * 1000);
      }
      assert.equal(f.shot().accepted, true, `${weapon} round ${i}`); f.advance(w.interval * 1000 + 10);
    }
    assert.equal(f.shot().reason, 'empty-magazine');
  }
});

test('selected tactical is enforced, next-life loadout cannot rewrite live kit', () => {
  const f = fixture('longhorn', []);
  assert.equal(f.shot({ weaponId: 'flash' }).accepted, false);
  assert.equal(f.shot({ weaponId: 'smoke' }).accepted, true);
  f.host.setLoadout('shooter', { primary: 'railgun', sidearm: 'magnum', grenade: 'semtex' });
  assert.equal(f.host.loadoutOf('shooter').primaryId, 'longhorn');
  assert.equal(f.host.loadoutOf('shooter').sidearmId, 'duster');
  assert.equal(f.host.loadoutOf('shooter').tacticalId, 'smoke');
});

test('disconnect retires launched projectile and afterburn ownership', () => {
  const f = fixture('flare-gun'); f.shot(); f.host.removeActor('shooter');
  for (let i = 0; i < 50; i++) f.advance();
  assert.equal(f.actor().hp, 100);
});

test('selected respawn delay applies to projectile deaths', () => {
  const f = fixture('explosive-crossbow', undefined, [], { rules: {
    mode: 'tdm', scoreLimit: null, durationMs: null, friendlyFire: false, respawnMs: 500,
  } });
  f.shot(); f.drain(); const events = [];
  for (let i = 0; i < 15; i++) events.push(...f.advance());
  const death = events.find((e) => e.type === 'death' && e.victimId === 'target');
  assert.ok(death); assert.equal(death.respawnAt - death.at, 500);
});

test('field repair grants are applied once, heal 35, and obey the maximum', () => {
  const pending = [];
  const streaks = { registerActor() {}, recordElimination: () => [], recordDeath: () => [],
    recordDisconnect: () => [], activate: () => [], advance: () => [], endMatch: () => [],
    snapshotFor: () => [], drainRewardGrants: () => pending.splice(0) };
  const f = fixture('longhorn', undefined, [], { deps: { streaks } });
  f.shot(); f.advance(110); f.shot(); f.drain();
  assert.equal(f.actor().hp, 32);
  pending.push({ actorId: 'target', team: 1, reward: 'field-repair', at: f.now(), instanceId: 1 });
  f.advance(); assert.equal(f.actor().hp, 67);
  f.advance(); assert.equal(f.actor().hp, 67);
  pending.push({ actorId: 'target', team: 1, reward: 'field-repair', at: f.now(), instanceId: 2 });
  f.advance(); assert.equal(f.actor().hp, 100);
});

test('real bot director registers its arsenal and tactical, then lands admitted shots', () => {
  const world = createWorldQuery([]);
  const host = new GameHost({ world, now: 0, rules: { mode: 'tdm', scoreLimit: null, durationMs: null, friendlyFire: false } });
  const director = new BotDirector({ host, world, rand: host.rand, maxBots: 2 });
  host.addActor('human', 1);
  const first = director.add(0); const second = director.add(0);
  assert.ok(first && second && first.weapon.id !== second.weapon.id);
  for (const bot of director.roster) {
    assert.equal(host.loadoutOf(bot.id).primaryId, bot.weapon.id);
    assert.equal(host.loadoutOf(bot.id).tacticalId, bot.tacticalId);
    bot.x = bot === first ? -1 : 1; bot.y = 0; bot.z = 0;
  }
  const events = []; host.tick(3000);
  for (let now = 3000; now <= 4000; now += 50) {
    host.updatePose('human', 0, 0, 5, now);
    director.tick(now, 0, [{ id: 'human', team: 1, alive: true, x: 0, y: 0, z: 5 }], host.snapshot().actors);
    events.push(...host.tick(now));
  }
  for (const bot of director.roster) {
    assert.ok(events.some((e) => e.type === 'shot-fired' && e.actorId === bot.id && e.weaponId === bot.weapon.id), bot.id);
    assert.ok(events.some((e) => e.type === 'damage' && e.attackerId === bot.id), `${bot.id} did not land host damage`);
    const outcome = host.submitShot(bot.id, { type: 'shot', seq: ++bot.shotSeq, life: host.lifeOf(bot.id),
      weaponId: bot.tacticalId, firedAt: 4000, ox: bot.x, oy: 1.42, oz: bot.z, dx: 0, dy: 0, dz: 1 }, 4000);
    assert.equal(outcome.accepted, true, `${bot.id} tactical refused`);
  }
  assert.equal(events.filter((e) => e.type === 'shot-rejected').length, 0);
});

test('a dry bot seeks usable primary ammo even while an enemy remains visible', () => {
  const world = createWorldQuery([]); const host = new GameHost({ world });
  const director = new BotDirector({ host, world, rand: host.rand, maxBots: 1 });
  const bot = director.add(0); bot.x = 0; bot.y = 0; bot.z = 0;
  const intent = botIntent(bot, { targetId: 'human', target: { x: 0, y: 1.42, z: 5 }, distance: 5, visible: true },
    4000, 100, null, { lethal: 0, tactical: 0, rounds: 0, primaryId: bot.weapon.id, armed: null }, [
      { x: -2, z: 0, weaponId: 'mp5', rounds: 50 }, { x: 4, z: 0, weaponId: bot.weapon.id, rounds: 20 },
    ]);
  assert.equal(intent.fire, false); assert.equal(intent.scavengeX, 4); assert.ok(intent.moveX > 0);
});

test('a stalled host retires expired flares without an invisible later hit or fire', () => {
  const f = fixture('flare-gun'); f.shot(); f.drain();
  const events = f.advance(5000);
  for (let i = 0; i < 30; i++) events.push(...f.advance(100));
  assert.equal(events.filter((e) => e.type === 'damage').length, 0);
  const terminal = events.filter((e) => e.type === 'weapon-effect' && e.effect === 'flare-impact');
  assert.equal(terminal.length, 1); assert.equal(terminal[0].durationMs, 100);
  assert.equal(f.actor().hp, 100);
});

test('new lives reject stale-life claims and forged muzzle origins', () => {
  const f = fixture('longhorn'); const oldLife = f.host.lifeOf('shooter');
  for (let i = 1; i <= 3; i++) {
    assert.equal(f.host.submitShot('target', { type: 'shot', weaponId: 'longhorn', seq: i,
      life: f.host.lifeOf('target'), firedAt: f.now(), ox: 0, oy: 1.2, oz: 5, dx: 0, dy: 0, dz: -1 }, f.now()).accepted, true);
    f.advance(110);
  }
  assert.equal(f.actor('shooter').alive, false);
  f.advance(10_000); assert.ok(f.host.lifeOf('shooter') > oldLife);
  assert.equal(f.shot({ life: oldLife }).reason, 'life-epoch');
  assert.equal(f.shot({ ox: 50 }).reason, 'bad-origin');
});

function rewardFixture(rules) {
  const pending = [];
  const streaks = { registerActor() {}, recordElimination: () => [], recordDeath: () => [],
    recordDisconnect: () => [], activate: () => [], advance: () => [], endMatch: () => [],
    snapshotFor: () => [], drainRewardGrants: () => pending.splice(0) };
  const f = fixture('longhorn', undefined, [], { deps: { streaks }, ...(rules ? { rules } : {}) });
  return { ...f, pending };
}

test('Crimson is earned, damages through its own cone and restores exact suspended ammo', () => {
  const f = rewardFixture();
  assert.equal(f.shot({ weaponId: 'crimson-flamethrower' }).accepted, false);
  f.shot(); f.drain(); const saved = f.host.loadoutOf('shooter').rounds;
  f.pending.push({ actorId: 'shooter', team: 0, reward: 'crimson-flamethrower', instanceId: 90, at: f.now(), durationMs: 45000 });
  f.advance();
  assert.equal(f.host.loadoutOf('shooter').primaryId, 'crimson-flamethrower');
  assert.equal(f.host.loadoutOf('shooter').rewardWeaponRemainingMs, 44980);
  assert.equal(f.shot({ weaponId: 'crimson-flamethrower' }).accepted, true);
  assert(f.drain().some((e) => e.type === 'damage' && e.weaponId === 'crimson-flamethrower'));
  assert.equal(f.shot({ weaponId: 'pickup' }).reason, 'reward-active');
  const rewardRounds = f.host.loadoutOf('shooter').rounds;
  f.pending.push({ actorId: 'shooter', team: 0, reward: 'crimson-flamethrower', instanceId: 90, at: f.now(), durationMs: 45000 });
  f.advance(); assert.equal(f.host.loadoutOf('shooter').rounds, rewardRounds, 'duplicate grant cannot refill reward');
  f.advance(45000);
  assert.equal(f.host.loadoutOf('shooter').primaryId, 'longhorn');
  assert.equal(f.host.loadoutOf('shooter').rounds, saved);
  assert.equal(f.host.loadoutOf('shooter').rewardWeaponId, null);
  assert.equal(f.shot({ weaponId: 'crimson-flamethrower' }).accepted, false);
  const forgedKit = fixture('crimson-flamethrower');
  assert.notEqual(forgedKit.host.loadoutOf('shooter').primaryId, 'crimson-flamethrower');
});

test('adrenaline is capped at 1.25, expires on host time and grants do not renew twice', () => {
  const f = rewardFixture(); const at = f.now();
  f.pending.push({ actorId: 'shooter', team: 0, reward: 'adrenaline', instanceId: 91, at, durationMs: 99000 });
  f.advance(); assert.equal(f.host.loadoutOf('shooter').speedMultiplier, 1.25);
  f.advance(10000);
  f.pending.push({ actorId: 'shooter', team: 0, reward: 'adrenaline', instanceId: 91, at: f.now(), durationMs: 15000 });
  f.advance(); f.advance(5000);
  assert.equal(f.host.loadoutOf('shooter').speedMultiplier, 1);
});

test('death retires buffs before corpse drop and respawn never inherits Crimson', () => {
  const f = rewardFixture();
  for (const [instanceId, reward] of [[92, 'adrenaline'], [93, 'crimson-flamethrower']]) {
    f.pending.push({ actorId: 'shooter', team: 0, reward, instanceId, at: f.now() });
  }
  f.advance(); const events = [];
  for (let seq = 1; seq <= 3; seq++) {
    f.host.submitShot('target', { type: 'shot', weaponId: 'longhorn', seq, life: f.host.lifeOf('target'),
      firedAt: f.now(), ox: 0, oy: 1.2, oz: 5, dx: 0, dy: 0, dz: -1 }, f.now());
    events.push(...f.advance(110));
  }
  assert.equal(f.actor('shooter').alive, false);
  assert.equal(f.host.loadoutOf('shooter').speedMultiplier, 1);
  assert.equal(f.host.loadoutOf('shooter').rewardWeaponRemainingMs, 0);
  assert(events.some((e) => e.type === 'drop-spawned' && e.ownerId === 'shooter' && e.weaponId === 'longhorn'));
  assert(!events.some((e) => e.type === 'drop-spawned' && e.weaponId === 'crimson-flamethrower'));
  f.advance(5000); assert.equal(f.host.loadoutOf('shooter').primaryId, 'longhorn');
  assert.equal(f.host.loadoutOf('shooter').speedMultiplier, 1);
});

test('match end and disconnect retire temporary reward state', () => {
  const f = rewardFixture({ mode: 'tdm', scoreLimit: null, durationMs: 4000, friendlyFire: false });
  for (const [instanceId, reward] of [[94, 'adrenaline'], [95, 'crimson-flamethrower']]) {
    f.pending.push({ actorId: 'shooter', team: 0, reward, instanceId, at: f.now() });
  }
  f.advance(); f.advance(4100);
  assert.equal(f.host.matchState.phase, 'ended');
  assert.equal(f.host.loadoutOf('shooter').primaryId, 'longhorn');
  assert.equal(f.host.loadoutOf('shooter').speedMultiplier, 1);
  f.host.removeActor('shooter'); assert.equal(f.host.loadoutOf('shooter'), null);
  f.host.addActor('shooter', 0); assert.equal(f.host.loadoutOf('shooter').rewardWeaponId, null);
});

test('host aircraft hits obey actual nearest actor, world cover and hostility', () => {
  const calls = []; let health = 100;
  const target = { instanceId: 4, actorId: 'air-owner', team: 1, x: 0, y: 1.2, z: 10, radius: 2, health };
  const streaks = { registerActor() {}, recordElimination: () => [], recordDeath: () => [],
    recordDisconnect: () => [], activate: () => [], advance: () => [], endMatch: () => [], snapshotFor: () => [],
    aircraftTargets: () => health > 0 ? [{ ...target, health }] : [],
    damageAircraft: (id, actorId, team, amount) => { calls.push({ id, actorId, team, amount }); health -= amount; return []; } };
  const f = fixture('longhorn', [{ id: 'target', x: 0, z: 15, team: 1 }], [], { deps: { streaks } });
  for (let i = 0; i < 3; i++) { f.shot(); f.advance(110); }
  assert(health <= 0); assert.equal(calls.length, 3); assert.equal(f.actor().hp, 100, 'aircraft intercepted bullets before body');
  f.shot(); f.drain(); assert(f.actor().hp < 100, 'destroyed aircraft no longer intercepts');
  calls.length = 0; health = 100;
  const blocked = fixture('longhorn', [], [wall(2)], { deps: { streaks } }); blocked.shot(); blocked.drain();
  assert.equal(calls.length, 0, 'wall blocks aircraft fire');
  const bodyFirst = fixture('longhorn', undefined, [], { deps: { streaks } }); bodyFirst.shot(); bodyFirst.drain();
  assert.equal(calls.length, 0, 'nearer body blocks aircraft fire');
  target.team = 0;
  const friendly = fixture('longhorn', [], [], { deps: { streaks } }); friendly.shot(); friendly.drain();
  assert.equal(calls.length, 0, 'friendly aircraft takes no bullet damage');
  const ffa = fixture('longhorn', [], [], { deps: { streaks }, rules: { mode: 'ffa', durationMs: null, scoreLimit: null, friendlyFire: false } });
  ffa.shot(); ffa.drain(); assert.equal(calls.length, 1, 'same team numbers do not block FFA aircraft fire');
});

test('actual owned pilot blocks body guns and ordnance, admits controls and releases body fire on exit', () => {
  const rt = new StreakRuntime({ matchEpoch: 72 });
  const f = fixture('longhorn', undefined, [], { deps: { streaks: streakPort(rt, 72) } });
  rt.registerActor('shooter', 0, ['recon-sweep', 'signal-jam', 'piloted-drone', 'blast-mortar']);
  for (let i = 1; i <= 5; i++) rt.recordElimination('shooter', i, f.now());
  assert.equal(f.host.submitStreakIntent('shooter', { type: 'streak-intent', slot: 3, toggle: false }), null);
  assert(rt.pilotFor('shooter'));
  f.drain(); const held = f.host.loadoutOf('shooter');
  assert.equal(f.shot().reason, 'possessing');
  assert.equal(f.shot({ weaponId: 'frag' }).reason, 'possessing');
  assert.equal(f.shot({ weaponId: 'knife' }).reason, 'possessing');
  assert.equal(f.shot({ weaponId: 'pickup' }).reason, 'possessing');
  const rejected = f.drain();
  assert.equal(rejected.filter((e) => e.type === 'shot-rejected' && e.reason === 'possessing').length, 4);
  assert(!rejected.some((e) => ['shot-fired', 'grenade-armed', 'melee', 'damage'].includes(e.type)));
  const { weaponState: afterAck, ...afterKit } = f.host.loadoutOf('shooter');
  const { weaponState: beforeAck, ...beforeKit } = held;
  assert.deepEqual(afterKit, beforeKit, 'rejected body actions never alter kit');
  assert.deepEqual(afterAck.primary, beforeAck.primary); assert.deepEqual(afterAck.sidearm, beforeAck.sidearm);
  assert.equal(afterAck.resolvedShotSeqs.length, beforeAck.resolvedShotSeqs.length + 1, 'refused gun acknowledged without spending');
  const before = rt.aircraftTargets()[0];
  assert.equal(rt.submitPilotInput('shooter', { seq: 1, forward: 1, strafe: 0, ascend: 0,
    yaw: 0, pitch: 0, fire: false }, f.now(), createWorldQuery([])), true);
  f.advance(50); const after = rt.aircraftTargets()[0];
  assert(Math.hypot(after.x - before.x, after.z - before.z) > 0, 'actual aircraft continues moving');
  assert.equal(f.host.submitStreakIntent('shooter', { type: 'streak-intent', slot: 3, toggle: true }), null);
  assert.equal(rt.pilotFor('shooter'), null);
  assert.equal(f.shot({ seq: 1 }).reason, 'duplicate', 'blocked pilot shot cannot replay after exit');
  assert.equal(f.shot().accepted, true);
  assert(f.drain().some((e) => e.type === 'damage' && e.attackerId === 'shooter' && e.cause === 'bullet'));
});

test('real host credits support kills without farming another ladder charge', () => {
  const rt = new StreakRuntime({ matchEpoch: 73 }); const queue = [];
  const port = streakPort(rt, 73), advanceRuntime = port.advance;
  port.advance = (...args) => [...advanceRuntime(...args), ...queue.splice(0)];
  const f = fixture('longhorn', [0, 1, 2, 3].map((i) => ({ id: `victim-${i}`, team: 1, x: i, z: 5 })), [], { deps: { streaks: port } });
  for (let i = 0; i < 4; i++) queue.push({ type: 'damage', at: f.now(), attackerId: 'shooter', attackerTeam: 0,
    victimId: `victim-${i}`, victimTeam: 1, amount: 100, cause: 'streak', zone: 'body', weaponId: '',
    distance: 5, healthAfter: 0, sourceX: 0, sourceZ: 0 });
  const events = f.advance();
  assert.equal(events.filter((e) => e.type === 'kill' && e.killerId === 'shooter' && e.cause === 'streak').length, 4);
  assert.equal(f.actor('shooter').kills, 4, 'scoreboard still credits legitimate kills');
  assert.equal(f.actor('shooter').streak, 4, 'consecutive kill statistic remains truthful');
  assert.equal(rt.snapshotFor('shooter').find((s) => s.streakId === 'recon-sweep').charges, 0);
  assert.equal(events.filter((e) => e.type === 'streak-earned').length, 0);
  // A following gun kill advances exactly once, rather than catching the ladder up to the scoreboard.
  f.host.addActor('body-target', 1); f.advance(3000);
  for (let i = 0; i < 3; i++) {
    f.host.updatePose('body-target', 0, 0, 4, f.now()); f.shot(); f.advance(110);
  }
  assert.equal(f.actor('shooter').kills, 5);
  assert.equal(rt.snapshotFor('shooter').find((s) => s.streakId === 'recon-sweep').charges, 0);
});

process.stdout.write(`VERIFIED ${cases} host combat scenarios; loadout/rewards, aircraft, possession and streak credit. Rendering/network-device acceptance is separate.\n`);
