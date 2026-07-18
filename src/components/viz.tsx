import { useId } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { AnimatedCounter } from './AnimatedCounter'

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'accent'

const TONE_COLOR: Record<Tone, string> = {
  good: 'var(--good)',
  warn: 'var(--warn)',
  bad: 'var(--bad)',
  info: 'var(--info)',
  accent: 'var(--accent)',
}

const solidTone = (tone: Tone) => TONE_COLOR[tone]

/** Radial gauge: value out of max as a rounded donut arc with count-up centre. */
export function RadialGauge({
  value,
  max = 100,
  label = '',
  size = 108,
  tone = 'accent',
}: {
  value: number | null
  max?: number
  label?: string
  size?: number
  tone?: Tone
}) {
  const reduced = useReducedMotion()
  if (value == null || isNaN(value)) return null
  const stroke = 8
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const frac = Math.max(0, Math.min(1, value / max))
  const color = TONE_COLOR[tone]
  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          strokeDasharray={c}
          initial={reduced ? false : { strokeDashoffset: c }}
          whileInView={{ strokeDashoffset: c - frac * c }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          style={reduced ? { strokeDashoffset: c - frac * c } : undefined}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <AnimatedCounter value={value} className="font-num text-2xl font-semibold text-ink" />
        {label && <div className="mt-0.5 text-[11px] tracking-wide text-ink-2 uppercase">{label}</div>}
      </div>
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
  const reduced = useReducedMotion()
  const v = Number(value)
  if (isNaN(v) || !max) return <span className="text-ink-3">{text ?? (value == null ? 'N/A' : String(value))}</span>
  const widthPct = Math.max(2, Math.min(100, (v / max) * 100))
  return (
    <div className="flex items-center gap-2">
      <span className="font-num text-sm tabular-nums">{text ?? value}</span>
      <span className="h-1.5 min-w-14 flex-1 overflow-hidden rounded-full bg-surface-3">
        <motion.span
          className="block h-full rounded-full"
          style={{ background: solidTone(tone) }}
          initial={reduced ? false : { width: 0 }}
          whileInView={{ width: `${widthPct}%` }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
        />
      </span>
    </div>
  )
}
