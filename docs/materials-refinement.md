# Materials refinement — 2026-09-19

This pass keeps the standalone map's existing material API and draw ownership, then
raises the response of the small hard-surface props that were still using a flat
`painted()` colour.

## Change contract

- Ground, architecture, vegetation and props continue to use the singleton library in
  `src/core/materials.ts`.
- No external mesh, model, or paid generation service was used. A bounded intake
  adds four small CC0 Poly Haven PBR surface sets; their source URLs, physical
  dimensions, API MD5 values, local SHA-256 values, and byte budget are recorded
  in `public/textures/polyhaven/manifest.json`. The added `sparse_grass` 1k set is
  2,859,599 bytes on its own and is used only by the lawn upgrade.
- Every material still has an authored procedural fallback available during the
  synchronous scene build. The local licensed maps upgrade complete channels only
  when all three files arrive successfully.
- The new painted detail set is shared by every `painted()` colour and is 128 px per
  channel: one albedo, one linear roughness map, and one tangent normal map.
- Existing caller signatures, palette values, wetness behaviour, and material cache keys
  remain unchanged.

## What changed

`src/core/material-surfaces.ts` creates a restrained, tileable paint response: broad
roller/cloud variation, fine wear marks, roughness drift, and a generated micro-normal.
`painted()` keeps its supplied base colour and metalness while using those shared maps,
so trim, appliances, props and weapons gain a coherent close-range response without a
texture trio per colour.

The same helper starts safe `TextureLoader` upgrades for Poly Haven Asphalt 07,
Concrete Pavement 03, Distressed Painted Planks, and Sparse Grass. Ground metre-per-UV
constants were checked before choosing repeats: asphalt 16 for a 2.5 m source, concrete
32 for a 2.1 m source, deck boards 1 for ordinary box UVs, and grass 48 for its declared
2 m physical tile across the lawn UV scale. The lawn fallback now uses low-contrast
directional bands, deterministic broad value drift, and fine speckle rather than the
former high-contrast checker.

Material texture generation now uses a reset seeded stream rather than `Math.random()`.
Rebuilding the scene therefore produces the same procedural pixels, which makes visual
gauntlet comparisons meaningful. The ownership set also de-duplicates shared materials
and textures during disposal; the existing cream maps and the new painted maps are each
released exactly once.

## Evidence

- `npm run check` — PASS (`tsc --noEmit` and render-site allow-list).
- `git diff --check` — PASS.
- The twelve downloaded files total 8,448,182 bytes; the Sparse Grass set is 2,859,599
  bytes and remains below the 3 MB asset cap. API-provided MD5 values match the
  local files, and the full SHA-256 values are pinned in the manifest.
- Browser/build/Blender jobs were intentionally left to the integrator; this lane did
  not start GPU work or replace the retained preview artifact.

## Open visual gate

The integration branch must run its normal real-browser capture and inspect the before /
after frames. This lane makes a material claim only; it does not claim the full scene
bar until the integrator verifies paint response at gameplay and close prop distances.
