import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageShell, EmptyState } from '../components/PageShell'
import { SectionBanner } from '../components/SectionBanner'
import { Tabs, type TabDef } from '../components/Tabs'
import { SortableTable, type Column } from '../components/SortableTable'
import { TeamBadge, PositionIcon } from '../components/badges'
import { InfoTip } from '../components/InfoTip'
import { Icon } from '../components/Icon'
import { PageSkeleton } from '../components/Skeleton'
import { useCore, useLazyTable } from '../lib/useData'
import { classifyZone, toPitch } from '../lib/shotzones'
import { Exportable } from '../components/ExportPanel'
import { num, str } from '../lib/rows'
import { useMarketOdds, type MarketOdds } from '../lib/xp'
import { teamLabel, playerHref } from '../lib/util'
import { analyserDiff, bandOf, bestRuns, buildDiffScale, diffFill, windowGames, type Lens, type TeamBase } from '../lib/fixtureRuns'
import { RunsTimeline } from '../components/BestRuns'
import type { FixtureEaseRow, RatingRow, Row } from '../lib/types'


/* Planning horizons. Six is where a transfer decision actually lives, so the
   grid opens there; four came off the list because it never told you anything
   six did not, only sooner.

   19 is the sentinel for "to the halfway point". Rest of season replaced it
   and drew thirty-eight columns, which is a spreadsheet rather than a read —
   the half is the unit people plan chips and wildcards around. */
const WINDOWS = [6, 8, 10, 19] as const
const HALF = 19
const winLabel = (w: number) => (w === HALF ? 'To GW19' : `Next ${w}`)

const VIEW_TABS: TabDef[] = [
  { id: 'difficulty', label: 'Difficulty' },
  { id: 'runs', label: 'Best Runs' },
  { id: 'rotation', label: 'Rotation Planner' },
  { id: 'matchup', label: 'Matchup Explorer' },
]
type View = 'difficulty' | 'runs' | 'rotation' | 'matchup'

/* The grid shows one of three things per cell: our 1–5 difficulty, the
   projected xG the team's attack should produce in that fixture, or the
   probability of a clean sheet — with window totals in the Run column. */
type GridMode = 'diff' | 'xg' | 'cs'
const MODE_TABS: TabDef[] = [
  { id: 'diff', label: 'Difficulty' },
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

/* Shot-profile categories used to match player strengths to opponent
   weaknesses. Channels come from the shot-zone geometry (attacker's view);
   set-piece from the shot situation. Penalties are excluded throughout. */
type Cat = 'left' | 'centre' | 'right' | 'setpiece'
const CAT_LABEL: Record<Cat, string> = {
  left: 'the attacking left',
  centre: 'central areas',
  right: 'the attacking right',
  setpiece: 'set pieces',
}

function channelOf(zone: string): Exclude<Cat, 'setpiece'> {
  if (/-(wl|el)/.test(zone) || /-l($|-)/.test(zone)) return 'left'
  if (/-(wr|er)/.test(zone) || /-r($|-)/.test(zone)) return 'right'
  return 'centre'
}
const isSetPiece = (sit: unknown) => sit === 'SetPiece' || sit === 'FromCorner' || sit === 'DirectFreekick'

interface Profile { shares: Record<Cat, number>; headShare: number | null; totalXg: number }

/** xG-weighted share of each category for a list of shots (penalties excluded). */
function profileOf(shots: Row[], withHead: boolean): Profile {
  const acc: Record<Cat, number> = { left: 0, centre: 0, right: 0, setpiece: 0 }
  let total = 0
  let headXg = 0
  for (const s of shots) {
    if (s.situation === 'Penalty') continue
    const xg = Number(s.xg) || 0
    if (!xg) continue
    total += xg
    if (isSetPiece(s.situation)) acc.setpiece += xg
    // Both player shots and shots-conceded are recorded in the attacking
    // team's frame — no mirroring, so channel labels line up on both sides.
    const { cx, cy } = toPitch(s.x as number, s.y as number)
    acc[channelOf(classifyZone(cx, cy))] += xg
    if (withHead && s.shot_type === 'Head') headXg += xg
  }
  const shares = Object.fromEntries(
    (Object.keys(acc) as Cat[]).map((k) => [k, total > 0 ? acc[k] / total : 0]),
  ) as Record<Cat, number>
  return { shares, headShare: withHead && total > 0 ? headXg / total : null, totalXg: total }
}

export default function Fixtures() {
  const { data, error: coreError } = useCore()
  const [view, setView] = useState<View>('difficulty')
  // Six on every screen. The grid scrolls sideways on a phone, which is a
  // smaller cost than opening two different people on two different windows
  // and having them compare notes.
  const [windowN, setWindowN] = useState<(typeof WINDOWS)[number]>(6)
  const [lens, setLens] = useState<Lens>('overall')
  const [mode, setMode] = useState<GridMode>('diff')


  // Per-game xG / xGC baselines for the projection modes (normalised from
  // window totals — never show a total as a rate).
  const { baselines: rawBaselines, leagueBase } = useMemo(() => {
    const m = new Map<string, TeamBase>()
    if (data) {
      for (const t of data.teamMetrics) {
        if (str(t, 'window') !== 'season') continue
        const g = windowGames(t, data)
        const xg = num(t, 'team_xg')
        const xgc = num(t, 'team_xgc')
        if (xg != null && xgc != null && g > 0) m.set(String(t.team), { xg: xg / g, xgc: xgc / g })
      }
    }
    const vals = [...m.values()]
    const leagueBase: TeamBase = vals.length
      ? { xg: vals.reduce((s, v) => s + v.xg, 0) / vals.length, xgc: vals.reduce((s, v) => s + v.xgc, 0) / vals.length }
      : { xg: 1.4, xgc: 1.4 }
    return { baselines: m, leagueBase }
  }, [data])

  // Promoted clubs have no season history, so their cells would be blank.
  // The odds layer backs their attack/defence out of every priced fixture
  // against a club we do know — a real baseline that sharpens each week,
  // rather than a league-average stand-in.
  const marketStrength = useMarketOdds()
  const baselines = useMemo(() => {
    const m = new Map(rawBaselines)
    for (const [team, v] of Object.entries(marketStrength?.strength ?? {})) {
      if (!m.has(team)) m.set(team, { xg: v.att, xgc: v.def })
    }
    return m
  }, [rawBaselines, marketStrength])

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

  if (!data) {
    return (
      <PageShell>
        <SectionBanner imgKey="fixtures" title="Fixtures" subtitle="Our own difficulty ratings for every upcoming game — grid, best runs, rotations and matchups" />
        <PageSkeleton error={coreError} />
      </PageShell>
    )
  }

  const fixtureEase = data.fixtureEase
  const hasFixtures = fixtureEase.length > 0
  const horizon = hasFixtures ? new Set(fixtureEase.map((f) => f.gw)).size : 0

  return (
    <PageShell>
      <SectionBanner imgKey="fixtures" title="Fixtures" subtitle="Our own difficulty ratings for every upcoming game — grid, best runs, rotations and matchups" />

      <div className="mb-4"><Tabs tabs={VIEW_TABS} active={view} onChange={(id) => setView(id as View)} layoutId="fx-view" /></div>

      {view === 'difficulty' ? (
        hasFixtures ? (
          <>
            {/* Window + lens controls */}
            <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
              {/* Wraps: five windows including "Rest of season" no longer fit
                  one phone row, and an unwrapped row pushed the page sideways. */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Window</span>
                {WINDOWS.map((w) => (
                  <button
                    key={w}
                    onClick={() => setWindowN(w)}
                    className={`min-h-9 rounded-full border px-3 text-sm font-medium transition-colors ${
                      windowN === w ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    {winLabel(w)}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Show</span>
                {MODE_TABS.map((m) => (
                  <span key={m.id} className="flex items-center gap-1">
                    <button
                      onClick={() => setMode(m.id as GridMode)}
                      className={`min-h-9 rounded-full border px-3 text-sm font-medium transition-colors ${
                        mode === m.id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
                      }`}
                    >
                      {m.label}
                    </button>
                    <InfoTip text={MODE_TIP[m.id as GridMode]} />
                  </span>
                ))}
              </div>
              {mode === 'diff' && (
                <div className="flex items-center gap-1.5">
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
            {windowN === HALF ? (
              <p className="mb-3 -mt-1 text-xs text-ink-3">Every gameweek to the halfway point of the season. Scroll the grid sideways.</p>
            ) : horizon < windowN ? (
              <p className="mb-3 -mt-1 text-xs text-ink-3">The data pipeline currently publishes {horizon} gameweeks ahead — showing all {horizon}.</p>
            ) : null}
            <MarketNote market={marketStrength} />

            <Exportable title={`${mode === 'diff' ? 'Fixture difficulty' : mode === 'xg' ? 'Projected xG' : 'Clean sheet odds'} — ${winLabel(windowN).toLowerCase()}`}>
            <FixtureGrid key={mode} fixtureEase={fixtureEase} windowN={windowN} lens={lens} mode={mode} baselines={baselines} leagueBase={leagueBase} profiles={profiles} league={league} />
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
          <>
            {/* The lens matters more here than anywhere: a run that's kind to
                a striker is not the same run that's kind to a keeper. */}
            <div className="mb-4 flex items-center gap-1.5">
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
            <SeasonRunsBoard fixtureEase={fixtureEase} lens={lens} baselines={baselines} />
          </>
        ) : (
          <EmptyState icon={<Icon name="calendar" size={44} />}>Best runs switch on when the fixtures are published.</EmptyState>
        )
      ) : view === 'rotation' ? (
        hasFixtures ? (
          <RotationPlanner ratings={data.ratings as RatingRow[]} fixtureEase={fixtureEase} baselines={baselines} leagueBase={leagueBase} />
        ) : (
          <EmptyState icon={<Icon name="calendar" size={44} />}>The rotation planner switches on when the fixtures are published.</EmptyState>
        )
      ) : (
        <MatchupExplorer ratings={data.ratings as RatingRow[]} />
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
function SeasonRunsBoard({ fixtureEase, lens, baselines }: {
  fixtureEase: FixtureEaseRow[]
  lens: Lens
  baselines: Map<string, TeamBase>
}) {
  const scale = useMemo(() => buildDiffScale(baselines), [baselines])
  const [half, setHalf] = useState<'all' | 1 | 2>('all')
  const [view, setView] = useState<'ranked' | 'map'>('ranked')

  const runs = useMemo(() => {
    const teams = [...new Set(fixtureEase.map((f) => String(f.team)))]
    return teams.flatMap((team) => bestRuns(fixtureEase, team, lens, scale).map((r) => ({ team, ...r })))
  }, [fixtureEase, lens, scale])

  const shown = useMemo(() => (half === 'all' ? runs : runs.filter((r) => r.half === half)), [runs, half])
  if (!runs.length) return null
  const spansSeason = runs.some((r) => r.half === 2) && runs.some((r) => r.half === 1)

  // Ranking is the whole point of the table, so it is fixed to the score
  // rather than to whatever column was clicked last: rank 1 has to mean the
  // best run, not the alphabetically first club.
  const ranked = useMemo(() => [...shown].sort((a, b) => b.advantage - a.advantage), [shown])
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
      <div className="mb-3 flex items-center gap-1.5">
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
        <div className="mb-3 flex items-center gap-1.5">
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
      {view === 'ranked' ? (
        <SortableTable
          rows={ranked}
          columns={columns}
          initialSort="score"
          initialDir="desc"
          rowKey={(r) => `${r.team}-${r.half}`}
        />
      ) : (
        <RunsTimeline fixtureEase={fixtureEase} runs={shown} gws={mapGws} lens={lens} scale={scale} />
      )}
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
const ROT_WINDOWS = [4, 6, 8, 10] as const
const LENS_LABEL_ROT: Record<Lens, string> = { overall: 'Overall', attack: 'Attack', defence: 'Defence' }
const mean = (ds: number[]) => (ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null)

/* ── Rotation planner: pick teams and see who to start each gameweek ──────
   Difficulty is OUR own rating (opponent strength on our team ratings) in the
   chosen lens. You set how many teams are in the rotation (N) and how many you
   actually start each week (K) — every gameweek we start the K with the kindest
   fixtures. With nothing picked we surface the best-rotating groups of size N. */
function RotationPlanner({ ratings, fixtureEase, baselines, leagueBase }: { ratings: RatingRow[]; fixtureEase: FixtureEaseRow[]; baselines: Map<string, TeamBase>; leagueBase: TeamBase }) {
  const market = useMarketOdds()
  const diffScale = useMemo(() => buildDiffScale(baselines), [baselines])
  const [teams, setTeams] = useState<string[]>([])
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
  const [startK, setStartK] = useState(1)
  const [windowN, setWindowN] = useState<(typeof ROT_WINDOWS)[number]>(6)
  const [lens, setLens] = useState<Lens>('overall')

  const allTeams = useMemo(() => [...new Set(fixtureEase.map((f) => f.team))].sort(), [fixtureEase])

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
  const gws = useMemo(() => [...new Set(fixtureEase.map((f) => f.gw))].sort((a, b) => a - b).slice(0, windowN), [fixtureEase, windowN])

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

  const changeSize = (n: (typeof ROT_SIZES)[number]) => {
    setSize(n)
    setTeams((s) => s.slice(0, n))
    setStartK((k) => Math.min(k, n - 1))
  }

  // Sorted (kindest first) fixtures for a group in one gameweek.
  const rankGw = (group: string[], gw: number) =>
    group.map((t) => ({ t, diff: cellFor(t, gw)?.diff })).filter((x): x is { t: string; diff: number } => x.diff != null).sort((a, b) => a.diff - b.diff)

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
        const dd = sub.map((t) => cellFor(t, gw)?.diff).filter((v): v is number => v != null)
        if (dd.length) ds.push(dd.reduce((a, b) => a + b, 0) / dd.length)
      }
      const a = mean(ds)
      if (a != null && (best == null || a < best)) best = a
    }
    return best
  }

  // Which teams to START each gameweek (the K kindest fixtures).
  const startByGw = new Map<number, Set<string>>()
  for (const gw of gws) startByGw.set(gw, new Set(rankGw(teams, gw).slice(0, startK).map((x) => x.t)))

  const rotAvg = startKAvg(teams, startK)
  const fixedAvg = teams.length ? fixedKAvg(teams, startK) : null

  // Top rotating groups of size N, ranked by the start-K combined difficulty.
  const topGroups = useMemo(() => {
    // Ruled-out clubs never enter the pool, and every suggestion has to carry
    // the ones already picked — "I know I want an Arsenal defender, show me
    // who partners them" is the question this answers.
    const pool = allTeams.filter((t) => !excluded.includes(t) && qualifies(t))
    const out: { group: string[]; combined: number }[] = []
    for (const group of combos(pool, size)) {
      if (!teams.every((t) => group.includes(t))) continue
      const c = startKAvg(group, startK)
      if (c != null) out.push({ group, combined: c })
    }
    return out.sort((x, y) => x.combined - y.combined).slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTeams, excluded, teams, size, startK, gws, cellFor, pickBy, filtering])

  const headCls = 'px-2 py-2 text-center text-[11px] font-semibold tracking-wide text-ink-3 uppercase'
  const pill = (active: boolean) => `min-h-9 rounded-full border px-3 text-sm font-medium transition-colors ${active ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'}`
  const startOpts = Array.from({ length: size - 1 }, (_, i) => i + 1) // 1 … N-1

  return (
    <div>
      <h2 className="mb-1 flex items-center gap-1.5 text-sm font-semibold tracking-wide text-ink-2 uppercase">
        Rotation Planner
        <InfoTip text="Difficulty is our own rating — opponent strength on our team Attack/Defence ratings, in the lens you choose. Set how many teams are in the rotation and how many you start each week; we always start the ones with the kindest fixtures." />
      </h2>
      <p className="mb-3 text-sm text-ink-3">Choose the rotation size, how many to start, the window and the lens — then tap teams, or pick a top combination.</p>

      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Rotate</span>
          {ROT_SIZES.map((n) => <button key={n} onClick={() => changeSize(n)} className={pill(size === n)}>{n}</button>)}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Start</span>
          {startOpts.map((k) => <button key={k} onClick={() => setStartK(k)} className={pill(startK === k)}>{k}</button>)}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Window</span>
          {ROT_WINDOWS.map((w) => <button key={w} onClick={() => setWindowN(w)} className={pill(windowN === w)}>Next {w}</button>)}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Rate for</span>
          {LENS_TABS.map((l) => (
            <span key={l.id} className="flex items-center gap-1">
              <button onClick={() => setLens(l.id as Lens)} className={pill(lens === l.id)}>{l.label}</button>
              <InfoTip text={LENS_TIP[l.id as Lens]} />
            </span>
          ))}
        </div>
      </div>

      {/* Budget filter — the reason most rotations exist. */}
      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Must field</span>
          {(['any', 'GKP', 'DEF', 'MID', 'FWD'] as const).map((pos) => (
            <button key={pos} onClick={() => setNeedPos(pos)} className={pill(needPos === pos)}>{pos === 'any' ? 'Anyone' : pos}</button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Up to</span>
          {([null, 4, 4.5, 5, 5.5, 6] as const).map((v) => (
            <button key={String(v)} onClick={() => setMaxPrice(v)} className={pill(maxPrice === v)}>{v == null ? 'Any price' : `£${v.toFixed(1)}m`}</button>
          ))}
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
          const full = (!on && !out && teams.length >= size) || (!on && !out && !ok)
          const cycle = () => {
            if (on) { setTeams(teams.filter((x) => x !== t)); setExcluded([...excluded, t]); return }
            if (out) { setExcluded(excluded.filter((x) => x !== t)); return }
            if (teams.length < size) setTeams([...teams, t])
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

      {teams.length < 2 ? (
        <div>
          <div className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Top rotations · start {startK} of {size} · next {gws.length} · {LENS_LABEL_ROT[lens]}</div>
          <div className="overflow-hidden rounded-xl border border-line">
            {topGroups.map((g, i) => (
              <button key={g.group.join('')} onClick={() => setTeams(g.group)} className="flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-surface-2/50">
                <span className="w-5 shrink-0 text-center font-num text-xs tabular-nums text-ink-3">{i + 1}</span>
                <span className="flex flex-1 flex-wrap items-center gap-x-2 gap-y-1 font-medium text-ink">
                  {g.group.map((t, k) => (
                    <span key={t} className="flex items-center gap-1.5">{k > 0 && <span className="text-ink-3">+</span>}<TeamBadge team={t} size={16} />{teamLabel(t)}</span>
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
                  <span className="font-num text-sm font-semibold tabular-nums" style={{ color: runColor(g.combined) }}>{g.combined.toFixed(1)}</span>
                  <span className="ml-1 text-[10px] text-ink-3">avg diff</span>
                </span>
              </button>
            ))}
            {topGroups.length === 0 && (
              <div className="px-3 py-8 text-center text-sm text-ink-3">
                {filtering ? 'No rotation fits that budget — try a higher cap or a different position.' : 'No fixtures to rank yet.'}
              </div>
            )}
          </div>
          <p className="mt-2 text-xs text-ink-3">Lower is kinder — the combined difficulty if you always start the {startK} kindest fixture{startK > 1 ? 's' : ''} in the group.</p>
        </div>
      ) : (
        <>
          {rotAvg != null && fixedAvg != null && (
            <div className="mb-4 rounded-xl border border-line bg-surface-1/60 p-4 text-sm">
              Starting the best {startK} of these {teams.length} each week averages{' '}
              <strong className="text-good">{rotAvg.toFixed(1)}</strong> difficulty over the next {gws.length} — versus{' '}
              <strong className="text-ink">{fixedAvg.toFixed(1)}</strong> if you fixed the best {startK} and never rotated.
              {rotAvg < fixedAvg - 0.1 ? ' The rotation is the smoother run.' : ' Rotation adds little over just holding the best here.'}
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-1">
                  <th className="sticky left-0 z-10 bg-surface-1 px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Team</th>
                  {gws.map((gw) => <th key={gw} className={headCls}>GW{gw}</th>)}
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
                </tr>
              </tbody>
            </table>
          </div>
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
  fixtureEase, windowN, lens, mode, baselines, leagueBase, profiles, league,
}: {
  fixtureEase: FixtureEaseRow[]
  windowN: number
  lens: Lens
  mode: GridMode
  baselines: Map<string, TeamBase>
  leagueBase: TeamBase
  profiles: Map<string, Profile>
  league: Profile
}) {
  const market = useMarketOdds()
  const diffScale = useMemo(() => buildDiffScale(baselines), [baselines])
  const [sortKey, setSortKey] = useState<number | 'run' | 'team'>('run')
  // Difficulty: ascending = easiest first. Projections: descending = most
  // goals / best clean-sheet odds first.
  const [dir, setDir] = useState<'asc' | 'desc'>(mode === 'diff' ? 'asc' : 'desc')
  const [open, setOpen] = useState<string | null>(null)

  const gws = useMemo(
    // "To GW19" is a destination, not a count: mid-season it must still stop at
    // the halfway point rather than draw nineteen weeks from wherever you are.
    () => {
      const all = [...new Set(fixtureEase.map((f) => f.gw))].sort((a, b) => a - b)
      return windowN === HALF ? all.filter((g) => g <= HALF) : all.slice(0, windowN)
    },
    [fixtureEase, windowN],
  )
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
      setDir('asc')
    }
  }
  const arrow = (key: number | 'run' | 'team') => (sortKey === key ? (dir === 'asc' ? ' ↑' : ' ↓') : '')

  const headCls = 'cursor-pointer select-none px-2 py-2 text-center text-[11px] font-semibold tracking-wide text-ink-3 uppercase transition-colors hover:text-ink'
  const colSpan = gws.length + 2

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
function MatchupExplorer({ ratings }: { ratings: RatingRow[] }) {
  const navigate = useNavigate()
  const concededQ = useLazyTable<Record<string, Row[]>>('shots_conceded')
  const playerShotsQ = useLazyTable<Record<string, Row[]>>('player_shots')
  const scoutQ = useLazyTable<Row[]>('scouting')
  const [opp, setOpp] = useState('')

  const teams = useMemo(() => Object.keys(concededQ.data ?? {}).sort(), [concededQ.data])

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
      const el = Number(elStr)
      const r = ratingByEl.get(el)
      if (!r || r.team === opp) continue
      if (r.position !== 'MID' && r.position !== 'FWD') continue
      if (!Array.isArray(shots) || shots.length < 20) continue // need a real sample
      const p = profileOf(shots, false)
      if (p.totalXg <= 0) continue

      // Uplift: how much of this player's shot profile lands where the
      // opponent is weakest relative to the league.
      const cats: { cat: Cat | 'header'; pShare: number; oShare: number; lShare: number }[] = (
        Object.keys(CAT_LABEL) as Cat[]
      ).map((c) => ({ cat: c, pShare: p.shares[c], oShare: oProf.shares[c], lShare: leagueProfile.shares[c] }))
      const pHead = headShareByEl.get(el)
      if (pHead != null && oProf.headShare != null && leagueProfile.headShare) {
        cats.push({ cat: 'header', pShare: pHead, oShare: oProf.headShare, lShare: leagueProfile.headShare })
      }
      let uplift = 0
      let best: (typeof cats)[number] | null = null
      for (const c of cats) {
        const rel = (c.oShare - c.lShare) / Math.max(c.lShare, 0.02)
        uplift += c.pShare * rel
        if (c.pShare >= 0.15 && (!best || c.pShare * rel > best.pShare * ((best.oShare - best.lShare) / Math.max(best.lShare, 0.02)))) best = c
      }

      const why = best && (best.oShare - best.lShare) / Math.max(best.lShare, 0.02) > 0.08
        ? `${opp} concede ${(best.oShare * 100).toFixed(0)}% of xG ${best.cat === 'header' ? 'from headers' : `from ${CAT_LABEL[best.cat as Cat]}`} (league ${(best.lShare * 100).toFixed(0)}%) — ${(best.pShare * 100).toFixed(0)}% of their threat comes from there.`
        : ''
      out.push({ r, uplift, xg: p.totalXg, why })
    }
    // Rank by uplift, favouring players with real attacking volume.
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

          {opp && oProf && leagueProfile.totalXg > 0 && (
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
          )}

          {opp && results.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-line">
              {results.map(({ r, uplift, why }, i) => (
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
                  <span className={`shrink-0 font-num text-sm font-semibold tabular-nums ${uplift > 0 ? 'text-good' : 'text-ink-3'}`}>
                    {uplift > 0 ? '+' : ''}{(uplift * 100).toFixed(0)}%
                    <span className="ml-1 text-[10px] font-normal text-ink-3">fit</span>
                  </span>
                </button>
              ))}
            </div>
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
