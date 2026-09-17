/**
 * Atomic Acres — UI entry point.
 *
 * main.ts wiring: place this after the startOverlay setup (~line 101):
 *
 *   import { initUI } from './ui/index';
 *   const { hud } = initUI({ player, world });
 *
 * initUI builds the HUD (sibling-owned initHud), builds the menus inside the
 * existing #start overlay, and starts an rAF loop that pushes player state
 * into the HUD every frame. The returned `hud` handle is for the weapons
 * agent (ammo / hitmarker / damage pushes).
 */
import { initHud, type HudApi } from './hud';
import { initMenus } from './menus';

/** Speed above which the crosshair counts the player as moving. */
const MOVING_EPS = 0.5;

export function initUI(deps: { player: any; world: any }): { hud: HudApi } {
  const hud = initHud();
  initMenus({ hud, player: deps.player, world: deps.world });

  const pushState = (): void => {
    try {
      const st = deps.player.state;
      hud.setPlayer(st.pos.x, st.pos.z, st.yaw);
      hud.setMoving(Math.hypot(st.vel.x, st.vel.z) > MOVING_EPS);
    } catch {
      // Player not ready yet — next frame will pick it up.
    }
    requestAnimationFrame(pushState);
  };
  requestAnimationFrame(pushState);

  return { hud };
}
