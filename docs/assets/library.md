# Standalone asset library

Generated 2026-09-19 from the recovery tree
`C:\Users\david\Desktop\stuff\worktrees\nuketown-recovery-20260919`.
The machine-readable inventory is [library.json](library.json). It records local
paths, byte counts, SHA-256 values, provenance, licence evidence, runtime role, and a
state that keeps source, runtime, and subjective review separate. Bounded review outcomes
are recorded only when the evidence path is named; they do not imply photoreal quality
or an exact shipped build.

This audit contains 42 entries: 16 Kimodo GLB clips, 8 CMU fallback motion files, the
field-case GLB, the industrial barrel prop, the Quiver Tree GLB, the operator material
candidate, 4 PBR sets, the authored v3 audio bank, the recorded CC0 five-shot canary,
the recorded CC0 eight-file foley bank, the four-map foliage source, and 6
2D/reference targets. The old Atomic Acres checkout was not inspected. Secrets,
profiles, logs, source archives, and audition-only media are excluded from runtime
claims.

`sourceCommit` and `sourceCommitAnchor` are both the current dirty-tree anchor
`fb7151498ac8e826e3c1066484219420c3c7a8bc`. The previous inventory baseline was
`232e13bc48b5e9ba5607a566540ac55054131312`; it is retained in `library.json` because
older entries were measured against that baseline. `sourceDirty: true` means this is
an anchor only, not an exact shipped-build record. Root owns final copy, integration,
browser, GPU, listening, and visual review.

## State rules

| State | Meaning |
|---|---|
| `verified-source` | The file and its provenance evidence are present; runtime integration is not claimed. |
| `integrated` | Repository code explicitly references or loads the path; this says nothing about visual acceptance or exact shipped state. |
| `runtime-review-open` | The asset is present or wired, but root still owns runtime, performance, subjective, listening, or copy/integration review. |

## Inventory

| Entry | Local/runtime role | Bytes | State | Provenance and licence |
|---|---|---:|---|---|
| `prop/field-case` | `public/assets/field-case/field-case.glb`; original prop canary | 487,972 | `integrated` | Original Blender-authored geometry with five embedded maps; editable source and build receipt are recorded. Root viewed and accepted the current material response as modest for this canary; no photoreal claim is made. |
| `prop/industrial-barrel` | `public/assets/industrial-barrel/industrial-barrel.glb`; four cached blue drum clones with four colliders | 573,188 | `runtime-review-open` | Poly Haven `barrel_03`, CC0 1.0, one geometry, one material, and three embedded PBR maps. Root viewed four passing views and the exact 652-row full-collider proof passes with minimum gaps 0.561/0.460/0.716/0.569 m; barrel-specific player traversal and final promotion remain OPEN. |
| `prop/quiver-tree` | `public/assets/quiver-tree/quiver-tree.glb`; two native-scale desert-yard instances through one shared `InstancedMesh` draw | 3,526,860 | `runtime-review-open` | Poly Haven `quiver_tree_02`, CC0 1.0, one mesh/primitive/material, 37,500 triangles and three embedded 1k maps. The exact two-frame placement/render canary, CPU module evidence and Vite build pass; final visual-quality and placement-specific traversal review remain OPEN. The converter alias is intentionally absent. |
| `character/operator-material-candidate` | `src/characters/operator-materials.ts`; shared operator surface | 262,144 texture bytes | `integrated` | One shared material and one deterministic 256×256 DataTexture, zero normal maps, one draw per figure, and no extra draw from the candidate. The current front view reads only subtly; no quality acceptance claim is made. |
| `animation/kimodo/*` | 15 runtime 21-bone GLB clips | 392,764 | `integrated` | Local Kimodo SOMA-RP v1.1 generation and retarget route; attribution and licence are in `public/anim/LICENCES.md`. |
| `animation/kimodo/idle-rejected` | Retained generated comparison GLB; procedural idle remains runtime | 23,720 | `verified-source` | Kimodo output retained for evidence; rejected for runtime in `public/anim/LICENCES.md`. |
| `animation/cmu-fallback/*` | 8 offline `.anim.json` fallbacks; not loaded by the current Kimodo registry | 515,754 | `verified-source` | CMU and three.js sample evidence are preserved in `public/anim/manifest-cmu.json` and `public/anim/LICENCES.md`. |
| `texture/polyhaven/*` | Sparse Grass, Asphalt 07, Concrete Pavement 03, Distressed Painted Planks PBR trios | 8,448,182 | mixed | Poly Haven, CC0 1.0. Local and source evidence are in `public/textures/polyhaven/manifest.json`; per-file hashes are in `library.json`. Sparse Grass remains rejected for the current lawn treatment. |
| `texture/vegetation/island_tree_01_leaves` | Four 1k leaf maps for alpha-tested cards and compact tree crowns | 5,462,812 | `runtime-review-open` | Poly Haven `island_tree_01`, CC0 1.0. Exact bytes, SHA-256, source URLs and source MD5 values are in `public/textures/vegetation/manifest.json`. Correction 3 is wired and its modest silhouette was viewed and accepted; it still reads topiary and carries no photoreal claim. The canary remains bounded at 19,760 triangles and five static draws. |
| `audio/authored-bank-v3` | 21 44.1 kHz mono weapon, cue, footfall and weather WAV files | 1,202,204 | `runtime-review-open` | Deterministic synthesis from `src/audio/render-bank.mjs`; no external samples. Service mappings and the stock-browser lifecycle are verified at 21 decoded buffers, five recorded shots, and eight recorded foley cues; ear quality remains OPEN. |
| `audio/recorded-cc0-5shot-canary` | `public/audio-recorded/rec-shot-<family>.wav` five-shot source pack with authored fallback; audition is `docs/audio-auditions/recorded-guns.wav` | 502,960 | `runtime-review-open` | CC0 1.0 evidence is in `public/audio-recorded/manifest.json`; audition SHA-256 `896d93968295a4f1494bb828b4b2c2d1b1b27a04b23baee8e221a3cd6af69e4f`. The 11-check lifecycle and live remote-miss presentation pass; ear quality and source clipping remain OPEN. |
| `audio/recorded-cc0-8foley` | Eight recorded step/reload cues under `public/audio-foley`; audition is separate | 294,836 | `runtime-review-open` | OpenGameArt source packs, CC0 evidence, transforms, source members and exact per-file hashes are in `public/audio-foley/manifest.json`. The service lifecycle decodes all eight inside the 21-buffer bound; gameplay surface mapping and ear quality remain OPEN. Source archives are provenance-only. |
| `reference/imagegen/*` | 125 generated 2D concept, photoreal, and light/material studies | 187,664,719 | `verified-source` | Generated for this project and recorded by the collection manifests. These are look targets only, never 3D assets, geometry, textures, or reconstruction inputs. |
| `reference/field-case-material-target` | `docs/reference/refinement-targets/field-case.png`; material proposal | 2,003,027 | `verified-source` | 2D target linked to its recorded receipt and source-frame provenance; the runtime field-case pass was viewed as modest, with no photoreal acceptance claim for the target or prop. |
| `reference/viewmodel-material-closeup` | `docs/reference/refinement-targets/viewmodel.png`; close-up cloth/glove/wood/steel direction | 1,417,788 | `verified-source` | 2D target only. `docs/viewmodel-materials.md` is recorded as the procedural PBR recipe with exact hash/bytes; the factory is wired and the 11-pose browser capture passed, while gun alignment remains OPEN. This is not photogrammetry or a texture source. |
| `reference/yard-white-foliage-target` | `docs/reference/refinement-targets/yard-white.png`; foliage silhouette and yard-light target | 1,707,762 | `verified-source` | 2D target only, with `provenance.json` hash/bytes recorded; correction 3 was viewed as a modest silhouette but still reads topiary. The target does not authorize geometry extraction or a photoreal runtime claim. |

The PBR state split is deliberate. `asphalt_07`, `concrete_pavement_03`, and
`distressed_painted_planks` are source-wired in `src/core/materials.ts`, with runtime
review still open. `sparse_grass` is source-verified but **rejected for this lawn**
after the root capture read as broad tufts, bare soil, and small conifers; the softened
procedural turf fallback remains the active direction.

## Provenance details

The Kimodo model is local at
`C:\Users\david\projects\kimodo.cpp\weights\models\kimodo-soma-rp-v1.1-f32.gguf`
with recorded SHA-256
`3bf1229f4c1eff1d28f5196a854113da2df9a11a5e21c60694630903bf948ee4` and size
1,133,166,784 bytes. The LLM2Vec conditioning bundle remains outside the repository.
No weights, embeddings, or raw motion are shipped. The project licence record requires
the game attribution **Built with Meta Llama 3** and **Motion: NVIDIA Kimodo SOMA-RP
v1.1 (NVIDIA Open Model License)**.

The field case has an editable Blender source and a byte-pinned GLB. Its build report
records 3,608 triangles, 3 materials, five embedded maps, and the exported
0.919 × 0.515 × 0.564 m bounds. Root viewed the runtime front, side, and three-quarter
material pass and accepted its modest response for this canary. The result carries no
photoreal claim; `captures/field-case-material/result.json` is the runtime evidence.

The authored audio bank v3 manifest records seeds, peaks, RMS, durations, and hashes
for all 21 WAV files. The service lifecycle evidence in
`captures/audio-lifecycle-rerun.txt` verifies one bounded 21-buffer bank with five
recorded shots and eight recorded foley cues, two ambient loops, and a 16-voice
transient cap. The separate recorded five-shot pack is CC0 evidence under
`public/audio-recorded`; the root service requests its recorded-shot path and falls
back to the authored bank. Its audition-only concat is
`docs/audio-auditions/recorded-guns.wav` (626,264 bytes, SHA-256
`896d93968295a4f1494bb828b4b2c2d1b1b27a04b23baee8e221a3cd6af69e4f`). The eight-file
recorded foley pack remains a separate gameplay-mapping candidate under
`public/audio-foley`; its audition-only concat is
`docs/audio-auditions/recorded-foley.wav` (448,878 bytes, SHA-256
`463f8f202f07dc6c3e5f166810be4382c76d83da7e3678555a6d0dc901552ff8`). The live
remote-miss presentation is recorded in
`captures/remote-audio-live-fixed.txt`; ear quality and source clipping remain OPEN.

The industrial barrel source is Poly Haven `barrel_03` under CC0 1.0, imported as
`public/assets/industrial-barrel/industrial-barrel.glb` (573,188 bytes). The cached
master is one geometry, one material, and three embedded maps; the live module places
four clones and returns four colliders. Root viewed the weathered blue PBR drum in
four passing views. The exact full-collider proof passes against all 652 rows in
`docs/verification/2026-09-19/collider-snapshot.json`, excluding only each placement's
own row and retaining the other barrel rows; minimum gaps are 0.561, 0.460, 0.716,
and 0.569 m. Barrel-specific player traversal remains OPEN, so this is not a final
placement or photoreal acceptance claim. Evidence: `captures/checkpoint-g-barrel-full-proof.txt`
and the exact snapshot fixture.

The Quiver Tree source is Poly Haven `quiver_tree_02` under CC0 1.0. The single
shipped file `public/assets/quiver-tree/quiver-tree.glb` is 3,526,860 bytes with
SHA-256 `2d65c167548c1d4d47d56ae457516cc074bc18a5fb22d67ac03604f2fe6c546e`.
The CPU audit measured one identity-transform scene node, 37,500 triangles, 25,488
position vertices, one PBR material, and three embedded official 1k maps. Root wires
`preloadQuiverTree()` and `buildDesertTrees` from `src/main.ts`; the two-placement
module capture and Vite build pass, while the live visual/traversal decision remains
OPEN. The source conversion, generation hashes, native bounds and collider policy
are recorded in `docs/quiver-tree-integration.md` and the `prop/quiver-tree` entry
in `library.json`. The converter alias output `quiver_tree_02.glb` is absent and is
not a runtime or library artifact.

The operator material candidate is wired through the shared material library. It uses
one deterministic 256×256 DataTexture (262,144 RGBA bytes), one shared material, no
normal map, and one draw per figure, with no extra draw introduced by the candidate.
Root's current front view reads the detail only subtly; no quality acceptance claim is
made. Evidence: `src/characters/operator-materials.ts`, `src/core/materials.ts`,
`src/main.ts`, and `captures/operator-material-run.txt`.

The foliage maps are four CC0 Poly Haven leaf channels totaling 5,462,812 bytes. The
current tree canary records 19,760 world triangles, five static draws, ten placements,
and unchanged gameplay colliders in `docs/tree-canary.md`. Root viewed correction 3
in the noon capture and accepted its modest silhouette; the trees still read topiary,
so no photoreal foliage claim is made.

The viewmodel close-up is a 1,376 × 768 generated 2D target. Its associated
`docs/viewmodel-materials.md` describes a four-material, twelve-DataTexture procedural
cache and is a recipe for authored materials. The factory is wired and the root
stock-browser capture passed all 11 bounded poses in `captures/hand-poses/result.json`;
gun alignment remains OPEN. The target must not be treated as captured surface data,
photogrammetry, or a 3D reconstruction. The yard-white image is likewise a 1,376 × 768
visual target only.

The gait capture verifies that the live path selects `run` for explicit 4.8 m/s jog
and `sprint` for explicit 6.6 m/s sprint. The corrected prone leg surfaces are covered
by the source proof and the live capture selects `prone-crawl`; gun alignment remains
OPEN. These are separate runtime and subjective claims, recorded in
`captures/gait-poses/result.json`.

Imagegen collections are explicitly 2D references. Their prompts and generation routes
remain in `docs/reference/concept/manifest.json`, `docs/reference/concept2/manifest.json`,
and `docs/reference/photoreal/MANIFEST.md`; no image is treated as a mesh or as evidence
that a 3D reconstruction exists.

## Refinement queue

1. Keep source/service integration for `audio/authored-bank-v3` and complete the remaining live ear-quality review.
2. Review the five `audio/recorded-cc0-5shot-canary` sounds for ear quality and source clipping, retaining the authored fallback.
3. Listen to `audio/recorded-cc0-8foley` and choose hard/grass/gravel gameplay mappings; keep the audition file and source archives out of runtime.
4. Keep `texture/vegetation/island_tree_01_leaves` correction 3 at 19,760 triangles and five static draws. Its modest silhouette is accepted, while the topiary read and photoreal quality remain OPEN; preserve the existing ten colliders and positions.
5. Keep the rejected Sparse Grass files for provenance, but continue with the procedural turf fallback unless a new looked-at capture justifies a change.
6. Preserve the field-case topology and modest material pass; no photoreal acceptance is implied by the target image.
7. Keep `reference/viewmodel-material-closeup` as recipe guidance. The factory is wired and the 11-pose browser capture passed; gun alignment remains OPEN.
8. Keep `reference/yard-white-foliage-target` as a comparison target for the already viewed tree correction; do not infer geometry or a photoreal claim from it.
9. Retain the gait proof for explicit 4.8 m/s jog and 6.6 m/s sprint plus corrected prone legs; gun alignment remains OPEN.
10. `docs/ASSET-PIPELINE.md` describes a coach pipeline, but `public/assets/coach.glb` is absent from this recovery tree. Treat that as a future candidate, not an existing asset.
11. Keep the industrial barrel source and four-collider integration; the exact full-collider proof passes, while barrel-specific player traversal and final promotion remain OPEN.
12. Keep the wired operator material candidate under review. Its one shared 256×256 texture and one-draw figure path are bounded, while the subtle front-view response and overall quality remain OPEN.
13. Keep the single-file Quiver Tree canary wired through the root preload and builder; the two placement/render frames pass and were viewed, while final visual-quality and placement-specific traversal remain OPEN.
