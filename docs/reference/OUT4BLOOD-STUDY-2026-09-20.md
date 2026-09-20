# Out 4 Blood — inspected techniques and transfer plan

Owner source: https://x.com/luaacro/status/2101136760080114010
Author's playable client: https://cesharpe.com/o4b
Author's release page: https://cesharpe.itch.io/o4b

VERIFIED September 20: downloaded the public browser entry and 35 referenced JS
modules using normal Windows TLS validation. Exact URLs, byte counts and SHA-256
are in `.recovery-runtime/o4b-study/manifest-os-trust.json`. The earlier urllib
manifest records certificate failures and is not evidence of successful downloads.
Downloaded the linked 45.8-second 1280x720 video and inspected six extracted frames
in `reference-clip.mp4` / `contact-sheet.jpg`. Files remain local study material.

VERIFIED the client contains Babylon.js code and its animation-group controllers;
it is not a Three.js implementation. Engine presence alone is not proof of which
renderer every browser selects. No engine migration is proposed.

## Observations that can be rebuilt here

| Evidence in public client / actual clip | Independent application here | State |
| --- | --- | --- |
| Separate idle, walk, sprint, ADS, fire, reload, empty-reload, draw and holster animation groups; groups pause when their weapon is hidden | Explicit weapon action priority and cancellation; blend locomotion underneath the active action; don't animate invisible guns | Next hands/weapon pass |
| Velocity controls animation weights; NPC run, sprint and strafe groups; staggered animation updates | Present simulation samples smoothly, then animate from that pose; preserve a separate presentation clock and authority | First slice implemented: 20 Hz pose interpolation, single root owner, +Z rig facing, render after animation |
| First-person camera target, up vector and FOV are eased; authored hand poses remain attached to weapon actions | Small bounded recoil/sway, deliberate reload landmarks and hand contact instead of excessive camera shake | Next hands/weapon pass |
| Short-lived muzzle flash with variable rotation and alpha; cancellable delayed actions | Bounded event-driven effects; hide/pause/dispose coherently on weapon switch and match exit | Existing flash failure remains open; this is a different design reference, not proof of repair |
| Actual video: distinct dark/bright value groups, localized warm practicals, layered haze, detailed weapon silhouettes, compact low-screen HUD | Rebuild contrast/contact/material response for this map's fixed sunny desert setting; simplify persistent HUD clutter | Materials/lighting and HUD milestones |

The source excerpts are bounded local research notes in `technique-excerpts.json`.
Do not copy minified client modules or third-party meshes into this project. The
release page lists Apache 2.0 for **code**; separate game-asset licences have not
been established. Downloading a public playable client is not an asset licence.

The owner's H3 first/third-person clips remain independent pose/timing references.
They are not extracted motion capture, and no game event timings are inferred
from generated video. Existing baked animation provenance lives with `public/anim`.

## Current-library checks

Installed Three.js is 0.180.x. Current upstream references were checked through
https://threejs.org/docs/llms.txt and
https://threejs.org/docs/pages/AnimationAction.html . Crossfades, weights and time
scales should use the installed API; current upstream examples do not authorize
copying newer engine APIs or changing the stable renderer during this pass.

## Largest remaining gaps

OPEN: the game still has crude building/furniture detail, repetitive surfaces,
weak distant silhouettes, an oversized first-person weapon, limited body acting
and an overfull HUD. Correcting geometry and sampling does not meet the full visual
bar. Next work must be visible in matched gameplay frames, not just this study.
