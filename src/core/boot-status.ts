/** Startup status only. No game controls, renderer fallback or asset substitution. */
let stage = 'Loading game';
let failed = false;
export const BOOT_STEP_TIMEOUT_MS = 30_000;
export const BOOT_TIMEOUT_MS = 45_000;

export function bootStage(label: string): void {
  if (failed) throw new Error('Startup stopped; reload to retry.');
  stage = label;
  const status = document.querySelector<HTMLElement>('#start > [role="status"]');
  if (status) status.textContent = `${label}…`;
}

/** Reject instead of letting a pending optional-art request strand startup.
 * The caller stops assembly; a late request cannot resume it after this rejects. */
export async function bootStep<T>(label: string, task: () => Promise<T>, timeoutMs = BOOT_STEP_TIMEOUT_MS): Promise<T> {
  bootStage(label);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([task(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} took longer than ${timeoutMs / 1000} seconds. Reload to retry.`)), timeoutMs);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export function showBootError(error: unknown): void {
  if (failed) return;
  failed = true;
  console.error('[atomic-acres] startup failed:', error);
  const overlay = document.getElementById('start');
  if (!overlay) return;
  overlay.replaceChildren();
  overlay.style.display = 'flex';
  const title = document.createElement('h1');
  title.textContent = 'ATOMIC ACRES';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.setAttribute('data-boot-error', 'true');
  status.textContent = `Couldn’t start the game · ${stage}`;
  const detail = document.createElement('p');
  detail.style.cssText = 'max-width:min(640px,calc(100vw - 48px));text-align:center;overflow-wrap:anywhere';
  detail.textContent = error instanceof Error ? error.message : 'Startup failed. Reload to retry.';
  const retry = document.createElement('button');
  retry.type = 'button'; retry.className = 'aa-button'; retry.textContent = 'Retry loading';
  retry.addEventListener('click', () => window.location.reload());
  overlay.append(title, status, detail, retry);
}
