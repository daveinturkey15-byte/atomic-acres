# mortar-dom fix (0057) — harness-only repair

Lane: `nuketown-muse-vehicle-20260919`. Source-only; no product UI touched.
Root diagnosis used: `.recovery-runtime/mortar-dom-0055.json` + `.recovery-mortar-dom-0055.mjs` (recovery lane @074f07b, read-only).

## Bug 1 — served-refs regex missed Vite `./assets/…`
- Before: `/(?:src|href)="(\/?assets\/[^"]+\.(?:js|css))"/g` — matches `assets/` + `/assets/` only.
- Vite `base:'./'` emits `./assets/index-*.js|css`, so `refs` was empty → `fail('served HTML names no assets…')` before earn.
- After (`scripts/capture-mortar-live.mjs`): `/(?:src|href)="(?:\.\/)?(\/?assets\/[^"]+\.(?:js|css))"/g` + existing `.replace(/^\//,'')`.
- Normalizes `./assets/x`, `/assets/x`, `assets/x` → `assets/x` for the `dist` join + `new URL(r, BASE_URL)` fetch.
- Gate unchanged: empty refs still fails; every ref still byte-compared served==local; `--expect-js-sha` pin unchanged.
- Regex proved in Node: `./assets/index-DvT1V1uI.js` + `./assets/index-DvT1V1uI.css` + `/assets/index-X.js` → `assets/…` exact, hash inputs untouched.

## Bug 2 — Recruit radio `name:'Recruit'` timeout
- Actual DOM-0055: radiogroup `Bot difficulty` → radio accessible names `'Difficulty Bot difficulty': Recruit`, `Regular checked`, `Veteran`. Wrapped `<label>` misnames the first radio, so `{name:'Recruit'}` times out.
- Visible texts are `Recruit`/`Regular`/`Veteran` (3 radio elements, filter count 1 for Recruit).
- After: `getByRole('radio').filter({hasText:/^Recruit$/}).click()` — the observed-true selector.
- Fixture assert kept: `setup()` readback must be `tdm/recruit/enemies/scoreLimit null`, else `misconfigured session` fail. Product UI not edited (UI owner fixes the accessible name separately).

## Backend proof strengthened (not weakened)
- Before: `typeof navigator.gpu !== 'undefined'` treated as WebGPU proof — API existence only.
- After: logs `gpuApi` + `{renderer: __NT_BACKEND.actual, post: __NTPOST.backend}`; fails if API missing AND fails if `renderer!=='webgpu' || post!=='webgpu'`. Matches `capture-look-ab` / `capture-reflection-canary` admission.

## Verify
- `node --check scripts/capture-mortar-live.mjs` → SYNTAX-OK.
- No browser/server/build run here per 0057 (root runs real proof on `:4200`, pinned `index-DvT1V1uI.js` sha `104ba48d0dbfb71fd3f8cbc89f32762cd109b80157cbfe91f3d1bafd736796e0`).
- Never fakes kills/ledger/host events; earn/press/telegraph/cleanup paths untouched.
