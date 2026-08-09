import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import { bandOf } from '../lib/fixtureRuns'
import { num, str } from '../lib/rows'
import { xpPartsForGw, sumParts, CS_PTS, type XpModel, type MarketOdds, type ShotProfiles } from '../lib/xp'
import type { Availability } from '../lib/availability'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   One grid, six metrics.

   Clean sheets, goals, goal involvement, expected points, def-con and minutes
   are the same shape of question — this player, this week — so they are one
   grid with a switch, not six screens. The bottom row totals the squad.

   Two things the grid has to get right or it lies:

   * SHADING. A keeper's xG next to a striker's is a meaningless comparison,
     so one absolute scale would paint every defender red and say nothing.
     "Across the squad" uses the same percentile deviation the Fixtures grids
     use, so a green cell means what it means everywhere else on the site;
     "vs his own average" answers the planning question — which of HIS weeks
     are the good ones — and leaves the cross-player read to the last column.

   * RELEVANCE. A forward earns nothing for a clean sheet and a keeper has no
     def-con threshold, so those rows are dropped per metric rather than
     shown as numbers that cannot pay. The grid says which it dropped.
   ════════════════════════════════════════════════════════════════════════ */

type MetricKey = 'cs' | 'xg' | 'xgi' | 'xp' | 'dc' | 'xmins'

interface Metric {
  key: MetricKey
  label: string
  fmt: (v: number) => string
  /** Aggregate for the right-hand column: a total or a per-week average. */
  agg: 'sum' | 'avg'
  aggLabel: string
  pos: string[]
  why: string | null
  /** Whether a gold cell means anything for this metric. See LEAGUE BEST. */
  gold: boolean
}

const METRICS: Metric[] = [
  { key: 'cs', label: 'Clean sheets', fmt: (v) => `${Math.round(v * 100)}%`, agg: 'avg', aggLabel: 'Avg',
    pos: ['GKP', 'DEF', 'MID'], why: 'forwards score nothing for a clean sheet', gold: true },
  { key: 'xg', label: 'xG', fmt: (v) => v.toFixed(2), agg: 'sum', aggLabel: 'Total',
    pos: ['DEF', 'MID', 'FWD'], why: 'a keeper has no projected goal threat', gold: true },
  { key: 'xgi', label: 'xGI', fmt: (v) => v.toFixed(2), agg: 'sum', aggLabel: 'Total',
    pos: ['DEF', 'MID', 'FWD'], why: 'a keeper has no projected goal threat', gold: true },
  { key: 'xp', label: 'xP', fmt: (v) => v.toFixed(1), agg: 'sum', aggLabel: 'Total',
    pos: ['GKP', 'DEF', 'MID', 'FWD'], why: null, gold: true },
  { key: 'dc', label: 'Def Con', fmt: (v) => `${Math.round(v * 100)}%`, agg: 'avg', aggLabel: 'Avg',
    pos: ['DEF', 'MID', 'FWD'], why: 'keepers have no defensive-contribution threshold', gold: true },
  // No gold: the league's highest expected minutes is whoever never comes off,
  // which is true of dozens of players and says nothing about the gameweek.
  { key: 'xmins', label: 'xMins', fmt: (v) => `${Math.round(v)}'`, agg: 'avg', aggLabel: 'Avg',
    pos: ['GKP', 'DEF', 'MID', 'FWD'], why: null, gold: false },
]

const POS_ORDER: Record<string, number> = { GKP: 0, DEF: 1, MID: 2, FWD: 3 }
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const listWords = (xs: string[]) =>
  xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`

export interface LadderEngine {
  fixtureEase: FixtureEaseRow[]
  avail?: Availability
  model?: XpModel | null
  market?: MarketOdds | null
  profiles?: ShotProfiles | null
}

interface Cell { v: number; opp: string; ven: string }

/** Every metric for one player in one gameweek, from one engine call.
 *  Shared by the squad rows and the league-best scan so the two can never
 *  drift into measuring subtly different things. */
function metricsFor(
  r: RatingRow, gw: number, engine: LadderEngine, full: number,
): Record<MetricKey, number | null> | null {
  const p = xpPartsForGw(r, gw, engine.fixtureEase, engine.avail, engine.model, engine.market, engine.profiles)
  if (!p) return null

  /* A player the component engine could not rate — a promoted club's forward,
     an unrated signing — still gets an xP, because the engine falls back to a
     flat per-game figure. But it lands whole in `appearance`, so every RATE on
     the parts object is left at zero, and a zero read as a rate is not a small
     number, it is a wrong one: lamAgainst = 0 makes exp(-lamAgainst) a 100%
     clean sheet, which promptly became the league's best and stopped anything
     real from ever going gold in GW1. His xP is real; nothing else here is. */
  const code = num(r, 'code')
  if (code == null || !engine.model?.byCode.has(code)) {
    return { cs: null, xg: null, xgi: null, xp: sumParts(p), dc: null, xmins: null }
  }

  return {
    // The CLUB's chance of a shutout, and nothing else. lamAgainst is a team
    // quantity — the goals the market expects this defence to concede — so
    // every Arsenal player reads the same number, which is what a clean sheet
    // is. It used to be multiplied by P(60+), which quietly turned it into
    // "clean sheet AND he lasts the hour" and printed a different figure for
    // the keeper and the centre-half in the same fixture. Whether he is on the
    // pitch to be paid for it is a separate question, and xMins answers it.
    cs: Math.exp(-p.lamAgainst),
    xg: p.lamGoal,
    xgi: p.lamGoal + p.lamAssist,
    xp: sumParts(p),
    // parts.dc is POINTS — 2 x the threshold probability. Halve it back.
    dc: Math.min(1, p.dc / 2),
    xmins: p.p60 * full,
  }
}

/** Expected minutes is not a modelled quantity — the engine carries P(60+) and
 *  P(playing). Derived from the player's own measured rate of going the
 *  distance rather than a league constant, and labelled as derived. */
const fullMins = (r: RatingRow) => {
  const m90 = num(r, 'season_m_mins90_rate') ?? 0.5
  return 90 * m90 + 75 * (1 - m90)
}

export function SquadLadder({ squad, gws, pool, engine }: {
  squad: RatingRow[]
  gws: number[]
  /** Every rated player, for the league-best scan. */
  pool: RatingRow[]
  engine: LadderEngine
}) {
  const [mi, setMi] = useState(0)
  const [shade, setShade] = useState<'abs' | 'rel'>('abs')
  const metric = METRICS[mi]

  /* Both memos below key on the ENGINE'S PARTS, not on the `engine` object, and
     on a joined gameweek string rather than the array. The caller builds both
     fresh every render — an object literal and a .filter().slice() — so keying
     on them would rebuild the 573-player league scan on every unrelated state
     change on the page. */
  const { fixtureEase, avail, model, market, profiles } = engine
  const gwKey = gws.join(',')

  const rows = useMemo(() => {
    const order = [...squad].sort((a, b) =>
      (POS_ORDER[str(a, 'position') ?? ''] ?? 9) - (POS_ORDER[str(b, 'position') ?? ''] ?? 9))
    return order.map((r) => {
      const pos = str(r, 'position') ?? ''
      const full = fullMins(r)
      const cells: Record<MetricKey, (Cell | null)[]> = { cs: [], xg: [], xgi: [], xp: [], dc: [], xmins: [] }
      for (const gw of gws) {
        const m = metricsFor(r, gw, engine, full)
        const fix = fixtureEase.filter((f) => f.team === r.team && f.gw === gw)
        const opp = fix.map((f) => f.opponent).join('+')
        const ven = fix.map((f) => f.venue).join('')
        if (!m || !fix.length) {
          for (const k of Object.keys(cells) as MetricKey[]) cells[k].push(null)
          continue
        }
        for (const k of Object.keys(cells) as MetricKey[]) {
          const v = m[k]
          cells[k].push(v == null ? null : { v, opp, ven })
        }
      }
      return { row: r, pos, cells }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [squad, gwKey, fixtureEase, avail, model, market, profiles])

  /* ── LEAGUE BEST ────────────────────────────────────────────────────────
     Gold marks the best in the DIVISION that gameweek, not the best of the
     fifteen players you happen to own. Best-of-squad was the easy version and
     it was worth nothing: it fires every single week for whoever your best
     defender is, so it decorates the row instead of telling you anything.
     League-best fires rarely and means something when it does.

     One scan over the whole rated pool, all six metrics at once, memoised on
     the pool and the horizon — so it does not re-run when you change tab. */
  const leagueBest = useMemo(() => {
    const best: Record<MetricKey, number[]> = {
      cs: gws.map(() => -Infinity), xg: gws.map(() => -Infinity), xgi: gws.map(() => -Infinity),
      xp: gws.map(() => -Infinity), dc: gws.map(() => -Infinity), xmins: gws.map(() => -Infinity),
    }
    for (const r of pool) {
      const pos = str(r, 'position') ?? ''
      const full = fullMins(r)
      gws.forEach((gw, i) => {
        const m = metricsFor(r, gw, engine, full)
        if (!m) return
        for (const mt of METRICS) {
          if (!mt.gold || !mt.pos.includes(pos)) continue
          const v = m[mt.key]
          if (v != null && v > best[mt.key][i]) best[mt.key][i] = v
        }
      })
    }
    return best
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool, gwKey, fixtureEase, avail, model, market, profiles])

  // Which positions the def-con fit found no fixture effect for this season.
  // Read off the model, not written down — build_xp_model.py refits β every run
  // and keeps it only when it beats a flat curve out of sample, so a hard-coded
  // caption would go stale silently the first time that verdict changed.
  const flatDcPositions = ['DEF', 'MID', 'FWD'].filter((p) => {
    const beta = engine.model?.dcCurve?.[p]?.beta
    return typeof beta === 'number' && Math.abs(beta) < 1e-6
  })

  const shown = rows.filter((r) => metric.pos.includes(r.pos))
  if (!shown.length || !gws.length) return null

  const flat = shown.flatMap((r) => r.cells[metric.key]).filter(Boolean).map((c) => (c as Cell).v).sort((a, b) => a - b)
  // The Fixtures grids' own deviation: percentile anchors, each side of the
  // median scaled separately so a skewed metric doesn't wash out one end.
  const q = (t: number) => flat[Math.min(flat.length - 1, Math.floor(t * flat.length))]
  const mid = q(0.5), lo = q(0.1), hi = q(0.9)
  const dev = (v: number) => v >= mid
    ? (hi > mid ? Math.min(1, (v - mid) / (hi - mid)) : 0)
    : (mid > lo ? Math.max(-1, (v - mid) / (mid - lo)) : 0)

  const bestByGw = leagueBest[metric.key]
  const weekTotals = gws.map((_, i) =>
    shown.reduce((s, r) => s + (r.cells[metric.key][i]?.v ?? 0), 0))
  const wMean = weekTotals.reduce((a, b) => a + b, 0) / (weekTotals.length || 1)
  const wHalf = Math.max((Math.max(...weekTotals) - Math.min(...weekTotals)) / 2, 1e-6)

  return (
    <section className="mt-6">
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-[10px] font-bold tracking-[0.12em] text-ink-3 uppercase">Metric</span>
        <div className="flex gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
          {METRICS.map((m, i) => (
            <button
              key={m.key}
              aria-pressed={i === mi}
              onClick={() => setMi(i)}
              className={`min-h-9 rounded-md px-2.5 text-[12.5px] font-medium transition-colors ${
                i === mi ? 'bg-accent text-accent-contrast' : 'text-ink-2 hover:text-ink'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <span className="ml-1 text-[10px] font-bold tracking-[0.12em] text-ink-3 uppercase">Shade</span>
        <div className="flex gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
          {([['abs', 'across the squad'], ['rel', 'vs his own average']] as const).map(([k, label]) => (
            <button
              key={k}
              aria-pressed={shade === k}
              onClick={() => setShade(k)}
              className={`min-h-9 rounded-md px-2.5 text-[12.5px] font-medium transition-colors ${
                shade === k ? 'bg-accent text-accent-contrast' : 'text-ink-2 hover:text-ink'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface-1 p-3">
        <table className="w-full min-w-[620px] border-separate border-spacing-[2px]">
          <thead>
            <tr>
              <th />
              {gws.map((gw) => (
                <td key={gw} className="pb-1 text-center text-[10px] font-bold tracking-[0.08em] text-ink-3 uppercase">
                  GW{gw}
                </td>
              ))}
              <td className="pb-1 pl-2 text-center text-[10px] font-bold tracking-[0.08em] text-ink-3 uppercase">
                {metric.aggLabel}
              </td>
            </tr>
          </thead>
          <tbody>
            {shown.map(({ row, pos, cells }) => {
              const series = cells[metric.key]
              const vals = series.filter(Boolean).map((c) => (c as Cell).v)
              const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1)
              const rHalf = Math.max((Math.max(...vals) - Math.min(...vals)) / 2, 1e-6)
              const agg = metric.agg === 'sum' ? vals.reduce((a, b) => a + b, 0) : mean
              return (
                <tr key={String(row.element)}>
                  <th className="pr-2.5 text-left font-medium whitespace-nowrap">
                    <span className="block text-[13px] font-semibold text-ink">{String(row.web_name)}</span>
                    <span className="font-num block text-[11px] text-ink-3 tabular-nums">
                      {String(row.team)} · {pos} · £{(num(row, 'price') ?? 0).toFixed(1)}
                    </span>
                  </th>
                  {series.map((c, i) => {
                    if (!c) return <td key={i} className="rounded px-1 py-1.5 text-center text-ink-3">–</td>
                    const isBest = metric.gold && Number.isFinite(bestByGw[i]) && c.v >= bestByGw[i] - 1e-9
                    const t = clamp(shade === 'rel' ? (c.v - mean) / rHalf : dev(c.v), -1, 1)
                    return (
                      <td
                        key={i}
                        title={`${String(row.web_name)} vs ${c.opp} (${c.ven}) — ${metric.label} ${metric.fmt(c.v)}${isBest ? ' — best in the league this gameweek' : ''}`}
                        className={`min-w-[72px] rounded px-1 py-1.5 text-center ${isBest ? 'shadow-[inset_0_0_0_1px_rgba(23,19,10,.35)]' : ''}`}
                        style={isBest
                          ? { background: 'linear-gradient(180deg,#F7E3A6,#C9A227)' }
                          : { background: bandOf(t) }}
                      >
                        <span className={`font-num block text-[13.5px] font-semibold tabular-nums ${isBest ? 'text-[#17130A]' : 'text-ink'}`}>
                          {isBest && <Icon name="crown" size={9} className="mr-0.5 inline-block align-[-0.05em]" />}
                          {metric.fmt(c.v)}
                        </span>
                        <span className={`block text-[10px] ${isBest ? 'text-[#3B2F10]' : 'text-ink-2'}`}>
                          {c.opp} <span className={isBest ? 'text-[#5a4a1c]' : 'text-ink-3'}>{c.ven}</span>
                        </span>
                      </td>
                    )
                  })}
                  <td className="font-num pl-2 text-center text-[13px] text-ink-2 tabular-nums">{metric.fmt(agg)}</td>
                </tr>
              )
            })}
            <tr>
              <th className="border-t-2 border-line pt-2 pr-2.5 text-left font-medium whitespace-nowrap">
                <span className="block text-[13px] font-semibold text-accent-2">Squad total</span>
                <span className="font-num block text-[11px] text-ink-3 tabular-nums">{shown.length} of {rows.length}</span>
              </th>
              {weekTotals.map((v, i) => (
                <td
                  key={i}
                  className="border-t-2 border-line pt-2"
                >
                  <span
                    className="font-num block rounded px-1 py-1.5 text-center text-[14px] font-bold text-accent-2 tabular-nums"
                    style={{ background: bandOf(clamp((v - wMean) / wHalf, -1, 1)) }}
                  >
                    {metric.fmt(metric.agg === 'sum' ? v : v / shown.length)}
                  </span>
                </td>
              ))}
              <td className="font-num border-t-2 border-line pt-2 pl-2 text-center text-[13px] text-ink-2 tabular-nums">
                {metric.fmt(metric.agg === 'sum'
                  ? weekTotals.reduce((a, b) => a + b, 0)
                  : wMean / shown.length)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-3">
        {metric.why && <span>Showing {metric.pos.join(', ')} only — {metric.why}.</span>}
        <span className="flex items-center gap-1.5">
          {shade === 'rel' ? 'Below his average' : 'Low for the squad'}
          <span className="flex gap-0.5">
            {[-1, -0.4, 0, 0.4, 1].map((t) => (
              <span key={t} className="block h-2.5 w-7 rounded-[2px]" style={{ background: bandOf(t) }} />
            ))}
          </span>
          {shade === 'rel' ? 'above' : 'high'}
        </span>
        {metric.gold && (
          <span className="flex items-center gap-1.5">
            <span className="block h-2.5 w-7 rounded-[2px]" style={{ background: 'linear-gradient(180deg,#F7E3A6,#C9A227)' }} />
            best in the league that gameweek — often nobody in your squad
          </span>
        )}
        {metric.key === 'cs' && (
          <span>
            The club&apos;s chance of a shutout, so every player at a club reads the same number.
            You still have to be on the pitch for an hour to be paid for it — that is the xMins tab.
          </span>
        )}
        {metric.key === 'dc' && flatDcPositions.length > 0 && (
          <span>
            {listWords(flatDcPositions)} rows are flat on purpose — the model refits the fixture effect on
            def-con every run and this season found none for those positions, so the number is the
            player&apos;s own rate whoever he plays.
          </span>
        )}
        {metric.key === 'xmins' && <span>xMins is derived from P(60+) and each player&apos;s own 90-minute rate, not measured.</span>}
        {metric.key === 'cs' && CS_PTS.MID === 1 && <span>Midfielders earn 1 point for a clean sheet, defenders and keepers 4.</span>}
      </div>
    </section>
  )
}
