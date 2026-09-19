/**
 * AUTHORED MOUNTAINS — opt-in Blender-native backdrop over the canary path.
 *
 * The two harmonic heightfield rounds read as smooth parallel ribbons in the
 * actual target view; this module mounts the authored GLB
 * (public/assets/authored-mountains/authored-mountains.glb, built by
 * scripts/blender/build_authored_mountains.py) when it is resident AND the
 * lane is opted in via ?mountains=authored. Otherwise it falls back to the
 * procedural canary synchronously — the fallback is retained, never removed.
 *
 * Contract mirrors createDistantMountainsCanary: 3 draws, backdrop only,
 * zero colliders, shared ctx.mat singletons never touched or disposed.
 * Disposal detaches the owned CLONE only; master buffers stay live in the
 * assets cache (disposeAssets owns them). Clones share master geometry, so
 * disposing clone buffers would corrupt the cache — never do that here.
 */
import * as THREE from 'three';
import { group, type BuildContext, type Builder } from '../core/kit';
import { getAsset } from '../core/assets';
import { createDistantMountainsCanary } from './distant-mountains-canary';

export const AUTHORED_MOUNTAIN_OBJECT = 'authored_mountains';

/** Opt-in only: ?mountains=authored. canary/baseline values return false. */
export function isAuthoredMountainsOptIn(): boolean {
  const g = globalThis as { __NT_OVERRIDE_AUTHORED_MOUNTAINS__?: boolean };
  if (typeof g.__NT_OVERRIDE_AUTHORED_MOUNTAINS__ === 'boolean') {
    return g.__NT_OVERRIDE_AUTHORED_MOUNTAINS__;
  }
  if (typeof window !== 'undefined' && window.location?.search) {
    const q = new URLSearchParams(window.location.search);
    const v = (q.get('mountains') ?? '').toLowerCase();
    if (v === 'authored' || v === 'authored-mountains') return true;
  }
  return false;
}

export interface AuthoredMountainsResult {
  group: THREE.Group;
  drawCalls: number;
  authored: boolean;
  dispose: () => void;
}

/**
 * Mount the preloaded authored GLB clone, or fall back to the procedural
 * canary when the asset has not finished loading (or the build is absent).
 * Sync by builder contract: never awaits, never throws, never retries.
 */
export function createAuthoredMountains(ctx: BuildContext): AuthoredMountainsResult {
  const owned = getAsset('authored-mountains');
  if (owned) {
    const g = group(AUTHORED_MOUNTAIN_OBJECT);
    g.add(owned);
    let draws = 0;
    owned.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        draws++;
        mesh.castShadow = false;
        mesh.receiveShadow = false;
      }
      o.updateMatrix();
      o.matrixAutoUpdate = false;
    });
    let released = false;
    const dispose = () => {
      if (released) return;
      released = true;
      g.removeFromParent();
      g.clear(); // detach clone nodes only; master buffers belong to the cache
    };
    g.userData.dispose = dispose;
    return { group: g, drawCalls: draws, authored: true, dispose };
  }
  const canary = createDistantMountainsCanary(ctx);
  return {
    group: canary.group,
    drawCalls: canary.drawCalls,
    authored: false,
    dispose: canary.dispose,
  };
}

/** Builder contract export: backdrop scenery, no colliders. */
export const buildAuthoredMountains: Builder = (ctx) => {
  const result = createAuthoredMountains(ctx);
  return { group: result.group, colliders: [] };
};
