/**
 * CPU reachability proof for the white upstairs bedroom.
 *
 * This bundles and calls the actual buildWhiteHouse function, collects the
 * AABBs it returns, erodes a sampled occupancy grid by the player's horizontal
 * halfwidth, and floods from both upstairs door approaches. Each doorway is
 * checked inside a bounded region so a hall route cannot pass through the
 * green-room opening (and vice versa). A retained esbuild onLoad control also
 * rebuilds the unchanged source with BED_SET_X=0 and proves that the original
 * bed placement fails the hall route.
 *
 * It deliberately does not use browser __NT collidersAt(), a hand-copied bed
 * rectangle, or a route-specific exception.
 */
import { build } from 'esbuild';
import * as THREE from 'three';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SOURCE = join(ROOT, 'src', 'build', 'white-house.ts');
const bundle = join(tmpdir(), `nuketown-bedroom-${process.pid}.mjs`);
const negativeBundle = join(tmpdir(), `nuketown-bedroom-negative-${process.pid}.mjs`);
const STEP = 0.2;
const PLAYER_HALF_WIDTH = 0.30;
// 0.42 m is deliberately retained as a conservative sensitivity pass. It is
// larger than the actual player's 0.30 m halfwidth and is not a controller radius.
const CONSERVATIVE_HALF_WIDTH = 0.42;
const STEP_UP = 0.38;
const BODY_TOP = 1.78;
const Y = 3.15;
const X0 = -7.4, X1 = 7.4, Z0 = 12.4, Z1 = 27.6;
const NX = Math.round((X1 - X0) / STEP) + 1;
const NZ = Math.round((Z1 - Z0) / STEP) + 1;
const cellIndex = (ix, iz) => iz * NX + ix;
const cellCoord = (x, z) => [Math.round((x - X0) / STEP), Math.round((z - Z0) / STEP)];
const world = (i) => [X0 + (i % NX) * STEP, Z0 + Math.floor(i / NX) * STEP];
const inside = (h, x, z) => x >= h.min.x && x <= h.max.x && z >= h.min.z && z <= h.max.z;

const checks = [
  { name: 'hall -> bedroom', from: [-3.65, 24.9], to: [-5.3, 23.0], region: 'hall' },
  { name: 'bedroom -> hall', from: [-5.3, 23.0], to: [-3.65, 24.9], region: 'hall' },
  { name: 'green room -> bedroom', from: [-1.8, 22.7], to: [-5.3, 23.0], region: 'green-room' },
  { name: 'bedroom -> green room', from: [-5.3, 23.0], to: [-1.8, 22.7], region: 'green-room' },
];

function materialFactory() {
  const shared = new THREE.MeshBasicMaterial();
  const mat = new Proxy({}, {
    get(_target, property) {
      if (property === 'painted' || property === 'emissive' || property === 'signText') return () => shared;
      return shared;
    },
  });
  return { mat, shared };
}

function disposeBuilt(built, shared) {
  built?.group?.traverse((node) => {
    if (node.isMesh) node.geometry.dispose();
  });
  shared?.dispose();
}

function routeRegion(name) {
  if (name === 'hall') {
    // The green-room partition is x=-2.4. Stop the hall flood before it can
    // reach that opening while retaining the entire hall doorway side corridor.
    return {
      name,
      description: 'hall side unrestricted; below z=24.3 requires x <= -2.7, green-room opening excluded',
      allowed: (x, z) => z > 24.3 || x <= -2.7,
    };
  }
  // The hall wall is z=24.6. Stop the green-room flood below that wall so it
  // cannot satisfy the green route by going out through the rear hall door.
  return { name, description: 'z <= 24.3; rear hall opening excluded', allowed: (_x, z) => z <= 24.3 };
}

function analyze(colliders, halfWidth) {
  function floorTop(x, z) {
    let top = -Infinity;
    for (const h of colliders) {
      if (!inside(h, x, z)) continue;
      if (h.max.y < Y - 0.65 || h.max.y > Y + STEP_UP) continue;
      if (h.max.y > top) top = h.max.y;
    }
    return top;
  }

  const blocked = new Uint8Array(NX * NZ);
  const floorHeights = new Float32Array(NX * NZ);
  floorHeights.fill(-Infinity);
  for (let iz = 0; iz < NZ; iz++) {
    for (let ix = 0; ix < NX; ix++) {
      const x = X0 + ix * STEP, z = Z0 + iz * STEP, i = cellIndex(ix, iz);
      const base = floorTop(x, z);
      floorHeights[i] = base;
      if (base === -Infinity) { blocked[i] = 1; continue; }
      for (const h of colliders) {
        if (!inside(h, x, z)) continue;
        if (h.max.y <= base + STEP_UP) continue;
        if (h.min.y >= base + BODY_TOP) continue;
        blocked[i] = 1;
        break;
      }
    }
  }

  // Erode against the real collider rectangles using the requested horizontal
  // halfwidth. A cell-radius ceil would turn 0.30 m into 0.40 m and 0.42 m into
  // 0.60 m, rejecting a physically valid doorway because of grid quantization.
  const sampleReachCells = Math.ceil(halfWidth / STEP);
  const standable = new Uint8Array(blocked.length);
  for (let iz = 0; iz < NZ; iz++) {
    for (let ix = 0; ix < NX; ix++) {
      let ok = blocked[cellIndex(ix, iz)] === 0;
      const x = X0 + ix * STEP, z = Z0 + iz * STEP;
      const base = floorHeights[cellIndex(ix, iz)];
      if (ok) {
        for (const h of colliders) {
          if (h.max.y <= base + STEP_UP || h.min.y >= base + BODY_TOP) continue;
          const dx = Math.max(h.min.x - x, 0, x - h.max.x);
          const dz = Math.max(h.min.z - z, 0, z - h.max.z);
          // Player.hits is an axis-aligned box, not a circular capsule. A circle
          // admits corners that the actual controller cannot pass.
          if (dx < halfWidth && dz < halfWidth) { ok = false; break; }
        }
      }
      standable[cellIndex(ix, iz)] = ok ? 1 : 0;
    }
  }

  function snap(x, z, allowed) {
    const [ix, iz] = cellCoord(x, z);
    let best = -1, bestD = Infinity;
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const cx = ix + dx, cz = iz + dz;
        if (cx < 0 || cz < 0 || cx >= NX || cz >= NZ) continue;
        const [wx, wz] = world(cellIndex(cx, cz));
        if (!allowed(wx, wz)) continue;
        const i = cellIndex(cx, cz);
        if (!standable[i]) continue;
        const d = Math.hypot(cx - ix, cz - iz);
        if (d < bestD) { bestD = d; best = i; }
      }
    }
    return best;
  }

  function bfs(start, allowed) {
    if (start < 0) return { seen: new Uint8Array(standable.length) };
    const seen = new Uint8Array(standable.length);
    const queue = [start];
    seen[start] = 1;
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head], ix = current % NX, iz = Math.floor(current / NX);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = ix + dx, nz = iz + dz;
        if (nx < 0 || nz < 0 || nx >= NX || nz >= NZ) continue;
        const [wx, wz] = world(cellIndex(nx, nz));
        if (!allowed(wx, wz)) continue;
        const next = cellIndex(nx, nz);
        if (seen[next] || !standable[next]) continue;
        // Prevent diagonal corner cutting through a wall corner.
        if (dx && dz && (!standable[cellIndex(ix + dx, iz)] || !standable[cellIndex(ix, iz + dz)])) continue;
        seen[next] = 1;
        queue.push(next);
      }
    }
    return { seen };
  }

  const results = checks.map((check) => {
    const region = routeRegion(check.region);
    const start = snap(...check.from, region.allowed);
    const target = snap(...check.to, region.allowed);
    const flood = bfs(start, region.allowed);
    return {
      name: check.name,
      region: region.description,
      ok: start >= 0 && target >= 0 && flood.seen[target] === 1,
      start: start >= 0 ? world(start) : null,
      target: target >= 0 ? world(target) : null,
    };
  });

  return { halfWidth, sampleReachCells, results };
}

async function bundleSource(outfile, plugins = []) {
  await build({
    entryPoints: [SOURCE], bundle: true, platform: 'node', format: 'esm',
    outfile, logLevel: 'silent', sourcemap: false, plugins,
  });
}

async function buildFromModule(module) {
  const { mat, shared } = materialFactory();
  const built = module.buildWhiteHouse({ mat, rand: () => 0.5 });
  if (!Array.isArray(built?.colliders) || built.colliders.length < 20) {
    disposeBuilt(built, shared);
    throw new Error('builder returned no usable collider set');
  }
  return { built, shared };
}

if (!existsSync(SOURCE)) throw new Error(`missing source: ${SOURCE}`);
mkdirSync(join(ROOT, 'docs', 'handoff', 'checkpoints', '2026-09-19-bedroom-door'), { recursive: true });

try {
  await bundleSource(bundle);
  const repairedModule = await import(`${pathToFileURL(bundle).href}?proof=${Date.now()}`);
  const repaired = await buildFromModule(repairedModule);
  const repairedColliders = repaired.built.colliders;

  const actual = analyze(repairedColliders, PLAYER_HALF_WIDTH);
  const conservative = analyze(repairedColliders, CONSERVATIVE_HALF_WIDTH);

  // Identify the bed by its actual returned AABB dimensions and prove the
  // required landing clearance against the authored wall positions.
  const bed = repairedColliders.find((h) => Math.abs((h.max.x - h.min.x) - 1.9) < 0.03
    && Math.abs((h.max.z - h.min.z) - 0.9) < 0.03
    && Math.abs((h.max.y - h.min.y) - 0.55) < 0.03);
  if (!bed) throw new Error('bed collider was not found in actual builder output');
  const hallWallZ = 24.6;
  const landingGap = hallWallZ - bed.max.z;
  const hallDoorMinX = -4.45;
  const hallDoorMaxX = -2.85;
  const greenPartitionX = -2.4;
  const hallCorridor = hallDoorMaxX - bed.max.x;
  const greenCorridor = greenPartitionX - bed.max.x;

  await bundleSource(negativeBundle, [{
    name: 'negative-bed-placement-control',
    setup(buildApi) {
      buildApi.onLoad({ filter: /[\\/]white-house\.ts$/ }, async (args) => {
        const source = await readFile(args.path, 'utf8');
        const replaced = source.replace(/const BED_SET_X = -?\d+(?:\.\d+)?;/, 'const BED_SET_X = 0;');
        if (replaced === source) throw new Error('negative control could not find BED_SET_X declaration');
        return { contents: replaced, loader: 'ts' };
      });
    },
  }]);
  const negativeModule = await import(`${pathToFileURL(negativeBundle).href}?negative=${Date.now()}`);
  const negative = await buildFromModule(negativeModule);
  const negativeActual = analyze(negative.built.colliders, PLAYER_HALF_WIDTH);
  const negativeConservative = analyze(negative.built.colliders, CONSERVATIVE_HALF_WIDTH);

  const measured = {
    colliderCount: repairedColliders.length,
    bed: { min: bed.min.toArray(), max: bed.max.toArray() },
    hallWallZ,
    landingGap,
    hallDoorX: [hallDoorMinX, hallDoorMaxX],
    hallDoorSideCorridor: hallCorridor,
    greenDoorSideCorridor: greenCorridor,
    actualPlayerHalfWidth: PLAYER_HALF_WIDTH,
    conservativeProofHalfWidth: CONSERVATIVE_HALF_WIDTH,
    actualRequiredCapsuleDiameter: PLAYER_HALF_WIDTH * 2,
    conservativeRequiredDiameter: CONSERVATIVE_HALF_WIDTH * 2,
    clearancePassActual: hallCorridor >= PLAYER_HALF_WIDTH * 2 && greenCorridor >= PLAYER_HALF_WIDTH * 2,
    clearancePassConservative: hallCorridor >= CONSERVATIVE_HALF_WIDTH * 2 && greenCorridor >= CONSERVATIVE_HALF_WIDTH * 2,
    repaired: { actual, conservative },
    negativeControl: {
      bedSetX: 0,
      actual: negativeActual,
      conservative: negativeConservative,
      hallRoutesFailActual: negativeActual.results.filter((result) => result.name.includes('hall')).every((result) => !result.ok),
      hallRoutesFailConservative: negativeConservative.results.filter((result) => result.name.includes('hall')).every((result) => !result.ok),
    },
  };

  writeFileSync(join(ROOT, 'docs', 'handoff', 'checkpoints', '2026-09-19-bedroom-door', 'collision-proof.json'), `${JSON.stringify(measured, null, 2)}\n`);
  console.log(JSON.stringify(measured, null, 2));
  const repairedPass = measured.clearancePassActual
    && measured.repaired.actual.results.every((result) => result.ok);
  const negativePass = measured.negativeControl.hallRoutesFailActual;
  if (!repairedPass || !negativePass) process.exitCode = 1;

  disposeBuilt(repaired.built, repaired.shared);
  disposeBuilt(negative.built, negative.shared);
} finally {
  // Keep the evidence JSON and source edits, but never leave temporary bundles.
  try { unlinkSync(bundle); } catch {}
  try { unlinkSync(negativeBundle); } catch {}
}
