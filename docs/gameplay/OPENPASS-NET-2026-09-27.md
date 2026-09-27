# Open-items network pass — 27 September 2026

VERIFIED scope: fresh owner admission at baseline `537ddb76477b8be7953c9bcd651458f255ce48da`, NEW restart branch `salvage/full-game-20260926`. This source/CPU pass does not promote a runtime, reset the earlier overnight budget, or change the FAILED strengthened-rejoin receipt. Accepted runtime `2f837ae` remains the root's protected owner preview. No browser, GPU, build, service, deployment or commit was run by this worker.

## Reproduced defects and changes

VERIFIED definite non-send: the actual RTC transport caught a native `RTCDataChannel.send` exception, counted a drop, then returned `undefined`. Room, driver and facade also discarded return values. The controller retained its predicted magazine debit even though the host could never acknowledge that sequence. The new actual-source negative receipt failed the controller, RTC and admitted-room/driver checks before runtime changes.

VERIFIED final repair: `Transport.send` permits `boolean | void`; explicit `false` means neither sent nor queued. RTC returns false for a synchronous native-send exception, closed transport, absent peer, or unavailable fast route. Successful native sends and the existing early reliable queue return true. Legacy void transports remain accepted. Guest room/driver and the session facade propagate definite refusal. Unsent weapon intents return null without waiting for an impossible acknowledgment. The controller cancels only the refused sequence's prediction, restores its one local cartridge/cooldown, and exits before shot effects. After the independent review below, only a definitely unsent, still-last sequence allocation is reclaimed; an accepted/queued/void/ambiguous send is never recycled. The same rule applies to unsent weapon intents. The root owns the small `main.ts` callback-return integration.

VERIFIED clock/epoch defect: a spawn at host time 1000 established the weapon epoch at local time 1000. A subsequent +200ms offset adjustment localized a valid host weapon state at1050 to850. `GameClient` incorrectly rejected that newer state against the old localized epoch. The retained negative receipt exercises the actual class, not a rewritten gate.

VERIFIED repair: receive-boundary-only `weaponSourceAt` metadata and the optional source-time argument on `GameClient.applyEvent` retain the unadjusted host timestamp for weapon epoch and same-revision ordering. `match-guest.ts` supplies it for resume state, ongoing weapon state, self spawn and death. No wire schema changed. Weapon `at` remains localized for display/freshness; source time cannot refresh an old level. Life, revision, exact acknowledgment, shot-age, cadence, origin and sequence-gap gates remain in force. Local/solo callers retain their existing default clock semantics.

VERIFIED localized repair1: independent review identified two remaining gaps in the initial source. A real previously accepted shot followed by512 definite non-sends caused recovery to exceed the unchanged host sequence-gap bound. Also, `GameClient` admitted raw ordering but the final `WeaponStateClient` still discarded a newer same-revision charge/reload progress level after its localized clock moved backwards. Pre-repair source and hashes are retained under `repair1-before/`; `repair1-negative-actual-gap.json` retains both deterministic failures. The final projection now carries local-only `sourceAt` metadata into `WeaponStateClient`. Equal revision compares raw source order; lower life/revision, duplicate/raw-stale levels and the unchanged1500ms localized freshness window still fail closed. No host or wire protocol schema changed.

VERIFIED final repair1 proof: `repair1-final-bound.json` passes6/6 groups and binds13 source files, including root's actual `main.ts` return seam, the LMG module, and unchanged `host-shot.ts`/`host-weapon-state.ts` authority gates. It exercises an actually admitted M4A1 guest, a previously accepted sky shot,512 real send refusals, recovery that spends exactly one host round,512 refused equip intents followed by legal equip, and both same-revision host charge/reload progress through the final projection. The prior helper's sequence-consumption assertion was explicitly replaced by this stronger known-unsent-only reallocation contract; its original bytes remain preserved. Two fixture failures are retained: one attempted too-large controller dt (the controller legitimately caps it), and one requested M4A1 equip from the fixture's default Longhorn kit. The final fixture uses actual50ms frames and explicitly declares the intended M4A1/Magnum/Flash kit through GuestClient admission. No host ownership assertion or limit was loosened.

## Preserved evidence and checks

VERIFIED original bytes: `captures/openpass-net-20260927/before/` contains the original nine runtime sources and rejoin helper, with SHA256 values in `source-sha256.json`. `negative-initial.json` is immutable FAILED evidence (1/5 groups passed). `positive-attempt1.json` passed5/5 with the same initial proof. `positive-final.json` adds stronger assertions and passes5/5: actual controller→guest driver→room→GameHost sky fire spends exactly one round after a refused send, exact ACK gaps and another in-flight sequence survive cancellation, duplicate cancellation is harmless, no timeout refunds occur, and a real admitted guest NTP pong correction preserves its new life. The proof writes receipts exclusively and never overwrites them.

VERIFIED focused commands, run from the candidate root:

```powershell
node scripts/_verify-openpass-net-20260927.mjs captures/openpass-net-20260927/negative-initial.json
node scripts/_verify-openpass-net-20260927.mjs captures/openpass-net-20260927/positive-attempt1.json
node scripts/_verify-openpass-net-20260927.mjs captures/openpass-net-20260927/positive-final.json
node scripts/_verify-openpass-net-20260927.mjs captures/openpass-net-20260927/repair1-negative-actual-gap.json
node scripts/_verify-openpass-net-20260927.mjs captures/openpass-net-20260927/repair1-final-bound.json
node scripts/_verify-openpass-rig-integration.mjs captures/openpass-net-20260927/rig-integration-final-bound.json
node scripts/_verify-overnight-weapon-state-client.mjs
node scripts/_verify-overnight-weapon-state-wire.mjs
node scripts/_verify-event-clock.mjs
node --check scripts/_verify-overnight-weapon-state-rejoin.mjs
git diff --check
```

VERIFIED the unchanged controller proof passed15 groups, unchanged wire proof passed17 groups, and unchanged event-clock proof passed both positive and negative offsets. All are CPU evidence; they do not establish hardware network or visual acceptance. Re-running the new proof requires a fresh receipt filename.

VERIFIED diagnostic getter correction: only `window.__NTUI.menu.state().surface` became the actual `window.__AA_UI.menu.state().surface` in `_verify-overnight-weapon-state-rejoin.mjs`. All prior native focus/lock, document replacement, exact magazine/reserve, reload, life, spawn, body, sequence, leave and page-error assertions remain. An exact normalized-source comparison passed after preserving the original indentation. Original helper SHA256 was `5bdcadf635b3f4d05c6fec6257de4125614fcd94a17e6fb40f1c5759d21b313c`; final corrected helper is `85bb7f1551cb98b24406960c8cb63a499f5e3c131e90a0269c3af573209a59b3`. This fresh source correction is not a reclassification of any older failed run.

VERIFIED final network CPU proof SHA256: `c430c863f8369872b3976b3687d8541dfdc678fc346a876271963e9ab9d8b465`. The final bound receipt records13 source hashes. Controller SHA256, including root's LMG and ordnance-disposal changes: `f752f07cfbaf7aea7b8d1e1751edff5fe75416cfc8e680060225a4737c0136bc`. GameClient: `82d8ffe7147474f41195778317cbfbc38c8a9dd348cca6827f0cb416b78373b4`. Root main: `700eeae67a8887c8da741d7f05f3cee15720a14269c99c7b934d3c49710363df`.

VERIFIED final typecheck: `node node_modules/typescript/bin/tsc --noEmit` passed after repair1 at12:03 UTC. The unchanged client15, wire17 and positive/negative event-clock checks passed again. Root still owns combined validation after later integration.

VERIFIED independent LMG controller review: `rig-integration-final-bound.json` passes4 CPU groups: default/explicit-disable exact geometry, ordinary/motion query opt-in actual ADS center and margin rays, authored reload, shared fallback visibility, unchanged ammo, async legacy-hero precedence and all-overlay exactly-once geometry disposal. Initial proof fixture errors (hand-root selector and collapsed single-material batching) remain retained. The unchanged full-overlay assertion then found a real preexisting12-geometry knife/grenade disposal omission, independently reproduced with the canary disabled in `rig-baseline-disposal-negative.json`. Root fixed disposal; the unchanged assertion now passes. Imported reference-model networking is excluded from this CPU proof, and hero async loading uses its existing deferred port seam. This is not a GLB/pixel or owner-art acceptance. Integration proof SHA256: `a2ca060cdeab0b37333d23c80b8eb655599e9e06400b6d89040fe9c70f3c721f`.

OPEN limits: accepted or early-queued messages can later be lost, evicted by the existing bounded queue or abandoned on connection replacement; this patch never guesses a refund or recycles a sequence for them. There is no retry/resend protocol in this scoped repair. Physical LAN/WAN, the strengthened real document-rejoin acceptance, hardware send-error timing and browser gameplay acceptance remain root-gated. The next real rejoin run must pin the exact built source SHA and use a new open-pass tag while retaining the earlier failures.
