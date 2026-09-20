# Mortar two-peer proof — handoff

Delivered: `scripts/capture-mortar-two-peer.mjs` (new; `node --check` clean, grep-clean for host-write strings).
Source-only. No game code touched, no browser/GPU run here, no thresholds weakened. `capture-mortar-live.mjs` + outputs preserved untouched.

## Run (root alone runs the GPU)

```bash
node scripts/capture-mortar-two-peer.mjs --url http://127.0.0.1:4199/ --dist dist --signal-port 4310 --tag k4199
node scripts/capture-mortar-two-peer.mjs --url ... --dist ... --signal-port ... --tag ... --expect-js-sha <sha>
```

Overall 240 s (earn capped 150 s); owns two stock Chromes via `scripts/lib/stock-browser.mjs`; cleans both in `finally` on ANY error.

## What it proves (all through real seams)

- WebGPU present + served `assets/*.js|css` bytes identical to local `--dist` (`./assets/` normalized; stale-server photograph refused).
- Real WebRTC pair: host + skewed guest (`+240000ms` clock helper copied from `_verify-net-refinement.mjs`), LAN link, room code, both Ready, Start → host/guest, phase `active`, opposite teams.
- Host rules `tdm/scoreLimit null/900s` via real `__NTGAME.configure()` readback (8 kills never end the match).
- Earn: 8 admitted host kills over a staged idle guest — guest teleported to the open anchor per kill (stated QA staging), host teleported to a `collidersAt`+`los` firing spot, aimed at the chest, real `__NT.weaponCmd('fire')` claims + real `reload`; host must stay alive (any host death fails).
- Press: slot derived from the host snapshot (`blast-mortar` charges ≥ 1, default 4 = Digit6 key path) only after a `streak-earned <host> blast-mortar` ledger line; real `__NTGAME.pressStreak(slot)`; `streak-activated <host> blast-mortar` required, wrong-streak or denied/silence fails.
- Ring-before-impact on the host (warning disc while `impactSeq` unchanged, `active` phase, photographer alive, no respawn between press and ring), photographed `host-ring` + frame budget.
- Guest in the skewed domain sees the same warning disc (`guest-ring`) — localized expiry path, not a second stack.
- Detonation on both peers (`impactSeq` climbs), photographed `host-detonation` + budget.
- Cleanup: host disc retired + dust expired, guest disc retired; `host-cleanup` photographed; body alive/`active` correlated throughout.
- What it never does: writes no host state, constructs no bus event, grants no manual charge — grep-clean for `mortar-telegraph|mortar-impact|GameEvent|recordElimination|submitStreakIntent`. Teleports are QA staging, stated in the output JSON. No audio claim.

## If the earn is infeasible

Exits BLOCKED naming the exact step (`no blast-mortar charge in the host ledger after N admitted kills` + slots dump) and writes a `refuted` JSON. No canary, no press, no fake claim.

## QA conventions source

- Earn/press/ring/cleanup shape: `scripts/capture-mortar-live.mjs` (this worktree, DOM-fix 0057).
- Two-peer helpers (stock Chrome ×2, `installClockSkew`, `openMultiplayer`, roster/ready/start, `collidersAt`+`los` firing spot, chest aim): root `scripts/_verify-net-refinement.mjs` (read-only, nothing copied out of the root except the pattern).

## For the runner

Needs a built candidate serving at `--url` with `dist/` beside it for the sha comparison, plus the signal relay on `--signal-port` (default 4310). Output: `captures/<tag>-json` (verdict, fixture, host/guest ids, kills, ledger lines, slot, press log, ring order, guest skew marker, cleanup, counters, first 8 errors, staging note) + `host-ring`, `guest-ring`, `host-detonation`, `host-cleanup` PNGs. Then look at the frames: an unopened capture is not evidence.
