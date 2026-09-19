/**
 * MOUNTAIN TERRAIN — opt-in connected panorama over the canary path.
 *
 * Outer-loop replacement for the box-scaled authored massifs (root rejected
 * on sight: isolated towers with empty horizon between them). This module
 * mounts the connected-terrain GLB
 * (public/assets/mountain-terrain/mountain-terrain.glb, built by
 * scripts/blender/build_mountain_terrain.py) when it is resident AND the
 * lane is opted in via ?mountains=terrain. Otherwise it falls back to the
 * procedural canary synchronously — the fallback is retained, never removed.
 *
 * Contract mirrors createAuthoredMountains / createDistantMountainsCanary:
 * 3 draws, 9568 tris (<= 30000), backdrop only, zero colliders, shared
 * ctx.mat singletons never touched or disposed. Disposal detaches the owned
 * CLONE only; master buffers stay live in the assets cache (disposeAssets
 * owns them). Clones share master geometry, so disposing clone buffers
 * would corrupt the cache — never do that here.
 */
import * as THREE from 'three';
import { group, type BuildContext, type Builder } from '../core/kit';
import { getAsset } from '../core/assets';
import { createDistantMountainsCanary } from './distant-mountains-canary';

export const MOUNTAIN_TERRAIN_OBJECT = 'mountain_terrain';

/** Opt-in only: ?mountains=terrain. authored/canary/baseline values return false. */
export function isMountainTerrainOptIn(): boolean {
  const g = globalThis as { __NT_OVERRIDE_MOUNTAIN_TERRAIN__?: boolean };
  if (typeof g.__NT_OVERRIDE_MOUNTAIN_TERRAIN__ === 'boolean') {
    return g.__NT_OVERRIDE_MOUNTAIN_TERRAIN__;
  }
  if (typeof window !== 'undefined' && window.location?.search) {
    const q = new URLSearchParams(window.location.search);
    const v = (q.get('mountains') ?? '').toLowerCase();
    if (v === 'terrain' || v === 'mountain-terrain') return true;
  }
  return false;
}

export interface MountainTerrainResult {
  group: THREE.Group;
  drawCalls: number;
  terrain: boolean;
  dispose: () => void;
}

/**
 * Mount the preloaded terrain GLB clone, or fall back to the procedural
 * canary when the asset has not finished loading (or the build is absent).
 * Sync by builder contract: never awaits, never throws, never retries.
 */
export function createMountainTerrain(ctx: BuildContext): MountainTerrainResult {
  const owned = getAsset('mountain-terrain');
  if (owned) {
    const g = group(MOUNTAIN_TERRAIN_OBJECT);
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
    return { group: g, drawCalls: draws, terrain: true, dispose };
  }
  const canary = createDistantMountainsCanary(ctx);
  return {
    group: canary.group,
    drawCalls: canary.drawCalls,
    terrain: false,
    dispose: canary.dispose,
  };
}

/** Builder contract export: backdrop scenery, no colliders. */
export const buildMountainTerrain: Builder = (ctx) => {
  const result = createMountainTerrain(ctx);
  return { group: result.group, colliders: [] };
};
