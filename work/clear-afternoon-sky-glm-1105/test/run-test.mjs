/**
 * Headless runner: esbuild-bundles contract-test.ts (with three and the
 * patched-tree copies under src/) and runs it under plain node. No browser,
 * no GPU. Writes the terminal receipt to ../test-run.txt relative to itself.
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '.build');
mkdirSync(outDir, { recursive: true });
const outfile = path.join(outDir, 'contract-test.mjs');

const t0 = Date.now();
await build({
  entryPoints: [path.join(here, 'contract-test.ts')],
  outfile,
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  logLevel: 'warning',
});
const buildMs = Date.now() - t0;

const r = spawnSync(process.execPath, [outfile], { encoding: 'utf8' });
const receipt =
  `$ node test/run-test.mjs\n` +
  `esbuild bundle: ${buildMs} ms (three bundled, platform browser, es2022)\n` +
  `$ node .build/contract-test.mjs\n` +
  `exit=${r.status}\n` +
  `${r.stdout}${r.stderr}`;
writeFileSync(path.join(here, '..', 'test-run.txt'), receipt);
process.stdout.write(receipt + '\n');
process.exit(r.status ?? 1);
