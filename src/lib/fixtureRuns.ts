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
  attackDiff: (opp: string) => number | null
  defenceDiff: (opp: string) => number | null
}

/* ── The difficulty scale ────────────────────────────────────────────────
   Two goes at this were wrong in opposite directions, and both showed up as
   a grid you couldn't read.

   It first ranked the opponent on our 0–100 team ratings — but only over the
   clubs that HAVE a season rating, and the three promoted sides don't.
   Whichever rated club sat bottom was pinned to the floor of the scale. That
   was Fulham, so everyone who played them got a 1.0, promoted clubs included.

   Rating the whole matchup instead fixed Fulham but swapped one flattening
   for another: difficulty then tracked how good YOU are as much as who you
   play, so Arsenal's next eight ran 1.1 to 1.9 and Hull's 4.2 to 4.9 — a
   club's entire run in one colour, and Arsenal at Villa indistinguishable
   from Arsenal against Chelsea.

   So: the opponent's strength, which is what a fixture ticker means, ranked
   over a population that finally holds all twenty clubs. The goal baselines
   cover the promoted sides through the odds layer, which is exactly what the
   team ratings could not. */
export function buildDiffScale(baselines: Map<string, TeamBase>): DiffScale | null {
  const clubs = [...baselines.values()]
  if (clubs.length < 8) return null
  const xg = clubs.map((c) => c.xg).sort((a, b) => a - b)
  const xgc = clubs.map((c) => c.xgc).sort((a, b) => a - b)
  const pctIn = (arr: number[]) => (v: number) => {
    let lo = 0, hi = arr.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v) lo = mid + 1; else hi = mid }
    return lo / (arr.length - 1)
  }
  const pXg = pctIn(xg)
  const pXgc = pctIn(xgc)
  return {
    // Our attack is judged on how freely they concede; our defence on how much
    // they score. Both read off the same twenty-club distribution.
    attackDiff: (opp) => { const o = baselines.get(opp); return o ? 5 - 4 * pXgc(o.xgc) : null },
    defenceDiff: (opp) => { const o = baselines.get(opp); return o ? 1 + 4 * pXg(o.xg) : null },
  }
}

/** Our own 1 (easy) … 5 (hard) fixture difficulty: how strong the opponent is
 *  at the end of the pitch this lens cares about, plus a venue nudge. Falls
 *  back to FPL's FDR only when we have no baseline for the opponent at all. */
export function analyserDiff(opp: string, lens: Lens, venue: 'H' | 'A', fdr: number, scale: DiffScale | null): { diff: number; ours: boolean } {
  const a = scale?.attackDiff(opp)
  const d = scale?.defenceDiff(opp)
  if (a == null || d == null) return { diff: fdr, ours: false }
  const base = lens === 'attack' ? a : lens === 'defence' ? d : (a + d) / 2
  return { diff: Math.max(1, Math.min(5, base + (venue === 'H' ? -0.25 : 0.25))), ours: true }
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
        // Ties go to the longer window, then the earlier one — a longer run at
        // the same total advantage is the more useful thing to own.
        if (!best || advantage > best.advantage + 1e-9 ||
            (Math.abs(advantage - best.advantage) < 1e-9 && to - from > best.to - best.from)) {
          best = { half, from, to, fixtures, avg, advantage, home: fixtures.filter((f) => f.venue === 'H').length }
        }
      }
    }
    return best
  }

  const first = bestIn(Math.min(...gws), HALF_END, 1)
  const second = bestIn(HALF_END + 1, Math.max(...gws), 2)
  return [first, second].filter((r): r is SeasonRun => r != null)
}
