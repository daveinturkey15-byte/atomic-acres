/**
 * Shared build kit. Every builder module in src/build/ takes a BuildContext and
 * returns a BuildResult. Builders NEVER touch the scene, the renderer or each other.
 */
import * as THREE from 'three';

/** Axis-aligned collider in world space. */
export interface AABB {
  min: THREE.Vector3;
  max: THREE.Vector3;
}

export interface BuildResult {
  group: THREE.Group;
  colliders: AABB[];
}

export interface BuildContext {
  mat: import('./materials').MaterialLibrary;
  /** deterministic per-module rng; same seed always gives the same world */
  rand: () => number;
}

export type Builder = (ctx: BuildContext) => BuildResult;

/** mulberry32 - small, fast, deterministic. */
export function makeRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A box mesh placed by its CENTRE. */
export function box(
  w: number, h: number, d: number,
  material: THREE.Material,
  x = 0, y = 0, z = 0,
): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** A box placed by its centre in x/z but sitting ON the ground at yBase. */
export function slab(
  w: number, h: number, d: number,
  material: THREE.Material,
  x = 0, yBase = 0, z = 0,
): THREE.Mesh {
  return box(w, h, d, material, x, yBase + h / 2, z);
}

export function aabbFromMesh(m: THREE.Object3D): AABB {
  const b = new THREE.Box3().setFromObject(m);
  return { min: b.min.clone(), max: b.max.clone() };
}

export function aabb(
  cx: number, cy: number, cz: number, w: number, h: number, d: number,
): AABB {
  return {
    min: new THREE.Vector3(cx - w / 2, cy - h / 2, cz - d / 2),
    max: new THREE.Vector3(cx + w / 2, cy + h / 2, cz + d / 2),
  };
}

/** Collider for a slab sitting on the ground. */
export function aabbSlab(
  cx: number, yBase: number, cz: number, w: number, h: number, d: number,
): AABB {
  return aabb(cx, yBase + h / 2, cz, w, h, d);
}

export function group(name: string): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  return g;
}

/** Merge several results into one, preserving names. */
export function combine(name: string, parts: BuildResult[]): BuildResult {
  const g = group(name);
  const colliders: AABB[] = [];
  for (const p of parts) {
    g.add(p.group);
    colliders.push(...p.colliders);
  }
  return { group: g, colliders };
}

/** Extruded profile helper: a closed 2D polygon in x/y swept along z. */
export function extrude(
  pts: [number, number][],
  depth: number,
  material: THREE.Material,
): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  geo.translate(0, 0, -depth / 2);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
