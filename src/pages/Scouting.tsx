import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { PageHeader, PageShell } from '../components/PageShell'
import { SearchBox } from '../components/SearchBox'
import { Tabs, type TabDef } from '../components/Tabs'
import { TeamBadge } from '../components/badges'
import { InfoTip } from '../components/InfoTip'
import { Icon } from '../components/Icon'
import { useCore, useLazyTable } from '../lib/useData'
import { distanceYards } from '../lib/shotzones'
import { num, str } from '../lib/rows'
import { teamFullNames } from '../lib/util'
import type { RatingRow, Row } from '../lib/types'

interface TeamDist { avg: number; pct: number }

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
const PEER_TABS: TabDef[] = [
  { id: 'pooled', label: 'MID + FWD pooled' },
  { id: 'position', label: 'By position' },
]
const MODE_TABS: TabDef[] = [
  { id: 'compare', label: 'Compare' },
  { id: 'discover', label: 'Discover' },
]
const POSITIONS = ['All', 'GKP', 'DEF', 'MID', 'FWD'] as const
type ScoutMode = 'compare' | 'discover'

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
  const reduced = useReducedMotion()

  const scout = scoutQ.data ?? []
  const scoutMeta = metaQ.data ?? []

  // Team avg distance of shots faced (from shots_conceded) → a keeper-relevant
  // defensive stat: further out = the defence forces harder chances.
  // shots_conceded is an object keyed by the conceding team → array of shots faced.
  const concededQ = useLazyTable<Record<string, Row[]>>('shots_conceded')
  const teamDist = useMemo(() => {
    const out = new Map<string, TeamDist>()
    const bag = concededQ.data
    if (!bag || typeof bag !== 'object') return out
    const avg = new Map<string, number>()
    for (const [team, shots] of Object.entries(bag)) {
      if (!Array.isArray(shots)) continue
      let d = 0, n = 0
      for (const s of shots) {
        if (s?.x == null || s?.y == null) continue
        d += distanceYards(s.x as number, s.y as number)
        n += 1
      }
      if (n > 0) avg.set(team, d / n)
    }
    const sorted = [...avg.values()].sort((a, b) => a - b)
    const pctOf = (v: number) => (sorted.length < 2 ? 50 : Math.round((sorted.filter((x) => x < v).length / (sorted.length - 1)) * 100))
    for (const [t, v] of avg) out.set(t, { avg: v, pct: pctOf(v) })
    return out
  }, [concededQ.data])

  // element -> price (from core ratings) for the Discover price filter.
  const priceMap = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of (core?.ratings ?? []) as RatingRow[]) if (r.element != null && r.price != null) m.set(r.element, r.price)
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
      <div className="mb-4 flex items-center gap-2">
        <Tabs tabs={PEER_TABS} active={peer} onChange={(id) => setPeer(id as ScoutPeer)} layoutId="scout-peer" />
        <InfoTip text="MID + FWD pooled ranks every midfielder and forward together in one attacking pool — good for comparing a winger against a striker. By position ranks each player only against others in their exact position (GKP/DEF/MID/FWD)." />
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
        <ScoutReport selected={selected} scoutMeta={scoutMeta} scoutRow={scoutRow} scoutPct={scoutPct} teamDist={teamDist} win={win} reduced={!!reduced} />
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
  selected, scoutMeta, scoutRow, scoutPct, teamDist, win, reduced,
}: {
  selected: SelPlayer[]
  scoutMeta: Row[]
  scoutRow: (el: number) => Row | null
  scoutPct: (row: Row, key: string) => number | null
  teamDist: Map<string, TeamDist>
  win: ScoutWin
  reduced: boolean
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
  const rows = scoutMeta.filter((m) => (gkMode ? str(m, 'group') === 'Goalkeeping' : str(m, 'group') !== 'Goalkeeping'))
  const multi = shown.length > 1

  // Comparison verdict: who wins the most contested categories.
  let verdict: React.ReactNode = null
  if (multi) {
    const wins = shown.map(() => 0)
    const winLabels: string[][] = shown.map(() => [])
    let contested = 0
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
      winLabels[winners[0]].push(String(m.label))
    })
    if (contested >= 4) {
      const order = wins.map((w, i) => [w, i] as [number, number]).sort((a, b) => b[0] - a[0])
      const [topW, topI] = order[0]
      const [secondW, secondI] = order[1]
      verdict = (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-line bg-surface-1 px-4 py-3 text-sm text-ink-2">
          <span className="mt-0.5 text-accent"><Icon name="bolt" size={14} /></span>
          {topW > secondW ? (
            <span>
              <strong className="text-ink">{shown[topI].sel.web_name}</strong> wins <strong className="text-ink">{topW} of {contested}</strong> contested categories
              {shown.length === 2 ? ` vs ${shown[secondI].sel.web_name}` : ''}
              {winLabels[secondI][0] && secondW > 0 ? ` — ${shown[secondI].sel.web_name}'s edge: ${winLabels[secondI][0].toLowerCase()}` : ''}.
            </span>
          ) : (
            <span>Dead heat — <strong className="text-ink">{shown[topI].sel.web_name}</strong> and <strong className="text-ink">{shown[secondI].sel.web_name}</strong> split the categories {topW}–{secondW}.</span>
          )}
        </div>
      )
    }
  }

  // Group rows for rendering.
  const groups: { group: string; metrics: Row[] }[] = []
  rows.forEach((m) => {
    const g = str(m, 'group') || ''
    const last = groups[groups.length - 1]
    if (!last || last.group !== g) groups.push({ group: g, metrics: [m] })
    else last.metrics.push(m)
  })

  const cellWidth = `minmax(0, ${shown.length}fr)`
  void cellWidth

  return (
    <div>
      {warnings.length > 0 && (
        <div className="mb-4 rounded-lg border border-warn/30 bg-warn/10 px-4 py-2.5 text-sm text-warn">{warnings.join(' ')}</div>
      )}
      {verdict}

      {multi && (
        <div className="mb-2 flex items-center gap-3 px-1">
          <div className="w-36 shrink-0 md:w-44" />
          <div className="grid flex-1 gap-3" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0,1fr))` }}>
            {shown.map((s, i) => (
              <div key={i} className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                <span className="size-2.5 rounded-full" style={{ background: SCOUT_COLORS[i] }} />
                {s.sel.web_name}
                <span className="flex items-center gap-1 font-normal text-ink-3"><TeamBadge team={s.sel.team} size={10} />{s.sel.team}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {groups.map((grp) => (
        <div key={grp.group} className="mb-4">
          <div className="mb-1.5 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">{grp.group}</div>
          <div className="flex flex-col">
            {grp.metrics.map((m) => {
              const key = str(m, 'key')!
              return (
                <div key={key} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
                  <div className="w-36 shrink-0 text-sm text-ink-2 md:w-44">{String(m.label)}</div>
                  <div className="grid flex-1 gap-3" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0,1fr))` }}>
                    {shown.map((s, i) => {
                      const raw = s.row ? s.row[`${key}_per90`] : null
                      if (raw === '' || raw == null) {
                        return (
                          <div key={i} className="min-w-0">
                            <div className="flex items-baseline justify-between text-xs"><span className="text-ink-3">—</span><span className="text-ink-3">n/a</span></div>
                            <div className="mt-1 h-1.5 rounded-full bg-surface-3" />
                          </div>
                        )
                      }
                      const pct = scoutPct(s.row!, key)
                      const color = multi ? SCOUT_COLORS[i] : pctColor(pct)
                      const isWhole = WHOLE_NUMBER_KEYS.has(key) && s.row![`${key}_total`] != null
                      const display = isWhole ? String(Math.round(Number(s.row![`${key}_total`]))) : Number(raw).toFixed(2)
                      return (
                        <div key={i} className="min-w-0">
                          <div className="flex items-baseline justify-between text-xs">
                            <span className="font-num font-medium tabular-nums text-ink">{display}</span>
                            <span className="font-num tabular-nums text-ink-2">{pct ?? '—'}</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                            <motion.div
                              className="h-full rounded-full"
                              style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${color} 72%, transparent), ${color})` }}
                              initial={reduced ? false : { width: 0 }}
                              whileInView={{ width: `${pct ?? 0}%` }}
                              viewport={{ once: true, amount: 0.3 }}
                              transition={{ duration: 0.7, ease: 'easeOut' }}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {gkMode && teamDist.size > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Team Defence</div>
          <div className="flex items-center gap-3 border-b border-line py-2 last:border-0">
            <div className="flex w-36 shrink-0 items-center gap-1 text-sm text-ink-2 md:w-44">
              Avg Shot Distance Against
              <InfoTip text="Average distance of the shots the keeper's team faces. Further out = the defence forces harder chances, which helps the keeper. Percentile is vs all teams." />
            </div>
            <div className="grid flex-1 gap-3" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0,1fr))` }}>
              {shown.map((s, i) => {
                const td = teamDist.get(s.sel.team)
                if (!td) {
                  return (
                    <div key={i} className="min-w-0">
                      <div className="flex items-baseline justify-between text-xs"><span className="text-ink-3">—</span><span className="text-ink-3">n/a</span></div>
                      <div className="mt-1 h-1.5 rounded-full bg-surface-3" />
                    </div>
                  )
                }
                const color = multi ? SCOUT_COLORS[i] : pctColor(td.pct)
                return (
                  <div key={i} className="min-w-0">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-num font-medium tabular-nums text-ink">{td.avg.toFixed(1)} yd</span>
                      <span className="font-num tabular-nums text-ink-2">{td.pct}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-3">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${color} 72%, transparent), ${color})` }}
                        initial={reduced ? false : { width: 0 }}
                        whileInView={{ width: `${td.pct}%` }}
                        viewport={{ once: true, amount: 0.3 }}
                        transition={{ duration: 0.7, ease: 'easeOut' }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
