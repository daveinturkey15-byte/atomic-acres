/** Private host magazine projection plus exact acknowledgements for predicted
 * shots. No clock, ammo or reload completion is sent back to the host. */
import type { WeaponAmmoState, WeaponState } from '../game/host-weapon-state';

export const WEAPON_STATE_MAX_AGE_MS = 1500;
const PENDING_SHOT_CAP = 64;

/** Local projection metadata, never a peer-authored protocol field. */
export interface WeaponStateProjection extends WeaponState {
  readonly sourceAt?: number;
}

export interface WeaponAmmoProjection extends WeaponAmmoState {
  readonly reloading: boolean;
  readonly chargeProgress: number;
}

export class WeaponStateClient {
  private latest: WeaponStateProjection | null = null;
  private readonly pending = new Map<number, string>();

  get state(): WeaponStateProjection | null { return this.latest; }
  get pendingShots(): number { return this.pending.size; }

  clear(): void { this.latest = null; this.pending.clear(); }

  apply(next: WeaponStateProjection): boolean {
    const old = this.latest;
    const sourceAt = next.sourceAt ?? next.at;
    if (!Number.isFinite(sourceAt)) return false;
    // Revision is host authority; `at` has crossed the adjustable guest clock
    // offset and can move backwards even while a newer revision settles a shot.
    if (old && (next.life < old.life || (next.life === old.life &&
      (next.revision < old.revision || next.revision === old.revision && sourceAt <= (old.sourceAt ?? old.at))))) return false;
    if (!old || next.life !== old.life) this.pending.clear();
    // High-water lastShotSeq cannot acknowledge an earlier missing packet.
    for (const seq of next.resolvedShotSeqs) this.pending.delete(seq);
    for (const [seq, id] of this.pending) {
      if (id !== next.primary.weaponId && id !== next.sidearm.weaponId) this.pending.delete(seq);
    }
    this.latest = next;
    return true;
  }

  fresh(now: number): boolean {
    return this.latest !== null && now >= this.latest.at - 100 && now - this.latest.at <= WEAPON_STATE_MAX_AGE_MS;
  }

  canPredict(weaponId: string, now: number): boolean {
    const row = this.project(weaponId, now);
    return this.fresh(now) && this.pending.size < PENDING_SHOT_CAP && !!row && row.mag > 0 && !row.reloading;
  }

  predictShot(seq: number, weaponId: string): void {
    if (this.latest && this.pending.size < PENDING_SHOT_CAP) this.pending.set(seq, weaponId);
  }

  /** Only a synchronous definite non-send may retire a prediction without a
   * host ACK. Queued/accepted/unknown delivery never calls this path. */
  cancelUnsentShot(seq: number): void { this.pending.delete(seq); }

  project(weaponId: string, now: number): WeaponAmmoProjection | null {
    const state = this.latest;
    if (!state) return null;
    const row = state.primary.weaponId === weaponId ? state.primary : state.sidearm.weaponId === weaponId ? state.sidearm : null;
    if (!row) return null;
    const elapsed = Math.max(0, now - state.at);
    let outstanding = 0;
    for (const id of this.pending.values()) if (id === weaponId) outstanding++;
    const charged = row.chargeElapsedMs === null ? null : row.chargeElapsedMs + elapsed;
    return { ...row, mag: Math.max(0, row.mag - outstanding),
      // Finishing the displayed timer does not load a single round. The host
      // must publish the completed magazine and clear its reload marker.
      reloading: row.reloadRemainingMs > 0,
      reloadRemainingMs: Math.max(0, row.reloadRemainingMs - elapsed),
      chargeElapsedMs: charged,
      chargeProgress: charged === null ? 0 : Math.min(1, charged / Math.max(1, row.chargeRequiredMs)) };
  }
}
