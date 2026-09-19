/**
 * Nuketown 2025 — bounded WebAudio service (audio lane).
 *
 * One AudioContext, one master gain, one effects bus, a capped voice set with
 * priority steal/drop, and per-voice retirement via `onended`. No update loop,
 * no per-frame allocation: voices are short-lived nodes created only on game
 * events (shots, reloads, impacts), retired automatically.
 *
 * Sound: pre-rendered authored WAVs in `public/audio/` (see
 * `src/audio/render-bank.mjs`, the canonical mix) played back as single
 * sources. If a buffer is missing (first load, fetch failure, headless), a
 * compact procedural fallback — filtered noise + a downward percussive thump,
 * never an upward sinusoid sweep — keeps the cue audible. The fallback table
 * is hand-synced to the renderer; AUDIO_BANK_VERSION must match
 * render-bank.mjs BANK_VERSION (checked by `src/audio/check-bank.mjs`).
 *
 * Headless/autoplay: every public method is safe with no AudioContext (returns
 * silently). The context is created lazily and resumed only from user-gesture
 * paths (`resume()`), so an autoplay-blocked or headless harness never throws.
 */
export type ShotFamily = 'longhorn' | 'rattler' | 'coachman' | 'deadeye' | 'duster';

export interface AudioStats {
  voices: number;
  dropped: number;
  state: string;
  buffers: number;
}

/** Must match BANK_VERSION in src/audio/render-bank.mjs (check-bank enforces). */
export const AUDIO_BANK_VERSION = 2;
/** Hard polyphony cap: one pull makes at most 3 voices (shot + impact + tick). */
const MAX_VOICES = 16;

/** Legacy Safari prefix: same-realm DOM object, shape known, no validator needed. */
interface WindowWithWebkit extends Window {
  webkitAudioContext?: typeof AudioContext;
}

const SHOT_FILES: Record<ShotFamily, string> = {
  longhorn: 'shot-longhorn.wav',
  rattler: 'shot-rattler.wav',
  coachman: 'shot-coachman.wav',
  deadeye: 'shot-deadeye.wav',
  duster: 'shot-duster.wav',
};

const CUE_FILES: Record<string, string> = {
  reloadStart: 'cue-reload-start.wav',
  reloadEnd: 'cue-reload-end.wav',
  dryFire: 'cue-dryfire.wav',
  switch: 'cue-switch.wav',
  impactDirt: 'cue-impact-dirt.wav',
  impactHard: 'cue-impact-hard.wav',
  hitmark: 'cue-hitmark.wav',
  blast: 'cue-blast.wav',
};

/** Fallback voice: per-family lowpass / decay / level / thump (Hz, drops ~45%). */
const FALLBACK: Record<ShotFamily, { cutoff: number; decay: number; vol: number; thump: number }> = {
  longhorn: { cutoff: 1800, decay: 0.16, vol: 0.32, thump: 75 },
  rattler: { cutoff: 2400, decay: 0.1, vol: 0.26, thump: 95 },
  coachman: { cutoff: 1100, decay: 0.28, vol: 0.36, thump: 60 },
  deadeye: { cutoff: 800, decay: 0.45, vol: 0.36, thump: 50 },
  duster: { cutoff: 2600, decay: 0.09, vol: 0.24, thump: 110 },
};

export class AudioService {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private fxBus: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private buffers = new Map<string, AudioBuffer>();
  /** Active voices with their steal priority. Bounded by MAX_VOICES. */
  private voices = new Map<AudioBufferSourceNode, number>();
  private dropped = 0;
  private masterVol = 0.8;
  private fxVol = 0.9;
  private muted = false;
  private preloadStarted = false;
  private loadGeneration = 0;
  private loadAbort: AbortController | null = null;
  /** Deterministic LCG so fallback texture is stable, never Math.random. */
  private seed = 0x2f6e2b21;

  /** Lazy context creation. Null when there is no WebAudio (headless). */
  ensure(): AudioContext | null {
    try {
      if (this.ctx) return this.ctx;
      if (typeof window === 'undefined') return null;
      const w = window as unknown as WindowWithWebkit;
      const AC = window.AudioContext ?? w.webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 24;
      comp.ratio.value = 5;
      comp.attack.value = 0.002;
      const master = ctx.createGain();
      const fx = ctx.createGain();
      fx.connect(comp);
      comp.connect(master);
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      this.fxBus = fx;
      this.limiter = comp;
      this.applyGains();
      // 1 s deterministic noise bed for the procedural fallback only.
      const len = ctx.sampleRate;
      const bed = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = bed.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = this.next() * 2 - 1;
      this.noiseBuf = bed;
      return ctx;
    } catch {
      return null;
    }
  }

  /** Call from pointer/key user gestures. Safe anywhere; no-ops headless. */
  resume(): void {
    try {
      const ctx = this.ensure();
      if (!ctx) return;
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      this.preload();
    } catch {
      // Audio never breaks the game.
    }
  }

  /** Fetch + decode the authored bank once. Fire-and-forget, failures keep fallback. */
  preload(): void {
    try {
      if (this.preloadStarted) return;
      const ctx = this.ensure();
      if (!ctx || typeof window === 'undefined') return;
      this.preloadStarted = true;
      const generation = ++this.loadGeneration;
      this.loadAbort = new AbortController();
      const entries: Array<[string, string]> = [];
      for (const k of Object.keys(SHOT_FILES)) entries.push([k, SHOT_FILES[k as ShotFamily]]);
      for (const k of Object.keys(CUE_FILES)) entries.push([k, CUE_FILES[k]]);
      for (const [key, file] of entries) {
        const url = new URL(`audio/${file}`, window.location.href).toString();
        fetch(url, { signal: this.loadAbort.signal })
          .then((r) => {
            if (!r.ok) throw new Error(`audio ${r.status}`);
            return r.arrayBuffer();
          })
          .then((ab) => ctx.decodeAudioData(ab))
          .then((buf) => {
            // An in-flight decode cannot repopulate a disposed/replaced bank.
            if (this.ctx === ctx && this.loadGeneration === generation) this.buffers.set(key, buf);
          })
          .catch(() => undefined);
      }
    } catch {
      // Missing bank: the fallback synth covers every cue.
    }
  }

  setMasterVolume(v: number): void {
    this.masterVol = clamp01(v);
    this.applyGains();
  }

  setEffectsVolume(v: number): void {
    this.fxVol = clamp01(v);
    this.applyGains();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGains();
  }

  audioStats(): AudioStats {
    return {
      voices: this.voices.size,
      dropped: this.dropped,
      state: this.ctx ? this.ctx.state : 'none',
      buffers: this.buffers.size,
    };
  }

  /** Full teardown: stop voices, disconnect the graph, close the context. */
  dispose(): void {
    try {
      this.loadGeneration++;
      this.loadAbort?.abort();
      this.loadAbort = null;
      this.preloadStarted = false;
      for (const src of this.voices.keys()) {
        try {
          src.stop();
        } catch {
          // Already stopped: onended still retires it.
        }
        try {
          src.disconnect();
        } catch {
          // Never connected or already gone.
        }
      }
      this.voices.clear();
      this.buffers.clear();
      this.noiseBuf = null;
      try {
        this.fxBus?.disconnect();
      } catch {
        // Graph already torn down.
      }
      this.fxBus = null;
      this.limiter?.disconnect();
      this.limiter = null;
      this.master?.disconnect();
      this.master = null;
      const ctx = this.ctx;
      this.ctx = null;
      if (ctx) void ctx.close().catch(() => undefined);
    } catch {
      // Dispose is best-effort by design.
    }
  }

  // ---- Game cues (all no-op safe without a context) ----

  /** One trigger pull: buffered shot, else the layered fallback. */
  shot(family: ShotFamily): void {
    try {
      if (this.playBuffer(family, 1.0, 2)) return;
      this.synthShot(family);
    } catch {
      // Garnish, never gameplay.
    }
  }

  /** Single impact thud per pull: gain + dullness scale with distance. */
  impact(distanceM: number, dusty: boolean): void {
    try {
      const dist = Math.max(0, distanceM);
      const gain = 0.55 / (1 + dist * 0.045);
      const dull = Math.max(900, 5200 - dist * 90);
      const key = dusty ? 'impactDirt' : 'impactHard';
      if (this.playBuffer(key, gain, 1, { type: 'lowpass', freq: dull })) return;
      this.synthImpact(gain, dull);
    } catch {
      // Garnish, never gameplay.
    }
  }

  reloadStart(): void {
    this.playCue('reloadStart', 0.8, 0);
  }

  reloadEnd(): void {
    this.playCue('reloadEnd', 0.9, 0);
  }

  /** Short hit-confirm tick on a damaging pull. Pairs with impact (2 voices). */
  hitmark(): void {
    this.playCue('hitmark', 0.55, 1);
  }

  dryFire(): void {
    this.playCue('dryFire', 0.7, 0);
  }

  switchWeapon(): void {
    this.playCue('switch', 0.6, 0);
  }

  blast(): void {
    try {
      if (this.playBuffer('blast', 1.0, 2)) return;
      this.synthShot('coachman');
    } catch {
      // Garnish, never gameplay.
    }
  }

  private playCue(key: string, gain: number, priority: number): void {
    try {
      if (this.playBuffer(key, gain, priority)) return;
      this.synthClick(gain, priority);
    } catch {
      // Garnish, never gameplay.
    }
  }

  // ---- Internals ----

  private applyGains(): void {
    try {
      const t = this.ctx ? this.ctx.currentTime : 0;
      // v^2 loudness taper so 0.5 reads as half-loud, not half-voltage.
      this.master?.gain.setValueAtTime(this.muted ? 0 : this.masterVol * this.masterVol, t);
      this.fxBus?.gain.setValueAtTime(this.fxVol, t);
    } catch {
      // Gains apply on next ensure.
    }
  }

  private next(): number {
    let a = (this.seed + 0x6d2b79f5) | 0;
    this.seed = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Voice admission: under the cap always; at the cap, priority-0 cues drop
   * (counted) while shots/blasts steal the oldest equal-or-lower voice.
   */
  private room(priority: number): AudioBufferSourceNode | null {
    if (this.voices.size < MAX_VOICES) return null;
    if (priority <= 0) {
      this.dropped++;
      return null;
    }
    for (const [src, p] of this.voices) {
      if (p <= priority) {
        try {
          src.stop();
        } catch {
          // Already ended; retirement still runs.
        }
        this.voices.delete(src);
        this.dropped++;
        return null;
      }
    }
    this.dropped++;
    return null;
  }

  private adopt(src: AudioBufferSourceNode, priority: number, nodes: AudioNode[]): void {
    this.voices.set(src, priority);
    src.onended = () => {
      this.voices.delete(src);
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          // Already disconnected.
        }
      }
    };
  }

  private playBuffer(
    key: string,
    gainV: number,
    priority: number,
    filter?: { type: BiquadFilterType; freq: number },
    rate = 1,
  ): boolean {
    const ctx = this.ensure();
    if (!ctx || !this.fxBus) return false;
    const buf = this.buffers.get(key);
    if (!buf) return false;
    this.room(priority);
    if (this.voices.size >= MAX_VOICES) return false;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    if (rate !== 1) src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.001, gainV), t);
    let head: AudioNode = src;
    let filt: BiquadFilterNode | null = null;
    if (filter) {
      filt = ctx.createBiquadFilter();
      filt.type = filter.type;
      filt.frequency.value = filter.freq;
      src.connect(filt);
      head = filt;
    }
    head.connect(g);
    g.connect(this.fxBus);
    this.adopt(src, priority, filt ? [src, filt, g] : [src, g]);
    src.start(t);
    return true;
  }

  /** Layered fallback: lowpassed noise body + downward percussive thump. */
  private synthShot(family: ShotFamily): void {
    const ctx = this.ensure();
    if (!ctx || !this.fxBus || !this.noiseBuf) return;
    this.room(2);
    if (this.voices.size >= MAX_VOICES) return;
    const P = FALLBACK[family];
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(P.vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + P.decay);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = P.cutoff;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.9 + this.next() * 0.2;
    src.connect(lp);
    lp.connect(g);
    g.connect(this.fxBus);
    // Body thump: sine that falls, never rises — weight without the pew.
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(P.thump, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(28, P.thump * 0.55), t + 0.09);
    const og = ctx.createGain();
    og.gain.setValueAtTime(P.vol * 0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(og);
    og.connect(this.fxBus);
    this.adopt(src, 2, [src, lp, g, o, og]);
    const stopT = t + P.decay + 0.05;
    src.start(t, this.next() * 0.5);
    src.stop(stopT);
    o.start(t);
    o.stop(stopT);
  }

  private synthImpact(gainV: number, cutoff: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.fxBus || !this.noiseBuf) return;
    this.room(1);
    if (this.voices.size >= MAX_VOICES) return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.001, gainV), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.connect(lp);
    lp.connect(g);
    g.connect(this.fxBus);
    this.adopt(src, 1, [src, lp, g]);
    src.start(t, this.next() * 0.8);
    src.stop(t + 0.12);
  }

  /** Last-resort mechanical tick: short shaped noise, no oscillator. */
  private synthClick(gainV: number, priority: number): void {
    const ctx = this.ensure();
    if (!ctx || !this.fxBus || !this.noiseBuf) return;
    this.room(priority);
    if (this.voices.size >= MAX_VOICES) return;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(Math.max(0.001, gainV * 0.5), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.connect(hp);
    hp.connect(g);
    g.connect(this.fxBus);
    this.adopt(src, priority, [src, hp, g]);
    src.start(t, this.next() * 0.8);
    src.stop(t + 0.07);
  }
}

function clamp01(v: number): number {
  if (!(v >= 0)) return 0;
  if (v > 1) return 1;
  return v;
}
