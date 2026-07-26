import { num } from './rows'
import { availFor, availabilityFactor, type Availability } from './availability'
import type { FixtureEaseRow, RatingRow } from './types'

/* ════════════════════════════════════════════════════════════════════════
   Per-gameweek expected points.

   The model, in one breath: what a player produced per game last season —
   already priced source by source (goals from xG, assists from xA, clean
   sheets from xGC, def con, saves, bonus) — carried forward and bent by the
   two things we actually know about the future: who the fixture is against,
   and whether the player can play.

     xP(gw) = Σ over that week's fixtures of
                baseline per-game xPts × difficulty multiplier
              × availability factor (0 while injured/suspended until the
                return date FPL states; scaled by chance-of-playing when
                doubtful)

   A blank gameweek is 0 because there is no fixture, a double counts twice
   because there are two. The difficulty multipliers are deliberately gentle —
   fixtures swing results far more than they swing underlying performance, and
   a model that doubles a player's projection against Sunderland is selling
   confidence it doesn't have.
   ════════════════════════════════════════════════════════════════════════ */

const FDR_MULT: Record<number, number> = { 1: 1.15, 2: 1.08, 3: 1.0, 4: 0.9, 5: 0.8 }

/** Expected points for one player in one gameweek. Null when the player has
 *  no baseline (unrated new signing); 0 for a blank or an unavailable week. */
export function xpForGw(
  r: RatingRow,
  gw: number,
  fixtureEase: FixtureEaseRow[],
  avail?: Availability,
): number | null {
  const base = num(r, 'season_xpts_per_game')
  if (base == null) return null
  const fixes = fixtureEase.filter((f) => f.team === r.team && f.gw === gw)
  if (!fixes.length) return 0
  let sum = 0
  for (const f of fixes) sum += base * (FDR_MULT[f.fdr] ?? 1)
  if (avail) {
    const p = availFor(avail, num(r, 'element'), num(r, 'code'))
    sum *= availabilityFactor(p, avail.deadlines.get(gw) ?? null)
  }
  return sum
}

/** Same thing summed over the next `n` gameweeks from `fromGw`. */
export function xpOverGws(
  r: RatingRow,
  fromGw: number,
  n: number,
  fixtureEase: FixtureEaseRow[],
  avail?: Availability,
): number | null {
  let total = 0
  let any = false
  for (let g = fromGw; g < fromGw + n; g++) {
    const v = xpForGw(r, g, fixtureEase, avail)
    if (v != null) {
      total += v
      any = true
    }
  }
  return any ? total : null
}
