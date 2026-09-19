import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockBrowser } from './lib/stock-browser.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE_URL = process.env.NT_URL ?? 'http://127.0.0.1:4192/';
const outputPath = join(ROOT, 'docs', 'verification', '2026-09-19', 'collider-snapshot.json');

const owned = await stockBrowser('collider-snapshot');
try {
  await owned.page.goto(BASE_URL, { waitUntil: 'load', timeout: 90000 });
  await owned.page.waitForFunction(() => window.__NT?.ready, null, { timeout: 90000 });
  const captured = await owned.page.evaluate(() => {
    const qa = window.__NT;
    if (!qa?.colliderSnapshot) throw new Error('__NT.colliderSnapshot() is unavailable');
    const snapshot = qa.colliderSnapshot();
    const moduleStats = qa.moduleStats ?? {};
    const moduleColliderTotal = Object.values(moduleStats)
      .reduce((sum, module) => sum + Number(module.colliders ?? 0), 0);
    if (snapshot.count !== qa.colliderCount) {
      throw new Error(`snapshot count ${snapshot.count} != __NT.colliderCount ${qa.colliderCount}`);
    }
    if (moduleColliderTotal !== qa.colliderCount) {
      throw new Error(`module collider total ${moduleColliderTotal} != __NT.colliderCount ${qa.colliderCount}`);
    }
    const scriptUrls = Array.from(document.scripts, (script) => script.src).filter(Boolean);
    const resourceUrls = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter(Boolean);
    const candidateJsUrl = [...scriptUrls, ...resourceUrls]
      .find((url) => /\/assets\/index-[^/]+\.js(?:\?|$)/.test(url)) ?? null;
    const candidateJsFilename = candidateJsUrl
      ? new URL(candidateJsUrl).pathname.split('/').pop() ?? null
      : null;
    const candidateJsBuildHash = candidateJsFilename?.match(/^index-([^.]+)\.js$/)?.[1] ?? null;
    return {
      snapshot,
      qaColliderCount: qa.colliderCount,
      moduleStats,
      moduleColliderTotal,
      pageUrl: location.href,
      candidateJsUrl,
      candidateJsFilename,
      candidateJsBuildHash,
    };
  });

  const colliders = captured.snapshot.colliders;
  const indices = colliders.map((collider) => collider.i);
  if (new Set(indices).size !== indices.length || indices.some((index, position) => index !== position)) {
    throw new Error('colliderSnapshot returned non-unique or non-contiguous indices');
  }
  const serialized = JSON.stringify({
    schema: 'nuketown-2025/collider-snapshot/1',
    capturedAt: new Date().toISOString(),
    source: {
      pageUrl: captured.pageUrl,
      candidateJsUrl: captured.candidateJsUrl,
      candidateJsFilename: captured.candidateJsFilename,
      candidateJsBuildHash: captured.candidateJsBuildHash,
    },
    complete: true,
    scope: 'complete exact collider list returned by __NT.colliderSnapshot(); no spatial sampling or rounding',
    count: captured.snapshot.count,
    qaColliderCount: captured.qaColliderCount,
    moduleColliderTotal: captured.moduleColliderTotal,
    moduleStats: captured.moduleStats,
    colliders,
  }, null, 2);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized + '\n');
  const sha256 = createHash('sha256').update(serialized).digest('hex');
  console.log(JSON.stringify({ outputPath, count: captured.snapshot.count, moduleColliderTotal: captured.moduleColliderTotal, candidateJsFilename: captured.candidateJsFilename, candidateJsBuildHash: captured.candidateJsBuildHash, sha256 }));
} finally {
  await owned.close();
}
