import { useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageShell, EmptyState } from '../components/PageShell'
import { SectionBanner, StadiumBanner } from '../components/SectionBanner'
import { TeamStory } from '../components/TeamStory'
import { Exportable } from '../components/ExportPanel'
import { SortableTable, type Column } from '../components/SortableTable'
import { SearchBox } from '../components/SearchBox'
import { Tabs, type TabDef } from '../components/Tabs'
import { ClubCard, TeamMatchup } from '../components/ClubCard'
import { TeamMap, ViewChips } from '../components/CompareScatter'
import { StarRating } from '../components/StarRating'
import { AnimatedCounter } from '../components/AnimatedCounter'
import { Donut, CHART_COLORS, PODIUM_COLORS, RatingNumber, ConcentrationBar, scoreTone, SCORE_TEXT } from '../components/viz'
import { TeamBadge } from '../components/badges'
import { PlayerNameCell, PosBadge } from '../components/cells'
import { FixtureChips } from '../components/FixtureChips'
import { TeamShotMap } from '../components/ShotMap'
import { PageSkeleton } from '../components/Skeleton'
import { Icon } from '../components/Icon'
import { InfoTip } from '../components/InfoTip'
import { BestRunCards, RotationPartners } from '../components/TeamPlanning'
import { TeamFormChart, teamTrend, trendWords } from '../components/TeamFormChart'
import { useCore, useLazyTable } from '../lib/useData'
import { bestRuns, useDiffScale, windowGames } from '../lib/fixtureRuns'
import { num, str, bool } from '../lib/rows'
import { teamLabel, TOOLTIPS } from '../lib/util'
import type { CoreData, FixtureEaseRow, RatingRow, Row, TeamRatingRow } from '../lib/types'

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
  /* Cards, table and map are three views of the same twenty clubs, so only
     one shows at a time. The page used to stack the card grid and the table
     on top of each other, which meant scrolling past every club to reach a
     list of every club. */
  const [listView, setListView] = useState<'cards' | 'table' | 'map'>('cards')

  const teamMetrics = data?.teamMetrics ?? []
  const teamRatings = (data?.teamRatings ?? []) as TeamRatingRow[]
  const ratings = (data?.ratings ?? []) as RatingRow[]
  const fixtureEase = (data?.fixtureEase ?? []) as FixtureEaseRow[]

  const seasonRows = useMemo(() => teamMetrics.filter((t) => str(t, 'window') === 'season'), [teamMetrics])
  /* The all-clubs table used to be handed season rows only, so its Attack and
     Defence numbers could never answer "who is doing this NOW". Both feeds
     carry season, 6gw and 4gw, so both get passed through and the table picks
     a window. */
  const metricsByWindow = useMemo(() => {
    const m = new Map<string, Row[]>()
    for (const r of teamMetrics) {
      const w = str(r, 'window') ?? 'season'
      if (!m.has(w)) m.set(w, [])
      m.get(w)!.push(r)
    }
    return m
  }, [teamMetrics])
  const ratingsByWindow = useMemo(() => {
    const m = new Map<string, Map<string, TeamRatingRow>>()
    for (const r of teamRatings) {
      const w = String(r.window)
      if (!m.has(w)) m.set(w, new Map())
      m.get(w)!.set(r.team, r)
    }
    return m
  }, [teamRatings])
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
  const gw4ByTeam = useMemo(() => {
    const m = new Map<string, TeamRatingRow>()
    for (const r of teamRatings) if (r.window === '4gw') m.set(r.team, r)
    return m
  }, [teamRatings])
  /* Rated clubs first, best combined rating down; then anyone the ratings
     build has nothing for. Promoted sides have no season to rate, and leaving
     them out meant "All clubs" listed seventeen — a reader looking for
     Coventry would conclude the site did not cover them. They appear with an
     honest N/A and their fixtures instead. */
  const clubOrder = useMemo(() => {
    const rated = [...ratingByTeam.values()]
      .sort((a, b) => ((num(b, 'attack') ?? 0) + (num(b, 'defence') ?? 0)) - ((num(a, 'attack') ?? 0) + (num(a, 'defence') ?? 0)))
      .map((r) => r.team)
    const seen = new Set(rated)
    const rest = (data?.teams ?? [])
      .map((t) => String(t.short_name))
      .filter((t) => !seen.has(t))
      .sort((a, b) => teamLabel(a).localeCompare(teamLabel(b)))
    return [...rated, ...rest]
  }, [ratingByTeam, data?.teams])

  const selectTeam = (team: string) => {
    setParams(team ? { team } : {})
    window.scrollTo(0, 0)
  }

  if (!data) {
    return (
      <PageShell>
        <SectionBanner imgKey="teams" title="Teams" subtitle="Search for a team to see their metrics and player ratings" />
        <PageSkeleton error={coreError} />
      </PageShell>
    )
  }

  const searchItems = seasonRows
    .map((r) => String(r.team))
    .sort((a, b) => teamLabel(a).localeCompare(teamLabel(b)))

  return (
    <PageShell>
      {selected && seasonByTeam.has(selected) ? (
        <StadiumBanner
          team={selected}
          stats={(() => {
            const r = ratingByTeam.get(selected)
            if (!r) return undefined
            const out: { label: string; value: string }[] = []
            if (r.attack != null) out.push({ label: 'Attack', value: String(Math.round(Number(r.attack))) })
            if (r.defence != null) out.push({ label: 'Defence', value: String(Math.round(Number(r.defence))) })
            if (r.set_piece_share != null) out.push({ label: 'Set piece xG', value: `${Math.round(Number(r.set_piece_share) * 100)}%` })
            return out
          })()}
        />
      ) : (
        <SectionBanner imgKey="teams" title="Teams" subtitle="Search for a team to see their metrics and player ratings" />
      )}

      {/* Tight to what follows. Twenty-four pixels under a search box that is
          itself sixteen from the banner left a band of nothing across the top
          of every club page. */}
      <div className="mb-3">
        <SearchBox
          items={searchItems}
          getLabel={(t) => teamLabel(t)}
          renderItem={(t) => (
            <span className="flex items-center gap-2">
              <TeamBadge team={t} size={18} />
              {teamLabel(t)}
            </span>
          )}
          onSelect={selectTeam}
          placeholder="Search team name…"
          initialValue={selected ? teamLabel(selected) : ''}
        />
      </div>

      {selected && seasonByTeam.has(selected) ? (
        <div className="flex flex-col gap-4">
          <Exportable title={`${teamLabel(selected)} — the brief`}><TeamStory team={selected} data={data} /></Exportable>
          <ClubPage
            team={selected}
            data={data}
            ratingByTeam={ratingByTeam}
            metricRows={teamMetrics.filter((t) => String(t.team) === selected)}
            ratingRows={teamRatings.filter((t) => t.team === selected)}
            ratings={ratings}
            fixtureEase={fixtureEase}
          />
        </div>
      ) : selected ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-line bg-surface-1/60 p-6 text-center">
            <div className="mb-3 flex items-center justify-center gap-2">
              <TeamBadge team={selected} size={40} />
              <span className="text-xl font-bold text-ink">{teamLabel(selected)}</span>
            </div>
            <div className="mx-auto mb-1 inline-flex items-center gap-1.5 rounded-full border border-line-mid px-3 py-1 text-xs font-semibold text-ink-2">
              <Icon name="clock" size={13} /> Team report available after GW1
            </div>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">
              Our Attack, Defence and set-piece ratings are built from this season’s match data, so they switch on once the
              opening gameweek has been played. Until then, use the fixtures below to plan your run.
            </p>
          </div>
          {fixtureEase.some((f) => f.team === selected) && (
            <>
              <div className="rounded-2xl border border-line bg-surface-1/60 p-4">
                <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Next fixtures</div>
                <FixtureChips fixtureEase={fixtureEase} team={selected} n={6} />
              </div>
              {/* The fixture list is published for every club, rated or not, so
                  a promoted side still gets the part of the page that is real. */}
              <SeasonRuns team={selected} data={data} fixtureEase={fixtureEase} />
            </>
          )}
        </div>
      ) : (
        <>
          <FormWatch data={data} metricsByWindow={metricsByWindow} onSelect={selectTeam} />

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">All clubs</div>
              <p className="mt-0.5 text-xs text-ink-3">
                {listView === 'cards'
                  ? 'Ranked by Attack plus Defence. Tap a club for its brief, its season and its squad.'
                  : listView === 'table'
                    ? 'Every club on the numbers behind the ratings — sort any column.'
                    : 'Attack against defence: the top right is a complete side, the bottom left a club with a problem at both ends.'}
              </p>
            </div>
            <ViewChips
              options={[{ id: 'cards', label: 'Cards' }, { id: 'table', label: 'Table' }, { id: 'map', label: 'Map' }]}
              active={listView}
              onChange={setListView}
            />
          </div>
          {listView === 'map' ? (
            <TeamMap ratingByTeam={ratingByTeam} onTeam={selectTeam} />
          ) : listView === 'table' ? (
            <AllTeamsTable data={data} metricsByWindow={metricsByWindow} ratingsByWindow={ratingsByWindow} onSelect={selectTeam} />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {clubOrder.map((t) => (
                <ClubCard key={t} team={t} season={ratingByTeam.get(t)} gw4={gw4ByTeam.get(t)} fixtureEase={fixtureEase} onClick={() => selectTeam(t)} />
              ))}
            </div>
          )}
        </>
      )}
    </PageShell>
  )
}

/* Who has changed, on the way in.
   The club list answers "who is good". Arriving at it you cannot see who is
   different from how they were, which is the thing that actually moves a
   transfer. This compares each club's last four gameweeks against its season
   and names the clubs that have moved most in either direction.

   Per game on both sides of the comparison, obviously: a four-gameweek total
   against a season total would rank every club as collapsing. */
const MOVE_MIN = 0.2   // xG/game. Below this a "shift" is a couple of shots.

function FormWatch({ data, metricsByWindow, onSelect }: {
  data: CoreData
  metricsByWindow: Map<string, Row[]>
  onSelect: (team: string) => void
}) {
  const moves = useMemo(() => {
    const per = (r: Row | undefined, key: string) => {
      if (!r) return null
      const v = num(r, key)
      const g = windowGames(r, data)
      return v == null || g <= 0 ? null : v / g
    }
    const recent = new Map((metricsByWindow.get('4gw') ?? []).map((r) => [String(r.team), r]))
    const out: { team: string; xg: number | null; xgc: number | null }[] = []
    for (const r of metricsByWindow.get('season') ?? []) {
      const team = String(r.team)
      const now = recent.get(team)
      if (!now) continue
      const xgS = per(r, 'team_xg'), xgN = per(now, 'team_xg')
      const gcS = per(r, 'team_xgc'), gcN = per(now, 'team_xgc')
      out.push({
        team,
        xg: xgS != null && xgN != null ? xgN - xgS : null,
        // Conceding less is the improvement, so the sign is flipped to make
        // "up" mean "better" in both columns.
        xgc: gcS != null && gcN != null ? gcS - gcN : null,
      })
    }
    const pick = (key: 'xg' | 'xgc', dir: 1 | -1) =>
      out
        .filter((m) => m[key] != null && Math.abs(m[key] as number) >= MOVE_MIN && Math.sign(m[key] as number) === dir)
        .sort((a, b) => dir * ((b[key] as number) - (a[key] as number)))
        .slice(0, 3)
    return {
      attackUp: pick('xg', 1), attackDown: pick('xg', -1),
      defenceUp: pick('xgc', 1), defenceDown: pick('xgc', -1),
    }
  }, [metricsByWindow, data])

  const any = moves.attackUp.length || moves.attackDown.length || moves.defenceUp.length || moves.defenceDown.length
  if (!any) return null

  const Col = ({ title, rows, good }: { title: string; rows: { team: string; xg: number | null; xgc: number | null }[]; good: boolean }) => {
    if (!rows.length) return null
    return (
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 text-[10px] font-bold tracking-[0.12em] text-ink-3 uppercase">{title}</div>
        <div className="flex flex-col gap-1">
          {rows.map((m) => {
            const v = (title.startsWith('Attack') ? m.xg : m.xgc) as number
            return (
              <button
                key={m.team}
                onClick={() => onSelect(m.team)}
                className="flex min-h-8 items-center gap-2 rounded-lg px-1.5 text-left text-[12.5px] transition-colors hover:bg-surface-2"
              >
                <TeamBadge team={m.team} size={16} />
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{teamLabel(m.team)}</span>
                <span className={`font-num tabular-nums ${good ? 'text-good' : 'text-bad'}`}>
                  {v > 0 ? '+' : ''}{v.toFixed(2)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="mb-5 rounded-2xl border border-line bg-surface-1/60 p-4">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">What has changed</h2>
        <span className="text-xs text-ink-3">Last 4 gameweeks against the season, per game</span>
        <InfoTip text="Each club's expected goals and expected goals conceded over its last four gameweeks, compared with its season average, both divided by games played. Only shifts of 0.20 a game or more are listed — anything smaller is a couple of shots, not a change of form. A defence moving up means it is conceding less." />
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-4">
        <Col title="Attack rising" rows={moves.attackUp} good />
        <Col title="Attack falling" rows={moves.attackDown} good={false} />
        <Col title="Defence tightening" rows={moves.defenceUp} good />
        <Col title="Defence leaking" rows={moves.defenceDown} good={false} />
      </div>
    </div>
  )
}

/** Everything below the brief.
 *
 *  This used to open on a "Club dashboard" tab whose first element was a
 *  ClubCard of the club you had just clicked into — Attack, Defence and
 *  set-piece threat, all three of which the stadium banner states in its top
 *  corner and the brief states again in its first sentence. Four statements of
 *  the same three numbers is what made the page feel like a repeat, so the
 *  card and the tabs are gone. What is left is the three things the page
 *  alone can say: the next match, the whole season's fixtures, and the squad.
 */
function ClubPage({ team, data, ratingByTeam, metricRows, ratingRows, ratings, fixtureEase }: {
  team: string
  data: CoreData
  ratingByTeam: Map<string, TeamRatingRow>
  metricRows: Row[]
  ratingRows: TeamRatingRow[]
  ratings: RatingRow[]
  fixtureEase: FixtureEaseRow[]
}) {
  const seasonMetrics = metricRows.find((r) => str(r, 'window') === 'season') ?? metricRows[0] ?? {}
  return (
    <div className="flex flex-col gap-5">
      {/* The next match and who carries the points: the two things a manager
          decides on, so they sit above everything that explains them. Points
          reliance was buried at the bottom of a squad card, which is the last
          place you would look for "is this a one-man team". */}
      <div className="grid grid-cols-1 items-start gap-3 md:grid-cols-2">
        <TeamMatchup team={team} ratingByTeam={ratingByTeam} fixtureEase={fixtureEase} />
        <PointsReliance team={team} ratings={ratings} metrics={seasonMetrics} />
      </div>

      <TeamForm team={team} />

      <SeasonRuns team={team} data={data} fixtureEase={fixtureEase} />

      <TeamTabs team={team} data={data} metricRows={metricRows} ratingRows={ratingRows} ratings={ratings} />
    </div>
  )
}

/** Who carries the points, as a share of the squad. */
function PointsReliance({ team, ratings, metrics }: { team: string; ratings: RatingRow[]; metrics: Row }) {
  const conc = useMemo(() => {
    const players = ratings.filter((p) => p.team === team && bool(p, 'season_ok'))
    const estPts = (p: Row) => {
      const ppg = num(p, 'season_ppg')
      const mins = num(p, 'total_mins')
      return ppg && mins ? ppg * (mins / 90) : 0
    }
    const ranked = players.map((p) => ({ label: String(p.web_name), value: estPts(p) })).filter((p) => p.value > 0).sort((a, b) => b.value - a.value)
    const total = ranked.reduce((s, p) => s + p.value, 0)
    // Podium fills: these five slots are a ranking, so they are coloured as
    // one — first, second, third, then the two behind them.
    const top5 = ranked.slice(0, 5).map((p, i) => ({ ...p, color: PODIUM_COLORS[i] }))
    return { segments: top5, rest: total - top5.reduce((s, p) => s + p.value, 0), hasData: total > 0, share: total ? top5.reduce((s, p) => s + p.value, 0) / total : 0 }
  }, [ratings, team])

  const top1 = num(metrics, 'top1_share')
  if (!conc.hasData) return null
  return (
    <div className="rounded-2xl border border-line bg-surface-1/60 p-4 md:p-5">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">
        <span>Points reliance</span>
        <span className="tracking-normal normal-case">Season · top 5 players</span>
      </div>
      <p className="mb-3 text-[12.5px] text-ink-2">
        The top five take <b className="text-ink">{Math.round(conc.share * 100)}%</b> of this squad&apos;s points
        {top1 != null ? <> — the leading scorer alone takes <b className="text-ink">{Math.round(top1 * 100)}%</b></> : null}.
      </p>
      <ConcentrationBar segments={conc.segments} rest={conc.rest} />
    </div>
  )
}

/** The receipts, split three ways. Squad and shot map are different questions
 *  and were stacked in one endless card; the club's own numbers are a third. */
function TeamTabs({ team, data, metricRows, ratingRows, ratings }: {
  team: string
  data: CoreData
  metricRows: Row[]
  ratingRows: TeamRatingRow[]
  ratings: RatingRow[]
}) {
  const [tab, setTab] = useState<'squad' | 'shots' | 'numbers'>('squad')
  const LABELS = [['squad', 'Squad'], ['shots', 'Shot map'], ['numbers', 'Club numbers']] as const
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {LABELS.map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`min-h-9 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${
              tab === id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <Exportable title={`${teamLabel(team)} — ${tab === 'squad' ? 'squad' : tab === 'shots' ? 'shot map' : 'club numbers'}`}>
        {tab === 'squad' ? (
          <SquadTable team={team} ratings={ratings} />
        ) : tab === 'shots' ? (
          <TeamShotMap team={team} />
        ) : (
          <TeamCard team={team} data={data} metricRows={metricRows} ratingRows={ratingRows} ratings={ratings} />
        )}
      </Exportable>
    </div>
  )
}

function SquadTable({ team, ratings }: { team: string; ratings: RatingRow[] }) {
  const rows = useMemo(
    () => ratings.filter((p) => p.team === team && bool(p, 'season_ok')).sort((a, b) => (num(b, 'season_overall_score') ?? 0) - (num(a, 'season_overall_score') ?? 0)),
    [ratings, team],
  )
  return (
    <SortableTable
      rows={rows}
      columns={[
        { key: 'player', header: 'Player', align: 'left', sortValue: (r) => str(r, 'web_name'), cell: (r) => <PlayerNameCell name={String(r.web_name)} code={num(r, 'code')} /> },
        { key: 'pos', header: 'Pos', align: 'left', sortValue: (r) => str(r, 'position'), cell: (r) => <PosBadge pos={String(r.position)} /> },
        { key: 'price', header: 'Price', sortValue: (r) => num(r, 'price'), cell: (r) => <span className="font-num tabular-nums">£{num(r, 'price')}m</span> },
        { key: 'season', header: 'Season Rating', align: 'left', sortValue: (r) => num(r, 'season_overall_score'), cell: (r) => <StarRating value={num(r, 'season_overall_score')} /> },
        { key: 'gw4', header: '4GW Rating', align: 'left', sortValue: (r) => num(r, 'gw4_overall_score'), cell: (r) => <StarRating value={num(r, 'gw4_overall_score')} /> },
        { key: 'ppg', header: 'PPG', sortValue: (r) => num(r, 'season_ppg'), cell: (r) => <span className="font-num tabular-nums text-accent">{num(r, 'season_ppg')?.toFixed(1) ?? 'N/A'}</span> },
      ]}
      initialSort="season"
      initialDir="desc"
      rowKey={(r) => String(r.element)}
    />
  )
}

/* Week by week rather than window by window.
   Every other team figure on the page is an average over some window, which
   is the right way to compare clubs and the wrong way to see a club change.
   This is the same club's xG and xA drawn gameweek by gameweek, with the
   headline stating whether the recent weeks differ from the earlier ones by
   enough to be worth a sentence. */
function TeamForm({ team }: { team: string }) {
  const q = useLazyTable<Row[]>('gameweek_stats')
  const trend = useMemo(() => teamTrend(q.data ?? [], team), [q.data, team])
  const words = trendWords(trend, teamLabel(team))

  // The gameweek feed does not exist until a season has games in it, and it is
  // fetched lazily, so the section has three honest states and no fourth: a
  // skeleton while it is coming, nothing at all when there is nothing to draw,
  // and the chart. It must not sit on a skeleton forever, which is what a
  // missing file used to produce.
  if (q.loading) return <Section title="Form, week by week"><div className="h-[210px] animate-pulse rounded-2xl bg-surface-2" /></Section>
  if (trend.points.length < 2) return null

  return (
    <Section title="Form, week by week" hint="Expected goals and expected assists per gameweek">
      {words && <p className="mb-3 max-w-[80ch] text-sm text-ink-2">{words}</p>}
      <div className="rounded-2xl border border-line bg-surface-1 p-3 sm:p-4">
        <TeamFormChart team={team} points={trend.points} />
      </div>
    </Section>
  )
}

/* A club's two purple patches — the kindest 3–6 gameweek stretch either side
   of the turn of the year. Overall lens: the team page speaks for the whole
   club rather than for its attackers or its defence, and a manager reading it
   wants to know when the good weeks are, not which end of the pitch they
   favour. */
function SeasonRuns({ team, data, fixtureEase }: { team: string; data: CoreData; fixtureEase: FixtureEaseRow[] }) {
  const scale = useDiffScale(data)
  const mine = useMemo(() => fixtureEase.filter((f) => String(f.team) === team), [fixtureEase, team])
  const runs = useMemo(() => bestRuns(mine, team, 'overall', scale), [mine, team, scale])
  const fromGw = useMemo(() => (mine.length ? Math.min(...mine.map((f) => f.gw)) : 1), [mine])
  if (!runs.length) return null
  return (
    <Section title="Planning the run" hint="Our own difficulty ratings">
      {/* This used to draw all thirty-eight gameweeks in one strip. That is the
          right picture on the Fixtures page, where twenty rows side by side let
          you compare clubs — for one club it is a spreadsheet with a single row
          in it, and the reader has to do the finding. Two questions instead:
          when are the good weeks, and who covers the bad ones. */}
      <BestRunCards runs={runs} />
      <div className="mt-4">
        <h4 className="mb-1.5 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Rotation partners</h4>
        <RotationPartners fixtureEase={fixtureEase} team={team} scale={scale} fromGw={fromGw} />
      </div>
    </Section>
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
    {teamLabel(String(r.team))}
  </span>
)
const teamSort = (r: Row) => teamLabel(String(r.team))
const fx = (v: number | null, d = 1) => (v == null ? 'N/A' : Number(v).toFixed(d))

function AllTeamsTable({
  data,
  metricsByWindow,
  ratingsByWindow,
  onSelect,
}: {
  data: CoreData
  metricsByWindow: Map<string, Row[]>
  ratingsByWindow: Map<string, Map<string, TeamRatingRow>>
  onSelect: (team: string) => void
}) {
  const [tab, setTab] = useState<'attack' | 'defence'>('attack')
  const [win, setWin] = useState<WinId>('season')

  const rows = metricsByWindow.get(win) ?? metricsByWindow.get('season') ?? []
  const ratingByTeam = ratingsByWindow.get(win) ?? ratingsByWindow.get('season') ?? new Map()
  const rt = (r: Row) => ratingByTeam.get(String(r.team))

  /* Per game, not per window. A season xG total and a four-gameweek xG total
     are both "xG", and putting them under the same header without dividing by
     games played would make Last 4 look like a collapse for every club in the
     league. windowGames knows how many games each window actually covers. */
  const perGame = (r: Row, key: string) => {
    const v = num(r, key)
    const g = windowGames(r, data)
    return v == null || g <= 0 ? null : v / g
  }

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
    { key: 'att', header: 'ATT', tip: TOOLTIPS.attack as string, sortValue: (r) => rt(r)?.attack ?? -1, cell: (r) => <RatingCell score={rt(r)?.attack ?? null} /> },
    { key: 'xg', header: 'xG/game', tip: TOOLTIPS.team_xg as string, sortValue: (r) => perGame(r, 'team_xg'), cell: (r) => <span className="font-num tabular-nums">{fx(perGame(r, 'team_xg'), 2)}</span> },
    { key: 'xa', header: 'xA/game', tip: TOOLTIPS.team_xa as string, sortValue: (r) => perGame(r, 'team_xa'), cell: (r) => <span className="font-num tabular-nums">{fx(perGame(r, 'team_xa'), 2)}</span> },
    { key: 'finish', header: 'Finish Δ', tip: TOOLTIPS.finish_delta as string, sortValue: (r) => { const v = rt(r)?.finish_delta; return v == null ? -999 : v - meanFinish }, cell: (r) => { const v = rt(r)?.finish_delta; return <DeltaCell value={v == null ? null : v - meanFinish} /> } },
    { key: 'box', header: 'Box %', tip: TOOLTIPS.box_share as string, sortValue: (r) => rt(r)?.box_share ?? -1, cell: (r) => { const v = rt(r)?.box_share; return <span className="font-num tabular-nums">{v == null ? 'N/A' : `${Math.round(v * 100)}%`}</span> } },
    /* Set-piece and penalty read like Box % because they are the same kind of
       number: a share of this club's xG, sortable, with no verdict attached.
       Set-piece used to gild whichever clubs cleared the threat flag, which
       put a highlight on four rows of a sortable column — the sort already
       ranks them, and the colour only made the eye stop somewhere the data
       had not asked it to. */
    { key: 'sp', header: 'Set-piece', tip: TOOLTIPS.set_piece_share as string, sortValue: (r) => rt(r)?.set_piece_share ?? -1, cell: (r) => { const v = rt(r)?.set_piece_share; return v == null ? <span className="text-ink-3">—</span> : <span className="font-num tabular-nums">{Math.round(v * 100)}%</span> } },
    { key: 'pen', header: 'Penalty', tip: TOOLTIPS.pen_share as string, sortValue: (r) => rt(r)?.pen_share ?? -1, cell: (r) => { const v = rt(r)?.pen_share; return v == null ? <span className="text-ink-3">—</span> : <span className="font-num tabular-nums">{Math.round(v * 100)}%</span> } },
  ]

  const defenceCols: Column<Row>[] = [
    { key: 'team', header: 'Team', align: 'left', sortValue: teamSort, cell: teamCell },
    { key: 'def', header: 'DEF', tip: TOOLTIPS.defence as string, sortValue: (r) => rt(r)?.defence ?? -1, cell: (r) => <RatingCell score={rt(r)?.defence ?? null} /> },
    { key: 'xgc', header: 'xGC/game', tip: TOOLTIPS.team_xgc as string, sortValue: (r) => perGame(r, 'team_xgc'), cell: (r) => <span className="font-num tabular-nums">{fx(perGame(r, 'team_xgc'), 2)}</span> },
    { key: 'cs', header: 'CS %', tip: TOOLTIPS.cs as string, sortValue: (r) => num(r, 'cs_rate'), cell: (r) => <span className="font-num tabular-nums">{pct(num(r, 'cs_rate'))}</span> },
    { key: 'prevent', header: 'Prevent Δ', tip: TOOLTIPS.prevent_delta as string, sortValue: (r) => { const v = rt(r)?.xgc_prevented; return v == null ? -999 : v - meanPrevent }, cell: (r) => { const v = rt(r)?.xgc_prevented; return <DeltaCell value={v == null ? null : v - meanPrevent} /> } },
    { key: 'boxc', header: 'Box % Con', tip: TOOLTIPS.box_share_conceded as string, sortValue: (r) => rt(r)?.box_share_conceded ?? -1, cell: (r) => { const v = rt(r)?.box_share_conceded; return <span className="font-num tabular-nums">{v == null ? 'N/A' : `${Math.round(v * 100)}%`}</span> } },
  ]

  const isAttack = tab === 'attack'
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold tracking-wide text-ink-2 uppercase">All Teams</h2>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            {WINDOWS.map((w) => (
              <button
                key={w.id}
                onClick={() => setWin(w.id)}
                className={`min-h-9 rounded-full border px-3 text-[13px] font-medium transition-colors ${
                  win === w.id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          <Tabs tabs={TEAM_LIST_TABS} active={tab} onChange={(id) => setTab(id as 'attack' | 'defence')} layoutId="team-list" />
        </div>
      </div>
      <SortableTable
        key={`${tab}-${win}`}
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

/** The club's own numbers, windowed. Everything here answers "what kind of
 *  side is this", as opposed to "who should I buy", which the page above
 *  answers. No club header: the stadium banner three inches up already said
 *  whose page this is. */
function TeamCard({
  team: _team,
  metricRows,
  ratingRows,
}: {
  team: string
  data: CoreData
  metricRows: Row[]
  ratingRows: TeamRatingRow[]
  ratings: RatingRow[]
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
  const seasonTotalPts = num(season, 'total_pts') ?? 0

  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4 md:p-6">
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

      <div className="mb-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile value={fx1(num(m, 'team_xg'))} label={`xG${win === 'season' ? '' : ` (${win})`}`} />
        <Tile value={fx1(num(m, 'team_xgc'))} label="xG Conceded" />
        <Tile value={<AnimatedCounter value={(num(m, 'cs_rate') ?? 0) * 100} suffix="%" />} label="Clean Sheet Rate" />
        <Tile value={<span className="text-sm">{str(m, 'form_direction') || '—'}</span>} label="Form" />
      </div>

      <Section title="Home vs Away" hint={win === 'season' ? 'Season' : WINDOWS.find((w) => w.id === win)?.label}>
        <HomeAwayBar home={num(m, 'home_pts_per_gw')} away={num(m, 'away_pts_per_gw')} />
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Points Breakdown" hint="Season">
          <Donut
            centerValue={<AnimatedCounter value={seasonTotalPts} />}
            centerLabel="Season pts"
            segments={[
              { label: 'Goals', value: num(season, 'goal_pts') ?? 0, color: CHART_COLORS[0] },
              { label: 'Assists', value: num(season, 'assist_pts') ?? 0, color: CHART_COLORS[1] },
              { label: 'Clean Sheets', value: num(season, 'cs_pts') ?? 0, color: CHART_COLORS[2] },
              { label: 'Def Contributions', value: num(season, 'dc_pts') ?? 0, color: CHART_COLORS[3] },
              { label: 'Bonus', value: num(season, 'bonus_pts') ?? 0, color: CHART_COLORS[4] },
            ]}
          />
        </Section>
        <Section title="Points by Position" hint="Season">
          <Donut
            segments={[
              { label: 'Goalkeepers', value: num(season, 'gkp_pts') ?? 0, color: CHART_COLORS[1] },
              { label: 'Defenders', value: num(season, 'def_pts') ?? 0, color: CHART_COLORS[2] },
              { label: 'Midfielders', value: num(season, 'mid_pts') ?? 0, color: CHART_COLORS[0] },
              { label: 'Forwards', value: num(season, 'fwd_pts') ?? 0, color: CHART_COLORS[3] },
            ]}
          />
        </Section>
      </div>
    </div>
  )
}

// Referenced by other pages' deep links; keeps an obvious empty fallback.
export function TeamNotFound() {
  return <EmptyState icon={<Icon name="pitch" size={44} />}>Search for a team to see their analysis</EmptyState>
}
