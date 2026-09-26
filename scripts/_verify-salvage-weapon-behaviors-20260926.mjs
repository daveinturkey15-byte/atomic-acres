/**
 * Focused CPU proof for the restart weapon delivery seam.
 *
 * This bundles the actual TypeScript module so the assertions exercise the
 * source consumed by the app. It deliberately does not boot a browser or
 * admit an exotic into the live host; that promotion belongs to the host and
 * network owner.
 */
import { build } from 'esbuild';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const src = (p) => join(root, p).replaceAll('\\', '/');
const entry = `
import { WEAPONS } from '${src('src/weapons/catalog.ts')}';
import {
  SPECIAL_WEAPON_BEHAVIORS, behaviorFor, isHitscanBehavior,
  insideCone, coneDamageAt, traceRailgun,
} from '${src('src/weapons/behavior.ts')}';
export { WEAPONS, SPECIAL_WEAPON_BEHAVIORS, behaviorFor, isHitscanBehavior, insideCone, coneDamageAt, traceRailgun };
`;
const outDir = join(tmpdir(), 'nuketown-salvage-weapon-behaviors');
mkdirSync(outDir, { recursive: true });
const entryPath = join(outDir, 'entry.ts');
const outPath = join(outDir, 'bundle.mjs');
writeFileSync(entryPath, entry);
await build({ entryPoints: [entryPath], outfile: outPath, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const {
  WEAPONS, SPECIAL_WEAPON_BEHAVIORS, behaviorFor, isHitscanBehavior,
  insideCone, coneDamageAt, traceRailgun,
} = await import(pathToFileURL(outPath).href);

const failures = [];
const check = (name, ok, detail = '') => {
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
};
const approx = (a, b, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;

const specialIds = ['railgun', 'explosive-crossbow', 'flamethrower', 'flare-gun'];
const catalogIds = WEAPONS.map((weapon) => weapon.id);
check('catalog has 20 authored rows', catalogIds.length === 20, String(catalogIds.length));
check('every catalog row has a behavior', catalogIds.every((id) => behaviorFor(id).kind));
check('ordinary rows remain hitscan', catalogIds.filter((id) => !specialIds.includes(id)).every(isHitscanBehavior));
check('all four special rows are non-hitscan', specialIds.every((id) => !isHitscanBehavior(id)));
check('railgun is piercing', behaviorFor('railgun').kind === 'piercing');
check('crossbow is a bounded projectile', behaviorFor('explosive-crossbow').kind === 'projectile' && behaviorFor('explosive-crossbow').speed === 60);
check('flamethrower is a bounded cone', behaviorFor('flamethrower').kind === 'cone' && behaviorFor('flamethrower').range === 17);
check('flare gun is a slower projectile', behaviorFor('flare-gun').kind === 'projectile' && behaviorFor('flare-gun').speed === 24);
let unknownThrew = false;
try { behaviorFor('weapon-from-old-project'); } catch { unknownThrew = true; }
check('unknown ids fail closed', unknownThrew);

const flame = SPECIAL_WEAPON_BEHAVIORS.flamethrower;
check('cone accepts a centered target', insideCone(0, 0, 0, 1, 0, 0, 8, 0, 0, flame));
check('cone rejects an off-axis target', !insideCone(0, 0, 0, 1, 0, 0, 8, 2, 0, flame));
check('cone rejects a target outside range', !insideCone(0, 0, 0, 1, 0, 0, 17.01, 0, 0, flame));
check('cone accepts the muzzle origin', insideCone(0, 0, 0, 1, 0, 0, 0, 0, 0, flame));
check('cone damage is near value at muzzle', coneDamageAt(0, 12, 2, 17) === 12);
check('cone damage falls linearly', approx(coneDamageAt(8.5, 12, 2, 17), 7));
check('cone damage is zero at and beyond range', coneDamageAt(17, 12, 2, 17) === 0 && coneDamageAt(40, 12, 2, 17) === 0);
check('cone damage rejects invalid distances', coneDamageAt(Number.NaN, 12, 2, 17) === 0 && coneDamageAt(-1, 12, 2, 17) === 0);

const railgun = SPECIAL_WEAPON_BEHAVIORS.railgun;
const trace = traceRailgun([
  { distance: 8, thickness: 0.3 },
  { distance: 12, thickness: 0 },
  { distance: 20, thickness: 0.3 },
  { distance: 26, thickness: 0 },
], railgun);
check('railgun accepts its trace', trace.accepted);
check('railgun honors its two-surface budget', trace.penetrations === 2);
check('railgun can reach targets before and after cover', trace.targetsReached === 2);
check('railgun retains energy after accepted cover', approx(trace.remainingEnergy, 0.62 * 0.62));
const exhausted = traceRailgun([{ distance: 2, thickness: 0.4 }, { distance: 3, thickness: 0 }], { ...railgun, surfaceRetention: 0 });
check('railgun stops target resolution after exhausted energy', exhausted.penetrations === 1 && exhausted.targetsReached === 0 && exhausted.remainingEnergy === 0);
const wrongProfile = traceRailgun([{ distance: 2, thickness: 0 }], flame);
check('piercing helper refuses a cone profile', !wrongProfile.accepted && wrongProfile.targetsReached === 0);

if (failures.length > 0) {
  console.error(`salvage weapon behavior invariants FAILED (${failures.length}):`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`salvage weapon behavior invariants PASS: ${catalogIds.length} catalog rows, ${specialIds.length} explicit non-hitscan profiles, cone + piercing proofs complete.`);
