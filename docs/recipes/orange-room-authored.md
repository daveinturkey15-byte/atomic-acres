# Orange living room: original furniture and physically scaled surfaces

September 20, single Astra lead. Candidate switch `room=authored`; baseline stays
available on the same bundle. This is original procedural mesh authoring plus CC0
photographed materials, not image-to-3D or Blender output. Existing fixed gameplay
cameras and the frozen visual bar apply; visual review is self-review per Dave's
single-agent instruction.

Scope: replace the block sofa, tall cupboard and TV with rounded cushions, piping,
tufting, veneer casework, inset doors, hardware and screen detail. Restore the rug
above the existing floor finish; use a fine woven carpet instead of the saturated
flat blue finish. Reduce the lounge pendant's blown-out emissive core without
changing the scene light set. All 240 authoritative orange-house colliders retain
their original values and order. Room staging, doors and travel lanes stay fixed.

Frozen limits for this slice: <12,000 triangles per furniture prefab; <40MiB of
additional uncompressed mipmapped texture storage; existing capture ceiling1,200
draws/900,000 triangles and existing active-match soak thresholds unchanged. No
new per-frame work. At most two visual repairs; retain rejected output.

VERIFIED CPU: sofa3,648 triangles, cabinet1,500, TV1,124; finite UVs/vertices and
envelope checks; exact collider parity; material+texture disposal once; delayed
loads cannot revive disposed materials. Existing architectural shader-cache guard
also passes. These checks do not establish visual acceptance.

Sources: [Three r180 sheen example](https://github.com/mrdoob/three.js/blob/r180/examples/webgpu_loader_gltf_sheen.html),
installed r180 RoundedBoxGeometry, [Poly Haven leather](https://polyhaven.com/a/fabric_leather_02),
[table veneer](https://polyhaven.com/a/wood_table_001), [CC0 terms](https://polyhaven.com/license).
Exact file URLs, MD5/SHA256 and real-world tile sizes are recorded in
`docs/assets/orange-room-surface-provenance.json`. Cloth weave is original code;
texture code and downloaded photo output are distinct provenance routes.

VERIFIED partial successor: R2 actual gameplay pixels and210-second stability
passed; see `docs/handoff/ROOM-REVIEW-2026-09-20-1555.md`. R2 adds glazed barriers
and continuous handrails while preserving authoritative bounds. OPEN: finished
room daylight/contact, richer dressing,60fps and the map-wide overhaul.

R3's aperture ambient graph was visually negligible and rejected, despite CPU and
render success. It is retained only behind the additional`room-light=aperture`
diagnostic switch. Both repair slots are consumed; change lighting approach.

Recipe: materials are lazy singletons in MaterialLibrary; placeholders exist
before shader compilation and update their image with stable binding identity.
Metric UVs are authored before static batching. Dispose belongs to the library,
including failure/late-load paths. Avoid changing the architecture cache key.
