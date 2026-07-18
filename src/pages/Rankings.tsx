import { useMemo, useState } from 'react'
import { PageHeader, PageShell } from '../components/PageShell'
import { Tabs, PillGroup, type TabDef } from '../components/Tabs'
import { SortableTable, type Column } from '../components/SortableTable'
import { StarRating } from '../components/StarRating'
import { MiniBar } from '../components/viz'
import { PlayerNameCell, PosBadge, TeamCell } from '../components/cells'
import { InfoTip } from '../components/InfoTip'
import { Icon } from '../components/Icon'
import { PageSkeleton } from '../components/Skeleton'
import { EmptyState } from '../components/PageShell'
import { useCore } from '../lib/useData'
import { num, str, bool } from '../lib/rows'
import { ratingToNum, TOOLTIPS } from '../lib/util'
import type { RatingRow, Row } from '../lib/types'

const TABS: TabDef[] = [
  { id: 'top-rated', label: 'Top Rated', icon: <Icon name="star" size={13} /> },
  { id: 'goal-threats', label: 'Goal Threats', icon: <Icon name="target" size={13} /> },
  { id: 'creators', label: 'Creators', icon: <Icon name="bolt" size={13} /> },
  { id: 'clean-sheets', label: 'Clean Sheets', icon: <Icon name="shield" size={13} /> },
  { id: 'value', label: 'Value Picks', icon: <Icon name="coin" size={13} /> },
  { id: 'form', label: 'Form', icon: <span className="text-hot"><Icon name="flame" size={13} solid /></span> },
  { id: 'next4', label: 'Next 4 GWs', icon: <Icon name="calendar" size={13} /> },
]

const TOP_N = 30

// # column: static rank from the tab's default metric order. Sorting by it
// (ascending, the table default) reproduces that metric ranking exactly.
function rankCol(): Column<Row> {
  return {
    key: 'rank',
    header: '#',
    align: 'left',
    tip: "Position in this ranking, ordered by the tab's headline metric.",
    sortValue: (r) => num(r, '_rank'),
    cell: (r) => <span className="font-num text-ink-3 tabular-nums">{num(r, '_rank')}</span>,
  }
}
const playerCol: Column<Row> = {
  key: 'player',
  header: 'Player',
  align: 'left',
  sortValue: (r) => str(r, 'web_name'),
  cell: (r) => <PlayerNameCell name={String(r.web_name)} />,
}
const posCol: Column<Row> = {
  key: 'pos',
  header: 'Pos',
  align: 'left',
  sortValue: (r) => str(r, 'position'),
  cell: (r) => <PosBadge pos={String(r.position)} />,
}
const teamCol: Column<Row> = {
  key: 'team',
  header: 'Team',
  align: 'left',
  sortValue: (r) => str(r, 'team'),
  cell: (r) => <TeamCell team={String(r.team)} />,
}
const priceCol: Column<Row> = {
  key: 'price',
  header: 'Price',
  tip: 'Current FPL price.',
  sortValue: (r) => num(r, 'price'),
  cell: (r) => <span className="font-num tabular-nums">£{num(r, 'price')}m</span>,
}
const starCol = (key: string, header: string, tip?: string): Column<Row> => ({
  key,
  header,
  tip,
  align: 'left',
  sortValue: (r) => ratingToNum(str(r, key)), // sort by numeric rating; null (N/A) sinks
  cell: (r) => <StarRating value={str(r, key)} />,
})
// Overall ratings render from the continuous 0–5 score for a granular /100 number.
const scoreCol = (scoreKey: string, header: string, tip?: string): Column<Row> => ({
  key: scoreKey,
  header,
  tip,
  align: 'left',
  sortValue: (r) => num(r, scoreKey),
  cell: (r) => <StarRating value={num(r, scoreKey)} />,
})
// Like scoreCol, but shows an explained N/A when the window has too few minutes.
const windowScoreCol = (scoreKey: string, header: string, tip?: string): Column<Row> => ({
  key: scoreKey,
  header,
  tip,
  align: 'left',
  sortValue: (r) => num(r, scoreKey),
  cell: (r) =>
    num(r, scoreKey) == null ? (
      <span className="inline-flex items-center gap-1 text-ink-3">N/A<InfoTip text="Not enough minutes in the last 4 gameweeks to produce a rating." /></span>
    ) : (
      <StarRating value={num(r, scoreKey)} />
    ),
})
function ppgCol(rows: Row[]): Column<Row> {
  const maxPpg = Math.max(...rows.map((p) => num(p, 'season_ppg') ?? 0), 1)
  return {
    key: 'ppg',
    header: 'PPG',
    tip: 'Average FPL points per game this season.',
    sortValue: (r) => num(r, 'season_ppg'),
    cell: (r) => {
      const v = num(r, 'season_ppg')
      return v == null ? <span className="text-ink-3">N/A</span> : <MiniBar value={+v.toFixed(1)} max={maxPpg} />
    },
  }
}

/** Rank rows by a numeric metric, take the top N, annotate a static _rank. */
function ranked(rows: Row[], metricKey: string): Row[] {
  return [...rows]
    .sort((a, b) => (num(b, metricKey) ?? 0) - (num(a, metricKey) ?? 0))
    .slice(0, TOP_N)
    .map((r, i) => ({ ...r, _rank: i + 1 }))
}

interface TabView {
  narrative?: React.ReactNode
  columns: Column<Row>[]
  rows: Row[]
}

export default function Rankings() {
  const { data } = useCore()
  const [tab, setTab] = useState('top-rated')
  const [pos, setPos] = useState('ALL')

  const ratings = (data?.ratings ?? []) as RatingRow[]
  const metrics = data?.metrics ?? []
  const seasonToDate = data?.seasonToDate ?? []

  const metricByName = useMemo(() => {
    const m = new Map<string, Row>()
    for (const row of metrics) m.set(String(row.web_name), row)
    return m
  }, [metrics])

  // Position filter options depend on the tab (att-only tabs hide GKP/DEF; def-only hides MID/FWD).
  const isAttOnly = tab === 'goal-threats' || tab === 'creators'
  const isDefOnly = tab === 'clean-sheets'
  const posOptions = useMemo(() => {
    const all = [{ id: 'ALL', label: 'All' }]
    if (!isAttOnly) all.push({ id: 'GKP', label: 'GKP' }, { id: 'DEF', label: 'DEF' })
    if (!isDefOnly) all.push({ id: 'MID', label: 'MID' }, { id: 'FWD', label: 'FWD' })
    return all
  }, [isAttOnly, isDefOnly])

  const view: TabView | null = useMemo(() => {
    const seasonOk = ratings.filter((p) => bool(p, 'season_ok'))
    const applyPos = (rows: Row[]) => (pos === 'ALL' ? rows : rows.filter((p) => p.position === pos))

    const shareCol = (key: string, header: string, tip?: string): Column<Row> => ({
      key,
      header,
      tip,
      sortValue: (r) => num(metricByName.get(String(r.web_name)) ?? {}, key),
      cell: (r) => {
        const v = num(metricByName.get(String(r.web_name)) ?? {}, key)
        return <span className="font-num tabular-nums">{v == null ? 'N/A' : `${(v * 100).toFixed(1)}%`}</span>
      },
    })

    switch (tab) {
      case 'top-rated': {
        const rows = ranked(applyPos(seasonOk), 'season_overall_score')
        return {
          columns: [
            rankCol(),
            playerCol,
            posCol,
            teamCol,
            priceCol,
            scoreCol('season_overall_score', 'Season Rating', TOOLTIPS.overall as string),
            windowScoreCol('gw4_overall_score', '4GW Rating', 'The same composite rating measured over the last 4 gameweeks only — a form snapshot.'),
            ppgCol(rows),
          ],
          rows,
        }
      }
      case 'goal-threats': {
        const att = seasonOk.filter((p) => p.position === 'MID' || p.position === 'FWD')
        const filtered = pos === 'MID' || pos === 'FWD' ? att.filter((p) => p.position === pos) : att
        const rows = ranked(filtered, 'season_goal_score')
        return {
          columns: [
            rankCol(),
            playerCol,
            posCol,
            teamCol,
            starCol('season_goal_score_rating', 'Goal Rating (Pos)', TOOLTIPS.goal as string),
            starCol('season_att_goal_score_rating', 'Goal Rating (ATT)', 'The same goal-threat rating, but ranked against all midfielders and forwards pooled together.'),
            shareCol('xg_share_4gw', 'xG Share 4GW', "Share of their team's expected goals over the last 4 gameweeks."),
            shareCol('xg_share_season', 'xG Share Season', "Share of their team's expected goals across the whole season."),
          ],
          rows,
        }
      }
      case 'creators': {
        const att = seasonOk.filter((p) => p.position === 'MID' || p.position === 'FWD')
        const filtered = pos === 'MID' || pos === 'FWD' ? att.filter((p) => p.position === pos) : att
        const rows = ranked(filtered, 'season_creative_score')
        return {
          columns: [
            rankCol(),
            playerCol,
            posCol,
            teamCol,
            starCol('season_creative_score_rating', 'Creative Rating (Pos)', TOOLTIPS.creative as string),
            starCol('season_att_creative_score_rating', 'Creative Rating (ATT)', 'The same creativity rating, but ranked against all midfielders and forwards pooled together.'),
            shareCol('xa_share_4gw', 'xA Share 4GW', "Share of their team's expected assists over the last 4 gameweeks."),
            shareCol('xa_share_season', 'xA Share Season', "Share of their team's expected assists across the whole season."),
          ],
          rows,
        }
      }
      case 'clean-sheets': {
        const def = seasonOk.filter((p) => p.position === 'GKP' || p.position === 'DEF')
        const filtered = pos === 'GKP' || pos === 'DEF' ? def.filter((p) => p.position === pos) : def
        const rows = ranked(filtered, 'season_cs_score')
        return {
          columns: [
            rankCol(),
            playerCol,
            posCol,
            teamCol,
            starCol('season_cs_score_rating', 'CS Rating', TOOLTIPS.cs as string),
            scoreCol('season_overall_score', 'Overall Rating', TOOLTIPS.overall as string),
          ],
          rows,
        }
      }
      case 'value': {
        const rows = ranked(applyPos(seasonOk), 'season_value_score')
        return {
          columns: [
            rankCol(),
            playerCol,
            posCol,
            teamCol,
            priceCol,
            starCol('season_value_score_rating', 'Value Rating', TOOLTIPS.value as string),
            ppgCol(rows),
          ],
          rows,
        }
      }
      case 'next4': {
        const rated = applyPos(seasonOk).filter((p) => num(p, 'next4_score') != null)
        if (!rated.length) return null
        const rows = ranked(rated, 'next4_score')
        return {
          columns: [
            rankCol(),
            playerCol,
            posCol,
            teamCol,
            starCol('next4_overall_rating', 'Next 4GW Rating', TOOLTIPS.next4 as string),
            {
              key: 'ease',
              header: 'Fixture Ease',
              tip: 'Opponent-difficulty multiplier over the next 4 gameweeks. Above ×1.00 = an easier-than-average run.',
              sortValue: (r) => num(r, 'next4_fixture_factor'),
              cell: (r) => {
                const f = num(r, 'next4_fixture_factor')
                if (f == null) return <span className="text-ink-3">N/A</span>
                return <span className={`font-num tabular-nums ${f >= 1 ? 'text-good' : 'text-bad'}`}>×{f.toFixed(2)}</span>
              },
            },
            scoreCol('season_overall_score', 'Season Rating', TOOLTIPS.overall as string),
            scoreCol('gw4_overall_score', '4GW Rating', 'The same composite rating measured over the last 4 gameweeks only — a form snapshot.'),
          ],
          rows,
        }
      }
      default:
        return null
    }
  }, [tab, pos, ratings, metricByName])

  // Per-tab narrative lead line.
  const narrative = useMemo(() => buildNarrative(tab, ratings, metrics, seasonToDate), [tab, ratings, metrics, seasonToDate])

  if (!data) {
    return (
      <PageShell>
        <PageHeader title="Rankings" subtitle="Top players across all metrics" />
        <PageSkeleton />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader title="Rankings" subtitle="Top players across all metrics" />
      {/* Desktop: tab strip. Mobile: a reliable native dropdown (tabs were
          hard to reach in a horizontal scroller on a phone). */}
      <div className="mb-4 hidden md:block">
        <Tabs
          tabs={TABS}
          active={tab}
          onChange={(id) => {
            setTab(id)
            setPos('ALL')
          }}
        />
      </div>
      <div className="mb-4 md:hidden">
        <label className="mb-1.5 block text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Ranking</label>
        <select
          value={tab}
          onChange={(e) => { setTab(e.target.value); setPos('ALL') }}
          className="min-h-11 w-full rounded-lg border border-line-mid bg-surface-1 px-3 text-base text-ink"
        >
          {TABS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>

      {narrative && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-surface-1 px-4 py-3 text-sm text-ink-2">
          <span className="mt-0.5 text-accent">
            <Icon name="bolt" size={14} />
          </span>
          <span>{narrative}</span>
        </div>
      )}

      <div className="mb-4">
        <PillGroup options={posOptions} active={pos} onChange={setPos} />
      </div>

      {tab === 'form' ? (
        <FormTables rows={seasonToDate} pos={pos} />
      ) : view ? (
        <SortableTable
          rows={view.rows}
          columns={view.columns}
          initialSort="rank"
          initialDir="asc"
          rowKey={(r) => String(r.element)}
          featured
        />
      ) : (
        <EmptyState icon={<Icon name="calendar" size={44} />}>
          Next 4 GW ratings aren't available yet — they appear once upcoming fixtures exist for the season.
        </EmptyState>
      )}
    </PageShell>
  )
}

function FormTables({ rows, pos }: { rows: Row[]; pos: string }) {
  const posFilter = (r: Row) => pos === 'ALL' || r.position === pos
  const hot = rows
    .filter((p) => str(p, 'streak') === '🔥 Hot' && posFilter(p))
    .sort((a, b) => (num(b, 'pts_delta') ?? 0) - (num(a, 'pts_delta') ?? 0))
    .slice(0, 15)
  const cold = rows
    .filter((p) => str(p, 'streak') === '🧊 Cold' && posFilter(p))
    .sort((a, b) => (num(a, 'pts_delta') ?? 0) - (num(b, 'pts_delta') ?? 0))
    .slice(0, 15)

  const th = (label: string, tip: string, right = true) => (
    <th className={`px-2.5 py-2 font-semibold md:px-3 ${right ? 'text-right' : 'text-left'}`}>
      <span className={`inline-flex items-center gap-1 ${right ? 'flex-row-reverse' : ''}`}>
        {label}
        <InfoTip text={tip} />
      </span>
    </th>
  )

  const table = (title: React.ReactNode, list: Row[], deltaClass: string, sign: boolean) => (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-ink">{title}</div>
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-[13px] md:text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-ink-2">
              <th className="px-2.5 py-2 text-left font-semibold md:px-3">Player</th>
              <th className="px-2.5 py-2 text-left font-semibold md:px-3">Team</th>
              <th className="px-2.5 py-2 text-left font-semibold md:px-3">Pos</th>
              {th('Season P90', 'Average FPL points per 90 minutes across the whole season.')}
              {th('4GW P90', 'Average FPL points per 90 minutes over the last 4 gameweeks.')}
              {th('Delta', 'Last-4-gameweek points-per-90 minus the season baseline — the size of the streak.')}
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr key={String(p.element)} className="border-b border-line/60 last:border-0">
                <td className="px-2.5 py-2 md:px-3">
                  <PlayerNameCell name={String(p.web_name)} />
                </td>
                <td className="px-2.5 py-2 md:px-3">
                  <TeamCell team={String(p.team)} />
                </td>
                <td className="px-2.5 py-2 md:px-3">
                  <PosBadge pos={String(p.position)} />
                </td>
                <td className="px-2.5 py-2 text-right font-num tabular-nums md:px-3">
                  {(num(p, 'pts_per90_season') ?? 0).toFixed(2)}
                </td>
                <td className="px-2.5 py-2 text-right font-num tabular-nums md:px-3">
                  {(num(p, 'pts_per90_4gw') ?? 0).toFixed(2)}
                </td>
                <td className={`px-2.5 py-2 text-right font-num tabular-nums md:px-3 ${deltaClass}`}>
                  {sign ? '+' : ''}
                  {(num(p, 'pts_delta') ?? 0).toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      {table(
        <>
          <span className="text-hot"><Icon name="flame" size={13} solid /></span> Hot Streak Players
        </>,
        hot,
        'text-hot',
        true,
      )}
      {table(
        <>
          <span className="text-cold"><Icon name="snow" size={13} /></span> Cold Streak Players
        </>,
        cold,
        'text-cold',
        false,
      )}
    </div>
  )
}

function buildNarrative(tab: string, ratings: RatingRow[], metrics: Row[], seasonToDate: Row[]): React.ReactNode {
  const rated = ratings.filter((p) => bool(p, 'season_ok'))
  const lead = (arr: Row[]) => (arr.length ? arr[0] : null)
  const metricOf = (name: string) => metrics.find((x) => x.web_name === name)
  const b = (s: string) => <strong className="text-ink">{s}</strong>

  switch (tab) {
    case 'top-rated': {
      const p = lead([...rated].sort((a, b) => (num(b, 'season_overall_score') ?? 0) - (num(a, 'season_overall_score') ?? 0)))
      if (!p) return null
      const ppg = num(p, 'season_ppg')
      return (
        <>
          {b(String(p.web_name))} leads the overall ratings — {ppg ? `${ppg.toFixed(1)} points per game` : 'the strongest all-round profile'} at £{p.price}m. Ratings blend output, consistency and reliability within each position.
        </>
      )
    }
    case 'goal-threats': {
      const p = lead(rated.filter((x) => x.position === 'MID' || x.position === 'FWD').sort((a, b) => (num(b, 'season_goal_score') ?? 0) - (num(a, 'season_goal_score') ?? 0)))
      if (!p) return null
      const m = metricOf(String(p.web_name))
      const share = m && num(m, 'xg_share_season')
      return (
        <>
          {b(String(p.web_name))} is the league's biggest goal threat{share ? <> — taking {b(`${(share * 100).toFixed(0)}%`)} of {p.team}'s xG</> : ''}. Sustainable threat comes from box shots, not long-range volume.
        </>
      )
    }
    case 'creators': {
      const p = lead(rated.filter((x) => x.position === 'MID' || x.position === 'FWD').sort((a, b) => (num(b, 'season_creative_score') ?? 0) - (num(a, 'season_creative_score') ?? 0)))
      if (!p) return null
      const m = metricOf(String(p.web_name))
      const share = m && num(m, 'xa_share_season')
      return (
        <>
          {b(String(p.web_name))} creates more than anyone{share ? <> — {b(`${(share * 100).toFixed(0)}%`)} of {p.team}'s xA runs through them</> : ''}. Assist points follow chance creation.
        </>
      )
    }
    case 'clean-sheets': {
      const p = lead(rated.filter((x) => x.position === 'GKP' || x.position === 'DEF').sort((a, b) => (num(b, 'season_cs_score') ?? 0) - (num(a, 'season_cs_score') ?? 0)))
      if (!p) return null
      return (
        <>
          {b(String(p.web_name))} anchors the strongest defensive numbers in the league. Clean-sheet ratings weigh xGC, not just results — they find defences that deserve their record.
        </>
      )
    }
    case 'value': {
      const p = lead([...rated].sort((a, b) => (num(b, 'season_value_score') ?? 0) - (num(a, 'season_value_score') ?? 0)))
      if (!p) return null
      return (
        <>
          {b(String(p.web_name))} is the best points-per-pound in the game at £{p.price}m. Value picks free up budget for premiums elsewhere.
        </>
      )
    }
    case 'form': {
      const p = lead(seasonToDate.filter((x) => str(x, 'streak') === '🔥 Hot').sort((a, b) => (num(b, 'pts_delta') ?? 0) - (num(a, 'pts_delta') ?? 0)))
      if (!p) return null
      return (
        <>
          {b(String(p.web_name))} is the hottest player right now — {b(`+${(num(p, 'pts_delta') ?? 0).toFixed(1)} pts/90`)} above their season baseline. Check the xGI before chasing: form backed by underlying numbers sticks.
        </>
      )
    }
    case 'next4': {
      const p = lead(rated.filter((x) => num(x, 'next4_score') != null).sort((a, b) => (num(b, 'next4_score') ?? 0) - (num(a, 'next4_score') ?? 0)))
      if (!p) return null
      return (
        <>
          {b(String(p.web_name))} tops the fixture-adjusted model for the next 4 gameweeks — quality and form weighted by how attackable the upcoming opponents are.
        </>
      )
    }
    default:
      return null
  }
}
