# Hero-prop canary — Trellis.2 timber supply crate, 2026-09-19

**Lane:** hero-prop canary. Builds the capability, runs ONE asset end to end, and answers
whether the result beats the procedural equivalent. **It integrates nothing.**
**Verdict: NOT clearly better. Keep the procedural crate.** See §7.

Nothing generated entered `public/`, `src/`, `dist/` or the git index. The repository
gained three files: `scripts/art-gen/comfy_trellis.py`,
`scripts/art-gen/prop-orbit.mjs`, `docs/reference/library/hero-prop-recipe.md`, and this
record. Every artefact lives in the session scratchpad
`…/503f5c1d-b1c5-4f2f-99fb-c25240f4a623/scratchpad/heroprop/`.

---

## 1. Machine state at generation time (API-measured, not assumed)

| | |
|---|---|
| ComfyUI | **0.34.0**, frontend 1.51.9, templates 0.11.52, Python 3.13.12, PyTorch 2.11.0+cu130 |
| Device | `cuda:0 NVIDIA GeForce RTX 5080 : cudaMallocAsync`, `vram_total` 17 094 475 776 B (15.92 GiB) |
| `argv` | `main.py --port 8188 --disable-auto-launch --log-stdout` — **no `--models-directory`** |
| Models root | the install default, `…\Comfy Fun\ComfyUI_portable\ComfyUI\models\` |
| Queue before each submit | `queue_running` [] and `queue_pending` [] — verified, never pre-empted |
| Free VRAM before each submit | 14 395 / 12 862 / 13 6xx MiB, always ≥ the 8 192 MiB gate |

The owner's ComfyUI was **not** started, restarted, updated or reconfigured. Nothing was
installed. The skill's recorded models root
(`C:\Users\david\Downloads\ComfyUI-H3-setup\downloads-current`, 2026-09-03) is **stale**;
`argv` now carries no flag at all.

`geometry_estimation/` is empty, so `LoadMoGeModel` cannot load and the Pixal3D branch of
the shipped template is unavailable here. **Trellis.2 route only**, as briefed.

All 30 node classes the graph uses were confirmed present through `/object_info` before
the first submit, and every weight through `/models/<folder>` — never a guessed path.

---

## 2. Concept image (step 1)

Generated locally on the owner's ComfyUI with the stack `scripts/art-gen/comfy_generate.py`
already drives on this machine.

| | |
|---|---|
| UNet | `qwen_image_2512_fp8_e4m3fn.safetensors` |
| text encoder | `qwen_2.5_vl_7b_fp8_scaled.safetensors` (CLIPLoader, type `qwen_image`) |
| VAE | `qwen_image_vae.safetensors` |
| LoRA | `Qwen-Image-2512-Lightning-4steps-V1.0-fp32.safetensors`, strength 1.0 / 0.0 |
| sampler | KSampler, **seed 19260919**, **4 steps**, cfg 1.0, euler / simple, FluxGuidance 3.5 |
| size | 1024 × 1024, `EmptyQwenImageLayeredLatentImage` layers 3 |
| wall time | 26.1 s · peak `nvidia-smi` used 15 556 MiB |
| file | `crate-concept-tall.png`, sha256 `a7b85bb7f588279b4fd230856bdf2ca4054df58c718a432baef24a809d69b74f` |

Prompt (verbatim, recorded in `crate-concept-tall-receipt.json`): a single tall upright
1950s desert test-site timber shipping crate, twice as tall as wide, rough-sawn pine with
grain, nail heads, steel corner brackets, batten and diagonal braces, sun-bleached and
chipped, **generic stencilled block numerals only, no brand names, no logos**,
three-quarter view slightly above, even soft overcast light, plain flat mid-grey seamless
background. The crate came out carrying a stencilled **"30"** — a generic numeral, nothing
that could not ship.

**First roll rejected and recorded:** the same prompt without the explicit
"twice as tall as wide" produced a **cube** (`crate-concept.png`, sha256
`6929cf4c08658409ae9f00958f73707f86ea3ec16b14ee4db113a298cbdd3983`). Kept for the record;
not used.

---

## 3. Trellis.2 generation (step 2) — first honest VRAM figure for this route

Graph as in the recipe; full API JSON preserved at `out/aa-crate-graph.json`.

| stage | node | seed | steps | cfg | sampler / scheduler |
|---|---|---|---|---|---|
| structure | KSampler 41 | **56** | 12 | 7.5 | euler / normal (CFGOverride 1.0 from 0.667, RescaleCFG 0.7, ModelSamplingSD3 5) |
| shape | KSampler 51 | **42** | 20 | 7.5 | euler / normal (CFGOverride 1.0 from 0.769, RescaleCFG 0.5) |
| upsample | KSampler 61 | **42** | 12 | 7.5 | euler / **simple** (Trellis2UpsampleStage target 1536) |
| texture | KSampler 71 | **43** | 12 | 1.0 | euler / normal (raw UNet, no CFG shaping) |

Mesh tail: `VaeDecodeStructureTrellis2` res "32" → `RemeshMesh` 768 / udf / band 1 /
smooth_iters 20 → `DecimateMesh` midpoint → `MeshSmoothNormals` 180 → `UnwrapMesh` pec
2048 → `BakeTextureFromVoxel` 2048 → `BakeNormalMapFromMesh` 2048 cage 0.05 →
`BakeAmbientOcclusion` 1024 / 64 spp → `ApplyTextureToMesh` → `MeshToFile3D` → `SaveGLB`.

| run | prompt id | AO `max_distance` | wall | peak VRAM (`nvidia-smi` used, whole GPU) |
|---|---|---|---|---|
| v1 | `fce17571-901b-4fdd-b000-a13acee7f188` | 0.71 (template) | **346.4 s** | **15 759 MiB** |
| v2 | `6808f006-87bf-4405-8ad3-8a8e8376ed43` | 0.03 (corrected) | 20.1 s (upstream cache-hit) | 8 508 MiB |

**Peak VRAM for this route on this machine: 15 759 MiB of a 16 303 MiB card**, sampled
every 5 s across the whole run. About 1 500–3 100 MiB of that belonged to other processes
(the idle baseline before the lane started was 1 583 MiB), so Trellis.2 itself accounts
for roughly **12.7–14.2 GiB**. The skill says no honest figure existed for this route.
This is the first one; it is a *whole-GPU* peak and should be read as "this route fills a
16 GB card". Full 5-second sample series in `out/aa-crate-receipt.json`.

`GetMeshInfo`, read through `PreviewAny` at three points in the graph:

| where | vertices | faces |
|---|---|---|
| raw `VaeDecodeShapeTrellis` mesh | 14 647 571 | **29 182 634** |
| after `DecimateMesh(700 000)` | 349 770 | **699 395** |
| after `DecimateMesh(3 000)` | 1 213 | **2 906** |

`uv_unwrap`: 2 906 faces → **214 charts**, atlas 1967 × 1866, 7.9 s.

---

## 4. Budget from the FILE (step 3)

Parsed straight out of the GLB's JSON chunk (`scratchpad/heroprop/glbinfo.mjs`, no
dependency), not taken from the node's target.

| | sculpt export | game export (v2, shipped candidate) |
|---|---|---|
| triangles | **699 395** | **2 906** |
| vertices | 349 770 | 2 811 |
| attributes | POSITION, NORMAL, COLOR_0 | POSITION, NORMAL, TANGENT, TEXCOORD_0 |
| materials | 1 (vertex colour) | 1, `doubleSided`, ORM + normal |
| textures | none | **3 × 2048 × 2048 PNG** (base colour; packed AO/rough/metal; normal) |
| file | 20 985 784 B | 9 613 400 B |
| sha256 | `526a200810a8a1b0421b233dbef5ea456b34d8c705ec62c02cf1153ed75b1f4d` | `a5b439106ba9afdae1f7c90ebb745e72c13ea37a829125bc2ea118fa78ea00ec` |

(v1 game export, superseded: 2 906 tris, 9 074 588 B, sha256
`73c07f0953e9825f0c009d8f6845af02f451fd7c9c6c59bc315bd879e5f46bbe`.)

Runtime cost of the game export: **1 mesh / 1 draw call in the colour pass plus 1 in the
shadow pass, 2 906 triangles, one additional material and therefore one additional shader
program, and ≈ 64 MiB of VRAM** for three uncompressed 2048² maps with mips.

---

## 5. The AO defect, found and corrected (one bounded change)

**Symptom → Cause → Correction → Verify** is in the recipe. In numbers:

| AO atlas | mean | frac < 16/255 | frac > 240/255 | p5 / p50 / p95 |
|---|---|---|---|---|
| template `max_distance` 0.71 | 85.4 | **0.569** | 0.225 | 0 / 7 / 255 |
| corrected 0.03 | 182.0 | **0.020** | 0.383 | 31 / 211 / 255 |

The template's 0.71 is 71 % of a unit-scale object: the rays reach the far wall from
almost everywhere and the bake goes binary. Only this one parameter changed between v1 and
v2; every seed, step count and other value is identical, and the run is in the receipt.

**Attribution falsifier run** (`prop-orbit.mjs --strip`), because "the crate looks broken"
had to be pinned on something: the hard triangular shards across every face **survive**
removal of `aoMap`, of `normalMap`, and of all four data maps at once. They are therefore
in the **base-colour bake**, not in AO and not in the normals. The normal map itself
measures clean (unit length everywhere, z > 0 everywhere, plausible plank relief), so the
smearing is `BakeTextureFromVoxel` back-projection differing chart to chart across the 214
charts. *Caveat on that last frame:* stripping `metalnessMap` leaves `metalness = 1` from
the glTF `metallicFactor`, so it renders shiny — an artefact of the test, not the asset.

---

## 6. Acceptance in the target runtime (steps 4 and 5)

`scripts/art-gen/prop-orbit.mjs`, three r180 `WebGPURenderer` (`backend: "webgpu"`
confirmed at runtime), real Chrome over CDP headless on the second monitor, this project's
sun / hemisphere / fill / sky-bake / fog / ACES 1.09 constants copied from `src/`
(nothing imported). 20 frames per subject: front, side, three-quarter, low, back,
**underside**, 3 m, 15 m and a **12-frame orbit**. Every frame was opened and looked at.

**Colour space, checked in the runtime and not in a viewer** (`trellis2-report.json`):
`map.colorSpace === "srgb"`; `normalMap`, `roughnessMap`, `metalnessMap`, `aoMap` all
`""` (NoColorSpace / linear). **Correct.** The material arrives as one
`MeshStandardMaterial`, `metalness` 1 and `roughness` 1 — those are glTF *factors*
multiplied by the ORM texture, whose blue (metallic) channel measures mean **0.2/255**, so
it behaves as a dielectric. A pipeline that dropped the ORM map would render it chrome.

**Scale and pivot.** Raw export bounding box **0.633 × 0.993 × 0.472** (generator units,
roughly unit-height, no real-world sense of size). Declared target is the yards' crate
stack at **0.6 × 0.6 × 1.18 m**. Fitted on height (`--size 100,1.18,100`, scale
**1.1888**) the footprint lands at **0.753 × 0.561 m** — 25 % wider and 7 % shallower than
the declared 0.6 × 0.6, so it cannot be dropped in against the existing collider without
either a non-uniform squash or a new collider. **The pivot is the centroid, not the
contact point:** measured at 0.499 / 0.497 / 0.504 of the bounding box on x / y / z. It
must be re-seated before anything stands on the ground; `prop-orbit` does that itself.

**UV atlas.** 214 charts with large dead areas and many slivers — real texel density is
well below what 2048² implies, which is why the stencil is soft at 3 m.

**Incumbent comparison, both ways.**
- `--mode procedural`: the `yards.ts` `crateStack` as flat boxes, 36 triangles. This is the
  incumbent's *floor* (no procedural timber textures) and is included so the candidate gets
  the easiest possible opponent.
- **The real thing, in the running game**: shared preview :4188, `__NT.teleport` (never
  `goto()`), orange front-lawn stack at world **x 0, z −9.1**, at 3 m / three-quarter /
  side / back / 15 m. This is the honest opponent, because the shipped crate uses
  `mat.timber` / `mat.timberDark` with generated `map` + `roughnessMap` + `normalMap`.

Measured on matched three-quarter frames, subject pixels only:

| | mean RGB | luma |
|---|---|---|
| Trellis.2 crate | **78.5 / 80.6 / 46.7** (green ≥ red — olive) | 77.7 |
| procedural crate | **113.0 / 73.6 / 37.5** (warm timber) | 79.4 |

Same overall value, **inverted hue relationship**. The generated base colour is olive-khaki
where the input concept was warm tan: the concept crop measures 119.4 / 108.5 / 82.6 and
the baked atlas 111.7 / 111.5 / 67.0, and the atlas's p5→p95 spread collapses from
84–145 to 89–125. The texture VAE both shifted the hue and flattened the plank-to-plank
value variation that made the concept read as timber.

**Two harness limitations, stated so the frames are read correctly:** the 1 m reference
cube sits at x +1.6, so the `side` station and orbit frames 02–04 are partly occluded by
it; and `renderer.info` reports `drawCalls: 0` in the report because `autoReset` clears it
at every `render()` — the draw count in §4 is derived from the scene graph (one mesh), not
read from `info`.

---

## 7. THE VERDICT

**Not clearly better. Keep the procedural crate.** Across all twenty frames the Trellis.2
crate loses on the two things that matter at the distances a player actually sees it. At
**3 m** its silhouette is right — upright, battened, braced, more interesting than three
stacked cubes — but the surface is wrong in a way no lighting fixes: hard-edged triangular
shards are baked into the base colour on every face, the corners pillow and sag instead of
reading as sawn timber, the stencil is soft, and the whole thing sits at olive-khaki
(78/81/47) where the project's timber palette is warm (113/74/38), so it reads as a painted
military box dropped into a sun-bleached 1950s street rather than as the yards' pine. At
**15 m** the extra geometry has vanished into two or three pixels of outline and the only
thing left is the colour, which is the one thing it gets wrong — the in-game crate stack
still reads as warm timber at that range and the candidate reads as a dark smudge. The back
is invented and the **underside is hollow and open**, with a hole through the base and
chaotic interior walls: fine for a prop against a wall, disqualifying for one the yards
place in the open and that players vault and shoot past. The AO bake was broken out of the
box (57 % of the atlas near-black) and needed a correction the template does not carry, and
even corrected the shards remain. Against that the cost is real and one-sided: the
procedural stack is **36 triangles inside an existing `InstancedMesh`, zero extra draw
calls, zero extra programs, zero extra texture memory**, while the candidate is **2 906
triangles, +1 colour draw and +1 shadow draw, one new material and program, and ≈ 64 MiB
of VRAM** — on a build whose own handoff records 1 348–2 112 draw calls per frame against a
1 200 budget (S9 still open). Paying a new program and 64 MiB to make one crate *worse*
at both distances is not a trade worth making.

**What the canary did establish:** the route works, end to end, locally, in about six
minutes per asset, with full provenance and a repeatable client. It is worth keeping for a
genuine **hero** prop — something large, close, unique and irregular where 3 000 triangles
of real silhouette beats anything box-kit code would write, and where the owner can accept
a bespoke material. It is not worth it for set dressing that a batched box already does.
A crate was the right canary precisely because it is the case procedural art wins.

**If a second attempt is ever wanted**, in priority order: bake at `--atlas 4096` with a
better-packed atlas (214 charts is too many for 2 906 faces); tune
`BakeNormalMapFromMesh.cage_distance` down from 0.05 with the same reasoning as the AO fix;
push the concept image to harder, more directional light so the texture stage has real
value variation to back-project; and colour-correct the base map toward the project's
timber palette before judging it.

---

## 8. Provenance

Route `comfyui-native-3d`, generator **trellis2**, ComfyUI **0.34.0**, on `dave-gaming-pc`,
2026-09-19. Weight SHA-256 computed here from the files the running server resolves:

| file | bytes | sha256 |
|---|---|---|
| `diffusion_models/trellis_2_int8_convrot.safetensors` | 5 253 048 192 | `d01952ad137213f6a868f86b6b877026276f84af5eec23069217475a0bad3a31` |
| `vae/trellis_2_shape_vae_bf16.safetensors` | 1 095 844 024 | `de0cb4949a76c59ee5c091a995a69bcc8c51d5aeda939f0c641a50d2a72341f4` |
| `vae/trellis_2_texture_vae_bf16.safetensors` | 948 461 364 | `714e5ebf094a610e12a8e3b5175c18a62f37f6ea4218acb6073644456b73ab0e` |
| `clip_vision/dino_v3_vit_l.safetensors` | 1 212 559 776 | `5cb785e458de7c460579082418af81f5c62380c181599344bdc60898c63468ee` |
| `background_removal/birefnet.safetensors` | 444 473 596 | `9ab37426bf4de0567af6b5d21b16151357149139362e6e8992021b8ce356a154` |
| `diffusion_models/qwen_image_2512_fp8_e4m3fn.safetensors` (concept) | 20 430 679 144 | `5dc80554d5d83390046a2f4a94ece06afb7700bf7b0aaf8bde9769793875876b` |

The first four match, byte for byte, the table in
`…\ComfyUI\models\TRELLIS2-PROVENANCE.md` written when they were fetched on 2026-09-18 —
independent confirmation, computed here rather than copied.

Node set observed: `Trellis2Conditioning`, `EmptyTrellis2LatentStructure`,
`VaeDecodeStructureTrellis2`, `Trellis2ShapeStage`, `Trellis2UpsampleStage`,
`VaeDecodeShapeTrellis`, `Trellis2TextureStage`, `VaeDecodeTextureTrellis`, `VoxelToMesh`,
`RemeshMesh`, `DecimateMesh`, `MeshSmoothNormals`, `UnwrapMesh`, `GetMeshInfo`,
`BakeTextureFromVoxel`, `PaintMesh`, `ApplyTextureToMesh`, `BakeNormalMapFromMesh`,
`BakeAmbientOcclusion`, `MeshToFile3D`, `SaveGLB`, `RenderUVAtlas`, `SaveImage`,
`LoadBackgroundRemovalModel`, `RemoveBackground`, `ImageCropToMask`, `CLIPVisionLoader`,
`UNETLoader`, `VAELoader`, `KSampler`, `PreviewAny` — all confirmed present through
`/object_info` on the running server before submit.

Concept chain, seeds and step counts: §2 and §3. Exported-file hashes: §4.

**Licences — observed separately from claimed.** Read on **2026-09-19** from the note
written beside the weights on 2026-09-18; the upstream `LICENSE` files themselves were
**not** re-fetched in this run, and that gap is deliberate to record rather than paper
over. Position as it stands: `microsoft/TRELLIS.2` MIT (code and weights); BiRefNet MIT;
the `Comfy-Org/TRELLIS.2` repackage declares `mit` in its model-card metadata and ships
**no LICENSE file** — re-confirmed here, there is no `LICENSE*` anywhere in the local
models tree, so that field is a claim about a bundle, not a per-file grant;
`clip_vision/dino_v3_vit_l.safetensors` is a Meta **DINOv3** backbone under Meta's own
DINOv3 licence — commercial use permitted **with attribution and redistribution
conditions**, not MIT. **Nothing from this lane ships, so no attribution obligation is
live today.** If the owner ever accepts a generated asset into the repository, the DINOv3
attribution condition is the one to settle with him first, and the upstream licence files
must be re-read at that revision.

**Owner decision still required.** Atomic Acres is procedural-art-first and its contract
forbids imported meshes for arena art; a generated mesh is a per-asset hero-prop exception.
This lane asked for no such exception and took none.
