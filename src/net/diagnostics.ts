/**
 * Nuketown 2025 — netcode diagnostics model.
 *
 * The predecessor learned this the hard way: without live tick/RTT/age
 * numbers nobody can tell a netcode bug from a game bug. This is the pure
 * model half — no DOM, no three.js, no allocation on record paths. The lobby
 * panel (src/ui/lobby.ts) draws it throttled at 4 Hz; record* may be called
 * per message and per tick.
 *
 * Conventions borrowed from atomic-acres netcode-diagnostics.ts so the two
 * agree if the projects ever compare notes:
 *  - RTT smoothing is EMA with alpha 0.25 (matches updatePeerTiming there).
 *  - Jitter gain is RFC 3550 1/16.
 *  - Sample rings are fixed Float64Arrays that overwrite oldest past cap and
 *    drop non-finite values instead of poisoning the mean.
 */

export const RTT_EMA_ALPHA = 0.25;
export const JITTER_GAIN = 1 / 16;
export const AGE_RING_CAP = 64;
/** Corrections counted per rolling 1 s window for the corrections/sec readout. */
const CORRECTION_WINDOW_MS = 1000;

/** Fixed ring of finite numbers. Push past cap overwrites oldest. */
export class NumericRing {
  private readonly values: Float64Array;
  private write = 0;
  private count = 0;

  constructor(capacity: number = AGE_RING_CAP) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('[net] NumericRing capacity must be a positive integer');
    }
    this.values = new Float64Array(capacity);
  }

  get length(): number {
    return this.count;
  }

  push(v: number): boolean {
    if (!Number.isFinite(v)) return false;
    this.values[this.write] = v;
    this.write = (this.write + 1) % this.values.length;
    if (this.count < this.values.length) this.count += 1;
    return true;
  }

  /** Copy of held samples oldest-first. Allocates: call only on render paths. */
  sorted(): number[] {
    const out: number[] = new Array(this.count);
    const cap = this.values.length;
    for (let k = 0; k < this.count; k++) {
      out[k] = this.values[(this.write - this.count + k + cap * 2) % cap];
    }
    out.sort((a, b) => a - b);
    return out;
  }

  quantile(q: number): number {
    if (this.count === 0) return NaN;
    const s = this.sorted();
    const idx = Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)));
    return s[idx];
  }
}

export interface DiagnosticsSnapshot {
  role: string;
  tickHz: number;
  rttMs: number | null;
  jitterMs: number;
  ageP50: number;
  ageP95: number;
  ageN: number;
  correctionsPerSec: number;
  snaps: number;
  misses: number;
  inputsAccepted: number;
  inputsRejected: number;
  heapBytes: number | null;
}

/**
 * Per-endpoint diagnostics. `tick()` is called by the owner's fixed-tick
 * driver (or the proof harness); everything else records wire events.
 * Nothing here allocates except snapshot()/line(), which are render paths.
 */
export class NetDiagnostics {
  private role: string = 'offline';
  private tickCount = 0;
  private tickWindowStart = -1;
  private tickHz = 0;
  private rttMs: number | null = null;
  private jitterMs = 0;
  private lastRttSample: number | null = null;
  private readonly ages = new NumericRing(AGE_RING_CAP);
  private correctionStamps: number[] = [];
  private correctionHead = 0;
  private snaps = 0;
  /** Acks with no prediction history: full snap-to-authority, not a shift. */
  private misses = 0;
  private inputsAccepted = 0;
  private inputsRejected = 0;

  constructor() {
    // Rolling 1 s window of correction timestamps, preallocated.
    this.correctionStamps = new Array(256).fill(-1e12);
  }

  reset(role: string): void {
    this.role = role;
    this.tickCount = 0;
    this.tickWindowStart = -1;
    this.tickHz = 0;
    this.rttMs = null;
    this.jitterMs = 0;
    this.lastRttSample = null;
    this.snaps = 0;
    this.misses = 0;
    this.inputsAccepted = 0;
    this.inputsRejected = 0;
    this.correctionHead = 0;
    this.correctionStamps.fill(-1e12);
  }

  /** Fixed-tick heartbeat. nowMs must be the same clock as the other calls. */
  tick(nowMs: number): void {
    if (this.tickWindowStart < 0) this.tickWindowStart = nowMs;
    this.tickCount += 1;
    const span = nowMs - this.tickWindowStart;
    if (span >= 1000) {
      this.tickHz = (this.tickCount * 1000) / span;
      this.tickCount = 0;
      this.tickWindowStart = nowMs;
    }
  }

  /** RTT sample from a ping/pong pair, ms. EMA + RFC 3550 jitter. */
  recordRtt(sampleMs: number): void {
    if (!Number.isFinite(sampleMs) || sampleMs < 0) return;
    if (this.rttMs === null) {
      this.rttMs = sampleMs;
    } else {
      this.rttMs += RTT_EMA_ALPHA * (sampleMs - this.rttMs);
    }
    if (this.lastRttSample !== null) {
      const d = Math.abs(sampleMs - this.lastRttSample);
      this.jitterMs += (d - this.jitterMs) * JITTER_GAIN;
    }
    this.lastRttSample = sampleMs;
  }

  /** Newest-snapshot age sample, ms. */
  recordAge(ageMs: number): void {
    this.ages.push(ageMs);
  }

  /** Reconciliation outcome for one acknowledged self sample. */
  recordCorrection(nowMs: number, snapped: boolean): void {
    if (!snapped) return;
    this.snaps += 1;
    this.correctionStamps[this.correctionHead] = nowMs;
    this.correctionHead = (this.correctionHead + 1) % this.correctionStamps.length;
  }
  /**
   * Ack arrived with no prediction history (post-stall): the guest took
   * authority as-is. Counted separately from error-shifts and included in
   * the corrections rate — it is the more visible of the two.
   */
  recordMiss(nowMs: number): void {
    this.misses += 1;
    this.recordCorrection(nowMs, true);
  }

  recordInput(accepted: boolean): void {
    if (accepted) this.inputsAccepted += 1;
    else this.inputsRejected += 1;
  }
  /** Sorted copy of the held age window. Render/proof path: allocates. */
  ageWindowSorted(): number[] {
    return this.ages.sorted();
  }

  correctionsPerSec(nowMs: number): number {
    let n = 0;
    for (let i = 0; i < this.correctionStamps.length; i++) {
      if (nowMs - this.correctionStamps[i] <= CORRECTION_WINDOW_MS) n += 1;
    }
    return n;
  }

  snapshot(nowMs: number): DiagnosticsSnapshot {
    return {
      role: this.role,
      tickHz: this.tickHz,
      rttMs: this.rttMs === null ? null : Math.round(this.rttMs * 10) / 10,
      jitterMs: Math.round(this.jitterMs * 10) / 10,
      ageP50: this.ages.length ? Math.round(this.ages.quantile(0.5) * 10) / 10 : NaN,
      ageP95: this.ages.length ? Math.round(this.ages.quantile(0.95) * 10) / 10 : NaN,
      ageN: this.ages.length,
      correctionsPerSec: this.correctionsPerSec(nowMs),
      snaps: this.snaps,
      misses: this.misses,
      inputsAccepted: this.inputsAccepted,
      inputsRejected: this.inputsRejected,
      heapBytes: readHeapBytes(),
    };
  }

  /** One-line readout for the overlay. Render path: may allocate. */
  line(nowMs: number): string {
    const s = this.snapshot(nowMs);
    const rtt = s.rttMs === null ? 'rtt --' : `rtt ${s.rttMs.toFixed(0)}ms`;
    const age = s.ageN === 0 ? 'age --' : `age p50/p95 ${s.ageP50.toFixed(0)}/${s.ageP95.toFixed(0)}ms`;
    return (
      `corr ${s.correctionsPerSec}/s (snaps ${s.snaps}/${s.misses} shift/full) in ${s.inputsAccepted}/${s.inputsRejected} ok/rej`
    );
  }
}

/** JS heap in bytes, or null where the runtime does not expose it. */
export function readHeapBytes(): number | null {
  try {
    const perf = (globalThis as unknown as {
      performance?: { memory?: { usedJSHeapSize?: unknown } };
    }).performance;
    const used = perf?.memory?.usedJSHeapSize;
    if (typeof used === 'number' && Number.isFinite(used)) return Math.round(used);
  } catch {
    /* performance.memory is Chromium-only; fall through to node. */
  }
  try {
    const proc = (globalThis as unknown as {
      process?: { memoryUsage?: () => { heapUsed?: unknown } };
    }).process;
    const used = proc?.memoryUsage?.().heapUsed;
    if (typeof used === 'number' && Number.isFinite(used)) return Math.round(used);
  } catch {
    /* unreachable in practice; heap is best-effort. */
  }
  return null;
}
