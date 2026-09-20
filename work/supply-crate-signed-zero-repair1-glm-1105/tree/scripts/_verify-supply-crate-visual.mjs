/**
 * _verify-supply-crate-visual — bundles `_verify-supply-crate-visual.scenario.ts`
 * with esbuild (a vite dependency; no install) against THIS lane's module and
 * runs it in node on a synthetic clock. CPU only: no GPU, no canvas (the
 * stencil falls back to plain geometry), no server.
 *
 *   node work/supply-crate-close-glm-1030/tree/scripts/_verify-supply-crate-visual.mjs
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const scenario = join(here, '_verify-supply-crate-visual.scenario.ts');
const outfile = join(mkdtempSync(join(tmpdir(), 'nt-crate-vis-')), 'scenario.cjs');

await build({
  entryPoints: [scenario],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  logLevel: 'silent',
});

await import(pathToFileURL(outfile).href);
