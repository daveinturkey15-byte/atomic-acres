# Visual Critique: Standalone Nuketown Map Frames

## Metadata & Evidence Inputs
- **Image Filenames Read**:
  1. `target-yard.png` (2D generated aspirational concept reference)
  2. `game-yard.png` (Actual runtime game frame: backyard perspective)
  3. `game-barrel.png` (Actual runtime game frame: close prop/perimeter view)
  4. `game-street.png` (Actual runtime game frame: center street/vehicle view)
- **Total Images Read**: 4 images (3 actual runtime game frames + 1 aspirational reference).
- **Scope & Constraints**:
  - Evaluation against generated 2D aspiration (`target-yard.png`) acknowledging non-photoreal stylized target.
  - Active pipelines excluded: GLM turf refinement, Muse car geometry refinement, and rejected static reflection probe glass darkening.
  - Fixed budget constraints: max 3 dynamic lights, 1,200 draw calls, 900,000 triangles.
  - Scope strictly limited to visual assets; no claims on audio, animation, or physics.

---

## Actionable Visual Issues (Beyond Active Lanes)

### Issue 1: Perimeter Fence & Boundary Wall Planar Flatness and Lack of Contact Seams
- **Visible Evidence**:
  - In `game-barrel.png` and `game-yard.png`, the wooden perimeter fence displays perfectly uniform, flat horizontal slats with a monotone orange-tan base color, lacking any perceptible grain depth, gap shadows between planks, or fastener/post detailing.
  - In `game-barrel.png`, the fence connects to the underlying concrete foundation ledge with a razor-sharp, uniform seam devoid of ambient occlusion or ground contact grime.
  - In `game-yard.png` (right midground), the fence line terminates against stark, untextured white cuboids representing utility buildings/containers that lack edge bevels or panel definition.
- **Root Cause Assessment (Inference)**:
  - *Material & Geometry*: The fence asset relies on simple flat box geometry with a uniform diffuse texture devoid of normal/roughness map variance or baked vertex occlusion. The foundation block lacks an ambient contact shadow or dirt gradient.
- **Low-Cost Bounded Correction** (Budget Impact: 0 lights, 0 extra draw calls, <300 tris):
  - *Material*: Update the fence material shader to incorporate a baked 2-channel normal/roughness map or vertex color channel providing dark plank separation lines and top-edge sun bleaching.
  - *Geometry*: Add a simple beveled top cap along perimeter fence segments to catch directional light highlights.
  - *Seam*: Apply a darkened contact gradient at the lower 10 cm of the concrete ledge where it meets the ground plane.

---

### Issue 2: Backdrop Mountain Silhouette Faceting and Atmospheric Depth Bleed
- **Visible Evidence**:
  - In `game-yard.png` and `game-street.png`, the mountain range encircling the map exhibits noticeable low-poly faceted shading where individual triangular polygons are plainly visible along ridgelines and planar faces.
  - The background sky presents as a flat, uniform pale grey/beige expanse with zero horizon luminance ramp or atmospheric haze falloff.
  - Unlike `target-yard.png`, where stratified desert hills establish clear sense of scale and perimeter enclosure, the game backdrop reads as an ungrounded low-poly diorama shell blending directly into the skybox value.
- **Root Cause Assessment (Inference)**:
  - *Geometry & Lighting/Environment*: The mountain backdrop mesh has unsmoothed or flat vertex normals across low-density polygon topology, and the environment lacks vertical height-based or distance fog falloff to separate background geometry from the playable play area.
- **Low-Cost Bounded Correction** (Budget Impact: 0 lights, 0 extra draw calls, 0 tris):
  - *Geometry*: Recompute averaged/smooth vertex normals on the background mountain hull to eliminate faceted polygon shading artifacts without adding geometry.
  - *Material/Environment*: Implement a lightweight height-gradient fog or vertex color fade (warmer desert tone at base transitioning to horizon luminance at upper peaks) in the background mesh material. This restores visual depth and frames the playspace cleanly.

---

### Issue 3: Midground Foliage & Yard Prop Grounding Disconnect
- **Visible Evidence**:
  - In `game-barrel.png`, the green hedge running adjacent to the fence is modeled as a continuous, featureless rounded capsule ("loaf") with uniform synthetic green noise, creating an unnatural plastic silhouette.
  - In `game-yard.png`, the sidewalk trees in the left background and `game-street.png` midground use smooth, monolithic green spherical puffs with no canopy silhouette breakup.
  - In `game-yard.png` (bottom right), the sandbox and shuffleboard court sit flatly on the ground plane without edge occlusion or surface roughness differentiation; sandbox toys (red cylinder, grey capsule) appear ungrounded.
- **Root Cause Assessment (Inference)**:
  - *Geometry & Material*: Hedges and tree canopies are modeled as primitive convex hulls with procedural noise rather than stepped modular silhouettes or clustered volumes. Yard props lack baked perimeter ambient occlusion against the lawn.
- **Low-Cost Bounded Correction** (Budget Impact: 0 lights, 0 extra draw calls via existing instancing, <1,000 tris):
  - *Geometry*: Break the continuous hedge into 3-4 modular segments with subtle height offsets and notch profiles, or attach low-poly silhouette leaf cards along the top edge (<400 tris).
  - *Material*: Add a soft baked contact occlusion border to the sandbox and shuffleboard plane materials to anchor them visually into the surrounding turf. Ensure sandbox sand roughness is distinct from surrounding grass.

---

## Conclusion
Excluding the active refinement lanes (turf, car geometry, and window glass probes), the primary visual deficits between the runtime frames and the aspirational target stem from unsoftened backdrop geometry normals, flat planar perimeter fencing lacking seam occlusion, and primitive monolithic foliage silhouettes. All three corrections are achievable purely through baked material maps, smoothed normals, and minor modular mesh profile adjustments within the existing 3-light, 1,200-draw-call, and 900k-triangle budget, preserving high gameplay readability and 60+ FPS stability.
