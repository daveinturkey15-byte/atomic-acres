/**
 * CharacterSystem: owns every live character in a scene.
 *
 * One shared clip library, one geometry cache, one dress per faction - the
 * per-character cost is bones (21) + meshes (~26) + one mixer. LOD is
 * update-rate scaling by camera distance: beyond 25 m a rig ticks every 3rd
 * frame, beyond 50 m every 6th. Mixers interpolate, so the eye never catches
 * the skip; the CPU ledger does.
 *
 * Movement belongs to the game, not here: each handle exposes its RigInput
 * and root, and the caller (player controller, netcode, demo) steers.
 * update() advances the root along the handle yaw at input.speed so the
 * demo and the game share the one speed->motion contract the skate
 * measurement assumes.
 */
import * as THREE from 'three';
import { buildStandardSkeleton } from './skeleton';
import { buildClipLibrary, type ClipLibrary, type ClipName } from './clips';
import { CharacterRig, type RigInput } from './blend';
import { dressProcedural, type CharacterDress, type CharacterMesh } from './mesh';
import { installAnimQA } from './anim-qa';

export interface CharacterHandle {
  rig: CharacterRig;
  mesh: CharacterMesh;
  root: THREE.Object3D;
  input: RigInput;
  yaw: number;
  scale: number;
  /** Which dress this figure wears, or null when mesh.ts's round-robin chose. */
  faction: 0 | 1 | null;
}

export interface SystemBudget {
  characters: number;
  /** Extra draw calls the characters add (measured, not estimated). */
  calls: number;
  triangles: number;
  /** JS heap in MB at measure time, when the API exists. */
  heapMB: number;
}

export class CharacterSystem {
  readonly library: ClipLibrary;
  readonly characters: CharacterHandle[] = [];
  private frame = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly dress: CharacterDress,
  ) {
    this.library = buildClipLibrary();
    // Animation-lane QA surface (window.__NTANIM). Additive and read-only with
    // respect to the game: it exists because LICENCES-ANIMATION obligation 6
    // requires clips to be photographed IN THE GAME from four camera views, and
    // the six figures main.ts spawns are otherwise unreachable from a harness.
    try { installAnimQA(this); } catch { /* QA must never break a spawn */ }
  }

  get clipNames(): ClipName[] {
    return Object.keys(this.library) as ClipName[];
  }

  /**
   * @param faction 0 or 1, indexing `dress.factions`. Omit it and the figure
   *   takes the next dress in mesh.ts's round-robin, which is exactly what
   *   every existing caller gets today - passing nothing is byte-for-byte the
   *   old behaviour, deliberately, so wiring a team in is a caller's choice
   *   and not a change to anything already shipped.
   *
   *   How it threads without touching mesh.ts (which is read-only to this
   *   lane): mesh.ts picks `factions[n++ % factions.length]`, so handing it a
   *   dress whose `factions` array holds only the wanted entry pins the choice
   *   whatever its counter says. The geometry cache is keyed on the dress's
   *   colours, so a pinned spawn shares the same baked BufferGeometry as a
   *   round-robin spawn of the same faction - no extra geometry, no extra draw.
   *
   *   The one interaction worth knowing: mesh.ts's counter still advances on a
   *   pinned spawn, so MIXING pinned and unpinned spawns shifts which dress the
   *   unpinned ones get. Pin all of them or none of them.
   */
  spawn(x: number, z: number, yaw = 0, scale = 1, faction?: 0 | 1): CharacterHandle {
    const std = buildStandardSkeleton();
    const all = this.dress.factions;
    const dress = faction !== undefined && all && all.length > 0
      ? { ...this.dress, factions: [all[faction % all.length]] }
      : this.dress;
    const mesh = dressProcedural(std.root, std.bones, dress);
    const rig = new CharacterRig(std.root, std.bones, this.library);
    std.root.position.set(x, 0, z);
    std.root.rotation.y = yaw;
    std.root.scale.setScalar(scale);
    this.scene.add(std.root);
    const handle: CharacterHandle = {
      rig,
      mesh,
      root: std.root,
      input: { speed: 0, turnRate: 0, crouch: false, aimPitch: 0, aimWeight: 0 },
      yaw,
      scale,
      faction: faction ?? null,
    };
    this.characters.push(handle);
    return handle;
  }

  despawn(handle: CharacterHandle): void {
    const i = this.characters.indexOf(handle);
    if (i >= 0) this.characters.splice(i, 1);
    handle.mesh.dispose();
  }

  /**
   * Advance every character. `camPos` drives LOD; pass null to tick all.
   * Root motion here is deliberately dumb (yaw + speed): steering is the
   * caller's job, this only keeps motion and animation in one contract.
   */
  update(dt: number, camPos: THREE.Vector3 | null): void {
    this.frame++;
    for (const c of this.characters) {
      let step = dt;
      if (camPos) {
        const d = camPos.distanceTo(c.root.position);
        if (d > 50 && this.frame % 6 !== 0) continue;
        if (d > 25 && this.frame % 3 !== 0) continue;
        if (d > 50) step = dt * 6;
        else if (d > 25) step = dt * 3;
      }
      if (!c.rig.isDead && Math.abs(c.input.speed) > 0.001) {
        c.root.position.x += Math.sin(c.yaw) * c.input.speed * step;
        c.root.position.z += Math.cos(c.yaw) * c.input.speed * step;
      }
      c.rig.update(step, c.input);
    }
  }

  measure(renderer: THREE.WebGLRenderer): SystemBudget {
    const info = renderer.info;
    let heapMB = 0;
    const perf = performance as Performance & {
      memory?: { usedJSHeapSize: number };
    };
    if (perf.memory) heapMB = perf.memory.usedJSHeapSize / 1048576;
    return {
      characters: this.characters.length,
      calls: info.render.calls,
      triangles: info.render.triangles,
      heapMB: Math.round(heapMB * 10) / 10,
    };
  }
}
