/**
 * Nuketown 2025 — the guest driver: a `GameClient` fed from the wire.
 *
 * A guest decides nothing (IMPORT-PLAN §5.6). It sends intent and shot claims
 * to the host and applies whatever the host publishes: match line, health,
 * kills, spawns, streak ledger. The HUD is driven through the same
 * `GameClient` the solo match uses, so a guest's screen is built by the same
 * code as the host's — one projection, two sources.
 *
 * MOVEMENT. The local `core/player.ts` controller moves the body with real
 * collision; this driver reads the body's displacement each tick and sends
 * the intent that reproduces it (`intentFromVelocity` + the sample's `dt`),
 * so the host's integration is the guest's walk to floating-point. The host's
 * acked position is compared against the body's own recorded position for
 * that seq; a divergence past `GUEST_SNAP_M` (a real desync: a lost input the
 * host coasted wrong, an arena clamp) teleports the body onto authority and
 * counts it. Small errors are left alone — a snap costs velocity, and the
 * exact-displacement wire makes them rare.
 *
 * SHOTS. `firedAt` is converted into the host's clock with the NTP offset the
 * room learned from pongs; `life` is the count of this seat's spawns, which is
 * exactly how the host's `health.ts` numbers lives (initial = 1, +1 per revive)
 * and travels on the reliable channel, so the two cannot drift.
 */
import { GameClient } from '../game/client';
import type { ActorId, GameEvent } from '../game/events';

import { STREAK_CATALOG } from '../game/killstreaks/catalog';
import type { SessionLog } from '../game/session-log';
import { displayNameFor } from '../game/session-solo';
import type { BotBody, MatchDriver, MatchUi, SessionActor, SessionSnapshot } from '../game/session-types';
import type { ShotClaim } from '../weapons/controller';
import type { GameNetMessage, MatchStateMsg, PlayerSample } from './protocol';
import type { GuestClient } from './room';
import { createPose, intentFromVelocity, type Pose } from './room-core';
import { INTERP_DELAY_MS, TICK_HZ } from './snapshot';

const TICK_MS = 1000 / TICK_HZ;
/** Divergence between the body and the host's acked seat that earns a teleport. */
export const GUEST_SNAP_M = 1.0;
/** Own-position history depth: [seq, x, z] triples. 64 ≈ 3.2 s at 20 Hz. */
const HIST = 64;

interface Body { id: ActorId; x: number; y: number; z: number; yaw: number; speed: number; alive: boolean; seen: number }

export interface GuestDriverOptions {
  readonly ui: MatchUi;
  readonly instrument: SessionLog;
  readonly placeLocal?: (x: number, y: number, z: number, yaw: number) => void;
}

export function createGuestDriver(guest: GuestClient, opts: GuestDriverOptions): MatchDriver {
  const selfId = guest.getPlayerId() ?? 'guest';
  const client = new GameClient(selfId);
  client.setStreakNames(STREAK_CATALOG.definitions.map((d) => [d.id, d.displayName] as const));
  opts.ui.bindClient(client);

  const hist = new Float64Array(HIST * 3);
  let histHead = 0;
  let histCount = 0;
  const intent = { mx: 0, mz: 0, sprint: false };
  const pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  const lastPose = { x: 0, z: 0, at: 0, valid: false };
  let acc = 0;
  let last = 0;
  let lives = 0;
  let matches = 0;
  let snaps = 0;
  let lastMatch: MatchStateMsg | null = null;
  let lastAckSeen = -1;
  let disposed = false;
  const bodies: Body[] = [];
  const bodyById = new Map<ActorId, Body>();
  const scratch: Pose = createPose();
  const named = new Set<ActorId>();
  let frame = 0;

  const pushNames = (): void => {
    const names: [string, string][] = [];
    for (const r of guest.roster()) names.push([r.id, r.id === selfId ? 'YOU' : r.name]);
    for (const p of guest.latestPlayers()) if (!named.has(p.id)) names.push([p.id, displayNameFor(p.id, selfId)]);
    for (const [id] of names) named.add(id);
    // Roster names win over derived ones: they were pushed last above? No -
    // derived first would lose. Roster entries are pushed first, so a later
    // derived entry never overwrites one (the set check above skips them).
    opts.ui.setNames(names);
  };

  const record = (e: GameEvent): void => {
    client.applyEvent(e);
    opts.instrument.record(e);
  };

  const onGame = (msg: GameNetMessage): void => {
    switch (msg.type) {
      case 'damage':
        record(msg.e);
        break;
      case 'kill':
        if (msg.kill !== null) record(msg.kill);
        record(msg.death);
        break;
      case 'spawn':
        record(msg.e);
        if (msg.e.actorId === selfId) {
          lives += 1;
          opts.placeLocal?.(msg.e.x, msg.e.y, msg.e.z, msg.e.yaw);
          // The body just teleported: forget its history and skip one velocity
          // sample, or the jump would be sent as a sprint in some direction.
          histCount = 0;
          lastPose.valid = false;
        }
        break;
      case 'shot-reject':
        record(msg.e);
        break;
      case 'match-state':
        if (lastMatch !== null && lastMatch.phase === 'ended' && msg.phase !== 'ended') matches += 1;
        if (lastMatch === null) matches = 1;
        lastMatch = msg;
        client.applySnapshot({ at: performance.now(), match: msg });
        break;
      case 'streak-state':
        client.applySnapshot({ at: performance.now(), streak: msg });
        break;
      case 'ordnance':
        record(msg.e as GameEvent);
        break;
      default:
        break;
    }
  };

  const onState = (players: readonly PlayerSample[]): void => {
    client.applySnapshot({ at: performance.now(), players });
    for (const p of players) if (!named.has(p.id)) { pushNames(); break; }
  };

  guest.onGame(onGame);
  guest.onState(onState);
  pushNames();

  const body = (id: ActorId): Body => {
    let b = bodyById.get(id);
    if (b === undefined) {
      b = { id, x: 0, y: 0, z: 0, yaw: 0, speed: 0, alive: true, seen: 0 };
      bodyById.set(id, b);
      bodies.push(b);
    }
    return b;
  };

  /** One 20 Hz sample: the body's displacement since the last, as intent. */
  const sample = (now: number): void => {
    if (!lastPose.valid) {
      lastPose.x = pose.x; lastPose.z = pose.z; lastPose.at = now; lastPose.valid = true;
      guest.sendMove(0, 0, pose.yaw, pose.pitch, false, false);
      return;
    }
    const dt = Math.max(1e-3, (now - lastPose.at) / 1000);
    intentFromVelocity((pose.x - lastPose.x) / dt, (pose.z - lastPose.z) / dt, pose.yaw, intent);
    lastPose.x = pose.x; lastPose.z = pose.z; lastPose.at = now;
    const seq = guest.sendMoveAt(intent.mx, intent.mz, pose.yaw, pose.pitch, intent.sprint, dt, pose.y);
    if (seq < 0) return;
    const o = histHead * 3;
    hist[o] = seq; hist[o + 1] = pose.x; hist[o + 2] = pose.z;
    histHead = (histHead + 1) % HIST;
    if (histCount < HIST) histCount += 1;
  };

  /** Compare the host's newest ack with the body's own position at that seq. */
  const reconcile = (): void => {
    const ack = guest.selfAck();
    if (ack.seq < 0 || ack.seq === lastAckSeen) return;
    lastAckSeen = ack.seq;
    for (let k = 0; k < histCount; k++) {
      const o = ((((histHead - 1 - k) % HIST) + HIST) % HIST) * 3;
      const s = hist[o];
      if (s < ack.seq) return;
      if (s !== ack.seq) continue;
      const dx = ack.x - hist[o + 1];
      const dz = ack.z - hist[o + 2];
      if (Math.hypot(dx, dz) <= GUEST_SNAP_M) return;
      snaps += 1;
      opts.placeLocal?.(pose.x + dx, pose.y, pose.z + dz, pose.yaw);
      for (let j = 0; j < histCount; j++) {
        const q = ((((histHead - 1 - j) % HIST) + HIST) % HIST) * 3;
        hist[q + 1] += dx;
        hist[q + 2] += dz;
      }
      lastPose.x += dx;
      lastPose.z += dz;
      return;
    }
  };

  return {
    localId: selfId,
    log: () => opts.instrument.lines.slice(),
    counters: () => ({ ...opts.instrument.tally, epoch: matches, bots: 0, remotes: bodies.length, snaps, lives }),
    ended: () => lastMatch !== null && lastMatch.phase === 'ended',
    rematchNow: () => undefined,
    localShot(claim: ShotClaim): void {
      if (lives === 0) return;
      guest.sendGame({
        type: 'shot', seq: claim.seq, life: lives, weaponId: claim.weaponId,
        firedAt: claim.time + guest.hostClockOffset(),
        ox: claim.origin.x, oy: claim.origin.y, oz: claim.origin.z,
        dx: claim.direction.x, dy: claim.direction.y, dz: claim.direction.z,
      });
    },
    pressStreak(slot): void {
      guest.sendGame({ type: 'streak-intent', slot, toggle: false });
    },

    tick(now, x, y, z, yaw, pitch): void {
      if (disposed) return;
      pose.x = x; pose.y = y; pose.z = z; pose.yaw = yaw; pose.pitch = pitch;
      frame += 1;
      if (last === 0) last = now;
      acc += Math.max(0, now - last);
      last = now;
      if (acc >= TICK_MS) {
        acc = acc > TICK_MS * 4 ? 0 : acc - TICK_MS;
        sample(now);
      }
      reconcile();
      client.tick(now);
    },

    bots(): readonly BotBody[] {
      const renderAt = performance.now() + guest.hostClockOffset() - INTERP_DELAY_MS;
      for (const p of guest.latestPlayers()) {
        if (p.id === selfId) continue;
        const b = body(p.id);
        const had = b.seen > 0;
        const px = b.x;
        const pz = b.z;
        if (!guest.remotePose(p.id, renderAt, scratch)) {
          scratch.x = p.x; scratch.y = p.y; scratch.z = p.z; scratch.yaw = p.yaw;
        }
        b.x = scratch.x; b.y = scratch.y; b.z = scratch.z; b.yaw = scratch.yaw;
        b.alive = p.alive !== false;
        // Speed from the interpolated track at frame rate, smoothed: the rig's
        // walk cycle wants a level, not a 60 Hz square wave.
        const inst = had ? Math.hypot(b.x - px, b.z - pz) * 60 : 0;
        b.speed = b.speed + (inst - b.speed) * 0.2;
        b.seen = frame;
      }
      return bodies;
    },

    snapshot(): SessionSnapshot {
      const m = lastMatch;
      if (m === null) throw new Error('[session] guest has no match line yet');
      const alive = new Map<string, boolean>();
      const hp = new Map<string, number>();
      for (const p of guest.latestPlayers()) {
        alive.set(p.id, p.alive !== false);
        if (p.hp !== undefined) hp.set(p.id, p.hp);
      }
      const actors: SessionActor[] = m.scores.map((r) => ({
        id: r.id, team: r.team, bot: r.id.startsWith('bot-'), hp: hp.get(r.id) ?? 0, alive: alive.get(r.id) ?? true,
        kills: r.kills, deaths: r.deaths, score: r.score,
      }));
      return { at: performance.now(), match: m, actors, stats: { shotsAdmitted: 0, shotsRejected: 0, hitsLanded: 0, hitsBlocked: 0 } };
    },

    netLine(now): string | null {
      const s = guest.diag.snapshot(now);
      const rtt = s.rttMs === null ? '--' : s.rttMs.toFixed(0);
      const age = s.ageN === 0 ? '--/--' : s.ageP50.toFixed(0) + '/' + s.ageP95.toFixed(0);
      return `guest ${selfId} · rtt ${rtt} ms · snap ${s.tickHz.toFixed(1)} Hz · age p50/p95 ${age} ms · snaps ${snaps} · offset ${guest.hostClockOffset().toFixed(0)} ms`;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      guest.onGame(null);
      guest.onState(null);
      opts.ui.bindClient(null);
    },
  };
}
