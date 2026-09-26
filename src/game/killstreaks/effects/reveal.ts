import type { ActorId } from '../../events';

export interface RevealSample {
  readonly id: ActorId;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface RadarSample extends RevealSample {
  readonly source: 'recon' | 'dart';
  /** Monotonic pulse number that captured this sample. */
  readonly pulse: number;
  readonly expiresAt: number;
}
