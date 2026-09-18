/**
 * Minimal glTF 2.0 / GLB writer for skeleton-only animation clips.
 *
 * WHY WRITE ONE RATHER THAN EXPORT FROM BLENDER. The clips have to drive the rig
 * that `src/characters/skeleton.ts` builds, and that rig has a property Blender
 * cannot represent: every bone's rest orientation is IDENTITY, with the bone's
 * direction carried entirely by its parent-relative translation. Blender forces
 * a bone's local +Y along the bone and bakes a roll, so a Blender round-trip
 * re-expresses every rotation in a different per-bone basis. The exported clip
 * would then need a second remap at load time - two lossy conversions to gain a
 * file format. Emitting glTF directly keeps the rest convention byte-identical
 * to the runtime rig, which is what makes `AnimationMixer` bind the tracks with
 * no remap at all.
 *
 * The output is ordinary glTF: node hierarchy + one animation, no mesh, no skin.
 * three's GLTFLoader names animation tracks after the node, so a node called
 * `Hips` yields `Hips.quaternion` / `Hips.position`, which is exactly what
 * `AnimationMixer(characterRoot)` resolves against `buildStandardSkeleton()`.
 */
import { writeFileSync } from 'node:fs';

const COMPONENT_FLOAT = 5126;

/**
 * @param {string} outPath
 * @param {{name:string, bones:{name:string,parent:number|null,translation:number[]}[],
 *          times:Float32Array, rotations:Record<string,Float32Array>,
 *          translations:Record<string,Float32Array>, extras?:object}} clip
 */
export function writeClipGlb(outPath, clip) {
  const buffers = [];
  const bufferViews = [];
  const accessors = [];
  let byteLength = 0;

  const pushData = (typed) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
    const pad = (4 - (byteLength % 4)) % 4;
    if (pad) { buffers.push(Buffer.alloc(pad)); byteLength += pad; }
    const offset = byteLength;
    buffers.push(bytes);
    byteLength += bytes.length;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    return bufferViews.length - 1;
  };

  const addAccessor = (typed, type, count, withMinMax) => {
    const view = pushData(typed);
    const acc = { bufferView: view, componentType: COMPONENT_FLOAT, count, type };
    if (withMinMax) {
      const stride = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
      const min = new Array(stride).fill(Infinity);
      const max = new Array(stride).fill(-Infinity);
      for (let i = 0; i < count; i++) {
        for (let c = 0; c < stride; c++) {
          const v = typed[i * stride + c];
          if (v < min[c]) min[c] = v;
          if (v > max[c]) max[c] = v;
        }
      }
      acc.min = min; acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };

  // --- nodes
  const nodes = clip.bones.map((b, bi) => {
    const n = { name: b.name, translation: b.translation };
    const kids = clip.bones.map((c, i) => (c.parent === bi ? i : -1)).filter((i) => i >= 0);
    if (kids.length) n.children = kids;
    return n;
  });
  const roots = clip.bones.map((b, i) => (b.parent === null ? i : -1)).filter((i) => i >= 0);

  // --- animation. One shared input accessor; the spec REQUIRES min/max on it.
  const frames = clip.times.length;
  const inputAcc = addAccessor(clip.times, 'SCALAR', frames, true);
  const samplers = [];
  const channels = [];
  for (let i = 0; i < clip.bones.length; i++) {
    const name = clip.bones[i].name;
    const rot = clip.rotations[name];
    if (rot) {
      const out = addAccessor(rot, 'VEC4', frames, false);
      samplers.push({ input: inputAcc, interpolation: 'LINEAR', output: out });
      channels.push({ sampler: samplers.length - 1, target: { node: i, path: 'rotation' } });
    }
    const tr = clip.translations[name];
    if (tr) {
      const out = addAccessor(tr, 'VEC3', frames, false);
      samplers.push({ input: inputAcc, interpolation: 'LINEAR', output: out });
      channels.push({ sampler: samplers.length - 1, target: { node: i, path: 'translation' } });
    }
  }

  const json = {
    asset: { version: '2.0', generator: 'nuketown scripts/animation/retarget-soma.mjs' },
    scene: 0,
    scenes: [{ nodes: roots }],
    nodes,
    animations: [{ name: clip.name, samplers, channels }],
    buffers: [{ byteLength }],
    bufferViews,
    accessors,
  };
  if (clip.extras) json.extras = clip.extras;

  // --- GLB container
  const bin = Buffer.concat(buffers, byteLength);
  const binPad = (4 - (bin.length % 4)) % 4;
  let jsonStr = JSON.stringify(json);
  while (jsonStr.length % 4 !== 0) jsonStr += ' ';
  const jsonBuf = Buffer.from(jsonStr, 'utf8');

  const total = 12 + 8 + jsonBuf.length + 8 + bin.length + binPad;
  const out = Buffer.alloc(total);
  let o = 0;
  out.writeUInt32LE(0x46546c67, o); o += 4;   // 'glTF'
  out.writeUInt32LE(2, o); o += 4;
  out.writeUInt32LE(total, o); o += 4;
  out.writeUInt32LE(jsonBuf.length, o); o += 4;
  out.writeUInt32LE(0x4e4f534a, o); o += 4;   // 'JSON'
  jsonBuf.copy(out, o); o += jsonBuf.length;
  out.writeUInt32LE(bin.length + binPad, o); o += 4;
  out.writeUInt32LE(0x004e4942, o); o += 4;   // 'BIN'
  bin.copy(out, o); o += bin.length;
  // remaining bytes are already zero from Buffer.alloc

  writeFileSync(outPath, out);
  return out.length;
}
