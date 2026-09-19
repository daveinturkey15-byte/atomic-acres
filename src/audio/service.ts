/**
 * Nuketown 2025 — bounded WebAudio service (audio lane).
 *
 * One AudioContext, one master gain, one effects bus, a capped transient
 * voice set (MAX_VOICES) with priority steal/drop, per-voice retirement via
 * `onended`, plus at most two owned ambient loops (wind/rain) with smooth
 * bounded gain transitions. No update loop, no per-frame allocation: voices
 *
 * Sound: five CC0 recorded shots in `public/audio-recorded/`, with authored
 * WAVs in `public/audio/` as the per-file fallback and remaining cue bank.
 * Each key retains one decoded buffer and plays as one source. If a buffer
 * is missing (first load, fetch failure, headless), a
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

/** Footfall surfaces. Aliases (dirt/wood/metal) resolve to the nearest bank. */
export type StepSurface = 'concrete' | 'grass' | 'gravel' | 'dirt' | 'wood' | 'metal';
export type StepStance = 'stand' | 'crouch' | 'prone' | 'sprint';
export interface StepOptions {
  /** Stride intensity ~0..1 (walk 0.4, run 0.8, sprint 1). Default 0.5. */
  speed?: number;
  stance?: StepStance;
  /** Optional distance attenuation in metres (null = close, dry). */
  distanceM?: number;
  /** Optional stereo placement -1 (left) .. 1 (right). Default 0. */
  pan?: number;
  /** Force variant 0/1; default alternates deterministically. */
  variant?: number;
}
/** Weather ambience. 'storm' = wind + rain together; 'clear' silences both. */
export type EnvironmentKind = 'clear' | 'wind' | 'rain' | 'storm';

export interface AudioStats {
  voices: number;
  dropped: number;
  state: string;
  buffers: number;
  /** Recorded shots decoded successfully; failed files use the authored bank. */
  recordedShots: number;
  recordedFoley: number;
  /** Actual AudioParam values (zero when the graph does not exist). */
  masterGain: number;
  effectsGain: number;
  /** Number of owned weather loop sources currently alive (0..2). */
  ambientLoops: number;
  environment: { kind: EnvironmentKind; level: number };
  unlocked: boolean;
  /** Flat remote-shot diagnostics; no event objects are retained. */
  remoteAdmitted: number;
  lastRemoteDistance: number;
  lastRemotePan: number;
  lastRemoteOccluded: boolean;
}

/** Must match BANK_VERSION in src/audio/render-bank.mjs (check-bank enforces). */
export const AUDIO_BANK_VERSION = 3;
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

/** CC0 field recordings. Surface approximations are documented in the manifest. */
const RECORDED_FOLEY: Record<string, string> = {
  reloadStart: 'rec-reload-start.wav', reloadEnd: 'rec-reload-end.wav',
  stepConcreteA: 'rec-step-hard-a.wav', stepConcreteB: 'rec-step-hard-b.wav',
  stepGrassA: 'rec-step-grass-a.wav', stepGrassB: 'rec-step-grass-b.wav',
  stepGravelA: 'rec-step-gravel-a.wav', stepGravelB: 'rec-step-gravel-b.wav',
};

/** Two authored variants per footfall bank; service alternates via LCG. */
const STEP_FILES: Record<string, [string, string]> = {
  concrete: ['stepConcreteA', 'step-concrete-a.wav'],
  grass: ['stepGrassA', 'step-grass-a.wav'],
  gravel: ['stepGravelA', 'step-gravel-a.wav'],
};
const STEP_FILES_B: Record<string, [string, string]> = {
  concrete: ['stepConcreteB', 'step-concrete-b.wav'],
  grass: ['stepGrassB', 'step-grass-b.wav'],
  gravel: ['stepGravelB', 'step-gravel-b.wav'],
};
/** Legacy/alias surfaces resolve to the nearest authored bank. */
const STEP_ALIAS: Record<StepSurface, string> = {
  concrete: 'concrete',
  grass: 'grass',
  gravel: 'gravel',
  dirt: 'grass',
  wood: 'concrete',
  metal: 'concrete',
};
const AMBIENT_FILES: Record<string, string> = {
  wind: 'ambient-wind.wav',
  rain: 'ambient-rain.wav',
};
/** Quiet beds: hard ceilings so weather never masks gunfire. */
const WIND_MAX = 0.14;
const RAIN_MAX = 0.12;
/** Ambience crossfade time constant (s): smooth, bounded, no clicks. */
const AMBIENT_TAU = 0.9;

/** Fallback voice: per-family lowpass / decay / level / thump (Hz, drops ~45%). */
const FALLBACK: Record<ShotFamily, { cutoff: number; decay: number; vol: number; thump: number }> = {
  longhorn: { cutoff: 1800, decay: 0.16, vol: 0.32, thump: 75 },
  rattler: { cutoff: 2400, decay: 0.1, vol: 0.26, thump: 95 },
  coachman: { cutoff: 1100, decay: 0.28, vol: 0.36, thump: 60 },
  deadeye: { cutoff: 800, decay: 0.45, vol: 0.36, thump: 50 },
  duster: { cutoff: 2600, decay: 0.09, vol: 0.24, thump: 110 },
};

/** Pure remote-shot mix rules, shared by the real sink and CPU proof. */
export function remoteShotGain(distanceM: number, occluded = false): number {
  const distance = Number.isFinite(distanceM) ? Math.max(0, distanceM) : 0;
  return (0.7 / (1 + distance * 0.06)) * (occluded ? 0.45 : 1);
}

export function remoteShotCutoff(distanceM: number, occluded = false): number {
  const distance = Number.isFinite(distanceM) ? Math.max(0, distanceM) : 0;
  const cutoff = Math.max(900, 7200 - distance * 90);
  return occluded ? Math.min(cutoff, 1100) : cutoff;
}

export class AudioService {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private fxBus: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private recordedShots = new Set<string>();
  private recordedFoley = new Set<string>();
  /** Active voices with their steal priority. Bounded by MAX_VOICES. */
  private voices = new Map<AudioBufferSourceNode, number>();
  /** Cleanup nodes owned by each active voice, including filters and panners. */
  private voiceNodes = new Map<AudioBufferSourceNode, AudioNode[]>();
  private dropped = 0;
  private masterVol = 0.8;
  private fxVol = 0.9;
  private muted = false;
  private preloadStarted = false;
  private loadGeneration = 0;
  private loadAbort: AbortController | null = null;
  /** Deterministic LCG so fallback texture is stable, never Math.random. */
  private seed = 0x2f6e2b21;
  /** Set only by resume(): no voice and no ambience starts before a gesture. */
  private unlocked = false;
  private env: EnvironmentKind = 'clear';
  private envLevel = 1;
  /** At most two owned ambient loops; never counted in the voice cap. */
  private windSrc: AudioBufferSourceNode | null = null;
  private rainSrc: AudioBufferSourceNode | null = null;
  private windGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  /** Last scheduled targets; repeated identical weather requests do no work. */
  private windTarget: number | null = null;
  private rainTarget: number | null = null;
  /** Monotonic presentation diagnostics, reset with service teardown. */
  private remoteAdmitted = 0;
  private lastRemoteDistance = 0;
  private lastRemotePan = 0;
  private lastRemoteOccluded = false;

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
      this.unlocked = true;
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
      this.preload();
      this.applyEnvironment();
    } catch {
      // Audio never breaks the game.
    }
  }

  /** Decode one bounded bank; recorded shots fall back per-file to authored WAVs. */
  preload(): void {
    try {
      // Fetch/decode is also an audio side effect. It starts only from resume().
      if (!this.unlocked) return;
      if (this.preloadStarted) return;
      const ctx = this.ensure();
      if (!ctx || typeof window === 'undefined') return;
      this.preloadStarted = true;
      const generation = ++this.loadGeneration;
      this.loadAbort = new AbortController();
      const entries: Array<[string, string]> = [];
      for (const k of Object.keys(SHOT_FILES)) entries.push([k, SHOT_FILES[k as ShotFamily]]);
      for (const k of Object.keys(CUE_FILES)) entries.push([k, CUE_FILES[k]]);
      for (const bank of Object.keys(STEP_FILES)) {
        entries.push([STEP_FILES[bank][0], STEP_FILES[bank][1]]);
        entries.push([STEP_FILES_B[bank][0], STEP_FILES_B[bank][1]]);
      }
      for (const k of Object.keys(AMBIENT_FILES)) entries.push([k, AMBIENT_FILES[k]]);
      const signal = this.loadAbort.signal;
      const decode = async (path: string): Promise<AudioBuffer> => {
        const response = await fetch(new URL(path, window.location.href), { signal });
        if (!response.ok) throw new Error(`audio ${response.status}`);
        return ctx.decodeAudioData(await response.arrayBuffer());
      };
      for (const [key, file] of entries) {
        const isShot = Object.hasOwn(SHOT_FILES, key);
        const recordedPath = isShot ? `audio-recorded/rec-${file}`
          : RECORDED_FOLEY[key] ? `audio-foley/${RECORDED_FOLEY[key]}` : null;
        let recorded = recordedPath !== null;
        const pending = recordedPath
          ? decode(recordedPath).catch((error: unknown) => {
              // Cancellation must never start a second request after disposal.
              if (signal.aborted) throw error;
              recorded = false;
              return decode(`audio/${file}`);
            })
          : decode(`audio/${file}`);
        pending.then((buf) => {
            // An in-flight decode cannot repopulate a disposed/replaced bank.
            if (this.ctx !== ctx || this.loadGeneration !== generation) return;
            this.buffers.set(key, buf);
            if (recorded) (isShot ? this.recordedShots : this.recordedFoley).add(key);
            // A weather request made before the beds decoded starts now.
            if (key === 'wind' || key === 'rain') this.applyEnvironment();
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
      recordedShots: this.recordedShots.size,
      recordedFoley: this.recordedFoley.size,
      masterGain: this.master?.gain.value ?? 0,
      effectsGain: this.fxBus?.gain.value ?? 0,
      ambientLoops: Number(this.windSrc !== null) + Number(this.rainSrc !== null),
      environment: { kind: this.env, level: this.envLevel },
      unlocked: this.unlocked,
      remoteAdmitted: this.remoteAdmitted,
      lastRemoteDistance: this.lastRemoteDistance,
      lastRemotePan: this.lastRemotePan,
      lastRemoteOccluded: this.lastRemoteOccluded,
    };
  }

  /** Full teardown: stop voices, disconnect the graph, close the context. */
  dispose(): void {
    try {
      this.loadGeneration++;
      this.loadAbort?.abort();
      this.loadAbort = null;
      this.preloadStarted = false;
      for (const bed of [this.windSrc, this.rainSrc]) {
        if (!bed) continue;
        try {
          bed.stop();
        } catch {
          // Already stopped.
        }
        try {
          bed.disconnect();
        } catch {
          // Already gone.
        }
      }
      this.windSrc = null;
      this.rainSrc = null;
      try {
        this.windGain?.disconnect();
      } catch {
        // Already gone.
      }
      try {
        this.rainGain?.disconnect();
      } catch {
        // Already gone.
      }
      this.windGain = null;
      this.rainGain = null;
      this.windTarget = null;
      this.rainTarget = null;
      this.unlocked = false;
      this.env = 'clear';
      this.envLevel = 1;
      for (const src of Array.from(this.voices.keys())) {
        try {
          src.stop();
        } catch {
          // Already stopped: onended still retires it.
        }
        this.retire(src);
      }
      this.voices.clear();
      this.voiceNodes.clear();
      this.buffers.clear();
      this.recordedShots.clear();
      this.recordedFoley.clear();
      this.remoteAdmitted = 0;
      this.lastRemoteDistance = 0;
      this.lastRemotePan = 0;
      this.lastRemoteOccluded = false;
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

  /** Remote firearm presentation: quieter/lower priority, spatial and occlusion-aware. */
  spatialShot(family: ShotFamily, distanceM: number, pan: number, occluded = false): void {
    try {
      if (!this.unlocked) return;
      const placement = Number.isFinite(pan) ? Math.max(-1, Math.min(1, pan)) : 0;
      const gain = remoteShotGain(distanceM, occluded);
      const cutoff = remoteShotCutoff(distanceM, occluded);
      // Priority 1 yields to local trigger pulls (priority 2) under the 16-voice cap.
      const admitted = this.playBuffer(family, gain, 1, { type: 'lowpass', freq: cutoff }, 1, placement)
        || this.synthShot(family, gain, cutoff, placement, 1);
      if (admitted) {
        this.remoteAdmitted++;
        this.lastRemoteDistance = Number.isFinite(distanceM) ? Math.max(0, distanceM) : 0;
        this.lastRemotePan = placement;
        this.lastRemoteOccluded = occluded;
      }
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

  /**
   * Footstep for one stride event (NOT per-frame — root stride-times it from
   * speed/grounded). Variant A/B alternates via LCG, playbackRate +/-6%
   * keeps repeats from machine-gunning. Priority 0: drops (counted) under
   * gunfire pressure, never steals a shot. Silent before resume().
   */
  step(surface: StepSurface = 'concrete', opts: StepOptions = {}): void {
    try {
      if (!this.unlocked) return;
      const bank = STEP_ALIAS[surface] ?? 'concrete';
      const pick = opts.variant === 0 || opts.variant === 1 ? opts.variant : Math.floor(this.next() * 2);
      const key = (pick === 0 ? STEP_FILES : STEP_FILES_B)[bank][0];
      const speed = Math.min(1, Math.max(0, opts.speed ?? 0.5));
      const stanceGain =
        opts.stance === 'prone' ? 0.45 : opts.stance === 'crouch' ? 0.7 : opts.stance === 'sprint' ? 1.0 : 0.85;
      let gain = (0.28 + speed * 0.3) * stanceGain;
      let dull = 6500;
      const dist = Math.max(0, opts.distanceM ?? 0);
      if (dist > 0) {
        gain = gain / (1 + dist * 0.06);
        dull = Math.max(900, 6500 - dist * 110);
      }
      const pan = Math.min(1, Math.max(-1, opts.pan ?? 0));
      const rate = 0.94 + this.next() * 0.12;
      if (this.playBuffer(key, gain, 0, { type: 'lowpass', freq: dull }, rate, pan)) return;
      this.synthStep(gain, dull, rate);
    } catch {
      // Garnish, never gameplay.
    }
  }

  /**
   * Weather ambience: stores the request always, starts/transitions the
   * owned loops only after unlock (resume). At most two loop sources,
   * created once and gain-ramped — no clicks, no per-frame work.
   */
  setEnvironment(kind: EnvironmentKind, level = 1): void {
    try {
      this.env = kind;
      this.envLevel = Math.min(1, Math.max(0, level));
      if (!this.unlocked) return;
      this.applyEnvironment();
    } catch {
      // Garnish, never gameplay.
    }
  }

  /** Current weather request, for HUD/debug introspection. */
  environment(): { kind: EnvironmentKind; level: number } {
    return { kind: this.env, level: this.envLevel };
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
        this.retire(src);
        this.dropped++;
        return null;
      }
    }
    this.dropped++;
    return null;
  }

  private adopt(src: AudioBufferSourceNode, priority: number, nodes: AudioNode[]): void {
    this.voices.set(src, priority);
    this.voiceNodes.set(src, nodes);
    src.onended = () => this.retire(src);
  }

  /** Idempotent voice teardown for natural end, admission steal, errors, and dispose. */
  private retire(src: AudioBufferSourceNode): void {
    this.voices.delete(src);
    const nodes = this.voiceNodes.get(src);
    this.voiceNodes.delete(src);
    for (const n of nodes ?? [src]) {
      try {
        n.disconnect();
      } catch {
        // Already disconnected.
      }
    }
  }

  private disconnectNodes(nodes: AudioNode[]): void {
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        // Best-effort cleanup after a partially constructed voice.
      }
    }
  }

  /** Create one owned loop bed (wind/rain) at silence; ramped by applyEnvironment. */
  private startBed(which: 'wind' | 'rain'): void {
    const ctx = this.ctx;
    const buf = ctx ? this.buffers.get(which) : undefined;
    if (!ctx || !this.fxBus || !buf) return;
    if (which === 'wind' ? this.windSrc : this.rainSrc) return;
    let src: AudioBufferSourceNode | null = null;
    let g: GainNode | null = null;
    try {
      src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      g = ctx.createGain();
      g.gain.value = 0;
      src.connect(g);
      g.connect(this.fxBus);
      src.start(ctx.currentTime);
      if (which === 'wind') {
        this.windSrc = src;
        this.windGain = g;
        this.windTarget = null;
      } else {
        this.rainSrc = src;
        this.rainGain = g;
        this.rainTarget = null;
      }
    } catch {
      // Ambience never breaks the game.
      try {
        src?.disconnect();
        g?.disconnect();
      } catch {
        // Best-effort cleanup after a failed start.
      }
    }
  }

  /**
   * Bring the owned loops to the requested weather. Loops are created once
   * (at most two, never in the voice cap) and ramped with setTargetAtTime;
   * 'clear' ramps to silence but keeps the nodes — no leak, no churn.
   */
  private applyEnvironment(): void {
    const ctx = this.ctx;
    if (!ctx || !this.fxBus || !this.unlocked) return;
    const t = ctx.currentTime;
    if (!this.windSrc) this.startBed('wind');
    if (!this.rainSrc) this.startBed('rain');
    const lvl = this.envLevel;
    const windTarget = this.env === 'wind' || this.env === 'storm' ? WIND_MAX * lvl : 0;
    const rainTarget = this.env === 'rain' || this.env === 'storm' ? RAIN_MAX * lvl : 0;
    if (this.windGain && this.windTarget !== windTarget) {
      this.windGain.gain.setTargetAtTime(windTarget, t, AMBIENT_TAU);
      this.windTarget = windTarget;
    }
    if (this.rainGain && this.rainTarget !== rainTarget) {
      this.rainGain.gain.setTargetAtTime(rainTarget, t, AMBIENT_TAU);
      this.rainTarget = rainTarget;
    }
  }

  private playBuffer(
    key: string,
    gainV: number,
    priority: number,
    filter?: { type: BiquadFilterType; freq: number },
    rate = 1,
    pan = 0,
  ): boolean {
    if (!this.unlocked) return false;
    const ctx = this.ensure();
    if (!ctx || !this.fxBus) return false;
    const buf = this.buffers.get(key);
    if (!buf) return false;
    this.room(priority);
    if (this.voices.size >= MAX_VOICES) return false;
    let src: AudioBufferSourceNode | null = null;
    const nodes: AudioNode[] = [];
    try {
      const t = ctx.currentTime;
      src = ctx.createBufferSource();
      nodes.push(src);
      src.buffer = buf;
      if (rate !== 1) src.playbackRate.value = rate;
      const g = ctx.createGain();
      nodes.push(g);
      g.gain.setValueAtTime(Math.max(0.001, gainV), t);
      let head: AudioNode = src;
      let filt: BiquadFilterNode | null = null;
      if (filter) {
        filt = ctx.createBiquadFilter();
        nodes.push(filt);
        filt.type = filter.type;
        filt.frequency.value = filter.freq;
        src.connect(filt);
        head = filt;
      }
      head.connect(g);
      if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
        const p = ctx.createStereoPanner();
        nodes.push(p);
        p.pan.value = Math.min(1, Math.max(-1, pan));
        g.connect(p);
        p.connect(this.fxBus);
      } else {
        g.connect(this.fxBus);
      }
      this.adopt(src, priority, nodes);
      src.start(t);
      return true;
    } catch {
      if (src && this.voiceNodes.has(src)) this.retire(src);
      else this.disconnectNodes(nodes);
      return false;
    }
  }

  /** Layered fallback: lowpassed noise body + downward percussive thump. */
  private synthShot(
    family: ShotFamily,
    gainScale = 1,
    cutoffOverride: number | undefined = undefined,
    pan = 0,
    priority = 2,
  ): boolean {
    if (!this.unlocked) return false;
    const ctx = this.ensure();
    if (!ctx || !this.fxBus || !this.noiseBuf) return false;
    this.room(priority);
    if (this.voices.size >= MAX_VOICES) return false;
    const nodes: AudioNode[] = [];
    let src: AudioBufferSourceNode | null = null;
    try {
      const P = FALLBACK[family];
      const t = ctx.currentTime;
      const scale = Math.max(0.01, Number.isFinite(gainScale) ? gainScale : 1);
      const g = ctx.createGain();
      nodes.push(g);
      g.gain.setValueAtTime(P.vol * scale, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + P.decay);
      const lp = ctx.createBiquadFilter();
      nodes.push(lp);
      lp.type = 'lowpass';
      lp.frequency.value = cutoffOverride === undefined ? P.cutoff : cutoffOverride;
      src = ctx.createBufferSource();
      nodes.push(src);
      src.buffer = this.noiseBuf;
      src.playbackRate.value = 0.9 + this.next() * 0.2;
      src.connect(lp);
      lp.connect(g);
      const placement = Math.max(-1, Math.min(1, Number.isFinite(pan) ? pan : 0));
      let output: AudioNode = this.fxBus;
      if (placement !== 0 && typeof ctx.createStereoPanner === 'function') {
        const p = ctx.createStereoPanner();
        nodes.push(p);
        p.pan.value = placement;
        p.connect(this.fxBus);
        output = p;
      }
      g.connect(output);
      // Body thump: sine that falls, never rises — weight without the pew.
      const o = ctx.createOscillator();
      nodes.push(o);
      o.type = 'sine';
      o.frequency.setValueAtTime(P.thump, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(28, P.thump * 0.55), t + 0.09);
      const og = ctx.createGain();
      nodes.push(og);
      og.gain.setValueAtTime(P.vol * 0.9 * scale, t);
      og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      o.connect(og);
      og.connect(output);
      this.adopt(src, priority, nodes);
      const stopT = t + P.decay + 0.05;
      src.start(t, this.next() * 0.5);
      src.stop(stopT);
      o.start(t);
      o.stop(stopT);
      return true;
    } catch {
      if (src && this.voiceNodes.has(src)) this.retire(src);
      else this.disconnectNodes(nodes);
      return false;
    }
  }

  private synthImpact(gainV: number, cutoff: number): void {
    if (!this.unlocked) return;
    const ctx = this.ensure();
    if (!ctx || !this.fxBus || !this.noiseBuf) return;
    this.room(1);
    if (this.voices.size >= MAX_VOICES) return;
    const nodes: AudioNode[] = [];
    let src: AudioBufferSourceNode | null = null;
    try {
      const t = ctx.currentTime;
      const g = ctx.createGain();
      nodes.push(g);
      g.gain.setValueAtTime(Math.max(0.001, gainV), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
      const lp = ctx.createBiquadFilter();
      nodes.push(lp);
      lp.type = 'lowpass';
      lp.frequency.value = cutoff;
      src = ctx.createBufferSource();
      nodes.push(src);
      src.buffer = this.noiseBuf;
      src.connect(lp);
      lp.connect(g);
      g.connect(this.fxBus);
      this.adopt(src, 1, nodes);
      src.start(t, this.next() * 0.8);
      src.stop(t + 0.12);
    } catch {
      if (src && this.voiceNodes.has(src)) this.retire(src);
      else this.disconnectNodes(nodes);
    }
  }

  /** Last-resort mechanical tick: short shaped noise, no oscillator. */
  private synthClick(gainV: number, priority: number): void {
    if (!this.unlocked) return;
    const ctx = this.ensure();
    if (!ctx || !this.fxBus || !this.noiseBuf) return;
    this.room(priority);
    if (this.voices.size >= MAX_VOICES) return;
    const nodes: AudioNode[] = [];
    let src: AudioBufferSourceNode | null = null;
    try {
      const t = ctx.currentTime;
      const g = ctx.createGain();
      nodes.push(g);
      g.gain.setValueAtTime(Math.max(0.001, gainV * 0.5), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      const hp = ctx.createBiquadFilter();
      nodes.push(hp);
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      src = ctx.createBufferSource();
      nodes.push(src);
      src.buffer = this.noiseBuf;
      src.connect(hp);
      hp.connect(g);
      g.connect(this.fxBus);
      this.adopt(src, priority, nodes);
      src.start(t, this.next() * 0.8);
      src.stop(t + 0.07);
    } catch {
      if (src && this.voiceNodes.has(src)) this.retire(src);
      else this.disconnectNodes(nodes);
    }
  }
  /** Last-resort footstep: dull shaped noise, no oscillator. */
  private synthStep(gainV: number, cutoff: number, rate: number): void {
    if (!this.unlocked) return;
    const ctx = this.ensure();
    if (!ctx || !this.fxBus || !this.noiseBuf) return;
    this.room(0);
    if (this.voices.size >= MAX_VOICES) return;
    const nodes: AudioNode[] = [];
    let src: AudioBufferSourceNode | null = null;
    try {
      const t = ctx.currentTime;
      const g = ctx.createGain();
      nodes.push(g);
      g.gain.setValueAtTime(Math.max(0.001, gainV * 0.7), t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      const lp = ctx.createBiquadFilter();
      nodes.push(lp);
      lp.type = 'lowpass';
      lp.frequency.value = cutoff;
      src = ctx.createBufferSource();
      nodes.push(src);
      src.buffer = this.noiseBuf;
      src.playbackRate.value = rate;
      src.connect(lp);
      lp.connect(g);
      g.connect(this.fxBus);
      this.adopt(src, 0, nodes);
      src.start(t, this.next() * 0.8);
      src.stop(t + 0.1);
    } catch {
      if (src && this.voiceNodes.has(src)) this.retire(src);
      else this.disconnectNodes(nodes);
    }
  }

}

function clamp01(v: number): number {
  if (!(v >= 0)) return 0;
  if (v > 1) return 1;
  return v;
}
