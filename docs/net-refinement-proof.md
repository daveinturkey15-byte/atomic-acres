# Network refinement proof

This is the standalone Nuketown recovery lane's two browser proof. It exercises
the built candidate already listening on `http://127.0.0.1:4192/` and the
signalling relay already listening on `http://127.0.0.1:4310`. The harness does
not start either service. It opens two fresh installed stock Chrome instances
through `scripts/lib/stock-browser.mjs`; that helper creates an isolated profile,
uses no unsafe WebGPU/Vulkan flags, and kills/removes only those two owned
profiles in `finally`.

Run it from this worktree after the candidate and relay are ready:

```text
node scripts/_verify-net-refinement.mjs
```

The browser-free admission falsifier covers the same loadout boundary without
starting a candidate or relay:

```text
node scripts/_verify-loadout-admission.mjs
```

It checks the real loopback `hello`/`ready` path, rejects an unknown primary,
and confirms a remote actor is seeded with `deadeye` before its first host
snapshot and remains `deadeye` after a later forged input declaration.

The candidate and relay can be changed explicitly:

```text
node scripts/_verify-net-refinement.mjs --url http://127.0.0.1:4192/ --signal-port 4310
```

The `--seconds` value is clamped to 120 seconds so a shorter invocation cannot
turn the no-disconnect gate into a weaker claim. The script prints one compact
line per check and persists the full JSON report at
`captures/net-refinement/result.json` in `finally`, including cleanup and
exception details. The initial failed loadout run is retained separately at
`captures/net-refinement/initial-loadout-failure.json`.

## Contract

The first half is the existing LAN proof through the real Multiplayer UI and
the real WebRTC data channel:

| Check | Acceptance |
| --- | --- |
| host/join/start | Two fresh stock Chrome profiles show two seats, both ready, then A is host and B is guest. |
| movement | B sends real `W` keyboard input for three seconds and moves more than 5 m. |
| tracking | The host's `HostRoom.poseOf()` median mid-walk gap is at most 200 ms when converted using the authored 4.8 m/s walk speed. |
| stop | The host settles within 0.5 m of B within 400 ms of key release. |
| damage/kill | A uses the real `__NT.weaponCmd('fire')` trigger path; B's host-authored health and feed change, and both sides receive the kill. |
| continuity | Eleven ten-second samples cover at least 120 seconds from Start with both modes and both rosters connected. |

The refinement checks the real stance and loadout boundaries:

- B holds Control through Playwright's page keyboard. B's local `__NT.stats()`
  reports `crouch`; A's authoritative `__NTGAME.bots()` remote body reports
  `crouch`. B then presses Z through the same keyboard and the equivalent host
  and local observations report `prone`.
- The host's read-only `__NT.remoteBodies()` surface matches the remote actor by
  its authoritative id and requires its `crouch`/`prone` flags plus
  `crouch-*`/`prone-*` locomotion. This avoids guessing from the static
  character count or nearest rendered body. If the surface is unavailable, the
  rendering claims are `OPEN`; the authoritative stance checks still remain
  required. A public surface that is present but disagrees is a failure.
- B starts with a fresh profile whose selected kit is `marksman`. After spawn,
  the proof requires the host actor's `primaryId`, guest ordnance projection's
  `self.primaryId`, `__NT.weaponCmd('state').id`, and the HUD weapon name to
  agree on `deadeye` / `Deadeye`. This prevents a menu selection from being
  mistaken for the weapon actually issued by the host. When this gate fails,
  the report records the stored selection plus the live guest state, guest
  ordnance primary, HUD name, and host actor primary.
- The guest declares its sanitized primary in both the admission `hello` and
  pre-Start `ready` messages. `HostRoom.primaryOf()` carries that declaration
  through the host roster sync, and `session-solo.ts` passes it to
  `GameHost.addActor()` before the first snapshot can lazily create an
  ordnance kit. Once the room leaves the lobby, input messages cannot rewrite
  the declaration, so a later input cannot swap the current life's weapon.

## Epoch-skew probe

Before B navigates to the candidate, the proof installs a coherent local-clock
wrapper: `performance.now()` and requestAnimationFrame callback timestamps add
exactly `+240000` ms, while `performance.timeOrigin` shifts by `-240000` ms.
A marker read after startup proves all three wrappers were installed and that a
real animation frame callback received a shifted timestamp close to the shifted
`performance.now()` reading. The proof then holds B's real `KeyQ` input for
500 ms (the marksman smoke path) and waits for the host-authored
`smoke-volume` projection. It requires the localized `bornAt` to be at or
before B's shifted clock, `diesAt` to be in the future, and the lifetime fields
to be present and remain about 25 seconds. It then waits until the shifted
runtime clock passes `diesAt` and requires the smoke entry to be gone.

If the ordnance projection is genuinely unavailable, the epoch-skew claim is
`OPEN`. A failed clock installation, missing smoke admission while the guest is
alive, wrong endpoint, or runtime entry that remains after its endpoint is a
`FAIL`; the harness does not convert a failed observable API into a green or
open result.

## Evidence labels

`VERIFIED` means this run observed the condition in the built candidate through
the named public runtime/UI surface. `FAIL` means the required condition was
refuted or the run could not complete. `OPEN` means the requested optional
surface was not exposed or its conditional probe could not be performed; it is
not a pass claim. The existing thresholds are kept in the script and are not
changed to accommodate a failing candidate.

Static authoring evidence for this refinement is `node --check
scripts/_verify-net-refinement.mjs`. The root integrator owns the live browser,
GPU, candidate-server, relay, and final handoff run.
