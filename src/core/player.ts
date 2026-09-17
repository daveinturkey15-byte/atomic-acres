/**
 * First-person controller: pointer-lock look, axis-resolved AABB collision,
 * gravity, jump and step-up.
 *
 * Two things this gets right that are easy to get wrong:
 *  - dt is CLAMPED. An unclamped dt after a tab stall integrates a huge step and
 *    tunnels the player through geometry.
 *  - ground snap runs every frame while grounded, not only on landing, so walking
 *    off a kerb does not leave you hovering for a frame.
 */
import * as THREE from 'three';
import type { AABB } from './kit';
import { EYE_HEIGHT, SPAWN_A } from './layout';

const HALF_W = 0.3;          // player half-width (0.6 m capsule)
const BODY_H = 1.78;         // full standing height
const STEP_UP = 0.38;        // kerbs, stair treads, low ledges
const GRAVITY = 24.0;
const JUMP_V = 7.4;
const WALK = 5.0;
const SPRINT = 8.1;
const ACCEL = 62.0;
const FRICTION = 11.5;
const MAX_DT = 1 / 20;       // clamp: never integrate more than a 50 ms step

export interface PlayerState {
  pos: THREE.Vector3;        // feet position
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  grounded: boolean;
}

export class Player {
  readonly state: PlayerState;
  private keys = new Set<string>();
  private colliders: AABB[] = [];
  private locked = false;

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement) {
    this.state = {
      pos: new THREE.Vector3(SPAWN_A.x, 0, SPAWN_A.z),
      vel: new THREE.Vector3(),
      yaw: SPAWN_A.yaw,
      pitch: 0,
      grounded: true,
    };
    this.bind();
  }

  setColliders(list: AABB[]): void {
    this.colliders = list;
  }

  teleport(x: number, y: number, z: number, yaw = 0, pitch = 0): void {
    this.state.pos.set(x, y, z);
    this.state.vel.set(0, 0, 0);
    this.state.yaw = yaw;
    this.state.pitch = pitch;
    this.syncCamera();
  }

  private bind(): void {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    this.dom.addEventListener('click', () => {
      if (!this.locked) this.dom.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const s = 0.0022;
      this.state.yaw -= e.movementX * s;
      this.state.pitch -= e.movementY * s;
      const lim = Math.PI / 2 - 0.02;
      this.state.pitch = Math.max(-lim, Math.min(lim, this.state.pitch));
    });
  }

  /** Does the player box at this feet-position overlap anything? */
  private hits(p: THREE.Vector3, feetLift = 0): AABB | null {
    const minX = p.x - HALF_W, maxX = p.x + HALF_W;
    const minZ = p.z - HALF_W, maxZ = p.z + HALF_W;
    const minY = p.y + feetLift, maxY = p.y + BODY_H;
    for (const c of this.colliders) {
      if (maxX <= c.min.x || minX >= c.max.x) continue;
      if (maxZ <= c.min.z || minZ >= c.max.z) continue;
      if (maxY <= c.min.y || minY >= c.max.y) continue;
      return c;
    }
    return null;
  }

  /** Highest collider top under the player box, at or below `y`. */
  private groundUnder(p: THREE.Vector3, y: number): number {
    let best = 0; // the world base plane
    const minX = p.x - HALF_W, maxX = p.x + HALF_W;
    const minZ = p.z - HALF_W, maxZ = p.z + HALF_W;
    for (const c of this.colliders) {
      if (maxX <= c.min.x || minX >= c.max.x) continue;
      if (maxZ <= c.min.z || minZ >= c.max.z) continue;
      if (c.max.y <= y + 0.001 && c.max.y > best) best = c.max.y;
    }
    return best;
  }

  /** Move along one axis, resolving into contact; tries a step-up before refusing. */
  private moveAxis(axis: 'x' | 'z', amount: number): void {
    if (amount === 0) return;
    const p = this.state.pos;
    const before = p[axis];
    p[axis] = before + amount;
    if (!this.hits(p, 0.02)) return;

    // blocked - try stepping up over it
    if (this.state.grounded) {
      const y0 = p.y;
      p.y = y0 + STEP_UP;
      if (!this.hits(p, 0.02)) {
        const g = this.groundUnder(p, p.y);
        if (g <= y0 + STEP_UP + 0.001) {
          p.y = g;
          return;
        }
      }
      p.y = y0;
    }
    p[axis] = before;
    this.state.vel[axis] = 0;
  }

  update(dtRaw: number): void {
    const dt = Math.min(dtRaw, MAX_DT);
    const st = this.state;

    // ---- wish direction in the yaw frame
    const f = this.keys.has('KeyW') ? 1 : 0;
    const b = this.keys.has('KeyS') ? 1 : 0;
    const l = this.keys.has('KeyA') ? 1 : 0;
    const r = this.keys.has('KeyD') ? 1 : 0;
    let wx = r - l;
    let wz = b - f;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }

    const sin = Math.sin(st.yaw), cos = Math.cos(st.yaw);
    const dirX = wx * cos - wz * sin;
    const dirZ = wx * sin + wz * cos;

    const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? SPRINT : WALK;

    // ---- horizontal accelerate / friction
    if (len > 0) {
      st.vel.x += dirX * ACCEL * dt;
      st.vel.z += dirZ * ACCEL * dt;
      const h = Math.hypot(st.vel.x, st.vel.z);
      if (h > speed) { st.vel.x = (st.vel.x / h) * speed; st.vel.z = (st.vel.z / h) * speed; }
    } else {
      const k = Math.max(0, 1 - FRICTION * dt);
      st.vel.x *= k;
      st.vel.z *= k;
    }

    // ---- jump
    if (st.grounded && this.keys.has('Space')) {
      st.vel.y = JUMP_V;
      st.grounded = false;
    }

    st.vel.y -= GRAVITY * dt;

    this.moveAxis('x', st.vel.x * dt);
    this.moveAxis('z', st.vel.z * dt);

    // ---- vertical
    const p = st.pos;
    p.y += st.vel.y * dt;

    if (st.vel.y <= 0) {
      const g = this.groundUnder(p, p.y + 0.35);
      if (p.y <= g + 0.02) {
        p.y = g;
        st.vel.y = 0;
        st.grounded = true;
      } else {
        st.grounded = false;
      }
    } else {
      // rising - stop at a ceiling
      if (this.hits(p, 0.02)) {
        p.y -= st.vel.y * dt;
        st.vel.y = 0;
      }
      st.grounded = false;
    }

    // ---- ground snap. Runs EVERY grounded frame, not only on landing, so stepping
    // off a kerb resolves in the same frame instead of floating.
    if (st.grounded) {
      const g = this.groundUnder(p, p.y + 0.35);
      if (Math.abs(p.y - g) < STEP_UP) p.y = g;
    }

    if (p.y < -12) this.teleport(SPAWN_A.x, 0, SPAWN_A.z, SPAWN_A.yaw);

    this.syncCamera();
  }

  private syncCamera(): void {
    const st = this.state;
    this.camera.position.set(st.pos.x, st.pos.y + EYE_HEIGHT, st.pos.z);
    this.camera.rotation.set(0, 0, 0, 'YXZ');
    this.camera.rotation.y = st.yaw;
    this.camera.rotation.x = st.pitch;
  }
}
