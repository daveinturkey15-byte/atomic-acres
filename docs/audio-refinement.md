# Audio refinement lane — 2026-09-19 (OMP / Muse Spark 1.3)

Modern weighty gun audio for the standalone Nuketown game. Replaces the old
single-filtered-noise `playShot` and the square-wave `click` beeps with a
layered authored bank plus a bounded playback service.

## What changed (lane-owned files only)

- `src/audio/service.ts` (new) — `AudioService`: one lazily-created
  `AudioContext`, master gain -> destination with a `DynamicsCompressor`
  limiter, one effects bus. Capped voice set (`MAX_VOICES = 16`, priority
  steal for shots/blasts, counted drops for low-priority cues), per-voice
  retirement via `onended` + `disconnect`, `dispose()` that stops voices,
  disconnects the graph and closes the context. No update loop, no per-frame
  allocation — voices are short-lived nodes created only on game events.
  Every method is headless/autoplay safe (null context -> silent no-op);
  the context is created lazily and resumed only from user-gesture paths.
  Public setters: `setMasterVolume`, `setEffectsVolume`, `setMuted`,
  `resume`, `preload`, `audioStats`, `dispose`.
- `src/audio/render-bank.mjs` (new, canonical mix) — deterministic offline
  synthesis (`node src/audio/render-bank.mjs`): 44.1 kHz mono 16-bit WAVs to
  `public/audio/` + `manifest.json` with sha256/peak/RMS/duration/seed per
  file. Re-runs reproduce every sample bit-for-bit.
- `src/audio/check-bank.mjs` (new) — offline verifier, fails non-zero on any
  violation (WAV shape, hash/size/duration vs manifest, peak < 0 dBFS,
  audibility bands, DC offset, 15 MB budget, service version/cap/retirement
  contract). No browser needed.
- `public/audio/` (new, generated) — 13 WAVs + `manifest.json`, 567.3 KiB
  total. Served as static files (`audio/*.wav` relative to the page).
- `src/weapons/controller.ts` (audio sections only) — fields
  `audio`/`noiseBuf` replaced by one `AudioService`; `ensureAudio` deleted;
  `playShot` delegates to `audioSvc.shot(familyOf(id))`; square-wave `click`
  deleted and its three call sites re-voiced (`dryFire`, `reloadStart`,
  `reloadEnd`); one impact thud per trigger pull (`impact(pullDist,
  pullDusty)`, never per pellet); `switchWeapon` on successful switch;
  `blast` in `blastAt`; `resume()` on `pointerDown`/`keyDown` (gesture
  unlock); new public setters `setMasterVolume`/`setEffectsVolume`/
  `setMuted`/`resumeAudio`/`preloadAudio`/`audioStats`/`disposeAudio`.
  No gameplay tuning touched: spread, recoil, damage, timers, claims,
  HUD state and poses are byte-identical logic.

## Voice design (anti-pew-pew)

Every shot layers transient (3–8 ms highpassed noise crack) + body
(lowpassed noise blast, per-family cutoff/decay) + thump (sine that FALLS
~90→40 Hz — chest weight; nothing ever sweeps up) + two baked mechanical
clicks + dull tail with two sparse echoes. Families: Longhorn rifle bark
(1.9 kHz), Rattler SMG yap (2.5 kHz, tight), Coachman shotgun boom
(1.15 kHz + heavy thump), Deadeye sniper cannon (850 Hz, 1.1 s tail),
Duster pistol pop (2.7 kHz, light). Mechanical cues are shaped noise
bursts, never oscillators.

## Source / license / provenance

No external samples, no downloads, no third-party material. Every byte is
authored by `src/audio/render-bank.mjs` (seeded `mulberry32`, documented
recipe table) — original work in this repository under the project's own
terms. `public/audio/manifest.json` records per-file sha256, seed and
generation inputs; re-running the renderer must reproduce the manifest
hashes exactly (the check enforces hash/size/duration match).

Bank as rendered (v2, 567.3 KiB — budget 15 MB):

| file | dur | peak | RMS | sha (12) |
|---|---|---|---|---|
| shot-longhorn.wav | 0.55 s | 0.89 | 0.112 | d599a5aae58f |
| cue-reload-start.wav | 0.35 s | 0.55 | 0.037 | 515dc20d90da |
| cue-reload-end.wav | 0.40 s | 0.65 | 0.062 | 1840b9bcbba6 |
| cue-dryfire.wav | 0.15 s | 0.50 | 0.026 | dbdbcfe77ebf |
| cue-switch.wav | 0.25 s | 0.45 | 0.028 | 39a7f74a6c76 |
| cue-impact-dirt.wav | 0.30 s | 0.60 | 0.106 | 4c060f9c9b67 |
| cue-impact-hard.wav | 0.25 s | 0.60 | 0.064 | c1284fb85168 |
| cue-hitmark.wav | 0.08 s | 0.40 | 0.024 | e1f50bf18a08 |
| cue-blast.wav | 1.60 s | 0.89 | 0.162 | ddc6d49c656f |

Auditions: the WAVs ARE the game audio (played back 1:1 when buffers load).
Play any file in `public/audio/` to audition. The procedural fallback (used
only before buffers load / fetch failure / headless) is intentionally
thinner; its family table is hand-synced in `service.ts` (`FALLBACK`).

## Checks run

- `node src/audio/render-bank.mjs` — renders 13 files, 567.3 KiB. PASS
- `node src/audio/check-bank.mjs` — every file/budget/contract assertion passes:
  hash/size/duration match, peak < 0 dBFS, RMS audibility bands, DC ~0,
  version match, MAX_VOICES 16, onended retirement, single context site,
  no Math.random, limiter present.
- `npm run check` — `tsc --noEmit` + render-site allow-list. Clean.
- Voice budget (static): one pull = at most 3 voices (shot + impact + hit tick);
  misses = 1 (shot only); reload/dry/switch = 1. At 800 rpm the SMG holds ~3
  concurrent voices. The 16-voice cap only binds under multi-shooter netcode
  playback, where steal/drop applies. No per-frame allocation: service has no
  update path; controller calls it only on events.

## Proposed root hooks (NOT touched — needs root / other lanes)

1. **Menu gesture (root, `main.ts`)**: on Play-button `pointerdown`, call
   `controller.resumeAudio(); controller.preloadAudio();` so the bank
   decodes during map load instead of on first shot. (Already works without
   this — first gun input resumes + preloads; this just warms it earlier.)
2. **Settings volumes (UI lane, `ui/**`)**: wire the existing sliders to
   `controller.setMasterVolume(v)` / `setEffectsVolume(v)` / `setMuted(m)`
   with `v` in 0..1. Values persist pre-init inside the service.
3. **Footsteps (root + audio lane follow-up)**: `MoveSample` (already
   flowing into `controller.update` with `speed`/`grounded`) needs an
   optional `surface?: 'concrete' | 'dirt' | 'wood' | 'metal'` from
   `main.ts` via the existing `world-query` ground raycast (~3 lines in
   `main.ts` + 1 optional field in `weapons/types.ts`); the audio lane then
   plays a stride-timed footstep cue in `update()` (grounded && speed > 1,
   interval scaled by speed). Surface data lives in root — not guessed here.
4. **Ambience (root lifecycle)**: add `AudioService.ambient(kind, on/off)`
   later; `main.ts` starts it on match start, stops on menu. No design done.
5. **Ordnance cues (ordnance lane)**: grenade-throw whoosh, pin click, knife
   swoosh and blast-rattle belong to `ordnance-input.ts` presentation; the
   `takeClaim` drain in `controller.update` is the natural event site, keyed
   by claim id. Left for coordination with that lane — not assumed here.

## Residuals / honest gaps

- No perceptual claim: code + WAV specs only. Root must listen in-game
  (playcap path with audio) and judge weight/family separation.
- No browser/GPU run in this lane per instructions: no `playcap`/`capture`/
  `soak` evidence; no heap measurement of the service (bounded by design —
  max 16 live sources + 13 decoded buffers ≈ 2.5 MB).
- Misses (no hit) are silent by design; no whiz/crack layer proposed yet.
- `setVisible(false)` does not suspend the context (menu returns fast);
  add `disposeAudio()` on page-hide in root if process-audio-in-background
  matters.
- OMP adoption guard (`akp_adoption_guard.py check/audit`) not run: the
  single attempt to invoke it failed on a provider stream error, and budget
  went to the work. Re-attestation left to root.
