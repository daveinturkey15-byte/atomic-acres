# GLM barrel lane — refinement record

2026-09-19. Lane `nuketown-glm-barrel-20260919`, base `fb71514`. Owned files only:
`src/build/industrial-barrels.ts`, `src/props/industrial-barrel.ts`,
`scripts/assets/verify-barrel-instances.mjs` (new), this document. No GPU, browser,
render, server, npm build, full suite, inference, credentials, config, profile or log
access; no commits; no delegation. Root integrates and supplies pixels.

## 1. Four clones → one InstancedMesh

`buildIndustrialBarrels` now reads geometry, material and master-space transform off a
scratch `getIndustrialBarrel()` clone (buffers are shared, the shell is discarded) and
adds a single `InstancedMesh` named `industrial-barrel-instances`:

- geometry and material are the master's own references — nothing copied, nothing
  recompiled; the 18-program material-singleton property is untouched;
- each instance matrix is `T(x, KERB_HEIGHT+0.001, z) · R_y(yaw) · M` where `M` is the
  mesh's transform relative to the master root (`rootRoot⁻¹ · mesh.matrixWorld`) — the
  exact chain the previous four clones rendered under, so world transforms are preserved
  bit for bit even for a non-identity GLB node chain;
- `computeBoundingBox()`/`computeBoundingSphere()` run after the matrices are set, so
  frustum culling sees the spread, not the unit barrel at the origin;
- `castShadow`/`receiveShadow` match the old clone flags;
- colliders are unchanged in kind: four honest rotated AABBs from
  `industrialBarrelCollider` (yaw-exact width/depth from `INDUSTRIAL_BARREL_SIZE`).

Static cost for the module: 4 draw calls → 1.

## 2. Readiness export: removed, not patched

`docs/glm-provider-canary.md` offers fix-or-remove. The historical barrel module
exposed a mutable `export let industrialBarrelReady`, which was assignable by any
importer and had zero runtime consumers. Root removed that export outright, killing
the defect class: no permanently-rejected stale promise after a failed preload and
no dispose-"healing" without a load. `preloadIndustrialBarrel()` still returns its
promise; `main.ts` needs no readiness assignment. `loadIndustrialBarrel`,
`getIndustrialBarrel`, `disposeIndustrialBarrel`, `INDUSTRIAL_BARREL_URL` keep their
documented contracts.

## 3. Placements: proven-clear positions

The proof harness first ran against the old coordinates and reproduced the lane brief
exactly — gap 0.000 m to `field-cases#645` (white-east), `yards#577` (white-west),
`mannequins#632` (orange-east), `yards#565` (orange-west), plus the snapshot's own old
`industrial-barrels#646..649` colliders. New positions are the deterministic
nearest-valid results of the harness's radial search (0.05 m grid, ≤ 3.0 m), same yaw,
lawn base 0.151:

| name | old (x,z) | new (x,z) | moved | min collider gap |
|---|---|---|---|---|
| white-east-fence | 11.60, 34.80 | 10.41, 34.97 | 1.20 m | 0.561 m |
| white-west-fence | -10.80, 31.80 | -12.46, 32.15 | 1.70 m | 0.460 m |
| orange-east-fence | 11.30, -33.00 | 11.58, -31.83 | 1.19 m | 0.716 m |
| orange-west-fence | -10.60, -34.20 | -11.84, -34.03 | 1.24 m | 0.569 m |

Clearance law: ≥ 0.45 m (0.4 m walking gap + the snapshot scope's own 0.05 m QA margin)
to every snapshot collider that vertically overlaps the barrel span (y 0.151–1.081),
against the COMPLETE `docs/verification/2026-09-19/collider-snapshot.json` list, not map outerbounds; outside
all four door aprons; ≥ 0.6 m from both spawn points; inside the back-yard band
`[HOUSE_BACK, BACK_FENCE-0.6] × [YARD_X_MIN+0.3, YARD_X_MAX-0.3]`.

## 4. Proof harness

`scripts/assets/verify-barrel-instances.mjs` (CPU only, ~3 s, deterministic) binds to
real artifacts: it compiles `src` with the project tsconfig into `work/barrel-verify-build`,
imports the shipped `INDUSTRIAL_BARREL_PLACEMENTS` / `industrialBarrelCollider` /
`INDUSTRIAL_BARREL_SIZE` / layout constants, parses the actual GLB, and loads the full
snapshot. The snapshot is accepted only when it is marked complete, its count agrees
with `__NT.colliderCount`, its module counts sum to that exact total, and its indices
are unique and contiguous from zero. It proves:

- source claims: 1 primitive, 1 material, 1473 triangles, GLB envelope = SIZE (max
  axis delta ≤ 0.01 m) — all confirmed on the committed 573,188-byte GLB;
- enclosure: each instance's world bounds (GLB envelope through the instance matrix,
  8-corner transform) sit inside its collider AABB in all six faces; tolerance is
  0.001 m — exactly SIZE's millimetre rounding bound — and the measured worst margin
  is −0.0005 m (double-conservative bbox-of-bbox rounding noise). No threshold was
  loosened anywhere; the tolerance was tightened from an initial 0.005 after measuring;
- clearance/apron/spawn/band law as above, with per-placement min gaps printed;
- failure mode: any violating placement prints its nearest valid position; the run
  exits non-zero. Running it on the pre-change coordinates FAILS (verified) — the
  falsifier property, same spirit as `scripts/_verify-streak-reject.mjs`.

Receipt: `work/barrel-verify-result.json` (untracked scratch, like the GLB importer's
`work/industrial-barrel/`).

## 5. Verification run in this lane

- `tsc -p tsconfig.json` (noEmit): clean.
- Proof harness: ALL CHECKS PASS on the new placements; FAILS (as designed) on the old.
- Not run here, per lane rules: `npm run check`, `playcap`, `capture`, `soak` — GPU/
  browser/server work belongs to root's integration pass.

Root's bounded full-collider receipt is now available at
`captures/checkpoint-g-barrel-full-proof.txt`: all four placements pass with
minimum gaps of 0.561 m, 0.460 m, 0.716 m, and 0.569 m respectively. The
replacement fixture `docs/verification/2026-09-19/collider-snapshot.json` is
complete and contains 652 exact rows; its SHA-256 is
`437acc78adffece89cc338e58b362e15cbb584f3cb32583db98133b08d0069f`. The
proof excludes only the placement's own barrel row while retaining the other
barrel rows as obstacles. This is a CPU placement/collider result, not a
photoreal or final player-traversal acceptance.

## 6. Integration notes for root

- `scripts/capture-industrial-barrels.mjs` (root-owned) hardcodes the four OLD
  coordinates on line 18; it needs the new table above.
- The root-owned `docs/industrial-barrel-runtime.md` still contains the historical
  `industrialBarrelReady` API line and should drop it before this record is treated
  as fully reconciled. The source module itself no longer exports that symbol.
- The root map traversal receipt `captures/checkpoint-e-traverse.txt` passes 5/5
  routes and 4/4 house faces, but it is not a barrel-specific traversal trace.
  Barrel-specific player traversal and final promotion remain open; pixels and
  the playcap dark-frame gate remain root's acceptance.
- The previous capture implementation sampled a 1 m x/z grid at only three heights
  and rounded bounds to 0.01 m. That sampled fixture must not be described as complete;
  the replacement capture calls the built page's read-only `__NT.colliderSnapshot()`
  once and writes `docs/verification/2026-09-19/collider-snapshot.json` with the exact
  total, module-count cross-check, and candidate JS filename/hash when available.
- `work/` is untracked and not gitignored; root may want a `.gitignore` line if the
  scratch convention should stay invisible to `git status`.
