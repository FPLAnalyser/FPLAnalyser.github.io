import { useId, type ReactNode } from 'react'
import { AnimatedCounter } from './AnimatedCounter'
import { ordinal } from '../lib/util'

/** Shared categorical palette (maps to the --chart-* tokens). */
export const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'accent'

const TONE_COLOR: Record<Tone, string> = {
  good: 'var(--good)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  info: 'var(--info)',
  accent: 'var(--accent)',
}

const solidTone = (tone: Tone) => TONE_COLOR[tone]

/**
 * Radial gauge: value out of max as a rounded gradient arc with a count-up
 * centre and a `/max` suffix. The label sits BELOW the ring so long labels
 * (e.g. "Season rating") never get clipped inside the circle.
 */
export function RadialGauge({
  value,
  max = 100,
  label = '',
  size = 108,
  tone = 'accent',
  showMax = true,
}: {
  value: number | null
  max?: number
  label?: string
  size?: number
  tone?: Tone
  showMax?: boolean
}) {
  const gid = useId()
  if (value == null || isNaN(value)) return null
  const stroke = Math.max(8, Math.round(size * 0.1))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const frac = Math.max(0, Math.min(1, value / max))
  const color = TONE_COLOR[tone]
  const color2 = tone === 'accent' ? 'var(--accent-2)' : color
  return (
    <div className="inline-flex flex-col items-center gap-2">
      <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={color} />
              <stop offset="100%" stopColor={color2} />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={`url(#${gid})`}
            strokeWidth={stroke}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            strokeDasharray={c}
            strokeDashoffset={c - frac * c}
          />
        </svg>
        <div className="absolute flex items-baseline gap-0.5 leading-none">
          <AnimatedCounter value={value} className="font-num font-bold text-ink" style={{ fontSize: Math.round(size * 0.3) }} />
          {showMax && <span className="font-num font-semibold text-ink-3" style={{ fontSize: Math.round(size * 0.13) }}>/{max}</span>}
        </div>
      </div>
      {label && <div className="max-w-28 text-center text-[10px] font-semibold tracking-[0.1em] text-ink-3 uppercase">{label}</div>}
    </div>
  )
}

/** Sparkline: polyline with soft gradient area fill and a glowing last point. */
export function Sparkline({
  values,
  w = 220,
  h = 48,
  tone = 'accent',
}: {
  values: number[]
  w?: number
  h?: number
  tone?: Tone
}) {
  const gid = useId()
  const vals = (values || []).map(Number).filter((v) => !isNaN(v))
  if (vals.length < 2) return null
  const min = Math.min(...vals)
  const maxV = Math.max(...vals)
  const span = maxV - min || 1
  const pad = 4
  const x = (i: number) => pad + (i * (w - pad * 2)) / (vals.length - 1)
  const y = (v: number) => h - pad - ((v - min) * (h - pad * 2)) / span
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const color = solidTone(tone)
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`${x(0).toFixed(1)},${h - pad} ${pts} ${x(vals.length - 1).toFixed(1)},${h - pad}`}
        fill={`url(#${gid})`}
      />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(vals.length - 1).toFixed(1)} cy={y(vals[vals.length - 1]).toFixed(1)} r={3} fill={color} />
    </svg>
  )
}

/**
 * Radar / spider chart for a set of 0–100 dimensions. Plots one or two series
 * (e.g. Season vs Last 4GW) as filled polygons with a labelled axis grid.
 */
export function Radar({
  axes,
  size = 300,
  seriesALabel = 'Season',
  seriesBLabel,
}: {
  axes: { label: string; a: number | null; b?: number | null }[]
  size?: number
  seriesALabel?: string
  seriesBLabel?: string
}) {
  const n = axes.length
  if (n < 3) return null
  const cx = size / 2
  const cy = size / 2
  const pad = 54
  const R = (size - pad * 2) / 2
  const ang = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n
  const at = (i: number, frac: number): [number, number] => [cx + Math.cos(ang(i)) * R * frac, cy + Math.sin(ang(i)) * R * frac]
  const polyOf = (vals: (number | null | undefined)[]) =>
    vals.map((v, i) => { const f = v == null ? 0 : Math.max(0, Math.min(1, v / 100)); const [x, y] = at(i, f); return `${x.toFixed(1)},${y.toFixed(1)}` }).join(' ')
  const gridPoly = (frac: number) => axes.map((_, i) => { const [x, y] = at(i, frac); return `${x.toFixed(1)},${y.toFixed(1)}` }).join(' ')

  const hasB = axes.some((ax) => ax.b != null) && !!seriesBLabel

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <polygon key={f} points={gridPoly(f)} fill="none" stroke="var(--surface-3)" strokeWidth={1} />
        ))}
        {axes.map((_, i) => { const [x, y] = at(i, 1); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--surface-3)" strokeWidth={1} /> })}

        {hasB && (
          <polygon
            points={polyOf(axes.map((ax) => ax.b))}
            fill="var(--info)" fillOpacity={0.1} stroke="var(--info)" strokeWidth={1.5} strokeLinejoin="round"
          />
        )}
        <polygon
          points={polyOf(axes.map((ax) => ax.a))}
          fill="var(--accent)" fillOpacity={0.32} stroke="var(--accent)" strokeWidth={2.5} strokeLinejoin="round"
        />
        {axes.map((ax, i) => { const [x, y] = at(i, ax.a == null ? 0 : Math.max(0, Math.min(1, ax.a / 100))); return <circle key={i} cx={x} cy={y} r={2.5} fill="var(--accent)" /> })}

        {axes.map((ax, i) => {
          const [lx, ly] = at(i, 1.16)
          const cos = Math.cos(ang(i))
          const anchor = cos > 0.3 ? 'start' : cos < -0.3 ? 'end' : 'middle'
          return (
            <text key={i} x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" className="fill-ink-3 font-ui" style={{ fontSize: 9.5, fontWeight: 600 }}>
              {ax.label}
            </text>
          )
        })}
      </svg>
      <div className="mt-1 flex items-center gap-4 text-xs text-ink-2">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--accent)' }} />{seriesALabel}</span>
        {hasB && <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--info)' }} />{seriesBLabel}</span>}
      </div>
    </div>
  )
}

/**
 * Donut chart with a legend. Segments are auto-normalised to the total; each arc
 * fades in on scroll. Optional centre label/value.
 */
export function Donut({
  segments,
  size = 168,
  thickness = 24,
  centerLabel,
  centerValue,
}: {
  segments: { label: string; value: number; color: string }[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerValue?: ReactNode
}) {
  const clean = segments.filter((s) => s.value > 0)
  const total = clean.reduce((s, x) => s + x.value, 0)
  if (total <= 0) return null
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let acc = 0
  const arcs = clean.map((seg) => {
    const frac = seg.value / total
    const rot = -90 + (acc / total) * 360
    acc += seg.value
    return { ...seg, dash: frac * c, gap: c - frac * c, rot }
  })
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={thickness} />
          {arcs.map((a, i) => (
            <circle
              key={i}
              cx={size / 2} cy={size / 2} r={r} fill="none" stroke={a.color} strokeWidth={thickness}
              strokeDasharray={`${a.dash.toFixed(2)} ${a.gap.toFixed(2)}`}
              transform={`rotate(${a.rot} ${size / 2} ${size / 2})`}
            />
          ))}
        </svg>
        {(centerValue != null || centerLabel) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {centerValue != null && <div className="font-num text-xl font-bold text-ink">{centerValue}</div>}
            {centerLabel && <div className="text-[10px] tracking-wide text-ink-3 uppercase">{centerLabel}</div>}
          </div>
        )}
      </div>
      <ul className="min-w-32 flex-1 space-y-1.5">
        {clean.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-sm">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-ink-2">{s.label}</span>
            <span className="font-num tabular-nums text-ink">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Shared 0–100 tier thresholds — mirrors StarRating's tierOf so the app speaks
 * one rating language (elite ≥80 · strong ≥65 · fair ≥50 · weak <50). */
export function scoreTone(r: number): Tone | 'neutral' {
  if (r >= 80) return 'accent'
  if (r >= 65) return 'good'
  if (r >= 50) return 'neutral'
  return 'bad'
}
const SCORE_TEXT: Record<Tone | 'neutral', string> = {
  accent: 'text-accent', good: 'text-good', warn: 'text-warn', bad: 'text-bad',
  info: 'text-info', neutral: 'text-ink',
}

/**
 * Big 0–100 rating with its league rank underneath — the Teams card anchor for
 * Attack/Defence. Number is coloured by tier; a thin track echoes the score.
 * `total` defaults to the 20-team league.
 */
export function RatingNumber({
  value,
  rank,
  label,
  total = 20,
}: {
  value: number | null
  rank?: number | null
  label: string
  total?: number
}) {
  const has = value != null && !isNaN(value)
  const r = has ? Math.round(value as number) : null
  const tone = r == null ? 'neutral' : scoreTone(r)
  const barColor = tone === 'neutral' ? 'var(--ink-3)' : TONE_COLOR[tone as Tone]
  return (
    <div className="flex-1 rounded-lg border border-line bg-surface-1 px-3 py-3">
      <div className="text-[11px] font-semibold tracking-wide text-ink-2 uppercase">{label}</div>
      <div className="mt-1 flex items-baseline gap-1.5">
        {r == null ? (
          <span className="font-num text-3xl font-bold text-ink-3">—</span>
        ) : (
          <AnimatedCounter value={r} className={`font-num text-3xl font-bold tabular-nums ${SCORE_TEXT[tone]}`} />
        )}
        {rank != null && r != null && (
          <span className="font-num text-xs font-semibold tabular-nums text-ink-3">{ordinal(rank)}</span>
        )}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
        <span className="block h-full rounded-full" style={{ width: `${r ?? 0}%`, background: barColor }} />
      </div>
      {rank != null && r != null && (
        <div className="mt-1.5 text-[11px] text-ink-3">{ordinal(rank)} of {total} in league</div>
      )}
    </div>
  )
}

/**
 * Horizontal stacked bar of who carries a team's points — top-N players plus a
 * muted "rest of squad" tail — with a legend. Segments are normalised to the
 * total, so it reads as reliance risk at a glance (one dominant block = one-man
 * team; even blocks = spread).
 */
export function ConcentrationBar({
  segments,
  rest = 0,
  restLabel = 'Rest of squad',
  height = 16,
}: {
  segments: { label: string; value: number; color?: string }[]
  rest?: number
  restLabel?: string
  height?: number
}) {
  const clean = segments.filter((s) => s.value > 0)
  const restVal = rest > 0 ? rest : 0
  const total = clean.reduce((s, x) => s + x.value, 0) + restVal
  if (total <= 0) return null
  const parts = clean.map((s, i) => ({ ...s, color: s.color ?? CHART_COLORS[i % CHART_COLORS.length] }))
  return (
    <div>
      <div className="flex w-full overflow-hidden rounded-full bg-surface-3" style={{ height }}>
        {parts.map((s, i) => (
          <div
            key={i}
            style={{ width: `${(s.value / total) * 100}%`, background: s.color }}
            title={`${s.label} — ${Math.round((s.value / total) * 100)}% of team points`}
          />
        ))}
        {restVal > 0 && (
          <div
            style={{ width: `${(restVal / total) * 100}%`, background: 'var(--surface-3)' }}
            title={`${restLabel} — ${Math.round((restVal / total) * 100)}%`}
          />
        )}
      </div>
      <ul className="mt-2.5 space-y-1">
        {parts.map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="w-4 text-ink-3">{i + 1}</span>
            <span className="min-w-0 flex-1 truncate text-ink-2">{s.label}</span>
            <span className="font-num tabular-nums text-ink">{Math.round((s.value / total) * 100)}%</span>
          </li>
        ))}
        {restVal > 0 && (
          <li className="flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-surface-3" />
            <span className="w-4" />
            <span className="min-w-0 flex-1 truncate text-ink-3">{restLabel}</span>
            <span className="font-num tabular-nums text-ink-3">{Math.round((restVal / total) * 100)}%</span>
          </li>
        )}
      </ul>
    </div>
  )
}

/** Mini bar for table cells: value over a rounded track, swept in on scroll. */
export function MiniBar({
  value,
  max,
  tone = 'accent',
  text,
}: {
  value: number | null
  max: number
  tone?: Tone
  text?: string
}) {
  const v = Number(value)
  if (isNaN(v) || !max) return <span className="text-ink-3">{text ?? (value == null ? 'N/A' : String(value))}</span>
  const widthPct = Math.max(2, Math.min(100, (v / max) * 100))
  return (
    <div className="flex items-center gap-2">
      <span className="font-num text-sm tabular-nums">{text ?? value}</span>
      <span className="h-1.5 min-w-14 flex-1 overflow-hidden rounded-full bg-surface-3">
        <span
          className="block h-full rounded-full"
          style={{ background: solidTone(tone), width: `${widthPct}%` }}
        />
      </span>
    </div>
  )
}
