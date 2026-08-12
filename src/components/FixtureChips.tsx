import { FDR_COLORS, teamFullNames } from '../lib/util'
import type { FixtureEaseRow } from '../lib/types'

/**
 * Next-n fixture chips for a team from the pre-computed fixture_ease rows.
 * Renders nothing when no upcoming fixtures are known (e.g. between seasons).
 */
export function FixtureChips({
  fixtureEase,
  team,
  n = 3,
  compact = false,
  dense = false,
  fromGw,
}: {
  fixtureEase: FixtureEaseRow[]
  team: string
  n?: number
  /** Tiny colour ticks instead of labelled chips — for pitch cards. */
  compact?: boolean
  /** Smaller chips that keep the opponent and the venue but drop the
   *  brackets and a point and a half of type: `COV·H` rather than `COV (H)`.
   *  For the market list, where four of these have to sit on the same line as
   *  a name, a price, a projection and a rating — 56px a chip does not fit
   *  and 33 does. */
  dense?: boolean
  /** Start from this gameweek rather than the first in the table — the
   *  planner steps through the season, and a list still showing GW1 while
   *  the board is on GW5 is worse than showing nothing. */
  fromGw?: number
}) {
  const upcoming = (fixtureEase || [])
    .filter((f) => f.team === team && (fromGw == null || f.gw >= fromGw))
    .sort((a, b) => a.gw - b.gw)
    .slice(0, n)
  if (!upcoming.length) return null
  if (compact) {
    return (
      <>
        {upcoming.map((f, i) => {
          const [bg] = FDR_COLORS[f.fdr] || FDR_COLORS[3]
          return (
            <span
              key={i}
              className="block h-[4px] w-[11px] rounded-sm"
              style={{ background: bg }}
              title={`GW${f.gw} ${f.venue === 'H' ? 'vs' : 'at'} ${teamFullNames[f.opponent] || f.opponent} (FDR ${f.fdr})`}
            />
          )
        })}
      </>
    )
  }
  return (
    <span className={dense ? 'inline-flex gap-0.5' : 'inline-flex flex-wrap gap-1'}>
      {upcoming.map((f, i) => {
        const [bg, fg] = FDR_COLORS[f.fdr] || FDR_COLORS[3]
        return (
          <span
            key={i}
            className={dense
              ? 'capture-pill rounded px-1 py-px text-[9px] leading-[13px] font-bold'
              : 'capture-pill rounded px-1.5 py-0.5 text-[11px] font-medium'}
            style={{ background: bg, color: fg }}
            title={`GW${f.gw} ${f.venue === 'H' ? 'vs' : 'at'} ${teamFullNames[f.opponent] || f.opponent} (FDR ${f.fdr})`}
          >
            {dense ? `${f.opponent}·${f.venue}` : `${f.opponent} (${f.venue})`}
          </span>
        )
      })}
    </span>
  )
}

/**
 * Named fixtures for a pitch card: the opponent and venue, coloured by
 * difficulty. Three colour ticks tell you the run is amber-red-red; they
 * don't tell you against whom, which is the thing you're actually checking on
 * a phone. Two on a small screen, three once there's room.
 */
export function FixtureNames({ fixtureEase, team, n = 3, fromGw }: { fixtureEase: FixtureEaseRow[]; team: string; n?: number; fromGw?: number }) {
  const upcoming = (fixtureEase || [])
    .filter((f) => f.team === team && (fromGw == null || f.gw >= fromGw))
    .sort((a, b) => a.gw - b.gw)
    .slice(0, n)
  if (!upcoming.length) return null
  return (
    // No fixed height here on purpose: html2canvas lays these pills out a
    // hair taller than the browser does, and clamping the stack clipped the
    // text in the exported PNG. The card carries a couple of pixels of bottom
    // padding to absorb it instead.
    <span className="block">
      {upcoming.map((f, i) => {
        const [bg, fg] = FDR_COLORS[f.fdr] || FDR_COLORS[3]
        return (
          <span
            key={i}
            // The third fixture is a nicety, not a necessity — it waits for a
            // screen with room for it.
            // Explicit box height rather than a line-height: the rasteriser
            // rounds line boxes differently and the stack grew past the card.
            className={`capture-pill mt-[2px] h-[12px] truncate rounded-[3px] px-1 text-[8px] leading-[12px] font-extrabold sm:h-[13px] sm:text-[9px] sm:leading-[13px] ${i >= 2 ? 'hidden sm:block' : 'block'}`}
            style={{ background: bg, color: fg }}
            title={`GW${f.gw} ${f.venue === 'H' ? 'vs' : 'at'} ${teamFullNames[f.opponent] || f.opponent} (FDR ${f.fdr})`}
          >
            {f.opponent} ({f.venue})
          </span>
        )
      })}
    </span>
  )
}
