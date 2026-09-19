/**
 * Bounded in-game gait capture for the animation lane.
 *
 * The harness is intentionally authored but not run by the source lane. An
 * operator starts the already-running candidate explicitly:
 *
 *   node scripts/_capture-gait-poses.mjs
 *   RECOVERY_URL=http://127.0.0.1:4192/ node scripts/_capture-gait-poses.mjs
 *
 * It goes through the real menu and Deploy route, uses the existing
 * `__NTANIM` drive/pin/surface API, and lets the game's own requestAnimationFrame
 * loop render each frame. Each of five states is photographed from the same
 * fixed front and side cameras: ten PNGs maximum, with no generated pose or
 * synthetic renderer involved.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stockBrowser } from './lib/stock-browser.mjs';

const CANDIDATE = process.env.RECOVERY_URL || 'http://127.0.0.1:4192/';
const OUT = join(process.cwd(), 'captures', 'gait-poses');
const MAX_FRAMES = 10;
const CALL_BUDGET = 1200;
const TRIANGLE_BUDGET = 900_000;

// The subject stays on one clear stage. The camera positions and rotations are
// identical for every state, so a later visual comparison is about gait rather
// than framing. The character faces +Z; front is therefore the +Z camera.
const VIEWS = [
  { id: 'front', dx: 0, dz: 3.8, yaw: 0, pitch: -0.06 },
  { id: 'side', dx: 3.8, dz: 0, yaw: Math.PI / 2, pitch: -0.06 },
];
const STATES = [
  { id: 'stand-idle', speed: 0, crouch: false, prone: false, sprinting: false, expected: 'idle' },
  { id: 'jog', speed: 4.8, crouch: false, prone: false, sprinting: false, expected: 'run' },
  { id: 'sprint', speed: 6.6, crouch: false, prone: false, sprinting: true, expected: 'sprint' },
  { id: 'crouch', speed: 2.75, crouch: true, prone: false, sprinting: false, expected: 'crouch-walk' },
  { id: 'prone', speed: 1.25, crouch: false, prone: true, sprinting: false, expected: 'prone-crawl' },
];

mkdirSync(OUT, { recursive: true });
const result = {
  candidate: CANDIDATE,
  route: 'real menu -> Play solo -> Deploy -> game rAF loop',
  fixedViews: VIEWS,
  states: STATES,
  limits: { maxFrames: MAX_FRAMES, calls: CALL_BUDGET, triangles: TRIANGLE_BUDGET },
  frames: [],
  checks: [],
  errors: [],
};
const check = (name, pass, value) => result.checks.push({ name, pass, value });

let owned = null;
try {
  owned = await stockBrowser('gait-poses');
  const { page } = owned;
  page.on('pageerror', error => result.errors.push('PAGEERROR ' + String(error).slice(0, 400)));
  page.on('console', message => {
    if (message.type() === 'error') result.errors.push('CONSOLE ' + message.text().slice(0, 400));
  });

  await page.goto(CANDIDATE, { waitUntil: 'load', timeout: 90_000 });
  await page.waitForFunction(() => window.__NT?.ready === true, null, { timeout: 90_000 });
  await page.getByRole('button', { name: 'Play solo', exact: true }).click();
  await page.getByRole('button', { name: /deploy/i }).click();
  await page.waitForFunction(() => {
    try {
      const phase = window.__NTGAME?.snapshot?.().match?.phase;
      return phase === 'active' && window.__NTANIM?.ready === true;
    } catch { return false; }
  }, null, { timeout: 45_000 });
  await page.addStyleTag({ content: '#hud,#crosshair{display:none !important}' });

  const stage = await page.evaluate(() => {
    const busy = (x, z) => {
      let count = 0;
      for (const y of [0.4, 1.0, 1.7]) count += window.__NT.collidersAt(x, z, y).length;
      return count;
    };
    let best = null;
    for (let x = -14; x <= 10; x += 2) {
      for (let z = -12; z <= 12; z += 2) {
        let score = busy(x, z) * 8;
        for (let a = 0; a < 8; a++) score += busy(x + Math.cos(a) * 1.3, z + Math.sin(a) * 1.3) * 2;
        for (const [dx, dz] of [[0, 3.8], [3.8, 0], [1.9, 1.9]]) {
          score += busy(x + dx, z + dz) * 3;
          score += busy(x + dx * 0.5, z + dz * 0.5) * 4;
        }
        if (!best || score < best.score) best = { x, z, score };
      }
    }
    return best;
  });
  if (!stage) throw new Error('could not choose a clear gait stage');
  result.stage = stage;

  const subject = await page.evaluate(([s]) => {
    const count = window.__NTANIM.count();
    const index = window.__NTANIM.spawn(s.x, s.z, 0, 0) - 1;
    if (index < count) throw new Error('spawn did not append a new animation subject');
    if (!window.__NTANIM.solo(index)) throw new Error('could not solo gait subject');
    if (!window.__NTANIM.pin(index, s.x, s.z, 0)) throw new Error('could not pin gait subject');
    return { index, countBefore: count, countAfter: window.__NTANIM.count() };
  }, [stage]);
  result.subject = subject;

  for (const state of STATES) {
    const armed = await page.evaluate(([i, s, state]) => {
      // Fifth argument is the optional gameplay-owned sprint flag added by the
      // gait pass. Older callers can still omit it; this capture needs it to
      // distinguish the 4.8 m/s jog from the 6.6 m/s sprint.
      const ok = window.__NTANIM.drive(i, state.speed, state.crouch, state.prone, state.sprinting);
      if (!ok) throw new Error('drive rejected ' + state.id);
      window.__NTANIM.pin(i, s.x, s.z, 0);
      return { list: window.__NTANIM.list()[i], surface: window.__NTANIM.surface(i) };
    }, [subject.index, stage, state]);
    await page.waitForTimeout(650);
    const live = await page.evaluate(i => ({
      list: window.__NTANIM.list()[i],
      surface: window.__NTANIM.surface(i),
      ticks: window.__NTANIM.ticks(),
      stats: window.__NT.stats(),
    }), subject.index);
    const stateMismatch = live.list?.loco !== state.expected;
    if (stateMismatch) result.errors.push(`${state.id}: expected ${state.expected}, got ${live.list?.loco}`);

    for (const view of VIEWS) {
      if (result.frames.length >= MAX_FRAMES) throw new Error(`frame limit ${MAX_FRAMES} exceeded`);
      await page.evaluate(([s, v]) => {
        window.__NT.setMode('walk');
        window.__NT.teleport(s.x + v.dx, 0, s.z + v.dz, v.yaw, v.pitch);
        if (window.__NT.release) window.__NT.release();
        // release() restores the viewmodel; hide only that overlay so the
        // saved pixels show the full character body from the fixed camera.
        try { window.__NT.weaponCmd('visible', false); } catch { /* optional */ }
      }, [stage, view]);
      await page.waitForTimeout(450);
      const file = join(OUT, `${String(result.frames.length + 1).padStart(2, '0')}-${state.id}-${view.id}.png`);
      await page.screenshot({ path: file });
      const frame = await page.evaluate(([i, s, state, view]) => {
        const stats = window.__NT.stats();
        const row = window.__NTANIM.list()[i];
        const surface = window.__NTANIM.surface(i);
        return {
          name: `${state.id}-${view.id}`,
          state: state.id,
          view: view.id,
          expectedLocomotion: state.expected,
          actualLocomotion: row?.loco ?? null,
          speed: row?.speed ?? null,
          surface,
          stats: {
            fps: stats.fps ?? null,
            calls: stats.calls ?? null,
            triangles: stats.triangles ?? null,
            renderCallsTotal: stats.renderCallsTotal ?? null,
            geometries: stats.geometries ?? null,
            textures: stats.textures ?? null,
          },
          stage: { x: s.x, z: s.z },
        };
      }, [subject.index, stage, state, view]);
      frame.file = file;
      frame.budgetOk = Number.isFinite(frame.stats.calls) && Number.isFinite(frame.stats.triangles)
        && frame.stats.calls > 2 && frame.stats.triangles > 2 && frame.stats.renderCallsTotal > 0
        && frame.stats.calls <= CALL_BUDGET && frame.stats.triangles <= TRIANGLE_BUDGET;
      frame.locomotionOk = frame.actualLocomotion === frame.expectedLocomotion;
      result.frames.push(frame);
      console.log(`[gait] ${frame.budgetOk && frame.locomotionOk ? 'PASS' : 'OPEN'} ${frame.name}`
        + ` ${frame.actualLocomotion} ${frame.stats.calls} calls/${frame.stats.triangles} tris`);
    }
  }

  check('real menu and Deploy path completed', true, result.route);
  check('bounded capture count', result.frames.length === MAX_FRAMES, result.frames.length);
  check('fixed front and side views for every state', result.frames.length === STATES.length * VIEWS.length,
    result.frames.map(frame => frame.name));
  check('expected gait selected for every state', result.frames.every(frame => frame.locomotionOk),
    result.frames.map(frame => ({ name: frame.name, expected: frame.expectedLocomotion, actual: frame.actualLocomotion })));
  check('renderer budgets respected', result.frames.every(frame => frame.budgetOk),
    result.frames.map(frame => ({ name: frame.name, calls: frame.stats.calls, triangles: frame.stats.triangles })));
  check('no page or console errors', result.errors.length === 0, result.errors);
} catch (error) {
  result.fatal = String(error);
  console.error('[gait] FATAL ' + result.fatal);
} finally {
  result.finishedAt = new Date().toISOString();
  result.pass = !result.fatal && result.errors.length === 0
    && result.frames.length === MAX_FRAMES
    && result.frames.every(frame => frame.budgetOk && frame.locomotionOk)
    && result.checks.every(entry => entry.pass);
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 2) + '\n', 'utf8');
  if (owned) await owned.close();
}

console.log(JSON.stringify({
  pass: result.pass,
  frames: result.frames.length,
  checks: result.checks,
  fatal: result.fatal,
}, null, 2));
if (!result.pass) process.exitCode = 1;
