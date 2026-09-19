/**
 * Atomic Acres — ordnance in the world and on the HUD: the one object
 * `main.ts` holds for grenades, smoke, drops, the flash white-out and the
 * pickup prompt.
 *
 * It sits between the client's projection (`game/ordnance-view.ts`, read every
 * frame off whichever `GameClient` the session bound) and three consumers:
 * the instanced meshes (`grenades.ts`, `drops.ts`), the HUD's three ordnance
 * setters, and the controller's level (`setOrdnance`) and verdicts
 * (`adoptWeapon`, `grantRounds`, `onSelfSpawn`). Everything here is a COPY
 * of a host decision; nothing is decided.
 *
 * Why it wraps `bindClient` rather than reading the session: `game/session*`
 * is the lobby lane's, and the only seam the session already offers for
 * "here is the live client" is the `MatchUi.bindClient` call it makes on
 * every match build. `main.ts` hands the session a `MatchUi` that calls
 * `bind()` here and then the UI's own, so a rematch (new host, new client)
 * re-points this object with no lobby-lane change.
 *
 * Flight replay reads the SAME `WorldQuery` arithmetic the host used, over the
 * same collider array, built here for presentation only.
 */
import type * as THREE from 'three';
import type { AABB } from '../core/kit';
import type { MaterialLibrary } from '../core/materials';
import type { GameClient } from '../game/client';
import type { WorldQuery } from '../game/events';
import { loadLoadout, resolveLoadout } from '../game/loadout';
import { TACTICAL_IDS } from '../game/ordnance';
import type { OrdnanceView } from '../game/ordnance-view';
import { DROP_SWAP_RANGE_M } from '../game/pickups';
import { createWorldQuery } from '../game/world-query';
import type { HudApi } from '../ui/hud';
import { WEAPONS } from './catalog';
import type { WeaponsController } from './controller';
import { DropFx, nearestDropView } from './drops';
import { GrenadeFx } from './grenades';

/** The white-out holds at its peak for this fraction of the flash, then fades linearly. */
export const FLASH_HOLD_FRACTION = 0.25;

export interface OrdnanceSceneOptions {
  readonly scene: THREE.Scene;
  readonly mat: MaterialLibrary;
  readonly colliders: readonly AABB[];
  readonly hud: HudApi;
  readonly weapons: WeaponsController;
}

const WEAPON_NAME: ReadonlyMap<string, string> = new Map(WEAPONS.map((w) => [w.id, w.name.toUpperCase()]));

export class OrdnanceScene {
  private client: GameClient | null = null;
  private readonly world: WorldQuery;
  private readonly grenades: GrenadeFx;
  private readonly drops: DropFx;
  private readonly hud: HudApi;
  private readonly weapons: WeaponsController;
  private tacticalId: string = TACTICAL_IDS[0];
  private lastPickupSeq = 0;
  private lastSpawnSeq = 0;
  private readonly onBlast: (x: number, y: number, z: number) => void;

  constructor(opts: OrdnanceSceneOptions) {
    this.world = createWorldQuery(opts.colliders);
    this.grenades = new GrenadeFx(opts.mat, this.world);
    this.drops = new DropFx(opts.mat);
    opts.scene.add(this.grenades.group);
    opts.scene.add(this.drops.group);
    this.hud = opts.hud;
    this.weapons = opts.weapons;
    this.onBlast = (x, y, z) => this.weapons.blastAt(x, y, z);
  }

  /** The tactical the player's kit carries; a kit whose grenade is lethal throws the first tactical. */
  private static tacticalFor(): string {
    const g = resolveLoadout(loadLoadout()).grenade;
    return (TACTICAL_IDS as readonly string[]).includes(g) ? g : TACTICAL_IDS[0];
  }

  /** A new match's client (or null at teardown). Called through the session's `MatchUi`. */
  bind(client: GameClient | null): void {
    this.client = client;
    this.tacticalId = OrdnanceScene.tacticalFor();
    this.lastPickupSeq = client === null ? 0 : client.ordnance.self.pickupSeq;
    this.lastSpawnSeq = client === null ? 0 : client.ordnance.self.spawnSeq;
    if (client === null) {
      this.hud.setPrompt(null);
      this.hud.setFlash(0);
    }
  }

  /** One frame. `nowMs` is `performance.now()`, the host clock domain; (px, py, pz) the player's feet. */
  update(dt: number, nowMs: number, px: number, py: number, pz: number): void {
    const c = this.client;
    if (c === null) return;
    const v: OrdnanceView = c.ordnance;
    v.expire(nowMs);
    this.grenades.update(dt, nowMs, v, this.onBlast);
    this.drops.update(nowMs, v);

    const self = v.self;
    // Verdicts the controller must act on, as edges off the projection's counters.
    if (self.spawnSeq !== this.lastSpawnSeq) {
      this.lastSpawnSeq = self.spawnSeq;
      this.weapons.onSelfSpawn();
    }
    if (self.pickupSeq !== this.lastPickupSeq) {
      this.lastPickupSeq = self.pickupSeq;
      if (self.lastPickupKind === 'swap' && self.lastPickupWeaponId !== null) {
        this.weapons.adoptWeapon(self.lastPickupWeaponId, self.lastPickupRounds);
      } else if (self.lastPickupKind === 'scavenge' && self.lastPickupWeaponId !== null && self.lastPickupRounds > 0) {
        this.weapons.grantRounds(self.lastPickupWeaponId, self.lastPickupRounds);
      }
    }
    // Levels: the controller's raise gate, the HUD's counts, the white-out, the prompt.
    this.weapons.setOrdnance(self.lethal, self.tactical, this.tacticalId, self.armed);
    this.hud.setGrenades(self.lethal, self.tactical, this.tacticalId, self.armed);
    this.hud.setFlash(flashOpacity(nowMs, self.flashAt, self.flashMs, self.flashPeak));
    const d = nearestDropView(v, px, py, pz, DROP_SWAP_RANGE_M);
    if (d === null) {
      this.hud.setPrompt(null);
    } else {
      const name = WEAPON_NAME.get(d.weaponId) ?? d.weaponId.toUpperCase();
      this.hud.setPrompt(d.weaponId === self.primaryId
        ? 'HOLD E · TAKE ' + name + ' AMMO (' + d.rounds + ')'
        : 'HOLD E TO SWAP · ' + name + ' (' + d.rounds + ')');
    }
  }

  /** QA readout for the browser proof: the projection's log, counts and live pools. */
  qa(): Record<string, unknown> {
    const c = this.client;
    if (c === null) return { bound: false };
    const v = c.ordnance;
    return {
      bound: true,
      lines: v.lines.slice(),
      counts: { ...v.counts },
      self: { ...v.self },
      live: this.grenades.counts(v),
      drops: v.drops.map((d) => ({ id: d.id, weaponId: d.weaponId, rounds: d.rounds, grenades: d.grenades, x: d.x, y: d.y, z: d.z })),
      smokes: v.smokes.map((s) => ({ id: s.id, kind: s.kind, radius: s.radius })),
      hand: this.weapons.command('ordnance'),
    };
  }
}

/**
 * White-out opacity for a flash that peaked at `peak` at `at` and lasts `ms`:
 * full for the first quarter, then a straight fade. Pure, so the HUD proof
 * can pin the curve without a page.
 */
export function flashOpacity(nowMs: number, at: number, ms: number, peak: number): number {
  if (!(ms > 0) || !(peak > 0)) return 0;
  const t = (nowMs - at) / ms;
  if (!(t >= 0) || t >= 1) return 0;
  if (t <= FLASH_HOLD_FRACTION) return peak;
  return peak * (1 - (t - FLASH_HOLD_FRACTION) / (1 - FLASH_HOLD_FRACTION));
}
