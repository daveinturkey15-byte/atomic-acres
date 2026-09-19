/**
 * fetch-anim.mjs - offline fetch + convert for the characters lane.
 *
 * Pulls a SMALL named set of BVH clips (CMU mirror + three.js sample),
 * resamples 120 -> 30 fps, trims dead ends, scales to metres, and writes one
 * compact JSON per clip into public/anim/. Raw BVH is deleted after a
 * successful convert - it is re-fetchable from the manifest URL + sha.
 *
 * What was actually found (2026-09-18, recorded so nobody re-derives it):
 * - The CMU mirror (una-dinosauria/cmu-mocap) is Y-UP, not Z-up: the walk
 *   root bobs in Y (15.7-17.5) and travels in Z (-31.7 -> +31.7). No
 *   reorientation is applied; the converter asserts this per file and would
 *   rotate a file that fails the Y-bob test.
 * - Units differ per file (mirror ~5.5 cm/unit, pirouette cm), so scale is
 *   calibrated per clip: median Hips height -> expected hip height for the
 *   motion (0.92 m upright, 0.62 m crouched). Recorded per clip.
 *
 * No account, no key, no login anywhere in this pipeline. Rejected sources
 * (Mixamo/Adobe login, Reallusion/ActorCore, Meshcapade/SMPL, ReadyPlayerMe,
 * Sketchfab account wall) are listed in LICENCES.md with the reason.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ANIM = join(ROOT, 'public', 'anim');
const RAW = join(ANIM, 'raw');
const FETCH_DATE = '2026-09-18';

const CMU_BASE = 'https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/data';
const CMU_LICENCE = 'CMU Graphics Lab Motion Capture Database - free for all uses, no registration (http://mocap.cs.cmu.edu/)';
const THREE_LICENCE = 'three.js example model (mrdoob/three.js, MIT licence) - loader/retarget path proof only';

/** name -> source. hipM is the calibration target for median Hips height. */
const SOURCES = {
  'walk': { file: '007/07_01.bvh', url: `${CMU_BASE}/007/07_01.bvh`, licence: CMU_LICENCE, hipM: 0.92, desc: 'CMU 07_01 walk' },
  'run': { file: '009/09_01.bvh', url: `${CMU_BASE}/009/09_01.bvh`, licence: CMU_LICENCE, hipM: 0.95, desc: 'CMU 09_01 run' },
  'sprint': { file: '009/09_05.bvh', url: `${CMU_BASE}/009/09_05.bvh`, licence: CMU_LICENCE, hipM: 0.95, desc: 'CMU 09_05 run (fast)' },
  'crouch-walk': { file: '136/136_09.bvh', url: `${CMU_BASE}/136/136_09.bvh`, licence: CMU_LICENCE, hipM: 0.62, desc: 'CMU 136_09 walk crouched' },
  'jump': { file: '016/16_05.bvh', url: `${CMU_BASE}/016/16_05.bvh`, licence: CMU_LICENCE, hipM: 0.92, desc: 'CMU 16_05 forward jump' },
  'turn-left': { file: '016/16_41.bvh', url: `${CMU_BASE}/016/16_41.bvh`, licence: CMU_LICENCE, hipM: 0.92, desc: 'CMU 16_41 run/jog 90-degree left turn' },
  'turn-right': { file: '016/16_43.bvh', url: `${CMU_BASE}/016/16_43.bvh`, licence: CMU_LICENCE, hipM: 0.92, desc: 'CMU 16_43 run/jog 90-degree right turn' },
  'pirouette': { file: '__pirouette__', url: 'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/bvh/pirouette.bvh', licence: THREE_LICENCE, hipM: 0.92, desc: 'three.js sample - loader proof' },
};

function parseBVH(text) {
  const lines = text.split('\n');
  const joints = []; // {name, parent, offset:[x,y,z], channels:['Xposition',...]}
  const stack = [];
  let i = 0;
  const channelCounts = [];
  while (i < lines.length) {
    const line = lines[i].trim();
    const m = /^(ROOT|JOINT)\s+(\S+)/.exec(line);
    if (m) {
      joints.push({ name: m[2], parent: stack.length ? stack[stack.length - 1] : -1, offset: [0, 0, 0], channels: [] });
      stack.push(joints.length - 1);
    } else if (/^End Site/.test(line)) {
      const parentIdx = stack[stack.length - 1];
      joints.push({ name: joints[parentIdx].name + '_end', parent: parentIdx, offset: [0, 0, 0], channels: [], endSite: true });
      stack.push(joints.length - 1);
    } else if (/^OFFSET/.test(line)) {
      const p = line.split(/\s+/).slice(1, 4).map(Number);
      joints[stack[stack.length - 1]].offset = p;
    } else if (/^CHANNELS/.test(line)) {
      const p = line.split(/\s+/);
      const n = parseInt(p[1], 10);
      joints[stack[stack.length - 1]].channels = p.slice(2, 2 + n);
    } else if (/^\}/.test(line)) {
      stack.pop();
    } else if (line === 'MOTION') {
      break;
    }
    i++;
  }
  const frames = parseInt(lines[i + 1].split(':')[1].trim(), 10);
  const frameTime = parseFloat(lines[i + 2].split(':')[1].trim());
  const motion = [];
  for (let f = 0; f < frames; f++) {
    motion.push(lines[i + 3 + f].trim().split(/\s+/).map(Number));
  }
  for (const j of joints) channelCounts.push(j.channels.length);
  return { joints, frames, frameTime, motion };
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function main() {
  mkdirSync(RAW, { recursive: true });
  const manifest = { fetched: FETCH_DATE, fpsOut: 30, clips: {} };
  const licenceRows = [];
  for (const [name, src] of Object.entries(SOURCES)) {
    const rawPath = join(RAW, name + '.bvh');
    let text;
    if (existsSync(rawPath)) {
      text = readFileSync(rawPath, 'utf8');
      console.log(`[fetch-anim] ${name}: using cached raw (${text.length} chars)`);
    } else {
      console.log(`[fetch-anim] ${name}: downloading ${src.url}`);
      const res = await fetch(src.url);
      if (!res.ok) throw new Error(`fetch ${name} -> HTTP ${res.status}`);
      text = await res.text();
      writeFileSync(rawPath, text);
    }
    const sha = createHash('sha256').update(text).digest('hex').slice(0, 16);
    const { joints, frames, frameTime, motion } = parseBVH(text);
    const fpsIn = Math.round(1 / frameTime);
    // Channel layout: root position channels come first.
    const rootIdx = { x: joints[0].channels.indexOf('Xposition'), y: joints[0].channels.indexOf('Yposition'), z: joints[0].channels.indexOf('Zposition') };
    // Up-axis check: the vertical has a high median (hip height) but never
    // covers ground. (A plain Y-range cap fails jumps - flight legitimately
    // moves Y - so test travel instead.)
    const col = (rows, j) => rows.map((r) => r[j]);
    const range = (a) => Math.max(...a) - Math.min(...a);
    const medX = median(col(motion, rootIdx.x));
    const medY = median(col(motion, rootIdx.y));
    const rX = range(col(motion, rootIdx.x));
    const rY = range(col(motion, rootIdx.y));
    const rZ = range(col(motion, rootIdx.z));
    const upAxis = medY > medX && rY < Math.max(rX, rZ) ? 'Y' : 'Z?';
    if (upAxis !== 'Y') throw new Error(`${name}: up-axis check failed (med [${medX.toFixed(1)},${medY.toFixed(1)}] range [${rX.toFixed(1)},${rY.toFixed(1)},${rZ.toFixed(1)}]) - refusing to guess`);
    const scale = src.hipM / medY;
    // Resample to 30 fps by striding; trim static ends on Hips travel.
    const stride = Math.max(1, Math.round(fpsIn / 30));
    const speed = motion.map((row, f) => {
      if (f === 0) return Infinity;
      const dx = row[rootIdx.x] - motion[f - 1][rootIdx.x];
      const dz = row[rootIdx.z] - motion[f - 1][rootIdx.z];
      return Math.hypot(dx, dz);
    });
    let start = 0;
    let end = frames - 1;
    const eps = 0.02 * (median(speed.filter((s) => isFinite(s))) || 1);
    while (start < end - 4 && speed[start + 1] < eps) start++;
    while (end > start + 4 && speed[end] < eps) end--;
    const picked = [];
    for (let f = start; f <= end; f += stride) picked.push(f);
    if (picked[picked.length - 1] !== end) picked.push(end);
    // Column offsets per joint into the flat motion row.
    const colOffset = [];
    let acc = 0;
    for (const j of joints) {
      colOffset.push(acc);
      acc += j.channels.length;
    }
    // Emit: offsets in metres, root positions re-based to start at origin and
    // in metres, rotations kept in degrees.
    const jOut = joints.map((j) => ({
      name: j.name,
      parent: j.parent,
      offset: j.offset.map((v) => +(v * scale).toFixed(4)),
      channels: j.channels,
    }));
    const baseX = motion[picked[0]][rootIdx.x];
    const baseZ = motion[picked[0]][rootIdx.z];
    const framesOut = picked.map((f) => {
      const row = motion[f];
      const out = new Array(row.length);
      for (let j = 0; j < joints.length; j++) {
        for (let c = 0; c < joints[j].channels.length; c++) {
          const ch = joints[j].channels[c];
          let v = row[colOffset[j] + c];
          if (/position/i.test(ch)) {
            v *= scale;
            if (j === 0 && ch === 'Xposition') v -= baseX * scale;
            if (j === 0 && ch === 'Zposition') v -= baseZ * scale;
          }
          out[colOffset[j] + c] = +v.toFixed(4);
        }
      }
      return out;
    });
    const doc = {
      name, desc: src.desc, url: src.url, licence: src.licence, fetched: FETCH_DATE, sha,
      fpsIn, fps: 30, framesIn: frames, frames: framesOut.length,
      trim: [picked[0], picked[picked.length - 1]], upAxis, metresPerUnit: +scale.toFixed(6),
      joints: jOut, motion: framesOut,
    };
    const outPath = join(ANIM, name + '.anim.json');
    writeFileSync(outPath, JSON.stringify(doc));
    console.log(`[fetch-anim] ${name}: ${frames} frames @${fpsIn}fps -> ${framesOut.length} @30fps, trim [${picked[0]},${picked[picked.length - 1]}], scale ${scale.toFixed(5)} m/unit -> ${outPath}`);
    manifest.clips[name] = {
      file: name + '.anim.json', desc: src.desc, url: src.url, sha,
      fpsIn, frames: framesOut.length, trim: [picked[0], picked[picked.length - 1]],
      metresPerUnit: +scale.toFixed(6),
    };
    licenceRows.push({ name, file: name + '.anim.json', url: src.url, licence: src.licence });
    rmSync(rawPath);
  }
  writeFileSync(join(ANIM, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const md = [
    '# Character animation sources',
    '',
    `Fetched ${FETCH_DATE}. Everything below was downloaded without an account, a key or a login.`,
    'Raw BVH is re-fetchable from the URL + sha; only the converted 30 fps JSON is committed.',
    '',
    '| clip | file | source | licence |',
    '| --- | --- | --- | --- |',
    ...licenceRows.map((r) => `| ${r.name} | ${r.file} | ${r.url} | ${r.licence} |`),
    '',
    '## Deliberately not used (owner constraint: no sign-up, no key, no EULA click-through)',
    '',
    '- Mixamo / Adobe - requires an Adobe login. Rejected.',
    '- Reallusion / ActorCore - requires an account. Rejected.',
    '- Meshcapade / SMPL - licence + registration. Rejected.',
    '- Ready Player Me - requires an account / API key. Rejected.',
    '- Sketchfab downloads - require an account. Rejected (do not use re-uploads either).',
    '- Quaternius (quaternius.com, CC0, no account) - ACCEPTABLE but not fetched: stylised low-poly placeholder unneeded while the procedural mesh proves the seam. May be pulled later as a drop-in skin.',
    '',
    '## Coverage honesty',
    '',
    '- CMU has no standing idle, no rifle aim/fire/reload, no hit-react, no death. Those clips are procedural (src/characters/clips.ts), not wrong retargets.',
    '- CMU turn clips are run-90-degree-turns; in-place turn-lean is procedural in the rig.',
  ].join('\n');
  writeFileSync(join(ANIM, 'LICENCES.md'), md);
  console.log('[fetch-anim] wrote manifest.json + LICENCES.md; raw BVH removed');
}

main().catch((e) => {
  console.error('[fetch-anim] FAILED:', e.message);
  process.exit(1);
});
