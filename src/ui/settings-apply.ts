/**
 * Atomic Acres — where a setting becomes a change in the renderer or the
 * controls, and the honest record of which ones can.
 *
 * Three kinds of option, named per key in `OPTION_STATUS` so the panel can
 * say it beside the control instead of pretending:
 *
 *   live      applied the moment the control moves, through a public handle
 *             (`world.camera`, `world.sun.shadow.mapSize`, `renderer.setPixelRatio`
 *             + `world.resize`, `world.post.setEffects` / `setFog`,
 *             `world.atmosphere.set` / `setWeather`) or through one of the two SHIMS below.
 *   shim      applied live by intercepting input before its consumer sees it,
 *             because the consumer (`core/player.ts`, `weapons/controller.ts`)
 *             is another lane's file and has no setter yet. Each shim probes
 *             for the real setter first and steps aside when it exists.
 *   persist   saved and shown, consumed by nobody in this build: weapon motion
 *             has no reader yet. Audio gains use `ApplyTargets.audio.setVolumes`.
 *             The plumbing here reads them off the settings object the moment
 *             they land.
 *
 * FOV, and why it is a shim. `weapons/controller.ts` writes
 * `camera.fov = BASE_FOV + (adsFov - BASE_FOV) * adsT` on every frame it
 * differs by more than 0.01°, so a value written to `camera.fov` from here
 * lasts one frame — the old "FOV slider" was dead in play. The shim wraps
 * `camera.updateProjectionMatrix` to build the matrix from
 * `fov * (setting / BASE_FOV)` and restore the field, so the controller keeps
 * its own bookkeeping, hip and ADS scale together (the way most shooters
 * treat an FOV option), and a default of 72 is bit-identical to today.
 *
 * EFFECTS HONESTY. `world.post.setEffects` / `setFog` are uniform(1) writes into
 * the existing graph: no node, material or light changes, so a toggle costs
 * nothing and cannot invalidate a program. Where the chain never built
 * (WebGL2 / `off` fallback) the same calls only update remembered values —
 * nothing is rendered from them. `probeApplied` therefore reports the chain's
 * own `getEffects()` / `getFog()` plus `post.enabled`: a proof that claims an
 * effect is ACTIVE must check `enabled`, never the slider.
 */
import type { HudApi } from './hud';
import { remapTable, streakBindingCodes } from './bindings';
import { accessibilityOf, type Settings } from './settings';
import type { TodName, WeatherName } from '../core/atmosphere';

/** `weapons/controller.ts:BASE_FOV`. A mirror, flagged: the setter request retires it. */
const CONTROLLER_BASE_FOV = 72;
/** `core/player.ts` mousemove gain. A mirror, flagged: `setSensitivity` retires it. */
const PLAYER_LOOK_GAIN = 0.0022;
void PLAYER_LOOK_GAIN;

export type OptionStatus = 'live' | 'shim' | 'persist';
export const OPTION_STATUS: Readonly<Record<string, OptionStatus>> = Object.freeze({
  quality: 'live', fov: 'shim', sensitivity: 'live', invertY: 'live', bindings: 'shim',
  shadowMapSize: 'live', resolutionScale: 'live', netOverlay: 'live',
  reducedMotion: 'live', damageFlashScale: 'live',
  ao: 'live', ssr: 'live', bloom: 'live', fog: 'live', tod: 'live', weather: 'live',
  masterVolume: 'live', effectsVolume: 'live', weaponMotionScale: 'persist',
});
export const STATUS_NOTE: Readonly<Record<OptionStatus, string>> = Object.freeze({
  live: 'applies now',
  shim: 'applies now (input shim until the module grows a setter)',
  persist: 'saved; no consumer in this build yet',
});

/** Minimal surface the menus actually use — probed, never assumed. */
export interface MenuPlayer {
  setFreeCursorLook?: (enabled: boolean) => void;
  setMenuInputSuspended?: (suspended: boolean) => void;
  setSensitivity?: (v: number) => void;
  setInvertY?: (v: boolean) => void;
  setBindings?: (b: Readonly<Record<string, string>>) => void;
}

/** Structural post handle: `world.post` (`core/post.ts:PostChain`). Uniform writes only. */
export interface MenuPost {
  readonly enabled: boolean;
  readonly backend: 'webgpu' | 'webgl2' | 'off';
  setEffects: (e: { ao: boolean; ssr: boolean; bloom: boolean }) => void;
  getEffects: () => { ao: boolean; ssr: boolean; bloom: boolean };
  setFog: (enabled: boolean) => void;
  getFog: () => boolean;
  setAtmosphere?: (preset: TodName, weather: WeatherName) => boolean;
}

/** Structural atmosphere handle (`core/atmosphere.ts:Atmosphere`). Preset switches only. */
export interface MenuAtmosphere {
  tod: () => TodName;
  weather: () => WeatherName;
  set: (tod: TodName) => boolean;
  setWeather: (weather: WeatherName) => boolean;
}

/**
 * Offered audio hook for the audio lane. Optional: absent in this build, so the
 * volume sliders persist and `applySettings` simply has somewhere to send them
 * the moment this hook lands. Desired integration: the audio owner reads
 * `settings.masterVolume` / `settings.effectsVolume` (0..1) at startup and on
 * every change through exactly `audio.setVolumes(master, effects)`.
 */
export interface MenuAudio {
  setVolumes?: (master: number, effects: number) => void;
}

export interface MenuWorld {
  camera?: {
    fov: number;
    updateProjectionMatrix: () => void;
    projectionMatrix?: { elements: ArrayLike<number> };
  };
  renderer?: {
    domElement?: HTMLCanvasElement;
    setPixelRatio?: (v: number) => void;
    getPixelRatio?: () => number;
  };
  sun?: { shadow: { mapSize: { set: (w: number, h: number) => unknown; width: number }; map?: { width: number } | null } };
  /** Present at runtime: `main.ts` passes the whole `World`, which owns both. */
  post?: MenuPost;
  atmosphere?: MenuAtmosphere;
  resize?: () => void;
}

export interface ApplyTargets {
  player: MenuPlayer;
  world: MenuWorld;
  hud: HudApi;
  audio?: MenuAudio;
}

/** What the proof reads back: the measurable effect of each live option. */
export interface AppliedProbe {
  fov: number;
  /** `projectionMatrix[5]` = 1 / tan(fov / 2): the projection itself. */
  projY: number | null;
  drawingBuffer: [number, number];
  pixelRatio: number | null;
  shadowMapSize: number | null;
  /** The shadow render target's actual width: ShadowNode.renderShadow resizes it to mapSize each frame. */
  shadowMapActual: number | null;
  fovScale: number;
  sensitivity: number;
  invertY: boolean;
  remaps: number;
  /** The chain's own readback (`getEffects`), or null with no post handle. */
  ao: boolean | null;
  ssr: boolean | null;
  bloom: boolean | null;
  /** The chain's own haze readback (`getFog`), or null with no post handle. */
  fog: boolean | null;
  /**
   * False on the WebGL2/`off` fallback: the toggles above are remembered there,
   * not rendered. A proof of ACTIVE effects must require this true.
   */
  postEnabled: boolean | null;
  postBackend: 'webgpu' | 'webgl2' | 'off' | null;
  /** `atmosphere.tod()` / `weather()`, or null with no atmosphere handle. */
  tod: TodName | null;
  weather: WeatherName | null;
}

let fovScale = 1;
let fovWrapped: object | null = null;
let liveSensitivity = 1;
let liveInvert = false;
let remap: ReadonlyMap<string, string> = new Map();
let shimsInstalled = false;
const synthetic = new WeakSet<Event>();

function wrapProjection(cam: NonNullable<MenuWorld['camera']>): void {
  if (fovWrapped === cam) return;
  fovWrapped = cam;
  const original = cam.updateProjectionMatrix;
  cam.updateProjectionMatrix = function (this: { fov: number }) {
    const f = this.fov;
    this.fov = Math.min(150, f * fovScale);
    original.call(this);
    this.fov = f;
  };
}

/** Apply every setting that has somewhere to go. Idempotent; cheap; called per change. */
export function applySettings(s: Settings, t: ApplyTargets): void {
  const cam = t.world.camera;
  if (cam) {
    try {
      wrapProjection(cam);
      fovScale = s.fov / CONTROLLER_BASE_FOV;
      cam.updateProjectionMatrix();
    } catch {
      /* camera not ready; the next change applies it */
    }
  }
  try {
    const r = t.world.renderer;
    if (r?.setPixelRatio && r.getPixelRatio) {
      const want = Math.min(devicePixelRatio || 1, 2) * s.resolutionScale;
      if (Math.abs(r.getPixelRatio() - want) > 1e-3) {
        r.setPixelRatio(want);
        t.world.resize?.();
      }
    }
  } catch {
    /* renderer not ready */
  }
  try {
    const sun = t.world.sun;
    // ShadowNode.renderShadow calls shadowMap.setSize(mapSize) every frame, so
    // writing mapSize is the whole change; no light is added, removed or toggled.
    if (sun && sun.shadow.mapSize.width !== s.shadowMapSize) sun.shadow.mapSize.set(s.shadowMapSize, s.shadowMapSize);
  } catch {
    /* no sun handle */
  }
  // Post effects: uniform(1) writes into the existing graph (core/post.ts), one
  // small object per CHANGE (never per frame). No node, material or light moves.
  try {
    t.world.post?.setEffects({ ao: s.ao, ssr: s.ssr, bloom: s.bloom });
  } catch {
    /* no post handle */
  }
  try {
    t.world.post?.setFog(s.fog);
  } catch {
    /* no post handle */
  }
  // Environment: preset switches only. The atmosphere resolves numbers into the
  // SAME three lights, dome uniforms, env bytes and rain mesh — the set never
  // changes, so lightCount() is invariant (atmosphere PASS 82). Called as two
  // separate switches on purpose: the post fallback's setAtmosphere chains them
  // with &&, which would drop the weather write whenever tod is unknown.
  try {
    if (t.world.atmosphere) {
      t.world.atmosphere.set(s.tod);
      t.world.atmosphere.setWeather(s.weather);
    } else {
      t.world.post?.setAtmosphere?.(s.tod, s.weather);
    }
  } catch {
    /* no atmosphere handle */
  }
  // Audio: nobody in this build. The hook is optional so today's call is a no-op
  // and the sliders keep persisting until the audio lane lands it.
  try {
    t.audio?.setVolumes?.(s.masterVolume, s.effectsVolume);
  } catch {
    /* no audio bus */
  }
  // Controls: the real setter when it exists, the shim otherwise.
  liveSensitivity = s.sensitivity;
  liveInvert = s.invertY;
  try {
    t.player.setSensitivity?.(s.sensitivity);
    t.player.setInvertY?.(s.invertY);
    t.player.setBindings?.(s.bindings);
  } catch {
    /* no hooks */
  }
  remap = t.player.setBindings ? new Map() : remapTable(s.bindings);
  t.hud.setAccessibility(accessibilityOf(s));
  t.hud.setStreakBindings?.(streakBindingCodes(s.bindings));
}

/**
 * The two input shims. Installed once; each is inert until a setting differs
 * from its default, and inert while the menu is open (a key typed into a
 * binding capture or a callsign field must arrive as typed).
 *
 * Look: `core/player.ts` reads `movementX/Y` off a window `mousemove` in the
 * bubble phase. A capture-phase listener on the same target runs first,
 * swallows the event and re-dispatches one with scaled (and, for invert,
 * negated) movement. Sub-pixel remainders are carried so 0.5x does not round
 * every 1 px move to nothing.
 *
 * Keys: `code` is remapped through `bindings.ts:remapTable` the same way; a
 * rebound action's old key goes dead rather than doing both.
 */
export function installInputShims(t: ApplyTargets, menuOpen: () => boolean): void {
  if (shimsInstalled) return;
  shimsInstalled = true;
  let carryX = 0;
  let carryY = 0;
  addEventListener('mousemove', (e) => {
    if (synthetic.has(e) || menuOpen() || t.player.setSensitivity) return;
    if (liveSensitivity === 1 && !liveInvert) return;
    e.stopImmediatePropagation();
    const sx = e.movementX * liveSensitivity + carryX;
    const sy = e.movementY * liveSensitivity * (liveInvert ? -1 : 1) + carryY;
    const mx = Math.round(sx);
    const my = Math.round(sy);
    carryX = sx - mx;
    carryY = sy - my;
    const ev = new MouseEvent('mousemove', {
      bubbles: true, cancelable: false, view: window,
      clientX: e.clientX, clientY: e.clientY, buttons: e.buttons,
      movementX: mx, movementY: my,
    } as MouseEventInit);
    synthetic.add(ev);
    dispatchEvent(ev);
  }, true);

  const key = (e: KeyboardEvent): void => {
    if (synthetic.has(e) || remap.size === 0 || menuOpen()) return;
    const to = remap.get(e.code);
    if (to === undefined) return;
    e.stopImmediatePropagation();
    if (e.code === 'Space' || e.code === 'Tab' || to === 'Space' || to === 'Tab') e.preventDefault();
    if (to === '') return;
    const ev = new KeyboardEvent(e.type, {
      code: to, key: e.key, repeat: e.repeat, bubbles: true, cancelable: true,
      shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, altKey: e.altKey, metaKey: e.metaKey,
    });
    synthetic.add(ev);
    dispatchEvent(ev);
  };
  addEventListener('keydown', key, true);
  addEventListener('keyup', key, true);
}

/** Read back what the live options did. The proof compares this, not the slider. */
export function probeApplied(t: ApplyTargets, s: Settings): AppliedProbe {
  const cam = t.world.camera;
  const r = t.world.renderer;
  const el = r?.domElement;
  // The chain's own readback, never the slider. On the fallback the remembered
  // values come back here with postEnabled false: ACTIVE means enabled AND on.
  let ao: boolean | null = null;
  let ssr: boolean | null = null;
  let bloom: boolean | null = null;
  let fog: boolean | null = null;
  let postEnabled: boolean | null = null;
  let postBackend: AppliedProbe['postBackend'] = null;
  try {
    const p = t.world.post;
    if (p) {
      const e = p.getEffects();
      ao = e.ao;
      ssr = e.ssr;
      bloom = e.bloom;
      fog = p.getFog();
      postEnabled = p.enabled;
      postBackend = p.backend;
    }
  } catch {
    /* post not ready */
  }
  let tod: TodName | null = null;
  let weather: WeatherName | null = null;
  try {
    const a = t.world.atmosphere;
    if (a) {
      tod = a.tod();
      weather = a.weather();
    }
  } catch {
    /* atmosphere not ready */
  }
  return {
    fov: s.fov,
    projY: cam?.projectionMatrix ? cam.projectionMatrix.elements[5] : null,
    drawingBuffer: [el?.width ?? 0, el?.height ?? 0],
    pixelRatio: r?.getPixelRatio ? r.getPixelRatio() : null,
    shadowMapSize: t.world.sun?.shadow.mapSize.width ?? null,
    shadowMapActual: t.world.sun?.shadow.map?.width ?? null,
    fovScale,
    sensitivity: liveSensitivity,
    invertY: liveInvert,
    remaps: remap.size,
    ao,
    ssr,
    bloom,
    fog,
    postEnabled,
    postBackend,
    tod,
    weather,
  };
}
