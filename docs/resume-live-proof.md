# Live LAN resume proof

This harness is intentionally a real browser acceptance gate, not a loopback
simulation. It uses two isolated stock Chrome profiles and the existing LAN
signalling relay. It does not start either service.

Run it only with a candidate and relay already running:

```text
node scripts/_verify-resume-live.mjs --url http://127.0.0.1:4192/ --signal-port 4310
```

The run is bounded at 90 seconds and writes:

- `captures/resume-live/result.json`
- `captures/resume-live/postresume.png`

## Verified progression

The captured acceptance history is preserved as a progression rather than a
single green run:

- **VERIFIED — G negative control:** `captures/checkpoint-g-resume-negative.txt`
  rejoined the reserved seat but left the guest driver idle; the live-match,
  life, movement, shot-admission, and damage gates failed. This preserved the
  original failure instead of treating transport reconnection as resume.
- **VERIFIED — H loadout catch:** `captures/checkpoint-h-resume.txt` restored
  the seat and movement, but the refreshed guest presented `Longhorn` after
  selecting `Deadeye` before reload. The shot still admitted and dealt 34
  damage (`100 -> 66`), exposing the UI/loadout rehydration gap.
- **VERIFIED — H2:** `captures/checkpoint-h2-resume.txt` restored `Deadeye`
  across the guest weapon surface, HUD, and host actor and passed the live
  resume movement, life, shot, and damage gates.
- **VERIFIED — H3:** `captures/checkpoint-h3-resume.txt` passed all 16 stock
  Chrome gates. Post-resume lethal/tactical inventory was `1/1` on both guest
  and host with `parity: true`; the resumed guest moved `6.016271339984616 m`;
  its admitted shot reduced the host from `100` to `0`; both pages reported no
  console or page errors.

H3 is the current live result. The H3 browser run was executed by the root lane;
the CPU proofs in this worktree remain separate evidence.

The guest starts a real LAN match, records its host seat id, host snapshot
life, guest driver counters, and the lobby LAN diagnostic. The guest page then
reloads in its own existing profile. The harness waits for the old RTC peer to
disappear (`__NTGAME.lobby.netLine()` must report `lan peers 0`) and for the
host to mark the same seat disconnected. It holds that reservation for at
least six seconds before clicking the real `Rejoin room` button.

Before reload, the guest submits and the host accepts one real firearm claim,
so the resumed proof exercises a nonzero guest shot sequence as well as the
life epoch. The harness also records the pre-refresh `Deadeye` primary from
the guest's `weaponCmd('state')`, HUD weapon label, and authoritative host
actor `primaryId`.

The harness also captures the real guest `__NT.ordnance().self` projection and
the host actor's authoritative `lethal`/`tactical` counts before reload. After
rejoin, the guest counts must equal both pre-refresh guest counts and the host
counts, with at least one retained charge positive. This is a bounded inventory
parity gate; it does not throw a new grenade just to create evidence.

Acceptance requires the fresh RTC peer to report `lan peers 1`, exactly one
host roster entry for the original player id, both gameplay drivers to return
to an active match, and the life epoch to remain authoritative: the host
snapshot actor life must stay unchanged and the rejoined guest counters must
report the same `lives` value with an active epoch. Before any post-resume
fire test, all three loadout surfaces must still agree on `Deadeye`; a switch
to another primary fails the proof.

The post-resume guest must then move far enough for the host's authoritative
seat pose to advance more than five metres. The existing clear-position and
weapon command pattern is used to place the host beside the rejoined guest,
fire the guest's real
catalog weapon at the host, require an admitted guest shot in the host's
authoritative stats, and require the host actor's HP to decrease. This directly
exercises the resumed guest's shot sequence and life epoch. Any console error,
page error, missing capture, duplicate seat, stale peer, missing active driver,
failed movement, rejected shot, or missing damage fails the run.

The LAN peer count is read from `__NTGAME.lobby.netLine()`. The gameplay
driver's `netLine()` is recorded for diagnostics only because it does not carry
the LAN peer suffix.

The resume `rounds` field is the host's documented normal-shot estimate. The
proof records the host total-rounds value and exercises the real weapon
controller, but it does not claim an exact magazine/reserve split or arbitrary
reload redistribution. Those magazine details remain a separate authority
decision; a passing resume result must not be read as proof of exact reload
reconstruction.

## Historical baseline

The G negative control is the recorded pre-repair baseline. The host resumed the
reserved seat, but a fresh guest that received only `welcome` remained idle and
could not move or submit a valid firearm claim. That failure is retained in the
capture as an exit-1 report.

The repaired authority/resume path is now live-verified at H3. A connected RTC
peer or welcome alone remains insufficient; the result requires the complete
gate set above.
