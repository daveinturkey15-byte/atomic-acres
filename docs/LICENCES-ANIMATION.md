# Animation supply chain — licence position (decided 2026-09-18 18:40)

The owner does not hold and will not create an Adobe account, so Mixamo is out
permanently. Do not ask again. He asked for the remaining question to be resolved rather
than parked; this file is that resolution and its reasoning. Re-read the licences before
any *public* release — a licence finding is true of a revision, not of a project.

## Primary route: Kimodo (local text-to-motion) → Blender retarget → baked glTF clips

Verified on `dave-gaming-pc`, 2026-09-18:

| component | on disk | licence | status |
|---|---|---|---|
| `kimodo.cpp` port + tools | `C:\Users\david\projects\kimodo.cpp` (built: `kmd-generate.exe`, `kmd-generate-embed.exe`, `kmd-encode.exe`) | Apache-2.0 | clear |
| Motion weights `kimodo-soma-rp-v1.1-f32.gguf` | `weights/models/` (manifest → `nvidia/Kimodo-SOMA-RP-v1.1`) | **NVIDIA Open Model License** — commercial permitted, no country exclusion, "NVIDIA claims no ownership rights in outputs" | clear |
| Text encoder bundle `weights/generated/llm2vec-text-bundle/` (LLM2Vec conversion of Llama 3 8B Instruct) | present, 2.8 GB; HF repo ships `LICENSE-META-LLAMA-3.txt` | **Meta Llama 3 Community License** | **accepted, with the obligations below** |
| SMPL-X RP checkpoint | **not present** | NVIDIA internal-R&D licence — prohibits derivative distribution | **do not obtain, do not use** |

### Why the Llama question had to be answered

Kimodo conditions on either a UTF-8 prompt or a precomputed 4096-float LLM2Vec embedding.
**Both** pass through the Llama-3-derived text bundle — `--motion-only` only moves *where*
the encoder runs, not *whether*. So "avoid the Llama bundle" and "drive Kimodo from text"
cannot both hold. One of them had to give, and it was the former.

### Reading of the Meta Llama 3 Community License for this use

- It licenses the **model** (the "Llama Materials") and derivative models. It does not
  claim the assets a downstream tool generates. Our shipped artefacts are skeletal motion
  clips produced by a *different* model (Kimodo) whose conditioning vector came from the
  encoder. The clips are ours.
- **Redistribution clause (§1.b.i):** applies if we distribute the Llama Materials or a
  derivative. We do not. The bundle stays on this machine and never enters the repo,
  `public/`, or any release. This was already the project rule ("ship generated output,
  never the primitives or weights").
- **Attribution clause (§1.b.ii):** "Built with Meta Llama 3" must be displayed if Llama
  Materials are used to create an AI model that is distributed. We are not distributing a
  model — but the line costs nothing and removes all doubt, so it is **required** in the
  game's credits screen and in `public/anim/LICENCES.md`.
- **700M MAU clause:** irrelevant to a free fan project.
- **Acceptable Use Policy:** nothing in generating walk/run/aim/reload cycles for a fan
  shooter approaches a prohibited use.

### Obligations, binding on every animation lane

1. The Llama bundle and the Kimodo weights **never** leave `C:\Users\david\projects\kimodo.cpp`.
   Not into the repo, not as a fixture, not in `public/`.
2. `public/anim/LICENCES.md` lists every shipped clip with: prompt, `kmd-generate` args,
   seed, model file names + SHA-256, date, and the line **"Built with Meta Llama 3"**.
3. The credits screen carries **"Built with Meta Llama 3"** and **"Motion: NVIDIA Kimodo
   SOMA-RP v1.1 (NVIDIA Open Model License)"**.
4. The SMPL-X checkpoint is never fetched. `soma-rp-v1.1` emits **SOMA-30 joints, not
   SMPL-X-22**; the port's README sentence "gives you SMPL-X" is true only of the
   forbidden checkpoint. Carry both layouts and select by joint count at import.
5. Kimodo is an **offline clip bakery** (native binary, no wasm/WebGPU path).
   `THREE.AnimationMixer` stays the runtime; clips ship as baked glTF.
6. Never accept from Kimodo's own web-demo preview — it renders on its own body model at
   its own scale. Accept only from the game, via `scripts/playcap.mjs` and four camera
   views (front, side, three-quarter, low), with a measured foot-slide figure.

## Secondary and fallback routes (so the lane can never block on one supplier)

- **CMU Graphics Lab Motion Capture Database** (`mocap.cs.cmu.edu`) — free for all uses,
  no registration; BVH conversions on public GitHub mirrors. three r180 ships `BVHLoader`
  and `SkeletonUtils.retargetClip`. 120 fps, Z-up: resample and reorient offline.
- **Procedural IK cycles in code** — the project's standing "beat Blender in code"
  directive; `src/characters/` already carries the skeleton, retarget, blend tree and a
  procedural mesh.

## Reference wiring that already exists (read, do not copy)

The OLD project, not this repo: `C:\Users\david\Desktop\stuff\atomic-acres\scripts\animation\`
(`bake-motion-prompts.mjs`, `inspect-kimodo-motion.mjs`, `measure-retarget-quality.mjs`) and
`scripts\blender\retarget-kimodo-motion.py`; `src\animation\kimodo-operator-retarget.ts`.
Its `docs/PASS77_KIMODO_SKELETAL_ANIMATION_ASSESSMENT.md` is **stale**: it predates the
SOMA weights and assesses the SMPL-X route this file rejects.
