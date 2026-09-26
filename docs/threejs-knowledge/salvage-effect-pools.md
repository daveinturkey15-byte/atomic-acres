# Admitted weapon and streak effect pools — 2026-09-26

VERIFIED source: Three.js installed 0.180.0; this pass retains the existing
WebGPURenderer, post chain and material registry. No new shader technology or lights.

Current references consulted:

- [Three.js index](https://threejs.org/docs/llms.txt) and
  [complete docs](https://threejs.org/docs/llms-full.txt).
- [InstancedMesh API](https://threejs.org/docs/pages/InstancedMesh.html): matrix
  writes need `instanceMatrix.needsUpdate`; mesh-owned GPU state and shared
  geometry/material ownership have separate disposal responsibilities.
- [r180 instance example](https://github.com/mrdoob/three.js/blob/r180/examples/webgpu_instance_uniform.html)
  and the installed renderer/material source. Check the installed release,
  since current upstream docs describe a newer release.
- Poimandres docs MCP, `drei /performances/instances`, read successfully:
  [Instances](https://drei.docs.pmnd.rs/performances/instances). Raw Three.js
  instancing is appropriate for these fixed, frequently updated pools; no R3F
  dependency was added.

VERIFIED implementation: `src/weapons/weapon-effects-scene.ts` consumes admitted
weapon-effect events through a 32-slot ring. Five fixed instanced batches draw
flame tongues, flare trails/fire, rail traces and crossbow bursts. Animation uses
absolute event time; flare travel follows the host's 120 Hz semiimplicit gravity.
It owns three geometries and no materials.

VERIFIED implementation: `src/weapons/streak-effects-scene.ts` draws host spatial
snapshots with 16 slots and nine fixed batches. Snapshot time plus remaining
lifetime expires equipment after a stale network feed. Sentry barrel yaw and
shot edges, crate presence/capture state, tracker range, fallout range and relay
target line are presentation; the scene does not aim, admit damage or grant rewards.
It owns four geometries and no materials. Existing mortar presentation remains
owned by `mortar-fx.ts`.

Gotcha: white emissive bases wash out team colours. Cause: instance colour tints
the diffuse term while the material's emissive colour remains white. Correction:
separate cached teal/red emissive batches and a warm muzzle batch. Verify actual
team-coloured pixels, then keep the existing frame budget; never repair this by
mutating a shared material's colour while rendering each team.

VERIFIED CPU lifecycle proof: `node scripts/_verify-salvage-effect-scenes.mjs`
passes nine checks including a 5,000-event flood, matrix finiteness, duplicate
event handling, flare launch/impact identity, stale snapshot expiry and idempotent
disposal that leaves registry materials intact.

OPEN until root browser acceptance: actual appearance, frame costs, device/mobile
behavior and the unchanged gameplay soak. `scripts/capture-salvage-effects.mjs`
uses the normal custom-loadout, Deploy and trigger paths; its screenshots are
actual admitted effects, with QA teleport staging explicitly recorded.
