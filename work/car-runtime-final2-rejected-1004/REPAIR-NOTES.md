# car-runtime-agy-repair2-1000 — Final Runtime Lifecycle Repair 2 for Sedan

Sole write target: `work/car-runtime-agy-repair2-1000/`  
Prior completed work: `work/car-runtime-agy-0938` (read-only) and ROOT recovery (read-only).

## Root Review Issues Addressed & Repaired

Root review of `car-runtime-agy-0938` identified:
1. Preload after visual take: `state === 'ready' && owned && !taken` only returned ready while untaken. Calling preload after take could trigger a second load/adopt replacing `owned` without proper disposal.
2. Pagehide + pending reload / flight cleanup generation: when release occurs during an in-flight load followed by a new preload, the cancelled flight's cleanup must not dispose the new/current object, mutate settled ready state, or clear the successor flight.
3. Coordinate validation: Three.js `Box3` could skip or mask `NaN` values in vertex buffers if a bounding box was pre-populated on the geometry. Direct vertex array checks were required.

### Exact Corrections Implemented

1. **Idempotent Ready-State Independent of Taken:**
   - In `preloadCarBodyCanary()`: changed condition to `if (state === 'ready' && owned) return Promise.resolve(state);`.
   - Calling preload after `carBodyCanaryVisual()` has taken the root returns `'ready'` immediately without invoking the loader or modifying `owned`/`taken`.
   - Verified by test suite: Section 12 proves `preload -> take -> preload` issues zero additional loader calls, leaves ownership and report intact, and allows subsequent clean release.

2. **Successor Flight Preservation & New Object Protection:**
   - In `releaseCarBodyCanary()`: sets `flight = null` and increments `generation++`.
   - In `preloadCarBodyCanary()`: `flight = myFlight`. In `.finally()`: `if (flight === myFlight) flight = null;`, preventing a finishing earlier flight from clearing a successor flight pointer.
   - Guarded scene disposal: cancellation / timeout losers call `disposeCandidate(scene)` exactly once, ensuring they never call `disposeOwned()` or touch the active `owned` object.
   - Tested under both race orderings in Section 13:
     - **Ordering 1 (Flight 1 settles first, then Flight 2 settles):** Flight 1's scene is disposed, successor Flight 2 remains intact in loading state, Flight 2 settles to ready and is adopted cleanly.
     - **Ordering 2 (Flight 2 settles first, then Flight 1 settles):** Flight 2 settles to ready and adopts, then cancelled Flight 1 settles and disposes only its own scene without touching Flight 2's owned scene or mutating state away from `'ready'`.

3. **Direct Vertex Finite Check:**
   - In `validateCandidateScene()`: directly loops through every mesh's `geometry.attributes.position.array` and checks `Number.isFinite(coord)`.
   - Tested in Section 14: a mesh with `NaN` in its vertex buffer whose geometry bounding box was pre-cached with valid finite numbers is rejected immediately with `non-finite coordinates in vertex position attribute`, and its resources are disposed cleanly.

4. **Preserved Invariants:**
   - All budgets maintained: `<=6 meshes`, `<=6 materials`, `<=14,000 triangles`.
   - Bounded envelope: len `5.04`, wid `2.04`, hgt `1.48` (within `[3.8-5.12, 1.0-1.56, 1.5-2.12]`).
   - Nose axis (+x longest) and ground alignment (`box.min.y` within 0.12m of y=0) verified.
   - Batcher keep marker `userData.carBodyCanary = true` and `makeCarBodyOwned` keep predicate preserved.
   - Procedural collider parity and RNG stream stability preserved.

## Deliverables in `work/car-runtime-agy-repair2-1000/`

- `candidate/src/build/car-body-canary.ts`: updated standalone owned canary lifecycle helper.
- `candidate/src/build/vehicles.ts`: minimal vehicle placement & keep predicate patch.
- `candidate/src/main.ts`: minimal preload, pagehide cleanup, and QA status patch.
- `car-runtime-agy-repair2-1000.patch`: unified git diff against ROOT `nuketown-recovery-20260919`.
- `verify-car-runtime-agy-repair2-1000.mjs`: comprehensive CPU-only test suite covering all 14 categories.
- `handoff.json`: structured metadata for ROOT orchestrator.
- `REPAIR-NOTES.md`: this file.

## Verification Evidence

- `node verify-car-runtime-agy-repair2-1000.mjs`: **115/115 PASS** (0 failures).
- `git apply --check --ignore-whitespace car-runtime-agy-repair2-1000.patch`: **CLEAN** (dry run against ROOT `nuketown-recovery-20260919`).
- `npx tsc --noEmit --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom candidate/src/build/car-body-canary.ts`: **CLEAN** (0 type errors).
