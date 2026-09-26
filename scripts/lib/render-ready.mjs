/** Device initialization precedes usable cold WebGPU frames. Admit actual render progress. */
export async function waitForRenderedPage(page, timeout = 180000) {
  await page.waitForFunction(() => window.__NT?.ready === true, null, { timeout });
  const first = await page.evaluate(() => window.__NT.stats().renderCallsTotal);
  await page.waitForFunction(before => {
    const s = window.__NT.stats();
    return s.fps > 0 && s.renderCallsTotal > before;
  }, first, { timeout, polling: 100 });
}
