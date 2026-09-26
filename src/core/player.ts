/**
 * First-person controller: pointer-lock look, axis-resolved AABB collision,
 * gravity, jump and step-up — plus FLY / FLY-NOCLIP inspection modes.
 *
 * Three things this gets right that are easy to get wrong:
 *  - dt is CLAMPED. An unclamped dt after a tab stall integrates a huge step and
 *    tunnels the player through geometry.
 *  - ground snap runs every frame while grounded, not only on landing, so walking
 *    off a kerb does not leave you hovering for a frame.
 *  - the wish vector's rotation into the yaw frame agrees with the camera: world
 *    forward is (-sin yaw, 0, -cos yaw), right is (cos yaw, 0, -sin yaw). The x
 *    term's sign was wrong once and mirrored movement about the z axis - correct
 *    at yaw 0 and PI, exactly backwards at +/-PI/2. Fly uses the same frame with
 *    pitch added, so test it at 45 and 90 degrees, not just down the street.
 */
import * as THREE from 'three';
import type { AABB } from './kit';
import { EYE_HEIGHT, CROUCH_EYE, PRONE_EYE, SPAWN_A } from './layout';

const HALF_W = 0.3;          // player half-width (0.6 m capsule)
const BODY_H = 1.78;         // full standing height
const CROUCH_H = 1.16;       // crouched capsule height, measured from the feet
const PRONE_H = 0.52;         // face-down capsule height, helmet included
const STEP_UP = 0.38;        // kerbs, stair treads, low ledges
// Movement tuned to Black Ops 2 rather than picked by feel. BO2 is a Quake-lineage
// engine where 1 unit = 1 inch, gravity is 800 units/s^2 = 20.32 m/s^2, and a jump
// clears roughly 0.6 m - CoD jumps are LOW, which is a large part of why the games
// feel grounded. The previous numbers gave a 1.14 m leap, closer to an arena shooter.
//   jump speed for height h under g:  v = sqrt(2*g*h)  ->  sqrt(2*20.32*0.6) = 4.94
const GRAVITY = 20.32;
const JUMP_V = 4.94;         // ~0.60 m apex
const WALK = 4.8;            // ~190 units/s, CoD base
const SPRINT = 6.6;          // ~1.37x base, BO2 sprint multiplier
const CROUCH_SPEED = 2.75;
const PRONE_SPEED = 1.25;
const ACCEL = 62.0;
const FRICTION = 11.5;
const MAX_DT = 1 / 20;       // clamp: never integrate more than a 50 ms step

export type PlayerStance = 'stand' | 'crouch' | 'prone';

/** WALK: gravity + collision. FLY: 6-axis, no gravity, still collides. NOCLIP: through everything. */
export type MoveMode = 'walk' | 'fly' | 'noclip';
const FLY_DEFAULT = 12;      // m/s — the map is ~100 m across, walk pace is useless
const FLY_MIN = 2;
const FLY_MAX = 60;
const FLY_BOOST = 3;         // shift multiplier in fly modes

export interface PlayerState {
  pos: THREE.Vector3;        // feet position
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  grounded: boolean;
  /** Effective gameplay stance; camera/body transitions are smoothed locally. */
  stance: PlayerStance;
}

export class Player {
  readonly state: PlayerState;
  private keys = new Set<string>();
  private colliders: AABB[] = [];
  private locked = false;
  /** world-space wish direction injected by the traversability probe, or null */
  private probeWish: { x: number; z: number } | null = null;
  private mode: MoveMode = 'walk';
  private flySpeed = FLY_DEFAULT;
  private bodyHeight = BODY_H;
  private eyeHeight = EYE_HEIGHT;
  private inputSuspended = false;
  private speedMultiplier = 1;

  constructor(private camera: THREE.PerspectiveCamera, private dom: HTMLElement) {
    this.state = {
      pos: new THREE.Vector3(SPAWN_A.x, 0, SPAWN_A.z),
      vel: new THREE.Vector3(),
      yaw: SPAWN_A.yaw,
      pitch: 0,
      grounded: true,
      stance: 'stand',
    };
    this.bind();
  }

  setColliders(list: AABB[]): void {
    this.colliders = list;
  }

  /** Possession parks the real body; the pilot owns only the review camera. */
  setInputSuspended(suspended: boolean): void {
    if (suspended === this.inputSuspended) return;
    this.inputSuspended = suspended;
    this.keys.clear();
    this.probeWish = null;
    this.state.vel.set(0, 0, 0);
  }

  /** Read from the host's inventory projection, never from keyboard intent. */
  setSpeedMultiplier(value: number): void {
    this.speedMultiplier = Number.isFinite(value) ? Math.max(1, Math.min(1.25, value)) : 1;
  }

  /**
   * Drive the controller from a script in WORLD space. The probe must exercise the
   * real movement code - collision, step-up, gravity and all - because an approximation
   * would pass exactly the routes the real controller fails.
   */
  setProbeWish(x: number | null, z = 0): void {
    this.probeWish = x === null ? null : { x, z };
  }

  teleport(x: number, y: number, z: number, yaw = 0, pitch = 0): void {
    this.state.pos.set(x, y, z);
    this.state.vel.set(0, 0, 0);
    this.state.yaw = yaw;
    this.state.pitch = pitch;
    this.state.stance = 'stand';
    this.bodyHeight = BODY_H;
    this.eyeHeight = EYE_HEIGHT;
    this.syncCamera();
  }

  private bind(): void {
    addEventListener('keydown', (e) => {
      if (this.inputSuspended) return;
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
      // Inspection modes are available only to the explicit QA API. Gameplay
      // keys must never disable gravity or world collision.
      if (e.repeat) return;
      if (e.code === 'KeyZ') this.toggleProne();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    this.dom.addEventListener('click', () => {
      if (!this.locked) this.dom.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      // Esc releases the lock; drop held keys so the camera neither spins (it
      // cannot — mousemove is lock-gated below) nor keeps walking on one stuck key.
      if (!this.locked) this.keys.clear();
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked || this.inputSuspended) return;
      const s = 0.0022;
      this.state.yaw -= e.movementX * s;
      this.state.pitch -= e.movementY * s;
      const lim = Math.PI / 2 - 0.02;
      this.state.pitch = Math.max(-lim, Math.min(lim, this.state.pitch));
    });
    // Wheel adjusts fly speed only; in walk it does nothing so page/scroll
    // behaviour elsewhere is unaffected.
    this.dom.addEventListener('wheel', (e: WheelEvent) => {
      if (this.mode === 'walk') return;
      this.adjustFlySpeed(Math.exp(-e.deltaY * 0.0012));
    }, { passive: true });
  }

  // ---------------------------------------------------------- inspection modes
  getMode(): MoveMode { return this.mode; }
  getFlySpeed(): number { return this.flySpeed; }
  getStance(): PlayerStance { return this.state.stance; }
  getEyeHeight(): number { return this.eyeHeight; }
  getBodyHeight(): number { return this.bodyHeight; }
  setFlySpeed(v: number): void {
    this.flySpeed = Math.max(FLY_MIN, Math.min(FLY_MAX, v));
  }
  adjustFlySpeed(mult: number): void {
    this.setFlySpeed(this.flySpeed * mult);
  }
  /** QA only: walk <-> fly; leaving noclip always lands back in walk. */
  toggleFly(): void {
    this.setMode(this.mode === 'walk' ? 'fly' : 'walk');
  }
  /** QA only: colliding mode -> noclip; noclip -> fly. */
  toggleNoclip(): void {
    this.setMode(this.mode === 'noclip' ? 'fly' : 'noclip');
  }
  setMode(m: MoveMode): void {
    if (m === this.mode) return;
    this.mode = m;
    this.state.vel.set(0, 0, 0);
    this.state.grounded = false;
    // Coming out of noclip inside a wall would wedge a colliding mode: every
    // axis refuses and gravity cannot help. Rise to the first free spot instead.
    if (m !== 'noclip') this.depenetrate();
  }

  /**
   * Request a stance change. Standing is admitted only when the full standing
   * body fits at the current feet position; this is the headroom guard used by
   * Ctrl release, Z release, and jumping out of a low stance. Lowering never
   * needs a clearance test, so a player can crouch or go prone below a roof.
   */
  setStance(stance: PlayerStance): boolean {
    const requestedHeight = stance === 'prone' ? PRONE_H : stance === 'crouch' ? CROUCH_H : BODY_H;
    if (requestedHeight > this.bodyHeight && this.mode !== 'noclip' && !this.canOccupy(this.state.pos, requestedHeight)) {
      return false;
    }
    this.state.stance = stance;
    return true;
  }

  /** Hold/release control for the normal crouch stance. */
  setCrouch(active: boolean): boolean {
    if (this.state.stance === 'prone' && active) return false;
    return this.setStance(active ? 'crouch' : 'stand');
  }

  /** Z toggles prone. A blocked stand request leaves the player prone. */
  toggleProne(): boolean {
    return this.setStance(this.state.stance === 'prone' ? 'stand' : 'prone');
  }
  /** If the player box overlaps anything, rise in 0.5 m steps to free air. */
  private depenetrate(): void {
    const p = this.state.pos;
    if (!this.hits(p, 0.02)) return;
    for (let i = 0; i < 10; i++) {
      p.y += 0.5;
      if (!this.hits(p, 0.02)) break;
    }
    this.state.vel.set(0, 0, 0);
  }

  /** Does the player box at this feet-position overlap anything? */
  private hits(p: THREE.Vector3, feetLift = 0, height = this.bodyHeight): AABB | null {
    const minX = p.x - HALF_W, maxX = p.x + HALF_W;
    const minZ = p.z - HALF_W, maxZ = p.z + HALF_W;
    const minY = p.y + feetLift, maxY = p.y + height;
    for (const c of this.colliders) {
      if (maxX <= c.min.x || minX >= c.max.x) continue;
      if (maxZ <= c.min.z || minZ >= c.max.z) continue;
      if (maxY <= c.min.y || minY >= c.max.y) continue;
      return c;
    }
    return null;
  }

  private canOccupy(p: THREE.Vector3, height: number): boolean {
    return this.hits(p, 0.02, height) === null;
  }

  private targetBodyHeight(): number {
    if (this.state.stance === 'prone') return PRONE_H;
    if (this.state.stance === 'crouch') return CROUCH_H;
    return BODY_H;
  }

  private targetEyeHeight(): number {
    if (this.state.stance === 'prone') return PRONE_EYE;
    if (this.state.stance === 'crouch') return CROUCH_EYE;
    return EYE_HEIGHT;
  }

  /** Ease the physical capsule and camera to the admitted stance target. */
  private updateStance(dt: number): void {
    // Movement can carry a partially raised body under a new obstruction.
    // Recheck clearance throughout the transition, not only on the key edge.
    if (this.targetBodyHeight() > this.bodyHeight && !this.canOccupy(this.state.pos, this.targetBodyHeight())) {
      this.state.stance = this.canOccupy(this.state.pos, CROUCH_H) ? 'crouch' : 'prone';
    }
    const k = 1 - Math.exp(-14 * dt);
    this.bodyHeight += (this.targetBodyHeight() - this.bodyHeight) * k;
    this.eyeHeight += (this.targetEyeHeight() - this.eyeHeight) * k;
  }

  /** C/Ctrl are held; Z is a separate toggle and takes precedence. */
  private updateHeldStance(): void {
    if (this.state.stance === 'prone') return;
    const crouch = this.keys.has('KeyC') || this.keys.has('ControlLeft') || this.keys.has('ControlRight');
    this.setCrouch(crouch);
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
    if (this.inputSuspended) { this.state.vel.set(0, 0, 0); this.syncCamera(); return; }
    if (this.mode === 'walk') this.updateWalk(dt);
    else this.updateFly(dt);
    if (this.state.pos.y < -12) this.teleport(SPAWN_A.x, 0, SPAWN_A.z, SPAWN_A.yaw);
    this.syncCamera();
  }

  /**
   * Inspection flight. Wish direction is built in the camera frame WITH pitch:
   * forward is (-sin yaw * cos pitch, sin pitch, -cos yaw * cos pitch), so flying
   * forward while looking up gains height. Strafe stays horizontal in the same yaw
   * frame walk uses, so A/D never surprise. Velocity is set directly — no accel
   * lag, hard stop on release. FLY reuses moveAxis for x/z (grounded is false, so
   * no step-up: pure slide) and resolves y against slabs; NOCLIP skips collision.
   */
  private updateFly(dt: number): void {
    const st = this.state;
    const fwd = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const str = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const up = ((this.keys.has('Space') || this.keys.has('KeyE')) ? 1 : 0)
      - ((this.keys.has('KeyX') || this.keys.has('KeyQ')) ? 1 : 0);
    const sin = Math.sin(st.yaw), cos = Math.cos(st.yaw);
    const cosP = Math.cos(st.pitch), sinP = Math.sin(st.pitch);
    let dx = -sin * cosP * fwd + cos * str;
    let dy = sinP * fwd + up;
    let dz = -cos * cosP * fwd - sin * str;
    const len = Math.hypot(dx, dy, dz);
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? FLY_BOOST : 1;
    const speed = this.flySpeed * boost;
    if (len > 0) { dx = (dx / len) * speed; dy = (dy / len) * speed; dz = (dz / len) * speed; }
    else { dx = 0; dy = 0; dz = 0; }
    st.vel.set(dx, dy, dz);
    st.grounded = false;
    if (this.mode === 'noclip') {
      st.pos.x += dx * dt;
      st.pos.y += dy * dt;
      st.pos.z += dz * dt;
      return;
    }
    this.moveAxis('x', dx * dt);
    this.moveAxis('z', dz * dt);
    const y0 = st.pos.y;
    st.pos.y = y0 + dy * dt;
    if (this.hits(st.pos, 0.02)) {
      st.pos.y = y0;
      st.vel.y = 0;
    }
  }

  /** Walk: gravity, collision, step-up, jump. Untouched hard-won behaviour. */
  private updateWalk(dt: number): void {
    const st = this.state;

    this.updateHeldStance();
    this.updateStance(dt);

    // ---- wish direction in the yaw frame
    const f = this.keys.has('KeyW') ? 1 : 0;
    const b = this.keys.has('KeyS') ? 1 : 0;
    const l = this.keys.has('KeyA') ? 1 : 0;
    const r = this.keys.has('KeyD') ? 1 : 0;
    let wx = r - l;
    let wz = b - f;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }

    // Rotate the wish vector into the yaw frame. This MUST agree with the camera:
    // the camera looks down its local -z, so its world forward is (-sin, 0, -cos)
    // and its right is forward x up = (cos, 0, -sin). Getting the x term's sign wrong
    // mirrors movement about the z axis - identical at yaw 0 and PI, exactly backwards
    // at +/-PI/2 - so it looks fine facing up or down the street and is unplayable
    // facing across it.
    const sin = Math.sin(st.yaw), cos = Math.cos(st.yaw);
    let dirX = wx * cos + wz * sin;
    let dirZ = wz * cos - wx * sin;
    let moving = len > 0;

    if (this.probeWish) {
      dirX = this.probeWish.x;
      dirZ = this.probeWish.z;
      moving = true;
    }

    const sprintHeld = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    // Low stances are deliberately speed-gated: Shift never turns a prone or
    // crouched player into a sprint, which keeps the stance animation and root
    // movement in the same speed family.
    const speed = (st.stance === 'prone' ? PRONE_SPEED
      : st.stance === 'crouch' ? CROUCH_SPEED
        : sprintHeld ? SPRINT : WALK) * this.speedMultiplier;

    // ---- horizontal accelerate / friction
    if (moving) {
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
      // A jump leaves crouch/prone only after the full standing capsule fits.
      // Under a low ceiling the request is refused and the player remains in
      // the low stance instead of clipping their head through the ceiling.
      if (st.stance === 'stand' || this.setStance('stand')) {
        st.vel.y = JUMP_V;
        st.grounded = false;
      }
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

  }

  private syncCamera(): void {
    const st = this.state;
    this.camera.position.set(st.pos.x, st.pos.y + this.eyeHeight, st.pos.z);
    this.camera.rotation.set(0, 0, 0, 'YXZ');
    this.camera.rotation.y = st.yaw;
    this.camera.rotation.x = st.pitch;
  }
}
