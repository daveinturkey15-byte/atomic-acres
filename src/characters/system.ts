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

export interface CharacterHandle {
  rig: CharacterRig;
  mesh: CharacterMesh;
  root: THREE.Object3D;
  input: RigInput;
  yaw: number;
  scale: number;
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
  }

  get clipNames(): ClipName[] {
    return Object.keys(this.library) as ClipName[];
  }

  spawn(x: number, z: number, yaw = 0, scale = 1): CharacterHandle {
    const std = buildStandardSkeleton();
    const mesh = dressProcedural(std.root, std.bones, this.dress);
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
