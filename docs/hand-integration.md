# First-person hand geometry integration

This lane carries the Muse hand-geometry canary as a CPU-testable candidate for
the existing `createFirstPersonHands` contract. The candidate keeps the
`FirstPersonHands` root attached to the caller's parent, retains the named
`TriggerHand`, `SupportHand`, and forearm groups, and leaves `updateReload` and
`resetReload` as transform-only operations on the support hand.

The canary supplies four connected geometry meshes per side: a sleeve forearm,
palm glove, thumb detail, and finger detail. The accepted dark webbing cuff is
still a separate mesh with its own material transition on each side. The
candidate therefore materializes ten meshes per rig (eight canary meshes and
two cuffs) and does not hide the cuff inside the glove geometry.

`src/weapons/viewmodel.ts` remains the anchor authority. The verifier parses its
five actual `createFirstPersonHands` calls and compares the support Z/Y and
reload target values to `WEAPON_ANCHORS`; it also compares the accepted source's
trigger sleeve points to `TRIGGER_SPEC`. This keeps the helper from becoming a
second, self-consistent source of weapon literals.

## CPU proof

Run from the lane root:

```text
node scripts/verify-hand-integration.mjs
npx tsc --noEmit --pretty false
git diff --check
```

The integration proof checks all five real anchors, the actual forearm endpoint
positions, finite/unit normals, finite vertex data, non-degenerate indexed
triangles, mesh and triangle budgets, dark cuff/detail material separation, the
existing reload curve at nine phases including cancellation, and disposal of
the created geometries and stub materials. It passed with 1,864 triangles and
10 meshes for each of rifle, pistol, smg, shotgun, and sniper.

This is source and CPU geometry evidence, not visual acceptance. The owning
render lane must inspect all five weapons in hip, ADS, reload, and reset poses
before selecting this candidate. No browser, renderer, GPU, server, or commit
was used for this integration pass.
