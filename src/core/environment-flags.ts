/**
 * Environment QA Flags.
 *
 * Provides independent opt-in switchability for authored environment candidates:
 * 1. Ground PBR candidate (?ground=canary or ?ground=pbr)
 * 2. Distant Mountains candidate (?mountains=canary)
 * 3. Combined candidate mode (?env=canary or ?env=candidate)
 *
 * In the absence of flags (or ?env=baseline), baseline is retained so
 * identical-camera before/after comparisons remain available.
 */

export interface EnvironmentFlags {
  groundPbr: boolean;
  distantMountains: boolean;
  lawnCanary: boolean;
  mode: 'baseline' | 'ground-canary' | 'mountains-canary' | 'combined-canary';
}

let overrideGroundPbr: boolean | null = null;
let overrideDistantMountains: boolean | null = null;
let overrideLawnCanary: boolean | null = null;

function parseQueryFlags(): { groundPbr: boolean; distantMountains: boolean; lawnCanary: boolean } {
  if (typeof window === 'undefined' || !window.location || !window.location.search) {
    return { groundPbr: false, distantMountains: false, lawnCanary: false };
  }

  const q = new URLSearchParams(window.location.search);
  const envVal = (q.get('env') ?? q.get('candidate') ?? '').toLowerCase();
  const isCombined = envVal === 'canary' || envVal === 'candidate' || envVal === 'all';

  let ground = isCombined;
  let mountains = isCombined;

  const groundVal = (q.get('ground') ?? '').toLowerCase();
  if (groundVal === 'canary' || groundVal === 'pbr' || groundVal === 'on' || groundVal === '1') {
    ground = true;
  } else if (groundVal === 'baseline' || groundVal === 'off' || groundVal === '0') {
    ground = false;
  }

  const mtnVal = (q.get('mountains') ?? '').toLowerCase();
  if (mtnVal === 'canary' || mtnVal === 'candidate' || mtnVal === 'pbr' || mtnVal === 'on' || mtnVal === '1') {
    mountains = true;
  } else if (mtnVal === 'baseline' || mtnVal === 'off' || mtnVal === '0') {
    mountains = false;
  }

  // Lawn canary rides its own boolean, not `mode`: mode keys the ground and
  // mountains capture comparisons, and the lawn swap must never re-key them.
  let lawn = false;
  const lawnVal = (q.get('lawn') ?? '').toLowerCase();
  if (lawnVal === 'canary' || lawnVal === 'pbr' || lawnVal === 'on' || lawnVal === '1') {
    lawn = true;
  } else if (lawnVal === 'baseline' || lawnVal === 'off' || lawnVal === '0') {
    lawn = false;
  }

  return { groundPbr: ground, distantMountains: mountains, lawnCanary: lawn };
}

export function isGroundPbrEnabled(): boolean {
  if (overrideGroundPbr !== null) return overrideGroundPbr;
  const globalOverride = (globalThis as { __NT_OVERRIDE_GROUND_PBR__?: boolean }).__NT_OVERRIDE_GROUND_PBR__;
  if (typeof globalOverride === 'boolean') return globalOverride;
  return parseQueryFlags().groundPbr;
}

export function isDistantMountainsEnabled(): boolean {
  if (overrideDistantMountains !== null) return overrideDistantMountains;
  const globalOverride = (globalThis as { __NT_OVERRIDE_DISTANT_MOUNTAINS__?: boolean }).__NT_OVERRIDE_DISTANT_MOUNTAINS__;
  if (typeof globalOverride === 'boolean') return globalOverride;
  return parseQueryFlags().distantMountains;
}

export function isLawnCanaryEnabled(): boolean {
  if (overrideLawnCanary !== null) return overrideLawnCanary;
  const globalOverride = (globalThis as { __NT_OVERRIDE_LAWN_CANARY__?: boolean }).__NT_OVERRIDE_LAWN_CANARY__;
  if (typeof globalOverride === 'boolean') return globalOverride;
  return parseQueryFlags().lawnCanary;
}

export function getEnvironmentMode(): EnvironmentFlags['mode'] {
  const g = isGroundPbrEnabled();
  const m = isDistantMountainsEnabled();
  if (g && m) return 'combined-canary';
  if (g) return 'ground-canary';
  if (m) return 'mountains-canary';
  return 'baseline';
}

export function getEnvironmentFlags(): EnvironmentFlags {
  return {
    groundPbr: isGroundPbrEnabled(),
    distantMountains: isDistantMountainsEnabled(),
    lawnCanary: isLawnCanaryEnabled(),
    mode: getEnvironmentMode(),
  };
}

export function setEnvironmentFlagsOverride(
  flags: Partial<{ groundPbr: boolean | null; distantMountains: boolean | null; lawnCanary: boolean | null }>,
): void {
  if (flags.groundPbr !== undefined) overrideGroundPbr = flags.groundPbr;
  if (flags.distantMountains !== undefined) overrideDistantMountains = flags.distantMountains;
  if (flags.lawnCanary !== undefined) overrideLawnCanary = flags.lawnCanary;
}
