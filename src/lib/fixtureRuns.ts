import { useMemo } from 'react'
import { num, str } from './rows'
import { useMarketOdds } from './xp'
import type { CoreData, FixtureEaseRow, Row } from './types'

/** How many games a metrics window covers, so a window TOTAL can be turned
 *  into a per-game rate. Never show a total as a rate. */
export function windowGames(metrics: Row | null, data: CoreData): number {
  if (!metrics) return 1
  const g = num(metrics, 'games')
  if (g != null && g > 0) return g
  const w = str(metrics, 'window')
  if (w === '4gw') return 4
  if (w === '6gw') return 6
  const nextGw = data.meta?.next_gw != null ? Number(data.meta.next_gw) : null
  return nextGw != null && !isNaN(nextGw) && nextGw > 1 ? Math.min(38, nextGw - 1) : 38
}

/* ════════════════════════════════════════════════════════════════════════
   The difficulty vocabulary, and the season's purple patches.

   The scale and analyserDiff lived inside the Fixtures page until the team
   pages needed to say the same thing about the same fixtures. Two copies of
   a difficulty model is how a site ends up telling you a run is kind on one
   screen and ordinary on another, so there is one copy and it lives here.
   ════════════════════════════════════════════════════════════════════════ */

export type Lens = 'overall' | 'attack' | 'defence'

/** Per-game attacking/defensive baselines (chance quality), plus the league
 *  means — the inputs to every fixture projection on the site. */
export interface TeamBase { xg: number; xgc: number }

export interface DiffScale {
  /** Venue is an argument, not an afterthought — see buildDiffScale. */
  attackDiff: (opp: string, venue: 'H' | 'A') => number | null
  defenceDiff: (opp: string, venue: 'H' | 'A') => number | null
}

/* ── The difficulty scale ────────────────────────────────────────────────
   Three goes at this, and each fixed a different way of losing information.

   It first ranked the opponent on our 0–100 team ratings — but only over the
   clubs that HAVE a season rating, and the three promoted sides don't.
   Whichever rated club sat bottom was pinned to the floor of the scale. That
   was Fulham, so everyone who played them got a 1.0, promoted clubs included.

   Rating the whole matchup instead fixed Fulham but swapped one flattening
   for another: difficulty then tracked how good YOU are as much as who you
   play, so Arsenal's next eight ran 1.1 to 1.9 and Hull's 4.2 to 4.9 — a
   club's entire run in one colour.

   Ranking the opponent across all twenty clubs fixed both, and was still
   wrong in a way that only showed up on a specific fixture: Brentford at home
   to Sunderland came out at exactly 1.00 in the defence lens, the same as
   Brentford at home to Hull, even though Hull create 29% fewer goals. Two
   causes, and they compound. A percentile knows the ORDER of the twenty clubs
   and nothing about the GAPS between them, so the 0.23 goals/game between
   Hull and Sunderland and the 0.05 between Sunderland and Spurs both counted
   as one step. And because the bottom club is pinned at exactly 1.0 by
   construction, the home nudge had nowhere to go: anything near the floor
   fell below it and got clamped back on top. 76 of 760 team-fixtures were
   being flattened onto the two ends.

   So: distance from the league average in standard deviations, squashed
   through tanh. The gaps are now the thing the scale is made of — a club a
   long way from average lands a long way from 3, and two clubs a hair apart
   land a hair apart. tanh compresses the extremes smoothly instead of cutting
   them off, so nothing needs clamping and no fixture reads as exactly 1.0 or
   5.0, which is honest: no game is free and none is unwinnable.

   Venue is folded in BEFORE the squash rather than added to the result. Added
   after, it pushes the extremes off the end of the scale and reintroduces the
   clamp; folded in, playing the best side in the league away is simply
   further along the same curve. K is set so the spread matches what the
   percentile scale produced — the point of this change is accuracy, not a
   louder grid. */

/** How far the venue is worth, in standard deviations of team strength. */
const VENUE_SD = 0.42
/** Standard deviations to the edge of the curve. 1.2 reproduces the spread of
 *  the old percentile scale (sd 1.08 vs 1.12 across all 380 fixtures) while
 *  clamping nothing at all. */
const CURVE_K = 1.2

export function buildDiffScale(baselines: Map<string, TeamBase>): DiffScale | null {
  const clubs = [...baselines.values()]
  if (clubs.length < 8) return null
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
  const sd = (xs: number[], m: number) => Math.sqrt(mean(xs.map((v) => (v - m) ** 2))) || 1
  const xg = clubs.map((c) => c.xg)
  const xgc = clubs.map((c) => c.xgc)
  const mXg = mean(xg), sXg = sd(xg, mXg)
  const mXgc = mean(xgc), sXgc = sd(xgc, mXgc)
  const curve = (z: number) => 2 * Math.tanh(z / CURVE_K)

  return {
    // Our attack is judged on how freely they concede; our defence on how much
    // they score. Both read off the same twenty-club distribution.
    attackDiff: (opp, venue) => {
      const o = baselines.get(opp)
      if (!o) return null
      return 3 - curve((o.xgc - mXgc) / sXgc + (venue === 'H' ? VENUE_SD : -VENUE_SD))
    },
    defenceDiff: (opp, venue) => {
      const o = baselines.get(opp)
      if (!o) return null
      return 3 + curve((o.xg - mXg) / sXg - (venue === 'H' ? VENUE_SD : -VENUE_SD))
    },
  }
}

/** Our own 1 (easy) … 5 (hard) fixture difficulty: how strong the opponent is
 *  at the end of the pitch this lens cares about, with the venue already in
 *  it. Falls back to FPL's FDR only when we have no baseline for the opponent
 *  at all. */
export function analyserDiff(opp: string, lens: Lens, venue: 'H' | 'A', fdr: number, scale: DiffScale | null): { diff: number; ours: boolean } {
  const a = scale?.attackDiff(opp, venue)
  const d = scale?.defenceDiff(opp, venue)
  if (a == null || d == null) return { diff: fdr, ours: false }
  const base = lens === 'attack' ? a : lens === 'defence' ? d : (a + d) / 2
  // The curve cannot leave 1–5, so this only guards against a degenerate
  // baseline set rather than doing any real work.
  return { diff: Math.max(1, Math.min(5, base)), ours: true }
}

/** −1 (well under a normal fixture) … +1 (well over) → one of five washes.
 *  Every grid on the site shares it, so a green cell means the same thing
 *  whichever screen you're on. */
export function bandOf(t: number): string {
  const [hue, pct] =
    t <= -0.6 ? ['--bad', 34] : t <= -0.2 ? ['--warn', 26] :
    t < 0.2 ? ['--warn', 9] : t < 0.6 ? ['--good', 24] : ['--good', 42]
  return `color-mix(in srgb, var(${hue}) ${pct}%, transparent)`
}

/** Difficulty already runs on a fixed 1–5 with 3 as the average fixture, so it
 *  needs no percentile step — it just points the other way, 1 being the good
 *  end. */
export const diffFill = (d: number): string => bandOf(Math.max(-1, Math.min(1, (3 - d) / 2)))

/** The same five bands as a solid colour, for marks too small to carry a wash
 *  — the difficulty tick under a dimmed fixture on the season map. */
export function diffTick(d: number): string {
  const t = Math.max(-1, Math.min(1, (3 - d) / 2))
  return t <= -0.6 ? '#e0655f' : t <= -0.2 ? '#e8b04a' : t < 0.2 ? '#8b8274' : t < 0.6 ? '#5ec98a' : '#3ddc7a'
}

/** The difficulty scale for the current season's data, built once and shared.
 *  Promoted clubs have no season history, so the odds layer backs their
 *  attack/defence out of every priced fixture against a club we do know —
 *  a real baseline that sharpens each week, rather than a league-average
 *  stand-in. Without it the scale is missing three of its twenty clubs and
 *  the whole ranking skews. */
export function useDiffScale(data: CoreData | null): DiffScale | null {
  const market = useMarketOdds()
  return useMemo(() => {
    const m = new Map<string, TeamBase>()
    for (const t of data?.teamMetrics ?? []) {
      if (str(t, 'window') !== 'season') continue
      const g = windowGames(t, data as CoreData)
      const xg = num(t, 'team_xg')
      const xgc = num(t, 'team_xgc')
      if (xg != null && xgc != null && g > 0) m.set(String(t.team), { xg: xg / g, xgc: xgc / g })
    }
    for (const [team, v] of Object.entries(market?.strength ?? {})) {
      if (!m.has(team)) m.set(team, { xg: v.att, xgc: v.def })
    }
    return buildDiffScale(m)
  }, [data, market])
}

/* ════════════════════════════════════════════════════════════════════════
   Best runs of the season

   A ticker tells you the next six. It cannot tell you that the six you want
   are in February, which is the thing you actually plan a season around —
   when to take the hit, when to hold the wildcard, when a £4.5m defender is
   worth a bench slot for a month.

   WHAT COUNTS AS A RUN. Three to six consecutive gameweeks. Below three it's
   a couple of nice games rather than a window worth moving a team for; above
   six the fixtures are too far out for the difficulty read to mean much.

   HOW THEY'RE RANKED — by total advantage, Σ(3 − difficulty) across the run,
   not by average difficulty. Average alone always picks the shortest window,
   because one home game against the worst side in the league beats any four
   games ever assembled. Summing instead rewards a run for being both kind and
   long, which is what makes it worth planning around: five games at 2.4 is a
   bigger prize than three at 2.2, and the sum says so.

   BLANKS END A RUN. A gameweek with no fixture scores nothing, so on a naive
   sum a blank would look better than a hard away day — it would quietly drag
   the algorithm towards recommending the weeks your players don't play. Any
   window containing a blank is discarded outright.

   ONE PER HALF. Windows must sit entirely inside their half of the season, so
   the two never overlap and never straddle the turn of the year. You get the
   best window before Christmas and the best one after, which is the shape of
   the question — plan the autumn, then plan the run-in.
   ════════════════════════════════════════════════════════════════════════ */

/** An average fixture on our 1–5 scale. Everything above it is a cost, and
 *  everything below it is the advantage a run is made of. */
const NEUTRAL = 3
const MIN_LEN = 3
const MAX_LEN = 6
/** 38 games, so the first half ends at 19. */
const HALF_END = 19

export interface RunFixture { gw: number; opponent: string; venue: 'H' | 'A'; diff: number }

export interface SeasonRun {
  half: 1 | 2
  from: number
  to: number
  fixtures: RunFixture[]
  /** Mean difficulty across the run — the number to show. */
  avg: number
  /** Σ(3 − difficulty). What the run was chosen on. */
  advantage: number
  /** How many are at home. */
  home: number
}

/** The two best windows of a team's season, one per half, best first within
 *  each. Returns fewer than two only when the fixture list doesn't reach that
 *  far — pre-season it holds all 38, mid-season the played weeks have gone. */
export function bestRuns(
  fixtureEase: FixtureEaseRow[],
  team: string,
  lens: Lens,
  scale: DiffScale | null,
): SeasonRun[] {
  const mine = fixtureEase.filter((f) => f.team === team)
  if (!mine.length) return []

  const byGw = new Map<number, RunFixture[]>()
  for (const f of mine) {
    const venue: 'H' | 'A' = String(f.venue) === 'H' ? 'H' : 'A'
    const { diff } = analyserDiff(String(f.opponent), lens, venue, num(f, 'fdr') ?? 3, scale)
    const list = byGw.get(f.gw) ?? []
    list.push({ gw: f.gw, opponent: String(f.opponent), venue, diff })
    byGw.set(f.gw, list)
  }

  const gws = [...byGw.keys()].sort((a, b) => a - b)

  const bestIn = (lo: number, hi: number, half: 1 | 2): SeasonRun | null => {
    let best: SeasonRun | null = null
    for (let i = 0; i < gws.length; i++) {
      for (let len = MIN_LEN; len <= MAX_LEN; len++) {
        const from = gws[i]
        const to = from + len - 1
        if (from < lo || to > hi) continue
        // Consecutive and complete: every gameweek in the span must be played.
        const fixtures: RunFixture[] = []
        let blank = false
        for (let gw = from; gw <= to; gw++) {
          const fs = byGw.get(gw)
          if (!fs) { blank = true; break }
          fixtures.push(...fs)
        }
        if (blank) continue
        const advantage = fixtures.reduce((s, f) => s + (NEUTRAL - f.diff), 0)
        const avg = fixtures.reduce((s, f) => s + f.diff, 0) / fixtures.length
        // Ties break on HOME GAMES first, then the longer window, then the
        // earlier one. Two runs the model rates identically are not equally
        // worth owning: the one with more home fixtures is the safer hold,
        // since home advantage is already priced into each fixture's
        // difficulty but nothing else separates a dead heat.
        const home = fixtures.filter((f) => f.venue === 'H').length
        const tied = best != null && Math.abs(advantage - best.advantage) < 1e-9
        const better = !best || advantage > best.advantage + 1e-9 ||
          (tied && home > best.home) ||
          (tied && home === best.home && to - from > best.to - best.from)
        if (better) {
          best = { half, from, to, fixtures, avg, advantage, home }
        }
      }
    }
    return best
  }

  const first = bestIn(Math.min(...gws), HALF_END, 1)
  const second = bestIn(HALF_END + 1, Math.max(...gws), 2)
  return [first, second].filter((r): r is SeasonRun => r != null)
}
