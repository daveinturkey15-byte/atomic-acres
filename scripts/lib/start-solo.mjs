/** Exercise the visible menu and fail if the authoritative match never starts. */
export async function startSolo(page) {
  await page.getByRole('button', { name: 'Play solo', exact: true }).click();
  await page.getByRole('button', { name: 'Deploy', exact: true }).click();
  await page.waitForFunction(() => {
    try {
      const match = window.__NTGAME?.snapshot();
      return match?.match?.phase === 'active' && match.actors.length > 1;
    } catch {
      return false; // The session refuses snapshot() while deployment is pending.
    }
  }, null, { timeout: 30000 });
}
