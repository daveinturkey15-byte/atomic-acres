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
}
