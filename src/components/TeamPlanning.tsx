import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { TeamBadge } from './badges'
import { Icon } from './Icon'
import { analyserDiff, diffFill, type DiffScale, type SeasonRun } from '../lib/fixtureRuns'
import { num } from '../lib/rows'
import { teamLabel } from '../lib/util'
import type { FixtureEaseRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   The two things a club's fixture list is actually asked:
   when are the good weeks, and who covers the bad ones.

   Neither is answered by drawing all thirty-eight gameweeks. That strip is
   the right picture on the Fixtures page, where twenty rows side by side let
   you compare clubs; on a single club's page it is a spreadsheet with one row
   in it, and the reader has to do the finding themselves.
   ════════════════════════════════════════════════════════════════════════ */

const HALF_LABEL: Record<1 | 2, string> = { 1: 'First half', 2: 'Second half' }

/** A difficulty on the 1–5 scale, worded. The number alone means nothing to
 *  anyone who has not memorised the scale. */
function easeWord(avg: number): { word: string; tone: string } {
  if (avg <= 2.2) return { word: 'Very kind', tone: 'text-good' }
  if (avg <= 2.7) return { word: 'Kind', tone: 'text-good' }
  if (avg <= 3.2) return { word: 'Average', tone: 'text-ink-2' }
  if (avg <= 3.7) return { word: 'Awkward', tone: 'text-warn' }
  return { word: 'Brutal', tone: 'text-bad' }
}

/** A club's best stretch, as a card rather than a row of chips.
 *
 *  The old display put the gameweek range, the average, the home count and
 *  every opponent on one line at 10px, which technically contained the answer
 *  and gave the eye nowhere to land. The range is the thing you act on, so it
 *  is the biggest thing on the card. */
export function BestRunCards({ runs, className = '' }: { runs: SeasonRun[]; className?: string }) {
  if (!runs.length) return null
  return (
    <div className={`grid gap-3 ${runs.length > 1 ? 'sm:grid-cols-2' : ''} ${className}`}>
      {runs.map((run) => {
        const { word, tone } = easeWord(run.avg)
        return (
          <div key={run.half} className="rounded-2xl border border-line bg-surface-1 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-extrabold tracking-[0.14em] text-ink-3 uppercase">{HALF_LABEL[run.half]}</span>
              <span className={`text-[11px] font-bold ${tone}`}>{word}</span>
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="font-display text-[28px] leading-none font-bold text-ink tabular-nums">GW{run.from}–{run.to}</span>
              <span className="text-[12px] text-ink-3">{run.fixtures.length} games</span>
            </div>
            <div className="mt-1.5 text-[12px] text-ink-2">
              <b className="text-ink">{run.avg.toFixed(1)}</b> average difficulty · <b className="text-ink">{run.home}</b> of {run.fixtures.length} at home
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1">
              {run.fixtures.map((f, i) => (
                <span
                  key={`${f.gw}-${f.opponent}-${i}`}
                  title={`GW${f.gw} · ${f.venue === 'H' ? 'home to' : 'away at'} ${f.opponent} · difficulty ${f.diff.toFixed(1)}`}
                  className="rounded-[5px] px-1.5 py-1 text-[10.5px] leading-none font-bold text-ink"
                  style={{ background: diffFill(f.diff) }}
                >
                  {f.opponent}<span className="ml-0.5 text-ink-2">{f.venue}</span>
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** One gameweek of the pair, already decided: who you start and against whom. */
export interface RotWeek {
  gw: number
  /** The club whose fixture is kinder this week. */
  start: string
  opponent: string
  venue: 'H' | 'A'
  diff: number
  /** True where this is one of the base club's awkward weeks. */
  rescued: boolean
}

export interface Partner {
  team: string
  /** Total difficulty removed across this club's hard weeks. */
  cover: number
  /** How many of the hard weeks the partner is genuinely easier in. */
  weeks: number
  hard: number
  /** The rotation itself, week by week — the thing you actually act on. */
  run: RotWeek[]
}

const HARD = 3.2   // above this on the 1–5 scale, a week is worth covering
const HORIZON = 8  // far enough to plan a rotation, near enough to be real

/** Who to pair a club with.
 *
 *  Not "whose fixtures are best" — that is the Fixtures page and it would
 *  return the same three clubs on every page. This asks a club-specific
 *  question: across the weeks where THIS club is hard, whose fixtures are
 *  easier, and by how much. A partner that is superb in the weeks you are
 *  already fine scores nothing here, which is the whole point of a rotation. */
export function rotationPartners(
  fixtureEase: FixtureEaseRow[],
  team: string,
  scale: DiffScale | null,
  fromGw: number,
): Partner[] {
  const diffOf = (f: FixtureEaseRow) =>
    analyserDiff(String(f.opponent), 'overall', String(f.venue) === 'H' ? 'H' : 'A', num(f, 'fdr') ?? 3, scale).diff

  const byTeam = new Map<string, Map<number, number>>()
  for (const f of fixtureEase) {
    const t = String(f.team)
    if (!byTeam.has(t)) byTeam.set(t, new Map())
    // A double gameweek is easier than its hardest game, so keep the kindest.
    const m = byTeam.get(t)!
    const d = diffOf(f)
    m.set(f.gw, Math.min(m.get(f.gw) ?? Infinity, d))
  }

  // The opponent and venue of each club's kindest fixture in a week, so the
  // run can name the game rather than only score it.
  const meta = new Map<string, Map<number, { opp: string; venue: 'H' | 'A' }>>()
  for (const f of fixtureEase) {
    const t = String(f.team)
    const d = diffOf(f)
    if ((byTeam.get(t)?.get(f.gw) ?? Infinity) !== d) continue
    if (!meta.has(t)) meta.set(t, new Map())
    meta.get(t)!.set(f.gw, { opp: String(f.opponent), venue: String(f.venue) === 'H' ? 'H' : 'A' })
  }

  const mine = byTeam.get(team)
  if (!mine) return []
  const gws = [...mine.keys()].filter((g) => g >= fromGw).sort((a, b) => a - b).slice(0, HORIZON)
  // A blank counts as maximally hard: no fixture is the worst fixture.
  const hardSet = new Set(gws.filter((g) => (mine.get(g) ?? 5) >= HARD))
  if (!hardSet.size) return []

  const out: Partner[] = []
  for (const [other, theirs] of byTeam) {
    if (other === team) continue
    let cover = 0
    let weeks = 0
    const run: RotWeek[] = []
    for (const g of gws) {
      const mineD = mine.get(g) ?? 5
      const theirD = theirs.get(g) ?? 5
      const rescued = hardSet.has(g) && mineD - theirD > 0.3
      if (rescued) { cover += mineD - theirD; weeks++ }
      // Start whichever has the kinder game — the rotation, decided.
      const startTheirs = theirD < mineD
      const club = startTheirs ? other : team
      const m = meta.get(club)?.get(g)
      run.push({
        gw: g,
        start: club,
        opponent: m?.opp ?? '—',
        venue: m?.venue ?? 'H',
        diff: startTheirs ? theirD : mineD,
        rescued,
      })
    }
    if (weeks) out.push({ team: other, cover, weeks, hard: hardSet.size, run })
  }
  return out.sort((a, b) => b.cover - a.cover).slice(0, 3)
}

export function RotationPartners({ fixtureEase, team, scale, fromGw, className = '' }: {
  fixtureEase: FixtureEaseRow[]
  team: string
  scale: DiffScale | null
  fromGw: number
  className?: string
}) {
  const partners = useMemo(() => rotationPartners(fixtureEase, team, scale, fromGw), [fixtureEase, team, scale, fromGw])
  if (!partners.length) return null
  const hard = partners[0].hard

  return (
    <div className={className}>
      <p className="mb-2.5 max-w-[80ch] text-sm text-ink-2">
        {teamLabel(team)} have <b className="text-ink">{hard}</b> awkward {hard === 1 ? 'week' : 'weeks'} in the next {HORIZON}.
        These three clubs are the kindest across exactly those weeks. Each card shows the rotation itself — who you start
        each gameweek and against whom.
      </p>
      <div className="grid gap-2.5 lg:grid-cols-3">
        {partners.map((p, i) => (
          <div key={p.team} className="rounded-xl border border-line bg-surface-1 p-3">
            <div className="flex items-center gap-2">
              <span className="grid size-5 shrink-0 place-items-center rounded-md bg-surface-3 text-[10px] font-bold text-ink-2">{i + 1}</span>
              <TeamBadge team={p.team} size={18} />
              <span className="min-w-0 flex-1 truncate font-semibold text-ink">{teamLabel(p.team)}</span>
            </div>
            <div className="mt-1.5 text-[12px] text-ink-2">
              Covers <b className="text-ink">{p.weeks}</b> of {p.hard} · <b className="text-ink">{p.cover.toFixed(1)}</b> difficulty removed
            </div>

            {/* The run, decided week by week. Naming a partner without showing
                the weeks leaves the reader to do the pairing by hand, which is
                the work they came here to have done. A ring marks the weeks
                where the partner is the reason the rotation is worth owning. */}
            <div className="mt-2.5 overflow-x-auto">
              <div className="flex gap-1">
                {p.run.map((w) => (
                  <div
                    key={w.gw}
                    title={`GW${w.gw} · start ${teamLabel(w.start)} ${w.venue === 'H' ? 'at home to' : 'away at'} ${w.opponent} · difficulty ${w.diff.toFixed(1)}`}
                    className={`min-w-[42px] flex-1 rounded-md px-1 py-1 text-center ${w.rescued ? 'ring-1 ring-accent' : ''}`}
                    style={{ background: diffFill(w.diff) }}
                  >
                    <span className="block text-[8.5px] leading-none font-bold text-ink-2">GW{w.gw}</span>
                    <span className="mt-0.5 block text-[10px] leading-none font-extrabold text-ink">{w.start}</span>
                    <span className="mt-0.5 block text-[8.5px] leading-none text-ink-2">{w.opponent}{w.venue === 'H' ? '' : ' (a)'}</span>
                  </div>
                ))}
              </div>
            </div>

            <Link
              to={`/fixtures?view=rotation&rot=${team},${p.team}`}
              className="mt-2.5 inline-flex min-h-8 items-center gap-1 text-[12px] font-semibold text-accent hover:underline"
            >
              Open in the rotation planner <Icon name="chevron-right" size={13} />
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}
