import { num } from './rows'
import { squadAt, autoLineup, pointsHit, type PlannerState, type Chip, type Pos } from './planner'
import { weeksKey } from './plans'
import { xpForGw, type XpModel, type MarketOdds, type ShotProfiles } from './xp'
import type { Availability } from './availability'
import type { FixtureEaseRow, RatingRow } from './types'

/* ════════════════════════════════════════════════════════════════════════
   A PLAN IS A ROUTE, NOT A FIFTEEN.

   Comparing plans used to mean comparing two squads as they stood in the
   opening week, with the weeks that follow reduced to a projection of the
   best legal eleven each could field. That is a comparison of two sets of
   players. It is not a comparison of two plans: two plans can hold the same
   fifteen in GW1 and be entirely different bets by GW6 — a transfer taken a
   week early, a hit paid, an armband on someone else — and none of that
   reached the page.

   This module walks each plan the way the board walks it: the squad it holds
   that week, the eleven it puts out, who wears the armband, what it spent
   and what the week is therefore worth. Everything the compare page shows is
   read off these rows, so the page and the board can never disagree about
   what a plan does.
   ════════════════════════════════════════════════════════════════════════ */

export interface RouteWeek {
  gw: number
  /** The fifteen the plan holds this week. */
  squad: number[]
  xi: number[]
  captain: number | null
  chip: Chip | null
  /** Transfers completed this week — a sale with no replacement is not one. */
  moves: { out: number; in: number }[]
  /** Points paid for those transfers. */
  hit: number
  /** The eleven's projection with the armband applied, before the hit. */
  gross: number
  /** What the week is actually worth: gross minus the hit. */
  xp: number
}

export interface RouteCtx {
  byEl: Map<number, RatingRow>
  fixtureEase: FixtureEaseRow[]
  avail?: Availability
  model?: XpModel | null
  market?: MarketOdds | null
  profiles?: ShotProfiles | null
}

/** A plan's stored week decisions, or a bare state when it has none yet. */
export function readState(planId: string, base: number[], startGw: number): PlannerState {
  try {
    const raw = localStorage.getItem(weeksKey(planId))
    if (raw) {
      const weeks = JSON.parse(raw) as PlannerState['weeks'] | PlannerState
      // Two shapes have lived under this key: the whole state, and just the
      // weeks. Accept either rather than silently reading zero transfers.
      if (weeks && typeof weeks === 'object') {
        const s = weeks as PlannerState
        if (Array.isArray(s.base) && s.weeks) return s
        return { base: [...base], startGw, weeks: weeks as PlannerState['weeks'] }
      }
    }
  } catch { /* private mode */ }
  return { base: [...base], startGw, weeks: {} }
}

/**
 * Walk a plan across `gws`, one row per gameweek.
 *
 * The lineup for a week the reader has never opened is DERIVED, not blank:
 * the planner only materialises a week when you visit it, and a compare page
 * that showed nothing for the weeks you had not clicked would be reporting on
 * your browsing rather than on your plan. Carried forward where the previous
 * eleven is still legal, auto-picked where it is not — the same rule the
 * season spine uses, so the two views agree.
 */
export function buildRoute(state: PlannerState, gws: number[], ctx: RouteCtx): RouteWeek[] {
  const { byEl, fixtureEase, avail, model, market, profiles } = ctx
  const posOf = (el: number) => String(byEl.get(el)?.position ?? 'MID') as Pos
  const ratingOf = (el: number) => (num(byEl.get(el) ?? {}, 'season_overall_score') ?? 0) * 20

  type Line = { xi: number[]; bench: number[]; captain: number | null }
  let carried: Line | null = null
  const out: RouteWeek[] = []

  for (const gw of gws) {
    const squad = squadAt(state, gw)
    const w = state.weeks[gw]
    const stored: Line | null = w && w.xi?.length === 11
      ? { xi: w.xi, bench: w.bench ?? [], captain: w.captain ?? null }
      : null
    const carryOk = !!carried && carried.xi.length === 11 && carried.xi.every((e) => squad.includes(e))
    const auto = (): Line => {
      const a = autoLineup(squad, posOf, ratingOf)
      return { xi: a.xi, bench: a.bench, captain: a.captain }
    }
    const line: Line = stored ?? (carryOk && carried ? carried : auto())
    const captain = line.captain ?? autoLineup(line.xi, posOf, ratingOf).captain
    const chip = (w?.chip ?? null) as Chip | null

    const xpOf = (el: number) => {
      const r = byEl.get(el)
      return r ? xpForGw(r, gw, fixtureEase, avail, model, market, profiles) ?? 0 : 0
    }
    let gross = 0
    for (const el of line.xi) {
      const v = xpOf(el)
      gross += el === captain ? v * (chip === 'triple-captain' ? 3 : 2) : v
    }
    // Bench Boost is the one chip that changes WHO scores, so it changes the
    // number rather than only the label.
    if (chip === 'bench-boost') for (const el of line.bench) gross += xpOf(el)

    const hit = pointsHit(state, gw)
    out.push({
      gw,
      squad,
      xi: line.xi,
      captain,
      chip,
      moves: (w?.transfers ?? [])
        .filter((t): t is { out: number; in: number } => t.in != null)
        .map((t) => ({ out: t.out, in: t.in })),
      hit,
      gross,
      xp: gross - hit,
    })
    carried = line
  }
  return out
}

/** What separates two routes in a given week. Empty means they did the same
 *  thing, which is most weeks and the reason the log only prints the rest. */
export interface WeekDiff {
  gw: number
  /** Held by A and not by B this week, and the other way round. */
  onlyA: number[]
  onlyB: number[]
  /** Different armband — the cheapest way for two plans to diverge. */
  captains: [number | null, number | null] | null
  chips: [Chip | null, Chip | null] | null
  movesA: { out: number; in: number }[]
  movesB: { out: number; in: number }[]
  hits: [number, number]
  /** B's week minus A's, net of hits. */
  gap: number
}

export function diffWeek(a: RouteWeek, b: RouteWeek): WeekDiff {
  const sa = new Set(a.squad)
  const sb = new Set(b.squad)
  return {
    gw: a.gw,
    onlyA: a.squad.filter((e) => !sb.has(e)),
    onlyB: b.squad.filter((e) => !sa.has(e)),
    captains: a.captain !== b.captain ? [a.captain, b.captain] : null,
    chips: a.chip !== b.chip ? [a.chip, b.chip] : null,
    movesA: a.moves,
    movesB: b.moves,
    hits: [a.hit, b.hit],
    gap: b.xp - a.xp,
  }
}

/** The state two plans are in, as opposed to what they DID this week. Two
 *  plans that differ by one keeper differ by that keeper in every week of the
 *  window; restating it six times is the noise the log exists to remove. */
const standing = (d: WeekDiff): string => JSON.stringify([
  [...d.onlyA].sort(), [...d.onlyB].sort(), d.captains, d.chips,
])

/** Did anything CHANGE this week? A move is always an event. Otherwise the
 *  week is only worth a row when the standing difference is not the one the
 *  week before had — which makes the first week of any difference a row, and
 *  every week that merely carries it a line in a collapsed run. */
export const changed = (d: WeekDiff, prev: string | null): boolean =>
  d.movesA.length > 0 || d.movesB.length > 0 || standing(d) !== (prev ?? '')

/** Runs of unchanged weeks collapse to one row. */
export type LogRow =
  | { kind: 'diff'; d: WeekDiff; cum: number }
  | { kind: 'quiet'; from: number; to: number; cum: number; same: WeekDiff }

export function buildLog(a: RouteWeek[], b: RouteWeek[]): LogRow[] {
  const rows: LogRow[] = []
  let cum = 0
  let prev: string | null = null
  let run: { from: number; to: number; same: WeekDiff } | null = null
  const flush = () => {
    // The running gap shown against a collapsed run is the one it ends on.
    if (run) rows.push({ kind: 'quiet', from: run.from, to: run.to, cum, same: run.same })
    run = null
  }
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = diffWeek(a[i], b[i])
    cum += d.gap
    if (changed(d, prev)) {
      flush()
      rows.push({ kind: 'diff', d, cum })
    } else {
      run = run ? { from: run.from, to: d.gw, same: d } : { from: d.gw, to: d.gw, same: d }
    }
    prev = standing(d)
  }
  flush()
  return rows
}

/** Do the two routes end the window holding the same fifteen? Then this is a
 *  question about TIMING, not about squads, and the page should say so. */
export function converges(a: RouteWeek[], b: RouteWeek[]): number | null {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const sa = new Set(a[i].squad)
    if (a[i].squad.length === b[i].squad.length && b[i].squad.every((e) => sa.has(e))) {
      // Only interesting if they were apart before it.
      if (i === 0) return null
      const s0 = new Set(a[0].squad)
      if (b[0].squad.every((e) => s0.has(e))) return null
      return a[i].gw
    }
  }
  return null
}

/** Where the lead changes hands, if it does. */
export function crossover(a: RouteWeek[], b: RouteWeek[]): { gw: number; to: 'a' | 'b' } | null {
  let cum = 0
  let side: 'a' | 'b' | null = null
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    cum += b[i].xp - a[i].xp
    const now: 'a' | 'b' | null = Math.abs(cum) < 0.05 ? null : cum > 0 ? 'b' : 'a'
    if (now && side && now !== side) return { gw: a[i].gw, to: now }
    if (now) side = now
  }
  return null
}

/** Cumulative difference (B − A) after each week — the crossover chart's line. */
export const cumulative = (a: RouteWeek[], b: RouteWeek[]): number[] => {
  let c = 0
  return a.map((_, i) => (c += (b[i]?.xp ?? 0) - a[i].xp))
}
