import { useMemo } from 'react'
import { TeamBadge } from './badges'
import { analyserDiff, diffFill, diffTick, type DiffScale, type Lens, type SeasonRun } from '../lib/fixtureRuns'
import { num } from '../lib/rows'
import type { FixtureEaseRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   A team's two purple patches, drawn the same way wherever they appear.

   The colour is the site's shared difficulty wash, so a green chip here means
   exactly what a green cell means on the planner grid. The number on the
   right is the run's average difficulty rather than its total advantage:
   advantage is the right thing to CHOOSE a run on — it rewards length as well
   as kindness — but it's a made-up unit, and nobody reads "+4.6" as a fixture
   run. The average sits on the 1–5 scale every other screen already uses.
   ════════════════════════════════════════════════════════════════════════ */

const HALF_LABEL: Record<1 | 2, string> = { 1: 'First half', 2: 'Second half' }

export function BestRuns({ runs, className = '' }: { runs: SeasonRun[]; className?: string }) {
  if (!runs.length) return null
  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      {runs.map((run) => (
        <div key={run.half}>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-[9.5px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">{HALF_LABEL[run.half]}</span>
            <span className="text-[12px] font-extrabold text-ink">GW{run.from}–{run.to}</span>
            <span className="text-[11px] text-ink-2">
              {run.avg.toFixed(1)} avg · {run.home} of {run.fixtures.length} at home
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {run.fixtures.map((f, i) => (
              <span
                key={`${f.gw}-${f.opponent}-${i}`}
                title={`GW${f.gw} · ${f.venue === 'H' ? 'home to' : 'away at'} ${f.opponent} · difficulty ${f.diff.toFixed(1)}`}
                className="rounded-[5px] px-1.5 py-1 text-[10.5px] leading-none font-bold text-ink"
                style={{ background: diffFill(f.diff) }}
              >
                {f.opponent}
                <span className="ml-0.5 text-ink-2">{f.venue}</span>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   Every gameweek of the season on one row per club, with only each club's
   best run lit. Lives here rather than on the Fixtures page because the club
   page needs exactly the same picture for one team — a club's fixture story
   should be drawn one way, not summarised differently depending on which
   page you arrived from.
   ════════════════════════════════════════════════════════════════════════ */
export function RunsTimeline({ fixtureEase, runs, gws, lens, scale }: {
  fixtureEase: FixtureEaseRow[]
  runs: (SeasonRun & { team: string })[]
  gws: number[]
  lens: Lens
  scale: DiffScale | null
}) {
  const byTeam = useMemo(() => {
    const m = new Map<string, Map<number, { opp: string; venue: 'H' | 'A'; diff: number }>>()
    for (const f of fixtureEase) {
      const team = String(f.team)
      const venue: 'H' | 'A' = String(f.venue) === 'H' ? 'H' : 'A'
      const { diff } = analyserDiff(String(f.opponent), lens, venue, num(f, 'fdr') ?? 3, scale)
      if (!m.has(team)) m.set(team, new Map())
      m.get(team)!.set(f.gw, { opp: String(f.opponent), venue, diff })
    }
    return m
  }, [fixtureEase, lens, scale])

  // Alphabetical. Ordering by when the run starts made a tidy diagonal but a
  // useless index: you arrive at this map knowing which club you want, and
  // hunting twenty rows for it costs more than the diagonal was worth. The
  // ranked view already answers "whose run is best".
  const rows = useMemo(() => {
    const m = new Map<string, (SeasonRun & { team: string })[]>()
    for (const r of runs) {
      if (!m.has(r.team)) m.set(r.team, [])
      m.get(r.team)!.push(r)
    }
    return [...m.entries()]
      .map(([team, rs]) => ({ team, runs: rs.sort((a, b) => a.from - b.from) }))
      .sort((a, b) => a.team.localeCompare(b.team))
  }, [runs])

  if (!rows.length) return null

  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full border-separate border-spacing-0 text-[10px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-surface-2 px-2.5 py-2 text-left text-[8.5px] font-extrabold tracking-[0.11em] text-ink-3 uppercase">Club</th>
            {gws.map((gw) => <th key={gw} className="bg-surface-2 px-1 py-2 text-center text-[9px] font-extrabold text-ink-3">{gw}</th>)}
            <th className="bg-surface-2 px-2.5 py-2 text-right text-[8.5px] font-extrabold tracking-[0.11em] text-ink-3 uppercase">Best run</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ team, runs: rs }, ri) => (
            <tr key={team} className={ri % 2 ? 'bg-white/[.014]' : undefined}>
              <th className={`sticky left-0 z-10 border-t border-line px-2.5 py-1.5 text-left font-bold whitespace-nowrap text-ink ${ri % 2 ? 'bg-[color-mix(in_srgb,var(--surface-1)_97%,white)]' : 'bg-surface-1'}`}>
                <span className="flex items-center gap-1.5"><TeamBadge team={team} size={14} />{team}</span>
              </th>
              {gws.map((gw) => {
                const f = byTeam.get(team)?.get(gw)
                const run = rs.find((r) => gw >= r.from && gw <= r.to)
                if (!f) return <td key={gw} className="border-t border-line px-1 py-1.5 text-center text-ink-3">–</td>
                if (!run) {
                  return (
                    <td key={gw} className="border-t border-line px-1 py-1.5 text-center leading-none">
                      <span className="font-semibold text-ink-3 opacity-[.34]">{f.opp}</span>
                      {/* the surrounding weeks stay readable as colour without
                          competing as text */}
                      <i className="mx-auto mt-[3px] block h-[2px] w-3.5 rounded-full opacity-50" style={{ background: diffTick(f.diff) }} />
                    </td>
                  )
                }
                const a = gw === run.from, b = gw === run.to
                return (
                  <td
                    key={gw}
                    title={`GW${gw} · ${f.venue === 'H' ? 'home to' : 'away at'} ${f.opp} · difficulty ${f.diff.toFixed(1)} · best run GW${run.from}–${run.to}`}
                    className="border-t border-line px-1 py-2 text-center leading-none whitespace-nowrap"
                    style={{
                      background: diffFill(f.diff),
                      // One continuous band, not a row of boxes: only the first
                      // and last week carry a hard edge, because those are the
                      // two weeks you act on.
                      borderTopLeftRadius: a ? 9 : 0, borderBottomLeftRadius: a ? 9 : 0,
                      borderTopRightRadius: b ? 9 : 0, borderBottomRightRadius: b ? 9 : 0,
                      boxShadow: [
                        'inset 0 1px 0 rgba(226,192,106,.34)',
                        'inset 0 -1px 0 rgba(226,192,106,.34)',
                        a ? 'inset 1px 0 0 var(--accent)' : '',
                        b ? 'inset -1px 0 0 var(--accent)' : '',
                      ].filter(Boolean).join(','),
                    }}
                  >
                    <span className="text-[10.5px] font-extrabold text-ink">{f.opp}</span>
                    <span className="ml-0.5 text-[8px] text-ink-2">{f.venue}</span>
                  </td>
                )
              })}
              <td className="border-t border-line px-2.5 py-1.5 text-right whitespace-nowrap">
                {rs.map((r) => (
                  <span key={r.half} className="block">
                    <b className="text-[11px] font-extrabold text-accent-2">GW{r.from}–{r.to}</b>
                    <span className="ml-1 text-[9px] text-ink-3">{r.avg.toFixed(2)} avg</span>
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
