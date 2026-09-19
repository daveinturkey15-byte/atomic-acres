/**
 * Nuketown 2025 — Mortar audio: spatial thumps from the existing contracts.
 *
 * One function, no state: presentation drains the mortar projection's new
 * impacts each frame and plays each exactly once through the ONLY spatial
 * thump the audio lane owns — `AudioService.impact(distanceM, dusty)` — with
 * `dusty = true` (every mortar slot lands on dirt, lawn or paving, never on a
 * wall). No new synth, no new bank entry, no pan (that contract carries no
 * stereo field; the limitation is pinned here, not hidden).
 *
 * Why not `blast()`: that cue is full-volume by design (a grenade at your
 * feet), and a mortar disc 40 m away at full volume reads as a bug. `impact()`
 * attenuates gain and dulls the cutoff with distance, which is the whole of
 * "spatial" this slice claims. A close slot still kicks: under ~12 m the gain
 * is within 6 dB of the blast cue through the same effects bus.
 *
 * Voice budget: the host emits at most `MAX_MORTAR_IMPACTS_PER_STEP` (4) per
 * tube per step, but one presentation drain can cover several steps and up to
 * `MORTAR_MAX_TELEGRAPHS` (4) tubes, so the real per-drain bound is the view
 * cap `MORTAR_MAX_IMPACTS` (8) — still under the `MAX_VOICES = 16` cap with
 * headroom for gunfire. At-most-once is the view's `audioSeq` cursor: a second
 * drain with no new impacts plays nothing, and an evicted-but-undrained impact
 * is skipped, never replayed. Silent when the sink is missing (headless) or
 * the listener is NaN.
 */

import type { MortarView } from './mortar-view';

export interface MortarAudioSink {
  impact(distanceM: number, dusty: boolean): void;
}

export interface MortarListener {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/**
 * Play every undrained impact once. Returns the count played. Idempotent:
 * the view's `audioSeq` cursor advances past what was played, so a second
 * call with no new impacts plays nothing.
 */
export function drainMortarAudio(
  view: MortarView,
  listener: MortarListener,
  sink: MortarAudioSink | null,
): number {
  if (sink === null || sink === undefined) return 0;
  if (!Number.isFinite(listener.x) || !Number.isFinite(listener.y) || !Number.isFinite(listener.z)) return 0;
  let played = 0;
  for (const impact of view.impacts) {
    if (impact.seq <= view.audioSeq) continue;
    const dx = impact.x - listener.x;
    const dy = impact.y - listener.y;
    const dz = impact.z - listener.z;
    const distance = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(distance)) continue;
    try {
      sink.impact(distance, true);
      played++;
    } catch {
      // Garnish, never gameplay.
    }
  }
  view.audioSeq = view.impactSeq;
  return played;
}
