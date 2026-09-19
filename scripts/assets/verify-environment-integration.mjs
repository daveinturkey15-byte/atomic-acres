/**
 * CPU verification for Environment Candidates Integration.
 * No browser, no server, no GPU.
 *
 * Runs:
 *   node --experimental-strip-types scripts/assets/verify-environment-integration.mjs
 *
 * Verifies:
 * 1. Ground PBR Canary: assets, hashes, dimensions, factory contract & disposal.
 * 2. Distant Mountains Canary: geometry, topology, budgets (<= 18k tris, <= 3 draws), & disposal.
 * 3. Environment Flags: independent opt-in QA flags & combined candidate mode.
 * 4. Code integration: materials.ts and skyline.ts integration integrity.
 */

import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

console.log('=== ENVIRONMENT INTEGRATION VERIFICATION ===\n');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

// --- 1. Run Ground PBR Canary Verifier ---
console.log('--- 1. Running Ground PBR Canary Verifier ---');
try {
  const out = execSync('node --experimental-strip-types scripts/assets/verify-ground-pbr-canary.mjs', {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const lines = out.trim().split('\n');
  const passLines = lines.filter((l) => l.startsWith('PASS'));
  const failLines = lines.filter((l) => l.startsWith('FAIL'));
  check(failLines.length === 0 && passLines.length > 0, 'Ground PBR Canary verifier green', `${passLines.length} passed, ${failLines.length} failed`);
} catch (err) {
  check(false, 'Ground PBR Canary verifier execution', String(err));
}

// --- 2. Run Distant Mountains Canary Verifier ---
console.log('\n--- 2. Running Distant Mountains Canary Verifier ---');
try {
  const out = execSync('node --experimental-strip-types scripts/assets/verify-distant-mountains-canary.mjs', {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const lines = out.trim().split('\n');
  const passLines = lines.filter((l) => l.startsWith('[PASS]'));
  const failLines = lines.filter((l) => l.startsWith('[FAIL]'));
  check(failLines.length === 0 && passLines.length > 0, 'Distant Mountains Canary verifier green', `${passLines.length} passed, ${failLines.length} failed`);
} catch (err) {
  check(false, 'Distant Mountains Canary verifier execution', String(err));
}

// --- 3. Verify Assets and Provenance on Disk ---
console.log('\n--- 3. Verifying Candidate Assets on Disk ---');
const ASSET_URL = new URL('../../public/assets/ground-pbr-canary/', import.meta.url);
const ASSET_DIR = fileURLToPath(ASSET_URL);

const prov = JSON.parse(await readFile(new URL('provenance.json', ASSET_URL), 'utf8'));
const files = (await readdir(ASSET_DIR)).filter((f) => f.endsWith('.jpg'));
check(files.length === 6, 'ground-pbr map count is exactly 6', `${files.length}`);

for (const asset of prov.assets) {
  for (const m of asset.maps) {
    const buf = await readFile(new URL(m.file, ASSET_URL));
    const sha = createHash('sha256').update(buf).digest('hex');
    check(buf.length === m.bytes && sha === m.sha256, `${m.file} byte count (${m.bytes} B) and SHA-256 match`);
  }
}

// --- 4. Environment Flags QA Switchability ---
console.log('\n--- 4. Environment Flags QA Switchability ---');
const envFlags = await import('../../src/core/environment-flags.ts');

// Baseline mode
envFlags.setEnvironmentFlagsOverride({ groundPbr: null, distantMountains: null });
check(envFlags.getEnvironmentMode() === 'baseline', 'default mode is baseline');
check(envFlags.isGroundPbrEnabled() === false, 'default groundPbr is false (baseline available)');
check(envFlags.isDistantMountainsEnabled() === false, 'default distantMountains is false (baseline available)');

// Ground-only mode
envFlags.setEnvironmentFlagsOverride({ groundPbr: true, distantMountains: false });
check(envFlags.getEnvironmentMode() === 'ground-canary', 'ground-only mode is ground-canary');
check(envFlags.isGroundPbrEnabled() === true, 'ground-only groundPbr is true');
check(envFlags.isDistantMountainsEnabled() === false, 'ground-only distantMountains is false');

// Mountains-only mode
envFlags.setEnvironmentFlagsOverride({ groundPbr: false, distantMountains: true });
check(envFlags.getEnvironmentMode() === 'mountains-canary', 'mountains-only mode is mountains-canary');
check(envFlags.isGroundPbrEnabled() === false, 'mountains-only groundPbr is false');
check(envFlags.isDistantMountainsEnabled() === true, 'mountains-only distantMountains is true');

// Combined candidate mode
envFlags.setEnvironmentFlagsOverride({ groundPbr: true, distantMountains: true });
check(envFlags.getEnvironmentMode() === 'combined-canary', 'combined mode is combined-canary');
check(envFlags.isGroundPbrEnabled() === true, 'combined groundPbr is true');
check(envFlags.isDistantMountainsEnabled() === true, 'combined distantMountains is true');

// Reset to default
envFlags.setEnvironmentFlagsOverride({ groundPbr: null, distantMountains: null });

// --- 5. Verify Integration In Source Code ---
console.log('\n--- 5. Integration Integrity in materials.ts & skyline.ts ---');
const materialsSrc = await readFile(new URL('../../src/core/materials.ts', import.meta.url), 'utf8');
const skylineSrc = await readFile(new URL('../../src/build/skyline.ts', import.meta.url), 'utf8');
const mainSrc = await readFile(new URL('../../src/main.ts', import.meta.url), 'utf8');

check(materialsSrc.includes('isGroundPbrEnabled()'), 'materials.ts branches on isGroundPbrEnabled()');
check(materialsSrc.includes('applyGroundPbrCanaryMaps'), 'materials.ts applies ground PBR canary maps');
check(materialsSrc.includes('textures/polyhaven/asphalt-07'), 'materials.ts retains Polyhaven asphalt baseline upgrade');
check(materialsSrc.includes('textures/polyhaven/concrete-pavement-03'), 'materials.ts retains Polyhaven paving/concrete baseline upgrade');
// The paving upgrade must sit at the region's base brace depth — inside neither
// canary branch — so absent-flag runs keep the original asphalt→paving→concrete
// order and canary runs keep the Polyhaven paving baseline.
const groundRegionStart = materialsSrc.indexOf('// Ground-family texture source selection.');
const groundRegionEnd = materialsSrc.indexOf('upgrade(lib.deckBoards');
let pavingDepth = -1;
if (groundRegionStart !== -1 && groundRegionEnd > groundRegionStart) {
  let depth = 0;
  for (const line of materialsSrc.slice(groundRegionStart, groundRegionEnd).split('\n')) {
    if (line.includes('upgrade(lib.paving')) {
      pavingDepth = depth;
      break;
    }
    depth += ((line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length);
  }
}
check(pavingDepth === 0, 'materials.ts paving upgrade is unconditional (base brace depth, outside any canary branch)');

check(skylineSrc.includes('isDistantMountainsEnabled()'), 'skyline.ts branches on isDistantMountainsEnabled()');
check(skylineSrc.includes('createDistantMountainsCanary'), 'skyline.ts calls createDistantMountainsCanary(ctx)');
check(skylineSrc.includes('buildRidgeGeometry'), 'skyline.ts retains baseline mountain ridge generator');
check(skylineSrc.includes('cityFar'), 'skyline.ts retains city and other skyline elements');
check(skylineSrc.includes('g.userData.dispose = canary.dispose'), 'skyline.ts registers release under userData.dispose (page-lifecycle key)');
check(!skylineSrc.includes('canaryDispose'), 'skyline.ts has no orphan canaryDispose key');

check(mainSrc.includes('getEnvironmentFlags()'), 'main.ts exposes getEnvironmentFlags()');
check(mainSrc.includes('__NT_FLAGS'), 'main.ts exposes __NT_FLAGS global');
check(mainSrc.includes('releaseEnvironmentCanary'), 'main.ts owns a single canary release shared by pagehide and QA');

// --- 6. Comparison harness contract (root runs it; this lane never launches it) ---
console.log('\n--- 6. Comparison Harness Contract ---');
const harnessSrc = await readFile(new URL('../../scripts/assets/environment-comparison-harness.mjs', import.meta.url), 'utf8');
check(harnessSrc.includes('../lib/stock-browser.mjs'), 'harness reuses stock-browser.mjs (no bespoke Chrome spawn)');
check(!harnessSrc.includes('chromium.launch') && !harnessSrc.includes('connectOverCDP'), 'harness spawns no browser of its own');
check(harnessSrc.includes('measureFrame') && harnessSrc.includes('sceneWasMeasured'), 'harness reads render-delta stats (MEASURED NOTHING fails)');
check(harnessSrc.includes('__NT_BACKEND') && harnessSrc.includes('ntBackend'), 'harness proves real WebGPU via page backend report + canvas dataset');
check(harnessSrc.includes('--url') && harnessSrc.includes('--dist'), 'harness accepts --url and --dist');
check(harnessSrc.includes('createHash') && harnessSrc.includes('distDigest'), 'harness records SHA-256 identity of the served build');
check(!harnessSrc.includes('disposeEnvironment') && !harnessSrc.includes('__NT.dispose'), 'harness never disposes the live session');
check(harnessSrc.includes('__NT.stations'), 'harness reads canonical stations off the page (no hardcoded coordinates)');

// --- Summary ---
console.log(`\n=== VERIFICATION SUMMARY ===`);
console.log(`Failures: ${failures}`);

if (failures === 0) {
  console.log('\nALL ENVIRONMENT INTEGRATION CHECKS PASSED (100% GREEN)');
  process.exit(0);
} else {
  console.error(`\nFAILED ${failures} CHECK(S)`);
  process.exit(1);
}
