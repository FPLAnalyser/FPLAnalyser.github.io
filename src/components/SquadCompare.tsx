import { useMemo } from 'react'
import { Panel } from './SquadShape'
import { num } from '../lib/rows'
import {
  buildSeries, comparePlans, spreadOf, type Engine, type PlayerSeries,
} from '../lib/squadInsights'
import type { StoredPlan } from '../lib/plans'
import type { RatingRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   Comparing plans.

   The table at the top could be assembled by anyone with two projections
   side by side. The head-to-head could not, and it is the reason the tab
   exists: "Plan A projects 11 more" sounds decisive, "Plan A wins 63% of
   the time" is the same fact and does not — and the second is the true one.

   Each plan is compared AS A FIFTEEN with the best legal eleven picked each
   week, not as a transfer path. That is the honest scope: a stored plan's
   week decisions are its own, but comparing two different transfer paths
   over six weeks compounds two sets of assumptions and the result stops
   being about the squads.
   ════════════════════════════════════════════════════════════════════════ */

const COLOURS = ['var(--accent)', 'var(--info)', 'var(--good)', 'var(--hot)']
const pct = (v: number) => `${Math.round(v * 100)}%`

export interface ComparePlan {
  plan: StoredPlan
  squad: RatingRow[]
}

export function SquadCompare({ plans, gws, engine, draws = 4000 }: {
  plans: ComparePlan[]
  gws: number[]
  engine: Engine
  draws?: number
}) {
  const gwKey = gws.join(',')
  const { fixtureEase, avail, model, market, profiles } = engine
  const sig = plans.map((p) => `${p.plan.id}:${p.squad.map((r) => num(r, 'element')).join('.')}`).join('|')

  const series = useMemo(
    () => plans.map((p) => buildSeries(p.squad, gws, engine)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sig, gwKey, fixtureEase, avail, model, market, profiles],
  )
  const cmp = useMemo(
    () => comparePlans(series, gws, draws),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series, gwKey, draws],
  )

  const complete = plans.filter((p) => p.squad.length === 15)
  if (complete.length < 2) {
    return (
      <Panel title="Compare plans" kicker="Two plans of fifteen are needed before there is anything to compare.">
        <div className="text-[13px] text-ink-2">
          {plans.length < 2
            ? 'Tick at least two plans in the strip above the pitch.'
            : `Only ${complete.length} of the ${plans.length} ticked plans has a full fifteen. Finish the others and they will appear here.`}
        </div>
      </Panel>
    )
  }

  const rows = plans.map((p, i) => {
    const s = series[i]
    const projection = cmp.weeks[i].reduce((a, w) => a + w.xp, 0)
    return {
      name: p.plan.name,
      colour: COLOURS[i % COLOURS.length],
      spend: s.reduce((a, x) => a + x.price, 0),
      projection,
      owned: s.reduce((a, x) => a + (num(x.row, 'selected_by_percent') ?? 0), 0) / Math.max(s.length, 1),
      spread: spreadOf(cmp.totals[i]),
      weeks: cmp.weeks[i],
      series: s,
    }
  })

  const bestProj = Math.max(...rows.map((r) => r.projection))
  const lowOwn = Math.min(...rows.map((r) => r.owned))

  return (
    <div className="grid gap-4">
      <Headline rows={rows} bestProj={bestProj} lowOwn={lowOwn} />
      <WeekByWeek rows={rows} gws={gws} />
      <HeadToHead rows={rows} cmp={cmp} />
      <SharedAndDifferent rows={rows} />
      <Armbands rows={rows} gws={gws} />
    </div>
  )
}

type Row = ReturnType<typeof buildRows>[number]
// Only here to give the sub-components a name for the row shape.
function buildRows() {
  return [] as {
    name: string; colour: string; spend: number; projection: number; owned: number
    spread: { p10: number; median: number; p90: number; mean: number }
    weeks: { xp: number; captain: number | null; xi: PlayerSeries[]; form: string }[]
    series: PlayerSeries[]
  }[]
}

// ── the table ───────────────────────────────────────────────────────────────

function Headline({ rows, bestProj, lowOwn }: { rows: Row[]; bestProj: number; lowOwn: number }) {
  const widest = Math.max(...rows.map((r) => r.spread.p90 - r.spread.p10))
  const gap = bestProj - Math.min(...rows.map((r) => r.projection))
  return (
    <Panel
      title="Three numbers, and the one that qualifies them"
      kicker="Projection is the sum of a best legal eleven each week with a captain. The range is the 10th to 90th percentile of the simulated runs behind it — the same runs the head-to-head below is drawn from."
      note={
        <>
          The best plan projects <b>{gap.toFixed(1)}</b> more than the worst over these{' '}
          {rows[0].weeks.length} weeks. The widest single plan spans <b>{widest.toFixed(0)}</b> points
          between its own bad run and its own good one. Read together, the gap you are choosing is a
          fraction of the noise you are choosing it inside — which does not make the choice
          pointless, it makes it the part you control.
        </>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-[10px] tracking-[0.09em] text-ink-3 uppercase">
              <th className="py-1.5 pr-2 text-left font-semibold">Plan</th>
              <th className="px-2 py-1.5 text-right font-semibold">Spent</th>
              <th className="px-2 py-1.5 text-right font-semibold">Projection</th>
              <th className="px-2 py-1.5 text-right font-semibold">Owned</th>
              <th className="px-2 py-1.5 text-right font-semibold">Floor</th>
              <th className="px-2 py-1.5 text-right font-semibold">Median</th>
              <th className="py-1.5 pl-2 text-right font-semibold">Ceiling</th>
            </tr>
          </thead>
          <tbody className="font-num tabular-nums">
            {rows.map((r) => (
              <tr key={r.name} className="border-b border-line last:border-0">
                <td className="py-2 pr-2 text-left">
                  <span className="flex items-center gap-2 font-sans text-[13px] font-semibold text-ink">
                    <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: r.colour }} />
                    {r.name}
                  </span>
                </td>
                <td className="px-2 py-2 text-right text-ink-2">£{r.spend.toFixed(1)}</td>
                <td className={`px-2 py-2 text-right font-bold ${r.projection >= bestProj - 1e-9 ? 'text-accent-2' : 'text-ink'}`}>
                  {r.projection.toFixed(1)}
                </td>
                <td className={`px-2 py-2 text-right ${r.owned <= lowOwn + 1e-9 ? 'font-bold text-accent-2' : 'text-ink-2'}`}>
                  {r.owned.toFixed(1)}%
                </td>
                <td className="px-2 py-2 text-right text-ink-2">{r.spread.p10.toFixed(0)}</td>
                <td className="px-2 py-2 text-right text-ink">{r.spread.median.toFixed(0)}</td>
                <td className="py-2 pl-2 text-right text-ink-2">{r.spread.p90.toFixed(0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

// ── week by week ────────────────────────────────────────────────────────────

function WeekByWeek({ rows, gws }: { rows: Row[]; gws: number[] }) {
  const all = rows.flatMap((r) => r.weeks.map((w) => w.xp))
  const lo = Math.min(...all) * 0.92
  const hi = Math.max(...all)
  const swing = rows.map((r) => {
    const xs = r.weeks.map((w) => w.xp)
    return { name: r.name, band: Math.max(...xs) - Math.min(...xs) }
  }).sort((a, b) => b.band - a.band)

  return (
    <Panel
      title="Where the gap opens"
      kicker="Projected points per week. A total hides whether one plan is better everywhere or better in two weeks and level in four — and those are different decisions, because the second one is a transfer rather than a rebuild."
      note={
        <>
          <b>{swing[0].name}</b> swings {swing[0].band.toFixed(1)} points across these weeks against{' '}
          {swing[swing.length - 1].band.toFixed(1)} for <b>{swing[swing.length - 1].name}</b> — and
          that is on projections alone, before a ball is kicked. A squad whose points are
          concentrated in a few players has a wider weekly band by construction.
        </>
      }
    >
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          <div className="mb-1 grid gap-2" style={{ gridTemplateColumns: `104px repeat(${gws.length}, 1fr)` }}>
            <span />
            {gws.map((gw) => (
              <span key={gw} className="text-center text-[10px] font-bold tracking-[0.08em] text-ink-3 uppercase">GW{gw}</span>
            ))}
          </div>
          {rows.map((r) => (
            <div key={r.name} className="mb-1.5 grid items-center gap-2" style={{ gridTemplateColumns: `104px repeat(${gws.length}, 1fr)` }}>
              <span className="truncate">
                <span className="block text-[12px] font-semibold text-ink">{r.name}</span>
                <span className="font-num block text-[10px] text-ink-3 tabular-nums">{r.projection.toFixed(1)} total</span>
              </span>
              {r.weeks.map((w, i) => {
                // Shaded within the plan's own colour by where the week sits in
                // the range every plan shares, so a cell is comparable across
                // rows as well as along one.
                const t = hi > lo ? (w.xp - lo) / (hi - lo) : 0.5
                return (
                  <span
                    key={i}
                    title={`${r.name} · GW${gws[i]} · ${w.xp.toFixed(1)} xP · ${w.form}`}
                    className="font-num block rounded px-1 py-1.5 text-center text-[11.5px] font-bold tabular-nums"
                    style={{
                      background: `color-mix(in oklab, ${r.colour} ${Math.round(28 + t * 62)}%, var(--surface-2))`,
                      color: t > 0.55 ? 'var(--accent-contrast)' : 'var(--ink-1)',
                    }}
                  >
                    {w.xp.toFixed(1)}
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}

// ── the answer ──────────────────────────────────────────────────────────────

function HeadToHead({ rows, cmp }: { rows: Row[]; cmp: ReturnType<typeof comparePlans> }) {
  if (!cmp.h2h.length) return null
  const decided = cmp.h2h.filter((h) => h.tieRate < 0.99)
  const closest = (decided.length ? decided : cmp.h2h)
    .slice().sort((a, b) => Math.abs(a.winRate - 0.5) - Math.abs(b.winRate - 0.5))[0]

  return (
    <Panel
      title="How often does the better plan actually win?"
      kicker={`Each pair simulated ${cmp.draws.toLocaleString()} times with common random numbers — every player draws the same score in both plans, so the players the squads share cancel out exactly and what is left is the decision you are making.`}
      note={
        decided.length === 0
          ? <>Every pairing here is a dead tie in every run, which means the squads are the same
              fifteen. Change something in one of them and this panel starts having an opinion.</>
          : <>
              <b>This is the panel worth having, and it is the one a table cannot give you.</b>{' '}
              {rows[closest.a].name} against {rows[closest.b].name} comes out{' '}
              {pct(closest.winRate)} / {pct(1 - closest.winRate - closest.tieRate)}
              {closest.tieRate > 0.005 ? ` with ${pct(closest.tieRate)} dead level` : ''} — a mean gap
              of {closest.meanGap >= 0 ? '+' : ''}{closest.meanGap.toFixed(1)} inside a range of{' '}
              {closest.p10.toFixed(0)} to {closest.p90.toFixed(0)}. Better than a coin toss is not the
              same as right, and the losing plan still comes out ahead in the runs where its
              differentials do what they were bought to do.
            </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {cmp.h2h.map((h) => {
          const A = rows[h.a], B = rows[h.b]
          const lossRate = Math.max(0, 1 - h.winRate - h.tieRate)
          const same = h.tieRate > 0.99
          const span = Math.max(Math.abs(h.p10), Math.abs(h.p90), 1)
          const pos = (v: number) => 50 + (v / (span * 2)) * 100
          return (
            <div key={`${h.a}-${h.b}`} className="rounded-xl border border-line bg-surface-2/40 p-3">
              <div className="mb-0.5 text-[12.5px] font-semibold text-ink">
                {A.name} <span className="font-normal text-ink-3">vs</span> {B.name}
              </div>
              <div className="font-num mb-2 text-[11px] text-ink-3 tabular-nums">
                {same ? 'the same fifteen — level in every run'
                  : `mean gap ${h.meanGap >= 0 ? '+' : ''}${h.meanGap.toFixed(1)} points`}
              </div>
              {/* Three segments, because a tie is not a loss. Two squads sharing
                  every player tie in 100% of paired runs, and a two-segment bar
                  had no way to say that except by handing the win to one of
                  them. */}
              <div className="flex h-6 overflow-hidden rounded-md text-[11px] font-bold">
                <span
                  className="flex items-center justify-center"
                  style={{ width: `${h.winRate * 100}%`, background: A.colour, color: 'var(--accent-contrast)' }}
                >
                  {h.winRate > 0.14 ? pct(h.winRate) : ''}
                </span>
                {h.tieRate > 0.001 && (
                  <span
                    className="flex items-center justify-center bg-surface-3 text-ink-2"
                    style={{ width: `${h.tieRate * 100}%` }}
                  >
                    {h.tieRate > 0.14 ? (same ? 'level' : `${pct(h.tieRate)} level`) : ''}
                  </span>
                )}
                <span
                  className="flex items-center justify-center"
                  style={{ width: `${lossRate * 100}%`, background: B.colour, color: 'var(--accent-contrast)' }}
                >
                  {lossRate > 0.14 ? pct(lossRate) : ''}
                </span>
              </div>
              {/* The distribution of the GAP, zero in the middle. Left of the
                  line is where the first plan loses. */}
              <div className="relative mt-3 h-9">
                <div className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                <div
                  className="absolute top-2 h-2.5 rounded-full"
                  style={{
                    left: `${Math.max(0, pos(h.p10))}%`,
                    width: `${Math.min(100, pos(h.p90)) - Math.max(0, pos(h.p10))}%`,
                    background: `linear-gradient(90deg, ${B.colour}, var(--surface-3), ${A.colour})`,
                  }}
                />
                <div className="absolute top-1 h-4 w-0.5 rounded bg-ink" style={{ left: `${pos(h.meanGap)}%` }} />
                <span className="font-num absolute bottom-0 left-0 text-[10px] text-ink-3 tabular-nums">{h.p10.toFixed(0)}</span>
                <span className="font-num absolute bottom-0 left-1/2 -translate-x-1/2 text-[10px] text-ink-3 tabular-nums">0</span>
                <span className="font-num absolute right-0 bottom-0 text-[10px] text-ink-3 tabular-nums">+{h.p90.toFixed(0)}</span>
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-3 max-w-[80ch] text-[11.5px] leading-snug text-ink-3">
        Why common random numbers and not two independent runs: plans that differ by three players
        still share twelve. Simulated separately those twelve draw different scores in each plan and
        add tens of points of noise that has nothing to do with the decision — a real edge vanishes
        inside it and every comparison prints 50/50. Drawing each player once and reusing the number
        in both plans removes exactly the part the squads have in common.
      </p>
      <p className="mt-1.5 max-w-[80ch] text-[11.5px] leading-snug text-ink-3">
        The mean gap here and the projection gap in the first table are the same quantity measured
        two ways — one summed, one drawn — so they land within a few tenths of each other rather
        than exactly on it. If they ever diverged by more than that, one of them would be wrong.
      </p>
    </Panel>
  )
}

// ── shared and different ────────────────────────────────────────────────────

function SharedAndDifferent({ rows }: { rows: Row[] }) {
  const sets = rows.map((r) => new Set(r.series.map((p) => p.element)))
  const all = [...new Set(rows.flatMap((r) => r.series.map((p) => p.element)))]
  const nameOf = (el: number) => {
    const p = rows.flatMap((r) => r.series).find((x) => x.element === el)
    return p ? String(p.row.web_name) : '?'
  }
  const core = all.filter((el) => sets.every((s) => s.has(el)))
  const unique = rows.map((_, i) => all.filter((el) =>
    sets[i].has(el) && sets.every((s, j) => j === i || !s.has(el))))
  const identical = core.length === all.length

  return (
    <Panel
      title={identical ? 'These are the same fifteen' : 'Plans agree more than they look like they do'}
      kicker={identical
        ? `All ${rows.length} plans hold an identical squad, so every panel on this tab will agree with itself. Change a player in one of them and the comparison starts saying something.`
        : `${all.length} distinct players across ${rows.length} squads. ${core.length} of them are in every plan — so the argument is about ${all.length - core.length} places, not ${rows.length * 15}.`}
      note={
        identical
          ? null
          : core.length
          ? <>The shared {core.length} are the finding, not the leftovers. Squads built to different
              briefs that all buy the same players are telling you those picks are not a preference —
              they are what the projection thinks is true, and no plan you write will be about them.</>
          : <>Nothing is in every plan, which is unusual and worth a second look: these squads are
              not variations on a theme, they are different teams, and the comparison below is
              measuring the whole thing rather than a decision.</>
      }
    >
      <div className="grid gap-2.5 sm:grid-cols-2">
        <div className="rounded-xl border border-accent/40 bg-accent-selected p-3">
          <div className="mb-2 text-[10px] font-bold tracking-[0.11em] text-accent uppercase">
            In every plan · {core.length}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {core.length
              ? core.map((el) => (
                  <span key={el} className="rounded-md bg-accent-soft px-2 py-1 text-[11.5px] font-medium text-accent-2">{nameOf(el)}</span>
                ))
              : <span className="text-[12.5px] text-ink-3">Nobody.</span>}
          </div>
        </div>
        {rows.map((r, i) => (
          <div key={r.name} className="rounded-xl border border-line bg-surface-2/40 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold tracking-[0.11em] text-ink-3 uppercase">
              <span className="size-2 rounded-[2px]" style={{ background: r.colour }} />
              Only in {r.name} · {unique[i].length}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {unique[i].length
                ? unique[i].map((el) => (
                    <span key={el} className="rounded-md bg-surface-3 px-2 py-1 text-[11.5px] text-ink-2">{nameOf(el)}</span>
                  ))
                : <span className="text-[12.5px] text-ink-3">Nothing unique to this plan.</span>}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ── armbands ────────────────────────────────────────────────────────────────

function Armbands({ rows, gws }: { rows: Row[]; gws: number[] }) {
  const nameOf = (r: Row, el: number | null) =>
    el == null ? '—' : String(r.series.find((p) => p.element === el)?.row.web_name ?? '—')

  const perWeek = gws.map((_, i) => rows.map((r) => nameOf(r, r.weeks[i]?.captain ?? null)))
  const agreeCount = perWeek.map((names) => {
    const counts = new Map<string, number>()
    for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1)
    return Math.max(...counts.values())
  })
  const unanimous = agreeCount.filter((c) => c === rows.length).length

  return (
    <Panel
      title="Who each plan captains, week by week"
      kicker="Two plans can project the same and be completely different bets once the armband is on. Gold marks a player two or more plans land on in the same week."
      note={
        <>
          {unanimous === 0
            ? <>No week has every plan agreeing on the captain, which is worth knowing on its own:
                the armband is never the free part of a plan.</>
            : <>{unanimous} of {gws.length} weeks have every plan on the same captain — those weeks
                are not a decision, whatever else you change.</>}
          {' '}A captain is a doubled bet, so the plan with the most concentrated armband has both the
          most to gain and the most to lose, and the projection column never says that.
        </>
      }
    >
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          <div className="mb-1 grid gap-1.5" style={{ gridTemplateColumns: `104px repeat(${gws.length}, 1fr)` }}>
            <span />
            {gws.map((gw) => (
              <span key={gw} className="text-center text-[10px] font-bold tracking-[0.08em] text-ink-3 uppercase">GW{gw}</span>
            ))}
          </div>
          {rows.map((r) => (
            <div key={r.name} className="mb-1.5 grid items-center gap-1.5" style={{ gridTemplateColumns: `104px repeat(${gws.length}, 1fr)` }}>
              <span className="truncate text-[12px] font-semibold text-ink">{r.name}</span>
              {gws.map((_, i) => {
                const who = nameOf(r, r.weeks[i]?.captain ?? null)
                const shared = perWeek[i].filter((n) => n === who).length > 1
                return (
                  <span
                    key={i}
                    className={`block truncate rounded px-1 py-1.5 text-center text-[11px] ${
                      shared ? 'bg-accent-soft font-semibold text-accent-2' : 'bg-surface-2 text-ink-2'}`}
                  >
                    {who}
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}
