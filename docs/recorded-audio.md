# Recorded audio canary — 2026-09-19 (standalone Nuketown)

Game-ready recorded gunshot canary for the 5 fictional families. New files only:
`scripts/audio/import-recorded.py`, runtime files under `public/audio-recorded/`,
and the audition-only concat under `docs/audio-auditions/recorded-guns.wav`. Nothing in
`src/audio/`, `public/audio/`, or any existing bank file was touched; root wires
integration after inspecting these outputs.

## Source attribution (exact)

- Library: **The Free Firearm Sound Library**, CC0 1.0 Universal, no rights reserved.
- Recorded/created by **Ben Jaszczak, Brian Nelson, Kevin Heras, Matthew Nanney**.
- Source page (license + author statement, read 2026-09-19):
  https://opengameart.org/content/the-free-firearm-sound-library
- Archive (single download into `work/recorded-source/`):
  https://opengameart.org/sites/default/files/Prepared%20SFX%20Library.7z
- Archive SHA256: `cc1ab5a99a0a365105c7c5dd783f4b0b1fe90938114d3ceec53856bfe005f7d6`
  (193,954,738 bytes). License evidence: page states CC0 + "created and recorded
  by" the four authors above; `Prepared Master Sheet.csv` (extracted alongside)
  describes all 57 shot/burst members.
- Only 5 members + the CSV were extracted (explicit names, traversal-guarded);
  the 194 MB archive is otherwise unopened. No commercial game rips, no other
  sources. Fallback source was not needed (primary downloaded fine).

## Family mapping (all mid-distance single shots, consistent mic perspective)

| family | real weapon | source member | onset | window |
|---|---|---|---|---|
| longhorn rifle | Winchester Model 1894 lever .32WS | `Prepared SFX Library/Model 1894/L_17P.wav` | 0.596 s | 1.10 s |
| rattler SMG | Carl Gustav M45 9mm | `Prepared SFX Library/Carl Gustav M45/G_20P.wav` | 0.348 s | 1.00 s |
| coachman shotgun | Winchester Model 12 pump 12ga | `Prepared SFX Library/Model 12/K_17P.wav` | 0.907 s | 1.20 s |
| deadeye bolt/sniper | Mosin Nagant 7.62x54R | `Prepared SFX Library/Mosin Nagant/M_26P.wav` | 1.138 s | 1.20 s |
| duster pistol | M1911 .45 | `Prepared SFX Library/1911/A_34P.wav` | 1.542 s | 1.20 s |

Mid-distance (forward/back pair) chosen over near-distance (left/right pair):
same single-shot content, less hot transient, more room body. Bursts deliberately
avoided (game triggers one shot per pull; slicing bursts would fake single shots).

## Transformation (`scripts/audio/import-recorded.py`, deterministic, re-run verified bit-identical)

1. ffmpeg decode to f32 stereo @ native 96 kHz (no ffmpeg mixing).
2. Explicit mono `(L+R)/2` in numpy.
3. Trim: 50 ms pre-roll before measured onset + fixed window (table above).
   Removes 0.3–1.5 s of lead silence; keeps transient, body, and tail.
4. SoXR resample 96 kHz → 44.1 kHz (ffmpeg, 2 threads max).
5. 2nd-order Butterworth highpass 60 Hz, Q 0.7071 (biquad, float64 state).
6. 2 ms raised-cosine attack ramp (prevents new clicks) + 20 ms raised-cosine tail fade.
7. Peak-normalize to −1 dBFS. Level only — see OPEN-CLIP.
8. Write 44.1 kHz mono PCM16 WAV (minimal header, `wave` module).

## Measured results (`public/audio-recorded/manifest.json`)

| file | dur | peak | RMS | DC | sha12 |
|---|---|---|---|---|---|
| rec-shot-longhorn.wav | 1.10 s | −1.00 | −27.2 | −1.7e−08 | (see manifest) |
| rec-shot-rattler.wav | 1.00 s | −1.00 | −31.0 | −4.2e−08 | (see manifest) |
| rec-shot-coachman.wav | 1.20 s | −1.00 | −29.0 | 5.6e−08 | (see manifest) |
| rec-shot-deadeye.wav | 1.20 s | −1.00 | −28.4 | 7.2e−08 | (see manifest) |
| rec-shot-duster.wav | 1.20 s | −1.00 | −25.0 | 4.8e−07 | (see manifest) |
| `docs/audio-auditions/recorded-guns.wav` | 7.10 s | −1.0 | −28.6 | — | (see manifest) |

Budgets: every shot ≤ 1.2 s ✓, peak ≤ −1 dBFS ✓ (ffprobe volumedetect confirms
−1.0 dB max on all six files), total 1,129,224 B ≤ 4 MB ✓. All files verified
44.1 kHz mono PCM16; every manifest hash re-checked against bytes on disk.

Audition concat `docs/audio-auditions/recorded-guns.wav` (not a game asset, no autoplay): shots in
order with 0.35 s gaps — longhorn 0.0–1.1, rattler 1.45–2.45, coachman 2.8–4.0,
deadeye 4.35–5.55, duster 5.9–7.1. Author did not audition by ear beyond measured
metrics; root listens before wiring.

## OPEN items (reported, not papered over)

- **OPEN-CLIP — source transients are recorded hot.** Per-channel peaks hit exactly
  0 dBFS with flat-top runs at 96 kHz: longhorn 458/308 sat (max run 76/50),
  rattler 388/263 (54/42), coachman 308/176 (67/41), deadeye 1014/492 (115/49),
  duster 149/486 (45/46) samples L/R. ~0.5–1.2 ms of the initial crack is
  saturated at the recorder. The 2 ms attack ramp + normalize add no new
  clipping, but normalization does not repair recorded flat-topping, and no
  declipping was attempted (would invent transient data). Body and tail are
  unaffected. If the crack sounds harsh in-game, prefer a shorter window or a
  different take — do not just turn it down and call it fixed.
- **OPEN-RELOAD — no recorded reload cues shipped.** The Prepared library's master
  sheet lists 57 files, all gunshots/bursts, zero mechanical-only files. Tails
  contain faint action noise but nothing isolable as a clean cue; nothing was
  fabricated from them. Synthesized `cue-reload-*` in `public/audio/` remains the
  only reload source until a foley library (e.g. a CC0 mechanical set) is licensed.

## Reproduce / verify

```
python scripts/audio/import-recorded.py   # rebuilds runtime files + docs/audio-auditions/recorded-guns.wav, asserts budgets
```

## For root integration (not done here)

Candidate drop-ins: `public/audio-recorded/rec-shot-<family>.wav` ↔ existing
`public/audio/shot-<family>.wav` names. No service/controller changes made here;
levels (−1 dBFS peak, RMS −25…−31) match the synthesized bank's nominal range,
but in-game A/B level trim is root's call after listening.

## Root integration evidence, September 19

VERIFIED: root independently re-read all five runtime WAVs: manifest hashes,
byte sizes, mono PCM16/44.1 kHz, durations and peak/RMS measurements match.
The service now requests these five recordings first and falls back per file
to the authored WAV. It retains 21 decoded buffers total, with no parallel
shot layers. A disposed load cannot issue fallback requests or repopulate it.
The stock Chrome lifecycle fixture passes all 11 checks, including recorded
selection, five deliberate missing-file fallbacks, volume controls, voice cap,
weather-loop bounds and delayed decode after disposal.

OPEN: source clipping and perceptual mix acceptance remain unresolved. The
fixture proves lifecycle behavior with a tiny valid WAV, not the quality of
these recordings. Real-game file decoding and playback are checked separately
after the candidate is rebuilt. No claim of ear audition is made.
