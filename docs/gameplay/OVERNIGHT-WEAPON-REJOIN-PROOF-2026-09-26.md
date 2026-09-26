# Weapon-state rejoin proof — September 26, 2026

VERIFIED source-only handoff: the new independent harness is
`scripts/_verify-overnight-weapon-state-rejoin.mjs`. `node --check` passes.
No browser, GPU, runtime build or source runtime change was performed by this
worker. Actual result remains OPEN until the integrator runs the serial slot.

VERIFIED retained baseline: `scripts/_verify-salvage-net-rejoin.mjs` is unchanged,
SHA256 `20AE742B862A94AB30754878A5EAB69D8C3E1F89704E76A5139EF3BFF03FD032`.
The new harness retains its actual menu admission, open WebRTC channel, authored
MP5/Magnum/Smoke kit and four selected streaks, ordinary sky shots, unearned
streak response, silent-seat reservation, visible Rejoin, life/input/shot/streak
fences, total-ammo checks, no extra spawn, exactly one rendered body per peer,
fresh post-resume actions, deliberate Leave, credential removal and error gates.

VERIFIED stronger authored contract:

1. Reliable equip must be acknowledged in the private weapon state before an
   ordinary non-Rail controller shot. Both actual magazines must lose one round;
   reserves stay unchanged. The first real document disconnect/rejoin preserves
   exact primary **and** sidearm magazine/reserve splits on host and guest.
2. After the retained post-resume action checks, native `KeyR` starts an ordinary
   tactical reload in the genuinely focused guest document with native canvas
   pointer lock. A positive
   authoritative `reloadRemainingMs` and unchanged split must be observed before
   immediate `about:blank` navigation destroys that document.
3. With the guest document absent, the host must complete its original timer and
   transfer exactly the missing magazine rounds from reserve. No gameplay timer,
   input message, health, life, ammunition or completion state is injected.
4. A second ordinary visible Rejoin must recover that exact completed split,
   preserve sidearm ammunition and total rounds, retain life and sequence fences,
   show all four selected streak cards and keep one body per peer. No extra spawn
   is allowed. The final normal Leave still must remove actor, seat and bodies.

VERIFIED read surfaces: guest uses `__NTGAME.snapshot().weaponState`; the host
uses `__NTGAME.snapshot().actors.find(a => a.id === guestId).weaponState`, which
comes directly from GameHost. `HostRoom.loadoutOf(id)` is only the immutable
lobby declaration and does **not** contain live magazine state. That method is
still used for the retained class-admission assertion, never invented as an ammo
readout. No new runtime QA API was added.

VERIFIED safety/evidence: `--expected-commit` is mandatory and must be a full SHA.
Both the preview identity and actual served entry bytes are checked before and
after the run. The receipt records its own harness hash. Existing report or
screenshot paths refuse overwrite; final JSON uses exclusive creation. The
original stock browser helper supplies owned headless Chrome with output muted;
WebAudio is unchanged. Both owned browsers and the owned relay close in `finally`.
The harness does not record a resume credential/token. Keep raw local evidence
under `captures/`; do not version browser profiles or credentials.

OPEN product edge, intentionally not bypassed: `main.ts` currently cancels weapon
actions on genuine blur/pointer-lock loss. If navigation naturally delivers that
explicit cancel before transport closes, the reload may legitimately be aborted
under the present implementation. This harness keeps its required offline
completion assertion and fails with a named message. A read-only observer retains
focus, blur, pointer-lock, R/equip key, before-unload and page-hide timing plus
authoritative reload snapshots; no listener is disabled and no focus property is
forged. Any failure needs product interpretation or a localized authorized fix,
not longer reload timers, fabricated authority, or removal of the assertion.

VERIFIED pre-execution review adjustment: main’s new native-input gate requires
focus and native canvas lock for R. The harness clears Playwright focus emulation
through the existing CDP session, uses ordinary `bringToFront`, and clicks the
real canvas only when it is unlocked. It then requires
`document.pointerLockElement === canvas` and actual focus. Lock acquisition must
not fire a cartridge or change the host split. Harmless Digit1/2 equip presses
also wait for genuine document focus. The original unexecuted harness hash was
`1DA0C250E63D2F5EBC911B15AED5B8534A7C66340F2EBE1379F22D147CA6691C`;
this is a source-review adjustment before attempt 1, not a repaired live result.

Run only when the root owns the serial GPU/browser slot:

```powershell
node scripts/_verify-overnight-weapon-state-rejoin.mjs --url http://127.0.0.1:4361/ --expected-commit <full-built-source-SHA> --tag overnight-weapon-rejoin-attempt1
```

OPEN acceptance budget: initial run plus at most two localized harness repairs.
Preserve each failed receipt and use a fresh tag. A syntax pass is not WebRTC,
native-input, reload-continuity or visual acceptance.
