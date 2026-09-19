/**
 * Bundle and run the roster-heroes loader CPU checks.
 * Usage: node work/roster-heroes-runtime/check-runtime.mjs
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [join(here, 'runtime-check.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: join(here, 'runtime-check.bundle.mjs'),
  logLevel: 'warning',
});

const ran = spawnSync(process.execPath, [join(here, 'runtime-check.bundle.mjs')], {
  stdio: 'inherit',
});
process.exit(ran.status ?? 1);
