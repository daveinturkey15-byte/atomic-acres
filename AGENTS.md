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
npm run check      # tsc + the render-site allow-list, must be clean
npm run build      # every harness serves dist/, never the source
npm run playcap    # four positions photographed through the REAL game loop
npm run capture    # every camera station, its draw calls, and console errors
npm run soak       # THE LONG GATE (3.5 min) - heap and process memory under play
```

`npm run verify` chains check / playcap / capture / traverse. **`soak` is deliberately
not in it, and not in `check`** — it plays the game for three and a half minutes, so it
belongs before a hand-off or after anything that touches the render chain, not in the
inner loop.

Every harness uses the ONE shared `vite preview` on **:4188** (`scripts/lib/preview.mjs`)
and spawns real Chrome over CDP through `scripts/lib/proc-guard.mjs`. Playwright's
bundled Chromium has no WebGPU adapter, so a harness that calls `chromium.launch()` is
measuring the WebGL2 fallback with the whole post chain switched off.

What each one is for, and what it cannot tell you:

- **`playcap`** is the gate for anything touching `core/world.ts`, `core/post.ts` or the
  render block of `main.ts`. It clicks to play and photographs the game's own frame loop,
  failing on a dark frame. Its threshold is frozen; lowering it to get green is the
  mistake it exists to prevent.
- **`capture`** drives `__NT.goto()`, which is the QA render path, **not** the path the
  player takes — that difference is how a black screen shipped behind ten green captures.
  Its draw-call numbers are read as a delta inside the same synchronous evaluate as the
  render, because the frame loop resets `renderer.info` every tick and a read taken after
  the screenshot reported 0 for the whole earlier life of this harness. A station that
  reports no draw calls now prints **MEASURED NOTHING** and fails the process. The frames
  carry no viewmodel and no bots, so they sit a little under `playcap` at the same spot.
- **`soak`** answers "does it leak while it is being played". It fails on a post-GC JS
  floor climbing ≥ 0.5 MB/min (least squares over every sample after t+60; two-point
  slopes carry ~0.75 MB/min of floor oscillation) and on the renderer process's own
  working set growing monotonically by more than 20 MB. Both series, because
  `Runtime.getHeapUsage` is **blind** to typed-array and external memory — a 4.4 MB/min
  Uint8Array leak read flat through it. Prove it can still fail before trusting a green
  run: `node scripts/soak.mjs --inject-kb-per-s 200`.
- **`node scripts/_verify-streak-reject.mjs`** is the headless, browser-free falsifier for
  the killstreak backoff: it forces one unplaceable sentry claim and fails if the presser
  is answered with silence or re-presses inside the 4 s hold.

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
