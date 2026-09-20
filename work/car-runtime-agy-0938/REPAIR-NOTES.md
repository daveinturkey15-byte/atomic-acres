# car-runtime-agy-0938 — Bounded Runtime/Lifecycle Repair for Sedan Art

Sole write target: `work/car-runtime-agy-0938/`
Prior car source and ROOT: Read-only.

## Root Review Issues Addressed & Repaired

Root reviewed `work/car-body-agy-0923/adoption/car-body-canary.ts` and patch, identifying unsafe lifecycle and adoption flaws. This lane resolves all items using the proven local ownership pattern from `src/build/coach-owned-canary.ts`:

1. **Deduplicated disposal (`disposeScene` & `disposeOwned`):**
   - *Problem:* Prior `car-body-canary.ts` walked each mesh and unconditionally called `.dispose()` on geometries, materials, and textures. When meshes shared materials or texture maps, resources were disposed multiple times.
   - *Repair:* `disposeScene` and `adopt` now gather unique resources in `Set<THREE.BufferGeometry>`, `Set<THREE.Material>`, and `Set<THREE.Texture>`. Each unique GPU resource is disposed exactly once.

2. **Cancellation generation & root detachment on release:**
   - *Problem:* Prior `releaseCarBodyCanary` did not detach the mounted visual root from its parent, and did not cancel pending in-flight loads.
   - *Repair:* `releaseCarBodyCanary` now increments `generation++`, detaches `group.removeFromParent()`, and frees owned resources. Any in-flight load compares `thisGen === generation` before adopting; if a release occurred, the scene is discarded and disposed immediately without flipping state to `ready`.

3. **Prevention of late load adoption after release:**
   - *Problem:* A slow fetch or race condition could resolve after `releaseCarBodyCanary()` had already run, resulting in a late adoption.
   - *Repair:* Generation checks across `attemptLoad`, `Promise.race.then`, `catch`, and `finally` ensure late arrivals are disposed immediately and cannot modify state.

4. **Missing release hooks in `main.ts`:**
   - *Problem:* Prior patch omitted `releaseCarBodyCanary` from `main.ts` lifecycle hooks.
   - *Repair:* Added `releaseCarBodyCanary()` to `window.addEventListener('pagehide')` and `qa.disposeEnvironment()`.

5. **Raw GLB fallback budget enforcement:**
   - *Problem:* Prior fallback to `assets/car-body-agy-0923.glb` did not validate complexity or draw calls, allowing an unbaked asset to exceed draw budgets.
   - *Repair:* Both consolidated and raw GLB attempts pass through `validateCandidateScene()`. If the raw GLB exceeds any budget (<= 6 meshes, <= 6 materials, <= 14,000 tris, bounds, ground, noseaxis), it is refused, disposed, and degrades to procedural fallback.

6. **Static batch ownership / exclusion enforcement:**
   - *Problem:* Meshes lacked proper batcher exclusion markers, and `makeCarBodyOwned` omitted the `keep` predicate, exposing the owned visual to `batchStatic` source geometry disposal.
   - *Repair:* `adopt()` tags each mesh with `userData.carBodyCanary = true;`. `makeCarBodyOwned()` returns `keep: (m) => m.userData.carBodyCanary === true`, which `park()` passes directly to `batchStatic(v.obj, ..., v.keep)`.

7. **Validation before consumption; removal of silent autoscaling:**
   - *Problem:* Prior `makeCarBodyOwned()` consumed the visual via `carBodyCanaryVisual()` (`taken = true`), checked bounds post-take without cleanup, and silently scaled oversized models with `multiplyScalar(1 / over)`.
   - *Repair:* `validateCandidateScene()` validates bounds, non-finite coords, ground rest (`box.min.y` within 0.12m of y=0), nose axis (+x longest dimension: `size.x > size.z` and `size.x > size.y`), and budgets *before* `adopt()` is ever called. Bad models are refused and disposed; no silent scaling is performed. `makeCarBodyOwned()` simply hands the valid visual to `park()`.

8. **Sync loader throw safety:**
   - *Problem:* If a custom or production loader throws synchronously, `preloadCarBodyCanary` would throw rather than resolving to `'fallback'`.
   - *Repair:* `safeLoad()` wraps loader invocation in `try { return Promise.resolve(load(url)); } catch (err) { return Promise.reject(err); }`.

9. **Opt-in no-fetch guarantee:**
   - *Problem:* Baseline runs must never make network requests.
   - *Repair:* `isCarBodyCanaryOptIn()` checks `?car-body=canary` or `globalThis.__NT_OVERRIDE_CAR_BODY__`. If absent or false, `preloadCarBodyCanary` resolves `'off'` immediately without calling the loader. `main.ts` guards the preload array with `...(isCarBodyCanaryOptIn() ? [preloadCarBodyCanary()] : [])`.

10. **Collider parity and RNG stability:**
    - Procedural `makeSaloon` returns `{ len: 4.8 + 0.24, wid: 1.95 + 0.09, hgt: 1.48 }` -> `{ len: 5.04, wid: 2.04, hgt: 1.48 }`.
    - `CAR_BODY_CANARY_DIMS` matches `{ len: 5.04, wid: 2.04, hgt: 1.48 }` exactly.
    - `makeCarBodyOwned()` consumes zero random numbers. The placement call in `vehicles.ts` consumes `nudge()` and `skew()` identically:
      `park(makeCarBodyOwned() ?? makeSaloon(ctx, PAL.carBlue, { fin: 0.32, twoTone: true, brightwork: true }), -(HEAD_RADIUS - 1.2) + nudge(), ORANGE.side * ROAD_HALF_WIDTH * 0.52, -0.09 + skew());`
    - Segment slabs are bit-for-bit identical with procedural saloon.

11. **Actual read-only QA status:**
    - `CarBodyCanaryReport` exported by `src/build/car-body-canary.ts` exposes: `optIn`, `state`, `mounted`, `taken`, `meshes`, `materials`, `geometries`, `textures`, `triangles`.
    - `qa.carBodyOwned()` in `src/main.ts` traverses `worldTargets` for marked meshes and returns `{ ...r, inScene }`.

## File Deliverables

- `candidate/src/build/car-body-canary.ts`: standalone owned canary lifecycle helper.
- `candidate/src/build/vehicles.ts`: minimal vehicle placement & keep predicate patch.
- `candidate/src/main.ts`: minimal preload, pagehide cleanup, and QA status patch.
- `car-runtime-agy-0938.patch`: unified git diff against ROOT `nuketown-recovery-20260919`.
- `verify-car-runtime-agy-0938.mjs`: CPU-only test suite exercising all 12 requirement categories via esbuild Node fixture.
- `handoff.json`: structured metadata for ROOT orchestrator.

## Verification Evidence

- `node verify-car-runtime-agy-0938.mjs`: **79/79 PASS** (0 failures).
- `git apply --check --ignore-whitespace car-runtime-agy-0938.patch`: **CLEAN** (dry run against ROOT).
- `npx tsc candidate/src/build/car-body-canary.ts --noEmit`: **CLEAN** (0 type errors).
- All work performed on bounded private CPU; no GPU/browser/server started.
