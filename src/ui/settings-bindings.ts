/**
 * Atomic Acres — the key-binding rows of the options panel.
 *
 * Projected from `bindings.ts:ACTION_DEFS` (IMPORT-PLAN §5.5): a new action is
 * one more row in that table and zero lines here. Each rebindable action is a
 * button showing its cap; pressing it arms a one-shot capture, the next key
 * becomes the binding, Escape cancels. A key already held by another action
 * SWAPS rather than silently resetting the other (which is what
 * `sanitizeBindings` would do on its own, in table order), so a rebind the
 * player just made is never undone behind their back.
 *
 * Mouse buttons are shown and not rebindable — `main.ts` reads them straight
 * off `mousedown.button` and that file is not this lane's.
 */

import { ACTION_DEFS, DEFAULT_BINDINGS, bindingConflicts, codeLabel, isBindableCode, type Action, type Bindings } from './bindings';

export interface BindingRowsDeps {
  read(): Bindings;
  write(next: Bindings): void;
}

export interface BindingRows {
  readonly root: HTMLElement;
  refresh(): void;
  /** True while a capture is armed: the menu must not treat the key itself. */
  capturing(): boolean;
}

export function buildBindingRows(deps: BindingRowsDeps): BindingRows {
  const root = document.createElement('div');
  root.className = 'aa-bindings';
  const buttons = new Map<Action, HTMLButtonElement>();
  let armed: Action | null = null;

  const disarm = (): void => {
    if (armed === null) return;
    const b = buttons.get(armed);
    b?.classList.remove('aa-capturing');
    armed = null;
    refresh();
  };

  const capture = (e: KeyboardEvent): void => {
    if (armed === null) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (e.key === 'Escape') {
      disarm();
      return;
    }
    if (!isBindableCode(e.code)) return;
    const cur = deps.read();
    const next: Record<Action, string> = { ...cur };
    const old = cur[armed];
    for (const d of ACTION_DEFS) {
      if (d.id !== armed && d.rebindable && cur[d.id] === e.code) next[d.id] = old;
    }
    next[armed] = e.code;
    deps.write(Object.freeze(next));
    disarm();
  };
  addEventListener('keydown', capture, true);

  for (const d of ACTION_DEFS) {
    const row = document.createElement('div');
    row.className = 'aa-setting aa-setting-row aa-bind-row';
    const name = document.createElement('span');
    name.textContent = d.label;
    const cap = document.createElement('button');
    cap.type = 'button';
    cap.className = 'aa-btn aa-bind-cap';
    cap.setAttribute('aria-label', 'Rebind ' + d.label);
    cap.disabled = !d.rebindable;
    cap.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!d.rebindable) return;
      if (armed === d.id) {
        disarm();
        return;
      }
      disarm();
      armed = d.id;
      cap.classList.add('aa-capturing');
      cap.textContent = 'PRESS A KEY';
    });
    buttons.set(d.id, cap);
    row.append(name, cap);
    root.append(row);
  }

  const resetRow = document.createElement('div');
  resetRow.className = 'aa-row';
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'aa-btn';
  reset.textContent = 'Reset bindings';
  reset.addEventListener('click', (e) => {
    e.stopPropagation();
    disarm();
    deps.write(DEFAULT_BINDINGS);
    refresh();
  });
  resetRow.append(reset);
  root.append(resetRow);

  function refresh(): void {
    const b = deps.read();
    const clash = bindingConflicts(b);
    for (const d of ACTION_DEFS) {
      const cap = buttons.get(d.id);
      if (cap === undefined || armed === d.id) continue;
      cap.textContent = codeLabel(b[d.id]);
      cap.classList.toggle('aa-conflict', clash.has(d.id));
      cap.title = clash.has(d.id) ? 'Bound to two actions - one of them will not fire' : '';
    }
  }
  refresh();

  return { root, refresh, capturing: () => armed !== null };
}
