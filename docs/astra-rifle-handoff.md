# Independent rifle hand candidate

VERIFIED: Source `02217fc5ab223f6e16b28a012cc6ea9f849fbf0d` adds
`?motion=canary&hands=rifle-canary`. It changes the procedural rifle fallback's
hands only: a trigger grip with index/thumb contact, four curled support fingers
around the fore-end, two shaped sleeves, and a contact-aware magazine reach.
The accepted pistol factory and shared motion helper remain byte-equivalent under
normalized-LF SHA256 checks frozen before authoring. Other weapon families keep
their existing geometry. No controller, catalogue, gameplay timer, material factory,
main.ts or authoritative event source changed.

VERIFIED: The contract was frozen in f95de1d before editing. Its solids are all
28 actual weapon mesh bounds/transforms, conservatively treated as oriented boxes
(including rounded-box and cylinder corner voids). Grip/fore-end/magazine maximum
penetration is 2mm, other solids 1mm. Contact limits and floor limits never changed.
Actual magazine-foot underside centre is [0, -0.20455336468, -0.102044798].

VERIFIED: Both hands together are exactly 12 meshes / 4,836 triangles / 3 shared
materials, with no new textures or per-frame geometry/material allocation. Four
curved fingers and one thumb per hand are static grip geometry, not animated digit
joints. The fore-end palm is 4.00mm from the actual handguard surface. Both sleeve
attachments and lengths remain constant to numerical precision through 241 poses.

VERIFIED: Final CPU checks pass 241 reload samples, 1,205 reload/offhand samples,
and 980 low-stance/ADS/offhand samples. Minimum level-camera worldY is 40.968mm
against the frozen 20mm threshold. Physical palm seat error is 2.236mm against 8mm:
the palm is 2mm left of centre on the actual underside and .5–1mm below its plane.
Reported zero excess penetration means no sample exceeds its limit, not necessarily
zero geometric penetration. Vertices and triangle centres are sampled; this is not
a formal continuous swept-volume proof.

VERIFIED: The same actual-controller regression passes separately with
`VIEWMODEL_HANDS_FLAG=rifle-canary` and `VIEWMODEL_HANDS_FLAG=rigged`: 6,970 frames,
172 exact action claims, 20 catalogue mappings and 17 admitted profiles including
crossbow. HUD/ammo/reload/cadence/FOV/camera recoil and claim origin/direction/time
match the retained controller. Default regression, pistol rig/transition checks,
typecheck and source build also pass. No full suite or browser/GPU job ran here.

VERIFIED: r0 failed a 2.98mm trigger-thumb bridge, a 2.06mm temporal magazine-foot
contact and a low-stance floor dip. Repair one fixed the thumb and floor but its
shallower diagonal transfer cut through the magazine. Bounded CPU configuration
diagnostics then separated descent, wrist turn and lateral transfer. Repair two
uses that measured path: release downward off the fore-end, lower/turn while
outboard, translate beneath the magazine, seat, then retrace. Both source repairs
are spent. The failed sources, results and diagnostic configurations are retained
under `docs/astra-rifle-evidence`; no failure was relabelled as passing.

OPEN: Root must compare actual rifle hip/ADS/reload/prone pixels and moving
sequences. Finger segmentation, cuff appearance, hand-to-hand overlap, extreme
camera pitch, renderer cost, resize/mobile and art quality remain unaccepted. The
procedural rifle body itself is unchanged. The pistol's real temporal run remains
separate evidence; its five observed reload images do not become six here.

Integrate f95de1d then 02217fc. No new main.ts integration is needed beyond the
previously integrated prone bit. Optional observer commit 15101c7 supports the
five weapon families without changing the default pistol capture:

```powershell
# Retain the root's verified RECOVERY_URL and expected live bundle hash.
$env:ASTRA_HANDS_VARIANT = 'rifle-canary'
$env:ASTRA_WEAPONS = 'longhorn'
$env:ASTRA_HANDS_MODE = 'both'
node scripts/verify-astra-hands-temporal.mjs
```

For the five-family check use `longhorn,rattler,coachman,deadeye,duster`; execution
is sequential and bounded to ten images / twenty capture seconds per weapon/mode.
Non-Duster output directories are `<weapon>-<mode>`. Duster retains the old directory
layout. All non-hand query flags remain identical between the paired modes.

The child source bundle is `index-CIVRZGrY.js`, SHA256
`bc74c9655d0459bf3cbb9b2c23b1ea52c24ee769cf4d4f856a3aecd8c4508fec`.
Root's combined lighting/facade build must have its own actual served-bundle receipt.
