import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader, PageShell, EmptyState } from '../components/PageShell'
import { SortableTable, type Column } from '../components/SortableTable'
import { SearchBox } from '../components/SearchBox'
import { Tabs, type TabDef } from '../components/Tabs'
import { StarRating } from '../components/StarRating'
import { AnimatedCounter } from '../components/AnimatedCounter'
import { Donut, CHART_COLORS, RatingNumber, ConcentrationBar, scoreTone, SCORE_TEXT } from '../components/viz'
import { TeamBadge } from '../components/badges'
import { PlayerNameCell, PosBadge } from '../components/cells'
import { FixtureChips } from '../components/FixtureChips'
import { TeamShotMap } from '../components/ShotMap'
import { PageSkeleton } from '../components/Skeleton'
import { Icon } from '../components/Icon'
import { useCore } from '../lib/useData'
import { num, str, bool } from '../lib/rows'
import { teamFullNames } from '../lib/util'
import type { FixtureEaseRow, RatingRow, Row, TeamRatingRow } from '../lib/types'

function Tile({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2.5">
      <div className="font-num text-lg font-semibold tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 text-[11px] tracking-wide text-ink-2 uppercase">{label}</div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-wide text-ink-2 uppercase">{title}</h3>
        {hint && <span className="text-[11px] text-ink-3">{hint}</span>}
      </div>
      {children}
    </section>
  )
}

const pct = (v: number | null) => (v == null ? 'N/A' : `${(v * 100).toFixed(0)}%`)
const fx1 = (v: number | null) => (v == null ? 'N/A' : Number(v).toFixed(1))

type WinId = 'season' | '6gw' | '4gw'
const WINDOWS: { id: WinId; label: string }[] = [
  { id: 'season', label: 'Season' },
  { id: '6gw', label: 'Last 6' },
  { id: '4gw', label: 'Last 4' },
]

export default function Teams() {
  const { data, error: coreError } = useCore()
  const [params, setParams] = useSearchParams()
  const selected = params.get('team')

  const teamMetrics = data?.teamMetrics ?? []
  const teamRatings = (data?.teamRatings ?? []) as TeamRatingRow[]
  const ratings = (data?.ratings ?? []) as RatingRow[]
  const fixtureEase = (data?.fixtureEase ?? []) as FixtureEaseRow[]

  const seasonRows = useMemo(() => teamMetrics.filter((t) => str(t, 'window') === 'season'), [teamMetrics])
  const seasonByTeam = useMemo(() => {
    const m = new Map<string, Row>()
    for (const r of seasonRows) m.set(String(r.team), r)
    return m
  }, [seasonRows])
  const ratingByTeam = useMemo(() => {
    const m = new Map<string, TeamRatingRow>()
    for (const r of teamRatings) if (r.window === 'season') m.set(r.team, r)
    return m
  }, [teamRatings])

  const selectTeam = (team: string) => {
    setParams(team ? { team } : {})
    window.scrollTo(0, 0)
  }

  if (!data) {
    return (
      <PageShell>
        <PageHeader title="Team Search" subtitle="Search for a team to see their metrics and player ratings" />
        <PageSkeleton error={coreError} />
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
          metricRows={teamMetrics.filter((t) => String(t.team) === selected)}
          ratingRows={teamRatings.filter((t) => t.team === selected)}
          ratings={ratings}
          fixtureEase={fixtureEase}
        />
      ) : (
        <AllTeamsTable rows={seasonRows} ratingByTeam={ratingByTeam} onSelect={selectTeam} />
      )}
    </PageShell>
  )
}

function RatingCell({ score }: { score: number | null }) {
  if (score == null) return <span className="text-ink-3">—</span>
  const r = Math.round(score)
  return <span className={`font-num font-semibold tabular-nums ${SCORE_TEXT[scoreTone(r)]}`}>{r}</span>
}

/** Signed value coloured by direction (good = green, bad = red). */
function DeltaCell({ value, digits = 1 }: { value: number | null; digits?: number }) {
  if (value == null) return <span className="text-ink-3">—</span>
  const tone = value > 0.05 ? 'text-good' : value < -0.05 ? 'text-bad' : 'text-ink-2'
  const sign = value > 0 ? '+' : ''
  return <span className={`font-num tabular-nums ${tone}`}>{sign}{value.toFixed(digits)}</span>
}

const TEAM_LIST_TABS: TabDef[] = [
  { id: 'attack', label: 'Attack' },
  { id: 'defence', label: 'Defence' },
]

const teamCell = (r: Row): ReactNode => (
  <span className="flex items-center gap-2 font-medium text-ink">
    <TeamBadge team={String(r.team)} size={20} />
    {teamFullNames[String(r.team)] || String(r.team)}
  </span>
)
const teamSort = (r: Row) => teamFullNames[String(r.team)] || String(r.team)
const fx = (v: number | null, d = 1) => (v == null ? 'N/A' : Number(v).toFixed(d))

function AllTeamsTable({
  rows,
  ratingByTeam,
  onSelect,
}: {
  rows: Row[]
  ratingByTeam: Map<string, TeamRatingRow>
  onSelect: (team: string) => void
}) {
  const [tab, setTab] = useState<'attack' | 'defence'>('attack')
  const rt = (r: Row) => ratingByTeam.get(String(r.team))

  // Finishing / prevention carry a dataset-wide xG↔goal offset, so present them
  // relative to the league mean (centred at 0 = league-average conversion).
  const { meanFinish, meanPrevent } = useMemo(() => {
    const vals = [...ratingByTeam.values()]
    const avg = (xs: (number | null)[]) => {
      const ns = xs.filter((v): v is number => v != null)
      return ns.length ? ns.reduce((a, b) => a + b, 0) / ns.length : 0
    }
    return { meanFinish: avg(vals.map((v) => v.finish_delta)), meanPrevent: avg(vals.map((v) => v.xgc_prevented)) }
  }, [ratingByTeam])

  const attackCols: Column<Row>[] = [
    { key: 'team', header: 'Team', align: 'left', sortValue: teamSort, cell: teamCell },
    { key: 'att', header: 'ATT', sortValue: (r) => rt(r)?.attack ?? -1, cell: (r) => <RatingCell score={rt(r)?.attack ?? null} /> },
    { key: 'xg', header: 'xG', sortValue: (r) => num(r, 'team_xg'), cell: (r) => <span className="font-num tabular-nums">{fx(num(r, 'team_xg'))}</span> },
    { key: 'xa', header: 'xA', sortValue: (r) => num(r, 'team_xa'), cell: (r) => <span className="font-num tabular-nums">{fx(num(r, 'team_xa'))}</span> },
    { key: 'finish', header: 'Finish Δ', sortValue: (r) => { const v = rt(r)?.finish_delta; return v == null ? -999 : v - meanFinish }, cell: (r) => { const v = rt(r)?.finish_delta; return <DeltaCell value={v == null ? null : v - meanFinish} /> } },
    { key: 'box', header: 'Box %', sortValue: (r) => rt(r)?.box_share ?? -1, cell: (r) => { const v = rt(r)?.box_share; return <span className="font-num tabular-nums">{v == null ? 'N/A' : `${Math.round(v * 100)}%`}</span> } },
    { key: 'sp', header: 'Set-piece', sortValue: (r) => rt(r)?.set_piece_share ?? -1, cell: (r) => { const rr = rt(r); if (!rr || rr.set_piece_share == null) return <span className="text-ink-3">—</span>; return <span className={`font-num tabular-nums ${rr.set_piece_threat ? 'font-semibold text-warn' : 'text-ink-2'}`}>{Math.round(rr.set_piece_share * 100)}%</span> } },
  ]

  const defenceCols: Column<Row>[] = [
    { key: 'team', header: 'Team', align: 'left', sortValue: teamSort, cell: teamCell },
    { key: 'def', header: 'DEF', sortValue: (r) => rt(r)?.defence ?? -1, cell: (r) => <RatingCell score={rt(r)?.defence ?? null} /> },
    { key: 'xgc', header: 'xGC', sortValue: (r) => num(r, 'team_xgc'), cell: (r) => <span className="font-num tabular-nums">{fx(num(r, 'team_xgc'))}</span> },
    { key: 'cs', header: 'CS %', sortValue: (r) => num(r, 'cs_rate'), cell: (r) => <span className="font-num tabular-nums">{pct(num(r, 'cs_rate'))}</span> },
    { key: 'prevent', header: 'Prevent Δ', sortValue: (r) => { const v = rt(r)?.xgc_prevented; return v == null ? -999 : v - meanPrevent }, cell: (r) => { const v = rt(r)?.xgc_prevented; return <DeltaCell value={v == null ? null : v - meanPrevent} /> } },
    { key: 'boxc', header: 'Box % Con', sortValue: (r) => rt(r)?.box_share_conceded ?? -1, cell: (r) => { const v = rt(r)?.box_share_conceded; return <span className="font-num tabular-nums">{v == null ? 'N/A' : `${Math.round(v * 100)}%`}</span> } },
  ]

  const isAttack = tab === 'attack'
  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-ink-2 uppercase">All Teams</h2>
        <Tabs tabs={TEAM_LIST_TABS} active={tab} onChange={(id) => setTab(id as 'attack' | 'defence')} layoutId="team-list" />
      </div>
      <SortableTable
        key={tab}
        rows={rows}
        columns={isAttack ? attackCols : defenceCols}
        initialSort={isAttack ? 'att' : 'def'}
        initialDir="desc"
        rowKey={(r) => String(r.team)}
        onRowClick={(r) => onSelect(String(r.team))}
      />
    </>
  )
}

/** Home vs Away points-per-GW as two bars sharing a scale, with the swing. */
function HomeAwayBar({ home, away }: { home: number | null; away: number | null }) {
  if (home == null && away == null) return <span className="text-sm text-ink-3">No home/away split</span>
  const max = Math.max(home ?? 0, away ?? 0, 0.1)
  const diff = (home ?? 0) - (away ?? 0)
  const Row = ({ label, v, tone }: { label: string; v: number | null; tone: string }) => (
    <div className="flex items-center gap-2">
      <span className="w-10 text-[11px] text-ink-3 uppercase">{label}</span>
      <span className="font-num w-8 text-sm tabular-nums text-ink">{v == null ? '—' : v.toFixed(1)}</span>
      <span className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-surface-3">
        <span className="block h-full rounded-full" style={{ width: `${((v ?? 0) / max) * 100}%`, background: tone }} />
      </span>
    </div>
  )
  return (
    <div className="space-y-2">
      <Row label="Home" v={home} tone="var(--good)" />
      <Row label="Away" v={away} tone="var(--info)" />
      <div className="text-[11px] text-ink-3">
        {Math.abs(diff) < 0.05 ? 'Even home & away' : `${diff > 0 ? 'Stronger at home' : 'Stronger away'} by ${Math.abs(diff).toFixed(1)} PPG`}
      </div>
    </div>
  )
}

function TeamCard({
  team,
  metricRows,
  ratingRows,
  ratings,
  fixtureEase,
}: {
  team: string
  metricRows: Row[]
  ratingRows: TeamRatingRow[]
  ratings: RatingRow[]
  fixtureEase: FixtureEaseRow[]
}) {
  const [win, setWin] = useState<WinId>('season')

  const metricByWin = useMemo(() => {
    const m = new Map<string, Row>()
    for (const r of metricRows) m.set(str(r, 'window') ?? '', r)
    return m
  }, [metricRows])
  const ratingByWin = useMemo(() => {
    const m = new Map<string, TeamRatingRow>()
    for (const r of ratingRows) m.set(String(r.window), r)
    return m
  }, [ratingRows])

  const season = metricByWin.get('season') ?? metricRows[0] ?? {}
  const m = metricByWin.get(win) ?? season
  const rating = ratingByWin.get(win) ?? null
  const hasRatings = ratingRows.length > 0

  const teamPlayers = useMemo(
    () => ratings.filter((p) => p.team === team && bool(p, 'season_ok')).sort((a, b) => (num(b, 'season_overall_score') ?? 0) - (num(a, 'season_overall_score') ?? 0)),
    [ratings, team],
  )

  const seasonTotalPts = num(season, 'total_pts') ?? 0

  // Points reliance: each player's estimated season points → top-5 + rest tail.
  const concentration = useMemo(() => {
    const estPts = (p: Row) => {
      const ppg = num(p, 'season_ppg')
      const mins = num(p, 'total_mins')
      return ppg && mins ? ppg * (mins / 90) : 0
    }
    const ranked = [...teamPlayers].map((p) => ({ name: String(p.web_name), pts: estPts(p) })).filter((p) => p.pts > 0).sort((a, b) => b.pts - a.pts)
    const total = ranked.reduce((s, p) => s + p.pts, 0)
    const top5 = ranked.slice(0, 5)
    const rest = total - top5.reduce((s, p) => s + p.pts, 0)
    return { segments: top5.map((p) => ({ label: p.name, value: p.pts })), rest, hasData: total > 0 }
  }, [teamPlayers])

  const upcoming = fixtureEase.filter((f) => f.team === team)

  return (
    <div className="rounded-xl border border-line bg-surface-1/50 p-5 md:p-6">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-center gap-4">
        <TeamBadge team={team} size={56} />
        <div className="text-2xl font-extrabold tracking-tight text-ink">{teamFullNames[team] || team}</div>
        {rating?.set_piece_threat && (
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 text-xs font-semibold text-warn"
            title={rating.set_piece_share != null ? `${Math.round(rating.set_piece_share * 100)}% of xG from set pieces & penalties` : 'High set-piece & penalty threat'}
          >
            <Icon name="target" size={13} /> Set-piece threat
          </span>
        )}
      </div>

      {/* Window toggle */}
      <div className="mb-4 inline-flex rounded-lg border border-line bg-surface-1 p-0.5">
        {WINDOWS.map((w) => (
          <button
            key={w.id}
            onClick={() => setWin(w.id)}
            className={`min-h-9 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              win === w.id ? 'bg-accent-soft text-accent' : 'text-ink-2 hover:text-ink'
            }`}
          >
            {w.label}
          </button>
        ))}
      </div>

      {/* Anchor: our Attack / Defence ratings */}
      <div className="mb-5 flex gap-3">
        {hasRatings ? (
          <>
            <RatingNumber label="Attack" value={rating ? rating.attack : null} rank={rating ? rating.attack_rank : null} />
            <RatingNumber label="Defence" value={rating ? rating.defence : null} rank={rating ? rating.defence_rank : null} />
          </>
        ) : (
          <div className="flex-1 rounded-lg border border-dashed border-line bg-surface-1 px-3 py-4 text-center text-sm text-ink-3">
            Attack &amp; Defence ratings unavailable — no shot data loaded yet.
          </div>
        )}
      </div>

      {/* Context strip for the active window */}
      <div className="mb-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile value={fx1(num(m, 'team_xg'))} label={`xG${win === 'season' ? '' : ` (${win})`}`} />
        <Tile value={fx1(num(m, 'team_xgc'))} label="xG Conceded" />
        <Tile value={<AnimatedCounter value={(num(m, 'cs_rate') ?? 0) * 100} suffix="%" />} label="Clean Sheet Rate" />
        <Tile value={<span className="text-sm">{str(m, 'form_direction') || '—'}</span>} label="Form" />
      </div>

      {/* Home / Away */}
      <Section title="Home vs Away" hint={win === 'season' ? 'Season' : WINDOWS.find((w) => w.id === win)?.label}>
        <HomeAwayBar home={num(m, 'home_pts_per_gw')} away={num(m, 'away_pts_per_gw')} />
      </Section>

      {/* Points reliance — who carries the team */}
      <Section title="Points Reliance" hint="Season · top 5 players">
        {concentration.hasData ? (
          <ConcentrationBar segments={concentration.segments} rest={concentration.rest} />
        ) : (
          <span className="text-sm text-ink-3">No player points recorded.</span>
        )}
      </Section>

      {/* Points DNA — the two donuts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Points Breakdown" hint="Season">
          <Donut
            segments={[
              { label: 'Goals', value: (num(season, 'goal_pts_pct') ?? 0) * 100, color: CHART_COLORS[0] },
              { label: 'Assists', value: (num(season, 'assist_pts_pct') ?? 0) * 100, color: CHART_COLORS[1] },
              { label: 'Clean Sheets', value: (num(season, 'cs_pts_pct') ?? 0) * 100, color: CHART_COLORS[2] },
              { label: 'Def Contributions', value: seasonTotalPts ? ((num(season, 'dc_pts') ?? 0) / seasonTotalPts) * 100 : 0, color: CHART_COLORS[3] },
              { label: 'Bonus', value: (num(season, 'bonus_pts_pct') ?? 0) * 100, color: CHART_COLORS[4] },
            ]}
            centerValue={<AnimatedCounter value={seasonTotalPts} />}
            centerLabel="Season pts"
          />
        </Section>
        <Section title="Points by Position" hint="Season">
          <Donut
            segments={[
              { label: 'Goalkeepers', value: (num(season, 'gkp_pct') ?? 0) * 100, color: CHART_COLORS[1] },
              { label: 'Defenders', value: (num(season, 'def_pct') ?? 0) * 100, color: CHART_COLORS[2] },
              { label: 'Midfielders', value: (num(season, 'mid_pct') ?? 0) * 100, color: CHART_COLORS[0] },
              { label: 'Forwards', value: (num(season, 'fwd_pct') ?? 0) * 100, color: CHART_COLORS[3] },
            ]}
          />
        </Section>
      </div>

      {/* Upcoming fixtures with a graceful empty state */}
      <Section title="Upcoming Fixtures">
        {upcoming.length ? (
          <FixtureChips fixtureEase={fixtureEase} team={team} n={6} />
        ) : (
          <div className="rounded-lg border border-dashed border-line bg-surface-1 px-3 py-3 text-sm text-ink-3">
            No upcoming fixtures yet — the next fixture list populates when the new season schedule lands.
          </div>
        )}
      </Section>

      {/* Squad */}
      <Section title="Squad">
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
      </Section>

      {/* Shot map */}
      <Section title="Shot Map">
        <TeamShotMap team={team} />
      </Section>
    </div>
  )
}

// Referenced by other pages' deep links; keeps an obvious empty fallback.
export function TeamNotFound() {
  return <EmptyState icon={<Icon name="pitch" size={44} />}>Search for a team to see their analysis</EmptyState>
}
