import { useMemo, useState } from 'react'
import { PageShell, EmptyState } from '../components/PageShell'
import { SectionBanner } from '../components/SectionBanner'
import { Tabs, type TabDef } from '../components/Tabs'
import { TeamBadge } from '../components/badges'
import { InfoTip } from '../components/InfoTip'
import { PageSkeleton } from '../components/Skeleton'
import { useCore } from '../lib/useData'
import { useAvailability } from '../lib/availability'
import { useXpModel, useMarketOdds, useShotProfiles } from '../lib/xp'
import { captainBoard, tripleCaptainWeeks, type CapRow } from '../lib/captaincy'
import { teamLabel } from '../lib/util'

/* ════════════════════════════════════════════════════════════════════════
   Captaincy.

   The armband is the single biggest decision of a gameweek — it is worth more
   than most transfers — and until now the site left it to be inferred from a
   projection column. Five views, in the order the decision is actually made:
   who to captain, what the bet looks like, when to spend the chip, and the
   two long views that tell you whether this week's answer is next month's.

   Every number comes from the site's own per-gameweek component model. The
   two that do not are labelled where they appear: the field's captaincy
   share, which FPL does not publish before a deadline, and the small smooth
   scoring parts held at their mean inside the distribution.
   ════════════════════════════════════════════════════════════════════════ */

/* FIVE TABS BECAME TWO. "By week" was the board again with the gameweek on
   the other axis, and "Differentials" was that same table with an ownership
   filter — so the gameweek is a dropdown on the board now, and the filter is a
   toggle beside it. "Risk & reward" plotted haul against projection, which is
   two columns the board already prints, as a scatter nobody could read a
   decision out of. What is left is the two questions the page exists to
   answer: who to captain this week, and when to spend the chip. */
const TABS: TabDef[] = [
  { id: 'board', label: 'Captain board' },
  { id: 'tc', label: 'Triple Captain' },
]

/** A differential is a captain the field is not already on. */
const DIFF_OWNED = 10

const pc = (v: number) => `${Math.round(v * 100)}%`
const one = (v: number) => v.toFixed(1)
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`

export default function Captaincy() {
  const { data } = useCore()
  const avail = useAvailability()
  const xpModel = useXpModel()
  const market = useMarketOdds()
  const profiles = useShotProfiles()
  const [tab, setTab] = useState('board')
  const [diffOnly, setDiffOnly] = useState(false)
  /** Which half of the season the chip view looks at. A Triple Captain is
   *  spent once, and the decision people actually make is "before Christmas or
   *  after" — a rolling twelve-week window could not express either. */
  const [half, setHalf] = useState<1 | 2>(1)

  const ratings = data?.ratings ?? []
  const fixtureEase = data?.fixtureEase ?? []

  // fixtureEase is forward-looking, so its first week is the one to captain.
  const gws = useMemo(
    () => [...new Set(fixtureEase.map((f) => f.gw))].sort((a, b) => a - b),
    [fixtureEase],
  )
  const [gw, setGw] = useState<number | null>(null)
  const activeGw = gw ?? gws[0] ?? null
  /* 38 games, so the first half ends at 19 — the same split the fixtures page
     uses for its best-runs windows. */
  const window = useMemo(
    () => gws.filter((g) => (half === 1 ? g <= 19 : g >= 20)),
    [gws, half],
  )

  const board = useMemo(
    () => (activeGw == null || !ratings.length
      ? null
      : captainBoard(ratings, activeGw, fixtureEase, avail, xpModel, market, profiles)),
    [ratings, activeGw, fixtureEase, avail, xpModel, market, profiles],
  )

  const tc = useMemo(
    () => (tab !== 'tc' || !ratings.length
      ? null
      : tripleCaptainWeeks(ratings, window, fixtureEase, avail, xpModel, market, profiles)),
    [tab, ratings, window, fixtureEase, avail, xpModel, market, profiles],
  )

  // No rows yet means the core tables are still in flight — the provider
  // exposes no loading flag, and an absent `data` says the same thing.
  if (!data) return <PageSkeleton />

  return (
    <PageShell>
      <SectionBanner
        imgKey="squad"
        title="Captaincy"
        subtitle="The biggest call of the week, priced against what everyone else is doing"
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {tab === 'board' && activeGw != null && gws.length > 1 && (
          <label className="flex items-center gap-2">
            <span className="text-[10px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">Gameweek</span>
            {/* A DROPDOWN, NOT EIGHT PILLS. The row showed `gws.slice(0, 8)`,
                so the back half of the season was unreachable — which is most
                of what the removed "By week" tab was for. */}
            <select
              value={activeGw}
              onChange={(e) => setGw(Number(e.target.value))}
              className="min-h-9 rounded-lg border border-line-mid bg-surface-1 px-2.5 text-xs font-bold text-ink"
            >
              {gws.map((g) => <option key={g} value={g}>GW{g}</option>)}
            </select>
          </label>
        )}
        {tab === 'board' && (
          <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink-2">
            <input
              type="checkbox"
              checked={diffOnly}
              onChange={(e) => setDiffOnly(e.target.checked)}
              className="size-4 accent-accent"
            />
            Differentials only
            <InfoTip text={`Captains owned by ${DIFF_OWNED}% of managers or fewer. A differential only pays if it hauls — the board's edge column is what it has to beat.`} />
          </label>
        )}
      </div>

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="mt-5">
        {!ratings.length ? (
          <EmptyState>No ratings loaded yet.</EmptyState>
        ) : tab === 'board' ? (
          <Board board={board} gw={activeGw} diffOnly={diffOnly} />
        ) : (
          <TripleCaptain weeks={tc} half={half} onHalf={setHalf} />
        )}
      </div>
    </PageShell>
  )
}

/* ── shared furniture ────────────────────────────────────────────────── */

function Why({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 rounded-xl border border-line bg-surface-1 px-4 py-3 text-[13.5px] leading-relaxed text-ink-2">
      {children}
    </p>
  )
}

/** Wide content scrolls INSIDE this, never by pushing the page sideways. */
function Wide({ children }: { children: React.ReactNode }) {
  return <div className="-mx-2.5 overflow-x-auto px-2.5 sm:mx-0 sm:px-0">{children}</div>
}

/* ── 1 · the captain board ───────────────────────────────────────────── */

function Board({ board, gw, diffOnly }: {
  board: { rows: CapRow[]; field: number } | null; gw: number | null; diffOnly: boolean
}) {
  if (!board || !board.rows.length) return <EmptyState>No projections for this gameweek yet.</EmptyState>
  /* Filtered AFTER the field benchmark is computed, never before: the field is
     what every manager's armband returns, so working it out over differentials
     alone would price the board against a league that does not exist. */
  const pool = diffOnly ? board.rows.filter((r) => r.owned <= DIFF_OWNED) : board.rows
  if (!pool.length) return <EmptyState>No differential captains projected this week.</EmptyState>
  const rows = pool.slice(0, 10)
  return (
    <section>
      <Why>
        <b className="font-bold text-ink">Expected points is the wrong sort key on its own.</b>{' '}
        Captaining the player most of the field captains is the neutral move — you gain nothing and
        lose nothing. The column that matters is <b className="font-bold text-ink">edge</b>: your
        captain&rsquo;s doubled return minus what the field&rsquo;s armband is expected to return
        (<span className="tabular-nums">{one(board.field)}</span> in GW{gw}). Ceiling and floor sit
        beside the mean because doubling a score doubles its variance, and the right captain when
        you are chasing is not the right one when you are protecting a lead.
      </Why>
      <Wide>
        <table className="w-full min-w-[620px] border-collapse overflow-hidden rounded-xl border border-line bg-surface-1 text-[13px]">
          <thead>
            <tr className="bg-surface-2 text-[9.5px] uppercase tracking-[0.09em] text-ink-3">
              <th className="w-7 px-2 py-2 text-right">#</th>
              <th className="px-2 py-2 text-left">Player</th>
              <th className="px-2 py-2 text-right">Cap xP</th>
              <th className="px-2 py-2 text-right">
                Haul <InfoTip text="The chance of 12 or more points AFTER doubling. Read off a full points distribution for the week — goals and assists drawn as Poisson from his projected rates, minutes, clean sheet and bonus on top — not a rule of thumb. Its mean comes back to the same expected points shown in the Cap xP column." />
              </th>
              <th className="px-2 py-2 text-right">
                Blank <InfoTip text="The chance of 4 or fewer points after doubling, off the same distribution. A captain who blanks costs you roughly what the field's armband returned." />
              </th>
              <th className="px-2 py-2 text-left">
                Ceiling / floor <InfoTip text="The doubled score at the 90th and 10th percentile of the week's distribution: a good week and a bad one, not the best and worst possible. Doubling a score doubles its spread, which is why the pair sits beside the mean." />
              </th>
              <th className="px-2 py-2 text-right">Owned</th>
              <th className="px-2 py-2 text-right">
                EO <InfoTip text="Effective ownership: ownership times one plus his captaincy share. MODELLED, NOT OBSERVED — FPL publishes no captaincy data before a deadline, so the share is estimated from projection and ownership. Treat it as a shape, not a measurement." />
              </th>
              <th className="px-2 py-2 text-right">Edge</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.element} className="border-t border-line">
                <td className="px-2 py-1.5 text-right font-extrabold text-ink-3">{i + 1}</td>
                <td className="px-2 py-1.5">
                  <span className="flex items-center gap-1.5 font-bold text-ink">
                    <TeamBadge team={r.team} size={13} />
                    {r.name}
                  </span>
                  <span className="block text-[10.5px] text-ink-3">
                    {teamLabel(r.team)} v {r.fixture}
                  </span>
                </td>
                <td className="px-2 py-1.5 text-right font-extrabold tabular-nums text-ink">
                  {one(r.outlook.xp * 2)}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-good">
                  {r.outlook.modelled ? pc(r.outlook.haul) : '—'}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">
                  {r.outlook.modelled ? pc(r.outlook.blank) : '—'}
                </td>
                {/* The shape of the bet, drawn: haul from the left in green,
                    blank from the right in red, and the gap between them the
                    ordinary weeks. Two numbers side by side say the same
                    thing and nobody reads them; a bar is comparable down the
                    column at a glance. */}
                <td className="px-2 py-1.5">
                  {r.outlook.modelled ? (
                    <span
                      className="flex h-1.5 min-w-[90px] overflow-hidden rounded-sm bg-surface-3"
                      title={`ceiling ${r.outlook.ceiling} · floor ${r.outlook.floor} (captained)`}
                    >
                      <i className="block h-full rounded-sm bg-good" style={{ width: `${r.outlook.haul * 100}%` }} />
                      <i className="ml-auto block h-full rounded-sm bg-bad/65" style={{ width: `${r.outlook.blank * 100}%` }} />
                    </span>
                  ) : (
                    <span className="text-[10.5px] text-ink-3" title="No component baseline for this player yet — his projection is a flat estimate, so there is no distribution behind it.">
                      no baseline
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">{r.owned.toFixed(0)}%</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">{r.eo.toFixed(0)}%</td>
                <td className={`px-2 py-1.5 text-right font-extrabold tabular-nums ${r.edge >= 0 ? 'text-good' : 'text-bad'}`}>
                  {signed(r.edge)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Wide>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
        Haul = 12+ as captain · blank = 4 or fewer · EO = ownership × (1 + captaincy share). FPL
        does not publish captaincy before the deadline, so that share is modelled from expected
        points weighted by ownership, not observed. Haul and blank come from the full points
        distribution: whether he features, whether he lasts the hour, goals, assists and goals
        conceded are drawn as random, and bonus is paid only when it is earned.
      </p>
    </section>
  )
}

/* ── 2 · Triple Captain ──────────────────────────────────────────────── */

function TripleCaptain({ weeks, half, onHalf }: {
  weeks: ReturnType<typeof tripleCaptainWeeks> | null
  half: 1 | 2
  onHalf: (h: 1 | 2) => void
}) {
  const picker = (
    /* HALVES, NOT A ROLLING TWELVE. The chip is spent once and the question
       people actually ask is "before Christmas or after"; a twelve-week window
       could express neither, and it hid GW20 onward entirely. */
    <label className="mb-3 flex items-center gap-2">
      <span className="text-[10px] font-extrabold tracking-[0.12em] text-ink-3 uppercase">Season</span>
      <select
        value={half}
        onChange={(e) => onHalf(Number(e.target.value) as 1 | 2)}
        className="min-h-9 rounded-lg border border-line-mid bg-surface-1 px-2.5 text-xs font-bold text-ink"
      >
        <option value={1}>First half · GW1–19</option>
        <option value={2}>Second half · GW20–38</option>
      </select>
    </label>
  )
  if (!weeks || !weeks.length) {
    return <section>{picker}<EmptyState>No projections in this half yet.</EmptyState></section>
  }
  const top = Math.max(...weeks.map((w) => w.gain))
  const bestWeek = weeks.find((w) => w.best)
  return (
    <section>
      {picker}
      <Why>
        <b className="font-bold text-ink">Each bar is the best captain available that week</b>, and
        its height is what that player is projected to score — so a Triple Captain played then adds
        roughly that many points again, on top of the double you were getting anyway. The name and
        fixture under each bar are who that captain would be.{' '}
        <b className="font-bold text-ink">A gold bar beats every week left after it</b>, which makes
        it the stopping rule: play the chip on the first gold bar you reach and you cannot do better
        later in this half.{' '}
        {bestWeek && (
          <>As it stands that is <b className="font-bold text-ink">GW{bestWeek.gw}</b>, on{' '}
            {bestWeek.name} against {bestWeek.fixture}.</>
        )}
      </Why>
      <Wide>
        <div className="flex min-w-[560px] items-end gap-1.5 rounded-xl border border-line bg-surface-1 p-3">
          {weeks.map((w) => (
            <div key={w.gw} className="flex flex-1 flex-col items-center gap-1">
              <span className={`text-[9.5px] font-extrabold tabular-nums ${w.best ? 'text-accent' : 'text-ink-3'}`}>
                {one(w.gain)}
              </span>
              <div
                className={`w-full rounded-t border ${
                  w.best ? 'border-accent-strong bg-accent/55' : 'border-line-mid bg-line-mid/30'
                }`}
                style={{ height: `${Math.max(6, (w.gain / top) * 150)}px` }}
              />
              <span className="text-[9px] font-bold text-ink-3">GW{w.gw}</span>
              <span className="max-w-full truncate text-[8.5px] text-ink-2">{w.name}</span>
              <span className="text-[8px] text-ink-3">{w.fixture}</span>
            </div>
          ))}
        </div>
      </Wide>
      <p className="mt-2 text-[11.5px] text-ink-3">
        Bench Boost and Free Hit price the same way — against the bench&rsquo;s expected return and
        the gap between your XI and the best available XI — but both need the blank and double
        calendar, which is not published this far out.
      </p>
    </section>
  )
}
