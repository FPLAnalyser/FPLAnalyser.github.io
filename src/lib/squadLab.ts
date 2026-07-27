import { num } from './rows'
import {
  type Availability,
} from './availability'
import {
  type MarketOdds, type ShotProfiles, type XpModel, type XpParts,
  CS_PTS, FORMATIONS, GOAL_PTS,
  sumParts, xpPartsForGw, xpForGw,
} from './xp'
import { FIRST_HALF_LAST, SECOND_HALF_FROM } from './planner'
import type { FixtureEaseRow, RatingRow } from './types'

/* ════════════════════════════════════════════════════════════════════════
   Squad Lab — the four reads that sit under the board.

   Everything here answers a question the pitch can't: how much of your team
   is everyone else's, what your schedule does over the next month and a half,
   whether you should actually make a transfer, and who takes the armband.

   All four run off the same component engine as the board, so a number here
   can never disagree with a number there.
   ════════════════════════════════════════════════════════════════════════ */

export const HORIZON = 6

const price = (r: RatingRow) => num(r, 'price') ?? 0
const own = (r: RatingRow) => num(r, 'selected_by_percent') ?? 0
const el = (r: RatingRow) => num(r, 'element') ?? -1

export interface Engine {
  fixtureEase: FixtureEaseRow[]
  avail?: Availability
  model: XpModel | null
  market: MarketOdds | null
  profiles: ShotProfiles | null
}

/* The projection filters the fixture list by team on every call. Across a
   whole pool over a six-week horizon that is millions of string comparisons
   for no reason, so each club's fixtures are sliced out once and the engine
   is handed the short list. Same answer, a fraction of the work. */
const byTeam = new WeakMap<FixtureEaseRow[], Map<string, FixtureEaseRow[]>>()

function fixturesFor(team: string, all: FixtureEaseRow[]): FixtureEaseRow[] {
  let idx = byTeam.get(all)
  if (!idx) {
    idx = new Map()
    for (const f of all) {
      const k = String(f.team)
      const arr = idx.get(k)
      if (arr) arr.push(f)
      else idx.set(k, [f])
    }
    byTeam.set(all, idx)
  }
  return idx.get(team) ?? []
}

const xp = (r: RatingRow, gw: number, e: Engine) =>
  xpForGw(r, gw, fixturesFor(String(r.team), e.fixtureEase), e.avail, e.model, e.market, e.profiles)

const parts = (r: RatingRow, gw: number, e: Engine) =>
  xpPartsForGw(r, gw, fixturesFor(String(r.team), e.fixtureEase), e.avail, e.model, e.market, e.profiles)

/** The best legal eleven out of a fifteen, by projected points. Used wherever
 *  a week has to be valued as a manager would actually play it. */
export function bestXiXp(squad: RatingRow[], gw: number, e: Engine): { total: number; xi: RatingRow[] } {
  const byPos: Record<string, { r: RatingRow; v: number }[]> = { GKP: [], DEF: [], MID: [], FWD: [] }
  for (const r of squad) {
    const v = xp(r, gw, e) ?? 0
    byPos[String(r.position)]?.push({ r, v })
  }
  for (const k of Object.keys(byPos)) byPos[k].sort((a, b) => b.v - a.v)
  let best: { total: number; xi: RatingRow[] } = { total: 0, xi: [] }
  for (const [d, m, f] of FORMATIONS) {
    if (!byPos.GKP.length || byPos.DEF.length < d || byPos.MID.length < m || byPos.FWD.length < f) continue
    const picked = [byPos.GKP[0], ...byPos.DEF.slice(0, d), ...byPos.MID.slice(0, m), ...byPos.FWD.slice(0, f)]
    const total = picked.reduce((s, p) => s + p.v, 0)
    if (total > best.total) best = { total, xi: picked.map((p) => p.r) }
  }
  return best
}

/* ─────────────────────────────────────────────────────────────────────────
   1 · Template & differential

   Your score doesn't move your rank — the gap to everyone else does. A
   player owned by two thirds of the game is insurance, not an edge, and the
   big names you've left out are bets whether you meant them or not.
   ───────────────────────────────────────────────────────────────────────── */

/* Where the bands sit matters more than it looks. At 30% only five players
   in the whole game qualify and a typical squad holds two of them, so the
   number never moved and never meant anything. At 15% there are twenty-six,
   and the average manager carries six — which is what "the template" actually
   describes. The bands now split a typical fifteen roughly 6 / 5 / 4. */
export type OwnBand = 'template' | 'balanced' | 'punt'
export const BAND_AT = { template: 15, balanced: 5 }

export const bandOf = (o: number): OwnBand =>
  o >= BAND_AT.template ? 'template' : o >= BAND_AT.balanced ? 'balanced' : 'punt'

export interface TemplateRead {
  rows: { row: RatingRow; own: number; band: OwnBand }[]
  counts: Record<OwnBand, number>
  /** Ownership-weighted, so it reads as "the average player in my squad". */
  avgOwn: number
  /** What a typical squad carries in each band, from live ownership: the sum
   *  of ownership across the band is exactly the expected count in any
   *  fifteen, so the comparison is measured rather than asserted. */
  typical: Record<OwnBand, number>
  /** Heavily-owned players you don't have — the bets you're making by omission. */
  missing: { row: RatingRow; own: number }[]
  headline: string
  tone: 'good' | 'warn' | 'flat'
}

export function templateRead(squad: RatingRow[], pool: RatingRow[]): TemplateRead | null {
  if (!squad.length) return null
  const rows = squad
    .map((row) => ({ row, own: own(row), band: bandOf(own(row)) }))
    .sort((a, b) => b.own - a.own)
  const counts: Record<OwnBand, number> = { template: 0, balanced: 0, punt: 0 }
  for (const r of rows) counts[r.band]++
  const avgOwn = rows.reduce((s, r) => s + r.own, 0) / rows.length

  // Ownership summed over a band is exactly the number of players from it
  // the average squad holds, so this benchmark is measured, not asserted.
  const typical: Record<OwnBand, number> = { template: 0, balanced: 0, punt: 0 }
  for (const r of pool) typical[bandOf(own(r))] += own(r) / 100

  const have = new Set(squad.map(el))
  const missing = pool
    .filter((r) => !have.has(el(r)) && own(r) >= BAND_AT.template)
    .sort((a, b) => own(b) - own(a))
    .slice(0, 4)
    .map((row) => ({ row, own: own(row) }))

  // Two ways to be exposed, and they pull in opposite directions — both
  // judged against what a typical squad carries rather than a round number.
  const heavy = counts.template >= typical.template + 3
  const bold = counts.punt >= typical.punt + 3
  const tone: TemplateRead['tone'] = heavy || bold ? 'warn' : 'good'
  const headline = heavy
    ? `You'll move with the crowd — ${counts.template} of your ${rows.length} are template picks, against ${typical.template.toFixed(0)} for a typical squad`
    : bold
      ? `A bold squad — ${counts.punt} of your ${rows.length} are owned by under ${BAND_AT.balanced}%, against ${typical.punt.toFixed(0)} typically`
      : `A normal spread — ${counts.template} template and ${counts.punt} punts, where a typical squad has ${typical.template.toFixed(0)} and ${typical.punt.toFixed(0)}`

  return { rows, counts, avgOwn, typical, missing, headline, tone }
}

/* ─────────────────────────────────────────────────────────────────────────
   2 · Horizon scanning

   Everyone reads fixtures club by club. Nobody adds up what *their fifteen*
   face week by week — so the week the schedule falls off a cliff arrives as
   a surprise instead of a plan.

   Riding along with it: the clashes where your own players cost each other.
   Only attack against defence counts. Two defences can both keep a clean
   sheet in a goalless draw, so a defender facing a defender is no conflict
   at all — it's a goal against a shutout that can't both happen.
   ───────────────────────────────────────────────────────────────────────── */

export interface Clash {
  gw: number
  fixture: string
  /** Your attackers in this match, with each one's chance of scoring. */
  attackers: { row: RatingRow; pScore: number }[]
  /** Everyone on the other side whose clean sheet they'd be ending. */
  blocked: RatingRow[]
  /** Clean-sheet points expected to be destroyed by your own players. */
  cost: number
}

export interface HorizonWeek {
  gw: number
  xp: number
  blanks: number
  doubles: number
  /** How many of your fifteen face a hard fixture, and how many an easy one.
   *
   *  Projected points are the honest measure of what a week is worth, but a
   *  fifteen spread over ten clubs averages out: the difference between the
   *  best and worst week is a few percent, which is true and useless for
   *  spotting trouble. Counting the players walking into a hard game is what
   *  actually says "this is the week to prepare for" — over the same run it
   *  swings from one player to eight. */
  hard: number
  easy: number
  clashes: Clash[]
}

export interface HorizonRead {
  weeks: HorizonWeek[]
  mean: number
  best: HorizonWeek
  worst: HorizonWeek
  clashes: Clash[]
  /** Best week against worst, as a percentage of an average week. */
  swing: number
  /** The week most of your squad faces a hard game — the one to plan around. */
  toughest: HorizonWeek
  /** Who makes that week hard. */
  hardest: { team: string; opponent: string; fdr: number }[]
  headline: string
}

/** FDR 4 and 5 are the two bands FPL itself calls difficult; 1 and 2 the two
 *  it calls easy. Using its own scale keeps this readable against every other
 *  fixture chart on the site. */
const HARD_FDR = 4
const EASY_FDR = 2

const ATTACKING = new Set(['MID', 'FWD'])
const SHUTOUT = new Set(['GKP', 'DEF'])

export function horizonRead(squad: RatingRow[], fromGw: number, e: Engine, gws: number[]): HorizonRead | null {
  if (squad.length < 11) return null
  const window = gws.filter((g) => g >= fromGw).slice(0, HORIZON)
  if (window.length < 2) return null

  const weeks: HorizonWeek[] = window.map((gw) => {
    const { total } = bestXiXp(squad, gw, e)
    let blanks = 0
    let doubles = 0
    let hard = 0
    let easy = 0
    for (const r of squad) {
      const fs = fixturesFor(String(r.team), e.fixtureEase).filter((f) => f.gw === gw)
      if (fs.length === 0) blanks++
      else if (fs.length > 1) doubles++
      // On a double the friendlier game is what counts, since he plays both.
      const fdr = Math.min(...fs.map((f) => f.fdr))
      if (fs.length && fdr >= HARD_FDR) hard++
      if (fs.length && fdr <= EASY_FDR) easy++
    }
    return { gw, xp: total, blanks, doubles, hard, easy, clashes: clashesIn(squad, gw, e) }
  })

  const mean = weeks.reduce((s, w) => s + w.xp, 0) / weeks.length
  const best = weeks.reduce((a, b) => (b.xp > a.xp ? b : a))
  const worst = weeks.reduce((a, b) => (b.xp < a.xp ? b : a))
  const clashes = weeks.flatMap((w) => w.clashes).sort((a, b) => b.cost - a.cost)

  const swing = mean > 0 ? Math.round(((best.xp - worst.xp) / mean) * 100) : 0
  // Ties on hard fixtures go to the week that projects worse.
  const toughest = weeks.reduce((a, b) => (b.hard > a.hard || (b.hard === a.hard && b.xp < a.xp) ? b : a))
  const kindest = weeks.reduce((a, b) => (b.hard < a.hard || (b.hard === a.hard && b.xp > a.xp) ? b : a))

  const headline = toughest.hard >= 5
    ? `GW${toughest.gw} is the week to plan for — ${toughest.hard} of your ${squad.length} walk into a hard game, against ${kindest.hard} in GW${kindest.gw}`
    : toughest.hard >= 3
      ? `Nothing severe ahead — GW${toughest.gw} is the busiest for hard fixtures with ${toughest.hard} of your ${squad.length}`
      : `A kind run — no week in the next ${weeks.length} has more than ${toughest.hard} of your fifteen in a hard game`

  return { weeks, mean, best, worst, clashes, swing, toughest, hardest: hardestIn(squad, toughest.gw, e), headline }
}

/** The clubs dragging a week down — a swing is only actionable once you know
 *  who's causing it. */
function hardestIn(squad: RatingRow[], gw: number, e: Engine): { team: string; opponent: string; fdr: number }[] {
  const seen = new Map<string, { team: string; opponent: string; fdr: number }>()
  for (const r of squad) {
    const team = String(r.team)
    if (seen.has(team)) continue
    const f = fixturesFor(team, e.fixtureEase).find((x) => x.gw === gw)
    if (f) seen.set(team, { team, opponent: `${f.opponent} (${f.venue})`, fdr: f.fdr })
  }
  return [...seen.values()].filter((x) => x.fdr >= HARD_FDR).sort((a, b) => b.fdr - a.fdr).slice(0, 4)
}

/** Your own attackers playing your own defenders, in one gameweek. */
function clashesIn(squad: RatingRow[], gw: number, e: Engine): Clash[] {
  const teams = new Set(squad.map((r) => String(r.team)))
  const out: Clash[] = []
  const seen = new Set<string>()

  for (const f of e.fixtureEase) {
    if (f.gw !== gw || f.venue !== 'H') continue
    if (!teams.has(f.team) || !teams.has(f.opponent)) continue
    const key = `${gw}:${f.team}:${f.opponent}`
    if (seen.has(key)) continue
    seen.add(key)

    for (const [attTeam, defTeam] of [[f.team, f.opponent], [f.opponent, f.team]] as const) {
      const blocked = squad.filter((r) => r.team === defTeam && SHUTOUT.has(String(r.position)))
      if (!blocked.length) continue
      const attackers = squad
        .filter((r) => r.team === attTeam && ATTACKING.has(String(r.position)))
        .map((row) => ({ row, p: parts(row, gw, e) }))
        .filter((a) => a.p && a.p.lamGoal > 0)
        .map(({ row, p }) => ({ row, pScore: 1 - Math.exp(-(p as XpParts).lamGoal) }))
      if (!attackers.length) continue

      // One warning per match, not one per attacker: what matters is the
      // chance *any* of yours scores, against the clean sheets it would end.
      const pAny = 1 - attackers.reduce((s, a) => s * (1 - a.pScore), 1)
      const csAtRisk = blocked.reduce((s, r) => {
        const bp = parts(r, gw, e)
        return s + (bp ? bp.cs : 0)
      }, 0)
      const cost = pAny * csAtRisk
      if (cost < 0.3) continue
      out.push({ gw, fixture: `${f.team} v ${f.opponent}`, attackers, blocked, cost })
    }
  }
  return out.sort((a, b) => b.cost - a.cost)
}

/* ─────────────────────────────────────────────────────────────────────────
   3 · The Analyser's recommendation

   Not "your best transfer" — the honest answer is often that there isn't
   one worth making. Moves are valued over the whole horizon rather than the
   week in front of you, a hit is only taken when it pays for itself, and
   holding is a first-class recommendation rather than a failure to find one.
   ───────────────────────────────────────────────────────────────────────── */

export interface Move {
  out: RatingRow
  in: RatingRow
  /** Points gained over the horizon, before any hit. */
  gain: number
  spend: number
  reason: string
}

export interface Recommendation {
  moves: Move[]
  /** Gain after paying for however many of these cost a hit. */
  net: number
  hits: number
  verdict: 'hold' | 'move'
  headline: string
  detail: string
  /** How many weeks the advice looks over. */
  weeks: number
}

/** Below this a move is inside the model's own noise and isn't worth a
 *  transfer — over six weeks, half a point a week. */
const WORTH_IT = 3.0
const HIT = 4

export function recommend({ squad, pool, fromGw, gws, bank, freeTransfers, engine, maxMoves = 3 }: {
  squad: RatingRow[]
  pool: RatingRow[]
  fromGw: number
  gws: number[]
  bank: number
  freeTransfers: number
  engine: Engine
  maxMoves?: number
}): Recommendation | null {
  if (squad.length !== 15) return null
  const window = gws.filter((g) => g >= fromGw).slice(0, HORIZON)
  if (!window.length) return null

  const over = (r: RatingRow) => window.reduce((s, g) => s + (xp(r, g, engine) ?? 0), 0)
  const cache = new Map<number, number>()
  const value = (r: RatingRow) => {
    const k = el(r)
    let v = cache.get(k)
    if (v == null) { v = over(r); cache.set(k, v) }
    return v
  }

  // Work on a copy so each accepted move constrains the next one honestly.
  let squadNow = [...squad]
  let bankNow = bank
  const moves: Move[] = []
  const usedOut = new Set<number>()
  const usedIn = new Set<number>()

  for (let step = 0; step < maxMoves; step++) {
    const have = new Set(squadNow.map(el))
    const clubCount = new Map<string, number>()
    for (const r of squadNow) clubCount.set(String(r.team), (clubCount.get(String(r.team)) ?? 0) + 1)

    let best: Move | null = null
    for (const out of squadNow) {
      if (usedOut.has(el(out))) continue
      const budget = bankNow + price(out)
      const outVal = value(out)
      for (const cand of pool) {
        if (cand.position !== out.position) continue
        if (have.has(el(cand)) || usedIn.has(el(cand))) continue
        if (price(cand) > budget + 1e-9) continue
        const club = String(cand.team)
        const already = (clubCount.get(club) ?? 0) - (String(out.team) === club ? 1 : 0)
        if (already >= 3) continue
        const gain = value(cand) - outVal
        if (!best || gain > best.gain) {
          best = { out, in: cand, gain, spend: price(cand) - price(out), reason: reasonFor(out, cand, window, engine) }
        }
      }
    }
    if (!best) break

    // Each move past the free ones has to clear the hit on its own.
    const paid = moves.length >= freeTransfers
    if (best.gain < (paid ? HIT + WORTH_IT : WORTH_IT)) break

    moves.push(best)
    usedOut.add(el(best.out))
    usedIn.add(el(best.in))
    squadNow = squadNow.map((r) => (el(r) === el(best.out) ? best.in : r))
    bankNow -= best.spend
  }

  const hits = Math.max(0, moves.length - freeTransfers)
  const net = moves.reduce((s, m) => s + m.gain, 0) - hits * HIT
  const weeks = window.length

  if (!moves.length) {
    return {
      moves: [], net: 0, hits: 0, verdict: 'hold', weeks,
      headline: 'Hold — no transfer is worth making',
      detail: `Nothing in the market gains your squad more than ${WORTH_IT.toFixed(0)} points over the next ${weeks} weeks. Bank the transfer.`,
    }
  }
  const plural = moves.length === 1 ? 'move' : 'moves'
  return {
    moves, net, hits, verdict: 'move', weeks,
    headline: `${moves.length} ${plural} worth +${net.toFixed(1)} points`,
    detail: hits > 0
      ? `Over the next ${weeks} weeks, after paying ${hits * HIT} points for ${hits === 1 ? 'a hit' : `${hits} hits`}.`
      : `Over the next ${weeks} weeks, all within your free ${moves.length === 1 ? 'transfer' : 'transfers'}.`,
  }
}

/** Why the swap is being suggested, in the terms a manager thinks in. */
function reasonFor(out: RatingRow, cand: RatingRow, window: number[], e: Engine): string {
  const outFix = window.reduce((s, g) => s + fdrOf(out, g, e), 0) / window.length
  const inFix = window.reduce((s, g) => s + fdrOf(cand, g, e), 0) / window.length
  const outMins = num(out, 'season_mins90_rate') ?? 1
  const inMins = num(cand, 'season_mins90_rate') ?? 1

  if (inFix <= outFix - 0.5) return 'Much the better run of fixtures'
  if (inMins - outMins >= 0.2) return 'Starts far more often'
  if (price(cand) < price(out) - 0.4) return 'The same output for less money'
  if ((num(cand, 'season_overall_score') ?? 0) > (num(out, 'season_overall_score') ?? 0) + 0.5) return 'A clear upgrade on form'
  return 'More projected points across the run'
}

const fdrOf = (r: RatingRow, gw: number, e: Engine) => {
  const f = fixturesFor(String(r.team), e.fixtureEase).filter((x) => x.gw === gw)
  return f.length ? f.reduce((s, x) => s + x.fdr, 0) / f.length : 5
}

/* ─────────────────────────────────────────────────────────────────────────
   4 · Captain ladder

   Expected points rank the candidates; they don't say how close the call is.
   A 0.2 gap and a 1.5 gap look identical in a points column, so the week is
   simulated from the same rates the projection is built on and the answer is
   given as a probability: how often does each man actually top your eleven?
   ───────────────────────────────────────────────────────────────────────── */

export interface CaptainRow {
  row: RatingRow
  xp: number
  parts: XpParts
  fixture: string
  /** Share of simulated weeks in which he is your highest scorer. */
  topPct: number
  /** Share of simulated weeks in which he returns double figures. */
  haulPct: number
  /** Dead-ball matchup against this opponent, and a line if it's material. */
  matchup: number
  note: string | null
}

export interface CaptainLadder {
  rows: CaptainRow[]
  gap: number
  close: boolean
  headline: string
}

const SIMS = 4000

/** Deterministic noise — the ladder must not shuffle between renders. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

function poisson(lam: number, rand: () => number): number {
  if (lam <= 0) return 0
  const L = Math.exp(-lam)
  let k = 0
  let p = 1
  do { k++; p *= rand() } while (p > L && k < 12)
  return k - 1
}

export function captainLadder(xi: RatingRow[], gw: number, e: Engine): CaptainLadder | null {
  if (xi.length < 2) return null

  const rows: CaptainRow[] = []
  for (const row of xi) {
    const p = parts(row, gw, e)
    if (!p) continue
    const fixes = fixturesFor(String(row.team), e.fixtureEase).filter((f) => f.gw === gw)
    const fixture = fixes.length
      ? fixes.map((f) => `${f.opponent} (${f.venue})`).join(' + ')
      : 'Blank'
    rows.push({
      row, parts: p, xp: sumParts(p), fixture,
      topPct: 0, haulPct: 0, matchup: p.matchup,
      note: matchupNote(row, fixes, p.matchup, e.profiles),
    })
  }
  if (rows.length < 2) return null

  // One simulated week at a time, so "tops your eleven" is a genuine race
  // rather than eleven separate numbers compared after the fact.
  const rand = rng(gw * 7919 + rows.length)
  const tops = new Array(rows.length).fill(0)
  const hauls = new Array(rows.length).fill(0)
  const draw = new Array(rows.length).fill(0)

  for (let s = 0; s < SIMS; s++) {
    let bestI = 0
    let bestV = -Infinity
    for (let i = 0; i < rows.length; i++) {
      const { row, parts: p } = rows[i]
      const pos = String(row.position)
      // The certain parts carry their expectation; the parts that actually
      // decide a gameweek are rolled.
      let v = p.appearance + p.dc + p.bonus + p.cards + p.conceded + p.saves
      v += poisson(p.lamGoal, rand) * (GOAL_PTS[pos] ?? 0)
      v += poisson(p.lamAssist, rand) * 3
      if ((CS_PTS[pos] ?? 0) > 0 && rand() < Math.exp(-p.lamAgainst) * p.p60) v += CS_PTS[pos]
      draw[i] = v
      if (v > bestV) { bestV = v; bestI = i }
    }
    tops[bestI]++
    for (let i = 0; i < rows.length; i++) if (draw[i] >= 10) hauls[i]++
  }

  for (let i = 0; i < rows.length; i++) {
    rows[i].topPct = (tops[i] / SIMS) * 100
    rows[i].haulPct = (hauls[i] / SIMS) * 100
  }
  rows.sort((a, b) => b.xp - a.xp)

  const gap = rows[0].xp - rows[1].xp
  const close = gap < 0.5
  const headline = close
    ? `${String(rows[0].row.web_name)} by a whisker — ${gap.toFixed(1)} over ${String(rows[1].row.web_name)}`
    : `${String(rows[0].row.web_name)}, ${gap.toFixed(1)} clear of ${String(rows[1].row.web_name)}`
  return { rows, gap, close, headline }
}

/** Say the dead-ball mismatch out loud, but only when it's big enough to
 *  matter — otherwise it's noise dressed as insight.
 *
 *  The effect is an interaction, never a property of the defence on its own:
 *  the same opponent helps a set-piece specialist and hurts an open-play one,
 *  so the line has to name both sides or it reads as a contradiction. */
function matchupNote(row: RatingRow, fixes: FixtureEaseRow[], mult: number, sp: ShotProfiles | null): string | null {
  if (!fixes.length || Math.abs(mult - 1) < 0.06 || !sp) return null
  const p = sp.players[String(el(row))]
  if (!p) return null
  const opp = fixes[0].opponent
  const pct = Math.round(Math.abs(mult - 1) * 100)
  const deadBall = p.sp > sp.league.taken.sp
  const sign = mult > 1 ? '+' : '−'
  const how = deadBall
    ? (mult > 1 ? `his threat is dead balls, and ${opp} concede heavily from them` : `his threat is dead balls, and ${opp} defend them well`)
    : (mult > 1 ? `he works in open play, which is where ${opp} give most away` : `he works in open play, but ${opp} mostly concede from set pieces`)
  return `${how} — ${sign}${pct}% on his goal threat`
}

/* ─────────────────────────────────────────────────────────────────────────
   5 · Chip planning

   You get a full set of chips in each half of the season — wildcard, free
   hit, bench boost, triple captain — and the first set expires at the GW19
   deadline whether you use it or not. Most managers lose points to chips
   they held too long rather than to chips they played too early.

   Each one is valued in the only currency that matters: the points it adds
   over playing that week normally.

     triple captain  a third helping of your best player that week
     bench boost     whatever your four substitutes would have scored
     free hit        the gap between your eleven and the best eleven money
                     could field that week, which is enormous in a blank
     wildcard        not a one-week gain at all — a signal, raised when your
                     squad needs more moves than free transfers can deliver
   ───────────────────────────────────────────────────────────────────────── */

export type ChipKey = 'triple-captain' | 'bench-boost' | 'free-hit' | 'wildcard'

export interface ChipAdvice {
  chip: ChipKey
  label: string
  /** The gameweek to play it in, or null when nothing in range is worth it. */
  gw: number | null
  /** Points it would add over playing that week normally. */
  gain: number
  /** Whether that gain clears the bar for spending a chip on it. */
  worthIt: boolean
  detail: string
  /** Already spent in this half, and where. */
  spentAt: number | null
}

export interface ChipPlan {
  advice: ChipAdvice[]
  /** The single best chip to play in range, if any is worth playing. */
  best: ChipAdvice | null
  /** Gameweeks left before this half's chips expire, null in the second half. */
  weeksLeft: number | null
  headline: string
}

/** A chip is a once-a-half asset, so it shouldn't be spent on a rounding
 *  error. These are the gains below which holding is simply better. */
const CHIP_BAR: Record<ChipKey, number> = {
  'triple-captain': 6,
  'bench-boost': 12,
  'free-hit': 15,
  wildcard: 0, // judged on moves needed, not points
}

const CHIP_TITLE: Record<ChipKey, string> = {
  'triple-captain': 'Triple Captain',
  'bench-boost': 'Bench Boost',
  'free-hit': 'Free Hit',
  wildcard: 'Wildcard',
}

/** The strongest legal eleven the whole market could field this week for a
 *  given budget — what a free hit is actually worth against.
 *
 *  Picking the best eleven and hoping it fits the budget doesn't work, so
 *  each player is scored on points minus a price penalty and the penalty is
 *  raised until the bill fits. That is the standard way to hang a budget on
 *  a selection problem, and it lands within a rounding error of the true
 *  optimum here. */
function bestAffordableXi(pool: RatingRow[], gw: number, e: Engine, budget: number): number {
  const cands = pool
    .map((r) => ({ r, v: xp(r, gw, e) ?? 0, p: price(r), pos: String(r.position), team: String(r.team) }))
    .filter((c) => c.v > 0)
  if (cands.length < 11) return 0

  const pick = (lambda: number) => {
    const scored = cands
      .map((c) => ({ ...c, s: c.v - lambda * c.p }))
      .sort((a, b) => b.s - a.s)
    let best = { total: 0, cost: 0 }
    for (const [d, m, f] of FORMATIONS) {
      const need: Record<string, number> = { GKP: 1, DEF: d, MID: m, FWD: f }
      const clubs = new Map<string, number>()
      let total = 0
      let cost = 0
      let taken = 0
      for (const c of scored) {
        if (!need[c.pos]) continue
        if ((clubs.get(c.team) ?? 0) >= 3) continue
        need[c.pos]--
        clubs.set(c.team, (clubs.get(c.team) ?? 0) + 1)
        total += c.v
        cost += c.p
        if (++taken === 11) break
      }
      if (taken === 11 && total > best.total) best = { total, cost }
    }
    return best
  }

  let lo = 0
  let hi = 4
  let out = pick(hi)
  if (pick(lo).cost <= budget) return pick(lo).total
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    const got = pick(mid)
    if (got.cost > budget) lo = mid
    else { hi = mid; out = got }
  }
  return out.total
}

export function chipPlan({ squad, pool, fromGw, gws, bank, engine, spentAt, freeTransfers: ft }: {
  squad: RatingRow[]
  pool: RatingRow[]
  fromGw: number
  gws: number[]
  bank: number
  engine: Engine
  /** Where each chip has already gone in this half. */
  spentAt: (c: ChipKey) => number | null
  freeTransfers: number
}): ChipPlan | null {
  if (squad.length !== 15) return null
  const window = gws.filter((g) => g >= fromGw).slice(0, HORIZON)
  if (!window.length) return null
  const squadValue = squad.reduce((s, r) => s + price(r), 0)

  // Triple captain: the extra helping of your best player, week by week.
  let tcGw: number | null = null
  let tcGain = 0
  let tcName = ''
  for (const g of window) {
    const best = squad.reduce((a, r) => Math.max(a, xp(r, g, engine) ?? 0), 0)
    if (best > tcGain) {
      tcGain = best
      tcGw = g
      tcName = String(squad.reduce((a, r) => ((xp(r, g, engine) ?? 0) > (xp(a, g, engine) ?? 0) ? r : a)).web_name)
    }
  }

  // Bench boost: what the four substitutes would add. The bench you'd field
  // that week, not today's — so it uses the squad minus its best eleven.
  let bbGw: number | null = null
  let bbGain = 0
  for (const g of window) {
    const { xi: starters } = bestXiXp(squad, g, engine)
    const ids = new Set(starters.map(el))
    const subs = squad.filter((r) => !ids.has(el(r)))
    const total = subs.reduce((s, r) => s + (xp(r, g, engine) ?? 0), 0)
    if (total > bbGain) { bbGain = total; bbGw = g }
  }

  // Free hit: your eleven against the best eleven the market could field.
  let fhGw: number | null = null
  let fhGain = 0
  let fhBlanks = 0
  for (const g of window) {
    const mine = bestXiXp(squad, g, engine).total
    const theirs = bestAffordableXi(pool, g, engine, squadValue + bank)
    const gain = theirs - mine
    if (gain > fhGain) {
      fhGain = gain
      fhGw = g
      fhBlanks = squad.filter((r) => !fixturesFor(String(r.team), engine.fixtureEase).some((f) => f.gw === g)).length
    }
  }

  // Wildcard isn't a week, it's a verdict on the squad: how many moves the
  // Analyser wants if transfers were free.
  const free = recommend({ squad, pool, fromGw, gws, bank, freeTransfers: 99, engine, maxMoves: 6 })
  const wcMoves = free?.moves.length ?? 0
  const wcGain = free?.moves.reduce((s, m) => s + m.gain, 0) ?? 0

  const advice: ChipAdvice[] = [
    {
      chip: 'triple-captain', label: CHIP_TITLE['triple-captain'], gw: tcGw, gain: tcGain,
      worthIt: tcGain >= CHIP_BAR['triple-captain'], spentAt: spentAt('triple-captain'),
      detail: tcGw
        ? `${tcName} projects ${tcGain.toFixed(1)} in GW${tcGw} — the third helping is worth that again`
        : 'No week in range stands out',
    },
    {
      chip: 'bench-boost', label: CHIP_TITLE['bench-boost'], gw: bbGw, gain: bbGain,
      worthIt: bbGain >= CHIP_BAR['bench-boost'], spentAt: spentAt('bench-boost'),
      detail: bbGw
        ? `Your four substitutes project ${bbGain.toFixed(1)} between them in GW${bbGw}`
        : 'No week in range stands out',
    },
    {
      chip: 'free-hit', label: CHIP_TITLE['free-hit'], gw: fhGw, gain: fhGain,
      worthIt: fhGain >= CHIP_BAR['free-hit'], spentAt: spentAt('free-hit'),
      detail: fhGw
        ? `${fhBlanks > 0 ? `${fhBlanks} of your fifteen blank in GW${fhGw}. ` : ''}A one-week squad at your budget projects ${fhGain.toFixed(1)} more than yours`
        : 'No week in range stands out',
    },
    {
      chip: 'wildcard', label: CHIP_TITLE.wildcard, gw: wcMoves >= 4 ? fromGw : null, gain: wcGain,
      // Four moves is the point at which free transfers can't keep up without
      // paying for it — which is exactly what a wildcard is for.
      worthIt: wcMoves >= 4, spentAt: spentAt('wildcard'),
      detail: wcMoves >= 4
        ? `${wcMoves} changes would each gain points, and you have ${ft === Infinity ? 'unlimited' : ft} free — a wildcard makes them all at once for +${wcGain.toFixed(1)}`
        : `Only ${wcMoves} ${wcMoves === 1 ? 'change is' : 'changes are'} worth making — free transfers can handle that`,
    },
  ]

  const live = advice.filter((a) => a.spentAt == null && a.worthIt)
  // Rank on how far each clears its own bar, since the bars differ.
  live.sort((a, b) => b.gain / (CHIP_BAR[b.chip] || 1) - a.gain / (CHIP_BAR[a.chip] || 1))
  const best = live[0] ?? null

  const weeksLeft = fromGw < SECOND_HALF_FROM ? FIRST_HALF_LAST - fromGw : null
  const unspent = advice.filter((a) => a.spentAt == null).length
  const headline = best
    ? best.chip === 'wildcard'
      ? `Wildcard — your squad needs more moves than your transfers can pay for`
      : `${best.label} in GW${best.gw}, worth about +${best.gain.toFixed(0)} points`
    : weeksLeft != null && weeksLeft <= 4 && unspent > 0
      ? `Hold — but ${unspent} ${unspent === 1 ? 'chip expires' : 'chips expire'} after GW${FIRST_HALF_LAST}`
      : 'Hold — no chip is worth playing in the next six weeks'

  return { advice, best, weeksLeft, headline }
}
