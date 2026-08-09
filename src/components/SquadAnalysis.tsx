import { useMemo, useState } from 'react'
import { Tabs, type TabDef } from './Tabs'
import { SquadLadder } from './SquadLadder'
import { Contribution, GoalSources, DefenceConcentration, ClubRisk, MinutesRisk } from './SquadShape'
import { CaptaincyLadder, CaptaincyVsField, ChipWindows, OwnershipSwing, TransferUpside, FixtureTurnMap, PriceWatch } from './SquadDecisions'
import { FloorCeiling, ProjectedVsActual, type SeasonRow } from './SquadOutcomes'
import { buildSeries, type Engine } from '../lib/squadInsights'
import { num } from '../lib/rows'
import type { DiffScale } from '../lib/fixtureRuns'
import type { RatingRow, FixtureEaseRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   The Insights tab.

   Thirteen readings of one squad, which is a great deal to put on a screen
   at once — so they are grouped by the question they answer rather than
   stacked in the order they were built:

     Ladder     one grid, six metrics, week by week
     Shape      where the points come from, and how concentrated
     Outcomes   the range a week can land in, and whether we were right
     Decisions  captain, chip, transfer, price

   Everything reads ONE pass of the engine, built here and handed down. The
   panels are pure functions of that pass, so two of them cannot disagree
   about a player's projection — which they could, and did, when each went
   to the engine on its own.
   ════════════════════════════════════════════════════════════════════════ */

const GROUPS: TabDef[] = [
  { id: 'ladder', label: 'Ladder' },
  { id: 'shape', label: 'Shape' },
  { id: 'outcomes', label: 'Outcomes' },
  { id: 'decisions', label: 'Decisions' },
]

export function SquadAnalysis({
  squad, xi, pool, gws, engine, fixtureEase, diffScale, bank, captain, seasonToDate, playedGws,
}: {
  squad: RatingRow[]
  /** The starting eleven — chips and captaincy are eleven-player questions. */
  xi: RatingRow[]
  pool: RatingRow[]
  gws: number[]
  engine: Engine
  fixtureEase: FixtureEaseRow[]
  /** The site's own fixture-difficulty scale, so the turn map matches Fixtures. */
  diffScale: DiffScale | null
  bank: number
  captain: number | null
  seasonToDate: SeasonRow[] | null
  playedGws: number
}) {
  const [group, setGroup] = useState('ladder')

  const gwKey = gws.join(',')
  const { fixtureEase: fe, avail, model, market, profiles } = engine

  const series = useMemo(
    () => buildSeries(squad, gws, engine),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [squad, gwKey, fe, avail, model, market, profiles],
  )
  const xiElements = useMemo(() => new Set(xi.map((r) => num(r, 'element') ?? -1)), [xi])
  const owned = useMemo(() => new Set(squad.map((r) => num(r, 'element') ?? -1)), [squad])
  const squadTeams = useMemo(() => new Set(squad.map((r) => String(r.team))), [squad])

  if (!gws.length || !series.length) return null

  return (
    <div className="grid gap-4">
      <Tabs tabs={GROUPS} active={group} onChange={setGroup} layoutId="squad-insights" />

      {group === 'ladder' && (
        <SquadLadder squad={squad} gws={gws} pool={pool} engine={engine} />
      )}

      {group === 'shape' && (
        <>
          <Contribution squad={series} gws={gws} />
          <GoalSources squad={series} />
          <DefenceConcentration squad={series} />
          <ClubRisk squad={series} gws={gws} />
        </>
      )}

      {group === 'outcomes' && (
        <>
          <FloorCeiling squad={series} xiElements={xiElements} gws={gws} captain={captain} />
          <MinutesRisk squad={series} />
          <ProjectedVsActual squad={series} seasonToDate={seasonToDate} playedGws={playedGws} />
        </>
      )}

      {group === 'decisions' && (
        <>
          <CaptaincyLadder squad={series} xiElements={xiElements} gws={gws} />
          <CaptaincyVsField squad={series} xiElements={xiElements} pool={pool} gws={gws} engine={engine} gwIndex={0} gw={gws[0]} />
          <ChipWindows squad={series} xiElements={xiElements} gws={gws} />
          <TransferUpside squad={series} pool={pool} gws={gws} engine={engine} bank={bank} />
          <OwnershipSwing squad={series} gwIndex={0} gw={gws[0]} />
          <FixtureTurnMap fixtureEase={fixtureEase} gws={gws} squadTeams={squadTeams} diffScale={diffScale} />
          <PriceWatch owned={owned} />
        </>
      )}
    </div>
  )
}
