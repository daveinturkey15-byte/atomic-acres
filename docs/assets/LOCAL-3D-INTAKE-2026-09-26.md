# Local reference-to-3D intake — 26 September 2026

**VERIFIED — scope:** read-only inspection of shared recipes, retained Skills Lab assets and current local service availability. Only this report was authored by this intake task. No generation, downloads, service starts, model unloading, process termination or shared Blender changes occurred. Measurements below are a snapshot, not admission for a later job.

## What the newer evidence establishes

| Claim state | Evidence | Consequence |
|---|---|---|
| VERIFIED | Skills Lab HEAD `818ab6a` (24 September), `docs/local-model-library.md`, retained `local-assets/model-library/generation-studies/ember-baby-pixal3d-raw.glb` and adult/omega TRELLIS studies | The newer library includes both routes. These files are separate from the older garden showcase. |
| VERIFIED | Garden GLB SHA256 `a135003ca97f68f4692684fa10a94421818046ce633b775612b2e71a3e2f9c25`; parsed today: 8,148 triangles, 61 mesh primitives, three materials, four images | A real retained model exists. Its 61 primitives would need consolidation before this task's six-draw limit. |
| CLAIMED, corroborated by retained files | Garden catalog method: Blender 5.1.2 primitive authoring, deterministic script, CPU weave/fBm maps; recovery report records successful browser GLB loads | Garden success demonstrates an authored asset and gallery pipeline; it does not demonstrate Pixal/TRELLIS generation. |
| VERIFIED | Opened retained `previews/props--props-garden-set-r1.png`, SHA256 `949b015b12dbe88b5adea2658f8a17ba2c4c6238c30dd4705ff48824a3aef66c` | Table, chairs and red parasol are visibly present. The catalog still records `qualityAcceptance: OPEN`; no fresh render or owner acceptance was performed. |
| CLAIMED, historical | AKP `references/reference-to-3d-transfer-2026-09-24.md`: Baby Pixal and adult/omega TRELLIS source sculpts, fitted rigs, exports and runtime evidence; art rating 2/4 against a 3/4 bar | These later receipts prevent carrying September 19's missing-MoGe diagnosis forward as a current fact. Successful conversion and accepted art remain different gates. |

**VERIFIED — sources inspected:** `C:/Users/david/Desktop/stuff/skills-lab/docs/blender-recovery-2026-09-20.md`, `docs/evidence/blender-recovery*.json`, `public/assets/world-studio/blender/props/catalog.json`, `docs/local-model-library.md`; this repository's [earlier hero-prop canary](../reference/library/hero-prop-canary-2026-09-19.md) and [recipe](../reference/library/hero-prop-recipe.md). The gallery uses Three 0.185.1; Atomic Acres uses 0.180.0. Gallery success cannot substitute for Atomic Acres integration.

## Current machine and service availability

**VERIFIED — 26 September, approximately 20:00–20:15 UTC:** HTTP requests to `127.0.0.1:8188`, `:8189` and `:8190` refused connections. No listeners were found on 8188/8189/8190/8000 and no Python/Comfy process matching ComfyUI was found. This is bounded discovery, not proof that an unknown service cannot exist elsewhere. `/system_stats`, `/object_info`, `/queue` and server-resolved `/models/<folder>` could not be obtained.

| Claim state | Snapshot |
|---|---|
| VERIFIED | RTX 5080: 16,303 MiB total, 10,670 MiB used, 5,308 MiB free, 39% utilization |
| VERIFIED | Physical RAM: approximately 63.6 GiB total / 32.4 GiB free; system commit approximately 56.9 / 95.6 GiB |
| VERIFIED | High performance power plan active; native Codex adoption `check` passed and `audit` emitted no row naming Codex on dave-gaming-pc |
| OPEN | Running Comfy version, actual model roots/names/hashes, native node schemas, queue state and generation resource headroom |

**OPEN — admission:** do not run or install anything from this snapshot. Restore or identify the owner-managed endpoint through the coordinating task, then perform fresh read-only preflight. A filesystem weight name alone does not establish what the server can load.

## Recipe comparison and prerequisites

**VERIFIED — current upstream documentation:** [TRELLIS.2](https://docs.comfy.org/tutorials/3d/trellis2) and [Pixal3D](https://docs.comfy.org/tutorials/3d/pixal3d) describe native Comfy nodes sharing TRELLIS VAEs and a DINOv3 encoder. Pixal's single-view branch additionally uses camera-aware conditioning and MoGe. The Pixal page now also describes a **separate multiview model/template**; a turnaround sheet must not be fed into the old single-view recipe and called multiview reconstruction.

| Expected component, subject to live schema validation | Single-view Pixal | TRELLIS |
|---|---|---|
| Diffusion model | `pixal3d_int8_convrot.safetensors` | `trellis_2_int8_convrot.safetensors` |
| Shared VAEs | `trellis_2_shape_vae_bf16.safetensors`, `trellis_2_texture_vae_bf16.safetensors` | Same |
| Vision encoder | Compatible DINOv3 entry resolved from the live loader | Same |
| Camera estimation | `moge_2_vitl_normal_fp16.safetensors` | Not required by the existing repository branch |
| Object mask | Compatible BiRefNet, or a separately validated alpha/mask bypass | Same |
| Current local availability | OPEN for every component | OPEN for every component |

**VERIFIED — local workflow:** [comfy_trellis.py](../../scripts/art-gen/comfy_trellis.py) implements the historical TRELLIS branch and receipts, not a complete Pixal or new multiview branch. Its 8 GiB free-VRAM threshold is only an existing guard. The retained September 19 canary reports a 346.4-second generation with **15,759 / 16,303 MiB whole-GPU peak**, then a 20.1-second cached texture-tail correction. That shorter rerun is not a new generation benchmark. The crate was rejected for baked color shards, wrong proportions/back/underside and excess runtime cost. Today's approximately 5.3 GiB free cannot admit that profile.

**OPEN — preflight for the next pass:** retrieve live stats/argv and any extra model paths; exact required `/object_info` schemas, including dynamic combo keys; empty running/pending queues; server-visible model names; pinned model hashes and each component's upstream license. Do not inherit a blanket MIT claim across DINOv3 and repackaged weights. Record physical RAM, commit headroom and GPU occupancy before each submission. Use an explicitly measured profile that preserves declared reserves; unknown readings, a busy owner queue or a profile that does not fit mean hold. No silent lower-resolution substitution or process termination.

## One project-owned canary

**VERIFIED — selected reference:** [garden-workbench-v1.png](references/garden-workbench-v1.png), 1,712,922 bytes, SHA256 `374f50678c055d14a85a5341537e8247e696e13b2dcecb0a933e470fde638612`. Inspected today: sage frame, ivory worktop/back lip, yellow cabinet and three terracotta plants. **CLAIMED — creation provenance:** root reports generating this original image with built-in image generation. It is concept art, not an existing mesh.

**OPEN — proposed route:** one static garden workbench, target 1.8 × 0.65 × 1.2 metres. Begin with the live-validated **single-view Pixal** route because the selected input is one image; preserve workflow/model/input hashes, seeds and all raw outputs. Require a complete visible frame, open leg space, separate plant silhouettes, straight cabinet/worktop edges and a plausible rear/underside. Missing Pixal prerequisites hold this route; TRELLIS is an explicitly recorded alternate experiment, not an automatic fallback. Thin foliage and open metal legs are likely reconstruction defects to inspect. Repair mechanical parts in a new project-owned editable source if necessary, preserving the original generation; do not modify another agent's Blender scene.

**OPEN — frozen proposed acceptance budget:** one canary, at most three submissions (initial plus two defect-directed repairs), at most 10 minutes per submission / 30 minutes total GPU execution. Stop on resource failure, repeated defect or plateau; a timeout does not authorize a blind resubmit. Preserve all rejected takes. Runtime limit: **20,000 triangles, six additional draws including shadow contribution, 2K maximum texture dimension, 12 MiB incremental runtime memory**, with no collision/gameplay changes. The 2K limit is a ceiling: three uncompressed 2K maps exceed the memory budget. Start from a measured texture allocation such as 1K base plus 512 normal and packed ORM (~8 MiB with RGBA mipmaps), leaving room for geometry; verify actual allocation rather than compressed GLB size.

**OPEN — Dream/Gauntlet completion gates:** retain editable source, source sculpt, optimized GLB, exact concept/workflow/model provenance and file-parsed geometry/texture totals. Inspect neutral front/side/rear/three-quarter/underside and a full orbit, then the same fixed Atomic Acres cameras under current authored lighting. Name one visible defect per revision and compare paired frames; use a fresh blind critic where available. Check actual runtime draws, memory/disposal, resize and target mobile behavior. Keep selected concept identity and mechanics frozen. Export, loading, visual acceptance and owner acceptance are separate outcomes. This intake produces none of those outcomes yet.

**VERIFIED — shared workflow consulted:** canonical `Skills/game-development/comfyui-3d-native-pipeline`, `ai-3d-asset-generation-loop`, `dream-loop`, and `Skills/quality/visual-gauntlet-loop` under `C:/Users/david/Documents/desky-bootstrap-clone`. Shared skills were not edited. Their predecessor-only manifest/test commands are not present in this restart; use the restart's actual per-asset provenance and executable checks when implementation is authorized.
