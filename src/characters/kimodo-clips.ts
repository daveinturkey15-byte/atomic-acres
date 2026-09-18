/**
 * Load the baked motion clips from public/anim and hand them to clips.ts.
 *
 * SHAPE OF THE SEAM. `buildClipLibrary()` is synchronous - `CharacterRig` builds
 * one `AnimationAction` per clip in its constructor, so the library has to be
 * complete before the first character spawns. Fetching glTF is not synchronous.
 * Rather than make the whole character system async (which would reach into
 * main.ts, system.ts and blend.ts for one feature), this module preloads into a
 * module-level registry and `buildClipLibrary()` reads that registry when it
 * runs. The game awaits `loadBakedClips()` once, before it creates the system.
 *
 * DEFENSIVE BY CONSTRUCTION. Every failure here - no manifest, a 404, a corrupt
 * glb, a clip whose tracks do not match the rig - degrades to the procedural
 * clip for that ONE name and logs it. A missing animation must never be able to
 * take the map down, and "the whole set silently vanished" must never be able to
 * look like "the animations are fine". `bakedClipReport()` says exactly which
 * source each clip came from, and the QA surface prints it.
 *
 * Clip metadata (speed, stride, loop) travels inside the glTF as `extras`,
 * written by scripts/animation/retarget-soma.mjs, so a clip cannot be separated
 * from the speed its cycle matches. That pairing is what keeps the blend tree's
 * `timeScale = input.speed / spec.speed` honest, and it is the whole of the
 * skate control.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BONE_NAMES } from './skeleton';
import type { ClipName, ClipSpec } from './clips';

/** What the retargeter writes into each glb's `extras`. */
interface ClipExtras {
  source?: string;
  seed?: number;
  fps?: number;
  speed?: number;
  stride?: number;
  loop?: boolean;
}

interface ManifestClip {
  id: string;
  file: string;
  frames: number;
  duration: number;
  speed: number;
  stride: number;
  loop: boolean;
  footSlideCm: number;
  seed: number;
}

export interface BakedManifest {
  baked: string;
  generator: Record<string, unknown>;
  calibration: Record<string, unknown>;
  clips: ManifestClip[];
}

const registry = new Map<string, ClipSpec>();
const report: Record<string, string> = {};
let manifest: BakedManifest | null = null;

/** Which clips came from the bakery and which fell back. Read by QA and the HUD. */
export function bakedClipReport(): Record<string, string> {
  return { ...report };
}
export function bakedManifest(): BakedManifest | null {
  return manifest;
}
/** Used by clips.ts. Returns undefined when nothing was baked for this name. */
export function bakedClip(name: ClipName): ClipSpec | undefined {
  return registry.get(name);
}

const boneSet = new Set<string>(BONE_NAMES as readonly string[]);

/**
 * A clip is only accepted if it actually addresses our rig. A glb exported
 * against a different skeleton parses perfectly and then animates nothing,
 * which in a dark scene is indistinguishable from a working T-pose.
 */
function tracksMatchRig(clip: THREE.AnimationClip): { ok: boolean; hit: number; total: number } {
  let hit = 0;
  for (const t of clip.tracks) {
    const bone = t.name.split('.')[0];
    if (boneSet.has(bone)) hit++;
  }
  return { ok: hit >= BONE_NAMES.length, hit, total: clip.tracks.length };
}

/**
 * Fetch and parse every clip named in the manifest.
 * Safe to call more than once; the second call is a no-op.
 */
export async function loadBakedClips(baseUrl = '/anim/'): Promise<Record<string, string>> {
  if (registry.size > 0) return bakedClipReport();

  let doc: BakedManifest;
  try {
    const res = await fetch(`${baseUrl}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`manifest ${res.status}`);
    doc = (await res.json()) as BakedManifest;
  } catch (err) {
    report['*'] = `no manifest (${String(err)}) - every clip is procedural`;
    return bakedClipReport();
  }
  manifest = doc;

  const loader = new GLTFLoader();
  await Promise.all(
    (doc.clips ?? []).map(async (entry) => {
      if (!entry.file) return;
      try {
        const gltf = await loader.loadAsync(`${baseUrl}${entry.file}`);
        const clip = gltf.animations?.[0];
        if (!clip) throw new Error('no animation in glb');
        const match = tracksMatchRig(clip);
        if (!match.ok) throw new Error(`only ${match.hit}/${match.total} tracks address the rig`);
        const extras = ((gltf.parser.json as { extras?: ClipExtras }).extras ?? {}) as ClipExtras;
        clip.name = entry.id;
        // The manifest and the glb carry the same numbers; prefer the glb's,
        // because that is the file the game actually loaded.
        registry.set(entry.id, {
          clip,
          speed: extras.speed ?? entry.speed ?? 0,
          stride: extras.stride ?? entry.stride ?? 0,
          loop: extras.loop ?? entry.loop ?? false,
        });
        report[entry.id] = `kimodo seed ${entry.seed} · ${entry.frames}f · ${entry.footSlideCm} cm slide`;
      } catch (err) {
        report[entry.id] = `FELL BACK to procedural: ${String(err)}`;
      }
    }),
  );
  return bakedClipReport();
}
