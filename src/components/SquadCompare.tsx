import { useMemo } from 'react'
import { Panel } from './SquadShape'
import { TeamBadge } from './badges'
import { Pitch, PitchCard, CARD_W } from './Pitch'
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
      {rows.length === 2
        ? <Lineups rows={rows} gw={gws[0]} fixtureEase={fixtureEase} />
        : <SharedAndDifferent rows={rows} />}
      <Verdict rows={rows} />
      {/* Pairing two lists of players only means something when there are two
          lists. With three or four plans the shared/unique panel above is the
          honest view and this is left off rather than fudged. */}
      {rows.length === 2 && <Ledger rows={rows} />}
      <WeekByWeek rows={rows} gws={gws} />
      <Horizon rows={rows} gws={gws} fixtureEase={fixtureEase} />
      <Dimensions rows={rows} />
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
    rating: number | null; dims: Dimension[]; transfers: number
    spread: { p10: number; median: number; p90: number; mean: number }
    weeks: { xp: number; captain: number | null; xi: PlayerSeries[]; form: string }[]
    series: PlayerSeries[]
  }[]
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
        <span className="flex items-center gap-1.5"><Key cls="border-line bg-surface-2/40 text-ink-3" />Same player, same role</span>
        <span className="flex items-center gap-1.5"><Key cls="border-dashed border-warn" />In both, different role</span>
        <span className="flex items-center gap-1.5"><Key cls="border-accent/55 text-accent" />Only in this plan</span>
      </div>
    </Panel>
  )
}

function Key({ cls }: { cls: string }) {
  return <span className={`inline-block h-3 w-5 rounded-[3px] border ${cls}`} />
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
  const shell = (el: number) => {
    const v = verdict(el)
    // Two plans holding the same fifteen in the same roles have nothing to
    // fade AGAINST, and greying all thirty cards read as a broken board.
    if (identical) return { className: '', style: undefined }
    if (v === 'only') return { className: 'rounded-xl', style: { boxShadow: `0 0 0 2px ${row.colour}` } }
    if (v === 'moved') return { className: 'rounded-xl', style: { boxShadow: '0 0 0 2px var(--warn)' } }
    return { className: 'opacity-45', style: undefined }
  }

  const card = (p: PlayerSeries, isBench?: boolean) => {
    const sh = shell(p.element)
    const rt = num(p.row, 'season_overall_score')
    return (
      <div
        key={p.element}
        className={`${CARD_W} relative ${sh.className}`}
        style={sh.style}
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
