/**
 * Nuketown 2025 — the bot director: the roster, the walk, the submissions.
 *
 * DOM-free and scene-free. A bot never writes a score, never applies damage
 * and never decides whether its bullet hit: it submits the same `ShotMsg`
 * claim a human's weapon does and `game/host.ts` resolves it. That is the
 * whole point of IMPORT-PLAN §2 — if a bot could shortcut the host, the host
 * would have two versions of "did that kill you".
 *
 * Bodies are NOT here. `main.ts` maps a bot id to a `characters/` handle and
 * moves it, so players, bots, reinforcements and corpses all come off the one
 * rig (AGENTS.md's durable gotcha, §5.8). This file publishes positions; it
 * owns no mesh.
 *
 * The pure half — constants, the arsenal projection, the aim frame, `senseBot`
 * and `botIntent` — is `./bot-sense`, split out for the 400-line cap and
 * re-exported here so `./bots` stays the one import target.
 *
 * ## What the navigation actually is, stated plainly
 *
 * There is no path graph. A bot walks straight at its goal and, when the chest
 * segment to the next step is blocked, tries the two axis-aligned slides
 * before giving up for that tick. On a map 44 m across with wide flanks this
 * reads as competent; in a corridor maze it would not. `scripts/paths.mjs`
 * already floods the collision world and emits line-of-sight-simplified
 * waypoints — that is the upgrade path when this stops being enough, and it is
 * deliberately not taken yet.
 */

import type { ActorId, TeamId, Vec3, WorldQuery } from './events';
import type { ActorSnapshot } from './host-ports';
import { SPAWN_POINTS } from './spawns';
import { TEAM_A, TEAM_B } from './rules';
import {
  BOT_AIM_ORIGIN_Y, BOT_ARSENAL, BOT_CHEST_Y, BOT_GOAL_REACHED_M, BOT_GOAL_TIMEOUT_MS,
  BOT_REINFORCE_EVERY_DEATHS, BOT_SIDE_HYSTERESIS_MS, BOT_SPEED_MS, BOT_STEP_UP_M,
  BOT_FIRE_RANGE_M, BOT_STRAFE_SWAP_MS, BOT_TARGET_MEMORY_MS, BOT_FALLBACK_HP, botIntent, senseBot,
  type BotActorView, type BotIntent, type BotRuntime,
} from './bot-sense';

export * from './bot-sense';


/** What the director submits to. Exactly the host's own public methods — no
 *  wrapper, no adapter, so there is nothing here that can drift from it. */
export interface BotHost {
  addActor(id: ActorId, team: TeamId, opts?: { bot?: boolean }): void;
  updatePose(id: ActorId, x: number, y: number, z: number, at?: number): void;
  submitInput(id: ActorId, msg: { type: 'input'; seq: number; mx: number; mz: number; yaw: number; pitch: number; fire: boolean; jump: boolean }): void;
  submitShot(id: ActorId, claim: { type: 'shot'; seq: number; life: number; weaponId: string; firedAt: number; ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }, receivedAt?: number): unknown;
  submitStreakIntent(id: ActorId, msg: { type: 'streak-intent'; slot: number; toggle: boolean }): void;
}

export interface BotDirectorOptions {
  readonly host: BotHost;
  readonly world: WorldQuery;
  /** Shared with the host so a replay of the same seed replays the same bots. */
  readonly rand: () => number;
  /** Hard ceiling on live bots; `net/protocol.ts:MAX_PLAYERS` minus the human. */
  readonly maxBots: number;
}

export class BotDirector {
  private readonly opts: BotDirectorOptions;
  private readonly bots: BotRuntime[] = [];
  private botDeaths = 0;
  private reinforcements = 0;
  private refusedReinforcements = 0;
  private serial = 0;
  /**
   * Instruments, not decoration. "The bots do not shoot enough" is an
   * adjective; `sight/engage/fire` per live bot-tick is a number, and it is
   * the only thing that says WHICH of the three gates - seeing anyone at all,
   * being inside 22 m, or the 650 ms reaction - is the one that binds.
   */
  private readonly m = {
    botTicks: 0, sightTicks: 0, engageTicks: 0, fireTicks: 0,
    shots: 0, streakPresses: 0, blockedSteps: 0,
  };

  constructor(opts: BotDirectorOptions) {
    this.opts = opts;
  }

  get roster(): readonly BotRuntime[] {
    return this.bots;
  }

  /** Total bot deaths seen, and the reinforcements they bought. Numbers for a proof. */
  get reinforcementCount(): number {
    return this.reinforcements;
  }

  get deathCount(): number {
    return this.botDeaths;
  }

  /** Admit one bot. The host places it; `onSpawn` brings the body to that point. */
  add(team: TeamId): BotRuntime | null {
    if (this.bots.length >= this.opts.maxBots) return null;
    const n = this.serial++;
    const id = 'bot-' + String(n + 1).padStart(2, '0');
    const weapon = BOT_ARSENAL[n % BOT_ARSENAL.length];
    const side: 1 | -1 = team === 0 ? 1 : -1;
    const bot: BotRuntime = {
      id, team, weapon, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0,
      alive: true, life: 1, targetId: null, targetSince: 0, lastSeen: -Infinity,
      side, sideWant: side, sideSince: 0, goalX: 0, goalZ: 0, goalAt: 0,
      strafe: 1, strafeAt: 0, inputSeq: 0, shotSeq: 0, cooldown: 0,
    };
    this.bots.push(bot);
    this.opts.host.addActor(id, team, { bot: true });
    return bot;
  }

  /** The host deployed someone. If it is one of ours, the body goes there. */
  onSpawn(actorId: ActorId, x: number, y: number, z: number, yaw: number): void {
    const b = this.bots.find((v) => v.id === actorId);
    if (b === undefined) return;
    b.x = x; b.y = y; b.z = z; b.yaw = yaw;
    b.alive = true;
    b.targetId = null;
    b.goalAt = 0;
  }

  /**
   * The host killed someone. Bot deaths buy reinforcements, ten to one.
   *
   * At the roster ceiling `add` refuses and the count is kept, so the ceiling
   * delays reinforcement rather than cancelling it — the same backpressure
   * rule lane C's streak bank uses, and for the same reason: an earned thing
   * that is silently discarded is a defect you only find by counting.
   */
  onDeath(actorId: ActorId, humanTeam: TeamId): void {
    if (!this.bots.some((v) => v.id === actorId)) return;
    this.botDeaths++;
    if (this.botDeaths % BOT_REINFORCE_EVERY_DEATHS !== 0) return;
    if (this.add(nextBotTeam(this.bots, humanTeam)) !== null) this.reinforcements++;
    else this.refusedReinforcements++;
  }

  /** Reinforcements the roster ceiling turned away. A number, not silence. */
  get refusedReinforcementCount(): number {
    return this.refusedReinforcements;
  }

  get metrics(): Readonly<Record<string, number>> {
    return this.m;
  }

  /**
   * One host tick. `now` is host milliseconds and `dt` is SECONDS — the two
   * units the rest of the codebase already uses (`GameHost.tick(now)` in ms,
   * `WeaponDef.interval` and every speed in seconds), kept rather than
   * unified so neither caller has to convert at the call site.
   *
   * `others` is every non-bot actor the bots may perceive (the human), `snap`
   * is the host's own actor table — alive, hp, life and streak slots all come
   * from there, because the host owns them and a second copy here would be
   * the §5.6 defect.
   */
  tick(now: number, dt: number, others: readonly BotActorView[], snap: readonly ActorSnapshot[]): void {
    const byId = new Map(snap.map((a) => [a.id, a]));
    const views: BotActorView[] = others.slice();
    for (const b of this.bots) {
      views.push({ id: b.id, team: b.team, alive: b.alive, x: b.x, y: b.y, z: b.z });
    }

    for (const b of this.bots) {
      const s = byId.get(b.id);
      if (s === undefined) continue;
      b.alive = s.alive;
      b.life = s.life;
      if (b.cooldown > 0) b.cooldown -= dt;
      if (!b.alive) {
        this.opts.host.updatePose(b.id, b.x, b.y, b.z, now);
        continue;
      }

      this.m.botTicks++;
      const sense = senseBot(b, views, this.opts.world);
      if (sense.visible) this.m.sightTicks++;
      if (sense.visible && sense.distance <= BOT_FIRE_RANGE_M) this.m.engageTicks++;
      // `targetSince` starts the reaction clock. It restarts when the target
      // CHANGES, and when sight has been gone longer than the target memory —
      // not on every frame the segment happens to be blocked, which is the
      // difference between 10 shots a minute and a firefight.
      if (sense.visible) {
        if (sense.targetId !== b.targetId) {
          b.targetId = sense.targetId;
          b.targetSince = now;
        }
        b.lastSeen = now;
      } else if (b.targetId === null || now - b.lastSeen > BOT_TARGET_MEMORY_MS) {
        b.targetId = sense.targetId;
        b.targetSince = now;
        b.lastSeen = -Infinity;
      }
      if (now - b.strafeAt > BOT_STRAFE_SWAP_MS) {
        b.strafeAt = now;
        b.strafe = this.opts.rand() < 0.5 ? -1 : 1;
      }
      this.updateSide(b, now, s.hp);
      if (b.goalAt === 0 || now - b.goalAt > BOT_GOAL_TIMEOUT_MS ||
          Math.hypot(b.goalX - b.x, b.goalZ - b.z) < BOT_GOAL_REACHED_M) {
        this.pickGoal(b, now);
      }

      const ready = this.readySlot(s);
      const intent = botIntent(b, sense, now, s.hp, ready);
      b.yaw = intent.yaw;
      b.pitch = intent.pitch;
      this.step(b, intent, dt);

      this.opts.host.updatePose(b.id, b.x, b.y, b.z, now);
      this.opts.host.submitInput(b.id, {
        type: 'input', seq: ++b.inputSeq, mx: intent.moveX, mz: intent.moveZ,
        yaw: b.yaw, pitch: b.pitch, fire: intent.fire, jump: false,
      });
      if (intent.fire) this.m.fireTicks++;
      if (intent.fire && sense.target !== null) this.shoot(b, sense.target, now);
      if (intent.streakSlot !== null) {
        this.m.streakPresses++;
        this.opts.host.submitStreakIntent(b.id, { type: 'streak-intent', slot: intent.streakSlot, toggle: false });
      }
    }
  }

  /** First slot holding a charge, 1-based, or null. Derived from the host's row. */
  private readySlot(s: ActorSnapshot): number | null {
    for (const slot of s.slots) if (slot.charges > 0) return slot.slot;
    return null;
  }

  /**
   * Which half of the map this bot wants, with the 1.2 s sustain. Without the
   * hysteresis a bot sitting on the health threshold, or flickering in and out
   * of contact, oscillates between advance and fall-back every tick and walks
   * on the spot — which is exactly what the old project's sustain window was
   * added to stop.
   */
  private updateSide(b: BotRuntime, now: number, hp: number): void {
    const want: 1 | -1 = hp <= BOT_FALLBACK_HP
      ? (b.team === 0 ? -1 : 1)     // hurt: back toward its own spawn end
      : (b.team === 0 ? 1 : -1);    // healthy: push toward the enemy end
    if (want !== b.sideWant) {
      b.sideWant = want;
      b.sideSince = now;
      return;
    }
    if (want !== b.side && now - b.sideSince >= BOT_SIDE_HYSTERESIS_MS) {
      b.side = want;
      b.goalAt = 0;
    }
  }

  /**
   * A patrol goal, taken from `game/spawns.ts:SPAWN_POINTS` on the favoured
   * side. Derived, not authored: the spawn table is already a projection of
   * `core/layout.ts`, so bots walk to places the map says are places.
   *
   * BIASED TOWARD THE MIDDLE, and here is why. Sorted by |z| the enemy-side
   * pool runs from the street (z = 0) out to that team's back fence (z = 34),
   * and picking uniformly sends bots to the far end of an 84 m map: measured
   * over a 60 s match, 4,465 live bot-ticks produced 131 with an enemy in
   * sight — 2.9%. `r * r` is the square-biased pick, so the contested middle
   * is drawn several times more often than the enemy back yard while every
   * point stays reachable. This is a heuristic about ONE map's shape; it is
   * not a substitute for the real waypoint graph `scripts/paths.mjs` can emit.
   */
  private pickGoal(b: BotRuntime, now: number): void {
    const wanted = SPAWN_POINTS.filter((p) => Math.sign(p.z) === b.side || p.z === 0);
    const pool = (wanted.length > 0 ? wanted : SPAWN_POINTS)
      .slice().sort((p, q) => Math.abs(p.z) - Math.abs(q.z));
    const r = this.opts.rand();
    const p = pool[Math.min(pool.length - 1, Math.floor(r * r * pool.length))];
    b.goalX = p.x;
    b.goalZ = p.z;
    b.goalAt = now;
  }

  /**
   * Movement. Straight at the wish, then the two axis slides. The blocking
   * test is the chest segment through the `WorldQuery` port — the same
   * colliders the player hits, so a bot cannot walk through something the
   * human cannot.
   */
  private step(b: BotRuntime, intent: BotIntent, dt: number): void {
    const dist = BOT_SPEED_MS * dt;
    if (dist <= 0 || (intent.moveX === 0 && intent.moveZ === 0)) { b.speed = 0; return; }
    const tries: [number, number][] = [
      [intent.moveX, intent.moveZ],
      [intent.moveX, 0],
      [0, intent.moveZ],
    ];
    for (const [mx, mz] of tries) {
      if (mx === 0 && mz === 0) continue;
      const len = Math.hypot(mx, mz);
      const nx = b.x + (mx / len) * dist;
      const nz = b.z + (mz / len) * dist;
      if (!this.opts.world.inBounds(nx, nz)) continue;
      const ny = this.opts.world.groundY(nx, nz);
      if (ny - b.y > BOT_STEP_UP_M) continue;
      const from: Vec3 = { x: b.x, y: b.y + BOT_CHEST_Y, z: b.z };
      const to: Vec3 = { x: nx, y: ny + BOT_CHEST_Y, z: nz };
      if (!this.opts.world.lineOfSight(from, to)) continue;
      if (mx !== intent.moveX || mz !== intent.moveZ) this.m.blockedSteps++;
      b.x = nx; b.y = ny; b.z = nz;
      b.speed = BOT_SPEED_MS * (len > 1 ? 1 : len);
      return;
    }
    b.speed = 0;
  }

  /** One claim, exactly as a human's controller authors one. */
  private shoot(b: BotRuntime, target: Vec3, now: number): void {
    const ox = b.x;
    const oy = b.y + BOT_AIM_ORIGIN_Y;
    const oz = b.z;
    let dx = target.x - ox;
    let dy = target.y - oy;
    let dz = target.z - oz;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    dx /= len; dy /= len; dz /= len;
    b.cooldown = b.weapon.interval;
    this.m.shots++;
    this.opts.host.submitShot(b.id, {
      type: 'shot', seq: ++b.shotSeq, life: b.life, weaponId: b.weapon.id,
      firedAt: now, ox, oy, oz, dx, dy, dz,
    }, now);
  }
}

/**
 * Auto-balance: the smaller team, counting the human. Exported so the initial
 * fill and a reinforcement ten deaths later agree on one rule instead of each
 * carrying its own, which is how a 5-v-1 gets shipped.
 */
export function nextBotTeam(existing: readonly { team: TeamId }[], humanTeam: TeamId): TeamId {
  let a = humanTeam === TEAM_A ? 1 : 0;
  let b = humanTeam === TEAM_B ? 1 : 0;
  for (const e of existing) (e.team === TEAM_A ? a++ : b++);
  return a <= b ? TEAM_A : TEAM_B;
}
