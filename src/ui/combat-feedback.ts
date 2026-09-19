/**
 * Nuketown 2025 — floating combat text: the local player's confirmed hits as
 * pooled damage numbers in the HUD layer.
 *
 * Owned by the combat-feedback lane (2026-09-19). Reads the ONE vocabulary
 * (`game/events.ts`, types only) and nothing else at runtime: the module is a
 * leaf, DOM-free of globals, scene-free, and mutates no gameplay state. Every
 * host-specific capability arrives through `CombatFeedbackPorts`, so the
 * actual module — not a parallel copy — runs headlessly under
 * `scripts/game/verify-combat-feedback.mjs` on Node's erasable-TS support.
 *
 * Admission contract (defense in depth; the host has already admitted):
 *   - `type === 'damage'` only, with `attackerId === localActorId()` —
 *     spectated, nonlocal and world damage (`attackerId === null`) show
 *     nothing;
 *   - `victimId !== attackerId` — never self-damage;
 *   - `attackerTeam !== victimTeam` — friendly hits produce nothing;
 *   - finite `amount > 0` and finite `healthAfter`;
 *   - full-tuple duplicate rejection over a bounded recent memory. The host
 *     emits one admitted event per resolved hit application
 *     (`host-shot.ts` resolves one target per admitted shot), so an
 *     identical repeat inside the memory window is a double delivery, not a
 *     second bullet.
 *
 * Placement: the number anchors at the VICTIM's world position through the
 * injected projector. `sourceX`/`sourceZ` is the ATTACK ORIGIN (the
 * damage-arc field, `HudApi.damageFrom`) and is never read here. With no
 * victim position, or when `project` reports behind-camera/offscreen (null),
 * the number falls back to a screen-anchored marker orbiting the crosshair
 * anchor at a deterministic per-victim offset.
 *
 * Bounds: at most `CFB_POOL_MAX` DOM nodes exist, ever — active plus pooled.
 * Rapid hits on one victim merge into one accumulating number inside
 * `CFB_MERGE_MS`; a second engagement on the same victim recycles the first.
 * One self-stopping frame callback expires popups; there are no per-popup
 * timers. `reset()` clears everything and advances the epoch (so replayed
 * events under a NEW match are admitted again); a `match-phase: warmup`
 * event resets automatically. `dispose()` unsubscribes, clears and detaches.
 *
 * The critical read is the host's own zone field: `head` styles as critical.
 * No random crit chance exists anywhere in this file.
 */

import type { DamageEvent, GameEvent, Vec3 } from '../game/events';

// ---------------------------------------------------------------------------
// Capacity — the authority for how much feedback exists
// ---------------------------------------------------------------------------

/** DOM nodes the layer may hold, active and pooled together. */
export const CFB_POOL_MAX = 24;
/** A popup's visible lifetime, refreshed when another hit merges in. */
export const CFB_LIFETIME_MS = 900;
/** Hits on one victim inside this window merge into one number. */
export const CFB_MERGE_MS = 140;
/** Bounded recent-event memory for duplicate rejection. */
export const CFB_DEDUPE_MAX = 128;
/** Outer radius of the anchored fallback's orbit around the crosshair. */
export const CFB_ANCHOR_RADIUS_PX = 46;

// ---------------------------------------------------------------------------
// The ports — everything host-specific, injected (IMPORT-PLAN §5.3 shape)
// ---------------------------------------------------------------------------

/** The sliver of DOM the module touches. A real HTMLElement satisfies it. */
export interface FeedbackElement {
  className: string;
  textContent: string;
  readonly style: CSSStyleDeclaration;
  setAttribute(name: string, value: string): void;
  appendChild(child: FeedbackElement): unknown;
  remove(): void;
}

/** The container the layer lives in; `#hud` in the shipped wiring. */
export interface FeedbackContainer {
  readonly ownerDocument: { createElement(tag: string): FeedbackElement };
  appendChild(child: FeedbackElement): unknown;
  removeChild(child: FeedbackElement): unknown;
}

export interface CombatFeedbackPorts {
  /** Every game event the presentation path already sees. Returns unsubscribe. */
  subscribe(fn: (e: GameEvent) => void): () => void;
  /** The local human's actor id; null while idle or spectating — nothing shows. */
  localActorId(): string | null;
  /** Victim world position; null when unknown. NEVER the event's sourceX/sourceZ. */
  victimPosition(id: string): Vec3 | null;
  /** World → layer pixels; null when behind the camera or offscreen. */
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  /** Screen point the anchored fallback orbits (the crosshair). */
  anchor(): { x: number; y: number };
  /** Monotonic presentation clock. */
  now(): number;
  /** The one frame callback; returns its cancel. `requestAnimationFrame` ships. */
  schedule(cb: () => void): () => void;
  /** Reduced-motion preference; still mode fades instead of rising. */
  reducedMotion(): boolean;
  /** The HUD container the layer is appended to (#hud children hide with it). */
  container: FeedbackContainer;
}

export interface CombatFeedbackStats {
  readonly active: number;
  readonly pooled: number;
  readonly seenEvents: number;
  readonly epoch: number;
  readonly disposed: boolean;
}

export interface CombatFeedback {
  /** Clear popups and duplicate memory; advance the epoch. New match. */
  reset(): void;
  /** Unsubscribe, clear, detach the layer. Dead afterwards. */
  dispose(): void;
  /** Observable state for the CPU proof and diagnostics. */
  readonly stats: CombatFeedbackStats;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Popup {
  el: FeedbackElement;
  num: FeedbackElement;
  victimId: string;
  amount: number;
  /** Born OR last merged; both lifetime and merge window read it. */
  bornAt: number;
  critical: boolean;
  lethal: boolean;
  anchored: boolean;
}

interface PoolNode {
  el: FeedbackElement;
  num: FeedbackElement;
}

/** FNV-1a — a stable per-victim scatter for the anchored fallback. */
function hashId(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function dedupeKey(e: DamageEvent): string {
  return (
    e.at + '|' + e.attackerId + '|' + e.victimId + '|' + e.amount + '|' +
    e.zone + '|' + e.cause + '|' + e.weaponId + '|' + e.healthAfter
  );
}

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------

export function createCombatFeedback(ports: CombatFeedbackPorts): CombatFeedback {
  const doc = ports.container.ownerDocument;
  const layer = doc.createElement('div');
  layer.className = 'cfb-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.setAttribute('role', 'presentation');
  ports.container.appendChild(layer);

  const pool: PoolNode[] = [];
  const actives: Popup[] = [];
  const byVictim = new Map<string, Popup>();
  const seen = new Set<string>();
  const seenOrder: string[] = [];
  let epoch = 0;
  let disposed = false;
  let animFlip = 0;
  let pendingCancel: (() => void) | null = null;

  function makeNode(): PoolNode {
    const el = doc.createElement('div');
    const num = doc.createElement('span');
    el.appendChild(num);
    return { el, num };
  }

  /**
   * Pop a pooled node (or make one) and hang it on the layer again. The cap
   * is the contract: with the pool dry at `CFB_POOL_MAX` actives, the OLDEST
   * popup is released and its node reused, so the layer never grows.
   */
  function takeNode(): PoolNode {
    if (pool.length === 0 && actives.length >= CFB_POOL_MAX) {
      let oldest = 0;
      for (let i = 1; i < actives.length; i++) {
        if (actives[i].bornAt < actives[oldest].bornAt) oldest = i;
      }
      release(actives[oldest]);
    }
    const n = pool.pop() ?? makeNode();
    layer.appendChild(n.el);
    return n;
  }

  function release(p: Popup): void {
    p.el.remove();
    byVictim.delete(p.victimId);
    const i = actives.indexOf(p);
    if (i >= 0) actives.splice(i, 1);
    pool.push({ el: p.el, num: p.num });
  }

  function tick(): void {
    pendingCancel = null;
    if (disposed) return;
    const now = ports.now();
    for (let i = actives.length - 1; i >= 0; i--) {
      if (now - actives[i].bornAt >= CFB_LIFETIME_MS) release(actives[i]);
    }
    // One self-stopping frame callback: no timers while the layer is idle.
    if (actives.length > 0) pendingCancel = ports.schedule(tick);
  }

  function ensureLoop(): void {
    if (pendingCancel === null && !disposed) pendingCancel = ports.schedule(tick);
  }

  function paint(p: Popup, flip: number): void {
    let cls = 'cfb-num';
    if (p.critical) cls += ' cfb-crit';
    if (p.lethal) cls += ' cfb-lethal';
    if (p.anchored) cls += ' cfb-anchored';
    p.el.className = cls;
    p.num.className = 'cfb-t ' + (flip === 0 ? 'cfb-a' : 'cfb-b');
    p.num.textContent = String(Math.round(p.amount));
  }

  function place(p: Popup, x: number, y: number): void {
    p.el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
  }

  /** Re-project a world-anchored popup; keeps the last good spot on failure. */
  function reposition(p: Popup): void {
    if (p.anchored) return;
    const pos = ports.victimPosition(p.victimId);
    if (pos === null) return;
    const pr = ports.project(pos.x, pos.y, pos.z);
    if (pr !== null) place(p, pr.x, pr.y);
  }

  function mergeInto(p: Popup, e: DamageEvent, now: number): void {
    p.amount += e.amount;
    p.critical = p.critical || e.zone === 'head';
    p.lethal = p.lethal || e.healthAfter <= 0;
    p.bornAt = now;
    paint(p, animFlip);
    reposition(p);
  }

  function present(e: DamageEvent): void {
    const now = ports.now();
    layer.className = 'cfb-layer' + (ports.reducedMotion() ? ' cfb-still' : '');

    const existing = byVictim.get(e.victimId);
    if (existing !== undefined) {
      if (now - existing.bornAt <= CFB_MERGE_MS) {
        mergeInto(existing, e, now);
        return;
      }
      release(existing); // a new engagement on the same victim: fresh number
    }

    // VICTIM placement. `sourceX/sourceZ` is the attack origin and is never read.
    let x = 0;
    let y = 0;
    let anchored = true;
    const pos = ports.victimPosition(e.victimId);
    if (pos !== null) {
      const pr = ports.project(pos.x, pos.y, pos.z);
      if (pr !== null) {
        x = pr.x;
        y = pr.y;
        anchored = false;
      }
    }
    if (anchored) {
      const a = ports.anchor();
      const h = hashId(e.victimId);
      const ang = ((h % 720) / 720) * Math.PI * 2;
      const r = 26 + ((h >>> 9) % (CFB_ANCHOR_RADIUS_PX - 26));
      x = a.x + Math.cos(ang) * r;
      y = a.y + Math.sin(ang) * r * 0.75;
    }

    animFlip ^= 1; // alternating animation class restarts the rise on reuse
    const node = takeNode();
    const popup: Popup = {
      el: node.el,
      num: node.num,
      victimId: e.victimId,
      amount: e.amount,
      bornAt: now,
      critical: e.zone === 'head',
      lethal: e.healthAfter <= 0,
      anchored,
    };
    actives.push(popup);
    byVictim.set(e.victimId, popup);
    place(popup, x, y);
    paint(popup, animFlip);
    ensureLoop();
  }

  const listener = (e: GameEvent): void => {
    if (disposed) return;
    if (e.type !== 'damage') {
      // A freshly built match clears the layer; `ended` lets numbers fade.
      if (e.type === 'match-phase' && e.phase === 'warmup') reset();
      return;
    }
    const local = ports.localActorId();
    if (local === null || e.attackerId !== local || e.victimId === local) return;
    if (e.attackerTeam === null || e.attackerTeam === e.victimTeam) return;
    if (!Number.isFinite(e.amount) || e.amount <= 0 || !Number.isFinite(e.healthAfter)) return;
    const key = dedupeKey(e);
    if (seen.has(key)) return;
    if (seen.size >= CFB_DEDUPE_MAX) {
      const old = seenOrder.shift();
      if (old !== undefined) seen.delete(old);
    }
    seen.add(key);
    seenOrder.push(key);
    present(e);
  };
  const unsubscribe = ports.subscribe(listener);

  function reset(): void {
    while (actives.length > 0) release(actives[0]);
    seen.clear();
    seenOrder.length = 0;
    epoch++;
  }

  return {
    reset,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (pendingCancel !== null) {
        pendingCancel();
        pendingCancel = null;
      }
      unsubscribe();
      reset();
      ports.container.removeChild(layer);
    },
    get stats(): CombatFeedbackStats {
      return {
        active: actives.length,
        pooled: pool.length,
        seenEvents: seen.size,
        epoch,
        disposed,
      };
    },
  };
}
