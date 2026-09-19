/**
 * _verify-mortar-slice — blast-mortar acceptance, source-only, no browser.
 *
 * Bundles a TypeScript scenario against the REAL killstreak sources with
 * esbuild (the `_verify-streak-reject.mjs` shape) and runs it: eligibility,
 * cost, duplicate activation, placement-before-spend, expiration, death /
 * disconnect / endMatch lifecycle, determinism, and exact single-impact
 * accounting. exits 1 with the failed check names. Writes
 * `captures/mortar-slice-<tag>.json`.
 */
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const TAG = opt('tag', 'run');

// The scenario, in TypeScript, compiled against the real sources. Kept as a
// string so the whole verifier is ONE file and nothing stale can be left on
// disk beside it. No template literals inside — this is one.
const ENTRY = [
  "import { StreakRuntime } from '../src/game/killstreaks/runtime';",
  "import { DEFAULT_STREAK_LOADOUT } from '../src/game/killstreaks/catalog';",
  "import { MORTAR_DAMAGE, MORTAR_IMPACTS, createMortar, mortarImpactAt, mortarProgress, stepMortar } from '../src/game/killstreaks/effects/mortar';",
  "",
  "const world = {",
  "  inBounds: (x: number, z: number) => x >= -30 && x <= 30 && z >= -30 && z <= 30,",
  "  groundY: (_x: number, _z: number) => 0,",
  "  lineOfSight: () => true,",
  "};",
  "type Ctx = { alive: boolean; matchPhase: 'active'; arenaSupported: boolean; inputEnabled: boolean; menuOpen: boolean; targetingOpen: boolean; possessionActive: boolean };",
  "const CTX: Ctx = { alive: true, matchPhase: 'active', arenaSupported: true, inputEnabled: true, menuOpen: false, targetingOpen: false, possessionActive: false };",
  "function press(rt: StreakRuntime, actor: string, slot: number, seq: number, claim: string, life: number, ax: number, az: number, at: number) {",
  "  return rt.activate({ actorId: actor, slot, seq, claimId: claim, life, matchEpoch: 0, toggle: false, origin: { x: 0, y: 0, z: 0 }, aimYaw: 0, anchor: { x: ax, y: 0, z: az }, context: CTX }, at, world);",
  "}",
  "function earn(rt: StreakRuntime, actor: string, at: number) {",
  "  for (let k = 1; k <= 8; k++) rt.recordElimination(actor, k, at + k);",
  "}",
  "function tgt(id: string, team: 0 | 1, x: number, z: number, health: number) {",
  "  return { id, team, alive: true, health, x, y: 0, z };",
  "}",
  "function slotCharges(rt: StreakRuntime, actor: string, slot: number): number {",
  "  return rt.snapshotFor(actor).find((s) => s.slot === slot)?.charges ?? -1;",
  "}",
  "export function run() {",
  "  const fails: string[] = [];",
  "  let checks = 0;",
  "  const check = (name: string, cond: boolean) => { checks += 1; if (!cond) fails.push(name); };",
  "  const dmg: any[] = [];",
  "  let endedExpired = 0;",
  "  // A. Eligibility, cost, duplicates on one runtime.",
  "  const rt = new StreakRuntime({ seed: 7, matchEpoch: 0 });",
  "  rt.registerActor('gunner', 0, DEFAULT_STREAK_LOADOUT, 0);",
  "  const fresh = press(rt, 'gunner', 4, 0, 'm-a0', 0, 0, 0, 1000);",
  "  check('unearned mortar press is denied not-earned', !fresh.accepted && fresh.outcome === 'denied' && (fresh as any).reason === 'not-earned');",
  "  earn(rt, 'gunner', 1100);",
  "  const first = press(rt, 'gunner', 4, 0, 'm-a1', 0, 0, 0, 2000);",
  "  check('earned mortar activates with streak-activated event', first.accepted && (first as any).streakId === 'blast-mortar' && first.events[0].type === 'streak-activated' && (first as any).chargesLeft === 0);",
  "  const live = rt.liveInstances();",
  "  check('live projection names the mortar', live.length === 1 && live[0].kind === 'mortar' && (live[0] as any).streakId === 'blast-mortar');",
  "  const dupClaim = press(rt, 'gunner', 4, 1, 'm-a1', 0, 0, 0, 2100);",
  "  check('same claim id is rejected duplicate-claim', !dupClaim.accepted && dupClaim.outcome === 'rejected' && (dupClaim as any).reason === 'duplicate-claim');",
  "  const dupSeq = press(rt, 'gunner', 4, 0, 'm-a2', 0, 0, 0, 2200);",
  "  check('replayed sequence is rejected even with no charges left', !dupSeq.accepted && dupSeq.outcome === 'rejected' && (dupSeq as any).reason === 'replayed-sequence');",
  "  check('charge moved exactly once', slotCharges(rt, 'gunner', 4) === 0);",
  "",
  "  // B. Placement resolves before the spend (Rule 5): blocked anchor keeps",
  "  // the charge, and the SAME claim retries exactly.",
  "  earn(rt, 'gunner', 2300);",
  "  const blocked = press(rt, 'gunner', 4, 1, 'm-a3', 0, 1000, 1000, 2400);",
  "  check('out-of-bounds anchor is rejected no-placement', !blocked.accepted && blocked.outcome === 'rejected' && (blocked as any).reason === 'no-placement');",
  "  check('blocked placement spends nothing', slotCharges(rt, 'gunner', 4) === 1);",
  "  const retry = press(rt, 'gunner', 4, 1, 'm-a3', 0, 0, 0, 2500);",
  "  check('same claim retries exactly once placed', retry.accepted && (retry as any).chargesLeft === 0);",
  "",
  "  // C. Full-window run: expiry, selectivity, progress, no friendly fire.",
  "  const foes = [tgt('foe-n', 1, 0, 2, 100), tgt('foe-s', 1, 0, -2, 100), tgt('foe-e', 1, 2, 0, 100), tgt('foe-w', 1, -2, 0, 100), tgt('foe-c', 1, 0, 0, 100), tgt('foe-far', 1, 25, 25, 100)];",
  "  const friendlies = [tgt('gunner', 0, 0, 0, 100), tgt('mate', 0, 2, 2, 100)];",
  "  for (let t = 2600; t <= 2600 + 18000; t += 50) {",
  "    for (const e of rt.advance(t, world, [...foes, ...friendlies])) {",
  "      if (e.type === 'damage') dmg.push(e);",
  "      if (e.type === 'streak-ended' && (e as any).reason === 'expired' && (e as any).streakId === 'blast-mortar') endedExpired += 1;",
  "    }",
  "  }",
  "  check('both mortars expire with streak-ended', endedExpired === 2 && rt.liveInstances().length === 0);",
  "  check('mortar damaged somebody (non-vacuous)', dmg.length > 0);",
  "  check('every mortar hit is flat streak splash on a hostile', dmg.every((d) => d.cause === 'streak' && d.amount === MORTAR_DAMAGE && d.zone === 'body' && d.weaponId === '' && d.victimTeam === 1));",
  "  check('owner and teammate never hit', dmg.every((d) => d.victimId !== 'gunner' && d.victimId !== 'mate'));",
  "  check('far foe outside every disc never hit', dmg.every((d) => d.victimId !== 'foe-far'));",
  "  check('healthAfter chains are sane', dmg.every((d) => d.healthAfter >= 0 && d.healthAfter <= 100));",
  "",
  "  // D. Death, disconnect, match end on a second runtime.",
  "  const rt2 = new StreakRuntime({ seed: 7, matchEpoch: 0 });",
  "  rt2.registerActor('trooper', 0, DEFAULT_STREAK_LOADOUT, 0);",
  "  earn(rt2, 'trooper', 1000);",
  "  rt2.recordDeath('trooper', 1200);",
  "  check('death keeps the bank', slotCharges(rt2, 'trooper', 4) === 1);",
  "  rt2.recordDisconnect('trooper', 1300);",
  "  check('disconnect keeps the bank', slotCharges(rt2, 'trooper', 4) === 1);",
  "  const afterDeath = press(rt2, 'trooper', 4, 0, 'm-d1', 1, 0, 0, 1400);",
  "  check('post-death press needs the new life epoch', afterDeath.accepted);",
  "  const staleLife = press(rt2, 'trooper', 4, 1, 'm-d2', 0, 0, 0, 1500);",
  "  check('stale life epoch is rejected', !staleLife.accepted && staleLife.outcome === 'rejected' && (staleLife as any).reason === 'life-epoch');",
  "  rt2.recordDeath('trooper', 1600);",
  "  const deathTs = [tgt('victim', 1, 0, 0, 100), tgt('ring1', 1, 2, 0, 100), tgt('ring2', 1, -2, 0, 100), tgt('trooper', 0, 0, 0, 100)];",
  "  let firedAfterDeath = false;",
  "  for (let t = 1650; t <= 8000; t += 100) {",
  "    if (rt2.advance(t, world, deathTs).some((e) => e.type === 'damage')) firedAfterDeath = true;",
  "  }",
  "  check('paid-for mortar keeps firing after owner death', firedAfterDeath);",
  "  const end = rt2.endMatch(9000);",
  "  check('endMatch retires live mortar as match-end', end.length === 1 && end[0].type === 'streak-ended' && (end[0] as any).reason === 'match-end' && rt2.liveInstances().length === 0);",
  "",
  "  // E. Determinism: same seed, same claims, same steps, same events.",
  "  const runPair = (seed: number) => {",
  "    const r = new StreakRuntime({ seed, matchEpoch: 0 });",
  "    r.registerActor('a', 0, DEFAULT_STREAK_LOADOUT, 0);",
  "    earn(r, 'a', 500);",
  "    press(r, 'a', 4, 0, 'det-0', 0, 4, -4, 1000);",
  "    const out: unknown[] = [];",
  "    const ts = [tgt('e1', 1, 4, -4, 100), tgt('e2', 1, 6, -2, 100)];",
  "    for (let t = 1100; t <= 1100 + 16000; t += 100) out.push(...r.advance(t, world, ts));",
  "    return JSON.stringify(out);",
  "  };",
  "  check('seed-identical runs emit identical events', runPair(99) === runPair(99));",
  "  check('different seeds scatter differently', runPair(99) !== runPair(100));",
  "",
  "  // F. Exact single-impact accounting at unit level.",
  "  const anchor = { x: 5, y: 0, z: -3 };",
  "  const m0 = createMortar(1, 'a', 0, 'blast-mortar', 15000, anchor, 1234);",
  "  const at0 = mortarImpactAt(1234, 0, anchor);",
  "  const tick = stepMortar(m0, 750, { now: 9000, targets: [tgt('v', 1, at0.x, at0.z, 100)] });",
  "  const tickDmg = tick.events.filter((e: any) => e.type === 'damage');",
  "  const tickTele = tick.events.filter((e: any) => e.type === 'mortar-telegraph');",
  "  const tickImp = tick.events.filter((e: any) => e.type === 'mortar-impact');",
  "  check('first due impact fires exactly one hit', tickDmg.length === 1 && tickTele.length === 1 && tickImp.length === 1);",
  "  const h = tickDmg[0] as any;",
  "  check('hit carries streak accounting', h.amount === MORTAR_DAMAGE && h.healthAfter === 100 - MORTAR_DAMAGE && h.cause === 'streak' && h.zone === 'body' && h.sourceX === at0.x && h.sourceZ === at0.z);",
  "  check('fired counter advances by one', (tick.state as any).fired === 1);",
  "  const idle = stepMortar(m0, 0, { now: 9000, targets: [tgt('v', 1, at0.x, at0.z, 100)] });",
  "  check('zero dt fires nothing', idle.events.length === 0 && (idle.state as any).fired === 0);",
  "  // Full schedule at unit level: empty targets, so every slot must still",
  "  // fire exactly once over the window. The runtime retires the tube on the",
  "  // same step the 20th impact fires, so post-advance sampling can never",
  "  // observe fired == 20 live — the returned tick state here can.",
  "  let mu: any = createMortar(2, 'a', 0, 'blast-mortar', 15000, anchor, 77);",
  "  let lastP = 0;",
  "  let dips = 0;",
  "  check('fresh tube projects zero progress', mortarProgress(mu) === 0);",
  "  for (let s = 0; s < 80; s++) {",
  "    const tk = stepMortar(mu, 250, { now: 10000 + s * 250, targets: [] });",
  "    mu = tk.state;",
  "    const p = mortarProgress(mu);",
  "    if (p < lastP - 1e-9) dips += 1;",
  "    lastP = p;",
  "  }",
  "  check('all 20 schedule slots fire over one window', mu.fired === MORTAR_IMPACTS && mu.remainingMs <= 0);",
  "  check('progress runs monotone 0 to 1', dips === 0 && lastP === 1);",
  "",
  "  return { checks, fails, damageEvents: dmg.length, endedExpired };",
  "}",
].join('\n');

const outfile = join(tmpdir(), 'aa-mortar-slice-' + process.pid + '.mjs');
await build({
  stdin: { contents: ENTRY, resolveDir: HERE, sourcefile: 'scenario.ts', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  logLevel: 'warning',
});

const scenario = await import(pathToFileURL(outfile).href);
const r = scenario.run();

console.log('[mortar-slice] blast-mortar over the real StreakRuntime: ' + r.checks + ' checks');
console.log('  damage events in full-window run  ' + r.damageEvents);
console.log('  mortars retired expired           ' + r.endedExpired);

mkdirSync(join(ROOT, 'captures'), { recursive: true });
writeFileSync(join(ROOT, 'captures', 'mortar-slice-' + TAG + '.json'),
  JSON.stringify({ tag: TAG, ...r }, null, 2));

if (r.fails.length) {
  console.log('[mortar-slice] REFUTED:\n  - ' + r.fails.join('\n  - '));
  process.exit(1);
}
console.log('[mortar-slice] HOLDS: eligibility, cost, duplicates, placement, expiry, lifecycle, determinism');
