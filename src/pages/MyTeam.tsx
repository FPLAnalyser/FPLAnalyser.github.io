import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, PageShell, EmptyState } from '../components/PageShell'
import { SkeletonBlock } from '../components/Skeleton'
import { StarRating } from '../components/StarRating'
import { Tabs, type TabDef } from '../components/Tabs'
import { TeamBadge } from '../components/badges'
import { FifaCard } from '../components/FifaCard'
import { Icon, type IconName } from '../components/Icon'
import { useCore } from '../lib/useData'
import { str } from '../lib/rows'
import { teamFullNames, avgRatingField } from '../lib/util'
import { fplFetch, getCurrentGwFallback, fetchEntry, fetchEntryHistory, fetchLeagueStandings, fetchPicksCached } from '../lib/api'
import { buildContext, runRules, SEVERITY_META } from '../lib/insights/engine'
import { RULES } from '../lib/insights/rules'
import type { CoreData, RatingRow, Row } from '../lib/types'

const TEAM_ID_KEY = 'fpl_team_id'

/* eslint-disable @typescript-eslint/no-explicit-any */
interface LoadedTeam { picksData: any; gw: number; historyData: any; entryData: any; teamId: string }

export default function MyTeam() {
  const { data } = useCore()
  const [teamId, setTeamId] = useState(() => { try { return localStorage.getItem(TEAM_ID_KEY) ?? '' } catch { return '' } })
  const [state, setState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle')
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState<LoadedTeam | null>(null)
  const autoTried = useRef(false)

  const load = async (id: string) => {
    if (!id || !/^\d+$/.test(id)) { setState('error'); setError('Please enter a valid numeric Team ID'); return }
    setState('loading')
    try {
      const entryData = await fetchEntry(id)
      const gw = entryData.current_event || (await getCurrentGwFallback())
      const [picksRes, historyData] = await Promise.all([
        fplFetch(`https://fantasy.premierleague.com/api/entry/${id}/event/${gw}/picks/`),
        fetchEntryHistory(id),
      ])
      const picksData = await picksRes.json()
      try { localStorage.setItem(TEAM_ID_KEY, id) } catch { /* ignore */ }
      setLoaded({ picksData, gw, historyData, entryData, teamId: id })
      setState('loaded')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }

  // Auto-load the saved team once on mount.
  useEffect(() => {
    if (autoTried.current) return
    autoTried.current = true
    const saved = (() => { try { return localStorage.getItem(TEAM_ID_KEY) } catch { return null } })()
    if (saved) load(saved)
  }, [])

  return (
    <PageShell>
      <PageHeader title="My Team" subtitle="Enter your FPL Team ID for your squad, ratings and a personalised weekly report" />

      <div className="mb-2 flex max-w-md gap-2">
        <input
          type="text"
          inputMode="numeric"
          value={teamId}
          placeholder="Enter your FPL Team ID…"
          className="min-h-11 flex-1 rounded-lg border border-line-mid bg-surface-1 px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-accent"
          onChange={(e) => setTeamId(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load(teamId.trim())}
        />
        <button className="min-h-11 rounded-lg bg-accent px-5 font-semibold text-accent-contrast transition-colors hover:bg-accent-strong" onClick={() => load(teamId.trim())}>
          Load
        </button>
      </div>
      <p className="mb-8 text-xs text-ink-3">
        Find your Team ID in the URL when viewing your team on the official FPL site — e.g. fantasy.premierleague.com/entry/<strong>1234567</strong>/event/1
      </p>

      {state === 'idle' && <EmptyState icon={<Icon name="users" size={44} />}>Enter your Team ID to load your squad</EmptyState>}
      {state === 'loading' && <div className="space-y-3"><SkeletonBlock /><SkeletonBlock /></div>}
      {state === 'error' && (
        <EmptyState icon={<Icon name="alert" size={44} />}>
          Could not load your team. Double-check the Team ID, or your browser/network may be blocking the request to the FPL API.
          <div className="mt-3 font-num text-[11px] break-words text-ink-3">{error}</div>
        </EmptyState>
      )}
      {state === 'loaded' && loaded && data && <Squad loaded={loaded} data={data} />}
    </PageShell>
  )
}

function SectionHeader({ children }: { children: ReactNode }) {
  return <h2 className="mt-8 mb-3 text-sm font-semibold tracking-wide text-ink-2 uppercase first:mt-0">{children}</h2>
}

interface Enriched { pick: any; r: RatingRow | undefined; p4: Row | undefined; std: Row | undefined }

function Squad({ loaded, data }: { loaded: LoadedTeam; data: CoreData }) {
  const { picksData, gw, historyData, entryData, teamId } = loaded
  const [tab, setTab] = useState<SquadTab>('squad')
  const picks: any[] = picksData.picks || []
  const entryHistory = picksData.entry_history || {}

  const enriched: Enriched[] = useMemo(
    () => picks.map((pick) => ({
      pick,
      r: data.ratings.find((x) => x.element === pick.element),
      p4: data.personas4.find((x) => x.element === pick.element),
      std: data.seasonToDate.find((x) => x.element === pick.element),
    })),
    [picks, data],
  )

  if (!picks.length) return <EmptyState icon={<Icon name="alert" size={44} />}>No squad data found for that Team ID / gameweek {gw}.</EmptyState>

  const startingXI = enriched.filter((e) => e.pick.position <= 11).sort((a, b) => a.pick.position - b.pick.position)
  const bench = enriched.filter((e) => e.pick.position > 11).sort((a, b) => a.pick.position - b.pick.position)
  const startingRated = startingXI.map((e) => e.r).filter((r): r is RatingRow => !!r)

  const overallAvg = avgRatingField(startingRated, 'season_overall_rating')
  const reliabilityAvg = avgRatingField(startingRated, 'season_reliability_score_rating')
  const goalAvg = avgRatingField(startingRated.filter((r) => r.position === 'MID' || r.position === 'FWD'), 'season_goal_score_rating')
  const csAvg = avgRatingField(startingRated.filter((r) => r.position === 'GKP' || r.position === 'DEF'), 'season_cs_score_rating')
  const teamValue = entryHistory.value != null ? (entryHistory.value / 10).toFixed(1) : 'N/A'

  const posGroups: Enriched[][] = [
    startingXI.filter((e) => e.r?.position === 'GKP'),
    startingXI.filter((e) => e.r?.position === 'DEF'),
    startingXI.filter((e) => e.r?.position === 'MID'),
    startingXI.filter((e) => e.r?.position === 'FWD'),
    startingXI.filter((e) => !e.r),
  ]

  const ownedElements = new Set(picks.map((p) => p.element))
  const hasLeagues = ((entryData?.leagues?.classic) || []).length > 0

  return (
    <div>
      <div className="mb-5">
        <Tabs tabs={SQUAD_TABS(hasLeagues)} active={tab} onChange={(id) => setTab(id as SquadTab)} layoutId="myteam-tab" />
      </div>

      {tab === 'squad' ? (
        <>
          <SectionHeader>Team Ratings</SectionHeader>
          <div className="mb-2 flex flex-wrap gap-x-8 gap-y-5">
            <RatingStat label="Avg Overall Rating" node={<StarRating value={overallAvg} size={12} />} />
            <RatingStat label="Avg Reliability (XI)" node={<StarRating value={reliabilityAvg} size={12} />} />
            <RatingStat label="Avg Goal Threat (MID/FWD)" node={<StarRating value={goalAvg} size={12} />} />
            <RatingStat label="Avg Clean Sheet (GKP/DEF)" node={<StarRating value={csAvg} size={12} />} />
            <RatingStat label="Total Team Value" node={<span className="font-num text-lg font-semibold tabular-nums text-ink">£{teamValue}m</span>} />
          </div>

          <Report picksData={picksData} historyData={historyData} data={data} ownedElements={ownedElements} />

          <SectionHeader>Starting XI — Gameweek {gw}</SectionHeader>
          <p className="mb-3 -mt-1 text-sm text-ink-3">Your XI as FIFA-style cards — overall plus the sub-ratings that matter for each position. Tap a card for the full profile.</p>
          <div
            className="relative overflow-hidden rounded-3xl p-3 md:p-6"
            style={{
              background:
                'radial-gradient(120% 80% at 50% 0%, rgba(0,0,0,0) 40%, rgba(0,0,0,0.5) 100%), repeating-linear-gradient(90deg, #0e2117 0 9%, #10281c 9% 18%), linear-gradient(180deg, #10281c, #0c1c13)',
            }}
          >
            <PitchLines />
            <div className="relative flex flex-col gap-4 md:gap-6">
              {posGroups.map((rows, i) => rows.length > 0 && (
                <div key={i} className="flex flex-wrap justify-center gap-3 md:gap-4">
                  {rows.map((e, j) => <PlayerCardSlot key={j} e={e} />)}
                </div>
              ))}
            </div>
          </div>

          {bench.length > 0 && (
            <div className="mt-3 rounded-2xl border border-line bg-surface-1/60 p-3 md:p-4">
              <div className="mb-3 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Bench</div>
              <div className="flex flex-wrap justify-center gap-3 md:gap-4">
                {bench.map((e, j) => <PlayerCardSlot key={j} e={e} bench />)}
              </div>
            </div>
          )}
        </>
      ) : (
        <MiniLeague entryData={entryData} teamId={teamId} gw={gw} ownedElements={ownedElements} data={data} />
      )}
    </div>
  )
}

type SquadTab = 'squad' | 'league'
const SQUAD_TABS = (hasLeagues: boolean): TabDef[] =>
  hasLeagues ? [{ id: 'squad', label: 'Squad & Report' }, { id: 'league', label: 'Mini-League' }] : [{ id: 'squad', label: 'Squad & Report' }]

/**
 * Decorative half-pitch markings behind the Starting XI (own goal at the top,
 * halfway line + centre circle at the bottom). Stretches with the container.
 */
function PitchLines() {
  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 140"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <g fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5">
        <rect x="2" y="2" width="96" height="136" rx="1.5" />
        {/* penalty area + six-yard box (own goal at the top) */}
        <rect x="21" y="2" width="58" height="22" />
        <rect x="36" y="2" width="28" height="8.5" />
        {/* goal frame */}
        <rect x="42.5" y="0.7" width="15" height="1.3" stroke="rgba(255,255,255,0.4)" />
        {/* penalty spot + the D */}
        <circle cx="50" cy="17.5" r="0.7" fill="rgba(255,255,255,0.3)" stroke="none" />
        <path d="M 39 24 A 12.5 10.5 0 0 0 61 24" />
        {/* halfway line + centre circle */}
        <line x1="2" y1="138" x2="98" y2="138" />
        <path d="M 37 138 A 13.5 11.5 0 0 1 63 138" />
      </g>
    </svg>
  )
}

function RatingStat({ label, node }: { label: string; node: ReactNode }) {
  return (
    <div>
      <div>{node}</div>
      <div className="mt-1 text-[11px] tracking-wide text-ink-2 uppercase">{label}</div>
    </div>
  )
}

/**
 * One player slot in the formation — a full (compact) FIFA card that links to
 * the detail page, or a placeholder when the player has no rating row.
 */
function PlayerCardSlot({ e }: { e: Enriched; bench?: boolean }) {
  const navigate = useNavigate()
  const { pick, r, std } = e
  const wrap = 'w-[calc(50%-0.375rem)] sm:w-[224px] lg:w-[240px]'
  if (!r) {
    return <div className={`${wrap} grid place-items-center rounded-2xl border border-line bg-surface-2 p-4 text-center text-[11px] text-ink-3`}>ID {pick.element}</div>
  }
  return (
    <div className={wrap}>
      <FifaCard
        r={r}
        compact
        onClick={() => navigate(`/player?name=${encodeURIComponent(String(r.web_name))}`)}
        captain={pick.is_captain}
        viceCaptain={pick.is_vice_captain}
        streak={std ? str(std, 'streak') : ''}
      />
    </div>
  )
}

function Report({ picksData, historyData, data, ownedElements }: { picksData: any; historyData: any; data: CoreData; ownedElements: Set<number> }) {
  const insights = useMemo(() => {
    const ctx = buildContext(picksData, historyData, {
      ratings: data.ratings, personas4: data.personas4, seasonToDate: data.seasonToDate, metrics: data.metrics,
      playerForm: data.playerForm, priceRisk: data.priceRisk, personaShifts: data.personaShifts, teamMetrics: data.teamMetrics,
      benchmarks: data.benchmarks, replacementPool: data.replacementPool, fixtureEase: data.fixtureEase,
    })
    return runRules(RULES, ctx) as any[]
  }, [picksData, historyData, data])
  const navigate = useNavigate()

  // Insights name their subject somewhere in the card text; resolve it to a link
  // so tapping a report card jumps to the relevant player or team page. The
  // headline alone is not enough — several rules only name the player in the
  // body or evidence ("Your DEF group is underperforming … X is the weakest link").
  const ownedNames = useMemo(
    () => data.ratings.filter((r) => ownedElements.has(r.element)).map((r) => String(r.web_name)).sort((a, b) => b.length - a.length),
    [data.ratings, ownedElements],
  )
  const teamEntries = useMemo(() => Object.entries(teamFullNames), [])
  const resolveLink = (i: { headline?: string; body?: string; evidence?: string }): (() => void) | undefined => {
    const text = [i.headline, i.body, i.evidence]
      .filter(Boolean)
      .join(' · ')
      .replace(/<[^>]*>/g, '')
    const name = ownedNames.find((n) => n && text.includes(n))
    if (name) return () => navigate(`/player?name=${encodeURIComponent(name)}`)
    const byFull = teamEntries.find(([, full]) => text.includes(full))
    if (byFull) return () => navigate(`/teams?team=${byFull[0]}`)
    const byCode = teamEntries.find(([code]) => new RegExp(`\\b${code}\\b`).test(text))
    if (byCode) return () => navigate(`/teams?team=${byCode[0]}`)
    return undefined
  }

  if (!insights.length) {
    return (
      <>
        <SectionHeader>Your Report</SectionHeader>
        <div className="rounded-xl border border-line bg-surface-1/60 p-4" style={{ borderLeft: '3px solid var(--good)' }}>
          <div className="flex items-center gap-2 font-semibold text-ink"><span className="text-good"><Icon name="check" size={14} /></span> No alerts this week — your squad looks healthy</div>
          <div className="mt-1 text-sm text-ink-2">Every starter is minutes-secure and every position group is holding up against the league benchmarks. Check back after the next gameweek.</div>
        </div>
      </>
    )
  }

  const counts: Record<string, number> = {}
  insights.forEach((i) => { counts[i.severity] = (counts[i.severity] || 0) + 1 })
  const chips = (['act', 'warn', 'info', 'good'] as const).filter((k) => counts[k]).map((k) => ({ k, meta: SEVERITY_META[k], n: counts[k] }))

  return (
    <>
      <SectionHeader>Your Report — {counts.act || 0} action{(counts.act || 0) === 1 ? '' : 's'} this week</SectionHeader>
      <div className="mb-4 flex flex-wrap gap-2">
        {chips.map(({ k, meta, n }) => (
          <span key={k} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium" style={{ borderColor: meta.color, color: meta.color }}>
            <Icon name={meta.iconId as IconName} size={12} /> {n} {meta.label}
          </span>
        ))}
      </div>
      <div className="space-y-3">
        {insights.map((i, idx) => {
          const meta = SEVERITY_META[i.severity] || SEVERITY_META.info
          const go = resolveLink(i)
          return (
            <div
              key={idx}
              onClick={go}
              className={`rounded-xl border border-line bg-surface-1/60 p-4 ${go ? 'cursor-pointer transition-colors hover:border-line-mid hover:bg-surface-2/50' : ''}`}
              style={{ borderLeft: `3px solid ${meta.color}` }}
            >
              <div className="flex items-center gap-2 font-semibold text-ink">
                <span style={{ color: meta.color }}><Icon name={meta.iconId as IconName} size={14} /></span>
                <span className="flex-1" dangerouslySetInnerHTML={{ __html: i.headline }} />
                {go && <span className="text-ink-3"><Icon name="trend-up" size={14} className="rotate-45" /></span>}
              </div>
              <div className="mt-1 text-sm text-ink-2" dangerouslySetInnerHTML={{ __html: i.body }} />
              {i.evidence && <div className="mt-1.5 text-xs text-ink-3" dangerouslySetInnerHTML={{ __html: i.evidence }} />}
              {i.suggestions && i.suggestions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {i.suggestions.map((s: any, si: number) => (
                    <button
                      key={si}
                      onClick={(ev) => { ev.stopPropagation(); navigate(`/player?name=${encodeURIComponent(s.web_name)}`) }}
                      className="rounded-lg border border-line bg-surface-2/70 px-3 py-2 text-left text-xs transition-colors hover:border-line-mid"
                    >
                      <div className="font-semibold text-ink">{s.web_name} <span className="font-normal text-ink-3">£{Number(s.price).toFixed(1)}m · {s.team}</span></div>
                      <div className="mt-0.5 text-ink-2">{s.reason}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </>
  )
}

/* ── Mini-league ── */
const MAX_RIVALS = 10
const FETCH_GAP_MS = 250
const TEMPLATE_SHARE = 0.6
const DIFF_SHARE = 0.2
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms))

function MiniLeague({ entryData, teamId, gw, ownedElements, data }: { entryData: any; teamId: string; gw: number; ownedElements: Set<number>; data: CoreData }) {
  const classic: any[] = (entryData?.leagues?.classic) || []
  const sorted = useMemo(() => [...classic].sort((a, b) => (a.league_type === 'x' ? 0 : 1) - (b.league_type === 'x' ? 0 : 1)), [classic])
  const [leagueId, setLeagueId] = useState<string>(sorted[0] ? String(sorted[0].id) : '')
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ leagueName: string; rivalPicks: any[] } | null>(null)

  if (!classic.length) return null

  const analyse = async () => {
    setStatus('loading')
    setError('')
    try {
      const standings = await fetchLeagueStandings(leagueId)
      const rows: any[] = (standings.standings && standings.standings.results) || []
      const rivals = rows.filter((r) => String(r.entry) !== String(teamId)).slice(0, MAX_RIVALS)
      if (!rivals.length) { setResult(null); setStatus('done'); return }
      const rivalPicks: any[] = []
      for (const r of rivals) {
        try {
          const p = await fetchPicksCached(r.entry, gw)
          rivalPicks.push({ rival: r, picks: p.picks || [] })
        } catch { /* skip rival */ }
        await sleep(FETCH_GAP_MS)
      }
      if (!rivalPicks.length) throw new Error('no rival squads could be fetched (proxy rate limit?)')
      const leagueName = sorted.find((l) => String(l.id) === leagueId)?.name || ''
      setResult({ leagueName, rivalPicks })
      setStatus('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
    }
  }

  return (
    <>
      <SectionHeader>Mini-League Rivals</SectionHeader>
      <div className="mb-2 flex max-w-xl flex-wrap gap-2">
        <select value={leagueId} onChange={(e) => setLeagueId(e.target.value)} className="min-h-11 flex-1 rounded-lg border border-line-mid bg-surface-1 px-3 text-sm text-ink outline-none">
          {sorted.map((l) => <option key={l.id} value={l.id}>{l.name}{l.entry_rank ? ` (you: #${l.entry_rank})` : ''}</option>)}
        </select>
        <button onClick={analyse} className="min-h-11 rounded-lg bg-accent px-4 font-semibold text-accent-contrast transition-colors hover:bg-accent-strong">Analyse rivals</button>
      </div>
      <p className="mb-3 text-xs text-ink-3">Compares your squad against the top {MAX_RIVALS} managers in the league — what they own that you don't, and where you have the edge.</p>

      {status === 'loading' && <div className="space-y-2"><SkeletonBlock /></div>}
      {status === 'error' && <EmptyState icon={<Icon name="alert" size={44} />}>Couldn't analyse this league — the FPL API may be rate-limiting the proxy. Try again in a minute.<div className="mt-2 font-num text-[11px] text-ink-3">{error}</div></EmptyState>}
      {status === 'done' && !result && <EmptyState icon={<Icon name="users" size={44} />}>No other managers found in this league yet.</EmptyState>}
      {status === 'done' && result && <MiniLeagueResult leagueName={result.leagueName} rivalPicks={result.rivalPicks} ownedElements={ownedElements} ratings={data.ratings} />}
    </>
  )
}

function MiniLeagueResult({ leagueName, rivalPicks, ownedElements, ratings }: { leagueName: string; rivalPicks: any[]; ownedElements: Set<number>; ratings: RatingRow[] }) {
  const navigate = useNavigate()
  const n = rivalPicks.length
  const ratingByEl = useMemo(() => { const m = new Map<number, RatingRow>(); for (const r of ratings) m.set(r.element, r); return m }, [ratings])

  const { counts, captains } = useMemo(() => {
    const counts = new Map<number, number>()
    const captains = new Map<number, number>()
    rivalPicks.forEach(({ picks }) => picks.forEach((p: any) => {
      counts.set(p.element, (counts.get(p.element) || 0) + 1)
      if (p.is_captain) captains.set(p.element, (captains.get(p.element) || 0) + 1)
    }))
    return { counts, captains }
  }, [rivalPicks])

  const template = [...counts.entries()].filter(([el, c]) => c / n >= TEMPLATE_SHARE && !ownedElements.has(el) && ratingByEl.has(el)).sort((a, b) => b[1] - a[1]).slice(0, 6)
  const diffs = [...ownedElements].filter((el) => (counts.get(el) || 0) / n <= DIFF_SHARE && ratingByEl.has(el)).sort((a, b) => (counts.get(a) || 0) - (counts.get(b) || 0)).slice(0, 6)
  const capRows = [...captains.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).filter(([el]) => ratingByEl.has(el))

  const Table = ({ items }: { items: [number, string][] }) => (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line-mid text-[11px] tracking-[0.1em] text-ink-3 uppercase">
            {['Player', 'Team', 'Pos', 'Form', 'Own'].map((h, i) => <th key={h} className={`px-3 py-2.5 font-semibold ${i >= 3 ? 'text-right' : 'text-left'}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {items.map(([el, extra]) => {
            const r = ratingByEl.get(el)!
            return (
              <tr key={el} className="border-b border-line last:border-0">
                <td className="px-3 py-2.5"><button className="font-medium text-ink hover:text-accent" onClick={() => navigate(`/player?name=${encodeURIComponent(String(r.web_name))}`)}>{String(r.web_name)}</button></td>
                <td className="px-3 py-2.5"><span className="flex items-center gap-1 text-ink-2"><TeamBadge team={String(r.team)} size={12} />{r.team}</span></td>
                <td className="px-3 py-2.5"><span className="rounded bg-surface-3 px-1.5 py-0.5 text-[11px] font-semibold text-ink-2">{r.position}</span></td>
                <td className="px-3 py-2.5 text-right"><StarRating value={str(r, 'gw4_overall_rating') || str(r, 'season_overall_rating')} size={10} showNum={false} /></td>
                <td className="px-3 py-2.5 text-right font-num tabular-nums text-accent">{extra}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-2 text-sm font-semibold text-ink-2">Template you're missing — owned by rivals, not you</div>
          {template.length ? <Table items={template.map(([el, c]) => [el, `${Math.round((c / n) * 100)}%`])} /> : <div className="py-2 text-sm text-ink-2"><Icon name="check" size={13} /> Nothing — you already own every template player in this league.</div>}
        </div>
        <div>
          <div className="mb-2 text-sm font-semibold text-ink-2">Your differentials — your edge over this league</div>
          {diffs.length ? <Table items={diffs.map((el) => [el, `${Math.round(((counts.get(el) || 0) / n) * 100)}%`])} /> : <div className="py-2 text-sm text-ink-2">None — your squad matches the league template closely. Rank moves will come from captaincy.</div>}
        </div>
      </div>
      {capRows.length > 0 && (
        <div className="mt-6 max-w-xl">
          <div className="mb-2 text-sm font-semibold text-ink-2">Rival captaincy — who the armbands are on</div>
          <Table items={capRows.map(([el, c]) => [el, `${c} of ${n}`])} />
          <p className="mt-2 text-xs text-ink-3">Matching the majority captain protects your rank; going against it is how you attack. Based on the top {n} managers in {leagueName.replace(/\s*\(you.*\)$/, '')}.</p>
        </div>
      )}
    </div>
  )
}
