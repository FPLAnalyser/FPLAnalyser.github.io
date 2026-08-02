import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from './Icon'
import { TeamBadge } from './badges'
import { useCore } from '../lib/useData'
import { useAvailability } from '../lib/availability'
import { num } from '../lib/rows'
import { xpForGw, useXpModel, useMarketOdds } from '../lib/xp'
import { pointsHit } from '../lib/planner'
import type { FixtureEaseRow, RatingRow } from '../lib/types'

/**
 * The squad you already built, pinned to the bottom of the front page.
 *
 * The site's job is to tell a manager something about *his* team, and until
 * now the front page did not know he had one — you built fifteen in the Squad
 * Builder and the home page still opened with a hero and eight tiles, as
 * though you had arrived for the first time. This is the smallest honest
 * version of making it personal: the rating, what it projects this week, and
 * one tap back to the board.
 *
 * It renders nothing at all until there are fifteen. A stranger from a search
 * result sees the page exactly as it is today, which is the whole reason this
 * is a strip and not a dashboard.
 */

const STORE_KEY = 'fpl_squad_build'

const ovOf = (r: RatingRow): number | null => {
  const s = num(r, 'season_overall_score')
  return s == null ? null : Math.round(Math.max(0, Math.min(100, s * 20)))
}

export function SquadStrip() {
  const navigate = useNavigate()
  const { data } = useCore()
  const avail = useAvailability()
  const model = useXpModel()
  const market = useMarketOdds()

  const picked = useMemo<number[]>(() => {
    try { const s = localStorage.getItem(STORE_KEY); const v = s ? JSON.parse(s) : []; return Array.isArray(v) ? v : [] } catch { return [] }
  }, [])

  const squad = useMemo(() => {
    if (picked.length !== 15 || !data) return null
    const byEl = new Map<number, RatingRow>()
    for (const r of (data.ratings ?? []) as RatingRow[]) if (r.element != null) byEl.set(Number(r.element), r)
    const rows = picked.map((el) => byEl.get(el)).filter(Boolean) as RatingRow[]
    return rows.length === 15 ? rows : null
  }, [picked, data])

  const read = useMemo(() => {
    if (!squad) return null
    const fixtureEase = (data?.fixtureEase ?? []) as FixtureEaseRow[]
    const gw = fixtureEase.length ? Math.min(...fixtureEase.map((f) => f.gw)) : (data?.meta?.next_gw ?? 1)
    const rated = squad.map(ovOf).filter((v): v is number => v != null)
    /* Projected points for the eleven that starts — and specifically for the
     * eleven the *planner* has, not a second opinion about which eleven that
     * would be.
     *
     * The first version took the best eleven on projection and read 43.7 while
     * the Squad Builder said 47.1 for the same fifteen, because the board was
     * showing a lineup imported from a screenshot rather than the one an
     * optimiser would pick. Two numbers for the same thing on two pages is
     * worse than one number in one place. Read the stored week; only fall back
     * to best-eleven when there is no week yet. */
    const xpOf = (r: RatingRow) => xpForGw(r, gw, fixtureEase, avail, model, market) ?? 0
    const byEl = new Map(squad.map((r) => [Number(r.element), r]))
    let week: { xi: number[]; bench: number[]; captain: number | null; chip: string | null } | null = null
    let hit = 0
    try {
      const raw = localStorage.getItem('fpl_planner')
      const st = raw ? JSON.parse(raw) : null
      const wk = st?.weeks?.[gw]
      if (Array.isArray(wk?.xi) && wk.xi.length === 11) { week = wk; hit = pointsHit(st, gw) }
    } catch { /* fall through to the approximation */ }

    /* The same arithmetic the board does, not a second opinion about it.
     *
     * The first version summed the best eleven's projections and read 38.3
     * while the Squad Builder said 43.0 for the same fifteen — because the
     * board doubles the captain, adds the bench under a Bench Boost, and takes
     * the points hit off. Two numbers for the same thing on two pages is worse
     * than one number in one place, so this reads the stored week and applies
     * the same three rules. Only when there is no week yet does it fall back
     * to a best-eleven guess. */
    let total: number
    if (week) {
      const mult = week.chip === 'triple-captain' ? 3 : 2
      const scoring = week.chip === 'bench-boost' ? [...week.xi, ...week.bench] : week.xi
      total = scoring.reduce((sum, el) => {
        const r = byEl.get(Number(el))
        return r ? sum + xpOf(r) * (el === week!.captain ? mult : 1) : sum
      }, 0) - hit
    } else {
      const xps = [...squad].sort((a, b) => xpOf(b) - xpOf(a))
      const xi = [...xps.filter((r) => r.position === 'GKP').slice(0, 1), ...xps.filter((r) => r.position !== 'GKP').slice(0, 10)]
      total = xi.reduce((s, r) => s + xpOf(r), 0)
    }
    const spend = squad.reduce((s, r) => s + (num(r, 'price') ?? 0), 0)
    return {
      gw,
      score: rated.length ? Math.round(rated.reduce((a, b) => a + b, 0) / rated.length) : null,
      xp: total,
      bank: +(100 - spend).toFixed(1),
      // Clubs, not names: fifteen names do not fit and a row of crests reads
      // as "your squad" at a glance in a way a truncated list never does.
      clubs: [...new Set(squad.map((r) => String(r.team)))],
    }
  }, [squad, data, avail, model, market])

  if (!squad || !read) return null

  return (
    /* Above the bottom bar, not behind it.
       The nav is `fixed … bottom-0 z-[150]` and 57px tall, and `main` already
       reserves 76px for it — so a strip pinned to `bottom-0` renders in that
       reserved gap and is completely covered on a phone. It sits at 76px on
       mobile and at 0 from `md`, where the bar is gone. */
    <div
      data-squad-strip
      className="sticky z-30 -mx-4 mt-4 border-t border-line-mid bg-bg-0/92 px-4 py-2.5 backdrop-blur-md md:-mx-6 md:bottom-0 md:px-6 lg:mx-0 lg:rounded-2xl lg:border lg:border-line-mid"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 76px)' }}
    >
      <button
        onClick={() => navigate('/squad')}
        className="flex w-full items-center gap-3 text-left"
        aria-label={`Your squad rates ${read.score ?? 'unrated'} — open the Squad Builder`}
      >
        <span className="relative grid size-12 shrink-0 place-items-center rounded-full" style={{
          background: `conic-gradient(var(--accent) 0 ${read.score ?? 0}%, rgba(255,255,255,.08) ${read.score ?? 0}% 100%)`,
        }}>
          <span className="absolute inset-[5px] rounded-full bg-surface-1" />
          <span className="metallic-num font-num relative z-[1] text-[17px] leading-none font-extrabold tabular-nums">{read.score ?? '—'}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[10px] font-bold tracking-[0.14em] text-ink-3 uppercase">Your squad · gameweek {read.gw}</span>
          <span className="block truncate text-[13px] text-ink-2">
            <b className="text-ink">{read.xp.toFixed(1)}</b> projected · <b className="text-ink">£{read.bank.toFixed(1)}m</b> in the bank
          </span>
          {/* Crests only above the narrowest phones — below 360 the row and the
              button together leave the line nothing to give. */}
          <span className="mt-1 hidden items-center gap-1 min-[360px]:flex">
            {read.clubs.slice(0, 8).map((t) => <TeamBadge key={t} team={t} size={13} />)}
            {read.clubs.length > 8 && <span className="text-[10px] text-ink-3">+{read.clubs.length - 8}</span>}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-accent bg-accent-soft px-3 py-2 text-[12px] font-bold text-accent">
          Open <Icon name="arrow-right" size={13} />
        </span>
      </button>
    </div>
  )
}
