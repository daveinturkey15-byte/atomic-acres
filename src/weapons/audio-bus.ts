/**
 * Atomic Acres — weapon audio bus (procedural WebAudio, no assets).
 *
 * One lazily-created AudioContext behind the whole weapon lane: a master
 * gain fed by `settings.masterVolume` and an sfx gain fed by
 * `settings.effectsVolume`, wired sfx -> master -> destination. Every voice
 * below connects under sfx, so both sliders always work and nothing outside
 * this file ever writes to `ctx.destination`.
 *
 * Creation stays lazy (first shot, click or volume change — a user gesture
 * in the live page) so the autoplay policy never sees an eager context.
 * In a headless harness without an AudioContext every method is a no-op.
 */

export type ReloadStage = 'start' | 'seated';

/** Per-family body level, decay and sub-thump pitch. The cutoff arrives per shot. */
interface ShotVoice {
  vol: number;
  decay: number;
  subHz: number;
}

const DEFAULT_VOICE: ShotVoice = { vol: 0.3, decay: 0.14, subHz: 120 };

const SHOT_VOICES: Readonly<Record<string, ShotVoice>> = Object.freeze({
  deadeye: { vol: 0.34, decay: 0.24, subHz: 70 },
  coachman: { vol: 0.34, decay: 0.2, subHz: 90 },
  rattler: { vol: 0.24, decay: 0.1, subHz: 140 },
  duster: { vol: 0.22, decay: 0.09, subHz: 150 },
});

/**
 * Module-level handle: the weapon controller registers its bus on
 * construction and `ui/settings-apply.ts` reads it back. The bus itself is
 * the only shared audio object — no further singletons.
 */
let sharedBus: AudioBus | null = null;

export function registerAudioBus(bus: AudioBus | null): void {
  sharedBus = bus;
}

export function getAudioBus(): AudioBus | null {
  return sharedBus;
}

function clamp01(v: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
}

export class AudioBus {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private masterLevel = 1;
  private sfxLevel = 1;
  private rngState = 0x9e3779b9;

  /** Exposed for the mix proof; null until a gesture creates the graph. */
  get masterGain(): GainNode | null {
    return this.master;
  }

  /** Exposed for the mix proof; null until a gesture creates the graph. */
  get sfxGain(): GainNode | null {
    return this.sfx;
  }

  /** Both sliders: stored always, applied live once the graph exists. */
  setVolumes(master: number, effects: number): void {
    this.masterLevel = clamp01(master);
    this.sfxLevel = clamp01(effects);
    try {
      // A slider drag is a user gesture, so the graph may be created here;
      // a headless harness simply keeps nulls and stays silent.
      const ctx = this.ensure();
      if (!ctx) return;
      if (this.master) this.master.gain.value = this.masterLevel;
      if (this.sfx) this.sfx.gain.value = this.sfxLevel;
    } catch {
      // Audio is garnish; settings must never break on it.
    }
  }

  /** Full synth voice: punch click + filtered body + square sub thump. */
  playShot(family: string, cutoffHz: number): void {
    try {
      const ctx = this.ensure();
      if (!ctx || !this.sfx || !this.noiseBuf) return;
      const voice = SHOT_VOICES[family] ?? DEFAULT_VOICE;
      const cutoff = typeof cutoffHz === 'number' && Number.isFinite(cutoffHz)
        ? Math.min(8000, Math.max(200, cutoffHz))
        : 1700;
      const t = ctx.currentTime;

      // Body: the shared 0.25 s noise buffer through the per-family lowpass.
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = cutoff;
      const body = ctx.createGain();
      body.gain.setValueAtTime(voice.vol, t);
      body.gain.exponentialRampToValueAtTime(0.001, t + voice.decay);
      src.connect(filter);
      filter.connect(body);
      body.connect(this.sfx);
      src.start(t, this.rand() * 0.1);
      src.stop(t + 0.2);

      // Transient punch: a 5 ms highpassed noise click off the same buffer.
      const tick = ctx.createBufferSource();
      tick.buffer = this.noiseBuf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 4000;
      const punch = ctx.createGain();
      punch.gain.setValueAtTime(voice.vol * 0.6, t);
      punch.gain.exponentialRampToValueAtTime(0.001, t + 0.005);
      tick.connect(hp);
      hp.connect(punch);
      punch.connect(this.sfx);
      tick.start(t, this.rand() * 0.2);
      tick.stop(t + 0.02);

      // Sub thump: a subtle square blip under the noise.
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = voice.subHz;
      const sub = ctx.createGain();
      sub.gain.setValueAtTime(voice.vol * 0.4, t);
      sub.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      osc.connect(sub);
      sub.connect(this.sfx);
      osc.start(t);
      osc.stop(t + 0.09);
    } catch {
      // Audio is garnish; a headless harness has no AudioContext.
    }
  }

  playReload(stage: ReloadStage): void {
    this.blip(stage === 'seated' ? 660 : 440, 0.05, 0.12);
  }

  playDryFire(): void {
    this.blip(1200, 0.03, 0.1);
  }

  /** Short square click (reload stages, dry fire), voiced under sfx. */
  private blip(freq: number, dur: number, vol: number): void {
    try {
      const ctx = this.ensure();
      if (!ctx || !this.sfx) return;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(this.sfx);
      osc.start(t);
      osc.stop(t + dur + 0.01);
    } catch {
      // Audio is garnish; a headless harness has no AudioContext.
    }
  }

  /** Lazily create the context and the sfx -> master -> destination chain. */
  private ensure(): AudioContext | null {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        void this.ctx.resume().catch(() => undefined);
      }
      return this.ctx;
    }
    if (typeof window === 'undefined') return null;
    const AC = window.AudioContext
      ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = this.masterLevel;
    master.connect(ctx.destination);
    const sfx = ctx.createGain();
    sfx.gain.value = this.sfxLevel;
    sfx.connect(master);
    const len = Math.floor(ctx.sampleRate * 0.25);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.ctx = ctx;
    this.master = master;
    this.sfx = sfx;
    this.noiseBuf = buf;
    return ctx;
  }

  /** Deterministic buffer offsets (mulberry32), so bursts stay reproducible. */
  private rand(): number {
    let a = (this.rngState + 0x6d2b79f5) | 0;
    this.rngState = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}
