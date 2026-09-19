# Guest net clock refinement

## Boundary

The host room and `GameHost` stamp absolute monotonic times in the host's clock
domain. The guest driver advances `GameClient` and presentation from the guest's
clock. `src/net/event-clock.ts` is the receive boundary between those domains:

```text
host absolute time  -  (hostNow - guestNow offset)  =  guest absolute time
```

`match-guest.ts` calls `localizeGameMessage()` exactly once for each host gameplay
message before it reaches `GameClient` or `OrdnanceView`. The adapter shifts every
absolute endpoint it knows about:

- event `at`
- death `respawnAt`
- spawn `protectedUntil`
- grenade `detonatesAt`
- smoke `bornAt` and `diesAt`
- death-drop `diesAt`
- match `endsAt`
- streak snapshot `at` and its optional cause event

`GuestClient` seeds the offset from `welcome.hostNow - welcomeReceiveNow` (and
refreshes it at `start` if the first pong has not arrived). That short initial
estimate includes one network leg; the first NTP pong replaces it. This closes
the join/start window where an event could otherwise enter the guest projection
with offset zero and permanently advance `GameClient.now` into the wrong epoch.

Relative values remain spans. In particular, `flash-hit.durationMs` is unchanged,
and a match snapshot keeps the same `endsAt - at` remaining time after both
endpoints move together. Player snapshot `hostNow` remains in the room's host
domain because it feeds `SnapshotRing` and is sampled against a host-domain
render timestamp in the guest driver; it does not enter `GameClient` as an event.

## Falsifier

Run from this worktree:

```text
node scripts/_verify-event-clock.mjs
```

The proof bundles the real adapter, `GameClient`, `OrdnanceView`, and the shipped
flash curve. It feeds smoke, flash, death, grenade, and match messages through
the guest projection at guest-local times, checks smoke live/expiry, flash
on/off, respawn countdown, raw-message immutability, and endpoint deltas with
both a positive and a negative clock offset. It also double-localizes a message
as a negative control and confirms that the wrong absolute endpoint is detected.
A failure means an absolute field was omitted, converted as a duration, mutated,
or crossed the boundary twice.

## Scope and remaining integration proof

This refinement owns only the receive-side conversion. It does not change host
authority, game balance, room admission, or snapshot interpolation. The parent
lane should run the existing two-browser proof after review so the full wire path
confirms that the NTP offset learned by `GuestClient` reaches the conversion
exactly once.
