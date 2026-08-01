import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageShell } from '../components/PageShell'
import { SectionBanner } from '../components/SectionBanner'
import { Tabs, PillGroup, type TabDef } from '../components/Tabs'
import { SortableTable, type Column } from '../components/SortableTable'
import { StarRating } from '../components/StarRating'
import { MiniBar } from '../components/viz'
import { PlayerNameCell, PosBadge, TeamCell } from '../components/cells'
import { InfoTip } from '../components/InfoTip'
import { Icon } from '../components/Icon'
import { PageSkeleton } from '../components/Skeleton'
import { EmptyState } from '../components/PageShell'
import { PlayerCompare, ViewChips, compareLenses, type CompareLens } from '../components/CompareScatter'
import { Exportable } from '../components/ExportPanel'
import { useCore } from '../lib/useData'
import { useAvailability, availFor } from '../lib/availability'
import { useMarketOdds, useXpModel, useShotProfiles, xpForGw } from '../lib/xp'
import { num, str, bool } from '../lib/rows'
import { norm, searchText, TOOLTIPS, playerHref, teamLabel } from '../lib/util'
import type { RatingRow, Row } from '../lib/types'

// This is the app's "Players" hub: sortable leaderboards across every metric,
// with an on-page search and click-through to each player's detail dashboard.
// (Kept as Rankings.tsx / <Rankings> internally; surfaced as "Players".)

const TABS: TabDef[] = [
  { id: 'top-rated', label: 'Top Rated', icon: <Icon name="star" size={13} /> },
  // xPoints sits second because it is the forward-looking answer: Top Rated
  // says who has been best, this says who is about to score most. Everything
  // after it explains where those points come from.
  { id: 'next4', label: 'xPoints', icon: <Icon name="calendar" size={13} /> },
  { id: 'goal-threats', label: 'Goal Threats', icon: <Icon name="target" size={13} /> },
  { id: 'creators', label: 'Creators', icon: <Icon name="bolt" size={13} /> },
  { id: 'clean-sheets', label: 'Clean Sheets', icon: <Icon name="shield" size={13} /> },
  { id: 'goalkeepers', label: 'Goalkeepers', icon: <Icon name="shield" size={13} /> },
  { id: 'def-con', label: 'Def Con', icon: <Icon name="shield" size={13} /> },
  { id: 'value', label: 'Value Picks', icon: <Icon name="coin" size={13} /> },
  { id: 'form', label: 'Form', icon: <span className="text-hot"><Icon name="flame" size={13} solid /></span> },
  { id: 'transfers', label: 'Transfers', icon: <Icon name="trend-up" size={13} /> },
  // Team of the Week has left this page. It reports on a gameweek that has
  // been played, which is a different job from the leaderboards around it —
  // it belongs in the gameweek review, and will move there when that is built.
]

/** Horizons the xPoints board projects over. Four is the transfer question,
 *  six is the wildcard question, and the longer two are for chip planning. */
const XP_WINDOWS = [4, 6, 8, 10] as const

const TOP_N = 30
const SEARCH_CAP = 60

// # column: static rank from the tab's default metric order. Sorting by it
// (ascending, the table default) reproduces that metric ranking exactly.
function rankCol(): Column<Row> {
  return {
    key: 'rank',
    header: '#',
    align: 'left',
    narrow: true,
    tip: "Position in this ranking, ordered by the tab's headline metric.",
    sortValue: (r) => num(r, '_rank'),
    cell: (r) => <span className="font-num text-ink-3 tabular-nums">{num(r, '_rank')}</span>,
  }
}
/** Below `lg` the name carries position, club and price on a second line, so
 *  three columns become none. The box is capped and the name wraps inside it:
 *  left to size itself the column took the longest name on screen, which put
 *  the hot-streak board 3px inside the phone until an Alexander-Arnold turned
 *  up in it. */
const playerCol: Column<Row> = {
  key: 'player',
  header: 'Player',
  align: 'left',
  sortValue: (r) => str(r, 'web_name'),
  cell: (r) => <PlayerNameCell name={String(r.web_name)} code={num(r, 'code')} />,
  mobileCell: (r) => {
    const price = num(r, 'price')
    return (
      <span className="block max-w-[104px]">
        <PlayerNameCell name={String(r.web_name)} code={num(r, 'code')} />
        <span className="mt-px block text-[9px] leading-tight font-semibold tracking-[0.02em] text-ink-3">
          {String(r.position)} · {String(r.team)}
          {price != null ? ` · £${price}m` : ''}
        </span>
      </span>
    )
  },
}
const posCol: Column<Row> = {
  key: 'pos',
  header: 'Pos',
  align: 'left',
  mobileHide: true,
  sortValue: (r) => str(r, 'position'),
  cell: (r) => <PosBadge pos={String(r.position)} />,
}
const teamCol: Column<Row> = {
  key: 'team',
  header: 'Team',
  align: 'left',
  mobileHide: true,
  sortValue: (r) => str(r, 'team'),
  cell: (r) => <TeamCell team={String(r.team)} />,
}
const priceCol: Column<Row> = {
  key: 'price',
  header: 'Price',
  mobileHide: true,
  tip: 'Current FPL price.',
  sortValue: (r) => num(r, 'price'),
  cell: (r) => <span className="font-num tabular-nums">£{num(r, 'price')}m</span>,
}
// Overall ratings render from the continuous 0–5 score for a granular /100 number.
const scoreCol = (scoreKey: string, header: string, tip?: string, short?: string): Column<Row> => ({
  key: scoreKey,
  header,
  mobileHeader: short,
  tip,
  align: 'left',
  sortValue: (r) => num(r, scoreKey),
  cell: (r) => <StarRating value={num(r, scoreKey)} />,
})
// Like scoreCol, but shows an explained N/A when the window has too few minutes.
const windowScoreCol = (scoreKey: string, header: string, tip?: string, short?: string): Column<Row> => ({
  key: scoreKey,
  header,
  mobileHeader: short,
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
    mobileCell: (r) => {
      const v = num(r, 'season_ppg')
      return v == null ? <span className="text-ink-3">—</span> : <span className="font-num tabular-nums">{v.toFixed(1)}</span>
    },
  }
}

/** Availability-adjusted expected points per game — the number the overall
 *  rating is built from. We calculate it, so it belongs on the table. */
const xptsCol: Column<Row> = {
  key: 'season_xpts_adjusted',
  header: 'xPts',
  tip: 'Availability-adjusted expected points per game: what the underlying numbers say a player should score, scaled by how often he actually starts. The FPL Analyser rating is this number ranked against the position.',
  align: 'right',
  sortValue: (r) => num(r, 'season_xpts_adjusted') ?? num(r, 'season_xpts_per_game'),
  cell: (r) => {
    const v = num(r, 'season_xpts_adjusted') ?? num(r, 'season_xpts_per_game')
    return v == null ? <span className="text-ink-3">—</span> : <span className="font-num tabular-nums">{v.toFixed(2)}</span>
  },
}

// ── Raw-metric columns (the ingredients behind each rating) ──────────────────
const dash = <span className="text-ink-3">—</span>
/** Plain numeric per-90 / ratio metric, N decimals. */
const numCol = (key: string, header: string, tip: string, digits = 2, short?: string): Column<Row> => ({
  key,
  header,
  mobileHeader: short,
  tip,
  align: 'right',
  sortValue: (r) => num(r, key),
  cell: (r) => {
    const v = num(r, key)
    return v == null ? dash : <span className="font-num tabular-nums">{v.toFixed(digits)}</span>
  },
})
/** A 0–1 fraction rendered as a percentage. */
const pctCol = (key: string, header: string, tip: string, short?: string): Column<Row> => ({
  key,
  header,
  mobileHeader: short,
  tip,
  align: 'right',
  sortValue: (r) => num(r, key),
  cell: (r) => {
    const v = num(r, key)
    return v == null ? dash : <span className="font-num tabular-nums">{(v * 100).toFixed(0)}%</span>
  },
})

/** Compare two rows on a headline metric, falling through a list of
 *  tie-breaks. Missing values sink. */
function byThen(a: Row, b: Row, key: string, tieKeys: string[]): number {
  for (const k of [key, ...tieKeys]) {
    const d = (num(b, k) ?? -Infinity) - (num(a, k) ?? -Infinity)
    if (d !== 0) return d
  }
  return 0
}

/** Sort a pool by a metric, stamp global rank, then either take the top N or
 *  (when searching) keep every name match with its true rank preserved.
 *
 *  The dimension scores are percentile-based and top out at 99.0, so the best
 *  handful of players in a category are routinely all on exactly the same
 *  number — five defenders and midfielders share the Def Con ceiling. Left to
 *  the sort's own devices the order of those five is whatever the build
 *  happened to emit, which is how the lead line came to credit Lacroix for a
 *  threshold Senesi hits far more often. `tieKey` names the raw metric the
 *  category is actually about and settles it. */
function rankedPool(rows: Row[], metricKey: string, query: string, tieKeys: string[] = []): Row[] {
  const sorted: Row[] = [...rows]
    .sort((a, b) => byThen(a, b, metricKey, tieKeys))
    .map((r, i) => ({ ...r, _rank: i + 1 }))
  if (query) {
    const q = norm(query)
    return sorted.filter((r) => searchText(r.web_name).includes(q)).slice(0, SEARCH_CAP)
  }
  return sorted.slice(0, TOP_N)
}

interface TabView {
  columns: Column<Row>[]
  rows: Row[]
}

// Price slider bounds — wide enough for any FPL season.
const PRICE_FLOOR = 3.5
const PRICE_CEIL = 16

/** The filter bar: price band, club, ownership and a nailed-minutes switch.
 *  Applies to the table and the compare chart alike. */
/** A price box you can actually empty.
 *
 *  Binding the input straight to a number meant clearing the field produced
 *  Number('') === 0, which React immediately painted back as "0" — so the
 *  zero could never be deleted and typing a price meant selecting it first.
 *  The raw string is held while the field has focus and only committed when
 *  it parses; blurring an empty box restores the bound. */
function PriceInput({ value, onCommit, fallback, label, className }: {
  value: number
  onCommit: (v: number) => void
  fallback: number
  label: string
  className?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      type="number"
      step="0.1"
      min={PRICE_FLOOR}
      max={PRICE_CEIL}
      inputMode="decimal"
      aria-label={label}
      className={className}
      value={draft ?? value}
      onChange={(e) => {
        const raw = e.target.value
        setDraft(raw)
        const n = Number(raw)
        if (raw !== '' && Number.isFinite(n)) onCommit(n)
      }}
      onBlur={() => {
        if (draft === '' || (draft != null && !Number.isFinite(Number(draft)))) onCommit(fallback)
        setDraft(null)
      }}
    />
  )
}

function FilterBar({ teams, priceMin, priceMax, setPriceMin, setPriceMax, teamFilter, setTeamFilter, ownership, setOwnership, nailedOnly, setNailedOnly, onReset, active }: {
  teams: string[]
  priceMin: number; priceMax: number
  setPriceMin: (v: number) => void; setPriceMax: (v: number) => void
  teamFilter: string; setTeamFilter: (v: string) => void
  ownership: 'ALL' | 'template' | 'differential'; setOwnership: (v: 'ALL' | 'template' | 'differential') => void
  nailedOnly: boolean; setNailedOnly: (v: boolean) => void
  onReset: () => void
  active: boolean
}) {
  const field = 'min-h-9 rounded-lg border border-line-mid bg-surface-1 px-2.5 text-sm text-ink focus:border-line-strong focus:outline-none'
  return (
    <div className="mb-4 rounded-xl border border-line bg-surface-1/60 p-3">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold tracking-[0.12em] text-ink-3 uppercase">Price</span>
          <span className="flex items-center gap-1.5">
            <PriceInput value={priceMin} onCommit={setPriceMin} fallback={PRICE_FLOOR} label="Minimum price" className={`${field} w-[74px]`} />
            <span className="text-xs text-ink-3">to</span>
            <PriceInput value={priceMax} onCommit={setPriceMax} fallback={PRICE_CEIL} label="Maximum price" className={`${field} w-[74px]`} />
          </span>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold tracking-[0.12em] text-ink-3 uppercase">Club</span>
          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className={`${field} w-[130px]`}>
            <option value="ALL">All clubs</option>
            {teams.map((t) => <option key={t} value={t}>{teamLabel(t)}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold tracking-[0.12em] text-ink-3 uppercase">Ownership</span>
          <select value={ownership} onChange={(e) => setOwnership(e.target.value as 'ALL' | 'template' | 'differential')} className={`${field} w-[150px]`}>
            <option value="ALL">Any ownership</option>
            <option value="template">Template (20%+)</option>
            <option value="differential">Differential (&lt;10%)</option>
          </select>
        </label>
        <label className="flex min-h-9 items-center gap-2 text-sm text-ink-2">
          <input type="checkbox" checked={nailedOnly} onChange={(e) => setNailedOnly(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Nailed starters only
        </label>
        {active && (
          <button onClick={onReset} className="min-h-9 rounded-lg border border-line-mid px-3 text-[13px] font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink">
            Clear filters
          </button>
        )}
      </div>
    </div>
  )
}

export default function Rankings() {
  const { data, error: coreError } = useCore()
  const avail = useAvailability()
  const market = useMarketOdds()
  const model = useXpModel()
  const profiles = useShotProfiles()
  const navigate = useNavigate()
  const [tab, setTab] = useState('top-rated')
  const [pos, setPos] = useState('ALL')
  const [query, setQuery] = useState('')
  const [viewMode, setViewMode] = useState<'table' | 'compare'>('table')
  const [compareLens, setCompareLens] = useState<CompareLens>('value')
  const [priceMin, setPriceMin] = useState(PRICE_FLOOR)
  const [priceMax, setPriceMax] = useState(PRICE_CEIL)
  const [teamFilter, setTeamFilter] = useState('ALL')
  const [ownership, setOwnership] = useState<'ALL' | 'template' | 'differential'>('ALL')
  const [nailedOnly, setNailedOnly] = useState(true)
  const [filtersOpen, setFiltersOpen] = useState(true)
  const [xpWindow, setXpWindow] = useState<(typeof XP_WINDOWS)[number]>(4)

  const ratings = (data?.ratings ?? []) as RatingRow[]
  const metrics = data?.metrics ?? []
  const seasonToDate = data?.seasonToDate ?? []

  /* The next four gameweeks, projected with the site's own per-gameweek model —
     the same one behind GW Preview and the Squad Builder, so a player's number
     here is the sum of the four numbers he is given there. The tab previously
     read a `next4_score` column that the ratings build has never produced, so
     it rendered nothing at all.

     Availability is applied per gameweek inside the model, which is the point
     of doing it week by week rather than scaling a season average: a player
     back in three weeks scores nothing for two of the four, and a blank shows
     up as a blank rather than being averaged away. */
  const nextGw = data?.meta?.next_gw != null ? Number(data.meta.next_gw) : 1
  const next4 = useMemo(() => {
    const fe = data?.fixtureEase ?? []
    if (!fe.length) return null
    const gws = [...new Set(fe.map((f) => f.gw))].sort((a, b) => a - b).filter((g) => g >= nextGw).slice(0, xpWindow)
    if (!gws.length) return null
    const byEl = new Map<number, { total: number; per: (number | null)[]; games: number }>()
    for (const r of ratings) {
      const el = num(r, 'element')
      if (el == null) continue
      const per = gws.map((g) => xpForGw(r, g, fe, avail, model, market, profiles))
      if (per.every((v) => v == null)) continue
      const total = per.reduce<number>((a, v) => a + (v ?? 0), 0)
      const games = gws.filter((g) => fe.some((f) => f.team === r.team && f.gw === g)).length
      byEl.set(el, { total, per, games })
    }
    return { gws, byEl }
  }, [ratings, data?.fixtureEase, nextGw, xpWindow, avail, model, market, profiles])

  const toPlayer = (name: string, code?: number | null) => navigate(playerHref(name, code))

  // Position filter options depend on the tab. Single-position tabs (clean
  // sheets = defenders, goalkeepers) hide the filter entirely.
  const isAttOnly = tab === 'goal-threats' || tab === 'creators'
  const isOutfield = tab === 'def-con'
  const singlePos = tab === 'clean-sheets' || tab === 'goalkeepers'
  const posOptions = useMemo(() => {
    const ALL = { id: 'ALL', label: 'All' }
    const GKP = { id: 'GKP', label: 'GKP' }
    const DEF = { id: 'DEF', label: 'DEF' }
    const MID = { id: 'MID', label: 'MID' }
    const FWD = { id: 'FWD', label: 'FWD' }
    if (singlePos) return [ALL]
    if (isAttOnly) return [ALL, MID, FWD]
    if (isOutfield) return [ALL, DEF, MID, FWD]
    return [ALL, GKP, DEF, MID, FWD]
  }, [isAttOnly, isOutfield, singlePos])

  const allTeams = useMemo(() => [...new Set(ratings.map((p) => String(p.team)).filter(Boolean))].sort(), [ratings])

  // Filters apply to the table AND the compare chart — one pool, two views.
  const passesFilters = useMemo(() => {
    return (p: Row): boolean => {
      const price = num(p, 'price')
      if (price != null && (price < priceMin || price > priceMax)) return false
      if (teamFilter !== 'ALL' && String(p.team) !== teamFilter) return false
      const own = num(p, 'selected_by_percent') ?? 0
      if (ownership === 'template' && own < 20) return false
      if (ownership === 'differential' && own >= 10) return false
      if (nailedOnly) {
        const sr = num(p, 'season_start_rate')
        const m90 = num(p, 'season_mins90_rate')
        // Nailed = starts nearly everything, or plays full shifts when fit.
        if (!((sr ?? 0) >= 0.85 || ((sr ?? 0) >= 0.55 && (m90 ?? 0) >= 0.75))) return false
      }
      return true
    }
  }, [priceMin, priceMax, teamFilter, ownership, nailedOnly])

  const filtersOn = priceMin > PRICE_FLOOR || priceMax < PRICE_CEIL || teamFilter !== 'ALL' || ownership !== 'ALL' || nailedOnly

  /* Transfers live in the daily availability feed rather than the ratings
     build, so they get merged onto the row before ranking. Both directions are
     kept: net alone hides the story, because a player on +118k in and −42k out
     is contested while one on +76k in and nothing out is a consensus buy. */
  const withTransfers = useMemo(() => ratings.map((r) => {
    const p = availFor(avail, num(r, 'element'), num(r, 'code'))
    const tin = p?.tin ?? 0
    const tout = p?.tout ?? 0
    return { ...r, _tin: tin, _tout: tout, _tnet: tin - tout, _dprice: (p?.dprice ?? 0) / 10, _own: p?.own ?? num(r, 'selected_by_percent') ?? 0 }
  }), [ratings, avail])

  const view: TabView | null = useMemo(() => {
    // Leaderboards rank only players with enough minutes to earn a rating.
    // But when the user searches by name, widen to the full pool so newly
    // promoted clubs and new signings — who have no rating yet (shown N/A) —
    // are still findable and clickable through to their profile.
    const seasonOk = (query ? ratings : ratings.filter((p) => bool(p, 'season_ok'))).filter(passesFilters)
    const applyPos = (rows: Row[]) => (pos === 'ALL' ? rows : rows.filter((p) => p.position === pos))

    switch (tab) {
      case 'top-rated': {
        const rows = rankedPool(applyPos(seasonOk), 'season_overall_score', query)
        return {
          columns: [
            rankCol(),
            playerCol,
            posCol,
            teamCol,
            priceCol,
            scoreCol('season_overall_score', 'Season Rating', TOOLTIPS.overall as string, 'Sea'),
            windowScoreCol('gw4_overall_score', '4GW Rating', 'The same composite rating measured over the last 4 gameweeks only — a form snapshot.', '4GW'),
            numCol('season_total_points', 'Pts', 'Total FPL points scored this season.', 0, 'Pts'),
            ppgCol(rows),
            xptsCol,
          ],
          rows,
        }
      }
      case 'goal-threats': {
        const att = seasonOk.filter((p) => p.position === 'MID' || p.position === 'FWD')
        const filtered = pos === 'MID' || pos === 'FWD' ? att.filter((p) => p.position === pos) : att
        const rows = rankedPool(filtered, 'season_goal_score', query, ['season_m_npxg'])
        return {
          columns: [
            rankCol(),
            playerCol,
            posCol,
            teamCol,
            scoreCol('season_goal_score_norm', 'Goal Threat', TOOLTIPS.goal as string, 'Thr'),
            numCol('season_total_xg', 'xG', 'Total expected goals this season (FPL).', 1, 'xG'),
            numCol('season_m_xg', 'xG/90', 'Expected goals per 90 minutes — the core of the goal-threat rating.', 2, 'xG/90'),
            numCol('season_m_npxg', 'npxG/90', 'Non-penalty expected goals per 90 (Understat) — threat stripped of penalties.', 2, 'npxG'),
            numCol('season_m_box_shots', 'Box Sh/90', 'Shots taken from inside the box per 90 minutes.', 1, 'Box'),
            pctCol('season_m_sot_rate', 'SoT%', 'Share of this player’s shots that are on target.', 'SoT%'),
            { ...numCol('season_m_shot_quality', 'Shot Q', TOOLTIPS.shot_quality as string, 3), mobileHide: true },
          ],
          rows,
        }
      }
      case 'creators': {
        const att = seasonOk.filter((p) => p.position === 'MID' || p.position === 'FWD')
        const filtered = pos === 'MID' || pos === 'FWD' ? att.filter((p) => p.position === pos) : att
        const rows = rankedPool(filtered, 'season_creative_score', query, ['season_m_xa'])
        return {
          columns: [
            rankCol(),
            playerCol,
            posCol,
            teamCol,
            scoreCol('season_creative_score_norm', 'Creativity', TOOLTIPS.creative as string, 'Cre'),
            numCol('season_total_xa', 'xA', 'Total expected assists this season (FPL).', 1, 'xA'),
            numCol('season_m_xa', 'xA/90', 'Expected assists per 90 minutes — the core of the creativity rating.', 2, 'xA/90'),
            numCol('season_m_big_chances', 'Big Ch/90', 'Big chances created per 90 minutes.', 2, 'Big'),
            numCol('season_m_creativity_depth', 'xGChain/90', TOOLTIPS.creativity_depth as string, 2, 'Chain'),
            numCol('season_m_set_piece', 'Set P/90', TOOLTIPS.set_piece as string, 2, 'SetP'),
          ],
          rows,
        }
      }
      case 'clean-sheets': {
        const def = seasonOk.filter((p) => p.position === 'DEF')
        const rows = rankedPool(def, 'season_cs_score', query, ['season_m_cs_rate'])
        return {
          columns: [
            rankCol(),
            playerCol,
            teamCol,
            priceCol,
            scoreCol('season_cs_score_norm', 'Clean Sheet', TOOLTIPS.cs as string, 'CS'),
            pctCol('season_m_cs_rate', 'CS%', 'Share of appearances that ended in a clean sheet.', 'CS%'),
            numCol('season_m_xgc', 'xGC/90', 'Expected goals conceded per 90 while on the pitch — lower is better.', 2, 'xGC'),
            scoreCol('season_dc_score_norm', 'Def Con', TOOLTIPS.dc as string, 'DC'),
            scoreCol('season_overall_score', 'Overall', TOOLTIPS.overall as string, 'Ovr'),
          ],
          rows,
        }
      }
      case 'goalkeepers': {
        const gk = seasonOk.filter((p) => p.position === 'GKP')
        const rows = rankedPool(gk, 'season_overall_score', query)
        return {
          columns: [
            rankCol(),
            playerCol,
            teamCol,
            priceCol,
            scoreCol('season_overall_score', 'Rating', TOOLTIPS.overall as string, 'Rat'),
            scoreCol('season_cs_score_norm', 'Clean Sheet', TOOLTIPS.cs as string, 'CS'),
            scoreCol('season_save_score_norm', 'Shot Stop', TOOLTIPS.save as string, 'Stop'),
            pctCol('season_m_cs_rate', 'CS%', 'Share of appearances that ended in a clean sheet.', 'CS%'),
            numCol('season_m_xgc', 'xGC/90', 'Expected goals conceded per 90 while on the pitch — lower is better.', 2, 'xGC'),
            numCol('season_m_saves', 'Saves/90', 'Saves per 90 minutes.', 1, 'Sv'),
            numCol('season_m_prevented', 'Prev/90', 'Goals prevented vs expected per 90 (shot-stopping edge).', 2, 'Prev'),
          ],
          rows,
        }
      }
      case 'def-con': {
        const out = seasonOk.filter((p) => p.position === 'DEF' || p.position === 'MID' || p.position === 'FWD')
        const filtered = pos !== 'ALL' && pos !== 'GKP' ? out.filter((p) => p.position === pos) : out
        const rows = rankedPool(filtered, 'season_dc_score', query, ['season_m_dc_hit', 'season_m_mins90_rate'])
        return {
          columns: [
            rankCol(),
            playerCol,
            posCol,
            teamCol,
            scoreCol('season_dc_score_norm', 'Def Con', TOOLTIPS.dc as string, 'DC'),
            pctCol('season_m_dc_hit', 'DC Hit%', 'How often the player hits FPL’s defensive-contribution threshold (2 pts): 10 CBIT for defenders, 12 incl. recoveries for MID/FWD.', 'Hit%'),
            numCol('season_m_tackles', 'Tkl/90', 'Tackles per 90 minutes.', 1, 'Tkl'),
            numCol('season_m_cbi', 'CBI/90', 'Clearances, blocks and interceptions per 90 minutes.', 1, 'CBI'),
            numCol('season_m_recoveries', 'Rec/90', 'Ball recoveries per 90. Counts toward the DC threshold for MID/FWD only — not defenders.', 1, 'Rec'),
          ],
          rows,
        }
      }
      case 'value': {
        const rows = rankedPool(applyPos(seasonOk), 'season_value_score', query)
        return {
          columns: [
            rankCol(),
            playerCol,
            posCol,
            teamCol,
            priceCol,
            scoreCol('season_value_score_norm', 'Value Rating', TOOLTIPS.value as string, 'Val'),
            numCol('season_total_points', 'Pts', 'Total FPL points scored this season.', 0, 'Pts'),
            ppgCol(rows),
            xptsCol,
          ],
          rows,
        }
      }
      case 'transfers': {
        const byEl = new Map(withTransfers.map((r) => [r.element, r]))
        const merged = applyPos(seasonOk).map((r) => byEl.get(num(r, 'element') ?? -1) ?? r)
        const rows = rankedPool(merged.filter((r) => (num(r, '_tin') ?? 0) + (num(r, '_tout') ?? 0) > 0), '_tnet', query)
        if (!rows.length) return null
        return {
          columns: [
            rankCol(),
            playerCol,
            posCol,
            teamCol,
            priceCol,
            {
              key: '_tin', header: 'In', align: 'right', sortValue: (r) => num(r, '_tin') ?? 0,
              cell: (r) => <span className="font-num font-bold text-good tabular-nums">+{(num(r, '_tin') ?? 0).toLocaleString()}</span>,
              mobileCell: (r) => <span className="font-num font-bold text-good tabular-nums">{kilo(num(r, '_tin') ?? 0)}</span>,
              tip: 'Managers who have brought him in this gameweek.',
            },
            {
              key: '_tout', header: 'Out', align: 'right', sortValue: (r) => num(r, '_tout') ?? 0,
              cell: (r) => <span className="font-num font-bold text-bad tabular-nums">−{(num(r, '_tout') ?? 0).toLocaleString()}</span>,
              mobileCell: (r) => <span className="font-num font-bold text-bad tabular-nums">{kilo(num(r, '_tout') ?? 0)}</span>,
              tip: 'Managers who have sold him this gameweek. Sort by this to find the exodus before it shows up in the price.',
            },
            {
              key: '_tnet', header: 'Net', align: 'right', sortValue: (r) => num(r, '_tnet') ?? 0,
              cell: (r) => {
                const v = num(r, '_tnet') ?? 0
                return <span className={`font-num font-extrabold tabular-nums ${v > 0 ? 'text-good' : v < 0 ? 'text-bad' : 'text-ink-3'}`}>{v > 0 ? '+' : v < 0 ? '−' : ''}{Math.abs(v).toLocaleString()}</span>
              },
              // Net keeps its sign: it is the one column whose direction is not
              // already in the header.
              mobileCell: (r) => {
                const v = num(r, '_tnet') ?? 0
                return <span className={`font-num font-extrabold tabular-nums ${v > 0 ? 'text-good' : v < 0 ? 'text-bad' : 'text-ink-3'}`}>{v > 0 ? '+' : v < 0 ? '−' : ''}{kilo(Math.abs(v))}</span>
              },
              tip: 'In minus out. The direction of the market on him this week.',
            },
            {
              key: '_dprice', header: 'Price move', mobileHeader: 'Δ£', align: 'right', sortValue: (r) => num(r, '_dprice') ?? 0,
              cell: (r) => {
                const v = num(r, '_dprice') ?? 0
                if (!v) return <span className="text-ink-3">—</span>
                return <span className={`font-num font-bold tabular-nums ${v > 0 ? 'text-good' : 'text-bad'}`}>{v > 0 ? '▲' : '▼'} £{Math.abs(v).toFixed(1)}m</span>
              },
              tip: 'How far his price has already moved this gameweek. FPL does not publish the threshold for the next move, so this is what has happened rather than a forecast.',
            },
            numCol('_own', 'Owned', "Share of managers who own him, as FPL had it this morning — the base the transfers above are moving.", 1, 'Own'),
          ],
          rows,
        }
      }
      case 'next4': {
        if (!next4) return null
        // Stamp the projection onto the rows so the table can sort on it.
        // Rows only carry scalars, so the per-gameweek breakdown stays in the
        // memo's map and the columns read it back by element.
        const withXp: Row[] = []
        for (const r of applyPos(seasonOk)) {
          const proj = next4.byEl.get(num(r, 'element') ?? -1)
          if (proj) withXp.push({ ...r, _n4: proj.total, _n4games: proj.games, _n4span: next4.gws.length })
        }
        if (!withXp.length) return null
        const rows = rankedPool(withXp, '_n4', query)
        const perOf = (r: Row, i: number) => next4.byEl.get(num(r, 'element') ?? -1)?.per[i] ?? null
        const gwCol = (i: number): Column<Row> => ({
          key: `n4g${i}`,
          header: `GW${next4.gws[i]}`,
          tip: `Projected points in gameweek ${next4.gws[i]} alone. A blank week reads 0.00; a double counts both games.`,
          align: 'right',
          sortValue: (r) => perOf(r, i),
          cell: (r) => {
            const v = perOf(r, i)
            return v == null ? dash : <span className={`font-num tabular-nums ${v === 0 ? 'text-ink-3' : ''}`}>{v.toFixed(2)}</span>
          },
        })
        return {
          columns: [
            rankCol(),
            playerCol,
            posCol,
            teamCol,
            priceCol,
            {
              key: '_n4',
              header: `xP next ${next4.gws.length}`,
              mobileHeader: `xP${next4.gws.length}`,
              tip: `Projected FPL points across the next ${next4.gws.length} gameweeks, added up from the same per-gameweek model used on GW Preview and the Squad Builder. Availability is applied week by week, so an injury that clears in three weeks costs a player three of them.`,
              align: 'right',
              sortValue: (r) => num(r, '_n4'),
              cell: (r) => <span className="font-num font-semibold tabular-nums text-accent">{(num(r, '_n4') ?? 0).toFixed(2)}</span>,
            },
            ...next4.gws.map((_, i) => gwCol(i)),
            {
              key: 'games',
              header: 'Games',
              mobileHide: true,
              tip: 'How many of these gameweeks his club actually plays in — blanks and doubles are why two players on the same form project differently.',
              align: 'right',
              sortValue: (r) => num(r, '_n4games'),
              cell: (r) => {
                const g = num(r, '_n4games') ?? 0
                return <span className={`font-num tabular-nums ${g < next4.gws.length ? 'text-warn' : 'text-ink-2'}`}>{g}</span>
              },
            },
            scoreCol('season_overall_score', 'Season Rating', TOOLTIPS.overall as string, 'Sea'),
          ],
          rows,
        }
      }
      default:
        return null
    }
    // Everything the switch statement closes over has to be listed, not just
    // the obvious inputs. passesFilters carries the price band, club,
    // ownership and nailed switch; next4 carries the projection horizon.
    // Leaving either out freezes the table on whatever was set the last time
    // the tab or the search changed — which is exactly how the filter bar and
    // then the xPoints horizon each came to be visibly inert.
  }, [tab, pos, query, ratings, passesFilters, withTransfers, next4])

  // Per-tab narrative lead line.
  const narrative = useMemo(() => buildNarrative(tab, view?.rows[0] ?? null, metrics, seasonToDate), [tab, view, metrics, seasonToDate])

  if (!data) {
    return (
      <PageShell>
        <SectionBanner imgKey="players" title="Players" subtitle="Every player ranked — search, sort and dig into the numbers" />
        <PageSkeleton error={coreError} />
      </PageShell>
    )
  }

  const showSearch = tab !== 'form'
  const showFilters = true

  return (
    <PageShell>
      <SectionBanner imgKey="players" title="Players" subtitle="Every player ranked — search, sort and dig into the numbers" />
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

      {showFilters && (
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          {posOptions.length > 1 ? <PillGroup options={posOptions} active={pos} onChange={setPos} /> : null}
          {/* The horizon belongs to the xPoints board alone — every other tab
              is measuring what has already happened. */}
          {tab === 'next4' && (
            <PillGroup
              options={XP_WINDOWS.map((w) => ({ id: String(w), label: `Next ${w}` }))}
              active={String(xpWindow)}
              onChange={(id) => setXpWindow(Number(id) as (typeof XP_WINDOWS)[number])}
            />
          )}
          <ViewChips options={[{ id: 'table', label: 'Table' }, { id: 'compare', label: 'Chart' }]} active={viewMode} onChange={setViewMode} />
          <button
            onClick={() => setFiltersOpen((o) => !o)}
            className={`min-h-9 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${
              filtersOn ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
            }`}
            aria-expanded={filtersOpen}
          >
            Filters{filtersOn ? ' ·' : ''}
          </button>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          {showSearch && (
            <div className="relative w-full sm:w-64">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3">
                <Icon name="search" size={15} />
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search players…"
                className="min-h-10 w-full rounded-lg border border-line-mid bg-surface-1 pr-8 pl-9 text-sm text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2 -translate-y-1/2 px-1 text-lg leading-none text-ink-3 hover:text-ink"
                >
                  ×
                </button>
              )}
            </div>
          )}
          <button
            onClick={() => navigate('/compare')}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-line-mid px-4 text-sm font-semibold text-ink transition-colors hover:border-line-strong"
          >
            <Icon name="users" size={15} /> Compare
          </button>
        </div>
      </div>
      )}

      {showFilters && filtersOpen && (
        <FilterBar
          teams={allTeams}
          priceMin={priceMin} priceMax={priceMax} setPriceMin={setPriceMin} setPriceMax={setPriceMax}
          teamFilter={teamFilter} setTeamFilter={setTeamFilter}
          ownership={ownership} setOwnership={setOwnership}
          nailedOnly={nailedOnly} setNailedOnly={setNailedOnly}
          active={filtersOn}
          onReset={() => { setPriceMin(PRICE_FLOOR); setPriceMax(PRICE_CEIL); setTeamFilter('ALL'); setOwnership('ALL'); setNailedOnly(false) }}
        />
      )}

      {viewMode === 'compare' ? (
        (() => {
          // Single-position tabs (Goalkeepers, Clean Sheets) imply the
          // position even though their pill filter is hidden.
          const comparePos = tab === 'goalkeepers' ? 'GKP' : tab === 'clean-sheets' ? 'DEF' : pos
          const lenses = compareLenses(comparePos === 'GKP' ? 'GKP' : comparePos === 'DEF' ? 'DEF' : 'ATT')
          // The keeper-only lenses vanish when you switch position — fall back
          // to price × rating rather than rendering an empty chart.
          const activeLens = lenses.some((l) => l.id === compareLens) ? compareLens : 'value'
          return (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {lenses.map((l) => (
              <span key={l.id} className="flex items-center gap-1">
                <button
                  onClick={() => setCompareLens(l.id)}
                  className={`min-h-9 rounded-full border px-3 text-[13px] font-semibold transition-colors ${
                    activeLens === l.id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
                  }`}
                >
                  {l.label}
                </button>
                <InfoTip text={l.tip} />
              </span>
            ))}
          </div>
          <Exportable title={`${comparePos === 'ALL' ? 'Players' : comparePos} — ${activeLens === 'value' ? 'price vs rating' : activeLens === 'roles' ? 'role map' : activeLens === 'triple' ? 'three-way map' : activeLens === 'workload' ? 'keeper workload' : 'momentum'}`}>
            <PlayerCompare
              rows={(comparePos === 'ALL' ? ratings : ratings.filter((p) => p.position === comparePos)).filter((p) => bool(p, 'season_ok') && passesFilters(p)) as RatingRow[]}
              lens={activeLens}
              highlightName={query || null}
              onPlayer={toPlayer}
            />
          </Exportable>
        </>
          )
        })()
      ) : tab === 'form' ? (
        <FormTables rows={seasonToDate} pos={pos} onPlayer={toPlayer} />
      ) : view ? (
        view.rows.length ? (
          <Exportable title={TABS.find((t) => t.id === tab)?.label ?? 'Players'}>
            <SortableTable
              rows={view.rows}
              columns={view.columns}
              initialSort="rank"
              initialDir="asc"
              rowKey={(r) => String(r.element)}
              onRowClick={(r) => toPlayer(String(r.web_name), num(r, 'code'))}
              featured={!query}
            />
          </Exportable>
        ) : (
          <EmptyState icon={<Icon name="search" size={44} />}>
            {query
              ? <>No players match “{query}” in this ranking. Try another tab or clear the search.</>
              : tab === 'transfers' && !filtersOn
                ? <>No transfer activity yet. FPL only publishes transfers in and out once the gameweek opens, so this fills in after the first deadline passes.</>
                : <>No players match these filters. Try widening the price band or clearing the filters.</>}
          </EmptyState>
        )
      ) : (
        <EmptyState icon={<Icon name="calendar" size={44} />}>
          Next 4 GW ratings aren't available yet — they appear once upcoming fixtures exist for the season.
        </EmptyState>
      )}
    </PageShell>
  )
}

/** xGI movement is read on its own merits: green when the underlying numbers
 *  are rising, red when they are falling, muted when the shift is noise. */
const xgiTone = (v: number | null) => (v == null || Math.abs(v) < 0.05 ? 'text-ink-3' : v > 0 ? 'text-good' : 'text-bad')
/** Six figures is 68px of a 368px row, and nobody reads a transfer count to the
 *  individual manager on a phone. Above a million it goes to "2.3m", which is
 *  narrower still — a bandwagon makes the column smaller, not wider. */
const kilo = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : v >= 10000 ? `${Math.round(v / 1000)}k` : v.toLocaleString())
const fmtDelta = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}`)

function FormTables({ rows, pos, onPlayer }: { rows: Row[]; pos: string; onPlayer: (n: string, code?: number | null) => void }) {
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
    <th className={`px-1.5 py-2 font-semibold lg:px-3 ${right ? 'text-right' : 'text-left'}`}>
      <span className={`inline-flex items-center gap-1 ${right ? 'flex-row-reverse' : ''}`}>
        {label}
        <span className="hidden lg:inline-flex"><InfoTip text={tip} /></span>
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
              <th className="px-1.5 py-2 text-left font-semibold lg:px-3">Player</th>
              <th className="hidden px-2.5 py-2 text-left font-semibold lg:table-cell lg:px-3">Team</th>
              <th className="hidden px-2.5 py-2 text-left font-semibold lg:table-cell lg:px-3">Pos</th>
              {th('Season P90', 'Average FPL points per 90 minutes across the whole season.')}
              {th('4GW P90', 'Average FPL points per 90 minutes over the last 4 gameweeks.')}
              {th('Delta', 'Last-4-gameweek points-per-90 minus the season baseline — the size of the streak.')}
              {th('xGI/90', 'Expected goal involvements per 90 across the season: expected goals plus expected assists. The baseline a streak is measured against.')}
              {th('4GW xGI', 'Expected goal involvements per 90 over the last 4 gameweeks.')}
              {th('xGI Δ', 'Last-4-gameweek xGI per 90 minus the season baseline. This is the column that separates a real change from a hot run of finishing: points up and xGI up is a player doing more, points up and xGI flat is variance.')}
            </tr>
          </thead>
          <tbody>
            {list.map((p) => (
              <tr
                key={String(p.element)}
                onClick={() => onPlayer(String(p.web_name), num(p, 'code'))}
                className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2/70"
              >
                <td className="px-1.5 py-2 lg:px-3">
                  <span className="block max-w-[104px] lg:max-w-none">
                    <PlayerNameCell name={String(p.web_name)} code={num(p, 'code')} />
                    <span className="mt-px block text-[9px] leading-tight font-semibold text-ink-3 lg:hidden">
                      {String(p.position)} · {String(p.team)}
                      {num(p, 'price') != null ? ` · £${num(p, 'price')}m` : ''}
                    </span>
                  </span>
                </td>
                <td className="hidden px-2.5 py-2 lg:table-cell lg:px-3">
                  <TeamCell team={String(p.team)} />
                </td>
                <td className="hidden px-2.5 py-2 lg:table-cell lg:px-3">
                  <PosBadge pos={String(p.position)} />
                </td>
                <td className="px-1.5 py-2 text-right font-num tabular-nums lg:px-3">
                  {(num(p, 'pts_per90_season') ?? 0).toFixed(2)}
                </td>
                <td className="px-1.5 py-2 text-right font-num tabular-nums lg:px-3">
                  {(num(p, 'pts_per90_4gw') ?? 0).toFixed(2)}
                </td>
                <td className={`px-1.5 py-2 text-right font-num tabular-nums lg:px-3 ${deltaClass}`}>
                  {sign ? '+' : ''}
                  {(num(p, 'pts_delta') ?? 0).toFixed(2)}
                </td>
                <td className="px-1.5 py-2 text-right font-num tabular-nums text-ink-2 lg:px-3">
                  {(num(p, 'xgi_per90_season') ?? 0).toFixed(2)}
                </td>
                <td className="px-1.5 py-2 text-right font-num tabular-nums text-ink-2 lg:px-3">
                  {(num(p, 'xgi_per90_4gw') ?? 0).toFixed(2)}
                </td>
                {/* Coloured on its own sign rather than the streak's: a hot run
                    with the underlying numbers going the other way is exactly
                    the thing this column exists to show. */}
                <td className={`px-1.5 py-2 text-right font-num tabular-nums lg:px-3 ${xgiTone(num(p, 'xgi_delta'))}`}>
                  {fmtDelta(num(p, 'xgi_delta'))}
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

/** The lead line above each leaderboard.
 *
 *  `p` is the table's own first row rather than a leader re-derived here. That
 *  is the whole point: the two used to be worked out separately, so a tie at
 *  the 99.0 ceiling — or simply a filter the reader had set — could leave the
 *  sentence crediting one player while the table ranked another first. Reading
 *  row one means the claim can never disagree with what is on screen. */
function buildNarrative(tab: string, p: Row | null, metrics: Row[], seasonToDate: Row[]): React.ReactNode {
  const lead = (arr: Row[]) => (arr.length ? arr[0] : null)
  const metricOf = (el: number | null | undefined) => metrics.find((x) => num(x, 'element') === el)
  const b = (s: string) => <strong className="text-ink">{s}</strong>

  switch (tab) {
    case 'top-rated': {
      if (!p) return null
      const ppg = num(p, 'season_ppg')
      return (
        <>
          {b(String(p.web_name))} leads the overall ratings — {ppg ? `${ppg.toFixed(1)} points per game` : 'the strongest all-round profile'} at £{p.price}m. Ratings are availability-adjusted expected points on one absolute scale. Tap any row for the full breakdown.
        </>
      )
    }
    case 'goal-threats': {
      if (!p) return null
      const m = metricOf(num(p, 'element'))
      const share = m && num(m, 'xg_share_season')
      return (
        <>
          {b(String(p.web_name))} tops the goal-threat rating{share ? <> — taking {b(`${(share * 100).toFixed(0)}%`)} of {p.team}'s xG</> : ''}. The columns show the ingredients: sustainable threat comes from box shots and shot quality, not long-range volume.
        </>
      )
    }
    case 'creators': {
      if (!p) return null
      const m = metricOf(num(p, 'element'))
      const share = m && num(m, 'xa_share_season')
      return (
        <>
          {b(String(p.web_name))} creates more than anyone{share ? <> — {b(`${(share * 100).toFixed(0)}%`)} of {p.team}'s xA runs through them</> : ''}. Assist points follow chance creation: xA, big chances and set-piece delivery.
        </>
      )
    }
    case 'clean-sheets': {
      if (!p) return null
      return (
        <>
          {b(String(p.web_name))} anchors the strongest defensive numbers in the league. Clean-sheet ratings weigh xGC, not just results — they find defences that deserve their record. (Keepers have their own tab.)
        </>
      )
    }
    case 'goalkeepers': {
      if (!p) return null
      return (
        <>
          {b(String(p.web_name))} is the top-rated goalkeeper — clean sheets and shot-stopping combined. The columns split the two: some keepers earn on saves behind a busy defence, others on clean sheets behind a stingy one.
        </>
      )
    }
    case 'def-con': {
      if (!p) return null
      const hit = num(p, 'season_m_dc_hit')
      return (
        <>
          {b(String(p.web_name))} tops the defensive-contribution rating{hit != null ? <>, hitting the threshold in {b(`${(hit * 100).toFixed(0)}%`)} of his appearances</> : ''} — the 2-point bonus for defensive work. Defenders count CBIT (10); midfielders and forwards also count recoveries (12).
        </>
      )
    }
    case 'value': {
      if (!p) return null
      return (
        <>
          {b(String(p.web_name))} is the best points-per-pound in the game at £{p.price}m. Value picks free up budget for premiums elsewhere.
        </>
      )
    }
    case 'form': {
      // Form ranks off the season-to-date feed, not the ratings table, so this
      // one leader really is derived here.
      const hot = lead(seasonToDate.filter((x) => str(x, 'streak') === '🔥 Hot').sort((a, b) => (num(b, 'pts_delta') ?? 0) - (num(a, 'pts_delta') ?? 0)))
      if (!hot) return null
      return (
        <>
          {b(String(hot.web_name))} is the hottest player right now — {b(`+${(num(hot, 'pts_delta') ?? 0).toFixed(1)} pts/90`)} above their season baseline. Check the xGI before chasing: form backed by underlying numbers sticks.
        </>
      )
    }
    case 'next4': {
      if (!p) return null
      const tot = num(p, '_n4')
      const span = num(p, '_n4span') ?? 4
      return (
        <>
          {b(String(p.web_name))} is projected to score more than anyone over the next {span} {span === 1 ? 'gameweek' : 'gameweeks'}{tot != null ? <> — {b(`${tot.toFixed(1)} points`)}</> : ''}. Each week is priced separately from that fixture's goal expectancies and the player's own rates, then added up; blanks and doubles are counted, not averaged away.
        </>
      )
    }
    default:
      return null
  }
}
