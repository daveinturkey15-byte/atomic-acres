import type { PilotInput } from '../game/killstreaks/pilot-types';

/** Guest authors controls only. Position, targets, owner and health stay host-owned. */
export interface PilotInputMsg extends PilotInput { type: 'pilot-input' }

export function isPilotInput(v: Record<string, unknown>): v is Record<string, unknown> & PilotInputMsg {
  const finite = (key: string): boolean => typeof v[key] === 'number' && Number.isFinite(v[key]);
  return v.type === 'pilot-input' && Number.isSafeInteger(v.seq) && (v.seq as number) >= 0 &&
    ['forward', 'strafe', 'ascend'].every(k => finite(k) && Math.abs(v[k] as number) <= 1) &&
    finite('yaw') && Math.abs(v.yaw as number) <= 1_000_000 && finite('pitch') &&
    Math.abs(v.pitch as number) <= Math.PI / 2 && typeof v.fire === 'boolean';
}
