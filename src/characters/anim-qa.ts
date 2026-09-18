/**
 * `window.__NTANIM` - the animation lane's QA surface.
 *
 * WHY IT HAS TO EXIST. docs/LICENCES-ANIMATION.md obligation 6 says a clip may
 * only be accepted from the GAME, photographed from four camera views, never
 * from a preview that renders on its own body at its own scale. The game spawns
 * six figures and never moves them, so without a handle on those figures there
 * is no way to photograph a walk at all, and the obligation cannot be met.
 *
 * It is deliberately thin. It holds no state of its own beyond the registration,
 * it reads and writes only the `RigInput` the character system already exposes,
 * and every method is wrapped by the caller's own try/catch. The one thing it
 * does own is a requestAnimationFrame loop for `measureSkate()`, because that
 * measurement is INCREMENTAL - it accumulates a planted foot's drift frame by
 * frame, so calling it from a CDP evaluate every few hundred milliseconds
 * measures nothing at all and would happily report 0 cm for a figure skating
 * across the map.
 */
import * as THREE from 'three';
import type { CharacterHandle } from './system';
import { bakedClip, bakedClipReport, bakedManifest, loadBakedClips } from './kimodo-clips';
import { buildClipLibrary } from './clips';

interface AnimSystem {
  characters: CharacterHandle[];
  spawn(x: number, z: number, yaw?: number, scale?: number): CharacterHandle;
  update(dt: number, camPos: THREE.Vector3 | null): void;
}

let system: AnimSystem | null = null;
let skateOn = false;
// A MAP, not one slot. The budget harness pins twelve figures; with a single
// slot each call overwrote the last, eleven of them kept walking at 1 m/s and
// were 40 m away by t+60s - which read as the draw-call cost quietly falling
// from 1571 to 1295 and would have been reported as the twelve-figure budget.
const pinned = new Map<number, { x: number; z: number; yaw: number }>();
let pinLoop = false;
let selfTicking = false;
let tickCount = 0;
let tickError = '';

export interface AnimQA {
  ready: boolean;
  count(): number;
  spawn(x: number, z: number, yaw?: number): number;
  report(): Record<string, string>;
  manifest(): unknown;
  load(base?: string): Promise<Record<string, string>>;
  list(): { i: number; x: number; z: number; yaw: number; speed: number; loco: string }[];
  place(i: number, x: number, z: number, yaw?: number): boolean;
  pin(i: number, x: number, z: number, yaw?: number): boolean;
  unpin(): void;
  drive(i: number, speed: number, crouch?: boolean): boolean;
  aim(i: number, weight: number, pitch?: number): boolean;
  solo(i: number): number;
  showAll(): number;
  external(i: number, name: string): Promise<boolean>;
  clearExternal(i: number): boolean;
  skateStart(i: number): boolean;
  skate(i: number): Record<string, number>;
  skateStop(): void;
  selfTick(on: boolean): boolean;
  verifySubstitution(): Promise<Record<string, string>>;
  ticks(): { n: number; error: string; on: boolean };
}

function pick(i: number): CharacterHandle | null {
  if (!system) return null;
  return system.characters[i] ?? null;
}

export function installAnimQA(s: AnimSystem): void {
  system = s;
  const w = globalThis as unknown as { __NTANIM?: AnimQA };
  if (w.__NTANIM) return;
  w.__NTANIM = {
    ready: true,
    count: () => system?.characters.length ?? 0,
    /** Grow the crowd for a budget run. The game spawns six; the budget is twelve. */
    spawn(x, z, yaw = 0) {
      system?.spawn(x, z, yaw);
      return system?.characters.length ?? 0;
    },
    report: () => bakedClipReport(),
    manifest: () => bakedManifest(),
    load: (base?: string) => loadBakedClips(base),
    list() {
      return (system?.characters ?? []).map((c, i) => ({
        i,
        x: +c.root.position.x.toFixed(2),
        z: +c.root.position.z.toFixed(2),
        yaw: +c.yaw.toFixed(3),
        speed: +c.input.speed.toFixed(2),
        loco: c.rig.currentLocomotion,
      }));
    },
    place(i, x, z, yaw) {
      const c = pick(i);
      if (!c) return false;
      c.root.position.set(x, c.root.position.y, z);
      if (yaw !== undefined) { c.yaw = yaw; c.root.rotation.y = yaw; }
      return true;
    },
    /**
     * Hold a figure on one spot while its clip keeps playing - a treadmill.
     * The four canary views need the subject framed identically in all four,
     * and a figure walking at 2.1 m/s leaves the frame in under a second. The
     * clip, its timeScale and the blend tree are all untouched; only the root
     * is held, and it is held on the FRAME LOOP so the camera never catches it
     * mid-drift. Skate must be measured with the pin OFF - a pinned foot is
     * sliding by definition.
     */
    pin(i, x, z, yaw) {
      const c = pick(i);
      if (!c) return false;
      pinned.set(i, { x, z, yaw: yaw ?? c.yaw });
      if (pinLoop) return true;
      pinLoop = true;
      const tick = (): void => {
        if (pinned.size === 0) { pinLoop = false; return; }
        for (const [k, p] of pinned) {
          const h = pick(k);
          if (!h) continue;
          h.root.position.x = p.x;
          h.root.position.z = p.z;
          h.yaw = p.yaw;
          h.root.rotation.y = p.yaw;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    },
    unpin() { pinned.clear(); },
    drive(i, speed, crouch = false) {
      const c = pick(i);
      if (!c) return false;
      c.input.speed = speed;
      c.input.crouch = crouch;
      return true;
    },
    aim(i, weight, pitch = 0) {
      const c = pick(i);
      if (!c) return false;
      c.input.aimWeight = weight;
      c.input.aimPitch = pitch;
      return true;
    },
    /** Hide every figure but one. The four canary views need one subject. */
    solo(i) {
      let hidden = 0;
      (system?.characters ?? []).forEach((c, k) => {
        const vis = k === i;
        c.root.visible = vis;
        if (!vis) hidden++;
      });
      return hidden;
    },
    showAll() {
      (system?.characters ?? []).forEach((c) => { c.root.visible = true; });
      return system?.characters.length ?? 0;
    },
    /**
     * Play a BAKED clip on a live figure, straight from the bakery registry.
     *
     * Deliberately NOT read from `rig.library`: the rig builds one action per
     * clip in its constructor, and `loadBakedClips()` is async, so by the time
     * a clip is fetched every rig already holds the procedural library. The
     * first run of this harness photographed four beautiful views of the
     * PROCEDURAL walk and reported them as the Kimodo canary - hipsY read
     * exactly 0.877, the rest value, which is the tell. The shipped path fixes
     * the ordering with one await in main.ts (see the lane report); this path
     * exists so the clip itself can be photographed regardless.
     */
    async external(i, name) {
      const c = pick(i);
      if (!c) return false;
      await loadBakedClips();
      const spec = bakedClip(name as never);
      if (!spec) return false;
      c.rig.playExternal(spec.clip, Math.max(0.01, spec.speed));
      return true;
    },
    clearExternal(i) {
      const c = pick(i);
      if (!c) return false;
      c.rig.stopExternal();
      return true;
    },
    /**
     * Start the per-frame skate accumulation. measureSkate() is incremental, so
     * it has to run on the frame loop; polling it from outside the page samples
     * a few scattered frames and reports a number that means nothing.
     */
    skateStart(i) {
      const c = pick(i);
      if (!c) return false;
      c.rig.resetSkate();
      if (skateOn) return true;
      skateOn = true;
      const tick = (): void => {
        if (!skateOn) return;
        const h = pick(i);
        if (h) h.rig.measureSkate();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    },
    skate(i) {
      const c = pick(i);
      if (!c) return {};
      return { worstCm: c.rig.measureSkate(), ...c.rig.debugSkate() };
    },
    skateStop() { skateOn = false; },
    /**
     * HARNESS ONLY, off by default.
     *
     * `main.ts` spawns six figures and never calls `characters.update(dt, ...)`,
     * so on this branch every figure stands frozen in its rest pose - which is
     * exactly what the first canary run photographed. The fix belongs in
     * main.ts, which this lane may not edit; until that line lands, the harness
     * drives the system itself so a clip can be seen at all. Turning this on
     * once main.ts ticks the system would double-step every rig, so it stays
     * opt-in and the report says so.
     */
    selfTick(on) {
      if (on === selfTicking) return selfTicking;
      selfTicking = on;
      if (!on) return false;
      let last = performance.now();
      const cam = new THREE.Vector3();
      const tick = (): void => {
        if (!selfTicking) return;
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        tickCount++;
        try { system?.update(dt, cam.set(0, 0, 0)); }
        catch (e) { tickError = String(e).slice(0, 200); }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    },
    ticks: () => ({ n: tickCount, error: tickError, on: selfTicking }),
    /**
     * Prove the SHIPPED path, not just the harness path.
     *
     * The canary photographs a clip via `playExternal`, which bypasses the clip
     * library entirely - so a green canary says the clip is good, and says
     * nothing about whether `buildClipLibrary()` would actually hand it to a
     * rig. This rebuilds the library AFTER the bakery has loaded (which is the
     * ordering the one-line main.ts wiring creates) and reports, per clip name,
     * whether the library came back with the baked AnimationClip or the
     * procedural one. Track count and duration identify it: a baked clip and
     * its procedural namesake never agree on both.
     */
    async verifySubstitution() {
      await loadBakedClips();
      const lib = buildClipLibrary();
      const out: Record<string, string> = {};
      for (const name of Object.keys(lib)) {
        const baked = bakedClip(name as never);
        const got = lib[name as keyof typeof lib];
        if (!baked) { out[name] = 'procedural (nothing baked for this name)'; continue; }
        out[name] = got.clip === baked.clip
          ? `BAKED ${got.clip.duration.toFixed(3)}s ${got.clip.tracks.length} tracks speed ${got.speed.toFixed(2)}`
          : 'procedural - SUBSTITUTION FAILED';
      }
      return out;
    },
  };
}
