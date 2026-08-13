import { sumParts, xpPartsForGw, GOAL_PTS, type XpModel, type MarketOdds, type ShotProfiles } from './xp'
import { num } from './rows'
import type { Availability } from './availability'
import type { PlannerState } from './planner'
import type { FixtureEaseRow, RatingRow } from './types'

/* ════════════════════════════════════════════════════════════════════════
   The season spine — fifteen SLOTS, not fifteen players.

   A plan grid that draws players cannot survive a wildcard: eight transfers
   in one week and the table grows eight rows that are empty either side of
   the seam. Drawing SLOTS instead means the grid is fifteen rows in August
   and fifteen in May, however many hands the shirts pass through, and a
   transfer reads as one row changing owner rather than two rows appearing.

   The planner already works this way and nobody noticed: `squadAt` applies a
   transfer with `squad[i] = t.in`, in place, so the slot index survives the
   swap. This module only has to walk the same path and remember who held
   each index when.
   ════════════════════════════════════════════════════════════════════════ */

export interface SlotStint {
  /** Null while the slot is empty — sold, with the money not yet spent. */
  element: number | null
  /** First and last gameweek of this stint; `to` null means still there. */
  from: number
  to: number | null
}

export interface Slot {
  stints: SlotStint[]
}

/** Who holds `slot` in `gw`, or null if the slot is empty that week. */
export function memberAt(slot: Slot, gw: number): number | null {
  for (const s of slot.stints) {
    if (gw >= s.from && (s.to == null || gw <= s.to)) return s.element
  }
  return null
}

/** Fifteen slots and their whole history, walked the same way `squadAt`
 *  walks it so the two can never disagree about who is in the squad. */
export function buildSlots(state: PlannerState): Slot[] {
  const squad = [...state.base]
  const slots: Slot[] = squad.map((el) => ({ stints: [{ element: el, from: state.startGw, to: null }] }))
  const weeks = Object.keys(state.weeks).map(Number).sort((a, b) => a - b)

  for (const gw of weeks) {
    for (const t of state.weeks[gw].transfers) {
      let i = squad.indexOf(t.out)
      if (i < 0) {
        /* The player being sold is not in the squad, which happens when the
           money from an earlier sale is being spent: the slot is sitting
           empty. Give the arrival the first empty slot rather than dropping
           him, or the grid would quietly lose a row. */
        i = squad.indexOf(-1)
        if (i < 0) continue
      }
      const slot = slots[i]
      const open = slot.stints[slot.stints.length - 1]
      if (open && open.to == null) open.to = gw - 1
      if (t.in == null) {
        squad[i] = -1
        slot.stints.push({ element: null, from: gw, to: null })
      } else {
        squad[i] = t.in
        slot.stints.push({ element: t.in, from: gw, to: null })
      }
    }
  }
  return slots
}

const POS_ORDER: Record<string, number> = { GKP: 0, DEF: 1, MID: 2, FWD: 3 }

/** Slots in team-sheet order — keepers, defenders, midfielders, forwards.
 *  `base` arrives in whatever order the squad was picked in, which put a
 *  forward between two defenders and made the grid unreadable as a squad.
 *  Ordered on the FIRST holder so the rows never reshuffle as you scrub
 *  through the weeks; a transfer is a slot changing hands, not moving. */
export function orderSlots(slots: Slot[], byEl: Map<number, RatingRow>): Slot[] {
  return [...slots].sort((a, b) => {
    const pa = byEl.get(a.stints[0]?.element ?? -1)
    const pb = byEl.get(b.stints[0]?.element ?? -1)
    const oa = POS_ORDER[String(pa?.position ?? '')] ?? 9
    const ob = POS_ORDER[String(pb?.position ?? '')] ?? 9
    if (oa !== ob) return oa - ob
    // Within a line, the expensive man first — that is how a team sheet reads.
    return (num(pb ?? {}, 'price') ?? 0) - (num(pa ?? {}, 'price') ?? 0)
  })
}

/** The gameweek a stint begins, for every slot that changes hands — what the
 *  grid draws as a seam, and the name bands hang off. */
export interface Handover {
  slot: number
  gw: number
  out: number | null
  in: number | null
}

export function handovers(slots: Slot[]): Handover[] {
  const out: Handover[] = []
  slots.forEach((slot, i) => {
    slot.stints.forEach((s, j) => {
      if (j === 0) return
      out.push({ slot: i, gw: s.from, out: slot.stints[j - 1].element, in: s.element })
    })
  })
  return out
}

/* ── what a cell says ────────────────────────────────────────────────── */

export type SpineMode = 'fix' | 'xp' | 'cs' | 'gi' | 'dc'

export const MODE_LABEL: Record<SpineMode, string> = {
  fix: 'Fix', xp: 'xP', cs: 'CS%', gi: 'xGI', dc: 'DC%',
}

/** What the numbers in each mode actually are, said on the page rather than
 *  left for a reader to infer from a decimal point. */
export const MODE_NOTE: Record<SpineMode, string> = {
  fix: 'opponent, upper case at home',
  xp: 'projected points that week',
  cs: 'chance his team keeps a clean sheet',
  gi: 'expected goals + assists',
  dc: 'chance he hits the defensive-contribution threshold',
}

export interface SpineCell {
  /** Opponent, cased for venue: ABC at home, abc away. Blank weeks are ''. */
  fixture: string
  fdr: number
  /** The number this cell shows in the current mode; null in fixture mode. */
  value: number | null
  blank: boolean
  /** The question does not apply to this shirt — a forward has no clean sheet
   *  to keep and a keeper has no defensive-contribution threshold to clear.
   *  A zero would read as "unlikely" when the truth is "not a thing". */
  na: boolean
}

/** Does this mode ask a question this position can answer? Clean sheets pay
 *  keepers, defenders and (one point) midfielders, never forwards; the
 *  defensive-contribution threshold exists for outfielders only. */
export function modeApplies(mode: SpineMode, pos: string): boolean {
  if (mode === 'cs') return pos !== 'FWD'
  if (mode === 'dc') return pos !== 'GKP'
  return true
}

/** How a mode's number reads. Clean sheets and defensive contribution are
 *  CHANCES — "0.4" in a cell is meaningless where "42%" is the whole answer —
 *  so they carry their own formatter rather than every caller guessing. */
export function formatCell(mode: SpineMode, v: number | null): string {
  if (v == null) return '—'
  if (mode === 'cs' || mode === 'dc') return `${Math.round(v * 100)}%`
  return v.toFixed(1)
}

/* ── how good is that number ─────────────────────────────────────────────
   A grid of numbers you have to read one at a time is a table, not an
   instrument. Each mode gets bands so a column can be scanned: red is a week
   to worry about, green a week to build around. The cuts are FPL judgements,
   not statistics — three points from a starter is a bad week, six is a good
   one — and they live here so every view agrees on what "good" means. */
export type Tone = 'bad' | 'weak' | 'ok' | 'good' | 'elite'

const BANDS: Record<Exclude<SpineMode, 'fix'>, [number, number, number, number]> = {
  //        bad below | weak below | good above | elite above
  /* Under three points from a man you are starting is a bad week — that cut
     is the one that matters and everything else is spaced around it. The
     first pass put the amber band at 4.5 and turned an ordinary week amber:
     104 of 180 cells, which is a warning colour saying nothing. */
  xp: [3, 4, 5.5, 7],
  cs: [0.2, 0.3, 0.45, 0.6],
  gi: [0.25, 0.4, 0.6, 0.85],
  dc: [0.2, 0.35, 0.5, 0.65],
}

export function toneOf(mode: SpineMode, v: number | null): Tone | null {
  if (mode === 'fix' || v == null) return null
  const [bad, weak, good, elite] = BANDS[mode]
  if (v >= elite) return 'elite'
  if (v >= good) return 'good'
  if (v >= weak) return 'ok'
  if (v >= bad) return 'weak'
  return 'bad'
}

/** One player, one week, in whichever language the grid is currently
 *  speaking. Every mode reads the SAME projection the rest of the site
 *  reads — the fixture view just draws the opponent instead of a number. */
export function spineCell(
  r: RatingRow | undefined,
  gw: number,
  mode: SpineMode,
  fixtureEase: FixtureEaseRow[],
  avail: Availability | undefined,
  model: XpModel | null,
  market: MarketOdds | null,
  profiles: ShotProfiles | null,
): SpineCell {
  if (!r) return { fixture: '', fdr: 3, value: null, blank: true, na: false }
  const fixes = fixtureEase.filter((f) => f.team === r.team && f.gw === gw)
  const fixture = fixes
    .map((f) => (f.venue === 'H' ? f.opponent.toUpperCase() : f.opponent.toLowerCase()))
    .join('+')
  const fdr = fixes.length ? Math.round(fixes.reduce((a, f) => a + f.fdr, 0) / fixes.length) : 3
  if (!fixes.length) return { fixture: '', fdr: 3, value: null, blank: true, na: false }
  if (mode === 'fix') return { fixture, fdr, value: null, blank: false, na: false }
  if (!modeApplies(mode, String(r.position))) {
    return { fixture, fdr, value: null, blank: false, na: true }
  }

  const parts = xpPartsForGw(r, gw, fixtureEase, avail, model, market, profiles)
  if (!parts) return { fixture, fdr, value: null, blank: false, na: false }
  /* Each mode answers its own question in its own unit, and three of them are
     not points. CS is the chance of a clean sheet, straight off the goals the
     team is expected to concede — as POINTS it was a forward's flat zero and a
     keeper's 1.4, which says nothing about the fixture. DC is the chance of
     hitting the defensive-contribution threshold: the engine prices that at
     two points a hit, so halving its points recovers the probability. xGI is
     expected goal involvement, which is what the letters mean — xG plus xA,
     not the points they happen to be worth to this shirt. */
  const value = mode === 'xp' ? sumParts(parts)
    : mode === 'cs' ? Math.exp(-parts.lamAgainst)
    : mode === 'gi' ? parts.lamGoal + parts.lamAssist
    : Math.min(1, parts.dc / 2)
  return { fixture, fdr, value, blank: false, na: false }
}

/** The scale a heat view colours against: modes have wildly different ranges
 *  (a keeper's clean-sheet points against a forward's goal points), so each
 *  gets its own top rather than a shared one that flattens four of them. */
export function heatTop(mode: SpineMode): number {
  // CS and DC are probabilities now, so their scale is 1, not a points range.
  return mode === 'xp' ? 8 : mode === 'gi' ? 1.2 : 1
}

/* ── the armband marker ──────────────────────────────────────────────── */

/** Does the squad hold the best captain in the game that week?

    Checking every player in every week is thousands of projections for one
    badge. It is also unnecessary: the best captain in a given week is always
    one of the season's best players, so a shortlist taken once on season
    projection answers it for a fortieth of the work. The shortlist is
    deliberately deep — forty, not ten — so a fixture swing can still lift a
    mid-table forward above the usual two. */
export function bestCaptainByGw(
  ratings: RatingRow[],
  gws: number[],
  fixtureEase: FixtureEaseRow[],
  avail: Availability | undefined,
  model: XpModel | null,
  market: MarketOdds | null,
  profiles: ShotProfiles | null,
  shortlist = 40,
): Map<number, { element: number; xp: number }> {
  const first = gws[0]
  const seeded = ratings
    .map((r) => ({
      r,
      seed: xpPartsForGw(r, first, fixtureEase, avail, model, market, profiles),
    }))
    .filter((x) => x.seed)
    .map((x) => ({ r: x.r, xp: sumParts(x.seed!) }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, shortlist)

  const out = new Map<number, { element: number; xp: number }>()
  for (const gw of gws) {
    let best: { element: number; xp: number } | null = null
    for (const { r } of seeded) {
      const parts = xpPartsForGw(r, gw, fixtureEase, avail, model, market, profiles)
      if (!parts) continue
      const xp = sumParts(parts)
      const element = num(r, 'element') ?? 0
      if (!best || xp > best.xp) best = { element, xp }
    }
    if (best) out.set(gw, best)
  }
  return out
}

/** Easy and hard fixture counts for the squad in a week — the diverging bar
 *  under each timeline column. Green grows from the left, red from the
 *  right, and the grey between them is the mid-table middle. */
export function weekRisk(
  elements: (number | null)[],
  gw: number,
  byEl: Map<number, RatingRow>,
  fixtureEase: FixtureEaseRow[],
): { easy: number; hard: number; total: number } {
  let easy = 0
  let hard = 0
  let total = 0
  for (const el of elements) {
    if (el == null) continue
    const r = byEl.get(el)
    if (!r) continue
    total++
    const fixes = fixtureEase.filter((f) => f.team === r.team && f.gw === gw)
    if (!fixes.length) { hard++; continue }   // a blank is the hardest week of all
    const fdr = fixes.reduce((a, f) => a + f.fdr, 0) / fixes.length
    if (fdr <= 2.5) easy++
    else if (fdr >= 3.5) hard++
  }
  return { easy, hard, total }
}

export { GOAL_PTS }
