/**
 * Atomic Acres — the multiplayer lobby view, inside the #start overlay.
 *
 * Everything decided here is decided by `net/lobby-session.ts` (DOM-free):
 * which link carries the room, what a refusal means, when a seat is gone.
 * This file draws `session.view()` and calls the verbs, and every refusal it
 * shows is a label the session or `game/rules.ts` authored (IMPORT-PLAN §5.4).
 *
 * Two links, both real:
 *   tabs  BroadcastChannel — two tabs of one browser profile, no server.
 *   lan   WebRTC data channels signalled through `scripts/net-signal.mjs`
 *         (spawned by a harness, or by hand on the machine that hosts).
 *
 * Callsign, link and signal address persist in `ui/settings.ts`. All names
 * render via textContent, never innerHTML.
 */
import type { LinkTier, LobbySession, LobbyView } from '../net/lobby-session';
import { LINK_LABELS, LINK_TIERS } from '../net/lobby-session';
import { LOBBY_CAPACITIES, SOLO_MAX_BOTS, type SoloSetup } from '../game/rules';
import { formatClock } from '../game/match';
import type { Settings } from './settings';

export interface LobbyPanelDeps {
  session(): LobbySession | null;
  settings(): Settings;
  write(patch: Partial<Settings>): void;
  /** The rules the host's match will use; shown as one line with an edit button. */
  rules(): SoloSetup;
  onEditRules(): void;
  onBack(): void;
}

export interface LobbyPanel {
  readonly root: HTMLElement;
  refresh(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function stop(e: Event): void {
  e.stopPropagation();
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', ('aa-btn ' + cls).trim(), label);
  b.type = 'button';
  b.addEventListener('click', (e) => { stop(e); onClick(); });
  return b;
}

function textInput(cls: string, placeholder: string, label: string, max: number): HTMLInputElement {
  const i = el('input', cls);
  i.type = 'text';
  i.maxLength = max;
  i.placeholder = placeholder;
  i.setAttribute('aria-label', label);
  i.autocomplete = 'off';
  i.addEventListener('click', stop);
  return i;
}

export function buildLobbyPanel(deps: LobbyPanelDeps): LobbyPanel {
  const root = el('div', 'aa-view aa-hidden aa-lobby');
  root.setAttribute('aria-label', 'Multiplayer');
  root.append(el('h2', 'aa-h2', 'Multiplayer'));
  const idle = el('div', 'aa-lobby-idle');
  const room = el('div', 'aa-lobby-room aa-hidden');
  const error = el('div', 'aa-error', '');
  error.setAttribute('role', 'status');
  root.append(idle, room, error);

  // ---- idle: identity, link, host / join ----------------------------------
  const name = textInput('aa-input aa-callsign', 'callsign', 'Callsign', 16);
  name.addEventListener('change', () => deps.write({ callsign: name.value }));
  const tier = el('select', 'aa-select');
  tier.setAttribute('aria-label', 'Link');
  for (const t of LINK_TIERS) {
    const o = el('option', '', LINK_LABELS[t]);
    o.value = t;
    tier.append(o);
  }
  tier.addEventListener('click', stop);
  tier.addEventListener('change', (e) => { stop(e); deps.write({ linkTier: tier.value as LinkTier }); refresh(); });
  const signal = textInput('aa-input aa-signal', 'http://host:4310', 'Signal server', 64);
  signal.addEventListener('change', () => deps.write({ signalUrl: signal.value }));
  const signalRow = el('label', 'aa-setting aa-setting-row');
  signalRow.append(el('span', '', 'Signal server'), signal);
  const cap = el('select', 'aa-select');
  cap.setAttribute('aria-label', 'Room size');
  for (const c of LOBBY_CAPACITIES) {
    const o = el('option', '', c + ' players');
    o.value = String(c);
    cap.append(o);
  }
  cap.value = String(LOBBY_CAPACITIES[LOBBY_CAPACITIES.length - 1]);
  cap.addEventListener('click', stop);
  const bots = el('input', 'aa-range');
  bots.type = 'range';
  bots.min = '0';
  bots.max = String(SOLO_MAX_BOTS);
  bots.step = '1';
  bots.value = '0';
  bots.setAttribute('aria-label', 'Bots in the room');
  bots.addEventListener('click', stop);
  const botsVal = el('span', 'aa-val', '0 bots');
  bots.addEventListener('input', () => { botsVal.textContent = bots.value + (bots.value === '1' ? ' bot' : ' bots'); });
  const botsRow = el('label', 'aa-setting');
  const botsHead = el('div', 'aa-setting-head');
  botsHead.append(el('span', '', 'Bots on the host'), botsVal);
  botsRow.append(botsHead, bots);
  const code = textInput('aa-input aa-code-input', 'CODE', 'Join code', 6);
  code.addEventListener('input', () => { code.value = code.value.toUpperCase(); });
  code.addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });

  const idRow = el('label', 'aa-setting aa-setting-row');
  idRow.append(el('span', '', 'Callsign'), name);
  const linkRow = el('label', 'aa-setting aa-setting-row');
  linkRow.append(el('span', '', 'Link'), tier);
  const capRow = el('label', 'aa-setting aa-setting-row');
  capRow.append(el('span', '', 'Room size'), cap);
  const hostRow = el('div', 'aa-row');
  hostRow.append(button('Host a room', 'aa-primary', host));
  const joinRow = el('div', 'aa-row aa-join-row');
  joinRow.append(code, button('Join by code', '', join));
  const rejoinRow = el('div', 'aa-row aa-hidden');
  const rejoinBtn = button('Rejoin', '', rejoin);
  rejoinRow.append(rejoinBtn);
  const backRow = el('div', 'aa-row');
  backRow.append(button('Back', '', deps.onBack));
  idle.append(idRow, linkRow, signalRow, capRow, botsRow, hostRow, joinRow, rejoinRow, backRow);

  // ---- in a room: code, roster, ready, start, leave ------------------------
  const codeBig = el('div', 'aa-code');
  const codeHint = el('div', 'aa-hint', '');
  const roster = el('ul', 'aa-roster');
  roster.setAttribute('aria-label', 'Roster');
  const rulesLine = el('div', 'aa-hint aa-rules-line');
  const rulesRow = el('div', 'aa-row');
  const editRules = button('Match rules', '', deps.onEditRules);
  rulesRow.append(editRules);
  const readyLabel = el('label', 'aa-check');
  const ready = el('input', '');
  ready.type = 'checkbox';
  ready.setAttribute('aria-label', 'Ready');
  ready.addEventListener('click', stop);
  ready.addEventListener('change', () => deps.session()?.setReady(ready.checked));
  readyLabel.append(ready, document.createTextNode(' Ready'));
  const startBtn = button('Start match', 'aa-primary', () => { deps.session()?.start(); refresh(); });
  const startWhy = el('span', 'aa-note aa-note-persist', '');
  const leaveBtn = button('Leave', '', () => { deps.session()?.leave(); refresh(); });
  const actRow = el('div', 'aa-row');
  actRow.append(readyLabel, startBtn, leaveBtn);
  const status = el('div', 'aa-hint aa-lobby-status', '');
  room.append(codeBig, codeHint, roster, rulesLine, rulesRow, actRow, startWhy, status);

  function host(): void {
    const s = deps.session();
    if (s === null) return;
    const st = deps.settings();
    s.host({ name: st.callsign, tier: st.linkTier, signalUrl: st.signalUrl, capacity: Number(cap.value), bots: Number(bots.value) });
    refresh();
  }
  function join(): void {
    const s = deps.session();
    if (s === null) return;
    const st = deps.settings();
    s.join(code.value, { name: st.callsign, tier: st.linkTier, signalUrl: st.signalUrl });
    refresh();
  }
  function rejoin(): void {
    const s = deps.session();
    const c = s?.rejoinCandidate() ?? null;
    if (s === null || c === null) return;
    s.join(c.code, { name: c.name, tier: c.tier, signalUrl: c.signalUrl });
    refresh();
  }

  function drawRoster(v: LobbyView): void {
    roster.replaceChildren();
    for (const r of v.roster) {
      const li = el('li', 'aa-seat' + (r.id === v.selfId ? ' aa-me' : '') + (r.ready ? ' aa-ready' : '') + (r.connected ? '' : ' aa-away'));
      const mark = el('span', 'aa-seat-mark', r.connected ? (r.ready ? '●' : '○') : '…');
      const label = el('span', 'aa-seat-name', r.name + (r.isHost ? ' (host)' : '') + (r.id === v.selfId ? ' - you' : ''));
      const state = el('span', 'aa-seat-state', !r.connected ? 'rejoining' : r.ready ? 'ready' : 'not ready');
      li.append(mark, label, state);
      roster.append(li);
    }
    for (let i = v.roster.length; i < v.capacity; i++) roster.append(el('li', 'aa-seat aa-empty', '— open seat —'));
  }

  function rulesText(): string {
    const r = deps.rules();
    return `${r.mode.toUpperCase()} · ${r.scoreLimit === null ? 'no kill limit' : r.scoreLimit + ' kills'} · ${formatClock(r.durationMs)} · ${r.difficulty} bots · respawn ${(r.respawnMs / 1000).toFixed(1)} s`;
  }

  function refresh(): void {
    const s = deps.session();
    const st = deps.settings();
    if (document.activeElement !== name) name.value = st.callsign;
    tier.value = st.linkTier;
    if (document.activeElement !== signal) signal.value = st.signalUrl;
    signalRow.classList.toggle('aa-hidden', st.linkTier !== 'lan');
    const v = s?.view() ?? null;
    const inRoom = v !== null && v.role !== 'idle';
    idle.classList.toggle('aa-hidden', inRoom);
    room.classList.toggle('aa-hidden', !inRoom);
    error.textContent = v?.error ?? '';
    const cand = s?.rejoinCandidate() ?? null;
    rejoinRow.classList.toggle('aa-hidden', inRoom || cand === null);
    if (cand !== null) rejoinBtn.textContent = 'Rejoin room ' + cand.code;
    if (v === null || !inRoom) return;
    codeBig.textContent = v.code ?? '—';
    codeHint.textContent = v.role === 'host'
      ? (v.tier === 'lan' ? 'Give this code to the other player. They join over the signal server.' : 'Give this code to the other tab of this browser.')
      : v.phase === 'joining' ? 'Joining…' : 'In the room. Mark ready; the host starts.';
    drawRoster(v);
    const me = v.roster.find((r) => r.id === v.selfId);
    ready.checked = me?.ready ?? false;
    ready.disabled = v.phase !== 'lobby';
    const isHost = v.role === 'host';
    startBtn.classList.toggle('aa-hidden', !isHost);
    rulesRow.classList.toggle('aa-hidden', !isHost);
    rulesLine.textContent = isHost ? rulesText() + (v.hostBots > 0 ? ` · ${v.hostBots} bots` : '') : '';
    startBtn.disabled = v.startRefusal !== null;
    startWhy.textContent = isHost && v.startLabel !== null ? v.startLabel : '';
    status.textContent = v.phase === 'starting' ? 'Starting…' : v.phase === 'playing' ? 'Match live.' : v.linkOk ? '' : 'LINK DOWN - is the signal server running?';
  }

  refresh();
  return { root, refresh };
}
