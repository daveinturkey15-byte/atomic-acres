/** Private weapon authority wire. All data shapes import the host's one contract. */
import { WEAPON_INTENT_ACTIONS, WEAPON_INTENT_REASONS,
  type WeaponIntent, type WeaponState, type WeaponAmmoState } from '../game/host-weapon-state';

export const WEAPON_STATE_PROTOCOL = 1;

export interface WeaponIntentMsg extends WeaponIntent { readonly type: 'weapon-intent' }
/** Sent only to this authenticated actor's seat, never broadcast to opponents. */
export interface WeaponStateMsg { readonly type: 'weapon-state'; readonly actorId: string; readonly state: WeaponState }
export type WeaponNetMessage = WeaponIntentMsg | WeaponStateMsg;

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const integer = (v: unknown, minimum = 0): v is number => Number.isSafeInteger(v) && (v as number) >= minimum;
const id = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 80;
const nonnegative = (v: unknown): v is number => finite(v) && v >= 0;

function isAmmoState(v: unknown): v is WeaponAmmoState {
  if (!object(v)) return false;
  return id(v.weaponId) && integer(v.mag) && integer(v.reserve) &&
    nonnegative(v.reloadRemainingMs) && nonnegative(v.reloadDurationMs) && v.reloadRemainingMs <= v.reloadDurationMs &&
    (v.chargeElapsedMs === null || nonnegative(v.chargeElapsedMs)) && nonnegative(v.chargeRequiredMs);
}

export function isWeaponState(v: unknown): v is WeaponState {
  if (!object(v)) return false;
  return integer(v.life, 1) && finite(v.at) && integer(v.revision) && id(v.activeWeaponId) &&
    integer(v.lastIntentSeq, -1) && (v.lastIntentReason === null ||
      (typeof v.lastIntentReason === 'string' && (WEAPON_INTENT_REASONS as readonly string[]).includes(v.lastIntentReason))) &&
    integer(v.lastShotSeq, -1) && Array.isArray(v.resolvedShotSeqs) && v.resolvedShotSeqs.length <= 64 &&
    v.resolvedShotSeqs.every(n => integer(n)) && new Set(v.resolvedShotSeqs).size === v.resolvedShotSeqs.length &&
    isAmmoState(v.primary) && isAmmoState(v.sidearm) &&
    (v.activeWeaponId === v.primary.weaponId || v.activeWeaponId === v.sidearm.weaponId);
}

export function isWeaponMessage(v: Record<string, unknown>): v is Record<string, unknown> & WeaponNetMessage {
  if (v.type === 'weapon-state') return id(v.actorId) && isWeaponState(v.state);
  if (v.type !== 'weapon-intent') return false;
  // No peer clock, ammo, completion fraction or claimed actor identity is admitted.
  return Object.keys(v).every(k => ['type', 'seq', 'life', 'weaponId', 'action'].includes(k)) &&
    integer(v.seq) && integer(v.life, 1) && id(v.weaponId) && typeof v.action === 'string' &&
    (WEAPON_INTENT_ACTIONS as readonly string[]).includes(v.action);
}
