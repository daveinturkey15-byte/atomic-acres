/**
 * Read back a GLB written by glb.mjs. Separate from the writer and from
 * inspect-clip.mjs on purpose: every verifier in this lane reads the SHIPPED
 * bytes rather than the retargeter's in-memory arrays, so a bug in the writer
 * (wrong accessor, wrong node order, a mis-scaled buffer) fails a check instead
 * of reaching the game.
 */
import { readFileSync } from 'node:fs';

export function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: not a GLB`);
  let o = 12, json = null, bin = null;
  while (o < buf.length) {
    const len = buf.readUInt32LE(o), type = buf.readUInt32LE(o + 4);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
    else if (type === 0x004e4942) bin = data;
    o += 8 + len;
  }
  const acc = (i) => {
    const a = json.accessors[i], v = json.bufferViews[a.bufferView];
    const n = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
    const off = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return new Float32Array(bin.buffer.slice(bin.byteOffset + off, bin.byteOffset + off + a.count * n * 4));
  };
  return { json, acc };
}
