/** Read-only spatial and pulse-latched sensor projections; hidden control/target state never crosses. */
import type { TeamId } from '../events';
import type { LiveInstance } from './behaviors';
import type { StreakTarget } from './runtime';
import type { StreakEffectView } from './effect-view';
import { reconBlipVisible, reconRevealsTo, RECON_BLIP_HOLD_MS } from './effects/recon';
import { jamsTeam } from './effects/counter-recon';
import { FALLOUT_RADIUS_M, falloutHides, type FalloutState } from './effects/fallout';
import { DART_PULSE_MS } from './effects/dart';
import type { RadarSample, RevealSample } from './effects/reveal';

/** Only the bounded spatial presentation fields leave the authoritative runtime. */
export function effectSnapshot(instances: readonly LiveInstance[]): readonly StreakEffectView[] {
  return instances.filter((i) => 'x' in i).map((i) => {
    const s = i as Extract<LiveInstance, { x: number }>;
    return Object.freeze({
      kind: s.kind, instanceId: s.instanceId, actorId: s.actorId, team: s.team,
      streakId: s.streakId, x: s.x, y: s.y, z: s.z, remainingMs: s.remainingMs,
      ...('yaw' in s ? { yaw: s.yaw } : {}), ...('aimYaw' in s ? { aimYaw: s.aimYaw } : {}),
      ...('shots' in s ? { shots: s.shots } : {}), ...('pulses' in s ? { pulses: s.pulses } : {}),
      ...('elapsedMs' in s ? { elapsedMs: s.elapsedMs } : {}), ...('fired' in s ? { fired: s.fired } : {}),
      ...('captureProgressMs' in s ? { captureProgressMs: s.captureProgressMs } : {}),
      ...('opened' in s ? { opened: s.opened } : {}),
      ...(s.kind === 'carpet-bomber' ? { impacts: s.impacts } : {}),
      ...(s.kind === 'aircraft' ? { variant: s.variant, units: s.units, pitch: s.pitch, health: s.health, controlled: s.controlled,
        craft: Object.freeze(s.drones.filter((d) => d.alive).map((d) => Object.freeze({ x: d.x, y: d.y, z: d.z, yaw: s.yaw, pitch: s.pitch }))) } : {}),
    });
  });
}

/** The ONE place recon and counter-recon combine; checking one alone is half the pair. */
export function revealedFor(instances: readonly LiveInstance[], team: TeamId): boolean {
  for (const i of instances) if (i.kind === 'counter-recon' && jamsTeam(i, team)) return false;
  for (const i of instances) {
    if (i.kind === 'recon' && reconRevealsTo(i, team) && reconBlipVisible(i)) return true;
    if (i.kind === 'dart' && i.team === team && i.remainingMs > 0 && i.samples.length > 0) return true;
  }
  return false;
}


/** Samples retain pulse coordinates; current positions only reject dead, friendly or screened targets. */
export function radarFor(instances: readonly LiveInstance[], nowMs: number, team: TeamId, targets: readonly StreakTarget[], freeForAll = false, observerId?: string): readonly RadarSample[] {
  if (freeForAll && !observerId) return Object.freeze([]);
  if (instances.some((instance) => instance.kind === 'counter-recon' && (freeForAll
    ? instance.actorId !== observerId && instance.remainingMs > 0 : jamsTeam(instance, team)))) {
    return Object.freeze([]);
  }
  const current = new Map(targets.map((target) => [target.id, target]));
  const fallout = instances.filter((instance): instance is FalloutState => instance.kind === 'fallout-screen');
  const visible = (sample: RevealSample): StreakTarget | null => {
    const target = current.get(sample.id);
    if (target === undefined || !target.alive || target.health <= 0 || (freeForAll ? target.id === observerId : target.team === team)) return null;
    if (fallout.some((screen) => freeForAll
      ? screen.actorId === target.id && screen.remainingMs > 0 && Math.hypot(target.x - screen.x, target.z - screen.z) <= FALLOUT_RADIUS_M
      : falloutHides(screen, team, target.team, target.x, target.z))) return null;
    return target;
  };
  const out: RadarSample[] = [];
  for (const instance of instances) {
    if (instance.kind === 'recon' && (freeForAll ? instance.actorId === observerId : reconRevealsTo(instance, team)) && reconBlipVisible(instance)) {
      const expiresAt = nowMs + Math.max(0, RECON_BLIP_HOLD_MS - instance.sweepMs);
      for (const sample of instance.latched) {
        if (visible(sample) !== null) out.push(Object.freeze({ ...sample, source: 'recon', pulse: instance.pulses, expiresAt }));
      }
    } else if (instance.kind === 'dart' && (freeForAll ? instance.actorId === observerId : instance.team === team) && instance.remainingMs > 0 && instance.samples.length > 0) {
      const expiresAt = nowMs + Math.max(0, DART_PULSE_MS - instance.pulseMs);
      for (const sample of instance.samples) {
        if (visible(sample) !== null) out.push(Object.freeze({ ...sample, source: 'dart', pulse: instance.pulses, expiresAt }));
      }
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id) || a.source.localeCompare(b.source) || a.expiresAt - b.expiresAt);
  return Object.freeze(out);
}
