# Overnight earned-pilot proof — pass 1

VERIFIED source preparation only, 26 September 2026. The worker owns only
`scripts/_verify-overnight-earned-pilot.mjs` and this note. No browser, GPU,
build, runtime edit or commit was performed. Root owns serial execution and
integration. Source baseline is the new Atomic Acres salvage candidate at
`ac3f1d4`; the retained tested runtime is `278b02b`, not the older project.

The preparation budget is 20 minutes, starting 21:41:52 UTC. Browser admission
is one initial run and at most two defect-directed harness repairs, each with
a new report tag. There is no automatic retry. A real product failure stays
OPEN and is reported to the owner of that source path. Earlier failed receipts
must remain intact. No threshold is relaxed to make this test pass.

## What the earlier failures establish

VERIFIED retained `salvage-earned-pilot-expanded-2.json`: five real Railgun
kills, zero deaths, original life and one earned drone charge. It then failed
the 5-second native pointer-lock gate. The browser reported
`WrongDocumentError: The root document of this element is not valid for pointer lock.`
The menu recorded `pointerLock: denied`; possession was never proved.

VERIFIED retained `salvage-earned-pilot-expanded-3.json`: its disposable browser
was granted the experimental `pointerLock` permission. Four real kills were
followed by a real bot grenade death, correctly failing the one-life assertion.
The retained menu still recorded denied lock. This did not prove that a
permission grant fixed pointer lock; it must not be described as such.

VERIFIED upstream clarification: the current Chrome article now explicitly
says the Keyboard Lock / Pointer Lock permission experiment was not launched.
The previous blanket “Chrome 131 requires a permission grant” rationale is
stale. See [Chrome's updated article](https://developer.chrome.com/blog/keyboard-lock-pointer-lock-permission).

VERIFIED source mechanism: Chromium rejects a native lock request with
`kWrongDocument` when its view cannot be pointer-locked, including absent native
focus. On the Windows view the default `CanBePointerLocked()` delegates to
`HasFocus()`. See [request admission](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/renderer_host/render_widget_host_impl.cc)
and [view focus check](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/browser/renderer_host/render_widget_host_view_base.cc).
This is a plausible explanation, not proof of the old run's native focus state.

VERIFIED installed Playwright 1.63.0 `lib/coreBundle.js` enables focus emulation
when attaching the default CDP context (around line 37638). Consequently
`document.hasFocus()` under the original helper is not sufficient evidence of
native view focus. Its `bringToFront()` uses the supported `Page.bringToFront`
command (around line 37367).

The new harness clears this preexisting emulation with `enabled:false`, then
uses `page.bringToFront()` and an ordinary trusted Deploy click. Root approved
this labeled harness change. It does not grant permissions, replace pointer
APIs, define focus/lock properties, generate fake lock events or open a headed
window. It records the exact browser version, focus/visibility, connected canvas,
trusted input events, transient activation and actual lock. No claim of repair
is made until `document.pointerLockElement === actualCanvas` passes.

## Frozen browser contract

1. Fetch the preview identity and actual entry bytes; require the supplied full
   runtime SHA and matching entry SHA256. Retain the harness's own SHA256.
2. Boot the existing stock headless/muted/disposable-profile helper. Require
   advancing WebGPU frames. Choose Railgun, one Recruit bot, FFA, 25-kill / 10-minute
   rules and Piloted Drone in slot 3 through the actual menus. Set the bot slider
   using its normal Home key, not injected settings.
3. Require native focused-canvas lock within the original 5-second lock budget
   immediately after the trusted Deploy gesture, before spending time earning
   kills. A denial writes FAIL with passive diagnostics and closes only this
   owned browser. Do not continue into a weaker keyboard-only possession test.
4. Earn five real admitted Railgun kills in the initial life with zero deaths,
   zero initial charge and exactly one earned charge. The sole gameplay fixture
   is player ground position/aim, as in the previous test. The director, enemies,
   health, weapons, damage, score, charges, clock and authority remain live.
5. Use clear authored ground, real collision clearance and LOS. Prefer firing
   distance, then retreat the player to clear ground away from the current bot
   and already-thrown grenades while the real cooldown/reload runs. Log those
   placements. This addresses the observed corpse-side grenade wait; it does
   not erase grenades, freeze the bot, grant immunity or claim human traversal.
   Any death still fails the same one-life assertion.
6. Activate the earned charge with Digit5. Require the actual aircraft pool,
   pilot HUD, hidden body weapon, elevated camera and consumed charge. Real W/E
   must move the camera more than 1 m and climb more than 0.3 m in 600 ms while
   the body moves less than 0.02 m. Native locked mouse input must change aim.
7. A body firearm command must be refused during possession; ordinary G/V and
   native mouse trigger cannot spend issued body ammo or grenades. The pilot
   input's firing flag must follow the trusted locked-canvas trigger. Preserve
   actual camera/pose/HUD screenshots and trajectory observations.
8. Escape restores the original body eye height/location, weapon and HUD
   without opening pause. Digit5 re-enters the same paid instance with no charge.
   Natural 30-second expiry must emit the authoritative `expired` event, restore
   the body and remove the aircraft from the visible pool. A subsequent unpaid
   activation must be denied. A real body shot must consume issued ammunition
   again. Every stage retains the original live actor and no browser errors.

The 180-second earning budget and original movement/body/camera/aim assertions
remain. The whole attempt has a 360-second deadline. Screenshots/JSON use a
unique tag; an existing report causes refusal, not replacement.

## Claim boundaries and product slices

OPEN until root runs and inspects the exact receipt and pixels: usable native
mouse possession, all browser stages above and the focus-ordering hypothesis.

The camera position is downstream of the host's aircraft snapshot in
`src/core/pilot-controls.ts:87-99`; the helper never sets the drone/camera directly.
The verifier observes that path's real movement rather than manufacturing a
host state. It proves the normal UI body-attack suppression and unchanged issued
inventory. It does not forge hostile claims to replace the existing actual-host
`possessing` rejection tests, and it does not claim that the drone's trigger
damaged an enemy merely because its local firing flag was true. Separate
authoritative aircraft damage/LOS tests remain the evidence for that boundary.

VERIFIED source concern, not a diagnosed root cause: `src/core/player.ts:136-138`
calls `requestPointerLock()` on canvas click without handling the returned
promise. A native rejection can therefore become an unhandled page error,
whereas the menu's Deploy path handles rejection. If root chooses a product
repair, retain denied menu state and actual lock gating; catching that promise
alone does not make possession work. This worker did not edit Player/main/UI.

## Root execution

Run only after resource admission and the root's exclusive browser/GPU slot.
If the runtime changes, supply its new full stamped commit; do not point this
script at an unbuilt development tree.

```powershell
node scripts/_verify-overnight-earned-pilot.mjs --url http://127.0.0.1:4348/ --tag overnight-earned-pilot-pass1-attempt1 --expected-commit 278b02bc4bcf3ea9e47411848b0ec6bf54b10814
```

VERIFIED preparation validation: `node --check` passed. No browser acceptance
is claimed. Root must inspect both JSON and the controlled/returned frames;
artifact generation alone is not visual acceptance. Any future attempt gets a
new tag and records the localized change and remaining repair budget here.

## Attempt 1 and localized harness repair 1

VERIFIED root-run `captures/overnight-earned-pilot-pass1-attempt1.json` failed
before any kills: ordinary Play solo click timed out at the unchanged 15 seconds.
The locator resolved; its combined visible/enabled/stable wait did not finish.
The document reported focused/visible and no browser errors. Menu geometry and
page-frame trajectory were not retained, so invisibility, focus and frame stall
are not established causes.

Repair 1 aligns the focus-before-navigation ordering with the successful frozen
profiling helper and supplies the same explicit authored flags (already the
runtime defaults). It records public menu state/panel, ancestor styles/rectangles,
hit target, renderer counters and passive page-rAF count both before clicking and
on failure, even when no match snapshot exists. Three real page callbacks and a
visible initial home panel are required inside the existing 90-second readiness
budget before the unchanged normal click. No forced click, visibility mutation,
public menu navigation bypass or focus spoof is used. Attempt 1 remains FAIL;
repair 1 is source-verified only. One of two localized repairs is used.

## Disjoint heavy-grip art capture helper

VERIFIED source-only `scripts/_capture-overnight-heavy-grip.mjs` accepts explicit
`--variant baseline|canary`, a full expected commit and expected entry SHA256.
Baseline omits `heavy-hands`; canary requires `heavy-hands=canary`. Root must run
the frozen baseline and candidate serially with separate unique tags. Both use
1600x900, the same authored scene/ground pose and real admitted Minigun/Magnum.
Hip, ADS, firing, reload, turn and optional sky-backdrop views are recorded for
each gun with before/after state and image hashes. A screenshot whose required
weapon state ends before capture completes is retained as a failed attempt.

VERIFIED the current product's Bots minimum is one. Root accepted one live
Recruit for this art-only capture; the helper does not invent a zero-bot mode or
remove/freeze director actors. Body life, actual inventory and admitted kit stay
checked. All weapon actions use native mouse/keyboard; only player pose is staged.
The public weapon state exposes hand transforms and sockets, but not complete
mount matrices or geometry budgets; those remain tied to the separate loader
proof. Capturing frames returns `CAPTURED_PENDING_PIXEL_REVIEW`, never art PASS.

Root command shape (supply each frozen preview's exact identity):

```powershell
node scripts/_capture-overnight-heavy-grip.mjs --url http://127.0.0.1:4360/ --variant baseline --tag overnight-heavy-grip-baseline-attempt1 --expected-commit <baseline-full-sha> --expected-entry-sha256 <baseline-entry-sha256>
node scripts/_capture-overnight-heavy-grip.mjs --url http://127.0.0.1:4361/ --variant canary --tag overnight-heavy-grip-canary-attempt1 --expected-commit 6d5fde72042cf6492ca438056bba55d5cc46e113 --expected-entry-sha256 db1655e0481fcd3648136bc8a22072ff7bfd6d289c885a7d4f168009bff5ffd8
```

VERIFIED both scripts pass `node --check`. No browser or GPU job was launched
by this worker. The art lane also allows initial capture plus at most two
localized repairs; existing baseline and rejected frames are never overwritten.

VERIFIED pre-run independent review tightened repair 1 without a further browser
attempt: every player shot must spend exactly one of that actor's issued rounds
and produce no new self shot-reject; expired slot 3 must log that actor's new
not-earned denial. Session-global counters remain checked but cannot substitute
for those actor-specific observations. The final player staging also verifies
the real LOS/ground/bounds of the intended corridor from ground + 8m before
possession. Movement thresholds and the six-minute total deadline are unchanged;
startup and remaining gameplay time are recorded separately.

OPEN art coverage: short motion and neutral front/side/three-quarter model views
are not implemented by this still-capture helper. Its neutral-sky image is an
in-game backdrop view, not those model views. The fresh comparison uses identical
pose (-4, -34.3, yaw PI) for baseline and canary; it differs from the retained older
pose (-6, 0, yaw -PI/2). No crop or lighting change is used, and completing the
stills cannot close those missing review gates or art acceptance.

## Art attempt 1 and localized staging repair 1

VERIFIED `captures/overnight-heavy-grip-baseline-attempt1/report.json` retained
Minigun hip and ADS, then failed the initial-live-actor assertion before the sky
view. Own HP was 100 at hip, 83 before ADS and 10.75 after ADS; the real Recruit's
Longhorn rounds fell 150 to 140. No browser errors were recorded. Bot positions
were absent from that receipt, so the precise shot path and a safer old pose
cannot be inferred from it. Those two stills remain preliminary evidence.

Repair 1 records bots and live ordnance. Immediately after genuine admission,
the baseline chooses a deterministic fixed ground pose from an ordered list:
clear player collision, actual blocked LOS to live bots, at least 30m bot distance
and 15m existing-projectile distance, preferring the farthest bot. It then retains
that exact pose for every view. There is no actor freeze, health change or threat
removal. This supersedes the earlier proposed (-4,-34.3) capture pose.

The canary must now receive `--pose-from <baseline-tag>/report.json`; it reuses
the baseline's recorded exact coordinates/yaw and independently checks actual
cover/distance there. It fails if that identical pose cannot be admitted. A live
bot may subsequently reach the pose; the original life gate still fails rather
than moving the camera between comparisons. Motion and neutral model views stay
OPEN. This is art repair 1 of 2, source-verified only until root runs it.

## Pilot attempt 2 and final localized harness repair

VERIFIED `captures/overnight-earned-pilot-pass1-attempt2.json` acquired native
focused canvas lock from trusted Deploy and earned two actual Railgun kills in
life 1 with zero deaths/browser errors. Each consumed its own issued round
(24→23→22). It then failed because the candidate firing-pose search returned no
clear grounded position. The live bot was at (-2.794,3.15,-19.499), upstairs;
the player remained at (-18,0,-26). This is not evidence that the bot was
unhittable, and the helper stopped before the existing earning deadline.

Final repair 2 doubles angular samples and adds legitimate 2m/1.5m/0.8m close
positions. It retains the exact existing ground, bounds, collision and LOS gates.
A temporarily unshootable/missing live bot now records rejection counts and its
pose, retreats only the player and waits for the actual director within the
unchanged 180-second earning window/six-minute total limit. It never fires from
an invalid position or changes the bot. Five real kills in the original life,
native lock, own-ammunition, possession and all restoration gates remain required.
Both localized pilot repairs are now used; a further correct failure stays OPEN.
