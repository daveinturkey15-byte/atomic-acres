# Retained heavy-motion timestamp diagnosis

VERIFIED — Read-only investigation on 2026-09-27. No browser, GPU, build, helper/source edits, re-encoding or frame changes. The original failed take and exhausted two-repair ledger remain unchanged. This document proposes one possible isolated diagnostic; it does not admit or execute another run.

## Exact evidence

VERIFIED — `captures/overnight-heavy-grip-canary-attempt2/report.json` fails `frame timestamps must advance`. Its motion manifest is `captures/overnight-heavy-grip-canary-attempt2/motion/manifest.json`. All **456** JPEG byte counts and SHA256 values match the manifest. Filenames retain contiguous arrival indices; stored metadata timestamps equal the fields used by the gate. The retained ffconcat still contains the two negative durations, `-0.018071` and `-0.024395`; it is not an accepted playable encode.

VERIFIED — Recording ran 2026-09-26 22:38:14.216–22:38:27.326 UTC. First-to-last metadata span is **12.725606918 seconds**. Browser receipt identifies Chrome **153.0.8010.54**, protocol 1.3, revision `ab3ecba863fd7852cc9b0fe5736187e19ed52a1c`. Runtime source was `3c3b0872210cef77818f69ce8f8563b10334279f`, entry SHA256 `8281d455950b4af25cc542469a1e448bdf42a0a529818e07bcf0131aef7a9739`. This is historical evidence, not the current accepted or candidate runtime.

VERIFIED — Read-only `FileVersionInfo` on 2026-09-27 reports both FileVersion and ProductVersion **153.0.8010.54** for `C:/Program Files/Google/Chrome/Application/chrome.exe`, the explicit executable selected by `scripts/lib/stock-browser.mjs`. It matches the recorded browser version. No browser was launched. OPEN — The installed binary's current revision and live protocol schema were not queried; version equality supplies no evidence that the newer fields below have become available.

| VERIFIED raw arrival index | Previous timestamp, seconds | Current timestamp, seconds | Difference | Current receipt UTC | Receipt gap |
|---|---|---|---|---|---|
| 223 | 1790462301.302486 | 1790462301.284415 | −18.071 ms | 22:38:21.330 | +4 ms |
| 305 | 1790462303.451788 | 1790462303.427393 | −24.395 ms | 22:38:23.486 | +13 ms |

VERIFIED — Every `receivedAtMs` is nondecreasing. Both offending pairs and their immediate neighbors carry `reload`; neither reversal straddles a phase-label change. The two receipts are respectively **4,157 / 6,313 ms after** the reload label and **2,290 / 134 ms before** the turn label. Phase counts are hip19, ADS32, fire15, reload246 and turn144. These meet the retained count requirement individually; the monotonic gate still fails.

## Screenshot and acknowledgement overlap

VERIFIED — The exact matching helper starts screencast before `minigun-hip`, then calls the ordinary `frame()` function for hip, ADS, firing, reload and turn while screencast remains active. Each `frame()` awaits `page.screenshot()`. These five screenshots are serial with each other, but concurrent with the active screencast stream. Their before/after page-clock observation spans are about 872, 649, 640, 606 and 577 ms; those spans also include state RPC overhead.

OPEN — The receipt does not record Node-clock screenshot command start/end times or page time-origin calibration. The current retained reload PNG modification time is 22:38:18.785 UTC, about 2.544 and 4.700 seconds before the reversals. That filesystem observation does not establish immutable command boundaries. The evidence therefore establishes whole-stream overlap, **not screenshot overlap or causation at either bad pair**.

VERIFIED — On each event, the helper issues `Page.screencastFrameAck` before decoding/writing, tracks the promise, and drains outstanding promises at stop. Recorded motion errors are empty. It neither sorts timestamps nor awaits an asynchronous operation before appending the frame. However, `receivedAtMs` is recorded after synchronous file writing, not at handler entry. Per-event session IDs and ACK issue/completion times were not retained. Zero reported ACK errors cannot reconstruct the actual in-flight queue or prove timing/order guarantees.

## Official source check

VERIFIED — At the **recorded browser revision**, Chromium creates this metadata timestamp using wall-clock `base::Time::Now()` before image encoding. Each JPEG is encoded by an independent `ThreadPool::PostTaskAndReplyWithResult`; the completion callback emits the event with its already-created metadata. There is no timestamp sorting barrier in this path. The in-flight predicate permits another capture while its count is at most two; ACK for the current session decrements that count. The session identifier is reused for that screencast session, so it is not an increasing frame-order proof. [Recorded Chromium implementation](https://github.com/chromium/chromium/blob/ab3ecba863fd7852cc9b0fe5736187e19ed52a1c/content/browser/devtools/protocol/page_handler.cc#L143).

VERIFIED — That source establishes a wall-clock value sampled while building capture metadata. OPEN — Neither this receipt nor that assignment establishes an actual GPU swap/presentation instant. Calling these values measured GPU swap times would overstate the evidence.

VERIFIED — The corresponding thread-pool API posts replies when their individual tasks complete. Posting-order execution requires a sequenced runner; the observed encoding call uses the general thread-pool API. **Inference:** different JPEG completion times can plausibly invert emission relative to metadata creation. This is a mechanism supported by source, not a trace of these particular two events. [Recorded thread-pool contract](https://github.com/chromium/chromium/blob/ab3ecba863fd7852cc9b0fe5736187e19ed52a1c/base/task/thread_pool.h#L119).

VERIFIED — Current official Page protocol labels the epoch timestamp optional, adds a separate optional `monotonicTimestamp`, and exposes `maxFramesInFlight`. No timestamp-ordered event-delivery promise is stated in those declarations. [Current Page protocol](https://raw.githubusercontent.com/ChromeDevTools/devtools-protocol/master/pdl/domains/Page.pdl). The recorded revision lacks both newer fields; its timestamp is `Network.TimeSinceEpoch`. They cannot be retroactively assumed available or used to replace the original failed gate. [Recorded Page protocol](https://github.com/chromium/chromium/blob/ab3ecba863fd7852cc9b0fe5736187e19ed52a1c/third_party/blink/public/devtools_protocol/domains/Page.pdl#L352).

OPEN — Exact cause remains unresolved. Concurrent encoding is plausible; a wall-clock adjustment also cannot be excluded from this record. There are no browser encoding-task traces, clock-adjustment observations or per-event ACK timings to distinguish them. Screenshot load may influence scheduling, but these data do not prove that it caused either reversal. The gate correctly stays failed; this diagnosis does not convert the take into accepted motion or performance evidence.

## One possible fresh isolated diagnostic

OPEN — If root separately admits it, prepare **one motion-only CDP take with no `page.screenshot` calls between screencast start and stop**. Freeze its exact runtime/browser/helper identities, JPEG80/everyNthFrame1/full1600×900 settings, native menu/loadout/focus/pointer-lock controls, actual host fire/reload completion and original concealed-ground fixture. Predeclare phase dwell windows that retain the original 8–15-second span and at least two frames in each hip/ADS/fire/reload/turn phase; do not extend the run or relax a gate after failure. Stills belong before/after that interval. This isolates the identified competing screenshot workload; success would not prove the old causal hypothesis or eliminate the source-level ordering risk.

OPEN — Add observation only: immutable arrival index, callback-entry wall/monotonic clocks, full untouched event metadata/sessionId, native-action/phase issue times, ACK issue/completion/error times and raw JPEG hashes. Preserve every delivered frame in arrival order, including events arriving during stop/drain, with an explicit interval label. Run the unchanged strict timestamp and phase gates against the declared recording interval. Never drop, reorder, interpolate, retime or repair frames to pass. Retain any new failure and stop; no automatic retries are proposed. Original helper and failures remain frozen.

OPEN — No runner has been prepared or executed. This proposal does not request unsupported `maxFramesInFlight` or `monotonicTimestamp` fields and does not claim single-frame-in-flight enforcement. Any future use of those fields would first require actual browser revision/protocol capability evidence. The original monotonic gate remains an unchanged evidence-integrity requirement.

| VERIFIED retained artifact | SHA256 |
|---|---|
| Historical report | `9c8ce765baa4e9b9785dc91a9531a29da9c9c7ca4bb5c09bed1fa35f1ae8ad18` |
| Historical motion manifest | `580e1891a8c64df17092ded6e8a4cf9ac7c9749d90afe994102d7bce7f0efd95` |
| Unchanged helper, also matching historical receipt | `bacee4db22058a18f7ca4b25f044953e48ae6100796d7ccf5a923dae3465562c` |
