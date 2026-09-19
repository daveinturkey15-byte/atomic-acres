# Distant Mountains Canary — Arid Ridge & Strata System

**Author**: AGY Gemini 3.8 Flash (High Lane)  
**Worktree**: `C:/Users/david/Desktop/stuff/worktrees/nuketown-environment-20260919`  
**Reference Root**: `C:/Users/david/Desktop/stuff/worktrees/nuketown-recovery-20260919`  
**Owned Paths**:
- `src/build/distant-mountains-canary.ts`
- `scripts/assets/verify-distant-mountains-canary.mjs`
- `docs/distant-mountains-canary.md`

---

## 1. Visual Target & Defect Analysis

### 1.1 Root Baseline (`checkpoint-j-yardWhite.png` & `src/build/skyline.ts`)
Inspection of the accepted Checkpoint J frame (`checkpoint-j-yardWhite.png`) against `docs/night/VISUAL-BAR.md` (specifically **S5: Sky & distance**) and the target reference `docs/reference/refinement-targets/yard-white.png` demonstrates the primary visual defect:
- **Smooth, lumpy mound morphology**: Existing mountains appear as doughy, sinusoidal mounds devoid of geological realism.
- **Absence of sedimentary strata**: No stepped ledges, cliff faces, or structural terraces exist.
- **Absence of drainage couloirs**: No dendritic erosion channels or talus chutes run down the slopes.
- **Lack of depth separation**: The ranges read as isolated soft objects placed closely behind the fence rather than distant Basin-and-Range desert mountains extending across a vast horizon.

### 1.2 Target Geomorphology (`docs/reference/refinement-targets/yard-white.png`)
The photoreal reference target sets clear visual requirements:
- **Asymmetric fault-block scarps**: Sharp, angular ridge crests, arêtes, V-shaped cols, and tabular mesa caps.
- **Sedimentary strata benching**: Alternating hard cliff faces and gentler structural shelves with regional tectonic dip (~3°–5°).
- **Dendritic erosion channels**: Vertical and diagonal couloirs cutting perpendicularly through strata and dispersing into alluvial aprons at the mountain foot.
- **Frontal spur buttresses (flatirons)**: Projecting outward between washes toward the valley floor to catch dramatic grazing light from the high desert sun.

---

## 2. Technical Architecture & Budgets

The canary generator is implemented in [`src/build/distant-mountains-canary.ts`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-environment-20260919/src/build/distant-mountains-canary.ts).

### 2.1 Budgets & Invariants
| Metric | Budget | Measured Canary Value | Status |
|---|---|---|---|
| **Total Triangles** | $\le 18{,}000$ | **15,744** | **PASS** (12.5% headroom) |
| **Draw Calls** | $\le 3$ | **3** | **PASS** (1 draw per layer) |
| **Layer 0 (Foothill Escarpment)** | N/A | 3,584 triangles (128 $\times$ 14 quads) | PASS |
| **Layer 1 (Mid Massifs)** | N/A | 5,760 triangles (160 $\times$ 18 quads) | PASS |
| **Layer 2 (Far Horizon Peaks)** | N/A | 6,400 triangles (160 $\times$ 20 quads) | PASS |
| **Per-frame allocations** | 0 | 0 (Static meshes, `matrixAutoUpdate = false`) | PASS |
| **Canvas creations** | 0 | 0 (Pure vertex math, no runtime canvas) | PASS |
| **Materials used** | Existing shared singletons | `ctx.mat.painted(PAL.dirt / PAL.mountain / PAL.mountainFar)` | PASS (0 new shaders) |

### 2.2 Layering & Value Ladder
1. **Layer 0 (`foothill_escarpment`)**:
   - Radius: 310 m (meander $\pm 18$ m), height 45–80 m, base sunk at $-12$ m.
   - Material: `PAL.dirt` (0x8a7a5e, roughness 0.98, metalness 0.0).
   - Serves as the warm, dark rock floor of the value ladder with the deepest erosion couloirs.
2. **Layer 1 (`mid_massifs`)**:
   - Radius: 460 m (meander $\pm 28$ m), height 85–145 m, base sunk at $-12$ m.
   - Material: `PAL.mountain` (0xa6b4c4, roughness 0.99, metalness 0.0).
   - Dominant skyline ridge featuring stepped strata terraces, mesa summits, and spur flatirons.
3. **Layer 2 (`far_horizon_peaks`)**:
   - Radius: 660 m (meander $\pm 40$ m), height 135–210 m, base sunk at $-12$ m.
   - Material: `PAL.mountainFar` (0xc6d0dc, roughness 1.0, metalness 0.0).
   - Distant jagged peaks blending seamlessly with scene FogExp2 aerial perspective.

---

## 3. CPU Verification Proofs

Executed via [`scripts/assets/verify-distant-mountains-canary.mjs`](file:///C:/Users/david/Desktop/stuff/worktrees/nuketown-environment-20260919/scripts/assets/verify-distant-mountains-canary.mjs):
```text
node scripts/assets/verify-distant-mountains-canary.mjs
```

### 3.1 Verification Run Output (20/20 Checks Passed)
```text
=== DISTANT MOUNTAINS CANARY CPU VERIFICATION ===

--- 1. POSITIVE PROOFS (Actual Geometry & Contract Checks) ---
[PASS] Draw Calls Budget - drawCalls=3 (limit <= 3)
[PASS] Triangle Count Budget - triangles=15744 (limit <= 18000)
[PASS] Mesh & Geometry Topology Match - meshes=3, geometries=3
[PASS] Layer 0 (foothill_escarpment) Index Validity - indexCount=10752, vertexCount=1935
[PASS] Layer 1 (mid_massifs) Index Validity - indexCount=17280, vertexCount=3059
[PASS] Layer 2 (far_horizon_peaks) Index Validity - indexCount=19200, vertexCount=3381
[PASS] Vertex Attributes Finite (No NaN / Inf) - totalVertices=8375
[PASS] Vertex Normals Normalized Unit Vectors - maxNormalDev=0.000000
[PASS] UV Coordinate Integrity - all UV components finite and non-NaN
[PASS] Bounding Box Finite & Non-Empty - boxMin=(-724.3, -12.0, -732.2), boxMax=(722.2, 188.3, 702.2)
[PASS] Bounding Sphere Valid - center=(-1.0, 88.1, -15.0), radius=1023.5m
[PASS] All Vertices Contained Inside Bounding Box - 100% vertex containment verified
[PASS] Silhouette Angularity Metric (vs Smooth Sine Wave) - canaryRoughness=2.712, smoothBase=0.265, ratio=10.25x (>= 2.0x)
[PASS] Sedimentary Strata Terracing Gradient - meanGradientVariation=8.38m per cross-step (strata benches verified)
[PASS] Determinism: Float-for-Float Reproducibility - identical geometry across separate factory calls
[PASS] Disposal Clears Geometry & Buffers - geometry arrays cleanly cleared and disposed

--- 2. NEGATIVE PROOFS (Budgets, Corrupt Inputs, Fault Injections) ---
[PASS] Negative Proof: Triangle Budget Overflow Detection - detected 40000 tris > limit 18000
[PASS] Negative Proof: Draw Call Budget Overflow Detection - detected 4 draws > limit 3
[PASS] Negative Proof: Corrupted NaN Vertex Rejection - injected NaN immediately trapped by attribute validator
[PASS] Negative Proof: Degenerate Zero-Length Normal Rejection - zero-length normal vector immediately trapped

=== VERIFICATION SUMMARY ===
Total checks: 20
Passed: 20
Failed: 0

ALL DISTANT MOUNTAINS CANARY CHECKS PASSED (100% GREEN)
```

---

## 4. Minimal Integration Recipe for Astra

Astra can integrate the canary into the world scene using either of two clean, zero-risk routes:

### Option A: Standard Builder in Scene Assembler (`src/main.ts`)
```ts
import { buildDistantMountainsCanary } from './build/distant-mountains-canary';

// Inside scene build stage:
const mtnResult = buildDistantMountainsCanary(ctx);
scene.add(mtnResult.group);
```

### Option B: Drop-in Replacement for Mountain Section in `src/build/skyline.ts`
Replace the mountain ring instancing block in `src/build/skyline.ts` with:
```ts
import { createDistantMountainsCanary } from './distant-mountains-canary';

// Inside buildSkyline(ctx):
const mountains = createDistantMountainsCanary(ctx);
g.add(mountains.group);
```

### Benefits of Integration:
- **Reduces draw calls**: Drops mountain draw calls from 8 (4 layers $\times$ 2 buckets) down to exactly **3 draws**.
- **Reduces triangle count**: Cuts mountain triangle count from ~39.9k tris down to **15.7k tris** ($\le 18{,}000$).
- **Eliminates lumpy appearance**: Replaces smooth mounds with stratified fault-block desert ranges matching `docs/reference/refinement-targets/yard-white.png`.
- **Zero shader recompilations**: Uses existing `PAL.dirt`, `PAL.mountain`, and `PAL.mountainFar` materials.
- **Zero layout drift**: All structures sit outside $R \ge 310$ m, preserving all town sightlines, needle/saucer/dome anchors, and gameplay boundaries.

---

## 5. Scope & Boundary Compliance

- **Owned files only**: Created and modified only `src/build/distant-mountains-canary.ts`, `scripts/assets/verify-distant-mountains-canary.mjs`, and `docs/distant-mountains-canary.md`.
- **Preserved dirty files**: Prior working tree state (`src/build/skyline.ts`, `src/build/terrain-ridges.ts`, `docs/environment-mountain-refinement.md`) remained completely untouched.
- **Harness discipline**: No browser, no dev server, no GPU process spawned; no dependencies installed; `node_modules` remained read-only.
- **Non-weakened verification**: All limits strictly tested against $\le 18{,}000$ tris and $\le 3$ draws with negative and positive tests.
