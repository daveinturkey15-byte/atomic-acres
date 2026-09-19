/**
 * Atomic Acres — where a setting becomes a change in the renderer or the
 * controls, and the honest record of which ones can.
 *
 * Three kinds of option, named per key in `OPTION_STATUS` so the panel can
 * say it beside the control instead of pretending:
 *
 *   live      applied the moment the control moves, through a public handle
 *             (`world.camera`, `world.sun.shadow.mapSize`, `renderer.setPixelRatio`
 *             + `world.resize`) or through one of the two SHIMS below.
 *   shim      applied live by intercepting input before its consumer sees it,
 *             because the consumer (`core/player.ts`, `weapons/controller.ts`)
 *             is another lane's file and has no setter yet. Each shim probes
 *             for the real setter first and steps aside when it exists.
 *   persist   saved and shown, consumed by nobody: the post chain has no
 *             AO/SSR/bloom toggle and the audio has no volume hook. The exact
 *             setters are listed in the lane report; the plumbing here reads
 *             them off the settings object the moment they land.
 *
 * FOV, and why it is a shim. `weapons/controller.ts` writes
 * `camera.fov = BASE_FOV + (adsFov - BASE_FOV) * adsT` on every frame it
 * differs by more than 0.01°, so a value written to `camera.fov` from here
 * lasts one frame — the old "FOV slider" was dead in play. The shim wraps
 * `camera.updateProjectionMatrix` to build the matrix from
 * `fov * (setting / BASE_FOV)` and restore the field, so the controller keeps
 * its own bookkeeping, hip and ADS scale together (the way most shooters
 * treat an FOV option), and a default of 72 is bit-identical to today.
 */

import type { HudApi } from './hud';
import { remapTable } from './bindings';
import { accessibilityOf, type Settings } from './settings';

/** `weapons/controller.ts:BASE_FOV`. A mirror, flagged: the setter request retires it. */
const CONTROLLER_BASE_FOV = 72;
/** `core/player.ts` mousemove gain. A mirror, flagged: `setSensitivity` retires it. */
const PLAYER_LOOK_GAIN = 0.0022;
void PLAYER_LOOK_GAIN;

export type OptionStatus = 'live' | 'shim' | 'persist';
export const OPTION_STATUS: Readonly<Record<string, OptionStatus>> = Object.freeze({
  quality: 'live', fov: 'shim', sensitivity: 'shim', invertY: 'shim', bindings: 'shim',
  shadowMapSize: 'live', resolutionScale: 'live', netOverlay: 'live',
  reducedMotion: 'live', damageFlashScale: 'live',
  ao: 'persist', ssr: 'persist', bloom: 'persist',
  masterVolume: 'persist', effectsVolume: 'persist', weaponMotionScale: 'persist',
});
export const STATUS_NOTE: Readonly<Record<OptionStatus, string>> = Object.freeze({
  live: 'applies now',
  shim: 'applies now (input shim until the module grows a setter)',
  persist: 'saved; no consumer in this build yet',
});

/** Minimal surface the menus actually use — probed, never assumed. */
export interface MenuPlayer {
  setSensitivity?: (v: number) => void;
  setInvertY?: (v: boolean) => void;
  setBindings?: (b: Readonly<Record<string, string>>) => void;
}

export interface MenuWorld {
  camera?: {
    fov: number;
    updateProjectionMatrix: () => void;
    projectionMatrix?: { elements: ArrayLike<number> };
  };
  renderer?: {
    domElement?: { requestPointerLock: () => unknown; width?: number; height?: number };
    setPixelRatio?: (v: number) => void;
    getPixelRatio?: () => number;
  };
  sun?: { shadow: { mapSize: { set: (w: number, h: number) => unknown; width: number }; map?: { width: number } | null } };
  resize?: () => void;
}

export interface ApplyTargets {
  player: MenuPlayer;
  world: MenuWorld;
  hud: HudApi;
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
  };
}
