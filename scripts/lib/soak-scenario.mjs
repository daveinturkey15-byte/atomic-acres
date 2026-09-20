/** A rendered menu is not proof that the combat path was exercised. */
export function soakScenario(argv) {
  if (argv.includes('--solo') && argv.includes('--menu-only')) {
    throw new Error('Choose solo gameplay or --menu-only, not both.');
  }
  return argv.includes('--menu-only') ? 'menu-only' : 'solo-gameplay';
}

export async function enterSoakScenario(page, scenario, timeout = 45000) {
  if (!['menu-only', 'solo-gameplay'].includes(scenario)) throw new Error('Unknown soak scenario');
  const play = page.getByRole('button', { name: 'Play solo', exact: true });
  await play.waitFor({ state: 'visible', timeout });
  if (scenario === 'menu-only') {
    const state = await page.evaluate(() => {
      // Before begin(), the game's snapshot API can legitimately throw.
      try {
        const phase = window.__NTGAME?.snapshot?.()?.match?.phase ?? null;
        return { phase, snapshotReadable: phase !== null };
      } catch { return { phase: null, snapshotReadable: false }; }
    });
    if (state.phase === 'active') throw new Error('Menu-only run unexpectedly has an active match');
    return { scenario, gameplayEntered: false, enteredPhase: state.phase, snapshotReadable: state.snapshotReadable };
  }
  await play.click({ timeout });
  await page.getByRole('button', { name: 'Deploy', exact: true }).click({ timeout });
  await page.waitForFunction(() => {
    try { return window.__NTGAME?.snapshot?.()?.match?.phase === 'active'; }
    catch { return false; } // A missing host must time out, never count as gameplay.
  }, null, { timeout });
  const entry = await page.evaluate(() => ({
    phase: window.__NTGAME.snapshot().match.phase,
    epoch: window.__NTGAME.counters?.().epoch ?? null,
  }));
  if (entry.phase !== 'active') throw new Error('Match left active state before soak admission');
  return { scenario, gameplayEntered: true, enteredPhase: entry.phase, epoch: entry.epoch };
}
