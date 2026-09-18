/**
 * Render retargeted poses to a PNG contact sheet, with no image dependency.
 *
 * This exists because of a rule this project learned the hard way: a number is
 * not a look. Foot-slide in centimetres tells you a clip is wrong; it does not
 * tell you the figure is inside-out, kneeling, or facing backwards. Getting a
 * frame in front of a pair of eyes BEFORE the clip goes near the game turns a
 * three-cycle guessing game into one look.
 *
 * Orthographic, two rows: front (camera down -Z, so +X is drawn to the right)
 * and side (camera down -X, +Z drawn to the right). A metre grid and the
 * y = 0 floor line are drawn so height and grounding are readable, and the
 * LEFT limbs are drawn in one colour and the RIGHT in another - which is the
 * whole point when the source skeleton is mirrored.
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return c ^ -1; }

class Canvas {
  constructor(w, h, bg = [22, 24, 28]) {
    this.w = w; this.h = h;
    this.buf = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) { this.buf[i * 3] = bg[0]; this.buf[i * 3 + 1] = bg[1]; this.buf[i * 3 + 2] = bg[2]; }
  }
  px(x, y, c) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.buf[i] = c[0]; this.buf[i + 1] = c[1]; this.buf[i + 2] = c[2];
  }
  line(x0, y0, x1, y1, c, thick = 1) {
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const n = Math.max(dx, dy, 1) | 0;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      for (let oy = 0; oy < thick; oy++) for (let ox = 0; ox < thick; ox++) this.px(x + ox, y + oy, c);
    }
  }
  dot(x, y, c, r = 2) { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) this.px(x + dx, y + dy, c); }
}

const COL = {
  grid: [44, 48, 56], floor: [110, 120, 130], axial: [225, 228, 232],
  left: [96, 190, 255], right: [255, 140, 90], label: [180, 186, 196],
};

/** 5x7 bitmap digits/letters, enough for frame numbers and view labels. */
const GLYPHS = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
};
function text(cv, s, x, y, c, scale = 1) {
  let cx = x;
  for (const ch of s.toUpperCase()) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) {
      if (g[r][k] === '1') for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) cv.px(cx + k * scale + sx, y + r * scale + sy, c);
    }
    cx += 6 * scale;
  }
}

const SEGMENTS = [
  ['Hips', 'Spine', 'axial'], ['Spine', 'Chest', 'axial'], ['Chest', 'Neck', 'axial'], ['Neck', 'Head', 'axial'],
  ['Chest', 'LeftShoulder', 'left'], ['LeftShoulder', 'LeftArm', 'left'], ['LeftArm', 'LeftForeArm', 'left'], ['LeftForeArm', 'LeftHand', 'left'],
  ['Chest', 'RightShoulder', 'right'], ['RightShoulder', 'RightArm', 'right'], ['RightArm', 'RightForeArm', 'right'], ['RightForeArm', 'RightHand', 'right'],
  ['Hips', 'LeftUpLeg', 'left'], ['LeftUpLeg', 'LeftLeg', 'left'], ['LeftLeg', 'LeftFoot', 'left'], ['LeftFoot', 'LeftToe', 'left'],
  ['Hips', 'RightUpLeg', 'right'], ['RightUpLeg', 'RightLeg', 'right'], ['RightLeg', 'RightFoot', 'right'], ['RightFoot', 'RightToe', 'right'],
];

/**
 * @param {string} outPath
 * @param {(name:string,frame:number)=>[number,number,number]} at  world position of a bone
 * @param {number[]} frames  which frames to draw
 * @param {string} caption
 */
export function writePoseSheet(outPath, at, frames, caption = '') {
  const CELL = 190, PAD = 8, TOP = 26;
  const cols = frames.length;
  const cv = new Canvas(cols * CELL + PAD * 2, TOP + CELL * 2 + PAD * 3, [22, 24, 28]);
  const M_PER_CELL = 2.4;                 // vertical metres the cell covers
  const scale = (CELL - 30) / M_PER_CELL; // px per metre

  text(cv, caption.slice(0, 40), PAD, 8, COL.label, 2);

  for (let row = 0; row < 2; row++) {
    const front = row === 0;
    const y0 = TOP + PAD + row * (CELL + PAD);
    text(cv, front ? 'FRONT' : 'SIDE', PAD, y0 + 2, COL.label, 1);
    for (let ci = 0; ci < cols; ci++) {
      const f = frames[ci];
      const ox = PAD + ci * CELL + CELL / 2;
      const floorY = y0 + CELL - 18;
      // metre grid + floor
      for (let m = 0; m <= 2; m++) cv.line(PAD + ci * CELL + 4, floorY - m * scale, PAD + ci * CELL + CELL - 4, floorY - m * scale, COL.grid, 1);
      cv.line(PAD + ci * CELL + 4, floorY, PAD + ci * CELL + CELL - 4, floorY, COL.floor, 1);
      const hipX = at('Hips', f)[0], hipZ = at('Hips', f)[2];
      const proj = (n) => {
        const p = at(n, f);
        // FRONT: camera looks along -Z at the figure's face, so the figure's own
        // LEFT (-X in our rig) appears on the right of the image. SIDE: +Z right.
        const h = front ? -(p[0] - hipX) : (p[2] - hipZ);
        return [ox + h * scale, floorY - p[1] * scale];
      };
      for (const [a, b, kind] of SEGMENTS) {
        const pa = proj(a), pb = proj(b);
        cv.line(pa[0], pa[1], pb[0], pb[1], COL[kind], 2);
      }
      const head = proj('Head'); cv.dot(head[0], head[1] - 6, COL.axial, 6);
      for (const n of ['LeftToe', 'RightToe']) { const p = proj(n); cv.dot(p[0], p[1], n[0] === 'L' ? COL.left : COL.right, 2); }
      text(cv, String(f), PAD + ci * CELL + 6, floorY + 6, COL.label, 1);
    }
  }
  writeFileSync(outPath, png(cv.w, cv.h, cv.buf));
  return outPath;
}
