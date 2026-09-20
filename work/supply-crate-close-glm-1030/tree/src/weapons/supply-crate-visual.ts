/**
 * Nuketown 2025 — Supply Crate VISUAL: the scene-side presentation of a
 * delivered supply crate (the CrateView the crate slice's header names).
 *
 * Owns ONLY drawing. The authoritative stepper (`game/killstreaks/effects/
 * supply-crate.ts`, pending lane `work/supply-crate-agy-0912`) owns every
 * gameplay truth: pickup holds, the secret roll, expiry, retirement. This
 * module never grants, never times gameplay, never invents a descent: the
 * vocabulary admits a crate as ALREADY LANDED (`crate-landed` = "draw the
 * box NOW", no air-time field), so the box appears at rest and DESCENT
 * REMAINS OPEN until the vocabulary grows an authoritative air-time.
 *
 * Lifecycle (keyed on `instanceId`):
 *   crate-landed  -> crate appears at (x,y,z), base ON the ground, closed.
 *                    Idempotent per id; oldest evicted past MAX_ACTIVE.
 *   crate-opened  -> lid opens on the next update() tick, presentation-local
 *                    clock (host `at` is never trusted as render time); the
 *                    instance disposes itself shortly after.
 *   streak-ended  -> un-opened crate disposes exactly once. An opened crate
 *                    already owns its exit; the ended notice is absorbed.
 *                    The runtime ends expiry (an effect never ends itself,
 *                    `killstreaks/runtime.ts` emits `streak-ended` WITH the
 *                    crate's `instanceId`), so expiry and early end share
 *                    this one path.
 *   clear()       -> generation/respawn reset: everything down, resources
 *                    stay pooled for the next match.
 *   dispose()     -> module INERT: pooled GPU resources freed, every method
 *                    no-ops afterwards (apply() cannot rebuild the pool).
 *
 * Budget: <= 4 draw calls per crate (body, lid, stencil = 3), ~110
 * triangles, MAX_ACTIVE = 4 crates, one shared <= 256 px texture (browser)
 * or a plain geometry plate fallback (no canvas - headless/CPU), ZERO
 * allocations per update() (backward-index iteration, no snapshots).
 * Idle module: no listeners (events are pushed in), no materials, no
 * geometry, no scene children.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// Event shapes. The real vocabulary is `work/supply-crate-agy-0912 -> src/
// game/events-crate.ts` (CrateLandedEvent, CrateOpenedEvent) folded into
// GameEvent by that lane's `events.ts`; expiry arrives as the runtime's
// `StreakEndedEvent` (which carries `instanceId`). `apply()` takes the
// caller's GameEvent union as read-only unknowns and narrows structurally,
// so this module compiles and tests standalone. The integration pin
// (`crate-visual-pin.ts`) asserts these mirrors against the real types in
// the lane tree - drift there is a compile error.
// ---------------------------------------------------------------------------

export interface CrateLandedShape {
  readonly type: 'crate-landed';
  readonly instanceId: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface CrateOpenedShape {
  readonly type: 'crate-opened';
  readonly instanceId: number;
}

export interface CrateEndedShape {
  readonly type: 'streak-ended';
  readonly instanceId: number;
}

/** Authored look. Palette lives here, named, until core/palette.ts grows a crate row. */
const OLIVE = 0x55613a;
const OLIVE_DARK = 0x3f4928;
const LID_WOOD = 0x8a6b45;
const STENCIL_WHITE = 0xf2efe6;

/** Body L x H x D in metres - authored, believable supply-box scale; the
 *  authority defines no crate bounds (only the 2.75 m pickup radius), so this
 *  stays well inside one placement cell and records that gap. */
const BODY_L = 0.95;
const BODY_H = 0.55;
const BODY_D = 0.62;

/** Concurrent crates cap. Exported so tests pin behaviour, not a copied number. */
export const SUPPLY_CRATE_MAX_ACTIVE = 4;
const MAX_ACTIVE = SUPPLY_CRATE_MAX_ACTIVE;
const OPEN_MS = 450;
const LINGER_MS = 900;
const LIFT = 0.24;
const LID_TILT = -1.15;

/** Shared, built once on first admission: 1 texture, 4 materials, 3 geometries. */
interface Pool {
  bodyGeo: THREE.BufferGeometry;
  lidGeo: THREE.BufferGeometry;
  stencilGeo: THREE.BufferGeometry;
  olive: THREE.MeshStandardMaterial;
  oliveDark: THREE.MeshStandardMaterial;
  lidWood: THREE.MeshStandardMaterial;
  stencil: THREE.MeshStandardMaterial;
  texture: THREE.CanvasTexture | null;
}

let pool: Pool | null = null;

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function drawStencil(c: CanvasRenderingContext2D, s: number): void {
  c.clearRect(0, 0, s, s);
  c.fillStyle = '#f2efe6';
  c.strokeStyle = '#f2efe6';
  const m = s * 0.12;
  c.lineWidth = s * 0.03;
  c.strokeRect(m, m, s - 2 * m, s - 2 * m);
  c.font = `bold ${Math.floor(s * 0.17)}px sans-serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('SUPPLY', s / 2, s / 2);
}

/** One shared stencil texture; null when no canvas (headless CPU run) - the
 *  stencil plate then reads as plain painted geometry, which the CPU tests cover. */
function makeStencilTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 256;
  cv.height = 256;
  const c = cv.getContext('2d');
  if (!c) return null;
  drawStencil(c, 256);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function buildPool(): Pool {
  const parts: THREE.BufferGeometry[] = [
    box(BODY_L, BODY_H, BODY_D, 0, BODY_H / 2, 0),
    box(BODY_L + 0.04, 0.07, BODY_D + 0.04, 0, BODY_H * 0.3, 0),
    box(BODY_L + 0.04, 0.07, BODY_D + 0.04, 0, BODY_H * 0.72, 0),
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    parts.push(box(0.07, BODY_H + 0.02, 0.07, sx * (BODY_L / 2 - 0.035), (BODY_H + 0.02) / 2 - 0.01, sz * (BODY_D / 2 - 0.035)));
  }
  const bodyGeo = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();

  const lidGeo = mergeGeometries([
    box(BODY_L - 0.08, 0.05, BODY_D - 0.08, 0, BODY_H - 0.025, 0),
    box(0.18, 0.03, 0.05, 0, BODY_H + 0.01, 0),
  ], false);

  const face = new THREE.PlaneGeometry(0.5, 0.22);
  const back = face.clone().rotateY(Math.PI);
  face.translate(0, BODY_H * 0.52, BODY_D / 2 + 0.002);
  back.translate(0, BODY_H * 0.52, -BODY_D / 2 - 0.002);
  const stencilGeo = mergeGeometries([face, back], false);
  face.dispose();
  back.dispose();

  const texture = makeStencilTexture();
  const stencil = new THREE.MeshStandardMaterial(
    texture
      ? { map: texture, transparent: true, alphaTest: 0.35, roughness: 0.9, metalness: 0 }
      : { color: STENCIL_WHITE, roughness: 0.9, metalness: 0 },
  );
  return {
    bodyGeo, lidGeo, stencilGeo,
    olive: new THREE.MeshStandardMaterial({ color: OLIVE, roughness: 0.82, metalness: 0.05 }),
    oliveDark: new THREE.MeshStandardMaterial({ color: OLIVE_DARK, roughness: 0.85, metalness: 0.05 }),
    lidWood: new THREE.MeshStandardMaterial({ color: LID_WOOD, roughness: 0.75, metalness: 0 }),
    stencil,
    texture,
  };
}

/** Deterministic yaw from the instance id - no Math.random, no world variance. */
function yawFor(id: number): number {
  return (id * 2.399963229728653) % (Math.PI * 2);
}

interface Instance {
  readonly id: number;
  readonly group: THREE.Group;
  readonly lid: THREE.Mesh;
  readonly lidBaseY: number;
  opened: boolean;
  /** Local ms the open animation started, null until the next update() after open. */
  openT0: number | null;
  disposed: boolean;
}

export interface SupplyCrateVisualDeps {
  readonly scene: THREE.Scene;
}

export interface SupplyCrateVisual {
  /** Feed admitted game events in. Accepts any event array; unknown types are ignored. */
  apply(events: readonly unknown[]): void;
  /** Per-frame tick, presentation-local ms. No allocations. */
  update(nowMs: number): void;
  /** Generation/respawn reset: removes every crate, keeps pooled resources. */
  clear(): void;
  /** Frees pooled resources; the module is inert afterwards. */
  dispose(): void;
  readonly liveCount: number;
}

export function createSupplyCrateVisual(deps: SupplyCrateVisualDeps): SupplyCrateVisual {
  const scene = deps.scene;
  const crates = new Map<number, Instance>();
  const order: number[] = [];
  let dead = false;

  function disposeInstance(inst: Instance): void {
    if (inst.disposed) return;
    inst.disposed = true;
    scene.remove(inst.group);
    crates.delete(inst.id);
    const i = order.indexOf(inst.id);
    if (i >= 0) order.splice(i, 1);
  }

  function admit(ev: CrateLandedShape): void {
    if (crates.has(ev.instanceId)) return;
    if (!Number.isFinite(ev.x) || !Number.isFinite(ev.y) || !Number.isFinite(ev.z)) return;
    if (order.length >= MAX_ACTIVE) {
      const oldest = order[0];
      const victim = oldest === undefined ? undefined : crates.get(oldest);
      if (victim) disposeInstance(victim);
    }
    if (!pool) pool = buildPool();
    const group = new THREE.Group();
    const body = new THREE.Mesh(pool.bodyGeo, pool.olive);
    body.name = 'crate-body';
    const lid = new THREE.Mesh(pool.lidGeo, pool.lidWood);
    lid.name = 'crate-lid';
    const stencil = new THREE.Mesh(pool.stencilGeo, pool.stencil);
    stencil.name = 'crate-stencil';
    stencil.renderOrder = 1;
    group.add(body, lid, stencil);
    group.position.set(ev.x, ev.y, ev.z);
    group.rotation.y = yawFor(ev.instanceId);
    group.matrixAutoUpdate = false;
    group.updateMatrix();
    scene.add(group);
    const inst: Instance = {
      id: ev.instanceId,
      group, lid,
      lidBaseY: BODY_H - 0.025,
      opened: false, openT0: null, disposed: false,
    };
    crates.set(ev.instanceId, inst);
    order.push(ev.instanceId);
  }

  return {
    apply(events: readonly unknown[]): void {
      if (dead) return;
      for (const raw of events) {
        if (raw === null || typeof raw !== 'object') continue;
        const e = raw as { type?: unknown; instanceId?: unknown; x?: unknown; y?: unknown; z?: unknown };
        if (typeof e.type !== 'string' || typeof e.instanceId !== 'number') continue;
        if (e.type === 'crate-landed') {
          admit(e as unknown as CrateLandedShape);
        } else if (e.type === 'crate-opened') {
          const inst = crates.get(e.instanceId);
          if (inst && !inst.opened) { inst.opened = true; inst.openT0 = null; }
        } else if (e.type === 'streak-ended') {
          const inst = crates.get(e.instanceId);
          // An opened crate already owns its exit animation; absorb the notice.
          if (inst && !inst.opened) disposeInstance(inst);
        }
      }
    },

    update(nowMs: number): void {
      if (dead || order.length === 0) return;
      // Backward index walk: disposeInstance splices `order` at i, which cannot
      // disturb indices below i. No snapshot array, no per-frame allocation.
      for (let i = order.length - 1; i >= 0; i--) {
        const inst = crates.get(order[i]);
        if (!inst) continue;
        if (!inst.opened) continue;
        if (inst.openT0 === null) inst.openT0 = nowMs;
        const t = Math.min(1, (nowMs - inst.openT0) / OPEN_MS);
        const ease = 1 - (1 - t) * (1 - t);
        inst.lid.position.y = inst.lidBaseY + LIFT * ease;
        inst.lid.rotation.x = LID_TILT * ease;
        if (nowMs - inst.openT0 > OPEN_MS + LINGER_MS) disposeInstance(inst);
      }
    },

    clear(): void {
      if (dead) return;
      for (let i = order.length - 1; i >= 0; i--) {
        const inst = crates.get(order[i]);
        if (inst) disposeInstance(inst);
      }
    },

    dispose(): void {
      if (dead) return;
      dead = true;
      for (let i = order.length - 1; i >= 0; i--) {
        const inst = crates.get(order[i]);
        if (inst) disposeInstance(inst);
      }
      if (pool) {
        pool.bodyGeo.dispose();
        pool.lidGeo.dispose();
        pool.stencilGeo.dispose();
        pool.olive.dispose();
        pool.oliveDark.dispose();
        pool.lidWood.dispose();
        pool.stencil.dispose();
        if (pool.texture) pool.texture.dispose();
        pool = null;
      }
    },

    get liveCount(): number {
      return crates.size;
    },
  };
}
