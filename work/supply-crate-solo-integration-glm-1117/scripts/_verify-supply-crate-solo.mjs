/**
 * _verify-supply-crate-solo — bundles `_verify-supply-crate-solo.scenario.ts`
 * with esbuild (a vite dependency; no install) and runs it in node on a
 * synthetic clock. CPU only: no GPU, no browser, no server, no canvas.
 *
 *   node work/supply-crate-solo-integration-glm-1117/scripts/_verify-supply-crate-solo.mjs
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scenario = join(here, '..', 'tree', 'scripts', '_verify-supply-crate-solo.scenario.ts');
const outfile = join(mkdtempSync(join(tmpdir(), 'nt-crate-solo-')), 'scenario.cjs');

await build({
  entryPoints: [scenario],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
});

await import(pathToFileURL(outfile).href);
