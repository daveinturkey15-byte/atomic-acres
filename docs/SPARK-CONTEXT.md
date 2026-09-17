# Shared context for delegated agents

Read this fully before touching anything. Then read your own task brief.

## What this project is

`C:/Users/david/Desktop/stuff/nuketown` — a from-scratch, code-only Three.js
recreation of **Call of Duty: Black Ops 2, map "Nuketown 2025"**. Vite + TypeScript +
Three.js, WebGL2. Every mesh and texture is generated procedurally in code. Nothing is
downloaded and nothing is copied from any other project.

**Version discipline, non-negotiable.** The target is **Black Ops 2 "Nuketown 2025"**
only. Black Ops 1's Nuketown, Cold War's Nuketown '84, Black Ops 6 and Black Ops 7 are
*controls*, never sources. If you are tempted to add a feature you remember from a
Nuketown, check `docs/SPEC.md` section 3 first — it records what was actually observed
in BO2 reference frames, with claim-states.

## Orientation — read these before your brief

1. `AGENTS.md` — the module contract. It binds you.
2. `docs/SPEC.md` — the build spec and the reference reads. Section 3 lists **OPEN**
   items (front ledge, mailboxes, exact turning-head inset, calibrated hex values).
   Those are deliberately NOT built. Do not invent them.
3. `src/core/layout.ts` — every dimension in the project. Nothing else may hardcode one.

## Hard rules

1. **Touch only the files your brief names.** Other agents are working in this repo
   right now on disjoint file sets. Writing outside your set will be reverted.
2. **Never run `git add -A`, `git commit`, `git stash`, `git reset`, or `git checkout`.**
   The orchestrator commits. Leave your work in the working tree.
3. Do not kill processes, do not delete `node_modules`, do not run `npm install`
   (dependencies are already installed).
4. Colours come from `src/core/palette.ts` (`PAL`). Materials come from `ctx.mat`.
   **Never construct a `THREE.Material` inside a builder** — that is what made the
   previous incarnation of this project recompile shaders at runtime.
5. Use `ctx.rand()`, never `Math.random()`, inside builders. The world is deterministic.
6. Every structural dimension comes from `src/core/layout.ts`. No bare positional numbers.

## The one invariant

From either back yard, facing your own house, the garage is on your **RIGHT**. The two
houses are a **180-degree rotational pair, not a mirror pair**. `layout.ts` derives this
in `garageIsOnTheRight()` and `main.ts` asserts it. Do not break it.

## How to verify — and what does not count

```
npx tsc --noEmit -p tsconfig.json     # must be clean for your files
npm run capture                       # headless captures -> captures/*.png
npm run traverse                      # drives the real player controller
```

- `capture` starts its **own** dev server on a port it picks, so it cannot photograph a
  stale preview. It fails the process on any page error.
- **Exit code 0 is not success.** Check the bytes actually written and the files
  actually produced. A run that completes having changed nothing is a failure.
- **A capture nobody opened is not evidence.** Open your frames and look at them.
  A camera station whose `ref` is `null` in `src/core/stations.ts` is a diagnostic view
  and may never be used to claim the map looks right.

Use `--tag <yourname>` on capture so you do not clobber another agent's frames:
`npm run capture -- --tag mylane`

## Environment notes that will otherwise cost you time

- This is **Windows**. The user's own shell is **PowerShell 5.1**, where `&&` is a
  parse error — never hand him a `cmd1 && cmd2` one-liner. Use `;` or separate lines.
- Node and npm are on PATH. The dev server is `npm run dev` on port 5188.
- There is no secret material in this repo. Do not add any.

## Reporting back

State plainly: what you changed, what you measured, what you looked at, and anything
you could not resolve. If you did not finish something, say so — a half-done thing
reported honestly is worth far more than a claim that does not hold up.
