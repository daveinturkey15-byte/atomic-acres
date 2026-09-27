# Workbench model path resolution — 27 September 2026

VERIFIED — read-only inspection at approximately 12:14–12:18 UTC resolved the
four selected model paths through the running ComfyUI API. This supersedes only
the model-root OPEN finding in the earlier workbench receipt; that frozen
receipt/helper and both input images remain unchanged. The initial path pass
read no model content. A separately admitted extension below hashes only the
four resolved files and inspects their headers. No model load, upload, prompt,
GPU task, weight download, service action, process-memory read or package
installation occurred.

## Discovery and service identity

VERIFIED — consulted the canonical native-3D skill and Skills Lab's
`scripts/launchers/check-prereqs.ps1`, `docs/lane-H-report.md` and related handoff
references. Their older installation/name observations do not identify today's
service. In particular, the old Skills Lab checkpoint-only test and statement
that a checkpoint is the sole missing prerequisite are not current readiness
proof. The launcher was read, not executed; its recursive model search was not
used. No whole-drive or broad weights scan occurred.

VERIFIED — current `GET http://127.0.0.1:8188/system_stats` reports ComfyUI0.37.0
and relative `main.py`, with no `--base-directory`, `--models-directory` or
`--extra-model-paths-config` flag. The selected input/output/temp directory flags
point into `C:/Users/david/Desktop/stuff/atra/pl/`. No owner input names were read.
Listener PID13984 uses uv CPython3.11; its parent PID37832 identifies
`C:/Users/david/Desktop/stuff/atra/pl/ComfyUI/.venv/Scripts/python.exe` with matching
arguments. Those are process executable/command metadata, not a working-directory
or process-memory read.

VERIFIED — that explicitly identified installation contains version0.37.0,
`main.py`, `folder_paths.py` and `extra_model_paths.yaml`. The config adds
`C:/Users/david/Desktop/stuff/Comfy Fun/ComfyUI_portable/ComfyUI/models` and
`C:/Users/david/Desktop/stuff/atra/shared-models`. Installed `main.py:142–149`
loads its adjacent config; `folder_paths.py:15–32` defines the default base and
model folders. This code/config interpretation alone would not prove which
paths the existing process actually uses.

OPEN — the actual process current working directory remains unread. No claim
that the parent virtual-environment path proves CWD is made. Model resolution
below does not depend on guessing CWD.

## Direct live resolution

VERIFIED — installed `app/model_manager.py:30–52` defines supported read-only
`GET /experiment/models`, returning each category's actual `folders` array,
and `GET /experiment/models/{folder}`, returning `name`, `pathIndex`, byte size
and timestamps. Its lines159–168 obtain those fields from the resolved file.
These endpoints were called at **2026-09-27T12:17:02Z**. Responses were filtered
to the three required categories and four exact filenames before printing or
retaining evidence. Unrelated model names and owner input/output filenames were
not retained.

VERIFIED — selected live folder arrays, in resolution order:

| Category | Index | Actual API folder |
|---|---:|---|
| diffusion_models | 0 | `atra/pl/ComfyUI/models/unet` |
| diffusion_models | 1 | `atra/pl/ComfyUI/models/diffusion_models` |
| diffusion_models | 2 | `Comfy Fun/ComfyUI_portable/ComfyUI/models/diffusion_models` |
| diffusion_models | 3 | `atra/shared-models/diffusion_models` |
| diffusion_models | 4 | `atra/shared-models/unet` |
| diffusion_models | 5 | `atra/pl/outputs/comfyui/diffusion_models` |
| vae | 0 | `atra/pl/ComfyUI/models/vae` |
| vae | 1 | `Comfy Fun/ComfyUI_portable/ComfyUI/models/vae` |
| vae | 2 | `atra/shared-models/vae` |
| vae | 3 | `atra/pl/outputs/comfyui/vae` |
| clip_vision | 0 | `atra/pl/ComfyUI/models/clip_vision` |
| clip_vision | 1 | `Comfy Fun/ComfyUI_portable/ComfyUI/models/clip_vision` |
| clip_vision | 2 | `atra/shared-models/clip_vision` |

VERIFIED — every folder above is relative to the common prefix
`C:/Users/david/Desktop/stuff/`. The API returned each selected model once,
all from the Comfy Fun store. Targeted filesystem metadata matched its API
size and modification time in the initial metadata-only pass:

| File relative to that store | API index | Bytes | Modification time UTC |
|---|---:|---:|---|
| `diffusion_models/trellis_2_int8_convrot.safetensors` | 2 | 5,253,048,192 | 2026-09-18 20:28:59.668 |
| `vae/trellis_2_shape_vae_bf16.safetensors` | 1 | 1,095,844,024 | 2026-09-18 20:31:16.422 |
| `vae/trellis_2_texture_vae_bf16.safetensors` | 1 | 948,461,364 | 2026-09-18 20:33:19.637 |
| `clip_vision/dino_v3_vit_l.safetensors` | 1 | 1,212,559,776 | 2026-09-18 20:40:55.753 |

VERIFIED — exact checks at the default Atra model paths and its configured
shared-model paths found none of these selected files. The live API supplies
the stronger resolution evidence, including output-model paths not assumed by
the config-only inspection. Installed `folder_paths.get_full_path` returns the
first existing matching file in category order. Three selected files report
HardLink metadata; aliases elsewhere were not enumerated. A hardlink is not a
distinct downloaded copy or content-integrity proof.

## Reproducibility and unresolved gates

VERIFIED — SHA256s of the small inspected installation sources/config only:

| File under `atra/pl/ComfyUI/` | SHA256 |
|---|---|
| `extra_model_paths.yaml` | `d139b825b6bfcea679d1fc9d19bb66d44646ed90fa432f517232bd11de69a8e0` |
| `app/model_manager.py` | `5a0584ccd2bfed14d2391a52cdbc43aba1dd53314c7c661c366f29bd6435cd3e` |
| `folder_paths.py` | `a8dae8d0b09c2caafbb7cc2f627d81bd9c299ff1de9c8698e2e32760dde1dc66` |
| `main.py` | `5a958d6975d8b6096887df7f5160cecf760e5b434a5471bb5f8efaae73bcfd96` |

VERIFIED — the four files total 8,509,913,356 bytes; this is storage metadata,
not RAM/VRAM demand. The following bounded extension resolves their content
identity and header structure. Image edge quality, graph execution, resource
admission, mesh/GLB quality and in-game/owner acceptance remain separate OPEN
gates.

VERIFIED — next inspection can target these exact four paths instead of
searching other installations. Before future execution, re-query the live
folder/path-index metadata: a restarted service or edited config may change
resolution. No prior historical success or matching filename is promoted into
current model readiness.

## Targeted content identity extension — 12:19–12:24 UTC

VERIFIED — only the four resolved files were SHA256-hashed, one at a time with
4MiB streaming chunks in a below-normal-priority CPU process. Combined file
read/hash time was 10.499 seconds. File sizes and nanosecond modification times
were unchanged across each hash. Free physical RAM measured25.26GiB before and
25.52GiB afterward. CPU samples were100% both before and after; saturation was
already present, and these two samples cannot establish absence of interference.
No repeat full reads or additional heavy work followed.

| Selected file | Full SHA256 |
|---|---|
| `trellis_2_int8_convrot.safetensors` | `d01952ad137213f6a868f86b6b877026276f84af5eec23069217475a0bad3a31` |
| `trellis_2_shape_vae_bf16.safetensors` | `de0cb4949a76c59ee5c091a995a69bcc8c51d5aeda939f0c641a50d2a72341f4` |
| `trellis_2_texture_vae_bf16.safetensors` | `714e5ebf094a610e12a8e3b5175c18a62f37f6ea4218acb6073644456b73ab0e` |
| `dino_v3_vit_l.safetensors` | `5cb785e458de7c460579082418af81f5c62380c181599344bdc60898c63468ee` |

VERIFIED — all four hashes and lengths exactly match the official Hugging Face
[Comfy-Org/TRELLIS.2 API](https://huggingface.co/api/models/Comfy-Org/TRELLIS.2/revision/430a9d09b2416687018c8fe8edced2ad4858a439?blobs=true)
LFS entries at revision `430a9d09b2416687018c8fe8edced2ad4858a439`.
The response was obtained from `/api/models/Comfy-Org/TRELLIS.2?blobs=true`, whose
reported revision was that hash. This establishes byte identity with those
distributed objects, not how or when the local files were originally obtained.
No weight download was made. The revision-pinned
[model card](https://huggingface.co/Comfy-Org/TRELLIS.2/blob/430a9d09b2416687018c8fe8edced2ad4858a439/README.md)
was read; SHA256 `c9dbaa577043305bf0da1160a652c752a8f7da23322aafa60f5cf47c2e421f7d`.

VERIFIED — bounded header parsing used Python `struct`/`json`, without importing
Torch or safetensors loaders. Every tensor interval is within the file, all
intervals are contiguous without overlap/gaps, final data offset equals the
file length after the header, and every shape×dtype byte count matches its
interval. This checks structural consistency, not numeric finiteness or model
execution. All four `__metadata__` maps are empty.

| File | Header bytes | Tensor descriptors | Observed storage |
|---|---:|---:|---|
| TRELLIS diffusion | 518,760 | 4,240 | 840F32, 1,720BF16, 840I8, 840U8 |
| Shape VAE | 38,688 | 366 | BF16 |
| Texture VAE | 29,344 | 284 | BF16 |
| DINO encoder | 41,368 | 415 | F32 |

VERIFIED — installed loader-source checks match the actual header keys:

- `comfy/model_detection.py:123–146` recognizes both
  `model.img2shape.t_embedder.mlp.0.weight` and
  `model.shape2txt.t_embedder.mlp.0.weight`, each shaped1536×256. No Pixal
  `cross_attn.proj_linear` keys appear. The stored model fits the TRELLIS route.
- `comfy/sd.py:586–595` recognizes shape marker
  `shape_dec.blocks.1.16.to_subdiv.weight` (8×512) and texture marker
  `txt_dec.blocks.3.4.conv2.weight` (64×3×3×3×64).
- `comfy/clip_vision.py:147–148` recognizes DINOv3-L through
  `layer.23.attention.o_proj.bias` (1024). Patch weights are1024×3×16×16,
  class token1×1×1024 and register tokens1×4×1024. No `naf.` tensors occur;
  the older DINO+NAF recipe must not be mistaken for this specific encoder.
- The840 `comfy_quant` U8 records total60,480 bytes. These small configuration
  byte ranges were decoded as JSON, not tensor weights: every record specifies
  `int8_tensorwise`, `convrot:true`, `convrot_groupsize:256`. Installed
  `comfy/ops.py:1188–1234` consumes this schema and weight scales. Empty global
  metadata therefore does not mean quantization information is absent.

OPEN — source recognition and valid descriptor layout are not successful
instantiation, inference or quality proof. No claim is made about tensor values,
GPU compatibility, maximum memory use, or present graph execution.

## Distribution and primary-license evidence

VERIFIED — the exact matched Comfy-Org model card declares MIT and identifies
`microsoft/TRELLIS.2-4B` as its base model. The repository file list contains no
standalone LICENSE/NOTICE. Microsoft's original model repository reports
revision `af44b45f2e35a493886929c6d786e563ec68364d` and an MIT card declaration,
also without a separate license file in the returned list. Those card fields
are publisher claims, not substitutes for each component's license text.

VERIFIED — Microsoft's primary
[TRELLIS.2 license](https://github.com/microsoft/TRELLIS.2/blob/75fbf0183001ed9876c8dbb35de6b68552ee08bd/LICENSE)
was read at revision `75fbf0183001ed9876c8dbb35de6b68552ee08bd`; it is MIT,
with copyright/permission-notice retention. License-file SHA256:
`d9a1b1e30d633d5732ea18e3cba9538d293ebc53e1a9e4e96ab739e0c5c4f1cb`.

VERIFIED — Meta's primary
[DINOv3 License](https://github.com/facebookresearch/dinov3/blob/6876159a11b4df116f30f667f8c9888617df0751/LICENSE.md)
was read at revision `6876159a11b4df116f30f667f8c9888617df0751`; it is a custom
license, not MIT. It covers use/modification and redistribution, requires its
agreement to accompany distributed DINO Materials/derivatives, requires
acknowledgment for published research, and includes use restrictions. File
SHA256 `25d122eb8f5b880fd23c736fb6ea8018ee45c12237e00b8a86d14c653904999e`.
This report records the primary text rather than treating the repackage's MIT
metadata as a blanket license for its encoder.

OPEN — the exact upstream DINO checkpoint/conversion revision and complete
component attribution trail are not stated by the matched card or empty file
metadata. The primary current license texts and exact Comfy distribution revision
are now recorded; final attribution/distribution clearance remains OPEN.
No weights are being redistributed by this project, and no inference or art
acceptance follows from this documentary check.
