import { useMemo } from 'react'
import { num } from './rows'
import { useLazyTable } from './useData'
import { availFor, availabilityFactor, type Availability } from './availability'
import { suppliedXp } from './promotedXp'
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

export const GOAL_PTS: Record<string, number> = { GKP: 10, DEF: 6, MID: 5, FWD: 4 }
export const CS_PTS: Record<string, number> = { GKP: 4, DEF: 4, MID: 1, FWD: 0 }
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

/* ── how a defence concedes, and how a player scores ─────────────────────────
   Central-versus-wide turned out to be a dead end — every Premier League
   defence concedes 78–85% of its expected goals from the middle of the box,
   because that is simply where chances are worth anything. The axis that
   genuinely separates them is dead balls: 16% of xG conceded at Brentford
   against 31% at Bournemouth.

   So each side is reduced to its shot mix and the two are matched. A player
   whose mix is league-average comes out at exactly 1.0, so the adjustment
   can only come from a real mismatch — never from noise in the baseline. */

export interface ShotProfiles {
  league: { conceded: { sp: number; q: number }; taken: { sp: number; q: number } }
  teams: Record<string, { sp: number; q: number; n: number }>
  players: Record<string, { sp: number; q: number; n: number }>
}

export function useShotProfiles(): ShotProfiles | null {
  const q = useLazyTable<ShotProfiles>('shot_profiles')
  const d = q.data
  return d && d.league && d.teams && d.players ? d : null
}

/** How much more (or less) this player's goal threat is worth against this
 *  defence, given how each of them splits between dead balls and open play.
 *  Clamped either side so a thin sample can't run away with a fixture. */
export function matchupMult(element: number | null, opponent: string, sp: ShotProfiles | null): number {
  if (!sp || element == null) return 1
  const p = sp.players[String(element)]
  const d = sp.teams[opponent]
  if (!p || !d) return 1
  const lg = sp.league.conceded.sp
  if (!(lg > 0 && lg < 1)) return 1
  const m = p.sp * (d.sp / lg) + (1 - p.sp) * ((1 - d.sp) / (1 - lg))
  return Math.max(0.75, Math.min(1.3, m))
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

/** Every scoring source in a fixture, kept apart rather than summed — the
 *  captain ladder simulates from the rates, and the breakdown reads them. */
export interface XpParts {
  goal: number; assist: number; cs: number; conceded: number; saves: number
  dc: number; bonus: number; appearance: number; cards: number
  /** Rates behind the random parts, so a week can be simulated not just averaged. */
  lamGoal: number; lamAssist: number; lamAgainst: number; p60: number
  /** The dead-ball matchup applied to the goal threat, 1.0 when it's a wash. */
  matchup: number
}

export const sumParts = (p: XpParts): number =>
  p.goal + p.assist + p.cs + p.conceded + p.saves + p.dc + p.bonus + p.appearance + p.cards

const ZERO_PARTS = (): XpParts => ({
  goal: 0, assist: 0, cs: 0, conceded: 0, saves: 0, dc: 0, bonus: 0, appearance: 0, cards: 0,
  lamGoal: 0, lamAssist: 0, lamAgainst: 0, p60: 0, matchup: 1,
})

function componentXp(
  p: XpPlayer,
  pos: string,
  fix: FixtureEaseRow,
  model: XpModel,
  mkt: { for: number; against: number } | null,
  market: MarketOdds | null,
  matchup = 1,
): XpParts {
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

  const lamGoal = p.xg90 * attScale * matchup * emf
  const lamAssist = p.xa90 * attScale * emf
  const bScale = pos === 'MID' || pos === 'FWD' ? Math.min(attScale, 1.3) : 1
  return {
    goal: lamGoal * (GOAL_PTS[pos] ?? 0),
    assist: lamAssist * 3,
    cs: Math.exp(-lamCs) * (CS_PTS[pos] ?? 0) * p.p60,
    conceded: pos === 'GKP' || pos === 'DEF' ? -expFloorDiv(lamCs, 2) * p.p60 : 0,
    saves: pos === 'GKP' ? expFloorDiv(p.sv90 * svScale, 3) * p.p60 : 0,
    dc: 2 * p.dc * dcMult * p.p60,
    bonus: p.bon * bScale * p.ppl,
    appearance: 2 * p.p60 + Math.max(p.ppl - p.p60, 0),
    cards: -p.yel * p.ppl,
    lamGoal, lamAssist, lamAgainst: lamCs, p60: p.p60, matchup,
  }
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
  profiles?: ShotProfiles | null,
): number | null {
  const parts = xpPartsForGw(r, gw, fixtureEase, avail, model, market, profiles)
  return parts && sumParts(parts)
}

/** The same projection, source by source. Null carries the same meaning as
 *  above: no baseline at all, as opposed to a blank week (all zeroes). */
export function xpPartsForGw(
  r: RatingRow,
  gw: number,
  fixtureEase: FixtureEaseRow[],
  avail?: Availability,
  model?: XpModel | null,
  market?: MarketOdds | null,
  profiles?: ShotProfiles | null,
): XpParts | null {
  const fixes = fixtureEase.filter((f) => f.team === r.team && f.gw === gw)
  const code = num(r, 'code')
  const element = num(r, 'element')
  const p = model && code != null ? model.byCode.get(code) : undefined
  const out = ZERO_PARTS()

  if (model && p) {
    for (const f of fixes) {
      const mkt = market?.byKey.get(`${f.team}:${gw}:${f.opponent}`) ?? null
      const m = matchupMult(element, f.opponent, profiles ?? null)
      const part = componentXp(p, String(r.position), f, model, mkt, market ?? null, m)
      for (const k of Object.keys(out) as (keyof XpParts)[]) out[k] += part[k]
      out.matchup = m
    }
  } else {
    const base = num(r, 'season_xpts_per_game')
    if (base == null) {
      // Nothing of our own at all — a promoted club, whose players have no
      // Premier League record for the engine to rate. A supplied GW1 figure
      // fills the gap for that one week; see promotedXp.ts for whose it is.
      // It lands whole in `appearance` for the same reason the branch below
      // does: it is a total, and inventing a breakdown for it would be a
      // claim the number cannot support.
      const supplied = suppliedXp(element, gw)
      if (supplied == null || !fixes.length) return null
      out.appearance += supplied
    } else {
      // No component baseline (an unrated new signing): a flat per-game figure
      // bent by difficulty is all we honestly have, so it lands as appearance
      // points rather than pretending to a breakdown it can't support.
      for (const f of fixes) out.appearance += base * (FDR_MULT[f.fdr] ?? 1)
    }
  }

  if (avail) {
    const pl = availFor(avail, element, code)
    const factor = availabilityFactor(pl, gw, avail)
    if (factor !== 1) {
      for (const k of ['goal', 'assist', 'cs', 'conceded', 'saves', 'dc', 'bonus', 'appearance', 'cards',
        'lamGoal', 'lamAssist', 'p60'] as (keyof XpParts)[]) out[k] *= factor
    }
  }
  return out
}

/* ── rating a gameweek's projected haul ─────────────────────────────────────
   A raw xP total means nothing on its own — 50 is good or bad depending on
   what was available that week. So it's scored between two honest posts: an
   XI of median players (what you'd get without trying) and the best legal XI
   in the game (what was actually on the table). Your rating is how far up
   that gap you sit. */

export const FORMATIONS: [number, number, number][] = []
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
  profiles?: ShotProfiles | null,
): GwBenchmark | null {
  const byPos: Record<string, number[]> = { GKP: [], DEF: [], MID: [], FWD: [] }
  for (const r of pool) {
    const v = xpForGw(r, gw, fixtureEase, avail, model, market, profiles)
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
  profiles?: ShotProfiles | null,
): number | null {
  let total = 0
  let any = false
  for (let g = fromGw; g < fromGw + n; g++) {
    const v = xpForGw(r, g, fixtureEase, avail, model, market, profiles)
    if (v != null) {
      total += v
      any = true
    }
  }
  return any ? total : null
}
