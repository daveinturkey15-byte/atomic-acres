# Workbench local-3D readiness — 27 September 2026

VERIFIED — read-only inspection and editable graph preparation only. No upload,
prompt submission, model loading/download, service action, generation, browser,
Blender, owner-process termination or public runtime asset change occurred.
The three new files are this report and `scripts/art-gen/openpass-workbench-prepare.py/json`.
The JSON is explicitly **HELD_NOT_SUBMITTED**, contains a deliberately unresolved
input placeholder, and is not an API submission envelope.
The owner has authorized the local canary once resource, model and image gates
pass; `submissionAdmitted: false` records current readiness, not missing permission.

## Source and edit provenance

VERIFIED — original `references/garden-workbench-v1.png` remains byte-preserved:
SHA256 `374f50678c055d14a85a5341537e8247e696e13b2dcecb0a933e470fde638612`.
Its original prompt and reference-first brief are retained in
[GARDEN-WORKBENCH-BRIEF-2026-09-26.md](GARDEN-WORKBENCH-BRIEF-2026-09-26.md).

VERIFIED — derived `references/garden-workbench-cutout-openpass-take1.png` is
1536×1024 RGBA, SHA256
`906f891a1968a3877b0aa94cc69a8927c6f39a57f803323a955d846abf6d9ad7`.
Both images were opened and visually inspected. The cutout keeps the sage frame,
ivory top, yellow cabinet and three terracotta planters. Exact geometric identity
and edge quality are not established by that observation.

CLAIMED — root reports built-in `image_gen.imagegen`, a transparent edit referencing
only the original local image, with `transparent_background: true`; no
`num_last_images_to_include` or other reference paths. The native output was
`C:/Users/david/.codex/generated_images/01a0d280-ae84-7872-bb76-972e6dd98e55/exec-491fbde8-769d-438e-973d-1d64fb7627c2.png`,
then byte-copied into this project. That native output was not independently
rehashed in this lane.

OPEN — the exact edit prompt was lost from root's compacted context. The following
is **root's intended-instruction paraphrase, not a verbatim tool prompt**:
remove only the gray backdrop and floor shadow; preserve the exact object,
style, camera and established invariants; output transparency. No invented exact
prompt or retrospective seed is recorded.

## Alpha inspection and proposed mask branch

VERIFIED — alpha ranges from 0 to 254. Of 1,572,864 pixels, 975,098 have alpha 0;
1,003,213 are <=8; 540,359 are >=250; 57,407 are between 1 and 249. A sampled
102,000-pixel lower open-leg region has maximum alpha 1 (only 186 nonzero pixels).
The sampled floor has maximum 1, with 12 nonzero pixels out of 86,400. The faint
green backdrop visible in the raw RGB is therefore largely beneath transparent
pixels, rather than an opaque filled background.

VERIFIED — faint alpha specks expand the any-alpha bounding box to
`[0,9,1457,997]`; the >=205 foreground box is `[133,33,1395,951]`. There are
4,581 partially transparent pixels more than eight pixels from the >=250 region;
489 of these have alpha >8. These are diagnostic counts, not automatically
defects: some may be fine leaf edges. No thresholding, alpha normalization,
colour cleanup or re-export was performed.

OPEN — sampled negative space supports this as a candidate mask, not an
image-ready or art-accepted input. Inspect the actual Comfy crop composite and
leaf/leg edges on contrasting backgrounds before admitting generation. Alpha
max 254 also means the strongest foreground is slightly translucent; do not
silently rewrite it or call the mask perfectly opaque.
The intended edit was background/shadow removal only. The alpha specks/bounds,
leaf-edge fringes and any object changes therefore need comparison against the
original before upload; this is a content-readiness check within the existing scope.

VERIFIED — official version-pinned source and live schemas support this branch:

```text
LoadImage IMAGE[0] --------------------------> ImageCropToMask.images
LoadImage MASK[1] --> InvertMask MASK[0] -----> ImageCropToMask.masks
ImageCropToMask IMAGE[0] --------------------> Trellis2Conditioning.image
```

VERIFIED — [LoadImage v0.37.0](https://github.com/Comfy-Org/ComfyUI/blob/v0.37.0/nodes.py)
returns inverse alpha; [InvertMask](https://github.com/Comfy-Org/ComfyUI/blob/v0.37.0/comfy_extras/nodes_mask.py)
inverts that back to foreground alpha. [ImageCropToMask](https://github.com/Comfy-Org/ComfyUI/blob/v0.37.0/comfy_extras/nodes_images.py)
uses foreground alpha for crop/compositing, thresholds its bounding-box search
above 204/255, and composites RGB with the mask. Fully transparent RGB halos
contribute nothing to that composite. Its fallback auto-inversion is not relied on.
The draft uses 1024×1024, pad_factor 1.0 (the current TRELLIS conditioning tooltip),
grow_mask 0 and black background. This is a verified input convention; the node
was not executed here. Official source file SHA256s are recorded in the JSON.

VERIFIED — targeted conditioning-path review at 12:08Z confirms the pinned
`_crop_image_with_mask` computes `RGB * foregroundAlpha + background *
(1 - foregroundAlpha)`. `ImageCropToMask.execute` resizes and returns this
composite; node15 consumes node13's IMAGE output, not the original unmasked RGB.
No extra compositor or graph repair is needed. Source SHA256
`5bc0a44ee22469506d5c86fccde5f4973d156b2356e0ced6a779d1299b0f1acf`
was rechecked. The graph and original/derived input bytes were unchanged.

VERIFIED — CPU arithmetic using the actual retained RGBA pixels found all
975,098 fully transparent pixels contribute exactly zero RGB on black and
produce exactly white on white. In the sampled lower open-leg region, the
black composite peaks at 0.2902/255 and white deviates by at most 0.9922/255.
Thus the sampled opening is not filled by the hidden green RGB. These tests
implement the inspected equation with NumPy; they do not execute Comfy's
crop/interpolation or conditioning. `compositeSemantics` preserves the preceding
draft receipt hash and records the results. Partially transparent leaf fringes
still contribute their weighted RGB. Extraction of every opening, final crop
pixels and absence of visible fringe remain OPEN; this is not input acceptance.

## Current endpoint versus retained history

VERIFIED — at `2026-09-27T12:04:15Z`, the live loopback8188 service reports
ComfyUI0.37.0 / PyTorch2.14.0+cu130, with zero running and pending jobs. An earlier
11:36 saved receipt had one running job; it is not overwritten or called current.
No queue IDs, queued workflows or owner input filename list were retained.

| Component | Current server-resolved name presence | Load/hash/license state |
|---|---|---|
| `trellis_2_int8_convrot.safetensors` | VERIFIED present | OPEN |
| `trellis_2_shape_vae_bf16.safetensors` | VERIFIED present | OPEN |
| `trellis_2_texture_vae_bf16.safetensors` | VERIFIED present | OPEN |
| `dino_v3_vit_l.safetensors` | VERIFIED present | OPEN |
| `pixal3d_int8_convrot.safetensors` | VERIFIED absent | Pixal route held |
| `moge_2_vitl_normal_fp16.safetensors` | VERIFIED absent | Pixal route held |
| `birefnet.safetensors` | VERIFIED absent | Existing BiRefNet recipe held |

VERIFIED — owning listener PID13984 resolves to the uv CPython3.11 executable,
launched with relative `main.py`; no `--models-directory` appears. The process
working directory is unresolved. `psutil` is unavailable in both the current
Python and that existing interpreter; no package was installed and no broad
weight search or unrelated configuration read was attempted.

OPEN — actual model roots and extra paths, weight content hashes, loadability,
model revisions and each component's license remain unresolved. Node/name
presence does not establish readiness. DINOv3 and packaged weights must not
inherit the application code's license by assumption.

VERIFIED — actual `nvidia-smi` at the receipt reported **1,848MiB free**, 14,130MiB
used, 30% utilization. Comfy's own allocator-free value is not used as whole-GPU
headroom. This is below the project's 4GiB reserve. The earlier retained TRELLIS
profile peaked at 15,759/16,303MiB total GPU use; an empty queue does not admit
another heavy job. No owner workload was stopped or offloaded.

## Editable graph and remaining gates

VERIFIED — the 51-node editable API draft is derived from the current project's
pure `trellis_workflow` builder; builder path/hash and all selected schema inputs
are retained. It replaces the unavailable BiRefNet branch with explicit alpha
inversion. Changes are declared: crop padding1.0, game target20k faces, 1K atlas/
base, 512 normal/AO, with the 700k raw sculpt branch retained. Sampling seeds,
steps and 1536 shape upsample remain the existing recipe's values. This is an
explicit TRELLIS alternative proposal; it does not silently fulfil the earlier
Pixal preference.

VERIFIED — locally checked required fields, primitive types/ranges, enum/model
choices, selected dynamic-combo subfields and connected output types match live
schemas. LoadImage's placeholder is deliberately deferred. The first checker
incorrectly rejected two SaveGLB union sockets; its failure/hash is preserved in
`preUnionValidation`. It was corrected against the pinned upstream
[union-type validator](https://github.com/Comfy-Org/ComfyUI/blob/v0.37.0/comfy_execution/validation.py).
Negative probes still reject width1 and IMAGE-to-MASK wiring. This is not server
`/prompt` validation, inference, export success or a readiness grant.

OPEN — resource admission and scale-sensitive AO/cage values require review;
the retained20-iteration smoothing and small-component filter may damage thin
leaves/legs. No speculative silent parameter correction was made. The cutout's
camera does not establish the back/underside, and a generator may invent panels
or fuse the open leg space.

OPEN — retain the original brief: one rigid workbench1.8×.65×1.2m; no gameplay/
collision change; <=20k **export-parsed** triangles, six added draws including
shadow contribution, <=2K textures, <=12MiB measured incremental runtime memory
including mipmaps. A 20k decimation request and 1K textures alone do not prove
those limits. Source sculpt, editable correction source, optimized GLB, UV/map
inspection, neutral front/side/rear/underside/orbit, fixed in-game cameras,
resource/disposal/resize/mobile proof and owner acceptance are separate gates.
The initial plus at most two defect-directed repairs and preserved rejected
takes remain the budget. All generation/export/game-pixel/owner gates are OPEN.
