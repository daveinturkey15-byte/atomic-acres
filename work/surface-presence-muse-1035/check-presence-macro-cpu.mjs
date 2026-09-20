// CPU-only guard for the presence-macro candidate. No GPU/browser/server.
// Bundles the private candidate with root's esbuild (self-contained via alias),
// imports it with real three (pure JS, no renderer), and asserts the no-GPU
// contract: flag gate, default-off untouched, fail-loud without base/textures.
// Renderer program-key probe + fixed-camera photography stay root gates.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = 'C:/Users/david/Desktop/stuff/worktrees/nuketown-recovery-20260919';
const HERE = 'C:/Users/david/Desktop/stuff/worktrees/nuketown-materials-20260919/work/surface-presence-muse-1035';
const requireRoot = createRequire(join(ROOT, 'package.json'));
const { build } = requireRoot('esbuild');
const THREE = requireRoot('three');

const out = mkdtempSync(join(tmpdir(), 'presence-cpu-'));
const fixture = join(out, 'fixture.mjs');
await build({
  entryPoints: [join(HERE, 'architectural-presence-macro.ts')],
  outfile: fixture,
  bundle: true,
  platform: 'node',
  format: 'esm',
  alias: {
    three: join(ROOT, 'node_modules/three/build/three.core.js'),
    'three/tsl': join(ROOT, 'node_modules/three/build/three.tsl.js'),
    'three/webgpu': join(ROOT, 'node_modules/three/build/three.webgpu.js'),
  },
  logLevel: 'silent',
});
const { installArchitecturalPresence: install, isPresenceEnabled: enabled } =
  await import(pathToFileURL(fixture).href);

assert.equal(enabled(''), false);
assert.equal(enabled('?presence=macro'), true);
assert.equal(enabled('?presence=off'), false);

// Default-off: untouched library, no loads, null controller.
const untouched = { dispose() {} };
assert.equal(await install(untouched, null, false), null);
assert.deepEqual(Object.keys(untouched), ['dispose']);

// Fail-loud without the base canary: plain shared materials carry no node hooks.
const KEYS = ['stuccoCream', 'stuccoTerracotta', 'capsuleWhite', 'roofWhite', 'timber', 'timberDark'];
const bare = { dispose() {} };
for (const k of KEYS) bare[k] = new THREE.MeshStandardMaterial();
await assert.rejects(
  install(bare, [{}, {}, {}, {}], true),
  /requires installArchitecturalMaterials\(\) first/,
);

// Hooked-but-textureless: throws before any node is built or key touched.
const hooked = { dispose() {} };
for (const k of KEYS) {
  hooked[k] = new THREE.MeshStandardMaterial();
  hooked[k].colorNode = {};
  hooked[k].roughnessNode = {};
  hooked[k].normalNode = {};
}
const keysBefore = KEYS.map((k) => hooked[k].customProgramCacheKey());
await assert.rejects(install(hooked, null, true), /requires the base controller textures/);
assert.deepEqual(KEYS.map((k) => hooked[k].customProgramCacheKey()), keysBefore);
assert.equal(hooked.stuccoCream.colorNode && true, true);

console.log(JSON.stringify({
  status: 'PASS',
  scope: 'cpu-only: flag gate, default-off, fail-loud, key stability on reject. '
    + 'Renderer program-key probe + fixed-camera before/after: root gate (see INTEGRATE.md).',
}));
