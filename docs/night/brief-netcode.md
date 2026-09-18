# Lane `netcode` - multiplayer lobby and host technology

Read `docs/night/_COMMON.md` first.

## The owner's words

> "multiplayer lobby host tech ... and maybe the multiplayer infrastructure and how we
> had the net code set up, all that kind of thing"

The predecessor project got a long way with this and paid for the lessons. Your job is
to bring the *design* across and stand up a working host/join slice here - not to port
files.

## Files you own

- `src/net/**` (new directory - create it)
- `src/ui/lobby.ts` and `src/ui/lobby.css` (new files only)
- One small, clearly-named wiring call in `src/main.ts`, and nothing else in that file.

Read-only: everything else, including the rest of `src/ui/**` (a sibling lane owns the
HUD and menus), `src/weapons/**` (a sibling lane owns weapons this wave), `src/core/**`
and `src/build/**`.

## Read the old project first - this is most of the value here

`C:/Users/david/Desktop/stuff/atomic-acres` (reference only, copy no file):

- `src/network.ts`, `src/network-sync.ts` - the transport and the sync loop
- `src/remote-snapshot-reconciliation.ts` - reconciling a remote snapshot against local
  prediction. This is the hard part and the file most worth reading closely.
- `src/schema-snapshot-kernel.ts` - how snapshots were schematised
- `src/host-lobby-admission-generation.ts`, `src/host-room-recovery.ts`,
  `src/room-rejoin-identity.ts` - admission, recovery and identity on rejoin
- `src/mp-lobby-authority-views.ts` - what each side is allowed to believe
- `src/network-fairness.ts`, `src/network-chaos.ts` - fairness and the chaos harness
- `src/netcode-diagnostics.ts`, `src/netcode-diagnostics-overlay.ts` - the diagnostics
- `scripts/qa/run-network-chaos-matrix.ts` - how it was tested under loss and jitter
- `C:/Users/david/Desktop/stuff/atomic-acres-netcode-pass59-61.pdf` and
  `atomic-acres-netcode-four-clocks.mp4` if they open - the "four clocks" model is the
  conceptual core and is worth understanding before you write anything.

Write a short section in your report on what that project's design got RIGHT, and what
you would do differently here knowing what it cost. That analysis is a deliverable in
its own right.

## What to build this pass

Scope honestly: a correct, small slice beats a broad broken one.

1. **A transport abstraction** with at least a loopback implementation, so everything
   above it can be tested with no network at all. WebRTC data channels behind the same
   interface if you get that far; if not, say so and leave the seam clean.
2. **Host authority**: one peer is host, owns match state, and is the only writer for
   anything contested. Make the authority boundary explicit in types, not in comments -
   it is the thing that rots first.
3. **A lobby**: create a room, get a join code, join by code, see the player list,
   ready-up, host starts the match. It must work host-and-one-client on this machine
   through the loopback transport.
4. **Snapshot + interpolation** for remote player position at a fixed tick, with local
   prediction and reconciliation for your own. Keep the tick rate and buffer depth as
   named constants with a comment saying what they trade off.
5. **Diagnostics**: a small overlay or console command reporting tick rate, RTT,
   snapshot age, and reconciliation corrections per second. Without this, nobody can
   tell a netcode bug from a game bug - the old project learned that the hard way.

Do NOT build matchmaking, accounts, persistence or a server deployment. Do not add a
dependency without saying why in your report.

## Things that will get your work reverted

- Trusting a client for anything contested. If a client can assert its own kill, score
  or position without host validation, that is the bug, not a shortcut.
- Per-frame allocation in the sync loop, or a growing buffer with no bound.
- Any `setInterval` or listener that is not torn down when a room closes. The old
  project leaked rooms this way.

## Verify before you report

```
npx tsc --noEmit -p tsconfig.json
npm run build
npm run traverse
```

Traverse must still report 4/4 house faces enterable and handedness PASS; ignore its
route PASS/FAIL, which is red for a geometry reason the orchestrator owns.

Then prove the slice: drive host-plus-client through the loopback transport headlessly,
and report the actual numbers - ticks exchanged, snapshot age distribution,
reconciliation corrections, and JS heap at start and after two minutes. Say plainly
what does not work yet.
