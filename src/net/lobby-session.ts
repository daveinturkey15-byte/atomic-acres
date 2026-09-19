/**
 * Nuketown 2025 — the room lifecycle for the local seat, with no DOM in it.
 *
 * Host a room or join one by code, over one of two links:
 *   tabs  BroadcastChannel — two tabs of the same browser profile, no server.
 *   lan   WebRTC data channels, signalled through `scripts/net-signal.mjs` —
 *         two browsers, two machines on one network.
 *
 * Everything the old `ui/lobby.ts` decided (which transport, what the status
 * line says, when a rejected guest is torn down) lives here as data the menu
 * renders; the menu only draws `view()` and calls the verbs. Every verb that
 * can refuse returns a reason from a frozen list with a label beside it
 * (IMPORT-PLAN §5.4).
 *
 * REJOIN. On `welcome` the guest's seat credential is saved (session storage
 * for a reload, local storage for a closed tab) with the room code and the
 * link it used. `rejoinCandidate()` offers it back inside `REJOIN_GRACE_MS`;
 * `join()` on that code presents it and the host resumes the seat — the idea
 * of the old `room-rejoin-identity.ts`, at a tenth of the size.
 */
import { LOBBY_START_LABELS, REJOIN_GRACE_MS, type LobbyStartRefusal } from '../game/rules';
import { REJECT_LABELS, createJoinCode, isJoinCode, type RejectReason, type ResumeClaim, type RosterEntry } from './protocol';
import { GuestClient, HostRoom } from './room';
import { createRtcTransport, rtcAvailable, type RtcTransport } from './rtc';
import { createLocalTransport, type Transport } from './transport';

export type LinkTier = 'tabs' | 'lan';
export const LINK_TIERS: readonly LinkTier[] = Object.freeze(['tabs', 'lan'] as const);
export const LINK_LABELS: Readonly<Record<LinkTier, string>> = Object.freeze({
  tabs: 'Same browser (two tabs)',
  lan: 'Network (signal server)',
});
export function isLinkTier(v: unknown): v is LinkTier {
  return v === 'tabs' || v === 'lan';
}
/** `scripts/net-signal.mjs` default. Above 4300, per the machine's port courtesy. */
export const DEFAULT_SIGNAL_URL = 'http://127.0.0.1:4310';

export const LOBBY_REFUSALS = ['bad-code', 'in-room', 'no-broadcast-channel', 'no-webrtc', 'bad-signal-url'] as const;
export type LobbyRefusal = (typeof LOBBY_REFUSALS)[number];
export const LOBBY_REFUSAL_LABELS: Readonly<Record<LobbyRefusal, string>> = Object.freeze({
  'bad-code': 'CODES ARE 6 LETTERS OR DIGITS',
  'in-room': 'LEAVE THE CURRENT ROOM FIRST',
  'no-broadcast-channel': 'THIS BROWSER HAS NO BROADCASTCHANNEL',
  'no-webrtc': 'THIS BROWSER HAS NO WEBRTC',
  'bad-signal-url': 'SIGNAL SERVER ADDRESS IS NOT A URL',
});

export type LobbyRole = 'idle' | 'host' | 'guest';
export type LobbyPhaseView = 'idle' | 'joining' | 'lobby' | 'starting' | 'playing';

export interface LobbyView {
  readonly role: LobbyRole;
  readonly phase: LobbyPhaseView;
  readonly tier: LinkTier;
  readonly code: string | null;
  readonly selfId: string | null;
  readonly roster: readonly RosterEntry[];
  /** Host only: why Start is refused right now, or null. */
  readonly startRefusal: LobbyStartRefusal | null;
  readonly startLabel: string | null;
  /** The last refusal or disconnect, as a label. Cleared by the next verb. */
  readonly error: string | null;
  readonly hostBots: number;
  readonly capacity: number;
  /** Link health: peers up on the LAN tier; always true on tabs. */
  readonly linkOk: boolean;
}

export interface HostArgs { name: string; tier: LinkTier; signalUrl?: string; capacity?: number; bots?: number }
export interface JoinArgs { name: string; tier: LinkTier; signalUrl?: string }
export interface RejoinCandidate { code: string; name: string; tier: LinkTier; signalUrl: string }

interface SavedIdentity extends RejoinCandidate, ResumeClaim { savedAt: number }

const IDENTITY_KEY = 'atomic-acres:room-identity';

function readStore(s: Storage | null): SavedIdentity | null {
  try {
    const raw = s?.getItem(IDENTITY_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedIdentity>;
    if (!isJoinCode(v.code) || typeof v.playerId !== 'string' || typeof v.token !== 'string' ||
        typeof v.savedAt !== 'number' || !isLinkTier(v.tier)) return null;
    return {
      code: v.code, playerId: v.playerId, token: v.token, savedAt: v.savedAt, tier: v.tier,
      name: typeof v.name === 'string' ? v.name : 'player',
      signalUrl: typeof v.signalUrl === 'string' ? v.signalUrl : DEFAULT_SIGNAL_URL,
    };
  } catch {
    return null;
  }
}

function storage(kind: 'session' | 'local'): Storage | null {
  try {
    return kind === 'session' ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

export class LobbySession {
  private readonly now: () => number;
  private room: HostRoom | null = null;
  private guest: GuestClient | null = null;
  private transport: Transport | null = null;
  private rtc: RtcTransport | null = null;
  private tier: LinkTier = 'tabs';
  private bots = 0;
  private error: string | null = null;
  private listener: (() => void) | null = null;
  private joinName = 'player';

  constructor(opts: { now: () => number }) {
    this.now = opts.now;
  }

  onChange(fn: (() => void) | null): void { this.listener = fn; }
  private changed(): void { this.listener?.(); }

  hostRoom(): HostRoom | null { return this.room; }
  guestClient(): GuestClient | null { return this.guest; }
  active(): boolean { return this.room !== null || this.guest !== null; }
  started(): boolean {
    if (this.room !== null) return this.room.getPhase() !== 'lobby';
    if (this.guest !== null) {
      const s = this.guest.getState();
      return s === 'starting' || s === 'playing';
    }
    return false;
  }
  hostBots(): number { return this.bots; }
  setHostBots(n: number): void {
    this.bots = Math.max(0, Math.min(7, Math.round(n)));
    this.changed();
  }

  /** A seat this browser held recently, if the grace has not run out. */
  rejoinCandidate(): RejoinCandidate | null {
    const v = readStore(storage('session')) ?? readStore(storage('local'));
    if (v === null || Date.now() - v.savedAt >= REJOIN_GRACE_MS) return null;
    return { code: v.code, name: v.name, tier: v.tier, signalUrl: v.signalUrl };
  }

  private link(role: 'host' | 'guest', code: string, tier: LinkTier, signalUrl: string | undefined): LobbyRefusal | null {
    const id = role === 'host' ? 'host' : 'g-' + createJoinCode().toLowerCase();
    if (tier === 'lan') {
      if (!rtcAvailable()) return 'no-webrtc';
      const url = (signalUrl ?? DEFAULT_SIGNAL_URL).trim();
      try {
        new URL(url);
      } catch {
        return 'bad-signal-url';
      }
      this.rtc = createRtcTransport({ role, code, signalUrl: url, localId: id });
      this.transport = this.rtc;
      return null;
    }
    try {
      this.transport = createLocalTransport(id, 'nuketown-lobby-' + code);
    } catch {
      return 'no-broadcast-channel';
    }
    return null;
  }

  host(a: HostArgs): LobbyRefusal | null {
    if (this.active()) return 'in-room';
    this.error = null;
    const code = createJoinCode();
    const refusal = this.link('host', code, a.tier, a.signalUrl);
    if (refusal !== null) {
      this.error = LOBBY_REFUSAL_LABELS[refusal];
      this.changed();
      return refusal;
    }
    this.tier = a.tier;
    this.bots = Math.max(0, Math.min(7, a.bots ?? 0));
    this.room = new HostRoom(this.transport as Transport, {
      hostName: a.name, code, now: this.now, capacity: a.capacity, onChange: () => this.changed(),
    });
    this.room.startAuto();
    this.changed();
    return null;
  }

  join(codeRaw: string, a: JoinArgs): LobbyRefusal | null {
    if (this.active()) return 'in-room';
    this.error = null;
    const code = codeRaw.trim().toUpperCase();
    if (!isJoinCode(code)) {
      this.error = LOBBY_REFUSAL_LABELS['bad-code'];
      this.changed();
      return 'bad-code';
    }
    const refusal = this.link('guest', code, a.tier, a.signalUrl);
    if (refusal !== null) {
      this.error = LOBBY_REFUSAL_LABELS[refusal];
      this.changed();
      return refusal;
    }
    this.tier = a.tier;
    this.joinName = a.name;
    const saved = readStore(storage('session')) ?? readStore(storage('local'));
    const resume = saved !== null && saved.code === code && Date.now() - saved.savedAt < REJOIN_GRACE_MS
      ? { playerId: saved.playerId, token: saved.token }
      : null;
    const signalUrl = (a.signalUrl ?? DEFAULT_SIGNAL_URL).trim();
    // The LAN handshake (SSE subscribe, offer, answer, ICE) needs a few seconds
    // more than two tabs on one channel do.
    const joinTimeoutMs = a.tier === 'lan' ? 15_000 : 6_000;
    this.guest = new GuestClient(this.transport as Transport, 'host', code, a.name, {
      now: this.now, resume, joinTimeoutMs,
      onChange: () => this.onGuestChange(code, signalUrl),
    });
    this.guest.startAutoPing();
    this.changed();
    return null;
  }

  private onGuestChange(code: string, signalUrl: string): void {
    const g = this.guest;
    if (g === null) return;
    const st = g.getState();
    if (st === 'lobby') {
      const id = g.identity();
      if (id !== null) this.saveIdentity({ ...id, code, name: this.joinName, tier: this.tier, signalUrl, savedAt: Date.now() });
    } else if (st === 'rejected' || st === 'closed') {
      const r = g.getRejectReason();
      this.error = r === null ? 'DISCONNECTED'
        : r === 'timeout' ? 'NO HOST ANSWERED - IS THE ROOM OPEN?'
        : r === 'host-left' ? 'HOST LEFT THE ROOM'
        : REJECT_LABELS[r as RejectReason];
      this.teardown(r !== 'host-left');
    }
    this.changed();
  }

  private saveIdentity(v: SavedIdentity): void {
    const s = JSON.stringify(v);
    try { sessionStorage.setItem(IDENTITY_KEY, s); } catch { /* best effort */ }
    try { localStorage.setItem(IDENTITY_KEY, s); } catch { /* best effort */ }
  }

  private clearIdentity(): void {
    try { sessionStorage.removeItem(IDENTITY_KEY); } catch { /* best effort */ }
    try { localStorage.removeItem(IDENTITY_KEY); } catch { /* best effort */ }
  }

  setReady(v: boolean): void {
    this.room?.setReady(v);
    this.guest?.setReady(v);
  }

  /** Host only. Returns the refusal (`LOBBY_START_LABELS`), or null when the countdown began. */
  start(): LobbyStartRefusal | null {
    if (this.room === null) return 'not-in-lobby';
    const r = this.room.start();
    this.error = r === null ? null : LOBBY_START_LABELS[r];
    this.changed();
    return r;
  }

  private teardown(forgetSeat: boolean): void {
    this.guest?.dispose();
    this.room?.dispose();
    this.transport?.close();
    this.guest = null;
    this.room = null;
    this.transport = null;
    this.rtc = null;
    if (forgetSeat) this.clearIdentity();
  }

  /** Deliberate leave: the seat is released and the credential forgotten. */
  leave(): void {
    if (!this.active()) return;
    this.teardown(true);
    this.error = null;
    this.changed();
  }

  view(): LobbyView {
    const room = this.room;
    const guest = this.guest;
    const refusal = room === null ? null : room.startRefusal();
    let phase: LobbyPhaseView = 'idle';
    if (room !== null) phase = room.getPhase();
    else if (guest !== null) {
      const s = guest.getState();
      phase = s === 'joining' ? 'joining' : s === 'lobby' ? 'lobby' : s === 'starting' ? 'starting' : s === 'playing' ? 'playing' : 'idle';
    }
    return {
      role: room !== null ? 'host' : guest !== null ? 'guest' : 'idle',
      phase,
      tier: this.tier,
      code: room?.code ?? null,
      selfId: room?.hostId ?? guest?.getPlayerId() ?? null,
      roster: room?.roster() ?? guest?.roster() ?? [],
      startRefusal: refusal,
      startLabel: refusal === null ? null : LOBBY_START_LABELS[refusal],
      error: this.error,
      hostBots: this.bots,
      capacity: room?.capacity ?? 6,
      linkOk: this.rtc === null ? true : this.rtc.stats().signalOk || this.rtc.peerCount() > 0,
    };
  }

  /** One diagnostics line for the overlay, or null when idle. */
  netLine(now: number): string | null {
    const d = this.room?.diag ?? this.guest?.diag ?? null;
    if (d === null) return null;
    const s = d.snapshot(now);
    const rtt = s.rttMs === null ? '--' : s.rttMs.toFixed(0);
    const age = s.ageN === 0 ? '--/--' : s.ageP50.toFixed(0) + '/' + s.ageP95.toFixed(0);
    const link = this.rtc === null ? this.tier : `lan peers ${this.rtc.peerCount()} drop ${this.rtc.stats().dropped}`;
    return `${s.role} · rtt ${rtt} ms · snap ${s.tickHz.toFixed(1)} Hz · age p50/p95 ${age} ms · corr ${s.correctionsPerSec}/s · in ${s.inputsAccepted}/${s.inputsRejected} ok/rej · ${link}`;
  }

  dispose(): void {
    this.teardown(false);
    this.listener = null;
  }
}
