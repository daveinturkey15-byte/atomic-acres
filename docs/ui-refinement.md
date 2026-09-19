# UI lane — live graphics/environment settings (2026-09-19)

Owned files only: `src/ui/settings.ts`, `src/ui/bindings.ts`,
`src/ui/settings-apply.ts`, `src/ui/settings-panel.ts`, this doc.
No edit to `main.ts`, materials, atmosphere, post, controller, player, game logic.

## What is live now

| Option | Consumer | Probe |
|---|---|---|
| `ao` / `ssr` / `bloom` | `world.post.setEffects` (uniform(1) writes, no node/material/light moves) | `post.getEffects()` + `postEnabled`; ACTIVE means `enabled && on` |
| `fog` | `world.post.setFog` (same caveat) | `post.getFog()` + `postEnabled` |
| `tod` / `weather` | `world.atmosphere.set` / `setWeather`, else `post.setAtmosphere` (preset switches into the SAME three lights/dome/env/rain; set never changes) | `atmosphere.tod()` / `weather()` |
| `quality`, `shadowMapSize`, `resolutionScale`, `fov`, controls, `netOverlay`, `reducedMotion`, `damageFlashScale` | unchanged | unchanged |
| `masterVolume` / `effectsVolume` | NOBODY in this build — persist only | n/a |
| `weaponMotionScale` | NOBODY YET (weapons lane) — persist only | n/a |

`OPTION_STATUS`: `ao`/`ssr`/`bloom` are `persist` → `live`; new `fog`/`tod`/`weather`
are `live`. Audio stays `persist`. `main.ts` already passes the whole `World`
(which owns `post` + `atmosphere`), so no wiring change outside this lane.

## Defaults — visual baseline retained

`fog: true`, `tod: 'noon'`, `weather: 'clear'`; presets untouched
(`high` = ao/ssr/bloom on, shadow 4096, resolution 1; `fov` 72).
Fog/tod/weather are independent of the quality preset;
`qualityOf`/`presetPatch` still cover only the four knobs.

## Query precedence (capture contract)

An explicit `?tod=` / `?weather=` in the page URL overrides the persisted value
on the FIRST `loadSettings()` of the page load only (`settings.ts:queryEnvironment`).
The world is built from the same query before the menu loads, so captures pin a
state. A later user adjustment writes storage and sticks — the override is
one-shot, never re-applied, never written back. Unknown values fall through to
the persisted one. `resetSettings()` stays pure defaults.

## Interface notes for root / other lanes

- `MenuPost` / `MenuAtmosphere` in `settings-apply.ts` are structural mirrors of
  `core/post.ts:PostChain` and `core/atmosphere.ts:Atmosphere` (preset names
  imported from `core/atmosphere.ts`: `TOD_NAMES`, `WEATHER_NAMES`).
- Audio (offered, not consumed): `ApplyTargets.audio?: MenuAudio` with
  `setVolumes?(master: number, effects: number): void`. Desired integration for
  the audio lane: read `settings.masterVolume` / `settings.effectsVolume`
  (0..1) at startup and on every change through exactly
  `audio.setVolumes(master, effects)`. Panel sliders persist until that lands.
- Environment apply calls `atmosphere.set` and `setWeather` as two separate
  switches on purpose: the post fallback's `setAtmosphere` chains them with
  `&&`, which would drop the weather write whenever tod is unknown.

## Knife repair (label mismatch)

Runtime (`main.ts:233`) forwards `KeyV` to the weapons controller on foot only;
`KeyF` is `core/player.ts`'s fly toggle. The table said `KeyF`.
Fix: default `knife` is now `KeyV`, consumer
`main.ts keydown (walk only) -> weapons.controller`; a stored `KeyF` knife
migrates to `KeyV` in `sanitizeBindings` (it never knifed — it toggled fly).
Gameplay files untouched.

## Verification (this lane)

- `npx tsc --noEmit` — clean.
- `npm run check` — clean (`tsc` + render-site allow-list OK).
- Browser-free focused check (compiled `settings`/`bindings` with the
  `core/atmosphere` import stubbed to its preset tables; temp dir removed
  after): 19 assertions passed — baseline defaults, tod/weather/fog validation
  incl. unknown rejection, knife default `KeyV`, `KeyF`→`KeyV` migration with
  other keys kept, one-shot `?tod=dusk&weather=rain` override on first load
  with the persisted store left untouched and the second load returning
  persisted values.
- NOT run per lane: build, browsers/GPU (`playcap`/`capture`/`soak`),
  commits. No frozen tests touched.

## OPEN residuals

- Audio bus + `weaponMotionScale` reader belong to their lanes (signatures above).
- `KeyF`/`KeyE`/`KeyQ` remain fly keys in `core/player.ts`: binding knife to
  `KeyF` will both fly-toggle and knife. The panel only flags intra-table
  collisions; reserve-note is in the consumer string, not enforced.
- `?post=` diagnostics (`ao`/`off`/`fog`/`smoke`) are display-only views and are
  unaffected by these toggles.
- Bootstrap: OMP on dave-gaming-pc re-attested natively 2026-09-19
  (`check` PASS trusted); other harnesses' audit rows untouched.
