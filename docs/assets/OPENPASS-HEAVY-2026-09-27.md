# Heavy-rig inspection: fresh bounded pass

VERIFIED: the previous neutral capture retained three positive views, then failed its nonzero draw-counter assertion. The failing numeric state was not retained. Its exact cause remains OPEN; the failed take and exhausted repairs are unchanged.

VERIFIED: installed Three.js r180 Animation resets renderer Info from its internal RAF, including when a manual viewer has no user animation loop. `scripts/_verify-openpass-manual-metrics.mjs` reproduces this using the actual installed classes with a mock scheduler. A completed draw can therefore have zero live counters when a later automation RPC reads them. This CPU counterexample establishes a measurement defect, not the cause of the historical GPU failure.

The viewer now disables automatic resets, explicitly resets before each draw, and retains completed draw counters alongside live counters. Camera, geometry, materials, lighting, seven pose samples, 1600x900/DPR1, WebGPU requirement and nonzero assertions are unchanged. Attempted states are recorded before asserting. Fresh explicit viewer selection requires three reviewed external SHA256 pins; original default pins, model pin, four source hashes, the 23-file allowlist and negative checks remain enforced.

VERIFIED CPU-built artifact: `captures/openpass-heavy-neutral-viewer-v1/`.

| Artifact | SHA256 |
|---|---|
| HTML | `ec9e1a7ca1ed63c24035f8b9cd30760ff11be88f11a681ea932299b612c3774f` |
| Manifest | `159c92da534717dfabc2616386c3e0a5447c5bcba12665fb1c403e3ee36fdd8c` |
| Bundle | `d55d0d49d9034d0dce78e9adf46e6b07e80584af26a81bd74bc294f4a184f887` |
| Original Minigun GLB | `bc7c965c3931ca2cce575a98552532b46fae11f41e313d3b03940cf726583a3b` |

VERIFIED: explicit-artifact CPU self-test passes the original asset, pose, source-hash and negative-route checks. Original builder/capture bytes are retained in `captures/openpass-manual-metrics-before/`. OPEN: actual neutral GPU capture, anatomy/contact, motion pixels and owner art. This artifact has not been run below the required 4GiB VRAM/14GiB RAM reserve.

OPEN: previous heavy motion contains two decreasing CDP timestamps. Its original monotonic gate remains intact. No frames have been reordered, dropped, cropped or assigned synthetic timing. Heavy hands remain opt-in.
