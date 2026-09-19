# Muse hedge independent geometry review

Review target: src/build/yards.ts hedge() in the recovery tree, compared with base fb715149. This review is CPU-only and does not build, boot a browser, render, or edit other runtime modules.

## Method

scripts/assets/verify-hedge-assembled.mjs extracts the actual hedge() function from the candidate source and the pinned base source. It strips only TypeScript syntax with esbuild, then executes the real function with instrumented B/C/S batches, aabbSlab, the real makeRng() extracted from src/core/kit.ts, and Three.js r180 primitive geometry. Each captured instance matrix is applied to every source vertex and checked against the actual generated per-block collider envelope. The script also runs a negative control made by removing only the repaired lump yaw argument from the candidate function.

Commands:

    node scripts/assets/verify-hedge-assembled.mjs
    node scripts/assets/verify-hedge-envelope.mjs
    node --check scripts/assets/verify-hedge-assembled.mjs

## Evidence

- **VERIFIED** — actual candidate execution produces 8 runs and 17 blocks. All generated box, sloped cylinder, and crown-lump vertices are inside their corresponding unchanged colliders: zero outside vertices for each primitive.
- **VERIFIED** — the repaired candidate preserves the exact downstream RNG cursor. The first post-hedge value is 0.21293388400226831 for both candidate and base, and all eight downstream values compare equal.
- **VERIFIED** — the negative control that removes only S.put's run yaw fails as expected: 42 crown-lump vertices exceed colliders, with a maximum overrun of 0.036504388 m in white-garage. This demonstrates the orientation repair is material to the result.
- **VERIFIED** — the prior scalar/source verifier passes its material, draw, triangle, collider, and route checks. It remains useful as a budget/source gate; the assembled verifier is the geometry gate.
- **VERIFIED / baseline** — unchanged endpoint-cap icosahedra exceed the union of block collider envelopes on all eight runs in both base and candidate. This is kept as a pre-existing endpoint exception and is not counted as a candidate regression.
- **VERIFIED** — no new materials, geometry types, batches, lights, colliders, or random calls were added. The new crown still uses the existing S batch and mat.hedge.

## Repair applied

The crown lump now receives the computed hedge yaw ry, so bw remains the cross-run dimension for both X and Z runs.

The sloped crown span now computes its actual vertical rise and adds the cylinder cap's run-axis projection to the visual TUCK. The wave is resampled at the inset endpoints, with a 1 mm numerical margin and a length clamp. This removes the measured cap overrun without weakening assertions or changing the collider.

## Limits

This proves source-executed CPU geometry, deterministic RNG behavior, and the requested negative control. It does not claim browser visual acceptance, collision feel, or runtime performance. Root should perform the real capture and integration review.
