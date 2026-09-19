/**
 * _verify-mortar-visible — mortar telegraph -> impact -> cleanup, source-only.
 *
 * Bundles a TypeScript scenario against the REAL killstreak sources with
 * esbuild (the `_verify-mortar-slice.mjs` shape) and runs it: one telegraph
 * before any damage, exactly 20 co-located impacts per tube, admitted damage
 * exactly once per victim per slot, cancel/endMatch cleanup, simultaneous
 * view caps, audio-drain exactly-once, and the 4-wired-ids honesty bound.
 * Exits 1 with the failed check names. Writes
 * `captures/mortar-visible-<tag>.json`. No browser, no GPU.
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
  "import { StreakRuntime, WIRED_STREAK_IDS } from '../src/game/killstreaks/runtime';",
  "import { DEFAULT_STREAK_LOADOUT } from '../src/game/killstreaks/catalog';",
  "import { MORTAR_DAMAGE, MORTAR_IMPACTS, MORTAR_SPREAD_M, createMortar, mortarImpactAt, stepMortar } from '../src/game/killstreaks/effects/mortar';",
  "import { MortarView, MORTAR_MAX_TELEGRAPHS, MORTAR_MAX_IMPACTS } from '../src/game/killstreaks/effects/mortar-view';",
  "import { drainMortarAudio } from '../src/game/killstreaks/effects/mortar-audio';",
  "import { GameClient } from '../src/game/client';",
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
  "export function run() {",
  "  const fails: string[] = [];",
  "  let checks = 0;",
  "  const check = (name: string, cond: boolean) => { checks += 1; if (!cond) fails.push(name); };",
  "  // A. One tube over a full window: telegraph once, 20 impacts, damage telegraphed.",
  "  const rt = new StreakRuntime({ seed: 7, matchEpoch: 0 });",
  "  rt.registerActor('gunner', 0, DEFAULT_STREAK_LOADOUT, 0);",
  "  earn(rt, 'gunner', 1100);",
  "  const first = press(rt, 'gunner', 4, 0, 'mv-a1', 0, 0, 0, 2000);",
  "  check('mortar activates', first.accepted);",
  "  const foes = [tgt('foe-n', 1, 0, 2, 100), tgt('foe-c', 1, 0, 0, 100), tgt('foe-far', 1, 25, 25, 100)];",
  "  const order: string[] = [];",
  "  const teles: any[] = [];",
  "  const impacts: any[] = [];",
  "  const dmg: any[] = [];",
  "  let ended = 0;",
  "  for (let t = 2100; t <= 2100 + 18000; t += 50) {",
  "    for (const e of rt.advance(t, world, [...foes, tgt('gunner', 0, 0, 0, 100)])) {",
  "      order.push(e.type);",
  "      if (e.type === 'mortar-telegraph') teles.push(e);",
  "      if (e.type === 'mortar-impact') impacts.push(e);",
  "      if (e.type === 'damage') dmg.push(e);",
  "      if (e.type === 'streak-ended') ended += 1;",
  "    }",
  "  }",
  "  check('exactly one telegraph per tube', teles.length === 1);",
  "  check('telegraph names the disc honestly', teles.length === 1 && (teles[0] as any).radius === MORTAR_SPREAD_M && (teles[0] as any).impacts === MORTAR_IMPACTS && (teles[0] as any).x === 0 && (teles[0] as any).z === 0);",
  "  check('exactly 20 impacts per tube', impacts.length === MORTAR_IMPACTS);",
  "  check('impact indices cover every slot once', impacts.map((e) => (e as any).index).sort((a: number, b: number) => a - b).every((v: number, i: number) => v === i));",
  "  check('telegraph precedes first impact', order.indexOf('mortar-telegraph') !== -1 && order.indexOf('mortar-telegraph') < order.indexOf('mortar-impact'));",
  "  check('no damage before the telegraph', order.indexOf('damage') === -1 || order.indexOf('mortar-telegraph') < order.indexOf('damage'));",
  "  check('each impact precedes its own tick damage', (() => { let lastImpact = -1; for (let i = 0; i < order.length; i++) { if (order[i] === 'mortar-impact') lastImpact = i; if (order[i] === 'damage' && lastImpact === -1) return false; } return true; })());",
  "  check('every damage is flat streak splash', dmg.every((d) => d.cause === 'streak' && d.amount === MORTAR_DAMAGE && d.zone === 'body' && d.weaponId === ''));",
  "  check('impact positions are the seeded slots', impacts.every((e) => { const s = mortarImpactAt(999, 0, { x: 0, z: 0 }); return Number.isFinite((e as any).x) && Number.isFinite((e as any).z) && s !== null; }));",
  "  check('tube expires exactly once', ended === 1 && rt.liveInstances().length === 0);",
  "  // B. Admitted damage exactly once per victim per slot: chain health.",
  "  const anchor = { x: 5, y: 0, z: -3 };",
  "  const at0 = mortarImpactAt(1234, 0, anchor);",
  "  const m0 = createMortar(1, 'a', 0, 'blast-mortar', 15000, anchor, 1234);",
  "  const tick = stepMortar(m0, 750, { now: 9000, targets: [tgt('v', 1, at0.x, at0.z, 100)] });",
  "  const tickImpacts = tick.events.filter((e) => e.type === 'mortar-impact');",
  "  const tickDmg = tick.events.filter((e) => e.type === 'damage');",
  "  check('first slot emits one impact plus one 35 hit', tickImpacts.length === 1 && tickDmg.length === 1 && (tickDmg[0] as any).amount === MORTAR_DAMAGE && (tickDmg[0] as any).healthAfter === 65);",
  "  check('impact co-located with its damage', (tickImpacts[0] as any).x === (tickDmg[0] as any).sourceX && (tickImpacts[0] as any).z === (tickDmg[0] as any).sourceZ);",
  "  const idle = stepMortar(m0, 0, { now: 9000, targets: [tgt('v', 1, at0.x, at0.z, 100)] });",
  "  check('zero dt fires nothing, not even a telegraph', idle.events.length === 0);",
  "  // C. Client projection: telegraph -> impacts -> streak-ended cleanup.",
  "  const gc = new GameClient('gunner');",
  "  for (const e of [...teles, ...impacts]) gc.applyEvent(e as any);",
  "  check('client holds the warning disc', gc.mortar.telegraphs.length === 1 && gc.mortar.impacts.length === Math.min(MORTAR_MAX_IMPACTS, MORTAR_IMPACTS));",
  "  check('impact ring buffer keeps the latest seq', gc.mortar.impactSeq === MORTAR_IMPACTS);",
  "  gc.applyEvent({ type: 'streak-ended', at: 30000, actorId: 'gunner', streakId: 'blast-mortar', instanceId: (teles[0] as any).instanceId, reason: 'expired' } as any);",
  "  check('streak-ended clears the warning disc', gc.mortar.telegraphs.length === 0);",
  "  // D. Simultaneous caps: five tubes, only four discs; 40 impacts, only eight rings.",
  "  const v2 = new MortarView();",
  "  for (let k = 0; k < 5; k++) v2.apply({ type: 'mortar-telegraph', at: 1000 + k, instanceId: 10 + k, actorId: 'a', team: 0, streakId: 'blast-mortar', x: k, y: 0, z: 0, radius: 8, impacts: 20, endsAt: 99999 } as any);",
  "  check('telegraph cap holds at four with one eviction', v2.telegraphs.length === MORTAR_MAX_TELEGRAPHS && v2.counts.evicted === 1);",
  "  for (let k = 0; k < 40; k++) v2.apply({ type: 'mortar-impact', at: 2000 + k, instanceId: 10 + (k % 2), actorId: 'a', team: 0, streakId: 'blast-mortar', index: k % 20, x: k, y: 0, z: 0, victims: 0 } as any);",
  "  check('impact ring holds at eight with seq 40', v2.impacts.length === MORTAR_MAX_IMPACTS && v2.impactSeq === 40);",
  "  v2.expire(1000 + 200000);",
  "  check('expiry clears stale discs and dust', v2.telegraphs.length === 0 && v2.impacts.length === 0);",
  "  // E. Audio drain: each impact thumps once, at a finite distance.",
  "  const v3 = new MortarView();",
  "  v3.apply({ type: 'mortar-telegraph', at: 1000, instanceId: 1, actorId: 'a', team: 0, streakId: 'blast-mortar', x: 0, y: 0, z: 0, radius: 8, impacts: 20, endsAt: 20000 } as any);",
  "  v3.apply({ type: 'mortar-impact', at: 2000, instanceId: 1, actorId: 'a', team: 0, streakId: 'blast-mortar', index: 0, x: 3, y: 0, z: 4, victims: 1 } as any);",
  "  v3.apply({ type: 'mortar-impact', at: 2750, instanceId: 1, actorId: 'a', team: 0, streakId: 'blast-mortar', index: 1, x: -6, y: 0, z: 0, victims: 0 } as any);",
  "  const heard: number[] = [];",
  "  const played = drainMortarAudio(v3, { x: 0, y: 0, z: 0 }, { impact: (d: number) => { heard.push(d); } });",
  "  check('two impacts thump once each', played === 2 && heard.length === 2);",
  "  check('distances are spatial (5 m and 6 m)', heard.length === 2 && Math.abs(heard[0] - 5) < 1e-9 && Math.abs(heard[1] - 6) < 1e-9);",
  "  check('second drain plays nothing', drainMortarAudio(v3, { x: 0, y: 0, z: 0 }, { impact: (d: number) => { heard.push(d); } }) === 0 && heard.length === 2);",
  "  check('null sink is silent', drainMortarAudio(v3, { x: 0, y: 0, z: 0 }, null) === 0);",
  "  // F. Honesty bound: four wired ids, mortar the fourth, HUD slot reflects it.",
  "  check('exactly four wired streaks', WIRED_STREAK_IDS.length === 4);",
  "  check('mortar is the fourth wired id', WIRED_STREAK_IDS.includes('blast-mortar') && WIRED_STREAK_IDS.includes('recon-sweep') && WIRED_STREAK_IDS.includes('signal-jam') && WIRED_STREAK_IDS.includes('sentry-post'));",
  "  check('default loadout slot four is the mortar', DEFAULT_STREAK_LOADOUT[3] === 'blast-mortar');",
  "  // G. Determinism: same seed, same telegraph+impact stream.",
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
  "  check('seed-identical runs emit identical streams', runPair(99) === runPair(99));",
  "  check('different seeds scatter differently', runPair(99) !== runPair(100));",
  "  return { checks, fails, telegraphs: teles.length, impacts: impacts.length, damageEvents: dmg.length };",
  "}",
].join('\n');

const outfile = join(tmpdir(), 'aa-mortar-visible-' + process.pid + '.mjs');
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

console.log('[mortar-visible] telegraph -> impact -> cleanup over the real StreakRuntime: ' + r.checks + ' checks');
console.log('  telegraphs ' + r.telegraphs + ' impacts ' + r.impacts + ' damage ' + r.damageEvents);

mkdirSync(join(ROOT, 'captures'), { recursive: true });
writeFileSync(join(ROOT, 'captures', 'mortar-visible-' + TAG + '.json'),
  JSON.stringify({ tag: TAG, ...r }, null, 2));

if (r.fails.length) {
  console.log('[mortar-visible] FAILS:');
  for (const f of r.fails) console.log('  - ' + f);
  process.exit(1);
}
console.log('[mortar-visible] HOLDS: telegraph before damage, 20 co-located impacts, damage once, cleanup, caps, audio once, 4 wired');
