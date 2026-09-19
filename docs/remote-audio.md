# Remote shot audio integration

`shot-fired` is a host-authored edge for admitted firearm claims. It is emitted
after the exactly-once admission window accepts a claim and before hit
resolution, so a miss still produces one edge. Rejected and duplicate claims,
and ordnance claims, produce no firearm edge. Bots call the same
`GameHost.submitShot` path and therefore do not need a damage-event sound
fallback.

The event carries `actorId`, `life`, `seq`, `weaponId`, `x/y/z`, and host
monotonic `at`. `match-host` broadcasts it to every peer; `match-guest`
localizes `at` once through `event-clock`. `GameClient` ignores the local
actor, drops events older than 750 ms in that local clock domain, deduplicates
by actor/life/seq, and retains at most 24 pending edges. `drainRemoteShots`
writes into caller-owned storage and returns zero without allocating when the
queue is empty.

Root wiring has two small hooks:

```ts
// Construct once, passing the same static build colliders used by Player.
const worldQuery = createWorldQuery(colliders);
const worldAudio = new WorldAudio(
  worldTargets, mat, weapons, colliders,
  worldQuery.lineOfSight.bind(worldQuery),
);

// In the existing matchUi.bindClient callback:
worldAudio.bindClient(client);
```

The sink passed to `WorldAudio` needs the additive wrapper below. It may live
beside the existing local `shot()` wrapper in the weapon presentation owner:

```ts
spatialShot(family, distanceM, pan, occluded = false) {
  audio.spatialShot(family, distanceM, pan, occluded);
}
```

Keep the one `worldQuery` adapter and pass
`worldQuery.lineOfSight.bind(worldQuery)` as the fifth constructor argument.
The regular frame call remains `worldAudio.update(player.state,
player.getStance(), active, weather)`. Weather is updated first and continues
while the local player is dead; local footsteps are suppressed while
`client.isAlive()` is false. Remote edges drain from a reusable scratch array.
Occlusion then uses the existing static AABB segment math through
`WorldQuery.lineOfSight`; the fourth constructor argument is only the bounded
fallback for isolated CPU fixtures. There is no per-bullet global mesh raycast.

Remote playback uses the recorded five-shot bank when decoded, falls back to
the authored bank or procedural fallback, applies distance attenuation,
stereo pan, and a low-pass filter, and runs at priority 1. Local trigger pulls
remain priority 2. The existing 16 transient voice cap, two ambient loop cap,
21-entry preload, gesture gate, stale-decode guard, and dispose/recreate
lifecycle remain owned by `AudioService`.

Focused CPU proof target: `node scripts/_verify-remote-audio.mjs`. Root owns the
actual browser/multiplayer run and should capture accepted/miss, rejected,
duplicate, own-shot filtering, remote attenuation/pan, and teardown evidence
after wiring the two hooks above.
