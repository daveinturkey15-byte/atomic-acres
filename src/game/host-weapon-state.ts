/** Shared data contract and host-only magazine/reload/charge authority.
 * Intents carry no client-authored clock, ammunition, or completion fraction. */
import { ALL_WEAPONS } from '../weapons/catalog';
import type { ShotRejectReason } from './events';
export const RAIL_CHARGE_MS = 750;
export const WEAPON_INTENT_ACTIONS = ['equip', 'reload', 'charge-start', 'cancel'] as const;
export type WeaponIntentAction = typeof WEAPON_INTENT_ACTIONS[number];
export interface WeaponIntent {
  readonly seq: number;
  readonly life: number;
  readonly weaponId: string;
  readonly action: WeaponIntentAction;
}
export const WEAPON_INTENT_REASONS = ['malformed', 'unknown-shooter', 'match-inactive', 'life-epoch',
  'shooter-dead', 'duplicate', 'possessing', 'weapon-not-owned', 'weapon-not-active', 'busy',
  'already-reloading', 'magazine-full', 'no-reserve', 'not-charge-weapon'] as const;
export type WeaponIntentReason = typeof WEAPON_INTENT_REASONS[number];
export interface WeaponAmmoState {
  readonly weaponId: string;
  readonly mag: number;
  readonly reserve: number;
  readonly reloadRemainingMs: number;
  readonly reloadDurationMs: number;
  /** null means not charging. Elapsed is measured solely from host admission. */
  readonly chargeElapsedMs: number | null;
  readonly chargeRequiredMs: number;
}
export interface WeaponState {
  readonly life: number;
  /** Host clock; receive-side localization belongs to the existing event-clock seam. */
  readonly at: number;
  readonly revision: number;
  readonly activeWeaponId: string;
  readonly lastIntentSeq: number;
  readonly lastIntentReason: WeaponIntentReason | null;
  readonly lastShotSeq: number;
  /** Exact bounded acknowledgements, including refused firearm claims. Never infer
   * that every lower seq resolved from the high-water mark under reorder. */
  readonly resolvedShotSeqs: readonly number[];
  readonly primary: WeaponAmmoState;
  readonly sidearm: WeaponAmmoState;
}
export interface WeaponIntentResult {
  readonly accepted: boolean;
  readonly reason: WeaponIntentReason | null;
}

export interface MagazineContents { readonly weaponId: string; readonly mag: number; readonly reserve: number }
interface Magazine extends MagazineContents {
  mag: number; reserve: number;
  reload: { start: number; end: number } | null;
  reloadDuration: number;
  reloadHistory: { start: number; end: number }[];
  reloadHistoryFloor: number;
  charges: { start: number; end: number | null; spent: boolean }[];
}
const DEFS = new Map(ALL_WEAPONS.map(w => [w.id, w]));
const LIMIT = 64;
function lastWhere<T>(rows: readonly T[], accept: (row: T) => boolean): T | undefined {
  for (let i = rows.length - 1; i >= 0; i--) if (accept(rows[i])) return rows[i];
  return undefined;
}
function magazine(id: string, contents?: MagazineContents): Magazine {
  const def = DEFS.get(id);
  if (!def) throw new Error(`Unknown issued weapon ${id}`);
  const mag = contents ? Math.max(0, Math.min(def.magSize, Math.floor(Number.isFinite(contents.mag) ? contents.mag : 0))) : def.magSize;
  const reserve = contents ? Math.max(0, Math.min(def.magSize + def.startReserve - mag, Math.floor(Number.isFinite(contents.reserve) ? contents.reserve : 0))) : def.startReserve;
  return { weaponId: id, mag, reserve, reload: null, reloadDuration: 0, reloadHistory: [], reloadHistoryFloor: -Infinity, charges: [] };
}

/** One life owns one instance. Counts are never reconstructed from a total. */
export class HostWeaponState {
  private primaryAmmo: Magazine;
  private readonly sidearmAmmo: Magazine;
  private activeId: string;
  private readonly equipped: { at: number; weaponId: string }[];
  private clock = 0;
  private revision = 0;
  private intentSeq = -1;
  private intentReason: WeaponIntentReason | null = null;
  private shotSeq = -1;
  private readonly resolved: number[] = [];

  constructor(readonly life: number, primaryId: string, sidearmId: string) {
    this.primaryAmmo = magazine(primaryId); this.sidearmAmmo = magazine(sidearmId);
    this.activeId = primaryId; this.equipped = [{ at: -Infinity, weaponId: primaryId }];
  }
  get primary(): MagazineContents { return this.primaryAmmo; }
  get sidearm(): MagazineContents { return this.sidearmAmmo; }
  get activeWeaponId(): string { return this.activeId; }
  private row(id: string): Magazine | null {
    return id === this.primaryAmmo.weaponId ? this.primaryAmmo : id === this.sidearmAmmo.weaponId ? this.sidearmAmmo : null;
  }
  private now(now: number): number { if (Number.isFinite(now)) this.clock = Math.max(this.clock, now); return this.clock; }
  advance(now: number): void {
    now = this.now(now);
    for (const row of [this.primaryAmmo, this.sidearmAmmo]) {
      if (row.reload && now >= row.reload.end) {
        const take = Math.min(DEFS.get(row.weaponId)!.magSize - row.mag, row.reserve);
        row.mag += take; row.reserve -= take; row.reload = null; this.revision++;
      }
    }
  }
  /** Close intervals, retaining already-fired trade/reorder eligibility. */
  cancelActions(at: number): void {
    for (const row of [this.primaryAmmo, this.sidearmAmmo]) {
      if (row.reload) { row.reload.end = Math.min(row.reload.end, at); row.reload = null; this.revision++; }
      for (const charge of row.charges) if (charge.end === null) { charge.end = at; this.revision++; }
    }
  }
  /** A lost control connection cannot resume any previous charge ticket. Reload
   * and issued ammunition remain owned by the same life across that boundary. */
  cancelCharge(): void {
    for (const row of [this.primaryAmmo, this.sidearmAmmo]) {
      if (row.charges.length) { row.charges.length = 0; this.revision++; }
    }
  }
  intent(intent: WeaponIntent, receivedAt: number, context: { active: boolean; alive: boolean; possessing: boolean; busy: boolean }): WeaponIntentResult {
    if (!Number.isSafeInteger(intent.seq) || intent.seq < 0 || !Number.isSafeInteger(intent.life)
      || typeof intent.weaponId !== 'string' || !(WEAPON_INTENT_ACTIONS as readonly string[]).includes(intent.action)
      || !Number.isFinite(receivedAt)) return { accepted: false, reason: 'malformed' };
    if (intent.life !== this.life) return { accepted: false, reason: 'life-epoch' };
    if (intent.seq <= this.intentSeq) return { accepted: false, reason: 'duplicate' };
    if (intent.seq > this.intentSeq + 512) return { accepted: false, reason: 'malformed' };
    this.advance(receivedAt); const now = this.clock;
    this.intentSeq = intent.seq; this.revision++;
    const refuse = (reason: WeaponIntentReason): WeaponIntentResult => {
      this.intentReason = reason; return { accepted: false, reason };
    };
    if (!context.active) return refuse('match-inactive');
    if (!context.alive) return refuse('shooter-dead');
    if (context.possessing) return refuse('possessing');
    const row = this.row(intent.weaponId);
    if (!row) return refuse('weapon-not-owned');
    if (intent.action !== 'equip' && intent.weaponId !== this.activeId) return refuse('weapon-not-active');
    if (intent.action === 'cancel') this.cancelActions(now);
    else if (context.busy) return refuse('busy');
    else if (intent.action === 'equip') {
      if (this.activeId !== intent.weaponId) {
        this.cancelActions(now); this.activeId = intent.weaponId;
        this.equipped.push({ at: now, weaponId: intent.weaponId });
        if (this.equipped.length > LIMIT) this.equipped.shift();
      }
    } else if (intent.action === 'reload') {
      if (row.reload) return refuse('already-reloading');
      const def = DEFS.get(row.weaponId)!;
      if (row.mag >= def.magSize) return refuse('magazine-full');
      if (row.reserve <= 0) return refuse('no-reserve');
      this.cancelActions(now);
      row.reloadDuration = (row.mag === 0 ? def.emptyReloadTime : def.reloadTime) * 1000;
      row.reload = { start: now, end: now + row.reloadDuration };
      row.reloadHistory.push(row.reload);
      if (row.reloadHistory.length > 8) row.reloadHistoryFloor = Math.max(row.reloadHistoryFloor, row.reloadHistory.shift()!.end);
    } else {
      if (row.weaponId !== 'railgun') return refuse('not-charge-weapon');
      if (row.reload || row.mag <= 0 || row.charges.some(c => c.end === null && !c.spent)) return refuse('busy');
      row.charges.push({ start: now, end: null, spent: false });
      if (row.charges.length > 8) row.charges.shift();
    }
    this.intentReason = null; return { accepted: true, reason: null };
  }
  spend(weaponId: string, firedAt: number, receivedAt: number): ShotRejectReason | null {
    this.advance(receivedAt);
    const row = this.row(weaponId);
    if (!row) return 'malformed';
    const equipped = lastWhere(this.equipped, e => e.at <= firedAt);
    if (!equipped || equipped.weaponId !== weaponId) return 'weapon-not-active';
    // Action flooding cannot evict a known reload interval and then backdate
    // a shot into it. Older history fails closed; ordinary reorder retains it.
    if (firedAt < row.reloadHistoryFloor || row.reloadHistory.some(r => firedAt >= r.start && firedAt < r.end)) return 'reloading';
    if (row.mag <= 0) return 'empty-magazine';
    if (weaponId === 'railgun') {
      const charge = lastWhere(row.charges, c => !c.spent && firedAt >= c.start && (c.end === null || firedAt <= c.end));
      if (!charge) return 'charge-required';
      if (firedAt < charge.start + RAIL_CHARGE_MS || receivedAt < charge.start + RAIL_CHARGE_MS) return 'charge-incomplete';
      charge.spent = true; charge.end ??= receivedAt;
    }
    row.mag--; this.revision++; return null;
  }
  acknowledgeShot(seq: number): void {
    if (!Number.isSafeInteger(seq) || seq < 0 || this.resolved.includes(seq)) return;
    this.shotSeq = Math.max(this.shotSeq, seq); this.resolved.push(seq);
    if (this.resolved.length > LIMIT) this.resolved.shift();
    this.revision++;
  }
  grantReserve(rounds: number): void {
    if (!Number.isFinite(rounds) || rounds <= 0) return;
    const row = this.primaryAmmo, def = DEFS.get(row.weaponId)!;
    row.reserve += Math.max(0, Math.min(def.magSize + def.startReserve - row.mag - row.reserve, Math.floor(rounds)));
    this.revision++;
  }
  replacePrimary(contents: MagazineContents, now: number): void {
    this.advance(now); this.cancelActions(this.clock);
    this.primaryAmmo = magazine(contents.weaponId, contents); this.activeId = contents.weaponId;
    this.equipped.push({ at: this.clock, weaponId: this.activeId });
    if (this.equipped.length > LIMIT) this.equipped.shift();
    this.revision++;
  }
  snapshot(now: number): WeaponState {
    this.advance(now);
    const project = (row: Magazine): WeaponAmmoState => {
      const charge = lastWhere(row.charges, c => c.end === null && !c.spent);
      return Object.freeze({ weaponId: row.weaponId, mag: row.mag, reserve: row.reserve,
        reloadRemainingMs: row.reload ? Math.max(0, row.reload.end - this.clock) : 0,
        reloadDurationMs: row.reload ? row.reloadDuration : 0,
        chargeElapsedMs: charge ? Math.max(0, this.clock - charge.start) : null,
        chargeRequiredMs: row.weaponId === 'railgun' ? RAIL_CHARGE_MS : 0 });
    };
    return Object.freeze({ life: this.life, at: this.clock, revision: this.revision, activeWeaponId: this.activeId,
      lastIntentSeq: this.intentSeq, lastIntentReason: this.intentReason, lastShotSeq: this.shotSeq,
      resolvedShotSeqs: Object.freeze(this.resolved.slice()), primary: project(this.primaryAmmo), sidearm: project(this.sidearmAmmo) });
  }
}
