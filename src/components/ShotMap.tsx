import { useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import { useLazyTable } from '../lib/useData'
import { teamFullNames } from '../lib/util'
import {
  analyse, buildNarrative, tooltipText, windowShots, venueFilterShots, toPitch,
  ZONE_SHAPES, METRIC_META, VIEW_Y_MIN, VIEW_H, VIEW_W,
  type Metric, type ShotMode, type ShotWindow, type Venue, type Analysis,
} from '../lib/shotzones'
import type { ShotEvent } from '../lib/types'

type ShotTable = Record<string, ShotEvent[]>
const YD_PER_M = 1.09361

interface SegOption<T extends string> { id: T; label: string }
function Segmented<T extends string>({ options, value, onChange }: { options: SegOption<T>[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line-mid bg-surface-1 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`min-h-8 rounded-md px-3 text-xs font-semibold transition-colors ${
            value === o.id ? 'bg-accent text-accent-contrast' : 'text-ink-2 hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function PitchChrome() {
  const gl = 30.34, gr = 37.66, gt = -3.6
  const netCols = [1, 2, 3, 4, 5, 6].map((i) => gl + ((gr - gl) * i) / 7)
  const netRows = [-1.2, -2.4]
  return (
    <>
      <rect className="shotmap-line" x={0} y={0} width={68} height={52.5} />
      <path className="shotmap-line" d="M 24.85 52.5 A 9.15 9.15 0 0 1 43.15 52.5" />
      <rect className="shotmap-line shotmap-box" x={13.84} y={0} width={40.32} height={16.5} />
      <rect className="shotmap-line shotmap-box" x={24.84} y={0} width={18.32} height={5.5} />
      <circle className="shotmap-spot" cx={34} cy={11} r={0.35} />
      <path className="shotmap-line" d="M 26.7 16.5 A 9.15 9.15 0 0 0 41.3 16.5" />
      <g className="shotmap-goal">
        {netCols.map((x, i) => <line key={`c${i}`} className="shotmap-net" x1={x} y1={0} x2={x} y2={gt} />)}
        {netRows.map((y, i) => <line key={`r${i}`} className="shotmap-net" x1={gl} y1={y} x2={gr} y2={y} />)}
        <path className="shotmap-goal-frame" d={`M ${gl} 0 L ${gl} ${gt} L ${gr} ${gt} L ${gr} 0`} />
      </g>
    </>
  )
}

function Orientation() {
  return (
    <div className="flex flex-col items-center justify-center pr-1 text-ink-3">
      <svg viewBox="0 0 20 70" className="h-24 w-4" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        <line x1={10} y1={68} x2={10} y2={14} />
        <path d="M 2 20 L 10 4 L 18 20 Z" fill="currentColor" />
      </svg>
      <span className="mt-1 text-[10px] tracking-wide uppercase [writing-mode:vertical-rl] rotate-180">Attack</span>
    </div>
  )
}

function StatGrid({ cards }: { cards: { value: string; label: string }[] }) {
  return (
    <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
      {cards.map((c, i) => (
        <div key={i} className="rounded-lg border border-line bg-surface-1 px-3 py-2.5">
          <div className="font-num text-lg font-semibold tabular-nums text-ink">{c.value}</div>
          <div className="mt-0.5 text-[11px] tracking-wide text-ink-2 uppercase">{c.label}</div>
        </div>
      ))}
    </div>
  )
}

/* ── Shared zone-grid pitch (heatmap + labels + tooltip + optional scatter) ── */
interface ZoneTip { key: string; x: number; y: number }
function ZonePitch({ analysis, metric, scatter, scatterMode }: { analysis: Analysis; metric: Metric; scatter?: ShotEvent[]; scatterMode?: ShotMode }) {
  const [tip, setTip] = useState<ZoneTip | null>(null)
  const pitchRef = useRef<HTMLDivElement>(null)
  const mm = METRIC_META[metric]
  const total = analysis[mm.totalKey]
  const maxZone = Math.max(...Object.values(analysis.zones).map((z) => z[mm.zoneKey]), 0.0001)

  const onZonePointer = (key: string, e: React.PointerEvent) => {
    const rect = pitchRef.current?.getBoundingClientRect()
    if (!rect) return
    setTip({ key, x: Math.min(e.clientX - rect.left + 12, rect.width - 210), y: Math.max(e.clientY - rect.top - 56, 0) })
  }

  return (
    <div className="flex items-stretch gap-2">
      <Orientation />
      <div ref={pitchRef} className="relative mx-auto w-full max-w-[520px]" onPointerLeave={() => setTip(null)}>
        <svg className="shotmap-pitch" viewBox={`0 ${VIEW_Y_MIN} ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet">
          {scatter && (
            <g>
              {scatter.map((s, i) => {
                const { cx, cy } = toPitch(s.x, s.y, scatterMode)
                return <circle key={i} className="shotmap-scatter" cx={cx} cy={cy} r={0.55} />
              })}
            </g>
          )}
          <g>
            {Object.entries(ZONE_SHAPES).map(([key, s]) => {
              const agg = analysis.zones[key]
              if (!agg || agg.shots === 0) return null
              const opacity = 0.14 + (agg[mm.zoneKey] / maxZone) * 0.6
              return (
                <rect
                  key={key}
                  className="shotmap-zone"
                  x={s.x}
                  y={s.y}
                  width={s.w}
                  height={s.h}
                  style={{ fill: 'var(--accent)', fillOpacity: opacity }}
                  onPointerMove={(e) => onZonePointer(key, e)}
                />
              )
            })}
          </g>
          <g>
            {Object.values(ZONE_SHAPES).map((s, i) => (
              <rect key={i} className="shotmap-cell-outline" x={s.x} y={s.y} width={s.w} height={s.h} />
            ))}
          </g>
          <PitchChrome />
        </svg>

        {Object.entries(ZONE_SHAPES).map(([key, s]) => {
          const agg = analysis.zones[key]
          if (!agg || agg.shots === 0) return null
          const pct = total > 0 ? Math.round((agg[mm.zoneKey] / total) * 100) : 0
          const left = ((s.x + s.w / 2) / VIEW_W) * 100
          const top = ((s.y + s.h / 2 - VIEW_Y_MIN) / VIEW_H) * 100
          return <div key={key} className="shotmap-zone-label" style={{ left: `${left}%`, top: `${top}%` }}>{pct}%</div>
        })}

        {tip && (() => {
          const { title, lines } = tooltipText(tip.key, analysis.zones[tip.key])
          return (
            <div className="pointer-events-none absolute z-20 w-[200px] rounded-md border border-line-mid bg-surface-3 px-3 py-2 shadow-float" style={{ left: tip.x, top: tip.y }}>
              <div className="mb-1 text-xs font-semibold text-ink">{title}</div>
              {lines.map((l, i) => <div key={i} className="text-[11px] text-ink-2">{l}</div>)}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

function ZoneNarrative({ lines }: { lines: string[] }) {
  if (!lines.length) return null
  return (
    <ul className="mb-4 space-y-1.5 text-sm text-ink-2">
      {lines.map((line, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-1 text-accent"><Icon name="target" size={12} /></span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  )
}

/* ══════════════════════ Team shot map ══════════════════════ */
export function TeamShotMap({ team }: { team: string }) {
  const [mode, setMode] = useState<ShotMode>('against')
  const [metric, setMetric] = useState<Metric>('xg')
  const [win, setWin] = useState<ShotWindow>('season')
  const [venue, setVenue] = useState<Venue>('all')
  const [wantFor, setWantFor] = useState(false)

  const concededQ = useLazyTable<ShotTable>('shots_conceded')
  const forQ = useLazyTable<ShotTable>(wantFor ? 'shots_for' : null)
  const active = mode === 'against' ? concededQ : forQ
  const teamShots = (active.data?.[team] ?? []) as ShotEvent[]

  const slice = useMemo(() => venueFilterShots(windowShots(teamShots, win), venue), [teamShots, win, venue])
  const analysis = useMemo(() => analyse(slice, mode), [slice, mode])

  const selectMode = (m: ShotMode) => { if (m === 'for') setWantFor(true); setMode(m) }

  if (active.loading && !active.data) return <div className="py-8 text-sm text-ink-2">Loading shot data…</div>
  if (!concededQ.loading && mode === 'against' && teamShots.length === 0) {
    return <div className="py-8 text-sm text-ink-2">No shot-level data yet for {teamFullNames[team] || team}.</div>
  }

  const narrative = buildNarrative(
    analysis, teamFullNames[team] || team, metric,
    mode === 'for' ? { verb: 'create', shotsNoun: 'shots taken', goalVerb: 'scored' } : { verb: 'concede', shotsNoun: 'shots faced', goalVerb: 'conceded' },
  )
  const cards = [
    { value: (analysis.matches ? analysis.totalShots / analysis.matches : 0).toFixed(1), label: mode === 'for' ? 'Shots / Game' : 'Shots Faced / Game' },
    { value: String(analysis.totalGoals), label: mode === 'for' ? 'Goals' : 'Goals Conceded' },
    { value: (analysis.totalShots ? analysis.totalXg / analysis.totalShots : 0).toFixed(2), label: 'xG / Shot' },
    { value: `${analysis.avgDistance.toFixed(1)} yd`, label: mode === 'for' ? 'Avg. Shot Distance' : 'Avg. Distance Conceded' },
    { value: `${analysis.totalShots ? Math.round((analysis.totalOnTarget / analysis.totalShots) * 100) : 0}%`, label: 'On Target' },
  ]

  return (
    <div>
      <StatGrid cards={cards} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Segmented options={[{ id: 'against', label: 'Defence' }, { id: 'for', label: 'Attack' }]} value={mode} onChange={selectMode} />
        <Segmented options={[{ id: 'xg', label: 'xG' }, { id: 'goals', label: 'Goals' }, { id: 'shots', label: 'Shots' }]} value={metric} onChange={setMetric} />
        <Segmented options={[{ id: 'season', label: 'Season' }, { id: '4gw', label: 'Last 4' }, { id: '6gw', label: 'Last 6' }]} value={win} onChange={setWin} />
        <Segmented options={[{ id: 'all', label: 'All' }, { id: 'H', label: 'Home' }, { id: 'A', label: 'Away' }]} value={venue} onChange={setVenue} />
      </div>
      <ZoneNarrative lines={narrative} />
      <ZonePitch analysis={analysis} metric={metric} scatter={slice.filter((s) => s.situation !== 'Penalty')} scatterMode={mode} />
      <p className="mt-3 text-xs text-ink-3">% = share of {METRIC_META[metric].noun} by zone · shading follows the same share</p>
    </div>
  )
}

/* ══════════════════════ Player zone map ══════════════════════ */
export function PlayerZoneMap({ element, name }: { element: number; name: string }) {
  const [metric, setMetric] = useState<Metric>('xg')
  const [win, setWin] = useState<ShotWindow>('season')
  const q = useLazyTable<ShotTable>('player_shots')
  const shots = ((q.data?.[String(element)] ?? []) as ShotEvent[]).filter((s) => s.situation !== 'Penalty')

  const slice = useMemo(() => windowShots(shots, win), [shots, win])
  // 'against' selects the x-flip branch that plots player_shots coordinates correctly (see legacy note).
  const analysis = useMemo(() => analyse(slice, 'against'), [slice])

  if (q.loading && !q.data) return <div className="py-6 text-sm text-ink-2">Loading shot data…</div>
  if (!q.loading && shots.length === 0) return <div className="py-6 text-sm text-ink-2">No non-penalty shots recorded for this player yet.</div>

  const narrative = buildNarrative(analysis, name, metric, { verb: 'creates', shotsNoun: 'shots taken', goalVerb: 'scored' })

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <Segmented options={[{ id: 'xg', label: 'xG' }, { id: 'goals', label: 'Goals' }, { id: 'shots', label: 'Shots' }]} value={metric} onChange={setMetric} />
        <Segmented options={[{ id: 'season', label: 'Season' }, { id: '4gw', label: 'Last 4' }, { id: '6gw', label: 'Last 6' }]} value={win} onChange={setWin} />
      </div>
      <ZoneNarrative lines={narrative} />
      <ZonePitch analysis={analysis} metric={metric} />
      <p className="mt-3 text-xs text-ink-3">% = share of {METRIC_META[metric].noun} by zone · shading follows the same share</p>
    </div>
  )
}

/* ══════════════════════ Player scatter map ══════════════════════ */
const RESULT_LABEL: Record<string, string> = { Goal: 'Goal', SavedShot: 'Saved', BlockedShot: 'Blocked', MissedShots: 'Off target', ShotOnPost: 'Hit post', OwnGoal: 'Own goal' }
const SITUATION_LABEL: Record<string, string> = { OpenPlay: 'Open play', FromCorner: 'From corner', SetPiece: 'Set piece', DirectFreekick: 'Free kick', Penalty: 'Penalty' }
const radiusFor = (xg: number) => Math.min(3.4, 0.7 + Math.sqrt(Math.max(0, Number(xg) || 0)) * 3.0)
function playerToPitch(x: number | string, y: number | string) {
  return { cx: (1 - Math.max(0, Math.min(1, Number(y)))) * 68, cy: (1 - Math.max(0.5, Math.min(1, Number(x)))) * 105 }
}
function pDist(x: number | string, y: number | string) {
  const depthM = (1 - Number(x)) * 105, widthM = (Number(y) - 0.5) * 68
  return Math.sqrt(depthM * depthM + widthM * widthM) * YD_PER_M
}
function dotStyle(recent: boolean, goal: boolean): React.CSSProperties {
  if (recent) return { fill: 'var(--accent)', fillOpacity: goal ? 1 : 0.8, stroke: goal ? '#fff' : 'none', strokeWidth: 0.35 }
  return { fill: goal ? 'rgba(255,255,255,0.62)' : 'rgba(255,255,255,0.26)', stroke: goal ? '#fff' : 'none', strokeWidth: 0.3 }
}

interface PTip { i: number; x: number; y: number }
export function PlayerScatterMap({ element }: { element: number }) {
  const [tip, setTip] = useState<PTip | null>(null)
  const pitchRef = useRef<HTMLDivElement>(null)
  const q = useLazyTable<ShotTable>('player_shots')
  const shots = ((q.data?.[String(element)] ?? []) as ShotEvent[]).filter((s) => s.situation !== 'Penalty')

  const recent = useMemo(() => {
    const dates = [...new Set(shots.map((s) => String(s.kickoff_date)))].sort().reverse().slice(0, 4)
    return new Set(dates)
  }, [shots])

  if (q.loading && !q.data) return <div className="py-6 text-sm text-ink-2">Loading shot data…</div>
  if (!q.loading && shots.length === 0) return <div className="py-6 text-sm text-ink-2">No non-penalty shots recorded for this player yet.</div>

  const n = shots.length
  const goals = shots.filter((s) => s.result === 'Goal').length
  const xg = shots.reduce((a, s) => a + (Number(s.xg) || 0), 0)
  const avgDist = n ? shots.reduce((a, s) => a + pDist(s.x, s.y), 0) / n : 0
  const cards = [
    { value: String(n), label: 'NP Shots' },
    { value: String(goals), label: 'NP Goals' },
    { value: xg.toFixed(1), label: 'NPxG' },
    { value: n ? (xg / n).toFixed(2) : '0.00', label: 'xG / Shot' },
    { value: `${avgDist.toFixed(1)} yd`, label: 'Avg. Distance' },
  ]

  // Older shots first so recent ones paint on top.
  const ordered = shots.map((s, i) => ({ s, i, isRecent: recent.has(String(s.kickoff_date)) })).sort((a, b) => (a.isRecent ? 1 : 0) - (b.isRecent ? 1 : 0))

  const onPointer = (i: number, e: React.PointerEvent) => {
    const rect = pitchRef.current?.getBoundingClientRect()
    if (!rect) return
    setTip({ i, x: Math.min(e.clientX - rect.left + 12, rect.width - 190), y: Math.max(e.clientY - rect.top - 56, 0) })
  }

  const swatch = (style: React.CSSProperties, label: string) => (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-ink-2">
      <span className="inline-block size-2.5 rounded-full" style={style} />
      {label}
    </span>
  )

  return (
    <div>
      <StatGrid cards={cards} />
      <div className="flex items-stretch gap-2">
        <Orientation />
        <div ref={pitchRef} className="relative mx-auto w-full max-w-[520px]" onPointerLeave={() => setTip(null)}>
          <svg className="shotmap-pitch" viewBox="0 -5 68 57.5" preserveAspectRatio="xMidYMid meet">
            <PitchChrome />
            <g>
              {ordered.map(({ s, i, isRecent }) => {
                const { cx, cy } = playerToPitch(s.x, s.y)
                const r = radiusFor(Number(s.xg))
                return (
                  <g key={i}>
                    <circle cx={cx} cy={cy} r={r} style={dotStyle(isRecent, s.result === 'Goal')} />
                    <circle className="pshot-hit" cx={cx} cy={cy} r={Math.max(r, 1.8) + 0.8} onPointerMove={(e) => onPointer(i, e)} />
                  </g>
                )
              })}
            </g>
          </svg>
          {tip && (() => {
            const s = shots[tip.i]
            const isRecent = recent.has(String(s.kickoff_date))
            return (
              <div className="pointer-events-none absolute z-20 w-[180px] rounded-md border border-line-mid bg-surface-3 px-3 py-2 shadow-float" style={{ left: tip.x, top: tip.y }}>
                <div className="mb-1 text-xs font-semibold text-ink">{RESULT_LABEL[String(s.result)] || s.result} · {s.minute}'</div>
                <div className="text-[11px] text-ink-2">{Number(s.xg).toFixed(2)} xG · {SITUATION_LABEL[String(s.situation)] || s.situation}</div>
                <div className="text-[11px] text-ink-2">vs {teamFullNames[String(s.opp)] || s.opp || '—'} · {s.kickoff_date}</div>
                {isRecent && <div className="mt-1 text-[10px] font-semibold text-accent">Last 4 GWs</div>}
              </div>
            )
          })()}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {swatch(dotStyle(true, true), 'Last 4 GWs · Goal')}
        {swatch(dotStyle(true, false), 'Last 4 GWs · Shot')}
        {swatch(dotStyle(false, true), 'Earlier · Goal')}
        {swatch(dotStyle(false, false), 'Earlier · Shot')}
        <span className="text-[11px] text-ink-3">Size = xG</span>
      </div>
    </div>
  )
}
