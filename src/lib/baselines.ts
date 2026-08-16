import { num, str } from './rows'
import type { Row } from './types'

/* ════════════════════════════════════════════════════════════════════════
   The two numbers everything about a fixture is made of.

   Per-game expected goals for and against, per club. Difficulty, the goal
   lambdas, clean-sheet odds, xP, the run finder and the rotation planner are
   all functions of this pair, which is why it lives in its own module with no
   React and no dependency on either lib/xp or lib/fixtureRuns: both of those
   import it, and both need to agree with each other exactly.

   They did not always. The Fixtures page carried a private copy of this
   construction, so a change to the shared one moved every page except the one
   named after fixtures. One builder now, or the colour of a cell and the
   projection printed inside it can drift apart again.
   ════════════════════════════════════════════════════════════════════════ */

export interface TeamBase { xg: number; xgc: number }

/** How many games a metrics window covers, so a window TOTAL can be turned
 *  into a per-game rate. Never show a total as a rate. */
export function gamesInWindow(metrics: Row | null, nextGw: number | null): number {
  if (!metrics) return 1
  const g = num(metrics, 'games')
  if (g != null && g > 0) return g
  const w = str(metrics, 'window')
  if (w === '4gw') return 4
  if (w === '6gw') return 6
  return nextGw != null && !isNaN(nextGw) && nextGw > 1 ? Math.min(38, nextGw - 1) : 38
}

/**
 * The house baselines: what each club scores and concedes a game, as the model
 * has it, before anyone re-rates anybody.
 *
 * Promoted clubs have no season history, so the odds layer backs their
 * attack/defence out of every priced fixture against a club we do know — a
 * real baseline that sharpens each week rather than a league-average stand-in.
 * Without it the league distribution is missing three of its twenty clubs and
 * every ranking built on it skews.
 */
export function houseBaselines(
  teamMetrics: Row[] | undefined,
  nextGw: number | null,
  oddsStrength: Record<string, { att: number; def: number }> | undefined,
): Map<string, TeamBase> {
  const out = new Map<string, TeamBase>()
  for (const t of teamMetrics ?? []) {
    if (str(t, 'window') !== 'season') continue
    const g = gamesInWindow(t, nextGw)
    const xg = num(t, 'team_xg')
    const xgc = num(t, 'team_xgc')
    if (xg != null && xgc != null && g > 0) out.set(String(t.team), { xg: xg / g, xgc: xgc / g })
  }
  for (const [team, v] of Object.entries(oddsStrength ?? {})) {
    if (!out.has(team) && v && v.att > 0) out.set(team, { xg: v.att, xgc: v.def })
  }
  return out
}

/* ── What a dial is worth ────────────────────────────────────────────────

   THE DIAL IS MEASURED AGAINST THE LEAGUE, NOT AGAINST ITSELF, and the first
   version was not. A step used to be a fixed 13% of a club's own goal rate, so
   the two steps anyone could enter bought ×1.29 — enough to nudge a good side
   and nowhere near enough to re-rate a bad one. Measured on this season's
   data, Hull at the top of both dials reached 2.21 on the 1–5; reaching 5.0
   would have taken eight steps against a cap of two. "Hull are actually
   dangerous" was a thing the control could not say.

   So +2 now means BETTER THAN ANY CLUB IN THE LEAGUE at that end of the pitch,
   and −2 worse than any of them, with the halves in between. Every club can
   reach both ends by construction, which is what full flexibility has to mean
   here, and the dial reads the same on every card whoever you point it at.

   The ends sit a quarter of the league's spread OUTSIDE its best and worst
   rather than exactly on them, because on them left the boundary club stuck:
   Arsenal are the meanest defence in the league, so a target of "the meanest
   defence in the league" was a target of where they already stood, and their
   defence dial did nothing. The fixture colour still saturates at 5 — the
   scale has an end — but the goals, the clean sheets and the xP underneath it
   keep moving, which is what someone re-rating an already-good side means.

   It is deliberately NOT linear in goals. Moving Hull from 0 to +2 is a much
   bigger change in goal rate than moving Arsenal the same distance, because
   Arsenal are nearly there already. That is the honest shape of the statement,
   and the impact strip on the card prints the goals either way so the size of
   what you have said is never hidden.

   STILL A DELTA, NOT AN ABSOLUTE. "Halfway to the best attack in the league"
   survives a data refresh with its meaning intact, which a stored 2.11 would
   not — the house numbers move several times a day. */

export interface LeagueRange {
  /** What a +2 attack dial aims at, and a −2. */
  attBest: number; attWorst: number
  /** What a +2 DEFENCE dial aims at — the FEWEST goals conceded, so the lower
   *  of the pair — and what a −2 aims at. */
  defBest: number; defWorst: number
}

/* HOW FAR PAST THE LEAGUE THE ENDS SIT.
 *
 * The ends were the league's own best and worst, and that had a hole in it:
 * Arsenal already ARE the meanest defence in the league at 0.751 goals a game,
 * exactly the minimum, so their defence dial multiplied by 1.00 and moving it
 * did nothing at all. Same for Man City's attack. The one club a reader is most
 * likely to have a strong opinion about is the one the control could not touch.
 *
 * A quarter of the league's own spread past each end fixes it and stays a
 * statement about football rather than an arbitrary number: on this season's
 * data it puts the meanest-defence target at 0.45 goals a game — about 17 over
 * a season, which is roughly the best any Premier League side has managed — and
 * the best-attack target at 2.44, or 93 goals. Strong opinions, not impossible
 * ones, and the projection stays worth printing at either.
 *
 * Anyone can still reach the ends from anywhere, which was the point of
 * anchoring to the league in the first place; the ends are now simply outside
 * it, so the club sitting on the boundary has somewhere to go. */
const MARGIN = 0.25
/** No lambda may reach zero — Poisson with λ=0 is a certainty, and nothing
 *  about a football match is certain. */
const FLOOR = 0.15

export function leagueRange(base: Map<string, TeamBase>): LeagueRange | null {
  const vals = [...base.values()]
  if (vals.length < 8) return null
  const xg = vals.map((v) => v.xg)
  const xgc = vals.map((v) => v.xgc)
  const xgLo = Math.min(...xg), xgHi = Math.max(...xg)
  const cLo = Math.min(...xgc), cHi = Math.max(...xgc)
  const mXg = (xgHi - xgLo) * MARGIN
  const mC = (cHi - cLo) * MARGIN
  return {
    attBest: xgHi + mXg,
    attWorst: Math.max(FLOOR, xgLo - mXg),
    defBest: Math.max(FLOOR, cLo - mC),
    defWorst: cHi + mC,
  }
}

/** The furthest a dial goes, in the same units the UI shows. */
export const TWEAK_MAX = 2

/**
 * One club's baseline with its dials applied.
 *
 * `att` positive moves them towards — and past — the league's best attack,
 * negative towards its worst. `def` positive moves them towards the meanest
 * defence, which is the LOWEST xGC, so the target flips against the axis
 * deliberately: on the card, right is always better at the thing the dial is
 * named after.
 */
export function tweakedBase(base: TeamBase, t: { att: number; def: number } | undefined, r: LeagueRange | null): TeamBase {
  if (!t || !r || (!t.att && !t.def)) return base
  const towards = (v: number, target: number, frac: number) => v + (target - v) * frac
  const a = Math.max(-TWEAK_MAX, Math.min(TWEAK_MAX, t.att)) / TWEAK_MAX
  const d = Math.max(-TWEAK_MAX, Math.min(TWEAK_MAX, t.def)) / TWEAK_MAX
  return {
    xg: a === 0 ? base.xg : Math.max(FLOOR, towards(base.xg, a > 0 ? r.attBest : r.attWorst, Math.abs(a))),
    xgc: d === 0 ? base.xgc : Math.max(FLOOR, towards(base.xgc, d > 0 ? r.defBest : r.defWorst, Math.abs(d))),
  }
}

/**
 * The same opinion as goal-rate multipliers, for the projection.
 *
 * componentXp works in lambdas rather than in baselines, and the market prices
 * only a round or two ahead — so an opinion baked into the priced odds faded
 * out after a week. Carried as a multiplier and applied inside componentXp, a
 * priced fixture and an unpriced one are adjusted identically, all
 * thirty-eight weeks of it.
 *
 * `def` is the multiplier on what they CONCEDE, so a meaner defence is below 1.
 */
export function tweakMultipliers(
  base: Map<string, TeamBase>,
  tweaks: Record<string, { att: number; def: number }>,
): Record<string, { att: number; def: number }> {
  const r = leagueRange(base)
  const out: Record<string, { att: number; def: number }> = {}
  for (const [team, t] of Object.entries(tweaks)) {
    const b = base.get(team)
    if (!b || !r) continue
    const n = tweakedBase(b, t, r)
    out[team] = {
      att: b.xg > 0.05 ? n.xg / b.xg : 1,
      def: b.xgc > 0.05 ? n.xgc / b.xgc : 1,
    }
  }
  return out
}
