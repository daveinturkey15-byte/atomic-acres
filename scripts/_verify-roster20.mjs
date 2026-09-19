/**
 * _verify-roster20 — CPU invariants for the 20-weapon roster slice. Deterministic,
 * headless, NO browser: it bundles the real `src/weapons/` and `src/game/loadout.ts`
 * modules with esbuild (already a vite dependency; no install) and asserts the
 * roster's numeric and projection contracts in node.
 *
 * WHAT IT LOCKS:
 *   1. the roster is exactly the frozen20 ids, and the ORIGINAL FIVE are
 *      byte-stable against the root-b015a59 baseline snapshot (no silent rebalance);
 *   2. every weapon's numbers are finite and mutually coherent (ordered falloff
 *      ranges, reload pairs, the documented 0.20–0.28 s ADS band, sane cones);
 *   3. damage semantics flow through the SHARED rules only: `damageAt` is
 *      monotone, the optic headshot rule keys off `isScoped` exactly, and no
 *      weapon leaks a private special case;
 *   4. the PLAYABLE-ROSTER GATE holds end to end: the four behaviour-gated
 *      exotics (railgun, explosive-crossbow, flamethrower, flare-gun) are
 *      barred from primaries, sidearms, persisted custom slots and loadout
 *      resolution; the sidearm slot is exactly the pistol-family trio; every
 *      projection row a menu would show carries honest readiness + reasons;
 *   5. every catalog weapon has exactly one family row, every fallback
 *      points at one of the five shipped rigs/voices, and gating agrees with
 *      the `exotic` family in both directions.
 *
 *   node scripts/_verify-roster20.mjs        # exit 1 on any violated invariant
 */
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = (p) => join(root, p).replaceAll('\\', '/');

const EXPECTED_IDS = [
  'longhorn', 'rattler', 'coachman', 'deadeye', 'duster',
  'mp5', 'mini-uzi', 'machine-pistol', 'm4a1', 'ak-47', 'lmg', 'minigun',
  'm14-ebr', 'slug-shotgun', 'magnum', 'flashlight-pistol', 'railgun',
  'explosive-crossbow', 'flamethrower', 'flare-gun',
];
const BASELINE_CATALOG = join(root, 'docs/orchestration/overnight-20260919/baselines/roster20-root-b015a59/src/weapons/catalog.ts');

const entry = `
import { WEAPONS as ROSTER, damageAt, patternMult } from '${src('src/weapons/catalog.ts')}';
import { WEAPONS as BASELINE, damageAt as baseDamageAt, patternMult as basePatternMult } from '${src('docs/orchestration/overnight-20260919/baselines/roster20-root-b015a59/src/weapons/catalog.ts')}';
import { WEAPON_FAMILY, FAMILY_FALLBACK, FAMILY_VOICE, weaponFamily } from '${src('src/weapons/families.ts')}';
import { isPlayableWeapon, playableWeapons, PROTOTYPE_WEAPON_IDS, rosterProjection } from '${src('src/weapons/roster.ts')}';
import { SIDEARM_IDS, PRIMARY_IDS, FIELD_KITS, defaultLoadoutStore, resolveLoadout, respawnLoadoutFor, loadLoadout, weaponTraits, sidearmForPrimary } from '${src('src/game/loadout.ts')}';
import { isScoped, zoneMultiplier, admitted, HEADSHOT_MULTIPLIER, SNIPER_HEADSHOT_MULTIPLIER, MIN_LANDED_DAMAGE } from '${src('src/game/damage.ts')}';
import { MAX_HEALTH } from '${src('src/game/health.ts')}';
import { fullRounds, createDrop } from '${src('src/game/pickups.ts')}';
import { HostLife } from '${src('src/game/host-life.ts')}';
import { validPrimaryId } from '${src('src/net/room-admit.ts')}';
import { GameHost } from '${src('src/game/host.ts')}';
import { DEFAULT_RULES } from '${src('src/game/rules.ts')}';

export {
  ROSTER, BASELINE, damageAt, baseDamageAt, patternMult, basePatternMult,
  WEAPON_FAMILY, FAMILY_FALLBACK, FAMILY_VOICE, weaponFamily,
  isPlayableWeapon, playableWeapons, PROTOTYPE_WEAPON_IDS, rosterProjection,
  SIDEARM_IDS, PRIMARY_IDS, FIELD_KITS, defaultLoadoutStore, resolveLoadout,
  respawnLoadoutFor, loadLoadout, weaponTraits, sidearmForPrimary,
  isScoped, zoneMultiplier, admitted, HEADSHOT_MULTIPLIER, SNIPER_HEADSHOT_MULTIPLIER,
  MIN_LANDED_DAMAGE, MAX_HEALTH,
  fullRounds, createDrop,
  HostLife,
  validPrimaryId,
  GameHost,
  DEFAULT_RULES,
};
`;

const tmp = join(tmpdir(), 'nuketown-roster20-verify');
mkdirSync(tmp, { recursive: true });
const entryPath = join(tmp, 'entry.ts');
const outPath = join(tmp, 'bundle.mjs');
writeFileSync(entryPath, entry);
await build({
  entryPoints: [entryPath],
  outfile: outPath,
  bundle: true,
  platform: 'node',
  format: 'esm',
  logLevel: 'silent',
});
const m = await import(pathToFileURL(outPath).href);
const {
  ROSTER, BASELINE, damageAt, baseDamageAt, patternMult, basePatternMult,
  WEAPON_FAMILY, FAMILY_FALLBACK, FAMILY_VOICE, weaponFamily,
  isPlayableWeapon, playableWeapons, PROTOTYPE_WEAPON_IDS, rosterProjection,
  SIDEARM_IDS, PRIMARY_IDS, FIELD_KITS, defaultLoadoutStore, resolveLoadout,
  respawnLoadoutFor, loadLoadout, weaponTraits, sidearmForPrimary,
  isScoped, zoneMultiplier, admitted, HEADSHOT_MULTIPLIER, SNIPER_HEADSHOT_MULTIPLIER,
  MIN_LANDED_DAMAGE, MAX_HEALTH,
  fullRounds, createDrop, HostLife, validPrimaryId, GameHost, DEFAULT_RULES,
} = m;

const failures = [];
function check(name, ok, detail = '') {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
}

// ---- 1. roster shape and original-five stability --------------------------------
check('roster has exactly 20 weapons', ROSTER.length === 20, `got ${ROSTER.length}`);
check('roster ids are the frozen20', JSON.stringify(ROSTER.map((w) => w.id)) === JSON.stringify(EXPECTED_IDS), ROSTER.map((w) => w.id).join(','));
check('roster ids are unique', new Set(ROSTER.map((w) => w.id)).size === 20);

const base5 = JSON.stringify(BASELINE.slice(0, 5));
const live5 = JSON.stringify(ROSTER.slice(0, 5));
check('original five are byte-stable vs root-b015a59 baseline', base5 === live5);
check('baseline catalog had exactly five weapons', BASELINE.length === 5, `got ${BASELINE.length}`);
for (const w of ROSTER.slice(0, 5)) {
  const i = EXPECTED_IDS.indexOf(w.id);
  check(`damageAt unchanged for ${w.id}`, damageAt(w, 0) === baseDamageAt(BASELINE[i], 0) && damageAt(w, 999) === baseDamageAt(BASELINE[i], 999));
  check(`patternMult unchanged for ${w.id}`, patternMult(w, 3) === basePatternMult(BASELINE[i], 3));
}

// ---- 2. numeric coherence ----------------------------------------------------------------------
function finiteEvery(obj, path) {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'number') check(`finite ${path}.${k}`, Number.isFinite(v), String(v));
    else if (v && typeof v === 'object') finiteEvery(v, `${path}.${k}`);
  }
}
for (const w of ROSTER) {
  finiteEvery(w, w.id);
  check(`${w.id} interval > 0`, w.interval > 0);
  check(`${w.id} pellets >= 1`, w.pellets >= 1);
  check(`${w.id} magSize >= 1`, w.magSize >= 1);
  check(`${w.id} startReserve >= 1`, w.startReserve >= 1);
  check(`${w.id} reload pair ordered`, w.reloadTime > 0 && w.reloadTime < w.emptyReloadTime);
  check(`${w.id} falloff ordered`, w.damage.nearRange > 0 && w.damage.nearRange < w.damage.farRange);
  check(`${w.id} fall below base`, w.damage.fall > 0 && w.damage.fall < w.damage.base);
  check(`${w.id} bloom within ceiling`, w.spread.bloom > 0 && w.spread.bloom <= w.spread.bloomMax);
  check(`${w.id} crouchMult in (0,1]`, w.spread.crouchMult > 0 && w.spread.crouchMult <= 1);
  check(`${w.id} adsTime in the documented 0.20-0.28 band`, w.adsTime >= 0.2 && w.adsTime <= 0.28, String(w.adsTime));
  check(`${w.id} adsMoveScale in (0,1]`, w.adsMoveScale > 0 && w.adsMoveScale <= 1);
  check(`${w.id} patternLen >= 1`, w.recoil.patternLen >= 1);
  const dps = (w.pellets * w.damage.base) / w.interval;
  check(`${w.id} near-band dps in the roster band [80,420]`, dps >= 80 && dps <= 420, `dps=${dps.toFixed(1)}`);
}

// ---- 3. shared damage semantics only ------------------------------------------------------------
for (const w of ROSTER) {
  let prev = Infinity;
  for (let d = 0; d <= 100; d += 1) {
    const v = damageAt(w, d);
    check(`${w.id} damageAt monotone at ${d}m`, v <= prev + 1e-9);
    prev = v;
  }
  check(`${w.id} damageAt(nearRange) = base`, damageAt(w, w.damage.nearRange) === w.damage.base);
  check(`${w.id} damageAt(farRange+) = fall`, damageAt(w, w.damage.farRange) === w.damage.fall && damageAt(w, 500) === w.damage.fall);
  check(`${w.id} isScoped keys off adsFov<=40`, isScoped(w) === (w.adsFov <= 40));
  check(`${w.id} body zone is x1`, zoneMultiplier(w, 'body') === 1);
  check(`${w.id} limb zone is x1`, zoneMultiplier(w, 'limb') === 1);
  const scopedHead = isScoped(w) ? SNIPER_HEADSHOT_MULTIPLIER : HEADSHOT_MULTIPLIER;
  check(`${w.id} head zone follows the optic rule`, zoneMultiplier(w, 'head') === scopedHead);
}
check('scoped set is exactly deadeye/m14-ebr/railgun', JSON.stringify(ROSTER.filter((w) => isScoped(w)).map((w) => w.id)) === JSON.stringify(['deadeye', 'm14-ebr', 'railgun']));
check('admitted clamps to a full-health player', admitted(5000) === MAX_HEALTH);
check('admitted keeps a mid value', admitted(50) === 50);
check('admitted floor is MIN_LANDED_DAMAGE', admitted(MIN_LANDED_DAMAGE) >= MIN_LANDED_DAMAGE);

const byId = Object.fromEntries(ROSTER.map((w) => [w.id, w]));
check('railgun one-shot body inside its near band', damageAt(byId['railgun'], 35) >= MAX_HEALTH);
check('deadeye one-shot body inside its near band', damageAt(byId['deadeye'], 40) >= MAX_HEALTH);
check('magnum head one-tap close', 67 * HEADSHOT_MULTIPLIER >= MAX_HEALTH);
check('slug-shotgun head one-tap close', 78 * HEADSHOT_MULTIPLIER >= MAX_HEALTH);
check('flamethrower can never one-tap', 9 * SNIPER_HEADSHOT_MULTIPLIER < MAX_HEALTH);
check('m14-ebr two-shot body in band', 2 * damageAt(byId['m14-ebr'], 45) >= MAX_HEALTH);

// ---- 4. the playable-roster gate and loadout projection ------------------------------------------
check('playable roster is 16 of the 20 designed', playableWeapons().length === 16, String(playableWeapons().length));
check('prototypes are exactly the four behaviour-gated exotics', JSON.stringify(PROTOTYPE_WEAPON_IDS) === JSON.stringify(['railgun', 'explosive-crossbow', 'flamethrower', 'flare-gun']));
check('original five are playable', EXPECTED_IDS.slice(0, 5).every(isPlayableWeapon));
check('every non-exotic roster weapon is playable', ROSTER.filter((w) => WEAPON_FAMILY[w.id] !== 'exotic').every((w) => isPlayableWeapon(w.id)));
check('unknown ids are never playable', isPlayableWeapon('not-a-gun') === false);

check('sidearms are exactly the pistol-family trio', JSON.stringify([...SIDEARM_IDS]) === JSON.stringify(['duster', 'magnum', 'flashlight-pistol']));
check('13 primaries derive from the playable pool', PRIMARY_IDS.length === 13, `got ${PRIMARY_IDS.length}`);
check('primaries are playable and never sidearms', PRIMARY_IDS.every((id) => isPlayableWeapon(id) && !SIDEARM_IDS.includes(id)));
check('no prototype reaches primaries or sidearms', PROTOTYPE_WEAPON_IDS.every((id) => !PRIMARY_IDS.includes(id) && !SIDEARM_IDS.includes(id)));
for (const id of ['longhorn', 'rattler', 'coachman', 'deadeye', 'mp5', 'mini-uzi', 'machine-pistol', 'm4a1', 'ak-47', 'lmg', 'minigun', 'm14-ebr', 'slug-shotgun']) {
  check(`${id} joins primaries by existing`, PRIMARY_IDS.includes(id));
}
check('still exactly four field kits', FIELD_KITS.length === 4);
for (const kit of FIELD_KITS) check(`kit ${kit.id} primary is an original five`, EXPECTED_IDS.slice(0, 5).includes(kit.primary), kit.primary);
check('deadeye kit keeps the Duster sidearm', sidearmForPrimary('deadeye') === 'duster');
check('a Duster primary carries the Magnum, not two Dusters', sidearmForPrimary('duster') === 'magnum');

// Persisted stores cannot resurrect a prototype: sanitize drops the slot…
const protoStoreJson = JSON.stringify({
  version: 1,
  custom: [{ name: 'CHEAT', primary: 'railgun', grenade: 'frag' }, null, null],
  selected: { kind: 'custom', slot: 0 },
});
const sanitized = loadLoadout({ getItem: () => protoStoreJson, setItem: () => {} });
check('sanitize drops a persisted railgun slot', sanitized.custom[0] === null);
check('sanitize falls the selection back to a kit', sanitized.selected.kind === 'kit');
check('resolve after a prototype slot lands on the default kit primary', resolveLoadout(sanitized).primary === 'longhorn', resolveLoadout(sanitized).primary);
// …and resolveLoadout re-checks even a hand-built store that bypassed sanitize.
const handBuilt = { version: 1, custom: [{ name: 'x', primary: 'flare-gun', grenade: 'frag' }, null, null], selected: { kind: 'custom', slot: 0 } };
check('resolve refuses a hand-built prototype slot', resolveLoadout(handBuilt).primary === 'longhorn');

const store = loadLoadout({ getItem: () => null, setItem: () => {} });
const resolved = resolveLoadout(store);
check('default resolve keeps the default kit primary', resolved.primary === 'longhorn', resolved.primary);
check('default resolve issues the Duster sidearm', resolved.sidearm === 'duster');
check('respawn re-grant matches the resolved loadout', JSON.stringify(respawnLoadoutFor(store)) === JSON.stringify(resolved));

// The readiness projection a menu derives from — not a fourth weapon table.
const projection = rosterProjection();
check('projection covers all 20 designed weapons', projection.length === 20);
const protoRows = projection.filter((r) => r.readiness === 'prototype');
check('projection marks exactly the gated four prototype', JSON.stringify(protoRows.map((r) => r.id)) === JSON.stringify(PROTOTYPE_WEAPON_IDS));
check('every prototype row states non-empty reasons', protoRows.every((r) => r.gatedBecause.length > 0 && r.gatedBecause.every((s) => s.length > 0)));
check('playable rows carry no gate reasons', projection.filter((r) => r.readiness === 'playable').every((r) => r.gatedBecause.length === 0));
const original5 = EXPECTED_IDS.slice(0, 5);
check('art-debt flags: native five clean, borrowed rigs flagged', projection.every((r) => r.fallbackArt === !original5.includes(r.id)));
for (const w of ROSTER) {
  const t = weaponTraits(w);
  for (const v of Object.values(t)) check(`${w.id} trait bar in [1,5]`, v >= 1 && v <= 5, String(v));
}

// ---- 5. families and temporary fallbacks ----------------------------------------------------------
check('family table covers exactly the catalog ids', JSON.stringify(Object.keys(WEAPON_FAMILY).sort()) === JSON.stringify([...EXPECTED_IDS].sort()));
check('every fallback names a shipped rig', Object.values(FAMILY_FALLBACK).every((r) => ['rifle', 'smg', 'shotgun', 'sniper', 'pistol'].includes(r)));
check('every voice names a shipped shot family', Object.values(FAMILY_VOICE).every((v) => ['longhorn', 'rattler', 'coachman', 'deadeye', 'duster'].includes(v)));
const familyExpect = {
  longhorn: 'rifle', rattler: 'smg', coachman: 'shotgun', deadeye: 'sniper', duster: 'pistol',
  mp5: 'smg', 'mini-uzi': 'smg', 'machine-pistol': 'smg', m4a1: 'rifle', 'ak-47': 'rifle',
  lmg: 'lmg', minigun: 'lmg', 'm14-ebr': 'dmr', 'slug-shotgun': 'shotgun',
  magnum: 'pistol', 'flashlight-pistol': 'pistol', railgun: 'exotic',
  'explosive-crossbow': 'exotic', flamethrower: 'exotic', 'flare-gun': 'exotic',
};
for (const [id, fam] of Object.entries(familyExpect)) check(`family(${id}) = ${fam}`, weaponFamily(id) === fam);
check('gating and exotic family agree in both directions', ROSTER.every((w) => (PROTOTYPE_WEAPON_IDS.includes(w.id)) === (weaponFamily(w.id) === 'exotic')));

// ---- 6. fail-closed: prototypes behave like unknown ids on every live path --
// A menu that hides a prototype gates nothing alone: a forged wire claim or a
// direct catalog lookup must still refuse. Prototypes get no exotic mechanics;
// they are refused exactly where unknown ids are.
check('validPrimaryId refuses every prototype on the wire', PROTOTYPE_WEAPON_IDS.every((id) => validPrimaryId(id) === undefined));
check('validPrimaryId still admits a playable primary', validPrimaryId('m4a1') === 'm4a1');
check('prototype drops carry no rounds', PROTOTYPE_WEAPON_IDS.every((id) => fullRounds(id) === 0 && createDrop(1, 'x', id, 90, 0, 0, 0, 0).rounds === 0));
check('playable drops keep their full issue', fullRounds('longhorn') === 150);

// The real host, end to end: one actor, warmup ticked into active, one forged
// bullet per prototype plus one unknown id. Every one must read `malformed`;
// the rifle control on the same window must admit, proving the refusals
// poisoned nothing.
const world = { lineOfSight: () => true, groundY: () => 0, inBounds: () => true };
const host = new GameHost({ world, now: 0 });
host.addActor('shooter', 0);
host.tick(3100);
host.updatePose('shooter', 0, 0, 0, 3100);
const epoch = host.lifeOf('shooter') ?? 1;
let seq = 0;
const shot = (weaponId) => ({ type: 'shot', seq: seq++, life: epoch, weaponId, firedAt: 3100, ox: 0, oy: 0, oz: 0, dx: 1, dy: 0, dz: 0 });
for (const id of [...PROTOTYPE_WEAPON_IDS, 'not-a-gun']) {
  const r = host.submitShot('shooter', shot(id), 3100);
  check(`host refuses forged ${id} bullet as malformed`, r.accepted === false && r.reason === 'malformed', JSON.stringify(r));
}
const controlShot = host.submitShot('shooter', shot('longhorn'), 3100);
check('host still admits the playable control bullet', controlShot.accepted === true, JSON.stringify(controlShot));

// Second layer, direct: HostLife.hit with a prototype id moves no health and
// lands no hit, while the same call with a playable id does.
const duel = new HostLife({ world, deps: {}, rules: DEFAULT_RULES, bus: null });
const victim = duel.newActor('victim', 1, false, 0);
const attacker = duel.newActor('attacker', 0, false, 0);
duel.actors.set('victim', victim);
duel.actors.set('attacker', attacker);
duel.hit(victim, attacker, 'body', 10, 'railgun', 'bullet', 1, 0, 0);
check('prototype hit moves no health', victim.health.hp === 100, String(victim.health.hp));
check('prototype hit lands no hit', duel.stats.hitsLanded === 0 && !duel.pending.some((e) => e.type === 'damage'));
duel.hit(victim, attacker, 'body', 10, 'longhorn', 'bullet', 1, 0, 0);
check('playable hit still lands', duel.stats.hitsLanded === 1 && victim.health.hp < 100, `${duel.stats.hitsLanded} ${victim.health.hp}`);


// --------------------------------------------------------------------------------------------------
if (failures.length > 0) {
  console.error(`roster20 invariants FAILED (${failures.length}):`);
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`roster20 invariants PASS: 20 designed / ${playableWeapons().length} playable, original5 stable vs root-b015a59, ` +
  `${PRIMARY_IDS.length} primaries + ${SIDEARM_IDS.length} sidearms, gated {${PROTOTYPE_WEAPON_IDS.join(', ')}}, families complete.`);
