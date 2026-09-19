# Runtime resource review

Date: 2026-09-19
Scope: source-only lifecycle audit of the recovery build. Reviewed the rain shelter,
atmosphere weather path, vegetation material/tree builders, viewmodel materials,
impact material, weapon-effects pools, world audio, `GameClient` presentation queues,
and `main.ts` integration. No browser, GPU, build, or server run was performed for
this pass, so runtime heap/renderer counters remain OPEN for the owner’s soak.

Claim states in this note are explicit: **VERIFIED** means established from the
current source; **OPEN** means a lifecycle condition that needs a runtime or future
integration check; **INFERENCE** means a likely consequence of the source shape.

## Hot-path map

**VERIFIED** `main.ts:305-349` drives one request-animation-frame path. The player,
world audio, weapon controller, world post/atmosphere render, viewmodel overlay,
characters, match, and ordnance update from there. `world.render()` calls
`atmosphere.update()` (`src/core/world.ts:265-271`), and the smoke adapter explicitly
uses preallocated uniform arrays (`src/core/atmosphere.ts:537-566`).

**VERIFIED** `main.ts:76-100` builds the static world once, then calls
`setRainShelter(worldTargets)` once. The weather switch at
`src/core/atmosphere.ts:970-980` applies new values to the same lights, uniforms,
environment texture, and rain mesh; it does not rebuild the world or tree groups.

**VERIFIED** match transitions create a new `GameClient` in the solo/guest drivers
(`src/game/session-solo.ts:117-119`, `src/net/match-guest.ts:60-62`) and dispose the
old driver when the session swaps it (`src/game/session.ts:140-146`). Rebinding the
presentation lanes is centralized at `src/main.ts:202-210`.

## Verified bounded or reused resources

| Area | Evidence | Lifecycle assessment |
| --- | --- | --- |
| Rain shelter | `src/core/rain-shelter.ts:13-16,26-62` keeps one `Float32Array`, one `Uint16Array`, and one `DataTexture`; `build()` clears and updates them. | **VERIFIED** fixed storage, approximately 589,824 CPU-side bytes for the two arrays. `texture.needsUpdate` is the only weather/build upload. `dispose()` releases the texture (`src/core/rain-shelter.ts:94-98`). The temporary vectors/matrices in `build()` are discrete build work, not frame work. |
| Rain and smoke | `src/core/atmosphere.ts:856-892` creates the rain geometry/material once. `src/core/atmosphere.ts:537-566` writes into bounded smoke uniform arrays; expired local smoke records are removed. | **VERIFIED** no per-frame object/texture creation in these paths. Atmosphere teardown disposes the rain resources and rain shelter (`src/core/atmosphere.ts:990-995`), while the world teardown disposes post, atmosphere, sky, environment texture, and renderer (`src/core/world.ts:278-285`). |
| Weather/TOD changes | `src/core/atmosphere.ts:923-962` mutates lights and uniforms and rebakes the existing environment texture. | **VERIFIED** no replacement texture, light, or rain mesh per switch. **INFERENCE:** `u.sunLin.value.clone()` at line 948 creates one short-lived `Color` per discrete apply; it is not a frame leak, but a future rapid cycle can generate avoidable garbage. |
| Vegetation textures | `src/core/vegetation-materials.ts:19-67` creates four local textures and one shared leaf-card material; its disposer releases all five. `src/core/materials.ts:288-295,920-926` owns it in the material-library disposer. | **VERIFIED** one shared material/texture set; no frame allocation. Repeated `buildMaterials()` calls must be paired with `dispose()`, but the current main path builds once. |
| Vegetation trees | `src/build/vegetation-tree.ts:217-240` creates five geometries and five static `InstancedMesh` pools; `src/build/vegetation-tree.ts:245-355` writes matrices once and marks `StaticDrawUsage`. | **VERIFIED** build-only geometry and matrix work; five draws and fixed instance counts for the authored specs. No update subscription or frame allocation. **OPEN** `VegetationTreeResult` exposes only `group` and `stats` (`src/build/vegetation-tree.ts:42-45`), so the module has no direct geometry disposer. Current `main.ts` builds it once and never rebuilds it; an in-place world rebuild would need an owner-side disposal contract before discarding the old group. |
| Viewmodel materials | `src/weapons/viewmodel-materials.ts:261-289` creates four shared materials and twelve owned textures, with an idempotent disposer. | **VERIFIED** startup-only generation, shared across weapon rigs, no per-frame texture/material work. Reported CPU image-data budget is 1,572,864 bytes from the declared stats formula at lines 273-280. |
| Impact material/effects | `src/core/impact-material.ts:5-37` creates one 128px scar atlas and one material; `src/weapons/effects.ts:109-194` creates fixed transient/decal pools; `src/weapons/effects.ts:348-463` updates slots in place. | **VERIFIED** impact presentation is bounded: 8 tracers, 24 shells, 12 sparks, 4 impact quads, 10 dust puffs, and 48 decals. `WeaponEffects` reuses the material-library singleton and its ring buffers; sustained fire/impacts do not append unbounded meshes. The impact texture/material are released by the material library’s owner set. |
| World audio | `src/audio/world-audio.ts:18-56` keeps reusable ray, vectors, hit array, material map, and shot scratch; `src/audio/world-audio.ts:58-105` only raycasts on a footstep threshold. | **VERIFIED** normal frame updates reuse scratch state. Remote shots are drained into the same caller-owned array, and bind transitions clear the previous queue (`src/audio/world-audio.ts:48-56,107-131`). No audio node or buffer is created in this loop. |
| Remote shot queue | `src/game/client.ts:120-138,239-255,396-403` bounds pending remote shots to 24 and the dedupe identity cache to 128. `WorldAudio` drains it each update. | **VERIFIED** remote shot bursts cannot grow the queue without bound; stale events are rejected after 750 ms. **VERIFIED** ordinary UI edges are drained every UI frame (`src/ui/index.ts:207-227`), while `GameClient.drain()` removes the whole edge array (`src/game/client.ts:419-423`). |

## Open lifecycle conditions and boundaries

1. **OPEN — tree geometry teardown on future rebuilds.** The current startup has one
   tree build and no weather/match path that rebuilds the static world, so this is not
   evidence of a current repeated-weather leak. If hot reload, a map remount, or a
   future match-level world rebuild is added, the old tree group’s five geometries
   need an explicit owner-side disposal before replacement. Do not dispose the shared
   bark/leaf materials from the tree lane; those belong to `MaterialLibrary`.

2. **OPEN — whole-world teardown is not wired from `main.ts`.** `createWorld()`
   exposes `dispose()` (`src/core/world.ts:278-295`), but `main.ts` only registers
   `weapons.disposeAudio()` on `pagehide` (`src/main.ts:225-229`). For the present
   one-document lifetime, browser teardown reclaims the world; this does not prove a
   leak during a page reload. A future HMR/remount path should call world disposal,
   match disposal, and any scene-owned private geometry teardown exactly once.

3. **OPEN — effect-pool geometry teardown on future controller remounts.**
   `WeaponEffects` owns five private geometries (`src/weapons/effects.ts:43-48,124-128`)
   but exposes no disposer; the current controller is constructed once
   (`src/main.ts:153-160`) and adds that group to the scene
   (`src/weapons/controller.ts:256-257`). This is fixed
   startup GPU geometry in the current route, not a per-shot leak. A future controller
   or scene remount should remove the group and dispose those private geometries,
   while leaving material-library singletons to `MaterialLibrary.dispose()`.

4. **OPEN — client metadata lifetime is bounded by driver lifetime.** `GameClient`
   keeps `names`, `streakNames`, `lastShotAt`, and `samples` maps
   (`src/game/client.ts:129-138`) without a public `clear()`/`dispose()`. The current
   session creates a new client per driver and disposes the old driver on swaps, so
   the maps become collectible with that client. If a future implementation reuses a
   client across rooms or leaves a driver retained, actor-id churn could retain stale
   metadata. This was not changed in a read-only audit.

5. **OPEN — `GameClient.edges` assumes its consumer remains live.** The array is
   drained every normal UI frame, so it is not an unbounded queue in the current
   integration. If UI binding stops while network events continue, `push()` has no
   capacity guard. The bounded remote-shot queue is safe; this separate feed/banner
   edge path should gain an owner-approved backlog metric or cap only if the product
   adds a paused/disconnected UI route.

6. **INFERENCE — discrete weather garbage.** Repeated `set()`/`setWeather()` calls
   rebake the same environment texture but allocate the `Color.clone()` mentioned
   above. This is a small bounded transient per call, not a persistent GPU resource.
   The owner’s live weather-cycle soak should watch JS heap slope while switching
   weather/TOD rapidly; no source change was made here.

## Owner follow-up checks

The next live pass should run a finite weather/TOD cycle, rematch/host-guest swap,
and an impact/remote-shot burst while sampling renderer memory, texture count, and
JS heap after idle points. The source audit predicts stable resource counts for the
current single-world route. Any growth would first implicate an integration caller
that rebuilds a static group or retains a replaced driver, rather than the bounded
rain, effects, audio, or remote-shot loops themselves.
