# lawn-canary — photo-PBR lawn surface behind `?lawn=canary`

OMP lane `glm-lawn-pbr-0118` on `nuketown-environment-20260919`, 2026-09-20.
Exclusive paths owned here: `src/core/lawn-pbr-canary.ts`, `public/assets/lawn-pbr-canary/`,
`scripts/assets/verify-lawn-pbr-canary.mjs`, plus minimal integration hunks in
`src/core/environment-flags.ts` and `src/core/materials.ts` (diffed against a
pre-edit snapshot; nothing else was touched). Root tree untouched. No build,
no browser, no playcap/capture/soak — those are the root's gates.

## What ships

| Path | Content |
|---|---|
| `public/assets/lawn-pbr-canary/` | 3× 1024² JPEG maps + `provenance.json` (4,926,168 B on disk) |
| `src/core/lawn-pbr-canary.ts` | Lawn-specific constants + swap-spec builder; loader/applier REUSED from `ground-pbr-canary.ts` |
| `scripts/assets/verify-lawn-pbr-canary.mjs` | CPU verifier: 38 checks, all pass (node v24.12.0) |
| `work/lawn-canary.patch` | Scoped patch: 6 git-binary new-file sections + 2 integration hunks |
| this doc | Provenance summary, contract, integration recipe, open items |

Asset: **ambientCG Grass001**, CC0, native physical tile **1.4 m** (v2 API
`dimensionX/Y = 140x140 cm`), maps = Color + NormalGL + Roughness.
SHA-256 per map in `provenance.json`, re-verified by the script.

**Authenticity disclosure:** Grass001 is `creationMethod = PBRProcedural` —
ambientCG-authored maps, NOT a photo scan. Evaluated and rejected alternatives:
PolyHaven `leafy_grass` (lush meadow + plant litter), `grass_ground` /
`sparse_grass` (the dry/soil-dominant class of the earlier "Sparse Grass"
rejection here). If the owner requires a true scan, the swap is provenance +
3 files behind the same flag.

## Flag and behavior

- `?lawn=canary` (or `pbr|on|1`; `baseline|off|0` forces off) enables ONLY the
  lawn swap. Default (no flag) is byte-identical to the current turf path.
- `mode` is deliberately unchanged — the lawn rides its own boolean so ground/
  mountains capture comparisons never re-key. `env=canary` does NOT enable it.
- QA parity: `__NT_OVERRIDE_LAWN_CANARY__` global + `setEnvironmentFlagsOverride`.
- The swap retargets the SAME `lib.lawn` wetStd material object
  (`applyGroundPbrCanaryMaps`): one program, one draw call, wetness uniform and
  `material.color` state (identity tint) preserved. `ground-detail.ts:215`
  ray-classifies placements by `ctx.mat.lawn` identity — unchanged.
- Teardown: the cancel-handle owner now registers when `groundCanary ||
  lawnCanary`; loader cancel/late-dispose is the audited shared
  `loadCanarySurfaceSet` contract.

## UV contract (never double-repeat)

Root `build/ground.ts` bakes world tiling into geometry UVs (`UV_LAWN = 96.0`
m per UV unit; geometry untouched here). The canary sets
`texture.repeat = 96 / 1.4 = 68.5714…` exactly once per map via
`applyGroundPbrCanaryMaps`. 1024 px over 1.4 m ≈ 731 px/m of blade detail.

## Calibration (root's paired views decide)

Measured color-map mean sRGB **(68.2, 91.7, 40.6)** (System.Drawing, stride 8,
16384 samples) — darker and more muted than the baseline turf target
(~(87, 121, 59)). `material.color` can only multiply darker, so the tint is
**identity 0xffffff** (exactly the baseline color state). If the paired view
reads the canary too dark, the levers are a brighter asset (e.g. Grass004) or
a gain in the wetness colorNode hook — never exposure/lighting.
`normalScale` 0.4 mirrors the lawn family value.

## Image input and pixel evidence

**Image input WAS available this session**: the color map was viewed directly
(dense fine dark-green mown turf, subtle tonal drift, sparse blade accents, no
zebra banding, no bald patches, no high-contrast noise — matches the directive's
"fine grass/thatch, low-frequency variation, restrained color"). The RENDER
comparison was not performed here: per directive the root alone builds and
compares actual pixels; frames referenced in the directive remain the evidence.

## Verification run here (all CPU)

- `node scripts/assets/verify-lawn-pbr-canary.mjs` → **ALL CHECKS PASS (38)**:
  bytes + SHA-256 + JPEG dims vs provenance; budgets (3 maps ≤3, 1024² ≤1K,
  4.93 MB ≤6 MiB disk, wire 20.4 MiB ≤30 MiB — includes one disclosed aborted
  delivery re-download); UV/spec contract; loader lifetime through the same
  fake-loader seam the browser path uses: happy path, cancel mid-flight,
  late arrivals late-disposed, mid-flight failure, disposed caller, and a
  double-fired slot (fails loud, never mis-delivers — unreachable from
  THREE.TextureLoader).
- `npm run check` → tsc clean + render-site allow-list OK.

## Root integration recipe

1. Apply with LF preserved (this tree is LF):
   `git -c core.autocrlf=false apply work/lawn-canary.patch`
   (verify with plain `git apply --check` first if preferred).
2. Build and serve as usual; open with `?lawn=canary` for the candidate, no
   flag for baseline.
3. Compare backyard spawn / fidelity stations baseline vs canary through the
   real game loop (`playcap` + `capture`). Expect: shader programs unchanged
   (map swap on an existing singleton adds none), draw calls unchanged
   (same meshes), lawn replaces turf everywhere `ctx.mat.lawn` was used.
4. Calibration levers in `src/core/lawn-pbr-canary.ts` if wanted; re-run the
   verifier after any constant change.

Rollback: remove the flag or the patch; the default path never changed.
