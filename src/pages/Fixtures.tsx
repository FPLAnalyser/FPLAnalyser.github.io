import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, PageShell, EmptyState } from '../components/PageShell'
import { SortableTable, type Column } from '../components/SortableTable'
import { FixtureChips } from '../components/FixtureChips'
import { TeamBadge, PositionIcon } from '../components/badges'
import { InfoTip } from '../components/InfoTip'
import { Icon } from '../components/Icon'
import { PageSkeleton } from '../components/Skeleton'
import { useCore, useLazyTable } from '../lib/useData'
import { classifyZone, toPitch } from '../lib/shotzones'
import { num, str } from '../lib/rows'
import { teamFullNames } from '../lib/util'
import type { FixtureEaseRow, RatingRow, Row } from '../lib/types'

/* ── Custom difficulty model ─────────────────────────────────────────────────
   Per fixture the pipeline publishes att_ease (opponent xGC vs league — how
   attackable they are) and def_ease (league xG vs opponent xG — how blunt
   their attack is), both home/away adjusted. We aggregate those into three
   lenses per team window: Overall, Attackers, Defenders. */

const WINDOWS = [4, 6, 8] as const
type Lens = 'overall' | 'att' | 'def'
const LENS_LABEL: Record<Lens, string> = { overall: 'Overall', att: 'Attackers', def: 'Defenders' }
const LENS_TIP: Record<Lens, string> = {
  overall: 'Average of the attacker and defender ease across the window — a single difficulty score for the run.',
  att: "Ease for this team's attackers: how many goals their upcoming opponents concede vs the league average, adjusted for home/away. Above ×1.00 = softer than average.",
  def: "Ease for this team's defenders and keeper: how blunt their upcoming opponents' attacks are vs the league average, adjusted for home/away. Above ×1.00 = friendlier for clean sheets.",
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
  const { data } = useCore()
  const [windowN, setWindowN] = useState<(typeof WINDOWS)[number]>(4)
  const [lens, setLens] = useState<Lens>('overall')

  if (!data) {
    return (
      <PageShell>
        <PageHeader title="Fixture Analysis" subtitle="Our own difficulty ratings for every upcoming game — overall, for attackers and for defenders" />
        <PageSkeleton />
      </PageShell>
    )
  }

  const fixtureEase = data.fixtureEase
  const hasFixtures = fixtureEase.length > 0
  const horizon = hasFixtures ? new Set(fixtureEase.map((f) => f.gw)).size : 0

  return (
    <PageShell>
      <PageHeader title="Fixture Analysis" subtitle="Our own difficulty ratings for every upcoming game — overall, for attackers and for defenders" />

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
          <span className="mr-1 text-[11px] font-semibold tracking-[0.12em] text-ink-3 uppercase">Rank by</span>
          {(Object.keys(LENS_LABEL) as Lens[]).map((l) => (
            <span key={l} className="flex items-center gap-1">
              <button
                onClick={() => setLens(l)}
                className={`min-h-9 rounded-full border px-3 text-sm font-medium transition-colors ${
                  lens === l ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
                }`}
              >
                {LENS_LABEL[l]}
              </button>
              <InfoTip text={LENS_TIP[l]} />
            </span>
          ))}
        </div>
      </div>
      {hasFixtures && horizon < windowN && (
        <p className="mb-3 -mt-1 text-xs text-ink-3">The data pipeline currently publishes {horizon} gameweeks ahead — showing all {horizon}.</p>
      )}

      {hasFixtures ? (
        <>
          <DifficultyMatrix fixtureEase={fixtureEase} windowN={windowN} lens={lens} />
          <ChipPlanner fixtureEase={fixtureEase} ratings={data.ratings as RatingRow[]} />
        </>
      ) : (
        <EmptyState icon={<Icon name="calendar" size={44} />}>
          The difficulty matrix and chip planner switch on when next season's fixtures are published.
          <div className="mt-1 text-sm text-ink-3">The matchup explorer below already works on this season's full shot data.</div>
        </EmptyState>
      )}

      <MatchupExplorer ratings={data.ratings as RatingRow[]} />
    </PageShell>
  )
}

/* ── Difficulty matrix ── */
function DifficultyMatrix({ fixtureEase, windowN, lens }: { fixtureEase: FixtureEaseRow[]; windowN: number; lens: Lens }) {
  const rows = useMemo(() => {
    const teams = [...new Set(fixtureEase.map((f) => f.team))]
    return teams.map((team) => {
      const next = fixtureEase.filter((f) => f.team === team).sort((a, b) => a.gw - b.gw).slice(0, windowN)
      const avg = (key: string) => next.reduce((s, f) => s + (num(f, key) ?? 1), 0) / (next.length || 1)
      const att = avg('att_ease')
      const def = avg('def_ease')
      return { team, att, def, overall: (att + def) / 2, n: next.length }
    })
  }, [fixtureEase, windowN])

  const easeCell = (v: number) => (
    <span className={`font-num tabular-nums ${v >= 1.05 ? 'text-good' : v <= 0.95 ? 'text-bad' : 'text-ink-2'}`}>×{v.toFixed(2)}</span>
  )

  const columns: Column<(typeof rows)[number]>[] = [
    {
      key: 'team',
      header: 'Team',
      align: 'left',
      sortValue: (r) => r.team,
      cell: (r) => <span className="flex items-center gap-2 font-medium text-ink"><TeamBadge team={r.team} size={16} />{teamFullNames[r.team] || r.team}</span>,
    },
    {
      key: 'fixtures',
      header: `Next ${windowN}`,
      align: 'left',
      tip: 'Upcoming opponents, coloured by FPL fixture difficulty (green = easy, red = hard). H = home, A = away.',
      cell: (r) => <FixtureChips fixtureEase={fixtureEase} team={r.team} n={windowN} />,
    },
    { key: 'overall', header: 'Overall', tip: LENS_TIP.overall, sortValue: (r) => r.overall, cell: (r) => easeCell(r.overall) },
    { key: 'att', header: 'ATT', tip: LENS_TIP.att, sortValue: (r) => r.att, cell: (r) => easeCell(r.att) },
    { key: 'def', header: 'DEF', tip: LENS_TIP.def, sortValue: (r) => r.def, cell: (r) => easeCell(r.def) },
  ]

  return (
    <div className="mb-8">
      <SortableTable rows={rows} columns={columns} initialSort={lens} initialDir="desc" rowKey={(r) => r.team} featured />
    </div>
  )
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
    const overallOf = (f: FixtureEaseRow) => ((num(f, 'att_ease') ?? 1) + (num(f, 'def_ease') ?? 1)) / 2

    // Bench Boost: the GW where the most teams have a kind fixture — a deep
    // squad is most likely to have all 15 pointing the right way.
    const easyCounts = gws.map((gw) => ({ gw, n: (byGw.get(gw) ?? []).filter((f) => overallOf(f) >= 1.05).length }))
    const bb = [...easyCounts].sort((a, b) => b.n - a.n)[0]

    // Triple Captain: the single softest fixture for one of the league's
    // strongest attacking teams (top 6 by season xG share of fixtures listed).
    const strongTeams = new Set(
      [...new Set(fixtureEase.map((f) => f.team))]
        .map((t) => ({ t, xg: ratings.filter((r) => r.team === t).reduce((s, r) => s + (num(r, 'season_ppg') ?? 0), 0) }))
        .sort((a, b) => b.xg - a.xg)
        .slice(0, 6)
        .map((x) => x.t),
    )
    const tc = [...fixtureEase]
      .filter((f) => strongTeams.has(f.team))
      .sort((a, b) => (num(b, 'att_ease') ?? 1) - (num(a, 'att_ease') ?? 1))[0]

    // Wildcard: the GW where the set of teams with kind runs shifts the most
    // over the following 3 GWs vs the previous 3 — a fixture swing point.
    let wc: number | null = null
    let bestSwing = 0
    for (let i = 1; i < gws.length - 1; i++) {
      const before = new Set((byGw.get(gws[i - 1]) ?? []).filter((f) => overallOf(f) >= 1.05).map((f) => f.team))
      const after = new Set((byGw.get(gws[i]) ?? []).filter((f) => overallOf(f) >= 1.05).map((f) => f.team))
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
        {tc && card('Triple Captain', <><strong className="text-ink">GW{tc.gw}</strong> — {teamFullNames[tc.team] || tc.team} {tc.venue === 'H' ? 'vs' : 'at'} {teamFullNames[tc.opponent] || tc.opponent}, attacker ease ×{(num(tc, 'att_ease') ?? 1).toFixed(2)}.</>, 'Triple Captain wants the softest single fixture for an elite attacking side — the best chance of a haul from your captain.')}
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
              <div className="mb-2 flex items-center gap-2 font-semibold text-ink"><TeamBadge team={opp} size={18} />Where {teamFullNames[opp] || opp} concede their xG</div>
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
