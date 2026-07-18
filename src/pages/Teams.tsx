import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader, PageShell, EmptyState } from '../components/PageShell'
import { SortableTable, type Column } from '../components/SortableTable'
import { SearchBox } from '../components/SearchBox'
import { Tabs, type TabDef } from '../components/Tabs'
import { StarRating } from '../components/StarRating'
import { AnimatedCounter } from '../components/AnimatedCounter'
import { TeamBadge } from '../components/badges'
import { PlayerNameCell, PosBadge } from '../components/cells'
import { TeamShotMap } from '../components/ShotMap'
import { PageSkeleton } from '../components/Skeleton'
import { Icon } from '../components/Icon'
import { useCore } from '../lib/useData'
import { num, str, bool } from '../lib/rows'
import { teamFullNames } from '../lib/util'
import type { RatingRow, Row } from '../lib/types'

function Tile({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2.5">
      <div className="font-num text-lg font-semibold tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 text-[11px] tracking-wide text-ink-2 uppercase">{label}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <h3 className="mb-3 text-sm font-semibold tracking-wide text-ink-2 uppercase">{title}</h3>
      {children}
    </section>
  )
}

const pct = (v: number | null) => (v == null ? 'N/A' : `${(v * 100).toFixed(0)}%`)

const TEAM_TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'players', label: 'Players' },
  { id: 'breakdown', label: 'Points Breakdown' },
  { id: 'shots', label: 'Shots' },
]

export default function Teams() {
  const { data } = useCore()
  const [params, setParams] = useSearchParams()
  const selected = params.get('team')

  const teamMetrics = data?.teamMetrics ?? []
  const ratings = (data?.ratings ?? []) as RatingRow[]

  const seasonRows = useMemo(() => teamMetrics.filter((t) => str(t, 'window') === 'season'), [teamMetrics])
  const seasonByTeam = useMemo(() => {
    const m = new Map<string, Row>()
    for (const r of seasonRows) m.set(String(r.team), r)
    return m
  }, [seasonRows])
  const gw4ByTeam = useMemo(() => {
    const m = new Map<string, Row>()
    for (const r of teamMetrics.filter((t) => str(t, 'window') === '4gw')) m.set(String(r.team), r)
    return m
  }, [teamMetrics])

  const selectTeam = (team: string) => {
    setParams(team ? { team } : {})
    window.scrollTo(0, 0)
  }

  if (!data) {
    return (
      <PageShell>
        <PageHeader title="Team Search" subtitle="Search for a team to see their metrics and player ratings" />
        <PageSkeleton />
      </PageShell>
    )
  }

  const searchItems = seasonRows
    .map((r) => String(r.team))
    .sort((a, b) => (teamFullNames[a] || a).localeCompare(teamFullNames[b] || b))

  return (
    <PageShell>
      <PageHeader title="Team Search" subtitle="Search for a team to see their metrics and player ratings" />

      <div className="mb-6">
        <SearchBox
          items={searchItems}
          getLabel={(t) => teamFullNames[t] || t}
          renderItem={(t) => (
            <span className="flex items-center gap-2">
              <TeamBadge team={t} size={18} />
              {teamFullNames[t] || t}
            </span>
          )}
          onSelect={selectTeam}
          placeholder="Search team name…"
          initialValue={selected ? teamFullNames[selected] || selected : ''}
        />
      </div>

      {selected && seasonByTeam.has(selected) ? (
        <TeamCard
          team={selected}
          season={seasonByTeam.get(selected)!}
          gw4={gw4ByTeam.get(selected) ?? null}
          ratings={ratings}
        />
      ) : (
        <AllTeamsTable rows={seasonRows} onSelect={selectTeam} />
      )}
    </PageShell>
  )
}

function AllTeamsTable({ rows, onSelect }: { rows: Row[]; onSelect: (team: string) => void }) {
  const columns: Column<Row>[] = [
    {
      key: 'team',
      header: 'Team',
      align: 'left',
      sortValue: (r) => teamFullNames[String(r.team)] || String(r.team),
      cell: (r) => (
        <span className="flex items-center gap-2 font-medium text-ink">
          <TeamBadge team={String(r.team)} size={20} />
          {teamFullNames[String(r.team)] || String(r.team)}
        </span>
      ),
    },
    { key: 'form', header: 'Form', align: 'left', sortValue: (r) => str(r, 'form_direction'), cell: (r) => <span className="text-xs text-ink-2">{str(r, 'form_direction')}</span> },
    { key: 'cs', header: 'CS Rate', sortValue: (r) => num(r, 'cs_rate'), cell: (r) => <span className="font-num tabular-nums">{pct(num(r, 'cs_rate'))}</span> },
    { key: 'home', header: 'Home PPG', sortValue: (r) => num(r, 'home_pts_per_gw'), cell: (r) => <span className="font-num tabular-nums">{num(r, 'home_pts_per_gw') ?? 'N/A'}</span> },
    { key: 'away', header: 'Away PPG', sortValue: (r) => num(r, 'away_pts_per_gw'), cell: (r) => <span className="font-num tabular-nums">{num(r, 'away_pts_per_gw') ?? 'N/A'}</span> },
    { key: 'top', header: 'Top Player', align: 'left', sortValue: (r) => str(r, 'top1_player'), cell: (r) => <span className="text-accent">{str(r, 'top1_player') || 'N/A'}</span> },
    { key: 'pts', header: 'Season Pts', sortValue: (r) => num(r, 'total_pts'), cell: (r) => <span className="font-num font-semibold tabular-nums text-accent">{Math.round(num(r, 'total_pts') ?? 0)}</span> },
  ]
  return (
    <>
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-2 uppercase">All Teams</h2>
      <SortableTable rows={rows} columns={columns} initialSort="pts" initialDir="desc" rowKey={(r) => String(r.team)} onRowClick={(r) => onSelect(String(r.team))} />
    </>
  )
}

function TeamCard({ team, season, gw4, ratings }: { team: string; season: Row; gw4: Row | null; ratings: RatingRow[] }) {
  const [tab, setTab] = useState('overview')
  const teamPlayers = useMemo(
    () => ratings.filter((p) => p.team === team && bool(p, 'season_ok')).sort((a, b) => (num(b, 'season_overall_score') ?? 0) - (num(a, 'season_overall_score') ?? 0)),
    [ratings, team],
  )
  const totalPts = num(season, 'total_pts') ?? 0

  return (
    <div className="rounded-xl border border-line bg-surface-1/50 p-5 md:p-6">
      <div className="mb-5 flex items-center gap-4">
        <TeamBadge team={team} size={56} />
        <div className="text-2xl font-extrabold tracking-tight text-ink">{teamFullNames[team] || team}</div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
        <Tile value={<AnimatedCounter value={totalPts} />} label="Season Pts" />
        <Tile value={<AnimatedCounter value={(num(season, 'cs_rate') ?? 0) * 100} suffix="%" />} label="CS Rate" />
        <Tile value={num(season, 'home_pts_per_gw') ?? '—'} label="Home PPG" />
        <Tile value={num(season, 'away_pts_per_gw') ?? '—'} label="Away PPG" />
        <Tile value={<span className="text-sm">{str(season, 'form_direction') || '—'}</span>} label="Form" />
        <Tile value={<span className="text-sm">{str(season, 'top1_player') || '—'}</span>} label="Top Scorer" />
      </div>

      <div className="mb-5">
        <Tabs tabs={TEAM_TABS} active={tab} onChange={setTab} layoutId={`team-${team}`} />
      </div>

      {tab === 'overview' && (
        <div>
          <Section title="Season Points Breakdown">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
              <Tile value={pct(num(season, 'goal_pts_pct'))} label="From Goals" />
              <Tile value={pct(num(season, 'assist_pts_pct'))} label="From Assists" />
              <Tile value={pct(num(season, 'cs_pts_pct'))} label="From Clean Sheets" />
              <Tile value={`${num(season, 'dc_pts') ? (((num(season, 'dc_pts') ?? 0) / totalPts) * 100).toFixed(0) : 0}%`} label="From Def Contributions" />
              <Tile value={pct(num(season, 'bonus_pts_pct'))} label="From Bonus" />
            </div>
          </Section>
          <Section title="Points by Position">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile value={pct(num(season, 'gkp_pct'))} label="GKP" />
              <Tile value={pct(num(season, 'def_pct'))} label="DEF" />
              <Tile value={pct(num(season, 'mid_pct'))} label="MID" />
              <Tile value={pct(num(season, 'fwd_pct'))} label="FWD" />
            </div>
          </Section>
          <Section title="Concentration Risk">
            <div className="grid grid-cols-2 gap-2">
              <Tile value={pct(num(season, 'top1_share'))} label="Top Player Share" />
              <Tile value={pct(num(season, 'top3_share'))} label="Top 3 Share" />
            </div>
            <div className="mt-3">
              {[...teamPlayers].sort((a, b) => (num(b, 'season_ppg') ?? 0) - (num(a, 'season_ppg') ?? 0)).slice(0, 3).map((p, i) => {
                const ppg = num(p, 'season_ppg')
                const mins = num(p, 'total_mins')
                const share = ppg && mins ? (((ppg * (mins / 90)) / totalPts) * 100).toFixed(1) : 'N/A'
                return (
                  <div key={String(p.element)} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
                    <span className="w-6 text-xs text-ink-3">#{i + 1}</span>
                    <span className="flex-1"><PlayerNameCell name={String(p.web_name)} /></span>
                    <span className="hidden font-num text-xs tabular-nums text-ink-2 sm:inline">{share}% of team pts</span>
                    <span className="font-num text-sm tabular-nums text-accent">{ppg ? ppg.toFixed(1) : 'N/A'} ppg</span>
                    <StarRating value={str(p, 'season_overall_rating')} size={11} showNum={false} />
                  </div>
                )
              })}
            </div>
          </Section>
          {gw4 && (
            <Section title="Last 4GW Form">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Tile value={Math.round(num(gw4, 'total_pts') ?? 0)} label="Total Pts" />
                <Tile value={pct(num(gw4, 'cs_rate'))} label="CS Rate" />
                <Tile value={<span className="text-sm">{str(gw4, 'form_direction') || '—'}</span>} label="Form" />
              </div>
            </Section>
          )}
        </div>
      )}

      {tab === 'players' && (
        <SortableTable
          rows={teamPlayers}
          columns={[
            { key: 'player', header: 'Player', align: 'left', sortValue: (r) => str(r, 'web_name'), cell: (r) => <PlayerNameCell name={String(r.web_name)} /> },
            { key: 'pos', header: 'Pos', align: 'left', sortValue: (r) => str(r, 'position'), cell: (r) => <PosBadge pos={String(r.position)} /> },
            { key: 'season', header: 'Season Rating', align: 'left', sortValue: (r) => num(r, 'season_overall_score'), cell: (r) => <StarRating value={str(r, 'season_overall_rating')} /> },
            { key: 'gw4', header: '4GW Rating', align: 'left', sortValue: (r) => str(r, 'gw4_overall_rating'), cell: (r) => <StarRating value={str(r, 'gw4_overall_rating')} /> },
            { key: 'next4', header: 'Next 4GW', align: 'left', sortValue: (r) => str(r, 'next4_overall_rating'), cell: (r) => <StarRating value={str(r, 'next4_overall_rating')} /> },
            { key: 'ppg', header: 'PPG', sortValue: (r) => num(r, 'season_ppg'), cell: (r) => <span className="font-num tabular-nums text-accent">{num(r, 'season_ppg')?.toFixed(1) ?? 'N/A'}</span> },
          ]}
          initialSort="season"
          initialDir="desc"
          rowKey={(r) => String(r.element)}
        />
      )}

      {tab === 'breakdown' && (
        <Section title="xG and xGC">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Tile value={num(season, 'team_xg') != null ? Number(num(season, 'team_xg')).toFixed(1) : 'N/A'} label="Season xG" />
            <Tile value={num(season, 'team_xa') != null ? Number(num(season, 'team_xa')).toFixed(1) : 'N/A'} label="Season xA" />
            <Tile value={num(season, 'team_xgc') != null ? Number(num(season, 'team_xgc')).toFixed(1) : 'N/A'} label="Season xGC" />
          </div>
        </Section>
      )}

      {tab === 'shots' && (
        <Section title="Shot Map">
          <TeamShotMap team={team} />
        </Section>
      )}
    </div>
  )
}

// Referenced by other pages' deep links; keeps an obvious empty fallback.
export function TeamNotFound() {
  return <EmptyState icon={<Icon name="pitch" size={44} />}>Search for a team to see their analysis</EmptyState>
}
