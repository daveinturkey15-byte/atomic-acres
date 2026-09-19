# Audio lifecycle proof

Run from the recovery worktree:

```text
node scripts/_verify-audio-lifecycle.mjs
```

The script starts an isolated local fixture and drives it in a stock installed
Chrome session through the repository's `scripts/lib/stock-browser.mjs` helper.
It dynamically bundles `src/audio/service.ts` with esbuild, serves a tiny HTML
fixture, and uses the browser's real WebAudio decoder. The fixture returns one
valid PCM WAV for each requested URL, so the service's own 21-entry bank load is
exercised without copying game code into the proof. The verdict is written to
`captures/audio-lifecycle/result.json`.

The proof uses trusted browser input for the unlock button, environment select,
volume sliders, burst button, repeated-weather button, and dispose/recreate and
late-decode buttons. Assertions read live service state and instrument the
browser nodes only to count contexts, starts, decodes, and target automation;
they do not inspect service source text.

Acceptance checks:

- cues, `preload()`, and weather requests before the unlock click leave the
  context absent and voices at zero;
- the unlock click creates one context and decodes 21 buffers;
- master/effects sliders reach the actual graph gains (`0.36` and `0.35` for
  slider values `0.60` and `0.35`);
- weather owns at most two loop sources, and repeating an identical request adds
  zero `setTargetAtTime` calls;
- a 32-cue burst never exceeds the 16-voice cap and decays back to zero;
- dispose/recreate restores the configured gains and bounded loop count;
- fetch/decode completions released after dispose leave buffers, loops, and
  voices at zero;
- the browser reports no page errors or console errors.

The 2026-09-19 run passed all checks in 2.3 seconds against the current dirty
service source. This proof is a lifecycle gate for the service and does not
claim that the full Nuketown candidate has passed its separate visual/GPU gates.
