import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PageShell, EmptyState } from '../components/PageShell'
import { SectionBanner } from '../components/SectionBanner'
import { Tabs, type TabDef } from '../components/Tabs'
import { SortableTable, type Column } from '../components/SortableTable'
import { TeamBadge, PositionIcon } from '../components/badges'
import { InfoTip } from '../components/InfoTip'
import { Icon } from '../components/Icon'
import { PageSkeleton } from '../components/Skeleton'
import { useCore, useLazyTable } from '../lib/useData'
import {
  CAT_LABEL, edgeFor, edgeSentence, profileOf, type Cat, type Profile,
} from '../lib/matchup'
import { Exportable } from '../components/ExportPanel'
import { useWide } from '../lib/useWide'
import { num, str } from '../lib/rows'
import { useMarketOdds, type MarketOdds } from '../lib/xp'
import { teamLabel, playerHref } from '../lib/util'
import { analyserDiff, bandOf, bestRuns, buildDiffScale, diffFill, useTeamBaselines, type Lens, type TeamBase } from '../lib/fixtureRuns'
import { RunsTimeline } from '../components/BestRuns'
import { RatingsEntry } from '../components/RatingsSwitch'
import type { FixtureEaseRow, RatingRow, Row } from '../lib/types'


/* Planning horizons. Six is where a transfer decision actually lives, so the
   grid opens there; four came off the list because it never told you anything
   six did not, only sooner.

   19 is the sentinel for "to the halfway point". Rest of season replaced it
   and drew thirty-eight columns, which is a spreadsheet rather than a read —
   the half is the unit people plan chips and wildcards around. */
/** The stretch of gameweeks a view is reading, and one you have taken out. */
export interface GwWindow { from: number; to: number; skip: number | null }

const winLabel = (w: GwWindow) => `GW${w.from}\u2013GW${w.to}`
/** A stable empty list, so a memo keyed on "no fixtures yet" is not
 *  invalidated by a fresh `[]` on every render while the data loads. */
const NO_ROWS: FixtureEaseRow[] = []
/** Longest span the difficulty and projection grids offer on a phone. */
const MOBILE_WINDOW_CAP = 12

/** The gameweeks a window actually covers: inside the range, minus the one
 *  you are chipping. Everything that reads a window goes through here so the
 *  grid, the planner and their exports cannot disagree about which weeks count. */
export function gwsIn(all: number[], w: GwWindow): number[] {
  return all.filter((g) => g >= w.from && g <= w.to && g !== w.skip)
}

/* A range, not a length. "Next six" cannot say GW5 to GW10, and planning a
   wildcard or a chip is exactly the case where you want to look at a stretch
   that does not start from now.

   Two inputs rather than one dual-thumb track: overlaying two sliders and
   splitting the hits between their thumbs depends on pointer-events behaviour
   this repo cannot test on WebKit, and the one WebKit bug the site has had was
   invisible to Chromium too. Two labelled thumbs are plain, reachable by
   keyboard, and cannot silently trap a thumb at an end. */
function WindowPicker({ value, all, maxSpan, onChange }: {
  value: GwWindow
  /** Every gameweek the fixtures reach, ascending. */
  all: number[]
  /** Longest span this view will show. Undefined means the whole range. */
  maxSpan?: number
  onChange: (w: GwWindow) => void
}) {
  const lo = all[0] ?? 1
  const hi = all[all.length - 1] ?? 1
  const [drag, setDrag] = useState<GwWindow | null>(null)
  const w = drag ?? value
  const span = w.to - w.from + 1

  /** Keep the pair legal: ends stay ordered, the span honours the cap, and a
   *  skipped week that falls outside the range stops being skipped. */
  const settle = (next: GwWindow, moved: 'from' | 'to'): GwWindow => {
    let { from, to } = next
    if (from > to) { if (moved === 'from') to = from; else from = to }
    if (maxSpan && to - from + 1 > maxSpan) {
      if (moved === 'from') to = from + maxSpan - 1
      else from = to - maxSpan + 1
    }
    from = Math.max(lo, Math.min(hi, from)); to = Math.max(lo, Math.min(hi, to))
    const skip = next.skip != null && next.skip >= from && next.skip <= to ? next.skip : null
    return { from, to, skip }
  }
  const move = (moved: 'from' | 'to', n: number) => setDrag(settle({ ...w, [moved]: n }, moved))
  const commit = () => { if (drag) { onChange(drag); setDrag(null) } }
  const inRange = all.filter((g) => g >= w.from && g <= w.to)

  return (
    <div className="flex min-w-[230px] flex-1 flex-col gap-1 sm:max-w-[320px]">
      <div className="flex items-baseline justify-between text-xs text-ink-2">
        <span>Window</span>
        <span className="font-num tabular-nums text-ink">
          {winLabel(w)}
          <span className="text-ink-3"> · {span - (w.skip != null ? 1 : 0)} {span - (w.skip != null ? 1 : 0) === 1 ? 'week' : 'weeks'}</span>
        </span>
      </div>
      {([['from', 'First'], ['to', 'Last']] as const).map(([k, lab]) => (
        <label key={k} className="flex items-center gap-2">
          <span className="w-8 shrink-0 text-[10px] tracking-[0.1em] text-ink-3 uppercase">{lab}</span>
          <input
            type="range" min={lo} max={hi} step={1} value={w[k]}
            onChange={(e) => move(k, Number(e.target.value))}
            onPointerUp={commit} onKeyUp={commit} onBlur={commit}
            aria-label={`${lab} gameweek`}
            className="w-full accent-[var(--accent)]"
          />
        </label>
      ))}
      {/* Chipping a week does not just skip a fixture, it removes that week from
          every number the view derives — so it belongs beside the range rather
          than in a legend somewhere. */}
      <label className="mt-0.5 flex items-center gap-2">
        <span className="w-8 shrink-0 text-[10px] tracking-[0.1em] text-ink-3 uppercase">Chip</span>
        <select
          value={value.skip ?? ''}
          onChange={(e) => onChange({ ...value, skip: e.target.value === '' ? null : Number(e.target.value) })}
          className="min-h-8 min-w-0 flex-1 appearance-none rounded-full border border-line-mid bg-surface-1 px-3 text-[12px] text-ink-2"
        >
          <option value="">No free hit</option>
          {inRange.map((g) => <option key={g} value={g}>Free hit GW{g}</option>)}
        </select>
      </label>
    </div>
  )
}
/* Difficulty and the two projections were one grid behind a "Show" toggle,
   which buried them: they answer a different question (who is best in the
   league at this) and want different controls, and a toggle two rows down is
   not a place anyone finds them. They are their own tab now, and the planner
   moves up behind it — deciding a rotation is closer to reading the grid than
   to browsing the season's best runs. */
const VIEW_TABS: TabDef[] = [
  { id: 'difficulty', label: 'Difficulty' },
  { id: 'projections', label: 'Goals & Clean Sheets' },
  { id: 'rotation', label: 'Rotation Planner' },
  { id: 'runs', label: 'Best Runs' },
  { id: 'matchup', label: 'Matchup Explorer' },
]
type View = 'difficulty' | 'projections' | 'runs' | 'rotation' | 'matchup'

/* The grid shows one of three things per cell: our 1–5 difficulty, the
   projected xG the team's attack should produce in that fixture, or the
   probability of a clean sheet — with window totals in the Run column. */
type GridMode = 'diff' | 'xg' | 'cs'
const PROJ_TABS: TabDef[] = [
  { id: 'xg', label: 'Projected xG' },
  { id: 'cs', label: 'Clean sheets' },
]
const MODE_TIP: Record<GridMode, string> = {
  diff: 'Our own difficulty (1 = easy … 5 = hard), from the goals each side is expected to score and concede in that fixture, placed against the spread of every fixture in the table. It rates the matchup rather than the opponent, so Liverpool at Fulham and Hull at Fulham are not the same game.',
  xg: "Projected expected goals for this team's ATTACK in each fixture: their xG/game baseline × how freely the opponent concedes vs the league × a ±5% venue nudge. The Σ column is the plain sum over the window — the goals their attack should produce across the run.",
  cs: 'The chance of a clean sheet in each fixture: projected goals conceded (opponent xG/game × our concession rate vs the league × venue) turned into a shutout probability (Poisson, e^−λ). The Σ column sums the probabilities — the number of clean sheets to expect over the window.',
}

/** The two goal expectancies for one side of one fixture — how many they
 *  should score, how many they should concede. Every grid and every sentence
 *  on this page is derived from this one pair, so the difficulty colour, the
 *  projected xG, the clean-sheet odds and the written read can never disagree
 *  about which week is the good one. */
interface Lambdas { for: number; against: number; assumed: boolean; market: boolean }

function lambdasFor(teamBase: TeamBase | undefined, oppBase: TeamBase | undefined, league: TeamBase, venue: 'H' | 'A', mkt?: { for: number; against: number } | null): Lambdas | null {
  // Bookmaker-implied goal expectancies outrank the stats baselines for any
  // fixture the market has priced — they already carry team news, transfers
  // and promoted-club strength the season history can't know.
  if (mkt) return { for: mkt.for, against: mkt.against, assumed: false, market: true }
  if (!teamBase || league.xgc <= 0 || league.xg <= 0) return null
  const opp = oppBase ?? league // promoted club with no solved strength either
  return {
    for: teamBase.xg * (opp.xgc / league.xgc) * (venue === 'H' ? 1.05 : 0.95),
    against: opp.xg * (teamBase.xgc / league.xgc) * (venue === 'H' ? 0.95 : 1.05),
    assumed: !oppBase,
    market: false,
  }
}

function projectCell(mode: 'xg' | 'cs', teamBase: TeamBase | undefined, oppBase: TeamBase | undefined, league: TeamBase, venue: 'H' | 'A', mkt?: { for: number; against: number } | null): { v: number; assumed: boolean; market?: boolean } | null {
  const l = lambdasFor(teamBase, oppBase, league, venue, mkt)
  if (!l) return null
  return { v: mode === 'xg' ? l.for : Math.exp(-l.against), assumed: l.assumed, market: l.market }
}

const mktOf = (market: MarketOdds | null, team: string, f: { gw: number; opponent: string }) =>
  market?.byKey.get(`${team}:${f.gw}:${f.opponent}`) ?? null

/* Our own fixture difficulty is driven by opponent strength from our team
   ratings, split into three lenses. It falls back to FPL's FDR only when the
   opponent has no rating yet (e.g. a newly promoted club, pre-season). */
const LENS_TABS: TabDef[] = [
  { id: 'overall', label: 'Overall' },
  { id: 'attack', label: 'Attack' },
  { id: 'defence', label: 'Defence' },
]
const LENS_TIP: Record<Lens, string> = {
  overall: 'Our own difficulty (1 = easy … 5 = hard): the average of the Attack and Defence reads — a single score for the run.',
  attack: "How kind the fixture is for this team's ATTACKERS — set by the goals they're expected to score in it. Expected to score more than most fixtures in the table → easier.",
  defence: "How kind the fixture is for this team's DEFENCE and keeper (clean-sheet odds) — set by the goals they're expected to concede in it. Expected to concede fewer than most fixtures in the table → easier.",
}

/** The scouting read on a team's upcoming run.
 *
 *  This used to average the opponents' conceded-xG channel shares and name
 *  the strongest one. It read as boilerplate because the metric underneath
 *  it barely moves: across the league, conceded xG splits 9% left, 82%
 *  central, 9% right. A "+16% down the left" is 10.4% against a 9.0%
 *  baseline — noise, dressed up. Half of all teams fell through to a generic
 *  fallback line for want of anything above the threshold.
 *
 *  What does separate teams is how much they concede from set pieces (18% to
 *  34% of their xG, so nearly two-fold), the quality of the opponents
 *  themselves, and the shape of the run — where the hard weeks fall and how
 *  many are at home. Each clause below is emitted only when it is actually
 *  true of this run, so a flat run says less rather than saying nothing in
 *  more words. */
interface ReadFixture { gw: number; opponent: string; venue: 'H' | 'A'; diff: number; xg?: number | null; cs?: number | null }

function fixtureRead(
  fixtures: ReadFixture[],
  profiles: Map<string, Profile>,
  league: Profile,
  /** Every club's average difficulty over the same window, so "kind" can mean
   *  kinder than the rest of the league rather than under a fixed number. */
  leagueRuns: number[],
): string | null {
  if (!fixtures.length) return null
  const bits: string[] = []
  const n = fixtures.length
  const avg = fixtures.reduce((s, f) => s + f.diff, 0) / n
  const when = (f: ReadFixture) => `GW${f.gw} ${f.venue === 'H' ? 'at home to' : 'away to'} ${teamLabel(f.opponent)}`

  /* 1. How the run rates — against the rest of the league, not against a
     constant. Fixed thresholds of 2.3 and 3.5 were tuned for an older, wider
     difficulty scale; on the current one nineteen clubs out of twenty landed
     between them and every read opened "A middling run". Runs genuinely do
     even out — over eight gameweeks the whole league sits between 2.5 and 3.5
     — so the only honest way to say "kind" is to say kinder than whom. */
  const home = fixtures.filter((f) => f.venue === 'H').length
  const pool = leagueRuns.length >= 8 ? [...leagueRuns].sort((a, b) => a - b) : null
  const rank = pool ? pool.filter((v) => v < avg - 1e-9).length + 1 : null
  const ordinal = (k: number) => {
    const t = k % 100
    return `${k}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][k % 10] ?? 'th'}`
  }
  if (rank && pool) {
    const of = pool.length
    const spread = pool[of - 1] - pool[0]
    const where = rank <= 4 ? 'One of the kindest runs in the league'
      : rank >= of - 3 ? 'One of the toughest runs in the league'
      : rank <= Math.round(of / 2) ? 'A slightly kinder run than most'
      : 'A slightly tougher run than most'
    bits.push(`${where} — ${ordinal(rank)} easiest of ${of} over the next ${n}, averaging ${avg.toFixed(1)} difficulty with ${home} at home.`)
    // Over a long window the league bunches up, and a rank hides that. Say it.
    if (spread < 0.8) bits.push(`Across ${n} gameweeks the league bunches up — every club sits between ${pool[0].toFixed(1)} and ${pool[of - 1].toFixed(1)}, so the edge is in the individual weeks rather than the run as a whole.`)
  } else {
    bits.push(`${avg.toFixed(1)} average difficulty over ${n}, ${home} at home.`)
  }

  // 2. The weeks that decide it, named by the projections on the grid rather
  // than by the difficulty score. Those two used to be separate models, so
  // the sentence could recommend a week the numbers beside it rated fourth
  // best. Attack and defence get their own answer, because they often differ:
  // the week your forwards want is not always the week your defenders do.
  const rated = fixtures.filter((f) => f.xg != null && f.cs != null)
  if (rated.length === n && n > 1) {
    const byXg = [...rated].sort((a, b) => b.xg! - a.xg!)
    const byCs = [...rated].sort((a, b) => b.cs! - a.cs!)
    const bestXg = byXg[0]
    const bestCs = byCs[0]
    const worst = [...rated].sort((a, b) => (a.xg! + 3 * a.cs!) - (b.xg! + 3 * b.cs!))[0]
    const spread = byXg[0].xg! - byXg[byXg.length - 1].xg!
    if (bestXg.gw === bestCs.gw) {
      bits.push(`${when(bestXg)} is the one to target — ${bestXg.xg!.toFixed(2)} projected xG and a ${Math.round(bestCs.cs! * 100)}% clean-sheet chance, the best of the run on both counts.`)
    } else {
      bits.push(`${when(bestXg)} is the week for the attack (${bestXg.xg!.toFixed(2)} projected xG); ${when(bestCs)} is the best clean-sheet shout (${Math.round(bestCs.cs! * 100)}%).`)
    }
    if (spread >= 0.4 && worst.gw !== bestXg.gw && worst.gw !== bestCs.gw) {
      bits.push(`${when(worst)} is the week to plan around — ${worst.xg!.toFixed(2)} xG and a ${Math.round(worst.cs! * 100)}% shutout chance.`)
    }
  } else {
    // No projections for this run (pre-season, or a window with no baselines):
    // fall back to the difficulty spread, and only when it says something.
    const sorted = [...fixtures].sort((a, b) => a.diff - b.diff)
    const easiest = sorted[0]
    const hardest = sorted[sorted.length - 1]
    if (hardest.diff - easiest.diff >= 1.2) bits.push(`${when(easiest)} is the one to target; ${when(hardest)} is the week to plan around.`)
    else bits.push('No single week stands out — the run is even, so there is nothing to route transfers around.')
  }

  // 3. Set pieces: the one concession pattern that genuinely varies.
  if (league.shares.setpiece > 0) {
    let acc = 0
    let rated = 0
    for (const f of fixtures) {
      const p = profiles.get(f.opponent)
      if (!p || p.totalXg <= 0) continue
      rated++
      acc += p.shares.setpiece
    }
    if (rated >= Math.ceil(n / 2)) {
      const share = acc / rated
      const rel = (share - league.shares.setpiece) / league.shares.setpiece
      if (rel >= 0.12) bits.push(`These opponents give away ${Math.round(share * 100)}% of their chances from set pieces against a league average of ${Math.round(league.shares.setpiece * 100)}% — a run that rewards aerial and set-piece threats.`)
      else if (rel <= -0.12) bits.push(`They defend set pieces well (${Math.round(share * 100)}% of chances conceded against ${Math.round(league.shares.setpiece * 100)}% league), so dead balls are a thin route to points here.`)
    }
  }

  return bits.join(' ')
}

export default function Fixtures() {
  const { data, error: coreError } = useCore()
  /* The tab and the rotation pair live in the URL so another page can send you
     straight to a working planner. Teams' rotation-partner cards link here
     with both clubs already picked, which is the difference between naming a
     partner and letting you see the rotation. */
  const [params, setParams] = useSearchParams()
  const view = (params.get('view') as View) || 'difficulty'
  const setView = (v: View) => {
    const next = new URLSearchParams(params)
    if (v === 'difficulty') next.delete('view')
    else next.set('view', v)
    if (v !== 'rotation') next.delete('rot')
    setParams(next, { replace: true })
  }
  // Six on every screen. The grid scrolls sideways on a phone, which is a
  // smaller cost than opening two different people on two different windows
  // and having them compare notes.
  // A range now, not a count: the planning question is often "GW5 to GW10",
  // which a next-N control cannot ask.
  const [win, setWin] = useState<GwWindow>({ from: 1, to: 6, skip: null })
  const wide = useWide()
  const [lens, setLens] = useState<Lens>('defence')
  // The grid mode is no longer a control — it follows the tab. Only the two
  // projections are a choice, and only inside their own tab.
  const [projMode, setProjMode] = useState<Exclude<GridMode, 'diff'>>('xg')
  const mode: GridMode = view === 'projections' ? projMode : 'diff'


  /* Per-game xG / xGC baselines for difficulty AND the projection modes, from
     the one shared builder. This page used to assemble its own copy, which is
     how Your ratings could move the goal lambdas everywhere else and leave
     every cell on this page exactly where it was. `house` is the same map with
     nobody re-rated — the distribution the 1–5 scale is measured against, so
     one club's dial cannot shift the other nineteen. */
  const { baselines, house, leagueBase } = useTeamBaselines(data)
  const marketStrength = useMarketOdds()

  // Per-team + league concession profiles for the fixture read (lazy — the
  // grid only needs them for the expandable commentary).
  const concededQ = useLazyTable<Record<string, Row[]>>('shots_conceded')
  const { profiles, league } = useMemo(() => {
    const bag = concededQ.data ?? {}
    const profiles = new Map<string, Profile>()
    const all: Row[] = []
    for (const [t, shots] of Object.entries(bag)) {
      if (!Array.isArray(shots)) continue
      profiles.set(t, profileOf(shots, true))
      all.push(...shots)
    }
    return { profiles, league: profileOf(all, true) }
  }, [concededQ.data])

  /* NO_ROWS is a module constant, not a fresh `[]`: written inline it would be
     a new array identity on every render while the core data is still loading,
     and the memo below keys on it. */
  const fixtureEase = data?.fixtureEase ?? NO_ROWS
  const hasFixtures = fixtureEase.length > 0
  /* A phone shows these two as cards and a ladder rather than the wide grid,
     and past a dozen gameweeks that is a very long scroll for a view you read
     by comparing columns. The rotation planner is left uncapped: its board is
     one row per gameweek by design, so length costs nothing there.
     Clamped rather than written back to state, so a window set on a desktop
     survives a narrow screen and comes back when there is room for it. */
  const allGws = useMemo(
    () => [...new Set(fixtureEase.map((f) => f.gw))].sort((a, b) => a - b),
    [fixtureEase],
  )
  const maxSpan = wide ? undefined : MOBILE_WINDOW_CAP
  // Clamped where it is read rather than written back, so a span set at a desk
  // survives a narrow screen and returns intact when there is room again.
  const shownWin: GwWindow = maxSpan && win.to - win.from + 1 > maxSpan
    ? { ...win, to: win.from + maxSpan - 1 } : win
  const gridGws = useMemo(() => gwsIn(allGws, shownWin), [allGws, shownWin])

  /* AFTER THE HOOKS. This used to sit above `allGws` and `gridGws`, so the
     render before the core data arrived ran two fewer hooks than the one after
     it — the same React #310 as in SeasonRunsBoard below, waiting for a slow
     enough network to show itself. */
  if (!data) {
    return (
      <PageShell>
        <SectionBanner imgKey="fixtures" title="Fixtures" subtitle="Our own difficulty ratings for every upcoming game — grid, best runs, rotations and matchups" />
        <PageSkeleton error={coreError} />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <SectionBanner imgKey="fixtures" title="Fixtures" subtitle="Our own difficulty ratings for every upcoming game — grid, best runs, rotations and matchups" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* Full width on a phone so the chip wraps BELOW rather than eating
            the tab row — beside them at 390 it truncated "Goals & Clean Sheets"
            and pushed two tabs behind the scroller. */}
        <div className="w-full min-w-0 sm:w-auto sm:flex-1"><Tabs tabs={VIEW_TABS} active={view} onChange={(id) => setView(id as View)} layoutId="fx-view" /></div>
        {/* WHERE THE DISAGREEMENT FORMS, and the only place the feature is
            advertised at all. A reader looks at a run of green against a club
            they rate and thinks the site has it wrong; that is the moment the
            offer means something, and it is not a moment that happens in a nav
            bar. Beside the tabs rather than inside the difficulty controls
            because every view on this page runs on the same ratings — it was
            on one tab of four. It steps aside once a club is re-rated, since
            the header switch then says the same thing better. */}
        <RatingsEntry className="shrink-0" />
      </div>

      {view === 'difficulty' || view === 'projections' ? (
        hasFixtures ? (
          <>
            {/* Window + lens controls */}
            <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
              {/* Wraps: the presets plus Custom and its box do not fit one
                  phone row, and an unwrapped row pushed the page sideways. */}
              <WindowPicker value={shownWin} all={allGws} maxSpan={maxSpan} onChange={setWin} />
              {view === 'projections' && (
                <div className="flex items-center gap-1.5">
                  <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Show</span>
                  {PROJ_TABS.map((m) => (
                    <span key={m.id} className="flex items-center gap-1">
                      <button
                        onClick={() => setProjMode(m.id as Exclude<GridMode, 'diff'>)}
                        className={`min-h-9 rounded-full border px-3 text-sm font-medium transition-colors ${
                          projMode === m.id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
                        }`}
                      >
                        {m.label}
                      </button>
                      <InfoTip text={MODE_TIP[m.id as GridMode]} />
                    </span>
                  ))}
                </div>
              )}
              {mode === 'diff' && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Rate for</span>
                  {(LENS_TABS).map((l) => (
                    <span key={l.id} className="flex items-center gap-1">
                      <button
                        onClick={() => setLens(l.id as Lens)}
                        className={`min-h-9 rounded-full border px-3 text-sm font-medium transition-colors ${
                          lens === l.id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
                        }`}
                      >
                        {l.label}
                      </button>
                      <InfoTip text={LENS_TIP[l.id as Lens]} />
                    </span>
                  ))}
                </div>
              )}
            </div>
            {/* The note that used to sit here — "the pipeline publishes N
                gameweeks ahead" — could no longer fire once the slider took
                its ceiling from the published fixtures. */}
            <MarketNote market={marketStrength} />

            <Exportable title={`${mode === 'diff' ? 'Fixture difficulty' : mode === 'xg' ? 'Projected xG' : 'Clean sheet odds'} — ${winLabel(shownWin)}${shownWin.skip != null ? `, free hit GW${shownWin.skip}` : ''}`}>
            <FixtureGrid key={mode} fixtureEase={fixtureEase} gws={gridGws} lens={lens} mode={mode} baselines={baselines} house={house} leagueBase={leagueBase} profiles={profiles} league={league} />
            </Exportable>
          </>
        ) : (
          <EmptyState icon={<Icon name="calendar" size={44} />}>
            The difficulty grid and chip planner switch on when next season's fixtures are published.
            <div className="mt-1 text-sm text-ink-3">The Matchup Explorer tab already works on this season's full shot data.</div>
          </EmptyState>
        )
      ) : view === 'runs' ? (
        hasFixtures ? (
          <SeasonRunsBoard
            fixtureEase={fixtureEase}
            lens={lens}
            baselines={baselines}
            house={house}
            lensControl={
              /* The lens matters more here than anywhere: a run that's kind to
                 a striker is not the same run that's kind to a keeper. */
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Rate for</span>
                {LENS_TABS.map((l) => (
                  <span key={l.id} className="flex items-center gap-1">
                    <button
                      onClick={() => setLens(l.id as Lens)}
                      className={`min-h-9 rounded-full border px-3 text-sm font-medium transition-colors ${
                        lens === l.id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
                      }`}
                    >
                      {l.label}
                    </button>
                    <InfoTip text={LENS_TIP[l.id as Lens]} />
                  </span>
                ))}
              </div>
            }
          />
        ) : (
          <EmptyState icon={<Icon name="calendar" size={44} />}>Best runs switch on when the fixtures are published.</EmptyState>
        )
      ) : view === 'rotation' ? (
        hasFixtures ? (
          <RotationPlanner
            ratings={data.ratings as RatingRow[]}
            fixtureEase={fixtureEase}
            baselines={baselines}
            house={house}
            leagueBase={leagueBase}
            initialTeams={(params.get('rot') ?? '').split(',').filter(Boolean)}
          />
        ) : (
          <EmptyState icon={<Icon name="calendar" size={44} />}>The rotation planner switches on when the fixtures are published.</EmptyState>
        )
      ) : (
        <MatchupExplorer ratings={data.ratings as RatingRow[]} league={(data.teams ?? []).map((t) => String(t.short_name))} />
      )}
    </PageShell>
  )
}

/* ── Season map: every club's whole run of gameweeks, with only its best
   stretch lit ────────────────────────────────────────────────────────────
   The ranked table answers "whose run is the kindest". This answers the
   question you actually act on, which is a timing one: when do I get on, and
   when do I get off. Rows are ordered by when the highlighted run STARTS, so
   reading down the page is reading the season in order — the clubs to be on
   in September sit above the clubs to be on in November, and the handover
   between two teams is a diagonal you can see rather than a comparison you
   have to hold in your head.

   Everything outside a run is drawn faint on purpose. A grid where all 38
   cells are coloured is the difficulty grid, and we already have one. */
/* ── Best runs of the season, every club ─────────────────────────────────
   The grid above answers "who has the kindest next six". This answers the
   other half of the question — when each club's good weeks actually fall —
   which is what you plan a wildcard or a bench slot around. Sorted by club
   name so you can find one, rather than by quality, which would make it a
   second leaderboard of the same twenty teams. */
function SeasonRunsBoard({ fixtureEase, lens, baselines, house, lensControl }: {
  fixtureEase: FixtureEaseRow[]
  lens: Lens
  baselines: Map<string, TeamBase>
  /** The same map with nobody re-rated — the scale's yardstick. */
  house: Map<string, TeamBase>
  /** The page's "Rate for" pills, rendered inline with this board's own
   *  filters. They belong on one line — all three change what the same table
   *  shows, and stacking them cost three bands of height above it. */
  lensControl?: ReactNode
}) {
  const wide = useWide()
  const scale = useMemo(() => buildDiffScale(baselines, house), [baselines, house])
  const [half, setHalf] = useState<'all' | 1 | 2>('all')
  const [view, setView] = useState<'ranked' | 'map'>('ranked')

  const runs = useMemo(() => {
    const teams = [...new Set(fixtureEase.map((f) => String(f.team)))]
    return teams.flatMap((team) => bestRuns(fixtureEase, team, lens, scale).map((r) => ({ team, ...r })))
  }, [fixtureEase, lens, scale])

  const shown = useMemo(() => (half === 'all' ? runs : runs.filter((r) => r.half === half)), [runs, half])
  const spansSeason = runs.some((r) => r.half === 2) && runs.some((r) => r.half === 1)

  // Ranking is the whole point of the table, so it is fixed to the score
  // rather than to whatever column was clicked last: rank 1 has to mean the
  // best run, not the alphabetically first club.
  // Ties break on home games — see `bestRuns`. Two runs the model rates the
  // same are not equally worth owning, and the home count is the one thing
  // left that separates them.
  const ranked = useMemo(
    () => [...shown].sort((a, b) => b.advantage - a.advantage || b.home - a.home || a.from - b.from),
    [shown],
  )

  /** Every fixture a club has in the current half — the backdrop the run is
   *  drawn against, so a kind stretch can be seen as kind relative to the rest
   *  rather than only in isolation. */
  const windowAll = useMemo(() => {
    const cache = new Map<string, { gw: number; opponent: string; venue: 'H' | 'A'; diff: number }[]>()
    return (team: string) => {
      const hit = cache.get(team)
      if (hit) return hit
      const out = fixtureEase
        .filter((f) => f.team === team && (half === 'all' || (half === 1 ? f.gw <= 19 : f.gw >= 20)))
        .sort((a, b) => a.gw - b.gw)
        .map((f) => {
          const venue: 'H' | 'A' = String(f.venue) === 'H' ? 'H' : 'A'
          return { gw: f.gw, opponent: String(f.opponent), venue, diff: analyserDiff(String(f.opponent), lens, venue, num(f, 'fdr') ?? 3, scale).diff }
        })
      cache.set(team, out)
      return out
    }
  }, [fixtureEase, half, lens, scale])
  const rankOf = new Map(ranked.map((r, i) => [`${r.team}-${r.half}`, i + 1]))

  const columns: Column<(typeof ranked)[number]>[] = [
    { key: 'rank', header: '#', sortValue: (r) => rankOf.get(`${r.team}-${r.half}`) ?? 0,
      cell: (r) => <span className="font-extrabold text-ink-3 tabular-nums">{rankOf.get(`${r.team}-${r.half}`)}</span> },
    { key: 'team', header: 'Club', sortValue: (r) => r.team,
      cell: (r) => (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <TeamBadge team={r.team} size={15} />
          <span className="font-bold text-ink">{teamLabel(r.team)}</span>
        </span>
      ) },
    { key: 'half', header: 'Half', align: 'center', sortValue: (r) => r.half,
      cell: (r) => <span className="text-[11px] font-semibold text-ink-2">{r.half === 1 ? '1st' : '2nd'}</span> },
    { key: 'gws', header: 'Gameweeks', sortValue: (r) => r.from,
      cell: (r) => <span className="font-semibold whitespace-nowrap text-ink tabular-nums">GW{r.from}–{r.to}</span> },
    { key: 'len', header: 'Games', align: 'center', sortValue: (r) => r.fixtures.length,
      cell: (r) => <span className="font-semibold text-ink tabular-nums">{r.fixtures.length}</span> },
    { key: 'fixtures', header: 'Fixtures', sortValue: () => null,
      cell: (r) => (
        <span className="flex flex-wrap gap-1">
          {r.fixtures.map((f, i) => (
            <span
              key={`${f.gw}-${f.opponent}-${i}`}
              title={`GW${f.gw} · ${f.venue === 'H' ? 'home to' : 'away at'} ${f.opponent} · difficulty ${f.diff.toFixed(1)}`}
              className="rounded-[5px] px-1.5 py-1 text-[10.5px] leading-none font-bold text-ink"
              style={{ background: diffFill(f.diff) }}
            >
              {f.opponent}<span className="ml-0.5 text-ink-2">{f.venue}</span>
            </span>
          ))}
        </span>
      ) },
    { key: 'home', header: 'Home', align: 'center', sortValue: (r) => r.home,
      cell: (r) => <span className="text-ink-2 tabular-nums">{r.home}</span> },
    { key: 'avg', header: 'Avg diff', align: 'right', sortValue: (r) => r.avg,
      cell: (r) => <span className="font-bold text-ink tabular-nums">{r.avg.toFixed(2)}</span> },
    { key: 'score', header: 'Score', align: 'right', sortValue: (r) => r.advantage,
      cell: (r) => <span className="font-extrabold text-accent tabular-nums">{r.advantage.toFixed(1)}</span> },
  ]

  const HALVES: [typeof half, string][] = [['all', 'Whole season'], [1, 'First half'], [2, 'Second half']]

  // The gameweeks the map draws — whatever the half filter leaves in play.
  const mapGws = useMemo(() => {
    const all = [...new Set(fixtureEase.map((f) => f.gw))].sort((a, b) => a - b)
    if (half === 'all') return all
    return all.filter((gw) => (half === 1 ? gw <= 19 : gw >= 20))
  }, [fixtureEase, half])

  /* BELOW EVERY HOOK, not above them. This bailed out at the top, after five
     of the eight hooks in this component — so the first render that produced
     no runs ran five, and the next render that produced some ran eight, and
     React threw #310 for it. That is not theoretical: flipping the ratings
     switch back to Default crashed this page every time, because the switch
     rebuilds `baselines`, `baselines` rebuilds `scale`, and for one render
     `runs` came back empty. Hooks are positional; an early return in the
     middle of them is a bug waiting for the state that triggers it. */
  if (!runs.length) return null

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-sm font-semibold tracking-wide text-ink uppercase">Best Runs of the Season</h3>
        <InfoTip text="Each club's kindest stretch of 3–6 consecutive gameweeks, one before the turn of the year and one after. Score is the total advantage over an average fixture across the whole run — every game below a 3 adds to it, so a long kind run outranks a short perfect one. Ranking on average difficulty instead would always pick the shortest window, because one home banker beats any four games ever assembled. A gameweek with no fixture ends a run." />
      </div>
      <p className="mb-3 text-xs text-ink-2">
        {view === 'ranked'
          ? 'Ranked by score: the lower the difficulty and the longer it holds, the higher it places.'
          : 'Every gameweek, with only each club\u2019s best run lit — read down the page to see when to get on and when to get off.'}
        {spansSeason ? ' Every club gets its best run in each half.' : ' The kindest stretch left in the season.'}
      </p>
      {/* One filter row: what to rate for, which view, which half. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        {lensControl}
        <div className="flex items-center gap-1.5">
          {([['ranked', 'Ranked'], ['map', 'Season map']] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              className={`min-h-9 rounded-full border px-3 text-sm font-medium transition-colors ${
                view === id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {spansSeason && (
          <div className="flex items-center gap-1.5">
            {HALVES.map(([id, label]) => (
              <button
                key={String(id)}
                onClick={() => setHalf(id)}
                className={`min-h-9 rounded-full border px-3 text-sm font-medium transition-colors ${
                  half === id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Shareable: the best runs of the season are the most postable thing on
          this page and had no way out of it. The heading names the settings,
          since a table of clubs and scores means nothing without the lens and
          the half it was read at. */}
      <Exportable
        title={`Best runs — ${view === 'ranked' ? 'ranked' : 'season map'}`}
        ident={
          <div className="mb-2">
            <div className="text-[11px] font-extrabold tracking-[0.14em] text-accent uppercase">Best runs of the season</div>
            <div className="mt-0.5 text-[11px] text-ink-3">
              {LENS_LABEL_ROT[lens]} · {half === 'all' ? 'whole season' : half === 1 ? 'first half' : 'second half'}
            </div>
          </div>
        }
      >
        {view === 'ranked' ? (
          wide ? (
            <SortableTable
              rows={ranked}
              columns={columns}
              initialSort="score"
              initialDir="desc"
              rowKey={(r) => `${r.team}-${r.half}`}
            />
          ) : (
            /* Phone: the run is the row. An eight-column sortable table put a
               609px table in a 368px column, so the club, the span and the
               score stack into a header and the run itself becomes a strip —
               which is the thing being ranked and the thing worth seeing. */
            <div className="overflow-hidden rounded-xl border border-line">
              {ranked.map((r, i) => (
                <div key={`${r.team}-${r.half}`} className="border-b border-line px-3 py-2.5 last:border-0">
                  <div className="flex items-center gap-2.5">
                    <span className="w-4 shrink-0 text-right font-num text-[11px] font-extrabold tabular-nums text-ink-3">{i + 1}</span>
                    <TeamBadge team={r.team} size={17} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-bold text-ink">{teamLabel(r.team)}</span>
                      {/* The question this tab is named after, answered in
                          words: which gameweek to buy, and which to leave. */}
                      <span className="block text-[10.5px] font-semibold text-ink-3">
                        Get on <b className="text-accent-2">GW{r.from}</b> · off after <b className="text-accent-2">GW{r.to}</b> · {r.home} home
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      {/* Difficulty, not an invented score. Every other number
                          on this page is 1–5 with lower kinder; a "score" that
                          ran the other way made the kindest run in the league
                          read as the harshest. */}
                      <span className="font-num text-[15px] font-extrabold tabular-nums" style={{ color: runColor(r.avg) }}>{r.avg.toFixed(2)}</span>
                      <span className="block text-[9px] font-bold tracking-[0.1em] text-ink-3 uppercase">avg diff</span>
                    </span>
                  </div>
                  {/* The run inside the whole window rather than cut out of
                      it, so you can see what it is kinder *than*. Fixtures in
                      the run keep their colour; the rest fade back. */}
                  <div className="mt-2 flex gap-[2px]">
                    {windowAll(r.team).map((f) => {
                      const inRun = f.gw >= r.from && f.gw <= r.to
                      return (
                        <span key={f.gw} className="h-2 flex-1 rounded-[2px]"
                          style={{ background: diffFill(f.diff), opacity: inRun ? 1 : 0.22 }}
                          title={`GW${f.gw} ${f.venue === 'H' ? 'vs' : 'at'} ${teamLabel(f.opponent)} — ${f.diff.toFixed(1)}`} />
                      )
                    })}
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    {r.fixtures.map((f) => (
                      <span key={`${f.gw}-${f.opponent}`} className="flex-1 rounded py-1 text-center text-[9.5px] leading-tight font-bold"
                        style={{ background: `color-mix(in srgb, ${runColor(f.diff)} 26%, transparent)`, color: runColor(f.diff) }}>
                        <span className="block text-[9px] font-semibold opacity-70">GW{f.gw}</span>
                        {f.opponent}
                        <span className="block text-[9px] font-semibold opacity-70">{f.venue}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : (
          <RunsTimeline fixtureEase={fixtureEase} runs={shown} gws={mapGws} lens={lens} scale={scale} />
        )}
      </Exportable>
    </div>
  )
}

/* ── Rotation planner: pick teams and see who to start each gameweek ──────
   For every gameweek we start the team with the kindest fixture (our own
   difficulty), so a rotating pair covers a smoother run than either alone.
   With nothing picked we surface the best-rotating pairs across the league. */
function combos<T>(arr: T[], k: number): T[][] {
  const res: T[][] = []
  const pick: T[] = []
  const rec = (start: number) => {
    if (pick.length === k) { res.push([...pick]); return }
    for (let i = start; i < arr.length; i++) { pick.push(arr[i]); rec(i + 1); pick.pop() }
  }
  rec(0)
  return res
}

const ROT_SIZES = [2, 3, 4, 5] as const
const LENS_LABEL_ROT: Record<Lens, string> = { overall: 'Overall', attack: 'Attack', defence: 'Defence' }
/** Gold, silver, bronze — the site already speaks in medals on the podium and
 *  the tier cards, so the band borrows the same language rather than inventing
 *  a third way of saying "best of these". */
const MEDAL = [
  'linear-gradient(90deg,#F7E3A6,#C9A227)',
  'linear-gradient(90deg,#E4E9EF,#9FB4C7)',
  'linear-gradient(90deg,#E6C0A0,#A9714B)',
]
const RATE_LABEL: Record<GridMode, string> = { diff: 'Difficulty', cs: 'Clean sheets', xg: 'Goals' }

/* A rotation is defensive or attacking, and that one choice settles the rest:
   which fixture metric is worth ranking on, which positions are worth
   fielding, and which rating tells you whether the player behind the club is
   any good. Overall answers none of them well — it is a blend, and a blend is
   what you pick when you have not decided. */
type Side = 'defence' | 'attack'
const SIDE_RATES: Record<Side, GridMode[]> = { defence: ['diff', 'cs'], attack: ['diff', 'xg'] }
const SIDE_POS: Record<Side, ('GKP' | 'DEF' | 'MID' | 'FWD')[]> = {
  defence: ['GKP', 'DEF', 'MID'],
  /* No defenders. An attacking rotation is bought for goals, and a defender's
     attacking score is a different claim on a different scale — it surfaced
     centre-halves as a club's best attacking option, which is not the player
     anyone is rotating for. */
  attack: ['MID', 'FWD'],
}
/** What to show about the club's best player at that position, per side.
 *  A keeper's job is saves; a defender's extra points come from defensive
 *  contribution; a midfielder is the awkward one and genuinely depends on why
 *  you are buying him, which is exactly what the side control has just said. */
const POS_METRIC: Record<Side, Record<string, { key: string; label: string }>> = {
  defence: {
    GKP: { key: 'season_save_score', label: 'Saves' },
    DEF: { key: 'season_dc_score', label: 'Def Con' },
    MID: { key: 'season_dc_score', label: 'Def Con' },
  },
  attack: {
    MID: { key: 'season_goal_score', label: 'Goal threat' },
    FWD: { key: 'season_goal_score', label: 'Goal threat' },
  },
}
const RATE_TIP: Record<GridMode, string> = {
  diff: 'Rank and start on our own fixture difficulty — a blend of what each side is expected to score and concede. The right default when the rotation is not position-specific.',
  cs: 'Rank and start on the clean-sheet chance for that fixture. What you want when the rotation is defenders or a keeper: the starter becomes the one most likely to earn the four points rather than the one with the kindest blended fixture.',
  xg: 'Rank and start on the goals that club is projected to score in that fixture. What you want for an attacking rotation.',
}
const mean = (ds: number[]) => (ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null)

/* ── Rotation planner: pick teams and see who to start each gameweek ──────
   Difficulty is OUR own rating (opponent strength on our team ratings) in the
   chosen lens. You set how many teams are in the rotation (N) and how many you
   actually start each week (K) — every gameweek we start the K with the kindest
   fixtures. With nothing picked we surface the best-rotating groups of size N. */
function RotationPlanner({ ratings, fixtureEase, baselines, house, leagueBase, initialTeams = [] }: {
  ratings: RatingRow[]
  fixtureEase: FixtureEaseRow[]
  baselines: Map<string, TeamBase>
  /** The same map with nobody re-rated — the scale's yardstick. */
  house: Map<string, TeamBase>
  leagueBase: TeamBase
  /** Clubs to open with, from ?rot= — a deep link from a club's page. */
  initialTeams?: string[]
}) {
  const market = useMarketOdds()
  const diffScale = useMemo(() => buildDiffScale(baselines, house), [baselines, house])
  const [teams, setTeams] = useState<string[]>(initialTeams)
  // Ruled out entirely. Separate from "not picked": a club you already own a
  // player from, or one you refuse to buy into, should never be offered as
  // half of a suggested pair.
  const [excluded, setExcluded] = useState<string[]>([])
  // A rotation is only useful if you can actually afford both ends of it, and
  // the classic case is a pair of £4.5m defenders. So the pool can be cut to
  // clubs that field a player at a position within a budget, and every
  // suggestion names the man you'd be buying.
  const [needPos, setNeedPos] = useState<'any' | 'GKP' | 'DEF' | 'MID' | 'FWD'>('any')
  const [maxPrice, setMaxPrice] = useState<number | null>(null)
  const [size, setSize] = useState<(typeof ROT_SIZES)[number]>(2)
  const [startKRaw, setStartKRaw] = useState(1)
  const [win, setWin] = useState<GwWindow>({ from: 1, to: 6, skip: null })
  const [lens, setLens] = useState<Lens>('defence')
  /* What the board ranks and rings on. Difficulty is a blend; rotating
     defenders you want the clean-sheet projection and rotating attackers you
     want goals, and both are already computed for the Goals & Clean Sheets
     tab. The ring genuinely changes hands between them in several gameweeks,
     which is the whole reason this is a control and not a preference. */
  const [rateOn, setRateOn] = useState<GridMode>('diff')
  const side: Side = lens === 'attack' ? 'attack' : 'defence'
  // Changing side can strand the other two controls on an option that no
  // longer exists — goals on a defensive rotation, a keeper on an attacking
  // one. Pull them back to something legal rather than silently filtering on
  // a value the picker no longer shows.
  const setSide = (nextSide: Side) => {
    setLens(nextSide)
    if (!SIDE_RATES[nextSide].includes(rateOn)) setRateOn('diff')
    if (needPos !== 'any' && !SIDE_POS[nextSide].includes(needPos)) setNeedPos('any')
  }

  const allTeams = useMemo(() => [...new Set(fixtureEase.map((f) => f.team))].sort(), [fixtureEase])

  /** Every club's best Defensive Contribution players. DC points land whether
   *  or not the clean sheet does, so two clubs with the same fixtures are not
   *  the same buy if one of them has a 99 in it — and nothing on this board
   *  said so. */
  const dcBy = useMemo(() => {
    // Which rating matters depends on the side you are planning and the
    // position you would buy, so the band answers "who would I actually get
    // here, and is he any good at the job I want him for" rather than always
    // reporting the same number.
    const wanted = needPos === 'any' ? SIDE_POS[side] : [needPos]
    const m = new Map<string, { name: string; pos: string; score: number; label: string; price: number | null }[]>()
    for (const r of ratings) {
      const pos = String(r.position)
      if (!wanted.includes(pos as 'GKP')) continue
      const spec = POS_METRIC[side][pos]
      if (!spec) continue
      const sc = num(r, spec.key)
      if (sc == null) continue
      const price = num(r, 'price')
      // Budget applies here too: a 99 you cannot afford is not a suggestion.
      if (maxPrice != null && (price ?? 99) > maxPrice + 1e-9) continue
      const t = String(r.team)
      const list = m.get(t) ?? []
      list.push({ name: String(r.web_name), pos, score: sc, label: spec.label, price })
      m.set(t, list)
    }
    for (const list of m.values()) list.sort((a, b) => b.score - a.score)
    return m
  }, [ratings, side, needPos, maxPrice])
  const dcMax = useMemo(() => Math.max(1, ...[...dcBy.values()].map((l) => l[0]?.score ?? 0)), [dcBy])

  /* One label for the band, since a mixed group would otherwise need one per
     column. With a position chosen it is that position's metric; with "Anyone"
     it is whatever the side implies most of the time. Hoisted out of the phone
     board because the desktop table needs the same two things and had neither —
     the band was inside a component that only rendered under `!wide`. */
  const bandLabel = needPos === 'any'
    // Both attacking positions now score on the same metric, so the generic
    // label can name it rather than hedging with "Attack".
    ? (side === 'defence' ? 'Def Con' : 'Goal threat')
    : POS_METRIC[side][needPos]?.label ?? ''
  /** Where each club places on the band metric inside THIS rotation. */
  const bandRank = (group: string[]) => {
    const m = new Map<string, number>()
    ;[...group]
      .map((t) => ({ t, s: dcBy.get(t)?.[0]?.score ?? -1 }))
      .sort((a, b) => b.s - a.s)
      .forEach((x, i) => m.set(x.t, i))
    return m
  }

  /** The best player each club can offer inside the budget — highest rated,
   *  not cheapest: at a fixed price cap you want the best man available at
   *  that price, and the whole point of the cap is that it is already set. */
  const pickBy = useMemo(() => {
    const m = new Map<string, RatingRow | null>()
    if (needPos === 'any' && maxPrice == null) return m
    for (const t of allTeams) {
      const cands = ratings.filter((r) =>
        String(r.team) === t &&
        (needPos === 'any' || r.position === needPos) &&
        (maxPrice == null || (num(r, 'price') ?? 99) <= maxPrice + 1e-9))
      cands.sort((a, b) => (num(b, 'season_overall_score') ?? -1) - (num(a, 'season_overall_score') ?? -1))
      m.set(t, cands[0] ?? null)
    }
    return m
  }, [ratings, allTeams, needPos, maxPrice])

  const filtering = needPos !== 'any' || maxPrice != null
  const qualifies = (t: string) => !filtering || !!pickBy.get(t)
  const allGws = useMemo(() => [...new Set(fixtureEase.map((f) => f.gw))].sort((a, b) => a - b), [fixtureEase])
  const gws = useMemo(() => gwsIn(allGws, win), [allGws, win])

  // A team's (easier, if a double) fixture + our difficulty for one gameweek, in
  // the selected lens. Cached; the cache resets when the lens/window change.
  const cellFor = useMemo(() => {
    const cache = new Map<string, { f: FixtureEaseRow; diff: number } | null>()
    return (team: string, gw: number) => {
      const key = team + ':' + gw
      if (cache.has(key)) return cache.get(key)!
      const fs = fixtureEase.filter((f) => f.team === team && f.gw === gw)
      const v = !fs.length ? null : fs
        .map((f) => ({ f, diff: analyserDiff(f.opponent, lens, f.venue, f.fdr, diffScale).diff }))
        .sort((a, b) => a.diff - b.diff)[0]
      cache.set(key, v)
      return v
    }
  }, [fixtureEase, baselines, leagueBase, market, diffScale, lens])

  /** The fixture's value under the chosen lens, and which way is better.
   *  Difficulty is lower-is-kinder; goals and clean sheets are higher-is-
   *  better, so the comparator flips with the control rather than the caller
   *  having to remember which one is on. */
  const rateVal = (team: string, gw: number): number | null => {
    const c = cellFor(team, gw)
    if (!c) return null
    if (rateOn === 'diff') return c.diff
    const p = projectCell(rateOn, baselines.get(team), baselines.get(c.f.opponent), leagueBase, c.f.venue, mktOf(market, team, c.f))
    return p ? p.v : null
  }
  const better = (a: number, b: number) => (rateOn === 'diff' ? a - b : b - a)
  const rateFmt = (v: number) => (rateOn === 'diff' ? v.toFixed(1) : rateOn === 'xg' ? v.toFixed(1) : `${Math.round(v * 100)}%`)

  const changeSize = (n: (typeof ROT_SIZES)[number]) => {
    setSize(n)
    setTeams((s) => s.slice(0, n))
  }

  /* How many clubs the rotation is *aiming* for — the target you set, or the
     number you have already locked if you went past it. Two jobs used to be
     tangled here: `size` also capped locking, so the club past it silently
     refused to select. It no longer caps anything, but it stays the target,
     because "rotate 3, I have locked 2, find me the third" is the whole
     question this planner exists to answer and a rotation derived from the
     locks alone cannot express it. */
  const effSize = Math.max(size, teams.length)
  /* Clamped rather than stored, so unlocking down to a smaller rotation cannot
     strand "start 4 of 2" — a state the Start pills could not even show. */
  const startK = Math.min(startKRaw, Math.max(1, effSize - 1))

  // Best-first fixtures for a group in one gameweek, under whichever lens is
  // selected. This used to be difficulty only, which left the suggestions
  // ranked one way while the board's ring picked another — an export headed
  // "by clean sheets" would have been ranked on something else.
  const rankGw = (group: string[], gw: number) =>
    group.map((t) => ({ t, diff: rateVal(t, gw) })).filter((x): x is { t: string; diff: number } => x.diff != null).sort((a, b) => better(a.diff, b.diff))

  // Combined difficulty if you start the best K of `group` each week.
  const startKAvg = (group: string[], k: number) => {
    const ds: number[] = []
    for (const gw of gws) {
      const r = rankGw(group, gw)
      if (!r.length) continue
      const take = r.slice(0, Math.min(k, r.length))
      ds.push(take.reduce((a, b) => a + b.diff, 0) / take.length)
    }
    return mean(ds)
  }
  // Best you'd do committing to a FIXED K of the group (no rotation) — the
  // yardstick the rotation improves on.
  const fixedKAvg = (group: string[], k: number) => {
    let best: number | null = null
    for (const sub of combos(group, k)) {
      const ds: number[] = []
      for (const gw of gws) {
        const dd = sub.map((t) => rateVal(t, gw)).filter((v): v is number => v != null)
        if (dd.length) ds.push(dd.reduce((a, b) => a + b, 0) / dd.length)
      }
      const a = mean(ds)
      if (a != null && (best == null || better(a, best) < 0)) best = a
    }
    return best
  }

  // Which teams to START each gameweek (the K kindest fixtures).
  const startByGw = new Map<number, Set<string>>()
  for (const gw of gws) startByGw.set(gw, new Set(rankGw(teams, gw).slice(0, startK).map((x) => x.t)))

  // Once for the table, not once per row.
  const dcRank = bandRank(teams)

  const rotAvg = startKAvg(teams, startK)
  const fixedAvg = teams.length ? fixedKAvg(teams, startK) : null

  // Top rotating groups of size N, ranked by the start-K combined difficulty.
  const topGroups = useMemo(() => {
    // Nothing to suggest once the rotation is full, and enumerating it anyway
    // is not free: locking a big rotation would have us build every k-subset
    // of twenty clubs to then discard all but the one already on screen.
    if (teams.length >= effSize) return []
    // Ruled-out clubs never enter the pool, and every suggestion has to carry
    // the ones already picked — "I know I want an Arsenal defender, show me
    // who partners them" is the question this answers.
    const pool = allTeams.filter((t) => !excluded.includes(t) && qualifies(t))
    const out: { group: string[]; combined: number; home: number }[] = []
    for (const group of combos(pool, effSize)) {
      if (!teams.every((t) => group.includes(t))) continue
      const c = startKAvg(group, startK)
      if (c == null) continue
      // Home fixtures across the whole group over the window. Two rotations
      // the model rates identically are not equally attractive; the one
      // playing at home more often is the one to own.
      let home = 0
      for (const t of group) for (const gw of gws) if (cellFor(t, gw)?.f.venue === 'H') home++
      out.push({ group, combined: c, home })
    }
    // Cap each club at two appearances. The kindest club partners well with
    // everyone, so an uncapped list gave Man Utd five of the eight rows — a
    // ranking of one club's fixtures dressed as a ranking of rotations. Locked
    // clubs are exempt: if you have asked to see partners for a side, every
    // row is supposed to contain it.
    const ranked = out.sort((x, y) => better(x.combined, y.combined) || y.home - x.home)
    const seen = new Map<string, number>()
    const spread: typeof out = []
    for (const g of ranked) {
      if (g.group.some((t) => !teams.includes(t) && (seen.get(t) ?? 0) >= 2)) continue
      for (const t of g.group) seen.set(t, (seen.get(t) ?? 0) + 1)
      spread.push(g)
      if (spread.length >= 8) break
    }
    return spread
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTeams, excluded, teams, effSize, startK, gws, cellFor, pickBy, filtering, rateOn])

  const headCls = 'px-2 py-2 text-center text-[11px] font-semibold tracking-wide text-ink-3 uppercase'
  const wide = useWide()
  /** Which suggestion is open on a phone. '' means all closed; null means
   *  untouched, in which case the first one shows. */
  const [openGroup, setOpenGroup] = useState<string | null>(null)
  const pill = (active: boolean) => `min-h-9 rounded-full border px-3 text-sm font-medium transition-colors ${active ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'}`
  const startOpts = Array.from({ length: Math.max(1, effSize - 1) }, (_, i) => i + 1) // 1 … N-1

  /** Who the exported board is about. The clubs, the settings and the number
   *  they earned — a grid of fixtures with no header is unreadable once it
   *  leaves the site. */
  const rotationIdent = (_group: string[], combined: number) => (
    <div className="mb-2 flex items-end gap-2">
      {/* The clubs used to be listed here and it was the same information
          twice — the board's own column headers name them, with their badges,
          directly underneath. A header should say what the picture IS. */}
      <span className="flex-1">
        <span className="block text-[13.5px] font-extrabold tracking-[-0.01em] text-ink">
          GW{gws[0]}–{gws[gws.length - 1]} rotation plan
        </span>
        <span className="block text-[10.5px] font-semibold text-ink-3">
          Start {startK} of {_group.length} · by {RATE_LABEL[rateOn].toLowerCase()}
        </span>
      </span>
      {/* Stacked, not inline. Side by side, "avg diff" first wrapped onto the
          board's header row and then clipped at the frame edge — a label
          fighting the clubs for the same line will always lose one way or the
          other. Two short lines cannot. */}
      <span className="shrink-0 text-right leading-tight">
        <span className="font-num block text-[15px] font-extrabold tabular-nums" style={{ color: rateOn === 'diff' ? runColor(combined) : 'var(--good)' }}>{rateFmt(combined)}</span>
        <span className="block text-[8.5px] font-bold tracking-[0.08em] text-ink-3 uppercase">avg {rateOn === 'diff' ? 'diff' : rateOn === 'cs' ? 'CS' : 'xG'}</span>
      </span>
    </div>
  )

  /* ── The board, turned on its side ────────────────────────────────────────
     Gameweeks down, the rotation's clubs across. Teams down and gameweeks
     across needs a column per gameweek plus a team column, which scrolled
     sideways on a phone; this way a column is the screen divided by the group,
     so every cell has room for the opponent, the venue and the difficulty —
     and it rings as many starters as `startK` rather than the single one a
     six-cell strip could hold. Shared by the open suggestion and the planner
     proper, so they cannot disagree about who starts. */
  const rotationBoard = (group: string[]) => {
    const rank = bandRank(group)
    const starters = (gw: number) => {
      const ranked = group
        .map((t) => ({ t, v: rateVal(t, gw) }))
        .filter((x): x is { t: string; v: number } => x.v != null)
        .sort((a, b) => better(a.v, b.v))
      return new Set(ranked.slice(0, Math.min(startK, ranked.length)).map((x) => x.t))
    }
    return (
      <div className="overflow-hidden rounded-xl border border-line">
        {/* Two clubs get twice the width of four, so the badge and the name
            grow into it rather than sitting small in the middle of a wide
            column. Matters most in the export, where this row is the only
            thing naming the clubs. */}
        <div className="flex gap-1 border-b border-line bg-surface-1 px-2 py-1.5">
          <span className="w-8 shrink-0" />
          {group.map((t) => (
            <span
              key={t}
              className={`flex flex-1 items-center justify-center gap-1.5 font-bold tracking-[0.06em] text-ink-2 uppercase ${
                group.length <= 2 ? 'text-[14px]' : group.length === 3 ? 'text-[12px]' : 'text-[9.5px]'
              }`}
            >
              <TeamBadge team={t} size={group.length <= 2 ? 20 : group.length === 3 ? 16 : 12} />{t}
            </span>
          ))}
        </div>
        {gws.map((gw) => {
          const on = starters(gw)
          return (
            <div key={gw} className="flex items-stretch gap-1 border-b border-line px-2 py-1 last:border-0">
              <span className="flex w-8 shrink-0 items-center text-[9.5px] font-extrabold text-ink-3">GW{gw}</span>
              {group.map((t) => {
                const c = cellFor(t, gw)
                const v = rateVal(t, gw)
                if (!c || v == null) return <span key={t} className="flex-1 rounded bg-surface-2 py-1 text-center text-[10px] text-ink-3">—</span>
                const start = on.has(t)
                // Colour always comes from the difficulty, whichever lens is
                // ranking. Recolouring the whole board per lens would mean
                // green meant three different things across one tab.
                return (
                  /* A real border in a literal colour, not an inset
                     box-shadow in var(--accent). Two things a rasteriser can
                     drop: html2canvas ignores box-shadow entirely on the
                     fallback path, and a custom property need not resolve
                     inside a cloned tree — so the export lost the one mark
                     that says which fixture you would actually start. Every
                     cell carries the border and only its colour changes, so
                     the layout is identical either way. */
                  <span
                    key={t}
                    className={`flex-1 rounded border-2 py-1 text-center text-[10.5px] leading-tight font-bold text-ink ${start ? '' : 'opacity-45'}`}
                    style={{ background: diffFill(c.diff), borderColor: start ? '#c9a227' : 'transparent' }}
                    title={`${c.f.venue === 'H' ? 'vs' : 'at'} ${teamLabel(c.f.opponent)} — ${RATE_LABEL[rateOn].toLowerCase()} ${rateFmt(v)}${start ? ' · START' : ''}`}
                  >
                    {c.f.opponent}
                    <span className="block text-[9px] font-semibold opacity-70">{c.f.venue} · {rateFmt(v)}</span>
                  </span>
                )
              })}
            </div>
          )
        })}
        {/* Def Con under the fixtures. A second dimension of the same choice,
            not an annotation on the first: the points land whether or not the
            clean sheet does, and position matters — a 99 midfielder and a 99
            defender are different buys at the same score. */}
        <div className="flex gap-1 border-t border-line bg-surface-2/40 px-2 py-1.5">
          <span className="flex w-8 shrink-0 items-center text-[9px] leading-tight font-extrabold tracking-[0.06em] text-ink-3 uppercase">
            {bandLabel}
          </span>
          {group.map((t) => {
            const best = dcBy.get(t)?.[0]
            if (!best) return <span key={t} className="flex-1 self-center text-center text-[9px] text-ink-3">{maxPrice != null ? 'None in budget' : '—'}</span>
            return (
              <span key={t} className="min-w-0 flex-1 text-center" title={`${best.name} (${best.pos})${best.price != null ? ` £${best.price}m` : ''} — ${best.label} ${best.score.toFixed(0)} of 100`}>
                <span className="block truncate text-[9.5px] font-bold text-ink">{best.name}</span>
                <span className="block text-[9px] text-ink-3">{best.pos}{best.price != null ? ` £${best.price}m` : ''} · {best.score.toFixed(0)}</span>
                {/* Gold, silver, bronze by rank inside this rotation. A single
                    grey bar said "here is a number" and nothing else; the
                    medal says which of these clubs has the better man at the
                    job, which is the comparison the row exists to make. */}
                <span className="mt-1 block h-[4px] overflow-hidden rounded-full bg-surface-3">
                  <span className="block h-full rounded-full" style={{ width: `${Math.round((best.score / dcMax) * 100)}%`, background: MEDAL[Math.min(2, rank.get(t) ?? 2)] }} />
                </span>
              </span>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold tracking-wide text-ink-2 uppercase">
        Rotation Planner
        <InfoTip text="Difficulty is our own rating — opponent strength on our team Attack/Defence ratings, in the lens you choose. Lock in as many clubs as you want to rotate and set how many you start each week; we always start the ones with the kindest fixtures. Rotate sets the size of the suggested combinations — it does not limit how many you can lock." />
      </h2>
      <p className="mb-3 text-sm text-ink-3">Choose how many to start each week, the window and the lens — then lock in as many clubs as you want to rotate, or pick a top combination.</p>

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Rotate</span>
          {/* Reads the live rotation, not the stored suggestion size, so it
              cannot say 2 while five clubs are locked. Past the largest pill
              nothing is lit, which is the truth rather than a wrong number. */}
          {ROT_SIZES.map((n) => <button key={n} onClick={() => changeSize(n)} className={pill(effSize === n)}>{n}</button>)}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Start</span>
          {startOpts.map((k) => <button key={k} onClick={() => setStartKRaw(k)} className={pill(startK === k)}>{k}</button>)}
        </div>
        <WindowPicker value={win} all={allGws} onChange={setWin} />
        {/* Defence or attack, and nothing else. Overall is a blend, which is
            what you pick when you have not decided — and it left the two
            controls below offering options that made no sense together, like
            a goalkeeper rotation ranked on projected goals. */}
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Rotating</span>
          {(['defence', 'attack'] as const).map((sd) => (
            <span key={sd} className="flex items-center gap-1">
              <button onClick={() => setSide(sd)} className={pill(side === sd)}>{sd === 'defence' ? 'Defence' : 'Attack'}</button>
              <InfoTip text={LENS_TIP[sd]} />
            </span>
          ))}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        {/* Where "Must field" used to be. That control filtered which clubs
            could be suggested by whether they field a player at a position —
            a question you ask once you have a rotation, not while choosing
            one, and with the defaults on it did nothing at all. This is the
            control that changes what the board answers. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Rate on</span>
          {SIDE_RATES[side].map((m) => (
            <span key={m} className="flex items-center gap-1">
              <button onClick={() => setRateOn(m)} className={pill(rateOn === m)}>{RATE_LABEL[m]}</button>
              <InfoTip text={RATE_TIP[m]} />
            </span>
          ))}
        </div>
        {/* Affordability, demoted to a select. Still the reason most rotations
            exist, but it belongs beside the price it works with. */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="rot-pos" className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Fields a</label>
          <select
            id="rot-pos"
            value={needPos}
            onChange={(e) => setNeedPos(e.target.value as typeof needPos)}
            className={`${pill(needPos !== 'any')} appearance-none bg-surface-1 pr-7`}
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a9a294' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.5rem center', backgroundSize: '0.85rem',
            }}
          >
            <option value="any">Anyone</option>
            {SIDE_POS[side].map((pos) => <option key={pos} value={pos}>{pos}</option>)}
          </select>
        </div>
        {/* A select, not chips. Six price options in a row that had no overflow
            container pushed the whole document to 461px inside a 390px phone —
            not a scrolling strip but a page-level sideways scroll, taking the
            header, the tabs and the results with it. It is also the one control
            here with an obvious natural order, which is what a select is for. */}
        <div className="flex items-center gap-1.5">
          <label htmlFor="rot-maxprice" className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Up to</label>
          <select
            id="rot-maxprice"
            value={maxPrice == null ? 'any' : String(maxPrice)}
            onChange={(e) => setMaxPrice(e.target.value === 'any' ? null : Number(e.target.value))}
            className={`${pill(maxPrice != null)} appearance-none bg-surface-1 pr-7`}
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23a9a294' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 0.5rem center',
              backgroundSize: '0.85rem',
            }}
          >
            <option value="any">Any price</option>
            {/* Up to £15m. Capping at £6 assumed every rotation is a pair of
                cheap defenders; a premium-forward rotation is a real thing and
                the old ladder could not express it. */}
            {([4, 4.5, 5, 5.5, 6, 6.5, 7, 8, 9, 10, 12, 15] as const).map((v) => (
              <option key={v} value={v}>£{v.toFixed(1)}m</option>
            ))}
          </select>
        </div>
      </div>

      {/* Team chips — three states on one control, because two rows of twenty
          clubs is worse than one rule to learn. */}
      <p className="mb-1.5 text-[11px] text-ink-3">Tap a club to lock it into the rotation, tap again to rule it out of the suggestions.</p>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {allTeams.map((t) => {
          const on = teams.includes(t)
          const out = excluded.includes(t)
          const ok = qualifies(t)
          /* Only ever disabled for not fielding anyone you could buy. How many
             clubs are already locked is not a reason to refuse another one. */
          const full = !on && !out && !ok
          const cycle = () => {
            if (on) { setTeams(teams.filter((x) => x !== t)); setExcluded([...excluded, t]); return }
            if (out) { setExcluded(excluded.filter((x) => x !== t)); return }
            setTeams([...teams, t])
          }
          return (
            <button
              key={t}
              onClick={cycle}
              disabled={full}
              title={on ? 'Locked in — tap to rule out' : out ? 'Ruled out — tap to clear' : !ok ? `No ${needPos === 'any' ? 'player' : needPos} here at this price` : 'Tap to lock into the rotation'}
              className={`flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-sm font-medium transition-colors ${
                on ? 'border-accent bg-accent-soft text-accent'
                  : out ? 'border-bad/50 text-ink-3 line-through opacity-60'
                  : full ? 'border-line-mid text-ink-3 opacity-40'
                  : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
              }`}
            >
              <TeamBadge team={t} size={14} />{t}
            </button>
          )
        })}
        {(teams.length > 0 || excluded.length > 0) && (
          <button onClick={() => { setTeams([]); setExcluded([]) }} className="min-h-9 rounded-full px-2.5 text-sm font-medium text-ink-3 hover:text-ink">Clear</button>
        )}
      </div>

      {/* The rotations board's own heading is inside the captured node and
          already names the settings, so no `ident` — it would print twice. */}
      {/* Suggestions until the rotation is actually full. This used to cut over
          at two clubs, so asking to rotate three and locking two dropped you
          straight onto the board for the pair — the one moment you most want a
          recommendation, since the question is now narrow enough to have a
          real answer: which single club completes *these two* best. The engine
          could always answer it (every group it builds contains the locked
          clubs); nothing ever asked. */}
      {teams.length < effSize ? (
        <div>
          <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">
            {teams.length
              ? `Best ${effSize - teams.length === 1 ? 'club' : `${effSize - teams.length} clubs`} to add · start ${startK} of ${effSize}`
              : `Top rotations · start ${startK} of ${effSize}`} · next {gws.length} · {LENS_LABEL_ROT[lens]}
          </div>
          <div className="overflow-hidden rounded-xl border border-line">
            {topGroups.map((g, i) => {
              const key = g.group.join('')
              // On a phone a suggestion opens in place. Tapping used to load
              // the rotation into the planner, which replaced the whole list —
              // the only way back to the other suggestions was Clear. The
              // first one is open on arrival so the board is visible without
              // anyone having to discover that the row is a control.
              const open = !wide && (openGroup ?? topGroups[0]?.group.join('')) === key
              return (
              <div key={key} className="border-b border-line last:border-0">
              <button
                onClick={() => (wide ? setTeams(g.group) : setOpenGroup(open ? '' : key))}
                aria-expanded={wide ? undefined : open}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-surface-2/50"
              >
                <span className="w-5 shrink-0 text-center font-num text-xs tabular-nums text-ink-3">{i + 1}</span>
                {/* Short codes on a phone: five full club names do not fit a
                    390px row, and the badge already carries the identity. */}
                <span className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-1 font-medium text-ink">
                  {/* Locked clubs first, so the one being suggested is always
                      last and the eight rows differ only in their final name.
                      Alphabetical order buried it mid-row on any group whose
                      candidate sorted early. */}
                  {[...g.group].sort((a, z) => Number(teams.includes(z)) - Number(teams.includes(a))).map((t, k) => (
                    <span key={t} className="flex items-center gap-1.5">{k > 0 && <span className="text-ink-3">+</span>}<TeamBadge team={t} size={16} />{wide ? teamLabel(t) : t}</span>
                  ))}
                </span>
                {filtering && (
                  <span className="hidden shrink-0 text-right text-[11px] text-ink-2 sm:block">
                    {g.group.map((t) => {
                      const pk = pickBy.get(t)
                      return pk ? <span key={t} className="block whitespace-nowrap"><b className="text-ink">{String(pk.web_name)}</b> £{num(pk, 'price')}m</span> : null
                    })}
                  </span>
                )}
                <span className="shrink-0 text-right">
                  <span className="font-num text-sm font-semibold tabular-nums" style={{ color: rateOn === 'diff' ? runColor(g.combined) : 'var(--good)' }}>{rateFmt(g.combined)}</span>
                  <span className="ml-1 text-[10px] text-ink-3">avg {rateOn === 'diff' ? 'diff' : rateOn === 'cs' ? 'CS' : 'xG'}</span>
                </span>
                {!wide && (
                  <span className={`shrink-0 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`}><Icon name="chevron-right" size={14} className="rotate-90" /></span>
                )}
              </button>
              {open && (
                <div className="border-t border-line px-2 pt-2 pb-3">
                  {/* The share is on the board, not on the page. Wrapping the
                      whole suggestions list exported eight collapsed rows and
                      the filter chrome around them; the artefact worth sending
                      is this one rotation's fixtures. */}
                  <Exportable variant="below" title={`GW${gws[0]}–${gws[gws.length - 1]} rotation plan — ${g.group.join(' + ')}`} ident={rotationIdent(g.group, g.combined)}>
                    {rotationBoard(g.group)}
                  </Exportable>
                </div>
              )}
              </div>
            )})}
            {topGroups.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-ink-3">
                {filtering ? 'No rotation fits that budget — try a higher cap or a different position.' : 'No fixtures to rank yet.'}
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-ink-3">{rateOn === 'diff' ? 'Lower is kinder' : 'Higher is better'} — the combined {RATE_LABEL[rateOn].toLowerCase()} if you always start the {startK} best fixture{startK > 1 ? 's' : ''} in the group.</p>
        </div>
      ) : (
        <>
          {rotAvg != null && fixedAvg != null && (
            <div className="mb-4 rounded-xl border border-line bg-surface-1/60 p-4 text-sm">
              Starting the best {startK} of these {teams.length} each week averages{' '}
              <strong className="text-good">{rateFmt(rotAvg)}</strong> {RATE_LABEL[rateOn].toLowerCase()} over the next {gws.length} — versus{' '}
              <strong className="text-ink">{rateFmt(fixedAvg)}</strong> if you fixed the best {startK} and never rotated.
              {rotAvg < fixedAvg - 0.1 ? ' The rotation is the smoother run.' : ' Rotation adds little over just holding the best here.'}
            </div>
          )}
          {/* ── Phone: the board turned on its side ────────────────────────
              Teams down and gameweeks across needs a column per gameweek plus
              a team column, so it scrolled sideways on a phone — and the strip
              that replaced it could only ever ring one starter, however many
              you had asked to field. Gameweeks down and clubs across makes a
              column the phone divided by the group instead of by the window,
              which leaves room for the opponent, the venue and the difficulty
              in every cell, and rings as many as `startK`. */}
          {!wide ? (
            <Exportable variant="below" title={`GW${gws[0]}–${gws[gws.length - 1]} rotation plan — ${teams.join(' + ')}`} ident={rotationIdent(teams, rotAvg ?? 0)}>
              {rotationBoard(teams)}
            </Exportable>
          ) : (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-1">
                  <th className="sticky left-0 z-10 bg-surface-1 px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Team</th>
                  {gws.map((gw) => <th key={gw} className={headCls}>GW{gw}</th>)}
                  {/* The same band the phone board carries under its fixtures.
                      Clubs are rows here rather than columns, so it is a column
                      rather than a strip — and it sits beside the club whose
                      fixtures it qualifies. */}
                  {/* headCls centres, and the cells under this one are left
                      aligned — so it gets its own alignment rather than the
                      shared class. */}
                  <th className="px-3 py-2 text-left text-[11px] font-semibold tracking-wide whitespace-nowrap text-ink-3 uppercase">{bandLabel}</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((t) => (
                  <tr key={t} className="border-b border-line last:border-0">
                    <td className="sticky left-0 z-10 bg-surface-1 px-3 py-2">
                      <span className="flex items-center gap-2 font-medium whitespace-nowrap text-ink"><TeamBadge team={t} size={16} />{teamLabel(t)}</span>
                    </td>
                    {gws.map((gw) => {
                      const c = cellFor(t, gw)
                      const start = startByGw.get(gw)?.has(t)
                      if (!c) return <td key={gw} className="px-1.5 py-1.5 text-center text-ink-3">—</td>
                      const bg = diffFill(c.diff)
                      return (
                        <td key={gw} className="px-1.5 py-1.5 text-center">
                          <span className={`inline-block w-full min-w-[54px] rounded px-1 py-1 text-[11px] font-semibold whitespace-nowrap ${start ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface-1' : 'opacity-70'}`} style={{ background: bg }} title={`${c.f.venue === 'H' ? 'vs' : 'at'} ${teamLabel(c.f.opponent)} — difficulty ${c.diff.toFixed(1)}${start ? ' · START' : ''}`}>
                            <span className="block text-[10px] leading-tight text-ink-2">{c.f.opponent} ({c.f.venue})</span>
                            <span className="font-num block text-[12px] leading-tight font-bold text-ink tabular-nums">{c.diff.toFixed(1)}</span>
                          </span>
                        </td>
                      )
                    })}
                    {(() => {
                      const best = dcBy.get(t)?.[0]
                      if (!best) return <td className="px-3 py-2 text-center text-[11px] text-ink-3">{maxPrice != null ? 'None in budget' : '—'}</td>
                      return (
                        <td className="px-3 py-2" title={`${best.name} (${best.pos})${best.price != null ? ` £${best.price}m` : ''} — ${best.label} ${best.score.toFixed(0)} of 100`}>
                          <span className="block text-[12px] leading-tight font-bold whitespace-nowrap text-ink">{best.name}</span>
                          <span className="block text-[10px] leading-tight text-ink-3">{best.pos}{best.price != null ? ` £${best.price}m` : ''} · {best.score.toFixed(0)}</span>
                          {/* Gold, silver, bronze by rank inside this rotation,
                              exactly as on the phone: which of these clubs has
                              the better man at the job. */}
                          <span className="mt-1 block h-[4px] w-full max-w-[90px] overflow-hidden rounded-full bg-surface-3">
                            <span className="block h-full rounded-full" style={{ width: `${Math.round((best.score / dcMax) * 100)}%`, background: MEDAL[Math.min(2, dcRank.get(t) ?? 2)] }} />
                          </span>
                        </td>
                      )
                    })()}
                  </tr>
                ))}
                <tr className="bg-surface-1/60">
                  <td className="sticky left-0 z-10 bg-surface-1 px-3 py-2 text-[11px] font-semibold tracking-wide text-accent uppercase">Start {startK}</td>
                  {gws.map((gw) => {
                    const starters = [...(startByGw.get(gw) ?? [])]
                    return (
                      <td key={gw} className="px-1.5 py-2 text-center">
                        {starters.length ? (
                          <span className="flex flex-wrap items-center justify-center gap-1">
                            {starters.map((t) => <span key={t} className="inline-flex items-center gap-0.5 text-[11px] font-medium text-ink"><TeamBadge team={t} size={12} />{t}</span>)}
                          </span>
                        ) : <span className="text-ink-3">—</span>}
                      </td>
                    )
                  })}
                  {/* Keeps the row's cell count matching the header now that a
                      band column exists; nothing to start in it. */}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
            <span>Difficulty:</span>
            {([1, 2, 3, 4, 5] as const).map((d) => <span key={d} className="rounded px-1.5 py-0.5 font-semibold text-ink-2" style={{ background: diffFill(d) }}>{d}</span>)}
            <span>· ringed = starting that week (the rest are benched)</span>
          </div>
        </>
      )}
    </div>
  )
}

/** Says where the numbers come from. Bookmakers price the next gameweek or
 *  two and no further, so the grid is part market, part model — and it should
 *  be obvious which, rather than implied. */
function MarketNote({ market }: { market: MarketOdds | null }) {
  const gws = useMemo(() => {
    const set = new Set<number>()
    for (const k of market?.byKey.keys() ?? []) {
      const gw = Number(k.split(':')[1])
      if (Number.isFinite(gw)) set.add(gw)
    }
    return [...set].sort((a, b) => a - b)
  }, [market])
  if (!gws.length) return null
  const span = gws.length === 1 ? `Gameweek ${gws[0]}` : `Gameweeks ${gws[0]}–${gws[gws.length - 1]}`
  return (
    <p className="mb-3 -mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
      <span className="inline-block size-1.5 rounded-full bg-accent" />
      <span>
        <span className="font-semibold text-ink-2">{span}</span> use live bookmaker odds — the goals the market expects each
        team to score and concede. Later weeks use our own model until the books price them.
      </span>
      <InfoTip text="Match-result and over/under odds are refreshed daily and solved into an expected-goals figure for each side of every fixture. Where a fixture is priced, that number drives its projected goals, clean-sheet odds and difficulty; beyond the market's horizon the grid falls back to team strength from the season's underlying numbers. No odds are shown or sold — only what they imply." />
    </p>
  )
}

/* ── Fixture grid: one column per gameweek, orderable by any week ──────────────
   Rows are teams; each gameweek is its own column showing the opponent, coloured
   by OUR own difficulty (opponent strength from our team ratings) in the chosen
   lens. Click any GW header (or the Run column) to rank teams by that week; tap a
   team to expand a scouting read of where its upcoming opponents are weak. */
function FixtureGrid({
  fixtureEase, gws, lens, mode, baselines, house, leagueBase, profiles, league,
}: {
  fixtureEase: FixtureEaseRow[]
  gws: number[]
  lens: Lens
  mode: GridMode
  baselines: Map<string, TeamBase>
  /** The same map with nobody re-rated — the scale's yardstick. */
  house: Map<string, TeamBase>
  leagueBase: TeamBase
  profiles: Map<string, Profile>
  league: Profile
}) {
  const market = useMarketOdds()
  const wide = useWide()
  const diffScale = useMemo(() => buildDiffScale(baselines, house), [baselines, house])
  const [sortKey, setSortKey] = useState<number | 'run' | 'team'>('run')
  // Difficulty: ascending = easiest first. Projections: descending = most
  // goals / best clean-sheet odds first.
  const [dir, setDir] = useState<'asc' | 'desc'>(mode === 'diff' ? 'asc' : 'desc')
  const [open, setOpen] = useState<string | null>(null)

  const gwSet = useMemo(() => new Set(gws), [gws])

  // One place where a fixture becomes numbers, so the difficulty grid, the two
  // projection grids and the written read are all quoting the same model.
  const lamOf = (team: string, f: { gw: number; opponent: string; venue: 'H' | 'A' }) =>
    lambdasFor(baselines.get(team), baselines.get(f.opponent), leagueBase, f.venue, mktOf(market, team, f))
  // Difficulty is a property of the opponent and the venue, so it needs no
  // team argument — the projections below still do.
  const diffOf = (f: FixtureEaseRow) => analyserDiff(f.opponent, lens, f.venue, f.fdr, diffScale)

  const rows = useMemo(() => {
    const teams = [...new Set(fixtureEase.map((f) => f.team))]
    return teams.map((team) => {
      const byGw = new Map<number, FixtureEaseRow[]>()
      const opponents: string[] = []
      let sum = 0
      let count = 0
      let usedFdr = false
      for (const f of fixtureEase) {
        if (f.team !== team || !gwSet.has(f.gw)) continue
        if (!byGw.has(f.gw)) byGw.set(f.gw, [])
        byGw.get(f.gw)!.push(f)
        opponents.push(f.opponent)
        if (mode === 'diff') {
          const { diff, ours } = diffOf(f)
          if (!ours) usedFdr = true
          sum += diff
          count++
        } else {
          const p = projectCell(mode, baselines.get(team), baselines.get(f.opponent), leagueBase, f.venue, mktOf(market, team, f))
          if (p) {
            if (p.assumed) usedFdr = true
            sum += p.v
            count++
          }
        }
      }
      // Difficulty runs average; projection runs are plain sums (total xG /
      // expected clean sheets over the window).
      return { team, byGw, opponents, run: count ? (mode === 'diff' ? sum / count : sum) : null, usedFdr }
    })
  }, [fixtureEase, gwSet, lens, mode, diffScale, baselines, leagueBase, market])

  /* ── Projection colour: five bands either side of a normal fixture ─────────
     The old scale was a single gold tint over hard-coded 0.7–2.4 anchors. On
     the real spread that pinned 6.9% of cells at the pale floor, clipped 5.0%
     at the ceiling, and squeezed the middle half of the data (p25–p75, a range
     of just 0.57 xG) into a third of the ramp — so the cells you actually
     compare all looked alike.

     Now the midpoint is the median fixture on screen and the spread comes from
     the 10th and 90th percentiles, so a cell reads on its own: green means
     better than a normal week without having to scan its neighbours. Five
     steps rather than a smooth ramp, because the eye judges a step far better
     than a gradient when comparing across a row — and because it matches the
     1–5 grammar already on the difficulty tab. */
  const scale = useMemo(() => {
    if (mode === 'diff') return null
    const vals: number[] = []
    for (const f of fixtureEase) {
      if (!gwSet.has(f.gw)) continue
      const p = projectCell(mode, baselines.get(f.team), baselines.get(f.opponent), leagueBase, f.venue, mktOf(market, f.team, f))
      if (p) vals.push(p.v)
    }
    if (vals.length < 8) return null
    vals.sort((a, b) => a - b)
    const q = (t: number) => vals[Math.min(vals.length - 1, Math.floor(t * vals.length))]
    const mid = q(0.5), lo = q(0.1), hi = q(0.9)
    return { mid, lo, hi }
  }, [fixtureEase, gwSet, mode, baselines, leagueBase, market])

  /** −1 (well under a normal fixture) … +1 (well over). */
  const deviation = (v: number) => {
    if (!scale) return 0
    return v >= scale.mid
      ? (scale.hi > scale.mid ? Math.min(1, (v - scale.mid) / (scale.hi - scale.mid)) : 0)
      : (scale.mid > scale.lo ? Math.max(-1, (v - scale.mid) / (scale.mid - scale.lo)) : 0)
  }

  const bandFill = (v: number): string => bandOf(deviation(v))

  /* Every club's average difficulty over this window — the yardstick the
     written read ranks a run against. Always difficulty, whichever grid is on
     screen, so the sentence doesn't change meaning with the tab. */
  const runAverages = useMemo(() => {
    const out: number[] = []
    for (const team of new Set(fixtureEase.map((f) => f.team))) {
      let sum = 0, count = 0
      for (const f of fixtureEase) {
        if (f.team !== team || !gwSet.has(f.gw)) continue
        sum += analyserDiff(f.opponent, lens, f.venue, f.fdr, diffScale).diff
        count++
      }
      if (count) out.push(sum / count)
    }
    return out
  }, [fixtureEase, gwSet, lens, diffScale])

  // A team's value in one gameweek (blanks → null; doubles → avg diff / summed projection).
  const gwVal = (r: (typeof rows)[number], gw: number): number | null => {
    const fs = r.byGw.get(gw)
    if (!fs || !fs.length) return null
    if (mode === 'diff') return fs.reduce((s, f) => s + diffOf(f).diff, 0) / fs.length
    let sum = 0
    let any = false
    for (const f of fs) {
      const p = projectCell(mode, baselines.get(r.team), baselines.get(f.opponent), leagueBase, f.venue, mktOf(market, r.team, f))
      if (p) { sum += p.v; any = true }
    }
    return any ? sum : null
  }

  /** The best projected figure in each gameweek column — the one worth
   *  planning around. Only for the projection modes: on the difficulty grid
   *  the colour already says which fixture is the kindest. */
  const bestByGw = useMemo(() => {
    const m = new Map<number, number>()
    if (mode === 'diff') return m
    for (const gw of gws) {
      let best: number | null = null
      for (const r of rows) {
        const v = gwVal(r, gw)
        if (v != null && (best == null || v > best)) best = v
      }
      if (best != null) m.set(gw, best)
    }
    return m
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, gws, mode, lens, baselines, leagueBase, market])

  const sorted = useMemo(() => {
    if (sortKey === 'team') {
      const by = [...rows].sort((a, b) => teamLabel(a.team).localeCompare(teamLabel(b.team)))
      return dir === 'asc' ? by : by.reverse()
    }
    const val = (r: (typeof rows)[number]) => (sortKey === 'run' ? r.run : gwVal(r, sortKey))
    return [...rows].sort((a, b) => {
      const av = val(a)
      const bv = val(b)
      if (av == null && bv == null) return a.team.localeCompare(b.team)
      if (av == null) return 1 // teams with no fixture that week sink to the bottom
      if (bv == null) return -1
      return dir === 'asc' ? av - bv : bv - av
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, dir, lens, mode])

  const clickHeader = (key: number | 'run' | 'team') => {
    if (sortKey === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      // Best first on a column you have just picked, whichever "best" means
      // here: kindest fixture for difficulty, most goals or the highest
      // clean-sheet chance for the projections. Ascending for everything was
      // right for difficulty and exactly backwards for the other two — the
      // first tap on an xG column put the leanest attack in the league at the
      // top. Club stays A–Z, which is the only order a name has.
      setDir(key === 'team' || mode === 'diff' ? 'asc' : 'desc')
    }
  }
  const arrow = (key: number | 'run' | 'team') => (sortKey === key ? (dir === 'asc' ? ' ↑' : ' ↓') : '')

  const headCls = 'cursor-pointer select-none px-2 py-2 text-center text-[11px] font-semibold tracking-wide text-ink-3 uppercase transition-colors hover:text-ink'
  const colSpan = gws.length + 2

  /* ── Phone: a league ladder, not a grid ────────────────────────────────────
     Projected goals and clean sheets are league questions — who is best at
     this over the window — and a ranking is a comparison, so every club has to
     be on screen in the same shape. The wide grid answers them by scrolling
     sideways, which on a phone showed three of six gameweeks with no scrollbar
     to say so: the half you could not see looked like it did not exist.

     Difficulty keeps the grid at every width. It is read down a single club's
     run rather than across the division, and that is what the grid is good at.

     Same rows, same percentile colour scale and same totals as the table below
     — this is a second rendering of one model, not a second model. */
  /* ── Phone, difficulty: one card per club ─────────────────────────────────
     Difficulty is read down a single club's run, so the club is the card and
     its gameweeks are a strip that fits because the card owns the full width.
     The wide grid put three of six gameweeks on screen behind a hidden
     scrollbar. Sorted kindest first, so the ranking is the scroll order. */
  const diffCards = !wide && mode === 'diff' && (
    <div className="mb-8">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-3">
        <span>All {sorted.length} clubs over {gws.length} gameweeks, kindest run first. Tap a club for the read on its run.</span>
        <InfoTip text={MODE_TIP.diff} />
      </div>
      {sorted.map((r) => (
        <div key={r.team} className="mb-2 overflow-hidden rounded-xl border border-line bg-surface-1/60">
          <button onClick={() => setOpen((o) => (o === r.team ? null : r.team))} className="w-full px-3 pt-2.5 pb-2 text-left">
            <span className="flex items-center gap-2.5">
              <TeamBadge team={r.team} size={20} />
              <span className="flex-1 truncate text-[14.5px] font-bold text-ink">{teamLabel(r.team)}</span>
              <span className="font-num text-[15px] font-extrabold tabular-nums" style={{ color: r.run == null ? 'var(--ink-3)' : runColor(r.run) }}>
                {r.run == null ? '–' : r.run.toFixed(2)}
              </span>
              <span className="text-[9px] font-bold tracking-[0.1em] text-ink-3 uppercase">avg</span>
            </span>
            <span className="mt-2 flex gap-1">
              {gws.map((gw) => {
                const fs = r.byGw.get(gw) ?? []
                if (!fs.length) return (
                  <span key={gw} className="flex-1 rounded bg-surface-2 py-1 text-center text-[9.5px] leading-tight font-bold text-ink-3">
                    <span className="block text-[9px] opacity-70">GW{gw}</span>–
                    {/* Same four lines as a played week, or a blank makes the
                        whole row jump a line shorter than its neighbours. */}
                    <span className="font-num block text-[11px] font-extrabold tabular-nums">–</span>
                    <span className="block text-[9px] opacity-70">&nbsp;</span>
                  </span>
                )
                const f = fs[0]
                const d = diffOf(f).diff
                return (
                  <span key={gw} className="flex-1 rounded py-1 text-center text-[9.5px] leading-tight font-bold text-ink" style={{ background: diffFill(d) }}>
                    <span className="block text-[9px] font-semibold opacity-70">GW{gw}</span>
                    {f.opponent}
                    {/* THE RATING ITSELF, which this cell computed and then threw
                        away — `d` set the background and was never printed, so a
                        phone got the colour and the desktop grid got the colour
                        AND the number. Five washes cannot carry a 1–5 scale on
                        their own: two fixtures a full point apart share a band,
                        and at the hard end the colour saturates while the number
                        keeps moving, which is precisely where a re-rated club
                        ends up. */}
                    <span className="font-num block text-[11px] font-extrabold tabular-nums">{d.toFixed(1)}</span>
                    <span className="block text-[9px] font-semibold opacity-70">{f.venue}{fs.length > 1 ? ' ×2' : ''}</span>
                  </span>
                )
              })}
            </span>
          </button>
          {open === r.team && (
            <div className="border-t border-line px-3 py-2.5">
              <RunRead
                team={r.team}
                fixtures={gws.flatMap((gw) => (r.byGw.get(gw) ?? []).map((f) => {
                  const l = lamOf(r.team, f)
                  return { gw, opponent: f.opponent, venue: f.venue, diff: diffOf(f).diff, xg: l ? l.for : null, cs: l ? Math.exp(-l.against) : null }
                }))}
                profiles={profiles} league={league} usedFdr={r.usedFdr} n={gws.length}
                leagueRuns={runAverages}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  )
  if (diffCards) return diffCards

  const ladder = !wide && mode !== 'diff' && (
    <div className="mb-8">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-3">
        <span>All {sorted.length} clubs, ranked over {gws.length} gameweeks. Tap a club for the read on its run.</span>
        <InfoTip text={MODE_TIP[mode] + ' Promoted opponents have no top-flight baseline yet, so a league-average opponent is assumed and the cell is marked with a dot.'} />
      </div>
      <div className="overflow-hidden rounded-xl border border-line">
        {/* Every column sorts, the same as the wide grid: tap a gameweek to
            rank the league by that week, tap the total to go back to the
            window. Without it the ladder answered one question and the phone
            reader could not ask another. */}
        <div className="flex items-center gap-1.5 border-b border-line bg-surface-1 px-2 py-1 text-[9.5px] font-bold tracking-[0.1em] text-ink-3 uppercase">
          <button onClick={() => clickHeader('team')} className="w-[76px] shrink-0 pl-5 text-left transition-colors hover:text-ink">Club{arrow('team')}</button>
          <span className="flex flex-1 gap-1">
            {gws.map((gw) => (
              <button key={gw} onClick={() => clickHeader(gw)}
                className={`flex-1 py-1 text-center transition-colors hover:text-ink ${sortKey === gw ? 'text-accent' : ''}`}>
                {gw}{sortKey === gw ? (dir === 'asc' ? '↑' : '↓') : ''}
              </button>
            ))}
          </span>
          <button onClick={() => clickHeader('run')}
            className={`w-9 shrink-0 py-1 text-right transition-colors hover:text-ink ${sortKey === 'run' ? 'text-accent' : ''}`}>
            {mode === 'xg' ? 'xG' : 'CS'}{sortKey === 'run' ? (dir === 'asc' ? '↑' : '↓') : ''}
          </button>
        </div>
        {sorted.map((r, i) => (
          <div key={r.team}>
            <button
              onClick={() => setOpen((o) => (o === r.team ? null : r.team))}
              className="flex w-full items-center gap-1.5 border-b border-line px-2 py-1.5 text-left transition-colors last:border-0 hover:bg-surface-2/40"
            >
              <span className="w-[76px] shrink-0 min-w-0 items-center gap-1.5 flex">
                <span className="w-3.5 shrink-0 text-right font-num text-[10px] tabular-nums text-ink-3">{i + 1}</span>
                <TeamBadge team={r.team} size={15} />
                <span className="truncate text-[12.5px] font-bold text-ink">{r.team}</span>
              </span>
              <span className="flex flex-1 gap-1">
                {gws.map((gw) => {
                  const v = gwVal(r, gw)
                  // Same red-to-green bands as the difficulty grid, and the
                  // same gold for the best figure in the column — literal
                  // metal rather than a stronger tint, so the winner reads as
                  // the winner in either theme. Doubles are excluded from the
                  // gold for the same reason as the wide grid: the total that
                  // won the column is not any one of its fixtures.
                  const single = (r.byGw.get(gw)?.length ?? 0) === 1
                  const best = bestByGw.get(gw)
                  const isBest = v != null && single && best != null && Math.abs(v - best) < 1e-9
                  return (
                    <span
                      key={gw}
                      className="flex-1 rounded py-1 text-center font-num text-[10.5px] font-bold tabular-nums"
                      style={v == null
                        ? { background: 'var(--surface-2)', color: 'var(--ink-3)' }
                        : isBest
                          ? { background: 'linear-gradient(180deg,#F7E3A6,#C9A227)', color: '#17130A' }
                          : { background: bandFill(v), color: 'var(--ink)' }}
                      title={isBest ? 'Best this gameweek' : undefined}
                    >
                      {v == null ? '–' : mode === 'xg' ? v.toFixed(1) : Math.round(v * 100)}
                    </span>
                  )
                })}
              </span>
              <span className="w-9 shrink-0 text-right font-num text-[12.5px] font-extrabold tabular-nums text-accent-2">
                {r.run == null ? '–' : mode === 'xg' ? r.run.toFixed(1) : r.run.toFixed(2)}
              </span>
            </button>
            {open === r.team && (
              <div className="border-b border-line bg-surface-1/60 px-3 py-2.5">
                <RunRead
                  team={r.team}
                  fixtures={gws.flatMap((gw) => (r.byGw.get(gw) ?? []).map((f) => {
                    const l = lamOf(r.team, f)
                    return { gw, opponent: f.opponent, venue: f.venue, diff: diffOf(f).diff, xg: l ? l.for : null, cs: l ? Math.exp(-l.against) : null }
                  }))}
                  profiles={profiles} league={league} usedFdr={r.usedFdr} n={gws.length}
                  leagueRuns={runAverages}
                />
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
        {mode === 'xg'
          ? 'Each cell is that fixture\u2019s projected goals; the column on the right is the total across the window. Reading down a column shows which gameweek the whole division is kind in.'
          : 'Each cell is that fixture\u2019s clean-sheet chance as a percentage; the column on the right is expected clean sheets across the window. A defender buy is a run of dark cells, not one.'}
      </p>
    </div>
  )
  if (ladder) return ladder

  return (
    <div className="mb-8">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-3">
        <span>Tap a gameweek to sort by that week; tap a team for the read on its run.</span>
        <InfoTip text={MODE_TIP[mode] + (mode === 'diff' ? " Where a fixture has no goal expectancy at all we fall back to FPL's FDR and mark the cell with a dot. The Run column is the window average." : ' Promoted opponents have no top-flight baseline yet, so a league-average opponent is assumed and the cell is marked with a dot.')} />
      </div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-1">
              <th
                onClick={() => clickHeader('team')}
                className="sticky left-0 z-10 cursor-pointer bg-surface-1 px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-ink-3 uppercase transition-colors select-none hover:text-ink"
                title="Sort A–Z by club"
              >Team{arrow('team')}</th>
              {gws.map((gw) => (
                <th key={gw} onClick={() => clickHeader(gw)} className={headCls}>GW{gw}{arrow(gw)}</th>
              ))}
              <th onClick={() => clickHeader('run')} className={headCls}>{mode === 'diff' ? 'Run' : mode === 'xg' ? 'Σ xG' : 'Σ clean sheets'}{arrow('run')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <Fragment key={r.team}>
                <tr className="border-b border-line last:border-0">
                  <td className="sticky left-0 z-10 cursor-pointer bg-surface-1 px-3 py-2" onClick={() => setOpen((o) => (o === r.team ? null : r.team))}>
                    <span className="flex items-center gap-2 font-medium whitespace-nowrap text-ink">
                      <TeamBadge team={r.team} size={16} />{teamLabel(r.team)}
                      <span className="text-[10px] text-ink-3">{open === r.team ? '▴' : '▾'}</span>
                    </span>
                  </td>
                  {gws.map((gw) => {
                    const fs = r.byGw.get(gw)
                    return (
                      <td key={gw} className="px-1.5 py-1.5 text-center">
                        {fs && fs.length ? (
                          <span className="flex flex-col items-center gap-1">
                            {fs.map((f, i) => {
                              if (mode === 'diff') {
                                const { diff, ours } = diffOf(f)
                                return (
                                  <span
                                    key={i}
                                    className="inline-block w-full min-w-[54px] rounded px-1 py-0.5 whitespace-nowrap"
                                    style={{ background: diffFill(diff) }}
                                    title={`GW${gw} ${f.venue === 'H' ? 'vs' : 'at'} ${teamLabel(f.opponent)} — difficulty ${diff.toFixed(1)}${ours ? '' : ' (FPL FDR — no goal expectancy for this fixture)'}`}
                                  >
                                    <span className="block text-[10px] leading-tight font-semibold text-ink-2">{f.opponent} ({f.venue}){!ours && ' ·'}</span>
                                    <span className="font-num block text-[12px] leading-tight font-bold text-ink tabular-nums">{diff.toFixed(1)}</span>
                                  </span>
                                )
                              }
                              const p = projectCell(mode, baselines.get(r.team), baselines.get(f.opponent), leagueBase, f.venue, mktOf(market, r.team, f))
                              if (!p) return <span key={i} className="text-ink-3">—</span>
                              const label = mode === 'xg' ? p.v.toFixed(2) : `${Math.round(p.v * 100)}%`
                              const tip = mode === 'xg'
                                ? `GW${gw} ${f.venue === 'H' ? 'vs' : 'at'} ${teamLabel(f.opponent)} — projected ${p.v.toFixed(2)} xG${p.assumed ? ' (promoted opponent: league-average assumption)' : ''}`
                                : `GW${gw} ${f.venue === 'H' ? 'vs' : 'at'} ${teamLabel(f.opponent)} — ${Math.round(p.v * 100)}% clean-sheet chance${p.assumed ? ' (promoted opponent: league-average assumption)' : ''}`
                              // Best in the column, and the only fixture this
                              // team has that week — a double's two halves are
                              // each smaller than the total that won it.
                              const best = bestByGw.get(gw)
                              const isBest = best != null && fs.length === 1 && Math.abs(p.v - best) < 1e-9
                              // Best of the week is gold outright, not a
                              // stronger tint of the column's own colour —
                              // literal metal, so it reads as the winner in
                              // any theme rather than "more of the same".
                              return (
                                <span
                                  key={i}
                                  className={`inline-block w-full min-w-[54px] rounded px-1 py-0.5 whitespace-nowrap ${isBest ? 'shadow-[0_0_0_1px_rgba(23,19,10,.35)]' : ''}`}
                                  style={isBest
                                    ? { background: 'linear-gradient(180deg,#F7E3A6,#C9A227)' }
                                    : { background: bandFill(p.v) }}
                                  title={isBest ? `${tip} — best this gameweek` : tip}
                                >
                                  <span className={`block text-[10px] leading-tight font-semibold ${isBest ? 'text-[#3B2F10]' : 'text-ink-2'}`}>{f.opponent} ({f.venue}){p.assumed ? ' ·' : ''}</span>
                                  <span className={`font-num block text-[12px] leading-tight font-bold tabular-nums ${isBest ? 'text-[#17130A]' : 'text-ink'}`}>
                                    {isBest && <Icon name="crown" size={9} className="mr-0.5 inline-block align-[-0.05em]" />}
                                    {label}
                                  </span>
                                </span>
                              )
                            })}
                          </span>
                        ) : (
                          <span className="text-ink-3">—</span>
                        )}
                      </td>
                    )
                  })}
                  <td className="px-2 py-2 text-center">
                    {r.run == null ? <span className="text-ink-3">—</span> : mode === 'diff' ? (
                      <span className="font-num text-sm font-semibold tabular-nums" style={{ color: runColor(r.run) }}>{r.run.toFixed(1)}</span>
                    ) : (
                      <span className="font-num text-sm font-bold tabular-nums metallic-num">{r.run.toFixed(1)}</span>
                    )}
                  </td>
                </tr>
                {open === r.team && (
                  <tr className="border-b border-line bg-surface-1/40">
                    <td colSpan={colSpan} className="px-3 py-3">
                      <RunRead
                        team={r.team}
                        fixtures={gws.flatMap((gw) => (r.byGw.get(gw) ?? []).map((f) => {
                          const l = lamOf(r.team, f)
                          return {
                            gw, opponent: f.opponent, venue: f.venue,
                            diff: diffOf(f).diff,
                            xg: l ? l.for : null,
                            cs: l ? Math.exp(-l.against) : null,
                          }
                        }))}
                        profiles={profiles} league={league} usedFdr={r.usedFdr} n={gws.length}
                        leagueRuns={runAverages}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {/* legend */}
      {mode === 'diff' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
          <span className="flex overflow-hidden rounded border border-line-mid">
            {([1, 2, 3, 4, 5] as const).map((d) => (
              <span key={d} className="grid h-5 w-7 place-items-center font-semibold text-ink-2" style={{ background: diffFill(d) }}>{d}</span>
            ))}
          </span>
          <span>1 = easiest, 5 = hardest · “·” = FPL FDR fallback (no goal expectancy)</span>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-ink-3">
          <span className="flex items-center gap-1.5">
            <span className="flex overflow-hidden rounded border border-line-mid">
              {([-1, -0.4, 0, 0.4, 1] as const).map((t) => (
                <span key={t} className="block h-4 w-7" style={{ background: bandFill(scale ? (t >= 0 ? scale.mid + t * (scale.hi - scale.mid) : scale.mid + t * (scale.mid - scale.lo)) : 0) }} />
              ))}
            </span>
            <span>Well under a normal fixture → well over{scale && (mode === 'xg' ? ` · midpoint ${scale.mid.toFixed(2)} xG` : ` · midpoint ${Math.round(scale.mid * 100)}%`)}</span>
          </span>
          <span>
            {mode === 'xg'
              ? 'The Σ column is the plain sum over the window — the goals their attack should produce across the run.'
              : 'The Σ column sums the probabilities — the number of clean sheets to expect over the window.'}
            {' '}“·” = promoted opponent, league-average assumption. Projections use each side’s per-game xG/xGC baselines (Understat chance quality) with a ±5% venue nudge.
          </span>
        </div>
      )}
    </div>
  )
}

/** The expandable per-team scouting read of an upcoming run. */
function RunRead({ team, fixtures, profiles, league, usedFdr, n, leagueRuns }: {
  team: string
  fixtures: ReadFixture[]
  profiles: Map<string, Profile>; league: Profile; usedFdr: boolean; n: number
  leagueRuns: number[]
}) {
  const read = fixtureRead(fixtures, profiles, league, leagueRuns)
  return (
    <div className="text-sm text-ink-2">
      <div className="mb-1 flex items-center gap-2 font-semibold text-ink"><TeamBadge team={team} size={15} />Next {n}: {teamLabel(team)}</div>
      {read ? <p>{read}</p> : <p className="text-ink-3">No fixtures in this window.</p>}
      {usedFdr && <p className="mt-1 text-xs text-ink-3">Some opponents have no rating yet (promoted / pre-season); those fixtures use FPL’s FDR.</p>}
    </div>
  )
}

// Colour for the average "Run" difficulty number (1 easy → 5 hard).
function runColor(fdr: number): string {
  if (fdr <= 2.2) return 'var(--good)'
  if (fdr >= 3.6) return 'var(--bad)'
  return 'var(--ink-2)'
}


/* ── Matchup explorer: opponent weaknesses × player shot profiles ── */
function MatchupExplorer({ ratings, league }: { ratings: RatingRow[]; league: string[] }) {
  const navigate = useNavigate()
  const concededQ = useLazyTable<Record<string, Row[]>>('shots_conceded')
  const playerShotsQ = useLazyTable<Record<string, Row[]>>('player_shots')
  const scoutQ = useLazyTable<Row[]>('scouting')
  const [opp, setOpp] = useState('')

  /* Only clubs actually in this season's league.
     The shot data is last season's — that is the point of it, it is the
     evidence — but its twenty keys are last season's twenty. Left unfiltered
     the picker offered Burnley, West Ham and Wolves, none of whom are in the
     division, and the reader had no way of knowing the list was stale. */
  const inLeague = useMemo(() => new Set(league), [league])
  const available = useMemo(
    () => Object.keys(concededQ.data ?? {}).filter((t) => inLeague.has(t)).sort(),
    [concededQ.data, inLeague],
  )
  /* Promoted clubs have no Premier League shots to profile. Naming them is
     better than a silently short list. */
  const missing = useMemo(
    () => league.filter((t) => !(t in (concededQ.data ?? {}))).sort(),
    [league, concededQ.data],
  )
  const teams = available

  // Opponent + league concession profiles (xG-weighted, penalties excluded).
  const { teamProfiles, leagueProfile } = useMemo(() => {
    const bag = concededQ.data ?? {}
    const teamProfiles = new Map<string, Profile>()
    const allShots: Row[] = []
    for (const [t, shots] of Object.entries(bag)) {
      if (!Array.isArray(shots)) continue
      teamProfiles.set(t, profileOf(shots, true))
      allShots.push(...shots)
    }
    return { teamProfiles, leagueProfile: profileOf(allShots, true) }
  }, [concededQ.data])

  // Player shot profiles + headed share from the scouting table (player shot
  // events carry no body-part field).
  const headShareByEl = useMemo(() => {
    const m = new Map<number, number>()
    for (const r of scoutQ.data ?? []) {
      if ((str(r, 'window') || 'season') !== 'season') continue
      const el = num(r, 'element')
      const shots = num(r, 'shots_per90')
      const headed = num(r, 'headed_shots_per90')
      if (el != null && shots && headed != null && shots > 0) m.set(el, headed / shots)
    }
    return m
  }, [scoutQ.data])

  const results = useMemo(() => {
    if (!opp || !playerShotsQ.data) return []
    const oProf = teamProfiles.get(opp)
    if (!oProf || oProf.totalXg <= 0) return []
    const ratingByEl = new Map<number, RatingRow>()
    for (const r of ratings) ratingByEl.set(r.element, r)

    const out: { r: RatingRow; uplift: number; xg: number; why: string }[] = []
    for (const [elStr, shots] of Object.entries(playerShotsQ.data)) {
      const r = ratingByEl.get(Number(elStr))
      if (!r || r.team === opp) continue
      if (r.position !== 'MID' && r.position !== 'FWD') continue
      const e = edgeFor(r, shots as Row[], oProf, leagueProfile, opp, headShareByEl.get(Number(elStr)))
      if (!e) continue
      out.push({ r, uplift: e.uplift, xg: e.xg, why: edgeSentence(e, teamLabel(opp), false) ?? "" })
    }
    /* Rank by fit AND volume: a perfect profile on somebody who barely
       shoots is not an edge. That has always been the order, but only the fit
       was on screen, so a +9% sat above a +10% and looked like a mistake. The
       volume is now shown beside it. */
    out.sort((a, b) => b.uplift * Math.sqrt(b.xg) - a.uplift * Math.sqrt(a.xg))
    return out.slice(0, 12)
  }, [opp, playerShotsQ.data, teamProfiles, leagueProfile, headShareByEl, ratings])

  const oProf = opp ? teamProfiles.get(opp) : null
  const loading = concededQ.loading || playerShotsQ.loading || scoutQ.loading

  return (
    <div>
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold tracking-wide text-ink-2 uppercase">
        Matchup Explorer
        <InfoTip text="Goes one level deeper than team-level difficulty: where exactly a team concedes its xG (left / central / right channels, set pieces, headers) versus the league average, and which players' shot profiles best exploit those weaknesses. Based on every shot this season, penalties excluded." />
      </h2>
      <p className="mb-3 text-sm text-ink-3">Pick an opponent to see where they're weak — and which attackers' shot profiles exploit it best.</p>

      {loading ? (
        <div className="rounded-xl border border-dashed border-line-mid bg-surface-1/50 px-6 py-10 text-center text-ink-2">Loading shot data…</div>
      ) : teams.length === 0 ? (
        <EmptyState icon={<Icon name="target" size={40} />}>Shot data isn’t available for this season yet.</EmptyState>
      ) : (
        <>
          {missing.length > 0 && (
            <p className="mb-2 text-xs text-ink-3">
              No Premier League shot data yet for {missing.map((t) => teamLabel(t)).join(', ')} — they appear once they have played.
            </p>
          )}
          <div className="mb-4 flex flex-wrap gap-1.5">
            {teams.map((t) => (
              <button
                key={t}
                onClick={() => setOpp(t === opp ? '' : t)}
                className={`flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-sm font-medium transition-colors ${
                  opp === t ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
                }`}
              >
                <TeamBadge team={t} size={14} />{t}
              </button>
            ))}
          </div>

          {/* Shareable only once an opponent is picked — an empty explorer is
              not a picture. Wraps the weakness tiles and the ranked players
              together, because either alone is half the argument. */}
          {opp && oProf && leagueProfile.totalXg > 0 && (
          <Exportable
            title={`${teamLabel(opp)} — where they concede, and who exploits it`}
            ident={
              <div className="mb-2 flex items-center gap-2">
                <TeamBadge team={opp} size={20} />
                <div>
                  <div className="text-[13px] font-extrabold text-ink">{teamLabel(opp)}</div>
                  <div className="text-[11px] text-ink-3">Matchup Explorer · where they concede their xG</div>
                </div>
              </div>
            }
          >
            <div className="mb-4 rounded-xl border border-line bg-surface-1/60 p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold text-ink"><TeamBadge team={opp} size={18} />Where {teamLabel(opp)} concede their xG</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {(Object.keys(CAT_LABEL) as Cat[]).map((c) => (
                  <VulnTile key={c} label={CAT_LABEL[c]} share={oProf.shares[c]} league={leagueProfile.shares[c]} />
                ))}
                {oProf.headShare != null && leagueProfile.headShare != null && (
                  <VulnTile label="headers" share={oProf.headShare} league={leagueProfile.headShare} />
                )}
              </div>
              <p className="mt-2 text-xs text-ink-3">Share of expected goals conceded this season vs the league average. Channels are from the attacking team's point of view.</p>
            </div>

          {results.length > 0 && (
            <>
            <p className="mb-1.5 text-xs text-ink-3">
              Ranked by fit <span className="text-ink-2">×</span> volume — a profile that suits the weakness perfectly is
              worth nothing on a player who barely shoots, so the season xG beside each fit is part of the order.
            </p>
            <div className="overflow-hidden rounded-xl border border-line">
              {results.map(({ r, uplift, xg, why }, i) => (
                <button
                  key={r.element}
                  onClick={() => navigate(playerHref(String(r.web_name), num(r, 'code')))}
                  className="flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left last:border-0 transition-colors hover:bg-surface-2/50"
                >
                  <span className="w-5 shrink-0 text-center font-num text-xs tabular-nums text-ink-3">{i + 1}</span>
                  <PositionIcon pos={r.position} size={14} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{String(r.web_name)}</span>
                    <span className="flex items-center gap-1.5 text-[11px] text-ink-3"><TeamBadge team={String(r.team)} size={11} />{r.team} · £{r.price}m</span>
                    {why && <span className="mt-0.5 block text-xs text-ink-2">{why}</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={`block font-num text-sm font-semibold tabular-nums ${uplift > 0 ? 'text-good' : 'text-ink-3'}`}>
                      {uplift > 0 ? '+' : ''}{(uplift * 100).toFixed(0)}%
                      <span className="ml-1 text-[10px] font-normal text-ink-3">fit</span>
                    </span>
                    <span className="block text-[10.5px] text-ink-3">{xg.toFixed(1)} xG</span>
                  </span>
                </button>
              ))}
            </div>
            </>
          )}
          </Exportable>
          )}
          {opp && !results.length && (
            <EmptyState icon={<Icon name="target" size={40} />}>No qualifying players (20+ shots this season) for this matchup yet.</EmptyState>
          )}
        </>
      )}
    </div>
  )
}

function VulnTile({ label, share, league }: { label: string; share: number; league: number }) {
  const delta = league > 0 ? (share - league) / league : 0
  const flag = delta >= 0.12 ? 'weak' : delta <= -0.12 ? 'strong' : 'avg'
  return (
    <div className="rounded-lg border border-line bg-surface-2/60 p-2.5">
      <div className="font-num text-lg font-bold tabular-nums text-ink">{(share * 100).toFixed(0)}%</div>
      <div className="text-[10px] leading-tight tracking-wide text-ink-3 uppercase">{label}</div>
      <div className={`mt-0.5 text-[11px] font-medium ${flag === 'weak' ? 'text-bad' : flag === 'strong' ? 'text-good' : 'text-ink-3'}`}>
        {flag === 'weak' ? `+${(delta * 100).toFixed(0)}% vs league` : flag === 'strong' ? `${(delta * 100).toFixed(0)}% vs league` : 'league-average'}
      </div>
    </div>
  )
}
