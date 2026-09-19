# Audio foley refinement — 2026-09-19 (OMP / Muse Spark 1.3)

Bounded high-quality foley/environment layer on top of the v2 authored bank.
Modern weight, movement and weather; no arcade oscillator sweeps anywhere.
Lane-owned files only: `src/audio/**`, `public/audio/**`, this doc.

## What changed

- `src/audio/render-bank.mjs` (BANK_VERSION 2 → 3) — 8 new deterministic
  WAVs: 6 footfalls (`makeFootstep`: contact snap + band-limited scuff +
  falling heel thump; gravel adds a deterministic grain train) and 2
  loopable weather beds (`makeWind` 3.5 s, `makeRain` 2.6 s; integer-cycle
  swells + end-to-start crossfade, no phase step at the wrap).
- `src/audio/service.ts` (AUDIO_BANK_VERSION 2 → 3) — new public APIs
  `step(surface, opts?)`, `setEnvironment(kind, level?)`, `environment()`;
  optional `pan`/`rate` on the internal voice path; `unlocked` gesture gate;
  at most two owned ambient loops (`startBed`/`applyEnvironment`) with
  `setTargetAtTime` ramps (τ = 0.9 s) and hard ceilings (wind 0.14,
  rain 0.12); `dispose()` stops/disconnects the beds and re-locks.
- `src/audio/check-bank.mjs` — per-class bands for `step-*`/`ambient-*`
  (shot/cue bands byte-identical to v2), duration allowance for beds
  (≤ 5 s), seamless-loop gates (head/tail means + seam-within-texture),
  and service-contract gates (step/setEnvironment presence, gesture flag,
  ≤ 2 `.loop = true` sites, `setTargetAtTime`, gain ceilings).
- `public/audio/` — 21 files + `manifest.json`, 1202204 bytes (1174.0 KiB,
  budget 15 MB). All 13 v2 files bit-identical (same sha256 as the v2 doc).

Bank v3 additions (from `manifest.json`):

| file | dur | peak | RMS | sha (12) |
|---|---|---|---|---|
| step-concrete-a/b.wav | 0.14 s | 0.55 | 0.074/0.078 | f271fc5bcbbb / be5390f78026 |
| step-grass-a/b.wav | 0.17/0.18 s | 0.50 | 0.063/0.069 | e95a23a2285c / 2ebc13c67a1c |
| step-gravel-a/b.wav | 0.15/0.16 s | 0.50 | 0.044/0.055 | a56b85ffd5ff / 5718e2432959 |
| ambient-wind.wav | 3.50 s | 0.289 | 0.063 | facd006dcf1c |
| ambient-rain.wav | 2.60 s | 0.319 | 0.112 | 993f9f7cc404 |

Concrete cracks (2.8–3.2 kHz snap + 115→58 Hz heel thump); grass rustles
(lowpassed 650–750 Hz scuff, soft snap only, no thump); gravel crunches
(3.0–3.4 kHz snap + 4 deterministic grains). Nothing ever sweeps up.

## Public API (for root wiring — NOT touched here)

```ts
step(surface?: StepSurface, opts?: StepOptions): void
// StepSurface: 'concrete' | 'grass' | 'gravel' | 'dirt'→grass | 'wood'→concrete | 'metal'→concrete
// StepOptions: { speed? 0..1, stance? 'stand'|'crouch'|'prone'|'sprint',
//                distanceM?, pan? -1..1, variant? 0|1 }

setEnvironment(kind: EnvironmentKind, level?: number): void
// 'clear' | 'wind' | 'rain' | 'storm' (= wind + rain); level 0..1, default 1
environment(): { kind: EnvironmentKind; level: number }
```

Proposed root hooks (other lanes, not this one):

1. **Stride timing (`weapons/controller.ts` + `main.ts`)**: from the existing
   `MoveSample` (`speed`/`grounded`), stride-time `step()` calls
   (grounded && speed > 1, interval scaled by speed — same pattern the v2
   doc proposed); `surface` from the `world-query` ground raycast, passed
   as `StepSurface` (aliases cover `dirt`/`wood`/`metal` with no root
   mapping table needed). `distanceM`/`pan` are for remote/bot steps.
2. **Weather (`main.ts` lifecycle)**: `setEnvironment('wind'|'rain'|'storm')`
   on match start (map weather), `setEnvironment('clear')` on menu.
   Pre-gesture calls are stored and applied on `resume()` — never forced.
3. **Volumes**: unchanged semantics — beds ride the effects bus, so the
   existing `setEffectsVolume`/`setMasterVolume`/`setMuted` govern them.

## Bounds (checked, not asserted)

- One `AudioContext`, one construction site (`new AC()` × 1).
- 16 transient voices max, priority steal/drop unchanged; footsteps are
  priority 0 (drop under gunfire, never steal). One stride = 1 voice.
- Ambience: exactly ≤ 2 owned looping sources, outside the voice cap,
  created once, ramped (no clicks), stopped + disconnected on `dispose()`.
- No `AudioContext`, voice, or loop starts before `resume()` (gesture);
  every method headless-safe (null-context no-op).
- No per-frame allocation: no update path; `step()` per stride event,
  `setEnvironment()` per weather change, automation ramps only.
- Master/effects volume semantics unchanged; `AudioStats` shape unchanged.

## Source / license / provenance decision

- **Kenney Impact Sounds verified, NOT vendored.** Checked 2026-09-19:
  `https://kenney.nl/assets/impact-sounds` states License:
  Creative Commons CC0, 130 files, v1.0 (2019), official download
  `https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip`.
  Declined for this lane: a 130-asset pack violates the no-giant-packs
  rule for 8 narrow needs; external bytes would break the bit-for-bit
  deterministic manifest; 25-minute budget left no room for careful
  per-file audition/selection. Revisit only as a curated 2–3-file
  extraction with hashes + license file, never a full-pack vendor.
- **Everything shipped is authored synthesis** (`render-bank.mjs`, seeded
  `mulberry32`, recipe table above). No external samples, no downloads.
  Not claimed as recorded sound anywhere. Manifest records per-file
  sha256/seed/duration; re-renders reproduce bit-for-bit (proven below).

## Checks run (CPU only, no browser/GPU per instructions)

- `node src/audio/render-bank.mjs` — 21 files, 1174.0 KiB. PASS
- `node src/audio/check-bank.mjs` — all file/budget/contract/loop gates
  pass, including the 8 new service-contract assertions. PASS
- Determinism: two consecutive renders → all 21 sha256 identical. PASS
- Falsification: injected full-scale seam click fails the loop gate
  (seam 1.8 vs allowance 0.77) — the relative gate still catches real
  clicks, not just texture. PASS
- `npm run check` (`tsc --noEmit` + render-site allow-list). Clean.
- During development the wind loop-seam gate caught a marginal wrap
  (0.0604 vs 0.06); fixed in the mix (softer airy top), not the gate.
  The absolute-bound form then false-failed on HF texture slew, so the
  gate was recalibrated same-session to seam-vs-texture (floor 0.06 kept;
  no passing baseline existed to weaken).

## Route attribution

OMP direct lane, no child agents. Model: Meta Muse Spark 1.3 contributor.
AKP: pull-only sync clean; adoption `check` PASS (OMP@dave-gaming-pc,
trusted, digest `bb4a1bf5…44e`); `audit` roll-up RED on Hermes rows only
(stale hashes + expired receipt — not this lane, not borrowed).
Power plan verified High performance. Uncommitted; root review pending.

## Residuals / honest gaps

- **Perceptual audition OPEN.** WAV specs only — root must listen in-game
  (playcap path with audio) and judge footfall separation, bed levels
  (0.14/0.12 ceilings are starting points), and stride timing.
- No browser/GPU run in this lane: no `playcap`/`capture`/`soak`; no heap
  measurement (bounded by design: ≤ 16 transient sources + 21 decoded
  buffers ≈ 3.5 MB + 2 loop sources).
- `src/weapons/controller.ts` shows a working-tree modification from
  another lane — untouched here; root owns the merge.
- `docs/audio-refinement.md` (v2 doc) intentionally not edited; this file
  is the v3 record.
- `setVisible(false)` still does not suspend the context (v2 gap, kept).
