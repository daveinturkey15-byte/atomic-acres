# Ground-detail refinement

## Purpose

`src/build/ground-detail.ts` adds a bounded presentation layer for the existing
lawn pads. The current lawn material already supplies the broad tiled surface
response; this pass adds the vertical near-field silhouette visible in the
reference target without changing the ground mesh, player floor, or gameplay
colliders.

## Integration hook

Build this module after the existing builder loop, when all static groups are
available for its one-time surface validation. Do not add it to `BUILDERS`, since
the builder list runs before those groups are collected:

```ts
import { buildGroundDetail } from './build/ground-detail';

const detailCtx: BuildContext = {
  mat,
  rand: makeRng('nuketown-2025:ground-detail'),
};
const detail = buildGroundDetail(detailCtx, worldTargets);
detail.group.name = 'ground-detail';
world.scene.add(detail.group);
worldTargets.push(detail.group);
```

The second argument is the already-built static group list. The builder returns
an empty collider list. It only uses `ctx.mat` materials and build-time
`ctx.rand()`. No scene, camera, light, renderer, or frame-loop hook is required.

## Placement contract

The module derives candidate lawn limits from `core/layout.ts`: the two front
lawns, the two back yards, and the narrow side strips beside each house. The
front lawn stop is derived from the same turning-head radius and pavement edge
used by `build/ground.ts`; it does not sample the central pavement ring. Every
candidate is then ray-tested downward against `worldTargets`. Only the first hit
is accepted, and only when that hit is `ctx.mat.lawn` at the lawn top. A patio,
shuffleboard pad, stepping stone, deck, garage/interior floor, prop, or house
therefore rejects the sample even when lawn exists underneath it. All candidates
have a 0.45 m inset from the named boundary ranges.

Two deterministic families are emitted:

| mesh | role | instances | triangles |
| --- | --- | ---: | ---: |
| `ground-detail-edge-grass` | taller edge and fence clumps | 1,640 cap | 13,120 cap |
| `ground-detail-field-grass` | lower open-lawn breakup | 760 cap | 6,080 cap |

The four tapered blades are one shared geometry. Total cost is two draws and
19,200 triangles at the candidate cap; surface rejection normally lowers this.
`InstancedMesh.computeBoundingSphere()` is called after all accepted transforms so
the spread across both yards remains frustum cullable. The meshes are
presentation-only and do not cast shadows; they receive the existing lawn
lighting without multiplying the shadow pass. `group.userData.ntGroundDetailStats`
records candidate, accepted, and rejected counts for the root review.

## Acceptance checks

- `npm run check` is the narrow static gate for this isolated lane.
- Browser captures and GPU budgets belong to the root integration lane. After the
  root adds the post-loop hook, inspect `yardWhite`, `yardOrange`, and `street`
  against the existing reference frames. The target improvement is visible grass
  silhouette along lawn/fence edges while the pavement, doors, lanes, and fences
  remain clear.
- If the root visual pass finds a local prop intersection, adjust only the zone
  inset or count in this module; do not add colliders or alter ground geometry.
