# Receipt: Final Repair 2 of Fence Art Canary (`fence-art-repair2-0930`)

## 1. Ownership & Boundary Constraints
- **Owned Directory**: `C:/Users/david/Desktop/stuff/worktrees/nuketown-prop-20260919/work/fence-art-repair2-0930` exclusively.
- **Root State**: `nuketown-recovery-20260919` strictly READ-ONLY (all changes verified with `git apply --check`).
- **Prior States**: `work/fence-art-repair1-0918` and `work/fence-art-agy-0900` preserved 100% untouched.
- **Runtime Constraints**: CPU source-only execution; zero GPU/browser/Blender/server required.
- **Module Resolution**: Relative imports between `./fence-boards` and `./fence-boards-canary` use extensionless specifiers matching project `tsconfig.json`. Verifier utilizes repository-standard `esbuild` bundling to honor Three.js r180 / TypeScript resolution.

## 2. Art Verdict & Defect Diagnoses Addressed
- **Art Scope Assessment**:
  - Grainphase variety is acknowledged as a modest improvement; plank beveling is subtle.
  - No claims of map-wide overhaul or photorealism are made.
- **Hardware Contact & Seating Defect (Root Cause)**:
  - *Symptom in Repair 1*: Fastener hardware (450 bolts x 18 tris = 8,100 tris) sat at normal offset ~0.03m, completely hidden behind the square timber posts whose actual thickness is 0.16m (surface at $\pm 0.08$m).
  - *Correction in Repair 2*: Fasteners are now physically seated at the actual exposed post facade ($+0.0805$m from centreline, 0.5mm clearance proud of the timber post face to prevent coplanar z-fighting). Orientation aligns outward along `(normX, 0, normZ)` with verified counter-clockwise triangle winding.
  - *Board Position Integrity*: Boards remain centered at their authentic physical thickness (0.06m, surface at $\pm 0.03$m); boards are *not* artificially offset outside the frame to hide contact errors.
- **Geometry & Budget Minimization**:
  - *Fastener Geometry*: Replaced 18-triangle cylindrical/hex bolts with minimized flat hex caps (4 counter-clockwise triangles covering a regular convex hexagon of 7mm radius).
  - *Triangle Counts*:
    - Boards (12 map segments, 60 planks): **1,680 triangles**
    - Fasteners (90 posts x 5 courses = 450 caps): **1,800 triangles**
    - Total Canary Triangles: **3,480 triangles**
    - Added Triangles over Baseline (720): **2,760 triangles** (strictly $\le 3,000$ whole-map added budget).
  - *Draw Calls*: Exactly **2 draw calls** (1 for boards, 1 for fasteners $\le 4$ draws budget).
  - *Materials & Textures*: Uses existing materials (`mat.fenceBoard` and `mat.steel`), zero new texture loads.

## 3. Independent CPU Verification Results (`verify-fence-art-canary.mjs`)

Executed in `work/fence-art-repair2-0930` via `node scripts/verify-fence-art-canary.mjs`:

```
--- Suite 1: Baseline Mode Verification ---
  PASS: Baseline returns single THREE.Mesh
  PASS: Baseline box count = 60 (actual: 60)
  PASS: Baseline triangles = 720 (actual: 720)
  PASS: Baseline Y bounds [0.58, 1.91] exact (actual: [0.5799999833106995, 1.909999966621399])

--- Suite 2: Canary Assembled Map Verification ---
  PASS: Canary returns THREE.Group (batched boards + fasteners)
  PASS: Found fence-course-boards-weathered mesh
  PASS: Found fence-hardware-fasteners mesh
  PASS: Board triangles = 1,680 (actual: 1680)
  PASS: Fastener triangles = 1,800 (actual: 1800)
  PASS: Total canary triangles = 3,480 (actual: 3480)
  PASS: Added triangles over baseline = 2,760 <= 3,000 budget (actual: 2760)
  PASS: Whole map added triangle budget strictly <= 3,000
  PASS: Draw call count = 2 <= 4 budget (actual: 2)
  PASS: Deterministic: repeated builds produce byte-identical buffers

--- Suite 3: Triangle Winding & Outward Normal Alignment ---
  PASS: fence-course-boards-weathered: 0 reversed triangles of 1680
  PASS: fence-course-boards-weathered: 0 misaligned triangles of 1680 (dot >= 0.99)
  PASS: fence-hardware-fasteners: 0 reversed triangles of 1800
  PASS: fence-hardware-fasteners: 0 misaligned triangles of 1800 (dot >= 0.99)

--- Suite 4: Outward Surface & Post Contact Fixture Assertion ---
  PASS: Found post dimension in yards.ts
  PASS: Fixture post thickness = 0.16m (actual: 0.16)
  PASS: Fixture post width = 0.16m (actual: 0.16)
  PASS: Fixture post facade surface is at +/-0.08m from centreline
  PASS: FENCE_POST_SPEC.THICKNESS matches yards.ts post thickness
  PASS: FENCE_POST_SPEC.HALF_THICKNESS matches yards.ts surface
  PASS: Fasteners seated on exposed post facade at X = 0.0805m (>= 0.08m post surface)
  PASS: Fasteners are NOT buried behind post at board depth 0.03m (X = 0.0805m > 0.035m)
  PASS: Boards retain authentic physical thickness ~0.03m (max |X| = 0.0325m <= 0.035m, not pushed to 0.08m)

--- Suite 5: Rotated Segments Audit ---
  PASS: Rotated segments (0°, 30°, 45°, 90°, 135°, 180°, 270°): all triangles dot >= 0.99

--- Suite 6: Independent Root Negative Guard Check ---
  PASS: Independent negative guard (check-fence-winding-0916.mjs) STILL FAILS original bad artifact

======================================================
FENCE ART CANARY (REPAIR 2) PROOF: ALL CHECKS PASS
```

## 4. Deliverables Manifest
- `src/build/fence-boards-canary.ts`: Refined canary fence builder with physically seated fasteners at exposed post facade ($+0.0805$m) and minimized flat hex geometry (4 triangles/cap).
- `src/build/fence-boards.ts`: Normalized integration module matching root.
- `patches/fence-boards-canary.patch`: Clean, minimal patch against current root (verified with `git apply --check`).
- `scripts/verify-fence-art-canary.mjs`: Complete CPU verification harness with fixture assertion of actual post dimensions from `yards.ts`.
- `docs/PROVENANCE-AND-LICENSE.md`: Maintained texture provenance and license documentation.
- `RECEIPT.md`: This receipt.
