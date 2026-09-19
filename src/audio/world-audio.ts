import * as THREE from 'three';
import type { AABB } from '../core/kit';
import type { MaterialLibrary } from '../core/materials';
import type { PlayerState, PlayerStance } from '../core/player';
import type { WeatherName } from '../core/atmosphere';
import type { GameClient } from '../game/client';
import type { ShotFiredEvent, Vec3 } from '../game/events';
import type { EnvironmentKind, ShotFamily, StepOptions, StepSurface } from './service';
import { EYE_HEIGHT, CROUCH_EYE, PRONE_EYE } from '../core/layout';

interface WorldAudioSink {
  footstep(surface: StepSurface, options: StepOptions): void;
  setEnvironment(kind: EnvironmentKind, level?: number): void;
  spatialShot?(family: ShotFamily, distanceM: number, pan: number, occluded?: boolean): void;
}

/** Distance-driven footsteps. Geometry is queried only when a foot lands; the
 * ray and hit array are reused. Static build groups exclude players and weapons. */
export class WorldAudio {
  private ray = new THREE.Raycaster();
  private down = new THREE.Vector3(0, -1, 0);
  private origin = new THREE.Vector3();
  private hits: THREE.Intersection[] = [];
  private materials = new Map<THREE.Material, StepSurface>();
  private stride = 0;
  private lastX = NaN;
  private lastZ = NaN;
  private lastEnvironment: EnvironmentKind | null = null;
  private lastLevel = -1;
  private foot = 0;
  private client: GameClient | null = null;
  private readonly shotScratch: ShotFiredEvent[] = [];

  constructor(
    private targets: THREE.Object3D[],
    mat: MaterialLibrary,
    private sink: WorldAudioSink,
    private readonly occluders: readonly AABB[] = [],
    private readonly lineOfSight: ((from: Vec3, to: Vec3) => boolean) | null = null,
  ) {
    this.materials.set(mat.lawn, 'grass');
    this.materials.set(mat.sand, 'gravel');
    for (const material of [mat.deckBoards, mat.timber, mat.timberDark]) this.materials.set(material, 'wood');
    for (const material of [mat.steel, mat.chrome]) this.materials.set(material, 'metal');
    this.ray.near = 0;
    this.ray.far = 1.2;
  }

  /** Bind the projection that owns remote shot edges. The queue remains client-owned. */
  bindClient(client: GameClient | null): void {
    if (this.client !== null && this.client !== client) {
      this.client.drainRemoteShots(this.shotScratch);
      this.shotScratch.length = 0;
    }
    this.client = client;
    this.shotScratch.length = 0;
  }

  update(state: PlayerState, stance: PlayerStance, active: boolean, weather: WeatherName): void {
    const environment = !active ? 'clear' : weather === 'rain' ? 'storm' : 'wind';
    const level = weather === 'rain' ? 0.8 : weather === 'clear' ? 0.28 : 0.55;
    if (environment !== this.lastEnvironment || level !== this.lastLevel) {
      this.lastEnvironment = environment;
      this.lastLevel = level;
      this.sink.setEnvironment(environment, level);
    }
    this.drainRemoteShots(state, stance);
    const { x, y, z } = state.pos;
    const distance = Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x;
    this.lastZ = z;
    // Corpse movement must not create local footsteps; weather and remote shots
    // above continue independently while the player is awaiting respawn.
    if (this.client !== null && !this.client.isAlive()) {
      this.stride = 0;
      return;
    }
    const speed = Math.hypot(state.vel.x, state.vel.z);
    // Teleports, menu movement and airborne travel must not generate steps.
    if (!active || !state.grounded || speed < 0.65 || !Number.isFinite(distance) || distance > 0.7) {
      this.stride = 0;
      return;
    }
    this.stride += distance;
    const sprint = stance === 'stand' && speed > 5.5;
    const spacing = stance === 'prone' ? 0.75 : stance === 'crouch' ? 1.1 : sprint ? 1.65 : 1.45;
    if (this.stride < spacing) return;
    this.stride %= spacing;
    this.origin.set(x, y + 0.4, z);
    this.ray.set(this.origin, this.down);
    this.hits.length = 0;
    this.ray.intersectObjects(this.targets, true, this.hits);
    let surface: StepSurface = 'concrete';
    const first = this.hits[0];
    if (first && first.object instanceof THREE.Mesh) {
      const material = Array.isArray(first.object.material)
        ? first.object.material[first.face?.materialIndex ?? 0] : first.object.material;
      surface = this.materials.get(material) ?? 'concrete';
    }
    this.hits.length = 0;
    this.foot ^= 1;
    this.sink.footstep(surface, {
      speed: Math.min(1, speed / 6.6), stance: sprint ? 'sprint' : stance,
      variant: this.foot, pan: this.foot ? 0.12 : -0.12,
    });
  }

  private drainRemoteShots(listener: PlayerState, stance: PlayerStance): void {
    const client = this.client;
    if (client === null) return;
    const count = client.drainRemoteShots(this.shotScratch);
    if (this.sink.spatialShot === undefined) {
      this.shotScratch.length = 0;
      return;
    }
    for (let i = 0; i < count; i++) {
      const shot = this.shotScratch[i];
      const earY = listener.pos.y + (stance === 'prone' ? PRONE_EYE : stance === 'crouch' ? CROUCH_EYE : EYE_HEIGHT);
      const dx = shot.x - listener.pos.x;
      const dy = shot.y - earY;
      const dz = shot.z - listener.pos.z;
      const distance = Math.hypot(dx, dy, dz);
      const right = dx * Math.cos(listener.yaw) - dz * Math.sin(listener.yaw);
      const pan = distance > 0.001 ? Math.max(-1, Math.min(1, right / distance)) : 0;
      this.sink.spatialShot(
        shotFamily(shot.weaponId),
        distance,
        pan,
        this.segmentBlocked(listener.pos.x, earY, listener.pos.z, shot.x, shot.y, shot.z),
      );
    }
    this.shotScratch.length = 0;
  }

  /** Static build AABBs only: one bounded slab test per remote shot. */
  private segmentBlocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    if (this.lineOfSight !== null) {
      this.occlusionFrom.x = ax;
      this.occlusionFrom.y = ay;
      this.occlusionFrom.z = az;
      this.occlusionTo.x = bx;
      this.occlusionTo.y = by;
      this.occlusionTo.z = bz;
      return !this.lineOfSight(this.occlusionFrom, this.occlusionTo);
    }
    for (let i = 0; i < this.occluders.length; i++) {
      const box = this.occluders[i];
      if (segmentIntersectsAabb(ax, ay, az, bx, by, bz, box)) return true;
    }
    return false;
  }

  private readonly occlusionFrom: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
  private readonly occlusionTo: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };
}

function shotFamily(id: string): ShotFamily {
  if (id === 'rattler' || id === 'coachman' || id === 'deadeye' || id === 'duster') return id;
  return 'longhorn';
}

function segmentIntersectsAabb(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  box: AABB,
): boolean {
  let lo = 0;
  let hi = 1;
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const mins = box.min;
  const maxs = box.max;
  if (Math.abs(dx) < 1e-9) { if (ax < mins.x || ax > maxs.x) return false; }
  else {
    let a = (mins.x - ax) / dx, b = (maxs.x - ax) / dx;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > lo) lo = a; if (b < hi) hi = b; if (lo > hi) return false;
  }
  if (Math.abs(dy) < 1e-9) { if (ay < mins.y || ay > maxs.y) return false; }
  else {
    let a = (mins.y - ay) / dy, b = (maxs.y - ay) / dy;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > lo) lo = a; if (b < hi) hi = b; if (lo > hi) return false;
  }
  if (Math.abs(dz) < 1e-9) { if (az < mins.z || az > maxs.z) return false; }
  else {
    let a = (mins.z - az) / dz, b = (maxs.z - az) / dz;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > lo) lo = a; if (b < hi) hi = b; if (lo > hi) return false;
  }
  return hi >= 0 && lo <= 1;
}
