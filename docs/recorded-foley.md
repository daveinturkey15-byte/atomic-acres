# Recorded foley import — 2026-09-19 (standalone Nuketown)

Modern recorded footfalls + reload mechanics for the NEW standalone game.
New files only: `scripts/audio/import-foley.py`, runtime files under
`public/audio-foley/`, the audition-only concat under
`docs/audio-auditions/recorded-foley.wav`, and this doc. Runtime WAVs in
`public/audio/`, `public/audio-recorded/`, and `public/audio-foley/` remain
unchanged; only the two manifest audition paths and these reproducibility paths
were updated. Root integrates after listening. No commits made here.

## Source attribution (exact, page-verified today)

- Footsteps: **Fantozzi** (recordist), submitted/sliced by **qubodup**, CC0 1.0.
  - Page: https://opengameart.org/content/fantozzis-footsteps-grasssand-stone
  - Archive: https://opengameart.org/sites/default/files/Fantozzi-footsteps.7z
  - Archive SHA256 `415d360e0911c1c1c5355ee94023b772e6f4044f59b9b580610e7dbffd1840fd`
    (476,363 bytes). Twelve single steps, 16-bit 44100 Hz FLAC (+ OGG copies,
    never touched). Only the six FLAC members below are read.
- Reloads: **SpringySpringo**, recorded airsoft mechanisms, CC0 1.0.
  - Page: https://opengameart.org/content/gun-reload-sounds
  - `gunreload1.wav` (https://opengameart.org/sites/default/files/gunreload1.wav,
    278,572 B, SHA256 `685cac6a184e3cc3ec09a25b6ddb1d6feffd86d469778f339aa423d384035c50`)
  - `assaultriflereload1_0.wav` (https://opengameart.org/sites/default/files/assaultriflereload1_0.wav,
    274,476 B, SHA256 `efb2d724d634eabe6ba8d3065686abca848bb7497d4d43a5e4aed5e5ea23016f`)
  - `shotguncock_0.wav` (https://opengameart.org/sites/default/files/shotguncock_0.wav,
    83,628 B, SHA256 `33e007321ba83301c861aef573f2c40b70bc62f8f24c0164877e6dd123e24371`)
    — retained under `work/foley-source/`, inspected, NOT shipped (reason below).
- License: CC0 1.0 Universal, http://creativecommons.org/publicdomain/zero/1.0/

## Surface mapping (honest — pack has no gravel, no grass)

The Fantozzi pack contains 6× Sand + 6× Stone and nothing else. Mapping:

| game surface | source | basis |
|---|---|---|
| hard-a/b | `Fantozzi-StoneL1/R1.flac` | page: "Stone could be most hard surfaces" |
| grass-a/b | `Fantozzi-SandL1/R1.flac` | page: "Sand sounds like grass too" |
| gravel-a/b | `Fantozzi-StoneL2/R2.flac` | **APPROXIMATION ONLY — no gravel recording exists in this pack** |

Gravel outputs are distinct Stone takes from hard's (L2/R2 vs L1/R1), so no
sample is reused, but they are stone, not gravel. Filenames say `gravel` for
drop-in compatibility; manifest `surface_mapping.gravel` and per-file `role`
label the approximation. A separately verified CC0 gravel recording was not
fetched in this pass (25-minute cap); that is the clean fix if root wants true
gravel.

## Reload cues (waveform slices, no hearing claim)

| cue | source region | trim_start | window |
|---|---|---|---|
| rec-reload-start | gunreload1.wav early mechanism cluster | 0.065354 s (onset 0.070385 − 5 ms) | 0.600 s |
| rec-reload-end | assaultriflereload1_0.wav late double-hit | 1.040227 s (onset 1.045249 − 5 ms, searched from 0.90 s) | 0.516 s (to EOF, capped 0.65 s) |

Start = release-side mechanics, end = seat/bolt-side double-hit. Regions chosen
from 50 ms envelope peaks (start cluster 0.10–0.25 s pk 0.60; end hits
1.04–1.05 pk 0.86 and 1.20–1.30 pk 1.00), not from listening. `shotguncock_0.wav`
(0.474 s, single merged cock, DC −0.0151, 375/383 full-scale hits L/R) was left
out: the two shipped cues already give distinct start/end mechanics without
declipping invented data.

## Transformation (`scripts/audio/import-foley.py`, deterministic, re-run verified bit-identical)

1. ffmpeg decode to f32 stereo @ native 44.1 kHz (no ffmpeg mixing, 2 threads).
2. Explicit mono `(L+R)/2` in float64.
3. Trim per table above (onset = first |x| ≥ 0.02 from anchor, minus 5 ms).
4. No resample (all sources native 44.1 kHz, asserted via ffprobe).
5. 2nd-order Butterworth highpass 80 Hz, Q 0.7071 (biquad, float64 state).
6. 2 ms raised-cosine attack + 20 ms raised-cosine tail fade.
7. Peak-normalize to −3 dBFS steps / −2 dBFS mechanisms. Level only.

No compression, no denoise, no declipping.

## Measured results (`public/audio-foley/manifest.json`)

| file | dur | peak | RMS | DC | bytes |
|---|---|---|---|---|---|
| rec-step-hard-a | 0.373 s | −3.00 | −23.4 | 5.1e−07 | 32,934 |
| rec-step-hard-b | 0.357 s | −3.00 | −24.2 | 2.4e−07 | 31,502 |
| rec-step-grass-a | 0.443 s | −3.00 | −27.5 | 1.4e−07 | 39,076 |
| rec-step-grass-b | 0.402 s | −3.00 | −28.7 | 1.9e−07 | 35,530 |
| rec-step-gravel-a | 0.332 s | −3.00 | −22.7 | 3.2e−07 | 29,294 |
| rec-step-gravel-b | 0.317 s | −3.00 | −21.7 | 1.8e−06 | 28,022 |
| rec-reload-start | 0.600 s | −2.00 | −28.9 | 2.3e−07 | 52,964 |
| rec-reload-end | 0.516 s | −2.00 | −22.1 | 5.2e−07 | 45,514 |
| `docs/audio-auditions/recorded-foley.wav` | 5.089 s | −2.0 | −26.2 | — | 448,878 |

Budgets: every step ≤ 0.6 s ✓, every cue ≤ 0.7 s ✓, peaks exactly −3.0/−2.0
(ffprobe volumedetect confirms) ✓, runtime bank 294,836 B ≤ 1.5 MB ✓,
audition 448,878 B ≤ 1 MB ✓. All files verified 44.1 kHz mono PCM16; every
manifest hash re-checked against bytes on disk.

Audition concat (not a game asset, 0.25 s gaps): hard-a 0.0–0.373, hard-b
0.623–0.980, grass-a 1.230–1.672, grass-b 1.922–2.324, gravel-a 2.574–2.906,
gravel-b 3.156–3.473, reload-start 3.723–4.323, reload-end 4.573–5.089.

## Source clipping / metadata (honest)

- Footstep FLACs: all stereo 44100 Hz, peaks −0.01…−0.63 dBFS (max sample
  0.9987–0.9990), **zero** samples at full scale L/R in any of the 12 members —
  hot but no flat-topping at the 0.999969 threshold. ffprobe confirms
  `pcm_s16le`-equivalent FLAC 16-bit stereo 44.1 kHz.
- gunreload1.wav (stereo 44.1 kHz 16-bit, 1.579 s): 250/229 full-scale hits L/R
  full-file — these live in the late crack at 1.25–1.30 s, **outside** the
  shipped start window (0.065–0.665 s). Shipped slice keeps the early cluster
  honestly; the crack is not smuggled in. Source DC −0.0038 (mono mean).
- assaultriflereload1_0.wav (1.556 s): 20/22 full-scale hits L/R — these ARE the
  shipped end-crack (1.25 s hit), preserved and normalized to −2 dBFS, not
  repaired. No declipping attempted.
- Processed outputs: HP filter kills source DC (all shipped DC ~1e−07…1e−06);
  post-normalize peaks sit exactly on target with zero clipped output samples.

## OPEN items (reported, not papered over)

- **OPEN-EAR — no audition by ear.** All quality claims are waveform metrics
  only. Root listens before wiring; if the start cue's 0.35 s tail silence reads
  as a gap, shorten its window rather than gating it.
- **OPEN-GRAVEL — gravel is stone, not gravel.** See mapping table. True CC0
  gravel needs a separately verified recording.
- **OPEN-RELOAD-DC — shotguncock excluded for DC + merged transient,** not
  shipped. If root prefers its single-cock shape, it needs DC correction review
  first (its −0.0151 offset is two orders above the shipped cues' post-HP floor).

## Reproduce / verify

```
python scripts/audio/import-foley.py   # rebuilds runtime files + docs/audio-auditions/recorded-foley.wav, asserts budgets
```

## For root integration (not done here)

Candidate drop-ins: `public/audio-foley/rec-step-<surf>-<a|b>.wav` ↔ existing
`public/audio/step-<surf>-<a|b>.wav` names; `public/audio-foley/rec-reload-start|end.wav`
↔ existing `public/audio/cue-reload-start|end.wav`. No service/controller changes
made here. Steps sit at −3 dBFS / mechs at −2 dBFS peak; in-game A/B trim is
root's call after listening. Do NOT wire gravel outputs as true gravel without
reading OPEN-GRAVEL above.
