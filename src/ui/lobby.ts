/**
 * Nuketown 2025 — multiplayer lobby panel.
 *
 * Owns the whole room lifecycle for the local seat: host a room (join code +
 * roster + ready + start) or join one by code, over the same-machine
 * BroadcastChannel transport — host in one tab, guest in another, no server.
 * Headless guests/hosts for the proof harness live in src/net/proof.ts; this
 * file is the human half and touches only DOM.
 *
 * Mounts inside #hud so captures hide it automatically. All names render via
 * textContent, never innerHTML. The diagnostics interval and any rAF loop are
 * owned here and torn down in dispose() and on leave.
 */
import './lobby.css';
import { createJoinCode, isJoinCode } from '../net/protocol';
import { GuestClient, HostRoom } from '../net/room';
import { createLocalTransport, type Transport } from '../net/transport';

export interface LocalPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface LobbyOptions {
  /** Sampled every frame while hosting to drive the host's own seat. */
  sampleLocalPose?: () => LocalPose | null;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function initLobby(opts?: LobbyOptions): { dispose(): void } {
  const hud = document.getElementById('hud');
  if (!hud) return { dispose: () => undefined };

  const samplePose = opts?.sampleLocalPose ?? null;
  let host: HostRoom | null = null;
  let guest: GuestClient | null = null;
  let transport: Transport | null = null;
  let diagTimer: number | null = null;
  let driveRaf = 0;
  let disposed = false;

  // -- static chrome ---------------------------------------------------------
  const btn = el('button', 'nt-lobby-btn', 'MP lobby');
  const panel = el('div', 'nt-lobby nt-lobby-hidden');
  const title = el('h2', '', 'MULTIPLAYER');
  const status = el('div', 'nt-status', 'Host a room or join by code. Same machine, two tabs, no server.');
  const netline = el('div', 'nt-net', '');
  panel.append(title);
  const body = el('div', '');
  panel.append(body, status, netline);
  hud.append(btn, panel);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.classList.toggle('nt-lobby-hidden');
  });

  function setStatus(text: string, isError: boolean): void {
    status.textContent = text;
    status.classList.toggle('nt-error', isError);
  }

  function stopLoops(): void {
    if (diagTimer !== null) {
      clearInterval(diagTimer);
      diagTimer = null;
    }
    if (driveRaf !== 0) {
      cancelAnimationFrame(driveRaf);
      driveRaf = 0;
    }
  }

  function leaveRoom(quiet: boolean): void {
    stopLoops();
    if (guest) {
      guest.dispose();
      guest = null;
    }
    if (host) {
      host.dispose();
      host = null;
    }
    if (transport) {
      transport.close();
      transport = null;
    }
    netline.textContent = '';
    if (!quiet) {
      setStatus('Left the room.', false);
      renderIdle();
    }
  }

  function startDiag(): void {
    stopLoops();
    const update = (): void => {
      if (host) netline.textContent = host.diag.line(Date.now());
      else if (guest) netline.textContent = guest.diag.line(Date.now());
    };
    update();
    diagTimer = setInterval(update, 250);
  }

  function startDrive(): void {
    if (!samplePose) return;
    const frame = (): void => {
      if (disposed || !host) return;
      try {
        const p = samplePose();
        if (p) host.driveHostSeat(p.x, p.y, p.z, p.yaw);
      } catch {
        /* sampler reads live player state; never let it break the loop. */
      }
      driveRaf = requestAnimationFrame(frame);
    };
    driveRaf = requestAnimationFrame(frame);
  }

  function rosterList(into: HTMLElement, entries: { id: string; name: string; ready: boolean; isHost: boolean }[], me: string | null): void {
    const ul = el('ul', '');
    for (const r of entries) {
      const mark = r.ready ? '●' : '○';
      const li = el('li', r.id === me ? 'nt-me' : '', `${mark} ${r.name}${r.isHost ? ' (host)' : ''}`);
      li.classList.add(r.ready ? 'nt-ready' : 'nt-notready');
      ul.append(li);
    }
    into.append(ul);
  }

  // -- views -----------------------------------------------------------------
  function clearBody(): void {
    body.replaceChildren();
  }

  function nameRow(defaultName: string): HTMLInputElement {
    const row = el('div', 'nt-row');
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 16;
    input.value = defaultName;
    input.className = 'nt-name';
    input.placeholder = 'callsign';
    input.setAttribute('aria-label', 'callsign');
    row.append(input);
    body.append(row);
    return input;
  }

  function renderIdle(): void {
    clearBody();
    const nameInput = nameRow('player');
    const row = el('div', 'nt-row');
    const hostBtn = el('button', '', 'Host room');
    const codeInput = document.createElement('input');
    codeInput.type = 'text';
    codeInput.maxLength = 6;
    codeInput.placeholder = 'CODE';
    codeInput.setAttribute('aria-label', 'join code');
    const joinBtn = el('button', '', 'Join');
    row.append(hostBtn, codeInput, joinBtn);
    body.append(row);

    hostBtn.addEventListener('click', () => {
      doHost(nameInput.value.trim() || 'player');
    });
    joinBtn.addEventListener('click', () => {
      const code = codeInput.value.trim().toUpperCase();
      if (!isJoinCode(code)) {
        setStatus('Codes are 6 letters/digits — check with the host.', true);
        return;
      }
      doJoin(code, nameInput.value.trim() || 'player');
    });
  }

  function doHost(name: string): void {
    leaveRoom(true);
    // The channel name embeds the code so a second tab can find this room.
    // The code is minted first and handed to the room, never read back.
    const code = createJoinCode();
    try {
      transport = createLocalTransport('host', 'nuketown-lobby-' + code);
    } catch {
      setStatus('Hosting needs BroadcastChannel (two tabs, same browser).', true);
      return;
    }
    host = new HostRoom(transport, { hostName: name, code, onChange: renderHost });
    host.startAuto();
    startDiag();
    startDrive();
    setStatus('Room open in this tab. Guests: open tab 2, enter the code.', false);
    renderHost();
  }

  function doJoin(code: string, name: string): void {
    leaveRoom(true);
    const gid = 'g-' + Math.random().toString(36).slice(2, 8);
    try {
      transport = createLocalTransport(gid, 'nuketown-lobby-' + code);
    } catch {
      setStatus('Joining needs BroadcastChannel (same browser).', true);
      return;
    }
    setStatus('Joining ' + code + '…', false);
    const t = transport;
    guest = new GuestClient(t, 'host', code, name, {
      onChange: () => {
        const g = guest;
        if (!g) return;
        if (g.getState() === 'rejected') {
          setStatus('Host refused: ' + (g.getRejectReason() ?? 'unknown') + '.', true);
          const dead = g;
          guest = null;
          dead.dispose();
          t.close();
          transport = null;
          renderIdle();
          return;
        }
        if (g.getState() === 'closed' && g.getRejectReason() === 'timeout') {
          setStatus('No host answered — is the host tab open with this code?', true);
          guest = null;
          g.dispose();
          t.close();
          transport = null;
          renderIdle();
          return;
        }
        renderGuest();
      },
    });
    guest.startAutoPing();
    startDiag();
    renderGuest();
  }

  function renderHost(): void {
    if (!host) {
      renderIdle();
      return;
    }
    clearBody();
    const code = el('div', 'nt-code', host.code);
    body.append(code);
    rosterList(body, host.roster(), host.hostId);

    const row = el('div', 'nt-row');
    const label = document.createElement('label');
    label.className = 'nt-check';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = host.roster().find((r) => r.id === host!.hostId)?.ready ?? false;
    check.addEventListener('change', () => host!.setReady(check.checked));
    label.append(check, document.createTextNode('ready'));
    const start = el('button', '', host.getPhase() === 'lobby' ? 'Start match' : 'Playing…');
    start.disabled = !host.canStart();
    start.addEventListener('click', () => {
      if (!host!.start()) setStatus('Need 2+ seats, all ready.', true);
      else setStatus('Match started.', false);
      renderHost();
    });
    const leave = el('button', '', 'Leave');
    leave.addEventListener('click', () => leaveRoom(false));
    row.append(label, start, leave);
    body.append(row);
    if (host.getPhase() !== 'lobby') setStatus('Match live — scoreboard and kill rules arrive with the gameplay lane.', false);
  }

  function renderGuest(): void {
    if (!guest) {
      renderIdle();
      return;
    }
    clearBody();
    const g = guest;
    rosterList(body, g.roster(), g.getPlayerId());
    const row = el('div', 'nt-row');
    const label = document.createElement('label');
    label.className = 'nt-check';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = g.roster().find((r) => r.id === g.getPlayerId())?.ready ?? false;
    check.disabled = g.getState() !== 'lobby';
    check.addEventListener('change', () => g.setReady(check.checked));
    label.append(check, document.createTextNode('ready'));
    const leave = el('button', '', 'Leave');
    leave.addEventListener('click', () => leaveRoom(false));
    row.append(label, leave);
    body.append(row);
    const st = g.getState();
    if (st === 'joining') setStatus('Joining…', false);
    else if (st === 'lobby') setStatus('In lobby. Mark ready; the host starts.', false);
    else if (st === 'starting' || st === 'playing') setStatus('Match live — guest locomotion lands with the gameplay lane.', false);
    else if (st === 'closed') setStatus('Host left.', true);
  }

  renderIdle();

  return {
    dispose(): void {
      disposed = true;
      leaveRoom(true);
      btn.remove();
      panel.remove();
    },
  };
}
