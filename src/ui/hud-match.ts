/**
 * Atomic Acres — the match-state HUD surfaces: match bar, scoreboard, streak
 * strip, centre banner and respawn clock.
 *
 * Split out of `hud.ts` at the 400-line cap. The grouping is not arbitrary:
 * these five are exactly the surfaces that render AUTHORITATIVE state pushed by
 * `game/client.ts`, as opposed to the local-player surfaces (ammo, health,
 * crosshair, hitmarker, minimap) that the frame loop drives. Each setter takes
 * a struct or null, caches a signature of what it wrote, and returns early when
 * nothing changed — same contract as the rest of the HUD, and the lane proof
 * counts DOM nodes across these calls to prove it.
 */

import type { TeamId } from '../game/events';
import { respawnText } from '../game/match';
import type { HudNodes } from './hud-build';

/** One scoreboard row. `name` is the roster name; the HUD never invents one. */
export interface ScoreRowView {
  readonly id: string;
  readonly name: string;
  readonly team: TeamId;
  readonly kills: number;
  readonly deaths: number;
  readonly score: number;
}

/**
 * Everything the match bar and the scoreboard render, in one push.
 * `clock` arrives PREFORMATTED: turning milliseconds into "4:32" is
 * `game/match.ts`'s job (`formatClock`), and a second formatter here would be
 * the stale mirror IMPORT-PLAN §5.5 forbids.
 */
export interface ScoreView {
  readonly mode: string;
  readonly clock: string;
  readonly teamScores: readonly [number, number];
  readonly scoreLimit: number | null;
  readonly selfId: string;
  readonly rows: readonly ScoreRowView[];
}

export interface StreakSlotView {
  readonly label: string;
  readonly charges: number;
}

export interface StreakHudView {
  readonly kills: number;
  readonly slots: readonly StreakSlotView[];
}

export interface MatchSurfaces {
  setScore(s: ScoreView | null): void;
  setStreak(v: StreakHudView | null): void;
  setBanner(text: string | null, sub?: string): void;
  setRespawn(secs: number | null): void;
}

function scoreSig(s: ScoreView): string {
  let sig = s.mode + '|' + s.clock + '|' + s.teamScores[0] + ':' + s.teamScores[1] + '|' + s.scoreLimit + '|';
  for (const r of s.rows) sig += r.id + r.team + r.kills + '/' + r.deaths + '/' + r.score + ';';
  return sig;
}

export function bindMatchSurfaces(n: HudNodes): MatchSurfaces {
  // Seeded null, not a sentinel string: `null` means "nothing written yet", so
  // the first real push always writes whatever is already on screen, and the
  // hidden state (`''`) stays distinguishable from it.
  let cScore: string | null = null;
  let cStreak: string | null = null;
  let cBannerText: string | null = null;
  let cBannerSub = '';
  let cRespawn = -2;

  return {
    setScore(s: ScoreView | null): void {
      if (s === null) {
        if (cScore === '') return;
        cScore = '';
        n.bar.classList.add('hud-hidden');
        for (const row of n.scoreRows) row.root.classList.add('hud-hidden');
        return;
      }
      const sig = scoreSig(s);
      if (sig === cScore) return;
      cScore = sig;
      n.bar.classList.remove('hud-hidden');
      n.barMode.textContent = s.mode;
      n.barClock.textContent = s.clock;
      const cap = s.scoreLimit === null ? '' : '/' + s.scoreLimit;
      n.barTeamA.textContent = s.teamScores[0] + cap;
      n.barTeamB.textContent = s.teamScores[1] + cap;
      // Rows are DERIVED from the push, never a hardcoded roster: the pool is
      // MAX_PLAYERS long and rows past the live count are hidden, not stale.
      for (let i = 0; i < n.scoreRows.length; i++) {
        const row = n.scoreRows[i];
        const r = s.rows[i];
        if (!r) {
          row.root.classList.add('hud-hidden');
          continue;
        }
        row.root.classList.remove('hud-hidden');
        row.root.classList.toggle('hud-score-self', r.id === s.selfId);
        row.root.classList.toggle('hud-team-b', r.team === 1);
        row.name.textContent = r.name;
        row.kills.textContent = String(r.kills);
        row.deaths.textContent = String(r.deaths);
        row.score.textContent = String(r.score);
      }
    },

    setStreak(v: StreakHudView | null): void {
      if (v === null) {
        if (cStreak === '') return;
        cStreak = '';
        n.streak.classList.add('hud-hidden');
        return;
      }
      let sig = String(v.kills);
      for (const s of v.slots) sig += '|' + s.label + ':' + s.charges;
      if (sig === cStreak) return;
      cStreak = sig;
      n.streak.classList.remove('hud-hidden');
      n.streakKills.textContent = String(v.kills);
      for (let i = 0; i < n.streakSlots.length; i++) {
        const el = n.streakSlots[i];
        const s = v.slots[i];
        if (!s) {
          el.classList.add('hud-hidden');
          continue;
        }
        el.classList.remove('hud-hidden');
        el.classList.toggle('hud-streak-ready', s.charges > 0);
        const key = String(i + 3);
        el.textContent = key + ' ' + s.label + (s.charges > 1 ? ' x' + s.charges : '');
        el.title = `Press ${key}: ${s.label}${s.charges > 0 ? ` (${s.charges} ready)` : ''}`;
      }
    },

    setBanner(text: string | null, sub = ''): void {
      // Two caches rather than one joined key: no separator can collide with a
      // banner whose text happens to contain it.
      if (text === cBannerText && sub === cBannerSub) return;
      cBannerText = text;
      cBannerSub = sub;
      if (text === null) {
        n.banner.classList.add('hud-hidden');
        return;
      }
      n.bannerText.textContent = text;
      n.bannerSub.textContent = sub;
      n.banner.classList.remove('hud-hidden');
    },

    /**
     * Seconds in, tenths on screen. The string itself is lane A's
     * `match.ts:respawnText` — a 2.2 s respawn shown to the whole second sits
     * on "2" for 800 ms and reads as frozen, which is exactly why that
     * function keeps a decimal. The cache quantum is therefore a TENTH: a
     * whole-second cache would throttle a tenths readout to 1 Hz.
     */
    setRespawn(secs: number | null): void {
      const v = secs === null ? -1 : Math.max(0, Math.round(secs * 10));
      if (v === cRespawn) return;
      cRespawn = v;
      if (v < 0) {
        n.respawn.classList.add('hud-hidden');
        return;
      }
      n.respawn.textContent = respawnText(v * 100, 0);
      n.respawn.classList.remove('hud-hidden');
    },
  };
}
