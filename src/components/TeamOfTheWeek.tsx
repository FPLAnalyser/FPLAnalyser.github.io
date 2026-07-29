import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import { Pitch, PitchCard, CARD_W } from './Pitch'
import { FixtureNames } from './FixtureChips'
import { Exportable } from './ExportPanel'
import { PlayerCardSheet } from './PlayerCardSheet'
import { ratingTo100 } from './StarRating'
import { num } from '../lib/rows'
import { useSeason } from '../lib/season'
import { useLazyTable } from '../lib/useData'
import type { FixtureEaseRow, RatingRow, Row } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   Team of the Week — what actually happened in the last finished gameweek,
   per player, from gameweek_stats.json (goals, assists, bonus, xG, xA and
   the points they returned), with a weekly rating, drawn on the Squad
   Builder's board.

   There used to be a second view here projecting the week ahead within
   £100m. It was a worse answer to a question three other surfaces answer
   properly — GW Preview ranks the round's expected points, the Squad
   Builder builds a real fifteen, and Players now projects four gameweeks —
   so it has gone rather than been kept for symmetry.
   ════════════════════════════════════════════════════════════════════════ */

const FORMATIONS: [number, number, number][] = [
  [3, 4, 3], [3, 5, 2], [4, 3, 3], [4, 4, 2], [4, 5, 1], [5, 3, 2], [5, 4, 1],
]

interface Pick { r: RatingRow; score: number; gw?: Row }

/** Best formation-legal XI by score. When `budget` is set, greedily trims
 * the most expensive picks until the XI fits (FPL's £100m squad rule
 * applied to the starting eleven). */
const MAX_PER_CLUB = 3

/** Take the best `n` from a sorted list without breaking the three-per-club
 *  rule, given what the rest of the XI already uses. */
function takeRespectingClubs(sorted: Pick[], n: number, clubCount: Map<string, number>): Pick[] {
  const out: Pick[] = []
  for (const p of sorted) {
    if (out.length === n) break
    const club = String(p.r.team)
    if ((clubCount.get(club) ?? 0) >= MAX_PER_CLUB) continue
    out.push(p)
    clubCount.set(club, (clubCount.get(club) ?? 0) + 1)
  }
  return out
}

function pickXI(pool: Pick[], budget?: number) {
  const byPos = (pos: string) => pool.filter((p) => p.r.position === pos).sort((a, b) => b.score - a.score)
  const gk = byPos('GKP'), def = byPos('DEF'), mid = byPos('MID'), fwd = byPos('FWD')
  if (!gk.length) return null
  const cost = (p: Pick) => num(p.r, 'price') ?? 0

  let best: { total: number; rows: Pick[][]; formation: string } | null = null
  for (const [d, m, f] of FORMATIONS) {
    if (def.length < d || mid.length < m || fwd.length < f) continue
    // FPL's three-players-per-club limit, applied as the XI is assembled.
    const clubs = new Map<string, number>()
    const keeper = takeRespectingClubs(gk, 1, clubs)
    const defs = takeRespectingClubs(def, d, clubs)
    const mids = takeRespectingClubs(mid, m, clubs)
    const fwds = takeRespectingClubs(fwd, f, clubs)
    if (!keeper.length || defs.length < d || mids.length < m || fwds.length < f) continue
    let rows: Pick[][] = [keeper, defs, mids, fwds]
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
        const clubUse = new Map<string, number>()
        for (const p of flat) if (p.r.element !== victim.r.element) clubUse.set(String(p.r.team), (clubUse.get(String(p.r.team)) ?? 0) + 1)
        const repl = bench[String(victim.r.position)].find(
          (p) => !used.has(p.r.element) && cost(p) < cost(victim) && (clubUse.get(String(p.r.team)) ?? 0) < MAX_PER_CLUB,
        )
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

/** One card. Deliberately the Squad Builder's card, in ice rather than gold:
 *  the two boards used to look like different products, and there was no
 *  reason for it — a Team of the Week is an eleven on a pitch, which is
 *  exactly what the builder already draws. The metal is the only thing that
 *  separates them, because this XI is not yours. */
function TotwCard({ pick, delay, onClick, fixtureEase }: { pick: Pick; delay: number; onClick: () => void; fixtureEase: FixtureEaseRow[] }) {
  const { r, gw } = pick
  const pts = gw ? num(gw, 'total_points') : null
  const goals = gw ? num(gw, 'goals_scored') ?? 0 : 0
  const assists = gw ? num(gw, 'assists') ?? 0 : 0
  const bonus = gw ? num(gw, 'bonus') ?? 0 : 0
  const cs = gw ? num(gw, 'clean_sheets') ?? 0 : 0
  const xg = gw ? num(gw, 'expected_goals') : null
  const xa = gw ? num(gw, 'expected_assists') : null
  const returns = [goals ? `${goals}G` : '', assists ? `${assists}A` : '', cs ? 'CS' : '', bonus ? `+${bonus}B` : ''].filter(Boolean)

  return (
    <div className={`totw-card relative ${CARD_W}`} style={{ animationDelay: `${delay}s` }}>
      <PitchCard
        tier="ice"
        rating={Math.round(pick.score)}
        name={String(r.web_name)}
        team={String(r.team)}
        price={num(r, 'price')}
        code={num(r, 'code')}
        element={num(r, 'element')}
        onClick={onClick}
        // With a gameweek behind it the card reports what he actually did;
        // pre-season there is nothing to report, so it falls back to the
        // fixtures the Squad Builder shows rather than a row of dashes.
        fixtures={gw ? undefined : <FixtureNames fixtureEase={fixtureEase} team={String(r.team)} n={3} />}
        footer={
          gw ? (
            <span className="mt-1 block border-t border-white/10 pt-1 text-[9.5px] leading-tight text-white/75">
              <span className="block">{returns.length ? returns.join(' · ') : '—'}</span>
              {(xg != null || xa != null) && (
                <span className="mt-0.5 block text-white/45">
                  {xg != null ? `${xg.toFixed(2)} xG` : ''}{xg != null && xa != null ? ' · ' : ''}{xa != null ? `${xa.toFixed(2)} xA` : ''}
                </span>
              )}
            </span>
          ) : undefined
        }
      />
      {pts != null && (
        <span
          className="font-num absolute -top-1.5 -right-1.5 z-10 grid size-6 place-items-center rounded-full text-[11px] leading-none font-extrabold tabular-nums shadow-lg sm:-top-2 sm:-right-2 sm:size-7 sm:text-[12px]"
          style={{ background: '#7fd4f5', color: '#06212e' }}
          title={`${pts} FPL points in this gameweek`}
        >{pts}</span>
      )}
    </div>
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
  onPlayer: _onPlayer,
}: {
  ratings: RatingRow[]
  currentGw: number | null
  fixtureEase?: FixtureEaseRow[]
  onPlayer?: (name: string, code?: number | null) => void
}) {
  const { info } = useSeason()
  const preseason = Boolean(info?.provisional)
  const gwQ = useLazyTable<Row[]>('gameweek_stats')
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

  // Pre-season with no gameweeks played: fall back to the season XI so the
  // panel still says something true.
  const fallbackXI = useMemo(() => {
    if (weekXI || !preseason) return null
    const picks: Pick[] = ratings
      .filter((r) => ratingTo100(num(r, 'season_overall_score')) != null && num(r, 'season_ok') !== 0)
      .map((r) => ({ r, score: ratingTo100(num(r, 'season_overall_score')) ?? 0 }))
    return pickXI(picks)
  }, [ratings, weekXI, preseason])

  const shown = weekXI ?? fallbackXI

  if (!shown) {
    return (
      <div className="rounded-xl border border-line bg-surface-1 p-6 text-center text-sm text-ink-3">
        The Team of the Week appears once a gameweek has been played.
      </div>
    )
  }

  const title = weekXI ? `Team of the Week · GW${lastGw}` : 'Team of the Season so far'
  const sub = weekXI
    ? 'The best XI on what actually happened last gameweek — points, goals, assists, bonus and the underlying numbers behind them'
    : `Carried ${info?.ratings_season?.replace('-', '/') ?? 'last season'} ratings until GW1 is played`
  const spend = shown.rows.flat().reduce((s, p) => s + (num(p.r, 'price') ?? 0), 0)
  const totalPts = shown.rows.flat().reduce((s, p) => s + (p.gw ? num(p.gw, 'total_points') ?? 0 : 0), 0)

  let delay = 0.1
  return (
    <>
      <Exportable title={title}>
        <Pitch key={runId} maxWidth={860} className="totw-pitch">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] font-extrabold tracking-[0.2em] text-white uppercase">{title}</div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-white/20 bg-black/25 px-2 py-0.5 text-[10px] font-bold text-white/85">{shown.formation}</span>
              <span className="rounded-full border border-white/20 bg-black/25 px-2 py-0.5 text-[10px] font-bold text-white/85">£{spend.toFixed(1)}m</span>
              {totalPts > 0 && <span className="rounded-full border border-white/20 bg-black/25 px-2 py-0.5 text-[10px] font-bold text-white/85">{totalPts} pts</span>}
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
          {/* The Squad Builder's spacing, so the two boards are the same board. */}
          <div className="relative flex flex-col gap-2 sm:gap-3 md:gap-4">
            {shown.rows.map((row, i) => (
              <div key={i} className="flex justify-center gap-1 sm:gap-2">
                {row.map((pick) => {
                  delay += 0.16
                  return (
                    <TotwCard
                      key={String(pick.r.element)}
                      pick={pick}
                      delay={delay}
                      fixtureEase={fixtureEase}
                      onClick={() => setSheetFor(pick.r)}
                    />
                  )
                })}
              </div>
            ))}
          </div>
        </Pitch>
      </Exportable>

      {sheetFor && <PlayerCardSheet player={sheetFor} pool={ratings} fixtureEase={fixtureEase} onClose={() => setSheetFor(null)} />}
    </>
  )
}
