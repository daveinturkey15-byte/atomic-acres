/**
 * Integration pin for `supply-crate-visual` against the REAL crate lane
 * vocabulary. Compile-time only, emits nothing at runtime.
 *
 * If `game/events-crate.ts`, `game/events.ts` or the runtime's
 * `streak-ended` shape drift from the structural mirrors the visual narrows
 * on, this file stops compiling AT the integration site — the drift can
 * never silently reach the draw path.
 */
import type { CrateLandedEvent, CrateOpenedEvent } from '../game/events-crate';
import type { GameEvent, StreakEndedEvent } from '../game/events';
import type { SupplyCrateVisual } from './supply-crate-visual';
import type {
  CrateLandedShape,
  CrateOpenedShape,
  CrateEndedShape,
} from './supply-crate-visual';

/** True iff Real carries every field the visual's structural mirror needs. */
type RealFitsMirror<Real, Mirror> = [Real] extends [Mirror] ? true : false;

/** Feed target: the admitted event union must be accepted by `apply()`. */
type GameEventFeedsVisual = readonly GameEvent[] extends Parameters<
  SupplyCrateVisual['apply']
>[0]
  ? true
  : false;

type CrateVisualMirrorsHold = [
  RealFitsMirror<CrateLandedEvent, CrateLandedShape>,
  RealFitsMirror<CrateOpenedEvent, CrateOpenedShape>,
  RealFitsMirror<StreakEndedEvent, CrateEndedShape>,
  GameEventFeedsVisual,
];

const crateVisualMirrorsHold: CrateVisualMirrorsHold = [
  true, true, true, true,
];
void crateVisualMirrorsHold;
