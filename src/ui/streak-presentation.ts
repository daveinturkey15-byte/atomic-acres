/**
 * Nuketown 2025 — streak strip presentation projection.
 *
 * The ONLY place the streak strip decides what a slot's honest state is. Pure
 * functions over the authoritative push (`StreakHudView`, host-authored via
 * `game/client.ts`), the streak catalog (lane C), and the shipped effect
 * wiring (`WIRED_STREAK_IDS`). No DOM here — `hud-match.ts` writes this onto
 * nodes built once in `hud-build.ts`; a node-side positive control exercises
 * this module headless.
 *
 * ## What the wire can and cannot say
 *
 * `StreakStateMsg` carries `kills` (eliminations this life, host-authored) and
 * per-slot `{ streakId, slot, charges }`. It does NOT carry the ledger's
 * `cycle`, an `active` flag, or a cooldown, so this projection NEVER shows an
 * active timer or cooldown — a streak that is running is announced by the
 * existing `streak-activated` banner (semantics unchanged), and the strip
 * keeps saying what the wire still proves: the charge is gone.
 *
 * Progress model, derived only from wire inputs plus catalog costs: with the
 * pushed loadout's max cost `top`, the ladder's current-cycle position is
 * `kills % top`. This equals the ledger's `cycle` in normal play; they can
 * diverge only when the bank cap (`MAX_BANKED_STREAKS = 8`) applies
 * backpressure — the ledger freezes `cycle` while `kills` keeps counting, so
 * the bar may then over-read. That case needs all eight banked charges held
 * unspent, and it can produce a full bar + SPENT where the true next unlock
 * is one kill after any spend — never a false READY. Documented in the lane
 * handoff rather than faked away.
 *
 * ## Key provenance
 *
 * `main.ts` keydown maps Digit3–Digit6 onto `match.pressStreak(slot + 1)`
 * ("3-6 are the four killstreak slots"). `ui/bindings.ts` has no streak
 * actions yet, so there is no rebind channel to read; this table mirrors
 * main.ts and MUST move with it (checked by the positive control, which
 * asserts the mapping comment's claim). Slot order on the wire is loadout
 * order, 1-based, so index i presses `STREAK_SLOT_CODES[i]`.
 */

import { SLOT_COUNT, streakById } from '../game/killstreaks/catalog';
import { WIRED_STREAK_IDS } from '../game/killstreaks/runtime';
import { codeLabel } from './bindings';

/** Four chosen slots use 3–6; the conditional crate reward uses 7. */
export const STREAK_SLOT_CODES: readonly string[] = Object.freeze([
  'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7',
]);

/** One pushed slot. `id` arrives once the ui/index.ts pushView hunk is applied; `label` is the roster name. */
export interface StreakSlotInput {
  readonly id?: string;
  readonly label?: string;
  readonly charges: number;
}

/** Honest states a card may show. No cooldown, no active-timer state exists on the wire. */
export type StreakCardState = 'ready' | 'locked' | 'spent' | 'unavailable';

export interface StreakCardProjection {
  readonly state: StreakCardState;
  readonly name: string;
  /** Cap label for the slot's key, e.g. `3`. */
  readonly key: string;
  /** Short state line: READY ×N, NEED n KILLS, NEXT CYCLE, or the honest unavailability reason. */
  readonly stateText: string;
  /** Use instruction; only a READY card can honestly give one. */
  readonly hint: string | null;
  readonly charges: number;
  /** 0..1 ladder fill, or -1 when the card shows no bar. */
  readonly progress: number;
  /** Whole-card assistive text, one sentence per fact. */
  readonly aria: string;
}

/**
 * The max catalog cost among the pushed selectable slots — the ladder's top
 * rung, which `game/killstreaks/runtime.ts` resets `cycle` at. 0 when nothing
 * pushed is a known selectable (no bar is honest there, not a zero bar).
 */
function ladderTop(slots: readonly StreakSlotInput[]): number {
  let top = 0;
  for (const s of slots.slice(0, SLOT_COUNT)) {
    if (s.id === undefined) continue;
    const def = streakById(s.id);
    if (def !== null && def.availability === 'selectable' && def.cost > top) top = def.cost;
  }
  return top;
}

/** Current-cycle ladder position derived from the wire: `kills % top` (see header for the bank-cap caveat). */
export function ladderCycle(kills: number, top: number): number {
  if (top <= 0) return 0;
  return ((kills % top) + top) % top;
}

function activationHint(activation: string, key: string): string {
  if (activation === 'possession') return 'PRESS ' + key + ' · PILOT';
  if (activation === 'target-line') return 'PRESS ' + key + ' · STRIKE AHEAD';
  if (activation === 'target-point') return 'PRESS ' + key + ' \u00b7 DEPLOYS AT YOU';
  return 'PRESS ' + key;
}

/** Projects every pushed slot onto a card view. Index order is slot order (1-based on the wire). */
export function projectStreakStrip(slots: readonly StreakSlotInput[], kills: number): readonly StreakCardProjection[] {
  const top = ladderTop(slots);
  const cycle = ladderCycle(kills, top);
  return slots.map((slot, i) => {
    const bonus = i === SLOT_COUNT;
    const key = i < STREAK_SLOT_CODES.length ? codeLabel(STREAK_SLOT_CODES[i]) : '?';
    const def = slot.id === undefined ? null : streakById(slot.id);
    const name = def?.displayName ?? (slot.label && slot.label.length > 0 ? slot.label : (slot.id ?? 'STREAK'));

    let state: StreakCardState;
    let stateText: string;
    let hint: string | null = null;
    let progress = -1;

    if (def !== null && (def.availability === 'retired' || def.availability === 'reward-only' && !bonus)) {
      // Reserved or pool-only rows cannot be pressed into a loadout honestly.
      state = 'unavailable';
      stateText = def.availability === 'reward-only' ? 'REWARD DROP ONLY' : 'RETIRED';
    } else if (def !== null && !WIRED_STREAK_IDS.includes(def.id)) {
      // Selectable in the catalog but with no live effect wired in this build:
      // the same truth the host answers with `arena-unsupported`.
      state = 'unavailable';
      stateText = 'NOT IN THIS BUILD';
    } else if (slot.charges > 0) {
      state = 'ready';
      stateText = slot.charges > 1 ? 'READY \u00d7' + slot.charges : 'READY';
      hint = def === null ? 'PRESS ' + key : activationHint(def.activation, key);
      if (bonus) stateText = 'CRATE REWARD · ' + stateText;
    } else if (def === null || def.cost <= 0) {
      // Degraded mode (no id on the push): charges alone are honest; cost is not knowable.
      state = 'locked';
      stateText = 'LOCKED';
    } else if (cycle >= def.cost) {
      // Unlocked this cycle but zero charges: spent. (Bank-cap caveat in the header.)
      state = 'spent';
      stateText = 'NEXT CYCLE';
      progress = 1;
    } else {
      const need = def.cost - cycle;
      state = 'locked';
      stateText = 'NEED ' + need + ' KILL' + (need === 1 ? '' : 'S');
      progress = cycle / def.cost;
    }

    let aria = name + '. ' + stateText + '.';
    if (hint !== null) aria += ' ' + hint + '.';
    return Object.freeze({ state, name, key, stateText, hint, charges: slot.charges, progress, aria });
  });
}

/**
 * Cache signature for `setStreak`: every input the projection reads. Progress,
 * state text and aria are pure functions of exactly these, so one string compare
 * gates every DOM write the strip can make.
 */
export function streakSig(kills: number, slots: readonly StreakSlotInput[]): string {
  let sig = String(kills);
  for (const s of slots) sig += '|' + (s.id ?? '?') + ':' + s.charges;
  return sig;
}
