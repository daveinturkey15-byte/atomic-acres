ROOT FOLLOW-UP: the three issues below were repaired in the root proof. Semantic tolerances are position1e-5m, normal/UV1e-6, and actual position/UV/shadow corruptions are rejected. Source proof passes; the original review follows as history. Runtime acceptance is tracked in the checkpoint report.

# Orange house static batch proof review

## Scope and run

This is a CPU-only review of the GLM candidate worktree
`C:\Users\david\Desktop\stuff\worktrees\nuketown-glm-orange-batch-20260919`.
The candidate proof bundles the real `src/build/orange-house.ts` and the real
`src/core/static-batch.ts`; its control replaces the batch call with a no-op.
No GLM source or runtime file was changed during this review.

**VERIFIED** — `node scripts/assets/verify-orange-house-batch.mjs` returned
`RESULT: PASS` with 204 -> 51 meshes, 23 merged groups, 7,196 merged
triangles, 9.07e-7 m reported worst triangle deviation, 233 identical
collider rows, six RNG calls in each variant, two unchanged transparent meshes,
one unchanged `windowDark` singleton, and a zero-reduction no-op control.
The proof also reports 40 of 9,564 triangles taking the tolerance path.

## Review findings

### Confirmed blocker: one broad tolerance covers three different semantics

At `scripts/assets/verify-orange-house-batch.mjs:276`, the fallback comparator
uses `TOL = 2e-3` for position, normal, and UV components. This is 2 mm for
positions, while the run reports only 9.07e-7 m worst position deviation. The
same number also permits 0.002 normal and 0.002 UV differences, without a
measured bound for either quantity. The exact 0.1 mm quantization path does
not remove this fallback gap: 40 triangles still rely on the broad matcher.

This is a proof-authority blocker even though the current candidate passes.
The comparator must use semantic-specific limits (and print maximum position,
normal, and UV residuals separately), or both variants must be canonicalized
through the same Float32 bake and compared at an exact/ULP-level bound. The
limits should be derived from measured residuals with a narrow explicit margin;
the existing 2e-3 blanket limit must not remain.

### Confirmed blocker: the negative control removes batching but never corrupts geometry

The current negative control is `noopBatcher` (the check around lines 403-416):
it proves that removing the `batchStatic` call removes the draw reduction. It
does not prove that the triangle comparator rejects a changed candidate. No
position, normal, or UV is intentionally mutated and passed through the
comparison path.

Add a bounded corruption falsifier after the semantic comparator is tightened:
clone one harvested triangle, perturb one position by a value well above the
new position limit (or one UV by a value well above the UV limit), and assert
that comparison fails. Keep the existing no-op reduction control as a separate
check. This should exercise the actual comparison code rather than a source
regex or a hard-coded expected failure.

### Open proof-fixture issue: material map presence is incomplete

The proof fixture's `TEXTURED` set at lines 73-75 omits `capsuleWhite`, while
the real material library defines `capsuleWhite` with `map`, `roughnessMap`,
and `normalMap` (`src/core/materials.ts:815`). This makes the fixture's claim
that it mirrors material map presence incomplete. In this builder the searched
sites use `mat.painted(PAL.capsuleWhite, ...)`, and `painted()` supplies its
own maps, so this review does not claim that the omission changes the current
orange candidate. It still must be resolved before treating the fixture as a
general material-parity proof.

Minimum repair is to make the stub's slot mapping exact for every material key
encountered (including `capsuleWhite`), derive it from the same material
factory where practical, or add an explicit used-material audit that fails on
an unclassified map-bearing key. Keep map slots, UV-bearing roughness/normal
slots, transparency, and material identity distinctions separate; a single
dummy `map` flag is not a texture-pixel or renderer proof.

## Handoff boundary

**OPEN** — browser visual acceptance, renderer draw-call/resource bounds, and
the 13-station play/soak checks remain root-owned. This note supplies CPU proof
findings and minimum fixes only; it does not claim those runtime gates.
