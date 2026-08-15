import { useMemo } from 'react'
import { PageHeader, PageShell } from '../components/PageShell'
import { TeamBadge } from '../components/badges'
import { Icon } from '../components/Icon'
import { useCore } from '../lib/useData'
import { useTweaks, TWEAK_MAX, TWEAK_STEP, type Tweak } from '../lib/tweaks'
import { teamLabel } from '../lib/util'

/* ════════════════════════════════════════════════════════════════════════
   Where you disagree with the model.

   Two dials a club, attack and defence, and everything on the site follows:
   the difficulty of every fixture against them, what their opponents are
   expected to score, their clean sheets, their opponents' xP, the captaincy
   board, the squad ratings, the plan comparison. One source, so nothing on
   any page can contradict anything on another. The reasoning is in
   docs/CUSTOM_FDR.md; the engine is in lib/tweaks.

   Deltas, not absolutes. The house numbers refresh several times a day and a
   stored absolute would freeze a stale opinion, where "I think you have
   Newcastle a step light at the back" stays true across a refresh.
   ════════════════════════════════════════════════════════════════════════ */

const WORDS: Record<string, [string, string]> = {
  att: ['weaker going forward', 'stronger going forward'],
  def: ['leakier at the back', 'meaner at the back'],
}

function Dial({ label, hint, value, onChange }: {
  label: string; hint: string; value: number; onChange: (v: number) => void
}) {
  const words = WORDS[hint]
  return (
    <div className="flex items-center gap-2">
      <span className="w-[54px] shrink-0 text-[11px] font-semibold text-ink-2">{label}</span>
      <input
        type="range"
        min={-TWEAK_MAX} max={TWEAK_MAX} step={TWEAK_STEP} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        title={value === 0 ? 'As the model has them' : `${Math.abs(value)} step${Math.abs(value) === 1 ? '' : 's'} ${words[value > 0 ? 1 : 0]}`}
        className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-surface-3 accent-accent"
      />
      <span className={`font-num w-9 shrink-0 text-right text-[12px] font-bold tabular-nums ${
        value === 0 ? 'text-ink-3' : value > 0 ? 'text-good' : 'text-bad'
      }`}>
        {value === 0 ? '—' : `${value > 0 ? '+' : '−'}${Math.abs(value)}`}
      </span>
    </div>
  )
}

export default function MyRatings() {
  const core = useCore()
  const { tweaks, set, reset, count } = useTweaks()
  const teams = useMemo(
    () => [...new Set((core.data?.fixtureEase ?? []).map((f) => String(f.team)))]
      .sort((a, b) => teamLabel(a).localeCompare(teamLabel(b))),
    [core.data],
  )

  return (
    <PageShell>
      <PageHeader
        title="Your ratings"
        subtitle="Where you disagree with the model, and what that changes."
      />

      <div className="mb-4 rounded-2xl border border-line bg-surface-1/60 p-4 text-[13.5px] leading-relaxed text-ink-2">
        <p className="mb-2">
          Two dials a club. <b className="text-ink">Attack</b> is what they are expected to score;
          {' '}<b className="text-ink">defence</b> is what they are expected to concede. Everything else on this site
          is derived from those two numbers, so a club you move here moves with it —
          {' '}<b className="text-ink">the difficulty of all thirty-eight fixtures against them</b>, their opponents'
          projected points, their clean-sheet odds, the captaincy board and every plan you compare.
        </p>
        <p className="mb-0 text-ink-3">
          One step is worth about a tenth of a goal a game; two is a strong disagreement and as far as the
          projection stays worth printing. Your changes are stored as a difference from the model rather than
          as a fixed number, so they still mean what you meant after the next data refresh — and they live on
          this device only.
        </p>
        {count > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <span className="rounded-lg border border-accent bg-accent-selected px-2.5 py-1 text-[12px] font-bold text-accent">
              {count} {count === 1 ? 'club' : 'clubs'} re-rated
            </span>
            <button
              onClick={reset}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-line-mid px-2.5 text-[12.5px] font-semibold text-ink-2 transition-colors hover:border-bad hover:text-bad"
            >
              <Icon name="undo" size={13} /> Back to the model
            </button>
          </div>
        )}
      </div>

      {!teams.length ? (
        <p className="text-[13px] text-ink-2">The fixture table has not loaded yet.</p>
      ) : (
        <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) => {
            const v: Tweak = tweaks[t] ?? { att: 0, def: 0 }
            const on = v.att !== 0 || v.def !== 0
            return (
              <div
                key={t}
                className={`rounded-xl border px-3 py-2.5 transition-colors ${
                  on ? 'border-accent/55 bg-accent-soft/30' : 'border-line bg-surface-1/50'
                }`}
              >
                <div className="mb-2 flex items-center gap-2">
                  <TeamBadge team={t} size={20} />
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{teamLabel(t)}</span>
                  {on && (
                    <button
                      onClick={() => set(t, { att: 0, def: 0 })}
                      title="Back to the model for this club"
                      className="text-[11px] font-semibold text-accent hover:underline"
                    >
                      Reset
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Dial label="Attack" hint="att" value={v.att} onChange={(n) => set(t, { att: n })} />
                  <Dial label="Defence" hint="def" value={v.def} onChange={(n) => set(t, { def: n })} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </PageShell>
  )
}
