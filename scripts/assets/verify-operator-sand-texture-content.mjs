#!/usr/bin/env node
/* Verify Operator Sand REPAIR GLB texture CONTENT (CPU only, no deps).
 *
 * Root PIL evidence 2026-09-20: the frozen ae052121 GLB embeds three solid
 * black PNGs (RGB means 0,0,0) even though the strict structural validator
 * (verify-operator-sand.mjs) passes it ALLPASS -- it checks dimensions, never
 * decoded pixels. This guard decodes every embedded PNG with pure node
 * (node:zlib inflate + PNG unfilter, no browser/GPU/network) and fails
 * closed on the known-black originals, constant fills, and unphysical ORM.
 *
 * Run (after a root Blender build of the REPAIR recipe):
 *   node scripts/assets/verify-operator-sand-texture-content.mjs [work/operator-sand-texture-repair/operator-sand.glb]
 *
 * This never weakens verify-operator-sand.mjs: run BOTH validators on the
 * repair GLB. The old one owns structure; this one owns pixels.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const GLB = process.argv[2] || path.join('work', 'operator-sand-texture-repair', 'operator-sand.glb');

let failures = 0;
function check(id, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} -- ${detail}`);
  if (!ok) failures += 1;
}

if (!fs.existsSync(GLB)) {
  console.log(`FAIL container.exists -- missing ${GLB}`);
  process.exit(1);
}
const buf = fs.readFileSync(GLB);
check('container.magic', buf.readUInt32LE(0) === 0x46546c67, `${buf.length} bytes`);
check('container.version', buf.readUInt32LE(4) === 2, 'version 2');
const jsonLen = buf.readUInt32LE(12);
let doc = null;
try {
  doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
} catch (e) {
  console.log(`FAIL container.json -- ${e.message}`);
  process.exit(1);
}
check('container.json', !!doc, `images=${(doc.images || []).length}`);

// BIN chunk body (bufferView.byteOffset is relative to it).
const binStart = 20 + jsonLen;
let binBody = null;
if (buf.length > binStart + 8 && buf.readUInt32LE(binStart + 4) === 0x004e4942) {
  const binLen = buf.readUInt32LE(binStart);
  binBody = buf.subarray(binStart + 8, binStart + 8 + binLen);
}
function viewBytes(vi) {
  const v = doc.bufferViews[vi];
  return binBody.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength);
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

// Minimal PNG decoder: 8-bit, truecolor (2) or truecolor+alpha (6) only.
// Every other encoding fails closed -- Blender file_format=PNG byte images
// must land here, and anything else is not the authored recipe output.
function decodePNG(bytes, label) {
  const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(SIG)) throw new Error(`${label}: not a PNG`);
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0;
  const parts = [];
  while (pos + 8 <= bytes.length) {
    const len = bytes.readUInt32BE(pos);
    const type = bytes.toString('ascii', pos + 4, pos + 8);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === 'IDAT') {
      parts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (!width || !height) throw new Error(`${label}: missing IHDR`);
  if (bitDepth !== 8) throw new Error(`${label}: bitDepth=${bitDepth}, want 8`);
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!channels) throw new Error(`${label}: colorType=${colorType}, want 2 or 6`);
  const raw = zlib.inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const px = Buffer.alloc(width * height * 4);
  let p = 0, q = 0;
  let prev = Buffer.alloc(stride); // zero row above the first scanline
  for (let y = 0; y < height; y++) {
    const f = raw[p++];
    if (f > 4) throw new Error(`${label}: bad filter ${f} at row ${y}`);
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const v = raw[p++];
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let r;
      if (f === 0) r = v;
      else if (f === 1) r = (v + a) & 255;
      else if (f === 2) r = (v + b) & 255;
      else if (f === 3) r = (v + ((a + b) >> 1)) & 255;
      else r = (v + paeth(a, b, c)) & 255;
      cur[x] = r;
    }
    for (let i = 0; i < width; i++) {
      px[q + i * 4] = cur[i * channels];
      px[q + i * 4 + 1] = cur[i * channels + 1];
      px[q + i * 4 + 2] = cur[i * channels + 2];
      px[q + i * 4 + 3] = channels === 4 ? cur[i * channels + 3] : 255;
    }
    prev = cur;
    q += width * 4;
  }
  return { width, height, channels, px };
}

function stats(px, width, height) {
  const n = width * height;
  const step = Math.max(1, Math.floor(n / 16384));
  let sr = 0, sg = 0, sb = 0, sa = 0, cnt = 0;
  let mnR = 255, mxR = 0, mnG = 255, mxG = 0, mnB = 255, mxB = 0;
  const seen = new Set();
  for (let i = 0; i < n; i += step) {
    const o = i * 4;
    const r = px[o], g = px[o + 1], b = px[o + 2], a = px[o + 3];
    sr += r; sg += g; sb += b; sa += a; cnt += 1;
    if (r < mnR) mnR = r; if (r > mxR) mxR = r;
    if (g < mnG) mnG = g; if (g > mxG) mxG = g;
    if (b < mnB) mnB = b; if (b > mxB) mxB = b;
    if (seen.size < 4096) seen.add((r << 16) | (g << 8) | b);
  }
  return {
    meanR: sr / cnt, meanG: sg / cnt, meanB: sb / cnt, meanA: sa / cnt,
    mnR, mxR, mnG, mxG, mnB, mxB, distinct: seen.size, samples: cnt,
  };
}

const EXPECT = {
  Sand_Cloth_Base: { w: 1024, h: 1024, kind: 'albedo' },
  Sand_Gear_Base: { w: 1024, h: 1024, kind: 'albedo' },
  Sand_Shared_ORM: { w: 512, h: 512, kind: 'orm' },
};

check('image.count', (doc.images || []).length === 3, `${(doc.images || []).length} images`);
const names = (doc.images || []).map((im) => im.name);
for (const k of Object.keys(EXPECT)) {
  check(`image.present.${k}`, names.includes(k), names.join(',') || '(none)');
}

for (const [ii, im] of (doc.images || []).entries()) {
  const label = im.name || `#${ii}`;
  const exp = EXPECT[label];
  if (im.mimeType !== 'image/png') {
    check(`content.mime.${label}`, false, String(im.mimeType));
    continue;
  }
  let bytes = null;
  try {
    if (im.bufferView == null) throw new Error('no bufferView (external URI not allowed)');
    bytes = viewBytes(im.bufferView);
  } catch (e) {
    check(`content.bytes.${label}`, false, e.message);
    continue;
  }
  let dec = null;
  try {
    dec = decodePNG(Buffer.from(bytes), label);
  } catch (e) {
    check(`content.decode.${label}`, false, e.message);
    continue;
  }
  check(`content.decode.${label}`, true, `${dec.width}x${dec.height} ct-ch=${dec.channels}`);
  if (exp) check(`content.dims.${label}`, dec.width === exp.w && dec.height === exp.h, `${dec.width}x${dec.height}`);
  const s = stats(dec.px, dec.width, dec.height);
  const det = `mean(${s.meanR.toFixed(1)},${s.meanG.toFixed(1)},${s.meanB.toFixed(1)},${s.meanA.toFixed(1)}) spanR${s.mxR - s.mnR} spanG${s.mxG - s.mnG} spanB${s.mxB - s.mnB} distinct${s.distinct}`;
  // The known-black originals: every RGB mean ~0 with alpha 255.
  const isBlack = s.meanR < 8 && s.meanG < 8 && s.meanB < 8;
  check(`content.not-black.${label}`, !isBlack, isBlack ? `REJECTED known-black pixels ${det}` : det);
  if (isBlack) continue;
  if (exp && exp.kind === 'albedo') {
    // Real authored cloth/gear: mid-tone, non-constant, varied colors.
    const lo = label === 'Sand_Cloth_Base'
      ? { r: [70, 220], g: [60, 205], b: [35, 180] }
      : { r: [35, 180], g: [35, 180], b: [25, 165] };
    check(`content.range.${label}.R`, s.meanR >= lo.r[0] && s.meanR <= lo.r[1], s.meanR.toFixed(1));
    check(`content.range.${label}.G`, s.meanG >= lo.g[0] && s.meanG <= lo.g[1], s.meanG.toFixed(1));
    check(`content.range.${label}.B`, s.meanB >= lo.b[0] && s.meanB <= lo.b[1], s.meanB.toFixed(1));
    check(`content.varied.${label}`, (s.mxR - s.mnR) > 8 && (s.mxG - s.mnG) > 8 && s.distinct > 64,
      `spanR${s.mxR - s.mnR} spanG${s.mxG - s.mnG} distinct${s.distinct}`);
    check(`content.alpha.${label}`, s.meanA > 250, s.meanA.toFixed(1));
  } else if (exp && exp.kind === 'orm') {
    // ORM pack: R unused (1.0), G roughness zones {0.85,0.62,0.50}, B metallic 0.
    check(`content.orm.R-unused.${label}`, s.meanR > 245, s.meanR.toFixed(1));
    check(`content.orm.rough.${label}`, s.meanG >= 120 && s.meanG <= 235, s.meanG.toFixed(1));
    check(`content.orm.rough-varied.${label}`, (s.mxG - s.mnG) > 30, `spanG${s.mxG - s.mnG}`);
    check(`content.orm.nonmetal.${label}`, s.meanB < 15, s.meanB.toFixed(1));
    check(`content.orm.alpha.${label}`, s.meanA > 250, s.meanA.toFixed(1));
  }
}

console.log(failures === 0 ? `\nOPERATOR_SAND_TEXTURE_CONTENT_VERIFY PASS -- ${GLB}` : `\nOPERATOR_SAND_TEXTURE_CONTENT_VERIFY FAIL (${failures}) -- ${GLB}`);
process.exit(failures === 0 ? 0 : 1);
