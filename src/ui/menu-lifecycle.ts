/**
 * Atomic Acres — menu lifecycle as a pure reducer.
 *
 * Five surfaces and five pointer-lock phases, no DOM. `menus.ts` renders the
 * result; this file decides it. IMPORT-PLAN §1.5: "pointer-lock denial and
 * focus-suspension are the two states every browser FPS gets wrong, and a pure
 * reducer is the only way to test them."
 *
 * The two that get missed, and what they mean here:
 *
 *  - **denied.** `requestPointerLock()` rejects — the user pressed Escape less
 *    than a second ago, or the document is not user-activated. The old code
 *    treated the resulting null `pointerLockElement` as "the player paused",
 *    so a browser-side refusal opened the pause menu with no player input.
 *    Here a rejection while `requesting` reaches `denied` and the surface stays
 *    `hidden`: the game keeps running, the mouse is just free.
 *  - **focus-suspended.** Alt-tab drops pointer lock exactly like Escape does.
 *    Pausing on it is wrong (the match is still live for everyone else) and
 *    ignoring it is wrong (the next click must re-lock). It is its own phase,
 *    and `focus-gained` returns to `unlocked`, not to `locked`.
 *
 * `pointer-lost` carries the evidence the reducer cannot observe —
 * was this a focus transition, is an overlay open, is pausing allowed — so the
 * decision stays here instead of being spread across three DOM listeners.
 */

export const MENU_SURFACES = ['pre-match', 'deploying', 'hidden', 'paused-match', 'error'] as const;
export type MenuSurface = (typeof MENU_SURFACES)[number];

export const POINTER_LOCK_PHASES = ['unlocked', 'requesting', 'locked', 'denied', 'focus-suspended'] as const;
export type PointerLockPhase = (typeof POINTER_LOCK_PHASES)[number];

export const POINTER_LOCK_SOURCES = ['match-start', 'respawn', 'resume', 'canvas'] as const;
export type PointerLockSource = (typeof POINTER_LOCK_SOURCES)[number];

export interface MenuLifecycleState {
  readonly surface: MenuSurface;
  readonly pointerLock: PointerLockPhase;
  /** What produced this state. Useful in a bug report; never branched on. */
  readonly reason: string;
  readonly requestSource: PointerLockSource | null;
  /** Counts only states that actually differ — a no-op event does not bump it. */
  readonly transitions: number;
}

export type MenuLifecycleEvent =
  | { readonly type: 'match-start' }
  | { readonly type: 'match-ready' }
  | { readonly type: 'pointer-request'; readonly source: PointerLockSource }
  | { readonly type: 'pointer-acquired' }
  | { readonly type: 'pointer-rejected' }
  | {
      readonly type: 'pointer-lost';
      /** True when the loss came with a window blur / visibility change. */
      readonly focusTransition: boolean;
      /** True when a real player Escape may open the pause menu. */
      readonly pauseAllowed: boolean;
    }
  | { readonly type: 'focus-lost' }
  | { readonly type: 'focus-gained' }
  | { readonly type: 'pause-requested' }
  | { readonly type: 'resume' }
  | { readonly type: 'return-pre-match' }
  | { readonly type: 'fatal-error' };

export const INITIAL_MENU_STATE: MenuLifecycleState = Object.freeze({
  surface: 'pre-match',
  pointerLock: 'unlocked',
  reason: 'initial',
  requestSource: null,
  transitions: 0,
});

/** Surfaces where the player is not in the world and pointer lock is moot. */
function notPlaying(s: MenuSurface): boolean {
  return s === 'pre-match' || s === 'deploying' || s === 'error';
}

function next(
  cur: MenuLifecycleState,
  surface: MenuSurface,
  pointerLock: PointerLockPhase,
  reason: string,
  requestSource: PointerLockSource | null = null,
): MenuLifecycleState {
  const changed =
    surface !== cur.surface || pointerLock !== cur.pointerLock || requestSource !== cur.requestSource;
  return Object.freeze({
    surface,
    pointerLock,
    reason,
    requestSource,
    transitions: cur.transitions + (changed ? 1 : 0),
  });
}

/** No state change, but the event is recorded so a trace shows it arrived. */
function ignore(cur: MenuLifecycleState, reason: string): MenuLifecycleState {
  return Object.freeze({ ...cur, reason: 'ignored:' + reason });
}

export function reduceMenuLifecycle(cur: MenuLifecycleState, e: MenuLifecycleEvent): MenuLifecycleState {
  switch (e.type) {
    case 'match-start':
      return next(cur, 'deploying', 'unlocked', 'match-start');

    case 'match-ready':
      // Only a deploying match becomes playable; a stray ready cannot hide the
      // pre-match menu and strand the player in a world with no lobby.
      return cur.surface === 'deploying' ? next(cur, 'hidden', 'unlocked', 'match-ready') : ignore(cur, e.type);

    case 'pointer-request':
      if (notPlaying(cur.surface)) return ignore(cur, e.type);
      return next(cur, 'hidden', 'requesting', 'pointer-request', e.source);

    case 'pointer-acquired':
      if (notPlaying(cur.surface)) return ignore(cur, e.type);
      // Lock acquired while paused: the pause menu wins, and the caller is
      // expected to exit lock. Reporting `locked` here would hide the menu.
      if (cur.surface === 'paused-match') return next(cur, 'paused-match', 'unlocked', 'pointer-while-paused');
      return next(cur, 'hidden', 'locked', 'pointer-acquired');

    case 'pointer-rejected':
      if (cur.pointerLock !== 'requesting') return ignore(cur, e.type);
      return next(cur, 'hidden', 'denied', 'pointer-rejected');

    case 'pointer-lost': {
      if (notPlaying(cur.surface)) return ignore(cur, e.type);
      const paused = cur.surface === 'paused-match';
      if (e.focusTransition) return next(cur, paused ? 'paused-match' : 'hidden', 'focus-suspended', 'focus-loss');
      // A transient null while a request is still in flight is not a pause.
      if (cur.pointerLock !== 'locked' || !e.pauseAllowed) {
        return next(cur, paused ? 'paused-match' : 'hidden', 'unlocked', 'pointer-transient-null');
      }
      return next(cur, 'paused-match', 'unlocked', 'escape');
    }

    case 'focus-lost':
      if (notPlaying(cur.surface)) return ignore(cur, e.type);
      return next(cur, cur.surface, 'focus-suspended', 'focus-loss');

    case 'focus-gained':
      if (cur.pointerLock !== 'focus-suspended') return ignore(cur, e.type);
      return next(cur, cur.surface, 'unlocked', 'focus-return');

    case 'pause-requested':
      if (notPlaying(cur.surface)) return ignore(cur, e.type);
      return next(cur, 'paused-match', 'unlocked', 'pause-requested');

    case 'resume':
      return cur.surface === 'paused-match' ? next(cur, 'hidden', 'unlocked', 'resume') : ignore(cur, e.type);

    case 'return-pre-match':
      return next(cur, 'pre-match', 'unlocked', 'return-pre-match');

    case 'fatal-error':
      return next(cur, 'error', 'unlocked', 'fatal-error');
  }
}

/** Is the overlay on screen for this state? The one place that decides. */
export function menuVisible(s: MenuLifecycleState): boolean {
  return s.surface !== 'hidden';
}
