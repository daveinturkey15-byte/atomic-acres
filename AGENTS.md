# Nuketown 2025 — agent contract

A from-scratch, code-only recreation of **Black Ops 2 `Nuketown 2025`** in Three.js.
Started 2026-09-17. This repository is deliberately small and stays that way.

Workspace rules in `C:/Users/david/Desktop/stuff/AGENTS.md` and active AKP apply.

## What this project is not

It is a clean restart of a much larger effort. The old project is **reference only**:
you may read it to recover a measurement or a lesson, and you may not copy an asset,
a texture, a mesh, a module or a build script out of it.

The failure modes that ended the previous attempt are the things to design against:

| Old failure | Rule here |
|---|---|
| A 5,239-line arena file | One feature per file in `src/build/`, under ~400 lines |
| ~100 npm scripts | Five: `dev`, `build`, `preview`, `capture`, `check` |
| Renders never compared to references | Every fidelity station names its reference frame |
| Gates green while the game was broken | The gate is a **looked-at frame**, not a count |
| Materials built at runtime, programs recompiling | Materials are singletons in `core/materials.ts` |
| Dimensions duplicated across modules | Every dimension lives in `core/layout.ts` |

## Layout

```
src/core/     layout.ts palette.ts materials.ts kit.ts world.ts player.ts stations.ts
src/build/    one file per feature; each exports a single Builder
src/main.ts   the only file that touches the scene
scripts/      capture.mjs — headless Playwright capture harness
docs/SPEC.md  the build spec and the reference reads
captures/     harness output (gitignored)
```

## The module contract

```ts
import type { Builder } from '../core/kit';
export const buildThing: Builder = (ctx) => ({ group, colliders });
```

1. Every structural dimension comes from `core/layout.ts`. No bare positional numbers.
2. Every colour comes from `core/palette.ts`. No inline hex.
3. Every material comes from `ctx.mat`. **Never construct a material in a builder.**
4. Builders never touch the scene, camera, renderer, lights or another builder's file.
5. Use `ctx.rand()`, never `Math.random()` — the world is deterministic.
6. `InstancedMesh` for anything repeated more than ~20 times.
7. Return honest colliders. Leave doorways and fence holes open.

## The one invariant

**From either back yard, facing your own house, the garage is on your RIGHT.**
The two houses are a **180° rotational pair, not a mirror pair**. `layout.ts` derives
this in `garageIsOnTheRight()`. Do not hardcode a sign anywhere else.

## Verifying a change

```bash
npm run check      # tsc, must be clean
npm run capture    # headless captures of every station + console errors
```

`capture` starts its **own** dev server on a port it picks, so it can never photograph
a stale preview. It fails the process on any page error.

**Then look at the frames.** A capture that nobody opened is not evidence. A station
whose `ref` is `null` is a diagnostic view and must never be used to claim the map looks
right. Compare each fidelity station against the reference named in `core/stations.ts`.

## Budgets

- under 1200 draw calls and 900k triangles at any fidelity station
- no page errors, no console errors

Measured 2026-09-17 at 1600x900, headless Chromium on ANGLE/D3D11, frame-rate cap off:
worst station **363 calls / 135k tris**; **573-586 fps** standing at either spawn with
the player loop running; **18 shader programs** total. The program count is the one to
watch - it stays small only because every material is a singleton built once in
`core/materials.ts`. A builder that constructs its own material adds programs, and a
builder that constructs one per frame is what made the previous project stutter.

## References

`docs/SPEC.md` section 3 records what was actually seen in each BO2-2025 frame, with
OPEN items marked. Reference images are **not** committed. Source URLs are in the old
project's `docs/references/nuketown-2025/manifest.json`; the CDN is behind a bot check,
so fetch them with a real browser, not curl.
