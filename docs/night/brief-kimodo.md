# Lane `kimodo` — bake real motion for the characters, locally, no accounts

Read `docs/HANDOFF.md` §6 and **`docs/LICENCES-ANIMATION.md` in full** before anything.
The licence position is decided; your job is to honour its obligations, not reopen them.

## The owner's words

> "we need good animation on our characters and bots too ... so many other people are
> doing decent rigging and animation using these things locally"

## What exists, and where

| | |
|---|---|
| Kimodo port + built tools | `C:\Users\david\projects\kimodo.cpp` — `build-msvc\Release\kmd-generate.exe`, `kmd-generate-embed.exe`, `kmd-encode.exe` |
| Motion weights | `weights\models\kimodo-soma-rp-v1.1-f32.gguf` (SOMA-RP v1.1, **SOMA-30 joints**) |
| Text encoder bundle | `weights\generated\llm2vec-text-bundle\` (Llama-3-derived; see licence file) |
| **Reference wiring, OLD project — read, port the design, copy no file** | `C:\Users\david\Desktop\stuff\atomic-acres\scripts\animation\bake-motion-prompts.mjs` (93 lines), `inspect-kimodo-motion.mjs` (110), `measure-retarget-quality.mjs` (232), `scripts\blender\retarget-kimodo-motion.py` (551, has SOMA-30 transcribed from the port's `src/skeleton.hpp`), `src\animation\kimodo-operator-retarget.ts` (213) |
| Our character system | `src/characters/` — skeleton, retarget, clip library, blend tree, procedural mesh, budgeted system. Read `index.ts` and `clips.ts` first. |
| Blender | `C:\Program Files\Blender Foundation\Blender 5.1\blender.exe` (5.1.2) — headless `--background --python` only, never a window |

The old project's design is worth keeping whole: **bake embeddings once** with the text
encoder (`kmd-encode`), then generate every clip motion-only with `kmd-generate-embed` —
the 1.1 GB motion model alone, no text runtime at generation time. Its inspector caught
the SOMA-30 trap before it reached Blender; keep that stage.

## Files you own

- `scripts/animation/**` (new here)
- `scripts/blender/**` (new here)
- `public/anim/**` — baked clips, `LICENCES.md`, and nothing else
- `src/characters/clips.ts` and `src/characters/retarget.ts` — to load the baked clips
  and the SOMA-30 layout. You may add files under `src/characters/`.

Read-only: everything else. In particular `src/main.ts`, `src/core/**`, `src/build/**`.
If the credits screen needs the "Built with Meta Llama 3" line and `src/ui/` is not
yours, put the exact text in your report and the orchestrator wires it.

## The pipeline, in order — stop and report at any stage that fails

1. **Prompt library.** 12–16 clips that cover the game: idle, walk, run, sprint,
   crouch-idle, crouch-walk, jump, land, turn-left/right, aim-rifle-idle, aim-rifle-walk,
   fire-recoil, reload, hit-react, death. One line each, written for a motion model
   ("a soldier jogs forward holding a rifle at the ready, steady pace, loopable").
2. **Encode once.** `kmd-encode` the library to embeddings (`.bin`, 4096 f32 each).
   Record the exact command, the bundle SHA-256s, and the date in `public/anim/LICENCES.md`
   with the line **"Built with Meta Llama 3"**.
3. **Generate motion-only.** `kmd-generate-embed` per prompt, fixed seeds, ~30 fps,
   2–4 s each; loopable ones a little longer for seam trimming. Output the raw motion
   files to a **scratch** dir, not `public/`.
4. **Inspect before Blender.** Port the inspector: assert joint count (must be 30 —
   if 22 appears you loaded the wrong weights, stop), frame count, root-translation
   range, no NaNs, no joint further than 1.3 m from the pelvis. Print a per-clip table.
5. **Retarget.** SOMA-30 → our skeleton in `src/characters/skeleton.ts`. Calibrate first
   and record each: rest pose match, bone names, **axis — soma-rp-v1.1 is already Y-UP
   (root at 0.93 m on Y); apply NO -90° X swing or every figure lies face-down**, **the
   source is MIRRORED — reflect in X and keep the labels, do not swap Left/Right**, scale
   (metres), **hip ownership** (who owns root translation — the clip or the controller; for locomotion
   the controller does, so strip root XZ and keep Y), foot contacts. Export glTF.
6. **ONE canary first.** `walk` only. Load it through `src/characters/clips.ts`, spawn
   one figure, and run `node scripts/playcap.mjs --tag anim` plus captures from four
   views (front, side, three-quarter, low). Open them. Then measure foot-slide in cm
   per stride (port `measure-retarget-quality.mjs`). Only when the canary is right do
   the other clips go through.
7. **Blend tree.** Wire clips into the existing blend tree: locomotion by speed and
   direction, upper-body aim layer so a figure aims while running, loop seams checked.
8. **Budget.** Twelve figures on screen: frame time, draw calls, JS heap over two
   minutes. State the budget you set and whether you met it.

## Corrections measured on 2026-09-18 (Wave 4)

- Y-up, not Z-up. Mirrored source, fixed by an X reflection with labels kept.
- Blender was NOT needed: our rig's rest is identity on every bone, so an exact
  quaternion retarget in Node (`scripts/animation/retarget-soma.mjs`) emits glTF that
  `AnimationMixer` binds with no remap; a Blender round-trip would force a per-bone
  roll basis and need a second remap. Use Blender only if the target rig demands it.
- 16 clips landed in `public/anim/` (350 kB). Wiring lines are in the Wave 4 report.

## Never

- Never accept a clip from Kimodo's web demo preview — it renders on its own body model
  at its own scale. Accept only from the game, via playcap and the four views.
- Never copy the Kimodo weights, the text bundle, embeddings, or raw motion into the
  repo or `public/`. Baked glTF clips only, with provenance.
- Never open a Blender window, never leave a process running, `windowsHide:true` on
  every spawn, `spawnGuarded` from `scripts/lib/proc-guard.mjs` for anything long.
- Never edit `scripts/playcap.mjs` or its threshold.

## Fallbacks, so you never block

If Kimodo output is unusable for a clip after two seeds, fall back for **that clip** to
CMU BVH (`three/examples/jsm/loaders/BVHLoader.js` + `SkeletonUtils.retargetClip`;
mirrors on public GitHub; no registration) and say so per clip in `LICENCES.md`. If
Blender headless will not run, retarget in three.js directly with `SkeletonUtils` and
report the quality difference. A clean skeleton plus four good clips beats sixteen bad
ones.

## Report

Per clip: source (Kimodo/CMU), seed, frames, foot-slide cm/stride, loop seam OK/not,
which views you opened. The canary's four frames named. Numbers for the budget. What
you could not do, plainly.
