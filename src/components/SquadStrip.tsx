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
 * The front page's one personal thing, in whichever of two states applies.
 *
 * **No squad — the invitation.** The strongest hook this site
 * has is that it will read a screenshot of your team in about eight seconds
 * and tell you what is wrong with it, and until now the front page never said
 * so. This is the banner that does, and it goes *above* the tiles: measured at
 * 390px it otherwise landed 2,100px down the page, below all eight of them,
 * which is not where you put the first thing a visitor should do.
 *
 * **A squad — the summary.** Once fifteen exist the invitation is nonsense, so
 * the strip takes over — the rating, what the week projects, what is in the
 * bank, one tap back to the board — pinned under the header and over the
 * tiles, where it stays for the whole page.
 *
 * Both states render in the same slot, above the grid — one component, one
 * mount, whichever of the two it turns out to be.
 *
 * The projection is read from the planner's own stored week rather than
 * recomputed, because two numbers for the same thing on two pages is worse
 * than one number in one place — see the comment where it is calculated.
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

  /* No fifteen yet — the invitation, which is the whole point of putting
     anything here. Not sticky: a banner pinned over a first-time visitor's
     screen is an advert. It just goes first. */
  if (!squad || !read) {
    /* The photo is optional and behaves like the tiles': drop a file at
       `public/home/import.jpg` and it appears; until then the gradient stands
       on its own and nothing breaks. Same `onError` hide the WindowCard uses,
       so a 404 costs a request and no layout.

       It is a picture in the banner, not the banner's background. Stretched
       across the whole thing it had to be held down under an opacity and a
       scrim to keep the copy readable, and at 1392x164 on a desktop the part
       that survived `object-cover` was a random horizontal slice — two goes at
       choosing which slice, and it still read as wallpaper. Bounded, it is
       just a photograph: a full-width band above the copy on a phone, a
       thumbnail beside it from md, and nothing sits on top of it either way. */
    return (
      <div className="hw-invite relative mb-4 overflow-hidden rounded-2xl border border-accent/30 p-4 md:mb-5 md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:gap-5">
          <img
            src={`${import.meta.env.BASE_URL}home/import.jpg`}
            alt=""
            loading="lazy"
            onError={(e) => { e.currentTarget.style.display = 'none' }}
            className="h-[74px] w-full rounded-xl border border-line-mid object-cover object-center md:h-[88px] md:w-[132px] md:shrink-0"
          />
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold tracking-[0.14em] text-accent uppercase">
              <Icon name="camera" size={13} /> Start here
            </div>
            <h2 className="text-lg font-extrabold tracking-[-0.01em] text-ink md:text-xl">Get your draft rated</h2>
            <p className="mt-1.5 max-w-[52ch] text-[13.5px] leading-relaxed text-ink-2">
              Screenshot your team from the FPL app and get instant analysis.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {/* Straight to the picker, not to an empty board with the same
                button on it. */}
            <button
              onClick={() => navigate('/squad', { state: { openImport: true } })}
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-accent bg-accent-soft px-4 text-[13.5px] font-bold text-accent transition-colors hover:brightness-110 md:flex-none"
            >
              <Icon name="camera" size={15} /> Import a screenshot
            </button>
            <button
              onClick={() => navigate('/squad')}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-line-mid px-4 text-[13.5px] font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink md:flex-none"
            >
              Build a fifteen
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    /* Pinned under the header, over the tiles.
       It used to sit after the grid and stick to the bottom, which meant your
       own squad was the last thing on the page and only appeared once you had
       scrolled past everything else. It now leads the page and stays put.

       `top` is the header's own height so the two never overlap: the nav is
       `sticky top-0 z-[100]`, h-14 on mobile and 70px from md, plus its 1px
       bottom border and whatever the notch takes — 56 and 70 left a hairline
       of the strip behind that border. z-30 keeps it under the header, so it
       slides beneath rather than over it on the way up. */
    <div
      data-squad-strip
      className="sticky top-[calc(env(safe-area-inset-top)_+_57px)] z-30 -mx-4 mb-4 border-b border-line-mid bg-bg-0/92 px-4 py-2.5 backdrop-blur-md md:-mx-6 md:top-[calc(env(safe-area-inset-top)_+_71px)] md:px-6 lg:mx-0 lg:rounded-2xl lg:border lg:border-line-mid"
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
          {/* "gameweek" spelled out wraps to two lines at 320px and makes the
              strip 71px instead of 62px, for a word nobody needs. */}
          <span className="block truncate text-[10px] font-bold tracking-[0.14em] text-ink-3 uppercase">
            Your squad · <span className="min-[390px]:hidden">GW</span><span className="hidden min-[390px]:inline">gameweek</span> {read.gw}
          </span>
          {/* Short words below 390px. Measured at 320: the line wants 204px and
              the disc, the Open chip and the gutters leave it 140, so "47.6
              projected · £0.0m in the bank" was being ellipsised mid-word.
              "47.6 pts · £0.0m bank" is 126px and says the same thing. */}
          <span className="block truncate text-[13px] text-ink-2">
            <b className="text-ink">{read.xp.toFixed(1)}</b>
            <span className="min-[390px]:hidden"> pts</span>
            <span className="hidden min-[390px]:inline"> projected</span>
            {' · '}
            <b className="text-ink">£{read.bank.toFixed(1)}m</b>
            <span className="min-[390px]:hidden"> bank</span>
            <span className="hidden min-[390px]:inline"> in the bank</span>
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
