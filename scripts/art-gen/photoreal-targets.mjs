/**
 * photoreal-targets.mjs - capture OUR frames as the sources for the photoreal
 * target loop (docs/reference/targets/), and orchestrate the two generation routes.
 *
 * The owner's brief (2026-09-19 06:30): photograph our own world, have an image model
 * re-render each frame photoreal (same camera, same geometry, real materials and
 * light), and use those as comparison targets for the visual gauntlets. This script
 * owns the CAPTURE half and the orchestration; the ComfyUI graph client, the fidelity
 * gate and the measurements live in photoreal-targets.py beside it.
 *
 *   node scripts/art-gen/photoreal-targets.mjs capture [--no-build] [--out <dir>]
 *
 * What the capture does, and why each step is the way it is:
 *
 *   - Builds ONCE (unless --no-build) and records the bundle hash from
 *     dist/index.html's asset name + sha256 of that file. Six sibling lanes rebuild
 *     dist/ constantly, so every frame in a set must come from ONE bundle. The page
 *     reports which asset it actually loaded; if the two page loads in a run see
 *     different assets, the whole set is re-captured (up to 3 attempts).
 *   - Real Chrome over CDP, the launch block of scripts/playcap.mjs verbatim
 *     (playwright's bundled chromium has no WebGPU adapter and would photograph the
 *     WebGL2 fallback with the post chain OFF). windowsHide, spawnGuarded, one browser.
 *   - Math.random is SEEDED before any page script runs (mulberry32, fixed seed):
 *     core/materials.ts paints 43 random canvas textures per load and two loads of
 *     the same build otherwise differ on 15-21% of pixels.
 *   - Station set (10): overlay REMOVED, never clicked, so no match starts and no bot
 *     walks into frame; __NT.goto(name) holds the camera and hides the viewmodel;
 *     one __NT.render() through the post chain, then a whole-page screenshot.
 *   - Playcap set (4): a fresh page load, the overlay CLICKED as a person would, the
 *     HUD hidden by CSS, __NT.teleport + release so the REAL frame loop renders from
 *     the four playcap positions with the viewmodel shown.
 *   - Every PNG gets a sha256 and a manifest row (station, pose, bundle, seed, luma).
 *
 * Boundaries: never touches :4190 (owner's frozen build) or :4173 (owner's preview);
 * uses the shared :4188 via scripts/lib/preview.mjs. Nothing here writes to src/ or
 * public/. Sources are OUR frames; nothing from the reference game is read or copied.
 */
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import net from 'node:net';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { usePreview } from '../lib/preview.mjs';
import { spawnGuarded, killTree } from '../lib/proc-guard.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const cmd = argv[0] || '';   // no default: `capture` builds, and a build must be asked for
function opt(name, dflt) {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : dflt;
}
const flag = (name) => argv.includes('--' + name);

const OUT = resolve(opt('out', join(ROOT, 'docs', 'reference', 'targets')));
const SRC_DIR = join(OUT, 'sources');
const SEED = Number(opt('seed', 0x9e3779b9));
const W = 1600, H = 900;

/** Eye-height player positions - copied from scripts/playcap.mjs (never edited there). */
const PLAYCAP_POSITIONS = [
  { name: 'spawnA', x: -4.0, z: -34.3, yaw: Math.PI },
  { name: 'circle', x: -6.0, z: 0.0, yaw: -Math.PI / 2 },
  { name: 'spawnB', x: 1.2, z: 34.3, yaw: 0 },
  { name: 'orangeInside', x: 0.8, z: -20.5, yaw: Math.PI },
];

// ------------------------------------------------------------------ helpers ---
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const sha256File = (p) => sha256(readFileSync(p));

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

/** The bundle currently in dist/: asset file name + sha256 (12 hex) of it. */
function bundleOnDisk() {
  const idx = join(ROOT, 'dist', 'index.html');
  if (!existsSync(idx)) return null;
  const html = readFileSync(idx, 'utf8');
  const m = html.match(/assets\/(index-[A-Za-z0-9_-]+\.js)/);
  if (!m) return null;
  const file = join(ROOT, 'dist', 'assets', m[1]);
  if (!existsSync(file)) return { asset: m[1], sha256: null };
  return { asset: m[1], sha256: sha256File(file).slice(0, 12) };
}

function gitRev() {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8', windowsHide: true }).trim();
  } catch { return 'unknown'; }
}

/** Run `npm run build` once, guarded, hidden, with a hard timeout. */
function buildOnce(timeoutMs = 300000) {
  return new Promise((res, rej) => {
    const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const t0 = Date.now();
    const child = spawnGuarded(npm, ['run', 'build'], {
      cwd: ROOT, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { killTree(child.pid); rej(new Error('build exceeded ' + timeoutMs + ' ms')); }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) res({ seconds: +((Date.now() - t0) / 1000).toFixed(1), tail: out.slice(-600) });
      else rej(new Error('build exit ' + code + '\n' + out.slice(-2000)));
    });
  });
}

/** Mean 8-bit luma of a PNG buffer, decoded by the page itself (no image lib needed). */
async function meanLuma(page, shot) {
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 200; c.height = 112;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 200, 112);
    const d = g.getImageData(0, 0, 200, 112).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (d.length / 4);
  }, shot.toString('base64'));
}

/** Which asset the PAGE loaded (not what is on disk now - siblings rebuild under us). */
const loadedAsset = (page) => page.evaluate(() => {
  const s = [...document.querySelectorAll('script[src]')].map((e) => e.getAttribute('src'));
  const m = s.map((x) => (x.match(/index-[A-Za-z0-9_-]+\.js/) || [])[0]).filter(Boolean);
  return m[0] || null;
});

const seedScript = (seed) => `
  (() => { let a = ${seed >>> 0};
    Math.random = () => { a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();`;

// ------------------------------------------------------------------ capture ---
async function capture() {
  mkdirSync(SRC_DIR, { recursive: true });
  const rev = gitRev();

  let build = null;
  if (!flag('no-build')) {
    console.log('[targets] npm run build (once) ...');
    build = await buildOnce();
    console.log(`[targets] built in ${build.seconds}s`);
  }
  const bundle0 = bundleOnDisk();
  if (!bundle0) throw new Error('dist/index.html has no index-*.js asset - build first');
  console.log(`[targets] bundle on disk: ${bundle0.asset} sha256:${bundle0.sha256}  git ${rev}`);

  const { url: base } = await usePreview();
  const url = base;

  const exe = chromePath();
  if (!exe) throw new Error('no Chrome found; this harness needs a real WebGPU adapter');

  for (let attempt = 1; attempt <= 3; attempt++) {
    const r = await captureOnce(exe, url, bundle0, rev, attempt);
    if (r.ok) return r;
    console.warn(`[targets] attempt ${attempt}: bundle changed mid-run (${r.reason}); re-capturing the whole set`);
  }
  throw new Error('bundle kept changing under us across 3 attempts; wait for the sibling lanes to settle');
}

async function captureOnce(exe, url, bundle0, rev, attempt) {
  const cdpPort = await freePort();
  const chrome = spawnGuarded(exe, [
    '--headless=new', '--remote-debugging-port=' + cdpPort,
    '--user-data-dir=' + join(tmpdir(), 'aa-targets-' + cdpPort),
    '--no-first-run', '--no-default-browser-check',
    '--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer',
    '--ignore-gpu-blocklist', '--enable-gpu-rasterization',
    '--window-position=2560,0', '--window-size=1600,900', 'about:blank',
  ], { stdio: 'ignore', windowsHide: true });

  let browser = null;
  for (let i = 0; i < 160 && !browser; i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:' + cdpPort); }
    catch { await new Promise((r) => setTimeout(r, 250)); }
  }
  if (!browser) { killTree(chrome.pid); throw new Error('Chrome never accepted CDP'); }

  const rows = [];
  const errors = [];
  let ok = true, reason = '';
  try {
    const ctx = browser.contexts()[0] ?? await browser.newContext();
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.setViewportSize({ width: W, height: H });
    await page.addInitScript(seedScript(SEED));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
    page.on('pageerror', (e) => errors.push('PAGEERROR ' + String(e).slice(0, 300)));

    // ---- station set: clean frames, no match, viewmodel hidden by goto()
    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
    const assetA = await loadedAsset(page);
    if (assetA !== bundle0.asset) { ok = false; reason = `station load saw ${assetA}, expected ${bundle0.asset}`; }
    await page.evaluate(() => {
      const el = document.getElementById('start'); if (el) el.remove();
      const hud = document.getElementById('hud'); if (hud) hud.style.display = 'none';
      const ch = document.getElementById('crosshair'); if (ch) ch.style.display = 'none';
    });
    await page.waitForTimeout(1500);
    const stations = await page.evaluate(() => window.__NT.stations);
    for (const name of Object.keys(stations)) {
      const went = await page.evaluate((n) => window.__NT.goto(n), name);
      if (!went) { console.warn('[targets] goto failed: ' + name); continue; }
      await page.waitForTimeout(300);
      const stats = await page.evaluate(() => {
        const before = window.__NT.stats(); window.__NT.render(); const after = window.__NT.stats();
        return { calls: after.calls - before.calls, renders: after.renderCallsTotal - before.renderCallsTotal };
      });
      const shot = await page.screenshot({ type: 'png' });
      const file = `station-${name}.png`;
      writeFileSync(join(SRC_DIR, file), shot);
      const luma = await meanLuma(page, shot);
      const s = stations[name];
      rows.push({
        id: `station-${name}`, set: 'station', file: `sources/${file}`, sha256: sha256(shot),
        pose: { pos: s.pos, yaw: s.yaw, pitch: s.pitch, fov: s.fov ?? 72 }, viewmodel: false,
        ref: s.ref, meanLuma: +luma.toFixed(1), drawCalls: stats.calls, renders: stats.renders,
      });
      console.log(`  station ${name.padEnd(16)} luma ${luma.toFixed(1).padStart(6)}  calls ${stats.calls}`);
    }

    // ---- playcap set: the REAL loop, overlay clicked, viewmodel shown
    await page.goto(url, { waitUntil: 'load', timeout: 90000 });
    await page.waitForFunction(() => window.__NT && window.__NT.ready === true, null, { timeout: 180000 });
    const assetB = await loadedAsset(page);
    if (assetB !== bundle0.asset) { ok = false; reason = `playcap load saw ${assetB}, expected ${bundle0.asset}`; }
    await page.evaluate(() => { const o = document.getElementById('start'); if (o) o.click(); });
    await page.waitForTimeout(1500);
    await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });
    for (const p of PLAYCAP_POSITIONS) {
      await page.evaluate(([x, z, yaw]) => {
        window.__NT.teleport(x, 0, z, yaw, 0);
        if (window.__NT.release) window.__NT.release();
      }, [p.x, p.z, p.yaw]);
      await page.waitForTimeout(900);
      const shot = await page.screenshot({ type: 'png' });
      const file = `playcap-${p.name}.png`;
      writeFileSync(join(SRC_DIR, file), shot);
      const luma = await meanLuma(page, shot);
      const stats = await page.evaluate(() => { try { return window.__NT.stats(); } catch { return {}; } });
      rows.push({
        id: `playcap-${p.name}`, set: 'playcap', file: `sources/${file}`, sha256: sha256(shot),
        pose: { pos: [p.x, 0, p.z], yaw: p.yaw, pitch: 0, fov: null }, viewmodel: true,
        ref: null, meanLuma: +luma.toFixed(1), drawCalls: stats.calls ?? null, renders: null,
      });
      console.log(`  playcap ${p.name.padEnd(16)} luma ${luma.toFixed(1).padStart(6)}  calls ${stats.calls ?? '?'}`);
    }
  } finally {
    try { await browser.close(); } catch { /* already gone */ }
    killTree(chrome.pid);
  }

  const bundle1 = bundleOnDisk();
  const manifest = {
    capturedAt: new Date().toISOString(), attempt, gitRev: rev,
    bundle: bundle0, bundleOnDiskAtEnd: bundle1,
    bundleChangedOnDiskDuringRun: !bundle1 || bundle1.asset !== bundle0.asset,
    url, viewport: `${W}x${H}`, renderer: 'real Chrome over CDP, WebGPU, post chain (default route)',
    mathRandomSeed: SEED, seededHow: 'page.addInitScript mulberry32 before any page script',
    frames: rows, consoleErrors: errors.slice(0, 20),
  };
  writeFileSync(join(SRC_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2));
  if (manifest.bundleChangedOnDiskDuringRun) {
    console.warn(`[targets] NOTE: dist/ changed on disk during the run (${bundle1?.asset}); the PAGE loaded ${bundle0.asset} for both sets, so the set is still one bundle.`);
  }
  console.log(`[targets] ${rows.length} sources -> ${SRC_DIR}  (bundle ${bundle0.asset} ${bundle0.sha256})`);
  if (errors.length) console.log('[targets] console errors:\n  ' + errors.slice(0, 6).join('\n  '));
  return { ok, reason, manifest };
}

// ------------------------------------------------------------ route A: agy ---
// The owner's route: "ask Claude or Gemini through the antigravity CLI bridge to make
// it look photoreal". Probed 2026-09-19 07:00-07:09 on station-turningHead:
//   attempt 1 (prompt only named the file): agy called generate_image WITHOUT the source
//     as input -> a 1024x1024 re-composition with invented foreground objects; gate
//     FAILED (aspect changed, edge overlap 0.439, 4 moved blocks).
//   attempt 2 (prompt tells it to pass the file as ImagePaths, AspectRatio 16:9): agy's
//     generate_image accepts `ImagePaths` (edit/reference images) and `AspectRatio`
//     ('16:9' supported) -> 1376x768, edge overlap 0.805, SSIM 0.722, 0 moved blocks.
// So the prompt below is explicit about the tool call. One frame per agy invocation, its
// own working directory (agy reads/writes the cwd), a hard --print-timeout AND a kill
// timer, the verbatim stdout kept beside the output, and the fidelity gate run on every
// result before it is accepted. The tool exposes no seed: provenance records that.
const AGY_MODEL = opt('agy-model', 'gemini-3.1-pro-high');
const AGY_TIMEOUT_S = Number(opt('agy-timeout', 600));
const SCRATCH = opt('scratch', join(tmpdir(), 'aa-photoreal-targets'));
const VARIANTS = {
  golden: 'Change the light to golden hour: low warm sun raking in from the west, long soft-edged shadows, warm amber highlights on every sunlit face, cool blue-violet shade, glowing backlit haze.',
  overcast: 'Change the weather to overcast with light rain: high flat grey sky, soft shadowless light, wet dark asphalt with mirror-like puddle reflections, saturated damp surfaces, water beading on paint and glass, drizzle haze softening the distance.',
};

function agyPrompt(variant, sourceAbs) {
  // Inline, not "read PROMPT.txt": on one run the agent went off to *search* for the
  // file, idled, and exited after 75 s with no image. The absolute paths remove the
  // only two things it would otherwise have to discover.
  return [
    `The file ${sourceAbs} (1600x900, 16:9) is a frame rendered by our own browser game engine.`,
    '',
    'Call your `generate_image` tool EXACTLY ONCE with these arguments:',
    `  ImagePaths: ["${sourceAbs}"]`,
    "  AspectRatio: '16:9'",
    "  ImageName: 'target'",
    '  Prompt: "Re-render this exact frame as a real photograph. Keep the same camera, the same composition, the same geometry and every object exactly where it is; add nothing, remove nothing, do not move the camera. Make it hyper-realistic and photorealistic: real-world materials (weathered asphalt with aggregate, cracked concrete kerbs and paving, painted stucco with subtle grime and edge wear, real glass reflecting the sky, painted metal with chrome trim and micro-scratches, dense leafy trees, lawn with individual grass blades), physically correct hard sunlight and blue sky light, soft contact shadows and ambient occlusion under every object, subtle volumetric haze and aerial perspective, natural film response with fine grain and gentle highlight roll-off. No text, no logos, no HUD, no watermark.'
      + (variant ? ' ' + VARIANTS[variant] : '') + '"',
    '',
    `The output MUST be saved as ${sourceAbs.replace(/source\.png$/, 'target.png')} (move or copy it there if the tool saves elsewhere). Do not describe the scene in words to the tool; the image itself is the input. Do not read or search for any other file. Do not edit source.png. Do not generate more than one image.`,
    'When done, print exactly: DONE target.png <the image model the tool reported, if any>',
    'If the tool call fails, print exactly: FAILED <the error text verbatim> and stop.',
  ].join('\n');
}

function runAgy(cwd, prompt) {
  return new Promise((res) => {
    const t0 = Date.now();
    const child = spawnGuarded('agy', [
      '--print', prompt, '--model', AGY_MODEL, '--effort', 'high',
      '--dangerously-skip-permissions', '--print-timeout', AGY_TIMEOUT_S + 's',
    ], { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    // shell:false on purpose: agy is agy.exe, and through cmd.exe the prompt's spaces split
    // it into positional arguments ("Prompts are read only from -p/--print ...", 0.1 s, no image).
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => { killTree(child.pid); out += '\n[targets] KILLED after ' + (AGY_TIMEOUT_S + 60) + 's wall clock'; }, (AGY_TIMEOUT_S + 60) * 1000);
    child.on('exit', (code) => { clearTimeout(timer); res({ code, out, seconds: +((Date.now() - t0) / 1000).toFixed(1) }); });
  });
}

function gate(src, tgt) {
  const r = execFileSync('python', [join(ROOT, 'scripts', 'art-gen', 'photoreal-targets.py'), 'fidelity', `${src}=${tgt}`],
    { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  const j = JSON.parse(r);
  return j[Object.keys(j)[0]];
}

async function routeA() {
  const man = JSON.parse(readFileSync(join(SRC_DIR, 'manifest.json'), 'utf8'));
  const outDir = join(OUT, 'targets');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(SCRATCH, { recursive: true });
  const variantStations = (opt('variant-stations', 'turningHead,spawnA,interiorOrange')).split(',').filter(Boolean);
  const only = (opt('only', '')).split(',').filter(Boolean);
  const jobs = [];
  for (const fr of man.frames) {
    jobs.push({ id: fr.id, src: join(OUT, fr.file), srcSha: fr.sha256, variant: null });
    const station = fr.id.split('-').slice(1).join('-');
    if (fr.set === 'station' && variantStations.includes(station)) {
      for (const v of Object.keys(VARIANTS)) jobs.push({ id: `${fr.id}-${v}`, src: join(OUT, fr.file), srcSha: fr.sha256, variant: v });
    }
  }
  const todo = only.length ? jobs.filter((j) => only.includes(j.id)) : jobs;
  const summary = [];
  for (const job of todo) {
    const outPng = join(outDir, job.id + '.png');
    const metaPath = join(outDir, job.id + '.json');
    if (existsSync(metaPath) && !flag('force')) {
      const m = JSON.parse(readFileSync(metaPath, 'utf8'));
      if (m.fidelity?.pass) { console.log(`[targets] keep ${job.id} (${m.route}, passed)`); continue; }
    }
    let accepted = null;
    for (let attempt = 1; attempt <= 2 && !accepted; attempt++) {
      const work = join(SCRATCH, `${job.id}-a${attempt}`);
      mkdirSync(work, { recursive: true });
      copyFileSync(job.src, join(work, 'source.png'));
      const prompt = agyPrompt(job.variant, join(work, 'source.png').replace(/\\/g, '/'));
      writeFileSync(join(work, 'PROMPT.txt'), prompt);   // the record; the prompt itself goes inline
      console.log(`[targets] agy ${job.id} attempt ${attempt} ...`);
      const r = await runAgy(work, prompt);
      writeFileSync(join(work, 'agy.log'), r.out + `\nAGY-PROCESS-EXIT ${r.code}\n`);
      const produced = join(work, 'target.png');
      const record = {
        id: job.id, attempt, agyExit: r.code, seconds: r.seconds,
        stdoutTail: r.out.trim().split(/\r?\n/).slice(-6).join('\n'),
      };
      if (!existsSync(produced)) {
        record.result = 'no target.png';
        console.log(`  no image (${r.seconds}s): ${record.stdoutTail.split('\n').pop()}`);
        summary.push(record);
        continue;
      }
      const fid = gate(job.src, produced);
      record.fidelity = fid;
      console.log(`  gate: overlap ${fid.edgeOverlap} ssim ${fid.ssim} moved ${fid.movedBlocks.length} size ${fid.targetSize.join('x')} -> ${fid.pass ? 'PASS' : 'REJECT ' + fid.reason}`);
      if (!fid.pass) { record.result = 'rejected'; summary.push(record); continue; }
      // resize back to the source size so every pair is pixel-aligned for measurement
      execFileSync('python', ['-c',
        'import sys;from PIL import Image;a=Image.open(sys.argv[1]).convert("RGB");a.resize((1600,900),Image.LANCZOS).save(sys.argv[2],"PNG")',
        produced, outPng], { windowsHide: true, timeout: 60000 });
      const reported = (r.out.match(/DONE target\.png\s*(.*)/) || [])[1]?.trim() || '';
      const meta = {
        file: `targets/${job.id}.png`, source: `sources/${job.id.replace(/-(golden|overcast)$/, '')}.png`,
        sourceSha256: job.srcSha, sha256: sha256File(outPng),
        route: 'A:agy-generate_image', model: `agy --model ${AGY_MODEL} -> generate_image (ImagePaths=[source], AspectRatio 16:9); image model as reported by the agent: ${reported || 'not reported'}`,
        prompt: prompt, variant: job.variant, seed: null, seedNote: 'generate_image exposes no seed; not reproducible bit-for-bit',
        strength: null, steps: null, generatedSize: fid.targetSize, resizedTo: [1600, 900], resample: 'LANCZOS',
        seconds: r.seconds, attempt, agyLog: join(work, 'agy.log'), fidelity: { ...fid, gatedAt: 'generated size' },
        date: new Date().toISOString(),
      };
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));
      record.result = 'accepted';
      summary.push(record);
      accepted = meta;
    }
    if (!accepted) console.log(`[targets] ${job.id}: route A did not yield an accepted image; leave for route B`);
    writeFileSync(join(outDir, '_route-a-log.json'), JSON.stringify(summary, null, 2));
  }
  console.log(`[targets] route A done: ${summary.filter((s) => s.result === 'accepted').length} accepted of ${todo.length} jobs`);
}

// ------------------------------------------------------------------- main ---
if (cmd === 'capture') {
  await capture();
} else if (cmd === 'route-a') {
  await routeA();
} else {
  console.error('usage: node scripts/art-gen/photoreal-targets.mjs capture [--no-build] [--out <dir>] [--seed <n>]');
  console.error('       node scripts/art-gen/photoreal-targets.mjs route-a [--only id,id] [--variant-stations a,b] [--agy-model m] [--agy-timeout s] [--force]');
  console.error('route B (local ComfyUI), fidelity and measurement live in scripts/art-gen/photoreal-targets.py');
  process.exit(2);
}
