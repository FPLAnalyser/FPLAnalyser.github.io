import { useCallback, useMemo } from 'react'
import { PageHeader, PageShell } from '../components/PageShell'
import { TeamBadge } from '../components/badges'
import { Icon } from '../components/Icon'
import { useCore } from '../lib/useData'
import { useTweaks, clubImpact, TWEAK_MAX, TWEAK_STEP, type Tweak } from '../lib/tweaks'
import { useXpModel, useMarketOdds } from '../lib/xp'
import { teamLabel } from '../lib/util'
import { buildDiffScale, useTeamBaselines, type DiffScale } from '../lib/fixtureRuns'

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

/** The consequence, beside the control. Without it a slider from 0 to +2 is
 *  a guess, and a projection built on a guess is worth nothing.
 *
 *  THE WINDOW IS NAMED, because a bare 1.87 next to a dial is unreadable —
 *  one week, six, a season? The goal and clean-sheet figures are per game
 *  across their next few fixtures; the difficulty is what facing this club is
 *  worth on the site's own 1–5, which is a property of the club rather than of
 *  a window, so it sits on its own line and says so. */
function Impact({ house, yours, diff }: {
  house: ReturnType<typeof clubImpact>
  yours: ReturnType<typeof clubImpact>
  diff: { house: number; yours: number } | null
}) {
  if (!house) return null
  const show = yours ?? house
  const moved = !!yours
  const cell = (label: string, was: number, now: number, dp: number, suffix = '') => {
    const up = now > was + 0.005
    const down = now < was - 0.005
    return (
      <span className="flex min-w-0 flex-1 flex-col items-center">
        <span className="text-[9px] font-extrabold tracking-[0.08em] text-ink-3 uppercase">{label}</span>
        <span className="font-num text-[12.5px] font-bold tabular-nums text-ink">
          {now.toFixed(dp)}{suffix}
        </span>
        {moved && (up || down) && (
          <span className={`font-num text-[10px] font-bold tabular-nums ${up ? 'text-good' : 'text-bad'}`}>
            {was.toFixed(dp)}{suffix} → {now.toFixed(dp)}{suffix}
          </span>
        )}
      </span>
    )
  }
  const dMoved = diff && Math.abs(diff.yours - diff.house) >= 0.05
  return (
    <div className="mt-2 rounded-lg border border-line-subtle bg-bg-0/40 px-2 py-1.5">
      <div className="mb-1 text-[9px] font-extrabold tracking-[0.08em] text-ink-3 uppercase">
        Their next {house.games} fixtures, per game
      </div>
      <div
        className="flex gap-1"
        title={`Averaged over their next ${house.games} fixtures, on the same arithmetic the projection uses`}
      >
        {cell('Scores', house.forGoals, show.forGoals, 2)}
        {cell('Concedes', house.against, show.against, 2)}
        {cell('Clean sheet', house.cs * 100, show.cs * 100, 0, '%')}
      </div>
      {diff && (
        <div
          className="mt-1.5 flex items-center gap-2 border-t border-line-subtle pt-1.5"
          title="What a fixture against this club is worth on the site's 1–5 difficulty, averaged over home and away. Every one of their thirty-eight games, not just the next few."
        >
          <span className="min-w-0 flex-1 truncate text-[9px] font-extrabold tracking-[0.08em] text-ink-3 uppercase">
            Difficulty of facing them
          </span>
          {dMoved && (
            <span className="font-num text-[10px] font-bold tabular-nums text-ink-3">
              {diff.house.toFixed(1)} →
            </span>
          )}
          <span className={`font-num text-[12.5px] font-bold tabular-nums ${
            !dMoved ? 'text-ink' : diff.yours > diff.house ? 'text-bad' : 'text-good'
          }`}>
            {diff.yours.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  )
}

export default function MyRatings() {
  const core = useCore()
  const model = useXpModel()
  const market = useMarketOdds()
  const { tweaks, set, reset, count } = useTweaks()
  const rows = core.data?.fixtureEase ?? []
  const fromGw = useMemo(() => Math.min(...(rows.length ? rows.map((f) => f.gw) : [1])), [rows])
  /* The engine's own strengths, so the preview and the projection are the same
     arithmetic. The market's implied figures where it has an opinion, the
     model's where it does not — exactly what strengthOf does. */
  const strength = useMemo(() => {
    const out: Record<string, { att: number; def: number }> = {}
    for (const t of Object.keys(model?.teams ?? {})) {
      const implied = market?.strength?.[t]
      out[t] = implied && implied.att > 0 ? { att: implied.att, def: implied.def } : model!.teams[t]
    }
    return out
  }, [model, market])
  const league = model ? { att: model.league.att, def: model.league.def, hAtt: model.league.hAtt } : undefined

  /* THE DIFFICULTY THESE DIALS PRODUCE, from the builder the Fixtures page
     draws its grid with — not a second opinion computed for this page. Two
     scales off the same yardstick: `house` as the model has everyone, and
     yours with the dials applied. Venue-neutral, because a club is not a
     harder opponent at home in a way this control should be asked about. */
  const { baselines, house } = useTeamBaselines(core.data)
  const scales = useMemo(() => ({
    house: buildDiffScale(house, house),
    yours: buildDiffScale(baselines, house),
  }), [baselines, house])
  const facing = useCallback((team: string, scale: DiffScale | null): number | null => {
    if (!scale) return null
    const vs: ('H' | 'A')[] = ['H', 'A']
    let n = 0
    let sum = 0
    for (const v of vs) {
      const a = scale.attackDiff(team, v)
      const d = scale.defenceDiff(team, v)
      if (a == null || d == null) continue
      sum += (a + d) / 2
      n++
    }
    return n ? sum / n : null
  }, [])
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
          One step moves that club's goal rate by about an eighth; two is a strong disagreement and as far as
          the projection stays worth printing. The figures under each pair of dials are per game across that
          club's next few fixtures; the difficulty is what facing them is worth on the site's 1–5, home and
          away averaged, and it applies to all thirty-eight. Your changes are stored as a difference from the
          model rather than as a fixed number, so they still mean what you meant after the next data refresh —
          and they live on this device only.
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
                <Impact
                  house={clubImpact(t, rows, strength, league, {}, fromGw)}
                  yours={on ? clubImpact(t, rows, strength, league, tweaks, fromGw) : null}
                  diff={(() => {
                    const h = facing(t, scales.house)
                    const y = facing(t, scales.yours)
                    return h == null || y == null ? null : { house: h, yours: y }
                  })()}
                />
              </div>
            )
          })}
        </div>
      )}
    </PageShell>
  )
}
