/**
 * Weapons lane — the weapon table. One object per weapon, in one file, so
 * adding a sixth is one entry here plus one viewmodel builder.
 *
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

  // --- roster20 (frozen20 alignment) ------------------------------------------------
  // The fifteen entries below complete the production catalog's 20-weapon
  // roster (`docs/reference/production-catalog/weapons/catalog-weapons-{a,b}.json`
  // carry the reference ids verbatim). Every entry rides the SAME semantics as
  // the original five — hitscan, pellets, linear falloff, one spread cone, one
  // recoil pattern — with no per-weapon special cases. Family and temporary
  // viewmodel fallback for these ids live in `weapons/families.ts`.
  //
  // Roles, one sentence each:
  //  mp5               close-range SMG, tighter cone than the Rattler, less bloom
  //  mini-uzi          1000 rpm zapper, wild hip cone, shortest damage band
  //  machine-pistol    pocket bullet hose, 20-round mag, sprays to full bloom fast
  //  m4a1              ranged controllable carbine, best mid-range falloff of the ARs
  //  ak-47             hardest-hitting AR per shot, punishes recoil
  //  lmg               sustained suppression: 75-belt, long band, slow handling
  //  minigun           100-round lane-holder, hip-heavy, worst ADS in the roster
  //  m14-ebr           scoped DMR: two-shot body, three-times head optic band
  //  slug-shotgun      semi-auto single slug: precision cousin of the Coachman
  //  magnum            hand cannon: two-shot body, heavy trigger cadence
  //  flashlight-pistol starter-plus pistol: Duster damage with a longer band
  //  railgun           hip-accurate heavy EMRG: one-shot body inside 35 m only
  //  explosive-crossbow slow heavy bolt; single hitscan projectile, no AoE yet
  //  flamethrower      very-short-range rapid ticks, 150-tank, melts close and dies far
  //  flare-gun         single-shot signal pistol: one hard close-range hit, long cycle
  //
  // The last four describe DESIGN, not shipped behaviour: the controller has no
  // explosion, cone/DoT, arc or charge/pierce — every gun here rides the same
  // hitscan pipeline. Until one of them is really implemented it is held out of
  // the playable roster by `weapons/roster.ts` (which also throws if this file's
  // `exotic` family rows and the gate ever disagree). Art fallbacks for the rest
  // are `weapons/families.ts`'s axis and are debt, not a gate.
  {
    id: 'mp5',
    name: 'MP5',
    auto: true,
    interval: 0.075, // 800 rpm
    pellets: 1,
    damage: { base: 26, fall: 13, nearRange: 14, farRange: 32 },
    magSize: 30,
    startReserve: 120,
    reloadTime: 1.8,
    emptyReloadTime: 2.3,
    adsTime: 0.2,
    adsFov: 58,
    adsMoveScale: 0.8,
    spread: { hip: 1.8 * DEG, ads: 0.4 * DEG, move: 1.0 * DEG, bloom: 0.12 * DEG, bloomMax: 1.2 * DEG, crouchMult: 0.75 },
    recoil: { pitch: 0.26 * DEG, yawRandom: 0.1 * DEG, patternAmp: 0.3, patternLen: 7, recovery: 7 },
  },
  {
    id: 'mini-uzi',
    name: 'Mini Uzi',
    auto: true,
    interval: 0.06, // 1000 rpm
    pellets: 1,
    damage: { base: 21, fall: 10, nearRange: 10, farRange: 26 },
    magSize: 32,
    startReserve: 128,
    reloadTime: 1.7,
    emptyReloadTime: 2.2,
    adsTime: 0.2,
    adsFov: 60,
    adsMoveScale: 0.82,
    spread: { hip: 2.2 * DEG, ads: 0.6 * DEG, move: 1.1 * DEG, bloom: 0.16 * DEG, bloomMax: 1.6 * DEG, crouchMult: 0.8 },
    recoil: { pitch: 0.22 * DEG, yawRandom: 0.14 * DEG, patternAmp: 0.35, patternLen: 6, recovery: 7.5 },
  },
  {
    id: 'machine-pistol',
    name: 'Machine Pistol',
    auto: true,
    interval: 0.055, // ~1090 rpm
    pellets: 1,
    damage: { base: 18, fall: 8, nearRange: 8, farRange: 20 },
    magSize: 20,
    startReserve: 80,
    reloadTime: 1.3,
    emptyReloadTime: 1.7,
    adsTime: 0.2,
    adsFov: 62,
    adsMoveScale: 0.84,
    spread: { hip: 2.4 * DEG, ads: 0.7 * DEG, move: 1.2 * DEG, bloom: 0.18 * DEG, bloomMax: 1.8 * DEG, crouchMult: 0.85 },
    recoil: { pitch: 0.2 * DEG, yawRandom: 0.16 * DEG, patternAmp: 0.4, patternLen: 5, recovery: 8 },
  },
  {
    id: 'm4a1',
    name: 'M4A1',
    auto: true,
    interval: 0.088, // ~680 rpm
    pellets: 1,
    damage: { base: 30, fall: 16, nearRange: 24, farRange: 50 },
    magSize: 30,
    startReserve: 150,
    reloadTime: 2.0,
    emptyReloadTime: 2.5,
    adsTime: 0.23,
    adsFov: 55,
    adsMoveScale: 0.72,
    spread: { hip: 1.5 * DEG, ads: 0.3 * DEG, move: 1.1 * DEG, bloom: 0.1 * DEG, bloomMax: 0.9 * DEG, crouchMult: 0.7 },
    recoil: { pitch: 0.3 * DEG, yawRandom: 0.08 * DEG, patternAmp: 0.28, patternLen: 8, recovery: 6.5 },
  },
  {
    id: 'ak-47',
    name: 'AK-47',
    auto: true,
    interval: 0.1, // 600 rpm
    pellets: 1,
    damage: { base: 36, fall: 17, nearRange: 22, farRange: 48 },
    magSize: 30,
    startReserve: 120,
    reloadTime: 2.3,
    emptyReloadTime: 2.8,
    adsTime: 0.25,
    adsFov: 56,
    adsMoveScale: 0.68,
    spread: { hip: 1.7 * DEG, ads: 0.35 * DEG, move: 1.3 * DEG, bloom: 0.13 * DEG, bloomMax: 1.1 * DEG, crouchMult: 0.7 },
    recoil: { pitch: 0.55 * DEG, yawRandom: 0.16 * DEG, patternAmp: 0.45, patternLen: 6, recovery: 5.5 },
  },
  {
    id: 'lmg',
    name: 'LMG',
    auto: true,
    interval: 0.09, // ~660 rpm
    pellets: 1,
    damage: { base: 32, fall: 17, nearRange: 30, farRange: 60 },
    magSize: 75,
    startReserve: 225,
    reloadTime: 4.6,
    emptyReloadTime: 5.4,
    adsTime: 0.27,
    adsFov: 52,
    adsMoveScale: 0.55,
    spread: { hip: 2.1 * DEG, ads: 0.45 * DEG, move: 1.4 * DEG, bloom: 0.1 * DEG, bloomMax: 1.2 * DEG, crouchMult: 0.65 },
    recoil: { pitch: 0.42 * DEG, yawRandom: 0.13 * DEG, patternAmp: 0.3, patternLen: 8, recovery: 4.5 },
  },
  {
    id: 'minigun',
    name: 'Minigun',
    auto: true,
    interval: 0.08, // 750 rpm
    pellets: 1,
    damage: { base: 28, fall: 14, nearRange: 26, farRange: 55 },
    magSize: 100,
    startReserve: 400,
    reloadTime: 6.4,
    emptyReloadTime: 7.8,
    adsTime: 0.28,
    adsFov: 55,
    adsMoveScale: 0.45,
    spread: { hip: 2.6 * DEG, ads: 0.55 * DEG, move: 2.4 * DEG, bloom: 0.1 * DEG, bloomMax: 1.2 * DEG, crouchMult: 0.6 },
    recoil: { pitch: 0.34 * DEG, yawRandom: 0.18 * DEG, patternAmp: 0.25, patternLen: 10, recovery: 4 },
  },
  {
    id: 'm14-ebr',
    name: 'M14 EBR',
    auto: false, // semi: one pull, one aimed round
    interval: 0.32, // ~187 rpm
    pellets: 1,
    damage: { base: 88, fall: 45, nearRange: 45, farRange: 85 },
    magSize: 10,
    startReserve: 40,
    reloadTime: 2.6,
    emptyReloadTime: 3.2,
    adsTime: 0.26,
    adsFov: 38, // scoped: earns the optic headshot rule like the Deadeye
    adsMoveScale: 0.6,
    spread: { hip: 2.8 * DEG, ads: 0.12 * DEG, move: 1.6 * DEG, bloom: 0.6 * DEG, bloomMax: 1.6 * DEG, crouchMult: 0.6 },
    recoil: { pitch: 0.9 * DEG, yawRandom: 0.1 * DEG, patternAmp: 0.15, patternLen: 4, recovery: 4 },
  },
  {
    id: 'slug-shotgun',
    name: 'Slug Shotgun',
    auto: false, // semi: one slug per pull
    interval: 0.45, // ~133 rpm
    pellets: 1, // a slug, not a pattern: precision shotgun
    damage: { base: 78, fall: 35, nearRange: 12, farRange: 30 },
    magSize: 5,
    startReserve: 30,
    reloadTime: 2.2,
    emptyReloadTime: 2.9,
    adsTime: 0.23,
    adsFov: 58,
    adsMoveScale: 0.7,
    spread: { hip: 2.0 * DEG, ads: 0.5 * DEG, move: 1.4 * DEG, bloom: 0.5 * DEG, bloomMax: 1.5 * DEG, crouchMult: 0.75 },
    recoil: { pitch: 1.4 * DEG, yawRandom: 0.2 * DEG, patternAmp: 0.15, patternLen: 4, recovery: 4.5 },
  },
  {
    id: 'magnum',
    name: 'Magnum',
    auto: false, // semi: heavy trigger cadence
    interval: 0.35,
    pellets: 1,
    damage: { base: 67, fall: 30, nearRange: 18, farRange: 40 }, // head one-tap inside 18 m (67 * 1.5 > 100)
    magSize: 6,
    startReserve: 36,
    reloadTime: 1.6,
    emptyReloadTime: 2.1,
    adsTime: 0.2,
    adsFov: 56,
    adsMoveScale: 0.78,
    spread: { hip: 1.4 * DEG, ads: 0.35 * DEG, move: 0.9 * DEG, bloom: 0.25 * DEG, bloomMax: 1.1 * DEG, crouchMult: 0.75 },
    recoil: { pitch: 0.9 * DEG, yawRandom: 0.14 * DEG, patternAmp: 0.2, patternLen: 5, recovery: 6 },
  },
  {
    id: 'flashlight-pistol',
    name: 'Flashlight Pistol',
    auto: false, // semi
    interval: 0.16,
    pellets: 1,
    damage: { base: 32, fall: 16, nearRange: 16, farRange: 34 },
    magSize: 12,
    startReserve: 60,
    reloadTime: 1.4,
    emptyReloadTime: 1.8,
    adsTime: 0.2,
    adsFov: 58,
    adsMoveScale: 0.8,
    spread: { hip: 1.3 * DEG, ads: 0.35 * DEG, move: 0.8 * DEG, bloom: 0.2 * DEG, bloomMax: 1.0 * DEG, crouchMult: 0.75 },
    recoil: { pitch: 0.48 * DEG, yawRandom: 0.12 * DEG, patternAmp: 0.25, patternLen: 6, recovery: 6.5 },
  },
  {
    id: 'railgun',
    name: 'Railgun',
    auto: false, // semi: EMRG slug, long cycle
    interval: 1.25, // ~48 rpm
    pellets: 1,
    damage: { base: 115, fall: 55, nearRange: 35, farRange: 70 },
    magSize: 4,
    startReserve: 20,
    reloadTime: 2.9,
    emptyReloadTime: 3.5,
    adsTime: 0.28,
    adsFov: 32, // scoped: optic headshot rule, like the Deadeye
    adsMoveScale: 0.58,
    spread: { hip: 0.8 * DEG, ads: 0.08 * DEG, move: 1.0 * DEG, bloom: 0.2 * DEG, bloomMax: 0.5 * DEG, crouchMult: 0.6 },
    recoil: { pitch: 1.0 * DEG, yawRandom: 0.08 * DEG, patternAmp: 0.1, patternLen: 4, recovery: 3.5 },
  },
  {
    id: 'explosive-crossbow',
    name: 'Explosive Crossbow',
    auto: false, // semi: one bolt, then a slow rechamber
    interval: 0.5,
    pellets: 1,
    damage: { base: 95, fall: 40, nearRange: 25, farRange: 55 },
    magSize: 1,
    startReserve: 12,
    reloadTime: 1.9,
    emptyReloadTime: 2.4,
    adsTime: 0.24,
    adsFov: 55,
    adsMoveScale: 0.75,
    spread: { hip: 1.6 * DEG, ads: 0.3 * DEG, move: 1.0 * DEG, bloom: 0.3 * DEG, bloomMax: 1.2 * DEG, crouchMult: 0.75 },
    recoil: { pitch: 0.85 * DEG, yawRandom: 0.1 * DEG, patternAmp: 0.15, patternLen: 4, recovery: 5 },
  },
  {
    id: 'flamethrower',
    name: 'Flamethrower',
    auto: true,
    interval: 0.045, // ~1330 rpm of short-range ticks
    pellets: 1,
    damage: { base: 9, fall: 2, nearRange: 9, farRange: 17 },
    magSize: 150,
    startReserve: 300,
    reloadTime: 3.6,
    emptyReloadTime: 4.6,
    adsTime: 0.22,
    adsFov: 62,
    adsMoveScale: 0.66,
    spread: { hip: 5.0 * DEG, ads: 2.8 * DEG, move: 1.6 * DEG, bloom: 0.05 * DEG, bloomMax: 1.5 * DEG, crouchMult: 0.8 },
    recoil: { pitch: 0.06 * DEG, yawRandom: 0.08 * DEG, patternAmp: 0.2, patternLen: 8, recovery: 9 },
  },
  {
    id: 'flare-gun',
    name: 'Flare Gun',
    auto: false, // semi: one flare, long cycle
    interval: 0.5,
    pellets: 1,
    damage: { base: 55, fall: 20, nearRange: 10, farRange: 22 },
    magSize: 1,
    startReserve: 12,
    reloadTime: 1.6,
    emptyReloadTime: 2.0,
    adsTime: 0.21,
    adsFov: 60,
    adsMoveScale: 0.78,
    spread: { hip: 1.8 * DEG, ads: 0.5 * DEG, move: 1.2 * DEG, bloom: 0.4 * DEG, bloomMax: 1.4 * DEG, crouchMult: 0.8 },
    recoil: { pitch: 0.8 * DEG, yawRandom: 0.15 * DEG, patternAmp: 0.2, patternLen: 4, recovery: 5.5 },
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
