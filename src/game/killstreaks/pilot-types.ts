/** Inputs carry intent only; the host owns the platform pose and lifetime. */
export interface PilotControls {
  readonly forward: number; readonly strafe: number; readonly ascend: number;
  readonly yaw: number; readonly pitch: number; readonly fire: boolean;
}
export interface PilotInput extends PilotControls { readonly seq: number }
export interface AircraftTarget {
  readonly instanceId: number; readonly actorId: string; readonly team: 0 | 1;
  readonly x: number; readonly y: number; readonly z: number;
  readonly radius: number; readonly health: number;
}
