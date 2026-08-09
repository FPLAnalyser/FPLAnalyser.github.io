import { useMemo } from 'react'
import { Panel } from './SquadShape'
import { num } from '../lib/rows'
import { simulateXi, type PlayerSeries, type Distribution } from '../lib/squadInsights'

/* ════════════════════════════════════════════════════════════════════════
   WHAT COULD ACTUALLY HAPPEN.

   Everything else on the tab is an expectation. An expectation is the one
   number a fantasy season never delivers: nobody scores 52.4. These two
   panels put a shape around it — the range a week can land in, and, once
   there are results to compare against, whether the projections have been
   describing this squad or not.
   ════════════════════════════════════════════════════════════════════════ */

// ── floor and ceiling ───────────────────────────────────────────────────────

export function FloorCeiling({ squad, xiElements, gws, captain }: {
  squad: PlayerSeries[]
  xiElements: Set<number>
  gws: number[]
  captain: number | null
}) {
  const xi = useMemo(() => squad.filter((p) => xiElements.has(p.element)), [squad, xiElements])
  const dists = useMemo(() => gws.map((_, i) =>
    // Seeded per week so the bands are stable across renders — an interval that
    // moved every time React re-drew it would be unreadable, and worse, would
    // look like the model changing its mind.
    simulateXi(xi, i, captain, 4000, 9871 + i * 7919)), [xi, gws, captain])

  const live = dists.filter(Boolean) as Distribution[]
  if (!live.length) return null

  /* The axis starts near the worst tenth, not at zero. Zero is technically
     honest and visually useless: every band lands in the top third of the box
     and six weeks that differ by fifteen points look identical. */
  const lo = Math.min(...live.map((d) => d.p10)) - 4
  const hi = Math.max(...live.map((d) => d.p90)) + 4
  const first = dists[0]
  const drift = first ? first.mean - first.expected : 0

  return (
    <Panel
      title="Floor and ceiling, not just the projection"
      kicker="Ten thousand simulated gameweeks per bar, drawn from the same rates the projection averages. The thick band is the middle half of outcomes; the whisker is the 10th to 90th percentile."
      note={
        first
          ? <>GW{gws[0]}: the projection is {first.expected.toFixed(1)}, the median simulated week is{' '}
              {first.median.toFixed(0)}, and one week in ten lands below {first.p10.toFixed(0)} or above{' '}
              {first.p90.toFixed(0)}. The median sits under the projection because points are
              right-skewed — a hat-trick drags the average past what a typical Saturday delivers,
              which is exactly why an expectation on its own reads as more reliable than it is.
              {' '}The simulated mean is {first.mean.toFixed(1)} against a projection of{' '}
              {first.expected.toFixed(1)}, a {Math.abs(drift) < 0.05 ? 'zero' : `${Math.abs(drift).toFixed(1)}-point`} gap —
              that agreement is the check that the draw and the projection are describing the same squad.</>
          : null
      }
    >
      <div className="flex items-end gap-2 sm:gap-3">
        {gws.map((gw, i) => {
          const d = dists[i]
          if (!d) return (
            <div key={gw} className="flex flex-1 flex-col items-center gap-1">
              <div className="h-[150px] w-full" />
              <span className="text-[10px] text-ink-3">GW{gw}</span>
            </div>
          )
          const f = (v: number) => (v - lo) / (hi - lo)          // 0 at the floor
          const top = (v: number) => `${(1 - f(v)) * 100}%`
          const bot = (v: number) => `${f(v) * 100}%`
          return (
            <div key={gw} className="flex flex-1 flex-col items-center gap-1">
              <div className="relative h-[170px] w-full">
                {/* whisker */}
                <div
                  className="absolute left-1/2 w-px -translate-x-1/2 bg-line-strong"
                  style={{ top: top(d.p90), bottom: bot(d.p10) }}
                />
                <div className="absolute left-1/2 h-px w-3 -translate-x-1/2 bg-line-strong" style={{ top: top(d.p90) }} />
                <div className="absolute left-1/2 h-px w-3 -translate-x-1/2 bg-line-strong" style={{ bottom: bot(d.p10) }} />
                {/* interquartile band */}
                <div
                  className="absolute inset-x-[14%] rounded-md border border-accent/40 bg-accent/25"
                  style={{ top: top(d.p75), bottom: bot(d.p25) }}
                />
                {/* median */}
                {/* Inside the box, not across the chart. Drawn wider than the
                    band it belongs to, it read as an axis rule. */}
                <div className="absolute inset-x-[14%] h-[3px] rounded bg-accent" style={{ top: top(d.median) }} />
                {/* the engine's own expectation, for comparison */}
                <div
                  className="absolute inset-x-[22%] h-px border-t border-dashed border-ink-2"
                  style={{ top: top(d.expected) }}
                  title={`Projection ${d.expected.toFixed(1)}`}
                />
                <span className="font-num absolute inset-x-0 text-center text-[10px] text-ink-3 tabular-nums" style={{ top: `calc(${top(d.p90)} - 14px)` }}>
                  {d.p90.toFixed(0)}
                </span>
                <span className="font-num absolute inset-x-0 text-center text-[10px] text-ink-3 tabular-nums" style={{ bottom: `calc(${bot(d.p10)} - 14px)` }}>
                  {d.p10.toFixed(0)}
                </span>
              </div>
              <span className="font-num text-[13px] font-semibold text-accent-2 tabular-nums">{d.median.toFixed(0)}</span>
              <span className="text-[10px] text-ink-3">GW{gw}</span>
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-2">
        <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-4 rounded-[2px] bg-accent-soft" />Middle half</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-[3px] w-4 rounded bg-accent" />Median</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-px w-4 border-t border-dashed border-ink-3" />Projection</span>
        <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-px bg-line-strong" />10th–90th</span>
      </div>
    </Panel>
  )
}

// ── projected against actual ────────────────────────────────────────────────

/** Rows from `season_to_date` — what each player has actually scored so far. */
export interface SeasonRow { element?: number; total_points?: number; [k: string]: unknown }

export function ProjectedVsActual({ squad, seasonToDate, playedGws }: {
  squad: PlayerSeries[]
  seasonToDate: SeasonRow[] | null
  playedGws: number
}) {
  const actual = useMemo(() => {
    if (!seasonToDate) return null
    const byEl = new Map<number, number>()
    for (const r of seasonToDate) {
      const el = num(r as never, 'element')
      const pts = num(r as never, 'total_points')
      if (el != null && pts != null) byEl.set(el, pts)
    }
    let total = 0
    let found = 0
    for (const p of squad) {
      const v = byEl.get(p.element)
      if (v != null) { total += v; found += 1 }
    }
    return { total, found }
  }, [squad, seasonToDate])

  /* Before a ball is kicked this panel has nothing to say, and saying it
     anyway — with a flat line at zero, or worse, a projection drawn against
     nothing — would be the sort of chart that looks like information. */
  if (!playedGws || !actual || !actual.found) {
    return (
      <Panel
        title="Projected against actual"
        kicker="Whether the projections have been describing this squad, or missing it."
        note={
          <>
            <b>This one needs a per-gameweek projection log, and the log starts at GW1.</b> A
            walk-forward comparison cannot be reconstructed afterwards: once a week is played, the
            projection that existed before its deadline is gone, and using today's numbers against
            last month's results measures nothing but hindsight. So this panel switches on with the
            season rather than pretending now.
          </>
        }
      >
        <div className="rounded-xl border border-dashed border-line-mid px-4 py-6 text-center text-[13px] text-ink-3">
          Nothing to compare yet — no gameweeks played.
        </div>
      </Panel>
    )
  }

  const projected = squad.reduce((s, p) => s + p.total, 0) / Math.max(squad.length, 1) * actual.found * playedGws
  const gap = actual.total - projected
  const gapPct = projected > 0 ? gap / projected : 0

  return (
    <Panel
      title="Projected against actual"
      kicker={`Your fifteen have scored ${actual.total} real points across ${playedGws} gameweek${playedGws === 1 ? '' : 's'}.`}
      note={
        <>
          <b>Read this as a rough gauge, not a verdict.</b> The projected line here is today's
          per-week figure carried backwards, because a walk-forward log did not exist for the weeks
          already played. A gap that oscillates around zero is variance; a gap that trends is a model
          that has stopped describing your squad — but only a proper log can tell those apart, and
          that log starts now.
        </>
      }
    >
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <div>
          <div className="font-display text-2xl text-ink tabular-nums">{actual.total}</div>
          <div className="text-[10px] tracking-[0.1em] text-ink-3 uppercase">Actual</div>
        </div>
        <div>
          <div className="font-display text-2xl text-ink-2 tabular-nums">{projected.toFixed(0)}</div>
          <div className="text-[10px] tracking-[0.1em] text-ink-3 uppercase">Rough projection</div>
        </div>
        <div>
          <div className={`font-display text-2xl tabular-nums ${gap >= 0 ? 'text-good' : 'text-bad'}`}>
            {gap >= 0 ? '+' : ''}{gap.toFixed(0)}
          </div>
          <div className="text-[10px] tracking-[0.1em] text-ink-3 uppercase">
            {gap >= 0 ? 'Over' : 'Under'} by {Math.abs(gapPct * 100).toFixed(1)}%
          </div>
        </div>
      </div>
    </Panel>
  )
}
