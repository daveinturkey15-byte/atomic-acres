# Glazing and local reflection candidate — 2026-09-20

## Current candidate: bounded repair 1

VERIFIED: root's `captures/gauntlet/glazing/round-0628/result.json` records WebGPU on all four paired stations, HTTP/bundle parity and no console errors. I opened its turningHead and interiorOrange before/after images. House window clarity improved; the coach/car covers still read as flat slate glass. Candidate 0 is retained in commit `37badd0`; it is not claimed to meet the visual bar.

VERIFIED: repair 1 retains the transparent house shader and adds one shared vehicle-only opaque glazing variant. Existing vehicle glazing bounds define a virtual cabin box extending below the sill. A view ray intersects that box; opposite window bands and darker seat/back silhouettes occupy two depths, so movement changes their relative projection. It affects windowDark meshes only under the existing coach, coach-second, saloon, display-sedan and box-truck groups. No vertices, indices, draw calls, lights, colliders or vehicle source change. This is **virtual interior shading**, not reconstructed interior geometry. Four materials maximum; per-mesh bounds are allocated at assembly and removed/restored at disposal.

VERIFIED: the incoming GLM lighting source at `nuketown-prop-20260919/work/lighting-overhaul-0605/src/core/{world,atmosphere}.ts` uses RGBA16F half-float sky data. The repaired helper accepts both RGBA8/Uint8 and RGBA16F/Uint16 and creates matching probe textures. Half-float sky texels are copied bit-exact; authored proxy radiance is not clamped to 1.0. Source texture memory is 768 KiB for legacy byte data or 1.5 MiB for HDR, with the same two textures. Contract: preserve the same DataTexture object, update its bytes plus needsUpdate on TOD/weather change, and retain effective()'s sunDir, sunColor, sunIntensity, hemiIntensity and envIntensity fields. No atmosphere/world edits were made here.

VERIFIED: extended CPU checks cover vehicle-only scope, finite preallocated cabin bounds, unchanged vertex data, restoration of metadata/materials, cache stability and HDR positive controls preserving radiance 8.0 then 16.0 across a version update. Existing checks/typecheck/build pass. The last synthetic bake measured about 28.5 ms RGBA8 and 17.3 ms HDR (different warmup, not a performance comparison). The worker build still excludes the unapplied root assembly hook, so its unchanged bundle name is expected and is not a runtime repair claim.

OPEN: root must rebuild its integrated assembly and photograph repair 1. Inspect coach and car windows in fixed and moving views, with both legacy and authored lighting/TOD. Reject virtual interiors that look like painted grids, reverse parallax, leak onto mirrors, shimmer, or dominate the reference. GPU compilation and moving-frame visual/resource acceptance of this repair remain OPEN. One visual repair is spent; at most one further repair remains before changing approach.

## Initial candidate record (superseded where repair 1 says otherwise)

OPEN: this is a source candidate for independent pixel review, not an accepted visual improvement. Frozen 4212 is unchanged. No browser, renderer, Blender or GPU process was started by this lane.

VERIFIED: lane `art/astra-shading-20260920`, based on `e8b4b6d`, owns `src/core/reflective-surfaces.ts` and the two lifecycle hooks in `src/core/post.ts`. Supplemental evidence is `scripts/check-reflective-surfaces.mjs`, this handoff, its JSON twin and the unapplied assembly patch. No main, world, atmosphere, materials library, builder, geometry, collider or multiplayer source was edited.

## Visual hypothesis and scope

VERIFIED: I opened root's `captures/gauntlet/plaza/round-0543/before-turningHead.png`, `before-plaza.png`, and `before-interiorOrange.png`. The existing vehicle panes and house bands are broad blue fields with little reflected structure. The sky-only environment does not contain architecture. The frozen scorecard remains unchanged.

CLAIMED: this candidate should make the turningHead coach/car windows read as dark glazing with moving reflections, house glass remain clearer face-on and more reflective at glancing angles, and chrome separate the dark road from sky/buildings. The plaza view should change only where the relevant materials appear. It is deliberately a material response change, without another screen-space effect.

VERIFIED: comparison references opened from the shot matrix are `photoreal/streamline-bus-paint-reflections-01.png` (lit-paint-reflection), `photoreal/stucco-wall-sun-shade-ratio-01.png` (lit-sun-shade-ratio), and `gameplay/f-mGpZaLy5_hM-023.jpg` (lit-interior-slider). They are local comparison inputs, not shipped assets. The glazing Fresnel row is NEED, so no nonexistent reference is claimed.

## Implementation and assembly contract

VERIFIED: enable only with `?glazing=canary`. Absent/other values leave baseline materials unchanged. Root applies `docs/astra-shading-integration.patch`, which adds one import and calls `installReflectiveSurfaces(world.scene, mat, world.atmosphere)` immediately after the BUILDERS loop, before any frame. The patch is intentionally not applied in this worker lane.

VERIFIED: material scope is identity-exact: meshes using `mat.glass`, `mat.roofGlazing`, and `mat.windowDark` receive three shared thin-glazing node materials. `mat.chrome` receives one street environment map. Roads, paint, glass-coloured opaque painted canopies and unrelated materials stay untouched. Original material references, array identity, tint, roughness and opacity intent are retained in source metadata; the transparent/opaque distinction remains. Transparent glass uses source-over compositing with a two-interface Schlick Fresnel term and low absorption, avoiding a constant alpha multiplying away its specular term. Geometry and hit volumes do not change.

VERIFIED: the environment is an **approximate static local probe**, not real-time scene reflection. Seven layout-derived building masses, coarse window bands and ground regions are CPU baked into five 256×128 angular views (street, each house front and rear). No old project source/assets or third-party imagery are copied. The source atmosphere supplies sky texels and live sun/ambient values. Chrome uses the street view through standard PMREM; glazing samples the atlas directly with the source roughness selecting a low mip. Three materials and two byte textures total 786,432 bytes before GPU mip/PMREM storage. No added scene draws, lights, scene capture, render target or full-screen pass is requested.

VERIFIED: `post.ts` runs a WeakMap lookup and environment-version comparison before the existing render. A TOD/weather transition that bumps the existing sky texture version rewrites the same byte buffers once, then marks textures for upload. Ordinary updates allocate nothing in this module. The existing material and node graphs remain fixed. Root's lighting lane must preserve the current in-place RGBA8 `scene.environment` texture contract; if it replaces that texture object, this module's capture must be revisited. `post.dispose()` restores borrowed bindings and disposes only the three owned materials and two owned textures; repeated disposal is safe.

## Mechanical evidence and open acceptance

VERIFIED: `npm run check` passes TypeScript and the unchanged direct-render allow-list. `npm run build` passes; the worker bundle is `dist/assets/index-CwyYJisQ.js` before assembly integration. This is not a playable canary because the assembly hunk is still unapplied.

VERIFIED: `node scripts/check-reflective-surfaces.mjs` passes finite/axis-parallel hit and miss controls, deliberate NaN rejection, default-off behavior, exact material scope, 10,000 idle refreshes with unchanged texture/material/cache identities, a positive TOD control that changes pixels in the same buffers, and repeated-disposal ownership controls. The synthetic transition bake measured approximately 30 ms on this run; this is CPU fixture timing, not gameplay frame time. Receipt: `captures/astra-shading-cpu/receipt.json` (local, ignored).

OPEN: root must apply the assembly hunk, build, and run actual WebGPU first-frame/playcap checks. The new Basic node materials explicitly initialize roughness/metalness in the existing MRT; shader compilation has not been observed by this worker. Root then compares fixed turningHead/plaza/interiorOrange frames and moving-camera exterior/interior views with the baseline/reference, checks window sightlines and alpha sorting, runs TOD/weather transitions, and measures resource/frame-time impact. Reject if massing reflections, probe zone boundaries or missing exact parallax become conspicuous in movement. Reflections omit actors, small props, vegetation detail and nearby vehicle self-reflection; this limitation must not be relabelled as accurate scene reflection. No score or 60 fps claim is made.

OPEN: the material tint absorption is physically motivated but still needs visual review against the retained glass intent; transparent depthWrite is disabled to prevent a clear pane occluding subsequent transparency. Alpha sorting, changes to AO at transparent depth edges, and the fixed probe neighbourhood boundaries are the important canaries. The module exposes `changedMeshes`, `bytes`, `bakeCount`, `lastBakeMs` and `disposed` on the returned installation for root QA.

## Sources and failed attempt

VERIFIED: current documentation was consulted first at [Three.js llms index](https://threejs.org/docs/llms.txt) and [full guide](https://threejs.org/docs/llms-full.txt). Installed package/source is three `0.180.0`. API decisions were checked against [r180 ReflectVector](https://github.com/mrdoob/three.js/blob/r180/src/nodes/accessors/ReflectVector.js), [r180 EquirectUV](https://github.com/mrdoob/three.js/blob/r180/src/nodes/utils/EquirectUV.js), [r180 NodeMaterial](https://github.com/mrdoob/three.js/blob/r180/src/materials/nodes/NodeMaterial.js), and [r180 EnvironmentNode](https://github.com/mrdoob/three.js/blob/r180/src/nodes/lighting/EnvironmentNode.js). Shared interior-look workflow and frame-loop audit were read; the daylight candidate does not import the interior skill's dark value recipe.

VERIFIED: one authoring error was repaired locally: `vec3(Color)` failed the installed r180 TypeScript overload; the corrected node uses explicit linear RGB components. The unchanged check subsequently passed. No visual repair round has been spent. Maximum two visual repairs remain for root's bounded canary, followed by a change of approach if needed.
