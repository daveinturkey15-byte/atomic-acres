/**
 * Atomic Acres — ordnance input: G/Q arm-hold-throw, V knife, E hold-to-use.
 *
 * Owned by `WeaponsController`, which forwards the keys and sends the claims
 * this class queues. It turns key edges into `OrdnanceHand` poses and into
 * CLAIM MOMENTS — the weapon id to author a `ShotClaim` for, at the frame the
 * grenade leaves the hand, the blade lands, or the use-hold matures — and
 * nothing else. It resolves nothing: the host decides whether the grenade was
 * there to arm, whether the knife reached, whether a drop was in range, and
 * answers with an event the HUD renders (IMPORT-PLAN §5.4).
 *
 * The LEVEL the host publishes (charges held, what is armed) is pushed in by
 * `setLevel` every frame. It gates the raise so a player with no grenade does
 * not lift an empty hand, and it is the only thing that can un-arm the hand:
 * a raise the host refused, or a frag it detonated in the hand, both arrive as
 * `armed === null` and `OrdnanceHand.setHeld` puts the hand down.
 *
 * Keys are the `bindings.ts` defaults (G grenade, E use) plus Q for the
 * tactical and V for the knife: F is `core/player.ts`'s fly toggle and cannot
 * also be the knife without entering fly mode on every stab.
 */
import type * as THREE from 'three';
import type { MaterialLibrary } from '../core/materials';
import { KNIFE_ID, LETHAL_IDS, PICKUP_ID, TACTICAL_IDS } from '../game/ordnance';
import { OrdnanceHand } from './ordnance-hand';

/** How long E is held before the pickup claim goes. The prompt says "hold". */
export const USE_HOLD_S = 0.3;
/** How long a release waits for the host to confirm the arm before it is dropped. Ten host ticks. */
export const RELEASE_WAIT_S = 0.5;

export const KEY_LETHAL = 'KeyG';
export const KEY_TACTICAL = 'KeyQ';
export const KEY_KNIFE = 'KeyV';
export const KEY_USE = 'KeyE';

export class OrdnanceInput {
  readonly hand: OrdnanceHand;
  /** The host's level, as last pushed. */
  lethal = 0;
  tactical = 0;
  tacticalId: string = TACTICAL_IDS[0];
  armed: string | null = null;

  private useSince = -1;
  private useFired = false;
  private releaseWaiting = false;
  private releaseSince = 0;
  private nowS = 0;
  /** Weapon ids to claim, oldest first. Empty on almost every frame. */
  private readonly pending: string[] = [];

  constructor(mat: MaterialLibrary, overlay: THREE.Scene) {
    this.hand = new OrdnanceHand(mat, overlay);
  }

  /** A throw, swing or reach is in progress: the trigger waits. */
  get busy(): boolean { return this.hand.busy; }
  get holding(): boolean { return this.hand.holding; }

  setLevel(lethal: number, tactical: number, tacticalId: string, armed: string | null): void {
    this.lethal = lethal;
    this.tactical = tactical;
    this.tacticalId = tacticalId;
    this.armed = armed;
    this.hand.setHeld(armed);
  }

  /** The next claim to author, or null. The controller drains this each frame. */
  takeClaim(): string | null {
    return this.pending.length === 0 ? null : (this.pending.shift() as string);
  }

  /**
   * Pin out: the claim goes and the hand rises, whatever the level says. The
   * host is the authority on whether there was a grenade to arm; if it says
   * `no-grenade` the feed shows the label and `setHeld(null)` puts the hand
   * back down within `ARM_CONFIRM_S`. Gating the RAISE on the client's copy
   * of the count was tried and was worse: the copy is stale for a host tick
   * after every spawn, and a G in that window armed a grenade on the host
   * behind an empty hand - a cook nobody could see.
   */
  arm(grenadeId: string): boolean {
    if (this.hand.busy || this.hand.holding) return false;
    this.pending.push(grenadeId);
    return this.hand.arm(grenadeId);
  }

  /** Let it go: the release claim is queued when the hand reaches the release frame. */
  release(): boolean {
    return this.hand.release();
  }

  swing(nowMs: number): boolean {
    return this.hand.swing(nowMs);
  }

  cancel(): void {
    this.hand.cancel();
    this.useSince = -1;
    this.useFired = false;
    this.releaseWaiting = false;
    this.pending.length = 0;
  }

  setVisible(v: boolean): void {
    this.hand.setVisible(v);
    if (!v) this.cancel();
  }

  /** True when the key was one of ours. `nowMs` is the controller's claim clock. */
  keyDown(code: string, nowMs: number): boolean {
    switch (code) {
      case KEY_LETHAL:
        this.arm(LETHAL_IDS[0]);
        return true;
      case KEY_TACTICAL:
        this.arm(this.tacticalId);
        return true;
      case KEY_KNIFE:
        this.swing(nowMs);
        return true;
      case KEY_USE:
        if (this.useSince < 0) { this.useSince = this.nowS; this.useFired = false; }
        return true;
      default:
        return false;
    }
  }

  keyUp(code: string): boolean {
    switch (code) {
      case KEY_LETHAL:
      case KEY_TACTICAL:
        this.release();
        return true;
      case KEY_USE:
        this.useSince = -1;
        this.useFired = false;
        return true;
      default:
        return false;
    }
  }

  /** QA and the scripted browser proof drive the same edges the keys do. */
  command(cmd: string, arg?: string | number | boolean, nowMs = 0): unknown {
    switch (cmd) {
      case 'grenade': {
        // Arm on the first call, release on the second - the two claims a throw is.
        if (this.hand.holding) return this.release() ? 'released' : 'refused';
        const id = typeof arg === 'string' ? arg : LETHAL_IDS[0];
        return this.arm(id) ? 'armed' : 'refused';
      }
      case 'knife':
        return this.swing(nowMs);
      case 'use':
        this.pending.push(PICKUP_ID);
        return this.hand.reach();
      case 'ordnance':
        return {
          hand: this.hand.current, phase: +this.hand.phase.toFixed(2), lethal: this.lethal, tactical: this.tactical,
          tacticalId: this.tacticalId, armed: this.armed, pending: this.pending.length,
        };
      default:
        return undefined;
    }
  }

  /**
   * Advance the hand and mature the use-hold. Returns how far (0..1) the gun
   * should lower this frame. `time` is seconds, the controller's frame clock.
   */
  update(dt: number, camPos: THREE.Vector3, camQuat: THREE.Quaternion, time: number, bobX: number, bobY: number): number {
    this.nowS = time;
    const lower = this.hand.update(dt, camPos, camQuat, time, bobX, bobY);
    if (this.hand.consumeRelease()) { this.releaseWaiting = true; this.releaseSince = time; }
    // The release claim goes only once the host has CONFIRMED the arm (the
    // level says this grenade is in hand). A release the host receives with
    // nothing armed reads as a fresh arm - and the first browser run cooked
    // one off in the player's hand that way after the arm claim had been
    // refused. Unconfirmed past RELEASE_WAIT_S, the release is dropped; the
    // refused arm has already brought the hand down.
    if (this.releaseWaiting) {
      if (this.armed === this.hand.grenadeId) {
        this.pending.push(this.hand.grenadeId);
        this.releaseWaiting = false;
      } else if (time - this.releaseSince > RELEASE_WAIT_S) {
        this.releaseWaiting = false;
      }
    }
    if (this.hand.consumeStrike()) this.pending.push(KNIFE_ID);
    if (this.useSince >= 0 && !this.useFired && time - this.useSince >= USE_HOLD_S) {
      this.useFired = true;
      this.pending.push(PICKUP_ID);
      this.hand.reach();
    }
    return lower;
  }
}
