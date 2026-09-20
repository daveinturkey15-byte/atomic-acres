# Coach geometry repair 0824

VERIFIED source delivery and exported geometry. VERIFIED the root's eight-frame
WebGPU report has zero errors, matching served JavaScript hashes and six ready
coach meshes. VERIFIED inspection of the actual `after-turningHead.png` shows
fitted front panes, a seated headlamp and attached arch strips. CLAIMED parent
accepts the geometry repair narrowly; surfacing and the full visual bar remain
OPEN. Geometry approach repair **1/2**. Parent requested no further repair;
this lane is now **HOLD**. This worker ran no Blender, GPU or browser.

VERIFIED final receipt: `root-acceptance-receipt.json` records the exact source,
exported asset and root report hashes. Root's accepted GLB is **4,789,512 bytes**,
SHA-256 `f80eb7eed01ebdbd0d78b2cc7aca50bffdbd84e342b1781eeca7485e5f92194c`.
Worker CPU re-consolidation of the actual raw export reproduces that hash exactly:
**9,824 triangles, six groups/materials, three embedded 1024-square PNGs**.
The asset remains within the frozen envelope. Root's recorded turningHead calls
decrease **704 to 679**, geometry resources **434 to 420**, textures stay **132**.
These static frames do not establish moving-camera or sustained resource results.

VERIFIED source distinction: `accepted-bake-recipe-0840.py` is a byte-exact snapshot
of the recipe root actually baked (SHA-256
`8dde76cf62a943c7b7d60b1544f76f82a8c10290c3f0e5a440b09fe89ad18395`). Root copied
before the final worker normal-recalculation compatibility edit. Its `smart_uv`
uses inherited `normals_make_consistent`; committed `build_coach_geometry_0824.py`
uses BMesh recalculation. That is the only text difference; geometry, helper,
checker and consolidator match. The BMesh variant is not claimed baked or
GPU-tested. Use the accepted snapshot with the bundled helpers to reproduce the
reviewed source. No geometry or surfacing changes followed acceptance.

The following sections preserve the diagnosis, CPU evidence and original pre-bake
handoff. Their bake and fixed-camera gates are closed by the receipt above;
moving-camera, sustained resource and broader art acceptance remain OPEN.

VERIFIED scope: everything is inside this work folder. Root source, source coach
GLBs, vehicle placement, gameplay colliders, loader ownership and material library
were read-only. Existing rejected 0742 artifacts remain intact.

VERIFIED diagnosis from the actual root round-r1-0822 pair and source:

- Right `screen_quad` mixed negative outer coordinates with positive inner/top
  coordinates, crossing the centre and twisting the pane. Both panes also used a
  single centreline nose X across their width, while the real nose turns backward.
  Axis-aligned gasket boxes did not follow either pane's rake or that plan curve.
- Headlamp helper baked a world-space centre into cylinder vertices and then set
  object rotation about the world origin. Its subsequent matrix roll read object
  matrices without first updating the dependency graph. These conflicting frames
  could rotate the placement or lose the intended rotation. New lamps use direct
  surface meshes with no object rotation or such ambiguous intermediate state.
- Seven separate axis-aligned boxes made each alleged continuous arch. They had
  neither shared edges nor a surface-following attachment to the curved body.
- Bumpers/guards and mirror heads exceeded the loader's claimed collider envelope.

VERIFIED repair: the exact preserved body loft is triangulated in a pure CPU
module. Each front/back part vertex intersects the actual hull triangles, then
receives its small outward fitting offset. This produces separate mirrored panes,
matching dark beds/gasket strips/divider, a fitted blind and grille, two seated
headlamp lenses/bezel rings, rear lamps and curved bumpers. The twin headlamp
arrangement follows the procedural baseline instead of the rejected four-cylinder
row. Six closed continuous annular wheel-arch strips follow the actual flank.
Side swoosh ends also follow the real taper. Mirror stalks/heads fit and meet inside
the original envelope. Body loft, PBR maps, six material roles, axles and wheel
centres remain inherited. Wheel decorative chrome lips move to their actual outer
face. Cylinder helpers now use local vertices plus one explicit object location.

VERIFIED actual geometry-only recipe execution: **321 raw mesh objects, 9,824
triangles, six material identities**, bounds **[-5.62,0,-1.4] to
[5.71123594,3.33,1.4]**. Frozen vehicle envelope from `COACH_CANARY_DIMS` remains
**[-5.8,0,-1.435] to [5.8,3.4,1.435]** (11.6 × 2.87 × 3.4 m). No gameplay collider
change is supplied. All geometry triangles satisfy the 12,000 ceiling. The root
consolidator must produce exactly six meshes/materials and three embedded 1024² PNGs.

VERIFIED checks: `python check_geometry.py` executes the exact recipe's geometry
section and helper functions without Blender, rather than a separately rewritten
approximation. It checks full-asset finite bounds/triangle/material counts, pane
separation, Y/Z symmetry and exact local hull offsets; minimum pane triangle-centre
clearance is **0.021576 m**. Each arch is one connected component, with every edge
used twice. Moving glass off its surface and moving a vertex beyond the envelope
both fail. `python -m py_compile build_coach_geometry_0824.py` passes.

VERIFIED preserved test finding: an initial assertion expecting numerically equal
left/right X failed by 3.639 mm because the unchanged loft's triangle diagonals are
asymmetric. The final gate requires identical mirrored Y/Z and each side's exact
actual hull X, keeping all bounds and clearances unchanged. No frozen criterion was
relaxed. The broken actual 0742 GLB fails `consolidate-and-check.mjs` at X=5.91;
the captured expected failure is `rejected-artifact-negative-control.txt`.

Root-only execution, from this directory:

```text
blender --background --threads 2 --python build_coach_geometry_0824.py
node consolidate-and-check.mjs
```

CLAIMED parent bake used 12.35 seconds and 354,021,376 peak private bytes under the
authorized 2-thread / 2-GiB guard. The recipe writes
`coach-geometry-0824.glb` beside itself and asserts the complete pre-export world
envelope. `common.py` and `coach_geometry.py` are bundled dependencies; no mutable
root authoring file is imported. A dependency-graph update precedes the one global
Y-up/export roll. Body normal recalculation uses BMesh rather than the inherited
obsolete `normals_make_consistent` operator; UV settings/maps stay inherited.

The CPU consolidator reads root's already-repaired
`work/coach-batch-0712/tools/lib/{consolidate,glb}.mjs` without editing it. It validates
the new raw asset against this CPU result, strict GLB JSON/length, six draw groups,
six materials and three 1K PNGs before writing
`coach-geometry-0824.consolidated.glb`. Both CPU and exported geometry must agree.

After those checks pass, copy only the NEW consolidated GLB to root
`public/assets/coach-geometry-0824.consolidated.glb` and apply `root-integration.patch`.
VERIFIED: `git apply --check` passes against the actual root source. The patch only
switches the existing owned-canary URL; `?coach=canary`, fallback, ownership/disposal,
parking and colliders remain existing behavior. Do not overwrite either 0742 asset.

VERIFIED fixed-camera criteria were reviewed: root `turningHead` must show separate inset curved
front panes entirely inside their frames, connected round headlamps without an
outward cylinder stack, and continuous attached arch lips. Check the matching
baseline and rejected frames side by side. Preserve body scale and road slots.
Then root checks source/HTTP parity, six live mesh/material groups, actual calls,
textures, moving-camera depth/sorting and a resource gate. Technical checks alone
do not accept the art; keep the procedural baseline if this result fails.

VERIFIED provenance: revised from the project's Muse-authored
`scripts/blender/build_coach_art_0742.py`, SHA-256
`0d36d4e0e2c032f32d0271f904220997603bc5a40da0add1c5c375d7d0d2b365`;
bundled original common.py SHA-256
`cbc4d42a23236449bc414bd01bb6940b8dd1d52c1a6f2d4dac42400dd5fd0909`.
`prepare_recipe.py` verifies the source hash and reproduces the revised file.
Original repair mathematics/code authored here; no downloaded assets, AI images,
old-project source or engine migration. Prior shared procedural-authoring workflow
applies. The authoritative [Blender BMesh API](https://docs.blender.org/api/current/bmesh.ops.html)
URL was attempted but unavailable to the web tool; actual root bake remains required.
