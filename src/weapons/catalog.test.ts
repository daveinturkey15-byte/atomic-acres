/**
 * Nuketown 2025 — gun parity proof. Same dependency-free rules as the
 * killstreak proofs: bundle with the repo's esbuild, run the bundle, a
 * thrown check is the failure. See docs/HANDOFF-PARITY.md for the command.
 */

import { WEAPONS, damageAt, patternMult } from './catalog';

let passed = 0;
function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`gun parity proof failed: ${name}`);
  passed += 1;
}

const ids = WEAPONS.map((w) => w.id);
check('seven guns ship', WEAPONS.length === 7);
check('ids unique', new Set(ids).size === ids.length);
for (const id of ['longhorn', 'rattler', 'coachman', 'deadeye', 'duster', 'stampede', 'varmint']) {
  check(`roster keeps ${id}`, ids.includes(id));
}

const byId = (id: string) => WEAPONS.find((w) => w.id === id) as (typeof WEAPONS)[number] | undefined;

// Stampede: the LMG analogue (old M249 SAW: 720 rpm, 62-round belt). Highest
// sustain in the roster: biggest mag, slowest ADS, heaviest move tax.
const stampede = byId('stampede');
check('stampede exists', stampede !== undefined);
if (stampede !== undefined) {
  check('stampede is automatic at 720 rpm', stampede.auto && Math.abs(stampede.interval - 1 / 12) < 0.001);
  check('stampede carries the belt', stampede.magSize === 60 && stampede.startReserve === 180);
  check('stampede is the slowest to aim', stampede.adsTime >= 0.3 && stampede.adsMoveScale <= 0.6);
  check('stampede hits 27 inside 25 m', damageAt(stampede, 10) === 27);
  check('stampede falls to 17 past 55 m', damageAt(stampede, 100) === 17);
  const mid = damageAt(stampede, 40);
  check('stampede falls off monotonically', mid < 27 && mid > 17);
  check('stampede reload punishes the belt', stampede.reloadTime >= 3 && stampede.emptyReloadTime > stampede.reloadTime);
}

// Varmint: the semi-marksman analogue (old M14 EBR family: hard-hitting semi,
// small mag, fast follow-up). Between the duster and the deadeye, no overlap:
// deadlier per shot than any auto, slower than any auto, weaker than the bolt.
const varmint = byId('varmint');
check('varmint exists', varmint !== undefined);
if (varmint !== undefined) {
  check('varmint is semi at ~150 rpm', !varmint.auto && Math.abs(varmint.interval - 0.4) < 1e-9);
  check('varmint hits 45 inside 30 m', damageAt(varmint, 10) === 45);
  check('varmint falls to 28 past 70 m', damageAt(varmint, 100) === 28);
  check('varmint carries 10+40', varmint.magSize === 10 && varmint.startReserve === 40);
  const deadeye = byId('deadeye');
  const longhorn = byId('longhorn');
  if (deadeye !== undefined && longhorn !== undefined) {
    check('varmint sits between rifle and bolt per shot',
      damageAt(varmint, 10) > damageAt(longhorn, 10) && damageAt(varmint, 10) < damageAt(deadeye, 10));
    check('varmint cycles faster than the bolt', varmint.interval < deadeye.interval);
    check('varmint aims tighter than the bolt class below it', varmint.adsFov > deadeye.adsFov);
  }
}

// Every gun: the controller's timer and HUD math stay finite.
for (const w of WEAPONS) {
  check(`${w.id} has a positive interval`, w.interval > 0 && Number.isFinite(w.interval));
  check(`${w.id} has a live round count`, w.magSize > 0 && w.startReserve >= 0);
  check(`${w.id} reloads forward`, w.reloadTime > 0 && w.emptyReloadTime >= w.reloadTime);
  check(`${w.id} ADS blends inside the BO2 band`, w.adsTime >= 0.15 && w.adsTime <= 0.35);
  let finite = true;
  for (let n = 0; n < 12; n += 1) finite = finite && Number.isFinite(patternMult(w, n));
  check(`${w.id} recoil pattern stays finite`, finite);
}

console.log(`gun parity proof: ${passed} checks passed`);
