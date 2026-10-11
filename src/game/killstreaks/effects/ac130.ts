/**
 * Nuketown 2025 — AC-130 Gunship: high-altitude pylon-turn fire support.
 *
 * One aircraft circles a ground column at 65 m AGL on a 90 m left-hand ring;
 * the gunner looks down at the column while the airframe does the flying, so
 * the orbit is a CLOSED-FORM function of elapsed time, never an integration:
 * `angle(t) = orbitAngle + OMEGA * t`. Two hosts stepping the same state with
 * the same clock read the same gun position to the bit, and a stalled tab
 * rejoins the circle rather than spiralling out of it.
 *
 * Three calibers, one gun each (autopilot shares the 40 mm with the gunner,
 * which is why a reloading 40 holds both):
 *   105 mm — 4.5 s reload, 12 m blast, 400 centre. One centre hit kills.
 *   40 mm  — 5-round clip, 350 ms cadence, 5 m blast, 140 centre, 2.5 s reload.
 *   25 mm  — 80 ms cadence, 2.2 m blast, 35 centre, overheats after 100 rounds
 *            with a 4 s cool. Three centre hits kill.
 * Edge numbers (25 / 10 / 3) are FIRST VALUES reasoned against OUR shotgun
 * (12x8=96 point-blank) and OUR sentry (14/shot): the edge punishes loitering,
 * the centre kills, same contract as the mortar's falloff (§5.9).
 *
 * POSSESSION vs AUTOPILOT. `possessed` is bookkeeping for the runtime toggle
 * fold and the client gunner projection; the stepper does not steer by it.
 * Damage always comes from explicit intents: `ctx.gunner` (the gunner shell,
 * exercised by the proof) or the autopilot baseline (40 mm only, 3 s cadence,
 * nearest VISIBLE hostile). The runtime wires autopilot only — a gunner aim
 * point has no wire type this wave (protocol-game.ts is untouched on purpose),
 * so a possessed gun still kills through the baseline while the gunner picks
 * calibers, zooms and thermals locally. The effect already honours a gunner
 * intent for the wave that carries one; nothing here needs to change for it.
 *
 * Determinism is seed-only like the mortar: integer-free hashes are avoided
 * entirely (id-sorted victims), no Math.random, no clock reads in the step.
 */

import type { ActorId, DamageEvent, GameEvent, TeamId, WorldQuery } from '../../events';
import type { SentryTarget } from './sentry';

export const AC130_STREAK_ID = 'ac130-gunship';
export const AC130_DURATION_MS = 40_000;
export const AC130_ALTITUDE_M = 65;
export const AC130_RADIUS_M = 90;
export const AC130_PERIOD_MS = 24_000;
export const AC130_OMEGA_RAD_S = (Math.PI * 2) / (AC130_PERIOD_MS / 1_000);

export const AC130_105_RELOAD_MS = 4_500;
export const AC130_105_BLAST_M = 12;
export const AC130_105_MAX_DAMAGE = 400;
export const AC130_105_MIN_DAMAGE = 25;

export const AC130_40_CLIP = 5;
export const AC130_40_CADENCE_MS = 350;
export const AC130_40_RELOAD_MS = 2_500;
export const AC130_40_BLAST_M = 5;
export const AC130_40_MAX_DAMAGE = 140;
export const AC130_40_MIN_DAMAGE = 10;

export const AC130_25_CADENCE_MS = 80;
export const AC130_25_BLAST_M = 2.2;
export const AC130_25_MAX_DAMAGE = 35;
export const AC130_25_MIN_DAMAGE = 3;
export const AC130_25_OVERHEAT_ROUNDS = 100;
export const AC130_25_COOL_MS = 4_000;

export const AC130_AUTOPILOT_CADENCE_MS = 3_000;
export const AC130_AUTOPILOT_RETRY_MS = 250;
export const AC130_AUTOPILOT_IDLE_MS = 500;
export const MAX_AC130_SHOTS_PER_STEP = 4;
export const AC130_ZOOM_FOVS: readonly number[] = Object.freeze([60, 24, 12]);

export const AC130_CALIBERS = ['105mm', '40mm', '25mm'] as const;
export type Ac130Caliber = (typeof AC130_CALIBERS)[number];

export interface Ac130State {
  readonly kind: 'ac130';
  readonly instanceId: number;
  readonly actorId: ActorId;
  readonly team: TeamId;
  readonly streakId: string;
  readonly remainingMs: number;
  readonly elapsedMs: number;
  readonly orbitAngle: number;
  readonly centreX: number;
  readonly centreY: number;
  readonly centreZ: number;
  readonly caliber: Ac130Caliber;
  readonly cool105Ms: number;
  readonly cool40Ms: number;
  readonly cool25Ms: number;
  readonly clip40: number;
  readonly reload40Ms: number;
  readonly heat25: number;
  readonly overheat25Ms: number;
  readonly autoMs: number;
  readonly zoomStep: number;
  readonly thermal: boolean;
  readonly possessed: boolean;
  readonly seed: number;
  readonly shots105: number;
  readonly shots40: number;
  readonly shots25: number;
}

export interface Ac130Gunner {
  readonly firing: boolean;
  readonly caliber: Ac130Caliber;
  readonly aimX: number;
  readonly aimZ: number;
}

export interface Ac130TickContext {
  readonly now: number;
  readonly world: WorldQuery;
  readonly targets: readonly SentryTarget[];
  readonly gunner: Ac130Gunner | null;
}

export interface Ac130Tick {
  readonly state: Ac130State;
  readonly events: readonly GameEvent[];
}

export interface Ac130Pose {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
}

export function ac130AngleAt(state: Ac130State, elapsedMs: number = state.elapsedMs): number {
  return state.orbitAngle + AC130_OMEGA_RAD_S * (elapsedMs / 1_000);
}

export function ac130PoseAt(state: Ac130State, elapsedMs: number = state.elapsedMs): Ac130Pose {
  const a = ac130AngleAt(state, elapsedMs);
  const x = state.centreX + Math.cos(a) * AC130_RADIUS_M;
  const z = state.centreZ + Math.sin(a) * AC130_RADIUS_M;
  const yaw = Math.atan2(Math.sin(a), -Math.cos(a));
  return Object.freeze({ x, y: state.centreY + AC130_ALTITUDE_M, z, yaw });
}

export function ac130Fov(zoomStep: number): number {
  const i = Math.max(0, Math.min(AC130_ZOOM_FOVS.length - 1, Math.floor(zoomStep)));
  return AC130_ZOOM_FOVS[i] as number;
}

export function createAc130(
  instanceId: number,
  actorId: ActorId,
  team: TeamId,
  streakId: string,
  durationMs: number,
  centre: { readonly x: number; readonly y: number; readonly z: number },
  seed: number,
): Ac130State {
  return Object.freeze({
    kind: 'ac130' as const,
    instanceId,
    actorId,
    team,
    streakId,
    remainingMs: Math.max(0, durationMs),
    elapsedMs: 0,
    orbitAngle: 0,
    centreX: centre.x,
    centreY: centre.y,
    centreZ: centre.z,
    caliber: '40mm' as Ac130Caliber,
    cool105Ms: 0,
    cool40Ms: 0,
    cool25Ms: 0,
    clip40: AC130_40_CLIP,
    reload40Ms: 0,
    heat25: 0,
    overheat25Ms: 0,
    autoMs: AC130_AUTOPILOT_CADENCE_MS,
    zoomStep: 0,
    thermal: false,
    possessed: true,
    seed: seed >>> 0,
    shots105: 0,
    shots40: 0,
    shots25: 0,
  });
}

export function selectAc130Caliber(state: Ac130State, caliber: Ac130Caliber): Ac130State {
  if (!AC130_CALIBERS.includes(caliber)) return state;
  return Object.freeze({ ...state, caliber });
}

export function setAc130Zoom(state: Ac130State, zoomStep: number): Ac130State {
  const z = Math.max(0, Math.min(AC130_ZOOM_FOVS.length - 1, Math.floor(zoomStep)));
  return Object.freeze({ ...state, zoomStep: z });
}

export function setAc130Thermal(state: Ac130State, thermal: boolean): Ac130State {
  return Object.freeze({ ...state, thermal: thermal === true });
}

export function setAc130Possessed(state: Ac130State, possessed: boolean): Ac130State {
  return Object.freeze({ ...state, possessed: possessed === true });
}

function blastDamage(max: number, min: number, blastM: number, distM: number): number {
  if (distM >= blastM) return 0;
  const t = distM / blastM;
  return Math.max(1, Math.round(max + (min - max) * t));
}

function canFire105(s: { remainingMs: number; cool105Ms: number }): boolean {
  return s.remainingMs > 0 && s.cool105Ms <= 0;
}

function canFire40(s: { remainingMs: number; cool40Ms: number; reload40Ms: number; clip40: number }): boolean {
  return s.remainingMs > 0 && s.cool40Ms <= 0 && s.reload40Ms <= 0 && s.clip40 > 0;
}

function canFire25(s: { remainingMs: number; cool25Ms: number; overheat25Ms: number }): boolean {
  return s.remainingMs > 0 && s.cool25Ms <= 0 && s.overheat25Ms <= 0;
}

interface MutableGun {
  cool105Ms: number; cool40Ms: number; cool25Ms: number;
  clip40: number; reload40Ms: number; heat25: number; overheat25Ms: number;
  shots105: number; shots40: number; shots25: number;
}

function blastAt(
  gun: MutableGun,
  caliber: Ac130Caliber,
  ix: number, iy: number, iz: number,
  state: Ac130State,
  now: number,
  targets: readonly SentryTarget[],
  health: Map<ActorId, number>,
  events: DamageEvent[],
): void {
  const max = caliber === '105mm' ? AC130_105_MAX_DAMAGE : caliber === '40mm' ? AC130_40_MAX_DAMAGE : AC130_25_MAX_DAMAGE;
  const min = caliber === '105mm' ? AC130_105_MIN_DAMAGE : caliber === '40mm' ? AC130_40_MIN_DAMAGE : AC130_25_MIN_DAMAGE;
  const blast = caliber === '105mm' ? AC130_105_BLAST_M : caliber === '40mm' ? AC130_40_BLAST_M : AC130_25_BLAST_M;
  const victims: { t: SentryTarget; dist: number; amount: number }[] = [];
  for (const t of targets) {
    if (!t.alive || t.team === state.team || t.id === state.actorId) continue;
    const before = health.get(t.id) ?? t.health;
    if (before <= 0) continue;
    const dx = t.x - ix;
    const dy = t.y + 1.35 - iy;
    const dz = t.z - iz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const amount = blastDamage(max, min, blast, dist);
    if (amount <= 0) continue;
    victims.push({ t, dist, amount });
  }
  victims.sort((a, b) => (a.dist === b.dist ? (a.t.id < b.t.id ? -1 : 1) : a.dist - b.dist));
  for (const v of victims) {
    const before = health.get(v.t.id) ?? v.t.health;
    if (before <= 0) continue;
    health.set(v.t.id, before - v.amount);
    events.push(Object.freeze({
      type: 'damage',
      at: now,
      attackerId: state.actorId,
      attackerTeam: state.team,
      victimId: v.t.id,
      victimTeam: v.t.team,
      amount: v.amount,
      cause: 'streak',
      zone: 'body',
      weaponId: '',
      distance: v.dist,
      healthAfter: Math.max(0, before - v.amount),
      sourceX: ix,
      sourceZ: iz,
    }) as DamageEvent);
  }
  if (caliber === '105mm') {
    gun.cool105Ms = AC130_105_RELOAD_MS;
    gun.shots105 += 1;
  } else if (caliber === '40mm') {
    gun.cool40Ms = AC130_40_CADENCE_MS;
    gun.clip40 -= 1;
    gun.shots40 += 1;
    if (gun.clip40 <= 0) gun.reload40Ms = AC130_40_RELOAD_MS;
  } else {
    gun.cool25Ms = AC130_25_CADENCE_MS;
    gun.heat25 += 1;
    gun.shots25 += 1;
    if (gun.heat25 >= AC130_25_OVERHEAT_ROUNDS) gun.overheat25Ms = AC130_25_COOL_MS;
  }
}

function pickAutoTarget(state: Ac130State, pose: Ac130Pose, ctx: Ac130TickContext): SentryTarget | null {
  let best: SentryTarget | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const t of ctx.targets) {
    if (!t.alive || t.team === state.team || t.id === state.actorId || t.health <= 0) continue;
    const dx = t.x - state.centreX;
    const dz = t.z - state.centreZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (best !== null && (dist > bestDist || (dist === bestDist && t.id >= best.id))) continue;
    const seen = ctx.world.lineOfSight(
      { x: pose.x, y: pose.y, z: pose.z },
      { x: t.x, y: t.y + 1.35, z: t.z },
    );
    if (!seen) continue;
    best = t;
    bestDist = dist;
  }
  return best;
}

export function stepAc130(state: Ac130State, dt: number, ctx: Ac130TickContext): Ac130Tick {
  const step = dt > 0 ? dt : 0;
  const gun: MutableGun = {
    cool105Ms: Math.max(0, state.cool105Ms - step),
    cool40Ms: Math.max(0, state.cool40Ms - step),
    cool25Ms: Math.max(0, state.cool25Ms - step),
    clip40: state.clip40,
    reload40Ms: state.reload40Ms,
    heat25: state.heat25,
    overheat25Ms: state.overheat25Ms,
    shots105: state.shots105,
    shots40: state.shots40,
    shots25: state.shots25,
  };
  if (gun.reload40Ms > 0) {
    gun.reload40Ms = Math.max(0, gun.reload40Ms - step);
    if (gun.reload40Ms <= 0) gun.clip40 = AC130_40_CLIP;
  }
  if (gun.overheat25Ms > 0) {
    gun.overheat25Ms = Math.max(0, gun.overheat25Ms - step);
    if (gun.overheat25Ms <= 0) gun.heat25 = 0;
  }
  let autoMs = state.autoMs - step;

  const elapsedMs = state.elapsedMs + step;
  const remainingMs = Math.max(0, state.remainingMs - step);
  const live = remainingMs > 0;
  const health = new Map<ActorId, number>();
  const events: DamageEvent[] = [];
  let shots = 0;

  const g = ctx.gunner;
  while (live && g !== null && g.firing && shots < MAX_AC130_SHOTS_PER_STEP) {
    const snap = { remainingMs, cool105Ms: gun.cool105Ms, cool40Ms: gun.cool40Ms, cool25Ms: gun.cool25Ms, reload40Ms: gun.reload40Ms, clip40: gun.clip40, overheat25Ms: gun.overheat25Ms };
    const ok = g.caliber === '105mm' ? canFire105(snap) : g.caliber === '40mm' ? canFire40(snap) : canFire25(snap);
    if (!ok || !ctx.world.inBounds(g.aimX, g.aimZ)) break;
    const gy = ctx.world.groundY(g.aimX, g.aimZ);
    blastAt(gun, g.caliber, g.aimX, Number.isFinite(gy) ? gy : state.centreY, g.aimZ, state, ctx.now, ctx.targets, health, events);
    shots += 1;
  }
  if (live && shots < MAX_AC130_SHOTS_PER_STEP && autoMs <= 0) {
    const snap = { remainingMs, cool40Ms: gun.cool40Ms, reload40Ms: gun.reload40Ms, clip40: gun.clip40 };
    if (canFire40(snap)) {
      const pose = ac130PoseAt(state, elapsedMs);
      const tgt = pickAutoTarget(state, pose, ctx);
      if (tgt !== null) {
        const gy = ctx.world.groundY(tgt.x, tgt.z);
        blastAt(gun, '40mm', tgt.x, Number.isFinite(gy) ? gy : state.centreY, tgt.z, state, ctx.now, ctx.targets, health, events);
        shots += 1;
        autoMs = AC130_AUTOPILOT_CADENCE_MS;
      } else {
        autoMs = AC130_AUTOPILOT_IDLE_MS;
      }
    } else {
      autoMs = AC130_AUTOPILOT_RETRY_MS;
    }
  }

  return {
    state: Object.freeze({
      ...state,
      remainingMs,
      elapsedMs,
      cool105Ms: gun.cool105Ms,
      cool40Ms: gun.cool40Ms,
      cool25Ms: gun.cool25Ms,
      clip40: gun.clip40,
      reload40Ms: gun.reload40Ms,
      heat25: gun.heat25,
      overheat25Ms: gun.overheat25Ms,
      autoMs: Math.max(0, autoMs),
      shots105: gun.shots105,
      shots40: gun.shots40,
      shots25: gun.shots25,
    }),
    events,
  };
}
