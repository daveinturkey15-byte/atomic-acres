/**
 * STATIC BATCH - collapse a finished, never-animated sub-tree into one mesh per
 * (material instance, shadow flags, attribute set).
 *
 * WHY THIS IS NOT `Batch` FROM yards.ts. That class is an *instancer*: it collects
 * unit box / cylinder / icosphere transforms and emits one InstancedMesh per material.
 * It only works when every part IS one of those three primitives. A vehicle is not:
 * the coach hull is a lofted one-off, the swooshes are extrusions, the bumpers are
 * torus arcs, and the panels are boxes of thirty different sizes. Those cannot be
 * expressed as scaled unit primitives, so the instancer has nothing to hold them.
 * This file is the other half of the same idea - bake the world matrix into the
 * vertices and concatenate - and the two are complementary, not parallel.
 *
 * ------------------------------------------------------------------ THE CONTRACT
 *
 * WHAT IT CONSUMES - and nothing else. A `Mesh` (or `InstancedMesh`) under `root`
 * is eligible only when ALL of these hold:
 *   - it is not `root` itself;
 *   - `material` is a single material, not an array, and not `transparent`;
 *   - it is not a `SkinnedMesh` and its geometry has no morph attributes;
 *   - every geometry attribute is backed by a `Float32Array`;
 *   - it has no children of its own;
 *   - the caller's `keep(mesh)` did not claim it;
 *   - neither it nor any ancestor below `root` has `visible === false`;
 *   - if instanced: `count <= MAX_EXPAND` and it carries no `instanceColor`;
 *   - its local-to-root transform (composed with each instance matrix) has a
 *     POSITIVE determinant;
 *   - and it shares its (material instance, castShadow, receiveShadow, attribute
 *     set) group with at least one other eligible mesh.
 * An eligible mesh is removed from its parent, its geometry is disposed, and its
 * triangles reappear - unchanged, in traversal order, in root-local space - inside
 * one merged `Mesh` added directly to `root`.
 *
 * WHAT IT LEAVES, exactly as it found it: everything else. Transparent surfaces
 * (merging two alpha surfaces into one draw throws away the per-object sort that
 * makes them composite correctly), skinned and morphed meshes, meshes that parent
 * other objects, anything the caller kept, a lone mesh in its group (already one
 * draw call; merging it would only throw away its own bounding volume), and every
 * one of the five hazards below.
 *
 * WHAT IT DELETES: nothing. The only objects that leave the tree are the consumed
 * meshes - whose triangles are re-emitted in the merge - and `THREE.Group` nodes
 * that the batcher itself emptied and that therefore held nothing but consumed
 * meshes (or other such groups). A `Light`, `Sprite`, `Points`, `Line`, `Bone`,
 * `Camera` or bare `Object3D` under `root` is never merged, never pruned and never
 * disposed, whether it has children or not. Groups that were already empty when
 * the batcher arrived are left too: the batcher did not empty them, so it does not
 * know they are disposable.
 *
 * THE FIVE HAZARDS, and why they are loud. Each is a case where the batcher COULD
 * have produced a plausible-looking scene that is quietly wrong, and none of them
 * is triggered by the current fleet - which is exactly why they need a gate rather
 * than a comment. In every case the object is left untouched, counted in
 * `report.left`, listed in `report.hazards`, and reported through the project's
 * dev-throw pattern (throw under `import.meta.env.DEV`, `console.error` in a built
 * artifact, so a live map is never taken down in front of a player):
 *   1. a non-Mesh, non-Group object - the previous prune removed ANY childless
 *      non-Mesh, so a Light under a batched root vanished with no warning, against
 *      the project rule that a light is never added, removed or hidden;
 *   2. `visible === false` on the mesh or on an ancestor below `root` - a
 *      deliberately hidden part would be merged and SHOWN;
 *   3. `instanceColor` on an InstancedMesh that would be expanded - per-instance
 *      colour has nowhere to go in a merged geometry and would be silently lost;
 *   4. a negative-determinant (mirrored) transform - `applyMatrix4` flips the
 *      winding of the triangles but does not reverse the index order, so the copy
 *      renders inside-out;
 *   5. a geometry whose attributes are not all Float32 is routine, not a hazard:
 *      it is left because widening it would be a guess, and it is counted as such.
 *
 * WHAT IT COSTS
 *  - frustum culling granularity. Call it on ONE vehicle, not on a whole street:
 *    a merged mesh is culled as a unit, so merging things that are not co-visible
 *    submits triangles a per-part tree would have dropped.
 *  - vertex memory. A merged group carries every vertex of every part, and an
 *    InstancedMesh that is expanded here pays count x its geometry.
 */
import * as THREE from 'three';

/** An InstancedMesh with more instances than this stays an InstancedMesh. */
const MAX_EXPAND = 200;

export interface StaticBatchReport {
  /** meshes in the sub-tree before */
  meshesBefore: number;
  /** meshes in the sub-tree after */
  meshesAfter: number;
  /** merged meshes emitted */
  groups: number;
  /** empty THREE.Group nodes the batcher itself emptied, and then removed */
  pruned: number;
  /** meshes left exactly as they were, by reason */
  left: Record<string, number>;
  /**
   * One line per object left for a reason that is a latent authoring bug rather
   * than routine, `name: reason`. This is also the text of the dev throw - a skip
   * this file cannot make safe is never allowed to be silent.
   */
  hazards: string[];
}

/**
 * Does this material sample anything through UVs? If not, the uv attribute is dead
 * weight AND an artificial group boundary: the lofted coach hull carries position +
 * normal only, and would otherwise never merge with the boxes wearing the same paint.
 * Dropping uv from a geometry whose material has no maps is provably safe here - the
 * hull already renders correctly with no uv at all through the same `painted()` key.
 */
function usesUV(m: THREE.Material): boolean {
  const any = m as unknown as Record<string, unknown>;
  for (const slot of [
    'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap',
    'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap', 'specularMap',
    'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'sheenColorMap',
    'sheenRoughnessMap', 'transmissionMap', 'thicknessMap', 'iridescenceMap',
    'specularColorMap', 'specularIntensityMap', 'anisotropyMap',
  ]) {
    if (any[slot]) return true;
  }
  return false;
}

/** Stable description of an attribute set, so two geometries only merge if they match. */
function attrKey(g: THREE.BufferGeometry): string {
  return Object.keys(g.attributes).sort().map((n) => {
    const a = g.attributes[n] as THREE.BufferAttribute;
    return n + ':' + a.itemSize + ':' + (a.normalized ? 1 : 0) + ':' + a.array.constructor.name;
  }).join('|');
}

/** Every attribute a Float32 array? Anything else is left alone rather than guessed at. */
function allFloat32(g: THREE.BufferGeometry): boolean {
  for (const n of Object.keys(g.attributes)) {
    if (!((g.attributes[n] as THREE.BufferAttribute).array instanceof Float32Array)) return false;
  }
  return true;
}

function dropUV(g: THREE.BufferGeometry): void {
  for (const n of ['uv', 'uv1', 'uv2', 'uv3']) {
    if (g.attributes[n]) g.deleteAttribute(n);
  }
}

/** Something to call an object by in a hazard line, even when nobody named it. */
function label(o: THREE.Object3D): string {
  return (o.name || '<unnamed>') + ' [' + o.type + ']';
}

/**
 * The nearest ancestor at or below `root` that is switched off, or null. `root`
 * itself is excluded on purpose: hiding the whole sub-tree hides the merged mesh
 * with it, so merging inside a hidden root changes nothing a viewer can see.
 */
function hiddenUnder(m: THREE.Object3D, root: THREE.Object3D): THREE.Object3D | null {
  for (let o: THREE.Object3D | null = m; o && o !== root; o = o.parent) {
    if (!o.visible) return o;
  }
  return null;
}

/** Concatenate geometries that have already been baked into a common space. */
function mergeBaked(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Mixed index/no-index cannot be concatenated; flatten the whole group instead.
  // Triangle count is untouched by that - only the vertex count grows.
  const indexed = parts.every((p) => p.index !== null);
  const src = indexed ? parts : parts.map((p) => (p.index ? p.toNonIndexed() : p));

  const names = Object.keys(src[0].attributes);
  let verts = 0;
  let indices = 0;
  for (const p of src) {
    verts += (p.attributes[names[0]] as THREE.BufferAttribute).count;
    if (p.index) indices += p.index.count;
  }

  const out = new THREE.BufferGeometry();
  for (const n of names) {
    const item = (src[0].attributes[n] as THREE.BufferAttribute).itemSize;
    const arr = new Float32Array(verts * item);
    let at = 0;
    for (const p of src) {
      const a = (p.attributes[n] as THREE.BufferAttribute).array as Float32Array;
      arr.set(a, at);
      at += a.length;
    }
    out.setAttribute(n, new THREE.BufferAttribute(arr, item,
      (src[0].attributes[n] as THREE.BufferAttribute).normalized));
  }
  if (indexed) {
    const idx = new Uint32Array(indices);
    let at = 0;
    let base = 0;
    for (const p of src) {
      const pi = p.index!;
      for (let i = 0; i < pi.count; i++) idx[at + i] = pi.getX(i) + base;
      at += pi.count;
      base += (p.attributes[names[0]] as THREE.BufferAttribute).count;
    }
    out.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  // parts we created inside this function (toNonIndexed copies) are ours to drop
  if (!indexed) for (let i = 0; i < src.length; i++) if (src[i] !== parts[i]) src[i].dispose();
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/**
 * Local-to-root transform, built by walking the parent chain and multiplying LOCAL
 * matrices. `inverse(root.matrixWorld) * mesh.matrixWorld` gives the same answer in
 * exact arithmetic, but a vehicle parked 40 m out and yawed loses ~0.05 mm in the
 * round trip, which is enough to move a baked vertex off the value it had. Walking
 * the chain never sees the root's own placement at all, so a part comes out at exactly
 * the coordinates the builder authored.
 */
function localToRoot(m: THREE.Object3D, root: THREE.Object3D, out: THREE.Matrix4): void {
  out.identity();
  for (let o: THREE.Object3D | null = m; o && o !== root; o = o.parent) out.premultiply(o.matrix);
}

interface Slot {
  mat: THREE.Material;
  cast: boolean;
  recv: boolean;
  parts: THREE.BufferGeometry[];
  sources: THREE.Mesh[];
}

/**
 * Merge the static meshes under `root` in place. Geometry is baked into ROOT-LOCAL
 * space, so `root` keeps its own transform and may still be moved as a whole.
 *
 * `keep(mesh)` returning true leaves that mesh exactly where it is.
 *
 * Throws under `import.meta.env.DEV` if the sub-tree contains any of the five
 * hazards in the file header; in a built artifact it reports them on the console
 * and returns normally. See `scripts/_verify-static-batch.mjs` for the falsifier.
 */
export function batchStatic(
  root: THREE.Object3D,
  tag: string,
  keep?: (m: THREE.Mesh) => boolean,
): StaticBatchReport {
  root.updateMatrixWorld(true);
  const left: Record<string, number> = {};
  const note = (why: string): void => { left[why] = (left[why] ?? 0) + 1; };
  const hazards: string[] = [];
  /** left alone AND reported: a skip that would otherwise ship silently wrong. */
  const hazard = (o: THREE.Object3D, why: string, reason: string): void => {
    note(why);
    hazards.push(label(o) + ': ' + reason);
  };

  const slots = new Map<string, Slot>();
  const sourceGeos = new Set<THREE.BufferGeometry>();
  let meshesBefore = 0;

  const world = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  const inst = new THREE.Matrix4();
  root.traverse((o) => {
    if (o === root) return;
    const m = o as THREE.Mesh;
    if (!m.isMesh) {
      // HAZARD 1. Structural cargo the batcher has no business touching. The prune
      // at the bottom of this function used to take any childless non-Mesh with it.
      if (!(o as THREE.Group).isGroup) {
        hazard(o, 'foreign-object', 'not a Mesh and not a Group, so the batcher '
          + 'neither merges nor prunes it - it is left exactly where it is. A Light '
          + 'here would once have been removed by the empty-group prune.');
      }
      return;
    }
    meshesBefore++;
    const mat = m.material as THREE.Material;
    if (Array.isArray(m.material)) { note('multi-material'); return; }
    if (mat.transparent) { note('transparent'); return; }
    if ((m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) { note('skinned'); return; }
    if (m.geometry.morphAttributes && Object.keys(m.geometry.morphAttributes).length) {
      note('morph'); return;
    }
    if (!allFloat32(m.geometry)) { note('non-float32'); return; }
    // A mesh that parents other objects cannot be removed without taking them with
    // it (the display plinth hangs its placard head off the board mesh).
    if (m.children.length) { note('has-children'); return; }
    if (keep && keep(m)) { note('kept-by-caller'); return; }

    // HAZARD 2. Merging a switched-off mesh into a visible batch SHOWS it. The test
    // is on the chain up to root, because hiding a Group hides its meshes without
    // touching their own `visible`.
    const off = hiddenUnder(m, root);
    if (off) {
      hazard(m, 'hidden', 'visible=false on ' + (off === m ? 'itself' : label(off))
        + ' - merging it into a visible batch would SHOW it; left switched off.');
      return;
    }

    const im = m as THREE.InstancedMesh;
    const count = im.isInstancedMesh ? im.count : 1;
    if (count > MAX_EXPAND) { note('instanced-too-many'); return; }

    // HAZARD 3. Per-instance colour has nowhere to live in a merged geometry: the
    // expansion would bake the transforms and drop the colours without a word.
    if (im.isInstancedMesh && im.instanceColor) {
      hazard(m, 'instance-color', 'InstancedMesh carries instanceColor, which a '
        + 'merged geometry cannot express - expanding it would silently repaint '
        + 'every instance in the material colour; left instanced.');
      return;
    }

    localToRoot(m, root, local);
    // HAZARD 4. applyMatrix4 mirrors the vertices but leaves the index order alone,
    // so a negative-determinant placement comes out with reversed winding: back
    // faces forward, front faces culled. Detected on the COMPOSED matrix so a
    // mirrored instance inside an otherwise ordinary mesh is caught too.
    let mirrored = false;
    for (let i = 0; i < count; i++) {
      world.copy(local);
      if (im.isInstancedMesh) { im.getMatrixAt(i, inst); world.multiply(inst); }
      if (world.determinant() < 0) { mirrored = true; break; }
    }
    if (mirrored) {
      hazard(m, 'mirrored', 'negative-determinant (mirrored) local-to-root transform '
        + '- applyMatrix4 does not reverse the index winding, so the merged copy '
        + 'would render inside-out; left as its own draw.');
      return;
    }

    const baked: THREE.BufferGeometry[] = [];
    for (let i = 0; i < count; i++) {
      world.copy(local);
      if (im.isInstancedMesh) {
        im.getMatrixAt(i, inst);
        world.multiply(inst);
      }
      const g = m.geometry.clone();
      if (!usesUV(mat)) dropUV(g);
      g.applyMatrix4(world);
      baked.push(g);
    }

    const cast = m.castShadow;
    const recv = m.receiveShadow;
    const key = mat.uuid + '|' + (cast ? 1 : 0) + (recv ? 1 : 0) + '|' + attrKey(baked[0]);
    let slot = slots.get(key);
    if (!slot) { slot = { mat, cast, recv, parts: [], sources: [] }; slots.set(key, slot); }
    for (const g of baked) slot.parts.push(g);
    slot.sources.push(m);
    sourceGeos.add(m.geometry);
  });

  let groups = 0;
  /** Groups the batcher itself emptied - the ONLY nodes it is allowed to prune. */
  const emptied = new Set<THREE.Object3D>();
  for (const slot of slots.values()) {
    // One source mesh is already one draw call; merging it buys nothing and would
    // only throw away its own bounding volume.
    if (slot.sources.length < 2) {
      note('alone-in-group');
      for (const g of slot.parts) g.dispose();
      continue;
    }
    const merged = new THREE.Mesh(mergeBaked(slot.parts), slot.mat);
    merged.castShadow = slot.cast;
    merged.receiveShadow = slot.recv;
    merged.name = tag + '-b' + groups;
    for (const g of slot.parts) g.dispose();
    for (const s of slot.sources) {
      const parent = s.parent;
      s.removeFromParent();
      if (parent) emptied.add(parent);
    }
    root.add(merged);
    groups++;
  }

  // The source geometries were never rendered, but drop their CPU arrays anyway.
  // One traversal collects what is still mounted - a geometry shared by two source
  // meshes (the second bus's mascot uses one for both flanks) must survive if either
  // of them was left behind, and must only ever be disposed once.
  const stillMounted = new Set<THREE.BufferGeometry>();
  root.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g) stillMounted.add(g); });
  for (const g of sourceGeos) if (!stillMounted.has(g)) g.dispose();

  // A group that lost every child is a pure object-count tax. Prune to a fixed
  // point: emptying a child group can empty its parent in turn. The candidate set
  // is CLOSED - only nodes this call emptied, and only plain THREE.Group instances.
  // The previous version walked the whole sub-tree and removed any childless
  // non-Mesh, which would have deleted a Light, Sprite, Points, Line, Bone or
  // Camera with no warning, and would also have swept away empty groups that were
  // already empty before it ran and are therefore not its to judge.
  let pruned = 0;
  for (;;) {
    const gone: THREE.Object3D[] = [];
    for (const o of emptied) {
      if (o === root || o.children.length > 0) continue;
      if (!(o as THREE.Group).isGroup) continue;
      gone.push(o);
    }
    if (!gone.length) break;
    for (const g of gone) {
      const parent = g.parent;
      g.removeFromParent();
      emptied.delete(g);
      if (parent) emptied.add(parent);
      pruned++;
    }
  }

  let meshesAfter = 0;
  root.traverse((o) => { if (o !== root && (o as THREE.Mesh).isMesh) meshesAfter++; });

  if (hazards.length) {
    // Same shape as the yards.ts stair assertion: a hard stop while someone is
    // authoring, a loud line in a built artifact rather than a black map.
    const msg = '[static-batch] ' + tag + ': ' + hazards.length + ' object(s) left '
      + 'untouched for a reason that is a latent bug, not routine:\n  ' + hazards.join('\n  ');
    if (import.meta.env.DEV) throw new Error(msg);
    console.error(msg);
  }
  return { meshesBefore, meshesAfter, groups, pruned, left, hazards };
}
