/**
 * Nuketown 2025 — net transport abstraction.
 *
 * Everything above this file (rooms, snapshots, lobby) speaks only the
 * Transport interface, so the whole stack runs with no network at all on the
 * loopback pair. A real signaling/WebRTC channel can sit behind the same
 * interface later; the seam is `connectSignaling()`, deliberately left
 * unimplemented rather than half-built.
 *
 * Leak contract: the loopback uses one-shot setTimeout deliveries in auto mode
 * and explicit pump() in manual mode. There is no interval anywhere in this
 * file, so a closed transport can only leave behind deliveries that were
 * already queued — each fires once, sees `closed`, and drops its message.
 */
import type { NetMessage } from './protocol';

export type PeerId = string;
export type TransportHandler = (from: PeerId, msg: NetMessage) => void;

export interface Transport {
  readonly localId: PeerId;
  readonly closed: boolean;
  send(to: PeerId, msg: NetMessage): void;
  /** Returns an unsubscribe function. Rooms MUST call it in dispose(). */
  onMessage(handler: TransportHandler): () => void;
  close(): void;
}

export interface Impairment {
  /** One-way base latency added to every delivery, ms. */
  latencyMs: number;
  /** Symmetric jitter: delay = latency + (rng*2-1)*jitter, clamped >= 0. */
  jitterMs: number;
  /** Fraction of messages dropped, in [0, 1). */
  lossRate: number;
}

export const CLEAN_LINK: Impairment = { latencyMs: 0, jitterMs: 0, lossRate: 0 };
/**
 * Rough LAN stand-in for proof runs: 40 ms one-way with +/-20 ms jitter and
 * 1% loss. Same order as the predecessor's `normal` chaos profile
 * (40/20/0.01 in atomic-acres network-chaos.ts), minus duplication/reorder
 * which that project's matrix showed rarely changed lobby outcomes.
 */
export const NORMAL_LINK: Impairment = { latencyMs: 40, jitterMs: 20, lossRate: 0.01 };

/** Upper bound on queued manual-mode deliveries; oldest is dropped past it. */
const LINK_QUEUE_CAP = 512;

/** FNV-1a string hash: seeds the deterministic rng from a readable seed. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: small deterministic rng for impairment, never Math.random. */
export function mulberry32(state: number): () => number {
  let a = state >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface QueuedDelivery {
  at: number;
  to: PeerId;
  from: PeerId;
  msg: NetMessage;
}

export interface LoopbackControls {
  /** Virtual clock, ms. Advanced by pump() in manual mode. */
  now: number;
  /** Deliver everything due at or before nowMs (manual mode). */
  pump(nowMs: number): void;
  setImpairment(next: Impairment): void;
  pending(): number;
  stats(): { sent: number; delivered: number; droppedLoss: number; droppedClosed: number };
}

/**
 * One end of a loopback pair. Delivery is intentionally ASYNC (never inline):
 * inline delivery would let host and guest recurse through each other's
 * handlers, which no real transport ever does and which hides re-entrancy bugs.
 */
class LoopbackTransport implements Transport {
  readonly localId: PeerId;
  closed = false;
  private handlers = new Set<TransportHandler>();

  constructor(
    localId: PeerId,
    private readonly link: LoopbackLink,
  ) {
    this.localId = localId;
  }

  send(to: PeerId, msg: NetMessage): void {
    if (this.closed) return;
    this.link.transmit(this.localId, to, msg);
  }

  onMessage(handler: TransportHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  receive(from: PeerId, msg: NetMessage): void {
    if (this.closed) return;
    for (const h of this.handlers) h(from, msg);
  }

  close(): void {
    this.closed = true;
    this.handlers.clear();
  }
}

class LoopbackLink {
  now = 0;
  auto: boolean;
  impairment: Impairment;
  readonly rng: () => number;
  readonly queue: QueuedDelivery[] = [];
  private readonly endpoints = new Map<PeerId, LoopbackTransport>();
  sent = 0;
  delivered = 0;
  droppedLoss = 0;
  droppedClosed = 0;

  constructor(seed: number, impairment: Impairment, auto: boolean) {
    this.rng = mulberry32(seed);
    this.impairment = { ...impairment };
    this.auto = auto;
  }

  attach(id: PeerId): LoopbackTransport {
    const t = new LoopbackTransport(id, this);
    this.endpoints.set(id, t);
    return t;
  }

  transmit(from: PeerId, to: PeerId, msg: NetMessage): void {
    this.sent += 1;
    const imp = this.impairment;
    if (this.rng() < imp.lossRate) {
      this.droppedLoss += 1;
      return;
    }
    const jitter = (this.rng() * 2 - 1) * Math.max(0, imp.jitterMs);
    const delay = Math.max(0, imp.latencyMs + jitter);
    if (this.auto) {
      const target = this.endpoints.get(to);
      setTimeout(() => {
        if (!target || target.closed) {
          this.droppedClosed += 1;
          return;
        }
        this.delivered += 1;
        target.receive(from, msg);
      }, delay);
      return;
    }
    if (this.queue.length >= LINK_QUEUE_CAP) this.queue.shift();
    this.queue.push({ at: this.now + delay, to, from, msg });
    // Stable order for equal timestamps keeps proof runs deterministic.
    this.queue.sort((a, b) => a.at - b.at);
  }

  pump(nowMs: number): void {
    this.now = nowMs;
    while (this.queue.length > 0 && this.queue[0].at <= nowMs) {
      const d = this.queue.shift()!;
      const target = this.endpoints.get(d.to);
      if (!target || target.closed) {
        this.droppedClosed += 1;
        continue;
      }
      this.delivered += 1;
      target.receive(d.from, d.msg);
    }
  }
}

export interface LoopbackPair {
  a: Transport;
  b: Transport;
  link: LoopbackControls;
}

/**
 * Two transports wired to each other. Pass `auto: false` for virtual-time
 * proof runs (drive time with link.pump); the default `auto: true` delivers
 * over real setTimeout delays for the live lobby panel.
 */
export function createLoopbackPair(opts?: {
  seed?: string | number;
  impairment?: Impairment;
  auto?: boolean;
}): LoopbackPair {
  const seed = typeof opts?.seed === 'number' ? opts.seed : hashSeed(String(opts?.seed ?? 'nuketown'));
  const link = new LoopbackLink(seed, opts?.impairment ?? { ...CLEAN_LINK }, opts?.auto ?? true);
  const a = link.attach('peer-a');
  const b = link.attach('peer-b');
  const controls: LoopbackControls = {
    get now() {
      return link.now;
    },
    set now(v: number) {
      link.now = v;
    },
    pump: (nowMs: number) => link.pump(nowMs),
    setImpairment: (next: Impairment) => {
      link.impairment = { ...next };
    },
    pending: () => link.queue.length,
    stats: () => ({
      sent: link.sent,
      delivered: link.delivered,
      droppedLoss: link.droppedLoss,
      droppedClosed: link.droppedClosed,
    }),
  };
  return { a, b, link: controls };
}

/**
 * WebRTC/signaling seam. NOT implemented this pass on purpose: the loopback
 * proves the whole stack above the transport, and a half-built data-channel
 * that only works on localhost would rot. When it lands it must return this
 * same Transport interface so rooms, snapshots and the lobby do not change.
 */
export function connectSignaling(_url: string): Transport {
  throw new Error(
    '[net] no signaling transport this pass — use createLoopbackPair (see transport.ts seam note)',
  );
}

/**
 * Same-machine transport over BroadcastChannel. Two tabs on the same origin
 * join the same channel name (`'nuketown-lobby-' + CODE`) and message each
 * other with no server at all. Same async, peer-to-peer semantics as the
 * loopback pair — `send` targets one peer id, receivers filter on it — so
 * rooms cannot tell which transport they run on. Convention: the host listens
 * as peer id `'host'`; guests use random `'g-…'` ids.
 *
 * Not available in Node proof runs (no BroadcastChannel there); the proof
 * uses the loopback pair instead. Throws at construction when unsupported.
 */
export function createLocalTransport(localId: PeerId, channel: string): Transport {
  const BC = (globalThis as unknown as {
    BroadcastChannel?: new (name: string) => {
      postMessage(v: unknown): void;
      close(): void;
      onmessage: ((ev: { data: unknown }) => void) | null;
    };
  }).BroadcastChannel;
  if (!BC) throw new Error('[net] BroadcastChannel unavailable in this runtime');
  const bc = new BC(channel);
  const handlers = new Set<TransportHandler>();
  const envelope = (v: unknown): { to: PeerId; from: PeerId; msg: NetMessage } | null => {
    if (!v || typeof v !== 'object') return null;
    const e = v as Record<string, unknown>;
    if (typeof e['to'] !== 'string' || typeof e['from'] !== 'string') return null;
    return e as unknown as { to: PeerId; from: PeerId; msg: NetMessage };
  };
  let closed = false;
  bc.onmessage = (ev) => {
    if (closed) return;
    const e = envelope(ev.data);
    if (!e || e.to !== localId) return;
    // Receive boundary lives in the room (isNetMessage); transport only routes.
    for (const h of handlers) h(e.from, e.msg);
  };
  return {
    localId,
    get closed() {
      return closed;
    },
    send(to: PeerId, msg: NetMessage): void {
      if (closed) return;
      bc.postMessage({ to, from: localId, msg });
    },
    onMessage(handler: TransportHandler): () => void {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    },
    close(): void {
      closed = true;
      handlers.clear();
      bc.close();
    },
  };
}