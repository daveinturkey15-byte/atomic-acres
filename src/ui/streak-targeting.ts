/**
 * Atomic Acres — killstreak targeting mode: aim, see the ghost, one click deploys.
 *
 * Pressing a target-point / target-line slot (sentry, mortar, dart, …) arms
 * this instead of firing the press at the player's feet. Every frame the aim
 * ray is marched against the collider query until it meets standable ground;
 * a ghost (blast ring + marker post) rides that point, green when the host's
 * own `validateSentryPlacement` accepts the column, red when it refuses.
 * The deploy click submits the anchor with the press — no second confirm —
 * and Esc (or a second press of the slot) stands the mode down.
 *
 * Authority split: everything here is advisory presentation. The anchor is
 * finite-guarded by `host.ts:cleanAnchor` and re-validated by the runtime
 * before any charge moves, so a forged or stale anchor can only be refused,
 * never placed somewhere illegal.
 */

import * as THREE from 'three';
import type { Vec3, WorldQuery } from '../game/events';
import { MORTAR_BLAST_M } from '../game/killstreaks/effects/mortar';
import { validateSentryPlacement } from '../game/killstreaks/effects/sentry';
import { streakById } from '../game/killstreaks/catalog';

/** Ray-march step along the aim ray, metres. */
const MARCH_STEP_M = 0.5;
/** How far ahead of the muzzle the march gives up, metres. */
const MARCH_MAX_M = 120;
/** The ray has met ground when it sinks this far below the surface. */
const GROUND_BITE_M = 0.15;
/** Ghost ring radius for point placements without a blast (sentry, dart). */
const MARK_RING_M = 1.2;
/** Ghost post height, metres. Reads as "a thing will stand here". */
const MARK_POST_M = 1.1;

/**
 * Aim ray → ground column, using the same collider query the host answers.
 * Marches from the eye until the ray sinks below standable ground; returns
 * null past max range or when the column has no ground (over the void).
 * Pure and host-consistent: the ghost and the refusal read one rule.
 */
export function solveTargetAnchor(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  world: WorldQuery,
  maxDistM = MARCH_MAX_M,
): Vec3 | null {
  const len = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(len) || len < 1e-6) return null;
  const nx = dx / len;
  const ny = dy / len;
  const nz = dz / len;
  let farthest: Vec3 | null = null;
  for (let t = MARCH_STEP_M; t <= maxDistM; t += MARCH_STEP_M) {
    const x = ox + nx * t;
    const z = oz + nz * t;
    const y = oy + ny * t;
    const g = world.groundY(x, z);
    if (!Number.isFinite(g)) continue;
    if (world.inBounds(x, z)) farthest = { x, y: g, z };
    if (y <= g + GROUND_BITE_M) return { x, y: g, z };
  }
  // Level (or near-level) aim never sinks, but it still names a column: the
  // farthest standable one down the ray — the map edge, on a map this small.
  // Skyward aim (pitch clearly up) names nothing; the ghost stays hidden.
  if (ny > 0.05) return null;
  return farthest;
}
/** Ghost sizing per streak family. Mortar shows its real blast ring. */
function ghostRadiusM(streakId: string): number {
  if (streakId === 'blast-mortar') return MORTAR_BLAST_M;
  return MARK_RING_M;
}

const VALID_TINT = new THREE.Color(0x8fe08f);
const INVALID_TINT = new THREE.Color(0xe08f8f);
export class StreakTargeting {
  readonly group = new THREE.Group();
  private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  private readonly post: THREE.Mesh<THREE.BoxGeometry, THREE.MeshBasicMaterial>;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly postMat: THREE.MeshBasicMaterial;
  private slot = -1;
  private streakId = '';
  private point: Vec3 | null = null;
  private valid = false;

  constructor() {
    this.group.name = 'streak-targeting-ghost';
    this.group.visible = false;
    this.ringMat = new THREE.MeshBasicMaterial({ color: VALID_TINT.clone(), transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
    this.postMat = new THREE.MeshBasicMaterial({ color: VALID_TINT.clone(), transparent: true, opacity: 0.9, depthWrite: false });
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.post = new THREE.Mesh(new THREE.BoxGeometry(0.18, MARK_POST_M, 0.18), this.postMat);
    this.group.add(this.ring, this.post);
  }

  /** Arming slot, or -1 when idle. */
  get activeSlot(): number {
    return this.slot;
  }

  get active(): boolean {
    return this.slot >= 0;
  }

  /** Last solved anchor, or null when the aim has no ground. */
  anchor(): Vec3 | null {
    return this.point;
  }

  /** Whether the last solved anchor would place. */
  anchorValid(): boolean {
    return this.point !== null && this.valid;
  }

  begin(slot: number, streakId: string): void {
    this.slot = slot;
    this.streakId = streakId;
    this.point = null;
    this.valid = false;
    const r = ghostRadiusM(streakId);
    this.ring.scale.set(r, r, 1);
    this.group.visible = true;
  }

  cancel(): void {
    this.slot = -1;
    this.streakId = '';
    this.point = null;
    this.valid = false;
    this.group.visible = false;
  }

  /**
   * Ride the aim ray. Sentry/mortar/dart reuse the host's placement rule so
   * the ghost's green is the runtime's accept; unwired point streaks (crate,
   * screen, relay) preview bounds + footing, and the gate still answers.
   */
  update(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number,
    world: WorldQuery,
  ): void {
    if (!this.active) return;
    const p = solveTargetAnchor(ox, oy, oz, dx, dy, dz, world);
    this.point = p;
    if (p === null) {
      this.valid = false;
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const def = streakById(this.streakId);
    const wired = def !== null && (this.streakId === 'sentry-post' || this.streakId === 'blast-mortar' || this.streakId === 'tracker-dart');
    if (wired) {
      this.valid = validateSentryPlacement(p.x, p.z, world).ok;
    } else {
      this.valid = world.inBounds(p.x, p.z);
    }
    const tint = this.valid ? VALID_TINT : INVALID_TINT;
    this.ringMat.color.copy(tint);
    this.postMat.color.copy(tint);
    this.group.position.set(p.x, p.y + 0.05, p.z);
    this.post.position.set(0, MARK_POST_M / 2, 0);
  }
}
