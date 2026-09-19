# Checkpoint C CPU review

Date: 2026-09-19 13:10 BST
Worktree: `C:\Users\david\Desktop\stuff\worktrees\nuketown-recovery-20260919`
Branch: `recovery/wave7-20260919`
Source HEAD: `232e13bc48b5e9ba5607a566540ac55054131312`

This is a bounded read-only CPU/static review. It did not start Vite, a browser,
GPU rendering, a server, or the app build. Existing scripts and thresholds were not
edited.

## Commands and results

The initial script inventory was gathered with:

```powershell
Get-ChildItem scripts -File -Recurse | Sort-Object FullName | Select-Object FullName
Get-ChildItem scripts/animation -File | Sort-Object Name | Select-Object FullName
Get-ChildItem scripts/audio -File | Sort-Object Name | Select-Object FullName
```

**VERIFIED — ordnance, exit 0**

```text
node scripts/_verify-ordnance.mjs
```

The real game modules held all `53/53 checks`. Frag, flash, smoke, knife, drops,
bot, and hand scenarios all reported `PASS`, including blast radius/LOS, smoke
occlusion, melee replay/cooldown rejection, pickup range, expiry, and hand timing.

**VERIFIED — streak rejection falsifier, exit 0**

```text
node scripts/_verify-streak-reject.mjs
```

The forced out-of-bounds sentry placement reached the real
`arena-unsupported/no-placement` refusal path. The script reported:

```text
re-presses inside the 4000 ms hold   0
denied events inside it               1
HOLDS: one refusal, one event, no re-press inside the hold
```

The scenario summary also reports three total sentry presses/denials over its
16-second run; those later attempts are outside the protected retry hold and are
not a falsifier failure.

**VERIFIED — loadout admission, exit 0**

```text
node scripts/_verify-loadout-admission.mjs
```

```text
[loadout-admission] PASS {"room":{"id":"p1","primary":"deadeye"},"unknown":{"id":"p1"},"hostKit":{"before":"deadeye","after":"deadeye"}}
```

**VERIFIED — stance authority, exit 0**

```text
node scripts/_verify-stance.mjs
```

```text
[stance] PASS {"speeds":[6.6,2.75,1.25],"zones":["head","head"],"proneFootprint":["prone","prone-yawed"],"invalid":"flying","muzzle":"bad-origin","primary":"deadeye","headroom":{"blocked":"crouch->stand","allowed":"prone->crouch"},"facade":{"crouch":"crouch","prone":"prone"}}
```

**VERIFIED — bedroom collision proof, exit 0 with one sensitivity item OPEN**

```text
node scripts/_bedroom-collision-proof.mjs
```

The source build returned 203 colliders. The repaired route passed for the actual
player half-width `0.30 m` in all four directions (hall↔bedroom and
green-room↔bedroom), and the retained `BED_SET_X=0` negative control failed both
hall directions as intended. The report measured a `0.080 m` landing gap and the
bed bounds `x -5.94..-4.04, y 3.15..3.70, z 23.62..24.52`.

The script’s conservative `0.42 m` sensitivity run reports the hall↔bedroom route
as false while its separate `clearancePassConservative` field is true. This is an
**OPEN sensitivity discrepancy**, not a process-exit failure: the real player
width proof passes, but root should decide whether the conservative route grid is
too strict or whether the visual doorway needs more clearance before treating the
bedroom as fully robust.

**VERIFIED — gait authority, exit 0**

```text
node scripts/animation/verify-gait-speeds.mjs
```

The verdict was `PASS explicit sprinting flag preserves walk/jog/sprint semantics
and scales each active clip by authored speed`. Baked speeds were walk `1.97`,
run `2.67`, sprint `2.84`, and crouch-walk `1.4`.

**VERIFIED — prone skinned-surface proof, exit 0**

```text
node scripts/animation/verify-prone-clearance.mjs
```

The verdict was `PASS corrected prone-idle and prone-crawl skinned surfaces remain
above floor and rifle carry stays root-forward with supported hands across full
cycles; legacy pose fails negative control`. Corrected minimum surface Y was
`0.0038566` for prone-idle and `0.0053020` for prone-crawl. The negative-control
legacy rows remain below floor by design.

**VERIFIED — first-person hands CPU proof, exit 0**

There is no checked-in TS runner, so the known CPU runner was an ephemeral esbuild
bundle followed by Node; it was deleted in `finally`:

```powershell
@'
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
const outfile = join(tmpdir(), `nuketown-first-person-hands-${process.pid}.mjs`);
try {
  await build({ entryPoints: ['scripts/verify-first-person-hands.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile, logLevel: 'warning' });
  await import(pathToFileURL(outfile).href);
} finally { rmSync(outfile, { force: true }); }
'@ | node --input-type=module
```

Rifle, pistol, SMG, shotgun, and sniper each reported phase/bind restoration
`PASS`; the final line was `[first-person-hands] 5 weapon rigs verified CPU-only`.

## Industrial barrel static review

The current builder was bundled only to call its placement and collider functions;
it was not added to the live scene:

```text
src/build/industrial-barrels.ts -> industrialBarrelCollider(placement)
```

The four coordinates and returned AABBs are:

| placement | centre `(x, y, z)` | yaw | AABB `(width, height, depth)` |
| --- | --- | ---: | --- |
| white-east-fence | `(11.6, 0.151, 34.8)` | 0.18 | `(0.738157, 0.930, 0.742181)` |
| white-west-fence | `(-10.8, 0.151, 31.8)` | -0.24 | `(0.767720, 0.930, 0.771388)` |
| orange-east-fence | `(11.3, 0.151, -33.0)` | -0.12 | `(0.705937, 0.930, 0.710302)` |
| orange-west-fence | `(-10.6, 0.151, -34.2)` | 0.28 | `(0.785900, 0.930, 0.789324)` |

These dimensions are the measured source `0.634 x 0.930 x 0.639 m` envelope rotated
into world-space AABBs. The static review confirms the placement coordinates are
inside the intended prop band and away from the known spawn/door ranges by CPU
geometry. Actual merged-scene overlap, route traversal, shadows, and visual quality
remain **OPEN** for root’s browser/runtime review.
