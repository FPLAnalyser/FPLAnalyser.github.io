import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ratingTo100 } from './StarRating'
import { num } from '../lib/rows'
import { teamLabel } from '../lib/util'
import type { RatingRow, TeamRatingRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   One chart grammar, everywhere: grey field of peers, a dashed reference,
   the selection in gold. Used by the Players compare mode and the Teams
   league map.
   ════════════════════════════════════════════════════════════════════════ */

/** Horizontal-scroll wrapper that starts scrolled so the highlighted point
 * is in view when the chart is wider than the screen (mobile). */
function ScrollTo({ frac, children }: { frac: number | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && frac != null && el.scrollWidth > el.clientWidth) el.scrollLeft = Math.max(0, frac * el.scrollWidth - el.clientWidth / 2)
  }, [frac])
  return <div ref={ref} className="overflow-x-auto">{children}</div>
}

/* ── Players: three lenses over the same field ─────────────────────────── */

export type CompareLens = 'value' | 'roles' | 'momentum' | 'workload' | 'triple'

/** The pool's position character — decides what the "roles" lens plots. */
export type PosMode = 'GKP' | 'DEF' | 'ATT'
export const posModeOf = (rows: RatingRow[]): PosMode =>
  rows.length > 0 && rows.every((r) => r.position === 'GKP') ? 'GKP'
  : rows.length > 0 && rows.every((r) => r.position === 'DEF') ? 'DEF'
  : 'ATT'

/* ── The three-variable lens ────────────────────────────────────────────────
   Two axes carry the pair you'd normally plot; bubble size carries a third
   number that would otherwise need its own chart. Area is proportional to
   the value, not radius, so a bubble twice as big means twice as much.
   ──────────────────────────────────────────────────────────────────────── */

const pctF = (v: number) => `${Math.round(v)}%`
const d2F = (v: number) => v.toFixed(2)

interface TripleSpec {
  label: string
  tip: string
  note: string
  /** [y-axis ↑, x-axis →] */
  axis: [string, string]
  /** Legend heading for what the bubble size means. */
  zLabel: string
  x: (r: RatingRow) => number | null
  y: (r: RatingRow) => number | null
  z: (r: RatingRow) => number | null
  fx: (v: number) => string
  fy: (v: number) => string
  fz: (v: number) => string
  quads: Quadrants
}

const scale100 = (v: number | null) => (v == null ? null : v * 100)
const sumOf = (r: RatingRow, a: string, b: string) => {
  const x = num(r, a), y = num(r, b)
  return x == null && y == null ? null : (x ?? 0) + (y ?? 0)
}

const TRIPLE: Record<PosMode, TripleSpec> = {
  DEF: {
    label: 'Three-way — clean sheets × def con × xGI',
    tip: 'Def Con hit rate (x) against clean-sheet rate (y), with the bubble sized by attacking threat (xG + xA per 90). The top-right bubbles earn from both defensive routes; a big bubble anywhere means he also threatens at the other end.',
    note: 'Bubble size = attacking threat (xG + xA per 90). Top-right earns from both defensive routes; a big bubble adds a third way to score.',
    axis: ['Clean sheet % ↑', 'Def Con hit % →'],
    zLabel: 'xGI / 90',
    x: (r) => scale100(num(r, 'season_m_dc_hit')),
    y: (r) => scale100(num(r, 'season_m_cs_rate')),
    z: (r) => sumOf(r, 'season_m_xg', 'season_m_xa'),
    fx: pctF, fy: pctF, fz: d2F,
    quads: { best: 'tr', worst: 'bl', labels: { tr: 'Both routes', tl: 'Clean sheets only', br: 'Def Con only', bl: 'Neither' } },
  },
  GKP: {
    label: 'Three-way — saves × xGC × shot danger',
    tip: 'Saves per 90 (x) against expected goals conceded per 90 (y), with the bubble sized by the share of shots his defence lets into the box. Bottom-right is the dream: plenty of saves behind a mean defence. A big bubble means the shots he faces come from dangerous positions (the mirror of average shot distance).',
    note: 'Bubble size = share of shots faced from inside the box — bigger means the shots come from closer, harder positions. Bottom-right is the dream: save volume behind a mean defence.',
    axis: ['xGC / 90 ↑', 'Saves / 90 →'],
    zLabel: 'Shots faced in the box',
    x: (r) => num(r, 'season_m_saves'),
    y: (r) => num(r, 'season_m_xgc'),
    z: (r) => scale100(num(r, 'season_m_box_faced')),
    fx: d2F, fy: d2F, fz: pctF,
    quads: { best: 'br', worst: 'tl', labels: { br: 'Busy · mean defence', tl: 'Quiet · leaky defence', tr: 'Busy · leaky', bl: 'Quiet · mean' } },
  },
  ATT: {
    label: 'Three-way — xG × shots on target × shots in the box',
    tip: 'Expected goals per 90 (x) against shots on target per 90 (y), with the bubble sized by shots taken inside the box per 90. Top-right is volume and quality together; a big bubble says the volume comes from dangerous positions rather than hopeful efforts.',
    note: 'Bubble size = shots taken inside the box per 90. Top-right is volume and quality together; a big bubble means the shots come from dangerous positions.',
    axis: ['Shots on target / 90 ↑', 'npxG / 90 →'],
    zLabel: 'Box shots / 90',
    x: (r) => num(r, 'season_m_xg'),
    y: (r) => num(r, 'season_m_sot'),
    z: (r) => num(r, 'season_m_box_shots'),
    fx: d2F, fy: d2F, fz: d2F,
    quads: { best: 'tr', worst: 'bl', labels: { tr: 'Volume & quality', tl: 'On target, low xG', br: 'High xG, off target', bl: 'Low threat' } },
  },
}

/** Bubble radius, area-proportional to the third variable. */
function radiusOf(z: number, zMin: number, zMax: number): number {
  const R_MIN = 3.5, R_MAX = 14
  const t = zMax > zMin ? (z - zMin) / (zMax - zMin) : 0.5
  return Math.sqrt(R_MIN * R_MIN + t * (R_MAX * R_MAX - R_MIN * R_MIN))
}

/** Lens chips — the roles lens becomes a position-specific chart: keepers get
 * saves × xGC, defenders def con × clean sheets, everyone else xG × xA. */
export function compareLenses(mode: PosMode): { id: CompareLens; label: string; tip: string }[] {
  const roles =
    mode === 'GKP'
      ? { id: 'roles' as const, label: 'Keepers — saves × xGC', tip: 'Saves per 90 (x) against expected goals conceded per 90 (y). Bottom-right is the dream: a busy keeper behind a defence that still concedes little. Low on the chart = better defence in front (the clean-sheet route); far right = save-points volume.' }
      : mode === 'DEF'
        ? { id: 'roles' as const, label: 'Defenders — def con × clean sheets', tip: 'Share of starts hitting the +2 Def Con threshold (x) against clean-sheet rate (y). Top-right earns both ways; far right earns without needing the clean sheet; top-left is a pure clean-sheet play.' }
        : { id: 'roles' as const, label: 'Roles — xG × xA', tip: 'Non-penalty goal threat (x) against creativity (y), both per 90. Scorers sit right, creators sit high, the rare both-axis elite sit top-right.' }
  const t = TRIPLE[mode]
  return [
    { id: 'value', label: 'Value — price × FPL Analyser rating', tip: 'Every player plotted price (x) against their FPL Analyser rating (y). The dashed line is the fair price for a given rating — above it = value.' },
    roles,
    { id: 'triple' as const, label: t.label, tip: t.tip },
    ...(mode === 'GKP'
      ? [{ id: 'workload' as const, label: 'Keepers — shot distance × saves', tip: "Average distance of the shots a keeper faces (x) against saves per 90 (y). Left = shots taken close to goal, so each one is harder and the defence is letting attackers in; right = shots from range, the easy kind. High and right is the save-points sweet spot: plenty of saves, mostly from distance." }]
      : []),
    { id: 'momentum', label: 'Momentum — season × last 4 rating', tip: 'Season FPL Analyser rating (x) against the last-4-gameweek FPL Analyser rating (y). Above the diagonal = form running ahead of reputation; below = cooling.' },
  ]
}

/** Quadrant guides: which corner is good, which is bad, and what to call
 * them. Null where the chart's meaning isn't a corner (value, momentum use
 * a reference line instead). */
interface Quadrants { best: 'tr' | 'tl' | 'br' | 'bl'; worst: 'tr' | 'tl' | 'br' | 'bl'; labels: Partial<Record<'tr' | 'tl' | 'br' | 'bl', string>> }
function quadrantsFor(lens: CompareLens, mode: PosMode): Quadrants | null {
  if (lens === 'triple') return TRIPLE[mode].quads
  if (lens === 'roles') {
    if (mode === 'GKP') {
      // x = saves, y = xGC. Low xGC + high saves = busy behind a good defence.
      return { best: 'br', worst: 'tl', labels: { br: 'Busy · mean defence', tl: 'Quiet · leaky defence', tr: 'Busy · leaky', bl: 'Quiet · mean' } }
    }
    if (mode === 'DEF') {
      return { best: 'tr', worst: 'bl', labels: { tr: 'Both routes', tl: 'Clean sheets only', br: 'Def Con only', bl: 'Neither' } }
    }
    return { best: 'tr', worst: 'bl', labels: { tr: 'Scores & creates', tl: 'Creator', br: 'Scorer', bl: 'Neither' } }
  }
  if (lens === 'workload') {
    // x = avg shot distance faced (left = close), y = saves (top = many).
    // Best: plenty of saves from distance. Worst: few saves and the shots
    // that do come are close in.
    return {
      best: 'tr',
      worst: 'bl',
      labels: {
        tr: 'Save points, from range',
        tl: 'Busy under pressure',
        br: 'Quiet, shots from range',
        bl: 'Few saves, close range',
      },
    }
  }
  return null
}

interface Pt { r: RatingRow; x: number; y: number; z?: number }

/** Which positions a lens can plot — the triple lens needs the pool to match
 * the spec it's built from, so a mixed pool falls back to the attacker view. */
function inPool(r: RatingRow, mode: PosMode): boolean {
  return mode === 'GKP' ? r.position === 'GKP' : mode === 'DEF' ? r.position === 'DEF' : r.position !== 'GKP'
}

function lensPoints(rows: RatingRow[], lens: CompareLens, mode: PosMode): Pt[] {
  const pts: Pt[] = []
  for (const r of rows) {
    if (lens === 'triple') {
      if (!inPool(r, mode)) continue
      const spec = TRIPLE[mode]
      const x = spec.x(r), y = spec.y(r), z = spec.z(r)
      if (x != null && y != null && z != null) pts.push({ r, x, y, z })
      continue
    }
    let x: number | null = null
    let y: number | null = null
    if (lens === 'value') {
      x = num(r, 'price')
      y = ratingTo100(num(r, 'season_overall_score'))
    } else if (lens === 'workload') {
      if (r.position !== 'GKP') continue
      x = num(r, 'season_m_dist_faced')
      y = num(r, 'season_m_saves')
    } else if (lens === 'roles') {
      if (mode === 'GKP') {
        if (r.position !== 'GKP') continue
        x = num(r, 'season_m_saves')
        y = num(r, 'season_m_xgc')
      } else if (mode === 'DEF') {
        if (r.position !== 'DEF') continue
        const hit = num(r, 'season_m_dc_hit')
        const cs = num(r, 'season_m_cs_rate')
        x = hit != null ? hit * 100 : null
        y = cs != null ? cs * 100 : null
      } else {
        if (r.position === 'GKP') continue
        x = num(r, 'season_m_xg')
        y = num(r, 'season_m_xa')
      }
    } else {
      x = ratingTo100(num(r, 'season_overall_score'))
      y = ratingTo100(num(r, 'gw4_overall_score'))
    }
    if (x != null && y != null) pts.push({ r, x, y })
  }
  return pts
}

/** ~5 rounded gridline values spanning a range — "nice" steps so the labels
 * read 0.5 / 1.0 / 1.5, never 0.4732. */
function ticks(min: number, max: number, target = 5): number[] {
  const span = max - min
  if (!(span > 0)) return [min]
  const raw = span / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const out: number[] = []
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) out.push(Number(t.toFixed(6)))
  return out
}

/** Legend for the bubble-size variable: three circles at the low, middle and
 * high end of the range, drawn at the same scale the chart uses. */
function BubbleKey({ label, min, max, fmt }: { label: string; min: number; max: number; fmt: (v: number) => string }) {
  const stops = [min, (min + max) / 2, max]
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] font-semibold tracking-[0.1em] text-ink-3 uppercase">{label}</span>
      <svg width={112} height={32} aria-hidden="true">
        {stops.map((z, i) => {
          const r = radiusOf(z, min, max)
          const cx = 16 + i * 40
          return (
            <g key={i}>
              <circle cx={cx} cy={15} r={r} fill="var(--ink-3)" opacity="0.42" stroke="var(--surface-1)" strokeWidth="1" />
              <text x={cx} y={30} textAnchor="middle" fontSize="8.5" fill="var(--ink-3)">{fmt(z)}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function PlayerCompare({ rows, lens, highlightName, onPlayer }: {
  rows: RatingRow[]
  lens: CompareLens
  highlightName?: string | null
  onPlayer: (name: string, code?: number | null) => void
}) {
  const mode = posModeOf(rows)
  const pts = useMemo(() => lensPoints(rows, lens, mode), [rows, lens, mode])
  const [hovered, setHovered] = useState<number | null>(null)
  const [showAllNames, setShowAllNames] = useState(false)
  if (pts.length < 8) return <p className="py-8 text-center text-sm text-ink-3">Not enough rated players for this view yet.</p>

  const W = 720, H = 380, PAD = { l: 46, r: 18, t: 18, b: 34 }
  const xs = pts.map((d) => d.x), ys = pts.map((d) => d.y)
  const xMin = Math.min(...xs), xMax = Math.max(...xs)
  const yMin = Math.min(...ys), yMax = Math.max(...ys)
  const xPadU = (xMax - xMin || 1) * 0.06, yPadU = (yMax - yMin || 1) * 0.08
  const X = (v: number) => PAD.l + ((v - (xMin - xPadU)) / ((xMax + xPadU) - (xMin - xPadU))) * (W - PAD.l - PAD.r)
  const Y = (v: number) => H - PAD.b - ((v - (yMin - yPadU)) / ((yMax + yPadU) - (yMin - yPadU))) * (H - PAD.t - PAD.b)

  // Reference line: least-squares fit for value; the y=x diagonal for
  // momentum; none for roles (the quadrants are the reference).
  let ref: { x1: number; y1: number; x2: number; y2: number } | null = null
  if (lens === 'value') {
    const n = pts.length
    const mx = xs.reduce((s, v) => s + v, 0) / n
    const my = ys.reduce((s, v) => s + v, 0) / n
    const slope = pts.reduce((s, d) => s + (d.x - mx) * (d.y - my), 0) / (pts.reduce((s, d) => s + (d.x - mx) ** 2, 0) || 1)
    const fy = (x: number) => my + slope * (x - mx)
    ref = { x1: X(xMin), y1: Y(Math.max(yMin - yPadU, Math.min(yMax + yPadU, fy(xMin)))), x2: X(xMax), y2: Y(Math.max(yMin - yPadU, Math.min(yMax + yPadU, fy(xMax)))) }
  } else if (lens === 'momentum') {
    const lo = Math.max(xMin, yMin), hi = Math.min(xMax, yMax)
    if (hi > lo) ref = { x1: X(lo), y1: Y(lo), x2: X(hi), y2: Y(hi) }
  }

  const quads = quadrantsFor(lens, mode)
  // Gold = the searched player (if matched) or, failing that, whoever sits
  // deepest into the chart's good corner — which is not always "highest y"
  // (a keeper's best corner is bottom-right: many saves, low xGC).
  const nx = (d: Pt) => (d.x - xMin) / (xMax - xMin || 1)
  const ny = (d: Pt) => (d.y - yMin) / (yMax - yMin || 1)
  const goodness = (d: Pt) => {
    if (!quads) return ny(d)
    const gx = quads.best === 'tr' || quads.best === 'br' ? nx(d) : 1 - nx(d)
    const gy = quads.best === 'tr' || quads.best === 'tl' ? ny(d) : 1 - ny(d)
    return gx + gy
  }
  // The triple lens ranks by its third variable — the big bubbles are what
  // the chart is there to show.
  const notable = (d: Pt) => (lens === 'triple' ? d.z ?? 0 : goodness(d))
  const hl = highlightName
    ? pts.find((d) => String(d.r.web_name).toLowerCase().includes(highlightName.toLowerCase())) ?? null
    : null
  const gold = hl ?? [...pts].sort((a, b) => goodness(b) - goodness(a))[0]
  const labelled = [...pts].sort((a, b) => notable(b) - notable(a)).slice(0, 4).filter((d) => d !== gold)

  const midX = X((xMin + xMax) / 2)
  const midY = Y((yMin + yMax) / 2)
  // The gold player's name prints beside his dot. Where that lands on top of a
  // quadrant caption, the caption gives way — two labels in the same 20 pixels
  // is worse than one caption missing.
  const clashes = (q: 'tr' | 'tl' | 'br' | 'bl') => {
    if (q[1] !== (X(gold.x) > midX ? 'r' : 'l')) return false
    const goldLabelY = Math.max(16, Y(gold.y) - rOf(gold, false) - 6)
    const capY = q[0] === 't' ? PAD.t + 13 : H - PAD.b - 8
    return Math.abs(goldLabelY - capY) < 18
  }

  // Percent-style lenses print whole numbers; per-90 rates get 2dp. The triple
  // lens brings its own per-axis formatters, since its three numbers rarely
  // share a unit.
  const spec = lens === 'triple' ? TRIPLE[mode] : null
  const pctLens = lens === 'roles' && mode === 'DEF'
  const rateLens = (lens === 'roles' && mode !== 'DEF') || lens === 'workload'
  const axis: [string, string] = spec ? spec.axis
    : lens === 'value' ? ['FPL Analyser rating ↑', 'Price →']
    : lens === 'workload' ? ['Saves / 90 ↑', 'Avg shot distance faced →']
    : lens === 'roles'
      ? mode === 'GKP' ? ['xGC / 90 ↑', 'Saves / 90 →']
        : mode === 'DEF' ? ['Clean sheet % ↑', 'Def Con hit % →']
        : ['xA / 90 ↑', 'npxG / 90 →']
      : ['Last 4 GW rating ↑', 'Season rating →']
  // Axis-specific: only the value lens's X axis is money — its Y is a rating.
  const xTickLabel = (v: number) =>
    spec ? spec.fx(v) : lens === 'value' ? `£${v}m` : pctLens ? `${Math.round(v)}%` : rateLens ? v.toFixed(2) : String(Math.round(v))
  const yTickLabel = (v: number) =>
    spec ? spec.fy(v) : lens === 'value' ? String(Math.round(v)) : pctLens ? `${Math.round(v)}%` : rateLens ? v.toFixed(2) : String(Math.round(v))
  // Value lens: x IS the price, so the label reads "name · rating · £price".
  // Triple lens: all three numbers, each with its own unit.
  const labelFor = (d: Pt) =>
    spec ? `${d.r.web_name} · ${spec.fx(d.x)} / ${spec.fy(d.y)} · ${spec.fz(d.z ?? 0)} ${spec.zLabel}`
    : lens === 'value' ? `${d.r.web_name} · ${Math.round(d.y)} · £${d.r.price}m`
    : `${d.r.web_name} · ${xTickLabel(d.x)} / ${yTickLabel(d.y)}`
  const hoveredPt = hovered != null ? pts.find((d) => d.r.element === hovered) ?? null : null
  const xTicks = ticks(xMin - xPadU, xMax + xPadU)
  const yTicks = ticks(yMin - yPadU, yMax + yPadU)

  // Bubble sizing for the triple lens: area ∝ the third variable.
  const zs = spec ? pts.map((d) => d.z ?? 0) : []
  const zMin = zs.length ? Math.min(...zs) : 0
  const zMax = zs.length ? Math.max(...zs) : 1
  const rOf = (d: Pt, active: boolean) =>
    spec ? radiusOf(d.z ?? 0, zMin, zMax) + (active ? 2 : 0) : active ? 6 : 4

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        {spec && <BubbleKey label={spec.zLabel} min={zMin} max={zMax} fmt={spec.fz} />}
        <label className="ml-auto inline-flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-ink-2">
          <input type="checkbox" checked={showAllNames} onChange={(e) => setShowAllNames(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Show all names
        </label>
      </div>
      <ScrollTo frac={(X(gold.x) - PAD.l) / (W - PAD.l - PAD.r)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label="Player comparison scatter">
          {/* quadrants: a green wash on the corner you want to be in, a red
              wash on the one you don't, both faint enough to stay behind. */}
          {quads && (() => {
            const box = (q: 'tr' | 'tl' | 'br' | 'bl') => ({
              x: q === 'tl' || q === 'bl' ? PAD.l : midX,
              y: q === 'tl' || q === 'tr' ? PAD.t : midY,
              width: (q === 'tl' || q === 'bl' ? midX - PAD.l : W - PAD.r - midX),
              height: (q === 'tl' || q === 'tr' ? midY - PAD.t : H - PAD.b - midY),
            })
            const b = box(quads.best), w = box(quads.worst)
            const anchor = (q: 'tr' | 'tl' | 'br' | 'bl') => {
              const r = box(q)
              const right = q === 'tr' || q === 'br'
              const bottom = q === 'bl' || q === 'br'
              return { x: right ? r.x + r.width - 8 : r.x + 8, y: bottom ? r.y + r.height - 8 : r.y + 13, anchor: right ? 'end' as const : 'start' as const }
            }
            return (
              <g>
                <rect {...b} fill="var(--good)" opacity="0.07" />
                <rect {...w} fill="var(--bad)" opacity="0.06" />
                {(Object.keys(quads.labels) as ('tr' | 'tl' | 'br' | 'bl')[]).filter((q) => !clashes(q)).map((q) => {
                  const a = anchor(q)
                  const tone = q === quads.best ? 'var(--good)' : q === quads.worst ? 'var(--bad)' : 'var(--ink-3)'
                  return (
                    <text key={q} x={a.x} y={a.y} textAnchor={a.anchor} fontSize="9" fontWeight="800" fill={tone} opacity="0.85" style={{ textTransform: 'uppercase', letterSpacing: '.1em' }}>
                      {quads.labels[q]}
                    </text>
                  )
                })}
              </g>
            )
          })()}
          {/* gridlines — recessive, behind everything */}
          {yTicks.map((t) => (
            <g key={`y${t}`}>
              <line x1={PAD.l} x2={W - PAD.r} y1={Y(t)} y2={Y(t)} stroke="var(--line)" strokeWidth="1" />
              <text x={PAD.l - 7} y={Y(t) + 3.5} textAnchor="end" fontSize="9.5" fill="var(--ink-3)">{yTickLabel(t)}</text>
            </g>
          ))}
          {xTicks.map((t) => (
            <g key={`x${t}`}>
              <line x1={X(t)} x2={X(t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--line)" strokeWidth="1" />
              <text x={X(t)} y={H - PAD.b + 15} textAnchor="middle" fontSize="9.5" fill="var(--ink-3)">{xTickLabel(t)}</text>
            </g>
          ))}
          <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="var(--line-mid)" />
          <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="var(--line-mid)" />
          {ref && <line {...{ x1: ref.x1, y1: ref.y1, x2: ref.x2, y2: ref.y2 }} stroke="var(--ink-3)" strokeWidth="1.5" strokeDasharray="5 4" opacity="0.5" />}
          {/* biggest bubbles first, so the small ones stay hoverable on top */}
          {pts.filter((d) => d !== gold).sort((a, b) => rOf(b, false) - rOf(a, false)).map((d) => (
            <circle
              key={String(d.r.element)}
              cx={X(d.x)} cy={Y(d.y)}
              r={rOf(d, hovered === d.r.element)}
              fill={hovered === d.r.element ? 'var(--ink-2)' : 'var(--ink-3)'}
              stroke={spec ? 'var(--surface-1)' : undefined}
              strokeWidth={spec ? 1 : undefined}
              opacity={hovered === d.r.element ? 0.9 : spec ? 0.42 : 0.35}
              className="cursor-pointer"
              onClick={() => onPlayer(String(d.r.web_name), num(d.r, 'code'))}
              onMouseEnter={() => setHovered(d.r.element)}
              onMouseLeave={() => setHovered(null)}
            >
              <title>{labelFor(d)} ({d.r.team})</title>
            </circle>
          ))}
          {/* names: the notable few by default, everyone when toggled on */}
          {(showAllNames ? pts.filter((d) => d !== gold) : labelled).filter((d) => d.r.element !== hovered).map((d) => (
            <text key={`l${d.r.element}`} x={X(d.x) + rOf(d, false) + 3} y={Y(d.y) + 3} fontSize={showAllNames ? 8.5 : 10.5} fontWeight="700" fill="var(--ink-2)" opacity={showAllNames ? 0.75 : 1} className="pointer-events-none">{String(d.r.web_name)}</text>
          ))}
          <circle cx={X(gold.x)} cy={Y(gold.y)} r={rOf(gold, false) + 4} fill="var(--accent)" opacity="0.18" />
          <circle
            cx={X(gold.x)} cy={Y(gold.y)} r={rOf(gold, hovered === gold.r.element) + (spec ? 0 : 2)}
            fill="var(--accent)" stroke="var(--surface-1)" strokeWidth="1.5" className="cursor-pointer"
            onClick={() => onPlayer(String(gold.r.web_name), num(gold.r, 'code'))}
            onMouseEnter={() => setHovered(gold.r.element)}
            onMouseLeave={() => setHovered(null)}
          >
            <title>{labelFor(gold)} ({gold.r.team})</title>
          </circle>
          {/* the gold player's own label carries its stats too, so hovering
              the highlighted dot reads like every other dot */}
          <text x={X(gold.x) + (gold.x > (xMin + xMax) / 2 ? -1 : 1) * (rOf(gold, false) + 6)} y={Math.max(16, Y(gold.y) - rOf(gold, false) - 6)} textAnchor={gold.x > (xMin + xMax) / 2 ? 'end' : 'start'} fontSize="12" fontWeight="700" fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={hovered === gold.r.element ? 4 : 3} style={{ paintOrder: 'stroke' }} className="pointer-events-none">
            {hovered === gold.r.element ? labelFor(gold) : String(gold.r.web_name)}
          </text>
          {/* instant hover label — name + values, with a surface halo so it
              stays readable over neighbouring dots */}
          {hoveredPt && hoveredPt !== gold && (
            <text
              x={X(hoveredPt.x) + (hoveredPt.x > (xMin + xMax) / 2 ? -1 : 1) * (rOf(hoveredPt, false) + 5)}
              y={Math.max(16, Y(hoveredPt.y) - rOf(hoveredPt, false) - 5)}
              textAnchor={hoveredPt.x > (xMin + xMax) / 2 ? 'end' : 'start'}
              fontSize="11.5" fontWeight="700" fill="var(--ink-1)"
              stroke="var(--surface-1)" strokeWidth="4" style={{ paintOrder: 'stroke' }}
              className="pointer-events-none"
            >
              {labelFor(hoveredPt)}
            </text>
          )}
          <text x={PAD.l} y={PAD.t - 4} fontSize="9.5" fill="var(--ink-3)" style={{ textTransform: 'uppercase', letterSpacing: '.12em' }}>{axis[0]}</text>
          <text x={W - PAD.r} y={H - 4} textAnchor="end" fontSize="9.5" fill="var(--ink-3)" style={{ textTransform: 'uppercase', letterSpacing: '.12em' }}>{axis[1]}</text>
        </svg>
      </ScrollTo>
      <div className="mt-2 text-xs text-ink-3">
        {spec && `${spec.note} `}
        {lens === 'value' && 'Dashed line = fair price for the rating; above it = value. '}
        {lens === 'workload' && 'Green corner = plenty of saves, mostly from distance — save points the easy way. Red corner = quiet and close-range. '}
        {lens === 'momentum' && 'Diagonal = form exactly on season level; above it = heating up. '}
        {lens === 'roles' && (mode === 'GKP'
          ? 'Low on the chart = a mean defence in front (the clean-sheet route); far right = save volume (the save-points route). Bottom-right is both. '
          : mode === 'DEF'
            ? 'Top-right earns both ways; far right earns without needing the clean sheet; top-left is a pure clean-sheet play. '
            : 'Scorers sit right, creators sit high; top-right is the rare both-axis elite. ')}
        Gold follows your search. Hover a dot for the name; tap it to open the player.
      </div>
    </div>
  )
}

/* ── Teams: the league map ─────────────────────────────────────────────── */

export function TeamMap({ ratingByTeam, onTeam }: { ratingByTeam: Map<string, TeamRatingRow>; onTeam: (team: string) => void }) {
  const teams = useMemo(
    () =>
      [...ratingByTeam.values()]
        .map((t) => ({ team: t.team, att: num(t, 'attack_rank'), def: num(t, 'defence_rank') }))
        .filter((t): t is { team: string; att: number; def: number } => t.att != null && t.def != null),
    [ratingByTeam],
  )
  if (teams.length < 6) return <p className="py-8 text-center text-sm text-ink-3">The league map appears once team ratings exist (after GW1).</p>

  const W = 720, H = 420, PAD = { l: 46, r: 20, t: 18, b: 42 }
  const maxRank = Math.max(20, ...teams.map((t) => Math.max(t.att, t.def)))
  const X = (att: number) => PAD.l + ((att - 1) / (maxRank - 1)) * (W - PAD.l - PAD.r)
  const Y = (def: number) => PAD.t + ((def - 1) / (maxRank - 1)) * (H - PAD.t - PAD.b)
  const midX = X((1 + maxRank) / 2)
  const midY = Y((1 + maxRank) / 2)

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[560px]" role="img" aria-label="League map: attack rank versus defence rank">
          <rect x={PAD.l} y={PAD.t} width={midX - PAD.l} height={midY - PAD.t} fill="var(--good)" opacity="0.05" />
          <rect x={midX} y={PAD.t} width={W - PAD.r - midX} height={midY - PAD.t} fill="var(--info)" opacity="0.05" />
          <rect x={PAD.l} y={midY} width={midX - PAD.l} height={H - PAD.b - midY} fill="var(--warn)" opacity="0.05" />
          <rect x={midX} y={midY} width={W - PAD.r - midX} height={H - PAD.b - midY} fill="var(--bad)" opacity="0.05" />
          <line x1={midX} y1={PAD.t} x2={midX} y2={H - PAD.b} stroke="var(--line-mid)" />
          <line x1={PAD.l} y1={midY} x2={W - PAD.r} y2={midY} stroke="var(--line-mid)" />
          <text x={PAD.l + 8} y={PAD.t + 16} fontSize="9" fontWeight="800" fill="var(--good)" letterSpacing="1">BUY BOTH ENDS</text>
          <text x={W - PAD.r - 8} y={PAD.t + 16} textAnchor="end" fontSize="9" fontWeight="800" fill="var(--info)" letterSpacing="1">CLEAN SHEETS ONLY</text>
          <text x={PAD.l + 8} y={H - PAD.b - 8} fontSize="9" fontWeight="800" fill="var(--warn)" letterSpacing="1">ATTACK ONLY</text>
          <text x={W - PAD.r - 8} y={H - PAD.b - 8} textAnchor="end" fontSize="9" fontWeight="800" fill="var(--bad)" letterSpacing="1">INDIVIDUALS ONLY</text>
          <text x={PAD.l} y={H - 6} fontSize="9.5" fill="var(--ink-3)" style={{ textTransform: 'uppercase', letterSpacing: '.12em' }}>← Good attack</text>
          <text x={14} y={H - PAD.b} fontSize="9.5" fill="var(--ink-3)" style={{ textTransform: 'uppercase', letterSpacing: '.12em' }} transform={`rotate(-90 14 ${H - PAD.b})`}>← Good defence</text>
          {teams.map((t) => (
            <g key={t.team} className="cursor-pointer" onClick={() => onTeam(t.team)}>
              <circle cx={X(t.att)} cy={Y(t.def)} r="12" fill="transparent" />
              <text x={X(t.att)} y={Y(t.def) + 4} textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--ink-2)">
                {t.team}
                <title>{teamLabel(t.team)} — attack #{t.att}, defence #{t.def}</title>
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="mt-2 text-xs text-ink-3">Every club plotted by attack rank (x) and defence rank (y) — the two numbers the team verdicts are built from. Tap a club to open its page.</div>
    </div>
  )
}

/* ── shared view toggle chip row ───────────────────────────────────────── */

export function ViewChips<T extends string>({ options, active, onChange }: { options: { id: T; label: string }[]; active: T; onChange: (id: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`min-h-9 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${
            active === o.id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

// Re-export for callers that manage lens state.
export function useCompareLens() {
  return useState<CompareLens>('value')
}
