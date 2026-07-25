import { useMemo, useState } from 'react'
import { TeamBadge } from './badges'
import { Icon } from './Icon'
import { num } from '../lib/rows'
import { useSeason } from '../lib/season'
import type { RatingRow } from '../lib/types'

// Team of the Week: the best formation-legal XI by rating, revealed
// card-by-card on a black pitch. Pre-season (carried ratings) it's billed as
// the Team of the Season so far; once gameweeks are played it uses the last-4
// window so the XI tracks current form.

const FORMATIONS: [number, number, number][] = [
  [3, 4, 3], [3, 5, 2], [4, 3, 3], [4, 4, 2], [4, 5, 1], [5, 3, 2], [5, 4, 1],
]

function pickXI(ratings: RatingRow[], scoreOf: (p: RatingRow) => number | null) {
  const ok = ratings.filter((p) => scoreOf(p) != null && num(p, 'season_ok') !== 0 && p.season_ok !== false)
  const byPos = (pos: string) => ok.filter((p) => p.position === pos).sort((a, b) => (scoreOf(b) ?? 0) - (scoreOf(a) ?? 0))
  const gk = byPos('GKP')
  const def = byPos('DEF')
  const mid = byPos('MID')
  const fwd = byPos('FWD')
  if (!gk.length) return null

  const sum = (rows: RatingRow[], n: number) => rows.slice(0, n).reduce((s, p) => s + (scoreOf(p) ?? 0), 0)
  let best: { total: number; d: number; m: number; f: number } | null = null
  for (const [d, m, f] of FORMATIONS) {
    if (def.length < d || mid.length < m || fwd.length < f) continue
    const total = (scoreOf(gk[0]) ?? 0) + sum(def, d) + sum(mid, m) + sum(fwd, f)
    if (!best || total > best.total) best = { total, d, m, f }
  }
  if (!best) return null
  return {
    rows: [[gk[0]], def.slice(0, best.d), mid.slice(0, best.m), fwd.slice(0, best.f)],
    formation: `${best.d}-${best.m}-${best.f}`,
  }
}

function TotwCard({ p, delay, score, onClick }: { p: RatingRow; delay: number; score: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="totw-card w-[92px] rounded-xl border border-accent/50 p-2 text-center transition-transform hover:-translate-y-0.5 md:w-[104px]"
      style={{ animationDelay: `${delay}s`, background: 'linear-gradient(165deg,#211d16,#0d0b08)' }}
    >
      <div className="metallic-num font-num text-xl leading-none font-extrabold tabular-nums">{Math.round(score)}</div>
      <div className="mt-1 truncate text-[11px] font-bold text-ink">{String(p.web_name)}</div>
      <div className="mt-0.5 flex items-center justify-center gap-1 text-[9px] text-ink-3">
        <TeamBadge team={String(p.team)} size={10} />
        {String(p.team)} · £{p.price}m
      </div>
    </button>
  )
}

export function TeamOfTheWeek({
  ratings,
  currentGw,
  onPlayer,
}: {
  ratings: RatingRow[]
  currentGw: number | null
  onPlayer: (name: string, code?: number | null) => void
}) {
  const { info } = useSeason()
  const preseason = Boolean(info?.provisional)
  // Live weeks → last-4 form window; pre-season → carried season ratings.
  const useForm = !preseason && currentGw != null && currentGw > 0
  const scoreOf = (p: RatingRow) => {
    const v = useForm ? (num(p, 'gw4_overall_score') ?? num(p, 'season_overall_score')) : num(p, 'season_overall_score')
    return v == null ? null : v * 20
  }

  const xi = useMemo(() => pickXI(ratings, scoreOf), [ratings, useForm]) // eslint-disable-line react-hooks/exhaustive-deps
  const [runId, setRunId] = useState(0)

  if (!xi) return null
  const title = useForm ? `Team of the Week · GW${currentGw}` : 'Team of the Season so far'
  const sub = useForm
    ? 'The best formation-legal XI on last-4-gameweek form'
    : `Carried ${info?.ratings_season?.replace('-', '/') ?? 'last season'} ratings until GW1 is played`

  let delay = 0.1
  return (
    <div key={runId} className="totw-pitch p-4 md:p-6">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-center text-[11px] font-extrabold tracking-[0.24em] text-accent-2 uppercase">{title}</div>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-ink-2">{xi.formation}</span>
          <button
            onClick={() => setRunId((i) => i + 1)}
            className="flex items-center gap-1 rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-ink-2 hover:text-ink"
            title="Replay the reveal"
          >
            <Icon name="bolt" size={10} /> Replay
          </button>
        </div>
      </div>
      <div className="mb-4 text-[11px] text-ink-3">{sub}</div>
      <div className="flex flex-col gap-3">
        {xi.rows.map((row, i) => (
          <div key={i} className="flex flex-wrap justify-center gap-2 md:gap-3">
            {row.map((p) => {
              delay += 0.18
              return (
                <TotwCard
                  key={String(p.element)}
                  p={p}
                  score={scoreOf(p) ?? 0}
                  delay={delay}
                  onClick={() => onPlayer(String(p.web_name), num(p, 'code'))}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
