# Root-run temporal observer

VERIFIED: `scripts/verify-astra-hands-temporal.mjs` is executable observer code,
authored by Codex / requested gpt-6-astra xhigh. No game source changed. Syntax
checking and `--self-check` pass. No browser, GPU, server, or actual capture was run
in the author lane; runtime remains OPEN until root executes it.

Set `RECOVERY_URL` to the exact already verified candidate URL, including the desired
lighting/glazing/facade flags. Run:

```powershell
$env:ASTRA_HANDS_MODE = 'both'
node scripts/verify-astra-hands-temporal.mjs
```

`motion` and `rigged` are also valid single modes. Both mode URLs preserve every
other query parameter; motion is always canary and only rigged adds hands=rigged.
The modes run sequentially with one owned stock Chrome at a time. No default server
is assumed. `EXPECTED_BUNDLE_SHA256` optionally requires the exact loaded entry
bundle bytes to match the root's known artifact hash.

The real Play solo -> Deploy path starts the game. The observer selects/refills
Duster through the existing QA commands, fires one admitted shot, starts the real
reload, observes completion, holds W+Shift for about 1.2 seconds, and enters/exits
ADS with right mouse. It never invokes synthetic camera/pose/render/teleport hooks
or changes reload time/progress. DOM HUD/crosshair alone are hidden for legibility.

The sequence targets six screenshots during the 1.4-second reload, then reload
settle, sprint held, ADS settled, and ADS exit: at most ten screenshots. Each image
is bracketed by actual browser timestamps, weapon/hand state, player pose and live
renderer statistics. A bounded 20Hz observer records the complete sequence for up
to 20 seconds and 450 samples. Startup/menu loading is outside that capture budget.
If screenshot latency misses reload phases, coverage is explicitly OPEN; the
observer never rewinds or fabricates missing frames.

Sprint proof derives distance and speed from real playerPose samples while normal
input is held. More than 0.25m travel and an observed speed above the actual 6.5m/s
sprint threshold are required. A blocked spawn route is OPEN, not an art failure.
This supersedes the older recipe's treatment of absent movement as a hard failure.

Every run receives a unique directory under captures/astra-hands-temporal-*, with
motion/rigged subdirectories, JPEGs, result.json and an HTML contact sheet preserving
capture order and time brackets. summary.json compares the loaded entry bundle
hashes across both modes. Local checkout SHA and dirty paths are recorded separately
from the hashes of bytes actually returned to the browser; their association is
CLAIMED until root binds the served artifact. No previous output is overwritten.

Hard gates remain 1,200 calls / 900,000 triangles, nonzero real scene counters, zero
console/page/observer errors, admitted action starts, completed reload, ADS flags,
capture bounds, and matching loaded builds for the paired run. Exit zero / pass=true
means these hard checks passed; status OPEN still identifies incomplete sprint or
image coverage. Visual acceptance is always OPEN until root inspects the evidence.

Browser-free controls executed by the author:

```powershell
node --check scripts/verify-astra-hands-temporal.mjs
node scripts/verify-astra-hands-temporal.mjs --self-check
```

The controls reject missing/zero counters, 1,201 calls, 900,001 triangles, blocked
movement and walk-only speed as sprint proof; they accept a measured 6.6m/s sprint
and verify that both query modes retain the same lighting/glazing flags.
