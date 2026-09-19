/**
 * ADVERSARIAL VERIFIER harness for the CHARACTERS lane.
 *
 * Independent of the lane's own _chars-*.mjs. It does not trust __NTMESH or
 * __NTANIM for anything it can measure itself: the Scene and the Renderer are
 * captured through three's own `__THREE_DEVTOOLS__` observe hook (installed by
 * addInitScript BEFORE the bundle loads), so object counts, geometry identity
 * and renderer.info are read off the live objects.
 *
 *   node scripts/_verify-chars.mjs draws
 *   node scripts/_verify-chars.mjs heap
 *   node scripts/_verify-chars.mjs shots
 *   node scripts/_verify-chars.mjs anim
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { usePreview } from './lib/preview.mjs';
import { spawnGuarded, killTree } from './lib/proc-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'captures', 'verify-chars');
mkdirSync(OUT, { recursive: true });

const phase = process.argv[2] || 'draws';

function distStamp() {
  const d = join(ROOT, 'dist', 'assets');
  const files = readdirSync(d).sort();
  return files.map((f) => f + ':' + statSync(join(d, f)).mtimeMs).join('|')
    + '|index.html:' + statSync(join(ROOT, 'dist', 'index.html')).mtimeMs;
}

function freePort() {
  return new Promise((res, rej) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
    s.on('error', rej);
  });
}
function chromePath() {
  const c = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  ].filter(Boolean);
  return c.find((p) => existsSync(p)) ?? null;
}

const distBefore = distStamp();
const { url } = await usePreview();
const exe = chromePath();
if (!exe) { console.error('no Chrome'); process.exit(2); }
const cdpPort = await freePort();
const chrome = spawnGuarded(exe, [
  '--headless=new', '--remote-debugging-port=' + cdpPort,
  '--user-data-dir=' + join(tmpdir(), 'aa-vchars-' + cdpPort),
  '--no-first-run', '--no-default-browser-check',
  '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
  '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
  '--window-position=2560,0', '--window-size=1600,900', 'about:blank',
], { stdio: 'ignore', windowsHide: true });

let browser = null;
for (let i = 0; i < 200 && !browser; i++) {
  try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
  catch { await new Promise((r) => setTimeout(r, 250)); }
}
if (!browser) { console.error('no CDP'); killTree(chrome.pid); process.exit(2); }

const ctx = browser.contexts()[0] ?? await browser.newContext();
// The devtools hook has to exist before three's Scene/Renderer constructors run.
await ctx.addInitScript(() => {
  const t = new EventTarget();
  window.__OBS = [];
  t.addEventListener('observe', (e) => { window.__OBS.push(e.detail); });
  window.__THREE_DEVTOOLS__ = t;
});
const page = ctx.pages()[0] ?? await ctx.newPage();
await page.setViewportSize({ width: 1600, height: 900 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 200)));
// Name the 404 instead of reporting "one pre-existing 404 on a resource".
page.on('response', (r) => { if (r.status() >= 400) errors.push('HTTP ' + r.status() + ' ' + r.url()); });

await page.goto(url, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
await page.waitForTimeout(2500);
await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });

// Bind the live three objects observed at construction time.
const bound = await page.evaluate(() => {
  const obs = window.__OBS || [];
  const scenes = obs.filter((o) => o && o.isScene);
  // Several Scenes exist (world, weapons overlay, the post chain's quad scene).
  // Pick the one that actually contains the skinned figures; fall back to the
  // biggest. Picking the first one silently measured an empty graph once.
  const withOps = scenes.filter((s) => {
    let n = 0; s.traverse((o) => { if (o.isSkinnedMesh) n++; });
    return n > 0;
  });
  const size = (s) => { let n = 0; s.traverse(() => n++); return n; };
  window.__V = {
    scene: withOps[0] || scenes.slice().sort((a, b) => size(b) - size(a))[0],
    scenes,
    renderer: obs.find((o) => o && o.info && typeof o.render === 'function'),
  };
  return {
    observed: obs.length, scenes: scenes.length, withOps: withOps.length,
    sizes: scenes.map(size), renderer: !!window.__V.renderer,
  };
});
console.log('[verify] devtools bind', JSON.stringify(bound), '| dist stable so far:', distStamp() === distBefore);

const SPAWN_A = { x: -4.0, z: -34.3, yaw: Math.PI };

async function goSpawnA() {
  await page.evaluate(([x, z, yaw]) => {
    window.__NT.teleport(x, 0, z, yaw, 0);
    if (window.__NT.release) window.__NT.release();
  }, [SPAWN_A.x, SPAWN_A.z, SPAWN_A.yaw]);
  await page.waitForTimeout(900);
}

/** Median of N per-frame drawCalls read two rAF ticks apart, from BOTH sources. */
async function sampleCalls(n = 41) {
  return await page.evaluate(async (n) => {
    const step = () => new Promise((r) => requestAnimationFrame(() => r()));
    const a = []; const b = [];
    for (let i = 0; i < n; i++) {
      await step(); await step();
      a.push(window.__NT.stats().calls);
      b.push(window.__V.renderer.info.render.drawCalls);
    }
    const med = (v) => [...v].sort((p, q) => p - q)[v.length >> 1];
    const uniq = (v) => [...new Set(v)].length;
    return { nt: med(a), raw: med(b), ntUniq: uniq(a), rawUniq: uniq(b), tris: window.__NT.stats().triangles };
  }, n);
}

async function figureCensus() {
  return await page.evaluate(() => {
    const scene = window.__V.scene;
    const ops = [];
    scene.traverse((o) => { if (o.isSkinnedMesh || (o.isMesh && o.name === 'operator')) ops.push(o); });
    const roots = [...new Set(ops.map((o) => o.parent))];
    const perRoot = roots.map((r) => {
      let renderables = 0; let objects = 0; const names = [];
      r.traverse((o) => {
        objects++;
        if (o.isMesh || o.isSkinnedMesh || o.isLine || o.isPoints || o.isSprite) {
          renderables++; names.push(o.type + ':' + (o.name || '-'));
        }
      });
      return { renderables, objects, names, pos: [+r.position.x.toFixed(2), +r.position.z.toFixed(2)], visible: r.visible };
    });
    const geos = [...new Set(ops.map((o) => o.geometry.uuid))];
    const geoInfo = geos.map((u) => {
      const m = ops.find((o) => o.geometry.uuid === u);
      const g = m.geometry;
      return {
        uuid: u.slice(0, 8),
        tris: g.index ? g.index.count / 3 : g.getAttribute('position').count / 3,
        verts: g.getAttribute('position').count,
        hasColor: !!g.getAttribute('color'),
        hasSkin: !!g.getAttribute('skinIndex'),
        groups: g.groups.length,
        users: ops.filter((o) => o.geometry.uuid === u).length,
      };
    });
    const mats = [...new Set(ops.map((o) => (Array.isArray(o.material) ? 'ARRAY' : o.material.uuid)))];
    const m0 = ops[0] && !Array.isArray(ops[0].material) ? ops[0].material : null;
    return {
      figures: ops.length,
      roots: roots.length,
      perRoot,
      geoInfo,
      distinctMaterials: mats.length,
      material: m0 ? { type: m0.type, vertexColors: m0.vertexColors, color: '#' + m0.color.getHexString(), rough: m0.roughness, metal: m0.metalness } : null,
      boundingSphere: ops[0] ? (ops[0].boundingSphere ? { r: ops[0].boundingSphere.radius } : null) : null,
    };
  });
}

async function memCounts() {
  return await page.evaluate(() => {
    const i = window.__V.renderer.info;
    return { geometries: i.memory.geometries, textures: i.memory.textures };
  });
}

const report = { phase, url, distBefore, errors: [] };

if (phase === 'draws') {
  await goSpawnA();
  const census0 = await figureCensus();
  const mem0 = await memCounts();
  const s0 = await sampleCalls();
  console.log('[A] live figures', census0.figures, 'calls', JSON.stringify(s0));

  // Hide every figure.
  const hidden = await page.evaluate(() => window.__NTANIM.solo(-1));
  await page.waitForTimeout(600);
  const sHide = await sampleCalls();
  console.log('[B] hidden', hidden, 'calls', JSON.stringify(sHide));

  await page.evaluate(() => window.__NTANIM.showAll());
  await page.waitForTimeout(600);

  // Spawn 6 more IN FRONT of the camera. At spawnA yaw=PI the camera forward is
  // (-sin yaw, -cos yaw) = (0, +1), so "in front" is +z of the player.
  const spawned = await page.evaluate(([x, z]) => {
    const at = [[x - 2.2, z + 5], [x, z + 5], [x + 2.2, z + 5],
      [x - 2.2, z + 7.5], [x, z + 7.5], [x + 2.2, z + 7.5]];
    let n = 0;
    for (const [px, pz] of at) n = window.__NTANIM.spawn(px, pz, Math.PI);
    return n;
  }, [SPAWN_A.x, SPAWN_A.z]);
  await page.waitForTimeout(900);
  const census6 = await figureCensus();
  const mem6 = await memCounts();
  const s6 = await sampleCalls();
  writeFileSync(join(OUT, 'draws-plus6.png'), await page.screenshot({ type: 'png' }));
  console.log('[C] after +6 total', spawned, 'calls', JSON.stringify(s6));

  // Do the new six actually render? Hide only them by soloing nothing is not
  // possible, so verify by hiding ALL and re-showing: the delta above is the test.
  const disposed = await page.evaluate(() => window.__NTMESH.disposeAll());
  await page.waitForTimeout(900);
  const memD = await memCounts();
  const sD = await sampleCalls();
  const censusD = await figureCensus();
  console.log('[D] disposed', disposed, 'calls', JSON.stringify(sD), 'mem', JSON.stringify(memD));

  report.draws = {
    liveFigures: census0.figures, census0, census6, censusD,
    callsAll: s0, callsHidden: sHide, callsPlus6: s6, callsDisposed: sD,
    mem0, mem6, memD, spawnedTotal: spawned, disposed,
    perFigureMarginal: (s6.nt - s0.nt) / 6,
    perFigureFromHide: (s0.nt - sHide.nt) / census0.figures,
    perFigureFromDispose: (s0.nt - sD.nt) / census0.figures,
  };
}

if (phase === 'heap') {
  await goSpawnA();
  const before = await figureCensus();
  await page.evaluate(([x, z]) => {
    const at = [[x - 2.2, z + 5], [x, z + 5], [x + 2.2, z + 5],
      [x - 2.2, z + 7.5], [x, z + 7.5], [x + 2.2, z + 7.5]];
    for (const [px, pz] of at) window.__NTANIM.spawn(px, pz, Math.PI);
  }, [SPAWN_A.x, SPAWN_A.z]);
  await page.waitForTimeout(1000);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('HeapProfiler.enable');
  const pts = [];
  const t0 = Date.now();
  for (const t of [30, 90, 150]) {
    while (Date.now() - t0 < t * 1000) await page.waitForTimeout(1000);
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(400);
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(400);
    const u = await cdp.send('Runtime.getHeapUsage');
    const fps = await page.evaluate(() => window.__NT.stats().fps);
    pts.push({ t, mb: +(u.usedSize / 1048576).toFixed(3), fps });
    console.log('[heap] t+' + t + 's', pts[pts.length - 1].mb, 'MB  fps', fps);
  }
  // least-squares slope over the three post-GC floors, MB per minute
  const n = pts.length;
  const mx = pts.reduce((a, p) => a + p.t, 0) / n;
  const my = pts.reduce((a, p) => a + p.mb, 0) / n;
  const num = pts.reduce((a, p) => a + (p.t - mx) * (p.mb - my), 0);
  const den = pts.reduce((a, p) => a + (p.t - mx) ** 2, 0);
  const slope = (num / den) * 60;
  report.heap = { figuresBefore: before.figures, points: pts, slopeMBPerMin: +slope.toFixed(3) };
  console.log('[heap] slope', slope.toFixed(3), 'MB/min');
}

if (phase === 'shots' || phase === 'mq') {
  // Park the game figures out of the way is not possible; instead pose two of
  // them (index 0 = faction A by round-robin, index 1 = faction B) at a clear
  // spot and photograph from three bearings in idle and walk.
  const D = 3.4;
  const PITCH = -0.10;
  // Pick an OPEN spot: the first staging point (-6, 2) put the subject inside a
  // coach and photographed its door. Probe the real collider set on a grid and
  // keep a point whose 4.2 m ring is clear, so all three bearings can stand off.
  const STAGE = await page.evaluate(() => {
    const clear = (x, z) => window.__NT.collidersAt(x, z, 1.0).length === 0;
    let best = null;
    for (let x = -16; x <= 12; x += 1) {
      for (let z = -30; z <= 30; z += 1) {
        if (!clear(x, z)) continue;
        let ok = true;
        for (let a = 0; a < 8 && ok; a++) {
          const t = (a / 8) * Math.PI * 2;
          for (const r of [1.5, 2.5, 3.4, 4.2]) {
            if (!clear(x + r * Math.sin(t), z + r * Math.cos(t))) { ok = false; break; }
          }
        }
        if (!ok) continue;
        const d = Math.hypot(x, z);
        if (!best || d < best.d) best = { x, z, d };
      }
    }
    return best || { x: -6, z: 2 };
  });
  console.log('[stage]', JSON.stringify(STAGE));
  const views = [
    { name: 'front', bearing: 0 },
    { name: 'side', bearing: Math.PI / 2 },
    { name: 'threequarter', bearing: Math.PI / 4 },
  ];
  const shots = [];
  for (const [fi, fname] of (phase === 'mq' ? [] : [[0, 'a'], [1, 'b']])) {
    for (const [speed, gait] of [[0, 'idle'], [1.3, 'walk']]) {
      await page.evaluate(([i, s]) => {
        window.__NTANIM.solo(i);
        window.__NTANIM.aim(i, 0, 0);
        window.__NTANIM.drive(i, s, false);
      }, [fi, speed]);
      for (const v of views) {
        await page.evaluate(([i, sx, sz, b, d, p]) => {
          window.__NTANIM.pin(i, sx, sz, 0);
          window.__NT.teleport(sx + d * Math.sin(b), 0, sz + d * Math.cos(b), b, p);
          if (window.__NT.release) window.__NT.release();
        }, [fi, STAGE.x, STAGE.z, v.bearing, D, PITCH]);
        await page.waitForTimeout(1100);
        const f = join(OUT, `f${fname}-${gait}-${v.name}.png`);
        writeFileSync(f, await page.screenshot({ type: 'png' }));
        shots.push(f);
        console.log('  shot', f);
      }
    }
  }
  await page.evaluate(() => { window.__NTANIM.unpin(); window.__NTANIM.showAll(); window.__NTANIM.drive(0, 0); window.__NTANIM.drive(1, 0); });

  // spawnA game frame with the bots as the game runs them
  await goSpawnA();
  await page.waitForTimeout(1200);
  const fa = join(OUT, 'game-spawnA.png');
  writeFileSync(fa, await page.screenshot({ type: 'png' }));
  shots.push(fa);

  // Mannequin vs operator in one shot. Find a real set-dressing mannequin from
  // the scene itself, stand a figure two metres from it, photograph both.
  const mq = await page.evaluate(() => {
    const scene = window.__V.scene;
    const g = scene.getObjectByName('mannequins');
    if (!g) return null;
    const pts = [];
    // No THREE constructor is reachable from the page, so apply matrixWorld by
    // hand: e[0..15] column-major, world = M * localTranslation.
    const applyW = (e, x, y, z) => [
      e[0] * x + e[4] * y + e[8] * z + e[12],
      e[1] * x + e[5] * y + e[9] * z + e[13],
      e[2] * x + e[6] * y + e[10] * z + e[14],
    ];
    g.updateWorldMatrix(true, true);
    g.traverse((o) => {
      if (o.isInstancedMesh) {
        const a = o.instanceMatrix.array;
        const e = o.matrixWorld.elements;
        for (let i = 0; i < o.count; i++) {
          const p = applyW(e, a[i * 16 + 12], a[i * 16 + 13], a[i * 16 + 14]);
          pts.push([+p[0].toFixed(2), +p[1].toFixed(2), +p[2].toFixed(2)]);
        }
      } else if (o.isMesh) {
        const e = o.matrixWorld.elements;
        pts.push([+e[12].toFixed(2), +e[13].toFixed(2), +e[14].toFixed(2)]);
      }
    });
    // cluster by 1 m so each mannequin is one entry, keep the tallest-standing ones
    const seen = new Map();
    for (const [x, y, z] of pts) {
      const k = Math.round(x) + '_' + Math.round(z);
      const e = seen.get(k) || { x, z, n: 0, maxY: 0 };
      e.n++; e.maxY = Math.max(e.maxY, y); seen.set(k, e);
    }
    return [...seen.values()].filter((e) => e.maxY > 1.3).sort((a, b) => b.n - a.n).slice(0, 8);
  });
  console.log('[mannequins]', JSON.stringify(mq));
  if (mq && mq.length) {
    const target = mq[0];
    // stand faction A beside it, camera 7 m back so both are inside 20 m
    await page.evaluate(([mx, mz]) => {
      window.__NTANIM.showAll();
      window.__NTANIM.drive(0, 0);
      window.__NTANIM.pin(0, mx + 1.6, mz, Math.PI);
      window.__NT.teleport(mx + 0.8, 0, mz + 7.0, 0, -0.06);
      if (window.__NT.release) window.__NT.release();
    }, [target.x, target.z]);
    await page.waitForTimeout(1300);
    const fm = join(OUT, 'mannequin-vs-operator.png');
    writeFileSync(fm, await page.screenshot({ type: 'png' }));
    shots.push(fm);
    // and a 20 m read of both factions side by side
    await page.evaluate(([mx, mz]) => {
      window.__NTANIM.pin(0, mx + 1.6, mz, Math.PI);
      window.__NTANIM.pin(1, mx + 3.4, mz, Math.PI);
      window.__NT.teleport(mx + 2.4, 0, mz + 20.0, 0, -0.03);
      if (window.__NT.release) window.__NT.release();
    }, [target.x, target.z]);
    await page.waitForTimeout(1300);
    const f20 = join(OUT, 'factions-at-20m.png');
    writeFileSync(f20, await page.screenshot({ type: 'png' }));
    shots.push(f20);
  }
  report.shots = shots;
  report.mannequins = mq;
}

if (phase === 'anim') {
  // Does the clip system still move THIS mesh? Sample a skinned vertex's world
  // position through the skeleton, not just the bone: if the bake were wrong the
  // bone could move and the surface not follow.
  const probe = async (label) => await page.evaluate(() => {
    const scene = window.__V.scene;
    const ops = [];
    scene.traverse((o) => { if (o.isSkinnedMesh) ops.push(o); });
    const m = ops[0];
    const b = m.skeleton.bones;
    const out = {};
    for (const n of ['Head', 'LeftHand', 'RightHand', 'Hips', 'LeftFoot']) {
      const bone = b.find((x) => x.name === n);
      if (bone) {
        const p = bone.getWorldPosition(new bone.position.constructor());
        out[n] = [+p.x.toFixed(4), +p.y.toFixed(4), +p.z.toFixed(4)];
      }
    }
    return out;
  });
  const dist = (a, b) => {
    let worst = 0; const per = {};
    for (const k of Object.keys(a)) {
      const d = Math.hypot(a[k][0] - b[k][0], a[k][1] - b[k][1], a[k][2] - b[k][2]);
      per[k] = +d.toFixed(4); worst = Math.max(worst, d);
    }
    return { worst: +worst.toFixed(4), per };
  };
  const STAGE = { x: -6.0, z: 2.0 };
  await page.evaluate(([sx, sz]) => {
    window.__NTANIM.solo(0);
    window.__NTANIM.pin(0, sx, sz, 0);
    window.__NTANIM.drive(0, 0, false);
    window.__NTANIM.aim(0, 0, 0);
    window.__NT.teleport(sx + 3.2 * Math.sin(Math.PI / 4), 0, sz + 3.2 * Math.cos(Math.PI / 4), Math.PI / 4, -0.10);
    if (window.__NT.release) window.__NT.release();
  }, [STAGE.x, STAGE.z]);
  await page.waitForTimeout(1500);
  const base = await probe('idle');
  writeFileSync(join(OUT, 'anim-idle.png'), await page.screenshot({ type: 'png' }));

  await page.evaluate(() => { window.__NTANIM.aim(0, 1, 0.15); });
  await page.waitForTimeout(1400);
  const aim = await probe('aim');
  writeFileSync(join(OUT, 'anim-aim-rifle.png'), await page.screenshot({ type: 'png' }));

  await page.evaluate(() => { window.__NTANIM.aim(0, 0, 0); window.__NTANIM.drive(0, 0, true); });
  await page.waitForTimeout(1600);
  const crouch = await probe('crouch');
  writeFileSync(join(OUT, 'anim-crouch-idle.png'), await page.screenshot({ type: 'png' }));

  await page.evaluate(() => { window.__NTANIM.drive(0, 0, false); });
  await page.waitForTimeout(1400);
  const deathOk = await page.evaluate(async () => await window.__NTANIM.external(0, 'death'));
  await page.waitForTimeout(1800);
  const death = await probe('death');
  writeFileSync(join(OUT, 'anim-death.png'), await page.screenshot({ type: 'png' }));
  const deathLate = await probe('death2');

  report.anim = {
    base, aim, crouch, death,
    aimDelta: dist(base, aim),
    crouchDelta: dist(base, crouch),
    deathDelta: dist(base, death),
    deathPlayed: deathOk,
    deathStillMoving: dist(death, deathLate),
  };
  console.log(JSON.stringify(report.anim, null, 1));
}

report.errors = errors.slice(0, 10);
report.distAfter = distStamp();
report.distStable = report.distAfter === distBefore;
writeFileSync(join(OUT, `report-${phase}.json`), JSON.stringify(report, null, 2));
console.log('[verify] dist stable across run:', report.distStable, '| console errors:', errors.length);
if (errors.length) console.log('  ' + errors.slice(0, 5).join('\n  '));

await browser.close();
killTree(chrome.pid);
