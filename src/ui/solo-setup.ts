/**
 * Atomic Acres — the pre-match panel for a solo match against bots.
 *
 * Every row is a PROJECTION of a `game/rules.ts` table (IMPORT-PLAN §5.5):
 * kill limits, time limits, respawn delays, difficulty presets, team layouts.
 * Nothing here knows a number the rules do not; add a row to the table and
 * the menu grows the option. The chosen setup is persisted under its own key
 * beside the settings (`settings.ts:saveSoloSetupRaw`) and sanitised on the
 * way back in by `rules.ts:sanitizeSoloSetup`, field by field.
 *
 * The panel reports a `SoloSetup` on every change; the menu hands it to
 * `LocalMatch.configure`, and `#start`'s one-click default is untouched
 * because `begin()` with nothing configured still runs `DEFAULT_SOLO_SETUP`.
 *
 * `mode: 'rules'` is the same panel opened from the multiplayer lobby: the
 * bot-count row hides (the room's own slider owns that) and the primary
 * button reads BACK TO LOBBY instead of DEPLOY.
 */

import {
  BOT_DIFFICULTIES, BOT_DIFFICULTY_PRESETS, BOT_TEAM_LAYOUTS, KILL_LIMITS, RESPAWN_DELAYS_MS,
  SHIPPED_MATCH_MODES, SOLO_MAX_BOTS, SOLO_MIN_BOTS, TIME_LIMITS_MS, sanitizeSoloSetup,
  type BotTeamLayout, type MatchMode, type SoloSetup,
} from '../game/rules';
import { formatClock } from '../game/match';
import { loadSoloSetupRaw, saveSoloSetupRaw } from './settings';

export interface SoloSetupPanelDeps {
  /** Every change, already sanitised. The menu configures the match with it. */
  onChange(setup: SoloSetup): void;
  onDeploy(setup: SoloSetup): void;
  onBack(): void;
}

export interface SoloSetupPanel {
  readonly root: HTMLElement;
  setup(): SoloSetup;
  setMode(mode: 'solo' | 'rules'): void;
  refresh(): void;
}

const MODE_LABEL: Record<MatchMode, string> = { tdm: 'Team deathmatch', ffa: 'Free for all', domination: 'Domination' };
const TEAM_LABEL: Record<BotTeamLayout, string> = { balanced: 'Balanced teams', enemies: 'All bots against me' };

function stop(e: Event): void {
  e.stopPropagation();
}

function row(label: string, control: HTMLElement, hint = ''): HTMLElement {
  const r = document.createElement('label');
  r.className = 'aa-setting aa-setting-row';
  const name = document.createElement('span');
  name.textContent = label;
  r.append(name, control);
  if (hint) {
    const h = document.createElement('span');
    h.className = 'aa-note aa-note-live';
    h.textContent = hint;
    r.append(h);
  }
  return r;
}

function selectOf(label: string, options: readonly { value: string; text: string }[], onPick: (v: string) => void): HTMLSelectElement {
  const sel = document.createElement('select');
  sel.className = 'aa-select';
  sel.setAttribute('aria-label', label);
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = o.value;
    opt.textContent = o.text;
    sel.append(opt);
  }
  sel.addEventListener('click', stop);
  sel.addEventListener('change', (e) => { stop(e); onPick(sel.value); });
  return sel;
}

export function buildSoloSetupPanel(deps: SoloSetupPanelDeps): SoloSetupPanel {
  let setup: SoloSetup = sanitizeSoloSetup(loadSoloSetupRaw());
  const root = document.createElement('div');
  root.className = 'aa-view aa-hidden aa-solo';
  root.setAttribute('aria-label', 'Solo vs bots');
  const title = document.createElement('h2');
  title.className = 'aa-h2';
  title.textContent = 'Solo vs bots';
  root.append(title);

  const refreshers: Array<() => void> = [];
  const change = (patch: Partial<SoloSetup>): void => {
    setup = sanitizeSoloSetup({ ...setup, ...patch });
    saveSoloSetupRaw(setup);
    deps.onChange(setup);
    refresh();
  };

  const modeSel = selectOf('Mode', SHIPPED_MATCH_MODES.map((m) => ({ value: m, text: MODE_LABEL[m] })), (v) => change({ mode: v as MatchMode }));
  refreshers.push(() => { modeSel.value = setup.mode; });
  root.append(row('Mode', modeSel));

  const botsRow = document.createElement('label');
  botsRow.className = 'aa-setting';
  const bh = document.createElement('div');
  bh.className = 'aa-setting-head';
  const bl = document.createElement('span');
  bl.textContent = 'Bots';
  const bv = document.createElement('span');
  bv.className = 'aa-val';
  bh.append(bl, bv);
  const bots = document.createElement('input');
  bots.type = 'range';
  bots.min = String(SOLO_MIN_BOTS);
  bots.max = String(SOLO_MAX_BOTS);
  bots.step = '1';
  bots.setAttribute('aria-label', 'Bots');
  bots.addEventListener('click', stop);
  bots.addEventListener('input', (e) => { stop(e); change({ bots: Number(bots.value) }); });
  botsRow.append(bh, bots);
  refreshers.push(() => { bots.value = String(setup.bots); bv.textContent = setup.bots + (setup.bots === 1 ? ' bot' : ' bots'); });
  root.append(botsRow);

  const diff = document.createElement('div');
  diff.className = 'aa-seg';
  diff.setAttribute('role', 'radiogroup');
  diff.setAttribute('aria-label', 'Bot difficulty');
  const diffButtons = new Map<string, HTMLButtonElement>();
  for (const id of BOT_DIFFICULTIES) {
    const p = BOT_DIFFICULTY_PRESETS[id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'aa-btn aa-seg-btn';
    b.setAttribute('role', 'radio');
    b.textContent = p.label;
    b.title = `reaction ${p.reactionMs} ms · range ${p.fireRangeM} m · aim error ${(p.aimErrorRad * 1000).toFixed(0)} mrad`;
    b.addEventListener('click', (e) => { stop(e); change({ difficulty: id }); });
    diffButtons.set(id, b);
    diff.append(b);
  }
  refreshers.push(() => {
    for (const [id, b] of diffButtons) {
      b.classList.toggle('aa-selected', id === setup.difficulty);
      b.setAttribute('aria-checked', id === setup.difficulty ? 'true' : 'false');
    }
  });
  root.append(row('Difficulty', diff));
  const diffNote = document.createElement('div');
  diffNote.className = 'aa-hint aa-diffnote';
  refreshers.push(() => {
    const p = BOT_DIFFICULTY_PRESETS[setup.difficulty];
    diffNote.textContent = `${p.label}: reacts in ${p.reactionMs} ms, engages to ${p.fireRangeM} m, aim error ${(p.aimErrorRad * 1000).toFixed(0)} mrad`;
  });
  root.append(diffNote);

  const killSel = selectOf('Kill limit', KILL_LIMITS.map((k) => ({ value: k === null ? 'none' : String(k), text: k === null ? 'No limit' : k + ' kills' })),
    (v) => change({ scoreLimit: v === 'none' ? null : Number(v) }));
  refreshers.push(() => { killSel.value = setup.scoreLimit === null ? 'none' : String(setup.scoreLimit); });
  root.append(row('Kill limit', killSel));

  const timeSel = selectOf('Time limit', TIME_LIMITS_MS.map((t) => ({ value: String(t), text: formatClock(t) })), (v) => change({ durationMs: Number(v) }));
  refreshers.push(() => { timeSel.value = String(setup.durationMs); });
  root.append(row('Time limit', timeSel));

  const ff = document.createElement('input');
  ff.type = 'checkbox';
  ff.setAttribute('aria-label', 'Friendly fire');
  ff.addEventListener('click', stop);
  ff.addEventListener('change', (e) => { stop(e); change({ friendlyFire: ff.checked }); });
  refreshers.push(() => { ff.checked = setup.friendlyFire; ff.disabled = setup.mode === 'ffa'; });
  root.append(row('Friendly fire', ff));

  const respawnSel = selectOf('Respawn delay', RESPAWN_DELAYS_MS.map((t) => ({ value: String(t), text: (t / 1000).toFixed(1) + ' s' })), (v) => change({ respawnMs: Number(v) }));
  refreshers.push(() => { respawnSel.value = String(setup.respawnMs); });
  root.append(row('Respawn delay', respawnSel));

  const teamSel = selectOf('Team balance', BOT_TEAM_LAYOUTS.map((t) => ({ value: t, text: TEAM_LABEL[t] })), (v) => change({ teams: v as BotTeamLayout }));
  refreshers.push(() => { teamSel.value = setup.teams; teamSel.disabled = setup.mode === 'ffa'; });
  root.append(row('Team balance', teamSel));

  const btns = document.createElement('div');
  btns.className = 'aa-row';
  const deploy = document.createElement('button');
  deploy.type = 'button';
  deploy.className = 'aa-btn aa-primary';
  deploy.textContent = 'Deploy';
  deploy.addEventListener('click', (e) => { stop(e); deps.onDeploy(setup); });
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'aa-btn';
  back.textContent = 'Back';
  back.addEventListener('click', (e) => { stop(e); deps.onBack(); });
  btns.append(deploy, back);
  root.append(btns);

  function refresh(): void {
    for (const r of refreshers) r();
  }
  refresh();
  deps.onChange(setup);

  return {
    root,
    setup: () => setup,
    setMode(mode): void {
      botsRow.classList.toggle('aa-hidden', mode === 'rules');
      deploy.classList.toggle('aa-hidden', mode === 'rules');
      title.textContent = mode === 'rules' ? 'Match rules' : 'Solo vs bots';
      back.textContent = mode === 'rules' ? 'Back to lobby' : 'Back';
    },
    refresh,
  };
}
