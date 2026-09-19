/**
 * Atomic Acres — key bindings: the authored action list and its defaults.
 *
 * One authored table (`ACTION_DEFS`); everything else — the options rows, the
 * prompt caps, the remap shim — is a projection of it (IMPORT-PLAN §5.5).
 * Each action names its CONSUMER honestly: the module that reads the default
 * code today. Rebinding works by re-dispatching the physical key as the
 * consumer's default code (`settings-apply.ts`), so a consumer that has not
 * grown a `setBindings` still follows the option; when one does, the shim
 * steps aside for that action.
 *
 * Codes are `KeyboardEvent.code` strings (`KeyW`, `Space`, `ShiftLeft`) or
 * `Mouse0` / `Mouse2` for the two buttons. Mouse buttons are shown, not
 * rebindable: fire and aim are read straight off `mousedown.button` in
 * `main.ts`, and swapping them would need that file.
 */

export const ACTIONS = [
  'forward', 'back', 'left', 'right', 'jump', 'sprint', 'crouch',
  'fire', 'ads', 'reload', 'weapon1', 'weapon2', 'grenade', 'knife', 'use', 'scoreboard',
] as const;
export type Action = (typeof ACTIONS)[number];

export interface ActionDef {
  readonly id: Action;
  readonly label: string;
  readonly code: string;
  readonly rebindable: boolean;
  /** Who reads the default code today. `none` = no consumer exists yet. */
  readonly consumer: string;
}

export const ACTION_DEFS: readonly ActionDef[] = Object.freeze([
  { id: 'forward', label: 'Move forward', code: 'KeyW', rebindable: true, consumer: 'core/player.ts' },
  { id: 'back', label: 'Move back', code: 'KeyS', rebindable: true, consumer: 'core/player.ts' },
  { id: 'left', label: 'Strafe left', code: 'KeyA', rebindable: true, consumer: 'core/player.ts' },
  { id: 'right', label: 'Strafe right', code: 'KeyD', rebindable: true, consumer: 'core/player.ts' },
  { id: 'jump', label: 'Jump', code: 'Space', rebindable: true, consumer: 'core/player.ts' },
  { id: 'sprint', label: 'Sprint', code: 'ShiftLeft', rebindable: true, consumer: 'core/player.ts' },
  { id: 'crouch', label: 'Crouch', code: 'ControlLeft', rebindable: true, consumer: 'none' },
  { id: 'fire', label: 'Fire', code: 'Mouse0', rebindable: false, consumer: 'main.ts mousedown' },
  { id: 'ads', label: 'Aim down sights', code: 'Mouse2', rebindable: false, consumer: 'main.ts mousedown' },
  { id: 'reload', label: 'Reload', code: 'KeyR', rebindable: true, consumer: 'main.ts keydown' },
  { id: 'weapon1', label: 'Primary weapon', code: 'Digit1', rebindable: true, consumer: 'main.ts keydown' },
  { id: 'weapon2', label: 'Secondary weapon', code: 'Digit2', rebindable: true, consumer: 'main.ts keydown' },
  { id: 'grenade', label: 'Grenade', code: 'KeyG', rebindable: true, consumer: 'ordnance lane' },
  { id: 'knife', label: 'Knife', code: 'KeyF', rebindable: true, consumer: 'ordnance lane (F also toggles fly in core/player.ts)' },
  { id: 'use', label: 'Use / pick up', code: 'KeyE', rebindable: true, consumer: 'ordnance lane (E is also fly-up in core/player.ts)' },
  { id: 'scoreboard', label: 'Scoreboard (hold)', code: 'Tab', rebindable: true, consumer: 'ui/hud.ts' },
]);

export type Bindings = Readonly<Record<Action, string>>;

/** Derived from the table; never authored twice. */
export const DEFAULT_BINDINGS: Bindings = Object.freeze(
  Object.fromEntries(ACTION_DEFS.map((d) => [d.id, d.code])) as Record<Action, string>,
);

const CODE_RE = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9A-Za-z]+|F([1-9]|1[0-9]|2[0-4])|Arrow(Up|Down|Left|Right)|Space|Tab|Enter|Backspace|Backquote|Minus|Equal|Bracket(Left|Right)|Semicolon|Quote|Comma|Period|Slash|Backslash|(Shift|Control|Alt)(Left|Right)|CapsLock|Home|End|PageUp|PageDown|Insert|Delete|Mouse[0-4])$/;

/** True for a code the shim can act on. Escape is reserved for the menu. */
export function isBindableCode(code: unknown): code is string {
  return typeof code === 'string' && CODE_RE.test(code) && code !== 'Escape';
}

/**
 * Sanitise stored bindings. A non-rebindable action keeps its default, an
 * unknown code falls back to the action's default, and a code bound to two
 * actions is kept on the FIRST in table order and reset on the second, so a
 * corrupted store can never produce a key that does two things.
 */
export function sanitizeBindings(raw: unknown): Bindings {
  const out: Record<Action, string> = { ...DEFAULT_BINDINGS };
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const used = new Set<string>();
  for (const d of ACTION_DEFS) {
    let code = d.rebindable && isBindableCode(r[d.id]) ? (r[d.id] as string) : d.code;
    if (used.has(code)) code = d.code;
    if (used.has(code)) continue; // default also taken: leave unbound-by-conflict as default (flagged in the UI)
    used.add(code);
    out[d.id] = code;
  }
  return Object.freeze(out);
}

/** Actions whose code collides with another's. The options panel marks them. */
export function bindingConflicts(b: Bindings): ReadonlySet<Action> {
  const seen = new Map<string, Action>();
  const out = new Set<Action>();
  for (const d of ACTION_DEFS) {
    const other = seen.get(b[d.id]);
    if (other !== undefined) {
      out.add(other);
      out.add(d.id);
    } else {
      seen.set(b[d.id], d.id);
    }
  }
  return out;
}

/** Short cap text for a code: `KeyW` → `W`, `ShiftLeft` → `L SHIFT`, `Mouse0` → `LMB`. */
export function codeLabel(code: string): string {
  if (code === 'Mouse0') return 'LMB';
  if (code === 'Mouse2') return 'RMB';
  if (code === 'Mouse1') return 'MMB';
  if (code.startsWith('Mouse')) return 'M' + code.slice(5);
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'NUM ' + code.slice(6);
  if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
  const side = /^(Shift|Control|Alt)(Left|Right)$/.exec(code);
  if (side) return (side[2] === 'Left' ? 'L ' : 'R ') + (side[1] === 'Control' ? 'CTRL' : side[1].toUpperCase());
  return code.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase();
}

/**
 * The remap the shim applies: physical code → the code the consumer expects.
 * Identity when bindings equal defaults; a rebound action maps its new key to
 * its default key, and the default key of a rebound action maps to nothing
 * (`''`) so the old key goes dead instead of doing both.
 */
export function remapTable(b: Bindings): ReadonlyMap<string, string> {
  const m = new Map<string, string>();
  for (const d of ACTION_DEFS) {
    if (!d.rebindable || b[d.id] === d.code) continue;
    m.set(b[d.id], d.code);
    if (!m.has(d.code)) m.set(d.code, '');
  }
  return m;
}
