# r180 shadow material alpha classes

VERIFIED: Atomic Acres uses Three0.180.0. Read the current
[upstream index](https://threejs.org/docs/llms.txt) before a version migration;
current examples do not establish installed APIs. This recipe binds to the
[r180 renderer](https://github.com/mrdoob/three.js/blob/r180/src/renderers/common/Renderer.js)
and the source inspected in `docs/perf/OVERNIGHT-PERF-PASS1-2026-09-26.md`.

VERIFIED: alternating opaque surfaces and alpha-tested leaf cards made the
shared light shadow override cross zero/positive alphaTest values. Material
version changes caused repeated cache-key work in the measured shadow stack.
The trace supported a bounded intervention before reducing scene quality.

VERIFIED: `src/core/shadow-material-canary.ts` wraps only the owned renderer
instance's public renderObject. Native opaque casters retain their override;
ordinary cutouts use one owned sibling per original light override, capped at
eight. The renderer still copies each caster's alpha/map/side state and submits
the original draw once. Custom hooks/nodes, transparency, clipping, alphaHash
and alpha-to-coverage bypass to native behavior. No global prototype, library
source, shadow resolution, quality setting, pass or cadence changes.

VERIFIED: release restores the wrapper only while it still owns the method,
removes base-material listeners and disposes owned siblings. Caller textures
and original materials remain caller-owned. Ten CPU cases, original paired
pixels and fresh local gameplay/net/soak checks protect this integration.

VERIFIED: the requested WebGPU path enables this optimization by default;
`?shadow-material=off` selects the native control. Forced WebGL remains off.
Observed game throughput rose from35.96–37.67 to51.83–54.73FPS in the retained
runs, with varied owner workloads and bot activity. This supports the trace's
mechanism without establishing an exclusive hardware benchmark.

OPEN: sustained60FPS, temporal/owner art acceptance, other Three versions and
uninspected custom material classes. Re-audit the installed renderer on upgrade;
do not copy this wrapper onto an assumed future API.
