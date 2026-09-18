/**
 * Read the standard skeleton out of src/characters/skeleton.ts at run time.
 *
 * The offline retargeter has to know our bone names, parents and rest offsets
 * EXACTLY, because the clips it bakes are keyed to them: a clip whose rest
 * offsets disagree with the runtime rig by even a centimetre lands feet below
 * the floor. Transcribing the table into a second file would create a silent
 * drift channel - someone lengthens a shin in skeleton.ts, the shipped clips
 * keep the old one, and the defect shows up as foot-slide months later.
 *
 * So this parses the TypeScript instead of copying it. It is deliberately
 * brittle: if the shape of skeleton.ts changes, this throws loudly at bake
 * time rather than quietly baking against a stale rig.
 */
import { readFileSync } from 'node:fs';

export function loadStandardSkeleton(repoRoot) {
  const src = readFileSync(`${repoRoot}/src/characters/skeleton.ts`, 'utf8');

  const namesBlock = /export const BONE_NAMES = \[([\s\S]*?)\] as const;/.exec(src);
  if (!namesBlock) throw new Error('skeleton.ts: BONE_NAMES block not found - the parser needs updating');
  const names = [...namesBlock[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);

  const parentsBlock = /export const BONE_PARENTS[\s\S]*?= \{([\s\S]*?)\n\};/.exec(src);
  if (!parentsBlock) throw new Error('skeleton.ts: BONE_PARENTS block not found');
  const parents = {};
  for (const m of parentsBlock[1].matchAll(/(\w+):\s*(null|'(\w+)')/g)) parents[m[1]] = m[3] ?? null;

  const offsetsBlock = /export const REST_OFFSETS[\s\S]*?= \{([\s\S]*?)\n\};/.exec(src);
  if (!offsetsBlock) throw new Error('skeleton.ts: REST_OFFSETS block not found');
  const offsets = {};
  for (const m of offsetsBlock[1].matchAll(/(\w+):\s*\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]/g)) {
    offsets[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }

  const heightM = /export const STANDARD_HEIGHT = ([\d.]+)/.exec(src);

  for (const n of names) {
    if (!(n in parents)) throw new Error(`skeleton.ts: no parent entry for ${n}`);
    if (!(n in offsets)) throw new Error(`skeleton.ts: no rest offset for ${n}`);
  }
  if (names.length < 20) throw new Error(`skeleton.ts: parsed only ${names.length} bones - parser is wrong`);

  // Rest world positions. Every rest local rotation in our rig is identity
  // (skeleton.ts sets position only), so rest world position is just the sum
  // of the offsets up the chain - and rest world ORIENTATION is identity for
  // every bone, which is the property the retarget correction relies on.
  const restWorld = {};
  const place = (n) => {
    if (restWorld[n]) return restWorld[n];
    const p = parents[n];
    const base = p ? place(p) : [0, 0, 0];
    const o = offsets[n];
    return (restWorld[n] = [base[0] + o[0], base[1] + o[1], base[2] + o[2]]);
  };
  for (const n of names) place(n);

  return { names, parents, offsets, restWorld, height: heightM ? Number(heightM[1]) : 1.78 };
}
