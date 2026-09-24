/**
 * Atomic Acres — UI entry point, and the ONE place game state becomes pixels.
 *
 * `initUI` builds the HUD, builds the menus inside the existing #start overlay,
 * wires the input-glyph scheme, and starts an rAF loop that pushes player state
 * into the HUD. The per-frame pushes are cheap by construction: every HudApi
 * setter caches its last value, so a still player costs a handful of compares
 * and zero DOM writes.
 *
 * `bindClient(client)` attaches a `game/client.ts:GameClient`. Everything
 * game-shaped flows through that one seam: LEVELS from `view()` pushed every
 * frame (idempotent, cached), EDGES from `drain()` applied once each. Nothing
 * in `src/game/` knows this file exists, and nothing here decides anything —
 * if a value is wrong, it is wrong in the host.
 *
 * `bindMatch(match)` hands the menus the session facade (`game/session.ts`),
 * which is built AFTER the UI in `main.ts`. Until it is bound the menus read
 * `window.__NTGAME`, the same handle `main.ts` publishes for the harnesses, so
 * the page works either way; the explicit bind is the honest wiring.
 *
 * STYLESHEETS ARE IMPORTED HERE, not by `hud.ts` and `menus.ts`. Those two are
 * exercised headlessly by the lane proof, and a `.css` specifier is not
 * importable outside a bundler.
 */
import './hud.css';
import './menus.css';
import './lobby.css';
import { initHud, type HudApi, type ScoreRowView, type ScoreView, type StreakHudView } from './hud';
import { initMenus, type MenuHandle, type MenuPlayer, type MenuWorld } from './menus';
import { initGlyphScheme } from './glyphs';
import { initNetOverlay } from './net-overlay';
import type { ClientEdge, ClientView, GameClient } from '../game/client';
import type { MatchMode } from '../game/rules';
import type { LocalMatch } from '../game/session';
import { streakById } from '../game/killstreaks/catalog';
import { formatClock } from '../game/match';

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

export interface UiHandle {
  hud: HudApi;
  menu: MenuHandle;
  /** Attach the local projection. Pass null to detach (match over, teardown). */
  bindClient(client: GameClient | null): void;
  /** Hand the menus the session facade. `main.ts` calls this once it exists. */
  bindMatch(match: LocalMatch | null): void;
  /** Roster display names, id → name. The HUD never invents one. */
  setNames(names: Iterable<readonly [string, string]>): void;
}

/** Mode labels. A `Record<MatchMode, …>` so a new mode fails to compile here. */
const MODE_LABEL: Record<MatchMode, string> = {
  tdm: 'TEAM DEATHMATCH',
  ffa: 'FREE FOR ALL',
  domination: 'DOMINATION',
};

function isWeaponState(v: unknown): v is { name: string; reloading: boolean } {
  return !!v && typeof v === 'object' && 'name' in v && typeof v.name === 'string' && 'reloading' in v;
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

/** `main.ts` publishes the match as `__NTGAME`; read it only until `bindMatch`. */
function readWindowMatch(): LocalMatch | null {
  try {
    const g = (window as unknown as Record<string, unknown>).__NTGAME;
    return g && typeof g === 'object' && typeof (g as LocalMatch).begin === 'function' ? (g as LocalMatch) : null;
  } catch {
    return null;
  }
}

/**
 * Levels → HUD. Exported so the lane proof can drive it against a real HudApi
 * without a frame loop; that is how "assert HUD text" is measured.
 */
export function pushView(hud: HudApi, v: ClientView, names: ReadonlyMap<string, string>): void {
  if (v.health !== null) hud.setHealth(v.health);
  hud.setBlips(v.blips);
  hud.setRespawn(v.respawnMs === null ? null : v.respawnMs / 1000);
  hud.setBanner(v.banner === null ? null : v.banner.text, v.banner?.sub ?? '');

  const m = v.match;
  if (m.mode === null) {
    hud.setScore(null);
  } else {
    const rows: ScoreRowView[] = m.rows.map((r) => ({
      id: r.id,
      name: names.get(r.id) ?? r.id,
      team: r.team,
      kills: r.kills,
      deaths: r.deaths,
      score: r.score,
    }));
    const score: ScoreView = {
      mode: MODE_LABEL[m.mode],
      // One formatter, lane A's: `game/match.ts:formatClock`. There is no
      // second mm:ss anywhere in the UI.
      clock: m.msRemaining === null ? '' : formatClock(m.msRemaining),
      teamScores: m.teamScores,
      scoreLimit: m.scoreLimit,
      selfId: v.selfId,
      rows,
    };
    hud.setScore(score);
  }

  const streak: StreakHudView = {
    kills: v.streak.kills,
    slots: v.streak.slots.map((s) => ({ label: streakById(s.streakId)?.displayName ?? s.streakId, charges: s.charges })),
  };
  hud.setStreak(v.streak.slots.length === 0 ? null : streak);
}

/** Edges → HUD. One call per edge, in the order the host produced them. */
export function pushEdges(hud: HudApi, edges: readonly ClientEdge[], px: number, pz: number, yaw: number): void {
  for (const e of edges) {
    if (e.kind === 'hit') hud.hitmarker(e.marker);
    else if (e.kind === 'feed') hud.feed(e.text, e.dest, e.tone);
    else if (e.kind === 'banner') hud.setBanner(e.text, e.sub);
    else if (e.kind === 'banner-clear') hud.setBanner(null);
    else {
      hud.damageFlash();
      hud.damageFrom(e.sourceX, e.sourceZ, px, pz, yaw);
    }
  }
}

export function initUI(deps: UiDeps): UiHandle {
  const hud = initHud();
  let client: GameClient | null = null;
  let bound: LocalMatch | null = null;
  const names = new Map<string, string>();
  const matchOf = (): LocalMatch | null => bound ?? readWindowMatch();

  const menu = initMenus({ hud, player: deps.player, world: deps.world, match: matchOf, names: () => names });
  initGlyphScheme();
  const net = initNetOverlay({
    hud: document.getElementById('hud'),
    onToggle: (v) => { menu.write({ netOverlay: v }); },
  });

  const handle: UiHandle = {
    hud,
    menu,
    bindClient(c) {
      client = c;
      if (c === null) {
        hud.setScore(null);
        hud.setStreak(null);
        hud.setBanner(null);
        hud.setRespawn(null);
      }
    },
    bindMatch(m) {
      bound = m;
    },
    setNames(entries) {
      for (const [id, name] of entries) names.set(id, name);
      client?.setNames(entries);
    },
  };

  try {
    // Verification + sibling-lane handle; typed at this boundary.
    (window as unknown as Record<string, unknown>).__AA_UI = handle;
  } catch {
    // Headless without a full window — the returned handle still works.
  }

  let lastWeaponPoll = 0;
  const pushState = (): void => {
    let px = 0;
    let pz = 0;
    let yaw = 0;
    try {
      const st = deps.player.state;
      px = st.pos.x;
      pz = st.pos.z;
      yaw = st.yaw;
      hud.setPlayer(px, pz, yaw);
      hud.setMoving(Math.hypot(st.vel.x, st.vel.z) > MOVING_EPS);
    } catch {
      // Player not ready yet — next frame will pick it up.
    }
    const now = performance.now();
    if (client) {
      client.tick(now);
      pushEdges(hud, client.drain(), px, pz, yaw);
      pushView(hud, client.view(), names);
    }
    if (now - lastWeaponPoll > WEAPON_POLL_MS) {
      lastWeaponPoll = now;
      const ws = readWeaponName();
      if (ws) hud.setWeapon(ws.name, ws.reloading);
    }
    try {
      menu.tick(now);
      const want = menu.settings().netOverlay;
      if (want !== net.visible()) net.setVisible(want);
      if (want) {
        const m = matchOf();
        net.tick(now, m === null ? null : (m.netLine(now) ?? m.lobby.netLine(now)));
      }
    } catch (err) {
      // A menu fault must never stop the HUD loop; say so once per frame at most.
      console.error('[ui] menu tick', err);
    }
    requestAnimationFrame(pushState);
  };
  requestAnimationFrame(pushState);

  return handle;
}
