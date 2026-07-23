import { Fragment, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, PageShell, EmptyState } from '../components/PageShell'
import { Tabs, type TabDef } from '../components/Tabs'
import { TeamBadge, PositionIcon } from '../components/badges'
import { InfoTip } from '../components/InfoTip'
import { Icon } from '../components/Icon'
import { PageSkeleton } from '../components/Skeleton'
import { useCore, useLazyTable } from '../lib/useData'
import { classifyZone, toPitch } from '../lib/shotzones'
import { num, str } from '../lib/rows'
import { teamLabel, FDR_COLORS } from '../lib/util'
import type { FixtureEaseRow, RatingRow, Row, TeamRatingRow } from '../lib/types'

/* ── Difficulty model ────────────────────────────────────────────────────────
   Every fixture carries FPL's own 1–5 difficulty (fdr). When the richer
   pipeline metrics are available (att_ease / def_ease — opponent xGC and xG vs
   the league, home/away adjusted) we use them; otherwise we derive an ease
   from the FDR so the grid still ranks and colours sensibly out of season. */
const FDR_EASE: Record<number, number> = { 1: 1.3, 2: 1.15, 3: 1.0, 4: 0.85, 5: 0.7 }
const easeFromFdr = (fdr: number) => FDR_EASE[fdr] ?? 1
const attEase = (f: FixtureEaseRow) => num(f, 'att_ease') ?? easeFromFdr(f.fdr)
const defEase = (f: FixtureEaseRow) => num(f, 'def_ease') ?? easeFromFdr(f.fdr)
const overallEase = (f: FixtureEaseRow) => (attEase(f) + defEase(f)) / 2

const WINDOWS = [4, 6, 8] as const

const VIEW_TABS: TabDef[] = [
  { id: 'difficulty', label: 'Difficulty' },
  { id: 'rotation', label: 'Rotation Planner' },
  { id: 'matchup', label: 'Matchup Explorer' },
]
type View = 'difficulty' | 'rotation' | 'matchup'

/* Our own fixture difficulty is driven by opponent strength from our team
   ratings, split into three lenses. It falls back to FPL's FDR only when the
   opponent has no rating yet (e.g. a newly promoted club, pre-season). */
type Lens = 'overall' | 'attack' | 'defence'
const LENS_TABS: TabDef[] = [
  { id: 'overall', label: 'Overall' },
  { id: 'attack', label: 'Attack' },
  { id: 'defence', label: 'Defence' },
]
const LENS_TIP: Record<Lens, string> = {
  overall: 'Our own difficulty (1 = easy … 5 = hard): the average of the Attack and Defence reads — a single score for the run.',
  attack: "How kind the fixture is for this team's ATTACKERS — set by how strong the opponent's defence is on our 0–100 defence rating. Weak opponent defence → easier.",
  defence: "How kind the fixture is for this team's DEFENCE and keeper (clean-sheet odds) — set by how strong the opponent's attack is on our 0–100 attack rating. Weak opponent attack → easier.",
}

/** Our own 1 (easy) … 5 (hard) fixture difficulty from the opponent's team
 *  rating, per lens. Falls back to FPL's FDR when the opponent has no rating. */
function analyserDiff(opp: TeamRatingRow | undefined, lens: Lens, venue: 'H' | 'A', fdr: number): { diff: number; ours: boolean } {
  if (!opp) return { diff: fdr, ours: false }
  const att = num(opp, 'attack') ?? 50
  const def = num(opp, 'defence') ?? 50
  const strength = lens === 'attack' ? def : lens === 'defence' ? att : (att + def) / 2
  let d = 1 + 4 * (strength / 100) // opponent strength 0 → 1 (easy), 100 → 5 (hard)
  d += venue === 'H' ? -0.25 : 0.25 // home is marginally kinder
  return { diff: Math.max(1, Math.min(5, d)), ours: true }
}

// Which attackers a channel weakness suits — used in the per-team fixture read.
const CHANNEL_HINT: Record<Cat, string> = {
  left: 'left-sided attackers (and inverted right wingers)',
  centre: 'central strikers and runners',
  right: 'right-sided attackers (and inverted left wingers)',
  setpiece: 'set-piece and aerial threats',
}

/** One-line scouting read of a team's upcoming run from where its opponents
 *  concede their xG (channels + set pieces) vs the league. */
function fixtureRead(opponents: string[], profiles: Map<string, Profile>, league: Profile): string | null {
  if (league.totalXg <= 0) return null
  const cats: Cat[] = ['left', 'centre', 'right', 'setpiece']
  const acc: Record<Cat, number> = { left: 0, centre: 0, right: 0, setpiece: 0 }
  let rated = 0
  for (const opp of opponents) {
    const p = profiles.get(opp)
    if (!p || p.totalXg <= 0) continue
    rated++
    for (const c of cats) acc[c] += p.shares[c]
  }
  if (!rated) return null
  const rel = cats.map((c) => {
    const share = acc[c] / rated
    const lg = league.shares[c]
    return { c, share, lg, delta: lg > 0 ? (share - lg) / lg : 0 }
  }).sort((a, b) => b.delta - a.delta)
  const top = rel.filter((r) => r.delta >= 0.1).slice(0, 2)
  if (!top.length) return `These opponents give little away by area — no obvious channel to target; lean on team quality and set pieces.`
  const bits = top.map((t) => `${CAT_LABEL[t.c]} (${Math.round(t.share * 100)}% of their conceded xG vs ${Math.round(t.lg * 100)}% league)`)
  return `Opponents concede most from ${bits.join(' and ')} — best suited to ${CHANNEL_HINT[top[0].c]}.`
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
  const [windowN, setWindowN] = useState<(typeof WINDOWS)[number]>(4)
  const [lens, setLens] = useState<Lens>('overall')

  // Season team ratings (opponent strength) drive our own difficulty.
  const seasonRating = useMemo(() => {
    const m = new Map<string, TeamRatingRow>()
    for (const r of (data?.teamRatings ?? []) as TeamRatingRow[]) if (r.window === 'season') m.set(r.team, r)
    return m
  }, [data])

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
        <PageHeader title="Fixture Analysis" subtitle="Our own difficulty ratings for every upcoming game — grid, chips and matchups" />
        <PageSkeleton error={coreError} />
      </PageShell>
    )
  }

  const fixtureEase = data.fixtureEase
  const hasFixtures = fixtureEase.length > 0
  const horizon = hasFixtures ? new Set(fixtureEase.map((f) => f.gw)).size : 0

  return (
    <PageShell>
      <PageHeader title="Fixture Analysis" subtitle="Our own difficulty ratings for every upcoming game — grid, chips and matchups" />

      <div className="mb-4"><Tabs tabs={VIEW_TABS} active={view} onChange={(id) => setView(id as View)} layoutId="fx-view" /></div>

      {view === 'difficulty' ? (
        hasFixtures ? (
          <>
            {/* Window + lens controls */}
            <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-3">
              <div className="flex items-center gap-1.5">
                <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Window</span>
                {WINDOWS.map((w) => (
                  <button
                    key={w}
                    onClick={() => setWindowN(w)}
                    className={`min-h-9 rounded-full border px-3 text-sm font-medium transition-colors ${
                      windowN === w ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
                    }`}
                  >
                    Next {w}
                  </button>
                ))}
              </div>
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
            </div>
            {horizon < windowN && (
              <p className="mb-3 -mt-1 text-xs text-ink-3">The data pipeline currently publishes {horizon} gameweeks ahead — showing all {horizon}.</p>
            )}

            <FixtureGrid fixtureEase={fixtureEase} windowN={windowN} lens={lens} seasonRating={seasonRating} profiles={profiles} league={league} />
            <ChipPlanner fixtureEase={fixtureEase} ratings={data.ratings as RatingRow[]} />
          </>
        ) : (
          <EmptyState icon={<Icon name="calendar" size={44} />}>
            The difficulty grid and chip planner switch on when next season's fixtures are published.
            <div className="mt-1 text-sm text-ink-3">The Matchup Explorer tab already works on this season's full shot data.</div>
          </EmptyState>
        )
      ) : view === 'rotation' ? (
        hasFixtures ? (
          <RotationPlanner ratings={data.ratings as RatingRow[]} fixtureEase={fixtureEase} seasonRating={seasonRating} />
        ) : (
          <EmptyState icon={<Icon name="calendar" size={44} />}>The rotation planner switches on when the fixtures are published.</EmptyState>
        )
      ) : (
        <MatchupExplorer ratings={data.ratings as RatingRow[]} />
      )}
    </PageShell>
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
const ROT_WINDOWS = [4, 6, 8] as const
const LENS_LABEL_ROT: Record<Lens, string> = { overall: 'Overall', attack: 'Attack', defence: 'Defence' }
const mean = (ds: number[]) => (ds.length ? ds.reduce((a, b) => a + b, 0) / ds.length : null)

/* ── Rotation planner: pick teams and see who to start each gameweek ──────
   Difficulty is OUR own rating (opponent strength on our team ratings) in the
   chosen lens. You set how many teams are in the rotation (N) and how many you
   actually start each week (K) — every gameweek we start the K with the kindest
   fixtures. With nothing picked we surface the best-rotating groups of size N. */
function RotationPlanner({ ratings: _ratings, fixtureEase, seasonRating }: { ratings: RatingRow[]; fixtureEase: FixtureEaseRow[]; seasonRating: Map<string, TeamRatingRow> }) {
  const [teams, setTeams] = useState<string[]>([])
  const [size, setSize] = useState<(typeof ROT_SIZES)[number]>(2)
  const [startK, setStartK] = useState(1)
  const [windowN, setWindowN] = useState<(typeof ROT_WINDOWS)[number]>(6)
  const [lens, setLens] = useState<Lens>('overall')

  const allTeams = useMemo(() => [...new Set(fixtureEase.map((f) => f.team))].sort(), [fixtureEase])
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
        .map((f) => ({ f, diff: analyserDiff(seasonRating.get(f.opponent), lens, f.venue, f.fdr).diff }))
        .sort((a, b) => a.diff - b.diff)[0]
      cache.set(key, v)
      return v
    }
  }, [fixtureEase, seasonRating, lens])

  const changeSize = (n: (typeof ROT_SIZES)[number]) => {
    setSize(n)
    setTeams((s) => s.slice(0, n))
    setStartK((k) => Math.min(k, n - 1))
  }
  const toggle = (t: string) => setTeams((s) => (s.includes(t) ? s.filter((x) => x !== t) : s.length >= size ? s : [...s, t]))

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
    const out: { group: string[]; combined: number }[] = []
    for (const group of combos(allTeams, size)) {
      const c = startKAvg(group, startK)
      if (c != null) out.push({ group, combined: c })
    }
    return out.sort((x, y) => x.combined - y.combined).slice(0, 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTeams, size, startK, gws, cellFor])

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

      {/* Team chips */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {allTeams.map((t) => {
          const on = teams.includes(t)
          const full = !on && teams.length >= size
          return (
            <button
              key={t}
              onClick={() => toggle(t)}
              disabled={full}
              className={`flex min-h-9 items-center gap-1.5 rounded-full border px-2.5 text-sm font-medium transition-colors ${
                on ? 'border-accent bg-accent-soft text-accent' : full ? 'border-line-mid text-ink-3 opacity-40' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
              }`}
            >
              <TeamBadge team={t} size={14} />{t}
            </button>
          )
        })}
        {teams.length > 0 && <button onClick={() => setTeams([])} className="min-h-9 rounded-full px-2.5 text-sm font-medium text-ink-3 hover:text-ink">Clear</button>}
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
                <span className="shrink-0 text-right">
                  <span className="font-num text-sm font-semibold tabular-nums" style={{ color: runColor(g.combined) }}>{g.combined.toFixed(1)}</span>
                  <span className="ml-1 text-[10px] text-ink-3">avg diff</span>
                </span>
              </button>
            ))}
            {topGroups.length === 0 && <div className="px-3 py-8 text-center text-sm text-ink-3">No fixtures to rank yet.</div>}
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
                      const [bg, fg] = FDR_COLORS[Math.max(1, Math.min(5, Math.round(c.diff)))] || FDR_COLORS[3]
                      return (
                        <td key={gw} className="px-1.5 py-1.5 text-center">
                          <span className={`inline-block w-full min-w-[54px] rounded px-1 py-1 text-[11px] font-semibold whitespace-nowrap ${start ? 'ring-2 ring-accent ring-offset-1 ring-offset-surface-1' : 'opacity-55'}`} style={{ background: bg, color: fg }} title={`${c.f.venue === 'H' ? 'vs' : 'at'} ${teamLabel(c.f.opponent)} — difficulty ${c.diff.toFixed(1)}${start ? ' · START' : ''}`}>
                            {c.f.opponent} <span className="opacity-70">({c.f.venue})</span>
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
            {([1, 2, 3, 4, 5] as const).map((d) => { const [bg, fg] = FDR_COLORS[d]; return <span key={d} className="rounded px-1.5 py-0.5 font-semibold" style={{ background: bg, color: fg }}>{d}</span> })}
            <span>· ringed = starting that week (the rest are benched)</span>
          </div>
        </>
      )}
    </div>
  )
}

/* ── Fixture grid: one column per gameweek, orderable by any week ──────────────
   Rows are teams; each gameweek is its own column showing the opponent, coloured
   by OUR own difficulty (opponent strength from our team ratings) in the chosen
   lens. Click any GW header (or the Run column) to rank teams by that week; tap a
   team to expand a scouting read of where its upcoming opponents are weak. */
function FixtureGrid({
  fixtureEase, windowN, lens, seasonRating, profiles, league,
}: {
  fixtureEase: FixtureEaseRow[]
  windowN: number
  lens: Lens
  seasonRating: Map<string, TeamRatingRow>
  profiles: Map<string, Profile>
  league: Profile
}) {
  const [sortKey, setSortKey] = useState<number | 'run'>('run')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc') // asc = easiest first
  const [open, setOpen] = useState<string | null>(null)

  const gws = useMemo(
    () => [...new Set(fixtureEase.map((f) => f.gw))].sort((a, b) => a - b).slice(0, windowN),
    [fixtureEase, windowN],
  )
  const gwSet = useMemo(() => new Set(gws), [gws])

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
        const { diff, ours } = analyserDiff(seasonRating.get(f.opponent), lens, f.venue, f.fdr)
        if (!ours) usedFdr = true
        sum += diff
        count++
      }
      return { team, byGw, opponents, run: count ? sum / count : null, usedFdr }
    })
  }, [fixtureEase, gwSet, lens, seasonRating])

  // Mean of our difficulty for a team in one gameweek (blanks → null, doubles → avg).
  const gwDiff = (r: (typeof rows)[number], gw: number): number | null => {
    const fs = r.byGw.get(gw)
    if (!fs || !fs.length) return null
    return fs.reduce((s, f) => s + analyserDiff(seasonRating.get(f.opponent), lens, f.venue, f.fdr).diff, 0) / fs.length
  }

  const sorted = useMemo(() => {
    const val = (r: (typeof rows)[number]) => (sortKey === 'run' ? r.run : gwDiff(r, sortKey))
    return [...rows].sort((a, b) => {
      const av = val(a)
      const bv = val(b)
      if (av == null && bv == null) return a.team.localeCompare(b.team)
      if (av == null) return 1 // teams with no fixture that week sink to the bottom
      if (bv == null) return -1
      return dir === 'asc' ? av - bv : bv - av
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, dir, lens, seasonRating])

  const clickHeader = (key: number | 'run') => {
    if (sortKey === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setDir('asc')
    }
  }
  const arrow = (key: number | 'run') => (sortKey === key ? (dir === 'asc' ? ' ↑' : ' ↓') : '')

  const headCls = 'cursor-pointer select-none px-2 py-2 text-center text-[11px] font-semibold tracking-wide text-ink-3 uppercase transition-colors hover:text-ink'
  const colSpan = gws.length + 2

  return (
    <div className="mb-8">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-3">
        <span>Tap a gameweek to sort by that week; tap a team for the read on its run.</span>
        <InfoTip text="Our own difficulty (1 = easy … 5 = hard), not FPL's FDR: each cell is coloured by how strong the opponent is on our team ratings, in the lens you pick above (Attack uses the opponent's defence rating; Defence uses their attack rating). Where an opponent has no rating yet (a promoted club, pre-season) we fall back to FPL's FDR and mark the cell with a dot. The Run column is the window average." />
      </div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-1">
              <th className="sticky left-0 z-10 bg-surface-1 px-3 py-2 text-left text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Team</th>
              {gws.map((gw) => (
                <th key={gw} onClick={() => clickHeader(gw)} className={headCls}>GW{gw}{arrow(gw)}</th>
              ))}
              <th onClick={() => clickHeader('run')} className={headCls}>Run{arrow('run')}</th>
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
                              const { diff, ours } = analyserDiff(seasonRating.get(f.opponent), lens, f.venue, f.fdr)
                              const [bg, fg] = FDR_COLORS[Math.max(1, Math.min(5, Math.round(diff)))] || FDR_COLORS[3]
                              return (
                                <span key={i} className="inline-block w-full min-w-[54px] rounded px-1 py-1 text-[11px] font-semibold whitespace-nowrap" style={{ background: bg, color: fg }} title={`GW${gw} ${f.venue === 'H' ? 'vs' : 'at'} ${teamLabel(f.opponent)} — difficulty ${diff.toFixed(1)}${ours ? '' : ' (FPL FDR — opponent unrated)'}`}>
                                  {f.opponent} <span className="opacity-70">({f.venue})</span>{!ours && <span className="opacity-70"> ·</span>}
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
                    {r.run == null ? <span className="text-ink-3">—</span> : (
                      <span className="font-num text-sm font-semibold tabular-nums" style={{ color: runColor(r.run) }}>{r.run.toFixed(1)}</span>
                    )}
                  </td>
                </tr>
                {open === r.team && (
                  <tr className="border-b border-line bg-surface-1/40">
                    <td colSpan={colSpan} className="px-3 py-3">
                      <RunRead team={r.team} opponents={r.opponents} profiles={profiles} league={league} usedFdr={r.usedFdr} n={gws.length} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {/* Difficulty legend */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
        <span>Our difficulty:</span>
        {([1, 2, 3, 4, 5] as const).map((d) => {
          const [bg, fg] = FDR_COLORS[d]
          return <span key={d} className="rounded px-1.5 py-0.5 font-semibold" style={{ background: bg, color: fg }}>{d}</span>
        })}
        <span>1 = easiest, 5 = hardest · “·” = FPL FDR fallback (opponent unrated)</span>
      </div>
    </div>
  )
}

/** The expandable per-team scouting read of an upcoming run. */
function RunRead({ team, opponents, profiles, league, usedFdr, n }: { team: string; opponents: string[]; profiles: Map<string, Profile>; league: Profile; usedFdr: boolean; n: number }) {
  const read = fixtureRead(opponents, profiles, league)
  return (
    <div className="text-sm text-ink-2">
      <div className="mb-1 flex items-center gap-2 font-semibold text-ink"><TeamBadge team={team} size={15} />Next {n}: {teamLabel(team)}</div>
      {read ? <p>{read}</p> : <p className="text-ink-3">No shot-concession data for these opponents yet — difficulty is from team strength only.</p>}
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

/* ── Chip planner ── */
function ChipPlanner({ fixtureEase, ratings }: { fixtureEase: FixtureEaseRow[]; ratings: RatingRow[] }) {
  const picks = useMemo(() => {
    const gws = [...new Set(fixtureEase.map((f) => f.gw))].sort((a, b) => a - b)
    if (!gws.length) return null
    const byGw = new Map<number, FixtureEaseRow[]>()
    for (const f of fixtureEase) {
      if (!byGw.has(f.gw)) byGw.set(f.gw, [])
      byGw.get(f.gw)!.push(f)
    }

    // Bench Boost: the GW where the most teams have a kind fixture — a deep
    // squad is most likely to have all 15 pointing the right way.
    const easyCounts = gws.map((gw) => ({ gw, n: (byGw.get(gw) ?? []).filter((f) => overallEase(f) >= 1.05).length }))
    const bb = [...easyCounts].sort((a, b) => b.n - a.n)[0]

    // Triple Captain: the single softest fixture for one of the league's
    // strongest attacking teams (top 6 by season points of fixtures listed).
    const strongTeams = new Set(
      [...new Set(fixtureEase.map((f) => f.team))]
        .map((t) => ({ t, xg: ratings.filter((r) => r.team === t).reduce((s, r) => s + (num(r, 'season_ppg') ?? 0), 0) }))
        .sort((a, b) => b.xg - a.xg)
        .slice(0, 6)
        .map((x) => x.t),
    )
    const tc = [...fixtureEase]
      .filter((f) => strongTeams.has(f.team))
      .sort((a, b) => attEase(b) - attEase(a))[0]

    // Wildcard: the GW where the set of teams with kind runs shifts the most
    // over the following GWs vs the previous — a fixture swing point.
    let wc: number | null = null
    let bestSwing = 0
    for (let i = 1; i < gws.length - 1; i++) {
      const before = new Set((byGw.get(gws[i - 1]) ?? []).filter((f) => overallEase(f) >= 1.05).map((f) => f.team))
      const after = new Set((byGw.get(gws[i]) ?? []).filter((f) => overallEase(f) >= 1.05).map((f) => f.team))
      let swing = 0
      after.forEach((t) => { if (!before.has(t)) swing++ })
      if (swing > bestSwing) { bestSwing = swing; wc = gws[i] }
    }

    return { bb, tc, wc, bestSwing }
  }, [fixtureEase, ratings])

  if (!picks) return null
  const { bb, tc, wc, bestSwing } = picks

  const card = (title: string, body: React.ReactNode, tip: string) => (
    <div className="rounded-xl border border-line bg-surface-1/60 p-4">
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">{title}<InfoTip text={tip} /></div>
      <div className="text-sm text-ink-2">{body}</div>
    </div>
  )

  return (
    <div className="mb-8">
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-ink-2 uppercase">Chip Planner — based on the published fixture window</h2>
      <div className="grid gap-3 md:grid-cols-3">
        {bb && bb.n > 0 && card('Bench Boost', <><strong className="text-ink">GW{bb.gw}</strong> — {bb.n} teams have an easier-than-average fixture, the widest spread in this window.</>, 'Bench Boost wants all 15 players pointing the right way, so we look for the gameweek where the most teams have a kind fixture.')}
        {tc && card('Triple Captain', <><strong className="text-ink">GW{tc.gw}</strong> — {teamLabel(tc.team)} {tc.venue === 'H' ? 'vs' : 'at'} {teamLabel(tc.opponent)} (FDR {tc.fdr}).</>, 'Triple Captain wants the softest single fixture for an elite attacking side — the best chance of a haul from your captain.')}
        {wc != null && bestSwing >= 3 && card('Wildcard / Free Hit', <><strong className="text-ink">GW{wc}</strong> — {bestSwing} teams' runs turn kind here; rebuilding into the swing captures it.</>, 'A wildcard lands best just before a fixture swing — when a new group of teams starts an easy run you are not set up for.')}
      </div>
      <p className="mt-2 text-xs text-ink-3">Heuristics over the published window only — they sharpen as more fixtures land.</p>
    </div>
  )
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
                  onClick={() => navigate(`/player?name=${encodeURIComponent(String(r.web_name))}`)}
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
