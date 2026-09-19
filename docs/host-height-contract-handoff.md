# Host height contract — handoff (2026-09-19)

Owner: Muse Spark 1.3 Contributor, bounded 25-minute source-only lane in
`worktrees/nuketown-combat-feedback-20260919` (exclusive writer).
No browser, GPU, server, install, credentials, publishing, or delegation.
Root recovery lane read-only. Prior failed/partial proof files preserved
(`captures/cfb-live/*` untouched). No commit. Root rebuilds and reruns the
SAME stationary-guest proof.

## Status

Minimal trusted-elevation fix owned, CPU-proven, ready for root browser rerun.
`npm run check` clean. New falsifier 11/11 PASS on fix, 2/11 on old build.
Neighbor CPU gates still green (host-silence 10/10 + 15/15, guest-stationary
placement 7 groups). Weapons/menu/ordnance/streak files untouched.

## Scoped baselines (exact)

Root candidate per directive: `a84e70f` + reviewed QA / opt-in mountain
experiment. Recovery HEAD at write time: `29efde5`
(`29efde5 Integrate reviewed external loadout selection and readable HUD`).
`a84e70f` stat touches no `src/net/room*`; `HEAD:src/net/room.ts` sha256
(`git show`, LF) equals `a84e70f:src/net/room.ts`:

- `a84e70f:src/net/room.ts` → `2bf131f4…db8f2`
- `HEAD:src/net/room.ts` → `2bf131f4…db8f2` (identical)
- recovery disk `src/net/room.ts` → `8770aeb0…e8b7b9c` (CRLF variant only;
  `diff --ignore-all-space` vs both blobs empty; defect lines 161–176 identical)
- this lane pre-fix disk `src/net/room.ts` → `72f7c9ee…fa9af44f`
  (`diff --ignore-all-space` vs recovery disk empty — same bug, whitespace only)
- this lane post-fix disk `src/net/room.ts` → `245dea5b…5ba86a1`
- new verifier `scripts/net/verify-host-height-contract.mjs` → `6b393897…95cae`

Scoped patch (this lane, uncommitted): `src/net/room.ts` only
(21-line `driveHostSeat` replacement, `placeSeat` untouched) plus the new
verifier and this handoff. Pre-existing lane modifications
(`session-solo`, `session-types`, `main`, `match-guest`, combat-feedback UI/docs)
were already dirty and are not part of this contract.

## Defect (root's frozen proof)

`captures/cfb-live/cfb-guest-stationary-2125-1789849234190-result.json` on
frozen 4192: guest stationary `(-3.58, 0.15, 18.4)`, host local
`(-3.58, 0.15, 24.4)`, guest-seen host `y=0`. Body + fatal outgoing damage
PASS (34/34/32), zero victim popups, zero rejects, real WebRTC. Head aim
`rendered y+1.65 = 1.65`, only 1.50 above authoritative feet (`HEAD_Y 1.55`).
No crit. Source: `driveHostSeat` did `void y` → `placeSeat` forced `y=0`.

## Fix (`src/net/room.ts`, `driveHostSeat` only)

Trusted local-physics elevation, same band guests are held to:

```ts
const m = this.members.get(this.hostId);
if (!m || !Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(yaw)) return;
m.pose.x = Math.max(BOUND_X_MIN, Math.min(BOUND_X_MAX, x));
m.pose.z = Math.max(-BOUND_Z, Math.min(BOUND_Z, z));
if (Number.isFinite(y)) m.pose.y = Math.max(0, Math.min(INPUT_Y_MAX, y));
m.pose.yaw = yaw;
m.pose.stance = stance;
```

No new imports (`BOUND_*`, `INPUT_Y_MAX` already imported). No guest-path,
collision, or head-threshold change.

### Reset semantics (why two functions)

- `placeSeat(id, x, z, yaw, stance)` — deploy/spawn placement. Still forces
  `y=0`. Callers: `match-host` spawn sink for remote seats, tests, initial
  deploys. Spawn selections resolve ground-floor `y` (`spawns.ts` `groundAt`);
  the room re-anchors integration there and the next guest `input.y` / host
  drive restores slab height. Deliberately unchanged.
- `driveHostSeat(x, y, z, yaw, stance)` — per-tick trusted host drive from
  `match-host.tick` (`room.driveHostSeat(x, y, z, yaw, stance)` → `solo.tick`
  with the same `y`). Now carries street slab (~0.15) and deck/upstairs
  (~3.15, `FLOOR_H`/`DECK_Y`) into `m.pose.y`, hence into `broadcastState`
  `PlayerSample.y` and guest `latestPlayers`. Non-finite `y` retains previous
  feet (never NaN); non-finite `x/z/yaw` rejects the whole drive (as before).

## Tests (`scripts/net/verify-host-height-contract.mjs`)

Real `HostRoom` + `GuestClient` over loopback `CLEAN_LINK`, virtual clock,
lobby → playing, then authoritative `poseOf('host')` + guest-seen host sample
after `tickOnce` + pump. Run: `node scripts/net/verify-host-height-contract.mjs`.

| id | covers | old build |
|---|---|---|
| H1 | street 0.15 (−3.58, 24.4, the frozen proof coords) auth + replicated | FAIL (0/0) |
| H2 | upstairs 3.15 auth + replicated | FAIL (0/0) |
| H3 | crouch + 0.15 (stance rides with elevation) | FAIL (0, stance ok) |
| H4a | NaN/±Infinity y retains 0.15, never NaN | FAIL (never reaches 0.15) |
| H4b | NaN x rejects whole drive | FAIL (y already 0) |
| H4c | host clamps 10→5, −2→0 (`INPUT_Y_MAX` band) | FAIL (high 0) |
| H5 | 20× repeated street drives converge, no decay to 0 | FAIL (0) |
| H6 | `placeSeat` still resets 0 after a 3.15 drive (separate semantics) | FAIL (driven 0) |
| H7 | trusted drive keeps x/z arena clamps (999→25/42, y intact) | FAIL (y 0) |
| H8 | guest wire y still clamps 10→5, −3→0 (bounds not relaxed) | PASS (guard) |
| H9 | liveRoomCount returns to baseline | PASS (guard) |

Verified: new build 11/11 PASS; `git stash` of `src/net/room.ts` alone →
2/11 (only H8/H9 pass). `node --check` clean on the verifier.

## Related host-movement audit (read-only, implementation confined)

- `match-host.tick` → `driveHostSeat` — the demonstrated bug; fixed here.
- `match-host` spawn sink → `placeSeat(e.actorId, e.x, e.z, e.yaw)` — drops
  `SpawnEvent.y` (ground-floor resolved, `spawnSeed`/`groundAt`). Transient:
  next guest `input.y` / host drive restores slab height. Left unchanged per
  "confined to demonstrated contract".
- `room-core.integrateInput` forces `pose.y = 0` — guest path saves `y`,
  integrates, restores (`room.ts` `applyInput` L436–439); host never calls it
  (`driveHostSeat` is direct). Guest `sendInput` prediction zeroes local `self.y`
  but sends no `y` (proof path); real controllers use `sendMoveAt` with `y`.
  Left unchanged.
- `newMember` `y=0` — matches `SPAWN_A/B y=0`; lobby-correct. Unchanged.
- `broadcastState` / `forEachGuestPose` → `solo.remotePose` — publish `p.y`
  verbatim; now correct for the host with no further change. Host game logic
  already used the direct `solo.tick(now, x, y, z, …)` argument, so hit history
  was always right — only remote rendering was flat.

## Root rerun (SAME proof, rebuild first)

```bash
AA_PREVIEW_PORT=4192 node scripts/game/verify-guest-stationary-proof.mjs \
  --url http://127.0.0.1:4192/ --dist dist-next --signal-port 4310 --tag cfb-guest-stationary
```

Expect: guest-seen host `y≈0.15` at the street geometry, head endpoint
`≈1.80` (feet + 1.65) clearing `HEAD_Y 1.55`; body/fatal behavior unchanged.
Head crit/kill stays an honest OPEN if hit-zone/falloff says so — no threshold
was touched to manufacture it.

## Limits

- Source-only lane: no browser/GPU run here; visual + WebRTC acceptance is
  root's rerun above on the rebuilt candidate.
- Upstairs 3.15 is proven at the room/wire layer only; no upstairs LOS or
  balcony shot was fired here.
- Spawn-transient 0 (one tick between `placeSeat` reset and next drive/input)
  is documented, not removed; out of this contract's scope.
