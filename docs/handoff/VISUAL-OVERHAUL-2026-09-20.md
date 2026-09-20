# Visual overhaul — September 20

VERIFIED owner priority: a substantial map-wide improvement in assets, UV/PBR surfaces, lighting and first-person arms/weapons. The overnight build remains below this bar. Frozen inspection build stays at http://127.0.0.1:4212/?operator=authored&lawn=canary&audiobank=2 while successors are tested separately.

| Model route | Assigned work | Current evidence |
|---|---|---|
| GLM 5.3 Flash max | Global light, sky, fog and environment response | OPEN source lane lighting-overhaul-0605 |
| GLM 5.3 Flash max | Ready/progress/activation/targeting killstreak HUD | OPEN source lane streak-hud-0612; preserve four functional streaks honestly |
| Muse Spark 1.3 Contributor xhigh | Facade trim, openings, plinth and surface articulation | CLAIMED source delivered; actual geometry/pixels pending. Procedural Three kit, not a deployed Blender asset. |
| Muse Spark 1.3 Contributor xhigh | Coach GLB adoption and resource ownership | OPEN continuation coach-owned-finish-0618 of exact timed-out GLM partials |
| AGY requested Gemini Flash 3.8 high | Road/pavement albedo, normal and roughness maps | Source/assets delivered. Actual model attribution UNKNOWN. Surrogate tests do not establish implementation lifecycle correctness. |
| AGY requested Gemini Flash 3.8 high | Distant mountain and skyline geometry | OPEN distance-overhaul-0605; actual model attribution UNKNOWN |
| Two owner-authorized Astra xhigh specialists | Glass/reflections and hand/weapon motion plus geometry | See ASTRA-CONTRIBUTIONS-2026-09-20.md; implementation stops at 09:00 |

VERIFIED accepted this morning: plaza batching saves 5–11 actual draw calls in paired views, with extra visible triangles in two views due to coarser culling. This is a modest performance change, not an art upgrade.

VERIFIED rejected trials: glove material and carbine surface changes were too slight to meet the visual goal; both source/assets were restored. Muse pistol geometry failed actual bounds/contact checks. Failed trials remain preserved. Generated reference images and authored candidates are not counted as deployed 3D.

OPEN acceptance sequence: same-camera pixels and moving gameplay first; relevant geometry/material/authority checks; bounded disposal/performance run; exact source/live identity before promotion. GPU and browser work remains serialized. Frozen build is retained throughout.

VERIFIED 06:39 review: AGY mountain geometry passed 21 CPU checks and eight WebGPU frames, but actual silhouettes still read as continuous layered ribbons. Rejected; root source restored. Its source mentions scanned textures but the actual material factory does not bind the downloaded maps; no deployed PBR scan claim is valid.

VERIFIED coach ownership code passed 54 focused CPU checks and actual GLB adoption (310 meshes, six materials, three textures). The actual candidate failed the unchanged 1,200 draw-call limit: 1,295 turningHead, 1,442 spawnA, 1,352 interiorOrange. Viewed coach also has poor wheel/front/window proportions. Rejected and root patch removed; preserve exact worker output and captures/gauntlet/coach/round-0642. A future attempt needs asset redesign and owned mesh batching, not just another loader repair.

VERIFIED GLM lighting and HUD jobs hit their launcher time bounds with source partials retained. Muse lighting-finish-0638 and AGY streak-hud-finish-0638 now continue those exact partials. GLM road-real-proof-0636 and Muse facade-real-proof-0636 replace weak surrogate/static tests with real implementation checks. These are authoring lanes, not accepted improvements.
