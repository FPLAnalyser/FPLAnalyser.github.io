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

export type CompareLens = 'value' | 'roles' | 'momentum' | 'workload'

/** The pool's position character — decides what the "roles" lens plots. */
export type PosMode = 'GKP' | 'DEF' | 'ATT'
export const posModeOf = (rows: RatingRow[]): PosMode =>
  rows.length > 0 && rows.every((r) => r.position === 'GKP') ? 'GKP'
  : rows.length > 0 && rows.every((r) => r.position === 'DEF') ? 'DEF'
  : 'ATT'

/** Lens chips — the roles lens becomes a position-specific chart: keepers get
 * saves × xGC, defenders def con × clean sheets, everyone else xG × xA. */
export function compareLenses(mode: PosMode): { id: CompareLens; label: string; tip: string }[] {
  const roles =
    mode === 'GKP'
      ? { id: 'roles' as const, label: 'Keepers — saves × xGC', tip: 'Saves per 90 (x) against expected goals conceded per 90 (y). Bottom-right is the dream: a busy keeper behind a defence that still concedes little. Low on the chart = better defence in front (the clean-sheet route); far right = save-points volume.' }
      : mode === 'DEF'
        ? { id: 'roles' as const, label: 'Defenders — def con × clean sheets', tip: 'Share of starts hitting the +2 Def Con threshold (x) against clean-sheet rate (y). Top-right earns both ways; far right earns without needing the clean sheet; top-left is a pure clean-sheet play.' }
        : { id: 'roles' as const, label: 'Roles — xG × xA', tip: 'Non-penalty goal threat (x) against creativity (y), both per 90. Scorers sit right, creators sit high, the rare both-axis elite sit top-right.' }
  return [
    { id: 'value', label: 'Value — price × FPL Analyser rating', tip: 'Every player plotted price (x) against their FPL Analyser rating (y). The dashed line is the fair price for a given rating — above it = value.' },
    roles,
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

interface Pt { r: RatingRow; x: number; y: number }

function lensPoints(rows: RatingRow[], lens: CompareLens, mode: PosMode): Pt[] {
  const pts: Pt[] = []
  for (const r of rows) {
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

  // Gold = the searched player (if matched) or the best y. Named labels for
  // a handful of the most notable points, so the field stays quiet.
  const hl = highlightName
    ? pts.find((d) => String(d.r.web_name).toLowerCase().includes(highlightName.toLowerCase())) ?? null
    : null
  const gold = hl ?? [...pts].sort((a, b) => b.y - a.y)[0]
  const labelled = [...pts].sort((a, b) => b.y - a.y).slice(0, 4).filter((d) => d !== gold)

  const quads = quadrantsFor(lens, mode)
  const midX = X((xMin + xMax) / 2)
  const midY = Y((yMin + yMax) / 2)

  // Percent-style lenses print whole numbers; per-90 rates get 2dp.
  const pctLens = lens === 'roles' && mode === 'DEF'
  const rateLens = (lens === 'roles' && mode !== 'DEF') || lens === 'workload'
  const fmt = (v: number) => (rateLens ? v.toFixed(2) : pctLens ? `${Math.round(v)}%` : String(Math.round(v)))
  const axis =
    lens === 'value' ? ['FPL Analyser rating ↑', 'Price →']
    : lens === 'workload' ? ['Saves / 90 ↑', 'Avg shot distance faced →']
    : lens === 'roles'
      ? mode === 'GKP' ? ['xGC / 90 ↑', 'Saves / 90 →']
        : mode === 'DEF' ? ['Clean sheet % ↑', 'Def Con hit % →']
        : ['xA / 90 ↑', 'npxG / 90 →']
      : ['Last 4 GW rating ↑', 'Season rating →']
  // Value lens: x IS the price, so the label reads "name · rating · £price".
  const labelFor = (d: Pt) => (lens === 'value' ? `${d.r.web_name} · ${Math.round(d.y)} · £${d.r.price}m` : `${d.r.web_name} · ${fmt(d.x)} / ${fmt(d.y)}`)
  const hoveredPt = hovered != null ? pts.find((d) => d.r.element === hovered) ?? null : null
  const xTicks = ticks(xMin - xPadU, xMax + xPadU)
  const yTicks = ticks(yMin - yPadU, yMax + yPadU)
  // Axis-specific: only the value lens's X axis is money — its Y is a rating.
  const xTickLabel = (v: number) =>
    lens === 'value' ? `£${v}m` : pctLens ? `${Math.round(v)}%` : rateLens ? v.toFixed(2) : String(Math.round(v))
  const yTickLabel = (v: number) =>
    lens === 'value' ? String(Math.round(v)) : pctLens ? `${Math.round(v)}%` : rateLens ? v.toFixed(2) : String(Math.round(v))

  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4">
      <div className="mb-2 flex justify-end">
        <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-ink-2">
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
                {(Object.keys(quads.labels) as ('tr' | 'tl' | 'br' | 'bl')[]).map((q) => {
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
          {pts.filter((d) => d !== gold).map((d) => (
            <circle
              key={String(d.r.element)}
              cx={X(d.x)} cy={Y(d.y)}
              r={hovered === d.r.element ? 6 : 4}
              fill={hovered === d.r.element ? 'var(--ink-2)' : 'var(--ink-3)'}
              opacity={hovered === d.r.element ? 0.9 : 0.35}
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
            <text key={`l${d.r.element}`} x={X(d.x) + 7} y={Y(d.y) + 3} fontSize={showAllNames ? 8.5 : 10.5} fontWeight="700" fill="var(--ink-2)" opacity={showAllNames ? 0.75 : 1} className="pointer-events-none">{String(d.r.web_name)}</text>
          ))}
          <circle cx={X(gold.x)} cy={Y(gold.y)} r="10" fill="var(--accent)" opacity="0.18" />
          <circle
            cx={X(gold.x)} cy={Y(gold.y)} r={hovered === gold.r.element ? 7.5 : 6}
            fill="var(--accent)" stroke="var(--surface-1)" strokeWidth="1.5" className="cursor-pointer"
            onClick={() => onPlayer(String(gold.r.web_name), num(gold.r, 'code'))}
            onMouseEnter={() => setHovered(gold.r.element)}
            onMouseLeave={() => setHovered(null)}
          >
            <title>{labelFor(gold)} ({gold.r.team})</title>
          </circle>
          {/* the gold player's own label carries its stats too, so hovering
              the highlighted dot reads like every other dot */}
          <text x={X(gold.x) + (gold.x > (xMin + xMax) / 2 ? -12 : 12)} y={Math.max(16, Y(gold.y) - 10)} textAnchor={gold.x > (xMin + xMax) / 2 ? 'end' : 'start'} fontSize="12" fontWeight="700" fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={hovered === gold.r.element ? 4 : 0} style={{ paintOrder: 'stroke' }} className="pointer-events-none">
            {hovered === gold.r.element ? labelFor(gold) : String(gold.r.web_name)}
          </text>
          {/* instant hover label — name + values, with a surface halo so it
              stays readable over neighbouring dots */}
          {hoveredPt && hoveredPt !== gold && (
            <text
              x={X(hoveredPt.x) + (hoveredPt.x > (xMin + xMax) / 2 ? -10 : 10)}
              y={Math.max(16, Y(hoveredPt.y) - 9)}
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
          <text x={W - PAD.r - 8} y={PAD.t + 16} textAnchor="end" fontSize="9" fontWeight="800" fill="var(--info)" letterSpacing="1">SHEETS ONLY</text>
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
