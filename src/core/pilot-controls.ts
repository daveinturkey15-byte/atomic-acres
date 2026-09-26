/** Local controls and camera for a host-owned piloted aircraft.
 * The body stays with Player; only a fresh, controlled self-owned view admits
 * this camera. No position, damage or lifetime is authored here. */
import type { PerspectiveCamera } from 'three';
import type { StreakEffectView } from '../game/killstreaks/effect-view';
import type { PilotControls } from '../game/killstreaks/pilot-types';

export const PILOT_VIEW_MAX_AGE_MS = 750;
const INPUT_INTERVAL_MS = 50;
const PITCH_LIMIT = Math.PI / 2 - .08;
const CONTROL_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE']);
const BODY_KEYS = new Set(['Space', 'KeyR', 'KeyG', 'KeyV', 'KeyC', 'KeyZ', 'Digit1', 'Digit2',
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight']);

export interface PilotControlDeps {
  camera: PerspectiveCamera;
  canvas: HTMLElement;
  hud: HTMLElement;
  send(input: PilotControls): void;
  exit(): void;
  streak(slot: number): void;
  transition(active: boolean): void;
  lookSettings(): { sensitivity: number; invertY: boolean };
}

export function controlledPilotView(rows: readonly StreakEffectView[], selfId: string | null,
  alive: boolean, snapshotAt: number, now: number): StreakEffectView | null {
  const age = Math.max(0, now - snapshotAt);
  if (!alive || selfId === null || age > PILOT_VIEW_MAX_AGE_MS) return null;
  return rows.find(row => row.kind === 'aircraft' && row.variant === 'piloted-drone'
    && row.actorId === selfId && row.controlled === true && row.remainingMs > age
    && (row.health ?? 0) > 0 && [row.x, row.y, row.z, row.yaw, row.pitch].every(Number.isFinite)) ?? null;
}

/** Construct before menu listeners so Escape exits possession before pausing. */
export class PilotControlView {
  private row: StreakEffectView | null = null;
  private readonly keys = new Set<string>();
  private fire = false;
  private returning = false;
  private yaw = 0;
  private pitch = 0;
  private lastSentAt = -Infinity;
  private snapshotAt = 0;
  private savedFov = 72;
  private hint: HTMLDivElement;
  private lastHint = '';

  constructor(private readonly deps: PilotControlDeps) {
    this.hint = document.createElement('div');
    this.hint.className = 'hud-pilot';
    Object.assign(this.hint.style, { position: 'absolute', left: '50%', top: '19%', transform: 'translateX(-50%)',
      padding: '12px 18px', border: '1px solid #4ec9c0', borderRadius: '3px', background: 'rgba(7,19,23,.86)',
      color: '#e8fff9', textAlign: 'center', fontSize: '12px', fontWeight: '700', letterSpacing: '.8px',
      lineHeight: '1.6', whiteSpace: 'pre-line', maxWidth: '90vw', pointerEvents: 'none', display: 'none' });
    this.deps.hud.append(this.hint);
    addEventListener('keydown', this.keyDown, true);
    addEventListener('keyup', this.keyUp, true);
    addEventListener('mousemove', this.mouseMove, true);
    addEventListener('mousedown', this.mouseDown, true);
    addEventListener('mouseup', this.mouseUp, true);
    addEventListener('blur', this.blur);
    document.addEventListener('pointerlockchange', this.pointerLockChange);
  }

  active(): boolean { return this.row !== null; }

  sync(rows: readonly StreakEffectView[], selfId: string | null, alive: boolean, snapshotAt: number, now: number): void {
    const row = controlledPilotView(rows, selfId, alive, snapshotAt, now);
    if (row === null) { this.reset(); return; }
    if (this.row?.instanceId !== row.instanceId) {
      if (this.row !== null) this.reset();
      this.savedFov = this.deps.camera.fov;
      this.yaw = row.yaw!; this.pitch = row.pitch!;
      this.keys.clear(); this.fire = false; this.returning = false; this.lastSentAt = -Infinity;
      this.deps.transition(true);
      this.hint.style.display = '';
    }
    this.row = row;
    this.snapshotAt = snapshotAt;
  }

  update(now: number): void {
    const row = this.row;
    if (row === null) return;
    if (now - this.lastSentAt >= INPUT_INTERVAL_MS) {
      this.lastSentAt = now;
      this.deps.send({
        forward: this.axis('KeyW', 'KeyS'), strafe: this.axis('KeyD', 'KeyA'), ascend: this.axis('KeyE', 'KeyQ'),
        yaw: this.yaw, pitch: this.pitch, fire: this.fire && !this.returning,
      });
    }
    const camera = this.deps.camera;
    // The camera sits just ahead of the craft's nose, so its own hull cannot
    // block the view. Position remains entirely derived from host state.
    camera.position.set(row.x - Math.sin(this.yaw) * 1.15, row.y + .22, row.z - Math.cos(this.yaw) * 1.15);
    camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (camera.fov !== 72) { camera.fov = 72; camera.updateProjectionMatrix(); }
    const remaining = Math.max(0, row.remainingMs - Math.max(0, now - this.snapshotAt));
    const line = this.returning ? 'RETURNING TO PLAYER'
      : `PILOTED DRONE · ${Math.ceil(row.health ?? 0)} HP · ${Math.ceil(remaining / 1000)} s\nWASD fly · Q / E descend / climb · Mouse aim · LMB fire · Esc return`;
    if (line !== this.lastHint) { this.lastHint = line; this.hint.textContent = line; }
  }

  reset(): void {
    this.keys.clear(); this.fire = false; this.returning = false;
    if (this.row === null) return;
    this.row = null;
    this.hint.style.display = 'none';
    this.deps.camera.fov = this.savedFov;
    this.deps.camera.updateProjectionMatrix();
    this.deps.transition(false);
  }

  snapshot() {
    return { active: this.row !== null, instanceId: this.row?.instanceId ?? null, returning: this.returning,
      yaw: this.yaw, pitch: this.pitch, firing: this.fire, lastSentAt: this.lastSentAt };
  }

  dispose(): void {
    this.reset();
    removeEventListener('keydown', this.keyDown, true); removeEventListener('keyup', this.keyUp, true);
    removeEventListener('mousemove', this.mouseMove, true); removeEventListener('mousedown', this.mouseDown, true);
    removeEventListener('mouseup', this.mouseUp, true); removeEventListener('blur', this.blur);
    document.removeEventListener('pointerlockchange', this.pointerLockChange);
    this.hint.remove();
  }

  private axis(positive: string, negative: string): number {
    return this.returning ? 0 : Number(this.keys.has(positive)) - Number(this.keys.has(negative));
  }
  private stop(e: Event): void { e.preventDefault(); e.stopImmediatePropagation(); }
  private requestExit(): void {
    if (this.row === null || this.returning) return;
    this.keys.clear(); this.fire = false; this.returning = true;
    this.deps.exit();
  }
  private keyDown = (e: KeyboardEvent): void => {
    if (!this.active()) return;
    if (e.code === 'Escape') { this.stop(e); this.requestExit(); return; }
    const slot = ['Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7'].indexOf(e.code);
    if (slot >= 0) { this.stop(e); if (!e.repeat && !this.returning) this.deps.streak(slot + 1); return; }
    if (!CONTROL_KEYS.has(e.code) && !BODY_KEYS.has(e.code)) return;
    this.stop(e);
    if (CONTROL_KEYS.has(e.code) && !this.returning) this.keys.add(e.code);
  };
  private keyUp = (e: KeyboardEvent): void => {
    if (!this.active() || !CONTROL_KEYS.has(e.code) && !BODY_KEYS.has(e.code)) return;
    this.stop(e); this.keys.delete(e.code);
  };
  private mouseMove = (e: MouseEvent): void => {
    if (!this.active()) return;
    this.stop(e);
    if (this.returning || document.pointerLockElement !== this.deps.canvas) return;
    const settings = this.deps.lookSettings();
    const scale = .0022 * settings.sensitivity;
    this.yaw -= Math.max(-2000, Math.min(2000, e.movementX)) * scale;
    this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT,
      this.pitch - Math.max(-2000, Math.min(2000, e.movementY)) * scale * (settings.invertY ? -1 : 1)));
  };
  private mouseDown = (e: MouseEvent): void => {
    if (!this.active() || e.target !== this.deps.canvas) return;
    this.stop(e); if (e.button === 0 && !this.returning) this.fire = true;
  };
  private mouseUp = (e: MouseEvent): void => {
    if (!this.active()) return;
    this.stop(e); if (e.button === 0) this.fire = false;
  };
  private blur = (): void => { this.requestExit(); };
  private pointerLockChange = (e: Event): void => {
    if (!this.active() || document.pointerLockElement === this.deps.canvas) return;
    // Player's earlier listener has already cleared its lock and held keys;
    // keep the later menu listener from treating possession exit as pause.
    e.stopImmediatePropagation(); this.requestExit();
  };
}
