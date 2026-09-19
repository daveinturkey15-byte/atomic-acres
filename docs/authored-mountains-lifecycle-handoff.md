# Authored Mountains Lifecycle & Asset-Cache Deduplication Handoff

**Date**: 2026-09-19  
**Lane**: `nuketown-environment-20260919` (exclusive environment worktree, source-only; zero Blender/browser/GPU/server/delegation)  
**Target Root**: `nuketown-recovery-20260919` (read-only reference)  
**Status**: Ready for root integration and serialized build.

---

## 1. Executive Summary

This handoff delivers a bounded, source-only repair addressing the concrete lifecycle and GPU resource deduplication defects identified by root review:
1. **Set-Based GPU Resource Ownership Deduplication**: `disposeScene` now collects unique geometries, materials, and textures into `Set` instances before calling `.dispose()`. Meshes sharing geometry, materials sharing textures, or packed ORM textures wired across multiple slots (`roughnessMap`, `metalnessMap`, `aoMap`) are disposed exactly once per release. A `WeakSet<THREE.Object3D>` (`disposedMasters`) guards against repeated traversal and disposal.
2. **Pending Late-Load Race & Cache Invariant**: `ensureLoaded` checks `if (released.has(name))` immediately upon decode. If an asset was released while in flight, its master is deep-disposed immediately and **never cached** into `masters`. In `releaseAsset`, the pending flight handler is guarded with rejection handlers to eliminate unhandled rejections.
3. **Master Preservation**: `releaseAsset('authored-mountains')` strictly targets the requested asset name; `coach` and any other cached masters remain resident in `masters` and their GPU buffers are untouched.
4. **Pagehide Invariant (Clone Detach Precedes Master Disposal)**: Scene clones share the cached master's geometry and texture buffers. In `main.ts`, `releaseEnvironmentCanary` traverses `worldTargets` and executes clone detachment (`target.userData.dispose()`) **prior** to invoking `releaseAsset('authored-mountains')`.
5. **Real Bundled Verifier**: Created [`scripts/assets/verify-asset-release.mjs`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-environment-20260919/scripts/assets/verify-asset-release.mjs) which bundles the actual `src/core/assets.ts` via `esbuild` and verifies cached release, late pending resolution, error handling, and clone detachment using a controlled `GLTFLoader.prototype.loadAsync` harness, entirely eliminating copied toy models.
6. **Patch Cleanliness**: [`work/authored-mountains/authored-mountains.integration.patch`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-environment-20260919/work/authored-mountains/authored-mountains.integration.patch) applies cleanly against the exact current root `nuketown-recovery-20260919` (`git apply --check` exits 0).
7. **Frozen Recipe & Validator**: Recipe (`scripts/blender/build_authored_mountains.py`) and validator (`scripts/assets/verify-authored-mountains.mjs`) were kept frozen and untouched.

---

## 2. Concrete Defect & Technical Root Cause Analysis

### A. Missing GPU Resource Identity Deduplication
- **Symptom**: `disposeScene` looped every mesh and every key of every material. If multiple meshes shared geometry (common in instanced or modular backdrops) or shared a material, `geometry.dispose()` and `material.dispose()` were called multiple times.
- **ORM Packing Multi-Dispose**: In glTF PBR pipelines, occlusion, roughness, and metalness channels are commonly packed into a single texture. When a material maps that single texture to `roughnessMap`, `metalnessMap`, and `aoMap`, traversing material keys called `.dispose()` 3 times on the same texture object. Across multiple meshes or materials sharing that texture, disposal counts escalated rapidly.
- **Correction**: Implemented identity-based deduplication:
  - `const geometries = new Set<THREE.BufferGeometry>()`
  - `const materials = new Set<THREE.Material>()`
  - `const textures = new Set<THREE.Texture>()`
  - Meshes populate `geometries` and `materials`. Materials populate `textures`. Each resource in each Set is disposed once.
  - Added `const disposedMasters = new WeakSet<THREE.Object3D>()` at module scope to make `disposeScene` strictly idempotent per scene instance.

### B. Pending Late-Load Race Condition
- **Symptom**: In the previous integration patch, if `releaseAsset(name)` was called while an asset was still in flight, `releaseAsset` attached a `.then` to `flight`. However, `ensureLoaded`'s own internal promise chain unconditionally executed `masters.set(name, master)` upon decode. Depending on microtask interleaving, the asset was briefly resident in `masters` or could be accessed by callers between resolution and deletion.
- **Correction**: In `src/core/assets.ts`, `ensureLoaded` checks `if (released.has(name))` right after decode:
  ```typescript
  if (released.has(name)) {
    disposeScene(master);
    return master;
  }
  masters.set(name, master);
  ```
  If released, the master is never written to `masters` and is disposed immediately. In `releaseAsset`, `flight.then(() => { masters.delete(key); disposeScene(late); }, () => { /* swallow */ })` guarantees cache deletion and handles any load rejection cleanly.

### C. Verification Using Real Code Rather Than Copied Mock
- **Symptom**: `verify-authored-mountains.mjs` previously simulated release using local dummy objects (`testMasters`, `testPending`) rather than exercising `src/core/assets.ts` and `GLTFLoader`.
- **Correction**: Implemented [`scripts/assets/verify-asset-release.mjs`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-environment-20260919/scripts/assets/verify-asset-release.mjs) which bundles `src/core/assets.ts` with `esbuild` and drives the real loader state machine using controlled `GLTFLoader.prototype.loadAsync` hooks.

---

## 3. Verification Evidence (100% CPU Green)

All verifications executed in `nuketown-environment-20260919`:

### 1. Real Asset Lifecycle Verifier (`node scripts/assets/verify-asset-release.mjs`)
```
=== REAL ASSET-CACHE LIFECYCLE & DEDUPLICATION VERIFICATION ===

--- 1. Set-based GPU Resource Ownership Deduplication ---
[PASS] Shared BufferGeometry disposed exactly once across multiple meshes — disposed 1 times
[PASS] Distinct BufferGeometry disposed exactly once — disposed 1 times
[PASS] Shared Material disposed exactly once across multiple meshes — disposed 1 times
[PASS] Material 2 disposed exactly once — disposed 1 times
[PASS] Shared ORM texture wired across 4 slots & 2 materials disposed exactly once — disposed 1 times (no repeated dispose)
[PASS] Color texture disposed exactly once — disposed 1 times
[PASS] Normal texture disposed exactly once — disposed 1 times
[PASS] Repeated disposeScene on already-disposed scene is safe

--- 2. Cached Asset Release & Master Preservation ---
[PASS] Both coach and authored-mountains resident in cache
[PASS] releaseAsset drops authored-mountains from cache
[PASS] releaseAsset disposes authored-mountains GPU resources — geo: 1, mat: 1
[PASS] releaseAsset PRESERVES coach master in cache — coach clone returned
[PASS] releaseAsset leaves coach GPU resources untouched — coach geo: 0, coach mat: 0
[PASS] Repeat releaseAsset is idempotent no-op (no extra disposals)
[PASS] Unknown asset release is silent no-op

--- 3. Pending Late-Load Release & Race Guard ---
[PASS] authored-mountains is not yet in cache while pending
[PASS] Late pending arrival had GPU resources disposed — late geo: 1, late mat: 1
[PASS] Late pending arrival is NEVER cached into masters — getAsset returns undefined
[PASS] Subsequent loadAsset after release rejects immediately — asset released for page lifetime: authored-mountains
[PASS] Subsequent loadAsset rejected

--- 4. Pending Load Rejection Safety ---
[PASS] Caller caught load error
[PASS] releaseAsset void flight.then has no unhandled rejection — unhandled rejections: 0

--- 5. Pagehide Clone Detach Precedes Cache Master Disposal ---
[PASS] Clone was detached from parent BEFORE master disposal — clone detached first
[PASS] Master GPU resources disposed after clone detach — master geo disposed: 1
[PASS] Clone children cleared without corrupting master buffers beforehand

=== SUMMARY ===
Total: 25 | Passed: 25 | Failed: 0
ASSET-CACHE LIFECYCLE VERIFICATION GREEN
```

### 2. Frozen Authored Mountains Validator (`node scripts/assets/verify-authored-mountains.mjs`)
- Result: **25/25 PASS** (Recipe static checks green, lifecycle patch contract checks green).

### 3. Patch Application Check (`git apply --check`)
- Command: `git apply --check C:/Users/david/Desktop/stuff/worktrees/nuketown-environment-20260919/work/authored-mountains/authored-mountains.integration.patch`
- Working Directory: `C:/Users/david/Desktop/stuff/worktrees/nuketown-recovery-20260919`
- Result: **Exit Code 0 (clean, no conflicts, no warnings)**.

### 4. TypeScript Compiler & Render Sites
- `npx tsc --noEmit`: **0 errors**.
- `node scripts/check-render-sites.mjs`: **[check-render-sites] OK**.

---

## 4. Operational Invariants Preserved

1. **Opt-In Guard**:
   - `isAuthoredMountainsOptIn()` gates the preload in `src/main.ts`. If `?mountains=authored` is not present, no fetch occurs (zero 404 noise, zero network overhead).
   - `src/build/skyline.ts` falls through to the existing procedural canary and baseline untouched.
2. **Fallback Retained**:
   - If the authored GLB fails to load or is absent, `createAuthoredMountains` returns the procedural canary synchronously.
3. **External Model Status**:
   - The actual 3D model status is unknown unless exposed by the root build. Root handles serialized asset builds and pixel evaluation.

---

## 5. File Manifest

| File | Status | Description |
|---|---|---|
| [`work/authored-mountains/authored-mountains.integration.patch`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-environment-20260919/work/authored-mountains/authored-mountains.integration.patch) | Modified | Unified diff against root for `src/core/assets.ts`, `src/build/skyline.ts`, `src/main.ts` with Set deduplication, WeakSet idempotence, and late pending protection. |
| [`scripts/assets/verify-asset-release.mjs`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-environment-20260919/scripts/assets/verify-asset-release.mjs) | NEW | Node-based real asset-cache lifecycle verifier with controlled `GLTFLoader`. |
| [`docs/authored-mountains-lifecycle-handoff.md`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-environment-20260919/docs/authored-mountains-lifecycle-handoff.md) | NEW | Complete handoff and technical verification documentation. |
| [`src/core/assets.ts`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-environment-20260919/src/core/assets.ts) | In-lane update | Local worktree copy synchronized with the integration patch. |
