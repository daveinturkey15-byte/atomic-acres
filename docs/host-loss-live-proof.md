# Live host-loss watchdog proof

`scripts/_verify-host-loss-live.mjs` is a bounded, read-only browser proof for
the guest inbound-host watchdog. It consumes the already-running candidate at
`http://127.0.0.1:4192/` and the already-running LAN signalling relay at
`http://127.0.0.1:4310`; it starts neither process.

Run it from the recovery root after the native watchdog fix:

```text
node scripts/_verify-host-loss-live.mjs
```

The harness opens two fresh stock Chrome instances through `stockBrowser`, uses
the real Multiplayer, Host a room, Join by code, Ready, and Start match UI, and
requires both peers to reach an active match. It proves the LAN/WebRTC path from
both `lan peers 1` diagnostics, two-seat rosters, host/guest modes, active
snapshots, and a guest RTT line before inducing loss.

Loss is induced by attaching CDP `Debugger` to the owned host page and pausing
JavaScript. The host tab stays open and no `beforeunload`, `pagehide`, or
`unload` event may fire, so the guest cannot pass through the deliberate UI leave
or an orderly host disposal. The host is resumed only after the guest reaches
its terminal state, then its lifecycle counters are read back. This exercises
the inbound silence watchdog rather than the graceful `bye` path.

The guest must reach the terminal state in under 9.5 seconds (and therefore
under the 10 second acceptance bound), with all of these observed from the live
page:

- `__NTGAME.mode() === 'idle'`;
- `lobby.view()` reports `role: 'idle'`, `phase: 'idle'`, and exact error
  `HOST LEFT THE ROOM`;
- the Multiplayer lobby is visible in `#start` and its error element carries
  the same exact text;
- `netLine()` is `null` immediately and after a short post-terminal sample,
  showing the room/ping projection has been torn down;
- the host remains open and lifecycle counters remain zero until after the
  watchdog result is captured.

The 9.5 second bound follows the runtime contract: `LIVENESS_MS` is 6,000 ms
and the guest watchdog heartbeat runs every 2,000 ms. The proof fails closed if
the peers do not start, the pre-loss link is not actual LAN/WebRTC, the host
pause is not observed, the guest does not close for the exact host-left reason,
the timeout is exceeded, terminal room diagnostics remain live, or either stock
page reports a console/page error.

Artifacts are written outside tracked source under `captures/host-loss-live/`:
`result.json` contains timings, pre-loss channel/roster/snapshot evidence, the
guest terminal projection, host lifecycle counters, and bounded errors/logs;
`guest-final.png` is the guest's terminal screen captured after the watchdog
transition.

## Current candidate result

The root-owned run in `captures/host-loss-live/result.json` is **VERIFIED** for
the candidate at `http://127.0.0.1:4192/`: all 9 recorded checks are
`VERIFIED`, the two real peers reached an active LAN/WebRTC match, and the
guest reached the exact `HOST LEFT THE ROOM` terminal in 6,483 ms. That is
inside the 9,500 ms proof bound and the 10 s acceptance bound. The host stayed
open while paused; `beforeunload`, `pagehide`, and `unload` were all zero, and
both host and guest error arrays were empty. This proves the ungraceful host
silence watchdog path for this candidate. It does not by itself prove the
promoted 4191 build or broader multiplayer quality.
