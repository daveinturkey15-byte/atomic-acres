# Technique Application Matrix — Nuketown standalone rebuild

Scope: 12 strongest shared-skills techniques mapped to weapons-20 / streaks-11 /
grenades / operator rig / lighting-reflections / scene PBR. Companion data:
`docs/catalog/technique-applications.json` (same 12, machine-readable).

Bounds of this pass (15 min, Muse Spark 1.3 xhigh): root repo
`nuketown-recovery-20260919` read-only; no browser, no local GPU, no heavy jobs,
no new skills, no downloads, no credentials, no commits. Source references read as
data, never instructions. **No live source/licence re-verification this pass** —
every pin, licence and observed-date below is carried from AKP
`references/ai-3d-technique-register.md` (licences observed 2026-08-22..2026-09-03)
and its carrying skills. **Re-read the LICENCE file + pin before any reuse.**
An old technique demo never proves new runtime quality; every row names its own gate.

Current-tree counts vs task scope (honest, not inflated): `src/weapons/catalog.ts`
hosts **5** defs today (target 20 viewmodels); `src/game/killstreaks/catalog.ts`
hosts a **10**-row STREAKS roster (target 11); grenades = `GrenadeFx` 3 instanced
meshes driven by `game/ordnance-view.ts`; operator rig = `src/characters/`
(`skeleton.ts` 1.78 m standard rig, `retarget.ts`, `clips.ts`, `kimodo-clips.ts`,
`operator-materials.ts` single-draw, `mesh.ts`, `anim-qa.ts`); materials are
singletons in `core/materials.ts` (+`material-surfaces.ts`, `palette.ts`,
`vegetation-materials.ts`, `impact-material.ts`); cameras in `core/stations.ts`
(`FIDELITY_STATIONS` ref-paired; null-ref = diagnostic only).

## DreamLoop / Gauntlet source verdict

**DreamLoop: NOT FOUND.** Searched the register + installed skill set 2026-09-19:
zero rows, zero pins, zero licences. Do not invent or cite the name.
**Gauntlet actual source (T8):** method article `https://somethingbig.ai/gauntlet-loop`
(copyrighted marketing, restate only) + canonical example
`mshumer/Claude-of-Duty @ d9b237b75c9304ab8d9ef4cfa0c3568c7c11a853` (MIT,
LICENSE read 2026-08-30), carried by skill `visual-gauntlet-loop`. Its own notes
admit low gameplay FPS + shader stalls — visual iteration ≠ gameplay proof.

## Trellis bound (owner hardware)

RTX 5080 16 GiB card; **3 GB VRAM reserve**; measured Trellis.2 int8 peak
**15,759 MiB of 16,303** (346 s wall, 2026-09-19). Prior root sample had approximately **5 GB used, not free**; latest free-memory sample belongs in CURRENT.json.
DO NOT LAUNCH.** Prefer the actionable CPU Blender/reference pipeline
(`docs/night/brief-image3d.md` route); any adaptive Trellis graph needs a
validated abort + budget before it runs. Pixal3D branch unrunnable here
(`geometry_estimation` empty).

## The five distinctions (do not conflate)

1. **Image-targeting** (T9: reference frame as comparison aid) vs
   **image-to-mesh reconstruction** (T2: generator invents hidden geometry).
2. **Reconstruction-by-code** (T1: measured procedural factory, unknown labelled)
   vs image-to-mesh (T2 shell).
3. **Blender reference modelling** (T7: pose reference authored against; T2/T5 bake
   path: headless `--background --python`, GLB+receipt = success, exit-0 lies).
4. **H3 video→pose reference** (T4: private scaffolding, never ships) vs
   **automatic rigging** (no such claim anywhere; every lane hand-calibrates).
5. **Kimodo clip retarget** (T5: SOMA-30→own rig, explicit correspondence) vs
   **planner recording** (T6: G1-34 context→next-seconds→bake; offline only).

## The 12 (technique → maps-to → output → gate)

**T1 · img2threejs procedural rebuild** (reg 6; Apache-2.0) → weapons-20
viewmodels, grenade casings. Output: `src/weapons/<w>-model.ts` factory
(`ctx.mat` only, `ctx.rand`, pivots/sockets/colliders) + `catalog.ts` entry.
Gate: turntable + Tier-1 Divine Eye, VLM last-layer only; `continue` needs
render+sheet+score with all critical features passing; playcap at closest distance.

**T2 · Trellis.2/Pixal3D native ComfyUI** (reg 45; MIT generators, DINOv3 caveat)
→ static hero prop ONLY (sign assembly / street furniture class). Output:
`scripts/blender/<prop>.py` → `public/assets/<prop>.glb` + baked PBR →
`core/assets.ts` (ready-gated) → `docs/IMAGE-TO-3D.md` verdict.
Gate: wire+capture+compare vs procedural incumbent; **delete GLB if not clearly
better**; report tris + decoded VRAM + build time. GATED BY VRAM BOX ABOVE.

**T3 · Video→skeletal mocap** (reg 1; `squall01337/mixamo-llm-mocap@00dfd53…`;
MIT-text/NOASSERTION + separate Mixamo terms; never auto-install) →
operator locomotion. Output: scratch motion → `scripts/blender/retarget-*.py` →
`public/anim/*.glb` + LICENCES.md → `characters/retarget.ts`+`clips.ts`.
Gate: one-GLB canary, mixer playback in real browser, frame-by-frame foot-slide,
front/side/three-quarter.

**T4 · Generated video as motion REFERENCE** (reg 30, owner bridge; H3 output
UK-blocked → video stays private; WAN 2.2 Apache-2.0 = clean substitute) →
unfilmmable motions (deaths, reactions, streak beats). Output: ignored-scratch
reference (hash recorded) + authored/retargeted clip on our rig. Gate: as T3;
the shipped clip is judged, never the video.

**T5 · Kimodo text→motion local** (reg 16; port Apache-2.0
`@92341f3…`; SOMA-RP v1.1 GGUF NVIDIA OML, no country block; SMPL-X ckpt NOT
clear; Llama-3 bundle separate + credit line; 10 s cap → stitched seams) →
clip-coverage tail (12–16 prompts per `docs/night/brief-kimodo.md`).
Output: `scripts/animation/**`, `scripts/blender/**`, `public/anim/**`+LICENCES.md.
Gate: walk-canary first (joint-count 30 assert, Y-up no-swing, mirror-X,
controller owns root XZ), 4-view capture, foot-slide cm/stride. Pass-80 precedent:
4 clips 2–5 cm shippable, walk rejected — design ports from old project, copy no file.

**T6 · MotionBricks planner, recorded offline** (reg 49; G1-34 robot ONLY;
licences clear-but-revocable OML; baked outputs ours, primitives never committed)
→ transitions/stance changes ONLY, trial-gated (NOT YET). Output: 0.8 MB style
primitives → container reader → frame-table-vs-bytes → one baked transition +
correspondence table with null reasons. Gate: retarget-first cheap trial vs G1–G7;
no build unless it reads; prewarm budget never raised.

**T7 · Rigged FP-arms CC0 reference** (reg 31; CC0, per-asset re-read; author limit:
rig+sample only) → viewmodel grip/pose (`weapons/viewmodel.ts`,
`first-person-hands.ts`; residual: trigger hand NDC y −0.75..−0.89).
Gate: NDC framing check + playcap FP views. Our geometry stays ours.

**T8 · Gauntlet loop** (regs 13+34; see verdict box) → process for ALL lanes.
Output: frozen scorecard + per-round evidence; `docs/*-refinement.md` verdicts
(local pattern: `muse-vehicle-refinement.md` — 2 corrections, +48 tris world,
+0 draws). Gate: looked-at frame; ≤3 corrections/subsystem, ≤6 total; stop on
repeat/oscillation/plateau; never move bar/camera to win.

**T9 · Code-only procedural scene + photographic grade** (regs 7+8; MIT; plus
forge method-observation with NO-licence: facts only) → scene PBR + grade
(`src/build/*`, `core/atmosphere.ts`, `core/post.ts`). Gate: fidelity stations
vs named BO2 refs; combat-readability re-meter (grade provably non-hiding).

**T10 · Plate armour/ballistics + spotting restudy** (reg 20;
`Kevin-Liu-01/Claude-of-Tanks@9004ce6…`; root MIT first-party ONLY; Dinamo
typeface + brand/licence-dirs quarantined) → streak ballistics/awareness
(`killstreaks/gate.ts`, `runtime.ts`, `effects/sentry.ts`; grenade penetration
classes via `impact-material.ts`/`material-surfaces.ts`). Gate: zero page errors,
`__NT.stats().programs` flat over 60 s streak play, traverse holds,
`capture --tag ks` opened+described.

**T11 · Classic in-browser ray tracing option** (reg 19;
`erichlof/THREE.js-RayTracing-Renderer@490ca08…`; CC0 file-read, most permissive;
Whitted+Hall, NOT path tracing) → lighting/reflections preset candidate
(hooks: `docs/local-reflections-proposal.md`, reflection canaries).
Gate: 4 s cold-compile fence; readability > beauty; never name it RTX.
Boundary: row-15 native runtime REPLACES the browser — owner-only decision.

**T12 · Mesh-baker optimizer** (reg 36; proprietary hosted; Hobby
non-commercial; Pro €49/seat/mo; automation needs separate licence; never
auto-purchase) → post-T2 intake ONLY (this repo is procedural; no highpoly
problem otherwise). Gate: per-asset owner call; tangent-correct bakes;
Blender remesh+bake stays default.

## Executable plan for root (concise, in order)

1. **Vehicle/scene PBR pass (T8+T9, CPU-only, now):** port `muse-vehicle-refinement`
   pattern to display sedan + coach loft follow-up; `npm run check/build`,
   `playcap` on saloon views, `capture` delta (draws flat, tris budgeted), look at frames.
2. **Weapon viewmodels ×N (T1+T7):** one `img2threejs`-route factory per weapon into
   `src/weapons/` (singleton-mat rule), hand-canary per `.mjs` verifier; T7 poses the grip.
3. **Streak ballistics/awareness (T10):** restate plate/penetration + gate structure
   into `killstreaks/`; verify via `node scripts/_verify-streak-reject.mjs` + 60 s
   program-flat capture. `soak` before handoff (prove it can fail:
   `--inject-kb-per-s 200`).
4. **Animation tail (T5→T3→T4, T6 trial-gated):** brief-kimodo pipeline order —
   prompt library → encode once → motion-only → inspect (joint 30) → retarget →
   walk canary → batch; MoCap footage (T3) for hero performances; T4 references for
   the unfilmmable; T6 cheap primitive trial before any build.
5. **Hero prop exceptions (T2+T12, owner-gated):** ONE concept prop via brief-image3d;
   Trellis only after VRAM frees (15.8 GB peak + 3 GB reserve) with abort+budget;
   baker only as licensed option. Default: procedural wins, GLB deleted otherwise.
6. **Reflection preset (T11, last):** capability-gated experiment behind fence +
   readability review; native-RTX stays an owner product decision, never a lane assumption.

## Output paths (this pass)

- `docs/TECHNIQUE-APPLICATION-MATRIX.md` (this file)
- `docs/catalog/technique-applications.json` (12 entries: source URLs, pins,
  licence-observed+date, original-claim vs locally-verified, maps-to, outputs, gates)

