/**
 * CharacterMesh: the pluggable mesh seam.
 *
 * The rig (blend.ts) animates bones; this file clothes them. Any mesh that
 * follows a standard skeleton qualifies - the procedural implementation below
 * today, a generated or Quaternius skinned mesh tomorrow - without touching
 * the skeleton, the clips or the blend tree.
 *
 * Materials are caller-owned and passed in: the game passes ctx.mat singletons
 * (no new shader programs), the demo page passes its own. This module never
 * constructs a material.
 *
 * WHY IT IS ONE SKINNED MESH NOW (2026-09-19, characters lane).
 * The previous implementation parented 27 separate THREE.Mesh objects to the
 * bones. Measured at spawnA through the real game loop with eleven figures
 * live: 1734 draw calls/frame with every figure visible, 1140 with all of them
 * hidden - 594 calls for eleven figures, exactly 54 each, which is 27 meshes
 * drawn twice (main pass + shadow pass). Against a 1200-call budget the figures
 * alone were a third of the frame. So the dressing is now baked ONCE, at module
 * level, into a single merged BufferGeometry bound to the skeleton:
 *
 *   - every part keeps the same primitive at the same offset it had as a child
 *     of its bone; its bind-pose matrix (rest-world of the bone * the part's
 *     local transform) is baked into the vertices, positions AND normals;
 *   - skinIndex is that one bone with weight 1.0. Rigid per-bone skinning is
 *     mathematically identical to parenting: with weight 1 the shader evaluates
 *     bone.matrixWorld * boneInverse * bindMatrix * v, and boneInverse *
 *     bindMatrix is precisely the rest-world matrix we baked out;
 *   - the dress travels in a per-vertex `color` attribute, so one material
 *     covers skin, fatigues, webbing, helmet and boots -> ONE draw per pass.
 *
 * The geometry is cached per dress, so spawning a figure allocates a
 * SkinnedMesh, a Skeleton and nothing else. Twelve figures share two
 * BufferGeometries.
 *
 * WHY THEY ARE OPERATORS AND NOT MANNEQUINS. The old dress was PAL.mannequin
 * skin + PAL.signTeal cloth - the same family as the shop dummies in
 * build/mannequins.ts - so at 20 m a bot and a dummy were the same object.
 * The part list below is read off the gameplay reference (docs/reference/
 * gameplay/f-aICKIbuo8zQ-162, f-FKQOEO-1ceE-055, f-aICKIbuo8zQ-030): helmet or
 * patrol cap, plate carrier with a triple mag pouch row, shoulder straps, a
 * back radio, rolled sleeves over bare forearms, gloves, belt and dump pouch,
 * thigh cargo pockets, kneepads, trousers bloused into boots. Colours are
 * VISUAL-BAR S7 families - olive, tan, grey-green, black webbing, warm skin.
 */
import * as THREE from 'three';
import {
  BONE_NAMES,
  BONE_PARENTS,
  REST_OFFSETS,
  type StandardBoneName,
} from './skeleton';

export interface CharacterMesh {
  /** Skeleton root, already dressed. Add to the scene, hand to the rig. */
  root: THREE.Object3D;
  /** Detach from parent. Shared geometries and caller materials are kept. */
  dispose(): void;
}

/**
 * Colours of one faction's kit. Values are sRGB hex from src/core/palette.ts;
 * they are baked into the shared geometry's vertex colours, so two factions
 * cost two BufferGeometries and zero extra draw calls.
 */
export interface FactionDress {
  /** Ballistic helmet (round, tall) or patrol cap (flat crown + peak). The
   *  silhouette difference is what separates the two sides at 20 m. */
  head: 'helmet' | 'cap';
  /** Exposed skin: face and rolled-sleeve forearms. Never PAL.mannequin. */
  skin: number;
  /** Fatigues: sleeves, trousers, torso under the carrier. */
  fatigue: number;
  /** Helmet or cap shell. */
  helmet: number;
  /** Plate carrier, pouches, shoulder straps, radio. */
  webbing: number;
  /** Boots, gloves, kneepads, belt - the near-black value break. */
  boot: number;
}

export interface CharacterDress {
  /** Legacy three-material seam, still used by the headless demo page. */
  skin: THREE.Material;
  cloth: THREE.Material;
  dark: THREE.Material;
  /**
   * The game path: ONE material for the whole figure. It must have
   * `vertexColors` on (src/core/materials.ts `mat.operator()`); the dress is
   * carried by the geometry. Omit it and the figure falls back to the three
   * materials above through three geometry groups - correct, but three draws
   * per pass instead of one.
   */
  material?: THREE.Material;
  /** One entry per faction, assigned round-robin in spawn order. */
  factions?: FactionDress[];
}

// ---------------------------------------------------------------------------
// Rest pose
// ---------------------------------------------------------------------------

/**
 * Rest-world matrix of every bone, relative to the character root.
 *
 * skeleton.ts builds bones with identity rest rotations and unit scale, so this
 * is a pure translation chain - but it is composed with Matrix4 rather than
 * summed, so a future skeleton that carries a rest rotation still bakes right.
 */
const REST_WORLD: Record<string, THREE.Matrix4> = (() => {
  const out: Record<string, THREE.Matrix4> = {};
  for (const name of BONE_NAMES) {
    const [x, y, z] = REST_OFFSETS[name];
    const local = new THREE.Matrix4().makeTranslation(x, y, z);
    const parent = BONE_PARENTS[name];
    out[name] = parent
      ? new THREE.Matrix4().multiplyMatrices(out[parent], local)
      : local;
  }
  return out;
})();

/**
 * Bone inverses handed to every Skeleton, so the bind pose can never drift with
 * the caller's transform state. Read-only: Skeleton.update() only multiplies by
 * them, so one frozen array serves every figure.
 */
const REST_INVERSES: THREE.Matrix4[] = BONE_NAMES.map(
  (n) => new THREE.Matrix4().copy(REST_WORLD[n]).invert(),
);

const BONE_INDEX: Record<string, number> = Object.fromEntries(
  BONE_NAMES.map((n, i) => [n, i]),
);

// ---------------------------------------------------------------------------
// Part list
// ---------------------------------------------------------------------------

/** Material slot. Mirrors the legacy skin / cloth / dark trio. */
const SKIN = 0;
const CLOTH = 1;
const DARK = 2;

interface Part {
  bone: StandardBoneName;
  geo: THREE.BufferGeometry;
  slot: 0 | 1 | 2;
  /** sRGB hex baked into the vertex colours. */
  colour: number;
  /** Multiplier on the baked colour - pocket flaps, boot soles, shaded kit. */
  tint?: number;
  pos?: [number, number, number];
  rot?: [number, number, number];
  scl?: [number, number, number];
}

const cap = (r: number, len: number): THREE.CapsuleGeometry =>
  new THREE.CapsuleGeometry(r, len, 3, 8);
const ball = (): THREE.SphereGeometry => new THREE.SphereGeometry(1, 10, 8);
const dome = (theta: number, seg = 12): THREE.SphereGeometry =>
  new THREE.SphereGeometry(1, seg, 7, 0, Math.PI * 2, 0, theta);
/** Band of a sphere between two polar angles - the balaclava over the jaw. */
const shell = (from: number, to: number, seg = 12): THREE.SphereGeometry =>
  new THREE.SphereGeometry(1, seg, 4, 0, Math.PI * 2, from, to - from);
const tube = (rt: number, rb: number, h: number, seg = 8, open = false):
  THREE.CylinderGeometry => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const box = (w: number, h: number, d: number): THREE.BoxGeometry =>
  new THREE.BoxGeometry(w, h, d);

/**
 * The whole figure, part by part, in the bone's local frame - exactly the
 * frame the old `put()` used, so nothing moved that was not meant to move.
 *
 * Proportions are metres against the 1.78 m standard skeleton (head top lands
 * near 1.82 m bare, 1.86 m helmeted - a kitted soldier). Measured against the
 * reference frames named in the module comment: the carrier reads as wide as
 * the shoulders and clearly deeper than the waist, the pouch row breaks the
 * chest into three values, the trouser blouses over a boot shaft that is a
 * separate darker block, and the helmet is wider than the skull.
 */
function operatorParts(d: FactionDress): Part[] {
  const p: Part[] = [];
  const add = (q: Part): void => { p.push(q); };

  // ---- head. Skull in skin so the face reads; headgear covers crown and back.
  add({ bone: 'Head', geo: ball(), slot: SKIN, colour: d.skin,
    pos: [0, 0.045, 0.006], scl: [0.098, 0.115, 0.108] });
  if (d.head === 'helmet') {
    // Ballistic dome: comes down past the ears, sits proud of the skull.
    add({ bone: 'Head', geo: dome(Math.PI * 0.62, 14), slot: CLOTH, colour: d.helmet,
      pos: [0, 0.046, -0.004], scl: [0.121, 0.130, 0.130] });
    // Rim line - the single detail that makes a dome read as a helmet.
    add({ bone: 'Head', geo: tube(0.124, 0.128, 0.026, 14, true), slot: CLOTH,
      colour: d.helmet, tint: 0.82, pos: [0, 0.012, -0.004] });
    // NVG mount on the brow: breaks the round silhouette against the sky.
    add({ bone: 'Head', geo: box(0.052, 0.038, 0.032), slot: DARK, colour: d.boot,
      pos: [0, 0.082, 0.112] });
  } else {
    // Patrol cap: flat crown plus a peak. Reads as "not a helmet" in one glance.
    add({ bone: 'Head', geo: dome(Math.PI * 0.5, 12), slot: CLOTH, colour: d.helmet,
      pos: [0, 0.052, 0.002], scl: [0.106, 0.082, 0.112] });
    add({ bone: 'Head', geo: box(0.168, 0.018, 0.088), slot: CLOTH, colour: d.helmet,
      tint: 0.86, rot: [-0.20, 0, 0], pos: [0, 0.056, 0.104] });
  }
  // Goggles / strap across the brow, both factions.
  add({ bone: 'Head', geo: box(0.208, 0.034, 0.016), slot: DARK, colour: d.boot,
    pos: [0, 0.050, 0.092] });
  // Balaclava. Without it the head is a bare warm ball under the headgear and
  // reads as a shop dummy - the exact failure this lane exists to fix. The
  // helmet's rim lands at skull polar angle ~0.63pi, so the two factions get
  // different faces from one part: under the helmet the cloth starts ABOVE the
  // rim and the head is fully masked (reference f-aICKIbuo8zQ-162, the hooded
  // runner); under the cap it starts at 0.64pi and leaves the brow-and-eyes
  // band bare (reference f-FKQOEO-1ceE-055, the sunlit tan operator).
  add({ bone: 'Head', geo: shell(Math.PI * (d.head === 'helmet' ? 0.58 : 0.645), Math.PI, 12),
    slot: DARK, colour: d.webbing, tint: 0.94, pos: [0, 0.045, 0.006],
    scl: [0.102, 0.119, 0.112] });

  // ---- neck and collar
  add({ bone: 'Neck', geo: cap(0.048, 0.05), slot: CLOTH, colour: d.fatigue,
    pos: [0, 0.026, 0] });

  // ---- chest: fatigue torso, then the carrier over it
  add({ bone: 'Chest', geo: tube(0.152, 0.112, 0.40), slot: CLOTH, colour: d.fatigue,
    pos: [0, 0.110, 0], scl: [1, 1, 0.68] });
  add({ bone: 'Chest', geo: tube(0.178, 0.166, 0.355), slot: DARK, colour: d.webbing,
    pos: [0, 0.126, 0.004], scl: [1, 1, 0.80] });
  // Triple mag pouch row on the front plate.
  for (const x of [-0.088, 0, 0.088]) {
    add({ bone: 'Chest', geo: box(0.082, 0.118, 0.056), slot: DARK, colour: d.webbing,
      tint: 0.78, pos: [x, 0.078, 0.128] });
  }
  // Admin pouch above the mags, radio on the back, straps over the traps.
  add({ bone: 'Chest', geo: box(0.132, 0.070, 0.046), slot: DARK, colour: d.webbing,
    tint: 0.90, pos: [0, 0.188, 0.118] });
  add({ bone: 'Chest', geo: box(0.190, 0.200, 0.086), slot: DARK, colour: d.webbing,
    tint: 0.86, pos: [0, 0.128, -0.138] });
  for (const x of [-0.102, 0.102]) {
    add({ bone: 'Chest', geo: box(0.062, 0.058, 0.205), slot: DARK, colour: d.webbing,
      pos: [x, 0.276, 0.004] });
  }
  add({ bone: 'Chest', geo: tube(0.074, 0.092, 0.072), slot: CLOTH, colour: d.fatigue,
    tint: 0.88, pos: [0, 0.290, 0], scl: [1, 1, 0.82] });

  // ---- abdomen, pelvis, belt
  add({ bone: 'Spine', geo: tube(0.114, 0.104, 0.20), slot: CLOTH, colour: d.fatigue,
    pos: [0, 0.020, 0], scl: [1, 1, 0.70] });
  add({ bone: 'Hips', geo: tube(0.114, 0.134, 0.17), slot: CLOTH, colour: d.fatigue,
    pos: [0, 0.052, 0], scl: [1, 1, 0.74] });
  add({ bone: 'Hips', geo: tube(0.138, 0.138, 0.056, 10), slot: DARK, colour: d.boot,
    pos: [0, 0.114, 0], scl: [1, 1, 0.80] });
  add({ bone: 'Hips', geo: box(0.086, 0.106, 0.078), slot: DARK, colour: d.webbing,
    tint: 0.88, pos: [-0.146, 0.054, -0.012] });

  for (const side of ['Left', 'Right'] as const) {
    const out = side === 'Left' ? -1 : 1;
    const S = (n: string): StandardBoneName => `${side}${n}` as StandardBoneName;

    // ---- arms: sleeve to the elbow, bare forearm, glove
    add({ bone: S('Shoulder'), geo: ball(), slot: CLOTH, colour: d.fatigue,
      scl: [0.076, 0.072, 0.076] });
    add({ bone: S('Arm'), geo: cap(0.057, 0.19), slot: CLOTH, colour: d.fatigue,
      pos: [0, -0.147, 0] });
    // Rolled cuff: the hard line where sleeve becomes skin.
    add({ bone: S('Arm'), geo: tube(0.060, 0.053, 0.046), slot: CLOTH, colour: d.fatigue,
      tint: 0.86, pos: [0, -0.262, 0] });
    add({ bone: S('ForeArm'), geo: cap(0.043, 0.18), slot: SKIN, colour: d.skin,
      pos: [0, -0.136, 0] });
    add({ bone: S('Hand'), geo: box(0.074, 0.104, 0.058), slot: DARK, colour: d.boot,
      pos: [0, -0.040, 0.004] });
    if (side === 'Right') {
      // Carried rifle, five boxes on the hand bone. Every operator in the
      // reference frames holds one and it is the single largest silhouette cue
      // after the carrier; baked into the same mesh it costs 60 triangles and
      // no draw call. The hand's rest frame has -y down the arm and +z forward,
      // so a receiver laid along +z points where the figure faces.
      add({ bone: S('Hand'), geo: box(0.046, 0.076, 0.30), slot: DARK,
        colour: d.boot, tint: 1.10, pos: [0, -0.046, 0.128] });
      add({ bone: S('Hand'), geo: box(0.034, 0.038, 0.26), slot: DARK,
        colour: d.boot, tint: 0.88, pos: [0, -0.062, 0.312] });
      add({ bone: S('Hand'), geo: box(0.030, 0.100, 0.056), slot: DARK,
        colour: d.boot, tint: 0.80, rot: [0.22, 0, 0], pos: [0, -0.112, 0.082] });
      add({ bone: S('Hand'), geo: box(0.042, 0.064, 0.165), slot: DARK,
        colour: d.boot, tint: 1.18, pos: [0, -0.030, -0.100] });
      add({ bone: S('Hand'), geo: box(0.032, 0.034, 0.072), slot: DARK,
        colour: d.boot, tint: 1.30, pos: [0, 0.006, 0.108] });
    }

    // ---- legs: trouser, cargo pocket, kneepad, blouse, boot
    add({ bone: S('UpLeg'), geo: ball(), slot: CLOTH, colour: d.fatigue,
      scl: [0.083, 0.078, 0.083] });
    add({ bone: S('UpLeg'), geo: cap(0.072, 0.29), slot: CLOTH, colour: d.fatigue,
      pos: [0, -0.215, 0] });
    add({ bone: S('UpLeg'), geo: box(0.056, 0.132, 0.094), slot: CLOTH, colour: d.fatigue,
      tint: 0.86, pos: [out * 0.070, -0.182, 0.012] });
    if (side === 'Right') {
      add({ bone: S('UpLeg'), geo: box(0.062, 0.128, 0.052), slot: DARK, colour: d.boot,
        pos: [0.080, -0.268, 0.016] });
    }
    add({ bone: S('Leg'), geo: box(0.108, 0.118, 0.078), slot: DARK, colour: d.boot,
      tint: 0.92, pos: [0, -0.028, 0.046] });
    add({ bone: S('Leg'), geo: cap(0.055, 0.28), slot: CLOTH, colour: d.fatigue,
      pos: [0, -0.180, 0] });
    // Blouse: the trouser gathered over the boot top.
    add({ bone: S('Leg'), geo: tube(0.074, 0.064, 0.058), slot: CLOTH, colour: d.fatigue,
      tint: 0.92, pos: [0, -0.262, 0] });
    add({ bone: S('Leg'), geo: tube(0.062, 0.058, 0.135, 8, true), slot: DARK,
      colour: d.boot, pos: [0, -0.336, 0] });
    add({ bone: S('Foot'), geo: ball(), slot: DARK, colour: d.boot,
      pos: [0, -0.004, 0.004], scl: [0.058, 0.050, 0.064] });
    add({ bone: S('Foot'), geo: box(0.098, 0.064, 0.200), slot: DARK, colour: d.boot,
      pos: [0, -0.010, 0.086] });
    // Sole: a darker block under the boot. The contact cue reads at distance.
    add({ bone: S('Foot'), geo: box(0.106, 0.024, 0.234), slot: DARK, colour: d.boot,
      tint: 0.62, pos: [0, -0.038, 0.076] });
  }

  return p;
}

// ---------------------------------------------------------------------------
// Bake
// ---------------------------------------------------------------------------

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _col = new THREE.Color();

/** Stable per-vertex hash in [0,1) from a baked position. No RNG, no seed. */
function hash01(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

interface Baked {
  geometry: THREE.BufferGeometry;
  triangles: number;
  parts: number;
}

/**
 * Merge every part into ONE geometry.
 *
 * Own merge rather than BufferGeometryUtils.mergeGeometries: that helper returns
 * null the moment two inputs disagree on their attribute set (the static-batcher
 * failure this project already hit once), and it cannot write the skin and
 * colour attributes we need. Indices are preserved and re-based, so the vertex
 * count stays at the indexed figure rather than tripling through toNonIndexed().
 *
 * Parts are emitted in slot order and three geometry groups are written, so the
 * same geometry serves the one-material game path (groups ignored) and the
 * demo's three-material array.
 */
function bake(parts: Part[]): Baked {
  const ordered = [...parts].sort((a, b) => a.slot - b.slot);

  let vTotal = 0;
  let iTotal = 0;
  const prepared = ordered.map((part) => {
    const g = part.geo;
    const [px, py, pz] = part.pos ?? [0, 0, 0];
    const [rx, ry, rz] = part.rot ?? [0, 0, 0];
    const [sx, sy, sz] = part.scl ?? [1, 1, 1];
    _q.setFromEuler(_e.set(rx, ry, rz));
    _m.compose(_v.set(px, py, pz), _q, _s.set(sx, sy, sz));
    // Bake the bind pose: rest-world of the bone, then the part's own local
    // transform. applyMatrix4 carries normals through the normal matrix, which
    // is why the non-uniform torso/head scales do not shear the shading.
    _m.premultiply(REST_WORLD[part.bone]);
    g.applyMatrix4(_m);
    const count = g.getAttribute('position').count;
    const index = g.getIndex();
    vTotal += count;
    iTotal += index ? index.count : count;
    return { part, g, count, index };
  });

  const position = new Float32Array(vTotal * 3);
  const normal = new Float32Array(vTotal * 3);
  const uv = new Float32Array(vTotal * 2);
  const colour = new Float32Array(vTotal * 3);
  const skinIndex = new Uint16Array(vTotal * 4);
  const skinWeight = new Float32Array(vTotal * 4);
  const indices = new Uint32Array(iTotal);

  const groups: { start: number; count: number; materialIndex: number }[] = [];
  let vOff = 0;
  let iOff = 0;
  let slotStart = 0;
  let slotNow = ordered.length ? ordered[0].slot : 0;

  for (const { part, g, count, index } of prepared) {
    if (part.slot !== slotNow) {
      groups.push({ start: slotStart, count: iOff - slotStart, materialIndex: slotNow });
      slotStart = iOff;
      slotNow = part.slot;
    }
    const pa = g.getAttribute('position');
    const na = g.getAttribute('normal');
    const ua = g.getAttribute('uv');
    const bone = BONE_INDEX[part.bone];
    // sRGB hex -> the renderer's working colour space, once, here.
    _col.set(part.colour);
    const tint = part.tint ?? 1;

    for (let i = 0; i < count; i++) {
      const v3 = (vOff + i) * 3;
      const px = pa.getX(i), py = pa.getY(i), pz = pa.getZ(i);
      position[v3] = px;
      position[v3 + 1] = py;
      position[v3 + 2] = pz;
      const nx = na ? na.getX(i) : 0;
      const ny = na ? na.getY(i) : 1;
      const nz = na ? na.getZ(i) : 0;
      normal[v3] = nx;
      normal[v3 + 1] = ny;
      normal[v3 + 2] = nz;
      if (ua) {
        uv[(vOff + i) * 2] = ua.getX(i);
        uv[(vOff + i) * 2 + 1] = ua.getY(i);
      }
      // Baked value modulation, free at runtime and worth two S-bar points:
      // downward faces lose light no directional lamp will ever give them back
      // (armpits, pouch undersides, the boot sole), upward faces gain a little
      // sky, and a fine deterministic grain keeps a 0.3 m flat panel of webbing
      // from reading as a single printed value (S4 two-scale breakup).
      const down = ny < 0 ? -ny : 0;
      const up = ny > 0 ? ny : 0;
      const shade = tint * (1 - 0.20 * down + 0.04 * up)
        * (0.972 + 0.056 * hash01(px, py, pz));
      colour[v3] = _col.r * shade;
      colour[v3 + 1] = _col.g * shade;
      colour[v3 + 2] = _col.b * shade;
      const v4 = (vOff + i) * 4;
      skinIndex[v4] = bone;
      skinWeight[v4] = 1;
    }
    if (index) {
      for (let i = 0; i < index.count; i++) indices[iOff + i] = index.getX(i) + vOff;
      iOff += index.count;
    } else {
      for (let i = 0; i < count; i++) indices[iOff + i] = vOff + i;
      iOff += count;
    }
    vOff += count;
    g.dispose();
  }
  groups.push({ start: slotStart, count: iOff - slotStart, materialIndex: slotNow });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.BufferAttribute(colour, 3));
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  for (const g of groups) if (g.count > 0) geometry.addGroup(g.start, g.count, g.materialIndex);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.name = 'operator';
  return { geometry, triangles: iOff / 3, parts: ordered.length };
}

/** One baked geometry per dress. Built on first use, never rebuilt. */
const bakedCache = new Map<string, Baked>();

function dressKey(d: FactionDress): string {
  return `${d.head}|${d.skin}|${d.fatigue}|${d.helmet}|${d.webbing}|${d.boot}`;
}

function bakedFor(d: FactionDress): Baked {
  const key = dressKey(d);
  let hit = bakedCache.get(key);
  if (!hit) {
    hit = bake(operatorParts(d));
    bakedCache.set(key, hit);
  }
  return hit;
}

/** Fallback dress for the legacy three-material seam (the demo page). */
const LEGACY: FactionDress = {
  head: 'helmet',
  skin: 0xb07a52,
  fatigue: 0xa8966b,
  helmet: 0x8e7f5a,
  webbing: 0x4a4236,
  boot: 0x26241f,
};

/**
 * Frustum sphere, set explicitly per figure.
 *
 * THREE.SkinnedMesh leaves `boundingSphere` null and computes it on the first
 * cull - by walking every vertex through its bone matrices, in whatever pose
 * that frame happened to be, and then caching it forever. That is both a stall
 * on the first frame and a sphere that a death animation can leave. One
 * generous sphere round the whole figure is cheaper and cannot pop.
 */
const CULL_CENTRE = new THREE.Vector3(0, 0.95, 0);
const CULL_RADIUS = 1.45;

// ---------------------------------------------------------------------------
// Public seam
// ---------------------------------------------------------------------------

/** Round-robin faction assignment, in spawn order. */
let spawnOrdinal = 0;

/** Live figures, for the QA surface below. */
const live = new Set<CharacterMesh>();

/**
 * Procedural implementation: ONE SkinnedMesh per figure, bound to the bones the
 * caller already built, dressed as a BO2-era operator. See the module comment
 * for why it is one mesh and what the parts are.
 */
export function dressProcedural(
  root: THREE.Object3D,
  bones: Record<StandardBoneName, THREE.Bone>,
  dress: CharacterDress,
): CharacterMesh {
  const factions = dress.factions?.length ? dress.factions : [LEGACY];
  const faction = factions[spawnOrdinal++ % factions.length];
  const baked = bakedFor(faction);

  // One material (vertex colours carry the dress) or the legacy trio through
  // the geometry's three groups. This module never constructs either.
  const material: THREE.Material | THREE.Material[] = dress.material
    ? dress.material
    : [dress.skin, dress.cloth, dress.dark];

  // Explicit bone inverses and an identity bind matrix: the bake is expressed
  // in the root's frame, so the figure must not pick up whatever transform the
  // root happens to carry when it is dressed.
  const skeleton = new THREE.Skeleton(
    BONE_NAMES.map((n) => bones[n]),
    REST_INVERSES,
  );
  const mesh = new THREE.SkinnedMesh(baked.geometry, material);
  mesh.name = 'operator';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.boundingSphere = new THREE.Sphere(CULL_CENTRE.clone(), CULL_RADIUS);
  mesh.bind(skeleton, new THREE.Matrix4());
  root.add(mesh);

  const handle: CharacterMesh = {
    root,
    dispose(): void {
      live.delete(handle);
      // Per-figure only. The geometry is shared by every figure of this faction
      // and the material is the caller's singleton; releasing either here would
      // black out the rest of the crowd. The skeleton's bone texture IS
      // per-figure, so it goes.
      mesh.removeFromParent();
      skeleton.dispose();
      root.parent?.remove(root);
    },
  };
  live.add(handle);
  return handle;
}

/**
 * `window.__NTMESH` - harness-only, additive, never read by the game.
 *
 * The draw-call and dispose claims in this lane are differences, and a
 * difference needs both ends measured in the same running page: how many
 * figures are live, how many triangles one of them is, and what
 * renderer.info.memory.geometries does when they are all released. Nothing
 * here mutates game state except disposeAll(), which a harness calls last.
 */
try {
  (globalThis as unknown as { __NTMESH?: unknown }).__NTMESH = {
    stats(): Record<string, unknown> {
      const dresses: Record<string, { triangles: number; parts: number; vertices: number }> = {};
      for (const [key, b] of bakedCache) {
        dresses[key] = {
          triangles: b.triangles,
          parts: b.parts,
          vertices: b.geometry.getAttribute('position').count,
        };
      }
      return { live: live.size, spawned: spawnOrdinal, geometries: bakedCache.size, dresses };
    },
    disposeAll(): number {
      const n = live.size;
      for (const h of [...live]) h.dispose();
      return n;
    },
  };
} catch { /* a QA surface must never break a spawn */ }

/**
 * External-skin seam (Quaternius, generated meshes, anything rigged).
 * A downloaded rigged mesh arrives with its own bone names and proportions;
 * bind it by mapping its joints onto the standard skeleton and playing the
 * same clips through retarget.ts - the mesh never touches the blend tree
 * directly. Implemented on first use with a real file; the interface above
 * is what it will satisfy, which is the seam this lane has to prove.
 */
export type { StandardBoneName };
