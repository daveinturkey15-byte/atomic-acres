/**
 * Browser-free gait authority proof.
 *
 * This reads the checked-in baked manifest and bundles the real blend helpers
 * with esbuild. It exercises locomotion selection and playback-rate math for
 * the controller's measured speeds without starting Vite, Chrome, WebGPU, or
 * a renderer.
 */
import { build } from 'esbuild';
import { readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const outfile = join(tmpdir(), `nuketown-gait-${process.pid}.mjs`);
const ENTRY = `
  import { buildClipLibrary } from ${JSON.stringify(join(ROOT, 'src/characters/clips'))};
  import { pickLocomotion, locomotionTimeScale } from ${JSON.stringify(join(ROOT, 'src/characters/blend'))};
  export { buildClipLibrary, pickLocomotion, locomotionTimeScale };
`;

const assert = (ok, message) => { if (!ok) throw new Error(message); };
const near = (actual, expected, message) => assert(
  Math.abs(actual - expected) < 1e-9,
  `${message}: expected ${expected}, got ${actual}`,
);

await build({
  stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'gait-proof.ts', loader: 'ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile,
  logLevel: 'warning',
});

try {
  const { buildClipLibrary, pickLocomotion, locomotionTimeScale } = await import(pathToFileURL(outfile).href);
  const manifest = JSON.parse(readFileSync(join(ROOT, 'public/anim/manifest.json'), 'utf8'));
  const manifestSpeeds = Object.fromEntries((manifest.clips ?? []).map((clip) => [clip.id, clip.speed]));
  const required = ['walk', 'run', 'sprint', 'crouch-walk'];
  for (const name of required) {
    assert(Number.isFinite(manifestSpeeds[name]) && manifestSpeeds[name] > 0,
      `manifest missing positive authored speed for ${name}`);
  }

  // Start from the actual library shape, then overlay the measured baked
  // speeds from manifest.json. This keeps every clip binding real while making
  // the threshold proof reflect the assets loaded by the game.
  const library = buildClipLibrary();
  for (const name of ['walk', 'run', 'sprint', 'crouch-walk']) {
    library[name] = { ...library[name], speed: manifestSpeeds[name] };
  }

  const cases = [
    { name: 'stationary', speed: 0, crouch: false, prone: false, sprinting: false, want: 'idle' },
    { name: 'jog-4.8-explicit-nonsprint', speed: 4.8, crouch: false, prone: false, sprinting: false, want: 'run' },
    { name: 'sprint-6.6-explicit', speed: 6.6, crouch: false, prone: false, sprinting: true, want: 'sprint' },
    { name: 'crouch-2.75', speed: 2.75, crouch: true, prone: false, sprinting: true, want: 'crouch-walk' },
    { name: 'prone-1.25', speed: 1.25, crouch: false, prone: true, sprinting: true, want: 'prone-crawl' },
  ];
  const selected = cases.map((test) => {
    const got = pickLocomotion(test.speed, test.crouch, test.prone, test.sprinting, library);
    assert(got === test.want, `${test.name}: selected ${got}, expected ${test.want}`);
    const spec = library[got];
    return {
      ...test,
      got,
      clipSpeed: spec.speed,
      timeScale: locomotionTimeScale(test.speed, spec.speed),
    };
  });

  // This is the historical failure the explicit flag closes: with the baked
  // speeds, an omitted state sends 4.8 m/s through the old run/sprint midpoint
  // and picks sprint. The explicit non-sprint state selects the measured run
  // band instead, preserving a jog cadence without claiming it is a sprint.
  const legacyWalk = pickLocomotion(4.8, false, false, undefined, library);
  assert(legacyWalk === 'sprint', `legacy threshold changed unexpectedly: ${legacyWalk}`);
  assert(legacyWalk !== selected[1].got, 'explicit non-sprint jog must differ from legacy baked-speed threshold');

  near(selected[1].timeScale, 4.8 / manifestSpeeds.run, 'jog/run playback rate');
  near(selected[2].timeScale, 6.6 / manifestSpeeds.sprint, 'sprint playback rate');
  near(selected[3].timeScale, 2.75 / library['crouch-walk'].speed, 'crouch playback rate');
  near(selected[4].timeScale, 1.25 / library['prone-crawl'].speed, 'prone playback rate');
  for (const row of selected) assert(Number.isFinite(row.timeScale) && row.timeScale >= 0,
    `${row.name}: invalid playback rate ${row.timeScale}`);

  console.log(JSON.stringify({
    bakedSpeeds: {
      walk: manifestSpeeds.walk,
      run: manifestSpeeds.run,
      sprint: manifestSpeeds.sprint,
      crouchWalk: manifestSpeeds['crouch-walk'],
    },
    legacyWalk,
    selected,
    verdict: 'PASS explicit sprinting flag preserves walk/jog/sprint semantics and scales each active clip by authored speed',
  }, null, 2));
} finally {
  rmSync(outfile, { force: true });
}
