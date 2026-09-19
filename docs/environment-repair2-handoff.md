# Environment Repair2 Handoff — Root Review Corrections

**Date**: 2026-09-19
**Lane**: `nuketown-environment-20260919` (sole owner). Root tree untouched (read-only);
frozen snapshot `work/root-baseline/` untouched. Previous `work/environment-rootbase.patch`
preserved as-is; this repair supersedes it.
**Patch**: `work/environment-rootbase-repair2.patch` (3 files, ASCII-only, LF line endings, `git apply`
clean against root baseline snapshot; verified via `git apply --check --directory=work/root-baseline`).
**New files**: listed below with exact SHA-256 and byte sizes; root copies them into place.

## Defects Fixed & Root Requirements Addressed

1. **Unconditional Paving Upgrade Restored** (`src/core/materials.ts`):
   Paving is unconditional at its original deterministic position: asphalt slot runs canary
   load vs `asphalt-07` upgrade, followed immediately by `upgrade(lib.paving, concrete-pavement-03, 32)`
   at base brace depth outside any branch, followed by concrete slot (canary load vs baseline upgrade).
   Absent-flag runs retain the original asphalt -> paving -> concrete order byte-for-byte.
   Canary runs preserve the Polyhaven paving baseline. Single `groundCanary` evaluation with
   one shared cancel-handle owner registered only when enabled. All existing turf, fences, operators,
   viewmodels, and rain configurations are retained untouched.

2. **Scoped Geometry Disposal & Pagehide Protection** (`src/build/skyline.ts`, `src/build/distant-mountains-canary.ts`, `src/main.ts`):
   - `createDistantMountainsCanary`: releases geometries (`geo.dispose()`) and detaches owned candidate meshes and group (`mesh.removeFromParent()`, `g.removeFromParent()`, `g.clear()`) idempotently (`released = true`). Never disposes shared materials during a live frame.
   - `buildSkyline`: registers `g.userData.dispose = canary.dispose`.
   - `releaseEnvironmentCanary` in `src/main.ts`: specifically restricts disposal to the owned `skyline` target (`if (target.name !== 'skyline') continue;`) and its `distant_mountains_canary` child. Does NOT traverse arbitrary unrelated scene targets and never touches unrelated `userData` disposers. Shared materials stay live.

3. **Comparison Harness Configured for Candidate 4192 / dist-next** (`scripts/assets/environment-comparison-harness.mjs`):
   Authored for ROOT to run in candidate environment, never executed here.
   - Defaults `--url` to `http://127.0.0.1:4192` and `--dist` to `dist-next`.
   - Explicitly rejects `:4188` (`Do not silently default 4188`).
   - Removed `usePreview` completely.
   - Uses owned stock Chrome via `scripts/lib/stock-browser.mjs`.
   - Proves real WebGPU via `window.__NT_BACKEND.actual === 'webgpu'` and canvas `data-nt-backend === 'webgpu'`.
   - Reads 6 canonical fidelity stations from `window.__NT.stations` (no in-wall or hardcoded cameras).
   - Reads render-delta stats via `measureFrame()` and asserts non-zero actual draws (`sceneWasMeasured`).
   - Preserves thresholds: `DARK_THRESHOLD = 40`, `sceneWasMeasured(stats)`.
   - Performs zero mid-session disposal.

4. **Loader Ownership & Docblock** (`src/core/ground-pbr-canary.ts`):
   Docblock explicitly notes that cancellation late-disposes completed maps and abandons
   the set, but does NOT abort underlying Image requests (return values unowned until onLoad).
   Zero loader calls upon cancel; late arrival is disposed immediately.

## Verification Executed in Lane (Focused CPU Checks + npm run check)

- `npm run check` — 0 errors (tsc --noEmit && node scripts/check-render-sites.mjs passed).
- `node --experimental-strip-types scripts/assets/verify-ground-pbr-canary.mjs` — 73/73 passed.
- `node --experimental-strip-types scripts/assets/verify-distant-mountains-canary.mjs` — 28/28 passed (including real buildSkyline registration, exact 3/3 geometry disposal, idempotent double-call, 0 foreign disposals).
- `node --experimental-strip-types scripts/assets/verify-environment-integration.mjs` — 100% passed (paving brace depth, skyline registration, main.ts releaseEnvironmentCanary, harness contract).
- `git apply -v --check --directory=work/root-baseline work/environment-rootbase-repair2.patch` — exit code 0 (cleanly checks against snapshot).
- Actual browser/visual acceptance is **OPEN** for Root to run.

## File Manifest (Exact SHA-256 & Bytes)

### Modified Tracked Files (in patch: `work/environment-rootbase-repair2.patch`):
- `src/core/materials.ts`
- `src/build/skyline.ts`
- `src/main.ts`

### New Files to Copy:
- `src/core/environment-flags.ts` — `FA456E41BB73D7C42B1FC2719D66D821E7D8BD91E3E1F1735750FFF6C68CB3AE` (3326 B)
- `src/core/ground-pbr-canary.ts` — `F46C9E061005B103BD57EC67311BE8708E7A41700CEFA81D98EDA83F0B966AD6` (10459 B)
- `src/build/distant-mountains-canary.ts` — `5AE5EB2DEC342A5F4711B44F53C2CC60ED8D5B7B33010030D29239B03AD5D813` (13294 B)
- `scripts/assets/verify-ground-pbr-canary.mjs` — `9AC3A12729B9E2BAEB30552B2DD64141FACC9A2A0613DD709236CA8D82DC97E8` (11935 B)
- `scripts/assets/verify-distant-mountains-canary.mjs` — `A5D0A2F16C9125C91B99047E4783363496535235D4E4EEA13FFA0B66F8D33EDE` (19795 B)
- `scripts/assets/verify-environment-integration.mjs` — `60364CBC32DE897A4B94CD5EE851AC6CC47CACD1F34B9FD02D445A2B4102927A` (9447 B)
- `scripts/assets/environment-comparison-harness.mjs` — `E911CBB3ADCCDE711D1B7E913103A22FB2B1E943FE291436EBEACC628559A5A1` (9827 B)
- `public/assets/ground-pbr-canary/provenance.json` — `58938B22456C5951871C879412E98B77B3CB00A96DCE055DF665710AC689B75A` (3907 B)
- `public/assets/ground-pbr-canary/asphalt-1k-color.jpg` — `3095D3352A25474E2AEC53DCDAA5574B839B8CE50935847F9CB38E01902891CD` (1857110 B)
- `public/assets/ground-pbr-canary/asphalt-1k-normal.jpg` — `52B5946C7E763ABC8D56A66B42066E3868CA188214B0F07583D29A3036D35287` (2209659 B)
- `public/assets/ground-pbr-canary/asphalt-1k-roughness.jpg` — `E9FF4D449AC12C000DF859DAD92EDE192BD7A8DB4A843B9E118FF6040E9C1F97` (718817 B)
- `public/assets/ground-pbr-canary/concrete-1k-color.jpg` — `2F155B85C2656305815E94A0EFCC0B0087C141E52E98395CC03EB906252150AF` (1092354 B)
- `public/assets/ground-pbr-canary/concrete-1k-normal.jpg` — `B7FB7D45F85BAD9E1C61F544E90077735F8F787CD13D3C1161AECE11082FE9FF` (1080228 B)
- `public/assets/ground-pbr-canary/concrete-1k-roughness.jpg` — `EE79CF1139197522AC6ED6DAD2D9C0429626CD8F2E107AAAF9DAA1F4F30E7D7D` (671268 B)

### Scoped Patch:
- `work/environment-rootbase-repair2.patch` — `9B1F9F3803690F7296364026360AB7EF6376D383A46771C950C81D395333ABB1` (10741 B)

## Executable Root Integration Commands

```bash
# 1. Inside root worktree (nuketown-recovery-20260919):
git apply ../nuketown-environment-20260919/work/environment-rootbase-repair2.patch

# 2. Copy the 8 new code/script/provenance files and 6 ground texture assets per manifest above

# 3. Focused CPU gates
npm run check
node --experimental-strip-types scripts/assets/verify-ground-pbr-canary.mjs
node --experimental-strip-types scripts/assets/verify-distant-mountains-canary.mjs
node --experimental-strip-types scripts/assets/verify-environment-integration.mjs

# 4. Browser/Visual comparison across canonical fidelity cameras (run by Root):
node scripts/assets/environment-comparison-harness.mjs --url http://127.0.0.1:4192 --dist dist-next
```
