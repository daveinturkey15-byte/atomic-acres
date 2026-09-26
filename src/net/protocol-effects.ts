import type { GameEvent, MortarEvent } from '../game/events';
import type { RadarSample } from '../game/killstreaks/effects/reveal';
import type { StreakEffectView } from '../game/killstreaks/effect-view';

export interface RadarStateMsg { type: 'radar-state'; at: number; actorId: string; samples: readonly RadarSample[] }
export interface StreakEffectsMsg { type: 'streak-effects'; at: number; effects: readonly StreakEffectView[] }
export interface EffectMsg { type: 'effect'; e: Extract<GameEvent, { type: 'weapon-effect' }> | MortarEvent }
export type PresentationMessage = RadarStateMsg | StreakEffectsMsg | EffectMsg;
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';
const point = (v: Record<string, unknown>) => finite(v.x) && finite(v.y) && finite(v.z);
const kinds = ['sentry','dart','fallout-screen','strike-relay','supply-crate','mortar'];

export function isPresentationMessage(v: Record<string, unknown>): boolean {
  if (v.type === 'radar-state') return finite(v.at) && typeof v.actorId === 'string' &&
    Array.isArray(v.samples) && v.samples.length <= 64 && v.samples.every(s => obj(s) &&
      typeof s.id === 'string' && point(s) && ['recon','dart'].includes(s.source as string) &&
      Number.isSafeInteger(s.pulse) && finite(s.expiresAt));
  if (v.type === 'streak-effects') return finite(v.at) && Array.isArray(v.effects) && v.effects.length <= 16 &&
    v.effects.every(e => obj(e) && kinds.includes(e.kind as string) && Number.isSafeInteger(e.instanceId) &&
      typeof e.actorId === 'string' && typeof e.streakId === 'string' && (e.team === 0 || e.team === 1) && point(e) &&
      finite(e.remainingMs) && ['yaw','aimYaw','shots','pulses','elapsedMs','fired','captureProgressMs'].every(k => e[k] === undefined || finite(e[k])) &&
      (e.opened === undefined || typeof e.opened === 'boolean'));
  if (v.type !== 'effect' || !obj(v.e) || !finite(v.e.at)) return false;
  const e = v.e;
  if (e.type === 'weapon-effect') return ['flame','flare-launch','flare-impact','crossbow-blast','rail'].includes(e.effect as string) &&
    typeof e.actorId === 'string' && typeof e.weaponId === 'string' && (e.team === 0 || e.team === 1) &&
    Number.isSafeInteger(e.id) && point(e) && finite(e.dx) && finite(e.dy) && finite(e.dz) && finite(e.radius) && finite(e.durationMs);
  if (e.type === 'mortar-telegraph') return Number.isSafeInteger(e.instanceId) && point(e) &&
    typeof e.actorId === 'string' && finite(e.radius) && finite(e.endsAt);
  if (e.type === 'mortar-impact') return Number.isSafeInteger(e.instanceId) && point(e) &&
    typeof e.actorId === 'string' && finite(e.index) && finite(e.victims) && (e.team === 0 || e.team === 1);
  return false;
}
