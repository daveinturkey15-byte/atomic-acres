# Receipt: Bounded Repair 1 of Fence Art (`fence-art-repair1-0918`)

## 1. Ownership & Worktree Boundary
- **Directory**: `C:/Users/david/Desktop/stuff/worktrees/nuketown-prop-20260919/work/fence-art-repair1-0918` exclusively.
- **Predecessor State**: `work/fence-art-agy-0900` preserved 100% untouched.
- **Root State**: `nuketown-recovery-20260919` strictly READ-ONLY (no root files edited, all patches verified with `git apply --check`).
- **Runtime Constraints**: Zero GPU/browser/Blender/server required; pure CPU Three.js r180 geometry verification.

## 2. Defects Diagnosed & Corrected

### A. Triangle Index Winding and Facet Normals
- **Plank Longitudinal Facets**:
  - *Defect*: Declared normals were shifted by one profile edge in the lookup array, and quad triangle indices `(0, 1, 2)` produced inward-facing cross products `(c - a) x (d - a) = (-dy * L, dx * L, 0)`, giving `dot = -1.0` (80 of 140 triangles facing inward in root's audit).
  - *Correction*: Computed analytic outward facet normals directly from CCW profile edge vectors `(p0 -> p1)` via `(dy, -dx, 0) / hypot(dx, dy)`. Re-indexed quad triangles `(v0, v1, v2)` and `(v0, v2, v3)` so cross-product normal `(v1 - v0) x (v2 - v0)` points outward with `dot = 1.0` against declared normals.
- **Hardware Hex Bolt Sides**:
  - *Defect*: Side quad indices produced cross product vectors with negated Y and Z components, causing all 12 side triangles per bolt (180 of 270 triangles total in root's fixture) to face inward (`dot = -1.0`).
  - *Correction*: Re-ordered quad vertices `v0=(0, y0, z0)`, `v1=(0, y1, z1)`, `v2=(D, y1, z1)`, `v3=(D, y0, z0)` with indices `(v0, v1, v2)` and `(v0, v2, v3)` so cross products point radially outward with `dot = 1.0`.
- **End Caps**:
  - End caps at `Z = -halfL` (`[0, 0, -1]`) and `Z = +halfL` (`[0, 0, 1]`) maintained with verified CCW outward winding (`dot = 1.0`).

### B. Truthful Labeling of End Grain
- *Correction*: Replaced inaccurate descriptions ("authentic annular cut-log end grain") with truthful documentation: the cut ends use a **transverse cross-cut crop from the timber texture** (perpendicular grain orientation to eliminate longitudinal stretching across the 6cm end grain; not procedural annular tree rings).

### C. Type Safety & Unused Imports
- *Correction*: `FenceBoardsBuild.mesh` in `fence-boards.ts` is typed as `THREE.Mesh | THREE.Group`. Removed the unsafe `group as unknown as THREE.Mesh` cast in `fence-boards-canary.ts`. Cleaned unused imports (`PLANK_WINDOWS`, `PLANK_TEXTURE_SIZE`).

### D. Post Contact Positions and Stale Triangle Counts
- *Correction*:
  - Stale `~7,800` triangle claim in comments/code corrected to actual measurements:
    - **12 Map Segments (Default Mode)**: 60 boards (1,680 tris) + 510 bolts (9,180 tris) = **10,860 triangles** (+10,140 added <= +12,000 budget).
    - **12 Map Segments (Exact `yards.ts` Post Contacts)**: 60 boards (1,680 tris) + 450 bolts for the 90 physical posts in `yards.ts` (8,100 tris) = **9,780 triangles** (+9,060 added <= +12,000 budget).
  - Added support for `seg.posts?: readonly number[]` on `FenceBoardSeg`.
  - Created minimal `patches/yards.patch` that passes actual post contact positions `posts: segPosts` and `mat.steel` fastener material.

## 3. Independent Verification Results

### Root Audit Script Reproduction (`.recovery-runtime/check-fence-winding-0916.mjs`)
Executed root's exact winding check formula on `[{x0: 0, z0: 0, x1: 0, z1: 2}]`:
- `fence-course-boards-weathered`: **140 triangles total, 0 reversed, 0 misaligned** (was 80 reversed, 80 misaligned).
- `fence-hardware-fasteners`: **270 triangles total, 0 reversed, 0 misaligned** (was 180 reversed, 180 misaligned).
- Exit code: **0 (PASS)**.

### Rotated Segments Check
Verified single segments rotated at 0°, 45°, 90°, 135°, 180°, and 270°:
- **0 reversed, 0 misaligned** across all orientations.

### Complete 12 Map Segments Verification (`verify-fence-art-canary.mjs`)
- **Suite 1 (Baseline Mode)**:
  - 60 boxes, 720 triangles, single `THREE.Mesh`, exact Y bounds `[0.58, 1.91]`. PASS.
- **Suite 2 (Root Fixture Audit)**:
  - Boards: 140 tris, 0 reversed, 0 misaligned. PASS.
  - Fasteners: 270 tris, 0 reversed, 0 misaligned. PASS.
- **Suite 3 (Rotated Segments)**:
  - 6 angles tested: all 0 reversed, 0 misaligned. PASS.
- **Suite 4 (12 Map Segments Default Mode)**:
  - Zero helper RNG: 100% deterministic buffers. PASS.
  - Draw calls: 2 (boards + fasteners <= +4 budget). PASS.
  - Triangles: 1,680 boards + 9,180 fasteners = 10,860 triangles (<= 12,720 budget). PASS.
  - Winding & Normal alignment: **all 10,860 triangles have dot >= 0.99 (0 reversed, 0 misaligned)**. PASS.
  - Bounds preservation: Y [0.58, 1.91], X and Z match baseline within millimeter tolerance. PASS.
- **Suite 5 (Alignment with `yards.ts` Posts)**:
  - 90 physical posts in `yards.ts` mapped to fence board segments.
  - 90 posts x 5 courses = 450 bolts (8,100 triangles), total 9,780 triangles.
  - All 8,100 fastener triangles have **0 reversed, 0 misaligned**. PASS.

## 4. Deliverables Manifest
- `src/build/fence-boards-canary.ts`: Corrected canary fence builder.
- `src/build/fence-boards.ts`: Root-applicable whole file with `FenceBoardsBuild.mesh` typed as `THREE.Mesh | THREE.Group` and `posts` support.
- `patches/fence-boards.patch`: Root-applicable patch (passes `git apply --check`).
- `patches/yards.patch`: Minimal root patch passing actual post contact positions and `mat.steel` (passes `git apply --check`).
- `scripts/verify-fence-art-canary.mjs`: Complete CPU verification suite.
- `docs/PROVENANCE-AND-LICENSE.md`: Poly Haven CC0 texture documentation with truthful transverse crop labeling.
- `RECEIPT.md`: This receipt.
