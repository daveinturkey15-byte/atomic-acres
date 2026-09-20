/** CPU/DOM contract test only. This is NOT a WebGPU or memory acceptance run. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { soakScenario, enterSoakScenario } from './lib/soak-scenario.mjs';

assert.equal(soakScenario([]), 'solo-gameplay');
assert.equal(soakScenario(['--solo']), 'solo-gameplay');
assert.equal(soakScenario(['--menu-only']), 'menu-only');
assert.throws(() => soakScenario(['--solo', '--menu-only']), /not both/);

const executablePath = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => p && existsSync(p));
if (!executablePath) throw new Error('Chrome required for the DOM contract fixture');
const browser = await chromium.launch({ executablePath, headless: true,
  args: ['--disable-gpu', '--disable-software-rasterizer'] });
let assertions = 4;
try {
  const page = await browser.newPage({ viewport: { width: 480, height: 320 } });
  async function fixture(mode = 'active') {
    await page.setContent('<button id="play">Play solo</button><button id="deploy" hidden>Deploy</button>');
    await page.evaluate((mode) => {
      window.calls = [];
      let phase = null;
      window.__NTGAME = {
        snapshot() {
          if (phase === null) throw new Error('No match yet');
          return { match: { phase } };
        },
        counters: () => ({ epoch: 'fixture-epoch' }),
      };
      document.querySelector('#play').onclick = () => {
        window.calls.push('play');
        document.querySelector('#deploy').hidden = false;
      };
      document.querySelector('#deploy').onclick = () => {
        window.calls.push('deploy');
        if (mode === 'missing-api') delete window.__NTGAME;
        else if (mode !== 'throws') phase = mode;
      };
    }, mode);
  }
  await fixture();
  assert.deepEqual(await enterSoakScenario(page, soakScenario([]), 1000), {
    scenario: 'solo-gameplay', gameplayEntered: true, enteredPhase: 'active', epoch: 'fixture-epoch',
  });
  assert.deepEqual(await page.evaluate(() => window.calls), ['play', 'deploy']);
  assertions += 2;

  // Rendering a menu, or clicking Deploy, cannot satisfy an active-match gate.
  for (const mode of ['loading', 'missing-api', 'throws']) {
    await fixture(mode);
    await assert.rejects(enterSoakScenario(page, 'solo-gameplay', 350), /Timeout/);
    assert.deepEqual(await page.evaluate(() => window.calls), ['play', 'deploy']);
    assertions += 2;
  }
  await fixture();
  assert.deepEqual(await enterSoakScenario(page, 'menu-only', 1000), {
    scenario: 'menu-only', gameplayEntered: false, enteredPhase: null, snapshotReadable: false,
  });
  assert.deepEqual(await page.evaluate(() => window.calls), []);
  assertions += 2;
  await page.evaluate(() => { window.__NTGAME.snapshot = () => ({ match: { phase: 'active' } }); });
  await assert.rejects(enterSoakScenario(page, 'menu-only', 1000), /unexpectedly/);
  await assert.rejects(enterSoakScenario(page, 'unknown', 1000), /Unknown/);
  assertions += 2;
  console.log(JSON.stringify({ pass: true, assertions, scope: 'CPU DOM scenario admission only; no game, GPU or memory verdict' }));
} finally { await browser.close(); }
