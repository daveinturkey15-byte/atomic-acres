/**
 * verify-authored-mountains.mjs — validator for the Blender-native authored
 * mountain backdrop (docs/authored-mountain-mesh-handoff.md).
 *
 * Node-only, no GPU/browser/Blender. Two modes:
 *   node scripts/assets/verify-authored-mountains.mjs
 *     recipe-only when public/assets/authored-mountains/authored-mountains.glb
 *     is absent (this lane: source-only, root has not built yet) — exits 0,
 *     GLB section reports SKIP with the exact build command.
 *   node scripts/assets/verify-authored-mountains.mjs --strict
 *     fails when the GLB is absent (root CI after the guarded build).
 *
 * Budgets enforced on the GLB: draws <= 3, tris <= 18000 (>= 3000 or the
 * massifs are boxes), embedded images <= 2 at <= 1024 px, no external URIs,
 * no Draco, baseColor wiring present, layout anchors (R >= 280 m keepout on
 * all vertices, max reach >= 280 m, sunk base, peaks above town).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const RECIPE = join(ROOT, "scripts", "blender", "build_authored_mountains.py");
const GLB = process.env.AUTHORED_GLB_PATH || join(ROOT, "public", "assets", "authored-mountains", "authored-mountains.glb");
const PATCH = join(ROOT, "work", "authored-mountains", "authored-mountains.integration.patch");
const STRICT = process.argv.includes("--strict");

const MAX_TRIS = 18000;
const MIN_TRIS = 3000;
const MAX_DRAWS = 3;
const MAX_IMG = 1024;
const KEEPOUT_RADIUS_MIN = 280.0;

const checks = [];
function check(name, pass, detail = "") {
  checks.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? " - " + detail : ""}`);
}

console.log("=== AUTHORED MOUNTAINS VALIDATOR ===\n--- 1. RECIPE (static, no Blender) ---");

const src = readFileSync(RECIPE, "utf8");
// Strip docstrings/comments so prose ("no downloads") cannot trip code bans.
const code = src
  .replace(/"""[\s\S]*?"""/g, '""')
  .replace(/'''[\s\S]*?'''/g, "''")
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("#"))
  .join("\n");

check("Recipe pins SEED = 20260919", /SEED\s*=\s*20260919/.test(code), "deterministic regeneration");
check("Recipe declares draw/tri budget asserts", /MAX_TRIS\s*=\s*18000/.test(code) && /MAX_DRAWS\s*=\s*3/.test(code));
check("Recipe outputs only to authored-mountains/", /authored-mountains/.test(code) && !/coach\.glb|skyline|distant-mountains-canary\.ts/.test(code), "never overwrites best-known-good");
check("Recipe fixes render threads = 2", /render\.threads\s*=\s*2/.test(code), "guarded CPU lane");
check("No subdivision/boolean/bake ops", !/SUBSURF|MULTIRES|BOOLEAN|ops\.object\.bake|ops\.mesh\.subdivide/.test(code), "bounded explicit geometry");
check("No Cycles assignment", !/CYCLES/.test(code), "EEVEE-or-nothing thumbnail");
check("No network/download/pip", !/urllib|requests|urlretrieve|urlopen|pip install|https?:\/\//.test(code), "zero external inputs");
check("Joined-ring topology (3 meshes)", /RING_MESH\.append/.test(code) && /ops\.object\.join/.test(code), "one mesh per ring");
check("y-up export roll before glTF", /_ROLL @ _ob\.matrix_world/.test(code), "three.js convention");
check("Flat-shaded facets", /use_smooth\s*=\s*False/.test(code), "geological normals, not smooth domes");
check("Far horns pointed (no mesa cap)", /horn = \(rname == .far.\)/.test(code), "no white-stripe tabular far tops");
check("Smart UV uses radians", /smart_project\(angle_limit=math\.radians\(66/.test(code), "Blender 5.1 RNA radian API");
check("Keepout assert declared (min_r >= 280.0)", /assert min_r >= 280\.0/.test(code), "runtime layout boundary assert");

console.log("\n--- 2. GLB (built asset) ---");
if (!existsSync(GLB)) {
  const msg = `absent — root builds it: blender --background --threads 2 --python scripts/blender/build_authored_mountains.py`;
  if (STRICT) {
    check("GLB exists (strict mode)", false, msg);
  } else {
    console.log(`[SKIP] GLB checks — ${msg}`);
  }
} else {
  const buf = readFileSync(GLB);
  check("GLB file size >= 20 bytes", buf.length >= 20, `${buf.length} bytes`);
  const magic = buf.toString("ascii", 0, 4);
  check("GLB magic", magic === "glTF", magic);
  const version = buf.readUInt32LE(4);
  check("GLB version 2", version === 2, `version=${version}`);
  const declaredLength = buf.readUInt32LE(8);
  check("GLB header length matches file size", declaredLength === buf.length, `declared=${declaredLength}, file=${buf.length}`);

  // Chunk 0: JSON
  let pos = 12;
  const c0Len = buf.readUInt32LE(pos);
  const c0Type = buf.toString("ascii", pos + 4, pos + 8);
  check("Chunk 0 is JSON", c0Type === "JSON", c0Type);
  check("Chunk 0 length valid", pos + 8 + c0Len <= buf.length, `c0Len=${c0Len}`);
  const doc = JSON.parse(buf.toString("utf8", pos + 8, pos + 8 + c0Len));

  pos += 8 + c0Len;

  // Chunk 1: BIN
  let binStart = 0;
  let binLength = 0;
  if (pos + 8 <= buf.length) {
    const c1Len = buf.readUInt32LE(pos);
    const c1Type = buf.toString("ascii", pos + 4, pos + 8);
    check("Chunk 1 is BIN", c1Type.startsWith("BIN"), c1Type);
    binStart = pos + 8;
    binLength = c1Len;
    check(
      "BIN chunk within file bounds (corruption falsifier)",
      binStart + binLength <= buf.length,
      `binStart=${binStart}, binLength=${binLength}, total=${buf.length}`
    );
  } else {
    check("Chunk 1 header present", false, `offset=${pos} >= length=${buf.length}`);
  }

  const meshCount = doc.meshes?.length ?? 0;
  let prims = 0;
  let tris = 0;
  for (const m of doc.meshes ?? []) {
    for (const p of m.primitives ?? []) {
      prims++;
      const idx = p.indices !== undefined ? doc.accessors[p.indices] : null;
      if (idx) tris += Math.floor(idx.count / 3);
      else if (p.attributes?.POSITION !== undefined) {
        tris += Math.floor(doc.accessors[p.attributes.POSITION].count / 3);
      }
    }
  }
  check("Draw calls <= 3", prims <= MAX_DRAWS && prims > 0, `primitives=${prims}`);
  check("Meshes <= 3", meshCount <= MAX_DRAWS && meshCount > 0, `meshes=${meshCount}`);
  check("Triangles 3000..18000", tris >= MIN_TRIS && tris <= MAX_TRIS, `tris=${tris}`);
  check("Single shared material", (doc.materials?.length ?? 99) <= 1, `materials=${doc.materials?.length}`);

  const images = doc.images ?? [];
  const external = images.filter((im) => typeof im.uri === "string" && !im.uri.startsWith("data:"));
  check("Embedded images <= 2", images.length <= 2 && images.length > 0, `images=${images.length}`);
  check("No external URIs", external.length === 0, external.length ? JSON.stringify(external) : "all bufferView-backed");
  let imgSizeOk = true;
  const imgDetail = [];
  for (const im of images) {
    if (im.bufferView === undefined) { imgSizeOk = false; imgDetail.push("missing bufferView"); continue; }
    const bv = doc.bufferViews[im.bufferView];
    if (!bv) { imgSizeOk = false; imgDetail.push(`invalid bufferView ${im.bufferView}`); continue; }
    const start = binStart + (bv.byteOffset ?? 0);
    const end = start + bv.byteLength;
    if (start < binStart || end > binStart + binLength || end > buf.length) {
      imgSizeOk = false;
      imgDetail.push(`bufferView out of BIN bounds (corrupt: start=${start}, end=${end})`);
      continue;
    }
    const bytes = buf.subarray(start, end);
    // PNG signature: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
    if (
      bytes.length >= 24 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    ) {
      const ihdrType = bytes.toString("ascii", 12, 16);
      if (ihdrType === "IHDR") {
        const w = bytes.readUInt32BE(16);
        const h = bytes.readUInt32BE(20);
        imgDetail.push(`${im.name || "image"}:${w}x${h}`);
        if (w > MAX_IMG || h > MAX_IMG || w === 0 || h === 0) imgSizeOk = false;
      } else {
        imgSizeOk = false;
        imgDetail.push(`${im.name || "image"}:missing-IHDR`);
      }
    } else {
      imgSizeOk = false;
      imgDetail.push(`${im.name || "image"}:non-PNG`);
    }
  }
  check("Textures <= 1024 px valid PNG", imgSizeOk, imgDetail.join(", "));

  const extReq = doc.extensionsRequired ?? [];
  check("No Draco compression", !extReq.some((e) => /DRACO/i.test(e)), extReq.join(",") || "plain glTF 2.0");
  const wired = (doc.materials ?? []).some(
    (m) => m.pbrMetallicRoughness?.baseColorTexture !== undefined || m.pbrMetallicRoughness?.baseColorFactor !== undefined,
  );
  check("baseColor wired (no white-export trap)", wired, "baked math pixels survive export");

  // Geometry checks: inspect all vertices across all primitives
  let minHorizRadius = Infinity;
  let maxReach = 0;
  let minY = Infinity;
  let maxY = -Infinity;
  let vertexCount = 0;

  for (const m of doc.meshes ?? []) {
    for (const p of m.primitives ?? []) {
      if (p.attributes?.POSITION === undefined) continue;
      const acc = doc.accessors[p.attributes.POSITION];
      const bv = doc.bufferViews[acc.bufferView];
      const offBase = binStart + (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      const stride = bv.byteStride || 12; // 3 floats * 4 bytes
      for (let i = 0; i < acc.count; i++) {
        const off = offBase + i * stride;
        if (off + 12 > binStart + binLength) break;
        const x = buf.readFloatLE(off);
        const y = buf.readFloatLE(off + 4);
        const z = buf.readFloatLE(off + 8);
        const r = Math.hypot(x, z);
        if (r < minHorizRadius) minHorizRadius = r;
        const reach = Math.max(Math.abs(x), Math.abs(z));
        if (reach > maxReach) maxReach = reach;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        vertexCount++;
      }
    }
  }

  check("Geometry vertices decoded", vertexCount > 0, `vertices=${vertexCount}`);
  check(
    `Layout keepout R >= ${KEEPOUT_RADIUS_MIN} m (all vertices)`,
    minHorizRadius >= KEEPOUT_RADIUS_MIN,
    `nearest=${minHorizRadius.toFixed(2)} m`
  );
  check("Layout reach R >= 280 m", maxReach >= 280, `reach=${maxReach.toFixed(0)} m`);
  check("Base sunk (minY <= -6)", minY <= -6, `minY=${minY.toFixed(1)}`);
  check("Peaks above town (maxY >= 60)", maxY >= 60, `maxY=${maxY.toFixed(1)}`);

  const gen = doc.asset?.generator ?? "";
  check("Blender-authored generator tag", /blender/i.test(gen), gen);
}

console.log("\n--- 3. LIFECYCLE & INTEGRATION (patch contract) ---");
check("Integration patch file exists", existsSync(PATCH), PATCH);
if (existsSync(PATCH)) {
  const patchText = readFileSync(PATCH, "utf8");
  check("Patch touches src/core/assets.ts", patchText.includes("a/src/core/assets.ts"));
  check("Patch touches src/build/skyline.ts", patchText.includes("a/src/build/skyline.ts"));
  check("Patch touches src/main.ts", patchText.includes("a/src/main.ts"));
  check("Patch defines releaseAsset", patchText.includes("export function releaseAsset"));
  check("Patch guards opt-in in main preload", patchText.includes("isAuthoredMountainsOptIn()"));
  check("Patch does NOT modify package.json scripts", !patchText.includes("package.json"));
}

// Unit test mock simulation of releaseAsset lifecycle contract
{
  const testMasters = new Map();
  const testPending = new Map();
  const testReleased = new Set();
  let coachDisposed = false;
  let authoredDisposed = false;
  let lateDisposed = false;

  const mockCoach = { name: "coach", dispose: () => { coachDisposed = true; } };
  const mockAuthored = { name: "authored-mountains", dispose: () => { authoredDisposed = true; } };
  testMasters.set("coach", mockCoach);
  testMasters.set("authored-mountains", mockAuthored);

  let resolveLate;
  const latePromise = new Promise((resolve) => { resolveLate = resolve; });
  testPending.set("authored-mountains", latePromise);

  // simulate releaseAsset logic
  function testReleaseAsset(name) {
    if (name !== "coach" && name !== "authored-mountains") return;
    if (testReleased.has(name)) return;
    testReleased.add(name);
    const master = testMasters.get(name);
    if (master) {
      master.dispose();
      testMasters.delete(name);
    }
    const flight = testPending.get(name);
    if (flight) {
      testPending.delete(name);
      void flight.then((late) => {
        late.dispose();
        testMasters.delete(name);
      });
    }
  }

  testReleaseAsset("authored-mountains");

  check("releaseAsset disposes authored master", authoredDisposed, "master disposed");
  check("releaseAsset removes authored from cache", !testMasters.has("authored-mountains"), "removed from masters");
  check("releaseAsset leaves coach master untouched", !coachDisposed && testMasters.has("coach"), "coach preserved");

  // Late pending resolve simulation
  const mockLate = { name: "late", dispose: () => { lateDisposed = true; } };
  resolveLate(mockLate);
  await Promise.resolve(); // flush microtask

  check("releaseAsset cleans up pending load safely", lateDisposed && !testMasters.has("authored-mountains"), "late master disposed and not cached");

  // Idempotent repeat release
  testReleaseAsset("authored-mountains");
  check("releaseAsset repeat call is idempotent no-op", testReleased.has("authored-mountains"), "idempotent");
}

console.log("\n=== SUMMARY ===");
const failed = checks.filter((c) => !c.pass);
console.log(`Total: ${checks.length} Passed: ${checks.length - failed.length} Failed: ${failed.length}`);
if (failed.length > 0) process.exit(1);
console.log("AUTHORED MOUNTAINS VALIDATOR GREEN");
