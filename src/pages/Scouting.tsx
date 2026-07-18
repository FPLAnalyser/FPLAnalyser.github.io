import { useMemo, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { PageHeader, PageShell } from '../components/PageShell'
import { SearchBox } from '../components/SearchBox'
import { Tabs, type TabDef } from '../components/Tabs'
import { TeamBadge } from '../components/badges'
import { Icon } from '../components/Icon'
import { useLazyTable } from '../lib/useData'
import { num, str } from '../lib/rows'
import { teamFullNames } from '../lib/util'
import type { Row } from '../lib/types'

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
  const [selected, setSelected] = useState<SelPlayer[]>([])
  const [win, setWin] = useState<ScoutWin>('season')
  const [peer, setPeer] = useState<ScoutPeer>('pooled')
  const reduced = useReducedMotion()

  const scout = scoutQ.data ?? []
  const scoutMeta = metaQ.data ?? []

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
      <PageHeader title="Scouting Report" subtitle="Per-90 percentiles vs positional peers — compare up to 4 players side by side" />

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

      <div className="mb-3"><Tabs tabs={WIN_TABS} active={win} onChange={(id) => setWin(id as ScoutWin)} layoutId="scout-win" /></div>
      <div className="mb-4"><Tabs tabs={PEER_TABS} active={peer} onChange={(id) => setPeer(id as ScoutPeer)} layoutId="scout-peer" /></div>

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
        <ScoutReport selected={selected} scoutMeta={scoutMeta} scoutRow={scoutRow} scoutPct={scoutPct} win={win} reduced={!!reduced} />
      )}
    </PageShell>
  )
}

function ScoutReport({
  selected, scoutMeta, scoutRow, scoutPct, win, reduced,
}: {
  selected: SelPlayer[]
  scoutMeta: Row[]
  scoutRow: (el: number) => Row | null
  scoutPct: (row: Row, key: string) => number | null
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
    </div>
  )
}
