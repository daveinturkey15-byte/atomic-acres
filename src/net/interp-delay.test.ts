/**
 * Nuketown 2025 — adaptive interp proof. Dependency-free: no test runner, no
 * node builtins (stays clean under the repo's `tsc --noEmit`, which has no
 * @types/node). Bundle with the repo's esbuild and run; a thrown check is
 * the failure.
 */

import {
  INTERP_DELAY_MS,
  INTERP_MAX_MS,
  INTERP_MIN_MS,
  interpTargetMs,
} from './snapshot';

let passed = 0;
function check(name: string, cond: boolean): void {
  if (!cond) throw new Error(`interp proof failed: ${name}`);
  passed += 1;
}

// Floor lockstep: clean links render exactly where they always did.
check('floor equals the legacy delay', INTERP_MIN_MS === INTERP_DELAY_MS);
check('legacy delay is 100', INTERP_DELAY_MS === 100);

// Empty/broken statistics hold today.
check('NaN holds', interpTargetMs(NaN) === 100);
check('Infinity holds', interpTargetMs(Number.POSITIVE_INFINITY) === 100);

// One extra 50 ms tick of margin over p95, inside the bounds.
check('quiet link holds floor', interpTargetMs(0) === 100);
check('p95 50 holds floor', interpTargetMs(50) === 100);
check('p95 60 targets 110', interpTargetMs(60) === 110);
check('p95 100 targets 150', interpTargetMs(100) === 150);
check('p95 200 clamps ceiling', interpTargetMs(200) === INTERP_MAX_MS);
check('p95 1000 clamps ceiling', interpTargetMs(1000) === 250);

// Tick rate parameterises the margin, never the bounds.
check('10 Hz margin is 100', interpTargetMs(60, 10) === 160);
check('bounds hold at any rate', interpTargetMs(5000, 10) === 250);

// Sweep: every answer inside [100, 250], monotone non-decreasing.
let prev = -1;
for (let p = 0; p <= 2000; p += 5) {
  const t = interpTargetMs(p);
  if (!(t >= 100 && t <= 250)) throw new Error(`interp proof failed: out of bounds at ${p}`);
  if (!(t >= prev)) throw new Error(`interp proof failed: non-monotone at ${p}`);
  prev = t;
  passed += 1;
}

console.log(`interp proof: ${passed} checks passed`);
