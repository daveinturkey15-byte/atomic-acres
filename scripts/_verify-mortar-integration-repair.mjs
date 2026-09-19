/**
 * _verify-mortar-integration-repair — bounded repair proof, source-only.
 *
 * Covers the five root review defects against the REAL modules (esbuild bundle,
 * node, no browser/GPU): event-clock endsAt mapping with positive/negative and
 * +240000 offsets, MortarView FIFO wrap + every-expired-entry expiry with
 * staggered deadlines, MortarFx release-exactly-once through the real module,
 * the corrected audio/draw budget, and telegraph-before-impact with untouched
 * authority/damage semantics. Exits 1 with the failed check names. Writes
 * `captures/mortar-integration-repair-<tag>.json`.
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

// Kept as one string array so the verifier is ONE file. No template literals inside.
const ENTRY = [
  "import { createMortar, stepMortar, MORTAR_DAMAGE, MORTAR_IMPACTS, MAX_MORTAR_IMPACTS_PER_STEP } from '../src/game/killstreaks/effects/mortar';",
  "import { MortarView, MORTAR_MAX_TELEGRAPHS, MORTAR_MAX_IMPACTS, MORTAR_DUST_MS, MORTAR_TELEGRAPH_GRACE_MS } from '../src/game/killstreaks/effects/mortar-view';",
  "import { drainMortarAudio } from '../src/game/killstreaks/effects/mortar-audio';",
  "import { MortarFx, MORTAR_TELEGRAPH_MESHES, MORTAR_DUST_MESHES } from '../src/weapons/mortar-fx';",
  "import { localizeGameEvent, hostTimeToGuest } from '../src/net/event-clock';",
  "import * as THREE from 'three';",
  "",
  "function tele(instanceId: number, at: number, endsAt: number): any {",
  "  return { type: 'mortar-telegraph', at, instanceId, actorId: 'a', team: 0, streakId: 'blast-mortar', x: 1, y: 0, z: 2, radius: 8, impacts: 20, endsAt };",
  "}",
  "function impact(instanceId: number, at: number, index: number, x: number): any {",
  "  return { type: 'mortar-impact', at, instanceId, actorId: 'a', team: 0, streakId: 'blast-mortar', index, x, y: 0, z: 0, victims: 0 };",
  "}",
  "function stubMat(collected: any[]) {",
  "  return {",
  "    emissive: (..._a: any[]) => { const m: any = new THREE.MeshBasicMaterial(); collected.push(m); return m; },",
  "    painted: (..._a: any[]) => { const m: any = new THREE.MeshBasicMaterial(); collected.push(m); return m; },",
  "  };",
  "}",
  "export function run() {",
  "  const fails: string[] = [];",
  "  let checks = 0;",
  "  const check = (name: string, cond: boolean) => { checks += 1; if (!cond) fails.push(name); };",
  "  // A. Clock: endsAt maps host->guest, remaining duration preserved.",
  "  const t0: any = tele(1, 10000, 25000);",
  "  const pos: any = localizeGameEvent(t0, 1500);",
  "  check('positive offset shifts at and endsAt', pos.at === 8500 && (pos as any).endsAt === 23500);",
  "  check('positive offset preserves remaining', (pos as any).endsAt - pos.at === 15000);",
  "  const neg: any = localizeGameEvent(t0, -800);",
  "  check('negative offset shifts at and endsAt', neg.at === 10800 && (neg as any).endsAt === 25800);",
  "  check('negative offset preserves remaining', (neg as any).endsAt - neg.at === 15000);",
  "  const big: any = localizeGameEvent(t0, 240000);",
  "  check('240s offset shifts at and endsAt', big.at === 10000 - 240000 && (big as any).endsAt === 25000 - 240000);",
  "  check('240s offset preserves remaining', (big as any).endsAt - big.at === 15000);",
  "  const nan: any = localizeGameEvent(t0, NaN);",
  "  check('non-finite offset fails safe', nan.at === 10000 && (nan as any).endsAt === 25000);",
  "  check('hostTimeToGuest passthrough on NaN offset', hostTimeToGuest(5000, NaN) === 5000);",
  "  const spawn: any = localizeGameEvent({ type: 'spawn', at: 9000, actorId: 'a', team: 0, protectedUntil: 12000 } as any, 1500);",
  "  check('spawn clock untouched', spawn.at === 7500 && spawn.protectedUntil === 10500);",
  "  const phase: any = localizeGameEvent({ type: 'match-phase', at: 9000, phase: 'live', endsAt: 60000 } as any, 1500);",
  "  check('match-phase clock untouched', phase.at === 7500 && phase.endsAt === 58500);",
  "  // B. View: FIFO wrap keeps the latest seqs, expiry removes every stale entry.",
  "  const v = new MortarView();",
  "  for (let k = 0; k < 40; k++) v.apply(impact(3, 2000 + k, k % 20, k));",
  "  check('wrap holds eight with seq forty', v.impacts.length === MORTAR_MAX_IMPACTS && v.impactSeq === 40);",
  "  check('wrap keeps the latest eight seqs', v.impacts.map((i) => i.seq).join(',') === '33,34,35,36,37,38,39,40');",
  "  const w = new MortarView();",
  "  for (let k = 0; k < 8; k++) w.apply(impact(5, k * 1000, k, k));",
  "  w.expire(8000);",
  "  check('staggered expiry keeps only fresh dust', w.impacts.length === 4 && w.impacts.every((i) => 8000 - i.at <= MORTAR_DUST_MS));",
  "  check('seq stable across expire', w.impactSeq === 8);",
  "  const o = new MortarView();",
  "  o.apply(impact(6, 9000, 0, 1));",
  "  o.apply(impact(6, 0, 1, 2));",
  "  o.expire(10000);",
  "  check('stale behind a fresh head still expires', o.impacts.length === 1 && o.impacts[0].at === 9000);",
  "  const g = new MortarView();",
  "  g.apply(tele(9, 10000, 25000));",
  "  g.expire(25000 + MORTAR_TELEGRAPH_GRACE_MS + 1);",
  "  check('localized endsAt plus grace retires the disc', g.telegraphs.length === 0);",
  "  const g2 = new MortarView();",
  "  g2.apply(tele(9, 10000, 25000));",
  "  g2.expire(25000 + MORTAR_TELEGRAPH_GRACE_MS - 10);",
  "  check('disc survives inside grace', g2.telegraphs.length === 1);",
  "  // C. Fx: the real module, release exactly once, resync never replays.",
  "  const mats: any[] = [];",
  "  const fx = new MortarFx(stubMat(mats) as any);",
  "  const fv = new MortarView();",
  "  fv.apply(tele(11, 1000, 30000));",
  "  fv.apply(impact(11, 2000, 0, 3));",
  "  fv.apply(impact(11, 2750, 1, 6));",
  "  let flashes = 0;",
  "  fx.update(3000, fv, () => { flashes += 1; });",
  "  check('disc plus two rings draw', (fx as any).group.children.filter((m: any) => m.visible).length === 3 && flashes === 2);",
  "  fx.update(3100, fv, () => { flashes += 1; });",
  "  check('same view flashes nothing twice', flashes === 2);",
  "  fx.reset((fv as any).impactSeq);",
  "  fx.update(3200, fv, () => { flashes += 1; });",
  "  check('synced resync never replays', flashes === 2);",
  "  let teleDisposes = 0; let dustDisposes = 0; let matDisposes = 0;",
  "  const tg: any = (fx as any).teleGeo; const dg: any = (fx as any).dustGeo;",
  "  const t0d = tg.dispose.bind(tg); const d0d = dg.dispose.bind(dg);",
  "  tg.dispose = () => { teleDisposes += 1; return t0d(); };",
  "  dg.dispose = () => { dustDisposes += 1; return d0d(); };",
  "  for (const m of mats) { const d = m.dispose.bind(m); m.dispose = () => { matDisposes += 1; return d(); }; }",
  "  fx.release(); fx.release(); fx.release();",
  "  check('repeated release disposes each geometry once', teleDisposes === 1 && dustDisposes === 1);",
  "  check('singleton materials never disposed', matDisposes === 0);",
  "  // D. Budget: real caps, at-most-once under the voice cap.",
  "  check('mesh constants equal view caps', MORTAR_TELEGRAPH_MESHES === MORTAR_MAX_TELEGRAPHS && MORTAR_DUST_MESHES === MORTAR_MAX_IMPACTS);",
  "  check('worst case twelve meshes', MORTAR_TELEGRAPH_MESHES + MORTAR_DUST_MESHES === 12);",
  "  const av = new MortarView();",
  "  av.apply(tele(21, 1000, 30000));",
  "  for (let k = 0; k < 20; k++) av.apply(impact(21, 2000 + k, k, k));",
  "  const heard: number[] = [];",
  "  const played = drainMortarAudio(av, { x: 0, y: 0, z: 0 }, { impact: (d: number) => { heard.push(d); } });",
  "  check('full tube drains at most eight voices', played <= 8 && heard.length === played);",
  "  check('drain is at-most-once', drainMortarAudio(av, { x: 0, y: 0, z: 0 }, { impact: (d: number) => { heard.push(d); } }) === 0 && heard.length === played);",
  "  check('host step cap intact', MAX_MORTAR_IMPACTS_PER_STEP === 4);",
  "  // E. Authority: warning first, silence on probe, damage untouched.",
  "  const anchor = { x: 5, y: 0, z: -3 };",
  "  const m0 = createMortar(1, 'a', 0, 'blast-mortar', 15000, anchor, 1234);",
  "  const first = stepMortar(m0, 50, { now: 9000, targets: [] });",
  "  const firstKinds = first.events.map((e) => e.type);",
  "  check('warning fires on the first stepped tick', firstKinds.indexOf('mortar-telegraph') !== -1);",
  "  const second = stepMortar(first.state, 750, { now: 9050, targets: [] });",
  "  const stream = first.events.concat(second.events).map((e) => e.type);",
  "  check('telegraph visibly precedes first impact', stream.indexOf('mortar-telegraph') !== -1 && stream.indexOf('mortar-impact') !== -1 && stream.indexOf('mortar-telegraph') < stream.indexOf('mortar-impact'));",
  "  const probe = stepMortar(m0, 0, { now: 9000, targets: [] });",
  "  check('zero-dt probe stays silent', probe.events.length === 0);",
  "  const m1 = createMortar(2, 'a', 0, 'blast-mortar', 15000, { x: 0, y: 0, z: 0 }, 77);",
  "  const t2 = stepMortar(m1, 750, { now: 9000, targets: [{ id: 'v', team: 1, alive: true, health: 100, x: 0, y: 0, z: 0 } as any] });",
  "  const dmg = t2.events.filter((e) => e.type === 'damage') as any[];",
  "  check('damage still flat thirty-five streak splash', dmg.length >= 1 && dmg.every((d) => d.amount === MORTAR_DAMAGE && d.cause === 'streak' && d.zone === 'body' && d.weaponId === ''));",
  "  check('tube still schedules twenty', MORTAR_IMPACTS === 20);",
  "  return { checks, fails };",
  "}",
].join('\n');

const outfile = join(tmpdir(), 'aa-mortar-repair-' + process.pid + '.mjs');
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

console.log('[mortar-integration-repair] ' + r.checks + ' checks over the real mortar modules');
mkdirSync(join(ROOT, 'captures'), { recursive: true });
writeFileSync(join(ROOT, 'captures', 'mortar-integration-repair-' + TAG + '.json'),
  JSON.stringify({ tag: TAG, ...r }, null, 2));

if (r.fails.length) {
  console.error('[mortar-integration-repair] FAILS: ' + r.fails.join(', '));
  process.exit(1);
}
console.log('[mortar-integration-repair] HOLDS: clock, wrap, expiry, release-once, budget, warning-first');
