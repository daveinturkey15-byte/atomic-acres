/**
 * Atomic Acres — first-person weapon lane controller (fan project inspired by
 * BO2-era arcade shooters, not a clone or port).
 *
 * Owns two viewmodel rigs (built by ./viewmodel), one transient pool
 * (./effects), and a private overlay scene rendered on top of the world.
 * After construction only visible flags, transforms, FOV, and preallocated
 * pool slots change: no new materials/geometries/lights, no scene add/remove.
 */
import * as THREE from 'three';
import { PAL } from '../core/palette';
import type { MaterialLibrary } from '../core/materials';
import type { MoveSample, WeaponSnapshot } from './types';
export type { MoveSample, WeaponSnapshot } from './types';
import { buildRifleViewmodel, buildPistolViewmodel, type ViewmodelRig } from './viewmodel';
import { WeaponEffects } from './effects';

const DEG = Math.PI / 180;
const BASE_FOV = 72;
const ADS_FOV = 55;
const MISS_DISTANCE = 120;
const MAX_DT = 0.05;

// Camera-local mount points (viewmodel detail, not world placement).
const HIP_OFFSET = new THREE.Vector3(0.22, -0.2, -0.45);
const ADS_OFFSET = new THREE.Vector3(0, -0.148, -0.3);

interface WeaponDef {
  id: string;
  name: string;
  auto: boolean;
  /** seconds between auto shots */
  interval: number;
  magSize: number;
  startMag: number;
  startReserve: number;
  reloadTime: number;
  hipSpread: number;
  adsSpread: number;
  recoilPitch: number;
  recoilYaw: number;
}

interface WeaponState {
  def: WeaponDef;
  rig: ViewmodelRig;
  mag: number;
  reserve: number;
  reloading: boolean;
  reloadT: number;
  shotsFired: number;
}

interface ControllerOpts {
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  mat: MaterialLibrary;
  targets: THREE.Object3D[];
  onHud: (line: string) => void;
}

const RIFLE: WeaponDef = {
  id: 'longhorn',
  name: 'Longhorn',
  auto: true,
  interval: 0.1, // 600 rpm
  magSize: 30,
  startMag: 30,
  startReserve: 90,
  reloadTime: 2.1,
  hipSpread: 1.6 * DEG,
  adsSpread: 0.35 * DEG,
  recoilPitch: 0.35 * DEG,
  recoilYaw: 0.09 * DEG,
};

const PISTOL: WeaponDef = {
  id: 'duster',
  name: 'Duster',
  auto: false,
  interval: 0,
  magSize: 12,
  startMag: 12,
  startReserve: 36,
  reloadTime: 1.4,
  hipSpread: 1.2 * DEG,
  adsSpread: 0.35 * DEG,
  recoilPitch: 0.5 * DEG,
  recoilYaw: 0.12 * DEG,
};

export class WeaponsController {
  readonly overlay: THREE.Scene;

  private camera: THREE.PerspectiveCamera;
  private targets: THREE.Object3D[];
  private onHud: (line: string) => void;
  private effects: WeaponEffects;
  private weapons: WeaponState[];
  private active = 0;

  private visible = true;
  private triggerHeld = false;
  private adsOn = false;
  private adsBlend = 0;
  private autoTimer = 0;
  private sprintBlend = 0;
  private bobPhase = 0;
  private bobScale = 0;
  private recoilPitch = 0;
  private recoilYaw = 0;
  private lastHud = '';

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

    const rifleRig = buildRifleViewmodel(opts.mat);
    const pistolRig = buildPistolViewmodel(opts.mat);
    this.weapons = [
      { def: RIFLE, rig: rifleRig, mag: RIFLE.startMag, reserve: RIFLE.startReserve, reloading: false, reloadT: 0, shotsFired: 0 },
      { def: PISTOL, rig: pistolRig, mag: PISTOL.startMag, reserve: PISTOL.startReserve, reloading: false, reloadT: 0, shotsFired: 0 },
    ];

    this.overlay = new THREE.Scene();
    const hemi = new THREE.HemisphereLight(PAL.skyHorizon, PAL.bounce, 0.9);
    const key = new THREE.DirectionalLight(PAL.sunColor, 1.5);
    key.position.set(2, 3, 1);
    this.overlay.add(rifleRig.group);
    this.overlay.add(pistolRig.group);
    this.overlay.add(hemi);
    this.overlay.add(key);
    rifleRig.group.visible = true;
    pistolRig.group.visible = false;

    this.effects = new WeaponEffects(opts.scene, opts.mat);
    opts.scene.add(this.effects.group);
    this.raycaster.far = 160;

    this.camera.fov = BASE_FOV;
    this.camera.updateProjectionMatrix();
    this.pushHud(true);
  }

  update(dt: number, time: number, move: MoveSample): void {
    if (!this.visible) return;
    dt = Math.min(dt, MAX_DT);
    const cur = this.weapons[this.active];

    // Recoil decays exponentially (~8/s); layered onto the camera AFTER the
    // caller (main.ts runs this after Player.update resets the rotation).
    const decay = Math.exp(-8 * dt);
    this.recoilPitch *= decay;
    this.recoilYaw *= decay;

    // ADS blend + FOV.
    const adsTarget = this.adsOn ? 1 : 0;
    this.adsBlend += (adsTarget - this.adsBlend) * Math.min(1, dt * 12);
    if (Math.abs(this.adsBlend - adsTarget) < 0.001) this.adsBlend = adsTarget;
    const fov = BASE_FOV + (ADS_FOV - BASE_FOV) * this.adsBlend;
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
    if (this.triggerHeld && cur.def.auto && !cur.reloading) {
      this.autoTimer -= dt;
      while (this.autoTimer <= 0) {
        if (!this.tryFire()) {
          this.autoTimer = 0;
          break;
        }
        this.autoTimer += cur.def.interval;
      }
    }

    // Reload timer with a lower-tilt-raise pose.
    let reloadDip = 0;
    if (cur.reloading) {
      cur.reloadT -= dt;
      const progress = 1 - Math.max(0, cur.reloadT) / cur.def.reloadTime;
      reloadDip = Math.sin(Math.min(1, Math.max(0, progress)) * Math.PI);
      if (cur.reloadT <= 0) {
        cur.reloading = false;
        const need = cur.def.magSize - cur.mag;
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
    const swayAmp = 0.004 + (0.001 - 0.004) * this.adsBlend;
    const adsDamp = 1 - this.adsBlend * 0.75;
    this.tmpOffset.lerpVectors(HIP_OFFSET, ADS_OFFSET, this.adsBlend);
    this.tmpOffset.x += Math.sin(time * 1.1) * swayAmp * adsDamp
      + Math.cos(this.bobPhase) * 0.005 * this.bobScale * adsDamp;
    this.tmpOffset.y += Math.cos(time * 1.7) * swayAmp * 0.7 * adsDamp
      + Math.sin(this.bobPhase * 2) * 0.008 * this.bobScale * adsDamp
      - 0.05 * this.sprintBlend
      - 0.06 * reloadDip;
    this.tmpOffset.applyQuaternion(this.camera.quaternion).add(this.camera.position);
    cur.rig.group.position.copy(this.tmpOffset);
    this.tmpEuler.set(
      0.21 * this.sprintBlend - 0.35 * reloadDip,
      0,
      0,
    );
    this.tmpQuat.setFromEuler(this.tmpEuler);
    cur.rig.group.quaternion.copy(this.camera.quaternion).multiply(this.tmpQuat);

    this.camera.rotation.x += this.recoilPitch;
    this.camera.rotation.y += this.recoilYaw;
    this.effects.update(dt);
    this.pushHud();
  }

  pointerDown(button: number): void {
    if (!this.visible) return;
    if (button === 0) {
      this.triggerHeld = true;
      const cur = this.weapons[this.active];
      if (cur.reloading) return;
      if (this.tryFire() && cur.def.auto) this.autoTimer = cur.def.interval;
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
    return false;
  }

  wheel(deltaY: number): void {
    if (deltaY === 0) return;
    this.switchTo((this.active + (deltaY > 0 ? 1 : this.weapons.length - 1)) % this.weapons.length);
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.overlay.visible = v;
    if (!v) {
      this.adsOn = false;
      this.adsBlend = 0;
      this.triggerHeld = false;
      this.autoTimer = 0;
      this.recoilPitch = 0;
      this.recoilYaw = 0;
      for (const w of this.weapons) {
        w.reloading = false;
        w.reloadT = 0;
      }
      this.camera.fov = BASE_FOV;
      this.camera.updateProjectionMatrix();
    } else {
      this.weapons[this.active].rig.group.visible = true;
    }
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
    };
  }

  command(cmd: string, arg?: string | number | boolean): unknown {
    switch (cmd) {
      case 'fire':
        return this.visible ? this.tryFire() : false;
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
      case 'visible':
        if (typeof arg === 'boolean') {
          this.setVisible(arg);
          return this.visible;
        }
        return this.visible;
      default:
        return undefined;
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
    this.adsBlend = 0;
    this.triggerHeld = false;
    this.autoTimer = 0;
    if (Math.abs(this.camera.fov - BASE_FOV) > 0.01) {
      this.camera.fov = BASE_FOV;
      this.camera.updateProjectionMatrix();
    }
    this.pushHud(true);
    return true;
  }

  private startReload(): boolean {
    if (!this.visible) return false;
    const cur = this.weapons[this.active];
    if (cur.reloading || cur.mag >= cur.def.magSize || cur.reserve <= 0) return false;
    cur.reloading = true;
    cur.reloadT = cur.def.reloadTime;
    this.click(440, 0.05, 0.12);
    this.pushHud(true);
    return true;
  }

  private tryFire(): boolean {
    const cur = this.weapons[this.active];
    if (!this.visible || cur.reloading) return false;
    if (cur.mag <= 0) {
      this.click(1200, 0.03, 0.1);
      this.pushHud();
      return false;
    }
    cur.mag -= 1;
    cur.shotsFired += 1;

    // Spread jitter in the camera frame, then to world. No allocation.
    const spread = cur.def.hipSpread + (cur.def.adsSpread - cur.def.hipSpread) * this.adsBlend;
    this.tmpDir.set(
      (Math.random() * 2 - 1) * spread,
      (Math.random() * 2 - 1) * spread,
      -1,
    ).normalize().applyQuaternion(this.camera.quaternion);

    this.raycaster.set(this.camera.position, this.tmpDir);
    const hits = this.raycaster.intersectObjects(this.targets, true);

    cur.rig.muzzle.getWorldPosition(this.tmpMuzzle);
    if (hits.length > 0) {
      const hit = hits[0];
      this.tmpEnd.copy(hit.point).sub(this.tmpMuzzle);
      this.effects.tracer(this.tmpMuzzle, this.tmpEnd, this.tmpEnd.length());
      if (hit.face) {
        // Face normal lives in object space; the pool slot is world space.
        this.tmpNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        this.effects.impact(hit.point, this.tmpNormal);
      } else {
        this.effects.impact(hit.point, this.tmpDir);
      }
    } else {
      this.tmpEnd.copy(this.tmpDir).multiplyScalar(MISS_DISTANCE).add(this.camera.position);
      this.effects.tracer(this.tmpMuzzle, this.tmpDir, MISS_DISTANCE);
    }
    cur.rig.muzzle.getWorldQuaternion(this.tmpQuat);
    this.effects.flashAt(this.tmpMuzzle, this.tmpQuat);
    cur.rig.eject.getWorldPosition(this.tmpMuzzle);
    this.tmpDir.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
    this.tmpEnd.set(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.effects.shell(this.tmpMuzzle, this.tmpDir, this.tmpEnd);

    this.recoilPitch += cur.def.recoilPitch;
    this.recoilYaw += (Math.random() * 2 - 1) * cur.def.recoilYaw;
    this.playShot(cur.def.id === 'duster');
    this.pushHud();
    return true;
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

  private playShot(high: boolean): void {
    try {
      const ctx = this.ensureAudio();
      if (!ctx || !this.noiseBuf) return;
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = high ? 2600 : 1700;
      const gain = ctx.createGain();
      const t = ctx.currentTime;
      gain.gain.setValueAtTime(high ? 0.22 : 0.3, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + (high ? 0.09 : 0.14));
      src.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      src.start(t, Math.random() * 0.1);
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
