# GLM resume repair — mid-match rejoin (2026-09-19)

Implements the repair for both findings in `docs/muse-resume-audit.md`:
admission phase state AND input/shot epoch initialization, landed together as
one coherent protocol addition. The follow-up correctness pass makes life and
shot facts come from the current `GameHost`, queues the short guest-driver
handoff, and covers ordnance, respawn and rematch boundaries. The implementation
proofs ran CPU-only in this worktree. Root separately ran the live stock-Chrome
acceptance described below.

## Result

```
node scripts/net/verify-resume-repair.mjs
[resume-repair] seat=p1 movedPre=2.40m movedPost=1.44m moveSeq=10 admittedShots=4
  resume block: phase=playing lastSeq=9 life=1 shotSeq=2
  ALL GATES PASS: playing resume, epoch continuity, replay refusals, idempotent hello, cold joins

node scripts/net/verify-resume-authority.mjs
[resume-authority] PASS real GameHost authority plus real GuestDriver rematch/respawn epochs and handoff queue

node scripts/net/verify-resume-audit.mjs      (unmodified audit, post-fix)
  F1 welcome=playing after40ticks=playing sendMove=10  -> NOT-REPRODUCED
  F2 rawSeq0Rejected=1 acceptedDelta=1  -> NOT-REPRODUCED

npx tsc --noEmit -> clean
```

The audit's F2 line doubles as the regression control: the raw `seq:0` replay
is STILL refused while the resumed client's own next input is accepted.

## Live acceptance progression

**VERIFIED — G negative control.** The reserved seat rejoined, but the fresh
guest stayed idle, so live-match, life, movement, shot, and damage gates failed.
The failure is preserved in `captures/checkpoint-g-resume-negative.txt`.

**VERIFIED — H loadout catch.** The next live run caught a real presentation
regression: `Deadeye` selected before reload returned as `Longhorn` after
resume. The shot path still admitted and reduced the host from `100` to `66`,
which proved the resumed seat was alive while exposing the missing loadout
rehydration.

**VERIFIED — H2/H3.** H2 restored `Deadeye` across the guest weapon surface,
HUD, and host actor. H3 then passed all 16 stock-Chrome gates. Its post-resume
host-authoritative grenade inventory was `lethal=1`, `tactical=1` on both
guest and host (`parity: true`); the guest moved `6.016271339984616 m`; and
the resumed admitted shot changed the host from `100` HP to `0`. Both browser
pages had empty error arrays. Evidence is in
`captures/checkpoint-h2-resume.txt` and `captures/checkpoint-h3-resume.txt`.

The resume `rounds` value remains the host's documented normal-shot estimate.
This acceptance proves the selected primary, live shot admission, and host
total-rounds handoff. It does not promise an exact magazine/reserve split or
exact redistribution after an arbitrary reload; that precision boundary is
intentionally outside the resume contract.

## Files changed (all in the owned list)

- `src/net/protocol.ts` — new `ResumeState` wire block (`phase`, `startTick`,
  `lastSeq`, `life`, `shotSeq`, primary/rounds, and optional lethal/tactical/
  armed kit levels); optional `WelcomeMsg.resume`; `isNetMessage` validates it
  when present (`isResumeState`).
- `src/net/room.ts` — `HostRoom.setResumeFacts(fn)` hook (the room still knows
  nothing about damage; it asks the registered game-side source only when
  building a resume welcome). `admit()` resume branch enriches `welcome` with
  `{phase, startTick, lastSeq, life, shotSeq, primaryId, rounds, lethal,
  tactical, armed}` when `phase !== 'lobby'`. A lobby resume sends no block —
  the cold-join state machine is untouched.
- `src/net/room-guest.ts` — `welcome` with a resume block lands the guest
  directly in `starting`/`playing`, stores the block, and sets
  `seq = lastSeq + 1`. Cold-join welcomes keep `state = 'lobby'` exactly as
  before. New accessor `resumeState()`. Game tags arriving before the
  frame-driven driver exists are retained in a bounded 128-entry FIFO and
  drained when `onGame` is installed; teardown clears it.
- `src/game/host.ts` — `shotSeqOf()` reads the current actor's authoritative
  `ShotWindow.seqHigh`; `lifeOf()` remains the authoritative health epoch;
  `loadoutOf()` exposes the current host kit without regranting it. Its
  `rounds` value is explicitly a total-rounds estimate, not a magazine split.
- `src/game/session-solo.ts` — `SoloDriver.resumeFacts()` forwards life, shot
  high-water, and current kit levels from the current `GameHost`, so a rematch
  cannot inherit a prior host's life or shot sequence.
- `src/net/match-host.ts` — `HostRoom.setResumeFacts` now calls the live
  `SoloDriver` port. No event tally is retained, and admitted ordnance claims
  are included because the host's window advances before ordnance resolution.
- `src/net/match-guest.ts` — driver seeds `lives` from `resumeState().life`
  (no longer muted pre-spawn), seeds the current primary/rounds and grenade
  levels before UI binding, and lifts shot claims by `shotSeqBase = shotSeq +
  1`, so the first post-refresh claim lands one past the host's retained
  window (inside `MAX_SEQ_GAP` = 512). Cold joins: base 0, wire unchanged.

## Why this shape

- Within a life the host never regresses `lastSeq` or its `ShotWindow`, so
  replay protection is identical across old and new transport ids: pre-refresh
  packets (inputs `<= lastSeq`, shot seqs inside the window) stay refusals.
  A spawn is the explicit life boundary: the host resets that window and the
  guest resets its local shot base at the same `initial`/`respawn` event.
  The proof re-plays `seq:0`, re-sends the just-sent seq, re-fires the same
  claim (`duplicate`), and asserts a `life:0` claim is refused `life-epoch`.
- Resumed shots continue ABOVE the high-water instead of the host forgetting:
  `admitShot`'s reorder tolerance admits lower seqs, so "reset the window"
  would genuinely readmit replays; continuing above is the only safe side.
- No field is required: old hosts/guests never see or send `resume`.

## Proof construction

`scripts/net/verify-resume-repair.mjs` bundles the REAL `HostRoom`,
`GuestClient`, `createGuestDriver` (the epoch logic under repair),
`createHostDriver` (the resume-facts port), `admitShot`/`createShotWindow`/
`acceptShot`, `createSessionLog`, and the real wire validation, on a virtual
clock. The only stub is the game core behind the narrow `SoloDriver` port
`createHostDriver` already consumes; it supplies explicit resume facts and runs
each claim through the real `admitShot`, so this remains a transport/driver
proof rather than a GameHost authority proof. Gates cover: cold join, lobby
`welcome` without a resume block,
pre-refresh spawn→3 admitted shots→window high-water 2→10 inputs→2.40 m,
refresh with dropped bye → 7.5 s silence → reservation, resume → `playing`
with `{lastSeq: 9, life: 1, shotSeq: 2}` and the same seat, resumed driver
`lives === 1`, first `sendMove` returns 10 and integrates 1.44 m and is acked,
seq-0 and duplicate-seq refusals, post-resume shot admitted as wire `seq 3,
life 1`, immediate resend `duplicate`, stale-life `life-epoch`, retried hello
idempotent (no second seat), lobby cold join on a second room unchanged, and
cold join against a playing room still `already-started`.

`scripts/net/verify-resume-authority.mjs` is the authority proof. It bundles
the real `GameHost`, admits an ordnance claim and checks its actual
`ShotWindow.seqHigh`, kills and respawns an actor and checks life/window reset,
creates a fresh rematch host and checks life 1 plus an immediate seq-0 shot,
then delivers a real `GuestClient` game tag before `onGame` construction and
asserts the bounded handoff queue drains it. Its real `createGuestDriver` case
then sends one resumed shot (`seq 10`, `life 1`), one rematch-initial shot
(`seq 0`, `life 1`), and one respawn shot (`seq 0`, `life 2`), proving the
guest resets its per-life sequence base instead of carrying the prior window.

## OPEN (not claimed fixed)

1. **Token-branch resume under a fresh transport id was not executable here:**
   `LoopbackLink` is module-private, `transport.ts` is not in this lane's
   owned list, and `createLoopbackPair` fixes two peer ids — a resumed guest
   on the same pair matches `resumeSeat`'s by-peer branch first. The repair is
   branch-agnostic (the welcome enrichment runs for any resumeSeat match) and
   the token check itself is unchanged code, but a harness with a third
   endpoint should pin it.
2. **Rematch boundary timing:** `HostRoom` remains in its active lobby phase
   while `session-solo.ts` builds the next `GameHost` on the next host frame
   after the rematch hold. The callback now reads the current host rather than
   a stale tally, and the proof covers a fresh host, but a refresh exactly in
   that one-frame boundary still needs the root live rematch proof.
3. **`starting`-phase resume** shares the code path (`phase`, `startTick`
   carried; guest waits in `starting` and is promoted by `applyState`) but the
   proof exercises only the audited `playing` case.
4. The root merge preserves the guest inbound host watchdog. Its 9/9 live
   host-loss proof passed after resume integration, and H2 normal multiplayer
   passed 24/24 checks over 120 seconds. Local clock localization, stance and
   audio changes are preserved. WAN and the rematch timing above remain OPEN.
