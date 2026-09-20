# Provenance & Reference Record: Operator Sand Anatomy 0845

- **Work Scope**: `work/operator-anatomy-0845/`
- **Asset Name**: `operator-sand-anatomy-0845` (`.blend` / `.glb`)
- **Stage**: Source-only visual repair 1 (recipe & CPU verification).
- **Harness / Model**: Antigravity (Gemini 3.8 Flash High).
- **License / Originality**: 100% original procedural geometry and procedural PBR texture authoring. No third-party meshes, scans, textures, or downloaded models used.

## References Inspected (Read-Only)

1. **Production Reference Catalog**:
   - `docs/reference/production-catalog/operators/operator-sand-turnaround.png`:
     Authoritative visual target for clothed tactical silhouette: broad clavicle slope, deltoid taper, bicep/tricep mass, olecranon elbow crease, extensor/flexor forearm taper, gluteal seat contouring in rear trousers, quadriceps S-curve, gastrocnemius calf bulge, and lugged combat boot anatomy.
   - `docs/reference/production-catalog/operators/operator-sand-poses.png`:
     Multi-pose verification guide (stand, walk, run, crouch, prone, throw). Used to verify joint clearance and kneeling knee articulation.
2. **Failure Analysis & Capture Diagnosis**:
   - `captures/operator-shape-0843/after/three-quarter.png`:
     Identified flat vertical rear silhouette, lack of gluteal seat, straight cylinder arms and legs.
   - `captures/operator-shape-0843/after/crouch.png`:
     Diagnosed severe kneeling defect: kneepad upper strap floating in midair and detaching from thigh due to rigid `Leg` bone weighting on upper knee vertices (`y > 0.44`).
   - `captures/operator-shape-0843/after/cloth-close.png`:
     Diagnosed jagged dark seams and z-fighting along kneepad strap perimeters where strap radius intersected trouser mesh folds at shallow grazing angles.
3. **Rig & Semantic Contracts**:
   - `src/characters/skeleton.ts`:
     Exact 21 bone names, parent hierarchy, rest offsets, and joint heights.
   - `scripts/assets/verify-operator-sand.mjs`:
     Structural GLB validator (bounds, bones, weights, 12k-22k tris, IBMs).
   - `scripts/assets/verify-operator-sand-texture-content.mjs`:
     Decoded PNG texture validator (dimensions, non-black, range, ORM pack).

## Construction Integrity

- **Clean Parametric Lofting**:
  All shells generated via deterministic math functions (`seed=2256`) evaluated into explicit vertex/face/UV/weight arrays, passed to Blender via a single `from_pydata` call per primitive.
- **No External Image Generation**:
  No OpenAI, Midjourney, or third-party image generation models.
- **No Mocap Extraction**:
  H3 frames consulted strictly as visual motion/posture reference.
