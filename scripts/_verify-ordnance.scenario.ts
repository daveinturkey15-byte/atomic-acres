/**
 * _verify-ordnance — the scenarios, in TypeScript, compiled by
 * `scripts/_verify-ordnance.mjs` with esbuild against the REAL `src/game/`
 * modules (the pattern of `_verify-streak-reject.mjs`). Kept as a `.ts` file
 * beside the runner rather than a string inside it so `npm run check` types
 * the proof against the host's real signatures: a proof that no longer
 * compiles is a proof that is stale, and it fails loudly instead of measuring
 * the wrong thing.
 *
 * Nothing here instantiates a mock. Every actor is admitted by the real host,
 * every claim goes through `submitShot`, every tick through `tick`. The only
 * things the scenario supplies are poses (which `net/room.ts` would supply in
 * a real match) and colliders (which the builders would).
 */
import { GameHost } from '../src/game/host';
import { activeSmokeVolumes, createWorldQuery, losBlockedBySmoke, type WorldQueryWithSight } from '../src/game/world-query';
import { TEAM_A, TEAM_B, WARMUP_MS, rulesFor } from '../src/game/rules';
import { TICK_HZ } from '../src/net/snapshot';
import {
  BOT_AIM_ORIGIN_Y, BOT_GRENADE_COOLDOWN_MS, BOT_REACTION_MS, botIntent, botOrdnanceClaim, senseBot, throwDirection,
  type BotActorView, type BotRuntime, type BotSupply,
} from '../src/game/bot-sense';
import { WEAPONS } from '../src/weapons/catalog';
import { FLASH_MAX_MS, KNIFE_RECOVERY_MS, SMOKE_RADIUS_M, TACTICAL_IDS } from '../src/game/ordnance';
import { DROP_LIFETIME_MS, DROP_MAX_LIVE, fullRounds } from '../src/game/pickups';
import { EYE_HEIGHT } from '../src/core/layout';
import type { DamageEvent, GameEvent, TeamId } from '../src/game/events';
import type { AABB } from '../src/core/kit';
import type { ShotAdmission } from '../src/game/host-ports';
import * as THREE from 'three';
import type { MaterialLibrary } from '../src/core/materials';
import { OrdnanceInput, RELEASE_WAIT_S, USE_HOLD_S } from '../src/weapons/ordnance-input';
import { ARM_CONFIRM_S, KNIFE_STRIKE_S, THROW_RELEASE_S } from '../src/weapons/ordnance-hand';

const TICK = 1000 / TICK_HZ;

export interface Check { readonly name: string; readonly pass: boolean; readonly detail: string }

interface Pose { x: number; y: number; z: number; yaw: number }

/** An axis-aligned collider from six numbers. `segmentHitsBox` reads only x/y/z. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): AABB {
  return { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 } } as unknown as AABB;
}

/** A host on a synthetic clock, with poses this harness supplies every tick. */
class Rig {
  readonly world: WorldQueryWithSight;
  readonly host: GameHost;
  readonly events: GameEvent[] = [];
  now = 0;
  private readonly seqs = new Map<string, number>();
  private readonly inputs = new Map<string, number>();
  private readonly poses = new Map<string, Pose>();

  constructor(colliders: AABB[], seed = 3) {
    this.world = createWorldQuery(colliders);
    this.host = new GameHost({ world: this.world, rules: rulesFor('tdm', 100), now: 0, seed });
  }

  add(id: string, team: TeamId, x: number, z: number, yaw = 0, opts: { bot?: boolean; primaryId?: string } = {}): void {
    this.host.addActor(id, team, opts);
    this.poses.set(id, { x, y: 0, z, yaw });
  }

  place(id: string, x: number, z: number, yaw?: number): void {
    const p = this.poses.get(id) as Pose;
    p.x = x; p.z = z;
    if (yaw !== undefined) p.yaw = yaw;
  }

  tick(n = 1): void {
    for (let i = 0; i < n; i++) {
      this.now += TICK;
      for (const [id, p] of this.poses) {
        this.host.updatePose(id, p.x, p.y, p.z, this.now);
        const seq = (this.inputs.get(id) ?? 0) + 1;
        this.inputs.set(id, seq);
        this.host.submitInput(id, { type: 'input', seq, mx: 0, mz: 0, yaw: p.yaw, pitch: 0, fire: false, jump: false });
      }
      for (const e of this.host.tick(this.now)) this.events.push(e);
    }
  }

  run(ms: number): void {
    this.tick(Math.ceil(ms / TICK));
  }

  /** A claim from `id`, eye-high, along `dir`, stamped now. Same shape as the controller's. */
  claim(id: string, weaponId: string, dir = { x: 0, y: -1, z: 0 }, seq?: number): ShotAdmission {
    const p = this.poses.get(id) as Pose;
    const life = this.host.lifeOf(id) ?? 1;
    const s = seq ?? (this.seqs.get(id) ?? 0) + 1;
    if (seq === undefined) this.seqs.set(id, s);
    return this.host.submitShot(id, {
      type: 'shot', seq: s, life, weaponId, firedAt: this.now,
      ox: p.x, oy: p.y + EYE_HEIGHT, oz: p.z, dx: dir.x, dy: dir.y, dz: dir.z,
    }, this.now);
  }

  lastSeq(id: string): number {
    return this.seqs.get(id) ?? 0;
  }

  of<T extends GameEvent['type']>(type: T): Extract<GameEvent, { type: T }>[] {
    return this.events.filter((e) => e.type === type) as Extract<GameEvent, { type: T }>[];
  }

  actor(id: string) {
    return this.host.snapshot().actors.find((a) => a.id === id);
  }

  damageTo(id: string, cause?: string): DamageEvent[] {
    return this.of('damage').filter((e) => e.victimId === id && (cause === undefined || e.cause === cause));
  }

  died(id: string): boolean {
    return this.of('death').some((e) => e.victimId === id);
  }
}

function check(out: Check[], name: string, pass: boolean, detail: string): void {
  out.push({ name, pass, detail });
}

// ---------------------------------------------------------------------------

export function fragScenario(): Check[] {
  const out: Check[] = [];
  // A wall across z = 3 between the thrower and `bwall` at z = 6.
  const r = new Rig([box(-4, 0, 2.8, 4, 3, 3.2)]);
  r.add('you', TEAM_A, 0, 0);
  r.add('b2', TEAM_B, 2, 0, 0, { bot: true });
  r.add('b14', TEAM_B, 14, 0, 0, { bot: true });
  r.add('bwall', TEAM_B, 0, 6, 0, { bot: true });
  r.add('ally', TEAM_A, -3, 0);
  r.run(WARMUP_MS + 200);
  // The client learns its counts from events only, so a deploy publishes the
  // fresh kit before anyone has thrown anything.
  const inv0 = r.of('ordnance-inventory').find((e) => e.actorId === 'you');
  check(out, 'spawn: the kit is published on deploy (1 lethal, 1 tactical, nothing armed)',
    inv0 !== undefined && inv0.lethal === 1 && inv0.tactical === 1 && inv0.armed === null && inv0.at <= TICK,
    JSON.stringify(inv0 ?? null));
  const arm = r.claim('you', 'frag');
  r.run(100);
  const rel = r.claim('you', 'frag');
  r.run(3200);
  const det = r.of('grenade-detonated');
  check(out, 'frag: arm and release both admitted', arm.accepted && rel.accepted, JSON.stringify([arm.reason, rel.reason]));
  check(out, 'frag: detonated once', det.length === 1 && det[0].grenadeId === 'frag', 'detonations=' + det.length);
  const d2 = r.damageTo('b2', 'explosion');
  check(out, 'frag: target at 2 m takes lethal damage', d2.length === 1 && d2[0].amount >= 100 && r.died('b2'),
    'amount=' + (d2[0]?.amount ?? 'none') + ' died=' + r.died('b2'));
  const d14 = r.damageTo('b14', 'explosion');
  check(out, 'frag: target at 14 m (radius 16) takes minimal damage', d14.length === 1 && d14[0].amount >= 1 && d14[0].amount <= 10,
    'amount=' + (d14[0]?.amount ?? 'none'));
  check(out, 'frag: target behind a wall takes none', r.damageTo('bwall').length === 0, 'events=' + r.damageTo('bwall').length);
  check(out, 'frag: team-mate at 3 m takes none (friendlyFire off)', r.damageTo('ally').length === 0, 'events=' + r.damageTo('ally').length);
  const self = r.damageTo('you', 'explosion');
  check(out, 'frag: self-damage applies (own grenade at own feet)', self.length === 1 && self[0].amount > 0 && self[0].attackerId === 'you',
    'amount=' + (self[0]?.amount ?? 'none') + ' attacker=' + String(self[0]?.attackerId));
  const kills = r.of('kill').filter((e) => e.killerId === 'you' && e.cause === 'explosion');
  check(out, 'frag: the kill is credited with cause explosion', kills.length >= 1, 'kills=' + kills.length);
  const smoke = r.of('smoke-volume');
  check(out, 'frag: leaves a small blast smoke volume', smoke.length === 1 && smoke[0].kind === 'blast' && smoke[0].radius < SMOKE_RADIUS_M / 2,
    JSON.stringify(smoke.map((s) => [s.kind, s.radius])));
  // A grenade kill is a death like any other: the corpse drops its primary.
  // (This is the check that caught the pending-scan ordering in host-ordnance.)
  const drop = r.of('drop-spawned').find((d) => d.ownerId === 'b2');
  check(out, 'frag: the frag victim drops its weapon', drop !== undefined && drop.rounds > 0, JSON.stringify(drop ?? null));
  return out;
}

export function flashScenario(): Check[] {
  const out: Check[] = [];
  // A wall at x = 1.5 between the thrower and `walled` at x = 3.
  const r = new Rig([box(1.4, 0, -4, 1.6, 3, 4)]);
  r.add('you', TEAM_A, 0, 0);
  // yaw 0 looks along -z. `face` at z = +3 looks at the origin; `back` at z = -3 looks away.
  r.add('face', TEAM_B, 0, 3, 0, { bot: true });
  r.add('back', TEAM_B, 0, -3, 0, { bot: true });
  r.add('walled', TEAM_B, 3, 0, Math.PI / 2, { bot: true });
  r.run(WARMUP_MS + 200);
  r.claim('you', 'flash');
  r.run(60);
  r.claim('you', 'flash');
  r.run(400);
  const det = r.of('grenade-detonated');
  check(out, 'flash: detonated on contact', det.length === 1 && det[0].grenadeId === 'flash', 'detonations=' + det.length);
  const hits = r.of('flash-hit');
  const face = hits.find((h) => h.victimId === 'face');
  const back = hits.find((h) => h.victimId === 'back');
  const walled = hits.find((h) => h.victimId === 'walled');
  check(out, 'flash: facing within 30 deg with LOS -> full white-out', face !== undefined && face.durationMs === FLASH_MAX_MS,
    'durationMs=' + String(face?.durationMs));
  check(out, 'flash: facing away -> half', back !== undefined && back.durationMs === FLASH_MAX_MS / 2, 'durationMs=' + String(back?.durationMs));
  check(out, 'flash: behind a wall -> none', walled === undefined, 'hit=' + JSON.stringify(walled ?? null));
  // The blinded bot cannot sense the human; after the flash it can.
  const bot: BotRuntime = {
    id: 'face', team: TEAM_B, weapon: WEAPONS[0], x: 0, y: 0, z: 3, yaw: 0, pitch: 0, speed: 0, alive: true, life: 1,
    targetId: null, targetSince: 0, lastSeen: -Infinity, side: 1, sideWant: 1, sideSince: 0, goalX: 0, goalZ: 0, goalAt: 0,
    strafe: 1, strafeAt: 0, inputSeq: 0, shotSeq: 0, cooldown: 0, streakHoldSlot: null, streakHoldUntil: 0, streakBlocked: false,
  };
  const human: BotActorView[] = [{ id: 'you', team: TEAM_A, alive: true, x: 0, y: 0, z: 0 }];
  const blind = senseBot(bot, human, r.world);
  check(out, 'bot-sense: a flashed bot senses no target', blind.targetId === null, JSON.stringify(blind));
  r.run(FLASH_MAX_MS + 200);
  const after = senseBot(bot, human, r.world);
  check(out, 'bot-sense: sight returns when the flash ends', after.targetId === 'you' && after.visible, JSON.stringify(after));
  return out;
}

export function smokeScenario(): Check[] {
  const out: Check[] = [];
  const r = new Rig([]);
  r.add('you', TEAM_A, 0, 0);
  r.add('bot', TEAM_B, -8, 0, 0, { bot: true });
  r.run(WARMUP_MS + 200);
  r.claim('you', 'smoke');
  r.run(60);
  r.claim('you', 'smoke');
  r.run(1600 + 1600);
  const vols = activeSmokeVolumes(r.world);
  check(out, 'smoke: one grenade volume live', vols.length === 1 && vols[0].kind === 'grenade' && vols[0].radius === SMOKE_RADIUS_M,
    JSON.stringify(vols.map((v) => [v.kind, v.radius])));
  const through = losBlockedBySmoke(r.world, { x: -8, y: 1, z: 0 }, { x: 8, y: 1, z: 0 });
  const tangent = losBlockedBySmoke(r.world, { x: -8, y: 1, z: SMOKE_RADIUS_M }, { x: 8, y: 1, z: SMOKE_RADIUS_M });
  check(out, 'smoke: losBlockedBySmoke true through the centre', through, 'blocked=' + through);
  check(out, 'smoke: losBlockedBySmoke false along the tangent', !tangent, 'blocked=' + tangent);
  const bot: BotRuntime = {
    id: 'bot', team: TEAM_B, weapon: WEAPONS[0], x: -8, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, alive: true, life: 1,
    targetId: null, targetSince: 0, lastSeen: -Infinity, side: 1, sideWant: 1, sideSince: 0, goalX: 0, goalZ: 0, goalAt: 0,
    strafe: 1, strafeAt: 0, inputSeq: 0, shotSeq: 0, cooldown: 0, streakHoldSlot: null, streakHoldUntil: 0, streakBlocked: false,
  };
  const human: BotActorView[] = [{ id: 'you', team: TEAM_A, alive: true, x: 8, y: 0, z: 0 }];
  const inSmoke = senseBot(bot, human, r.world);
  check(out, 'bot-sense: no visible target through the smoke', !inSmoke.visible, JSON.stringify(inSmoke));
  r.run(30_000);
  const ended = r.of('smoke-volume-end');
  const clear = senseBot(bot, human, r.world);
  check(out, 'smoke: volume ends on the bus and sight returns', ended.length >= 1 && clear.visible && activeSmokeVolumes(r.world).length === 0,
    'ends=' + ended.length + ' visible=' + clear.visible);
  return out;
}

export function knifeScenario(): Check[] {
  const out: Check[] = [];
  const r = new Rig([]);
  r.add('you', TEAM_A, 0, 0);
  r.add('v15', TEAM_B, 1.5, 0, 0, { bot: true });
  r.add('v18', TEAM_B, 40, 40, 0, { bot: true });
  r.run(WARMUP_MS + 200);
  const east = { x: 1, y: 0, z: 0 };
  const swing = r.claim('you', 'knife', east);
  const seq = r.lastSeq('you');
  r.tick();
  const hit = r.damageTo('v15', 'melee');
  check(out, 'knife: 1.5 m is a one-hit kill', swing.accepted && hit.length === 1 && hit[0].amount === 100 && r.died('v15'),
    'amount=' + (hit[0]?.amount ?? 'none') + ' died=' + r.died('v15'));
  const glyphKill = r.of('kill').find((e) => e.cause === 'melee' && e.weaponId === 'knife');
  check(out, 'knife: the kill event carries cause melee / weapon knife', glyphKill !== undefined, JSON.stringify(glyphKill ?? null));
  const replay = r.claim('you', 'knife', east, seq);
  check(out, 'knife: a replayed claim is refused with a reason', !replay.accepted && replay.reason === 'duplicate',
    JSON.stringify([replay.reason, replay.label]));
  const early = r.claim('you', 'knife', east);
  check(out, 'knife: a second swing inside 0.8 s is refused melee-cooldown', !early.accepted && early.reason === 'melee-cooldown',
    JSON.stringify([early.reason, early.label]));
  r.place('v15', 40, -40);
  r.place('v18', 1.8, 0);
  r.run(KNIFE_RECOVERY_MS + 100);
  const before = r.of('melee').length;
  const miss = r.claim('you', 'knife', east);
  r.tick();
  const melees = r.of('melee');
  check(out, 'knife: 1.8 m is a miss (admitted, no victim, no damage)',
    miss.accepted && melees.length === before + 1 && melees[melees.length - 1].victimId === null && r.damageTo('v18').length === 0,
    'victim=' + String(melees[melees.length - 1]?.victimId) + ' dmg=' + r.damageTo('v18').length);
  return out;
}

export function dropsScenario(): Check[] {
  const out: Check[] = [];
  const r = new Rig([]);
  r.add('you', TEAM_A, 0, 0);
  const bots: string[] = [];
  for (let i = 1; i <= DROP_MAX_LIVE + 1; i++) {
    const id = 'r' + String(i).padStart(2, '0');
    bots.push(id);
    r.add(id, TEAM_B, 30, 30, 0, { bot: true, primaryId: 'rattler' });
  }
  r.run(WARMUP_MS + 200);
  const east = { x: 1, y: 0, z: 0 };
  // Thirteen knife kills at 1.5 m: thirteen corpses, twelve drops.
  for (const id of bots) {
    r.place(id, 1.5, 0);
    r.tick();
    r.claim('you', 'knife', east);
    r.tick();
    r.place(id, 30, 30);
    r.run(KNIFE_RECOVERY_MS + 50);
  }
  const spawned = r.of('drop-spawned');
  const culled = r.of('drop-removed').filter((e) => e.reason === 'culled');
  const live = r.host.snapshot().ordnance?.drops ?? [];
  check(out, 'drops: every corpse drops its primary with its rounds',
    spawned.length === DROP_MAX_LIVE + 1 && spawned.every((d) => d.weaponId === 'rattler' && d.rounds === fullRounds('rattler')),
    'spawned=' + spawned.length + ' weapons=' + JSON.stringify([...new Set(spawned.map((d) => d.weaponId + ':' + d.rounds))]));
  check(out, 'drops: cap 12 live, oldest culled', live.length === DROP_MAX_LIVE && culled.length === 1 && culled[0].id === spawned[0].id,
    'live=' + live.length + ' culled=' + JSON.stringify(culled.map((c) => c.id)));

  // Swap at 2.3 m: take the rattler, leave the longhorn in the same drop.
  r.place('you', 1.5 - 2.3, 0);
  r.tick();
  const swap = r.claim('you', 'pickup', east);
  r.tick();
  const pick = r.of('pickup').find((p) => p.kind === 'swap');
  const changed = r.of('drop-changed').find((c) => pick !== undefined && c.id === pick.dropId);
  check(out, 'drops: swap at 2.3 m takes the drop weapon and leaves ours in its place',
    swap.accepted && pick !== undefined && pick.weaponId === 'rattler' && pick.leftWeaponId === 'longhorn'
      && changed !== undefined && changed.weaponId === 'longhorn' && (r.actor('you')?.primaryId === 'rattler'),
    JSON.stringify({ accepted: swap.accepted, pick: pick ?? null, dropNow: changed?.weaponId, primary: r.actor('you')?.primaryId }));
  // Swap at 2.4 m is refused, with a reason. From the FAR side of the pile:
  // the swap above left our longhorn at our old feet, 2.3 m west of the pile,
  // and standing 2.4 m west would put us 0.1 m from that one.
  r.place('you', 1.5 + 2.4, 0);
  r.tick();
  const far = r.claim('you', 'pickup', { x: -1, y: 0, z: 0 });
  check(out, 'drops: swap at 2.4 m is refused too-far', !far.accepted && far.reason === 'too-far', JSON.stringify([far.reason, far.label]));

  // Scavenge: fire ten rattler rounds (we now carry the rattler), stand at 1.1 m (nothing), then 1.0 m (ammo).
  r.place('you', -5, 0);
  r.tick();
  for (let i = 0; i < 10; i++) { r.claim('you', 'rattler', { x: 0, y: 1, z: 0 }); r.tick(); }
  const roundsBefore = r.actor('you')?.rounds ?? -1;
  // Read the ground AFTER the swap: the swapped drop now holds the longhorn at
  // our old feet, every other one still holds a rattler where its owner fell.
  const ground = r.host.snapshot().ordnance.drops;
  const fresh = ground.find((d) => d.weaponId === 'rattler');
  const pouch = ground.find((d) => d.id !== fresh?.id && d.grenades > 0);
  if (fresh === undefined || pouch === undefined) {
    check(out, 'drops: a rattler drop and a second pouch remain to scavenge from', false,
      JSON.stringify(ground.map((d) => [d.id, d.weaponId, d.rounds, d.grenades])));
    return out;
  }
  r.place('you', fresh.x - 1.1, fresh.z);
  r.run(400);
  const at11 = r.of('pickup').filter((p) => p.kind === 'scavenge').length;
  r.place('you', fresh.x - 1.0, fresh.z);
  r.run(400);
  const scav = r.of('pickup').filter((p) => p.kind === 'scavenge');
  check(out, 'drops: scavenge at 1.1 m grants nothing, at 1.0 m grants the ten rounds fired',
    at11 === 0 && scav.length === 1 && scav[0].rounds === 10 && (r.actor('you')?.rounds ?? 0) === roundsBefore + 10,
    'at1.1=' + at11 + ' at1.0=' + JSON.stringify(scav.map((s) => [s.rounds, s.grenades])) + ' rounds ' + roundsBefore + '->' + r.actor('you')?.rounds);

  // Grenades top up from a drop: spend both (lobbed 16 m down +z, outside
  // their own blast and flash radii), walk over a fresh pouch.
  r.place('you', -5, 0);
  r.tick();
  const lob = { x: 0, y: Math.SQRT1_2, z: Math.SQRT1_2 };
  r.claim('you', 'frag'); r.tick(); r.claim('you', 'frag', lob); r.tick();
  r.claim('you', 'flash'); r.tick(); r.claim('you', 'flash', lob); r.tick();
  const spent = r.actor('you');
  r.place('you', pouch.x - 0.5, pouch.z);
  r.run(400);
  const refilled = r.actor('you');
  const grenadePick = r.of('pickup').filter((p) => p.kind === 'scavenge' && p.grenades > 0);
  check(out, 'drops: pickups replenish grenades (1 lethal + 1 tactical from one pouch)',
    (spent?.lethal ?? 1) === 0 && (spent?.tactical ?? 1) === 0 && (refilled?.lethal ?? 0) === 1 && (refilled?.tactical ?? 0) === 1
      && grenadePick.length >= 1 && grenadePick[grenadePick.length - 1].grenades === 2,
    JSON.stringify({ spent: [spent?.lethal, spent?.tactical], refilled: [refilled?.lethal, refilled?.tactical], granted: grenadePick.map((g) => g.grenades) }));

  // Lifetime: the oldest SURVIVING drop (the first was culled) expires 30 s
  // after it was born, and not a tick before.
  r.place('you', -15, -20);
  const oldest = spawned[1];
  const early = oldest.at + DROP_LIFETIME_MS - TICK * 2 - r.now;
  if (early > 0) r.run(early);
  const expiredEarly = r.of('drop-removed').filter((e) => e.reason === 'expired').length;
  r.run(TICK * 4);
  const expired = r.of('drop-removed').filter((e) => e.reason === 'expired');
  check(out, 'drops: 30 s lifetime, expired with a reason and not before',
    expiredEarly === 0 && expired.length >= 1 && expired[0].id === oldest.id,
    'early=' + expiredEarly + ' expired=' + JSON.stringify(expired.map((e) => e.id)) + ' bornAt=' + oldest.at.toFixed(0) + ' now=' + r.now.toFixed(0));
  return out;
}

/** A bot record for the reducer, at a point, with the reaction delay already served. */
function botAt(id: string, x: number, z: number, now: number): BotRuntime {
  return {
    id, team: TEAM_B, weapon: WEAPONS[0], x, y: 0, z, yaw: 0, pitch: 0, speed: 0, alive: true, life: 1,
    targetId: 'you', targetSince: now - BOT_REACTION_MS - 1, lastSeen: now, side: 1, sideWant: 1, sideSince: 0,
    goalX: 0, goalZ: 0, goalAt: 0, strafe: 1, strafeAt: 0, inputSeq: 0, shotSeq: 0, cooldown: 0,
    streakHoldSlot: null, streakHoldUntil: 0, streakBlocked: false,
  };
}

/**
 * The bot side, both halves: the pure reducer's ordnance intents (what
 * `bots.ts` will act on once it passes the supply and drops through), and a
 * bot-authored throw built with `bot-ordnance.ts`'s claim helpers and admitted
 * by the real host - the exact lines the lobby lane's handover adds.
 */
export function botsScenario(): Check[] {
  const out: Check[] = [];
  const now = 20_000;
  const world = createWorldQuery([]);
  const you: BotActorView[] = [{ id: 'you', team: TEAM_A, alive: true, x: 0, y: 0, z: 0 }];
  const full: BotSupply = { lethal: 1, tactical: 1, rounds: 100, armed: null };
  const intentAt = (dist: number, supply: BotSupply | null, bot: BotRuntime = botAt('bot-01', 0, dist, now)) =>
    botIntent(bot, senseBot(bot, you, world), now, 100, null, supply);

  const mid = intentAt(10, full);
  check(out, 'bots: a visible target at 10 m draws a frag and holds the trigger', mid.grenade === 'frag' && !mid.fire, JSON.stringify([mid.grenade, mid.fire]));
  const near = intentAt(5, full);
  check(out, 'bots: 5 m is under the 7 m window - no grenade, trigger free', near.grenade === null && near.fire, JSON.stringify([near.grenade, near.fire]));
  const farI = intentAt(20, full);
  check(out, 'bots: 20 m is past the 18 m window - no grenade', farI.grenade === null && farI.fire, JSON.stringify([farI.grenade, farI.fire]));
  const cooling = botAt('bot-01', 0, 10, now);
  cooling.grenadeAt = now - BOT_GRENADE_COOLDOWN_MS + 1000;
  const cool = intentAt(10, full, cooling);
  check(out, 'bots: inside the 12 s cooldown - no grenade', cool.grenade === null && cool.fire, JSON.stringify([cool.grenade, cool.fire]));
  const tac = intentAt(10, { ...full, lethal: 0 });
  const tac2 = intentAt(10, { ...full, lethal: 0 }, botAt('bot-02', 0, 10, now));
  check(out, 'bots: with no frag the tactical goes, alternating by roster serial',
    (TACTICAL_IDS as readonly string[]).includes(String(tac.grenade)) && (TACTICAL_IDS as readonly string[]).includes(String(tac2.grenade)) && tac.grenade !== tac2.grenade,
    JSON.stringify([tac.grenade, tac2.grenade]));
  const armedBot = intentAt(10, { ...full, armed: 'frag' });
  check(out, 'bots: already holding one - no second arm', armedBot.grenade === null, JSON.stringify(armedBot.grenade));
  const knifeI = intentAt(1.8, full);
  check(out, 'bots: 1.8 m is a knife, not a shot', knifeI.knife && !knifeI.fire && knifeI.grenade === null, JSON.stringify([knifeI.knife, knifeI.fire]));
  const noPort = intentAt(10, null);
  check(out, 'bots: no supply (today\'s bots.ts) - the old reducer answer, unchanged', noPort.grenade === null && !noPort.knife && noPort.fire, JSON.stringify(noPort));
  const dry = botAt('bot-01', 0, 30, now);
  const dryIntent = botIntent(dry, senseBot(dry, [], world), now, 100, null, { ...full, rounds: 0 }, [{ x: 4, z: 27, weaponId: 'longhorn', rounds: 40 }]);
  check(out, 'bots: out of rounds with nothing in sight - walks to the nearest drop',
    dryIntent.scavengeX === 4 && dryIntent.scavengeZ === 27 && dryIntent.moveX > 0.5 && dryIntent.moveZ < 0,
    JSON.stringify([dryIntent.scavengeX, dryIntent.scavengeZ, +dryIntent.moveX.toFixed(2), +dryIntent.moveZ.toFixed(2)]));

  // A bot-authored throw through the real host: two claims from the helpers.
  const r = new Rig([]);
  r.add('you', TEAM_A, 0, 10);
  r.add('bot-01', TEAM_B, 0, 0, 0, { bot: true, primaryId: 'rattler' });
  r.run(WARMUP_MS + 200);
  const life = r.host.lifeOf('bot-01') ?? 1;
  const from = { x: 0, y: BOT_AIM_ORIGIN_Y, z: 0 };
  const dir = { x: 0, y: 0, z: 0 };
  throwDirection(from, { x: 0, y: BOT_AIM_ORIGIN_Y, z: 10 }, dir);
  const arm = r.host.submitShot('bot-01', botOrdnanceClaim(life, 'frag', from.x, from.y, from.z, dir, 1, r.now), r.now);
  const rel = r.host.submitShot('bot-01', botOrdnanceClaim(life, 'frag', from.x, from.y, from.z, dir, 2, r.now), r.now);
  r.run(3500);
  const thrown = r.of('grenade-thrown').filter((e) => e.actorId === 'bot-01');
  const det = r.of('grenade-detonated').filter((e) => e.actorId === 'bot-01');
  const hurt = r.damageTo('you', 'explosion');
  check(out, 'bots: the helper-built arm+release claims are admitted and the frag flies and goes off',
    arm.accepted && rel.accepted && thrown.length === 1 && det.length === 1, JSON.stringify([arm.reason, rel.reason, thrown.length, det.length]));
  check(out, 'bots: the lob lands near a 10 m target and its blast reaches the human, bot-scaled',
    det.length === 1 && Math.hypot(det[0].x, det[0].z - 10) < 6 && hurt.length === 1 && hurt[0].attackerId === 'bot-01' && hurt[0].amount < 100,
    JSON.stringify({ landed: det.map((d) => [+d.x.toFixed(1), +d.z.toFixed(1)]), amount: hurt[0]?.amount ?? null }));
  return out;
}

/** Library singletons stand in for `core/materials.ts`: a viewmodel only needs objects to hand to meshes. */
const STUB_MAT = {
  painted: () => ({}), chrome: {}, steel: {}, timber: {}, timberDark: {}, glass: {},
} as unknown as MaterialLibrary;

/**
 * The client half of a throw, a stab and a reach: `weapons/ordnance-input.ts`
 * over the real `OrdnanceHand`, driven at 60 Hz with the host's level pushed
 * in by hand the way `ordnance-scene.ts` pushes it. What it pins is the CLAIM
 * COUNT: one per arm, one per release at the release frame, one per strike,
 * one per matured use-hold - and none from a hand the host refused, which
 * must simply come down again.
 */
export function handScenario(): Check[] {
  const out: Check[] = [];
  const input = new OrdnanceInput(STUB_MAT, new THREE.Scene());
  const cam = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const claims: { t: number; id: string }[] = [];
  let t = 0;
  const DT = 1 / 60;
  /** Host tick latency, in frames: the claim is answered three frames later. */
  const HOST_LAG = 3;
  // A stand-in host kit, and the client's copy of it. The copy is what the
  // level push carries; it lags the kit by HOST_LAG frames the way an
  // `ordnance-inventory` event lags a claim. It starts EMPTY on purpose: a
  // fresh life's first inventory event has not arrived yet.
  const kit = { lethal: 1, tactical: 1, armed: null as string | null };
  const level = { lethal: 0, tactical: 0, tacticalId: 'flash', armed: null as string | null };
  const dueLevels: { at: number; snap: { lethal: number; tactical: number; armed: string | null } }[] = [];
  const isLethal = (id: string) => id === 'frag';
  /** What `host-ordnance.ts:grenadeClaim` does with one grenade claim. */
  const hostReact = (id: string): void => {
    if (id === 'knife' || id === 'pickup') return;
    if (kit.armed === null) {
      if ((isLethal(id) ? kit.lethal : kit.tactical) <= 0) return; // refused no-grenade: nothing changes
      kit.armed = id;
    } else if (kit.armed === id) {
      if (isLethal(id)) kit.lethal--; else kit.tactical--;
      kit.armed = null;
    }
    dueLevels.push({ at: t + HOST_LAG * DT, snap: { lethal: kit.lethal, tactical: kit.tactical, armed: kit.armed } });
  };
  const frames = (n: number): void => {
    for (let i = 0; i < n; i++) {
      t += DT;
      while (dueLevels.length > 0 && dueLevels[0].at <= t + 1e-9) Object.assign(level, (dueLevels.shift() as { snap: object }).snap);
      // The level, pushed EVERY frame exactly as `ordnance-scene.ts` does:
      // that push is what brings a refused or spent hand back down.
      input.setLevel(level.lethal, level.tactical, level.tacticalId, level.armed);
      input.update(DT, cam, q, t, 0, 0);
      for (let id = input.takeClaim(); id !== null; id = input.takeClaim()) { claims.push({ t: +t.toFixed(3), id }); hostReact(id); }
    }
  };
  const since = (n: number) => claims.slice(n);

  // A fresh life before the host's first inventory event: G still arms.
  frames(6);
  const r1 = input.command('grenade', 'frag');
  const t0 = t;
  frames(60);
  check(out, 'hand: G arms - one claim, the hand up, and nothing more while it is held a second',
    r1 === 'armed' && claims.length === 1 && claims[0].id === 'frag' && input.holding && level.armed === 'frag',
    JSON.stringify([r1, claims, input.hand.current, level]));
  const r2 = input.command('grenade');
  const tRel = t;
  frames(120);
  check(out, 'hand: release - exactly one more claim, at the release frame, then idle and spent',
    r2 === 'released' && claims.length === 2 && claims[1].id === 'frag' && Math.abs(claims[1].t - tRel - THROW_RELEASE_S) < 2 * DT + 1e-6
      && input.hand.current === 'idle' && level.armed === null && level.lethal === 0 && t - t0 > 2,
    JSON.stringify([r2, claims, input.hand.current, level]));

  // A refused arm (no frag left): the claim goes, the host says no, the hand comes down by itself.
  const n0 = claims.length;
  input.command('grenade', 'frag');
  frames(Math.ceil((ARM_CONFIRM_S + 0.1) / DT));
  check(out, 'hand: an arm the host refused is one claim and a hand that drops within ARM_CONFIRM_S',
    since(n0).length === 1 && input.hand.current === 'idle', JSON.stringify([since(n0), input.hand.current]));
  // A refused arm followed by a quick release: the release claim must NOT go
  // (the host would read it as a fresh arm and cook it off in the hand).
  const n0b = claims.length;
  input.command('grenade', 'frag');
  frames(3);
  input.command('grenade');
  frames(Math.ceil((RELEASE_WAIT_S + 0.6) / DT));
  check(out, 'hand: a release after an unconfirmed arm sends no claim and the hand ends idle',
    since(n0b).length === 1 && since(n0b)[0].id === 'frag' && input.hand.current === 'idle' && level.armed === null,
    JSON.stringify([since(n0b), input.hand.current, level]));

  // The knife: one claim at the strike frame; a second swing inside recovery is refused locally.
  const n1 = claims.length;
  const s1 = input.command('knife', undefined, t * 1000);
  frames(2);
  const s2 = input.command('knife', undefined, t * 1000);
  frames(Math.ceil(0.6 / DT));
  check(out, 'hand: V swings once - one knife claim at the strike frame, the second swing refused',
    s1 === true && s2 === false && since(n1).length === 1 && since(n1)[0].id === 'knife' && since(n1)[0].t - (t - 0.6 - 2 * DT) < KNIFE_STRIKE_S + 3 * DT,
    JSON.stringify([s1, s2, since(n1)]));

  // Use: a tap does nothing, a hold matures once.
  const n2 = claims.length;
  input.keyDown('KeyE', t * 1000);
  frames(Math.ceil(USE_HOLD_S / 2 / DT));
  input.keyUp('KeyE');
  frames(10);
  const tapClaims = since(n2).length;
  input.keyDown('KeyE', t * 1000);
  frames(Math.ceil((USE_HOLD_S + 0.5) / DT));
  input.keyUp('KeyE');
  check(out, 'hand: a tap of E claims nothing, a hold claims one pickup', tapClaims === 0 && since(n2).length === 1 && since(n2)[0].id === 'pickup',
    JSON.stringify([tapClaims, since(n2)]));

  // The keys: G down arms, G up throws. (A few frames first: the reach above
  // runs PICKUP_S and a G during it is refused as busy, like the trigger.)
  frames(12);
  // A pickup re-issued the frag; the level names smoke as the tactical.
  const n3 = claims.length;
  kit.lethal = 1;
  Object.assign(level, { lethal: 1, tactical: 1, tacticalId: 'smoke' });
  input.keyDown('KeyG', t * 1000);
  frames(34);
  input.keyUp('KeyG');
  frames(60);
  check(out, 'hand: G down / G up is arm then release - two frag claims', since(n3).length === 2 && since(n3).every((c) => c.id === 'frag') && input.hand.current === 'idle',
    JSON.stringify([since(n3), input.hand.current, level]));
  // Q tapped faster than a host tick: the release waits for the arm to be confirmed, then goes.
  const n4 = claims.length;
  input.keyDown('KeyQ', t * 1000);
  frames(1);
  input.keyUp('KeyQ');
  frames(60);
  check(out, 'hand: a fast Q tap throws the tactical the level names - the release waited for the confirm',
    since(n4).length === 2 && since(n4).every((c) => c.id === 'smoke') && since(n4)[1].t - since(n4)[0].t >= HOST_LAG * DT - 1e-6 && level.tactical === 0,
    JSON.stringify([since(n4), level]));
  return out;
}

/** Scenario names; the runner calls `<name>Scenario` for each, guarded. */
export const SCENARIOS = ['frag', 'flash', 'smoke', 'knife', 'drops', 'bots', 'hand'] as const;
