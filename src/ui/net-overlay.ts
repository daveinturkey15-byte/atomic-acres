/**
 * Atomic Acres — the netcode diagnostics overlay: one line in #hud.
 *
 * RTT, snapshot rate, snapshot age, corrections, accepted / rejected inputs,
 * link tier — whatever the live driver's `netLine()` says (host, guest, or
 * the lobby while a room is open; nothing in solo). Mounted inside #hud so
 * the capture harness hides it with everything else. Toggled by the
 * `netOverlay` setting and by F3, which writes the setting back so the two
 * cannot disagree. Text is written at 4 Hz through `textContent`, never per
 * frame and never via innerHTML.
 */

const REFRESH_MS = 250;

export interface NetOverlay {
  /** Once per frame; cheap when hidden. */
  tick(now: number, line: string | null): void;
  setVisible(v: boolean): void;
  visible(): boolean;
}

export function initNetOverlay(opts: { hud: HTMLElement | null; onToggle(v: boolean): void }): NetOverlay {
  const el = document.createElement('div');
  el.className = 'aa-netline aa-hidden';
  el.setAttribute('aria-live', 'off');
  opts.hud?.append(el);
  let shown = false;
  let last = 0;
  let lastText = '';

  addEventListener('keydown', (e) => {
    if (e.code !== 'F3' || e.repeat) return;
    e.preventDefault();
    opts.onToggle(!shown);
  });

  return {
    tick(now, line): void {
      if (!shown || now - last < REFRESH_MS) return;
      last = now;
      const text = line ?? 'net: no room open';
      if (text !== lastText) {
        lastText = text;
        el.textContent = text;
      }
    },
    setVisible(v): void {
      shown = v;
      el.classList.toggle('aa-hidden', !v);
      if (!v) lastText = '';
    },
    visible: () => shown,
  };
}
