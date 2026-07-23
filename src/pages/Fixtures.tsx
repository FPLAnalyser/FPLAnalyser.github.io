import { useMemo, useState } from 'react'
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
import { teamFullNames, FDR_COLORS } from '../lib/util'
import type { FixtureEaseRow, RatingRow, Row } from '../lib/types'

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
  { id: 'matchup', label: 'Matchup Explorer' },
]
type View = 'difficulty' | 'matchup'

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
            {/* Window control */}
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
            </div>
            {horizon < windowN && (
              <p className="mb-3 -mt-1 text-xs text-ink-3">The data pipeline currently publishes {horizon} gameweeks ahead — showing all {horizon}.</p>
            )}

            <FixtureGrid fixtureEase={fixtureEase} windowN={windowN} />
            <ChipPlanner fixtureEase={fixtureEase} ratings={data.ratings as RatingRow[]} />
          </>
        ) : (
          <EmptyState icon={<Icon name="calendar" size={44} />}>
            The difficulty grid and chip planner switch on when next season's fixtures are published.
            <div className="mt-1 text-sm text-ink-3">The Matchup Explorer tab already works on this season's full shot data.</div>
          </EmptyState>
        )
      ) : (
        <MatchupExplorer ratings={data.ratings as RatingRow[]} />
      )}
    </PageShell>
  )
}

/* ── Fixture grid: one column per gameweek, orderable by any week ──────────────
   Rows are teams; each gameweek is its own column showing the opponent, coloured
   by FPL difficulty. Click any GW header (or the Run column) to rank teams by
   how kind that week is; the first click puts the easiest teams on top. */
function FixtureGrid({ fixtureEase, windowN }: { fixtureEase: FixtureEaseRow[]; windowN: number }) {
  const [sortKey, setSortKey] = useState<number | 'run'>('run')
  const [dir, setDir] = useState<'asc' | 'desc'>('asc') // asc = easiest (lowest FDR) first

  const gws = useMemo(
    () => [...new Set(fixtureEase.map((f) => f.gw))].sort((a, b) => a - b).slice(0, windowN),
    [fixtureEase, windowN],
  )
  const gwSet = useMemo(() => new Set(gws), [gws])

  const rows = useMemo(() => {
    const teams = [...new Set(fixtureEase.map((f) => f.team))]
    return teams.map((team) => {
      const byGw = new Map<number, FixtureEaseRow[]>()
      let sum = 0
      let count = 0
      for (const f of fixtureEase) {
        if (f.team !== team || !gwSet.has(f.gw)) continue
        if (!byGw.has(f.gw)) byGw.set(f.gw, [])
        byGw.get(f.gw)!.push(f)
        sum += f.fdr
        count++
      }
      return { team, byGw, run: count ? sum / count : null }
    })
  }, [fixtureEase, gwSet])

  // Mean FDR for a team in one gameweek (handles blanks → null, doubles → avg).
  const gwFdr = (r: (typeof rows)[number], gw: number): number | null => {
    const fs = r.byGw.get(gw)
    if (!fs || !fs.length) return null
    return fs.reduce((s, f) => s + f.fdr, 0) / fs.length
  }

  const sorted = useMemo(() => {
    const val = (r: (typeof rows)[number]) => (sortKey === 'run' ? r.run : gwFdr(r, sortKey))
    return [...rows].sort((a, b) => {
      const av = val(a)
      const bv = val(b)
      if (av == null && bv == null) return a.team.localeCompare(b.team)
      if (av == null) return 1 // teams with no fixture that week sink to the bottom
      if (bv == null) return -1
      return dir === 'asc' ? av - bv : bv - av
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, dir])

  const clickHeader = (key: number | 'run') => {
    if (sortKey === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setDir('asc')
    }
  }
  const arrow = (key: number | 'run') => (sortKey === key ? (dir === 'asc' ? ' ↑' : ' ↓') : '')

  const headCls = 'cursor-pointer select-none px-2 py-2 text-center text-[11px] font-semibold tracking-wide text-ink-3 uppercase transition-colors hover:text-ink'

  return (
    <div className="mb-8">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] text-ink-3">
        <span>Tap a gameweek to sort by that week’s difficulty.</span>
        <InfoTip text="Rows are teams; each column is a gameweek. Cells show the opponent and venue (H/A), coloured by FPL's 1–5 fixture difficulty (green = easy, red = hard). The Run column is the average difficulty across the window — lower is kinder." />
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
              <tr key={r.team} className="border-b border-line last:border-0">
                <td className="sticky left-0 z-10 bg-surface-1 px-3 py-2">
                  <span className="flex items-center gap-2 font-medium whitespace-nowrap text-ink"><TeamBadge team={r.team} size={16} />{teamFullNames[r.team] || r.team}</span>
                </td>
                {gws.map((gw) => {
                  const fs = r.byGw.get(gw)
                  return (
                    <td key={gw} className="px-1.5 py-1.5 text-center">
                      {fs && fs.length ? (
                        <span className="flex flex-col items-center gap-1">
                          {fs.map((f, i) => {
                            const [bg, fg] = FDR_COLORS[f.fdr] || FDR_COLORS[3]
                            return (
                              <span key={i} className="inline-block w-full min-w-[54px] rounded px-1 py-1 text-[11px] font-semibold whitespace-nowrap" style={{ background: bg, color: fg }} title={`GW${gw} ${f.venue === 'H' ? 'vs' : 'at'} ${teamFullNames[f.opponent] || f.opponent} (FDR ${f.fdr})`}>
                                {f.opponent} <span className="opacity-70">({f.venue})</span>
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
            ))}
          </tbody>
        </table>
      </div>
      {/* FDR legend */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
        <span>Difficulty:</span>
        {([1, 2, 3, 4, 5] as const).map((d) => {
          const [bg, fg] = FDR_COLORS[d]
          return <span key={d} className="rounded px-1.5 py-0.5 font-semibold" style={{ background: bg, color: fg }}>{d}</span>
        })}
        <span>1 = easiest, 5 = hardest</span>
      </div>
    </div>
  )
}

// Colour for the average-FDR "Run" number (1 easy → 5 hard).
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
        {tc && card('Triple Captain', <><strong className="text-ink">GW{tc.gw}</strong> — {teamFullNames[tc.team] || tc.team} {tc.venue === 'H' ? 'vs' : 'at'} {teamFullNames[tc.opponent] || tc.opponent} (FDR {tc.fdr}).</>, 'Triple Captain wants the softest single fixture for an elite attacking side — the best chance of a haul from your captain.')}
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
