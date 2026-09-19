# Atomic Acres — handoff, 2026-09-18 18:30

Written so the next session (Fable, orchestrating) can pick this up cold. Everything
below is verified state, not intention. Where something is unproven it says so.

---

## 1. Where the code is

- **Branch: `layout-boii-proportions`** — all of today's work, pushed.
- **`master` is what GitHub Pages serves** and is deliberately stale. It carries the
  older, wrongly-proportioned but playable build. **Do not publish to Pages** until the
  branch is genuinely playable; that was the owner's standing instruction all day.
- Local preview the owner inspects: **http://localhost:4173/** (`npx vite preview`).
  Port 4173 is pinned in `leak-watch/protected-ports.txt` so the reaper never kills it.

Commits today, newest first:

| | |
|---|---|
| `b989327` | Fix the black screen: take the interactive path off the post chain |
| `911f769` | Land the characters, netcode and weapons lanes; wire characters in |
| `34d7bf9` | Open the west flank; stop the path exporter cutting its own corners |
| `3669346` | Make the AO actually visible; stop every harness popping console windows |
| `c76e1f0` | photoreal lane: light rebalance and two-scale surface breakup |
| `98bf4d1` | The post chain had never run, and both houses were sealed |
| `8e4829d` | Re-proportion the map to the official BO2 minimap |

**Uncommitted right now:** the process-leak fix (`scripts/lib/proc-guard.mjs`,
`scripts/lib/preview.mjs`, and the rewiring of all seven harnesses). It is finished and
verified — capture writes 10 frames, traverse reports 4/4 house faces — but not yet
committed. Commit it before starting new work.

---

## 2. The five things that will waste your time if you do not know them

These each cost hours today. They are all still true.

1. **The post chain now WORKS on the interactive path** (commit `001324d`, 21:40). Two
   root causes, both real, neither guessed: (a) three r180's material cache key ignores
   the MRT, so a direct render of the scene BEFORE the chain's first frame compiles
   single-output shaders for the session and WebGPU silently refuses the chain's
   four-attachment pipeline; (b) `Renderer.clear()` blitted an unwritten frame-buffer
   target over the post frame. The chain is now the first and only thing that renders
   the world; it draws its own QuadMesh with a linear output node. **Never add a
   `renderer.render(scene, camera)` anywhere** - `npm run check` now fails on one that
   is not on the allow-list in `scripts/check-render-sites.mjs`. `?post=chain` is gone
   (the loop always takes the chain); `?post=off` and `?post=ao` swap the output node
   without changing the route. `stats().calls` is now per-frame (info.reset() each
   frame), so the 1200-call budget is measurable; `triangles` still reads 0 on WebGPU.
   `?post=ao` is contrast-stretched for legibility - do not read its pixels as the
   shipped AO strength.

2. **The capture harness tests a path the player does not take.** Captures drive
   `qa.render()`; the game drives the frame loop. That difference is exactly how a black
   screen shipped behind ten green captures and a clean traverse. Any visual claim must
   be checked in the interactive page, not only in a capture.

3. **`traverse.mjs` cannot distinguish "sealed" from "waypoint in a flowerbed".** Use
   `node scripts/paths.mjs` for the real question — it floods the collision world from a
   spawn with the player radius eroded out and reports what is genuinely reachable, then
   emits line-of-sight-simplified waypoints. Never re-simplify a path by taking every
   Nth cell; the chord cuts the corner back through whatever the path walked around.

4. **`?post=ao` output is tone-mapped.** Its pixel values are display values, not linear
   shader values. Reading them as linear sends you down a wrong path.

5. **Playwright's bundled Chromium has no WebGPU adapter.** `chromium.launch()` gives
   `navigator.gpu === undefined`, so `buildPost` silently returns `enabled:false`.
   `capture.mjs` now spawns real Chrome and attaches over CDP. If you write a new
   browser harness, do the same or you will be measuring the WebGL2 fallback.

---

## 3. What the map is now

Re-proportioned today from the **genuine** official BO2 minimap at
`docs/reference/img/nt2025-minimap-boii.png`. Every previous file in that directory was
a 5.8 kB HTML error page — the fetch had no browser User-Agent and nobody checked the
bytes, so every "measured off the minimap" claim before today was void.

Scale assumption is stated with its falsifier in the provenance block at the top of
`src/core/layout.ts`. The headline correction: the **house-to-house axis is the long
one** and the street is short — the turning circle is most of it. The map had been
~2.8× too long along the street, which is why it read as an empty boulevard.

Verified by `scripts/paths.mjs`: **every landmark reachable from spawn A** — both
spawns, both house interiors, all four flanks, the circle, the west road stem, the east
apron. **4/4 house faces enterable** (was 2/4). Handedness invariant PASS.

Still open on layout:
- `traverse` reports 1/5 routes. The map is connected; the stalls are a
  controller-vs-probe disagreement at a point verified clear at every height 0.1–1.7 m.
- Interior topology has **not** been checked against the real map — garage access,
  stairs, both floors. That is in the owner's new brief.

---

## 4. Instruments (use these, they are the point)

| script | what it answers |
|---|---|
| `scripts/paths.mjs` | what is genuinely reachable; emits safe waypoints |
| `scripts/plan.mjs` | top-down collision plan next to the reference at matched scale |
| `scripts/traverse.mjs` | are the specific lanes a player runs still clear |
| `scripts/capture.mjs` | ten camera stations through real Chrome + WebGPU |
| `__NT.collidersAt(x,z,y)` | now reports **which module owns** each collider |

`npm run build` first — both harnesses serve the **built** artifact.

---

## 5. Process hygiene — read before spawning anything

Two leaks cost the owner real time. Both are now defended, but the defences only work
if you use them.

- **`scripts/lib/preview.mjs`** — ONE shared `vite preview` on port **4188** (pinned in
  `leak-watch/protected-ports.txt`). Every harness uses `usePreview()`. Previously each
  spawned its own and killed only the vite parent, orphaning esbuild: 52 servers, 104
  processes, 4.67 GB and 52 listening sockets in three hours.
- **`scripts/lib/proc-guard.mjs`** — `spawnGuarded` / `killTree` / `stopServer`. Kills
  the whole tree and reaps on exit, SIGINT, SIGTERM, uncaughtException and
  unhandledRejection. Chrome in `capture.mjs` uses it; ~600 orphaned Chromes exhausted
  the ephemeral port pool on 2026-09-17 and made the machine unusable for 15 hours.
- A scheduled task **`DevLeakReaper`** runs every 15 min as a safety net. It skips
  anything under 20 min old, anything with an ESTABLISHED connection, and any port in
  `protected-ports.txt`.
- **Launching background agents:** `CREATE_NO_WINDOW` is **ignored** by CreateProcess
  when `DETACHED_PROCESS` is set, and a detached process has no console so its children
  allocate visible ones. Use `CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP |
  CREATE_BREAKAWAY_FROM_JOB` (see the scratchpad `spark.py`). Node's `spawn` also
  defaults `windowsHide` to **false** — always pass `windowsHide: true`.

---

## 6. Characters and animation — the licence position

> **Resolved 2026-09-18 18:40 — see `docs/LICENCES-ANIMATION.md`.** The owner asked for
> the Llama-3 question to be answered, not parked. Decision: proceed with the Kimodo text
> bundle under the Meta Llama 3 Community License; weights never leave the machine;
> "Built with Meta Llama 3" in credits and `public/anim/LICENCES.md`. CMU BVH and
> procedural IK remain as second and third sources. The animation lane is unblocked.


The owner **will not create an Adobe account**, so Mixamo is out permanently. Do not ask.

The chosen route is **Kimodo** (local text-to-motion) + Blender retarget, with the
character mesh built procedurally in code. Verified on disk today:

- `C:\Users\david\projects\kimodo.cpp`, binaries built: `kmd-generate.exe`,
  `kmd-generate-embed.exe`, `kmd-encode.exe`
- Motion weights `kimodo-soma-rp-v1.1-f32.gguf`, manifest traces to
  `nvidia/Kimodo-SOMA-RP-v1.1` — NVIDIA Open Model License, commercial use permitted,
  no country exclusion. The prohibited SMPL-X checkpoint is **not** present.

**Two traps:**
1. The port's README says Kimodo "gives you SMPL-X". That is true only of the SMPL-X
   checkpoint, which we may not use. `soma-rp-v1.1` emits **SOMA-30, not 22 joints**.
   Carry both layouts and select by joint count at import. This has already cost a
   rewrite once.
2. **Unresolved licence question.** Kimodo takes a text prompt *or* a precomputed
   4096-float LLM2Vec embedding. **Both** go through the Llama-3-derived text bundle at
   `weights/generated/llm2vec-text-bundle/` (present, 2.8 GB, built from
   `llama3-8b-instruct-base`). So "don't use the Llama bundle" and "drive it from text"
   are mutually exclusive. Someone must read the Meta Llama 3 Community License and
   decide. **This blocks the animation lane.**

Reference wiring exists in the OLD project (`stuff/atomic-acres/scripts/animation/…`
and `scripts/blender/retarget-kimodo-motion.py`) — read it, it is not in this repo.
`docs/PASS77_KIMODO_SKELETAL_ANIMATION_ASSESSMENT.md` in that project is **stale**: it
predates the SOMA weights and describes the SMPL-X route we are rejecting.

`src/characters/` already contains a skeleton, retarget, clip library, blend tree,
procedural mesh and a budgeted system, wired into `main.ts` with six figures spawned.
The **system** is right and transfers unchanged; only the clip source moves to Kimodo.
The clips currently in it came from a CMU-mocap brief written before the owner's
Kimodo direction and are **not** the ones to keep.

---

## 7. What the lanes delivered, and what they did not

Delivered and committed: `src/characters/**`, `src/net/**` (transport, protocol, room,
snapshot, diagnostics, loopback proof — self-wired via `net/wire.ts`),
`src/weapons/catalog.ts` plus controller/effects/viewmodel revisions, `src/ui/`
reskin with `glyphs.ts`, `layout.ts`, `lobby.ts`.

**Not delivered:** `src/game/` was never created — **killstreaks, scoring and match
state do not exist**. No lane wrote a report except `photoreal` and `light`
(`docs/report-photoreal.md`, `docs/report-light.md` — both worth reading).

Reference imagery: `docs/reference/gameplay/` has 1371 real BO2 frames across six
clips; `docs/reference/img/` has the genuine minimap, aerial, load screen and a
2560×1440 frame; `docs/reference/photoreal/` has 14 agy-generated material studies
(the run was interrupted at 14 of a planned 24).

---

## 8. The owner's brief for the next phase, in his words

Recorded verbatim in intent so nothing is lost in translation:

- Fable orchestrating, spinning up however many Fable sub-agents are needed; Opus 5 also
  available; **set sub-agents to extra-high** for density and quality.
- **Refine the visual art style** — a big visual overhaul. Gameplay "feels like it's
  moved in the right direction"; the gap is visual quality.
- **House interiors must match BO2 topology** — the way you access the garage, the
  stairs, and both floors.
- **Remove some mannequins** — there are far too many.
- **Make the map borders much clearer** rather than invisible walls.
- **Cover more evenly distributed and muted**, and collision must work.
- **Import guns, gameplay, UI, menus and killstreaks** from the previous build, in a
  familiar way — minimap, HUD, killstreak behaviour — but implemented more efficiently.
- **Trellis 2 + Blender locally** for high-quality PBR, mapping, lighting, reflections,
  in an **iterative gauntlet loop** (see the Dreamloop/gauntlet skills).
- **Build a reference library**: the map, the surroundings, every camera angle in
  detail, all guns in all positions, animations, effects, lighting and reflections.
  Use Fable for image gen, supplement with the existing catalogue, and the Antigravity
  CLI for more.
- **Run overnight, ~12 hours, conservative with usage** — slow, steady pace.
- Looking at BO2 on YouTube/Twitch, screenshots, or the installed Steam copy is
  explicitly allowed to get the interiors right.

---

## 9. Machine state at handoff

All Muse Spark (`omp`) agents **stopped** at the owner's request — swapping to Fable.
One `agy` process may still be finishing the photoreal reference images.
At 18:30: 36 GB RAM free, commit ~32 GB, CPU moderate, preview on 4173 alive.
`llama-server` holding ~17 GB is the owner's — leave it alone.

---

## 10. Overnight run — live state (Fable orchestrating, Opus 5 xhigh sub-agents)

Updated 21:30. If you are reading this cold after a crash, this section is the truth.

**Gate for anything touching the renderer:** `node scripts/playcap.mjs` — clicks to play
and photographs the REAL game loop at four positions; fails on a dark frame. Proven able
to fail (0/4 on `?post=chain`, 4/4 on the default path) before it was trusted.
**Do not lower `DARK_THRESHOLD`.**

**Wave 1** (launched 18:32): `renderfix` (post chain on the interactive path) still
running at 21:30 with `src/core/post.ts`, `world.ts`, `main.ts` modified; an adversarial
verifier fires when it returns. Research landed and is committed (`33e87ad`):
`docs/INTERIORS-TOPOLOGY.md`, `docs/IMPORT-PLAN.md`, `docs/reference/library/`.

**Contract change** (`6b88ef8`): `GARAGE_LEN 6.2`, `GARAGE_BAYS 2`, `YARD_X ±14.8` —
two street-facing bays per the research; yard widened to keep the 2.0 m squeeze.
Gated: all landmarks reachable, west flank 42 m → 15 m, 4/4 faces, handedness PASS.

**Wave 2** (launched 21:24, `wf_5f9c4647-341`): `interiors` / `perimeter` / `dressing`
with DECLARED COORDINATE REGIONS (see the workflow script), `handedness` falsifier
(read-only), then `geoverify` which checks collider ownership per region via
`collidersAt().owner`. Commit only if `geoverify.holds`.

**Handedness invariant is under test, not settled.** INTERIORS-TOPOLOGY §7 contradicts
it from one match's frames. It stays derived in one place (`garageIsOnTheRight`) so a
single sign flip fixes the map if the verdict is "mirror". Nobody may flip it on a hunch.

**Animation:** licence resolved (`docs/LICENCES-ANIMATION.md`); Wave 4 brief at
`docs/night/brief-kimodo.md`. Kimodo built + weights present at
`C:\Users\david\projects\kimodo.cpp`.

**Trellis.2:** ComfyUI 0.34.0 running on :8188 (started 21:05 by the orchestrator via the
old client's launch; never restarted/updated). All Trellis.2/Pixal3D nodes present.
Weights were ABSENT (API-verified); fetching the Trellis.2-only set (~8.5 GB) from
`Comfy-Org/TRELLIS.2` into the default models dir — resumable, log at scratchpad
`agylogs/trellis_fetch.log`, provenance note written beside the weights.
Owner authorised: "we do have trellis 2 … keep working through the waves" (18:55).

**Next waves, in order:** 3 gameplay (IMPORT-PLAN §3: vocabulary → lanes A/B/C/D →
integration), 4 animation (Kimodo), 5–7 visual gauntlets per `visual-gauntlet-loop`
(≤6 corrections per loop, fresh blind critic each round, evidence per round).
Concurrency cap ≈5 Opus xhigh. Pages stays on `master`.

**Runtime baseline, 21:52 (first honest per-frame numbers):** draw calls/frame
spawnA 1735 · circle 1160 · spawnB 1729 · orangeInside 1505; triangles/frame 296k–356k.
AGENTS.md budget is 1200 calls / 900k tris. **Over the call budget at 3 of 4 positions**
(the shadow pass roughly doubles the scene's draws). Holds 60 fps here only because vsync
caps it. This is gauntlet item S9; mannequin thinning and vehicle batching are the first
levers. Measured through `scripts/playcap.mjs` — `captures/perframe-summary.json`.

**21:55.** Wave 3 (gameplay, `wf_9803433a-ea2`) launched: vocabulary writer first, then
lanes A/B/C/D, integrator, verifier - exactly IMPORT-PLAN §3. Wave 4 (Kimodo) and Wave 5
(visual gauntlet, one script per subsystem via `args`) are drafted at the session
scratchpad `wave4-animation.js` / `wave5-gauntlet.js` and launch after Wave 2 lands.
Trellis.2 weights: 4/4 on disk and visible to the server (`comfy_up.py` preflight).

**21:58.** Wave 4 (Kimodo animation, `wf_8faff9c6-e08`) launched - single bake agent then
adversarial verifier. Three workflows in flight: geometry, gameplay, animation. Street
gauntlet waits for geometry to land so its critics score final pixels.

**22:15.** Wave 2 landed and is committed (`ea91fe8`): real interiors on both floors,
visible borders, handedness = ROTATIONAL (settled, `docs/HANDEDNESS.md`). traverse is
now 5/5. The dressing lane died on a transient DNS error and is re-running
(`wf_5f9c4647-341` resumed - others replay from cache). Interiors gauntlet launched
(`wf_6b26f3be-4ab`). Open items from the verifier: draw calls 1851/frame at spawnA;
white house reads as a round ring vs the minimap's orthogonal L-block (OWNER QUESTION -
not changed on a hunch); roofless dead-end slot into the white house x 4.3..5.9;
plan.mjs writes .ppm only; the pool cannot be sunk while player.ts clamps the world
floor at y=0.

**23:50.** Wave 4 bake landed: 16 Kimodo clips in `public/anim/`, 30 joints on every
export, canary through four views, foot-slide measured (walk 3.8 cm). Verifier running.
WIRING PENDING until Wave 3's integrator releases `src/main.ts` / `src/ui`: two lines
(`import { loadBakedClips }` + `await loadBakedClips()` before createCharacterSystem) and
the credits line in the UI. Brief corrected: SOMA is Y-up and mirrored; Blender optional.
Wave 3: vocabulary + lanes A-D returned; integrator running.

**23:50.** Wave 4 committed (see its message for the open list). BLOCKED ON WAVE 3 LANDING:
(1) wire clips - `import { loadBakedClips } from './characters/kimodo-clips'` +
`await loadBakedClips()` immediately before `createCharacterSystem` in main.ts;
(2) a credits surface in src/ui carrying "Built with Meta Llama 3" and "Motion: NVIDIA
Kimodo SOMA-RP v1.1 (NVIDIA Open Model License)"; (3) a LEAK HUNT - heap post-GC floor
climbs ~4.2 MB/min with zero figures (verifier's control run) - heap snapshots at t+30/90/
150 s through the real loop, diff retained objects, one bounded fix.

**00:20 (19 Sep).** Interiors gauntlet: 1 round, average 1.5 -> 1.5, state request-input,
integration verdict "improved". Structural fix converged on: AO radius 0.9 -> 3.0 m with
AO_DEEP/AO_OPEN re-measured - running as its own bounded round now. FOR THE OWNER:
(a) "Nuketown" livery text on the coaches - our own procedural text, historical project
name; keep or rename? (b) white upper floor may have a hole at (-3, 19). Also: the white
house is a single-skin capsule shell, so interior/exterior materials cannot differ there
without splitting its geometry - a geometry task, not a material one.

**01:05 (19 Sep).** Wave 3 committed (`3e9e651`): a TDM match runs end to end with bots,
streaks, scoreboard - verifier ran its own headless match (kills 2 -> 12 / 195 s). Clips
WIRED and credits line landed (`7e8f587`); playcap 4/4. Running now: dressing verifier
(`wf_5f9c4647-341`), AO room-scale retune (`wf_6e400e5c-43f`, post.ts only), leak hunt
(`wf_b2a8e68c-585`: heap floor +4.2 MB/min with zero figures), gameplay fixes
(`wf_15ddb204-3ce`: streak-denial livelock backoff, friendly-fire in the pre-resolved
branch, __NTGAME out of src/game, un-export HostLife). Next: street / exteriors / sky /
vehicles gauntlets once the AO retune releases post.ts and dressing lands.
Draw calls now 1348-2112/frame with five bot rigs (~300-380 each) - S9 remains open.


**01:50 (19 Sep).** Geometry verifier (wf_5f9c4647-341) REFUTED the wave on ownership,
not on any numbered gate (paths 15/15, --y 3.3 22/22, traverse 5/5 + 4/4 + handedness,
playcap 4/4 all green): (1) yards props built INTO the external stairs - planter in the
white stair's bottom four treads, patio table in the orange stair's foot - because the
yards keep-out is derived from the DECK and both stairs run past it; (2) the white upper
floor has NO -z face (see-through, shoot-through; the "hole at (-3,19)" is a whole face);
(3) 14 mannequins with zero colliders (pre-existing). Repair running as
wf_8cdb6581-97c: re-aim the orange flight along x per HANDEDNESS.md evidence, each house
EXPORTS its stair footprint and yards consumes + asserts it, close the white face with
wall + glass + chord colliders, mannequin colliders; fresh verifier; max two rounds.
Dressing lane's four files (mannequins 40 -> 14, yards cover rebuilt, vehicles, plaza)
stay uncommitted until that verdict holds. Leak hunt FOUND IT: three r180
Sampler.set texture removes a brand-new onDispose closure so the unsubscribe never
matches, and BloomNode re-points its samplers twice per frame - 132,780 dead listeners
in 2 min; fixed in post.ts (repairSamplerUnsubscribe), floor 4.44 -> 0.02 MB/min;
verifier soak running. Gameplay fixes: 4/4 done (livelock was bots re-pressing a banked
streak at 20 Hz through the 9 s rematch hold), verifier running. AO retune critic1
running. Two 7.5 h orphan vite previews (59359/51235) reaped; :4173 and :4188 intact.
Other open items from the verifier, not this round: capture.mjs draw-call gate prints 0
(blind); plan.mjs writes .ppm only; two sub-metre sealed pockets behind the orange
kitchen counters; draw calls 1348-2112/frame (S9); white house round-ring vs L-block
(OWNER QUESTION).

**02:20 (19 Sep).** Gameplay round 2 committed (`8ba75f7`, verifier HOLDS: one refusal
per match end instead of 179; open: streakRefused resets per rematch, no-placement
sentry rejects bypass the backoff and emit no event, main.ts 480 lines). AO retune
round 1 (`wf_6e400e5c-43f`): radius 0.9 -> 3.0 bought real contact everywhere at zero
draw-call cost, exteriors within 1%, average 1.8 -> 1.9 - but the interior wall FIELD is
still raw 1.0 because GTAONode gates samples on thickness (0.6 m discards every
room-scale occluder; three GTAONode.js:357/371). Round 2 running (`wf_d60fcfb8-ef9`):
thickness 0.6 -> 3.0 + AO_DEEP re-derived on CLEAN goto() frames - the 0.672 came from a
teleport frame where the weapon overlay is 6% of the pixels, p5 was the gun; the true
p5 at radius 3.0 was 0.167. post.ts is uncommitted (AO round 1 + the bloom-sampler
leak fix) until the leak verifier reports. B5 DECIDED (reversible, one-line each): the
billboard, strapline and coach livery now carry the project's own name and an original
line - skyline.ts 'Atomic Acres' / 'Tomorrow Lives Here', vehicles.ts 'Atomic Acres' -
consistent with the 2026-09-17 rename; five critic rounds had failed on it. If the owner
wants the source text back it is two string constants. Characters lane launched
(`wf_e07c393b-832`): one SkinnedMesh per figure (34 meshes -> <=3 draws/pass) and an
operator dress instead of mannequin teal; verifier measures draws/figure, heap, four
views. Geometry repair (`wf_8cdb6581-97c`) still in round 1.

**02:35 (19 Sep).** Leak verifier HOLDS (its own harness, 30 floor samples per run,
calibrated with an injected on-heap leak it read at 2.73 MB/min): zero rigs 0.145,
eleven rigs 0.295 MB/min, worst estimator 0.348, all bloom textures' listener counts
identical at t+60 and t+300 across 14k frames (was 8089 at t+80 before). post.ts
committed at the exact bytes all three critics measured (md5 507376fb: AO round 1 +
the sampler shim). Carried: no regression guard sees this leak yet (only the untracked
_heap*.mjs instruments, now tracked); Runtime.getHeapUsage is BLIND to typed-array /
external memory (a 4.4 MB/min Uint8Array leak read flat) - a GPU or ArrayBuffer leak
needs a different metric; the shim retires the oldest same-function registration, not
the caller's own - harmless only while RenderTarget.dispose dispatches on the target.

**03:55 (19 Sep).** Geometry repair HOLDS in one round and is committed (see its
message): stair footprints exported and asserted, orange flight along the back wall,
white upper front wall closed (0 gaps), 14 mannequin colliders; dressing lane's four
files landed with it. OPEN: descent direction contradicts HANDEDNESS.md (outboard vs
toward the garage - builder's case in the commit), turf roll + crate stack crowd the
orange flight, white house round-ring vs L-block. Hardening lane: H2-H5 committed
(`5856fcc`); H1's soak gate was refuted on one clause (its frame floor counted its OWN
rAF tick, so a dead game loop read as flat) - fixed by the orchestrator: liveness now
comes from __NT.stats().renderCallsTotal (the game's own render() total), the JS gate
needs slope >= 0.5 WITH r2 >= 0.25 (or >= 1.0 at any fit; two clean runs read 0.27 and
0.38 at r2 0.05), the process gate fires at >= 60% of steps up; proven three ways:
clean 120 s PASS (0.182 MB/min, 182k render calls), --kill-loop 60 s FAILS with 0 game
render calls while the page ticked 3720 frames, --inject-kb-per-s 200 FAILS at 12.4
MB/min r2 0.965. `npm run soak` is the long gate (3.5 min), not in check/verify.
Running: characters (`wf_e07c393b-832`), AO round 2 integration (`wf_d60fcfb8-ef9`).
Next: street / exteriors / sky gauntlets once post.ts is free; a vehicles budget lane
(310 objects, the other S9 lever).

**04:05 (19 Sep).** AO round 2 (`wf_d60fcfb8-ef9`, thickness 0.6 -> 3.0, AO_DEEP re-derived
0.672 -> 0.194 on a CLEAN goto() frame - and the 'AO_DEEP never satisfied its rule' finding
is RETRACTED: on the clean route at thickness 0.6 the p5 was 0.669, the shipped 0.672
was right; the 0.167 was itself a teleport-frame reading). Gain, measured: interior wall
fields occlude for the first time (interiorOrange wall gradient p95-p5 12.3 -> 24.0
against 24.1 on the reference frame; whitePoolRoom 11 -> 29 - the white house moved for
the first time), light pool inverted the right way (0.65 -> 1.07), no halo, sky
bit-identical, mountains +2.5%, draws unchanged. Cost: the two rects that used to CLAMP
got lighter (crate base 65 -> 71, threshold floor +7%), the crisp junction creases of the
r=0.9 kernel are gone, and a NEW false wash at midStreet - a flat coach panel reads 229 ->
160 with nothing occluding it (grazing-angle self-occlusion at thickness 3). Integration:
'improved', average 2.2 flat, NO single lever fixes both halves - every probe (AO_CURVE,
distanceExponent, denoise radius) trades wall field against contact on one axis.
Committed as the improved state. Round 3 launched: TWO-SCALE AO - keep the far term
(r 3 / t 3, the wall field) and multiply in a near term (r 0.9 / t 0.6, the kernel that
drew the creases and the crate base), one bounded correction. aperture/wall 0.82 vs the
references' 1.33-1.67 is NOT an occlusion problem: interiors need enclosure-aware
ambient (lighting lane, after the street gauntlet).
