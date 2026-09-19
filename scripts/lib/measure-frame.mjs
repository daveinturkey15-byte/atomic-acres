/** A WebGPU PassNode renders once per renderer frame. Sample on a fresh rAF,
 * then read synchronously so neither a cached post quad nor a reset is counted
 * as the scene. Keep budget thresholds in the calling acceptance harness. */
export function sceneWasMeasured(stats) {
  return Number.isFinite(stats.calls) && Number.isFinite(stats.triangles)
    && stats.calls > 2 && stats.triangles > 2 && stats.renders > 0;
}

export async function measureFrame(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    requestAnimationFrame(() => {
      try {
        const before = window.__NT.stats();
        window.__NT.render();
        const after = window.__NT.stats();
        resolve({
          calls: after.calls - before.calls,
          triangles: after.triangles - before.triangles,
          renders: after.renderCallsTotal - before.renderCallsTotal,
          geometries: after.geometries,
          textures: after.textures,
          programs: after.programs,
        });
      } catch (error) { reject(error); }
    });
  }));
}
