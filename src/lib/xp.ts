import { useMemo } from 'react'
import { num } from './rows'
import { useLazyTable } from './useData'
import { availFor, availabilityFactor, type Availability } from './availability'
import type { FixtureEaseRow, RatingRow } from './types'

/* ════════════════════════════════════════════════════════════════════════
   Per-gameweek expected points — the component engine.

   Every scoring source responds to a fixture differently, so each is
   projected on its own and priced by the FPL scoring sheet:

     goals/assists  player per-90 rates x how much his team should create
                    in THIS fixture
     clean sheets   P(CS) = e^-λ from the goals his team should concede —
                    non-linear, as shutouts really behave
     saves          rise in hard fixtures (more shots to save), not fall
     def con        the measured fixture curve: defenders hit the threshold
                    less in easy games, mids slightly more in hard ones
     minutes        chance of 60+ from his record, appearance points from it

   The fixture context comes from the best source available: bookmaker-
   implied goal expectancies (odds.json, refreshed daily) for every fixture
   the market has priced, and team strength x opponent x venue from last
   season's record beyond the market horizon. The live availability layer
   then zeroes or scales the lot. Blanks are 0, doubles are summed.
   ════════════════════════════════════════════════════════════════════════ */

const GOAL_PTS: Record<string, number> = { GKP: 10, DEF: 6, MID: 5, FWD: 4 }
const CS_PTS: Record<string, number> = { GKP: 4, DEF: 4, MID: 1, FWD: 0 }
const MAX_G = 12

// ── data hooks ──────────────────────────────────────────────────────────────

interface XpPlayer {
  code: number; xg90: number; xa90: number; sv90: number
  dc: number; bon: number; yel: number; p60: number; ppl: number
}
interface XpModelFile {
  league: { att: number; def: number; hAtt: number }
  teams: Record<string, { att: number; def: number; prior?: boolean }>
  dcCurve: Record<string, Record<string, number>>
  players: XpPlayer[]
}
export interface XpModel extends Omit<XpModelFile, 'players'> {
  byCode: Map<number, XpPlayer>
}

export function useXpModel(): XpModel | null {
  const q = useLazyTable<XpModelFile>('xp_model')
  return useMemo(() => {
    const d = q.data
    if (!d || !Array.isArray(d.players) || !d.league || !d.teams) return null
    const byCode = new Map<number, XpPlayer>()
    for (const p of d.players) byCode.set(p.code, p)
    return { league: d.league, teams: d.teams, dcCurve: d.dcCurve ?? {}, byCode }
  }, [q.data])
}

interface OddsFile {
  matches: { gw: number; h: number; a: number; lh: number; la: number }[]
  /** Attack/defence backed out of the odds for clubs with no PL record. */
  strength?: Record<string, { att: number; def: number; n: number }>
}
interface TeamRow { short_name?: string }
/** Market-implied goals for/against, keyed `${team}:${gw}:${opponent}` so
 *  double gameweeks resolve to the right fixture, plus any club strengths the
 *  odds imply for sides the season history can't rate. */
export interface MarketOdds {
  byKey: Map<string, { for: number; against: number }>
  strength: Record<string, { att: number; def: number; n: number }>
}

export function useMarketOdds(): MarketOdds | null {
  const odds = useLazyTable<OddsFile>('odds')
  const teams = useLazyTable<TeamRow[]>('teams')
  return useMemo(() => {
    const o = odds.data
    const t = teams.data
    if (!o || !Array.isArray(o.matches) || !Array.isArray(t) || !t.length) return null
    // FPL team ids are assigned alphabetically — the order of teams.json.
    const shortOf = (id: number) => t[id - 1]?.short_name
    const byKey = new Map<string, { for: number; against: number }>()
    for (const m of o.matches) {
      const hs = shortOf(m.h)
      const as = shortOf(m.a)
      if (!hs || !as) continue
      byKey.set(`${hs}:${m.gw}:${as}`, { for: m.lh, against: m.la })
      byKey.set(`${as}:${m.gw}:${hs}`, { for: m.la, against: m.lh })
    }
    return { byKey, strength: o.strength ?? {} }
  }, [odds.data, teams.data])
}

// ── the maths ───────────────────────────────────────────────────────────────

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800, 39916800]

/** A club's attack/defence per game. Promoted sides carry a flagged prior in
 *  the model; wherever the market has priced them we can solve their real
 *  strength out of the odds, so that always wins. */
export function strengthOf(
  team: string,
  model: XpModel | null,
  market: MarketOdds | null,
): { att: number; def: number } | undefined {
  const base = model?.teams[team]
  const implied = market?.strength?.[team]
  if (implied && (!base || base.prior)) return { att: implied.att, def: implied.def }
  return base
}

/** E[floor(K/div)] for K ~ Poisson(lam): expected goals-conceded hits (div 2)
 *  or save points (div 3). */
function expFloorDiv(lam: number, div: number): number {
  let e = 0
  const base = Math.exp(-lam)
  for (let k = div; k < MAX_G; k++) e += base * Math.pow(lam, k) / FACT[k] * Math.floor(k / div)
  return e
}

function componentXp(
  p: XpPlayer,
  pos: string,
  fix: FixtureEaseRow,
  model: XpModel,
  mkt: { for: number; against: number } | null,
  market: MarketOdds | null,
): number {
  const lg = model.league
  const t = strengthOf(fix.team, model, market)
  const o = strengthOf(fix.opponent, model, market)
  const home = fix.venue === 'H'
  const hA = lg.hAtt || 1

  // How much the team should create / concede in THIS fixture, relative to
  // its own norm. Market numbers when the fixture is priced; strengths
  // otherwise.
  const attScale = mkt && t ? mkt.for / Math.max(t.att, 0.2)
    : (o ? o.def / lg.def : 1) * (home ? hA : 1 / hA)
  const lamCs = mkt ? mkt.against
    : (t ? t.def : lg.def) * (o ? o.att / lg.att : 1) * (home ? 1 / hA : hA)
  const svScale = mkt && t ? mkt.against / Math.max(t.def, 0.2)
    : (o ? o.att / lg.att : 1) * (home ? 1 / hA : hA)

  const emf = p.p60 + 0.5 * Math.max(p.ppl - p.p60, 0)
  const dcMult = model.dcCurve[pos]?.[String(fix.fdr)] ?? 1

  let xp = 0
  xp += p.xg90 * attScale * (GOAL_PTS[pos] ?? 0) * emf
  xp += p.xa90 * attScale * 3 * emf
  xp += Math.exp(-lamCs) * (CS_PTS[pos] ?? 0) * p.p60
  if (pos === 'GKP' || pos === 'DEF') xp -= expFloorDiv(lamCs, 2) * p.p60
  if (pos === 'GKP') xp += expFloorDiv(p.sv90 * svScale, 3) * p.p60
  xp += 2 * p.dc * dcMult * p.p60
  const bScale = pos === 'MID' || pos === 'FWD' ? Math.min(attScale, 1.3) : 1
  xp += p.bon * bScale * p.ppl
  xp += 2 * p.p60 + Math.max(p.ppl - p.p60, 0)
  xp -= p.yel * p.ppl
  return xp
}

// Legacy fallback for players without a component baseline (no last-season
// record): flat per-game xPts bent by a gentle difficulty multiplier.
const FDR_MULT: Record<number, number> = { 1: 1.15, 2: 1.08, 3: 1.0, 4: 0.9, 5: 0.8 }

/** Expected points for one player in one gameweek. Null when the player has
 *  no baseline at all (unrated new signing); 0 for a blank or a week he's
 *  ruled out of. */
export function xpForGw(
  r: RatingRow,
  gw: number,
  fixtureEase: FixtureEaseRow[],
  avail?: Availability,
  model?: XpModel | null,
  market?: MarketOdds | null,
): number | null {
  const fixes = fixtureEase.filter((f) => f.team === r.team && f.gw === gw)
  const code = num(r, 'code')
  const p = model && code != null ? model.byCode.get(code) : undefined
  let sum: number
  if (model && p) {
    if (!fixes.length) return 0
    sum = 0
    for (const f of fixes) {
      const mkt = market?.byKey.get(`${f.team}:${gw}:${f.opponent}`) ?? null
      sum += componentXp(p, String(r.position), f, model, mkt, market ?? null)
    }
  } else {
    const base = num(r, 'season_xpts_per_game')
    if (base == null) return null
    if (!fixes.length) return 0
    sum = 0
    for (const f of fixes) sum += base * (FDR_MULT[f.fdr] ?? 1)
  }
  if (avail) {
    const pl = availFor(avail, num(r, 'element'), code)
    sum *= availabilityFactor(pl, gw, avail)
  }
  return sum
}

/* ── rating a gameweek's projected haul ─────────────────────────────────────
   A raw xP total means nothing on its own — 50 is good or bad depending on
   what was available that week. So it's scored between two honest posts: an
   XI of median players (what you'd get without trying) and the best legal XI
   in the game (what was actually on the table). Your rating is how far up
   that gap you sit. */

const FORMATIONS: [number, number, number][] = []
for (let d = 3; d <= 5; d++) for (let m = 2; m <= 5; m++) { const f = 10 - d - m; if (f >= 1 && f <= 3) FORMATIONS.push([d, m, f]) }

export interface GwBenchmark { floor: number; ceiling: number }

/** The median and best XI xP for one gameweek, over the whole player pool. */
export function gwBenchmark(
  pool: RatingRow[],
  gw: number,
  fixtureEase: FixtureEaseRow[],
  avail?: Availability,
  model?: XpModel | null,
  market?: MarketOdds | null,
): GwBenchmark | null {
  const byPos: Record<string, number[]> = { GKP: [], DEF: [], MID: [], FWD: [] }
  for (const r of pool) {
    const v = xpForGw(r, gw, fixtureEase, avail, model, market)
    if (v != null && byPos[String(r.position)]) byPos[String(r.position)].push(v)
  }
  for (const k of Object.keys(byPos)) byPos[k].sort((a, b) => b - a)
  if (!byPos.GKP.length || byPos.DEF.length < 5 || byPos.MID.length < 5 || byPos.FWD.length < 3) return null

  const topSum = (p: string, n: number) => byPos[p].slice(0, n).reduce((s, v) => s + v, 0)
  let ceiling = 0
  for (const [d, m, f] of FORMATIONS) {
    const total = byPos.GKP[0] + topSum('DEF', d) + topSum('MID', m) + topSum('FWD', f)
    if (total > ceiling) ceiling = total
  }
  // Captaincy: the best starter counts twice in both benchmarks.
  ceiling += Math.max(byPos.DEF[0], byPos.MID[0], byPos.FWD[0])

  const med = (p: string) => byPos[p][Math.floor(byPos[p].length / 2)] ?? 0
  const floor = med('GKP') + 4 * med('DEF') + 4 * med('MID') + 2 * med('FWD') + Math.max(med('MID'), med('FWD'))
  return { floor, ceiling }
}

/** Where a projected total sits between those posts, 0–100. */
export function gwRating(xp: number, b: GwBenchmark | null): number | null {
  if (!b || b.ceiling <= b.floor) return null
  return Math.max(0, Math.min(100, Math.round(((xp - b.floor) / (b.ceiling - b.floor)) * 100)))
}

/** Same thing summed over the next `n` gameweeks from `fromGw`. */
export function xpOverGws(
  r: RatingRow,
  fromGw: number,
  n: number,
  fixtureEase: FixtureEaseRow[],
  avail?: Availability,
  model?: XpModel | null,
  market?: MarketOdds | null,
): number | null {
  let total = 0
  let any = false
  for (let g = fromGw; g < fromGw + n; g++) {
    const v = xpForGw(r, g, fixtureEase, avail, model, market)
    if (v != null) {
      total += v
      any = true
    }
  }
  return any ? total : null
}
