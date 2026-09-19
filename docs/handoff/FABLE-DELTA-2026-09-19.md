# Fable delta audit — 2026-09-19

Read-only recovery comparison of the original checkout, its named 08:51 snapshot,
and the recovered standalone root. This audit read only the named project, source,
docs, and asset paths; it did not read sessions, logs, profiles, or `.claude` data.
No runtime file was changed.

## Anchors

- **VERIFIED original:** `C:\Users\david\Desktop\stuff\nuketown`, branch
  `layout-boii-proportions`, `HEAD 56d2f46` (`HANDOFF 12:45`). The commit after
  `b1a3100` changes only `docs/HANDOFF.md`; `git diff b1a3100 HEAD --stat` has one
  file and 16 inserted lines. Runtime changes after the snapshot are therefore dirty
  working-tree evidence, not a committed original release.
- **VERIFIED snapshot:**
  `C:\Users\david\Desktop\stuff\nuketown-recovery\20260919T085155Z\snapshot`.
  `refs.txt` records the `b1a3100` branch anchor. File hashes below are direct byte
  comparisons against this source snapshot.
- **VERIFIED recovered root:**
  `C:\Users\david\Desktop\stuff\worktrees\nuketown-recovery-20260919`,
  `HEAD fc8c4c8` (`recovery/wave7-20260919`).

The original 12:45 handoff says the z-fight, atmosphere, animation, and photoreal
lanes were partial and relaunched. The recovered root has later integrated versions of
the environment and animation systems, so those lane labels are historical evidence,
not an instruction to import the old project.

## Original-only deltas after the snapshot

| Path | Snapshot | Original current | Recovered root | Status |
|---|---|---|---|---|
| `src/characters/blend.ts` | SHA-256 `0c903f37563b` | `bfd2e52e002a` | `01d22380c69c` | **OPEN — runtime patch missing from root** |
| `public/anim/idle.glb` | absent | 23,720 bytes, SHA-256 `27c8b8a48750dc...` | exact same bytes | **VERIFIED incorporated** |
| `public/anim/LICENCES.md` | SHA-256 `dd3382439588` | `29c0458877c0` | `dd3382439588` | **OPEN — documentation only** |
| `scripts/animation/capture-anim-sheets.mjs` | `57f2803dea4f` | `be9358a2df24` | `57f2803dea4f` | **OPEN — QA tooling only** |
| `scripts/animation/surface-audit.mjs` | `ed809d14742d` | `4ddfbe615b37` | `ed809d14742d` | **OPEN — QA tooling only** |

### `src/characters/blend.ts` — runtime delta

**VERIFIED original change:** the original current file adds shared `_qPitch`,
`_qRecoil`, and `_eScratch` objects and builds those twists once per frame instead of
allocating quaternions/Eulers inside the upper-body bone loop. It also reuses the
stored `footPrev` vector with `.copy()` instead of cloning a vector every frame.
The source-to-source delta is 25 additions and 12 deletions.

**OPEN recovery gap:** the recovered root's current file still contains the per-bone
`new THREE.Euler(...)` calls and `this.footPrev.set(side, this.footWorld.clone())`.
The root has a richer prone/sprint blend implementation, so copying the original file
wholesale would regress features. Port only the scratch-quaternion and vector-reuse
changes into the root's newer blend tree, then rerun the existing animation and heap
proofs.

### `public/anim/idle.glb` — restored asset

**VERIFIED:** the snapshot lacks `idle.glb`; original and recovered root both contain
the identical 23,720-byte file with SHA-256
`27c8b8a48750dc034b24840914c741f20ff0768e6585f24a5a064a970f942b96`. The current
original licence note says it is dead/unloaded and absent from `manifest.json`; this
is a restored on-disk asset, not proof that runtime fetches it.

### Animation QA and licence evidence

**VERIFIED:** the original `capture-anim-sheets.mjs` adds a collider-scored camera
search, a shutter-time re-aim, and explicit subject/camera telemetry. The recovered
root still has the earlier fixed-position chooser. The original `surface-audit.mjs`
adds `--expose-gc`, response/request-failure URL tracking, burst sampling, post-GC
heap floors, and a bounded slope window. The recovered root still has the earlier
live-heap measurement. These are useful verifier improvements but are not shipped
runtime code.

**OPEN:** original `public/anim/LICENCES.md` adds the restored-idle explanation,
round-3 animation measurements, transfer-error values, and updated sprint/aim notes.
The recovered root contains the older licence page. The root's separate
`docs/animation-refinement.md` records the newer prone/sprint contract, so this is an
evidence-document reconciliation rather than an asset loss.

## Files checked with no original-only runtime loss

**VERIFIED exact across snapshot, original current, and recovered root:**
`src/build/ground.ts`, `src/build/orange-house.ts`, `src/build/surround.ts`,
`src/build/third-house.ts`, `src/core/palette.ts`, and `src/core/world.ts`.

**VERIFIED root supersedes the original snapshot:** the recovered root's
`src/build/yards.ts`, `src/core/atmosphere.ts`, `src/core/materials.ts`, and
`src/core/post.ts` contain later integrated vegetation/fence, rain shelter and smoke,
material-library, and AO/MRT changes. The original current copies equal the snapshot
for these files, so there is no later original-only delta to reconcile. The original
`src/characters/anim-qa.ts` and `src/characters/system.ts` also equal the snapshot and
omit the prone/sprinting QA/input additions present in the recovered root; preserve
the root versions.

**VERIFIED path coverage:** every original dirty/untracked path under `src/`,
`scripts/`, and `public/` checked for this audit exists at the same relative path in
the recovered root. The hash comparison above identifies the content differences;
there is no path-only missing runtime file in this bounded set.

## Handoff conclusion

- **INCORPORATED:** restored `idle.glb`; environment, AO/post, materials, yards, and
  prone/sprint system work are present in newer recovered-root forms.
- **NOT to copy wholesale:** original `anim-qa.ts`, `system.ts`, and old environment
  files are older or less capable than the recovered root.
- **OPEN and actionable:** port the two allocation reductions from original current
  `src/characters/blend.ts` into the root's newer blend implementation.
- **OPEN and optional:** reconcile the three animation QA/licence documents if those
  newer measurements are needed for future acceptance. They do not change the frozen
  runtime artifact.
- **DOCUMENTATION delta:** original `docs/HANDOFF.md` includes the 12:45 relaunch
  paragraph; recovered `docs/HANDOFF.md` stops at the 09:27 build, while
  `docs/handoff/CURRENT.json`, `CAMPAIGN-2026-09-19.md`, and
  `INSPECTION-2026-09-19.md` carry the later recovered checkpoint state.

## Allocation reduction port — current root candidate

**VERIFIED:** the two original `src/characters/blend.ts` allocation reductions are
now ported into the recovered root's newer blend tree without replacing its prone or
sprint logic. The candidate source SHA-256 is
`5e7a07a8d67b9e87324294e36349c603e5461f5686e83320eee0915058dd3a2d`; the frozen
baseline source at `fc8c4c8` is
`7b8bbffca8d8ef64a97e29ea0bd0b5a3bc1501e7b636d0fabb89d6d6b8f245da`.

**VERIFIED CPU proof:**
`node scripts/animation/verify-blend-allocation-equivalence.mjs` bundled the actual
baseline and candidate modules and exercised the real `CharacterRig`, skeleton, and
clip library through walk, run, sprint, crouch, prone, normal aim, tiny positive and
negative aim, and fire states for 72 frames per state. All 648 frames preserved
locomotion labels, bone quaternions and positions, and foot metrics with
`maxFloatDiff: 0` (threshold `1e-6`).

**VERIFIED allocation delta:** the targeted upper-body loop changed from 2 to 0
`new THREE.Quaternion(...)` sites and from 2 to 0 `new THREE.Euler(...)` sites. The
foot path now clones only on first observation per foot and copies into the retained
vector thereafter. Total source counts changed from 9 to 9 quaternion constructors
and 2 to 1 Euler constructors; this proof deliberately makes no claim that the
whole rig has zero allocations.

**OPEN:** root still needs to run its current browser/build/soak gates after this
runtime edit. The edit is frozen for that build; no further animation source changes
are part of this handoff.
