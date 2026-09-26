# Overnight weapon authority — September 26, 2026

VERIFIED source scope: the real `GameHost` now owns each life’s primary and
sidearm magazines, reserves, equipped gun, reload deadline, and Railgun charge.
This closes the former behavior where the host enforced only lifetime total
ammunition and a forged client could fire the reserve without reloading.

VERIFIED canonical contract: `src/game/host-weapon-state.ts` exports
`WeaponIntent`, `WeaponIntentResult`, `WeaponAmmoState`, `WeaponState`, action and
reason lists, and `RAIL_CHARGE_MS = 750`. Intents contain only sequence, life,
weapon ID and equip/reload/charge-start/cancel action. Client timestamps,
ammunition and claimed completion are not authority inputs. Host clock advances
monotonically inside each life. Private state carries exact magazine/reserve,
remaining reload time, host charge elapsed, revision, current-life intent
acknowledgement and 64 exact resolved firearm sequences. A shot high-water mark
does not acknowledge missing lower sequences.

VERIFIED gameplay rules:

- A firearm spends one seated cartridge only after the unchanged shared
  life/sequence/age/muzzle checks and unchanged firearm cadence check pass.
- Empty and tactical reload durations come from the actual weapon catalogue;
  completion transfers only the needed reserve once. Cancel/equip/ordnance do
  not refill the magazine. Scavenged ammunition enters reserve.
- Equip is explicit and admits only the current kit. Next-life loadout hints
  cannot rewrite a live kit. Bounded equip/reload histories retain legal
  pre-intent delayed shots; reload-history flooding fails closed instead of
  forgetting a forbidden interval.
- Railgun discharge requires an admitted host charge-start and at least 750ms
  on both host receipt time and shot time. Each charge ticket spends at most
  once. Early release, equip, ordnance, possession, death and teardown cancel
  actions. Already-fired pre-death trades retain their original bounded
  eligibility. Trusted disconnect/resume clears all charge tickets while
  preserving exact ammunition and a paid reload deadline.
- Crimson suspends and restores the exact original magazine/reserve split;
  it does not resume an old reload. Bots consume the same host state and intents,
  including reload, Railgun charge, issued backup, and earned Crimson use.
- Death drops preserve magazine/reserve split. A drop is visible immediately,
  but cannot transfer until the existing 250ms fire-age plus 25ms clock allowance
  has closed. An admitted late primary trade decrements the matching corpse and
  its corresponding drop once. Matching requires owner, life, death deadline,
  weapon and an unswapped drop. Sidearm trades cannot spend primary drops.
  `drop-settling` is the explicit brief pickup refusal. This is a behavior fix,
  not a change to the pre-existing shot timing thresholds.

VERIFIED host APIs: `submitWeaponIntent`, `weaponStateOf`, and trusted
`cancelWeaponCharge`; host actor snapshots and resume kit readouts contain the
private state. Public player samples contain only the authoritative active
weapon ID. Wire, controller and HUD integration are separately owned by the
other workers and integrator.

VERIFIED CPU acceptance: `node scripts/_verify-overnight-weapon-state-authority.mjs`
passes 15 groups against actual GameHost/BotDirector source. It exercises empty
and tactical reload, conservation, cancel/equip, ordered and reordered claims,
forged completion/weapon/life/sequence, reload-history eviction, held charge,
early release/backdating/repeat, possession/resume/death/end cleanup, exact
acknowledgements, Crimson restoration, real corpse settlement/swap/scavenge,
and real bots through 80 seconds of ammunition exhaustion plus Rail/Crimson.
These are source/CPU proofs; no browser or GPU was run by this worker.

VERIFIED regression: `node scripts/_verify-astra-combat-20260926.mjs` passes its
25 existing combat scenarios after adding actual legal equip, charge and reload
setup. Original damage, life, cadence and lifetime-ammunition assertions were
retained. The old whole-kit possession equality now compares all original kit
fields and both ammo rows, while separately requiring the new refused-shot
acknowledgement. This preserves its ammunition invariant without pretending
that acknowledgement metadata must remain unchanged.

VERIFIED preserved negative control: the original combat verifier is retained at
`captures/weapon-state-precontract/_verify-astra-combat-20260926.original.mjs`,
SHA256 `B542FDD75606C3339B44AE1D8B48EAAEC271BFF469540620B7E5BF9D8CA9923A`.
Its unchanged run fails at the former implicit Duster equip assertion, recorded
in `captures/weapon-state-precontract/old-combat-contract-failure.txt`.
Updated verifier SHA256 is
`CDFA8B758BFC3953ED7DCCF3BA0C880B2EA808FC7DF042B3EC77BD7FA35B5BD3`.
No host gate was weakened to make that fixture pass.

VERIFIED final worker checks: full `npx tsc --noEmit` and the focused host proofs.
The edited host coordinator, ordnance and bot modules remain below the 400-line
repository cap; historical comments were condensed without changing behavior.

OPEN acceptance: actual native pointer hold/release, HUD charge/reload feedback,
WebRTC private state/ownership and resume continuity, and gameplay resource/FPS
checks belong to the integrator’s serialized browser pass on the final built
SHA. CPU success is not a claim that these live checks passed. Older generic
test harnesses that fire sidearms without equip, Railgun without charge, whole
reserve without reload, or swap on the death instant describe the superseded
contract and require explicit legal setup rather than weaker assertions.
