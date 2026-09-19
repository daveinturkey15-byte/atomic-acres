/**
 * Atomic Acres — first-person weapon lane controller (fan project inspired by
 * BO2-era arcade shooters, not a clone or port).
 *
 * Owns five viewmodel rigs (built by ./viewmodel from ./catalog), one transient
 * pool (./effects), and a private overlay scene rendered on top of the world.
 * After construction only visible flags, transforms, FOV, and preallocated
 * pool slots change: no new materials/geometries/lights, no scene add/remove.
 *
 * The BO2 feel, concretely:
 *  - hitscan, one ray per pellet from the camera, through a spread cone that
 *    grows while moving/firing (bloom) and shrinks while still/ADS/crouched;
 *  - two-part recoil: a deterministic per-weapon climb pattern plus a bounded
 *    random yaw term, split into a fast camera kick and a slow climb that
 *    recovers toward the original aim when fire stops;
 *  - ADS on a per-weapon timer (200–280 ms) driving FOV, spread, viewmodel
 *    pose and the exposed moveScale together.
 *
 * Hot-path allocations: three's Raycaster owns its result array per ray —
 * everything else (spread, recoil, effects, logging rings) is pooled scratch.
 * The 30 s soak in the lane report measures the heap cost of that choice.
 */
import * as THREE from 'three';
import { PAL } from '../core/palette';
import type { MaterialLibrary } from '../core/materials';
import type { GunsHudState, MoveSample, WeaponSnapshot } from './types';
export type { GunsHudState, MoveSample, WeaponSnapshot } from './types';
import { WEAPONS, damageAt, patternMult, type WeaponDef } from './catalog';
import {
  buildRifleViewmodel,
  buildSmgViewmodel,
  buildShotgunViewmodel,
  buildSniperViewmodel,
  buildPistolViewmodel,
  type ViewmodelRig,
} from './viewmodel';
import { WeaponEffects } from './effects';
import { OrdnanceInput } from './ordnance-input';

const DEG = Math.PI / 180;
const BASE_FOV = 72;
const MISS_DISTANCE = 120;
const MAX_DT = 0.05;
const SPRINT_REF = 6.6;
// Slow-climb accumulation caps so a full mag dumps into a learnable band.
const CLIMB_CAP_PITCH = 5 * DEG;
const CLIMB_CAP_YAW = 2 * DEG;
// QA logging rings (construction-time only).
const IMPACT_RING = 128;
const RECOIL_RING = 256;

// Camera-local mount points (viewmodel detail, not world placement).
const HIP_OFFSET = new THREE.Vector3(0.22, -0.2, -0.45);
const ADS_OFFSET = new THREE.Vector3(0, -0.148, -0.3);

interface WeaponState {
  def: WeaponDef;
  rig: ViewmodelRig;
  mag: number;
  reserve: number;
  reloading: boolean;
  reloadT: number;
  reloadDur: number;
  cool: number;
  bloom: number;
  shotsFired: number;
}

/**
 * One trigger pull, as the shooter saw it.
 *
 * WHAT THIS IS NOT: a damage number. The controller still raycasts, still
 * draws a tracer and still sparks an impact, because those are PRESENTATION
 * and must happen on the frame the trigger went down. What it no longer does
 * is decide anything: the claim goes to `game/host.ts`, which rewinds every
 * actor to `time`, runs the eight admission rules and resolves the damage.
 * A client that resolves its own damage is the architecture IMPORT-PLAN §2
 * exists to forbid — and the reason the old project could not tell a hit from
 * a wish.
 *
 * `direction` is the AIM AXIS (camera forward, recoil included), not a pellet:
 * the spread cone is presentation too, and the host resolves one ray. For the
 * shotgun that means the host tests the centre of the pattern; a per-pellet
 * wire claim is the upgrade, and it is not made here.
 *
 * `time` is the controller's own monotonic stamp (`performance.now()` domain),
 * taken at the last `update`. At 60 fps that is at most ~17 ms behind the
 * click, well inside the host's 250 ms fire-age ceiling, and it is stable —
 * reading the clock inside the fire path would make a burst's spacing depend
 * on when the browser felt like delivering the mouse event.
 *
 * `life` is deliberately ABSENT. The controller does not know the host's life
 * epoch and must not guess one; the integrator stamps it (`game/session.ts`).
 */
export interface ShotClaim {
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
  readonly direction: { readonly x: number; readonly y: number; readonly z: number };
  /** Per-controller monotonic, from 1. The host's exactly-once window keys on it. */
  readonly seq: number;
  readonly weaponId: string;
  readonly time: number;
}

interface ControllerOpts {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  mat: MaterialLibrary;
  targets: THREE.Object3D[];
  onHud: (line: string) => void;
  /** Optional: absent means nobody is listening, and the gun is a toy again. */
  onShot?: (claim: ShotClaim) => void;
}


export class WeaponsController {
  readonly overlay: THREE.Scene;
  /** Plain readable state for the HUD lane: one live object, mutated in place. */
  readonly hud: GunsHudState;

  private camera: THREE.PerspectiveCamera;
  private targets: THREE.Object3D[];
  private onHud: (line: string) => void;
  private effects: WeaponEffects;
  private weapons: WeaponState[];
  private active = 0;

  private visible = true;
  private triggerHeld = false;
  private adsOn = false;
  private adsT = 0;
  private autoTimer = 0;
  private sprintBlend = 0;
  private bobPhase = 0;
  private bobScale = 0;
  private speed = 0;
  private crouched = false;
  // Two-part recoil: fast punch (decays ~11/s) + slow climb (per-weapon recovery).
  private kickPitch = 0;
  private kickYaw = 0;
  private climbPitch = 0;
  private climbYaw = 0;
  private lastHud = '';

  // Deterministic shot randomness (mulberry32, seeded once — no Math.random
  // anywhere in the fire path, so bursts are reproducible in the soak test).
  private rngState = 0x9e3779b9;

  // QA rings: impact points and per-shot recoil deltas, preallocated.
  private impactPts: THREE.Vector3[] = [];
  private impactHead = 0;
  private impactTotal = 0;
  private recoilLog = new Float32Array(RECOIL_RING * 2);
  private recoilHead = 0;
  private recoilTotal = 0;

  private onShot: ((claim: ShotClaim) => void) | null = null;
  /** Monotonic claim sequence, and the clock the claim is stamped with. */
  private shotSeq = 0;
  private nowMs = 0;
  /** Grenades, knife, pickup: the off hand (ordnance lane). Its claims go out through `claim()`. */
  private readonly ord: OrdnanceInput;
  private handLower = 0;

  private shotsHit = 0;
  private hitSeq = 0;
  private lastDamage = 0;
  private lastDistance = 0;

  // Preallocated per-frame scratch: no allocation per shot or per frame.
  private raycaster = new THREE.Raycaster();
  private tmpDir = new THREE.Vector3();
  private tmpOffset = new THREE.Vector3();
  private tmpMuzzle = new THREE.Vector3();
  private tmpEnd = new THREE.Vector3();
  private tmpNormal = new THREE.Vector3();
  private tmpEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private tmpQuat = new THREE.Quaternion();

  private audio: AudioContext | null = null;
  private noiseBuf: AudioBuffer | null = null;

  constructor(opts: ControllerOpts) {
    this.camera = opts.camera;
    this.targets = opts.targets;
    this.onHud = opts.onHud;
    this.onShot = opts.onShot ?? null;

    this.weapons = WEAPONS.map((def) => {
      let rig: ViewmodelRig;
      if (def.id === 'rattler') rig = buildSmgViewmodel(opts.mat);
      else if (def.id === 'coachman') rig = buildShotgunViewmodel(opts.mat);
      else if (def.id === 'deadeye') rig = buildSniperViewmodel(opts.mat);
      else if (def.id === 'duster') rig = buildPistolViewmodel(opts.mat);
      else rig = buildRifleViewmodel(opts.mat);
      return {
        def,
        rig,
        mag: def.magSize,
        reserve: def.startReserve,
        reloading: false,
        reloadT: 0,
        reloadDur: def.reloadTime,
        cool: 0,
        bloom: 0,
        shotsFired: 0,
      };
    });
    for (let i = 0; i < IMPACT_RING; i++) this.impactPts.push(new THREE.Vector3());

    this.overlay = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(PAL.skyHorizon, PAL.bounce, 0.9);
    const key = new THREE.DirectionalLight(PAL.sunColor, 1.5);
    key.position.set(2, 3, 1);
    // Lights are siblings of the rigs and are never touched again: toggling a
    // rig's visibility cannot change the light set (the old project's program-
    // invalidation bug came from hiding a root that owned lights).
    for (const w of this.weapons) {
      w.rig.group.visible = false;
      this.overlay.add(w.rig.group);
    }
    this.weapons[0].rig.group.visible = true;
    this.overlay.add(hemi);
    this.overlay.add(key);
    // The knife and the held grenade mount beside the gun, in the same overlay,
    // at construction - no scene add/remove afterwards, and no light of their own.
    this.ord = new OrdnanceInput(opts.mat, this.overlay);

    this.effects = new WeaponEffects(opts.scene, opts.mat);
    opts.scene.add(this.effects.group);
    this.raycaster.far = 160;

    this.hud = {
      weaponId: this.weapons[0].def.id,
      weaponName: this.weapons[0].def.name,
      mag: this.weapons[0].mag,
      reserve: this.weapons[0].reserve,
      magSize: this.weapons[0].def.magSize,
      reloading: false,
      ads: false,
      adsT: 0,
      moveScale: 1,
      shotsFired: 0,
      shotsHit: 0,
      hitSeq: 0,
      lastDamage: 0,
      lastDistance: 0,
      spread: 0,
      visible: true,
    };

    this.camera.fov = BASE_FOV;
    this.camera.updateProjectionMatrix();
    this.pushHud(true);
  }

  private rand(): number {
    let a = (this.rngState + 0x6d2b79f5) | 0;
    this.rngState = a;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  update(dt: number, time: number, move: MoveSample): void {
    if (!this.visible) return;
    dt = Math.min(dt, MAX_DT);
    // The stamp every shot claim this frame carries. `time` arrives in seconds
    // (main.ts passes `performance.now() / 1000`); the wire is milliseconds.
    this.nowMs = time * 1000;
    const cur = this.weapons[this.active];
    const def = cur.def;
    this.speed = move.speed;
    this.crouched = move.crouched === true;

    // Recoil: fast kick decays hard, slow climb recovers at the weapon's rate
    // toward the original aim — the recovery is the BO2 half of the model.
    const kickDecay = Math.exp(-11 * dt);
    this.kickPitch *= kickDecay;
    this.kickYaw *= kickDecay;
    const climbDecay = Math.exp(-def.recoil.recovery * dt);
    this.climbPitch *= climbDecay;
    this.climbYaw *= climbDecay;

    // Bloom bleeds off a few seconds after the last shot.
    if (cur.bloom > 0) cur.bloom = Math.max(0, cur.bloom - def.spread.bloomMax * dt * 1.4);
    if (cur.cool > 0) cur.cool -= dt;

    // ADS on the weapon's own timer: FOV, spread, pose and moveScale ride adsT.
    const adsTarget = this.adsOn ? 1 : 0;
    if (this.adsT !== adsTarget) {
      const step = dt / def.adsTime;
      this.adsT = adsTarget > this.adsT
        ? Math.min(adsTarget, this.adsT + step)
        : Math.max(adsTarget, this.adsT - step);
    }
    const fov = BASE_FOV + (def.adsFov - BASE_FOV) * this.adsT;
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }

    // Sprint-lower blend (suppressed while aiming).
    const sprintTarget = move.sprinting && !this.adsOn ? 1 : 0;
    this.sprintBlend += (sprintTarget - this.sprintBlend) * Math.min(1, dt * 8);

    // Walk bob: phase advances with speed while grounded; amplitude eases out
    // the moment we leave the ground so no pose sticks mid-air.
    if (move.grounded && move.speed > 0.5) this.bobPhase += dt * (2 + move.speed);
    const bobTarget = move.grounded && move.speed > 0.5 ? Math.min(1, move.speed / 4) : 0;
    this.bobScale += (bobTarget - this.bobScale) * Math.min(1, dt * 6);

    // Auto fire while the trigger is held.
    if (this.triggerHeld && def.auto && !cur.reloading) {
      this.autoTimer -= dt;
      while (this.autoTimer <= 0) {
        if (!this.tryFire(true)) {
          this.autoTimer = 0;
          break;
        }
        this.autoTimer += def.interval;
      }
    }

    // Reload timer with a lower-tilt-raise pose.
    let reloadDip = 0;
    if (cur.reloading) {
      cur.reloadT -= dt;
      const progress = 1 - Math.max(0, cur.reloadT) / cur.reloadDur;
      reloadDip = Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI);
      if (cur.reloadT <= 0) {
        cur.reloading = false;
        const need = def.magSize - cur.mag;
        const take = Math.min(need, cur.reserve);
        cur.mag += take;
        cur.reserve -= take;
        this.click(660, 0.05, 0.12);
        this.pushHud();
      }
    }

    // Mount the active rig in the camera frame: hip <-> ADS lerp, idle sway
    // (4 mm hip / 1 mm ADS), walk bob (8 mm vert / 5 mm horiz), sprint-lower
    // (~12 deg pitch + drop), reload dip.
    const swayAmp = 0.004 + (0.001 - 0.004) * this.adsT;
    const adsDamp = 1 - this.adsT * 0.75;
    const bobX = Math.cos(this.bobPhase) * 0.005 * this.bobScale * adsDamp;
    const bobY = Math.sin(this.bobPhase * 2) * 0.008 * this.bobScale * adsDamp;
    // The off hand first: it bobs with the gun and tells the gun how far to
    // drop while it is throwing, stabbing or reaching. Its claim moments are
    // drained here so a grenade leaves the hand on the frame the pose says.
    this.handLower = this.ord.update(dt, this.camera.position, this.camera.quaternion, time, bobX, bobY);
    for (let id = this.ord.takeClaim(); id !== null; id = this.ord.takeClaim()) this.claim(id);
    this.tmpOffset.lerpVectors(HIP_OFFSET, ADS_OFFSET, this.adsT);
    this.tmpOffset.x += Math.sin(time * 1.1) * swayAmp * adsDamp + bobX + 0.04 * this.handLower;
    this.tmpOffset.y += Math.cos(time * 1.7) * swayAmp * 0.7 * adsDamp + bobY
      - 0.05 * this.sprintBlend
      - 0.06 * reloadDip
      - 0.09 * this.handLower;
    this.tmpOffset.applyQuaternion(this.camera.quaternion).add(this.camera.position);
    cur.rig.group.position.copy(this.tmpOffset);
    this.tmpEuler.set(
      0.21 * this.sprintBlend - 0.35 * reloadDip + 0.3 * this.handLower,
      0,
      -0.12 * this.handLower,
    );
    this.tmpQuat.setFromEuler(this.tmpEuler);
    cur.rig.group.quaternion.copy(this.camera.quaternion).multiply(this.tmpQuat);

    this.camera.rotation.x += this.kickPitch + this.climbPitch;
    this.camera.rotation.y += this.kickYaw + this.climbYaw;
    this.effects.update(dt);
    this.syncHudState();
    this.pushHud();
  }

  pointerDown(button: number): void {
    if (!this.visible) return;
    if (button === 0) {
      this.triggerHeld = true;
      const cur = this.weapons[this.active];
      if (cur.reloading) return;
      if (this.tryFire(false) && cur.def.auto) this.autoTimer = cur.def.interval;
      else this.autoTimer = 0;
    } else if (button === 2) {
      this.adsOn = true;
      this.pushHud();
    }
  }

  pointerUp(button: number): void {
    if (button === 0) {
      this.triggerHeld = false;
      this.autoTimer = 0;
    } else if (button === 2) {
      this.adsOn = false;
      this.pushHud();
    }
  }

  keyDown(code: string): boolean {
    if (code === 'KeyR') {
      this.startReload();
      return true;
    }
    if (code === 'Digit1') {
      this.switchTo(0);
      return true;
    }
    if (code === 'Digit2') {
      this.switchTo(1);
      return true;
    }
    if (code === 'Digit3') {
      this.switchTo(2);
      return true;
    }
    if (code === 'Digit4') {
      this.switchTo(3);
      return true;
    }
    if (code === 'Digit5') {
      this.switchTo(4);
      return true;
    }
    // G / Q / V / E: the off hand. A swing cancels a reload, as in BO2.
    if (this.visible && this.ord.keyDown(code, this.nowMs)) {
      if (this.ord.busy) { const cur = this.weapons[this.active]; cur.reloading = false; cur.reloadT = 0; }
      return true;
    }
    return false;
  }

  /** Key releases: a held grenade is thrown when G/Q comes up; E stops the use-hold. */
  keyUp(code: string): boolean {
    return this.visible && this.ord.keyUp(code);
  }

  // ---- Ordnance lane: the host's level and its verdicts, pushed by `ordnance-scene.ts` ----

  /** What the host says we hold. Level, every frame; gates the raise and un-arms a refused one. */
  setOrdnance(lethal: number, tactical: number, tacticalId: string, armed: string | null): void {
    this.ord.setLevel(lethal, tactical, tacticalId, armed);
  }

  /** A grenade went off here: flash star, dust and sparks from the pools. Never a light. */
  blastAt(x: number, y: number, z: number): void {
    this.tmpEnd.set(x, y, z);
    this.effects.blast(this.tmpEnd, this.camera.quaternion);
  }

  /** The host swapped our primary for a drop's: hold that gun, with the rounds it had. */
  adoptWeapon(weaponId: string, rounds: number): boolean {
    const idx = this.weapons.findIndex((w) => w.def.id === weaponId);
    if (idx < 0) return false;
    const w = this.weapons[idx];
    const total = Math.max(0, Math.floor(rounds));
    w.mag = Math.min(w.def.magSize, total);
    w.reserve = total - w.mag;
    w.reloading = false;
    w.reloadT = 0;
    this.switchTo(idx);
    this.syncHudState();
    this.pushHud(true);
    return true;
  }

  /** Scavenged ammo for a gun we carry. */
  grantRounds(weaponId: string, rounds: number): boolean {
    const w = this.weapons.find((v) => v.def.id === weaponId);
    if (w === undefined || !(rounds > 0)) return false;
    w.reserve += Math.floor(rounds);
    this.syncHudState();
    this.pushHud(true);
    return true;
  }

  /** A new life: whatever the hand was doing is over. */
  onSelfSpawn(): void {
    this.ord.cancel();
  }

  wheel(deltaY: number): void {
    if (deltaY === 0) return;
    this.switchTo((this.active + (deltaY > 0 ? 1 : this.weapons.length - 1)) % this.weapons.length);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.overlay.visible = v;
    this.ord.setVisible(v);
    if (!v) {
      this.adsOn = false;
      this.adsT = 0;
      this.triggerHeld = false;
      this.autoTimer = 0;
      this.kickPitch = 0;
      this.kickYaw = 0;
      this.climbPitch = 0;
      this.climbYaw = 0;
      for (const w of this.weapons) {
        w.reloading = false;
        w.reloadT = 0;
        w.cool = 0;
        w.bloom = 0;
      }
      this.camera.fov = BASE_FOV;
      this.camera.updateProjectionMatrix();
    } else {
      this.weapons[this.active].rig.group.visible = true;
    }
    this.syncHudState();
    this.pushHud(true);
  }

  snapshot(): WeaponSnapshot {
    const cur = this.weapons[this.active];
    return {
      id: cur.def.id,
      name: cur.def.name,
      mag: cur.mag,
      reserve: cur.reserve,
      ads: this.adsOn,
      reloading: cur.reloading,
      visible: this.visible,
      shotsFired: cur.shotsFired,
      cool: +Math.max(0, cur.cool).toFixed(3),
    };
  }

  command(cmd: string, arg?: string | number | boolean): unknown {
    switch (cmd) {
      case 'fire':
        return this.visible ? this.tryFire(false) : false;
      case 'reload':
        return this.startReload();
      case 'ads':
        if (typeof arg === 'boolean') this.adsOn = arg;
        else this.adsOn = !this.adsOn;
        this.pushHud();
        return this.adsOn;
      case 'switch': {
        if (typeof arg === 'string') {
          const idx = this.weapons.findIndex((w) => w.def.id === arg);
          return idx >= 0 ? this.switchTo(idx) : false;
        }
        if (typeof arg === 'number') return this.switchTo(arg);
        this.switchTo((this.active + 1) % this.weapons.length);
        return true;
      }
      case 'state':
        return this.snapshot();
      case 'hud':
        return this.hud;
      case 'visible':
        if (typeof arg === 'boolean') {
          this.setVisible(arg);
          return this.visible;
        }
        return this.visible;
      case 'impacts': {
        // QA-only: copy of the impact ring for the spread falsifier.
        const n = Math.min(this.impactTotal, IMPACT_RING);
        const pts: number[][] = [];
        const start = this.impactTotal <= IMPACT_RING ? 0 : this.impactHead;
        for (let i = 0; i < n; i++) {
          const p = this.impactPts[(start + i) % IMPACT_RING];
          pts.push([+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)]);
        }
        const out = { total: this.impactTotal, points: pts };
        if (arg === true) {
          this.impactHead = 0;
          this.impactTotal = 0;
        }
        return out;
      }
      case 'recoil': {
        // QA-only: per-shot applied aim deltas (pitch, yaw radians).
        const n = Math.min(this.recoilTotal, RECOIL_RING);
        const shots: number[][] = [];
        const start = this.recoilTotal <= RECOIL_RING ? 0 : this.recoilHead;
        for (let i = 0; i < n; i++) {
          const j = ((start + i) % RECOIL_RING) * 2;
          shots.push([+this.recoilLog[j].toFixed(6), +this.recoilLog[j + 1].toFixed(6)]);
        }
        const out = { total: this.recoilTotal, shots };
        if (arg === true) {
          this.recoilHead = 0;
          this.recoilTotal = 0;
        }
        return out;
      }
      case 'accuracy': {
        // QA-only: dispersion of the impact ring around its own mean.
        const n = Math.min(this.impactTotal, IMPACT_RING);
        if (n < 3) return { n, rms: 0, within035: 0, mean: [0, 0, 0] };
        const start = this.impactTotal <= IMPACT_RING ? 0 : this.impactHead;
        let mx = 0;
        let my = 0;
        let mz = 0;
        for (let i = 0; i < n; i++) {
          const p = this.impactPts[(start + i) % IMPACT_RING];
          mx += p.x;
          my += p.y;
          mz += p.z;
        }
        mx /= n;
        my /= n;
        mz /= n;
        let ss = 0;
        let within = 0;
        for (let i = 0; i < n; i++) {
          const p = this.impactPts[(start + i) % IMPACT_RING];
          const dx = p.x - mx;
          const dy = p.y - my;
          const dz = p.z - mz;
          const d2 = dx * dx + dy * dy + dz * dz;
          ss += d2;
          if (d2 <= 0.35 * 0.35) within++;
        }
        return {
          n,
          rms: +Math.sqrt(ss / n).toFixed(3),
          within035: +(within / n).toFixed(3),
          mean: [+mx.toFixed(2), +my.toFixed(2), +mz.toFixed(2)],
        };
      }
      case 'inspect': {
        // QA-only: one live round with stretched lifetimes so a screenshot
        // catches flash + tracer + impact mid-flight.
        const ok = this.visible ? this.tryFire(false) : false;
        if (ok) this.effects.stretchLives(24);
        return ok;
      }
      case 'refill': {
        // QA-only: top up the active gun so a soak holds the trigger without
        // spending its wall clock inside reload timers.
        const cur = this.weapons[this.active];
        cur.mag = cur.def.magSize;
        cur.reserve = cur.def.startReserve;
        cur.reloading = false;
        cur.reloadT = 0;
        this.syncHudState();
        this.pushHud(true);
        return true;
      }
      default:
        // 'grenade' / 'knife' / 'use' / 'ordnance': the off hand's own commands.
        return this.visible ? this.ord.command(cmd, arg, this.nowMs) : undefined;
    }
  }

  private switchTo(index: number): boolean {
    if (index < 0 || index >= this.weapons.length || index === this.active) return index === this.active;
    const prev = this.weapons[this.active];
    prev.reloading = false;
    prev.reloadT = 0;
    prev.rig.group.visible = false;
    this.active = index;
    this.weapons[this.active].rig.group.visible = this.visible;
    this.adsOn = false;
    this.adsT = 0;
    this.triggerHeld = false;
    this.autoTimer = 0;
    if (Math.abs(this.camera.fov - BASE_FOV) > 0.01) {
      this.camera.fov = BASE_FOV;
      this.camera.updateProjectionMatrix();
    }
    this.syncHudState();
    this.pushHud(true);
    return true;
  }

  private startReload(): boolean {
    if (!this.visible) return false;
    const cur = this.weapons[this.active];
    if (cur.reloading || cur.mag >= cur.def.magSize || cur.reserve <= 0) return false;
    cur.reloading = true;
    // A dry gun costs the empty reload; a tactical reload keeps the chambered
    // round's head start.
    cur.reloadDur = cur.mag === 0 ? cur.def.emptyReloadTime : cur.def.reloadTime;
    cur.reloadT = cur.reloadDur;
    this.click(440, 0.05, 0.12);
    this.pushHud(true);
    return true;
  }

  /**
   * One claim on the wire: a bullet, a grenade (arm or release), the knife or
   * a pickup reach are all "an action at the eye along the aim at a time",
   * and the host tells them apart by `weaponId`. One author, one sequence.
   */
  private claim(weaponId: string): void {
    if (this.onShot === null) return;
    this.tmpDir.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const c = this.camera.position;
    this.onShot({
      origin: { x: c.x, y: c.y, z: c.z },
      direction: { x: this.tmpDir.x, y: this.tmpDir.y, z: this.tmpDir.z },
      seq: ++this.shotSeq,
      weaponId,
      time: this.nowMs,
    });
  }

  private tryFire(fromAuto: boolean): boolean {
    const cur = this.weapons[this.active];
    const def = cur.def;
    // The trigger waits for the off hand: no bullet mid-throw, mid-stab or mid-reach.
    if (!this.visible || cur.reloading || this.ord.busy) return false;
    if (!fromAuto || !def.auto) {
      if (cur.cool > 0) return false;
      cur.cool = def.interval;
    }
    if (cur.mag <= 0) {
      this.click(1200, 0.03, 0.1);
      this.pushHud();
      return false;
    }
    cur.mag -= 1;
    cur.shotsFired += 1;

    // THE CLAIM, authored before the presentation raycast below so that a
    // throw anywhere in the effects path cannot swallow the shot the host is
    // meant to resolve. Camera forward carries the recoil already applied this
    // frame, which is what the player was actually pointing at.
    this.claim(def.id);

    // Spread cone: base (hip<->ADS) + movement + accumulated bloom, crouch bonus.
    cur.bloom = Math.min(def.spread.bloomMax, cur.bloom + def.spread.bloom);
    const moveFrac = Math.min(1, this.speed / SPRINT_REF);
    let spread = def.spread.hip
      + (def.spread.ads - def.spread.hip) * this.adsT
      + def.spread.move * moveFrac
      + cur.bloom;
    if (this.crouched) spread *= def.spread.crouchMult;
    if (spread < 0) spread = 0;

    let anyHit = false;
    let pullDamage = 0;
    let pullDist = 0;
    for (let p = 0; p < def.pellets; p++) {
      // Uniform-disc sample in the camera frame, then to world. No allocation.
      const u = this.rand();
      const v = this.rand();
      const r = spread * Math.sqrt(u);
      const a = v * Math.PI * 2;
      this.tmpDir.set(r * Math.cos(a), r * Math.sin(a), -1)
        .normalize()
        .applyQuaternion(this.camera.quaternion);

      this.raycaster.set(this.camera.position, this.tmpDir);
      const hits = this.raycaster.intersectObjects(this.targets, true);

      cur.rig.muzzle.getWorldPosition(this.tmpMuzzle);
      if (hits.length > 0) {
        const hit = hits[0];
        anyHit = true;
        const dmg = damageAt(def, hit.distance);
        pullDamage += dmg;
        pullDist = hit.distance;
        this.tmpEnd.copy(hit.point).sub(this.tmpMuzzle);
        this.effects.tracer(this.tmpMuzzle, this.tmpEnd, this.tmpEnd.length());
        if (hit.face) {
          // Face normal lives in object space; the pool slot is world space.
          this.tmpNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
          this.effects.impact(hit.point, this.tmpNormal, this.tmpNormal.y > 0.5);
        } else {
          this.effects.impact(hit.point, this.tmpDir, false);
        }
        const slot = this.impactPts[this.impactHead];
        slot.copy(hit.point);
        this.impactHead = (this.impactHead + 1) % IMPACT_RING;
        this.impactTotal++;
      } else {
        this.tmpEnd.copy(this.tmpDir).multiplyScalar(MISS_DISTANCE).add(this.camera.position);
        this.effects.tracer(this.tmpMuzzle, this.tmpDir, MISS_DISTANCE);
      }
    }
    if (anyHit) {
      this.shotsHit++;
      this.hitSeq++;
      this.lastDamage = pullDamage;
      this.lastDistance = pullDist;
    } else {
      this.lastDamage = 0;
      this.lastDistance = 0;
    }

    this.effects.flashAt(this.tmpMuzzle, this.camera.quaternion);
    cur.rig.eject.getWorldPosition(this.tmpMuzzle);
    this.tmpDir.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.tmpEnd.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.effects.shell(this.tmpMuzzle, this.tmpDir, this.tmpEnd);

    // Two-part recoil: deterministic climb pattern in pitch, bounded random
    // yaw. Most of each shot lands as fast kick; a fraction accumulates as
    // slow climb that the recovery term bleeds off when fire stops.
    const n = cur.shotsFired - 1;
    const pitchAdd = def.recoil.pitch * patternMult(def, n);
    const yawAdd = (this.rand() * 2 - 1) * def.recoil.yawRandom;
    this.kickPitch += pitchAdd * 0.75;
    this.kickYaw += yawAdd * 0.75;
    this.climbPitch = Math.min(CLIMB_CAP_PITCH, this.climbPitch + pitchAdd * 0.25);
    this.climbYaw = Math.max(-CLIMB_CAP_YAW, Math.min(CLIMB_CAP_YAW, this.climbYaw + yawAdd * 0.25));
    const rj = (this.recoilHead % RECOIL_RING) * 2;
    this.recoilLog[rj] = pitchAdd;
    this.recoilLog[rj + 1] = yawAdd;
    this.recoilHead = (this.recoilHead + 1) % RECOIL_RING;
    this.recoilTotal++;

    this.playShot(def.id);
    this.syncHudState();
    this.pushHud();
    return true;
  }

  private syncHudState(): void {
    const cur = this.weapons[this.active];
    const h = this.hud;
    h.weaponId = cur.def.id;
    h.weaponName = cur.def.name;
    h.mag = cur.mag;
    h.reserve = cur.reserve;
    h.magSize = cur.def.magSize;
    h.reloading = cur.reloading;
    h.ads = this.adsOn;
    h.adsT = +this.adsT.toFixed(3);
    h.moveScale = +(1 + (cur.def.adsMoveScale - 1) * this.adsT).toFixed(3);
    h.shotsFired = cur.shotsFired;
    h.shotsHit = this.shotsHit;
    h.lastDamage = +this.lastDamage.toFixed(1);
    h.lastDistance = +this.lastDistance.toFixed(1);
    let cone = cur.def.spread.hip
      + (cur.def.spread.ads - cur.def.spread.hip) * this.adsT
      + cur.def.spread.move * Math.min(1, this.speed / SPRINT_REF)
      + cur.bloom;
    if (this.crouched) cone *= cur.def.spread.crouchMult;
    h.spread = +Math.max(0, cone).toFixed(5);
    h.visible = this.visible;
  }

  private pushHud(force = false): void {
    const cur = this.weapons[this.active];
    const line = `${cur.def.name} ${cur.mag} / ${cur.reserve}`
      + (cur.reloading ? ' — reloading' : '')
      + (this.adsOn ? ' · ADS' : '')
      + (this.visible ? '' : ' · hidden');
    if (force || line !== this.lastHud) {
      this.lastHud = line;
      try {
        this.onHud(line);
      } catch {
        // HUD must never break the weapon lane.
      }
    }
  }

  private ensureAudio(): AudioContext | null {
    try {
      if (this.audio) {
        if (this.audio.state === 'suspended') void this.audio.resume().catch(() => undefined);
        return this.audio;
      }
      if (typeof window === 'undefined') return null;
      const AC = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      this.audio = ctx;
      const len = Math.floor(ctx.sampleRate * 0.25);
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      return ctx;
    } catch {
      return null;
    }
  }

  private playShot(id: string): void {
    // Free synth only: per-family filter/decay over the shared noise buffer.
    // Sniper booms low and long, SMG barks high and short.
    let freq = 1700;
    let vol = 0.3;
    let decay = 0.14;
    if (id === 'deadeye') {
      freq = 900;
      vol = 0.34;
      decay = 0.24;
    } else if (id === 'coachman') {
      freq = 1200;
      vol = 0.34;
      decay = 0.2;
    } else if (id === 'rattler') {
      freq = 2200;
      vol = 0.24;
      decay = 0.1;
    } else if (id === 'duster') {
      freq = 2600;
      vol = 0.22;
      decay = 0.09;
    }
    try {
      const ctx = this.ensureAudio();
      if (!ctx || !this.noiseBuf) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = freq;
      const gain = ctx.createGain();
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start(t, this.rand() * 0.1);
      src.stop(t + 0.2);
    } catch {
      // Audio is garnish; a headless harness has no AudioContext.
    }
  }

  private click(freq: number, dur: number, vol: number): void {
    try {
      const ctx = this.ensureAudio();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(vol, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.01);
    } catch {
      // Audio is garnish; a headless harness has no AudioContext.
    }
  }
}
