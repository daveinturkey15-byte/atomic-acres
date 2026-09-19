# Operator material refinement

Date: 2026-09-19
Scope: one shared material for the existing merged skinned operator geometry.

## Current pipeline

**VERIFIED:** `src/characters/mesh.ts:382-466` bakes one `color` attribute per
vertex from the existing three dress slots. The same file keeps `skinIndex` and
`skinWeight` unchanged, merges the geometry into one draw, and caches one geometry
per faction dress (`src/characters/mesh.ts:469-483`). `src/core/materials.ts:842-851`
currently creates a white, vertex-colour `MeshStandardMaterial` with no detail map.

The source has a usable region signal without a geometry change: the baked palette
has a warm red/green separation for exposed skin, mid-value fatigues, and a dark
branch for boots, gloves, webbing, and kneepads. The operator material can therefore
add restrained surface variation while leaving team colours in the vertex attribute.

The current gait captures show the existing operator at a distance where broad value
blocks read, but cloth and dark kit are still flat. This is a material observation;
the captures do not establish the final appearance of the unintegrated candidate.

## Candidate module

`src/characters/operator-materials.ts` adds `createOperatorMaterial()`:

- one shared `MeshStandardNodeMaterial` for every faction and figure;
- one deterministic 256×256 `DataTexture` with fine weave, broad wear, and sparse
  scuff channels;
- explicit `attribute('color', 'vec3')` consumption so the baked vertex colour is
  multiplied exactly once;
- a red/green and luminance mask that keeps the strongest breakup on cloth and dark
  leather/webbing while preserving exposed skin colour;
- albedo modulation capped to a few percent, with most readability carried by
  roughness variation;
- no normal map, avoiding high-frequency shimmer on the low-poly figure at distance;
- an idempotent `dispose()` for the material and detail texture.

The declared resource budget is one material, one texture, 262,144 CPU-side RGBA
bytes, zero normal maps, and one draw per figure. No per-frame or per-figure texture
generation occurs.

## Required root wiring

The root integrator should wire the module inside the existing material-library
ownership path, rather than constructing it in `main.ts` per character:

1. Import `createOperatorMaterial` in `src/core/materials.ts`.
2. Create one `const operatorSurface = createOperatorMaterial();` beside the other
   library resources and register it with the existing `own(operatorSurface)` set.
3. Make `operator(rough = 0.80, metal = 0.02)` return the shared candidate material
   for the only current game call (`src/main.ts:117`). If custom operator roughness
   or metalness callers are added later, extend the factory deliberately instead of
   silently sharing incompatible values.
4. Leave `src/main.ts`’s `material: mat.operator()` call, faction palette, mesh
   geometry, skin weights, and draw-count path unchanged.

## Verification state

**VERIFIED:** `npx tsc --noEmit --pretty false` passes with the new module present.
The module has not been wired into the live material library in this lane, so no
browser or GPU appearance claim is made here. Root must capture a close operator
front/side/three-quarter set after integration and confirm team colours, skin tone,
cloth readability, and stable renderer memory before accepting the candidate.

**OPEN:** the mask is inferred from the existing baked palette rather than a
per-part ID attribute. If a future faction palette collapses skin and cloth values,
the correct fix is an explicit material-region attribute in the geometry bake; a
global tint would be the wrong fallback.
