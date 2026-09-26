/** Host-authored presentation only: no hidden target ids or crate reward roll. */
export interface StreakEffectView {
  readonly kind: 'sentry' | 'dart' | 'fallout-screen' | 'strike-relay' | 'supply-crate' | 'mortar' | 'aircraft' | 'carpet-bomber';
  readonly instanceId: number;
  readonly actorId: string;
  readonly team: 0 | 1;
  readonly streakId: string;
  readonly x: number; readonly y: number; readonly z: number;
  readonly remainingMs: number;
  readonly yaw?: number; readonly aimYaw?: number;
  readonly shots?: number; readonly pulses?: number;
  readonly elapsedMs?: number; readonly fired?: number;
  readonly captureProgressMs?: number; readonly opened?: boolean;
  readonly variant?: 'yardhawk' | 'piloted-drone' | 'hunter-swarm' | 'chopper' | 'drone-swarm';
  readonly pitch?: number; readonly units?: number; readonly health?: number;
  readonly controlled?: boolean;
  readonly craft?: readonly { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly pitch: number }[];
  readonly impacts?: readonly { readonly x: number; readonly y: number; readonly z: number }[];
}
