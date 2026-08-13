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
  fix: 'Fix', xp: 'xP', cs: 'CS', gi: 'xGI', dc: 'DC',
}

export interface SpineCell {
  /** Opponent, cased for venue: ABC at home, abc away. Blank weeks are ''. */
  fixture: string
  fdr: number
  /** The number this cell shows in the current mode; null in fixture mode. */
  value: number | null
  blank: boolean
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
  if (!r) return { fixture: '', fdr: 3, value: null, blank: true }
  const fixes = fixtureEase.filter((f) => f.team === r.team && f.gw === gw)
  const fixture = fixes
    .map((f) => (f.venue === 'H' ? f.opponent.toUpperCase() : f.opponent.toLowerCase()))
    .join('+')
  const fdr = fixes.length ? Math.round(fixes.reduce((a, f) => a + f.fdr, 0) / fixes.length) : 3
  if (!fixes.length) return { fixture: '', fdr: 3, value: mode === 'fix' ? null : 0, blank: true }
  if (mode === 'fix') return { fixture, fdr, value: null, blank: false }

  const parts = xpPartsForGw(r, gw, fixtureEase, avail, model, market, profiles)
  if (!parts) return { fixture, fdr, value: null, blank: false }
  const value = mode === 'xp' ? sumParts(parts)
    : mode === 'cs' ? parts.cs
    // Attacking involvement in points, not in expected goals: the grid is a
    // points instrument, and goals and assists are worth different amounts to
    // different shirts.
    : mode === 'gi' ? parts.goal + parts.assist
    : parts.dc
  return { fixture, fdr, value, blank: false }
}

/** The scale a heat view colours against: modes have wildly different ranges
 *  (a keeper's clean-sheet points against a forward's goal points), so each
 *  gets its own top rather than a shared one that flattens four of them. */
export function heatTop(mode: SpineMode): number {
  return mode === 'xp' ? 8 : mode === 'gi' ? 5 : mode === 'cs' ? 3 : 2
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
