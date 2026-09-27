/** Install the failure boundary BEFORE importing/evaluating the game. */
import { BOOT_TIMEOUT_MS, bootStage, showBootError } from './core/boot-status';

window.dispatchEvent(new Event('atomic-acres:boot-started'));
bootStage('Loading game');
let watchdog: ReturnType<typeof setTimeout> | undefined;
try {
  await Promise.race([import('./main'), new Promise<never>((_, reject) => {
    watchdog = setTimeout(() => reject(new Error('Startup did not finish within 45 seconds. Reload to retry.')), BOOT_TIMEOUT_MS);
  })]);
} catch (error) { showBootError(error); }
finally { if (watchdog !== undefined) clearTimeout(watchdog); }
