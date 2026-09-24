/**
 * Weapons lane — the weapon table. One object per weapon, in one file, so
 * adding an eighth is one entry here plus one viewmodel builder. `stampede`
 * and `varmint` are long guns, so until their builders exist they ride the
 * controller's rifle-viewmodel fallback (the same fallback every unknown id
 * already gets) with the generic shot report.
 * All angles are radians. Damage is per pellet (the shotgun fires 8).
 * rpm is expressed as seconds between shots (`interval`) because that is
 * what the controller's timer consumes — rpm is in the comment.
 *
 * Numbers are BO2-arcade flavoured, not a port: fast ADS (200–280 ms),
 * short time-to-kill, hitscan, generous feedback.
 */

export interface DamageFalloff {
  /** damage inside nearRange */
  base: number;
  /** damage beyond farRange */
  fall: number;
  nearRange: number;
  farRange: number;
}

export interface SpreadParams {
  /** standing-still cone, radians */
  hip: number;
  /** fully-aimed cone, radians */
  ads: number;
  /** extra cone at full sprint, radians (scales linearly with speed) */
  move: number;
  /** cone added per shot while firing, radians */
  bloom: number;
  /** bloom ceiling, radians */
  bloomMax: number;
  /** multiplier while crouched (controller reads MoveSample.crouched) */
  crouchMult: number;
}

export interface RecoilParams {
  /** deterministic climb per shot, radians of pitch */
  pitch: number;
  /** bounded random horizontal term per shot, radians of yaw (±) */
  yawRandom: number;
  /** deterministic pattern depth: shot n climbs pitch * (1 + amp*sin) */
  patternAmp: number;
  /** pattern repeats every patternLen shots */
  patternLen: number;
  /** slow-climb recovery rate toward original aim, per second */
  recovery: number;
}

export interface WeaponDef {
  readonly id: string;
  readonly name: string;
  /** true: holding the trigger repeats (rifle, SMG). false: pump/bolt/semi. */
  readonly auto: boolean;
  /** seconds between shots */
  readonly interval: number;
  /** projectiles per trigger pull (8 on the shotgun, 1 elsewhere) */
  readonly pellets: number;
  readonly damage: DamageFalloff;
  readonly magSize: number;
  readonly startReserve: number;
  /** tactical reload (mag not empty), seconds */
  readonly reloadTime: number;
  /** distinct empty reload, seconds */
  readonly emptyReloadTime: number;
  /** ADS blend time, seconds (BO2 band: 0.20–0.28) */
  readonly adsTime: number;
  /** camera FOV when fully aimed */
  readonly adsFov: number;
  /** movement-speed multiplier when fully aimed (read by main/player wiring) */
  readonly adsMoveScale: number;
  readonly spread: SpreadParams;
  readonly recoil: RecoilParams;
}

const DEG = Math.PI / 180;

export const WEAPONS: readonly WeaponDef[] = [
  {
    id: 'longhorn',
    name: 'Longhorn',
    auto: true,
    interval: 0.1, // 600 rpm
    pellets: 1,
    damage: { base: 34, fall: 18, nearRange: 20, farRange: 45 },
    magSize: 30,
    startReserve: 120,
    reloadTime: 2.1,
    emptyReloadTime: 2.6,
    adsTime: 0.24,
    adsFov: 55,
    adsMoveScale: 0.7,
    spread: { hip: 1.6 * DEG, ads: 0.35 * DEG, move: 1.2 * DEG, bloom: 0.12 * DEG, bloomMax: 1.0 * DEG, crouchMult: 0.7 },
    recoil: { pitch: 0.35 * DEG, yawRandom: 0.09 * DEG, patternAmp: 0.3, patternLen: 8, recovery: 6 },
  },
  {
    id: 'rattler',
    name: 'Rattler',
    auto: true,
    interval: 0.075, // 800 rpm
    pellets: 1,
    damage: { base: 25, fall: 12, nearRange: 12, farRange: 30 },
    magSize: 32,
    startReserve: 128,
    reloadTime: 1.9,
    emptyReloadTime: 2.4,
    adsTime: 0.2,
    adsFov: 58,
    adsMoveScale: 0.78,
    spread: { hip: 2.0 * DEG, ads: 0.5 * DEG, move: 1.0 * DEG, bloom: 0.14 * DEG, bloomMax: 1.4 * DEG, crouchMult: 0.75 },
    recoil: { pitch: 0.28 * DEG, yawRandom: 0.12 * DEG, patternAmp: 0.35, patternLen: 7, recovery: 7 },
  },
  {
    id: 'coachman',
    name: 'Coachman',
    auto: false, // pump: one pull, rechamber pause
    interval: 0.8, // ~75 rpm
    pellets: 8,
    damage: { base: 12, fall: 4, nearRange: 6, farRange: 16 },
    magSize: 6,
    startReserve: 24,
    reloadTime: 2.4,
    emptyReloadTime: 3.0,
    adsTime: 0.22,
    adsFov: 60,
    adsMoveScale: 0.72,
    spread: { hip: 3.5 * DEG, ads: 2.2 * DEG, move: 1.5 * DEG, bloom: 0.8 * DEG, bloomMax: 2.0 * DEG, crouchMult: 0.8 },
    recoil: { pitch: 1.6 * DEG, yawRandom: 0.23 * DEG, patternAmp: 0.15, patternLen: 4, recovery: 4 },
  },
  {
    id: 'deadeye',
    name: 'Deadeye',
    auto: false, // bolt: one round, long cycle
    interval: 1.3, // ~46 rpm
    pellets: 1,
    damage: { base: 150, fall: 90, nearRange: 40, farRange: 80 },
    magSize: 5,
    startReserve: 15,
    reloadTime: 3.0,
    emptyReloadTime: 3.7,
    adsTime: 0.28,
    adsFov: 24,
    adsMoveScale: 0.55,
    spread: { hip: 6.0 * DEG, ads: 0.05 * DEG, move: 2.0 * DEG, bloom: 1.5 * DEG, bloomMax: 2.0 * DEG, crouchMult: 0.6 },
    recoil: { pitch: 1.2 * DEG, yawRandom: 0.11 * DEG, patternAmp: 0.1, patternLen: 4, recovery: 3 },
  },
  {
    id: 'duster',
    name: 'Duster',
    auto: false, // semi: every pull is one round
    interval: 0.12,
    pellets: 1,
    damage: { base: 30, fall: 15, nearRange: 15, farRange: 35 },
    magSize: 12,
    startReserve: 48,
    reloadTime: 1.4,
    emptyReloadTime: 1.8,
    adsTime: 0.2,
    adsFov: 58,
    adsMoveScale: 0.8,
    spread: { hip: 1.2 * DEG, ads: 0.35 * DEG, move: 0.8 * DEG, bloom: 0.2 * DEG, bloomMax: 1.0 * DEG, crouchMult: 0.75 },
    recoil: { pitch: 0.5 * DEG, yawRandom: 0.12 * DEG, patternAmp: 0.25, patternLen: 6, recovery: 6.5 },
  },
  {
    id: 'stampede',
    name: 'Stampede',
    auto: true, // LMG: hold the trigger, own the lane; the belt is the reload
    interval: 0.0833, // 720 rpm
    pellets: 1,
    damage: { base: 27, fall: 17, nearRange: 25, farRange: 55 },
    magSize: 60,
    startReserve: 180,
    reloadTime: 3.4,
    emptyReloadTime: 3.9,
    adsTime: 0.3,
    adsFov: 55,
    adsMoveScale: 0.6,
    spread: { hip: 2.2 * DEG, ads: 0.5 * DEG, move: 1.4 * DEG, bloom: 0.1 * DEG, bloomMax: 1.2 * DEG, crouchMult: 0.7 },
    recoil: { pitch: 0.42 * DEG, yawRandom: 0.1 * DEG, patternAmp: 0.3, patternLen: 8, recovery: 5 },
  },
  {
    id: 'varmint',
    name: 'Varmint',
    auto: false, // semi marksman: every pull is one aimed round, fast follow-up
    interval: 0.4, // ~150 rpm
    pellets: 1,
    damage: { base: 45, fall: 28, nearRange: 30, farRange: 70 },
    magSize: 10,
    startReserve: 40,
    reloadTime: 2.2,
    emptyReloadTime: 2.7,
    adsTime: 0.26,
    adsFov: 32,
    adsMoveScale: 0.62,
    spread: { hip: 3.0 * DEG, ads: 0.08 * DEG, move: 1.6 * DEG, bloom: 0.6 * DEG, bloomMax: 1.6 * DEG, crouchMult: 0.65 },
    recoil: { pitch: 0.9 * DEG, yawRandom: 0.1 * DEG, patternAmp: 0.15, patternLen: 4, recovery: 4 },
  },
];

/** Linear damage falloff between nearRange and farRange. Pure, no allocation. */
export function damageAt(def: WeaponDef, dist: number): number {
  const d = def.damage;
  if (dist <= d.nearRange) return d.base;
  if (dist >= d.farRange) return d.fall;
  const t = (dist - d.nearRange) / (d.farRange - d.nearRange);
  return d.base + (d.fall - d.base) * t;
}

/**
 * Deterministic climb multiplier for the n-th shot of a burst (0-based).
 * This is the learnable pattern half of the recoil model; the bounded
 * random yaw term is the other half. Pure, no allocation.
 */
export function patternMult(def: WeaponDef, n: number): number {
  const len = def.recoil.patternLen > 0 ? def.recoil.patternLen : 1;
  const phase = ((n % len) + len) % len / len;
  return 1 + def.recoil.patternAmp * Math.sin(phase * Math.PI * 2);
}
