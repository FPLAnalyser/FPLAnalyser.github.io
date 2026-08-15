import { Fragment, useMemo, useState } from 'react'
import { Panel } from './SquadShape'
import { Tabs } from './Tabs'
import { TeamBadge } from './badges'
import { Pitch, PitchCard, CARD_W } from './Pitch'
import { buildRoute, readState, buildLog, crossover, cumulative, converges, type RouteWeek, type LogRow } from '../lib/planRoutes'
import { CHIP_LABEL } from '../lib/planner'
import { xpForGw } from '../lib/xp'
import { FixtureNames } from './FixtureChips'
import { squadDimensions, type Dimension } from './SquadVerdict'
import { num } from '../lib/rows'
import {
  buildSeries, comparePlans, spreadOf, type Engine, type PlayerSeries,
} from '../lib/squadInsights'
import type { StoredPlan } from '../lib/plans'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   Comparing plans.

   THE SQUADS FIRST, THEN THE CALL. The page used to open on a verdict, a
   radar and a chart, and you scrolled past all three before seeing the two
   things being compared. Nobody reads a judgement about two squads before
   they have looked at the squads. So: both fifteens side by side with what
   each projects, then the verdict, then the swap that separates them, then
   the working — week by week, the two halves of the window, what each is
   built on, club risk, armbands.

   Each plan is compared AS A FIFTEEN with the best legal eleven picked each
   week, not as a transfer path. That is the honest scope: a stored plan's
   week decisions are its own, but comparing two different transfer paths
   over six weeks compounds two sets of assumptions and the result stops
   being about the squads.
   ════════════════════════════════════════════════════════════════════════ */

const COLOURS = ['var(--accent)', 'var(--info)', 'var(--good)', 'var(--hot)']
const DIM_KEYS = ['attack', 'defence', 'defcon', 'fixtures'] as const
const DIM_LABELS = ['Attack', 'Defence', 'Def Con', 'Fixtures']

export interface ComparePlan {
  plan: StoredPlan
  squad: RatingRow[]
  /** Moves spent after the opening week. Breaks a tie on points. */
  transfers?: number
}

export function SquadCompare({ plans, gws, engine, draws = 4000, onEdit }: {
  plans: ComparePlan[]
  gws: number[]
  engine: Engine
  draws?: number
  /** Open a plan on the board. Reading a comparison and acting on it were two
   *  pages with no door between them. */
  onEdit?: (planId: string) => void
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

  /* THE HORIZON IS A CONTROL. Six weeks was a house assumption and it decided
     the answer: a plan that pays a hit in GW2 loses at four weeks and wins at
     ten, and the page only ever showed one of those. */
  const [tab, setTab] = useState('answer')
  const [range, setRange] = useState<{ from: number; to: number } | null>(null)
  const bounds = { first: gws[0] ?? 1, last: gws[gws.length - 1] ?? 1 }
  const from = Math.max(bounds.first, Math.min(range?.from ?? bounds.first, bounds.last))
  const to = Math.max(from, Math.min(range?.to ?? gws[Math.min(5, gws.length - 1)] ?? bounds.last, bounds.last))
  const weeks = useMemo(() => gws.filter((g) => g >= from && g <= to), [gws, from, to])
  const byEl = useMemo(() => {
    const m = new Map<number, RatingRow>()
    for (const p of plans) for (const r of p.squad) { const el = num(r, 'element'); if (el != null) m.set(el, r) }
    return m
  }, [plans])
  const nameOf = (el: number) => String(byEl.get(el)?.web_name ?? '—')

  /* Both routes, walked. Keyed on the plan ids and the window: the weeks come
     out of localStorage, which React cannot see change, so the compare view is
     built when you enter it and rebuilt when you change the horizon. */
  const pair = useMemo(() => {
    const two = plans.filter((p) => p.squad.length === 15).slice(0, 2)
    if (two.length !== 2 || plans.length !== 2 || !weeks.length) return null
    const ctx = { byEl, fixtureEase, avail, model, market, profiles }
    const routes = two.map((p) => {
      const base = p.squad.map((r) => num(r, 'element') ?? -1)
      return buildRoute(readState(p.plan.id, base, weeks[0]), weeks, ctx)
    }) as [RouteWeek[], RouteWeek[]]
    return {
      names: [two[0].plan.name, two[1].plan.name] as [string, string],
      colours: [COLOURS[0], COLOURS[1]] as [string, string],
      routes,
      log: buildLog(routes[0], routes[1]),
      ids: [two[0].plan.id, two[1].plan.id] as [string, string],
      convergeAt: converges(routes[0], routes[1]),
      xpOver: (el: number) => {
        const r = byEl.get(el)
        if (!r) return 0
        return weeks.reduce((a, g) => a + (xpForGw(r, g, fixtureEase, avail, model, market, profiles) ?? 0), 0)
      },
      gws: weeks,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, weeks.join(','), byEl, fixtureEase, avail, model, market, profiles])

  const complete = plans.filter((p) => p.squad.length === 15)
  if (complete.length < 2) {
    return (
      <Panel title="Compare Plans" kicker="Two plans of fifteen are needed before there is anything to compare.">
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
      transfers: p.transfers ?? 0,
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

  return (
    /* THE SQUADS FIRST. The page opened on a verdict, then a radar, then a
       chart, and you had to scroll past all three before seeing the two
       things being compared. Nobody reads a judgement about two squads
       before they have looked at the squads. Boards at the top with what
       each is projected to score, then the call, then the working.

       [&>*]:min-w-0 because every panel here is a grid item, and a grid
       item's automatic minimum is its MIN-CONTENT: one panel holding a pitch
       set the width of the whole page and pushed a phone 134px into a
       horizontal scroll. */
    <div className="grid gap-4 [&>*]:min-w-0">
      {pair ? (
        <>
          {/* THE WINDOW IS NOT PART OF A TAB. It changes every number on every
              tab, so it sits above them — moving it must not mean going back
              to the tab that happens to own it. */}
          <Frame
            names={pair.names} colours={pair.colours} routes={pair.routes} gws={pair.gws}
            all={gws} from={from} to={to}
            onRange={(f, t) => setRange({ from: f, to: t })}
            onEdit={onEdit ? (side) => onEdit(pair.ids[side]) : undefined}
          />
          <Tabs
            tabs={[
              { id: 'answer', label: 'The answer' },
              { id: 'weeks', label: 'Week by week' },
              { id: 'squad', label: 'Squads' },
              { id: 'fixtures', label: 'Fixtures' },
            ]}
            active={tab}
            onChange={setTab}
            layoutId="compare-tab"
          />
          {tab === 'answer' && (
            <Crossover names={pair.names} colours={pair.colours} routes={pair.routes} />
          )}
          {tab === 'weeks' && (
            <>
              <Divergence names={pair.names} colours={pair.colours} log={pair.log} nameOf={nameOf} convergeAt={pair.convergeAt} />
              <Timelines names={pair.names} colours={pair.colours} routes={pair.routes} nameOf={nameOf} />
            </>
          )}
          {tab === 'squad' && (
            <>
              <SquadDiff
                names={pair.names} colours={pair.colours} routes={pair.routes} byEl={byEl}
                xpOver={pair.xpOver} weeks={pair.gws.length}
                boards={<Lineups rows={rows} gw={pair.gws[0]} fixtureEase={fixtureEase} />}
              />
              <Dimensions rows={rows} />
            </>
          )}
          {tab === 'fixtures' && (
            <FixtureGap
              names={pair.names} colours={pair.colours} routes={pair.routes}
              fixtureEase={fixtureEase} byEl={byEl}
            />
          )}
        </>
      ) : (
        /* Three and four plans have no "the two routes" to draw, and pairing
           every combination is a matrix nobody reads. The panels that were
           always about a SET of plans carry on doing that job. */
        <>
          <Verdict rows={rows} />
          <SharedAndDifferent rows={rows} />
          <WeekByWeek rows={rows} gws={gws} />
          <Horizon rows={rows} gws={gws} fixtureEase={fixtureEase} />
          <Dimensions rows={rows} />
          <ClubRisk rows={rows} />
          <Armbands rows={rows} gws={gws} />
        </>
      )}
    </div>
  )
}

type Row = ReturnType<typeof buildRows>[number]
// Only here to give the sub-components a name for the row shape.
function buildRows() {
  return [] as {
    name: string; colour: string; spend: number; projection: number; owned: number
    rating: number | null; dims: Dimension[]; transfers: number
    spread: { p10: number; median: number; p90: number; mean: number }
    weeks: { xp: number; captain: number | null; xi: PlayerSeries[]; form: string }[]
    series: PlayerSeries[]
  }[]
}



/* ════════════════════════════════════════════════════════════════════════
   COMPARING TWO ROUTES, NOT TWO FIFTEENS.

   Everything below reads off lib/planRoutes: each plan walked week by week,
   with the squad it holds, the eleven it fields, the armband, the chip and
   what it paid. The old panels compared two squads as they stood in the
   opening week and reported the rest as a projection of the best legal
   eleven — which cannot see a transfer taken early, a hit paid for it, or a
   different captain, and those are what separate two plans.
   ════════════════════════════════════════════════════════════════════════ */

/** 1 · The frame. Horizon is a control, and the winner can change with it. */
function Frame({ names, colours, routes, gws, all, from, to, onRange, onEdit }: {
  names: [string, string]
  colours: [string, string]
  routes: [RouteWeek[], RouteWeek[]]
  gws: number[]
  /** Every week the plans could be compared over. */
  all: number[]
  from: number
  to: number
  onRange: (from: number, to: number) => void
  onEdit?: (side: 0 | 1) => void
}) {
  const tot = (r: RouteWeek[]) => r.reduce((a, w) => a + w.xp, 0)
  const [ta, tb] = [tot(routes[0]), tot(routes[1])]
  const lead = Math.abs(ta - tb) < 0.05 ? null : ta > tb ? 0 : 1
  const gap = Math.abs(ta - tb)
  const hits: [number, number] = [
    routes[0].reduce((a, w) => a + w.hit, 0),
    routes[1].reduce((a, w) => a + w.hit, 0),
  ]
  /* THE FLIP IS THE POINT. A six-week window is a house assumption and it
     decides the answer, so the shorter windows are computed too and the
     sentence says where the verdict changes hands. "Plan 2 is better" and
     "Plan 2 is better if you hold it past GW4" are different claims and only
     the second is actionable. */
  /* Does the verdict change inside the window? Walk it week by week and find
     the last week the OTHER plan was ahead — that is the week this decision
     has to survive, and it is the sentence worth printing. */
  const flip = (() => {
    if (lead == null) return null
    let cum = 0
    let last: { n: number; side: 0 | 1 } | null = null
    for (let i = 0; i < routes[0].length - 1; i++) {
      cum += routes[1][i].xp - routes[0][i].xp
      const side: 0 | 1 | null = Math.abs(cum) < 0.05 ? null : cum > 0 ? 1 : 0
      if (side != null && side !== lead) last = { n: i + 1, side }
    }
    return last
  })()

  return (
    <Panel
      title="The call"
      kicker={`Projected points over ${routes[0].length} ${routes[0].length === 1 ? 'week' : 'weeks'} from GW${gws[0]}, with each plan's own transfers, captains and chips — and its hits taken off.`}
    >
      {/* START AND END, NOT A LIST OF WINDOWS. Five preset horizons were five
          opinions about what a sensible window is; the reader's question is
          usually bounded by something specific — a wildcard, a double, the
          week a man is back — and only they know where it starts and ends. */}
      <div className="mb-3.5 rounded-xl border border-line bg-surface-2/30 px-3 py-2.5">
        <div className="mb-2 flex flex-wrap items-baseline gap-x-2.5">
          <span className="text-[10px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">Window</span>
          <span className="font-num text-[14px] font-extrabold tabular-nums text-accent">GW{from} → GW{to}</span>
          <span className="text-[12px] text-ink-3">{gws.length} {gws.length === 1 ? 'week' : 'weeks'}</span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {([['Start', from, (v: number) => onRange(v, Math.max(v, to))],
             ['End', to, (v: number) => onRange(Math.min(from, v), v)]] as const).map(([label, val, set]) => (
            <label key={label} className="flex items-center gap-2.5 rounded-lg border border-line-subtle bg-bg-0/40 px-2.5 py-1.5">
              <span className="w-9 shrink-0 text-[11px] font-semibold text-ink-2">{label}</span>
              <input
                type="range"
                min={all[0]} max={all[all.length - 1]} step={1} value={val}
                onChange={(e) => set(Number(e.target.value))}
                className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-surface-3 accent-accent"
              />
              <span className="font-num w-11 shrink-0 text-right text-[12px] font-bold tabular-nums text-ink">GW{val}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-x-7 gap-y-3">
        {[0, 1].map((i) => (
          <div key={i}>
            <div className="flex items-center gap-2 text-[11px] font-extrabold tracking-[0.1em] text-ink-3 uppercase">
              <span className="size-2.5 rounded-[3px]" style={{ background: colours[i] }} />
              <span className="max-w-[22ch] truncate">{names[i]}</span>
            </div>
            <div className="font-display mt-1 text-[38px] leading-none tabular-nums" style={{ color: colours[i] }}>
              {(i === 0 ? ta : tb).toFixed(1)}
            </div>
            {hits[i] > 0 && (
              <div className="font-num mt-1 text-[11px] font-bold text-bad tabular-nums">−{hits[i]} in hits, already taken off</div>
            )}
          </div>
        ))}
        <p className="min-w-[240px] flex-1 pb-1 text-[13.5px] leading-snug text-ink-2">
          {lead == null
            ? <>The two routes are <b>level</b> over {routes[0].length} weeks.</>
            : <><b style={{ color: colours[lead] }}>{names[lead]} by {gap.toFixed(1)}</b> over {routes[0].length}{hits[lead] > 0 ? <> — after paying {hits[lead]} in hits</> : null}.</>}
          {flip && (
            <> It was <b style={{ color: colours[flip.side] }}>{names[flip.side]}</b> as late as GW{gws[flip.n - 1]},
              so this is a decision you have to <b>hold past GW{gws[flip.n - 1]}</b> for.</>
          )}
        </p>
        {onEdit && (
          <div className="flex w-full flex-wrap gap-2 pt-1">
            {/* BACK TO THE BOARD. Reading a comparison and acting on it were two
                different pages with no door between them. */}
            {[0, 1].map((i) => (
              <button
                key={i}
                onClick={() => onEdit(i as 0 | 1)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line-mid px-3 text-[12.5px] font-semibold text-ink-2 transition-colors hover:border-accent hover:text-accent"
              >
                <span className="size-2 rounded-[2px]" style={{ background: colours[i] }} />
                Edit {names[i]} on the board
              </button>
            ))}
          </div>
        )}
      </div>
    </Panel>
  )
}

/** 2 · The crossover: cumulative DIFFERENCE, not two cumulative totals. */
function Crossover({ names, colours, routes }: {
  names: [string, string]; colours: [string, string]; routes: [RouteWeek[], RouteWeek[]]
}) {
  const cum = cumulative(routes[0], routes[1])
  if (cum.length < 2) return null
  const cross = crossover(routes[0], routes[1])
  const span = Math.max(2, ...cum.map((v) => Math.abs(v))) * 1.15
  const W = 900, H = 220, L = 44, R = 18, T = 16, B = 30
  const x = (i: number) => L + (i / Math.max(cum.length - 1, 1)) * (W - L - R)
  const y = (v: number) => T + ((span - v) / (span * 2)) * (H - T - B)
  const line = cum.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  const last = cum[cum.length - 1]

  return (
    <Panel
      title="Where the lead changes hands"
      kicker="The running difference between the two routes, week by week. Above the line the second plan is ahead; below it, the first."
      note={<>Two cumulative totals both climb to three hundred-odd points and sit on top of each other — a five-point
        gap on that axis is invisible. Plotting the difference spends the whole axis on the only quantity you are
        choosing between, and makes the week the lead turns an event on the page rather than something you work out
        by subtracting two labels.</>}
    >
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full min-w-[520px]" role="img" aria-label="Running difference by gameweek">
          <defs>
            <linearGradient id="cmp-up" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colours[1]} stopOpacity="0.34" /><stop offset="100%" stopColor={colours[1]} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="cmp-dn" x1="0" y1="1" x2="0" y2="0">
              <stop offset="0%" stopColor={colours[0]} stopOpacity="0.34" /><stop offset="100%" stopColor={colours[0]} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={`M${x(0)},${y(0)} ${cum.map((v, i) => `L${x(i)},${y(Math.max(v, 0))}`).join(' ')} L${x(cum.length - 1)},${y(0)} Z`} fill="url(#cmp-up)" />
          <path d={`M${x(0)},${y(0)} ${cum.map((v, i) => `L${x(i)},${y(Math.min(v, 0))}`).join(' ')} L${x(cum.length - 1)},${y(0)} Z`} fill="url(#cmp-dn)" />
          <line x1={L} y1={y(0)} x2={W - R} y2={y(0)} stroke="var(--line-strong)" strokeWidth="1.5" />
          <text x={L - 8} y={y(0) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">0</text>
          <text x={L - 8} y={y(span * 0.75) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">+{(span * 0.75).toFixed(0)}</text>
          <text x={L - 8} y={y(-span * 0.75) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">−{(span * 0.75).toFixed(0)}</text>
          {routes[0].map((w, i) => {
            const h = Math.max(w.hit, routes[1][i]?.hit ?? 0)
            if (!h) return null
            return (
              <g key={`h${i}`}>
                <line x1={x(i)} y1={y(cum[i])} x2={x(i)} y2={y(0)} stroke="var(--bad)" strokeWidth="1.5" strokeDasharray="3 3" />
                <text x={x(i) + 7} y={y(cum[i]) + (cum[i] < 0 ? 16 : -8)} fontSize="12" fontWeight="700" fill="var(--bad)">−{h} hit</text>
              </g>
            )
          })}
          {cross && (() => {
            const i = routes[0].findIndex((w) => w.gw === cross.gw)
            return (
              <g>
                <line x1={x(i) - (x(1) - x(0)) / 2} y1={T} x2={x(i) - (x(1) - x(0)) / 2} y2={H - B} stroke="var(--good)" strokeWidth="1.5" strokeDasharray="4 4" />
                <text x={x(i) - (x(1) - x(0)) / 2 + 8} y={T + 14} fontSize="12.5" fontWeight="800" fill="var(--good)">
                  {names[cross.to === 'a' ? 0 : 1]} goes ahead here
                </text>
                <text x={x(i) - (x(1) - x(0)) / 2 + 8} y={T + 31} fontSize="11.5" fill="var(--ink-2)">
                  GW{routes[0][Math.max(i - 1, 0)].gw} → GW{cross.gw}
                </text>
              </g>
            )
          })()}
          <polyline points={line} fill="none" stroke="var(--ink-1)" strokeWidth="2.5" strokeLinejoin="round" />
          {cum.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill="var(--ink-1)" />)}
          {routes[0].map((w, i) => (
            <text key={w.gw} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11.5" fill="var(--ink-2)">GW{w.gw}</text>
          ))}
          <text x={W - R} y={y(last) - 10} textAnchor="end" fontSize="13" fontWeight="800" fill={last >= 0 ? colours[1] : colours[0]}>
            {last >= 0 ? '+' : '−'}{Math.abs(last).toFixed(1)}
          </text>
        </svg>
      </div>
      {!cross && (
        <p className="mt-1 text-[12.5px] text-ink-2">
          The lead never changes hands over these {cum.length} weeks — whoever is ahead in the first week is ahead in the last.
        </p>
      )}
    </Panel>
  )
}

/** How hard each route's weeks actually are. A points gap with no fixture
 *  context reads as "these players are better"; often it is "these players
 *  have an easier month", which is a different and much more perishable
 *  claim. */
function FixtureGap({ names, colours, routes, fixtureEase, byEl }: {
  names: [string, string]; colours: [string, string]; routes: [RouteWeek[], RouteWeek[]]
  fixtureEase: FixtureEaseRow[]; byEl: Map<number, RatingRow>
}) {
  const byTeamGw = useMemo(() => {
    const m = new Map<string, FixtureEaseRow[]>()
    for (const f of fixtureEase) {
      const k = `${f.team}:${f.gw}`
      const at = m.get(k)
      if (at) at.push(f); else m.set(k, [f])
    }
    return m
  }, [fixtureEase])

  /** Mean difficulty of the ELEVEN's fixtures, because the bench does not
   *  play — and a blank counts as a 5, which is what it is worth. */
  const week = (w: RouteWeek) => {
    let sum = 0
    let hard = 0
    let blanks = 0
    for (const el of w.xi) {
      const team = String(byEl.get(el)?.team ?? '')
      const fs = byTeamGw.get(`${team}:${w.gw}`) ?? []
      const fdr = fs.length ? Math.min(...fs.map((f) => f.fdr)) : 5
      if (!fs.length) blanks += 1
      if (fdr >= 4) hard += 1
      sum += fdr
    }
    return { mean: sum / Math.max(w.xi.length, 1), hard, blanks }
  }
  const cells = routes.map((r) => r.map(week)) as [ReturnType<typeof week>[], ReturnType<typeof week>[]]
  const avg = cells.map((c) => c.reduce((a, x) => a + x.mean, 0) / Math.max(c.length, 1))
  const hardTotal = cells.map((c) => c.reduce((a, x) => a + x.hard, 0))
  const gap = avg[1] - avg[0]
  const gws = routes[0].map((w) => w.gw)
  const cols = `minmax(0,10rem) repeat(${gws.length}, minmax(3.2rem,1fr)) 4.5rem`
  const ink = (v: number) => (v <= 2.2 ? 'text-[#3ddb84]' : v <= 2.8 ? 'text-[#8fe0ad]' : v <= 3.4 ? 'text-ink-2' : v <= 4 ? 'text-[#f0998a]' : 'text-[#f26a60]')

  return (
    <Panel
      title="How hard the weeks are"
      kicker="Mean fixture difficulty of the eleven each plan puts out, week by week. A blank counts as a 5, because that is what it is worth."
      note={<>A points gap with no fixture context reads as "these are better players". Often it is "these players
        have an easier month" — the same number, a much shorter shelf life. If one route is ahead on points AND on
        difficulty, it is winning on the schedule rather than on the squad, and the schedule turns.</>}
    >
      <div className="overflow-x-auto">
        <div className="grid min-w-max gap-[3px]" style={{ gridTemplateColumns: cols }}>
          <span />
          {gws.map((g) => (
            <span key={g} className="pb-1 text-center text-[9.5px] font-extrabold tracking-[0.08em] text-ink-3 uppercase">GW{g}</span>
          ))}
          <span className="pb-1 text-right text-[9.5px] font-extrabold tracking-[0.08em] text-ink-3 uppercase">Mean</span>

          {[0, 1].map((side) => (
            <Fragment key={side}>
              <span className="flex min-w-0 items-center gap-2 pr-2 text-[12.5px] font-semibold text-ink">
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: colours[side] }} />
                <span className="truncate">{names[side]}</span>
              </span>
              {cells[side].map((c, i) => (
                <span
                  key={gws[i]}
                  title={`GW${gws[i]} — ${c.hard} of the eleven in a game rated 4 or 5${c.blanks ? `, ${c.blanks} blank` : ''}`}
                  className={`flex flex-col items-center justify-center rounded-md border border-line bg-surface-2/40 py-1 ${ink(c.mean)}`}
                >
                  <span className="font-num text-[13px] font-extrabold tabular-nums">{c.mean.toFixed(1)}</span>
                  {c.hard > 0 && <span className="text-[9px] font-bold text-ink-3">{c.hard} hard</span>}
                </span>
              ))}
              <span className={`font-num flex items-center justify-end text-[15px] font-extrabold tabular-nums ${ink(avg[side])}`}>
                {avg[side].toFixed(2)}
              </span>
            </Fragment>
          ))}

          <span className="pt-1 text-[11px] text-ink-3">Difference</span>
          {cells[0].map((c, i) => {
            const d = cells[1][i].mean - c.mean
            return (
              <span key={gws[i]} className="font-num pt-1 text-center text-[12px] font-bold tabular-nums"
                style={{ color: Math.abs(d) < 0.05 ? 'var(--ink-3)' : d < 0 ? colours[1] : colours[0] }}>
                {Math.abs(d) < 0.05 ? '—' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`}
              </span>
            )
          })}
          <span className="font-num pt-1 text-right text-[12px] font-extrabold tabular-nums text-ink-2">
            {gap >= 0 ? '+' : '−'}{Math.abs(gap).toFixed(2)}
          </span>
        </div>
      </div>
      <p className="mt-2.5 text-[13px] leading-snug text-ink-2">
        {Math.abs(gap) < 0.08
          ? <>The two routes walk into <b>the same schedule</b> — {hardTotal[0]} and {hardTotal[1]} hard games across the window. Whatever separates them, it is not the fixtures.</>
          : <><b style={{ color: gap < 0 ? colours[1] : colours[0] }}>{names[gap < 0 ? 1 : 0]}</b> has the kinder run
              by <b>{Math.abs(gap).toFixed(2)}</b> a week, and meets {Math.min(hardTotal[0], hardTotal[1])} games rated 4 or 5
              against {Math.max(hardTotal[0], hardTotal[1])}.</>}
      </p>
    </Panel>
  )
}

/** 3 · The divergence log: only the weeks where the plans actually differ. */
function Divergence({ names, colours, log, nameOf, convergeAt }: {
  names: [string, string]; colours: [string, string]; log: LogRow[]; nameOf: (el: number) => string
  convergeAt: number | null
}) {
  const diffs = log.filter((r) => r.kind === 'diff').length
  return (
    <Panel
      title="What actually separates them"
      kicker="One row per gameweek where the two plans do something different. Weeks in which they do the same thing are collapsed — printing them is how six identical weeks hide the two that matter."
      note={<>A plan is a route, so the difference between two plans is a list of decisions, not a gap between two
        squads. This is that list. Where the squads converge again, the gap stops moving and the rows say so.</>}
    >
      {convergeAt != null && (
        <p className="mb-2.5 rounded-lg border border-accent/45 bg-accent-soft px-3 py-2 text-[13px] text-ink">
          <b>Both plans hold the same fifteen from GW{convergeAt}.</b> Everything after that is the same squad,
          which makes this a question about <b>when</b> you move, not about which players you end up with.
        </p>
      )}
      {diffs === 0 ? (
        <p className="text-[13px] text-ink-2">
          These two plans make identical decisions in every week of the window — same fifteen, same eleven, same
          armband, same moves. There is nothing to choose between them here.
        </p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {log.map((r, i) => r.kind === 'quiet' ? (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-line-subtle bg-surface-2/25 px-3 py-2 text-[12.5px] text-ink-3">
              <span className="font-num w-12 shrink-0 font-bold tabular-nums">
                {r.from === r.to ? `GW${r.from}` : `${r.from}–${r.to}`}
              </span>
              <span className="flex-1">
                {r.same.onlyA.length || r.same.onlyB.length
                  ? <>No new decisions — the same difference carries ({r.same.onlyA.map(nameOf).join(', ') || '—'} against {r.same.onlyB.map(nameOf).join(', ') || '—'}), and the gap moves with the fixtures.</>
                  : <>Identical squads, identical elevens, identical armbands. Nothing separates the plans here.</>}
              </span>
              <span className="font-num shrink-0 tabular-nums">{r.cum >= 0 ? '+' : '−'}{Math.abs(r.cum).toFixed(1)}</span>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-3 rounded-lg border border-line bg-surface-2/40 px-3 py-2.5">
              <span className="font-num w-12 shrink-0 pt-0.5 text-[13px] font-extrabold tabular-nums text-ink">GW{r.d.gw}</span>
              <div className="min-w-0 flex-1 text-[13px] text-ink-2">
                {[0, 1].map((side) => {
                  const mv = side === 0 ? r.d.movesA : r.d.movesB
                  if (!mv.length) return null
                  return (
                    <div key={side} className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className="size-2 rounded-[2px]" style={{ background: colours[side] }} />
                      <b className="text-ink">{names[side]}</b>
                      {mv.map((m, k) => (
                        <span key={k} className="rounded border border-line-mid px-1.5 py-0.5 text-[11.5px]">
                          <span className="text-bad">{nameOf(m.out)}</span>
                          <span className="mx-1 text-ink-3">→</span>
                          <span className="text-good">{nameOf(m.in)}</span>
                        </span>
                      ))}
                      {r.d.hits[side] > 0 && (
                        <span className="rounded border border-bad/55 px-1.5 py-0.5 text-[11.5px] font-bold text-bad">−{r.d.hits[side]}</span>
                      )}
                    </div>
                  )
                })}
                {r.d.captains && (
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <b className="text-ink">Different armband</b>
                    {[0, 1].map((side) => (
                      <span key={side} className="rounded border border-accent/45 px-1.5 py-0.5 text-[11.5px] font-semibold text-accent-2">
                        <span className="mr-1 inline-block size-2 rounded-[2px] align-[-1px]" style={{ background: colours[side] }} />
                        {nameOf(r.d.captains![side] ?? -1)}
                      </span>
                    ))}
                  </div>
                )}
                {r.d.chips && (
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <b className="text-ink">Chip</b>
                    {[0, 1].map((side) => (
                      <span key={side} className="rounded border border-accent/45 px-1.5 py-0.5 text-[11.5px] font-semibold text-accent-2">
                        <span className="mr-1 inline-block size-2 rounded-[2px] align-[-1px]" style={{ background: colours[side] }} />
                        {r.d.chips![side] ? CHIP_LABEL[r.d.chips![side]!] : 'none'}
                      </span>
                    ))}
                  </div>
                )}
                {(r.d.onlyA.length > 0 || r.d.onlyB.length > 0) && (
                  <div className="text-[12px] text-ink-3">
                    Squads differ by {Math.max(r.d.onlyA.length, r.d.onlyB.length)}:{' '}
                    {r.d.onlyA.map(nameOf).join(', ') || '—'} <span className="text-ink-3">vs</span>{' '}
                    {r.d.onlyB.map(nameOf).join(', ') || '—'}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right">
                <div className="font-num text-[13px] font-bold tabular-nums" style={{ color: r.d.gap >= 0 ? colours[1] : colours[0] }}>
                  {r.d.gap >= 0 ? '+' : '−'}{Math.abs(r.d.gap).toFixed(1)}
                </div>
                <div className="font-num text-[11px] tabular-nums text-ink-3">{r.cum >= 0 ? '+' : '−'}{Math.abs(r.cum).toFixed(1)} running</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}

/** 4 · The two plans as two timelines — N plans by weeks, not one plan by
 *  fifteen players, which is what the Squad Builder's spine already is. */
function Timelines({ names, colours, routes, nameOf }: {
  names: [string, string]; colours: [string, string]; routes: [RouteWeek[], RouteWeek[]]; nameOf: (el: number) => string
}) {
  const gws = routes[0].map((w) => w.gw)
  const cols = `minmax(0,10rem) repeat(${gws.length}, minmax(3.6rem,1fr)) 4.5rem`
  const tot = (r: RouteWeek[]) => r.reduce((a, w) => a + w.xp, 0)

  return (
    <Panel
      title="The two routes, week by week"
      kicker="Each plan's own eleven, armband and moves — what it does, not what its best fifteen could do."
      note={<>Not the season spine in another place: that is one plan by fifteen players, this is one row per plan
        across the weeks. Two fifteens over ten weeks is three hundred cells and nobody reads it; what survives the
        compression is the week's total, the armband and the moves, which is the plan.</>}
    >
      <div className="overflow-x-auto">
        <div className="grid min-w-max gap-[3px]" style={{ gridTemplateColumns: cols }}>
          <span />
          {gws.map((g) => (
            <span key={g} className="pb-1 text-center text-[9.5px] font-extrabold tracking-[0.08em] text-ink-3 uppercase">GW{g}</span>
          ))}
          <span className="pb-1 text-right text-[9.5px] font-extrabold tracking-[0.08em] text-ink-3 uppercase">Total</span>

          {[0, 1].map((side) => (
            <Fragment key={side}>
              <span className="flex min-w-0 items-center gap-2 pr-2 text-[12.5px] font-semibold text-ink">
                <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: colours[side] }} />
                <span className="truncate">{names[side]}</span>
              </span>
              {routes[side].map((w) => (
                <span
                  key={w.gw}
                  title={`GW${w.gw} · ${w.gross.toFixed(1)} projected${w.hit ? `, −${w.hit} hit` : ''}${w.captain != null ? ` · captain ${nameOf(w.captain)}` : ''}`}
                  className="flex flex-col items-center justify-center rounded-md border border-line bg-surface-2/40 px-0.5 py-1"
                >
                  <span className="font-num text-[13px] font-extrabold tabular-nums text-ink">{w.xp.toFixed(1)}</span>
                  {w.captain != null && (
                    <span className="max-w-full truncate text-[9px] font-extrabold text-accent-2">C {nameOf(w.captain)}</span>
                  )}
                  <span className="flex gap-1">
                    {w.moves.length > 0 && (
                      <span className={`text-[9px] font-extrabold ${w.hit ? 'text-bad' : 'text-good'}`}>
                        {w.moves.length} in{w.hit ? ` −${w.hit}` : ''}
                      </span>
                    )}
                    {w.chip && <span className="text-[9px] font-extrabold text-accent">{CHIP_LABEL[w.chip]}</span>}
                  </span>
                </span>
              ))}
              <span className="font-display flex items-center justify-end text-[17px] tabular-nums" style={{ color: colours[side] }}>
                {tot(routes[side]).toFixed(1)}
              </span>
            </Fragment>
          ))}

          <span className="pt-1 text-[11px] text-ink-3">Difference</span>
          {routes[0].map((w, i) => {
            const d = (routes[1][i]?.xp ?? 0) - w.xp
            return (
              <span key={w.gw} className="font-num pt-1 text-center text-[12px] font-bold tabular-nums"
                style={{ color: Math.abs(d) < 0.05 ? 'var(--ink-3)' : d > 0 ? colours[1] : colours[0] }}>
                {Math.abs(d) < 0.05 ? '0.0' : `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}`}
              </span>
            )
          })}
          <span className="font-num pt-1 text-right text-[12px] font-extrabold tabular-nums"
            style={{ color: tot(routes[1]) >= tot(routes[0]) ? colours[1] : colours[0] }}>
            {tot(routes[1]) - tot(routes[0]) >= 0 ? '+' : '−'}{Math.abs(tot(routes[1]) - tot(routes[0])).toFixed(1)}
          </span>
        </div>
      </div>
    </Panel>
  )
}

/** 5 · The squads, collapsed to the difference. Both fifteens behind a click. */
function SquadDiff({ names, colours, routes, byEl, boards, xpOver, weeks }: {
  names: [string, string]; colours: [string, string]; routes: [RouteWeek[], RouteWeek[]]
  byEl: Map<number, RatingRow>; boards: React.ReactNode
  /** What a player is projected to score across the window — the currency the
   *  rest of the page is in. A rating out of 100 beside a points total is two
   *  units in one column. */
  xpOver: (el: number) => number
  weeks: number
}) {
  const [open, setOpen] = useState(false)
  /* Held at ANY point in the window, not just in the opening week: a plan that
     signs a man in GW3 owns him for the decision even though he is not in the
     GW1 fifteen, and the old panel could not see him at all. */
  const held = (r: RouteWeek[]) => new Set(r.flatMap((w) => w.squad))
  const [ha, hb] = [held(routes[0]), held(routes[1])]
  const onlyA = [...ha].filter((e) => !hb.has(e))
  const onlyB = [...hb].filter((e) => !ha.has(e))
  const shared = [...ha].filter((e) => hb.has(e))

  const row = (el: number, colour: string) => {
    const r = byEl.get(el)
    if (!r) return null
    return (
      <div key={el} className="flex items-center gap-2 border-b border-line py-1.5 last:border-0">
        <TeamBadge team={String(r.team)} size={15} />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink">{String(r.web_name)}</span>
        <span className="font-num text-[11.5px] tabular-nums text-ink-3">{String(r.position)} · £{num(r, 'price')?.toFixed(1)}m</span>
        <span className="font-num w-16 text-right text-[13px] font-extrabold tabular-nums" style={{ color: colour }}>
          {xpOver(el).toFixed(1)} <span className="text-[10px] font-bold text-ink-3">xP</span>
        </span>
      </div>
    )
  }

  return (
    <Panel
      title="The men who separate them"
      kicker={`Everyone each plan holds at any point in the window that the other never does, with what he is projected to score across the ${weeks} weeks. The rest of the squad cannot decide anything.`}
    >
      <div className="grid gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        {[onlyA, onlyB].map((list, side) => (
          <div key={side} className="rounded-xl border border-line bg-surface-2/30 px-3 py-2">
            <div className="mb-1 flex items-center gap-2 text-[10px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">
              <span className="size-2.5 rounded-[3px]" style={{ background: colours[side] }} />
              Only in {names[side]}
            </div>
            {list.length ? list.map((el) => row(el, colours[side]))
              : <div className="py-2 text-[13px] text-ink-3">Nobody — this plan holds no one the other does not.</div>}
          </div>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
        <span><b>{shared.length} players are in both plans</b>, so they cancel out exactly.</span>
        <button
          onClick={() => setOpen((v) => !v)}
          className="rounded-lg border border-line-mid px-2.5 py-1 text-[12px] font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
        >
          {open ? 'Hide both fifteens ▴' : 'Show both fifteens ▾'}
        </button>
      </div>
      {open && <div className="mt-3">{boards}</div>}
    </Panel>
  )
}

// ── the verdict ─────────────────────────────────────────────────────────────

/* One panel, one answer, in the order the question is actually asked: who
   wins, by how much, and on what.
 
   This replaces a seven-column table that opened the tab. The table had every
   figure in it and made the reader do all of the comparing — and most of the
   time the comparison has one answer, so it is stated. The supporting numbers
   are still here, under the bars, where they qualify the answer instead of
   burying it. */
function Verdict({ rows }: { rows: Row[] }) {
  /* Points, then moves, then quality. Two plans that project the same are not
     equal if one of them paid four transfers to get there, and if they spent
     the same then the better-rated fifteen is the one more likely to keep
     being right after this window closes. Ranking on points alone would have
     called those ties arbitrarily, by array order. */
  const ranked = [...rows].sort((a, b) =>
    b.projection - a.projection
    || a.transfers - b.transfers
    || (b.rating ?? -1) - (a.rating ?? -1))
  const top = ranked[0]
  const gap = top.projection - ranked[ranked.length - 1].projection
  const max = Math.max(...rows.map((r) => r.projection))
  const min = Math.min(...rows.map((r) => r.projection))
  /* Bars start near the lowest plan, not at zero. Six weeks of projection is
     300-odd points for everyone, so a zero-based axis draws four bars of
     identical length and says nothing. */
  const floor = min - Math.max(gap * 0.6, 2)
  const width = (v: number) => `${Math.max(6, ((v - floor) / Math.max(max - floor, 0.001)) * 100)}%`

  const tied = ranked.length > 1 && Math.abs(top.projection - ranked[1].projection) < 1
  const why = tied
    ? (top.transfers !== ranked[1].transfers
        ? `level on points, and ${top.name} spends ${top.transfers} ${top.transfers === 1 ? 'transfer' : 'transfers'} against ${ranked[1].transfers}`
        : `level on points and on transfers, so it falls to the better-rated fifteen`)
    : null

  const rated = rows.filter((r) => r.rating != null)
  const topRate = rated.length ? rated.reduce((a, b) => ((b.rating ?? 0) > (a.rating ?? 0) ? b : a)) : null
  const split = topRate && topRate.name !== top.name

  return (
    <Panel
      title="The verdict"
      kicker={`Projected points over ${rows[0].weeks.length} weeks. Ties break on transfers spent, then on squad rating.`}
      note={
        <>
          {split
            ? <><b>{topRate!.name} has the better players; {top.name} scores more points.</b> The rating
                averages what fifteen footballers are over a season; the projection is what this fifteen
                returns over these weeks once fixtures, minutes and the armband are applied. A squad can
                be the stronger set of players and still the weaker plan for the window in front of you. </>
            : null}
          The range is the 10th to 90th percentile of the same window played out {' '}
          thousands of times with the luck randomised. Read it against the gap: the difference you are
          choosing is a fraction of the noise you are choosing it inside, which does not make the choice
          pointless, it makes it the part you control.
        </>
      }
    >
      <div className="grid gap-2.5">
        {ranked.map((r, i) => (
          <div key={r.name} className="grid grid-cols-[22px_1fr] items-center gap-2.5 sm:gap-3">
            <span className={`font-num text-center text-[13px] font-bold tabular-nums ${i === 0 ? 'text-accent' : 'text-ink-3'}`}>
              {i + 1}
            </span>
            <div>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                  <span className="size-2.5 rounded-[3px]" style={{ background: r.colour }} />
                  {r.name}
                  {i === 0 && <span className="rounded-full border border-accent/50 px-1.5 py-px text-[9.5px] font-bold tracking-[0.06em] text-accent uppercase">Leads</span>}
                </span>
                <span className="font-num text-[11px] tabular-nums text-ink-3">
                  £{r.spend.toFixed(1)} · {r.transfers} {r.transfers === 1 ? 'move' : 'moves'} · rating {r.rating ?? '—'} · {r.owned.toFixed(1)}% owned
                </span>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="h-7 flex-1 overflow-hidden rounded-lg bg-surface-3">
                  <span className="block h-full rounded-lg" style={{ width: width(r.projection), background: r.colour, opacity: i === 0 ? 1 : 0.5 }} />
                </span>
                <span className="font-display w-[62px] shrink-0 text-right text-xl leading-none tabular-nums" style={{ color: i === 0 ? r.colour : 'var(--ink-2)' }}>
                  {r.projection.toFixed(1)}
                </span>
              </div>
              <div className="font-num mt-1 text-[10.5px] tabular-nums text-ink-3">
                {r.spread.p10.toFixed(0)} to {r.spread.p90.toFixed(0)} across the simulated runs
                {i > 0 && <span className="ml-2 text-ink-3">−{(top.projection - r.projection).toFixed(1)} behind</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
      {why && (
        <p className="mt-3 rounded-xl border border-line bg-surface-2/40 px-3 py-2 text-[12px] text-ink-2">
          <b className="text-ink">{top.name} leads on the tiebreak</b> — {why}.
        </p>
      )}
    </Panel>
  )
}

// ── week by week ─────────────────────────────────────────────────────────

// ── week by week ────────────────────────────────────────────────────────────

function WeekByWeek({ rows, gws }: { rows: Row[]; gws: number[] }) {
  const all = rows.flatMap((r) => r.weeks.map((w) => w.xp))
  const lo = Math.min(...all) * 0.92
  const hi = Math.max(...all)
  const swing = rows.map((r) => {
    const xs = r.weeks.map((w) => w.xp)
    return { name: r.name, band: Math.max(...xs) - Math.min(...xs) }
  }).sort((a, b) => b.band - a.band)

  /* Who takes each week. A margin under a tenth of a point is a rounding
     difference between two identical-looking cells, so it is called a tie and
     nothing is highlighted — marking a winner there would invent one. */
  const best = gws.map((_, i) => {
    const vals = rows.map((r) => r.weeks[i]?.xp ?? -Infinity)
    const top = Math.max(...vals)
    const many = vals.filter((v) => top - v < 0.1).length > 1
    return many ? null : rows[vals.indexOf(top)].name
  })

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
          <div className="mb-1 grid gap-2" style={{ gridTemplateColumns: `124px repeat(${gws.length}, 1fr)` }}>
            <span />
            {gws.map((gw) => (
              <span key={gw} className="text-center text-[10px] font-bold tracking-[0.08em] text-ink-3 uppercase">GW{gw}</span>
            ))}
          </div>
          {rows.map((r) => (
            <div key={r.name} className="mb-1.5 grid items-center gap-2" style={{ gridTemplateColumns: `124px repeat(${gws.length}, 1fr)` }}>
              <span className="truncate">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink">
                  <span className="size-2 shrink-0 rounded-[2px]" style={{ background: r.colour }} />
                  {r.name}
                </span>
                <span className="font-display block text-lg leading-tight tabular-nums" style={{ color: r.colour }}>
                  {r.projection.toFixed(1)}
                </span>
              </span>
              {r.weeks.map((w, i) => {
                /* Every cell used to be a different shade of the plan's colour
                   with the text flipping between dark and light past a
                   threshold — six brightnesses and two ink colours in one row,
                   which read as a fault rather than a scale. One surface, one
                   ink, and the only thing colour now says is "this plan wins
                   this week", which is the one thing worth spotting. */
                const wins = best[i] === r.name
                return (
                  <span
                    key={i}
                    title={`${r.name} · GW${gws[i]} · ${w.xp.toFixed(1)} xP · ${w.form}`}
                    className={`font-num block rounded-lg border py-1.5 text-center text-[12.5px] tabular-nums ${
                      wins ? 'font-bold text-ink' : 'border-line bg-surface-2/40 text-ink-2'
                    }`}
                    style={wins ? { borderColor: r.colour, background: `color-mix(in oklab, ${r.colour} 18%, transparent)` } : undefined}
                  >
                    {w.xp.toFixed(1)}
                  </span>
                )
              })}
            </div>
          ))}
          <div className="mt-1.5 text-[10.5px] text-ink-3">
            The highlighted cell is the best plan that week. Ties are left unmarked.
          </div>
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

/* The "if you played this window over and over" panel lived here: a
   Monte-Carlo of the pairing, with a win rate, a tie rate and a 10th-to-90th
   margin. It was the most technical panel on the page and the least acted on
   — it took four hundred words to say "closer than the totals make it look",
   which the spread on the verdict already says without asking anyone to hold
   a distribution in their head. Removed rather than shrunk: the honest
   version of it is that sentence.  */

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

  /* The rating-versus-projection split is stated once, in the verdict at the
     top. Repeating it here put the same sentence twice on one screen, which
     reads as a fault rather than as emphasis. */

  return (
    <Panel
      title="The squad, by the numbers you already have"
      kicker="Squad rating, and the four routes to points scored the same 0–100 way as a player. A near-tie is drawn as a near-tie — nothing here awards a winner it cannot see."
      note={
        <>
          These dimensions come from last season&rsquo;s percentiles, so pre-season they exist only for
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
          ) : null
        })}
      </div>

      {/* Three or four plans do not face off — there is no middle to grow away
          from, and five stacks of four bars was a wall rather than a reading.
          A grid puts one number where the eye expects it and marks the best in
          each column, so a plan's shape is a row you can read across. */}
      {!two && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] text-[13px]">
            <thead>
              <tr className="border-b border-line text-[10px] tracking-[0.09em] text-ink-3 uppercase">
                <th className="py-1.5 pr-2 text-left font-semibold">Plan</th>
                {lines.map((l) => (
                  <th key={l.label} className="px-2 py-1.5 text-right font-semibold" title={l.note}>{l.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.name} className="border-b border-line last:border-0">
                  <td className="py-2 pr-2">
                    <span className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
                      <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: r.colour }} />
                      {r.name}
                    </span>
                  </td>
                  {lines.map((l) => {
                    const best = Math.max(...l.vals.map((v) => v ?? -1))
                    const tie = l.vals.filter((v) => v != null && Math.abs(v - best) <= 1).length > 1
                    const lead = !tie && (l.vals[i] ?? -1) >= best
                    return (
                      <td key={l.label} className="px-2 py-2 text-right">
                        <span className={`font-num text-[13px] tabular-nums ${lead ? 'font-bold text-accent-2' : 'text-ink-2'}`}>
                          {l.vals[i] ?? '—'}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
  const { hard, clubs } = useMemo(() => {
    const byTeamGw = new Map<string, number>()
    for (const f of fixtureEase) byTeamGw.set(`${f.team}|${f.gw}`, f.fdr)
    const isHard = (team: string, gw: number) => (byTeamGw.get(`${team}|${gw}`) ?? 3) >= 4
    return {
      hard: rows.map((r) => gws.map((gw) => r.series.filter((p) => isHard(p.team, gw)).length)),
      /* Which clubs the hard week actually belongs to. A count says a week is
         rough; the crests say whether that is four players from one club with
         one bad fixture, or four separate problems — and those are different
         things to plan around. */
      clubs: rows.map((r) => gws.map((gw) => {
        const c = new Map<string, number>()
        for (const p of r.series) if (isHard(p.team, gw)) c.set(p.team, (c.get(p.team) ?? 0) + 1)
        return [...c.entries()].sort((a, b) => b[1] - a[1])
      })),
    }
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
                  title={`GW${gws[j]} — ${n} of 15 in a fixture rated 4 or 5${clubs[i][j].length ? `: ${clubs[i][j].map(([t, c]) => `${t}${c > 1 ? ` x${c}` : ''}`).join(', ')}` : ''}`}
                  className={`rounded-lg border px-1 py-1.5 text-center ${
                    n >= 6 ? 'border-bad/50' : n >= 4 ? 'border-warn/45' : n <= 2 ? 'border-good/40' : 'border-line'
                  }`}
                >
                  <b className={`font-num block text-[15px] font-extrabold tabular-nums ${
                    n >= 6 ? 'text-bad' : n >= 4 ? 'text-warn' : n <= 2 ? 'text-good' : 'text-ink'
                  }`}>{n}</b>
                  {/* Four crests is the most a cell this narrow can hold and
                      still be a crest rather than a smudge; past that the count
                      above already says there are more, and the title carries
                      the full list. */}
                  <span className="mt-1 flex flex-wrap items-center justify-center gap-0.5">
                    {clubs[i][j].slice(0, 4).map(([team, c]) => (
                      <span key={team} className="relative inline-flex" title={`${team}${c > 1 ? ` — ${c} players` : ''}`}>
                        <TeamBadge team={team} size={13} />
                        {c > 1 && <span className="font-num absolute -right-1 -bottom-1 text-[7.5px] font-bold tabular-nums text-ink-2">{c}</span>}
                      </span>
                    ))}
                  </span>
                  <span className="mt-0.5 block text-[9px] text-ink-3">GW{gws[j]}</span>
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
/* The Ledger — a side-by-side list of who each plan holds that the other does
   not — was folded into "The men who separate them", which asks the same
   question of the whole window rather than of the opening week.  */
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

// ── the two squads, side by side ────────────────────────────────────────────

/* Two pitches rather than two lists of names.
 
   The chip version of this panel was correct and unreadable: to find the shape
   of a disagreement you had to read twenty-two names and hold them in your
   head. Worse, it counted a player as "shared" whenever both plans owned him —
   so a man starting in one plan and benched in the other showed up as
   agreement, which is the opposite of true. Position is the whole point of a
   squad, so the comparison is drawn on the thing that carries it. */

type Role = 'xi' | 'bench'
type Verdict = 'same' | 'moved' | 'only'

function Lineups({ rows, gw, fixtureEase }: { rows: Row[]; gw: number; fixtureEase: FixtureEaseRow[] }) {
  const [a, b] = rows

  const roleMap = (r: Row): Map<number, Role> => {
    const xi = new Set((r.weeks[0]?.xi ?? []).map((p) => p.element))
    const m = new Map<number, Role>()
    for (const p of r.series) m.set(p.element, xi.has(p.element) ? 'xi' : 'bench')
    return m
  }
  const roles = [roleMap(a), roleMap(b)]
  const caps = rows.map((r) => r.weeks[0]?.captain ?? null)

  const verdictFor = (el: number, i: number): Verdict => {
    const mine = roles[i].get(el)
    const theirs = roles[1 - i].get(el)
    if (!theirs) return 'only'
    return mine === theirs ? 'same' : 'moved'
  }

  const counts = { same: 0, moved: 0, only: 0 }
  for (const p of a.series) counts[verdictFor(p.element, 0)] += 1
  const onlyB = b.series.filter((p) => verdictFor(p.element, 1) === 'only').length

  return (
    <Panel
      title="The two squads, side by side"
      kicker={`Both fifteens laid out for GW${gw}, best eleven on the grass and the four on the bench underneath. Faded means both plans agree, exactly — same player, same role.`}
      note={
        <>
          {counts.moved > 0
            ? <><b>{counts.moved} {counts.moved === 1 ? 'player is' : 'players are'} in both squads but not in the same place.</b>{' '}
                A list of names calls that agreement; it is not. A man who starts in one plan and sits
                on the other bench is a different decision in each, and it is worth the same to you as
                a transfer you never made. </>
            : <>Every player both plans own is in the same role in both, so the only disagreements here
                are the {counts.only + onlyB} places where the squads hold different men. </>}
          The eleven is the best legal one the engine can pick for GW{gw}, not a lineup either plan has
          saved — so this reads as what each squad <em>would</em> put out, which is the only basis on
          which two squads can be compared at all.
        </>
      }
    >
      {/* min-w-0 on the tracks: a grid item defaults to min-width:auto, so
          the pitch's own rows of cards set the column width and the panel
          grew 134px past a phone screen. */}
      <div className="grid gap-3 lg:grid-cols-2 [&>*]:min-w-0">
        {rows.map((r, i) => (
          <Board key={r.name} row={r} roles={roles[i]} captain={caps[i]} verdict={(el) => verdictFor(el, i)} fixtureEase={fixtureEase} gw={gw} />
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-ink-2">
        <span className="flex items-center gap-1.5 opacity-40"><Swatch c="var(--line-strong)" />Faded — same player, same role</span>
        <span className="flex items-center gap-1.5"><Swatch c="var(--warn)" />In both, different role</span>
        <span className="flex items-center gap-1.5"><Swatch c={rows[0].colour} /><Swatch c={rows[1].colour} />Only in that plan</span>
        <span className="text-ink-3">No tiers on this board — the only colour here is the difference.</span>
      </div>
    </Panel>
  )
}

function Swatch({ c }: { c: string }) {
  return <span className="inline-block size-4 rounded-[5px]" style={{ boxShadow: `0 0 0 2px ${c}` }} />
}

const ROWS: { pos: string; label: string }[] = [
  { pos: 'GKP', label: 'GK' }, { pos: 'DEF', label: 'DEF' },
  { pos: 'MID', label: 'MID' }, { pos: 'FWD', label: 'FWD' },
]

function Board({ row, roles, captain, verdict, fixtureEase, gw }: {
  row: Row
  roles: Map<number, Role>
  captain: number | null
  verdict: (el: number) => Verdict
  fixtureEase: FixtureEaseRow[]
  gw: number
}) {
  const xi = row.series.filter((p) => roles.get(p.element) === 'xi')
  const bench = row.series.filter((p) => roles.get(p.element) === 'bench')
  const moved = row.series.filter((p) => verdict(p.element) === 'moved').length
  const only = row.series.filter((p) => verdict(p.element) === 'only').length

  /* THE SAME BOARD THE BUILDER DRAWS, at half the width. This was thirty
     name-chips on a grey card, and it was defensible — a diff is not a team
     sheet, and grass under thirty small labels is loud. But it made you learn
     a second way of looking at your own squad, one screen after the first,
     and the pitch is how you know at a glance that the left one is 3-5-2 and
     the right one is 3-4-3. The diff survives as what it always was: a state
     on each card. Faded means both plans agree exactly, a dashed amber edge
     means he is in both but not in the same role, and a solid edge in the
     plan's own colour means only this plan has him. */
  const identical = moved === 0 && only === 0
  /* ONE THING ON THIS BOARD CARRIES COLOUR, AND IT IS THE DIFFERENCE.

     Two attempts got this wrong in the same way. A ring round the card fought
     the card's own tier edge — the gold, silver and bronze that says how good
     a player is — and a rule under the card was quiet enough to miss. The
     mistake in both was leaving the tier metal on: a board whose subject is
     "which two of these thirty are different" cannot also spend its colour
     saying how good each of them is. That belongs on the pitch you build on,
     not on the one you compare with.

     So every card here is graphite, the grass is gone, and the only saturated
     colour left is the marker. On a neutral card on a dark surface a ring
     reads at a glance, which is all it ever needed. */
  const ringOf = (el: number): string | null => {
    const v = verdict(el)
    // Two plans holding the same fifteen in the same roles have nothing to
    // mark AGAINST, so nothing is marked.
    if (identical) return null
    if (v === 'only') return row.colour
    if (v === 'moved') return 'var(--warn)'
    return null
  }
  const faded = (el: number) => !identical && verdict(el) === 'same'

  const card = (p: PlayerSeries, isBench?: boolean) => {
    const ring = ringOf(p.element)
    const rt = num(p.row, 'season_overall_score')
    return (
      <div
        key={p.element}
        className={`${CARD_W} relative rounded-[13px] ${faded(p.element) ? 'opacity-40' : ''}`}
        style={ring ? { boxShadow: `0 0 0 2px ${ring}, 0 0 14px -2px ${ring}` } : undefined}
        title={`${String(p.row.web_name)} · ${p.pos} · ${p.team} · £${p.price.toFixed(1)}m${
          verdict(p.element) === 'moved' ? ` — in both plans, ${isBench ? 'benched here' : 'starting here'}`
          : verdict(p.element) === 'only' ? ' — only in this plan' : ' — same player, same role in both'}`}
      >
        <PitchCard
          rating={rt != null ? Math.round(rt * 20) : null}
          cornerText={p.weeks[0] ? p.weeks[0].xp.toFixed(1) : null}
          name={String(p.row.web_name)}
          team={p.team}
          price={p.price}
          code={num(p.row, 'code')}
          element={p.element}
          tier="graphite"
          armband={p.element === captain ? 'C' : null}
          fixtures={<FixtureNames fixtureEase={fixtureEase} team={p.team} n={1} fromGw={gw} />}
        />
      </div>
    )
  }

  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface-1/60 p-3">
      {/* The total, at the size of the thing it is. This was one line of grey
          micro-type ending in "42.1 xP", and it was the week's figure rather
          than the window's — the number the whole page is about, printed
          smaller than the legend underneath it. */}
      <div className="mb-2 flex items-end justify-between gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: row.colour }} />
            <span className="truncate">{row.name}</span>
          </span>
          <span className="font-num mt-0.5 block text-[10.5px] tabular-nums text-ink-3">
            {only} unique · {moved} moved · £{row.spend.toFixed(1)}m
          </span>
        </span>
        <span className="shrink-0 text-right leading-none">
          <span className="font-display block text-[26px] tabular-nums" style={{ color: row.colour }}>
            {row.projection.toFixed(1)}
          </span>
          <span className="mt-0.5 block text-[9px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">
            projected
          </span>
        </span>
      </div>

      <Pitch
        plain
        footer={
          <div className="flex justify-center gap-1 sm:gap-2">
            {bench.map((p) => card(p, true))}
          </div>
        }
      >
        <div className="relative flex flex-col gap-2 sm:gap-3">
          {ROWS.map(({ pos }) => {
            const line = xi.filter((p) => p.pos === pos)
            if (!line.length) return null
            return (
              <div key={pos} className="flex justify-center gap-1 sm:gap-2">
                {line.map((p) => card(p))}
              </div>
            )
          })}
        </div>
      </Pitch>
    </div>
  )
}

/* The old name-chip Card lived here. The pitch cards carry the same three
   states now — faded for agreement, a warn edge for a different role, the
   plan's own colour for a player only it holds — so a second card component
   drawing the same distinctions in a different visual language was one
   language too many.  */
