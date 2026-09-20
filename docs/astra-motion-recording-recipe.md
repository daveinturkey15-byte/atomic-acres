# Root-only temporal recording recipe

This worker must not run browser/GPU jobs. Use the parent's serialized stock Chrome
lease and its already verified candidate server/build identity. Retain actual game
rAF rendering and the real Play solo -> Deploy menu path from
`scripts/_verify-hand-poses-5.mjs`; never call synthetic `goto` or `render` poses.

Record 1600x900 at actual elapsed timestamps for at most 20 seconds. Keep a manifest
containing the source SHA, bundle hash, full query, URL, weapon, input transitions,
and per-frame `weaponCmd('state')`/`stats()` samples. Do not infer cadence or shot
events from image motion. Preserve the previous paired recording.

1. Motion-only control query `?motion=canary`: deploy, select `duster` using the
   existing QA switch and refill commands, wait for hip idle, record 1 second.
2. Use one real QA `fire` command followed by `reload`; require true from both.
   Record the complete actual reload through `reloading=false`, plus 0.5 seconds
   of settle. Capture representative release, withdrawal, seat and return frames
   by observed reloadProgress; do not seek or set reloadProgress.
3. Hold W+Shift for 1.2 seconds, release both and settle 0.5 seconds. The spawn
   room can obstruct the route: require observed moving speed sufficient to engage
   sprint. If blocked, reposition by normal input before retrying this segment.
4. Hold right mouse for 0.8 seconds, release for 0.5 seconds, then repeat once to
   expose ADS entry/exit settling. Require state.ads true/false at the corresponding
   times. Keep the full camera/weapon path in the recording.
5. After the contact-aware pistol candidate passes its CPU gates, repeat exactly
   with `?motion=canary&hands=rigged`, then compare both recordings at real speed
   and frame-by-frame. Also capture pistol crouch/prone and the existing 17 poses.

Treat console errors, failed action starts, absent sprint movement, wrong source
identity, more than 1,200 calls/900,000 triangles, missing frames or incomplete
reload as failures. Read render statistics on actual frame boundaries as the
existing harness does. Technical checks are separate from visual acceptance:
judge grip contact, thumb/finger silhouette, wrist continuity, clipping and settle.
Static frames alone do not close this temporal acceptance item.
