/**
 * Third-person grenade-throw BODY presentation: ordnance events → body clip.
 *
 * The one object between the client's ordnance projection and the characters'
 * rigs. It decides WHEN a body plays the throw clip and at which phase — the
 * gameplay (arm, release, fuse, cadence) stays entirely in the host; every
 * input here is a copy of an already-emitted event, the same rule the grenade
 * flight replay follows.
 *
 * Timing contract (clips.ts markers):
 * - `grenade-armed` cue  → windup plays in and HOLDS the coil
 *   (playThrowBody('anticipation')) so a body that was already reaching
 *   before the release reads the whole authored windup.
 * - `grenade-thrown` cue → playThrowBody('release'), entering AT the authored
 *   release beat (THROW_BODY_THROWN_ENTRY_S == THROW_BODY_RELEASE_S). The
 *   projectile already spawned when the event arrives, so any run-up before
 *   the beat is LAG, not lead. With a live anticipation hold the same call
 *   releases the hold into that same beat; a late notification with no
 *   `armed` cue takes the same entry.
 * - The rig's own watchdog (THROW_BODY_HOLD_MAX_S) CANCELS a held windup if
 *   the release cue never comes; it never plays an autonomous fake throw.
 *   Death and revive clear the overlay.
 *
 * The clip is a mirrored LEFT-hand authored adaptation of the H3 right-hand
 * reference (clips.ts): the left arm throws, the right arm stays at carry
 * holding the rifle baked to RightHand. No skeleton extraction is claimed.
 *
 * Cues are consumed once by a monotonic cursor. `bind` re-points at a match's
 * view (every rematch builds a new client) and re-seats the cursor so stale
 * sequences are neither replayed nor, worse, shadow-ignored forever.
 */
import type { CharacterRig } from './blend';
import type { OrdnanceView } from '../game/ordnance-view';

export class ThrowBodyPresentation {
  private view: OrdnanceView | null = null;
  private cursor = 0;
  // Every rig ever driven, until it is pruned. Without pruning this grows
  // once per distinct thrower per match: repeated despawns in one match
  // accumulate stale references even though each overlay finishes in 0.9 s.
  // The map value is the actor id the rig was resolved from plus whether its
  // root was attached at drive time, so an absent/despawned rig (resolve no
  // longer returns it) or a disposed one (attached-then-detached) can be
  // recognised and dropped. A scratch rig that was never attached is never
  // treated as disposed. Cancel-on-rebind is unchanged.
  private readonly driven = new Map<CharacterRig, { actorId: string; attached: boolean }>();

  /** A new match's view (or null at teardown). Called through `MatchUi.bindClient`. */
  bind(view: OrdnanceView | null): void {
    this.view = view;
    if (view !== null) {
      const last = view.bodyThrows[view.bodyThrows.length - 1];
      // Seat past cues that predate the bind: a client can be rebound
      // mid-match (guest rejoin), and replaying its backlog would wind up
      // bodies for throws that happened before anyone could watch.
      this.cursor = last !== undefined ? last.seq : 0;
    }
    for (const rig of this.driven.keys()) {
      try { rig.cancelThrowBody(); } catch { /* QA teardown must not throw */ }
    }
    this.driven.clear();
  }
  /**
   * Drain new cues. `resolve` maps an actor id to the body that should
   * animate it (null: the local player has no third-person body, an unknown
   * actor, or a despawned bot) — the caller owns that map, this module never
   * reaches into a scene.
   */
  update(resolve: (actorId: string) => CharacterRig | null): void {
    const view = this.view;
    if (view === null) return;
    for (const cue of view.bodyThrows) {
      if (cue.seq <= this.cursor) continue;
      this.cursor = cue.seq;
      const rig = resolve(cue.actorId);
      if (rig === null) continue;
      this.driven.set(rig, { actorId: cue.actorId, attached: rig.root.parent !== null });
      if (cue.kind === 'armed') {
        if (!rig.isDead) rig.playThrowBody('anticipation');
      } else {
        rig.playThrowBody('release');
      }
    }
    // Prune rigs whose overlay is done or whose body is gone, so repeated
    // distinct throwers in one match cannot grow this set without bound.
    // Completed (phase 'none') and dead (death cleared the overlay) drop
    // silently; disposed (root detached) and absent (resolve no longer maps
    // the actor to this rig) are cancelled first so a live overlay cannot
    // survive on a body nobody can see. Resolve failures never break the
    // presentation pass.
    for (const [rig, seen] of this.driven) {
      if (rig.throwBodyPhase === 'none' || rig.isDead) {
        this.driven.delete(rig);
        continue;
      }
      // Disposed: attached at drive time, detached now. Never fires for
      // scratch rigs that were never in a scene.
      if (seen.attached && rig.root.parent === null) {
        try { rig.cancelThrowBody(); } catch { /* teardown hygiene only */ }
        this.driven.delete(rig);
        continue;
      }
      let current: CharacterRig | null = null;
      try {
        current = resolve(seen.actorId);
      } catch {
        continue;
      }
      if (current !== rig) {
        try { rig.cancelThrowBody(); } catch { /* teardown hygiene only */ }
        this.driven.delete(rig);
      }
    }
  }
  qa(): Record<string, unknown> {
    return {
      bound: this.view !== null,
      cursor: this.cursor,
      pendingCues: this.view === null ? 0 : this.view.bodyThrows.filter((c) => c.seq > this.cursor).length,
      drivenRigs: this.driven.size,
    };
  }
}
