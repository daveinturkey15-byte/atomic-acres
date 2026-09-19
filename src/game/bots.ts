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
 * re-exported here so `./bots` stays the one import target. Navigation is
 * `./bot-nav`, the aim line and its error cone `./bot-aim`.
 *
 * ## Difficulty (lobby lane, 2026-09-19)
 *
 * `BotDifficultyPreset` from `rules.ts` moves three numbers: the reaction
 * delay, the fire range and an aim-error cone. `regular` is the play-tested
 * pair `bot-sense.ts` has always used with the perfect aim it has always had,
 * so a match with no preset chosen is the match every harness already knows.
 * The preset is applied HERE, over `botIntent`'s answer, because
 * `bot-sense.ts` is another lane's file: the reducer keeps reading its own
 * constants for the movement decision, and the trigger decision is re-taken
 * against the preset's numbers before anything is submitted.
 *
 * ## Ordnance (wired against the ordnance lane's README contract)
 *
 * `botIntent` already forms the three intents when it is told what the bot
 * carries (`BotSupply`, off the host's own `ActorSnapshot`) and what lies on
 * the ground (`HostSnapshot.ordnance.drops`). A knife or a grenade is
 * submitted exactly where a bullet is, as a `ShotMsg` whose `weaponId` is the
 * ordnance id; a grenade is TWO claims (arm, then release along the lob) per
 * `src/game/README.md`. Scavenging needs no claim at all: the host applies the
 * walk-over itself, so a bot out of rounds simply walks to the drop.
 */

import type { ActorId, StreakDenialReason, TeamId, Vec3, WorldQuery } from './events';
import type { ActorSnapshot } from './host-ports';
import { BOT_DIFFICULTY_PRESETS, TEAM_A, TEAM_B, type BotDifficultyPreset } from './rules';
import {
  BOT_AIM_ORIGIN_Y, BOT_ARSENAL, BOT_GOAL_REACHED_M, BOT_GOAL_TIMEOUT_MS,
  BOT_REINFORCE_EVERY_DEATHS, BOT_STREAK_RETRY_MS, BOT_STREAK_TERMINAL_DENIALS, BOT_STRAFE_SWAP_MS,
  BOT_TARGET_MEMORY_MS, botIntent, senseBot, throwDirection,
  type BotActorView, type BotDropSpot, type BotRuntime, type BotSupply,
} from './bot-sense';
import { aimVector, scatter, type Dir } from './bot-aim';
import { pickGoal, stepBot, updateSide } from './bot-nav';
import { KNIFE_ID, KNIFE_RECOVERY_MS } from './ordnance';

export * from './bot-sense';
export * from './bot-nav';
export * from './bot-aim';

/** What the director submits to. Exactly the host's own public methods — no
 *  wrapper, no adapter, so there is nothing here that can drift from it. */
export interface BotHost {
  addActor(id: ActorId, team: TeamId, opts?: { bot?: boolean }): void;
  updatePose(id: ActorId, x: number, y: number, z: number, at?: number): void;
  submitInput(id: ActorId, msg: { type: 'input'; seq: number; mx: number; mz: number; yaw: number; pitch: number; fire: boolean; jump: boolean }): void;
  submitShot(id: ActorId, claim: { type: 'shot'; seq: number; life: number; weaponId: string; firedAt: number; ox: number; oy: number; oz: number; dx: number; dy: number; dz: number }, receivedAt?: number): unknown;
  /** The refusal, or `null` when the press was admitted. See the backoff in `tick`. */
  submitStreakIntent(id: ActorId, msg: { type: 'streak-intent'; slot: number; toggle: boolean }): StreakDenialReason | null;
}

export interface BotDirectorOptions {
  readonly host: BotHost;
  readonly world: WorldQuery;
  /** Shared with the host so a replay of the same seed replays the same bots. */
  readonly rand: () => number;
  /** Hard ceiling on live bots; `net/protocol.ts:MAX_PLAYERS` minus the human. */
  readonly maxBots: number;
  /** Reaction / range / aim cone. Absent = `regular`, the pre-preset numbers. */
  readonly difficulty?: BotDifficultyPreset;
}

const NO_DROPS: readonly BotDropSpot[] = Object.freeze([]);

export class BotDirector {
  private readonly opts: BotDirectorOptions;
  private readonly difficulty: BotDifficultyPreset;
  private readonly bots: BotRuntime[] = [];
  private botDeaths = 0;
  private reinforcements = 0;
  private refusedReinforcements = 0;
  private serial = 0;
  /** Scratch for the aim line and the kit view; never escape `tick`. */
  private readonly dir: Dir = { x: 0, y: 0, z: 0 };
  private readonly supply: { lethal: number; tactical: number; rounds: number; armed: string | null } = { lethal: 0, tactical: 0, rounds: 0, armed: null };
  /**
   * Instruments, not decoration. "The bots do not shoot enough" is an
   * adjective; `sight/engage/fire` per live bot-tick is a number, and it is
   * the only thing that says WHICH of the three gates - seeing anyone at all,
   * being inside 22 m, or the 650 ms reaction - is the one that binds.
   */
  private readonly m = {
    botTicks: 0, sightTicks: 0, engageTicks: 0, fireTicks: 0,
    shots: 0, knives: 0, grenades: 0, streakPresses: 0, blockedSteps: 0,
    // `streakPresses` cannot tell four charges spent from four refused.
    // THIS DIRECTOR ONLY, and a rematch builds a new one: quote
    // `LocalMatch.counters()`, which banks each retiring director's numbers in
    // `session-log.ts` and reports the session total. NOT named `streakDenied`:
    // that key is the tally's, counted from events, and the clash would have
    // hidden one number behind the other.
    streakRefused: 0, streakBlocks: 0,
  };

  constructor(opts: BotDirectorOptions) {
    this.opts = opts;
    this.difficulty = opts.difficulty ?? BOT_DIFFICULTY_PRESETS.regular;
  }

  /** The preset in force. A proof reads it back rather than trusting the brief. */
  get preset(): BotDifficultyPreset {
    return this.difficulty;
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
      streakHoldSlot: null, streakHoldUntil: 0, streakBlocked: false,
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
    // A new life clears every streak refusal: `dead` is answered by this very
    // event, and an unexpired slot hold describes a world that no longer is.
    b.streakBlocked = false;
    b.streakHoldSlot = null;
    b.streakHoldUntil = 0;
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
   * is the host's own actor table — alive, hp, life, streak slots and the
   * carried kit all come from there, because the host owns them and a second
   * copy here would be the §5.6 defect. `drops` is the host's ground list.
   */
  tick(now: number, dt: number, others: readonly BotActorView[], snap: readonly ActorSnapshot[], drops: readonly BotDropSpot[] = NO_DROPS): void {
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
      if (sense.visible && sense.distance <= this.difficulty.fireRangeM) this.m.engageTicks++;
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
      updateSide(b, now, s.hp);
      if (b.goalAt === 0 || now - b.goalAt > BOT_GOAL_TIMEOUT_MS ||
          Math.hypot(b.goalX - b.x, b.goalZ - b.z) < BOT_GOAL_REACHED_M) {
        pickGoal(b, now, this.opts.rand);
      }

      const ready = this.readySlot(b, s, now);
      const k = this.supply;
      k.lethal = s.lethal; k.tactical = s.tactical; k.rounds = s.rounds; k.armed = s.armed;
      const intent = botIntent(b, sense, now, s.hp, ready, k as BotSupply, drops);
      b.yaw = intent.yaw;
      b.pitch = intent.pitch;
      if (stepBot(b, intent, dt, this.opts.world)) this.m.blockedSteps++;

      // The trigger, re-taken against the preset: the reducer's own rule
      // (visible, in range, reacted, cooled) with the preset's range and
      // reaction. `regular` reproduces the reducer's answer exactly. A knife
      // or a grenade this tick replaces the bullet, as the reducer decided.
      const d = this.difficulty;
      const fire = !intent.knife && intent.grenade === null && sense.visible && sense.distance <= d.fireRangeM &&
        now - b.targetSince >= d.reactionMs && b.cooldown <= 0;

      this.opts.host.updatePose(b.id, b.x, b.y, b.z, now);
      this.opts.host.submitInput(b.id, {
        type: 'input', seq: ++b.inputSeq, mx: intent.moveX, mz: intent.moveZ,
        yaw: b.yaw, pitch: b.pitch, fire, jump: false,
      });
      if (fire) this.m.fireTicks++;
      if (sense.target !== null) {
        if (fire) this.shoot(b, sense.target, now);
        else if (intent.knife && b.cooldown <= 0) this.knife(b, sense.target, now);
        else if (intent.grenade !== null) this.throwGrenade(b, intent.grenade, sense.target, now);
      }
      if (intent.streakSlot !== null) {
        this.m.streakPresses++;
        const refused = this.opts.host.submitStreakIntent(
          b.id, { type: 'streak-intent', slot: intent.streakSlot, toggle: false },
        );
        this.noteStreakAnswer(b, intent.streakSlot, refused, now);
      }
    }
  }

  /**
   * First slot holding a charge that is not under a refusal, 1-based, or null.
   * Derived from the host's row; the holds are this director's own memory of
   * what the host already said no to.
   */
  private readySlot(b: BotRuntime, s: ActorSnapshot, now: number): number | null {
    if (b.streakBlocked) return null;
    for (const slot of s.slots) {
      if (slot.charges <= 0) continue;
      if (slot.slot === b.streakHoldSlot && now < b.streakHoldUntil) continue;
      return slot.slot;
    }
    return null;
  }

  /**
   * What the host answered, remembered. A refused charge stays banked, so
   * without this the same slot is re-pressed on the very next tick and refused
   * again — 20 presses and 20 feed rows a second for as long as the refusal
   * holds. The gate was never wrong; the retry cadence was.
   *
   * Two horizons: a refusal that can clear on its own gets
   * `BOT_STREAK_RETRY_MS` on that slot, one that cannot clear this life
   * (`BOT_STREAK_TERMINAL_DENIALS`) stops the bot until it respawns. An
   * admitted press clears both, so the next charge starts clean.
   */
  private noteStreakAnswer(b: BotRuntime, slot: number, refused: StreakDenialReason | null, now: number): void {
    if (refused === null) {
      b.streakHoldSlot = null;
      b.streakHoldUntil = 0;
      return;
    }
    this.m.streakRefused++;
    b.streakHoldSlot = slot;
    b.streakHoldUntil = now + BOT_STREAK_RETRY_MS;
    if (BOT_STREAK_TERMINAL_DENIALS.includes(refused)) {
      b.streakBlocked = true;
      this.m.streakBlocks++;
    }
  }

  /** One claim, exactly as a human's controller authors one. */
  private claim(b: BotRuntime, weaponId: string, now: number): void {
    const o = this.dir;
    this.opts.host.submitShot(b.id, {
      type: 'shot', seq: ++b.shotSeq, life: b.life, weaponId,
      firedAt: now, ox: b.x, oy: b.y + BOT_AIM_ORIGIN_Y, oz: b.z, dx: o.x, dy: o.y, dz: o.z,
    }, now);
  }

  private eye(b: BotRuntime): Vec3 {
    return { x: b.x, y: b.y + BOT_AIM_ORIGIN_Y, z: b.z };
  }

  private shoot(b: BotRuntime, target: Vec3, now: number): void {
    if (!aimVector(this.eye(b), target, this.dir)) return;
    scatter(this.dir, this.difficulty.aimErrorRad, this.opts.rand);
    b.cooldown = b.weapon.interval;
    this.m.shots++;
    this.claim(b, b.weapon.id, now);
  }

  /** The knife: one swing along the aim line; the host measures the reach. */
  private knife(b: BotRuntime, target: Vec3, now: number): void {
    if (!aimVector(this.eye(b), target, this.dir)) return;
    b.cooldown = KNIFE_RECOVERY_MS / 1000;
    this.m.knives++;
    this.claim(b, KNIFE_ID, now);
  }

  /** Arm, then release along the ballistic lob that lands at the target. */
  private throwGrenade(b: BotRuntime, grenadeId: string, target: Vec3, now: number): void {
    throwDirection(this.eye(b), target, this.dir);
    b.grenadeAt = now;
    this.m.grenades++;
    this.claim(b, grenadeId, now);
    this.claim(b, grenadeId, now);
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
