/** Execute the pure network proof with the same module resolution as Vite. */
import { build } from 'esbuild';

const result = await build({
  entryPoints: ['src/net/run-proof.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  logLevel: 'warning',
});
const js = result.outputFiles[0].contents;
await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
