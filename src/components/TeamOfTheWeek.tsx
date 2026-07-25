import { useMemo, useState } from 'react'
import { TeamBadge } from './badges'
import { Icon } from './Icon'
import { Pitch } from './Pitch'
import { PlayerPhoto } from './PlayerPhoto'
import { Exportable } from './ExportPanel'
import { PlayerCardSheet } from './PlayerCardSheet'
import { ratingTo100 } from './StarRating'
import { num } from '../lib/rows'
import { useSeason } from '../lib/season'
import { useLazyTable } from '../lib/useData'
import type { FixtureEaseRow, RatingRow, Row, TeamRatingRow } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   Two XIs on one surface:
     · Team of the Week — what actually happened in the last finished
       gameweek, per player, from gameweek_stats.json (goals, assists,
       bonus, xG, xA and the points they returned), with a weekly rating.
     · Next GW projection — the best £100m XI for the week ahead, built
       from projected goal involvement and clean-sheet odds.
   ════════════════════════════════════════════════════════════════════════ */

const FORMATIONS: [number, number, number][] = [
  [3, 4, 3], [3, 5, 2], [4, 3, 3], [4, 4, 2], [4, 5, 1], [5, 3, 2], [5, 4, 1],
]

interface Pick { r: RatingRow; score: number; gw?: Row }

/** Best formation-legal XI by score. When `budget` is set, greedily trims
 * the most expensive picks until the XI fits (FPL's £100m squad rule
 * applied to the starting eleven). */
function pickXI(pool: Pick[], budget?: number) {
  const byPos = (pos: string) => pool.filter((p) => p.r.position === pos).sort((a, b) => b.score - a.score)
  const gk = byPos('GKP'), def = byPos('DEF'), mid = byPos('MID'), fwd = byPos('FWD')
  if (!gk.length) return null
  const cost = (p: Pick) => num(p.r, 'price') ?? 0

  let best: { total: number; rows: Pick[][]; formation: string } | null = null
  for (const [d, m, f] of FORMATIONS) {
    if (def.length < d || mid.length < m || fwd.length < f) continue
    let rows: Pick[][] = [[gk[0]], def.slice(0, d), mid.slice(0, m), fwd.slice(0, f)]
    if (budget != null) {
      // Swap out the priciest player for the best affordable replacement in
      // his position until the XI is inside the budget.
      const spend = () => rows.flat().reduce((s, p) => s + cost(p), 0)
      const bench = { GKP: gk, DEF: def, MID: mid, FWD: fwd } as Record<string, Pick[]>
      let guard = 0
      while (spend() > budget && guard++ < 40) {
        const flat = rows.flat()
        // Drop the pick with the worst score-per-£ and replace with the next
        // best unused player in that slot.
        const victim = [...flat].sort((a, b) => cost(a) / Math.max(a.score, 0.01) - cost(b) / Math.max(b.score, 0.01)).pop()
        if (!victim) break
        const used = new Set(flat.map((p) => p.r.element))
        const repl = bench[String(victim.r.position)].find((p) => !used.has(p.r.element) && cost(p) < cost(victim))
        if (!repl) break
        rows = rows.map((row) => row.map((p) => (p.r.element === victim.r.element ? repl : p)))
      }
      if (spend() > budget) continue // this shape can't be afforded
    }
    const total = rows.flat().reduce((s, p) => s + p.score, 0)
    if (!best || total > best.total) best = { total, rows, formation: `${d}-${m}-${f}` }
  }
  return best
}

/** One card: the week's returns on the front, tappable for the full sheet. */
function TotwCard({ pick, delay, onClick, projected }: { pick: Pick; delay: number; onClick: () => void; projected?: boolean }) {
  const { r, gw, score } = pick
  const pts = gw ? num(gw, 'total_points') : null
  const goals = gw ? num(gw, 'goals_scored') : null
  const assists = gw ? num(gw, 'assists') : null
  const bonus = gw ? num(gw, 'bonus') : null
  const xg = gw ? num(gw, 'expected_goals') : null
  const xa = gw ? num(gw, 'expected_assists') : null
  const cs = gw ? num(gw, 'clean_sheets') : null

  return (
    <button
      onClick={onClick}
      className="totw-card w-[104px] rounded-xl border border-accent/45 p-2 text-center transition-transform hover:-translate-y-0.5 md:w-[116px]"
      style={{ animationDelay: `${delay}s`, background: 'linear-gradient(165deg,#211d16,#0d0b08)' }}
    >
      <div className="flex items-start justify-between">
        <span className="metallic-num font-num text-[17px] leading-none font-extrabold tabular-nums">{Math.round(score)}</span>
        {pts != null && (
          <span className="rounded-md bg-accent px-1.5 py-0.5 font-num text-[11px] leading-none font-extrabold tabular-nums text-[#10131b]">{pts}</span>
        )}
        {projected && <span className="rounded-md border border-accent/50 px-1.5 py-0.5 text-[9px] font-extrabold text-accent-2">PROJ</span>}
      </div>
      <PlayerPhoto
        code={num(r, 'code')} element={num(r, 'element')}
        className="mx-auto my-1 w-9 rounded-md object-cover object-top" style={{ height: 44 }}
        placeholder={<span className="mx-auto my-1 block w-9 rounded-md bg-white/5" style={{ height: 44 }} />}
      />
      <div className="truncate text-[11.5px] font-bold text-ink">{String(r.web_name)}</div>
      <div className="mt-0.5 flex items-center justify-center gap-1 text-[9.5px] text-ink-3">
        <TeamBadge team={String(r.team)} size={10} />{String(r.team)} · £{r.price}m
      </div>
      {gw && (
        <div className="mt-1 border-t border-white/8 pt-1 text-[9.5px] leading-tight text-ink-2">
          {(goals ?? 0) > 0 && <span className="mr-1">{goals}G</span>}
          {(assists ?? 0) > 0 && <span className="mr-1">{assists}A</span>}
          {(cs ?? 0) > 0 && <span className="mr-1">CS</span>}
          {(bonus ?? 0) > 0 && <span className="mr-1 text-accent-2">+{bonus}B</span>}
          {(goals ?? 0) === 0 && (assists ?? 0) === 0 && (cs ?? 0) === 0 && (bonus ?? 0) === 0 && <span>—</span>}
          <span className="mt-0.5 block text-ink-3">
            {xg != null ? `${xg.toFixed(2)} xG` : ''}{xg != null && xa != null ? ' · ' : ''}{xa != null ? `${xa.toFixed(2)} xA` : ''}
          </span>
        </div>
      )}
      {projected && <div className="mt-1 border-t border-white/8 pt-1 text-[9.5px] text-ink-2">{score.toFixed(1)} proj pts</div>}
    </button>
  )
}

/** A weekly 0–100 rating from what a player actually returned: FPL points
 * carry it, with underlying involvement as the tie-break so a lucky tap-in
 * doesn't outrank a dominant display. */
function weeklyRating(gw: Row): number {
  const pts = num(gw, 'total_points') ?? 0
  const xgi = (num(gw, 'expected_goals') ?? 0) + (num(gw, 'expected_assists') ?? 0)
  const bps = num(gw, 'bps') ?? 0
  // Tuned so a big haul lands in the 80s-90s and only a truly exceptional
  // week reaches 100 — a wall of 100s tells you nothing.
  return Math.max(0, Math.min(100, pts * 3.6 + xgi * 14 + bps * 0.28))
}

export function TeamOfTheWeek({
  ratings,
  currentGw: _currentGw,
  fixtureEase = [],
  teamRatings = [],
  onPlayer: _onPlayer,
}: {
  ratings: RatingRow[]
  currentGw: number | null
  fixtureEase?: FixtureEaseRow[]
  teamRatings?: TeamRatingRow[]
  onPlayer?: (name: string, code?: number | null) => void
}) {
  const { info } = useSeason()
  const preseason = Boolean(info?.provisional)
  const gwQ = useLazyTable<Row[]>('gameweek_stats')
  const [view, setView] = useState<'week' | 'next'>('week')
  const [runId, setRunId] = useState(0)
  const [sheetFor, setSheetFor] = useState<RatingRow | null>(null)

  const byElement = useMemo(() => {
    const m = new Map<number, RatingRow>()
    for (const r of ratings) if (r.element != null) m.set(r.element, r)
    return m
  }, [ratings])

  // ── the week that was ──
  const lastGw = useMemo(() => {
    const rows = gwQ.data ?? []
    const gws = rows.map((r) => num(r, 'gw')).filter((g): g is number => g != null)
    return gws.length ? Math.max(...gws) : null
  }, [gwQ.data])

  const weekXI = useMemo(() => {
    if (lastGw == null) return null
    const picks: Pick[] = []
    for (const g of gwQ.data ?? []) {
      if (num(g, 'gw') !== lastGw) continue
      const el = num(g, 'element')
      const r = el != null ? byElement.get(el) : null
      if (!r) continue
      picks.push({ r, gw: g, score: weeklyRating(g) })
    }
    return pickXI(picks)
  }, [gwQ.data, lastGw, byElement])

  // ── the week ahead: projected points within £100m ──
  const nextXI = useMemo(() => {
    if (!fixtureEase.length) return null
    const seasonRating = new Map<string, TeamRatingRow>()
    for (const t of teamRatings) if (t.window === 'season') seasonRating.set(t.team, t)
    const nextGw = Math.min(...fixtureEase.map((f) => f.gw))
    const picks: Pick[] = []
    for (const r of ratings) {
      const base = num(r, 'season_xpts_adjusted') ?? num(r, 'season_xpts_per_game')
      if (base == null) continue
      const fx = fixtureEase.filter((f) => f.team === String(r.team) && f.gw === nextGw)
      if (!fx.length) continue // blank gameweek
      // Fixture multiplier: attackers ride att_ease, defenders/keepers def_ease.
      const attacking = r.position === 'MID' || r.position === 'FWD'
      const factor = fx.reduce((s, f) => {
        const e = attacking ? num(f, 'att_ease') : num(f, 'def_ease')
        return s + (e ?? (f.fdr ? (6 - f.fdr) / 3 : 1))
      }, 0) / fx.length
      picks.push({ r, score: base * factor })
    }
    return pickXI(picks, 100)
  }, [ratings, fixtureEase, teamRatings])

  const nextGwNum = fixtureEase.length ? Math.min(...fixtureEase.map((f) => f.gw)) : null
  const showWeek = view === 'week'
  const xi = showWeek ? weekXI : nextXI

  // Pre-season with no gameweeks played: fall back to the season XI so the
  // panel still says something true.
  const fallbackXI = useMemo(() => {
    if (weekXI || !preseason) return null
    const picks: Pick[] = ratings
      .filter((r) => ratingTo100(num(r, 'season_overall_score')) != null && num(r, 'season_ok') !== 0)
      .map((r) => ({ r, score: ratingTo100(num(r, 'season_overall_score')) ?? 0 }))
    return pickXI(picks)
  }, [ratings, weekXI, preseason])

  const shown = xi ?? (showWeek ? fallbackXI : null)

  // The view switch always renders — an empty state must never strand the
  // reader on a tab with no way back.
  const chips = (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {([['week', 'Last gameweek'], ['next', 'Next gameweek — projected']] as const).map(([id, label]) => (
        <button
          key={id}
          onClick={() => setView(id)}
          className={`min-h-9 rounded-full border px-3.5 text-[13px] font-semibold transition-colors ${
            view === id ? 'border-accent bg-accent-soft text-accent' : 'border-line-mid text-ink-2 hover:border-line-strong hover:text-ink'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )

  if (!shown) {
    return (
      <>
        {chips}
        <div className="rounded-xl border border-line bg-surface-1 p-6 text-center text-sm text-ink-3">
          {showWeek
            ? 'The Team of the Week appears once a gameweek has been played.'
            : 'The projected XI appears once next-gameweek fixtures are published — during a finished season there is no week ahead to project.'}
        </div>
      </>
    )
  }

  const title = showWeek
    ? (weekXI ? `Team of the Week · GW${lastGw}` : 'Team of the Season so far')
    : `Projected XI · GW${nextGwNum ?? '—'}`
  const sub = showWeek
    ? (weekXI
        ? 'The best XI on what actually happened last gameweek — points, goals, assists, bonus and the underlying numbers behind them'
        : `Carried ${info?.ratings_season?.replace('-', '/') ?? 'last season'} ratings until GW1 is played`)
    : 'The best XI for the week ahead within £100m — expected points scaled by each fixture'
  const spend = shown.rows.flat().reduce((s, p) => s + (num(p.r, 'price') ?? 0), 0)
  const totalPts = showWeek ? shown.rows.flat().reduce((s, p) => s + (p.gw ? num(p.gw, 'total_points') ?? 0 : 0), 0) : null

  let delay = 0.1
  return (
    <>
      {chips}

      <Exportable title={title}>
        <Pitch key={`${runId}-${view}`}>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] font-extrabold tracking-[0.2em] text-white uppercase">{title}</div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-white/20 bg-black/25 px-2 py-0.5 text-[10px] font-bold text-white/85">{shown.formation}</span>
              <span className="rounded-full border border-white/20 bg-black/25 px-2 py-0.5 text-[10px] font-bold text-white/85">£{spend.toFixed(1)}m</span>
              {totalPts != null && <span className="rounded-full border border-white/20 bg-black/25 px-2 py-0.5 text-[10px] font-bold text-white/85">{totalPts} pts</span>}
              <button
                onClick={() => setRunId((i) => i + 1)}
                className="flex items-center gap-1 rounded-full border border-white/20 bg-black/25 px-2 py-0.5 text-[10px] font-bold text-white/85 hover:text-white"
                title="Replay the reveal"
              >
                <Icon name="bolt" size={10} /> Replay
              </button>
            </div>
          </div>
          <div className="mb-4 max-w-[62ch] text-[11.5px] text-white/70">{sub}</div>
          <div className="flex flex-col gap-3">
            {shown.rows.map((row, i) => (
              <div key={i} className="flex flex-wrap justify-center gap-2 md:gap-2.5">
                {row.map((pick) => {
                  delay += 0.16
                  return (
                    <TotwCard
                      key={String(pick.r.element)}
                      pick={pick}
                      delay={delay}
                      projected={!showWeek}
                      onClick={() => setSheetFor(pick.r)}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </Pitch>
      </Exportable>

      {sheetFor && <PlayerCardSheet player={sheetFor} pool={ratings} onClose={() => setSheetFor(null)} />}
    </>
  )
}
