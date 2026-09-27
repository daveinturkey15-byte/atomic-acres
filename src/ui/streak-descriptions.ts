/** Describes the restart's implemented effects; reference behavior is not implied. */
import type { StreakId } from '../game/killstreaks/catalog';

export const STREAK_DESCRIPTIONS: Readonly<Record<StreakId, string>> = Object.freeze({
  'recon-sweep': 'Reveals enemy positions on your minimap while the sweep is active.',
  'signal-jam': 'Disrupts enemy reconnaissance while the signal jammer is active.',
  'tracker-dart': 'Places a tracking dart at your position to reveal nearby enemies.',
  'sentry-post': 'Deploys an automatic sentry at your position to engage visible enemies.',
  'supply-crate': 'Drops a supply crate at your position. Capture it for a reward; extra rewards use key 8.',
  'fallout-screen': 'Places a temporary information-denial screen at your position.',
  'blast-mortar': 'Calls a telegraphed mortar barrage at your position. Move away before impact.',
  'strike-relay': 'Sends three bursts along the direction you are facing.',
  adrenaline: 'Boosts your movement speed by 25% for 15 seconds.',
  yardhawk: 'Launches an autonomous aircraft that seeks an enemy.',
  'piloted-drone': 'Takes control of an armed drone. Use movement keys, aim and fire; Escape returns to your body.',
  'carpet-bomber': 'Bombs a corridor centered on your position and aligned with your facing.',
  'hunter-swarm': 'Sends three autonomous drones to engage enemies.',
  chopper: 'Calls an autonomous helicopter to provide fire support.',
  'drone-swarm': 'Deploys five autonomous drones for sustained support.',
  'last-resort': 'Strikes all living enemies across the map when activated.',
  'crimson-flamethrower': 'A supply-crate reward that temporarily equips the Crimson Flamethrower.',
  'field-repair': 'A supply-crate reward that restores up to 35 health.',
});

export function streakDescription(id: string): string {
  return (STREAK_DESCRIPTIONS as Readonly<Record<string, string>>)[id] ?? '';
}
