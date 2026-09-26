# Native weapon state: client checkpoint

VERIFIED: This source pass changes `src/weapons/controller.ts`,
`src/weapons/types.ts`, `src/weapons/weapon-state-client.ts` and `src/ui/hud.ts`.
The integrator owns `main.ts`; the other two Astra workers own the canonical
host state and private network/session projection. This worker ran no browser,
GPU job, main build, deployment or commit. Source cutoff is September 26,
23:55 UTC. The initial implementation plus at most two localized repairs is
the declared bound. Two client repairs tightened refused charge acknowledgments
and required the host-ready level before discharge; the source repair budget is
now exhausted for this issue.

VERIFIED: The controller imports the shared `WeaponIntent` and `WeaponState`
contract from `game/host-weapon-state.ts`. Intents contain a weapon and action;
the session driver assigns life and sequence. The client sends no charge
duration, ammunition count, reload completion, or clock in a weapon intent.

VERIFIED: Native Railgun press starts an intent. The charge display waits for
the successful acknowledgement of that exact press. The visual percentage can
interpolate, but discharge also requires the host's actual acknowledged elapsed
time to reach the required duration. Full charge sends one
ordinary firearm claim only while that gesture remains held; continued hold
does not repeat. Early release, switching, hide/possession, explicit input
cancel, spawn, session unbind and disposal cancel the local gesture. A resumed
host charge cannot recreate a held gesture. An explicitly refused new start
cannot inherit an older host charge. The QA instant-fire command cannot bypass
charge in an authoritative match.

VERIFIED: Ordinary weapon magazine and reserve are projected separately from
the host. Local firing predicts a debit before invoking the shot callback;
exact resolved shot sequences remove the debit whether admitted or refused.
The high-water sequence is never used to infer missing acknowledgements.
Switching predicts the displayed gun but waits for host equip before firing.
Reload animation can start immediately, but local timer expiry never moves
reserve into a magazine. Remaining-total inventory events and reserve grants
cannot refill or double-credit the canonical split. Reload remains manual.

VERIFIED: The existing HUD action node displays charge requested, charge
percentage, reload remaining time, or pending synchronization. Its setters
cache text and visibility. The legacy weapon-name polling cannot erase this
action readout. A CPU DOM double measured zero new nodes and zero repeated
text/class writes over 1,000 unchanged updates; this is not a layout test.

## Integration contract

- VERIFIED: `onWeaponIntent(input): number | null` returns the sequence assigned
  by the driver, or null when the request cannot be submitted.
- VERIFIED: `applyWeaponState(state, nowMs)` consumes private state localized by
  the network clock seam. Call after spawn/pickup inventory presentation.
- VERIFIED: `clearWeaponState()` resets the prediction ledger on session unbind.
- VERIFIED: `cancelWeaponAction()` handles menu, death, possession and focus or
  pointer-lock loss. `setVisible(false)` also invokes it.
- VERIFIED: `HudApi.setWeaponAction(weapons.hud)` renders the action state.
- VERIFIED: The integrator's current `main.ts` calls these APIs and gates input
  on active life, hidden menu, native focus/lock and absence of possession.

## CPU evidence

VERIFIED: `node scripts/_verify-overnight-weapon-state-client.mjs` passed twelve
groups at `2026-09-26T23:09:32.941Z`. It bundles the actual controller, actual
`HostWeaponState`, projection adapter and HUD. Only the unrelated reference-art
network loader is deferred. Its deterministic clock and authored fixtures are
CPU tests, not live gameplay grants.

VERIFIED: The retained machine-local report is
`C:/Users/david/AppData/Local/Temp/aa-weapon-state-client-sS36Q4/report.json`.
It records SHA-256 for every exercised changed module. Controller hash is
`82acff3bbfdca2f41b0128fcb74ca5ceaac06ec701e90fdf08a5671576616099`;
projection adapter hash is
`54296564106e8ab16d3a9ed08309dbbfe5466c0a0c3992a0e3d79cc7a1a33a61`.
Host source was still under its separate owner's validation when this report
was captured; the integrator must retain the final combined source identity.

VERIFIED: The groups cover early release, full hold/new press, missing start
acknowledgement, full visual bar without host-ready level, lifecycle cancellation,
resumed charge, explicitly refused
charge, delayed old-press acknowledgement, canonical reload, equip admission,
exact unordered shot acknowledgements/stale epochs, and HUD caching/polling.
Earlier focused regressions `_verify-astra-input-clock-20260926.mjs` and
`_verify-astra-playflow-20260926.mjs` passed on this pass's initial client
implementation. Those regressions exercise the preserved standalone path;
they do not prove a real authoritative Railgun match.

VERIFIED: Final `npx tsc --noEmit --pretty false` and the scoped
`git diff --check` both completed without errors after the second localized
client repair. Git reported its configured LF-to-CRLF conversion notices;
these were not TypeScript or whitespace failures.

## Open acceptance and limitations

OPEN: Real native input, host damage, five earned kills, authoritative reload,
drone possession, network latency/resume and visible HUD acceptance require
the integrator's frozen `_verify-overnight-native-weapon-state.mjs` and the
appropriate network/browser gates. CPU success does not close those rows.
The exhausted earlier earned-pilot and heavy-motion harnesses remain unchanged.

OPEN: A reliable control-channel send that throws or drops before host receipt
can leave a predicted shot debit pending until a new life or session rebind.
No local timeout guesses that it was refused. Clock-offset changes make a
comparison between an old local shot timestamp and a newly localized host
timestamp unsafe. A future repair needs sent-shot bookkeeping in the host
clock domain and an explicit expiry/cancellation result, or a send-failure
result returned to the prediction owner. Exact acknowledgement behavior and
the 64-entry bound are preserved in this checkpoint.

OPEN: Visual charge affordance and reload animation timing need inspection on
the exact combined browser artifact. This pass reuses the existing HUD node
and procedural hands; it does not promote the opt-in heavy-hand art or replace
the accepted graphics preview.

## Separately admitted receive-order repair, 23:20 UTC

VERIFIED: Independent integration review reproduced a distinct clock-order
defect in `WeaponStateClient.apply`: a newer host revision with an earlier
localized timestamp was discarded, leaving its exact shot acknowledgement
and magazine update unapplied. Changed host-to-guest offset can cause this
ordering without any host revision regression.

VERIFIED: The integrator separately admitted this narrow receive-order repair;
it does not reopen the exhausted Rail gesture repair budget. Revision now
orders state within a life. A lower revision still fails regardless of local
time; an equal revision requires a strictly newer timestamp. The unchanged
1,500 ms freshness window still governs firing. No controller, charge duration,
ammunition arithmetic or animation cadence changed.

VERIFIED: Pre-fix source, verifier and this document were retained byte-for-byte
with hashes in `captures/weapon-state-clock-order-before/identity.json`.
`failing-output.txt` records the expected actual-adapter assertion failure.
The strengthened existing verifier then passed all thirteen groups at
`2026-09-26T23:20:51.111Z`; its complete output is `repaired-output.txt` there,
and its report is `C:/Users/david/AppData/Local/Temp/aa-weapon-state-client-SGU5aP/report.json`.
The new group uses actual `HostWeaponState` shot spend/ack, proves corrected
state settles the pending debit, and preserves lower/equal-revision and stale
freshness negatives. Adapter SHA-256:
`6615f8d614ae10bb4821b9842cc63598368072256e03be30467f340a8157aa20`.
