/**
 * Minimal PNG reader for the ao-thickness critic. 8-bit, non-interlaced,
 * colour type 2 (RGB) or 6 (RGBA) — what Chrome's screenshot writes.
 * Throwaway critic tooling; touches nothing under scripts/lib/**.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

export function readPng(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png: ' + path);
  let off = 8;
  let w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; ctype = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (ctype !== 2 && ctype !== 6)) {
    throw new Error(`unsupported png depth=${depth} ctype=${ctype} interlace=${interlace}`);
  }
  const bpp = ctype === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, y * stride + stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, (y - 1) * stride + stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = (prev && x >= bpp) ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
  }
  return { width: w, height: h, bpp, data: out };
}

/** BT.709 luma 0..255 at (x, y). */
export function luma(img, x, y) {
  const i = (y * img.width + x) * img.bpp;
  return 0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2];
}

export function rgb(img, x, y) {
  const i = (y * img.width + x) * img.bpp;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

/** Stats over a rect [x0,y0,x1,y1) on a channel picker. */
export function rectStats(img, rect, pick = luma) {
  const [x0, y0, x1, y1] = rect;
  const vals = [];
  for (let y = Math.max(0, y0); y < Math.min(img.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.width, x1); x++) vals.push(pick(img, x, y));
  }
  vals.sort((a, b) => a - b);
  const q = (f) => vals[Math.min(vals.length - 1, Math.max(0, Math.round(f * (vals.length - 1))))];
  const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
  return {
    n: vals.length,
    mean: +mean.toFixed(2),
    min: +vals[0].toFixed(2),
    p1: +q(0.01).toFixed(2), p5: +q(0.05).toFixed(2), p20: +q(0.20).toFixed(2),
    p50: +q(0.50).toFixed(2), p95: +q(0.95).toFixed(2),
    max: +vals[vals.length - 1].toFixed(2),
  };
}

export function wholeStats(img, pick = luma) {
  return rectStats(img, [0, 0, img.width, img.height], pick);
}
