# Floating combat text — combat-feedback lane (2026-09-19)

Owner: GLM 5.3 Flash via OMP, lane `nuketown-combat-feedback-20260919`, rebuild of the
old-project damage/critical feedback per task `J0138f85`. Status: **implemented and
CPU-proven; integration recipe below is PROPOSED, not applied.** No balance numbers were
changed. No commits; the root integrator reviews, wires and promotes.

## What was read (first pass)

- `docs/IMPORT-PLAN.md` §1.2/§1.4/§5 — damage-resolution numbers, feed routing, the
  `applyDamage` warning, the ports-and-leaves discipline.
- `docs/handoff/CURRENT.json` — checkpoint G, `recovery/wave7-20260919`; root owns
  promotion; this lane wrote no other runtime file.
- `src/game/events.ts` — `DamageEvent` exact shape: `at, attackerId (null = world),
  attackerTeam, victimId, victimTeam, amount (admitted, ≥1), cause, zone ('head'|'body'|
  'limb'), weaponId, distance, healthAfter (fatal ≤0), sourceX, sourceZ (ATTACK ORIGIN,
  the damage-arc field)`. Presentation reaches events through the drivers' event fan-out
  into `GameClient.applyEvent`; there is no public bus.
- `src/game/damage.ts`, `src/weapons/catalog.ts` — the authored band (table below).
- `src/game/client.ts` — `onDamage` already projects hitmarkers (`ClientEdge.hit`) and
  damage-taken (`hurt`); attacker-side floating numbers did not exist. Untouched.
- `src/game/session.ts`, `session-solo.ts`, `session-types.ts` — `MatchUi` is the seam;
  drivers deliver `GameEvent[]` to the client on every match (re)build.
- `src/game/host-shot.ts` — one target resolved per admitted shot: one admitted
  `DamageEvent` per resolved hit application. Full-tuple duplicate rejection is
  therefore safe (a repeated tuple is a double delivery, not a second bullet).
- `src/ui/hud.ts`, `ui/layout.ts`, `ui/hud.css` — `--aa-*` custom properties from `PAL`,
  transform/opacity-only motion, `#hud` children hide together in captures.

## Owned files (this lane touched nothing else)

| file | role |
|---|---|
| `src/ui/combat-feedback.ts` | pooled floating damage numbers; port-injected; runs headless |
| `src/ui/combat-feedback.css` | layer + popup styles; `--aa-*` vars; reduced motion |
| `scripts/game/verify-combat-feedback.mjs` | headless CPU proof over the REAL module |
| `docs/combat-feedback.md` | this document |

## Behaviour contract (implemented)

- **Admission** — only `DamageEvent`s with `attackerId === localActorId()`, a victim
  that is someone else, differing teams, finite `amount > 0`, finite `healthAfter`.
  Spectated, nonlocal, friendly and world (`attackerId: null`) events show nothing.
- **Duplicates** — full-tuple rejection over a bounded 128-entry FIFO memory. The epoch
  advances on `reset()` (and on a `match-phase: warmup` event, which fires on every
  freshly built match), so replayed events under a NEW match are admitted again.
- **Critical** — `zone === 'head'` renders the critical style; `healthAfter <= 0` adds
  the lethal accent. The host's zone field is the only crit read; no random chance.
- **Placement** — the number anchors at the VICTIM's world position via the injected
  projector. `sourceX/sourceZ` is the attack origin and is NEVER read. Unknown victim
  position, behind-camera or offscreen (`project` returns null) → deterministic
  crosshair-anchored marker (per-victim FNV-1a offset, ≤46 px from the anchor).
- **Bounds** — `CFB_POOL_MAX = 24` DOM nodes ever; oldest-stolen under pressure. Hits on
  one victim within `CFB_MERGE_MS = 140` merge into one accumulating number (lifetime
  refreshed); an older engagement on the same victim recycles. ONE self-stopping frame
  callback expires at `CFB_LIFETIME_MS = 900`; zero timers while idle; disposal cancels
  a pending frame.
- **A11y** — layer is `aria-hidden` + `role="presentation"` (the accessible record is
  the damage-done feed, which already exists); `prefers-reduced-motion` (media query
  AND the JS-driven `.cfb-still` class) swaps the rise for a fade in place.
- **Purity** — no gameplay state read or written beyond the event; no scene, no
  materials, no `Math.random()`; CSS durations mirror module constants.

## Root integration recipe (PROPOSED — not applied)

Three hunks. (1) and (2) are the "tiny root integration diff"; (3) is main.ts wiring.

**1. `src/game/session-types.ts` — expose the optional raw-event tap:**

```ts
import type { GameEvent } from './events'; // ActorId/TeamId already imported from here

export interface MatchUi {
  bindClient(client: GameClient | null): void;
  setNames(names: Iterable<readonly [string, string]>): void;
  /** Optional raw-event tap for presentation lanes that need the full event. */
  onEvent?(e: GameEvent): void;
}
```

**2. Drivers — call the tap beside every `client.applyEvent(e)`** (the only places a
`GameEvent` crosses from authority to presentation: the shared sink used by the solo
and host drivers, and the guest driver's equivalent in `net/match-guest.ts`):

```ts
ui.onEvent?.(e);
client.applyEvent(e);
```

This is the entire authority-side change. `onEvent` is optional, so existing `MatchUi`
consumers are unaffected, and guests get the same tap because their events flow through
the same fan-out — no second wire path, so **host and guest cannot double-count**: the
module renders only events that crossed this one seam, exactly once each.

**3. `src/main.ts` — construct, wire, own the lifecycle:**

```ts
import { createCombatFeedback, type FeedbackContainer } from './ui/combat-feedback';
import './ui/combat-feedback.css';

// Adapter: the module's container contract is narrower than HTMLElement.
const hudEl = document.getElementById('hud')!;
const cfbContainer: FeedbackContainer = {
  ownerDocument: { createElement: (tag) => hudEl.ownerDocument.createElement(tag) },
  appendChild: (el) => hudEl.appendChild(el as unknown as Node),
  removeChild: (el) => hudEl.removeChild(el as unknown as Node),
};
let cfbSink: ((e: GameEvent) => void) | null = null;
const v3 = new THREE.Vector3();
const combatFeedback = createCombatFeedback({
  subscribe: (fn) => { cfbSink = fn; return () => { cfbSink = null; }; },
  localActorId: () => (match && match.mode() !== 'idle' ? match.localId : null),
  victimPosition: (id) => {
    if (!match) return null;
    const b = match.bots().find((b) => b.id === id); // bots AND remote humans
    return b && b.alive ? { x: b.x, y: b.y, z: b.z } : null;
  },
  project: (x, y, z) => {
    v3.set(x, y, z).applyMatrix4(world.camera.matrixWorldInverse);
    if (v3.z > -world.camera.near) return null; // at/behind the camera
    v3.applyMatrix4(world.camera.projectionMatrix); // NDC (w-divide included)
    const sx = (v3.x * 0.5 + 0.5) * innerWidth;
    const sy = (-v3.y * 0.5 + 0.5) * innerHeight;
    const m = 32;
    if (sx < -m || sy < -m || sx > innerWidth + m || sy > innerHeight + m) return null;
    return { x: sx, y: sy };
  },
  anchor: () => ({ x: innerWidth / 2, y: innerHeight / 2 }),
  now: () => performance.now(),
  schedule: (cb) => {
    const id = requestAnimationFrame(() => cb());
    return () => cancelAnimationFrame(id);
  },
  reducedMotion: () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  container: cfbContainer,
});
addEventListener('pagehide', () => combatFeedback.dispose(), { once: true });
```

and one line on the existing `matchUi` literal:

```ts
const matchUi: MatchUi = {
  bindClient: (c) => { /* unchanged */ },
  setNames: (n) => ui.setNames(n),
  onEvent: (e) => cfbSink?.(e),
};
```

**No-double-count rules the recipe guarantees:**

- The local PREDICTED path (`WeaponsController.fire()` → `hud.lastDamage`, tracer,
  impact decals) never constructs a `DamageEvent`; only the host's admitted event
  renders text. Predicted feedback and confirmed text are different channels.
- The host broadcasts and renders the SAME single admitted event object — one render.
- `GameClient.onDamage`'s `hit` edge (crosshair hitmarker) is a separate presentation
  channel the module never reads; both fire once per admitted event, by design.
- Duplicate delivery (wire replay, double-wired listener) is absorbed by the module's
  full-tuple memory; a new match's `warmup` event advances the epoch so the memory
  starts clean. Explicit `combatFeedback.reset()` may also be called at match build.
- Spectating (`localActorId() → null`) suppresses everything, so an observer never
  renders a fight as if it were their own hits.

## Per-weapon tuning audit (READ-ONLY — balance unchanged)

Weapon rows from `src/weapons/catalog.ts`; multipliers and shared band from
`src/game/damage.ts`. Reference: `docs/IMPORT-PLAN.md` §1.2 (old-project numbers).

| weapon | base→fall dmg | near→far (m) | pellets | head × | limb × | scoped (adsFov ≤ 40) |
|---|---|---|---|---|---|---|
| Longhorn | 34→18 | 20→45 | 1 | 1.5 | 1.0 | no (55°) |
| Rattler | 25→12 | 12→30 | 1 | 1.5 | 1.0 | no (58°) |
| Coachman | 12→4 | 6→16 | 8 | 1.5 | 1.0 | no (60°) |
| Deadeye | 150→90 | 40→80 | 1 | **3.0** | 1.0 | **yes (24°)** |
| Duster | 30→15 | 15→35 | 1 | 1.5 | 1.0 | no (58°) |

Shared band audit vs reference: `HEADSHOT_MULTIPLIER 1.5` = old
`HEADSHOT_DAMAGE_MULTIPLIER` ✓ · `SNIPER_HEADSHOT_MULTIPLIER 3` = old ✓, applied via
`isScoped()` (`adsFov ≤ SNIPER_OPTIC_FOV_MAX 40`) so only the Deadeye earns it ✓ ·
`LIMB_MULTIPLIER 1.0` (old: limbs took full damage this era) ✓ · `MIN_LANDED_DAMAGE 1`
floor = old `admittedPlayerDamage` ✓ · `BOT_DAMAGE_MULTIPLIER 0.25` ✓ · melee 100 dmg /
1.75 m / 650 ms ✓ · grenade 230 max / 16 m ✓ · fall 9.5→22 m/s, ×0.5, ^1.35 ✓ · falloff
is one linear curve, `damageAt()` — no second damage table exists ✓.

Verdict: **every row is consistent with the IMPORT-PLAN reference band.** The catalog's
own header declares the numbers "BO2-arcade flavoured, not a port", which the plan
explicitly permits. Nothing was tuned here.

Open (not verified in this lane, no behaviour risk to presentation): the catalog
comment says Coachman damage is per pellet (8 × 12 = 96 close-range potential) while
`host-shot.ts` resolves one target per admitted shot; how many pellets a `ShotMsg`
carries is a host.ts-body question. Floating text displays the admitted `amount`
whatever the aggregation, so this lane is unaffected either way. `limb` exists in
`HitZone` with ×1.0, so limb hits render identically to body — down-weighting it is a
balance request, not feedback work.

## Verification (2026-09-19, this worktree)

- `node scripts/game/verify-combat-feedback.mjs` → **PASS, 13 scenario groups, exit 0**
  over the REAL module (Node 24 erasable-TS; no browser/server/GPU): admission filters;
  victim-placement with attack-origin never projected; body/head/lethal styling; merge
  accumulation + same-victim recycling; pool cap under 40-event spam + expiry +
  node return; offscreen/unknown-victim deterministic anchoring; duplicate rejection;
  epoch re-admission; warmup auto-reset (ended kept); dispose (unsubscribe, detach only
  its own layer, inert, idempotent); pending-frame cancellation on dispose; idle
  silence; reduced-motion path.
- `npm run check` → **PASS** (`tsc --noEmit` + render-site allow-list), including the
  new `src/ui/combat-feedback.ts`.
- Deliberately NOT run (task boundary): browser, `vite`, playcap/capture/soak, GPU.
  Visual confirmation against live fire is the root integrator's acceptance step — the
  recipe above is the wiring they review. Suggested acceptance: `npm run playcap` must
  stay green (the layer is inside `#hud`, so captures hide it), then a solo match at a
  bot at range: number rises at the bot, head hits read amber-critical, kills read red.
