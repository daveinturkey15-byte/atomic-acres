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
import { BONE_NAMES } from './skeleton';

interface AnimSystem {
  characters: CharacterHandle[];
  spawn(x: number, z: number, yaw?: number, scale?: number, faction?: 0 | 1): CharacterHandle;
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
  spawn(x: number, z: number, yaw?: number, faction?: 0 | 1): number;
  report(): Record<string, string>;
  manifest(): unknown;
  load(base?: string): Promise<Record<string, string>>;
  list(): { i: number; x: number; z: number; yaw: number; speed: number; loco: string; faction: 0 | 1 | null }[];
  place(i: number, x: number, z: number, yaw?: number): boolean;
  pin(i: number, x: number, z: number, yaw?: number): boolean;
  unpin(): void;
  drive(i: number, speed: number, crouch?: boolean): boolean;
  aim(i: number, weight: number, pitch?: number): boolean;
  solo(i: number): number;
  showAll(): number;
  external(i: number, name: string): Promise<boolean>;
  clearExternal(i: number): boolean;
  carry(i: number, weight: number | null): boolean;
  surface(i: number): Record<string, number | string>;
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
    spawn(x, z, yaw = 0, faction) {
      system?.spawn(x, z, yaw, 1, faction);
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
        faction: c.faction,
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
      // `spec.loop` travels with the clip out of the glb's extras, so a
      // one-shot plays once and holds its last pose instead of restarting the
      // collapse from standing every 3.6 s.
      c.rig.playExternal(spec.clip, Math.max(0.01, spec.speed), spec.loop);
      return true;
    },
    clearExternal(i) {
      const c = pick(i);
      if (!c) return false;
      c.rig.stopExternal();
      return true;
    },
    /**
     * Force the weapon-carry layer's weight, or hand it back to the rig.
     *
     * The layer owns both arms, so a measurement OF THE CLIP DATA - upper-arm
     * abduction, the arm swing a seed produced - has to be taken with it off,
     * and a measurement of what the PLAYER sees has to be taken with it on.
     * Reporting one and calling it the other is how a lane claims a clip is
     * fixed when a solver is covering for it.
     */
    carry(i, weight) {
      const c = pick(i);
      if (!c) return false;
      if (weight === null) delete c.input.carryWeight;
      else c.input.carryWeight = Math.max(0, Math.min(1, weight));
      return true;
    },
    /**
     * THE ACCEPTANCE MEASUREMENT: read off the SKINNED SURFACE, not the bones.
     *
     * Bones are where the rig thinks it is; the surface is what the player
     * sees, and the two differ by the whole of the dressing - a helmet is 18 cm
     * of it. Every vertex is pushed through `applyBoneTransform`, which is the
     * same arithmetic the skinning shader runs, and then into world space.
     *
     *   surfaceTop     highest vertex of the figure, metres
     *   leftHandPt     centroid of the vertices skinned to LeftHand (the glove)
     *   forestockBone  where the solver aimed, from RightHand's world matrix
     *   forestockSurf  centroid of the RIFLE vertices in the handguard band -
     *                  an independent read of the same point, so a wrong offset
     *                  in blend.ts cannot agree with itself
     *   handToStock    the acceptance number, centimetres
     *   barrelVsChest  angle between the barrel axis and chest forward, degrees
     */
    surface(i): Record<string, number | string> {
      const c = pick(i);
      if (!c) return { error: 'no such figure' };
      const rig = c.rig;
      let mesh: THREE.SkinnedMesh | null = null;
      c.root.traverse((o) => { if (!mesh && (o as THREE.SkinnedMesh).isSkinnedMesh) mesh = o as THREE.SkinnedMesh; });
      if (!mesh) return { error: 'no SkinnedMesh under the root' };
      const sm = mesh as THREE.SkinnedMesh;
      c.root.updateMatrixWorld(true);
      const pos = sm.geometry.getAttribute('position');
      const skin = sm.geometry.getAttribute('skinIndex');
      const iLeftHand = BONE_NAMES.indexOf('LeftHand');
      const iRightHand = BONE_NAMES.indexOf('RightHand');
      const invRight = sm.skeleton.boneInverses[iRightHand];
      const v = new THREE.Vector3();
      const local = new THREE.Vector3();
      const hand = new THREE.Vector3();
      const stock = new THREE.Vector3();
      let top = -Infinity, nHand = 0, nStock = 0;
      for (let k = 0; k < pos.count; k++) {
        v.fromBufferAttribute(pos, k);
        const bone = skin.getX(k);
        if (bone === iRightHand) {
          // Bind-space position in the RightHand's own rest frame - exactly the
          // coordinates mesh.ts authored the rifle in. The handguard band is
          // 0.20..0.30 m down the receiver.
          local.copy(v).applyMatrix4(invRight);
          if (local.z > 0.20 && local.z < 0.30) {
            const w = v.clone();
            sm.applyBoneTransform(k, w);
            sm.localToWorld(w);
            stock.add(w); nStock++;
          }
        }
        sm.applyBoneTransform(k, v);
        sm.localToWorld(v);
        if (v.y > top) top = v.y;
        if (bone === iLeftHand) { hand.add(v); nHand++; }
      }
      if (nHand) hand.divideScalar(nHand);
      if (nStock) stock.divideScalar(nStock);

      const fore = new THREE.Vector3();
      const barrel = new THREE.Vector3();
      rig.weaponProbe(fore, barrel);

      // lean and abduction are joint angles by definition, so they come off the
      // bones - the surface has no shoulder.
      const ls = new THREE.Vector3(), rs = new THREE.Vector3(), hips = new THREE.Vector3();
      rig.bones.LeftShoulder.getWorldPosition(ls);
      rig.bones.RightShoulder.getWorldPosition(rs);
      rig.bones.Hips.getWorldPosition(hips);
      const spine = ls.clone().add(rs).multiplyScalar(0.5).sub(hips);
      const lean = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(spine.y / (spine.length() || 1), -1, 1)));
      const chestQ = new THREE.Quaternion();
      rig.bones.Chest.getWorldQuaternion(chestQ);
      const chestFwd = new THREE.Vector3(0, 0, 1).applyQuaternion(chestQ);
      const chestRight = new THREE.Vector3(1, 0, 0).applyQuaternion(chestQ);
      const chestUp = new THREE.Vector3(0, 1, 0).applyQuaternion(chestQ);
      const abd = (side: 'Left' | 'Right'): number => {
        const a = new THREE.Vector3(), b = new THREE.Vector3();
        rig.bones[`${side}Arm`].getWorldPosition(a);
        rig.bones[`${side}ForeArm`].getWorldPosition(b);
        const u = b.sub(a).normalize();
        const lat = u.dot(chestRight) * (side === 'Left' ? -1 : 1);
        return THREE.MathUtils.radToDeg(Math.atan2(lat, -u.dot(chestUp)));
      };
      return {
        loco: rig.currentLocomotion,
        faction: c.faction === null ? 'round-robin' : c.faction,
        surfaceTop: +top.toFixed(4),
        rootY: +c.root.position.y.toFixed(4),
        leanDeg: +lean.toFixed(2),
        abdLeftDeg: +abd('Left').toFixed(2),
        abdRightDeg: +abd('Right').toFixed(2),
        carry: +rig.carryWeight.toFixed(3),
        aimWeight: +c.input.aimWeight.toFixed(2),
        handToStockCm: nHand ? +(hand.distanceTo(fore) * 100).toFixed(1) : -1,
        handToStockSurfCm: nHand && nStock ? +(hand.distanceTo(stock) * 100).toFixed(1) : -1,
        stockBoneVsSurfCm: nStock ? +(stock.distanceTo(fore) * 100).toFixed(1) : -1,
        barrelVsChestDeg: +THREE.MathUtils.radToDeg(Math.acos(
          THREE.MathUtils.clamp(barrel.dot(chestFwd), -1, 1))).toFixed(1),
        // The aim ray as the character defines it: root yaw, aimPitch * 0.7.
        // Independent of whatever the animation did to the spine.
        barrelVsAimDeg: +THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(
          barrel.dot(new THREE.Vector3(
            0, Math.sin(c.input.aimPitch * 0.7), Math.cos(c.input.aimPitch * 0.7),
          ).applyQuaternion(c.root.getWorldQuaternion(new THREE.Quaternion()))), -1, 1))).toFixed(1),
        barrelPitchDeg: +THREE.MathUtils.radToDeg(Math.asin(
          THREE.MathUtils.clamp(barrel.y, -1, 1))).toFixed(1),
        vertices: pos.count,
      };
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
