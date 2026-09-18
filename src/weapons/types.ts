/**
 * Weapons lane — shared vocabulary. Written by the orchestrator so the four
 * parallel units (viewmodel, effects, controller, main.ts wiring) agree on
 * names without negotiating. Small on purpose: defs and tuning live with
 * their owners.
 */
import type * as THREE from 'three';

/** A procedurally built first-person rig. Origin at the grip/trigger area. */
export interface ViewmodelRig {
  /** everything, barrel pointing down local -z */
  group: THREE.Group;
  /** empty at the barrel tip: flash anchor + tracer/shell origin frame */
  muzzle: THREE.Object3D;
  /** empty at the ejection port: shell spawn frame */
  eject: THREE.Object3D;
}

/** Per-frame movement sample. main.ts derives it from Player; read-only. */
export interface MoveSample {
  /** horizontal speed m/s */
  speed: number;
  /** speed-derived sprint gate (walk caps at 5, sprint at 8.1) */
  sprinting: boolean;
  grounded: boolean;
  /** crouch hold when a crouch input exists (main.ts does not send it yet) */
  crouched?: boolean;
}

/** Headless-readable weapon state for the QA surface and the soak test. */
export interface WeaponSnapshot {
  id: string;
  name: string;
  mag: number;
  reserve: number;
  ads: boolean;
  reloading: boolean;
  visible: boolean;
  shotsFired: number;
  /** seconds until the next pull can fire (semi/pump/bolt cadence gate) */
  cool: number;
}

/**
 * Plain readable weapon state for the HUD lane. The controller owns ONE
 * instance and mutates it in place — the HUD polls the same reference every
 * frame, no events, no allocation. Shape:
 *   weaponId/weaponName: active entry in catalog.ts (longhorn, rattler,
 *     coachman, deadeye, duster)
 *   mag/reserve/magSize: rounds in the gun, in reserve, gun capacity
 *   reloading/ads/adsT: reload flag, ADS flag, 0..1 ADS blend progress
 *   moveScale: 1 at the hip, def.adsMoveScale fully aimed — main.ts / Player
 *     wiring multiplies walk speed by this (one line, next wave)
 *   shotsFired/shotsHit: trigger pulls that fired / pulls with >= 1 pellet hit
 *   hitSeq: increments on every trigger pull that lands (the hit-marker signal:
 *     the HUD flashes its marker whenever this changes)
 *   lastDamage/lastDistance: summed pellet damage and hit distance of the most
 *     recent landing pull (0 when the last pull missed)
 *   spread: live total cone in radians (base + move + bloom) for the crosshair
 *   visible: false while the QA harness owns the camera
 */
export interface GunsHudState {
  weaponId: string;
  weaponName: string;
  mag: number;
  reserve: number;
  magSize: number;
  reloading: boolean;
  ads: boolean;
  adsT: number;
  moveScale: number;
  shotsFired: number;
  shotsHit: number;
  hitSeq: number;
  lastDamage: number;
  lastDistance: number;
  /** live total cone in radians (base + move + bloom): HUD crosshair signal */
  spread: number;
  visible: boolean;
}
