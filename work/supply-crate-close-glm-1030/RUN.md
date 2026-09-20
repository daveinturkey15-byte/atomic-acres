# supply-crate-close-glm-1030 — run commands

Finished continuation of the timed-out `supply-crate-visual-glm-1012` partial.
Source: `tree/src/weapons/supply-crate-visual.ts` (finished: inert-after-dispose
guard, allocation-free update/clear loops). Pin: `tree/src/weapons/crate-visual-pin.ts`.

From the repo root `worktrees/nuketown-glm-respawn-20260919`:

```bash
# 1. CPU lifecycle + negative controls (no GPU/browser/server)
node work/supply-crate-close-glm-1030/tree/scripts/_verify-supply-crate-visual.mjs

# 2. Compile gate (tsc from the shared node_modules)
node ../../nuketown/node_modules/typescript/bin/tsc -p work/supply-crate-close-glm-1030/tsconfig.verify.json

# 3. Integration onto the pending crate lane (read-only until applied):
cd work/supply-crate-agy-0912
git apply --check ../supply-crate-close-glm-1030/patches/supply-crate-close-glm-1030.patch
git apply      ../supply-crate-close-glm-1030/patches/supply-crate-close-glm-1030.patch
```

The patch adds two files under the lane's `tree/src/weapons/` and touches
nothing else in the lane. Runtime wiring (root app, readonly to this lane):
construct once where views are built; feed admitted `GameEvent`s each tick to
`apply()`; call `update(nowMs)` in the render loop; `clear()` on match reset;
`dispose()` on teardown.

Classification: SOURCE-ONLY until a real in-game frame is captured. The
stepper owns all gameplay truth; this module draws only. Guestwire and reward
activation remain unresolved — do not claim the full supply streak playable.
