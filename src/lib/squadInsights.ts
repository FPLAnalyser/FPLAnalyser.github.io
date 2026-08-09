import { num, str } from './rows'
import { xpPartsForGw, sumParts, type XpModel, type MarketOdds, type ShotProfiles, type XpParts } from './xp'
import type { Availability } from './availability'
import type { FixtureEaseRow, RatingRow } from './types'

/* ════════════════════════════════════════════════════════════════════════
   The arithmetic behind the Insights tab.

   Every panel there answers a different question about the same fifteen
   players over the same horizon, so they all read ONE pass of the engine —
   `buildSeries` below. Recomputing per panel would be both slow (fourteen
   panels x fifteen players x six weeks) and, worse, a licence for two
   panels to quietly disagree about the same number.

   Nothing here rounds, formats or decides what is interesting. That is the
   components' job; this file only does sums.
   ════════════════════════════════════════════════════════════════════════ */

export interface Engine {
  fixtureEase: FixtureEaseRow[]
  avail?: Availability
  model?: XpModel | null
  market?: MarketOdds | null
  profiles?: ShotProfiles | null
}

export interface Week {
  gw: number
  /** Null when the club blanks that week — distinct from a projected zero. */
  parts: XpParts | null
  xp: number
  opponents: { opponent: string; venue: string; fdr: number }[]
}

export interface PlayerSeries {
  row: RatingRow
  element: number
  pos: string
  team: string
  price: number
  /** True when the component engine rated him; false for a flat fallback. */
  modelled: boolean
  weeks: Week[]
  total: number
}

/** One engine pass for a set of players over a set of gameweeks. */
export function buildSeries(players: RatingRow[], gws: number[], e: Engine): PlayerSeries[] {
  // The engine filters the whole fixture table per player per week. Indexing it
  // once turns fifteen-by-six lookups from a linear scan into a map hit, which
  // matters here because the transfer scan runs this over the entire pool.
  const byTeamGw = new Map<string, FixtureEaseRow[]>()
  for (const f of e.fixtureEase) {
    const k = `${f.team}:${f.gw}`
    const arr = byTeamGw.get(k)
    if (arr) arr.push(f)
    else byTeamGw.set(k, [f])
  }

  return players.map((row) => {
    const element = num(row, 'element') ?? -1
    const code = num(row, 'code')
    const team = str(row, 'team') ?? ''
    const modelled = code != null && !!e.model?.byCode.has(code)
    const weeks: Week[] = gws.map((gw) => {
      const fixes = byTeamGw.get(`${team}:${gw}`) ?? []
      const parts = fixes.length
        ? xpPartsForGw(row, gw, e.fixtureEase, e.avail, e.model, e.market, e.profiles)
        : null
      return {
        gw,
        parts,
        xp: parts ? sumParts(parts) : 0,
        opponents: fixes.map((f) => ({ opponent: f.opponent, venue: f.venue, fdr: f.fdr })),
      }
    })
    return {
      row,
      element,
      pos: str(row, 'position') ?? '',
      team,
      price: num(row, 'price') ?? 0,
      modelled,
      weeks,
      total: weeks.reduce((s, w) => s + w.xp, 0),
    }
  })
}

// ── one gameweek, simulated ─────────────────────────────────────────────────

/** A deterministic PRNG. Math.random would redraw the distribution on every
 *  React render, so the floor you were reading would move while you read it. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

const poisson = (lam: number, r: () => number): number => {
  if (lam <= 0) return 0
  // Knuth. Fine at these rates — a player's λ never approaches the range where
  // the exponential underflows.
  const L = Math.exp(-lam)
  let k = 0, p = 1
  do { k++; p *= r() } while (p > L)
  return k - 1
}

export const GOAL_PTS: Record<string, number> = { GKP: 10, DEF: 6, MID: 5, FWD: 4 }
export const CS_PTS: Record<string, number> = { GKP: 4, DEF: 4, MID: 1, FWD: 0 }

/** One player's points in one week, drawn rather than averaged.
 *
 *  The engine's parts are EXPECTATIONS, and a squad's floor and ceiling live in
 *  the shape of the distribution, which an expectation cannot show. So goals and
 *  assists are drawn Poisson, the clean sheet and def-con Bernoulli, and whether
 *  he plays at all is its own roll — that last one being most of the downside in
 *  a real fantasy week.
 *
 *  THE TRAP, and it is not a small one. Every rate on the parts object is
 *  ALREADY multiplied by his minutes: lamGoal carries `emf`, dc and saves carry
 *  p60, bonus and cards carry P(plays). Rolling "did he play?" and then drawing
 *  on those rates discounts the same thing twice, and the first version of this
 *  did exactly that — it put the median simulated week five points under the
 *  projection and called it right-skew. So the rates are divided back out to a
 *  PER-APPEARANCE basis before anything is drawn.
 *
 *  Two identities make that possible from the parts alone, without threading the
 *  model's internals through:
 *
 *      appearance = 2·p60 + (ppl − p60)   ⟹   ppl = appearance − p60
 *      emf        = p60 + ½(ppl − p60)    ⟹   emf = appearance / 2
 *
 *  The check that this is right is `mean` against `expected` on the returned
 *  distribution: they agree to well under a point, and did not before.
 */
function drawWeek(p: XpParts, pos: string, r: () => number): number {
  const p60 = Math.max(0, Math.min(1, p.p60))
  const emf = p.appearance / 2
  const ppl = Math.max(p60, p.appearance - p60)
  if (ppl < 0.02 || emf < 0.01) return 0

  const u = r()
  if (u >= ppl) return 0            // did not appear
  const full = u < p60              // reached the hour
  // A cameo is worth half a start's threat — the same weighting `emf` applies,
  // rather than a second guess at it.
  const minutesShare = full ? 1 : 0.5

  const g = poisson((p.lamGoal / emf) * minutesShare, r)
  const a = poisson((p.lamAssist / emf) * minutesShare, r)
  let pts = g * (GOAL_PTS[pos] ?? 0) + a * 3

  if (full) {
    const conceded = poisson(p.lamAgainst, r)
    if (conceded === 0) pts += CS_PTS[pos] ?? 0
    if (pos === 'GKP' || pos === 'DEF') pts -= Math.floor(conceded / 2)
    if (r() < Math.min(1, (p.dc / 2) / p60)) pts += 2
    if (pos === 'GKP') pts += p.saves / p60
    pts += 2
  } else {
    pts += 1
  }
  // Bonus and cards are per-appearance and near-deterministic at this scale;
  // drawing them would add noise without adding shape.
  pts += p.bonus / ppl + p.cards / ppl
  return pts
}

export interface Distribution {
  p10: number; p25: number; median: number; p75: number; p90: number
  mean: number
  /** The engine's own expectation, for the honesty check against `mean`. */
  expected: number
}

/** The distribution of an eleven's total for one gameweek, captain included. */
export function simulateXi(
  xi: PlayerSeries[], gwIndex: number, captain: number | null, draws = 4000, seed = 1234,
): Distribution | null {
  const live = xi.filter((p) => p.weeks[gwIndex]?.parts)
  if (!live.length) return null
  const r = rng(seed)
  const totals: number[] = []
  for (let d = 0; d < draws; d++) {
    let t = 0
    for (const p of live) {
      const w = p.weeks[gwIndex]
      const v = drawWeek(w.parts as XpParts, p.pos, r)
      t += p.element === captain ? v * 2 : v
    }
    totals.push(t)
  }
  totals.sort((a, b) => a - b)
  const q = (f: number) => totals[Math.min(totals.length - 1, Math.floor(f * totals.length))]
  const expected = live.reduce((s, p) =>
    s + p.weeks[gwIndex].xp * (p.element === captain ? 2 : 1), 0)
  return {
    p10: q(0.10), p25: q(0.25), median: q(0.50), p75: q(0.75), p90: q(0.90),
    mean: totals.reduce((a, b) => a + b, 0) / totals.length,
    expected,
  }
}

// ── shares and concentration ────────────────────────────────────────────────

export interface Share { key: string; label: string; value: number; share: number }

/** Sorted shares of a total, descending, with a share fraction attached. */
export function sharesOf(entries: { key: string; label: string; value: number }[]): Share[] {
  const total = entries.reduce((s, e) => s + Math.max(0, e.value), 0)
  return entries
    .map((e) => ({ ...e, share: total > 0 ? Math.max(0, e.value) / total : 0 }))
    .sort((a, b) => b.value - a.value)
}

/** Herfindahl index, 0 (perfectly spread) to 1 (one player is everything).
 *  Reported alongside the top-N share because the index alone means nothing to
 *  anyone who has not met it before. */
export const herfindahl = (shares: Share[]): number =>
  shares.reduce((s, x) => s + x.share * x.share, 0)

// ── chips ───────────────────────────────────────────────────────────────────

export interface ChipWeek {
  gw: number
  /** What the four bench players would add if they all counted. */
  benchBoost: number
  /** The EXTRA from a third multiplier on the best starter, not his total. */
  tripleCaptain: number
  tcName: string
}

export function chipWindows(squad: PlayerSeries[], xiElements: Set<number>, gws: number[]): ChipWeek[] {
  return gws.map((gw, i) => {
    const bench = squad.filter((p) => !xiElements.has(p.element))
    const starters = squad.filter((p) => xiElements.has(p.element))
    const best = starters.reduce<PlayerSeries | null>((b, p) =>
      !b || p.weeks[i].xp > b.weeks[i].xp ? p : b, null)
    return {
      gw,
      benchBoost: bench.reduce((s, p) => s + p.weeks[i].xp, 0),
      // Triple captain replaces the double you already have, so the chip is
      // worth ONE extra copy of him — not two, and not his whole score.
      tripleCaptain: best ? best.weeks[i].xp : 0,
      tcName: best ? String(best.row.web_name) : '—',
    }
  })
}

// ── ownership ───────────────────────────────────────────────────────────────

/** Expected points weighted by the share of managers who do NOT own him.
 *  Points move your score; only points other people do not have move your
 *  rank, and rank is what the game is scored on. */
export function effectiveOwnership(p: PlayerSeries, gwIndex: number): { xp: number; owned: number; swing: number } {
  const owned = (num(p.row, 'selected_by_percent') ?? 0) / 100
  const xp = p.weeks[gwIndex]?.xp ?? 0
  return { xp, owned, swing: xp * (1 - owned) }
}

// ── transfers ───────────────────────────────────────────────────────────────

export interface Upgrade {
  out: PlayerSeries
  in: PlayerSeries
  gain: number
  cost: number
}

/** The best same-position swap for each player you own, inside the bank.
 *
 *  Scored on the WHOLE horizon rather than the next week, because a transfer
 *  you make now is a decision about the next six, and a one-week gain that
 *  reverses in the second is not an upgrade. */
export function transferUpside(
  squad: PlayerSeries[], candidates: PlayerSeries[], bank: number, limit = 6,
): Upgrade[] {
  const owned = new Set(squad.map((p) => p.element))
  const perClub = new Map<string, number>()
  for (const p of squad) perClub.set(p.team, (perClub.get(p.team) ?? 0) + 1)

  const out: Upgrade[] = []
  for (const o of squad) {
    let best: Upgrade | null = null
    for (const c of candidates) {
      if (c.pos !== o.pos || owned.has(c.element)) continue
      const cost = c.price - o.price
      if (cost > bank + 1e-9) continue
      // Three from one club is the rule, and a suggestion that breaks it is
      // not a suggestion.
      if (c.team !== o.team && (perClub.get(c.team) ?? 0) >= 3) continue
      const gain = c.total - o.total
      if (gain <= 0) continue
      if (!best || gain > best.gain) best = { out: o, in: c, gain, cost }
    }
    if (best) out.push(best)
  }
  return out.sort((a, b) => b.gain - a.gain).slice(0, limit)
}
