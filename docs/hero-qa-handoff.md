# Hero QA handoff — roster heroes capture (source-only)

Lane: `nuketown-prop-20260919`. Source-only. No browser, GPU, Blender, or server ran here.
Root runs the capture after build. No runtime acceptance is claimed from this lane.

## Deliverable

- `scripts/capture-roster-heroes.mjs` (new, ~330 lines) — the ONLY new file with code.
  Adapted from ROOT read-only `scripts/capture-carbine-canary.mjs` (byte-identical
  in this lane, verified by diff) for route/budget/backend conventions, and ROOT
  `.recovery-roster-acceptance-2216.mjs` for the 16-id sweep, served-bundle sha,
  and base/final `__NT.stats()` conventions.
- This doc. No product-code changes; the frozen loader
  (`work/roster-heroes-runtime/roster-heroes-loader.ts`) and 141-line integration
  patch are untouched. Imports stay on `./lib/stock-browser.mjs`, so root runs the
  file as-is with no retarget.

## Run (root only, after build)

```bash
npm run build
node scripts/capture-roster-heroes.mjs [--url=http://127.0.0.1:4195/?heroes=canary] [--tag=roster-heroes]
```

`--url` accepts a bare positional URL too. Default is the explicit `:4195`
candidate with `?heroes=canary`. Shared `:4188` and owner `:4173` are refused.
Overall bound 180 s; the owned stock-Chrome profile closes in `finally{}`.

## What it proves (pass = all)

1. Real WebGPU path: `__NT_BACKEND.actual` + canvas `data-nt-backend` are `webgpu`
   and `__NTPOST` is `{backend:'webgpu', enabled:true}` — fallback pixels fail.
2. Served-bundle provenance: `dist/assets/index-*.js` sha256 equals the live
   `/assets/<same>` bytes over the candidate origin.
3. Real menu `Play solo → Deploy` into `__NTGAME.snapshot().match.phase==='active'`.
4. Hero adoption: `state.heroes.requested===true`, and `adopted` holds `mp5`,
   `m14-ebr`, `lmg` — each URL containing its `*.glb` with all four real sockets
   (`anchor_muzzle/grip/support/mag`). Fallback rigs are never adopted, so a
   procedural stand-in cannot pass. Carbine canary is recorded, asserted only
   when the URL requested it.
5. Full 16-id roster sweep (catalog order) via the real `switch` command, then
   re-asserts all three heroes are still adopted.
6. Nine frames in `captures/<tag>/` — `<id>-hip/-ads/-reload.png` per hero, shot
   off the live game rAF (no `goto`/`teleport` near photos). Each ADS photo
   asserts `ads===true`; each reload photo asserts one live `fire` expended
   (`mag-1`, `shotsFired+1`) and `reloading/reloadProgress` live at the shutter.
   Every frame entry records its path plus the weapon state at the photo.

## weaponCmd API truth (do not "extend")

Root `src/weapons/controller.ts` `command()` implements: `fire`, `reload`,
`ads`, `switch`, `state`, `hud`, `visible`, `impacts`, `recoil`, `accuracy`,
`inspect`, `refill` (+ ordnance delegation). There is NO `select` and NO `reset`
command — the brief's `select/reset` have no such implementation, so the script
selects with `switch` (whose `switchTo` also performs the reload-pose reset).
`refill` fires only when a hero reads `mag<=0`, and is recorded on the frame.

## Verification from this lane

- `node --check scripts/capture-roster-heroes.mjs` — syntax clean, no execution
  (browser/GPU forbidden here by the tasking).
- No `npm run check` impact: the file is a standalone `.mjs` outside `tsc`.
