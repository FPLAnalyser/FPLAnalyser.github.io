import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, PageShell } from '../components/PageShell'
import { SearchBox } from '../components/SearchBox'
import { Tabs, type TabDef } from '../components/Tabs'
import { TeamBadge } from '../components/badges'
import { InfoTip } from '../components/InfoTip'
import { Icon } from '../components/Icon'
import { useCore, useLazyTable } from '../lib/useData'
import { distanceYards, toPitch, classifyZone } from '../lib/shotzones'
import { num, str } from '../lib/rows'
import { teamFullNames } from '../lib/util'
import type { RatingRow, Row } from '../lib/types'

// Per-team defensive shot profile from shots_conceded. For distance, higher =
// better (defence forces long shots); for shot volume, higher = worse, so the
// percentile is inverted (fewer conceded → greener bar).
interface TeamDef {
  distAvg: number; distPct: number
  shotsPg: number; shotsPct: number
  boxPg: number; boxPct: number
}
interface PlayerMeta { rating: number | null; starts: number | null; mins: number | null; startRate: number | null }

const SCOUT_MAX = 4
const SCOUT_COLORS = ['#5EA7F7', '#E8A13C', '#E2649B', '#8B7BF4']
const WHOLE_NUMBER_KEYS = new Set(['goals', 'assists'])
const WINDOW_LABELS: Record<string, string> = { season: 'season to date', l6: 'last 6 gameweeks', l4: 'last 4 gameweeks' }
type ScoutWin = 'season' | 'l6' | 'l4'
type ScoutPeer = 'pooled' | 'position'

const WIN_TABS: TabDef[] = [
  { id: 'season', label: 'Season' },
  { id: 'l6', label: 'Last 6 GWs' },
  { id: 'l4', label: 'Last 4 GWs' },
]
const MODE_TABS: TabDef[] = [
  { id: 'compare', label: 'Compare' },
  { id: 'discover', label: 'Discover' },
]
const POSITIONS = ['All', 'GKP', 'DEF', 'MID', 'FWD'] as const
type ScoutMode = 'compare' | 'discover'

// Per-metric explainers (scouting_meta carries no descriptions).
const SCOUT_TIPS: Record<string, string> = {
  goals: 'Total goals scored in the window. The percentile compares goals per 90 minutes against the peer group.',
  npxg: 'Non-penalty expected goals per 90 — chance quality from open play and set pieces, penalties excluded.',
  xg_delta: 'Goals minus xG. Positive = finishing above expectation (clinical); negative = leaving chances unconverted.',
  xgi: 'Expected goal involvements per 90 (xG + xA) — total attacking threat, scoring and creating combined.',
  xgi_delta: 'Actual goals + assists minus xGI. Positive = returns running above the underlying numbers.',
  shots: 'Total shots taken per 90 minutes.',
  sot: 'Shots on target per 90 — volume that actually tests the keeper.',
  box_shots: 'Shots taken inside the penalty box per 90 — the highest-value shot locations.',
  headed_shots: 'Headed shots per 90 — aerial threat, mostly from crosses and set pieces.',
  fk_shots: 'Direct free-kick shots per 90.',
  touches_box: "Touches inside the opponent's box per 90 — how often they get into dangerous areas.",
  avg_shot_distance: 'Average distance of their shots from goal, in yards. Closer usually means better-quality chances.',
  assists: 'Total assists in the window. The percentile compares assists per 90 against the peer group.',
  xa: 'Expected assists per 90 — the quality of chances created for teammates.',
  xa_delta: 'Assists minus xA. Positive = teammates converting their chances at an above-expected rate.',
  chances_created: 'Passes leading directly to a shot, per 90.',
  big_chances: 'Big chances created per 90 — passes leading to a clear scoring opportunity.',
  xg_chain: 'xG of every attacking move the player was involved in, per 90 — credit for build-up, not just the final action.',
  xg_buildup: 'xG Chain excluding shots and key passes — pure build-up involvement deep in moves.',
  crosses: 'Completed open-play crosses per 90.',
  sp_deliveries: 'Set-piece deliveries per 90 (corners and free-kick crosses taken).',
  tackles: 'Tackles won per 90.',
  cbi: 'Clearances, blocks and interceptions per 90 — core defensive volume.',
  recoveries: 'Ball recoveries per 90 — winning loose balls back for the team.',
  def_contrib: "FPL's defensive-contribution count per 90 — the stat behind DC bonus points.",
  saves: 'Saves per 90 minutes. High volume usually means a busy keeper behind a leaky defence.',
  cs: 'Clean sheets per 90 (share of games without conceding).',
  xgc_prevented: 'Expected goals conceded minus actual goals conceded — shot-stopping above or below expectation.',
  bps: 'Bonus point system score per 90 — how often the keeper racks up bonus-relevant actions.',
}

// Display-name overrides (the info-card wording in SCOUT_TIPS is unchanged).
const LABEL_OVERRIDE: Record<string, string> = {
  cbi: 'CBI',
  def_contrib: 'Defensive Contributions',
}
const labelOf = (m: Row): string => LABEL_OVERRIDE[str(m, 'key') ?? ''] ?? String(m.label)

// FBref-style percentile colour: red (poor) → grey → green (elite).
function pctColor(p: number | null): string {
  if (p == null) return '#5D6C80'
  const stops: [number, number[]][] = [[1, [176, 58, 62]], [25, [186, 108, 70]], [50, [122, 122, 122]], [75, [92, 160, 96]], [99, [46, 176, 92]]]
  let lo = stops[0], hi = stops[stops.length - 1]
  for (let i = 0; i < stops.length - 1; i++) if (p >= stops[i][0] && p <= stops[i + 1][0]) { lo = stops[i]; hi = stops[i + 1]; break }
  const t = (p - lo[0]) / (hi[0] - lo[0] || 1)
  const c = lo[1].map((v, i) => Math.round(v + (hi[1][i] - v) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

interface SelPlayer { element: number; web_name: string; team: string; position: string; minutes: number; code: number | null }

export default function Scouting() {
  const scoutQ = useLazyTable<Row[]>('scouting')
  const metaQ = useLazyTable<Row[]>('scouting_meta')
  const { data: core } = useCore()
  const [mode, setMode] = useState<ScoutMode>('compare')
  const [selected, setSelected] = useState<SelPlayer[]>([])
  const [win, setWin] = useState<ScoutWin>('season')
  const [peer, setPeer] = useState<ScoutPeer>('pooled')

  const scout = scoutQ.data ?? []
  const scoutMeta = metaQ.data ?? []

  // Per-team defensive shot profile from shots_conceded (object keyed by the
  // conceding team → array of shots faced). Distance further out is good; shot
  // and in-box volume is bad, so those percentiles are inverted.
  const concededQ = useLazyTable<Record<string, Row[]>>('shots_conceded')
  const teamDef = useMemo(() => {
    const out = new Map<string, TeamDef>()
    const bag = concededQ.data
    if (!bag || typeof bag !== 'object') return out
    const stat = new Map<string, { dist: number; shots: number; box: number; games: number }>()
    for (const [team, shots] of Object.entries(bag)) {
      if (!Array.isArray(shots)) continue
      let dist = 0, n = 0, box = 0
      const games = new Set<string>()
      for (const s of shots) {
        if (s?.x == null || s?.y == null) continue
        dist += distanceYards(s.x as number, s.y as number)
        const { cx, cy } = toPitch(s.x as number, s.y as number)
        if (/^b[123]/.test(classifyZone(cx, cy))) box += 1
        if (s.kickoff_date) games.add(String(s.kickoff_date))
        n += 1
      }
      const g = games.size || 1
      if (n > 0) stat.set(team, { dist: dist / n, shots: n / g, box: box / g, games: g })
    }
    // percentile helpers: asc = higher value ranks higher; desc inverts it.
    const pctIn = (vals: number[], v: number, invert: boolean) => {
      if (vals.length < 2) return 50
      const below = vals.filter((x) => x < v).length / (vals.length - 1)
      return Math.round((invert ? 1 - below : below) * 100)
    }
    const dists = [...stat.values()].map((s) => s.dist).sort((a, b) => a - b)
    const shotsA = [...stat.values()].map((s) => s.shots).sort((a, b) => a - b)
    const boxA = [...stat.values()].map((s) => s.box).sort((a, b) => a - b)
    for (const [t, s] of stat) {
      out.set(t, {
        distAvg: s.dist, distPct: pctIn(dists, s.dist, false),
        shotsPg: s.shots, shotsPct: pctIn(shotsA, s.shots, true),
        boxPg: s.box, boxPct: pctIn(boxA, s.box, true),
      })
    }
    return out
  }, [concededQ.data])

  // element -> core rating info (price for Discover; rating/starts/mins for the report).
  const priceMap = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of (core?.ratings ?? []) as RatingRow[]) if (r.element != null && r.price != null) m.set(r.element, r.price)
    return m
  }, [core])
  const metaByEl = useMemo(() => {
    const m = new Map<number, PlayerMeta>()
    for (const r of (core?.ratings ?? []) as RatingRow[]) {
      if (r.element == null) continue
      const s = num(r, 'season_overall_score')
      m.set(r.element, {
        rating: s == null ? null : Math.round(Math.max(0, Math.min(100, s * 20))),
        starts: num(r, 'total_starts'),
        mins: num(r, 'total_mins'),
        startRate: num(r, 'season_start_rate'),
      })
    }
    return m
  }, [core])

  const addToCompare = (p: SelPlayer) => {
    setMode('compare')
    setSelected((s) => (s.length >= SCOUT_MAX || s.some((x) => x.element === p.element) ? s : [...s, p]))
  }

  // Unique season-window players for the picker.
  const pool = useMemo(() => {
    const seen = new Set<number>()
    const out: SelPlayer[] = []
    for (const r of scout) {
      if ((str(r, 'window') || 'season') !== 'season') continue
      const el = num(r, 'element')
      if (el == null || seen.has(el)) continue
      seen.add(el)
      out.push({ element: el, web_name: String(r.web_name), team: String(r.team), position: String(r.position), minutes: num(r, 'minutes') ?? 0, code: num(r, 'code') })
    }
    return out
  }, [scout])

  const scoutRow = (element: number) => scout.find((p) => num(p, 'element') === element && (str(p, 'window') || 'season') === win) ?? null
  const scoutPct = (row: Row, key: string): number | null => {
    const preferred = peer === 'position' ? row[`${key}_pct_pos`] : undefined
    const v = preferred !== undefined && preferred !== null && preferred !== '' ? preferred : row[`${key}_pct`]
    return v === '' || v == null ? null : Number(v)
  }

  const loading = (scoutQ.loading && !scoutQ.data) || (metaQ.loading && !metaQ.data)
  const failed = scoutQ.error || metaQ.error

  return (
    <PageShell>
      <PageHeader title="Scouting Report" subtitle="Per-90 percentiles vs positional peers — compare players head-to-head or discover who fits your criteria" />

      <div className="mb-4"><Tabs tabs={MODE_TABS} active={mode} onChange={(id) => setMode(id as ScoutMode)} layoutId="scout-mode" /></div>

      <div className="mb-3"><Tabs tabs={WIN_TABS} active={win} onChange={(id) => setWin(id as ScoutWin)} layoutId="scout-win" /></div>
      {/* Peer group as pills, each with its own explainer. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        {([
          ['pooled', 'MID + FWD pooled', 'Ranks every midfielder and forward together in one attacking pool — good for comparing a winger against a striker on the same scale.'],
          ['position', 'By position', 'Ranks each player only against others in their exact position (GKP / DEF / MID / FWD) — good for judging how a player stacks up in their own role.'],
        ] as [ScoutPeer, string, string][]).map(([id, label, tip]) => (
          <span key={id} className="flex items-center gap-1.5">
            <button
              onClick={() => setPeer(id)}
              className={`min-h-9 rounded-full border px-3 text-sm font-medium transition-colors ${
                peer === id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
              }`}
            >
              {label}
            </button>
            <InfoTip text={tip} />
          </span>
        ))}
      </div>

      {mode === 'discover' ? (
        loading ? (
          <div className="rounded-xl border border-dashed border-line-mid bg-surface-1/50 px-6 py-16 text-center text-ink-2">Loading scouting data…</div>
        ) : failed ? (
          <div className="rounded-xl border border-dashed border-line-mid bg-surface-1/50 px-6 py-16 text-center text-ink-2">Scouting data isn't available yet.</div>
        ) : (
          <Discover pool={pool} scoutMeta={scoutMeta} scoutRow={scoutRow} scoutPct={scoutPct} priceMap={priceMap} win={win} onAdd={addToCompare} />
        )
      ) : (
      <>
      <div className="mb-4">
        <SearchBox
          items={pool.filter((p) => !selected.some((s) => s.element === p.element))}
          getLabel={(p) => p.web_name}
          renderItem={(p) => (
            <span className="flex w-full items-center justify-between gap-2">
              <span>{p.web_name}</span>
              <span className="flex items-center gap-1.5 text-xs text-ink-3"><TeamBadge team={p.team} size={12} />{p.team} · {p.position}</span>
            </span>
          )}
          onSelect={(p) => setSelected((s) => (s.length >= SCOUT_MAX ? s : [...s, p]))}
          placeholder={pool.length ? `Search ${pool.length} eligible players… (up to 4)` : 'Search player… (up to 4)'}
          clearOnSelect
        />
      </div>

      {selected.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {selected.map((p, i) => (
            <div key={p.element} className="flex items-center gap-2 rounded-lg border bg-surface-1 px-2.5 py-1.5" style={{ borderColor: SCOUT_COLORS[i] }}>
              <span className="size-2.5 rounded-full" style={{ background: SCOUT_COLORS[i] }} />
              <div className="text-sm">
                <div className="font-medium text-ink">{p.web_name}</div>
                <div className="flex items-center gap-1 text-[11px] text-ink-2"><TeamBadge team={p.team} size={10} />{teamFullNames[p.team] || p.team} · {p.position} · {p.minutes} mins</div>
              </div>
              <button aria-label={`Remove ${p.web_name}`} className="ml-1 text-ink-3 hover:text-ink" onClick={() => setSelected((s) => s.filter((x) => x.element !== p.element))}>
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="rounded-xl border border-dashed border-line-mid bg-surface-1/50 px-6 py-16 text-center text-ink-2">Loading scouting data…</div>
      ) : failed ? (
        <div className="rounded-xl border border-dashed border-line-mid bg-surface-1/50 px-6 py-16 text-center text-ink-2">Scouting data isn't available yet.</div>
      ) : selected.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-mid bg-surface-1/50 px-6 py-16 text-center text-ink-2">
          Search for a player to build their scouting report.
          <div className="mt-1 text-sm text-ink-3">Percentiles ranked within peer group, {WINDOW_LABELS[win]}.</div>
        </div>
      ) : (
        <ScoutReport selected={selected} scoutMeta={scoutMeta} scoutRow={scoutRow} scoutPct={scoutPct} teamDef={teamDef} metaByEl={metaByEl} win={win} />
      )}
      </>
      )}
    </PageShell>
  )
}

function Discover({
  pool, scoutMeta, scoutRow, scoutPct, priceMap, win, onAdd,
}: {
  pool: SelPlayer[]
  scoutMeta: Row[]
  scoutRow: (el: number) => Row | null
  scoutPct: (row: Row, key: string) => number | null
  priceMap: Map<number, number>
  win: ScoutWin
  onAdd: (p: SelPlayer) => void
}) {
  const navigate = useNavigate()
  const [pos, setPos] = useState<(typeof POSITIONS)[number]>('All')
  const [minMins, setMinMins] = useState(0)
  const [maxPrice, setMaxPrice] = useState(15)
  const [criteria, setCriteria] = useState<{ key: string; min: number }[]>([])

  const isGK = pos === 'GKP'
  const metrics = useMemo(
    () => scoutMeta.filter((m) => (isGK ? str(m, 'group') === 'Goalkeeping' : str(m, 'group') !== 'Goalkeeping')),
    [scoutMeta, isGK],
  )
  const metricLabel = (key: string) => String(metrics.find((m) => str(m, 'key') === key)?.label ?? key)
  const available = metrics.filter((m) => !criteria.some((c) => c.key === str(m, 'key')))
  const minsMax = win === 'season' ? 3000 : win === 'l6' ? 540 : 360

  // Drop criteria whose metric isn't valid for the current position group.
  const validKeys = new Set(metrics.map((m) => str(m, 'key')))
  const activeCriteria = criteria.filter((c) => validKeys.has(c.key))

  const results = useMemo(() => {
    const out: { p: SelPlayer; price: number | null; mins: number; pcts: (number | null)[]; score: number }[] = []
    for (const p of pool) {
      if (pos === 'GKP') { if (p.position !== 'GKP') continue }
      else if (pos === 'All') { if (p.position === 'GKP') continue }
      else if (p.position !== pos) continue
      const price = priceMap.get(p.element) ?? null
      if (price != null && price > maxPrice) continue
      const row = scoutRow(p.element)
      if (!row) continue
      const mins = num(row, 'minutes') ?? p.minutes
      if (mins < minMins) continue
      const pcts = activeCriteria.map((c) => scoutPct(row, c.key))
      if (activeCriteria.some((c, i) => pcts[i] == null || (pcts[i] as number) < c.min)) continue
      const score = activeCriteria.length ? pcts.reduce((a: number, b) => a + (b ?? 0), 0) / activeCriteria.length : mins
      out.push({ p, price, mins, pcts, score })
    }
    out.sort((a, b) => b.score - a.score)
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, pos, maxPrice, minMins, activeCriteria, priceMap, scoutRow, scoutPct])

  const shown = results.slice(0, 40)

  return (
    <div>
      <div className="mb-4 rounded-xl border border-line bg-surface-1/50 p-4">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Position</span>
          {POSITIONS.map((pp) => (
            <button
              key={pp}
              onClick={() => setPos(pp)}
              className={`min-h-9 rounded-lg px-3 text-sm font-medium transition-colors ${pos === pp ? 'bg-accent text-accent-contrast' : 'bg-surface-2 text-ink-2 hover:text-ink'}`}
            >
              {pp}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <div className="mb-1 flex items-center justify-between text-xs text-ink-2">
              <span>Min minutes ({WINDOW_LABELS[win]})</span>
              <span className="font-num tabular-nums text-ink">{minMins}</span>
            </div>
            <input type="range" min={0} max={minsMax} step={45} value={minMins} onChange={(e) => setMinMins(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
          </label>
          <label className="block">
            <div className="mb-1 flex items-center justify-between text-xs text-ink-2">
              <span>Max price</span>
              <span className="font-num tabular-nums text-ink">{maxPrice >= 15 ? 'Any' : `£${maxPrice.toFixed(1)}m`}</span>
            </div>
            <input type="range" min={4} max={15} step={0.5} value={maxPrice} onChange={(e) => setMaxPrice(Number(e.target.value))} className="w-full accent-[var(--accent)]" />
          </label>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Metric thresholds (percentile ≥)</div>
          {activeCriteria.length > 0 && (
            <div className="mb-2 space-y-2">
              {activeCriteria.map((c) => (
                <div key={c.key} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 truncate text-sm text-ink-2 md:w-44">{metricLabel(c.key)}</span>
                  <input
                    type="range" min={0} max={99} step={1} value={c.min}
                    onChange={(e) => setCriteria((cs) => cs.map((x) => (x.key === c.key ? { ...x, min: Number(e.target.value) } : x)))}
                    className="min-w-0 flex-1 accent-[var(--accent)]"
                  />
                  <span className="w-8 shrink-0 text-right font-num tabular-nums text-sm" style={{ color: pctColor(c.min) }}>{c.min}</span>
                  <button aria-label={`Remove ${metricLabel(c.key)} filter`} className="text-ink-3 hover:text-ink" onClick={() => setCriteria((cs) => cs.filter((x) => x.key !== c.key))}>
                    <Icon name="x" size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {available.length > 0 && (
            <select
              value=""
              onChange={(e) => { if (e.target.value) setCriteria((cs) => [...cs, { key: e.target.value, min: 60 }]) }}
              className="min-h-11 rounded-lg border border-line-mid bg-surface-2 px-3 text-base text-ink-2 md:min-h-9 md:text-sm"
            >
              <option value="">+ Add metric filter…</option>
              {available.map((m) => <option key={str(m, 'key')} value={str(m, 'key')!}>{String(m.label)}</option>)}
            </select>
          )}
        </div>
      </div>

      <div className="mb-2 flex items-center justify-between px-1 text-sm text-ink-2">
        <span><span className="font-semibold text-ink">{results.length}</span> {results.length === 1 ? 'player' : 'players'} match{activeCriteria.length ? '' : ' — add metric filters to narrow'}</span>
        {activeCriteria.length > 0 && <span className="text-xs text-ink-3">ranked by average of your metrics</span>}
      </div>

      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line-mid bg-surface-1/50 px-6 py-16 text-center text-ink-2">No players fit these criteria. Loosen a threshold or raise the price.</div>
      ) : (
        <div className="flex flex-col">
          {shown.map(({ p, price, mins, pcts, score }, idx) => (
            <div key={p.element} className="border-b border-line py-2.5 last:border-0">
              {/* Name row — never competes with the metric pills for width. */}
              <div className="flex items-center gap-3">
                <span className="w-6 shrink-0 text-center font-num text-xs tabular-nums text-ink-3">{idx + 1}</span>
                <button className="min-w-0 flex-1 text-left" onClick={() => navigate(`/player?name=${encodeURIComponent(p.web_name)}`)}>
                  <div className="truncate font-medium text-ink hover:text-accent">{p.web_name}</div>
                  <div className="flex items-center gap-1.5 truncate text-[11px] text-ink-3"><TeamBadge team={p.team} size={11} />{p.team} · {p.position} · {price != null ? `£${price.toFixed(1)}m` : '—'} · {mins} mins</div>
                </button>
                {activeCriteria.length > 0 && (
                  <span className="shrink-0 text-right">
                    <span className="font-num text-base font-semibold tabular-nums" style={{ color: pctColor(score) }}>{Math.round(score)}</span>
                    <span className="ml-0.5 text-[10px] text-ink-3">match</span>
                  </span>
                )}
                <button
                  aria-label={`Compare ${p.web_name}`}
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line-mid text-ink-2 transition-colors hover:border-accent hover:text-accent"
                  onClick={() => onAdd(p)}
                >
                  <Icon name="check" size={14} />
                </button>
              </div>
              {/* Metric pills wrap freely on their own row. */}
              {activeCriteria.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-9">
                  {activeCriteria.map((c, i) => (
                    <span key={c.key} className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px]">
                      <span className="text-ink-3">{metricLabel(c.key)}</span>
                      <span className="font-num tabular-nums" style={{ color: pctColor(pcts[i]) }}>{pcts[i] ?? '—'}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ScoutReport({
  selected, scoutMeta, scoutRow, scoutPct, teamDef, metaByEl, win,
}: {
  selected: SelPlayer[]
  scoutMeta: Row[]
  scoutRow: (el: number) => Row | null
  scoutPct: (row: Row, key: string) => number | null
  teamDef: Map<string, TeamDef>
  metaByEl: Map<number, PlayerMeta>
  win: ScoutWin
}) {
  const warnings: string[] = []
  const hasGK = selected.some((p) => p.position === 'GKP')
  const hasOut = selected.some((p) => p.position !== 'GKP')
  if (hasGK && hasOut) warnings.push("Goalkeepers are ranked against other keepers, so they can't share bars with outfield players. Showing outfield players only.")
  const shownSel = hasGK && hasOut ? selected.filter((p) => p.position !== 'GKP') : selected

  const shown = shownSel.map((p) => ({ sel: p, row: scoutRow(p.element) }))
  const missing = shown.filter((s) => !s.row).map((s) => s.sel.web_name)
  if (missing.length) warnings.push(`No ${WINDOW_LABELS[win]} data for ${missing.join(', ')} — not enough minutes in this window.`)

  const gkMode = shownSel.every((p) => p.position === 'GKP')
  const defensiveMode = shownSel.length > 0 && shownSel.every((p) => p.position === 'GKP' || p.position === 'DEF')
  const rows = scoutMeta.filter((m) => (gkMode ? str(m, 'group') === 'Goalkeeping' : str(m, 'group') !== 'Goalkeeping'))
  const multi = shown.length > 1
  const gridCols = `repeat(${shown.length}, minmax(0,1fr))`

  // Per-player strengths / weaknesses from the visible metric percentiles —
  // this is the "insight behind the data" the numbers alone don't give.
  const profiles = shown.map((s) => {
    if (!s.row) return { strong: [] as { label: string; pct: number }[], weak: [] as { label: string; pct: number }[] }
    const scored = rows
      .map((m) => ({ label: labelOf(m), pct: scoutPct(s.row!, str(m, 'key')!) }))
      .filter((x): x is { label: string; pct: number } => x.pct != null)
    const strong = [...scored].filter((x) => x.pct >= 75).sort((a, b) => b.pct - a.pct).slice(0, 3)
    const weak = [...scored].filter((x) => x.pct <= 28).sort((a, b) => a.pct - b.pct).slice(0, 2)
    return { strong, weak }
  })
  const listPhrase = (arr: { label: string; pct: number }[]) => arr.map((x) => `${x.label} (${x.pct})`).join(', ')

  // Who-wins tally across contested categories.
  const wins = shown.map(() => 0)
  let contested = 0
  if (multi) {
    rows.forEach((m) => {
      const key = str(m, 'key')!
      const pcts = shown.map((s) => (s.row ? scoutPct(s.row, key) : null))
      const valid = pcts.filter((v): v is number => v != null)
      if (valid.length < 2) return
      const maxP = Math.max(...valid)
      const winners = pcts.map((v, i) => (v != null && v === maxP ? i : -1)).filter((i) => i >= 0)
      if (winners.length !== 1) return
      contested++
      wins[winners[0]]++
    })
  }
  const order = wins.map((w, i) => [w, i] as [number, number]).sort((a, b) => b[0] - a[0])

  const ratingTier = (r: number) => (r >= 80 ? 'text-accent bg-accent-soft' : r >= 65 ? 'text-good bg-good/10' : r >= 50 ? 'text-ink-2 bg-surface-3' : 'text-bad bg-bad/10')
  const RatingBadge = ({ el }: { el: number }) => {
    const r = metaByEl.get(el)?.rating
    if (r == null) return null
    return <span className={`ml-1 inline-block rounded-md px-1.5 py-0.5 font-num text-[11px] font-semibold tabular-nums ${ratingTier(r)}`}>{r}<span className="opacity-60">/100</span></span>
  }
  const rotationNote = (el: number) => {
    const meta = metaByEl.get(el)
    if (!meta || meta.starts == null) return ''
    const share = meta.starts / 38
    if (share < 0.55) return ` Rotation risk — started only ${meta.starts} of 38.`
    if (share >= 0.9) return ` Nailed-on starter (${meta.starts}/38).`
    return ''
  }

  // Detailed analysis block: who wins + a plain-language profile per player.
  const analysis = (
    <div className="mb-5 rounded-xl border border-line bg-surface-1/70 p-4">
      {multi && contested >= 4 && (
        <div className="mb-3 flex items-start gap-2 border-b border-line pb-3 text-sm text-ink">
          <span className="mt-0.5 text-accent"><Icon name="bolt" size={15} /></span>
          {order[0][0] > order[1][0] ? (
            <span><strong>{shown[order[0][1]].sel.web_name}</strong> wins <strong>{order[0][0]} of {contested}</strong> contested categories{shown.length === 2 ? ` vs ${shown[order[1][1]].sel.web_name}` : ` (next: ${shown[order[1][1]].sel.web_name}, ${order[1][0]})`}.</span>
          ) : (
            <span>Line-ball — <strong>{shown[order[0][1]].sel.web_name}</strong> and <strong>{shown[order[1][1]].sel.web_name}</strong> split it {order[0][0]}–{order[1][0]}.</span>
          )}
        </div>
      )}
      <ul className="space-y-2.5 text-sm">
        {shown.map((s, i) => {
          const p = profiles[i]
          return (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: multi ? SCOUT_COLORS[i] : 'var(--accent)' }} />
              <span className="text-ink-2">
                <strong className="text-ink">{s.sel.web_name}</strong>
                <RatingBadge el={s.sel.element} />
                {' '}
                {!s.row ? (
                  <>has no {WINDOW_LABELS[win]} sample.</>
                ) : p.strong.length ? (
                  <>ranks top-quartile for <span className="text-ink">{listPhrase(p.strong)}</span></>
                ) : (
                  <>has no standout metric in this profile</>
                )}
                {s.row && p.weak.length ? <>; weakest at <span className="text-ink">{listPhrase(p.weak)}</span>.</> : s.row ? '.' : ''}
                <span className="text-ink-3">{rotationNote(s.sel.element)}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )

  // Group metric rows for rendering.
  const groups: { group: string; metrics: Row[] }[] = []
  rows.forEach((m) => {
    const g = str(m, 'group') || ''
    const last = groups[groups.length - 1]
    if (!last || last.group !== g) groups.push({ group: g, metrics: [m] })
    else last.metrics.push(m)
  })

  // Label column: label left, info icon pinned right so every ⓘ lines up.
  const LabelCell = ({ children, tip }: { children: React.ReactNode; tip?: string }) => (
    <div className="flex w-36 shrink-0 items-center justify-between gap-1 text-sm text-ink-2 md:w-44">
      <span className="min-w-0 truncate">{children}</span>
      {tip ? <InfoTip text={tip} /> : <span className="w-3.5 shrink-0" />}
    </div>
  )

  // A value + percentile bar cell.
  const BarCell = ({ i, value, pct }: { i: number; value: string; pct: number | null }) => {
    const color = multi ? SCOUT_COLORS[i] : pctColor(pct)
    return (
      <div className="min-w-0">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-num font-medium tabular-nums text-ink">{value}</span>
          <span className="font-num tabular-nums text-ink-2">{pct ?? '—'}</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
          <div className="h-full rounded-full" style={{ width: `${pct ?? 0}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${color} 72%, transparent), ${color})` }} />
        </div>
      </div>
    )
  }
  const NaCell = () => (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between text-xs"><span className="text-ink-3">—</span><span className="text-ink-3">n/a</span></div>
      <div className="mt-1 h-1.5 rounded-full bg-surface-3" />
    </div>
  )

  return (
    <div>
      {warnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-warn/30 bg-warn/10 px-4 py-2.5 text-sm text-warn">{warnings.join(' ')}</div>
      )}

      {multi && (
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1">
          {shown.map((s, i) => (
            <span key={i} className="flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap text-ink">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: SCOUT_COLORS[i] }} />
              {s.sel.web_name}
              <span className="flex items-center gap-1 font-normal text-ink-3"><TeamBadge team={s.sel.team} size={10} />{s.sel.team}</span>
            </span>
          ))}
        </div>
      )}

      {analysis}

      {/* Playing time & headline rating */}
      <div className="mb-4">
        <div className="mb-1.5 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Playing Time & Rating</div>
        <div className="flex flex-col">
          <div className="flex items-center gap-3 border-b border-line py-2">
            <LabelCell tip="FPL Analyser's overall season rating out of 100 — the same figure shown on the player and rankings pages.">FPL Analyser Rating</LabelCell>
            <div className="grid flex-1 gap-3" style={{ gridTemplateColumns: gridCols }}>
              {shown.map((s, i) => {
                const r = metaByEl.get(s.sel.element)?.rating
                return <div key={i} className="min-w-0 font-num text-sm font-semibold tabular-nums" style={{ color: r == null ? 'var(--ink-3)' : pctColor(r) }}>{r ?? '—'}{r != null && <span className="text-[10px] text-ink-3">/100</span>}</div>
              })}
            </div>
          </div>
          <div className="flex items-center gap-3 border-b border-line py-2">
            <LabelCell tip={`Minutes played in the selected window (${WINDOW_LABELS[win]}).`}>Minutes ({win === 'season' ? 'season' : win.toUpperCase()})</LabelCell>
            <div className="grid flex-1 gap-3" style={{ gridTemplateColumns: gridCols }}>
              {shown.map((s, i) => <div key={i} className="min-w-0 font-num text-sm tabular-nums text-ink">{s.row ? (num(s.row, 'minutes') ?? '—') : '—'}</div>)}
            </div>
          </div>
          <div className="flex items-center gap-3 border-b border-line py-2 last:border-0">
            <LabelCell tip="Games started this season out of 38, with the share of available games. Low = a rotation or bench risk.">Starts (season)</LabelCell>
            <div className="grid flex-1 gap-3" style={{ gridTemplateColumns: gridCols }}>
              {shown.map((s, i) => {
                const m = metaByEl.get(s.sel.element)
                if (!m || m.starts == null) return <div key={i} className="min-w-0 text-sm text-ink-3">—</div>
                const share = Math.round((m.starts / 38) * 100)
                return (
                  <div key={i} className="min-w-0">
                    <span className="font-num text-sm font-medium tabular-nums text-ink">{m.starts}</span>
                    <span className="font-num text-xs tabular-nums text-ink-3">/38</span>
                    <span className="ml-1.5 font-num text-xs tabular-nums" style={{ color: pctColor(share) }}>{share}%</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {groups.map((grp) => (
        <div key={grp.group} className="mb-4">
          <div className="mb-1.5 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">{grp.group}</div>
          <div className="flex flex-col">
            {grp.metrics.map((m) => {
              const key = str(m, 'key')!
              return (
                <div key={key} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
                  <LabelCell tip={SCOUT_TIPS[key]}>{labelOf(m)}</LabelCell>
                  <div className="grid flex-1 gap-3" style={{ gridTemplateColumns: gridCols }}>
                    {shown.map((s, i) => {
                      const raw = s.row ? s.row[`${key}_per90`] : null
                      if (raw === '' || raw == null) return <NaCell key={i} />
                      const isWhole = WHOLE_NUMBER_KEYS.has(key) && s.row![`${key}_total`] != null
                      const display = isWhole ? String(Math.round(Number(s.row![`${key}_total`]))) : Number(raw).toFixed(2)
                      return <BarCell key={i} i={i} value={display} pct={scoutPct(s.row!, key)} />
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {defensiveMode && teamDef.size > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Team Defence</div>
          <div className="flex flex-col">
            {([
              ['Avg Shot Distance Against', 'yd', (d: TeamDef) => d.distAvg, (d: TeamDef) => d.distPct, "Average distance of the shots this player's team faces. Further out = the defence forces harder chances. Higher is better. Percentile vs all 20 teams."],
              ['Shots Conceded / Game', '', (d: TeamDef) => d.shotsPg, (d: TeamDef) => d.shotsPct, "Average shots the team faces per game. Fewer is better, so a low count scores green. Percentile vs all 20 teams."],
              ['Box Shots Conceded / Game', '', (d: TeamDef) => d.boxPg, (d: TeamDef) => d.boxPct, "Average shots the team concedes from inside the box per game — the dangerous ones. Fewer is better. Percentile vs all 20 teams."],
            ] as [string, string, (d: TeamDef) => number, (d: TeamDef) => number, string][]).map(([label, unit, valOf, pctOf, tip]) => (
              <div key={label} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
                <LabelCell tip={tip}>{label}</LabelCell>
                <div className="grid flex-1 gap-3" style={{ gridTemplateColumns: gridCols }}>
                  {shown.map((s, i) => {
                    const d = teamDef.get(s.sel.team)
                    if (!d) return <NaCell key={i} />
                    return <BarCell key={i} i={i} value={`${valOf(d).toFixed(1)}${unit ? ' ' + unit : ''}`} pct={pctOf(d)} />
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
