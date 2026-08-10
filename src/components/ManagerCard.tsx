import { useMemo, useState } from 'react'
import { Icon } from './Icon'
import { Exportable } from './ExportPanel'
import { PlayerPhoto } from './PlayerPhoto'
import { initialsOf } from './Pitch'
import { num } from '../lib/rows'
import { useLazyTable } from '../lib/useData'
import type { RatingRow, Row } from '../lib/types'

/* ════════════════════════════════════════════════════════════════════════
   The manager's gameweek card.

   Every other card on the site rates a player. This one rates you: what the
   week actually returned, where it ranked, and the one number that says
   whether it was a good week or a bad one — issued fresh after each gameweek
   and built to be posted.
   ════════════════════════════════════════════════════════════════════════ */

/** A gameweek rating out of 100.
 *
 *  Points carry it, on a curve set so an average week (~50) lands near 50 and
 *  it takes a genuinely big week to reach the 90s — a wall of 100s would say
 *  nothing. Two deductions, both for things that were your call rather than
 *  the players': points left on the bench, and transfer hits that didn't pay
 *  for themselves. Deliberately NOT rank-based: rank is already shown, and a
 *  rating that just restates it is a second copy of the same fact. */
export function gameweekRating(pts: number, bench: number, hit: number): number {
  // Anchored so a 50-point week reads 55 and a 90-point week reads 97 — the
  // range real gameweeks actually occupy, rather than a curve where everything
  // clusters in the 60s.
  const base = Math.max(0, Math.min(100, pts * 1.05 + 2.5))
  const benchCost = Math.min(10, bench * 0.5)   // 20 left on the bench ≈ −10
  const hitCost = Math.min(10, hit * 0.6)       // a −8 hit ≈ −4.8
  return Math.max(1, Math.round(base - benchCost - hitCost))
}

const VERDICT: [number, string][] = [
  [88, 'A week that moves you up the page'],
  [74, 'A strong return'],
  [60, 'Solid — no damage done'],
  [45, 'Quiet. The green arrows went elsewhere'],
  [0, 'One to move on from'],
]
const verdictFor = (r: number) => VERDICT.find(([min]) => r >= min)![1]

interface Entry { event: number; points: number; rank: number | null; overall_rank: number | null; points_on_bench: number; event_transfers_cost: number; value: number | null }

/** The per-gameweek rows FPL gives us, newest last. `picksData.entry_history`
 *  covers the week being viewed; `historyData.current` covers the season. */
function entriesFrom(historyData: unknown, entryHistory: Record<string, unknown> | undefined): Entry[] {
  const rows = (historyData as { current?: Record<string, number>[] } | null)?.current
  const read = (o: Record<string, unknown>): Entry => ({
    event: Number(o.event ?? 0),
    points: Number(o.points ?? 0),
    rank: o.rank == null ? null : Number(o.rank),
    overall_rank: o.overall_rank == null ? null : Number(o.overall_rank),
    points_on_bench: Number(o.points_on_bench ?? 0),
    event_transfers_cost: Number(o.event_transfers_cost ?? 0),
    value: o.value == null ? null : Number(o.value),
  })
  if (Array.isArray(rows) && rows.length) return rows.map(read)
  if (entryHistory && entryHistory.event != null) return [read(entryHistory)]
  return []
}

const fmtRank = (n: number | null) => (n == null ? '—' : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}m` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n))

export function ManagerCard({ picksData, historyData, entryData, ratings, teamName }: {
  picksData: { picks?: { element: number; multiplier: number; is_captain?: boolean }[]; entry_history?: Record<string, unknown> }
  historyData: unknown
  entryData: { name?: unknown; player_first_name?: unknown; player_last_name?: unknown } | null
  ratings: RatingRow[]
  teamName?: string
}) {
  const gwQ = useLazyTable<Row[]>('gameweek_stats')
  const gwStats: Row[] = gwQ.data ?? []

  const entries = useMemo(() => entriesFrom(historyData, picksData.entry_history), [historyData, picksData.entry_history])
  const [idx, setIdx] = useState(() => Math.max(0, entries.length - 1))
  const e = entries[Math.min(idx, entries.length - 1)]

  // What each of your players actually did that week, from our own published
  // per-gameweek table (the FPL picks endpoint carries no per-player points).
  const squad = useMemo(() => {
    if (!e || !gwStats.length) return []
    const mine = new Map((picksData.picks ?? []).map((p) => [p.element, p]))
    return gwStats
      .filter((g: Row) => Number(num(g, 'round') ?? num(g, 'gw_from_fixture') ?? -1) === e.event && mine.has(Number(g.element)))
      .map((g: Row) => {
        const pick = mine.get(Number(g.element))!
        const r = ratings.find((x) => x.element === Number(g.element))
        return {
          g, r, pick,
          started: pick.multiplier > 0,
          pts: (num(g, 'total_points') ?? 0) * (pick.multiplier || 1),
        }
      })
      .sort((a, b) => b.pts - a.pts)
  }, [e, gwStats, picksData.picks, ratings])

  if (!entries.length) {
    return (
      <div className="rounded-2xl border border-line bg-surface-1 p-6 text-center">
        <div className="text-[13px] text-ink-2">Your gameweek card appears once a gameweek has been played.</div>
      </div>
    )
  }

  const starters = squad.filter((s) => s.started)
  const best = starters[0] ?? null
  const goals = starters.reduce((n, s) => n + (num(s.g, 'goals_scored') ?? 0), 0)
  const assists = starters.reduce((n, s) => n + (num(s.g, 'assists') ?? 0), 0)
  const cleanSheets = starters.reduce((n, s) => n + (num(s.g, 'clean_sheets') ?? 0), 0)
  const bonus = starters.reduce((n, s) => n + (num(s.g, 'bonus') ?? 0), 0)

  const rating = gameweekRating(e.points, e.points_on_bench, e.event_transfers_cost)
  const name = teamName || (entryData?.name ? String(entryData.name) : 'My team')
  const prev = entries[idx - 1]
  const arrow = prev?.overall_rank != null && e.overall_rank != null ? prev.overall_rank - e.overall_rank : null

  return (
    <div className="flex flex-col gap-3">
      {/* gameweek scroller */}
      <div className="flex items-center gap-2">
        <button
          disabled={idx <= 0}
          onClick={() => setIdx((i) => Math.max(0, i - 1))}
          aria-label="Previous gameweek"
          className="grid size-9 place-items-center rounded-full border border-accent/45 text-accent transition-colors hover:border-accent hover:bg-accent-soft disabled:border-line disabled:text-ink-3 disabled:opacity-35 disabled:hover:bg-transparent"
        ><Icon name="chevron-left" size={16} /></button>
        <div className="flex-1 text-center text-[11px] font-semibold tracking-[0.14em] text-ink-3 uppercase">Gameweek {e.event}</div>
        <button
          disabled={idx >= entries.length - 1}
          onClick={() => setIdx((i) => Math.min(entries.length - 1, i + 1))}
          aria-label="Next gameweek"
          className="grid size-9 place-items-center rounded-full border border-accent/45 text-accent transition-colors hover:border-accent hover:bg-accent-soft disabled:border-line disabled:text-ink-3 disabled:opacity-35 disabled:hover:bg-transparent"
        ><Icon name="chevron-right" size={16} /></button>
      </div>

      <Exportable title={`${name} — Gameweek ${e.event}`}>
        {/* The card sets its own ink: it is one fixed dark object in both
            themes, and the exported PNG has to match what's on screen. */}
        <div className="relative overflow-hidden rounded-2xl p-4" style={{ color: '#f4efe3', background: 'linear-gradient(168deg,#1f2023 0%,#0f1013 56%,#08090c 100%)', border: '1px solid rgba(234,209,136,.22)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-extrabold tracking-[0.2em] uppercase" style={{ color: '#8a8172' }}>Gameweek {e.event} · Manager card</div>
              <div className="mt-1 truncate text-[20px] font-extrabold tracking-[-0.01em]">{name}</div>
              <div className="mt-0.5 text-[12.5px]" style={{ color: '#b3ab99' }}>{verdictFor(rating)}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="metallic-num font-num text-[46px] leading-none font-extrabold tabular-nums">{rating}</div>
              <div className="text-[10px] font-extrabold tracking-[0.16em] uppercase" style={{ color: '#8a8172' }}>Week rating</div>
            </div>
          </div>

          <div className="mt-3.5 grid grid-cols-3 gap-px overflow-hidden rounded-xl" style={{ background: 'rgba(255,255,255,.09)' }}>
            {[
              ['Points', String(e.points)],
              ['GW rank', fmtRank(e.rank)],
              ['Overall', fmtRank(e.overall_rank)],
            ].map(([k, v]) => (
              <div key={k} className="px-3 py-2.5" style={{ background: '#141518' }}>
                <div className="text-[10px] font-extrabold tracking-[0.16em] uppercase" style={{ color: '#8a8172' }}>{k}</div>
                <div className="font-num mt-0.5 text-[21px] font-extrabold tabular-nums">{v}</div>
              </div>
            ))}
          </div>

          {arrow != null && arrow !== 0 && (
            <div className="mt-2 text-[12px] font-semibold" style={{ color: arrow > 0 ? '#3ddc7a' : '#f0736f' }}>
              {arrow > 0 ? '▲' : '▼'} {fmtRank(Math.abs(arrow))} places overall
            </div>
          )}

          {starters.length > 0 && (
            <>
              <div className="mt-3.5 flex flex-wrap gap-1.5">
                {[
                  [`${goals}`, 'goals'], [`${assists}`, 'assists'],
                  [`${cleanSheets}`, 'clean sheets'], [`${bonus}`, 'bonus'],
                  [`${e.points_on_bench}`, 'left on the bench'],
                ].map(([v, k]) => (
                  <span key={k} className="rounded-full px-2.5 py-1 text-[11.5px] font-semibold" style={{ background: 'rgba(255,255,255,.06)', color: '#b3ab99' }}>
                    <b className="font-num font-extrabold tabular-nums" style={{ color: '#f4efe3' }}>{v}</b> {k}
                  </span>
                ))}
              </div>

              {best && (
                <div className="mt-3.5 flex items-center gap-3 rounded-xl px-3 py-2.5" style={{ background: 'rgba(201,162,39,.10)', border: '1px solid rgba(234,209,136,.2)' }}>
                  <span className="relative block h-10 w-8 shrink-0">
                    <span className="absolute inset-0 grid place-items-center rounded text-[11px] font-extrabold" style={{ background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.4)' }}>{initialsOf(String(best.g.web_name))}</span>
                    <PlayerPhoto code={best.r ? num(best.r, 'code') : null} element={Number(best.g.element)} className="relative h-full w-full rounded object-cover object-top" placeholder={<span />} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-extrabold tracking-[0.16em] uppercase" style={{ color: '#8a8172' }}>Best performer</div>
                    <div className="truncate text-[15px] font-extrabold">{String(best.g.web_name)}</div>
                    <div className="text-[11.5px]" style={{ color: '#b3ab99' }}>
                      {String(best.g.team)}
                      {(num(best.g, 'goals_scored') ?? 0) > 0 && ` · ${num(best.g, 'goals_scored')}G`}
                      {(num(best.g, 'assists') ?? 0) > 0 && ` · ${num(best.g, 'assists')}A`}
                      {(num(best.g, 'bonus') ?? 0) > 0 && ` · +${num(best.g, 'bonus')} bonus`}
                    </div>
                  </div>
                  <div className="metallic-num font-num shrink-0 text-[26px] leading-none font-extrabold tabular-nums">{best.pts}</div>
                </div>
              )}
            </>
          )}

          {e.event_transfers_cost > 0 && (
            <div className="mt-2.5 text-[12px]" style={{ color: '#f0736f' }}>−{e.event_transfers_cost} points taken on transfers</div>
          )}
        </div>
      </Exportable>

      {starters.length === 0 && (
        <div className="text-center text-[12.5px] text-ink-3">
          Per-player returns for gameweek {e.event} aren't published yet — the headline numbers above come straight from FPL.
        </div>
      )}
    </div>
  )
}
