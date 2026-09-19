# roster20 production repair — handoff (nuketown-glm-resume-20260919 → root)

Lane: exclusive writer `refine/glm-resume-20260919`, source-only, no browser/GPU/server/delegation.
Root: `nuketown-recovery-20260919` at `29efde5` (read-only; all delivery is patches + new files below).
Prior partials preserved and finished, not restarted. Unrelated dirty resume-lane files
(`session-solo`, `main`, `net/*`, `host` resume surface) are untouched by this slice.

## What this delivers

20 designed weapons, **16 playable**. The 4 behaviour-gated exotics
(`railgun`, `explosive-crossbow`, `flamethrower`, `flare-gun`) stay design records with
reasons, and **fail closed on every live path** — a forged wire claim or direct catalog
lookup refuses exactly like an unknown id. No exotic mechanics invented.

| Entry | Refusal | Proof |
|---|---|---|
| `command('switch', prototype)` / index past end | `false`, active unchanged | `_verify-roster20-controller.mjs` |
| `adoptWeapon` / `grantRounds` prototype | `false` | controller verify |
| `validPrimaryId` (lobby + rejoin) | `undefined` (falls back, never stored) | `_verify-roster20.mjs` §6, real `GameHost` |
| `submitShot` forged prototype bullet | `malformed` | §6, end-to-end vs `29efde5` logic |
| `HostLife.hit` prototype id | no damage, no hit | §6 direct, plus longhorn control lands |
| `fullRounds` / `createDrop` prototype | `0` rounds (dry, like unknown) | §6 |
| loadout sanitize + `resolveLoadout` prototype slot | dropped / default kit | §4 (two layers) |
| bot arsenal | prototypes + all 3 sidearms excluded | `BOT_ARSENAL` gate |

Controller: 16 weapons on **5 shared family rigs** (was 1 rig per weapon → 20 graphs);
reload pose resets on switch; carbine canary adopts onto the Longhorn only, never hides or
releases a rig another weapon renders; dispose releases every owned geometry exactly once,
0 materials touched. Original five keep switch slots 1–5 and byte-stable catalog rows.
Sidearm policy: `SIDEARM_IDS` = pistol-family trio (`duster`, `magnum`, `flashlight-pistol`),
`sidearmForPrimary` is the old rule live again; trait bars rank the playable pool only.

## Apply at root (order matters)

1. Copy new files verbatim: `src/weapons/families.ts`, `src/weapons/roster.ts`,
   `scripts/_verify-roster20.mjs`, `scripts/_verify-roster20-controller.mjs`,
   `docs/orchestration/overnight-20260919/baselines/` (catalog baseline sha still matches
   `29efde5`: `2cb6f098…86980f4`).
2. `git apply docs/patches/roster20-catalog-vs-29efde5.patch` — 15 entries, original five untouched.
3. `git apply docs/patches/roster20-loadout-vs-29efde5.patch` — gate only; **semtex preserved**
   (this worktree predates it; the patch was rebased so the semtex hunk is context, not a revert).
4. `git apply docs/patches/roster20-controller-vs-29efde5.patch` — shared rigs + gate + dispose.
5. `git apply docs/patches/roster20-admission-gate-vs-29efde5.patch` — `host`, `host-life`,
   `host-shot` (comments), `pickups`, `bot-sense`. Coexists with root's `loadoutOf`/`shotSeqOf`.

Validation done here: all four pass `git apply --check` against pristine `29efde5` content in
both LF and CRLF checkouts, and apply byte-exact (modulo git's own CRLF smudge). Supersedes
the deleted `docs/patches/roster20-controller-integration.patch` (was against `b015a59`,
predates the shared-rig and host-gate work).

## Evidence (CPU-only, per lane budget)

- `node scripts/_verify-roster20.mjs` — PASS (20 designed / 16 playable, original-5 stable,
  13 primaries + 3 sidearms, §6 fail-closed proofs incl. live `GameHost`).
- `node scripts/_verify-roster20-controller.mjs` — PASS (5 shared rigs, 96 switches +
  reload/adopt lifecycle, canary shared-safe, 137 geometries × 1, 0 materials).
- `npx tsc --noEmit` — clean. `npm run check` — root runs it post-apply.

## Root acceptance (not run here — forbidden)

`npm run verify` (check / playcap / capture / traverse) then `soak` before hand-off; the 17
carbine loader proofs and `node scripts/_verify-streak-reject.mjs` stay the render-chain gate.
Look at the frames: `capture` stations carry no viewmodel/bots, `playcap` is the play-path gate.

## Honest debt

Art: 11 playable weapons borrow one of the five shipped rigs (`FAMILY_FALLBACK`, flagged per
row in `rosterProjection`); exotics borrow the rifle only as a stand-in silhouette — never as
a behaviour claim. Audio: five shipped shot voices by family; no new foley. No AoE, DoT, cone,
arc, charge or pierce exists anywhere; a prototype leaves `roster.ts:GATED` the day its
behaviour lands. No UI/network/host rewrite; no old-project code or assets copied.
