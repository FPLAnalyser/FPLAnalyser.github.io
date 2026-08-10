import { useMemo } from 'react'
import { Panel } from './SquadShape'
import { squadDimensions, type Dimension } from './SquadVerdict'
import { num } from '../lib/rows'
import {
  buildSeries, comparePlans, spreadOf, type Engine, type PlayerSeries,
} from '../lib/squadInsights'
import type { StoredPlan } from '../lib/plans'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

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
const DIM_KEYS = ['attack', 'defence', 'defcon', 'fixtures'] as const
const DIM_LABELS = ['Attack', 'Defence', 'Def Con', 'Fixtures']
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
    /* Squad rating is the same figure the builder prints above the pitch —
       mean of the rated players, on the 0-100 scale. Pre-season a chunk of the
       fifteen carry no rating at all, so the mean is over those who do and the
       panel says so rather than quietly counting a new signing as zero. */
    const rated = p.squad.map((r) => num(r, 'season_overall_score')).filter((v): v is number => v != null)
    return {
      rating: rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 20) : null,
      dims: squadDimensions(p.squad, fixtureEase, gws[0]),
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
      <Dimensions rows={rows} />
      <WeekByWeek rows={rows} gws={gws} />
      <Horizon rows={rows} gws={gws} fixtureEase={fixtureEase} />
      <HeadToHead rows={rows} cmp={cmp} />
      <SharedAndDifferent rows={rows} />
      {/* Pairing two lists of players only means something when there are two
          lists. With three or four plans the shared/unique panel above is the
          honest view and this is left off rather than fudged. */}
      {rows.length === 2 && <Ledger rows={rows} />}
      <ClubRisk rows={rows} />
      <Armbands rows={rows} gws={gws} />
    </div>
  )
}

type Row = ReturnType<typeof buildRows>[number]
// Only here to give the sub-components a name for the row shape.
function buildRows() {
  return [] as {
    name: string; colour: string; spend: number; projection: number; owned: number
    rating: number | null; dims: Dimension[]
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
      <TrendChart rows={rows} gws={gws} lo={lo} hi={hi} />
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


/* xP against gameweeks, one line per plan, with the area between the top two
   shaded. The grid of numbers underneath answers "how many points in GW4"; the
   line answers "is one plan ahead everywhere, or ahead twice and behind
   twice" — which is the question that decides between a transfer and a
   rebuild, and the one a column of figures is worst at. */
function TrendChart({ rows, gws, lo, hi }: { rows: Row[]; gws: number[]; lo: number; hi: number }) {
  const W = 720
  const H = 190
  const PAD_X = 28
  const PAD_Y = 14
  const span = Math.max(hi - lo, 0.001)
  const x = (i: number) => PAD_X + (i * (W - 2 * PAD_X)) / Math.max(gws.length - 1, 1)
  const y = (v: number) => H - PAD_Y - ((v - lo) / span) * (H - 2 * PAD_Y - 12)
  const pts = rows.map((r) => r.weeks.map((w, i) => `${x(i).toFixed(1)},${y(w.xp).toFixed(1)}`))
  // Shade between the two strongest plans only. With four lines every pairwise
  // band overlaps into an unreadable wash, and the pair that matters is the
  // one at the top.
  const rank = rows.map((r, i) => ({ i, p: r.projection })).sort((a, b) => b.p - a.p)
  const band = rows.length >= 2
    ? `${pts[rank[0].i].join(' ')} ${[...pts[rank[1].i]].reverse().join(' ')}`
    : null

  return (
    <div className="mb-3 overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[460px]" role="img"
           aria-label="Projected points per gameweek for each plan">
        {gws.map((gw, i) => (
          <g key={gw}>
            <line x1={x(i)} y1={PAD_Y - 6} x2={x(i)} y2={H - PAD_Y - 4} stroke="var(--line-subtle)" />
            <text x={x(i)} y={H - 2} textAnchor="middle" className="fill-ink-3 text-[9px]">GW{gw}</text>
          </g>
        ))}
        {band && <polygon points={band} fill={rows[rank[0].i].colour} opacity={0.12} />}
        {rows.map((r, i) => (
          <polyline key={r.name} points={pts[i].join(' ')} fill="none" stroke={r.colour} strokeWidth={2.25}
                    strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {rows.map((r) => r.weeks.map((w, j) => (
          <circle key={`${r.name}-${j}`} cx={x(j)} cy={y(w.xp)} r={3} fill={r.colour}>
            <title>{`${r.name} · GW${gws[j]} · ${w.xp.toFixed(1)} xP`}</title>
          </circle>
        )))}
      </svg>
    </div>
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

// ── squad shape: the ratings, faced off ─────────────────────────────────────

/* The four dimensions the site already scores for a single squad, put side by
   side. Worth stating why this panel is not just "the verdict card, twice":
   the projection and the rating answer different questions, and on a real pair
   of plans they routinely disagree. A rating is what fifteen footballers ARE,
   averaged over a season. A projection is what this fifteen RETURNS over these
   weeks — quality multiplied by fixtures, minutes and the armband. Showing one
   without the other is how a comparison ends up sounding certain and being
   wrong. */
function Dimensions({ rows }: { rows: Row[] }) {
  const two = rows.length === 2
  const lines: { label: string; note: string; vals: (number | null)[] }[] = [
    { label: 'Squad rating', note: 'mean player rating across the fifteen', vals: rows.map((r) => r.rating) },
    ...DIM_KEYS.map((k, i) => ({
      label: DIM_LABELS[i],
      note: rows[0].dims[i]?.note ?? '',
      vals: rows.map((r) => r.dims.find((d) => d.key === k)?.value ?? null),
    })),
  ]

  // Does the top-projecting plan also rate highest? When it does not, that is
  // the most useful sentence on the tab, so it is said rather than implied.
  const topProj = rows.reduce((a, b) => (b.projection > a.projection ? b : a))
  const rated = rows.filter((r) => r.rating != null)
  const topRate = rated.length ? rated.reduce((a, b) => ((b.rating ?? 0) > (a.rating ?? 0) ? b : a)) : null
  const split = topRate && topRate.name !== topProj.name

  return (
    <Panel
      title="The squad, by the numbers you already have"
      kicker="Squad rating, and the four routes to points scored the same 0–100 way as a player. A near-tie is drawn as a near-tie — nothing here awards a winner it cannot see."
      note={
        <>
          {split ? (
            <>
              <b>{topRate!.name} has the better players; {topProj.name} scores more points.</b> That is
              the panel working, not a contradiction to resolve — the rating is season-long quality, the
              projection is these {rows[0].weeks.length} weeks with fixtures, minutes and a captain
              applied.{' '}
            </>
          ) : null}
          These dimensions come from last season's percentiles, so pre-season they exist only for
          players with a record — new signings and promoted players carry none, and each figure is the
          mean over the players who have one rather than over all fifteen.
        </>
      }
    >
      <div className="grid gap-2">
        {lines.map((l) => {
          const best = Math.max(...l.vals.map((v) => v ?? -1))
          const tie = l.vals.filter((v) => v != null && Math.abs(v - best) <= 1).length > 1
          return two ? (
            <div key={l.label} className="grid grid-cols-[34px_1fr_150px_1fr_34px] items-center gap-2 sm:grid-cols-[38px_1fr_190px_1fr_38px] sm:gap-2.5">
              <Val v={l.vals[0]} lead={!tie && (l.vals[0] ?? -1) >= best} />
              <Track v={l.vals[0]} colour={rows[0].colour} lead={!tie && (l.vals[0] ?? -1) >= best} flip />
              <div className="text-center">
                <div className="text-[12px] font-semibold text-ink">{l.label}</div>
                <div className="text-[10px] leading-tight text-ink-3">{l.note}</div>
              </div>
              <Track v={l.vals[1]} colour={rows[1].colour} lead={!tie && (l.vals[1] ?? -1) >= best} />
              <Val v={l.vals[1]} lead={!tie && (l.vals[1] ?? -1) >= best} />
            </div>
          ) : (
            <div key={l.label} className="border-b border-line py-1.5 last:border-0">
              <div className="mb-1 flex items-baseline gap-2">
                <span className="text-[12px] font-semibold text-ink">{l.label}</span>
                <span className="text-[10px] text-ink-3">{l.note}</span>
              </div>
              <div className="grid gap-1">
                {rows.map((r, i) => (
                  <div key={r.name} className="grid grid-cols-[64px_1fr_34px] items-center gap-2">
                    <span className="truncate text-[11px] text-ink-2">{r.name}</span>
                    <Track v={l.vals[i]} colour={r.colour} lead={!tie && (l.vals[i] ?? -1) >= best} />
                    <Val v={l.vals[i]} lead={!tie && (l.vals[i] ?? -1) >= best} />
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </Panel>
  )
}

function Val({ v, lead }: { v: number | null; lead: boolean }) {
  return (
    <span className={`font-num text-center text-[13px] tabular-nums ${lead ? 'font-bold text-ink' : 'text-ink-3'}`}>
      {v == null ? '—' : v}
    </span>
  )
}

/* `flip` right-aligns the fill so the two sides grow away from the label in
   the middle. Without it the left-hand bars would start at the far edge and
   the shape of a difference would be unreadable at a glance, which is the only
   thing this chart is for. */
function Track({ v, colour, lead, flip }: { v: number | null; colour: string; lead: boolean; flip?: boolean }) {
  return (
    <span className={`flex h-2 overflow-hidden rounded-full bg-surface-3 ${flip ? 'justify-end' : ''}`}>
      <span
        className="block h-full rounded-full"
        style={{ width: `${v ?? 0}%`, background: colour, opacity: lead ? 1 : 0.42 }}
      />
    </span>
  )
}

// ── horizon, across every plan ──────────────────────────────────────────────

/* Squad Lab runs this for one squad. Across two it is the panel most likely to
   change a decision, because a projection total cannot show it: a plan can be
   ahead over six weeks and still walk most of its fifteen into a wall in the
   seventh. */
function Horizon({ rows, gws, fixtureEase }: { rows: Row[]; gws: number[]; fixtureEase: FixtureEaseRow[] }) {
  const hard = useMemo(() => {
    const byTeamGw = new Map<string, number>()
    for (const f of fixtureEase) byTeamGw.set(`${f.team}|${f.gw}`, f.fdr)
    return rows.map((r) =>
      gws.map((gw) => r.series.filter((p) => (byTeamGw.get(`${p.team}|${gw}`) ?? 3) >= 4).length),
    )
  }, [rows, gws, fixtureEase])

  const worst = hard.map((h) => {
    const m = Math.max(...h)
    return { n: m, gw: gws[h.indexOf(m)] }
  })
  const calmest = worst.reduce((a, b, i) => (b.n < worst[a].n ? i : a), 0)
  const spread = Math.max(...worst.map((w) => w.n)) - Math.min(...worst.map((w) => w.n))

  /* When the peaks tie, the interesting difference is usually WHEN the hard
     weeks land rather than how many there are. Split the window in half and
     compare, so two plans with the same worst week are not written off as
     identical when one front-loads its trouble and the other back-loads it. */
  const half = Math.ceil(gws.length / 2)
  const sums = hard.map((h) => ({
    early: h.slice(0, half).reduce((a, b) => a + b, 0),
    late: h.slice(half).reduce((a, b) => a + b, 0),
  }))
  const shift = (() => {
    if (rows.length !== 2) return null
    const dEarly = sums[0].early - sums[1].early
    const dLate = sums[0].late - sums[1].late
    // Only worth saying when the two halves genuinely point opposite ways.
    if (Math.sign(dEarly) === Math.sign(dLate) || Math.abs(dEarly) < 2) return null
    const e = dEarly > 0 ? 0 : 1
    const l = dLate > 0 ? 0 : 1
    return {
      early: { name: rows[e].name, a: sums[e].early, b: sums[1 - e].early },
      late: { name: rows[l].name, a: sums[l].late, b: sums[1 - l].late },
    }
  })()

  return (
    <Panel
      title="The horizon, plan by plan"
      kicker="How many of each fifteen walk into a fixture rated 4 or 5, week by week. Not a projection — a count of hard games, which is the thing a total hides."
      note={
        spread >= 2 ? (
          <>
            <b>{rows[calmest].name} has the calmer run</b>: its worst week puts {worst[calmest].n} of
            fifteen in a hard game, against {Math.max(...worst.map((w) => w.n))} for the roughest plan
            here. A squad that projects a point or two better over the window and then hits a wall
            inside it is not obviously the better plan, and this is the only panel that says so.
          </>
        ) : shift ? (
          <>
            The peaks are level, but they <b>arrive at different times</b>: {shift.early.name} takes the
            harder first half ({shift.early.a} hard games against {shift.early.b}) and{' '}
            {shift.late.name} the harder back end ({shift.late.a} against {shift.late.b}). That is a
            timing difference rather than a quality one — it decides when you need a free transfer
            spare, not which fifteen is better.
          </>
        ) : (
          <>Every plan here peaks within a game or two of the others and the hard weeks land in the
            same places, so the horizon is not what separates them — the decision is back with the
            projection and the players.</>
        )
      }
    >
      <div className="overflow-x-auto">
        <div className="min-w-[520px]">
          {rows.map((r, i) => (
            <div key={r.name} className="mb-1.5 grid items-center gap-1.5" style={{ gridTemplateColumns: `88px repeat(${gws.length}, minmax(0,1fr))` }}>
              <span className="flex items-center gap-1.5 truncate text-[11.5px] font-semibold text-ink-2">
                <span className="size-2 shrink-0 rounded-[2px]" style={{ background: r.colour }} />
                {r.name}
              </span>
              {hard[i].map((n, j) => (
                <span
                  key={gws[j]}
                  title={`GW${gws[j]} — ${n} of 15 in a fixture rated 4 or 5`}
                  className={`rounded-lg border py-1.5 text-center ${
                    n >= 6 ? 'border-bad/50' : n >= 4 ? 'border-warn/45' : n <= 2 ? 'border-good/40' : 'border-line'
                  }`}
                >
                  <b className={`font-num block text-[15px] font-extrabold tabular-nums ${
                    n >= 6 ? 'text-bad' : n >= 4 ? 'text-warn' : n <= 2 ? 'text-good' : 'text-ink'
                  }`}>{n}</b>
                  <span className="block text-[9px] text-ink-3">GW{gws[j]}</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  )
}

// ── the ledger ──────────────────────────────────────────────────────────────

/* Two plans, the players they share cancelled off, and what is left priced.
   Pairing is within position and by price, because a table that lines a
   midfielder up against a forward and prints a difference between them is
   inventing a decision nobody is making. When the positions do not match the
   row is left half-empty and says so, rather than being padded. */
function Ledger({ rows }: { rows: Row[] }) {
  const [a, b] = rows
  const setA = new Set(a.series.map((p) => p.element))
  const setB = new Set(b.series.map((p) => p.element))
  const onlyA = a.series.filter((p) => !setB.has(p.element))
  const onlyB = b.series.filter((p) => !setA.has(p.element))
  if (!onlyA.length && !onlyB.length) return null

  const pairs: { a: PlayerSeries | null; b: PlayerSeries | null }[] = []
  for (const pos of ['GKP', 'DEF', 'MID', 'FWD']) {
    const la = onlyA.filter((p) => p.pos === pos).sort((x, y) => y.price - x.price)
    const lb = onlyB.filter((p) => p.pos === pos).sort((x, y) => y.price - x.price)
    for (let i = 0; i < Math.max(la.length, lb.length); i++) pairs.push({ a: la[i] ?? null, b: lb[i] ?? null })
  }
  const biggest = pairs.reduce<{ d: number; a: PlayerSeries | null; b: PlayerSeries | null }>(
    (best, p) => {
      const d = (p.a?.total ?? 0) - (p.b?.total ?? 0)
      return Math.abs(d) > Math.abs(best.d) ? { d, ...p } : best
    },
    { d: 0, a: null, b: null },
  )
  const wins = pairs.filter((p) => (p.a?.total ?? 0) > (p.b?.total ?? 0)).length

  return (
    <Panel
      title="The swaps, priced"
      kicker={`The ${15 - onlyA.length} players both plans hold cancel exactly. What is left is ${pairs.length} decisions, each worth the points in the middle column across these weeks.`}
      note={
        biggest.a || biggest.b ? (
          <>
            {a.name} takes {wins} of the {pairs.length} rows.{' '}
            <b>
              The largest single swing is {biggest.d >= 0 ? biggest.a?.row.web_name : biggest.b?.row.web_name}, worth{' '}
              {Math.abs(biggest.d).toFixed(1)} points
            </b>{' '}
            over the window — which is worth checking against the row count, because one player can
            carry a plan that loses most of its individual arguments.
          </>
        ) : null
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-[10px] tracking-[0.09em] text-ink-3 uppercase">
              <th className="py-1.5 pr-2 text-left font-semibold">Only in {a.name}</th>
              <th className="px-2 py-1.5 text-right font-semibold">xP</th>
              <th className="px-2 py-1.5 text-center font-semibold">Δ</th>
              <th className="px-2 py-1.5 text-left font-semibold">xP</th>
              <th className="py-1.5 pl-2 text-right font-semibold">Only in {b.name}</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p, i) => {
              const d = (p.a?.total ?? 0) - (p.b?.total ?? 0)
              const both = p.a && p.b
              return (
                <tr key={i} className="border-b border-line last:border-0">
                  <td className="py-2 pr-2">{p.a ? <Who p={p.a} /> : <span className="text-[12px] text-ink-3">—</span>}</td>
                  <td className="font-num px-2 py-2 text-right tabular-nums text-ink-2">{p.a ? p.a.total.toFixed(1) : '—'}</td>
                  <td className={`font-num px-2 py-2 text-center font-bold tabular-nums ${
                    !both ? 'text-ink-3' : d > 0 ? 'text-accent-2' : d < 0 ? 'text-info' : 'text-ink-3'
                  }`}>
                    {both ? `${d > 0 ? '+' : ''}${d.toFixed(1)}` : '·'}
                  </td>
                  <td className="font-num px-2 py-2 tabular-nums text-ink-2">{p.b ? p.b.total.toFixed(1) : '—'}</td>
                  <td className="py-2 pl-2 text-right">{p.b ? <Who p={p.b} right /> : <span className="text-[12px] text-ink-3">—</span>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function Who({ p, right }: { p: PlayerSeries; right?: boolean }) {
  return (
    <span className={`block ${right ? 'text-right' : ''}`}>
      <span className="block text-[12.5px] font-semibold text-ink">{String(p.row.web_name ?? '—')}</span>
      <span className="block text-[10px] text-ink-3">{p.pos} · {p.team} · £{p.price.toFixed(1)}</span>
    </span>
  )
}

// ── club concentration ──────────────────────────────────────────────────────

/* Three players from one club is the FPL maximum, and it is also a single
   point of failure: one postponement, one early red, one manager resting a
   back line, and a fifth of your outfield moves together. The projection
   already prices each of those players; it cannot price the fact that their
   outcomes are correlated, so this is shown separately rather than folded into
   a number. */
function ClubRisk({ rows }: { rows: Row[] }) {
  const stacks = rows.map((r) => {
    const c = new Map<string, number>()
    for (const p of r.series) c.set(p.team, (c.get(p.team) ?? 0) + 1)
    return [...c.entries()].filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1])
  })
  const maxed = stacks.map((s) => s.filter(([, n]) => n >= 3).length)
  const doubled = stacks.map((s) => s.length)
  const peak = Math.max(...maxed)
  const atPeak = rows.filter((_, i) => maxed[i] === peak)
  const tightest = maxed.indexOf(peak)

  return (
    <Panel
      title="Club concentration"
      kicker="Every club you hold two or more of. Three is the FPL limit, and the point at which one fixture decides a chunk of your week."
      note={
        Math.max(...maxed) > 0 ? (
          <>
            {atPeak.length === rows.length ? (
              <><b>Every plan here is maxed out</b> on {peak} {peak === 1 ? 'club' : 'clubs'}</>
            ) : (
              <><b>{rows[tightest].name} is the most concentrated</b>, maxed out on {peak}{' '}
                {peak === 1 ? 'club' : 'clubs'}</>
            )}. That is not a mistake — it is
            usually where the value is — but it is a correlation the projection cannot see: those
            players share a fixture, a manager and a postponement, so their good weeks and their bad
            weeks arrive together.
          </>
        ) : (
          <>No plan here holds three of anyone, so every squad is spread across at least{' '}
            {15 - Math.max(...doubled)} clubs. Nothing to flag.</>
        )
      }
    >
      <div className="grid gap-2.5 sm:grid-cols-2">
        {rows.map((r, i) => (
          <div key={r.name} className="rounded-xl border border-line bg-surface-2/40 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold tracking-[0.11em] text-ink-3 uppercase">
              <span className="size-2 rounded-[2px]" style={{ background: r.colour }} />
              {r.name}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {stacks[i].length ? stacks[i].map(([team, n]) => (
                <span
                  key={team}
                  className={`rounded-full border px-2.5 py-1 text-[11.5px] font-medium ${
                    n >= 3 ? 'border-warn/50 text-warn' : 'border-line text-ink-2'
                  }`}
                >
                  {team} ×{n}
                </span>
              )) : <span className="text-[12.5px] text-ink-3">Never more than one from a club.</span>}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  )
}
