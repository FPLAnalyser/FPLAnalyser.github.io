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
import { captainBoard, captainMatrix, tripleCaptainWeeks, type CapRow } from '../lib/captaincy'
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

const TABS: TabDef[] = [
  { id: 'board', label: 'Captain board' },
  { id: 'risk', label: 'Risk & reward' },
  { id: 'tc', label: 'Triple Captain' },
  { id: 'matrix', label: 'By week' },
  { id: 'diff', label: 'Differentials' },
]

/** How far the long views look. Twelve is the planning half-horizon the
 *  fixtures page settled on, and it is as many columns as a phone can carry
 *  while a name still fits in the cell. */
const HORIZON = 12
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

  const ratings = data?.ratings ?? []
  const fixtureEase = data?.fixtureEase ?? []

  // fixtureEase is forward-looking, so its first week is the one to captain.
  const gws = useMemo(
    () => [...new Set(fixtureEase.map((f) => f.gw))].sort((a, b) => a - b),
    [fixtureEase],
  )
  const [gw, setGw] = useState<number | null>(null)
  const activeGw = gw ?? gws[0] ?? null
  const window = useMemo(() => gws.slice(0, HORIZON), [gws])

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

  const matrix = useMemo(
    () => (!['matrix', 'diff'].includes(tab) || !ratings.length
      ? null
      : captainMatrix(ratings, window, fixtureEase, avail, xpModel, market, profiles, 5,
        tab === 'diff' ? DIFF_OWNED : 101)),
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

      {activeGw != null && gws.length > 1 && (
        <div className="mb-4 flex items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-[0.12em] text-ink-3">
            Gameweek
          </span>
          {gws.slice(0, 8).map((g) => (
            <button
              key={g}
              onClick={() => setGw(g)}
              aria-pressed={g === activeGw}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                g === activeGw
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-line bg-surface-1 text-ink-2 hover:text-ink'
              }`}
            >
              GW{g}
            </button>
          ))}
        </div>
      )}

      <Tabs tabs={TABS} active={tab} onChange={setTab} />

      <div className="mt-5">
        {!ratings.length ? (
          <EmptyState>No ratings loaded yet.</EmptyState>
        ) : tab === 'board' ? (
          <Board board={board} gw={activeGw} />
        ) : tab === 'risk' ? (
          <Risk board={board} gw={activeGw} />
        ) : tab === 'tc' ? (
          <TripleCaptain weeks={tc} />
        ) : (
          <Matrix weeks={window} matrix={matrix} differential={tab === 'diff'} />
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

function Board({ board, gw }: { board: { rows: CapRow[]; field: number } | null; gw: number | null }) {
  if (!board || !board.rows.length) return <EmptyState>No projections for this gameweek yet.</EmptyState>
  const rows = board.rows.slice(0, 10)
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
                Haul <InfoTip text="12 or more after the armband." />
              </th>
              <th className="px-2 py-2 text-right">Blank</th>
              <th className="px-2 py-2 text-left">Ceiling / floor</th>
              <th className="px-2 py-2 text-right">Owned</th>
              <th className="px-2 py-2 text-right">Cap %</th>
              <th className="px-2 py-2 text-right">
                EO <InfoTip text="Ownership times one plus the modelled captaincy share. FPL does not publish captaincy before a deadline, so that share is modelled from projection and ownership, not observed." />
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
                <td className="px-2 py-1.5 text-right tabular-nums text-ink-2">{pc(r.capShare)}</td>
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

/* ── 2 · risk and reward ─────────────────────────────────────────────── */

function Risk({ board, gw }: { board: { rows: CapRow[]; field: number } | null; gw: number | null }) {
  if (!board || !board.rows.length) return <EmptyState>No projections for this gameweek yet.</EmptyState>
  const rows = board.rows.slice(0, 12)
  const W = 760
  const H = 340
  const xs = rows.map((r) => r.outlook.xp * 2)
  const lo = Math.min(...xs, board.field) - 0.8
  const hi = Math.max(...xs) + 0.8
  const hiHaul = Math.max(...rows.map((r) => r.outlook.haul), 0.1)
  const x = (v: number) => 54 + ((v - lo) / (hi - lo)) * (W - 90)
  const y = (v: number) => H - 46 - (v / (hiHaul * 1.15)) * (H - 80)
  const rad = (eo: number) => 7 + Math.sqrt(Math.max(0, eo)) * 2.2

  return (
    <section>
      <Why>
        The same twelve as a shape. Across is the captained projection, up is the chance of a haul,
        and bubble size is effective ownership. The gold line is the field.{' '}
        <b className="font-bold text-ink">Anything left of the line needs a reason.</b> Small and
        high is a differential — low effective ownership with real ceiling, which is the trade you
        want when you are behind and the one to avoid when you are ahead.
      </Why>
      <Wide>
        <svg viewBox={`0 0 ${W} ${H}`} className="block w-full min-w-[560px] rounded-xl border border-line bg-surface-1">
          {[0.2, 0.3, 0.4, 0.5, 0.6].filter((g) => g < hiHaul * 1.15).map((g) => (
            <g key={g}>
              <line x1={44} y1={y(g)} x2={W - 20} y2={y(g)} stroke="currentColor" className="text-line" />
              <text x={38} y={y(g) + 3} textAnchor="end" fontSize={10} fill="currentColor" className="text-ink-3">
                {pc(g)}
              </text>
            </g>
          ))}
          <line
            x1={x(board.field)} y1={16} x2={x(board.field)} y2={H - 40}
            stroke="currentColor" className="text-accent" strokeDasharray="4 3" strokeWidth={1.4}
          />
          <text x={x(board.field) + 6} y={26} fontSize={10.5} fill="currentColor" className="text-accent">
            field {one(board.field)}
          </text>
          {rows.map((r) => {
            const ahead = r.edge >= 0
            return (
              <g key={r.element}>
                <circle
                  cx={x(r.outlook.xp * 2)} cy={y(r.outlook.haul)} r={rad(r.eo)}
                  className={ahead ? 'text-good' : 'text-bad'}
                  fill="currentColor" fillOpacity={0.24} stroke="currentColor" strokeWidth={1.3}
                />
                <text
                  x={x(r.outlook.xp * 2)} y={y(r.outlook.haul) - rad(r.eo) - 4}
                  textAnchor="middle" fontSize={10.5} fill="currentColor" className="text-ink-2"
                >
                  {r.name}
                </text>
              </g>
            )
          })}
          <text x={W / 2} y={H - 8} textAnchor="middle" fontSize={10.5} fill="currentColor" className="text-ink-3">
            captained expected points &middot; GW{gw}
          </text>
        </svg>
      </Wide>
    </section>
  )
}

/* ── 3 · Triple Captain ──────────────────────────────────────────────── */

function TripleCaptain({ weeks }: { weeks: ReturnType<typeof tripleCaptainWeeks> | null }) {
  if (!weeks || !weeks.length) return <EmptyState>No projections in this window yet.</EmptyState>
  const top = Math.max(...weeks.map((w) => w.gain))
  return (
    <section>
      <Why>
        A chip is a one-time option, and the mistake is spending it below its value because it is
        burning a hole. Triple Captain adds one further multiple of the captain, so its worth in any
        week is simply the best captain expectation going.{' '}
        <b className="font-bold text-ink">Gold bars are weeks that beat every week left after them</b>{' '}
        — so playing where the bar is gold is the stopping rule, and everything between is a week to
        hold.
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

/* ── 4 & 5 · the matrices ────────────────────────────────────────────── */

function Matrix({ weeks, matrix, differential }: {
  weeks: number[]
  matrix: ReturnType<typeof captainMatrix> | null
  differential: boolean
}) {
  if (!matrix || !matrix.size) return <EmptyState>No projections in this window yet.</EmptyState>
  const all = weeks.flatMap((g) => matrix.get(g) ?? [])
  const top = Math.max(...all.map((c) => c.xp), 1)
  return (
    <section>
      <Why>
        {differential ? (
          <>Not who is best, but who is best among players the field is not already on — everyone
          here is under <b className="font-bold text-ink">{DIFF_OWNED}% owned</b>. A differential
          captain is how you gain on a rival who is on the same template as you.</>
        ) : (
          <>Rank one to five down the side, gameweek across. A solid row is a hold; the same name
          reappearing eleven weeks apart is a fixture-swing play. Home fixtures are upper case, away
          lower.</>
        )}
      </Why>
      <Wide>
        <div className="min-w-[860px] rounded-xl border border-line bg-surface-1 p-2">
          <div className="mb-1 flex gap-1">
            <span className="w-7 shrink-0" />
            {weeks.map((g) => (
              <span key={g} className="flex-1 text-center text-[9px] font-extrabold tracking-wide text-ink-3">
                GW{g}
              </span>
            ))}
          </div>
          {[0, 1, 2, 3, 4].map((rank) => (
            <div key={rank} className="mb-1 flex gap-1">
              <span className="flex w-7 shrink-0 items-center justify-center text-[10.5px] font-extrabold text-ink-3">
                {rank + 1}
              </span>
              {weeks.map((g) => {
                const cell = (matrix.get(g) ?? [])[rank]
                if (!cell) return <span key={g} className="min-h-[34px] flex-1 rounded bg-surface-2/50" />
                return (
                  <span
                    key={g}
                    className="flex min-h-[34px] flex-1 flex-col justify-center rounded px-1 py-0.5 text-center leading-tight"
                    style={{ background: `rgba(201,162,39,${(0.12 + 0.34 * (cell.xp / top)).toFixed(3)})` }}
                    title={`${cell.name} (${teamLabel(cell.team)}) v ${cell.fixture} — ${one(cell.xp)} xP, ${cell.owned.toFixed(0)}% owned`}
                  >
                    <b className="truncate text-[10px] font-extrabold text-ink">{cell.name}</b>
                    <small className="truncate text-[7.5px] font-semibold text-ink-2">
                      {cell.fixture} &middot; {one(cell.xp)}
                    </small>
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      </Wide>
    </section>
  )
}
