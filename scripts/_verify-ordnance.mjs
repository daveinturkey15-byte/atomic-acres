/**
 * _verify-ordnance — the ordnance lane's deterministic, headless, browser-free
 * proof. Bundles `_verify-ordnance.scenario.ts` with esbuild (a vite
 * dependency; no install) against the REAL `src/game/` modules and runs five
 * scenarios on a synthetic clock in node, the way `_verify-streak-reject.mjs`
 * does.
 *
 * What it asserts (exit 1 on any failure):
 *   frag    2 m lethal · 14 m minimal · behind a wall none · team-mate none
 *           (friendlyFire off) · self-damage applies · kill credited · blast smoke
 *   flash   facing within 30° with LOS full white-out · facing away half ·
 *           behind a wall none · a flashed bot senses nothing until it ends
 *   smoke   one 5 m volume · losBlockedBySmoke true through the centre, false
 *           along the tangent · a bot has no visible target through it ·
 *           smoke-volume-end on the bus and sight returns
 *   knife   1.5 m one-hit kill · 1.8 m miss · replayed claim refused
 *           `duplicate` · second swing inside 0.8 s refused `melee-cooldown`
 *   drops   every corpse drops its primary with its rounds · cap 12, oldest
 *           culled · swap at 2.3 m takes theirs and leaves ours · 2.4 m refused
 *           `too-far` · scavenge 1.1 m nothing / 1.0 m the rounds fired ·
 *           grenades replenished from a pouch · 30 s expiry with a reason
 *
 *   node scripts/_verify-ordnance.mjs            # all five
 *   node scripts/_verify-ordnance.mjs --json     # plus the raw checks
 */
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const TAG = (() => { const i = argv.indexOf('--tag'); return i >= 0 ? argv[i + 1] : 'run'; })();

const outfile = join(tmpdir(), 'aa-ordnance-' + process.pid + '.mjs');
await build({
  entryPoints: [join(HERE, '_verify-ordnance.scenario.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  logLevel: 'warning',
});

const scenario = await import(pathToFileURL(outfile).href);
// One scenario per call, each guarded: a scenario that throws is a FAILED check
// with the stack in its detail, not a crash that hides the other four.
const results = {};
for (const name of scenario.SCENARIOS) {
  try {
    results[name] = scenario[name + 'Scenario']();
  } catch (e) {
    const stack = e && e.stack ? String(e.stack).split(/\r?\n/).slice(0, 2).join(' | ') : String(e);
    results[name] = [{ name: name + ': scenario threw', pass: false, detail: stack }];
  }
}

let total = 0;
let failed = 0;
for (const [name, checks] of Object.entries(results)) {
  console.log('[ordnance] ' + name);
  for (const c of checks) {
    total++;
    if (!c.pass) failed++;
    console.log('  ' + (c.pass ? 'PASS' : 'FAIL') + '  ' + c.name + '   ' + c.detail);
  }
}
if (JSON_OUT) console.log(JSON.stringify(results, null, 2));

mkdirSync(join(ROOT, 'captures'), { recursive: true });
writeFileSync(join(ROOT, 'captures', 'ordnance-proof-' + TAG + '.json'), JSON.stringify({ tag: TAG, total, failed, results }, null, 2));

console.log('[ordnance] ' + (total - failed) + '/' + total + ' checks hold' + (failed ? '  <-- REFUTED' : ''));
process.exit(failed ? 1 : 0);
