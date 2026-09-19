# GLM host watchdog independent review

Date: 2026-09-19
Scope: `src/net/room-guest.ts` and CPU-only network proofs in `scripts/net/`

## Result

**VERIFIED** `GuestClient` now treats host liveness as a directional protocol
boundary. `isNetMessage()` remains the structural gate, but the guest then
accepts only host-authored message types before changing its watchdog clock.
Wire-valid `input`, `hello`, `ready`, `shot`, and `streak-intent` messages from
the expected host peer are ignored and cannot keep a dead host admitted.

**VERIFIED** Host `state` broadcasts are monotonic at the guest boundary.
Non-safe or duplicate/out-of-order ticks are ignored, including their state
callback and liveness refresh. A fresh state tick received while a resumed
guest is in the lobby is accepted as a liveness word but does not pretend to
repair the separate resume/start protocol.

**VERIFIED** Duplicate `welcome` messages for the current seat refresh the
roster without demoting the guest. A mismatched welcome is ignored. A stale or
duplicate `start` cannot move an already playing guest backwards.

**VERIFIED** Host silence uses the existing `LIVENESS_MS` (6 seconds) and a
single terminal path. The path detaches the transport listener, clears join
and ping timers, records `closed`/`host-left`, decrements the live-room count,
and invokes the change callback once. A later `dispose()` or queued message is
a no-op; the close path does not send a misleading bye after detecting one-way
host loss.

## Proof evidence

**VERIFIED** `node scripts/net/verify-host-silence.mjs` passed 15/15
expectations. One source-lifecycle expectation was corrected to the
intentional exact-once rule: after watchdog close, a later `dispose()` sends
zero additional byes (W6b), rather than expecting one.

The retained 15 assertions map directly to the original IDs:

- **W1** valid host traffic keeps an admitted guest alive;
- **W2a–W2d** exact-once silence timing, lifecycle reason/callback, timer
  release, and refusal to create a replacement polling timer;
- **W3/W3b** foreign or malformed traffic cannot refresh liveness or mutate the
  roster cache;
- **W4a/W4b** late welcome, start, state, game traffic, and rejected-guest
  traffic cannot resurrect a seat;
- **W5a/W5b** joining remains outside the watchdog and still ends through the
  existing retry timeout;
- **W6a–W6c** ordinary dispose idempotence, watchdog-close dispose behavior,
  and zero leaked fake intervals;
- **W7** host clock skew cannot alter guest-local watchdog timing.

**VERIFIED** `node scripts/net/verify-host-silence-semantics.mjs` passed 10/10
focused semantic checks for host direction, fresh/stale state ticks, phase
guards, exact-once callback/room-count teardown, late-message immunity, and
the original live-room count.

**CLAIMED** The unowned copied `scripts/net/glm-focused-proof.mjs` reports
8/8 because its defect-oriented expectations/reproductions hold; that number
is not a watchdog repair score and is intentionally left untracked. F1/F2
remain open resume defects. Its F3 expectation reflects the repaired
host-silence behavior, which is authoritative only through the separate
15-expectation proof above.

## Open boundary

**OPEN** This patch does not implement mid-match resume synchronization or
sequence-space renegotiation. The existing review proof still demonstrates
that a resumed client receives `welcome` without a `start`/state resync and
that its input/shot sequence counters are not renegotiated. Those changes
remain with the separate GLM lane as requested.

**OPEN** No browser, GPU, server, or full build was used in this bounded pass.
The proofs bundle the actual TypeScript sources into a temporary Node module
and exercise them through the real loopback transport with virtual time.
