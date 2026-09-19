/**
 * Atomic Acres — the static menu views: main, pause, end of match, credits,
 * deploying, error. Each builder returns its root and the buttons the shell
 * wires; none of them decides anything. Split out of `menus.ts` when the
 * solo / multiplayer / options panels landed (the 400-line cap).
 *
 * Licence text lives HERE on the main menu footer and in the credits view:
 * docs/LICENCES-ANIMATION.md obligation 3 requires both lines wherever the
 * game names itself. Keep them.
 */
import type { SessionSnapshot } from '../game/session-types';
import type { MatchMode } from '../game/rules';
import { formatClock } from '../game/match';
import { glyphFor, glyphScheme } from './glyphs';
import { buildMapSelect, type MapSelect } from './map-select';

export const FAN_LINE = 'Unofficial fan project — not affiliated with Activision or Treyarch.';
export const LICENCE_LINES: readonly string[] = Object.freeze([
  'Built with Meta Llama 3',
  'Motion: NVIDIA Kimodo SOMA-RP v1.1 (NVIDIA Open Model License)',
]);

export function button(label: string, cls = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.className = ('aa-btn ' + cls).trim();
  b.addEventListener('click', (e) => e.stopPropagation());
  return b;
}

/** A `<kbd data-glyph>` prompt cap; the glyph scheme owns its text. */
function kbd(action: string): HTMLElement {
  const k = document.createElement('kbd');
  k.setAttribute('data-glyph', action);
  k.textContent = glyphFor(action, glyphScheme());
  return k;
}

export function view(label: string, cls = ''): HTMLElement {
  const v = document.createElement('div');
  v.className = ('aa-view aa-hidden ' + cls).trim();
  v.setAttribute('aria-label', label);
  return v;
}

function text(tag: keyof HTMLElementTagNameMap, cls: string, content: string): HTMLElement {
  const n = document.createElement(tag);
  n.className = cls;
  n.textContent = content;
  return n;
}

export interface MainView {
  root: HTMLElement;
  solo: HTMLButtonElement;
  multiplayer: HTMLButtonElement;
  options: HTMLButtonElement;
  credits: HTMLButtonElement;
  maps: MapSelect;
}

export function buildMain(): MainView {
  const root = view('Main menu', 'aa-main');
  root.classList.remove('aa-hidden');
  const btnRow = document.createElement('div');
  btnRow.className = 'aa-row aa-menu-row';
  const solo = button('Play solo', 'aa-primary');
  const multiplayer = button('Multiplayer');
  const options = button('Options');
  const credits = button('Credits');
  btnRow.append(solo, multiplayer, options, credits);
  const maps = buildMapSelect();
  const foot = document.createElement('div');
  foot.className = 'aa-foot';
  foot.append(text('div', 'aa-fan', FAN_LINE), text('div', 'aa-fan aa-credits', LICENCE_LINES.join(' · ')));
  root.append(
    text('div', 'aa-eyebrow', 'A fan project inspired by Black Ops 2'),
    text('h1', 'aa-title', 'ATOMIC ACRES'),
    text('div', 'aa-sub', 'Nuketown 2025'),
    btnRow,
    text('div', 'aa-maphead', 'Map'),
    maps.root,
    foot,
  );
  return { root, solo, multiplayer, options, credits, maps };
}

export interface PauseView {
  root: HTMLElement;
  resume: HTMLButtonElement;
  options: HTMLButtonElement;
  leave: HTMLButtonElement;
}

export function buildPause(): PauseView {
  const root = view('Paused', 'aa-pause');
  const row = document.createElement('div');
  row.className = 'aa-row';
  const resume = button('Resume', 'aa-primary');
  const options = button('Options');
  const leave = button('Leave match');
  row.append(resume, options, leave);
  const hint = document.createElement('div');
  hint.className = 'aa-hint';
  hint.append(
    kbd('move'), document.createTextNode(' move · '),
    kbd('fire'), document.createTextNode(' fire · '),
    kbd('ads'), document.createTextNode(' aim · '),
    kbd('reload'), document.createTextNode(' reload · '),
    kbd('switch'), document.createTextNode(' weapons · Tab scoreboard'),
  );
  root.append(text('h2', 'aa-h2', 'Paused'), row, hint);
  return { root, resume, options, leave };
}

export interface CreditsView {
  root: HTMLElement;
  back: HTMLButtonElement;
}

export function buildCredits(): CreditsView {
  const root = view('Credits', 'aa-creditsview');
  const lines = [
    'Atomic Acres — a from-scratch browser FPS on Three.js WebGPU / TSL.',
    'Map, props, characters and effects are procedural: built in code, no downloaded art.',
    FAN_LINE,
    ...LICENCE_LINES,
  ];
  const list = document.createElement('div');
  list.className = 'aa-creditlines';
  for (const l of lines) list.append(text('div', 'aa-creditline', l));
  const row = document.createElement('div');
  row.className = 'aa-row';
  const back = button('Back');
  row.append(back);
  root.append(text('h2', 'aa-h2', 'Credits'), list, row);
  return { root, back };
}

export interface EndView {
  root: HTMLElement;
  rematch: HTMLButtonElement;
  leave: HTMLButtonElement;
  /** Redraw from the authoritative snapshot; `rematchMs` null hides the countdown. */
  update(snap: SessionSnapshot | null, selfId: string, names: ReadonlyMap<string, string>, rematchMs: number | null, canRematch: boolean): void;
}

const MODE_LABEL: Record<MatchMode, string> = { tdm: 'Team deathmatch', ffa: 'Free for all', domination: 'Domination' };

export function buildEnd(): EndView {
  const root = view('Match over', 'aa-end');
  const outcome = text('h2', 'aa-h2 aa-outcome', 'MATCH OVER');
  const why = text('div', 'aa-sub aa-why', '');
  const table = document.createElement('div');
  table.className = 'aa-table';
  table.setAttribute('role', 'table');
  const row = document.createElement('div');
  row.className = 'aa-row';
  const rematch = button('Rematch', 'aa-primary');
  const leave = button('Leave');
  row.append(rematch, leave);
  root.append(outcome, why, table, row);
  let lastKey = '';

  function update(snap: SessionSnapshot | null, selfId: string, names: ReadonlyMap<string, string>, rematchMs: number | null, canRematch: boolean): void {
    rematch.disabled = !canRematch;
    rematch.textContent = !canRematch ? 'Host decides the rematch' : rematchMs === null ? 'Rematch' : `Rematch (auto in ${Math.ceil(rematchMs / 1000)}s)`;
    if (snap === null) return;
    const m = snap.match;
    const self = snap.actors.find((a) => a.id === selfId);
    const team = self?.team ?? null;
    let title = 'MATCH OVER';
    if (m.winner === 'draw') title = 'DRAW';
    else if (m.winnerId !== null) title = m.winnerId === selfId ? 'VICTORY' : 'DEFEAT';
    else if (m.winner !== null && team !== null) title = m.winner === team ? 'VICTORY' : 'DEFEAT';
    outcome.textContent = title;
    const reason = m.endReason === 'time' ? 'time limit' : m.endReason === 'score' ? 'score limit' : '';
    // Team totals mean nothing in a free-for-all; the rows below carry that story.
    const totals = m.mode === 'ffa' ? '' : ` · ${m.teamScores[0]} – ${m.teamScores[1]}`;
    why.textContent = `${MODE_LABEL[m.mode]}${totals}${reason ? ' · ' + reason : ''}` +
      (m.endsAt === null ? '' : ` · ${formatClock(Math.max(0, m.endsAt - m.at))} left`);
    // Rebuild the rows only when the standings change: the countdown ticks at
    // 4 Hz and must not churn the table every time.
    const key = m.scores.map((r) => `${r.id}:${r.kills}/${r.deaths}/${r.score}`).join('|');
    if (key === lastKey) return;
    lastKey = key;
    table.replaceChildren();
    const head = document.createElement('div');
    head.className = 'aa-trow aa-thead';
    head.append(text('span', 'aa-tname', 'PLAYER'), text('span', 'aa-tn', 'K'), text('span', 'aa-tn', 'D'), text('span', 'aa-tn', 'PTS'));
    table.append(head);
    for (const r of m.scores) {
      const tr = document.createElement('div');
      tr.className = 'aa-trow' + (r.id === selfId ? ' aa-tself' : '') + (r.team === 1 ? ' aa-tteam-b' : ' aa-tteam-a');
      tr.append(
        text('span', 'aa-tname', names.get(r.id) ?? r.id),
        text('span', 'aa-tn', String(r.kills)),
        text('span', 'aa-tn', String(r.deaths)),
        text('span', 'aa-tn', String(r.score)),
      );
      table.append(tr);
    }
  }

  return { root, rematch, leave, update };
}

export function buildDeploying(): HTMLElement {
  const root = view('Deploying', 'aa-deploying');
  root.append(text('h2', 'aa-h2', 'DEPLOYING'));
  return root;
}

export function buildError(): HTMLElement {
  const root = view('Error', 'aa-errorview');
  root.append(text('h2', 'aa-h2', 'Something broke'), text('div', 'aa-hint', 'The match stopped. Reload the page to try again.'));
  return root;
}
