# Resume-edge CPU review

Review date: 2026-09-19. Source tree:
`C:\Users\david\Desktop\stuff\worktrees\nuketown-recovery-20260919`.

## Verdict

**VERIFIED** `node --check scripts/net/verify-resume-edges.mjs` passed, and
`node scripts/net/verify-resume-edges.mjs --json` exited 0 in about 1.0 s. The
proof exercises the real `HostRoom`, `GuestClient`, `GameHost`,
`createHostDriver`, and `createSoloDriver` paths. Its only substitutes are the
manual loopback transport, a bounded world query, and a no-op match UI.

**VERIFIED** The JSON result covered all three requested edges:

| Edge | Result | Evidence |
|---|---|---|
| New transport/token resume | PASS | `guest-b` resumed seat `p1` with phase `playing`, life `1`, shot high-water `0`, and input sequence continued from `0` to `1`; wrong-token, stale-identity, quiet-seat, and expired-reservation controls held. |
| Starting/countdown resume | PASS | Resume retained `phase=starting` and `startTick=20`; both authority and guest changed to `playing` at tick 20; pre-start input was rejected and post-start input was admitted. |
| One-host-frame rematch rebuild | PASS | `pre`, `mid`, and `post` refresh positions all observed one epoch increment, coherent old/new resume facts, and welcome → warmup/initial-spawn wire ordering. |

**OPEN** This remains a CPU schedulability proof. It does not establish WAN,
WebRTC, browser refresh, rendering, audio, or real two-device behavior.

## Harness corrections required before the result was meaningful

The timed GLM draft did not reach a trustworthy verdict until these narrow
proof defects were repaired:

1. `Hub.down.find()` returns `{to,msg}` records; the start assertions now read
   `record.msg`, and the roster helper returns the newest matching wire event.
2. A dead page is now modeled by dropping the old transport path. Liveness and
   expiry assertions read the authoritative `room.roster()` because a dropped
   peer cannot receive the roster change.
3. A started room's admission precedence is `already-started` before capacity
   (`src/net/room-admit.ts`), so the stranger control records that exact result
   and separately checks that the disconnected seat remains reserved. It does
   not claim a `room-full` refusal from this scenario.
4. The rematch shot now uses the real `ShotClaim` shape. The fixture uses the
   smallest authored score limit (`10`) and one bot; it drives ten real host
   claims with a three-second wait because `HostLife` currently uses its 2.2 s
   fallback despite the menu's 1 s row.
5. The proof aligns the production `performance.now()` receipt seam with its
   virtual authority clock, preventing synthetic future/stale shot failures.

These are harness corrections, not runtime changes. No production source was
edited for this review.

## Remaining review item

**OPEN** The bearer control intentionally records that an old transport peer
presenting the correct seat token can retake the seat after a different peer
has resumed it. That is the current `resumeSeat` contract in
`src/net/room-admit.ts`, not a hidden pass. Root should decide whether the
token is intentionally bearer-scoped or should be bound to a refresh epoch;
this proof preserves the observation and does not change the policy.

**VERIFIED** The host authority remains in `src/net/room.ts` and
`src/game/host.ts`; guest state is populated from the host welcome/state path in
`src/net/room-guest.ts` and `src/net/match-guest.ts`. The rematch path is the
real `src/game/session-solo.ts` rebuild rather than a copied epoch formula.
