/** Six-second actual game-loop review. Headless owned profile; no desktop input.
 * Recording is a presentation canary, never an animation asset or WAN proof. */
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { stockBrowser } from './lib/stock-browser.mjs';
import { waitForRenderedPage } from './lib/render-ready.mjs';

const url = 'http://127.0.0.1:4362/';
const out = 'captures/polish-motion-video-20260927';
mkdirSync(out, { recursive: true });
const report = { url, sourceCommit: null, kind: 'actual first-person movement/fire/reload/ADS presentation; not generated skeletal motion', samples: [], errors: [], status: 'OPEN' };
const owned = await stockBrowser('polish-motion');
let context, page;
try {
  context = await owned.browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } });
  page = await context.newPage();
  page.on('pageerror', e => report.errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load', timeout: 90000 });
  await waitForRenderedPage(page, 180000);
  report.sourceCommit = await page.evaluate(async () => (await (await fetch('preview-identity.json')).json()).sourceCommit);
  await page.getByRole('button', { name: 'Play solo', exact: true }).click();
  await page.getByLabel('Bots', { exact: true }).evaluate(el => { el.value = el.min; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.getByRole('radio', { name: 'Recruit', exact: true }).click();
  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  await page.waitForFunction(() => window.__NTGAME?.snapshot().match.phase === 'active', null, { timeout: 30000 });
  await page.evaluate(() => window.__NT.teleport(-6, 0, 0, -Math.PI / 2));
  await page.waitForTimeout(1000);
  await page.screenshot({ path: out + '/before.png', timeout: 15000 });
  const began = Date.now();
  await page.evaluate(() => {
    window.__polishTimeline = [];
    const key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
    key('keydown', 'KeyW'); key('keydown', 'ShiftLeft');
    const event = (delay, name, action) => setTimeout(() => { const result = action(); window.__polishTimeline.push({ at: performance.now(), name, result }); }, delay);
    event(850, 'sprint stop', () => { key('keyup', 'KeyW'); key('keyup', 'ShiftLeft'); });
    event(1200, 'jump', () => {
      key('keydown', 'Space');
      requestAnimationFrame(() => requestAnimationFrame(() => key('keyup', 'Space')));
    });
    event(2000, 'fire', () => window.__NT.weaponCmd('fire'));
    event(2500, 'reload', () => window.__NT.weaponCmd('reload'));
    event(4800, 'ADS', () => window.__NT.weaponCmd('ads', true));
    event(5900, 'ADS release', () => window.__NT.weaponCmd('ads', false));
  });
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(200);
    report.samples.push(await page.evaluate(() => ({ at: performance.now(), stats: window.__NT.stats(), state: window.__NT.weaponCmd('state'), pose: window.__NT.playerPose?.() })));
  }
  report.elapsedMs = Date.now() - began;
  assert(report.elapsedMs >= 6000 && report.elapsedMs <= 8000, 'bounded real-time6–8seconds, never virtual clock');
  for (let i = 1; i < report.samples.length; i++) {
    assert(report.samples[i].at > report.samples[i-1].at, 'timestamps strictly advance');
    assert(report.samples[i].stats.renderCallsTotal > report.samples[i-1].stats.renderCallsTotal, 'actual rendered loop advances');
  }
  report.timeline = await page.evaluate(() => window.__polishTimeline);
  assert(Math.max(...report.samples.map(s => s.pose.y)) > report.samples[0].pose.y + 0.1, 'actual jump rises above the starting floor');
  assert(Math.abs(report.samples.at(-1).pose.y - report.samples[0].pose.y) < 0.1, 'actual jump returns to the floor');
  for (const name of ['fire', 'reload']) assert.equal(report.timeline.find(e => e.name === name)?.result, true, `${name} admitted by the weapon controller`);
  assert.equal(report.errors.length, 0, 'no browser errors');
  const video = page.video();
  await context.close(); context = null;
  const actionThroughCloseSeconds = (Date.now() - began) / 1000;
  const raw = out + '/full-session.webm';
  renameSync(await video.path(), raw);
  const metadata = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', raw], { encoding: 'utf8', windowsHide: true }));
  report.rawVideo = { path: raw, duration: Number(metadata.format.duration) };
  report.clipStartSeconds = Math.max(0, Number(metadata.format.duration) - actionThroughCloseSeconds);
  report.clipAlignment = 'action-start estimate from real wall time through recording close; full raw retained';
  execFileSync('ffmpeg', ['-v', 'error', '-i', raw, '-ss', String(report.clipStartSeconds), '-t', '6', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '20', '-y', out+'/review-6s.mp4'], { windowsHide: true, timeout: 60000 });
  for (const seconds of [0, 2, 4, 5.5]) execFileSync('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', out+'/review-6s.mp4', '-frames:v', '1', '-y', out+`/frame-${seconds}.png`], { windowsHide: true, timeout: 15000 });
  report.reviewVideo = out+'/review-6s.mp4';
  report.status = 'PASS_TECHNICAL; moving-pixel critic/owner acceptance separate';
} catch (e) { report.status = 'FAIL'; report.failure = String(e); throw e; }
finally { if(context) await context.close().catch(()=>{}); await owned.close(); writeFileSync(out+'/report.json', JSON.stringify(report,null,2)); }
