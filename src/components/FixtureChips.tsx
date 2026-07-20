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
}: {
  fixtureEase: FixtureEaseRow[]
  team: string
  n?: number
}) {
  const upcoming = (fixtureEase || [])
    .filter((f) => f.team === team)
    .sort((a, b) => a.gw - b.gw)
    .slice(0, n)
  if (!upcoming.length) return null
  return (
    <span className="inline-flex flex-wrap gap-1">
      {upcoming.map((f, i) => {
        const [bg, fg] = FDR_COLORS[f.fdr] || FDR_COLORS[3]
        return (
          <span
            key={i}
            className="rounded px-1.5 py-0.5 text-[11px] font-medium"
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
