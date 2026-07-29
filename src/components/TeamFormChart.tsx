import { useState } from 'react'
import { num, str } from '../lib/rows'
import type { Row } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   A club's xG and xA, gameweek by gameweek.

   Every other team number on the site is a window average — season, last six,
   last four. Averages tell you where a club stands and hide when it changed,
   which is the question a manager is actually asking: is this attack coming
   or going. So this draws the weeks themselves.

   One axis, deliberately. xG and xA are both expected-involvement counts on
   the same per-match scale, so they share a scale honestly; giving each its
   own axis would let any pair of lines be made to cross wherever the drawing
   suited the story.

   The source is the per-player gameweek feed summed to a club total, which is
   also the honest limit: it covers whatever gameweeks that feed carries, and
   the component says so rather than implying it has the whole season.
   ════════════════════════════════════════════════════════════════════════ */

export interface Point { gw: number; xg: number; xa: number }

const PAD = { t: 16, r: 44, b: 22, l: 34 }
const W = 640
const H = 210

/** Mean of the last n values, or null when there aren't n of them. */
function tailMean(xs: number[], n: number): number | null {
  if (xs.length < n) return null
  return xs.slice(-n).reduce((a, b) => a + b, 0) / n
}

export interface TeamTrend {
  /** Points actually plotted, oldest first. */
  points: Point[]
  /** Last-4 mean minus the mean of everything before it. Null without both. */
  xgShift: number | null
  xaShift: number | null
}

/** Aggregate the per-player gameweek feed into one club's weekly totals. */
export function teamTrend(rows: Row[], team: string): TeamTrend {
  const byGw = new Map<number, Point>()
  for (const r of rows) {
    if (str(r, 'team') !== team) continue
    const gw = num(r, 'gw')
    if (gw == null) continue
    const p = byGw.get(gw) ?? { gw, xg: 0, xa: 0 }
    p.xg += num(r, 'expected_goals') ?? 0
    p.xa += num(r, 'expected_assists') ?? 0
    byGw.set(gw, p)
  }
  const points = [...byGw.values()].sort((a, b) => a.gw - b.gw)
  const shift = (pick: (p: Point) => number) => {
    const xs = points.map(pick)
    const recent = tailMean(xs, 4)
    const before = xs.slice(0, -4)
    if (recent == null || before.length < 2) return null
    return recent - before.reduce((a, b) => a + b, 0) / before.length
  }
  return { points, xgShift: shift((p) => p.xg), xaShift: shift((p) => p.xa) }
}

/** The one-line read above the chart. Deliberately refuses to call a shift
 *  either way until it is worth a sentence — a 0.05 xG wobble is noise, and
 *  dressing it as "rising" is the failure mode of every form table. */
export function trendWords(t: TeamTrend, team: string): string | null {
  const n = t.points.length
  if (n < 6 || t.xgShift == null) return null
  const dir = (v: number) => (v > 0.25 ? 'up' : v < -0.25 ? 'down' : 'flat')
  const g = dir(t.xgShift)
  const a = t.xaShift == null ? 'flat' : dir(t.xaShift)
  const amt = Math.abs(t.xgShift).toFixed(2)
  if (g === 'up' && a === 'up') return `${team} are creating more of everything — xG up ${amt} a game on their earlier weeks, and the chances are being made as well as taken.`
  if (g === 'up') return `${team}'s xG is up ${amt} a game on their earlier weeks — the shots are coming, even though the chance creation behind them has not moved.`
  if (g === 'down' && a === 'down') return `${team} have gone quiet at both ends of the chance — xG down ${amt} a game on their earlier weeks.`
  if (g === 'down') return `${team}'s xG is down ${amt} a game on their earlier weeks, though the creation behind it is holding up.`
  return `${team}'s attack has been steady — no meaningful shift in xG across these ${n} gameweeks.`
}

/** Pure: the caller owns the fetch, because it also has to decide whether the
 *  surrounding section is worth showing at all. An earlier version fetched
 *  here and sat on its loading skeleton forever whenever the gameweek feed was
 *  absent — which is every day of pre-season. */
export function TeamFormChart({ team, points, className = '' }: { team: string; points: Point[]; className?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  if (points.length < 2) return null

  const max = Math.max(...points.flatMap((p) => [p.xg, p.xa]), 1) * 1.12
  const X = (i: number) => PAD.l + (i / Math.max(1, points.length - 1)) * (W - PAD.l - PAD.r)
  const Y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b)
  const path = (pick: (p: Point) => number) => points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(pick(p)).toFixed(1)}`).join(' ')

  const SERIES = [
    { key: 'xg' as const, label: 'xG', colour: 'var(--series-1)', pick: (p: Point) => p.xg },
    { key: 'xa' as const, label: 'xA', colour: 'var(--series-2)', pick: (p: Point) => p.xa },
  ]
  // Four gridlines is enough to read a level against without the grid becoming
  // a thing you look at.
  const ticks = [0, max / 3, (max * 2) / 3, max]
  const last = points[points.length - 1]
  const hp = hover == null ? null : points[hover]

  return (
    <div className={className}>
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink-2">
            <i className="block h-[3px] w-4 rounded-full" style={{ background: s.colour }} />
            {s.label}
          </span>
        ))}
        <span className="ml-auto text-[11px] text-ink-3">
          GW{points[0].gw}–{last.gw} · {points.length} {points.length === 1 ? 'gameweek' : 'gameweeks'} published
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 'auto' }}
        role="img"
        aria-label={`${team} expected goals and expected assists by gameweek, GW${points[0].gw} to GW${last.gw}. Latest: ${last.xg.toFixed(2)} xG, ${last.xa.toFixed(2)} xA.`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const x = ((e.clientX - r.left) / r.width) * W
          const step = (W - PAD.l - PAD.r) / Math.max(1, points.length - 1)
          setHover(Math.max(0, Math.min(points.length - 1, Math.round((x - PAD.l) / step))))
        }}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(t)} y2={Y(t)} stroke="var(--line-subtle)" strokeWidth="1" />
            <text x={PAD.l - 6} y={Y(t) + 3.5} textAnchor="end" fontSize="9" fill="var(--ink-3)">{t.toFixed(1)}</text>
          </g>
        ))}

        {/* Gameweek numbers, thinned so they never collide on a long season. */}
        {points.map((p, i) =>
          i % Math.ceil(points.length / 10) === 0 || i === points.length - 1 ? (
            <text key={p.gw} x={X(i)} y={H - 7} textAnchor="middle" fontSize="9" fill="var(--ink-3)">{p.gw}</text>
          ) : null,
        )}

        {hp && <line x1={X(hover!)} x2={X(hover!)} y1={PAD.t} y2={H - PAD.b} stroke="var(--line-strong)" strokeWidth="1" />}

        {SERIES.map((s) => (
          <path key={s.key} d={path(s.pick)} fill="none" stroke={s.colour} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {/* Markers only on the hovered week and the last one: a dot on every
            point turns a line into a bead necklace. The 2px surface ring keeps
            the two series legible where they cross. */}
        {SERIES.map((s) => (
          <g key={`m${s.key}`}>
            <circle cx={X(points.length - 1)} cy={Y(s.pick(last))} r="4.5" fill={s.colour} stroke="var(--surface-1)" strokeWidth="2" />
            {hp && hover !== points.length - 1 && (
              <circle cx={X(hover!)} cy={Y(s.pick(hp))} r="4.5" fill={s.colour} stroke="var(--surface-1)" strokeWidth="2" />
            )}
            <text x={X(points.length - 1) + 8} y={Y(s.pick(last)) + 3.5} fontSize="10" fontWeight="700" fill="var(--ink-2)">
              {s.pick(last).toFixed(1)}
            </text>
          </g>
        ))}
      </svg>

      {hp && (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 text-[11.5px] text-ink-2">
          <b className="text-ink">GW{hp.gw}</b>
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <i className="block size-2 rounded-full" style={{ background: s.colour }} />
              {s.label} <b className="font-num tabular-nums text-ink">{s.pick(hp).toFixed(2)}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
