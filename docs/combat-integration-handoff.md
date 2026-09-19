# Combat feedback integration — lane handoff

Lane: `worktrees/nuketown-combat-feedback-20260919`. Sole-owner bounded lane, no
delegation. Nothing committed. No browser/GPU/server run in this lane
(forbidden); all proof below is CPU/headless. **Runtime frame evidence is OPEN
and belongs to root.**

## What was already here vs what this worker did

Prior workers authored the leaf, the taps, and the wiring; this worker changed
exactly one source line (the TS cast), added one adapter-level proof script,
re-ran everything, and packaged the handoff.

## Exact edited paths

Tracked modifications (in `work/combat-integration.patch`, 4 files, +25/−2):

- `src/game/session-types.ts` — `MatchUi` gains optional `onEvent(GameEvent)` /
  `resetPresentation()` (presentation-only tap; prior worker).
- `src/game/session-solo.ts` — `route()` calls `ui.onEvent?.(e)` once per
  admitted event (covers solo AND local-host: the host driver wraps the solo
  driver, its `sink` only broadcasts the wire); `build()` calls
  `resetPresentation?.()` on every new epoch (prior worker).
- `src/net/match-guest.ts` — `record()` calls `opts.ui.onEvent?.(e)` once per
  wire event; `match-state` ended→new calls `resetPresentation?.()` (prior).
- `src/main.ts` — creates `createCombatFeedbackAdapter({ hud, camera,
  match: () => match })`; `matchUi.bindClient` resets on every (re)bind
  including `bindClient(null)` at leave/dispose; `pagehide` disposes (prior).

Untracked new source files (NOT in the patch — copy explicitly):

- `src/ui/combat-feedback.ts` — the DOM-free leaf (GLM).
- `src/ui/combat-feedback.css` — popup styling (GLM).
- `src/ui/combat-feedback-adapter.ts` — browser plumbing (prior worker +
  **this worker's one-line fix**, see below).
- `scripts/game/verify-combat-feedback.mjs` — leaf CPU proof, 13 groups (GLM).
- `scripts/game/verify-combat-feedback-adapter.mjs` — adapter CPU proof,
  7 groups (this worker).
- `docs/combat-feedback.md` — lane doc (GLM; untouched by this worker).

Supporting artifact (untracked, lane scratch): `work/combat-integration.patch`.

## This worker's correction

`src/ui/combat-feedback-adapter.ts` `containerFor`: `tsc` failed with
`TS2322: Type 'HTMLElement' is not assignable to type 'FeedbackElement'` —
`document.createElement` returns `HTMLElement`, whose `appendChild<T extends
Node>(node: T): T` is not assignable to the leaf's narrow
`appendChild(child: FeedbackElement): unknown` (a `FeedbackElement` is not a
`Node`). Fix, after reading both interfaces rather than weakening either:

```ts
createElement: (tag): FeedbackElement =>
  hud.ownerDocument.createElement(tag) as unknown as FeedbackElement,
```

Narrowing-only cast: a real `HTMLElement` satisfies the whole `FeedbackElement`
duck shape (`className`, `textContent`, `style`, `setAttribute`,
`appendChild`, `remove`). No interface changed, no assertion weakened.

## Applied reference contracts

- `docs/REFERENCE-BEHAVIOR-CONTRACTS.md` (root) governs
  characters/grenades/spawns/map-use — **orthogonal**; no row covers floating
  combat text, and none was modified or claimed.
- Applied instead: `src/game/events.ts` derivations (`zone === 'head'` is the
  crit, `healthAfter <= 0` is the lethal — carried, never re-derived);
  IMPORT-PLAN §2 trigger-is-a-claim (wire amounts authoritative, presentation
  never computes damage); the old-project lesson recorded at
  `src/game/feed.ts:148-152` (a spectator's damage numbers are noise —
  nonlocal/self/friendly/world/non-finite events show nothing); AGENTS.md
  budgets (24-node DOM cap, singleton materials untouched, no render-chain
  change).

## Event ordering + reset/leave audit (by reading, all paths)

- Ordering: solo `route()` and guest `record()` both tap `onEvent` BEFORE
  `client.applyEvent`. Safe: the leaf reads only the event plus
  `victimPosition` from `bots()` (director roster / interpolated track, current
  at damage time), never client projection. Fatal-first ordering is why the
  adapter deliberately does NOT filter `alive`.
- Reset: new solo/host epoch (`build()`), guest rejoin (`match-state`
  ended→new), any (re)bind (`bindClient`, incl. `null` at leave/dispose), and
  leaf-internal `match-phase/warmup`. Leave/rejoin funnel through
  `swap → dispose → bindClient(null) → reset`. `pagehide` disposes audio +
  feedback. No path leaves stale popups or a running RAF.

## Tests (all actual, this lane)

- `npm exec -- tsc --noEmit --pretty false` → clean (was 1 error, now 0).
- `node scripts/game/verify-combat-feedback.mjs` → **PASS 13 groups**.
- Adapter proof needs a bundle step (adapter uses the repo's extensionless
  relative imports, which resolve under vite/tsc but not node's type-stripping
  ESM — harness-only quirk, not a source bug):
  `npm exec -- esbuild scripts/game/verify-combat-feedback-adapter.mjs --bundle
  --platform=node --format=esm --outfile=work/cfb-adapter.probe.mjs` then
  `node work/cfb-adapter.probe.mjs` → **PASS 7 groups**: idle gate, victim
  anchor, dead-record fatal, local-only, replay dedupe, reset/re-admit +
  self-stopping loop, dispose-cancels + inert. Probe deleted after the run;
  rerun via the same two commands.
- Network messages and authoritative amounts are byte-unchanged (presentation
  tap only; no `net/` wire shape touched).

## Risks / OPEN

- **OPEN: runtime frame proof.** No playcap/capture/soak in this lane. Root
  must run the visual gate and LOOK at the frames (numbers over bots, head vs
  body styling, fallback marker near crosshair when offscreen).
- Lane source is OLDER than root accepted K (`2139d69` on 4191). Do NOT copy
  lane `main.ts` over root — reapply the hunks (patch + 4 new files + 1-line
  cast, all named above) onto current root and re-run `tsc`.
- `project()` uses `innerWidth/innerHeight` globals; `#hud` must exist before
  the adapter constructs (true in current `main.ts` ordering).
- Pool pressure: spam past 24 actives evicts the oldest popup (contract,
  leaf-tested) — under sustained multi-kill spam the evicted number is the
  oldest, by design.

## Root runtime test procedure

1. Apply `work/combat-integration.patch` + the 5 new files (4 source + this
   handoff lists them; CSS import already in the patch's `main.ts` hunk).
2. `npm run check && npm run build`.
3. `AA_PREVIEW_PORT=4192 npm run playcap` — click through, confirm damage
   numbers appear on local hits only; then `npm run capture` and open every
   fidelity station frame.
4. `npm run soak` before any handoff (touches no render chain, but it is the
   long gate and this adds a per-frame-adjacent subscriber).
5. Promote only on looked-at frames + budgets (<1200 calls, no console/page
   errors). No quota/auth failure occurred in this lane.
