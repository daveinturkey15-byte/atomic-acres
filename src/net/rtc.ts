/**
 * Nuketown 2025 — the cross-browser transport: WebRTC data channels, with the
 * offer/answer/ICE exchange carried by a tiny HTTP signalling relay
 * (`scripts/net-signal.mjs`, SSE down / POST up, no dependencies, no account).
 *
 * This is the `connectSignaling` seam `transport.ts` left open, filled in the
 * shape it promised: the same `Transport` interface, so `HostRoom` and
 * `GuestClient` cannot tell it from the loopback pair or the BroadcastChannel.
 * Convention unchanged: the host listens as peer id `'host'`; guests pick a
 * random `'g-…'` id.
 *
 * TWO CHANNELS PER PEER. `ctl` is reliable and ordered (hello, roster, start,
 * shots, kills — a lost one is a lost fact); `fast` is unordered with zero
 * retransmits (inputs, state — a late one is worthless and the next one
 * supersedes it). Messages route by type. Until a channel opens, sends queue
 * (bounded) and flush on open; a peer that never opens drops its queue.
 *
 * SIGNALLING ONLY CARRIES SDP AND ICE. Once the channels are up the relay
 * sees nothing; it can go away and the match continues. The guest offers,
 * the host answers — the guest knows who it wants to talk to and the host
 * learns of a guest by its offer. No STUN/TURN: host candidates only, which is
 * the LAN / same-machine tier this build proves; a WAN tier adds an
 * `iceServers` list here and nothing else.
 */
import type { NetMessage } from './protocol';
import type { PeerId, Transport, TransportHandler } from './transport';

export interface RtcOptions {
  readonly role: 'host' | 'guest';
  readonly code: string;
  readonly signalUrl: string;
  readonly localId: PeerId;
}

export interface RtcStats {
  sent: number;
  received: number;
  /** Sends dropped because a peer's queue overflowed before its channel opened. */
  dropped: number;
  /** Malformed frames ignored. */
  bad: number;
  peers: number;
  signalOk: boolean;
}

export interface RtcTransport extends Transport {
  stats(): Readonly<RtcStats>;
  /** Open channels right now. A host with no guests reads 0. */
  peerCount(): number;
}

/** Message types that ride the unreliable channel. Everything else is reliable. */
const FAST_TYPES: ReadonlySet<string> = new Set(['input', 'state']);
/** Queued sends per peer before its channel opens; oldest dropped past it. */
const QUEUE_CAP = 256;

interface Peer {
  pc: RTCPeerConnection;
  ctl: RTCDataChannel | null;
  fast: RTCDataChannel | null;
  queue: string[];
}

interface Signal {
  from: string;
  payload: { kind: 'offer' | 'answer'; sdp: string } | { kind: 'ice'; candidate: RTCIceCandidateInit | null };
}

/** True when this runtime can build the transport at all. */
export function rtcAvailable(): boolean {
  return typeof RTCPeerConnection === 'function' && typeof EventSource === 'function' && typeof fetch === 'function';
}

export function createRtcTransport(opts: RtcOptions): RtcTransport {
  if (!rtcAvailable()) throw new Error('[net] WebRTC or EventSource unavailable in this runtime');
  const base = opts.signalUrl.replace(/\/+$/, '');
  const peers = new Map<PeerId, Peer>();
  const handlers = new Set<TransportHandler>();
  const stats: RtcStats = { sent: 0, received: 0, dropped: 0, bad: 0, peers: 0, signalOk: false };
  let closed = false;

  const post = (to: PeerId, payload: Signal['payload']): void => {
    // text/plain keeps this a "simple" request: no preflight round trip per
    // candidate, and the relay answers with a permissive origin header.
    void fetch(base + '/signal', {
      method: 'POST',
      body: JSON.stringify({ code: opts.code, from: opts.localId, to, payload }),
    }).then(() => { stats.signalOk = true; }).catch(() => { stats.signalOk = false; });
  };

  const deliver = (from: PeerId, raw: string): void => {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      stats.bad += 1;
      return;
    }
    if (!msg || typeof msg !== 'object') {
      stats.bad += 1;
      return;
    }
    stats.received += 1;
    // Receive boundary lives in the room (isNetMessage); transport only routes.
    for (const h of handlers) h(from, msg as NetMessage);
  };

  const attach = (id: PeerId, p: Peer, ch: RTCDataChannel): void => {
    if (ch.label === 'fast') p.fast = ch;
    else p.ctl = ch;
    ch.onmessage = (ev) => {
      if (!closed && typeof ev.data === 'string') deliver(id, ev.data);
    };
    ch.onopen = () => {
      if (ch.label !== 'ctl') return;
      stats.peers = countOpen();
      const q = p.queue;
      p.queue = [];
      for (const s of q) ch.send(s);
    };
    ch.onclose = () => {
      stats.peers = countOpen();
    };
  };

  const countOpen = (): number => {
    let n = 0;
    for (const p of peers.values()) if (p.ctl !== null && p.ctl.readyState === 'open') n++;
    return n;
  };

  const newPeer = (id: PeerId): Peer => {
    const pc = new RTCPeerConnection({ iceServers: [] });
    const p: Peer = { pc, ctl: null, fast: null, queue: [] };
    peers.set(id, p);
    pc.onicecandidate = (ev) => post(id, { kind: 'ice', candidate: ev.candidate === null ? null : ev.candidate.toJSON() });
    pc.ondatachannel = (ev) => attach(id, p, ev.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        p.queue.length = 0;
        stats.peers = countOpen();
      }
    };
    return p;
  };

  /** Guest side: build the channels and offer to the host. */
  const offer = async (): Promise<void> => {
    const p = newPeer('host');
    attach('host', p, p.pc.createDataChannel('ctl', { ordered: true }));
    attach('host', p, p.pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
    const sdp = await p.pc.createOffer();
    await p.pc.setLocalDescription(sdp);
    post('host', { kind: 'offer', sdp: sdp.sdp ?? '' });
  };

  const onSignal = async (s: Signal): Promise<void> => {
    if (closed) return;
    const from = s.from;
    const pl = s.payload;
    if (pl.kind === 'offer') {
      if (opts.role !== 'host') return;
      const old = peers.get(from);
      if (old !== undefined) old.pc.close();
      const p = newPeer(from);
      await p.pc.setRemoteDescription({ type: 'offer', sdp: pl.sdp });
      const answer = await p.pc.createAnswer();
      await p.pc.setLocalDescription(answer);
      post(from, { kind: 'answer', sdp: answer.sdp ?? '' });
      return;
    }
    const p = peers.get(from);
    if (p === undefined) return;
    if (pl.kind === 'answer') {
      await p.pc.setRemoteDescription({ type: 'answer', sdp: pl.sdp });
    } else if (pl.kind === 'ice' && pl.candidate !== null) {
      try {
        await p.pc.addIceCandidate(pl.candidate);
      } catch {
        /* a candidate for a description that already settled; harmless. */
      }
    }
  };

  const events = new EventSource(`${base}/events?code=${encodeURIComponent(opts.code)}&peer=${encodeURIComponent(opts.localId)}`);
  events.onopen = () => { stats.signalOk = true; };
  events.onerror = () => { stats.signalOk = false; };
  events.onmessage = (ev) => {
    let s: unknown;
    try {
      s = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (!s || typeof s !== 'object' || typeof (s as Signal).from !== 'string') return;
    void onSignal(s as Signal).catch(() => undefined);
  };
  if (opts.role === 'guest') {
    // Offer once the relay has us: an offer posted before the SSE subscription
    // exists would have its answer delivered to nobody.
    events.addEventListener('ready', () => { void offer().catch(() => undefined); });
  }

  return {
    localId: opts.localId,
    get closed() {
      return closed;
    },
    send(to: PeerId, msg: NetMessage): void {
      if (closed) return;
      const p = peers.get(to);
      if (p === undefined) return;
      const s = JSON.stringify(msg);
      const fast = FAST_TYPES.has(msg.type) ? p.fast : null;
      const ch = fast !== null && fast.readyState === 'open' ? fast : p.ctl;
      if (ch !== null && ch.readyState === 'open') {
        try {
          ch.send(s);
          stats.sent += 1;
        } catch {
          stats.dropped += 1;
        }
        return;
      }
      if (fast !== null) return; // a fast message with no open channel is worthless late
      if (p.queue.length >= QUEUE_CAP) {
        p.queue.shift();
        stats.dropped += 1;
      }
      p.queue.push(s);
    },
    onMessage(handler: TransportHandler): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    close(): void {
      if (closed) return;
      closed = true;
      handlers.clear();
      events.close();
      for (const p of peers.values()) {
        p.ctl?.close();
        p.fast?.close();
        p.pc.close();
      }
      peers.clear();
      stats.peers = 0;
    },
    stats: () => stats,
    peerCount: countOpen,
  };
}
