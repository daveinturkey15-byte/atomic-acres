# GLM provider canary — `src/props/industrial-barrel.ts`

2026-09-19. Static read-only review of the barrel loader module against the
worktree AGENTS.md module contract. Nothing was executed: no build, no browser,
no GPU work, no workers.

## Lifecycle observation

The module is a generation-guarded singleton decode with clone fan-out. Clones
share geometry and materials with the decoded master, so `disposeIndustrialBarrel()`
intentionally invalidates every outstanding clone. The generation counter makes
the awkward races sound: a decode that completes after `disposeIndustrialBarrel()`
self-disposes its fresh scene and rejects ("disposed before decode completed")
without clobbering a newer master; a failure from a stale generation does not
clear a newer request's `pending`; double-dispose is a no-op state reset. The
dispose contract is honest — it warns that shared clone buffers die with the call.

## Defect

`industrialBarrelReady` goes permanently stale after a failed preload. The export
is assigned once per `preloadIndustrialBarrel()` call; if that load rejects
(transient fetch failure), the exported promise stays rejected forever, even after
a later direct `loadIndustrialBarrel()` succeeds — a caller gating on
`await industrialBarrelReady` then fails while the asset is actually loadable.
Symmetrically, `disposeIndustrialBarrel()` resets it to a resolved promise with
nothing loaded, so dispose "heals" a rejected preload without any successful load.
Fix is small: reassign `industrialBarrelReady` (to the live load promise, or a
resolved-then-reload-on-await thunk) wherever `master`/`pending` transition, not
only inside `preloadIndustrialBarrel()`.

Everything else matches the contract: one feature, ~125 lines, no scene/camera/
renderer work, no runtime material construction, no `Math.random()`, no inline
placement numbers (`INDUSTRIAL_BARREL_SIZE` is asset metadata, not layout).
