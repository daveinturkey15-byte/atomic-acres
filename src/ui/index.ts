/**
 * Atomic Acres — UI entry point.
 *
 * initUI builds the HUD (sibling-owned initHud), builds the menus inside the
 * existing #start overlay, wires the input-glyph scheme, and starts an rAF
 * loop that pushes player state into the HUD every frame. The per-frame
 * pushes are cheap by construction: every HudApi setter caches its last
 * value, so a still player costs a handful of compares and zero DOM writes.
 *
 * Weapon identity arrives through the existing `window.__NT` QA surface
 * (`weaponCmd('state')`), polled at 4 Hz — weapon switches and reloads are
 * human-rate, and the poll only writes on change. This file READS that
 * surface; it never touches player/world/weapons internals. If a cheaper
 * this poll is the thing to delete.
 */
import { initHud, type HudApi } from './hud';
import { initMenus, type MenuPlayer, type MenuWorld } from './menus';
import { initGlyphScheme } from './glyphs';

/** Speed above which the crosshair counts the player as moving. */
const MOVING_EPS = 0.5;
/** Weapon-identity poll interval: switches/reloads are human-rate. */
const WEAPON_POLL_MS = 250;

/** Minimal shape initUI reads off the player each frame. */
export interface UiPlayer extends MenuPlayer {
  state: {
    pos: { x: number; z: number };
    yaw: number;
    vel: { x: number; z: number };
  };
}

export interface UiDeps {
  player: UiPlayer;
  world: MenuWorld;
}

function isWeaponState(v: unknown): v is { name: string; reloading: boolean } {
  return (
    !!v &&
    typeof v === 'object' &&
    'name' in v &&
    typeof v.name === 'string' &&
    'reloading' in v
  );
}

function readWeaponName(): { name: string; reloading: boolean } | null {
  try {
    // Cross-lane read: __NT is owned and typed by main.ts; here it is an
    // untyped window field, so narrow it before touching it.
    const win = window as unknown as Record<string, unknown>;
    const nt = win.__NT;
    if (!nt || typeof nt !== 'object' || !('weaponCmd' in nt)) return null;
    const cmd = nt.weaponCmd;
    if (typeof cmd !== 'function') return null;
    const s: unknown = (cmd as (c: string) => unknown)('state');
    if (!isWeaponState(s)) return null;
    return { name: s.name, reloading: s.reloading === true };
  } catch {
    return null;
  }
}

export function initUI(deps: UiDeps): { hud: HudApi } {
  const hud = initHud();
  initMenus({ hud, player: deps.player, world: deps.world });
  initGlyphScheme();

  try {
    // Verification + sibling-lane handle; typed at this boundary.
    const win = window as unknown as Record<string, unknown>;
    win.__AA_UI = { hud };
  } catch {
    // Headless without a full window — the returned handle still works.
  }

  let lastWeaponPoll = 0;
  const pushState = (): void => {
    try {
      const st = deps.player.state;
      hud.setPlayer(st.pos.x, st.pos.z, st.yaw);
      hud.setMoving(Math.hypot(st.vel.x, st.vel.z) > MOVING_EPS);
    } catch {
      // Player not ready yet — next frame will pick it up.
    }
    const now = performance.now();
    if (now - lastWeaponPoll > WEAPON_POLL_MS) {
      lastWeaponPoll = now;
      const ws = readWeaponName();
      if (ws) hud.setWeapon(ws.name, ws.reloading);
    }
    requestAnimationFrame(pushState);
  };
  requestAnimationFrame(pushState);

  return { hud };
}
