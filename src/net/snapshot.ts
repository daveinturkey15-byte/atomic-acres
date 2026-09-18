/**
 * Nuketown 2025 — snapshots, interpolation and prediction/reconciliation.
 *
 * Fixed-tick host simulation with guest-side interpolation for remotes and
 * prediction + reconciliation for self. The design follows the predecessor
 * (atomic-acres network-sync.ts / remote-snapshot-reconciliation.ts) with the
 * adaptive parts cut: this map holds 8 players max on a LAN-able tick, so a
 * fixed rate and fixed delay are correct and far easier to reason about.
 */

/**
 * Host simulation tick, Hz. 20 Hz (50 ms) matches the predecessor's
 * STATE_BROADCAST_INTERVAL_MS and is the standard small-room rate: 10 Hz
 * visibly steps strafes at 6.6 m/s sprint (0.66 m per sample); 40 Hz doubles
 * bandwidth for no perceptible gain with 8 players on this map. If rooms ever
 * grow past MAX_PLAYERS, raise bandwidth by delta-compression, not by tick.
 */
export const TICK_HZ = 20;
/** Seconds per tick, derived — never re-literalised elsewhere. */
export const TICK_DT = 1 / TICK_HZ;

/**
 * Interpolation delay, ms. Render remotes ~2 ticks behind the newest sample:
 * long enough that one dropped snapshot never starves the interpolator,
 * short enough that a 6.6 m/s sprint reads live (~0.66 m behind). The
 * predecessor adapted 40..120 ms; fixed 100 ms is the same 2-tick policy at
 * our 20 Hz tick without the adaptation state machine.
 */
export const INTERP_DELAY_MS = 100;

/**
 * Per-remote snapshot ring capacity. 64 samples ≈ 3.2 s at 20 Hz: deep enough
 * to ride out any plausible jitter burst, bounded so a stalled peer costs
 * 64*5 doubles (2.5 KiB), never a growing array. Overwrites oldest past cap.
 */
export const SNAPSHOT_BUFFER = 64;

/**
 * Local prediction divergence that still counts as "ahead of authority"
 * rather than "disagreeing with authority", metres. Borrowed directly from
 * the predecessor's LOCAL_AUTHORITATIVE_CORRECTION_BOUND_M: at 20 Hz a guest
 * predicting its own sprint moves 0.33 m per tick, so anything under ~0.35 m
 * is normal tick-phase skew and must NOT snap (snapping there looks like
 * rubber-banding every step).
 */
export const CORRECTION_BOUND_M = 0.35;

/** One decoded remote sample. Plain data; the ring stores it decomposed. */
export interface RemoteSample {
  tick: number;
  hostNow: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  ack: number;
}

/**
 * Fixed-capacity ring of remote samples over preallocated Float64Arrays.
 * Push and sample paths allocate nothing: no closures, no spreads, no array
 * literals. Layout per slot: [tick, hostNow, x, y, z, yaw, ack].
 */
export class SnapshotRing {
  private readonly data: Float64Array;
  private write = 0;
  private count = 0;
  /** Newest tick admitted; older-or-equal ticks are stale duplicates. */
  private newestTick = -1;

  constructor(capacity: number = SNAPSHOT_BUFFER) {
    this.data = new Float64Array(capacity * 7);
  }

  get length(): number {
    return this.count;
  }

  get latestTick(): number {
    return this.newestTick;
  }

  get capacity(): number {
    return this.data.length / 7;
  }

  reset(): void {
    this.write = 0;
    this.count = 0;
    this.newestTick = -1;
  }

  /**
   * Admit one sample. Returns false (drops) for stale/duplicate ticks —
   * loss-and-duplicate on the wire must not rewind the buffer.
   */
  push(s: RemoteSample): boolean {
    if (!Number.isSafeInteger(s.tick) || s.tick <= this.newestTick) return false;
    const o = this.write * 7;
    this.data[o] = s.tick;
    this.data[o + 1] = s.hostNow;
    this.data[o + 2] = s.x;
    this.data[o + 3] = s.y;
    this.data[o + 4] = s.z;
    this.data[o + 5] = s.yaw;
    this.data[o + 6] = s.ack;
    this.write = (this.write + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
    this.newestTick = s.tick;
    return true;
  }

  /**
   * Interpolated position at renderTime (host clock, ms). Writes into `out`
   * and returns true; returns false when the buffer cannot serve yet
   * (fewer than 2 samples) so the caller holds the last pose instead of
   * extrapolating into the void.
   */
  sampleAt(renderTime: number, out: { x: number; y: number; z: number; yaw: number }): boolean {
    if (this.count < 2) return false;
    const cap = this.capacity;
    const n = this.count;
    // Walk newest-first to find the bracket [older, newer] around renderTime.
    // Linear scan is fine: n <= 64 and this runs once per remote per frame.
    let newer = -1;
    for (let k = 0; k < n; k++) {
      const idx = (this.write - 1 - k + cap * 2) % cap;
      if (this.data[idx * 7 + 1] <= renderTime) {
        newer = k - 1;
        break;
      }
    }
    if (newer < 0) {
      // Everything is newer than renderTime (burst catch-up): hold newest.
      const idx = (this.write - 1 + cap) % cap;
      out.x = this.data[idx * 7 + 2];
      out.y = this.data[idx * 7 + 3];
      out.z = this.data[idx * 7 + 4];
      out.yaw = this.data[idx * 7 + 5];
      return true;
    }
    if (newer >= n - 1) {
      // Everything is older (starved): hold newest, do NOT extrapolate.
      const idx = (this.write - 1 + cap) % cap;
      out.x = this.data[idx * 7 + 2];
      out.y = this.data[idx * 7 + 3];
      out.z = this.data[idx * 7 + 4];
      out.yaw = this.data[idx * 7 + 5];
      return true;
    }
    const iNew = (this.write - 1 - newer + cap * 2) % cap;
    const iOld = (this.write - 1 - (newer + 1) + cap * 2) % cap;
    const tOld = this.data[iOld * 7 + 1];
    const tNew = this.data[iNew * 7 + 1];
    const span = tNew - tOld;
    const f = span <= 0 ? 1 : Math.min(1, Math.max(0, (renderTime - tOld) / span));
    out.x = this.data[iOld * 7 + 2] + (this.data[iNew * 7 + 2] - this.data[iOld * 7 + 2]) * f;
    out.y = this.data[iOld * 7 + 3] + (this.data[iNew * 7 + 3] - this.data[iOld * 7 + 3]) * f;
    out.z = this.data[iOld * 7 + 4] + (this.data[iNew * 7 + 4] - this.data[iOld * 7 + 4]) * f;
    // Yaw: shortest-arc lerp so a 359°->1° turn does not spin the long way.
    let dy = this.data[iNew * 7 + 5] - this.data[iOld * 7 + 5];
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    out.yaw = this.data[iOld * 7 + 5] + dy * f;
    return true;
  }

  /** Age of the newest sample against a host clock, ms. -1 when empty. */
  newestAge(hostNow: number): number {
    if (this.count === 0) return -1;
    const idx = ((this.write - 1 + this.capacity) % this.capacity) * 7;
    return Math.max(0, hostNow - this.data[idx + 1]);
  }
}

export type CorrectionKind = 'none' | 'snap' | 'ignore';

export interface ReconcileResult {
  accepted: boolean;
  correction: CorrectionKind;
  divergenceM: number;
}

/**
 * Reconcile the HISTORICAL prediction for one acked input against authority.
 * Fail-safe curve from the predecessor: sub-bound skew stays predicted (no
 * visible snap for normal tick-phase lag); anything larger reports 'snap' and
 * the caller shifts its live pose by the error, preserving legitimate lead.
 * Compare the live pose here instead and every sprint step snaps — the lead
 * itself trips the bound. Stale/foreign acks are ignored, never applied.
 * Pure function — no allocation, no state.
 */
export function reconcileSelf(
  predicted: { x: number; y: number; z: number },
  authoritative: { x: number; y: number; z: number },
  ackSeq: number,
  lastAckedSeq: number,
): ReconcileResult {
  if (!Number.isSafeInteger(ackSeq) || ackSeq <= lastAckedSeq) {
    return { accepted: false, correction: 'ignore', divergenceM: 0 };
  }
  const dx = predicted.x - authoritative.x;
  const dy = predicted.y - authoritative.y;
  const dz = predicted.z - authoritative.z;
  const divergenceM = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (divergenceM > CORRECTION_BOUND_M) {
    return { accepted: true, correction: 'snap', divergenceM };
  }
  return { accepted: true, correction: 'none', divergenceM };
}
