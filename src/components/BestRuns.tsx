import { diffFill, type SeasonRun } from '../lib/fixtureRuns'

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
