import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { flushSync } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { GameweekCover } from '../components/GameweekCover'
import { useSeason } from '../lib/season'
import { useCore } from '../lib/useData'

function Hero() {
  const { info } = useSeason()
  const preseason = Boolean(info?.provisional)
  const seasonLabel = info?.label ?? '2026/27'
  const ratingsFrom = info?.ratings_season ? info.ratings_season.replace('-', '/') : null
  // Wide screens: headline left, season note right — the note fills the space
  // the capped reading measure would otherwise leave empty.
  return (
    <section className="mb-5 grid items-start gap-x-10 gap-y-4 md:mb-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <div>
        <p className="mb-3 text-[11px] font-semibold tracking-[0.28em] text-accent uppercase">Data. Insight. Points.</p>
        <h1 className="text-2xl leading-[1.08] font-extrabold tracking-[-0.02em] text-ink md:text-4xl">
          Turn Premier League data into FPL points.
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2 md:text-base">
          FPL Analyser rates every player on the numbers that actually predict returns — expected goals, minutes, form and
          fixtures — then turns them into a plain-language verdict and transfer calls for <em>your</em> team.
        </p>
      </div>

      {preseason && (
        <div className="rounded-xl border border-accent/25 bg-accent-soft/40 p-3.5 lg:mt-8">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] text-accent uppercase">
            <Icon name="star" size={13} /> Welcome to the {seasonLabel} season
          </div>
          <p className="text-[13px] leading-relaxed text-ink-2">
            New season, fresh squads. Every {seasonLabel} player, price and fixture is loaded and ready to plan around.
            {ratingsFrom ? <> Player and team ratings carry over from <strong>{ratingsFrom}</strong> until GW1 is played, then they switch to live {seasonLabel} form.</> : null}
          </p>
        </div>
      )}
    </section>
  )
}

// Base path for site assets (relative build → GitHub Pages sub-path safe).
const IMG_BASE = import.meta.env.BASE_URL

interface HomeWin { key: string; to: string; kicker: string; title: string; desc: string; stat: string; ghost?: { text: string; style: CSSProperties } }
const WINDOWS: HomeWin[] = [
  { key: 'players', to: '/players', kicker: 'Explore', title: 'Players', desc: 'Every player rated 0–100 — form, value, fixtures and the editorial player hero.', stat: '600+ rated' },
  { key: 'teams', to: '/teams', kicker: 'Explore', title: 'Teams', desc: 'Attack, defence and set-piece ratings for all 20 clubs, with matchup previews.', stat: '20 clubs' },
  { key: 'fixtures', to: '/fixtures', kicker: 'Plan', title: 'Fixtures', desc: 'Our own fixture rating and rotation planner.', stat: 'Next 6 GWs' },
  { key: 'scouting', to: '/scout', kicker: 'Discover', title: 'Scouting', desc: 'Filter the market for your next differential.', stat: 'Find gems' },
  { key: 'squad', to: '/squad', kicker: 'Build', title: 'Squad Builder', desc: 'Draft an XI and plan the season week by week.', stat: '£100.0m' },
  { key: 'myteam', to: '/loadteam', kicker: 'Track', title: 'My Team', desc: 'Link your side for a live rated breakdown.', stat: 'Live GW1',
    ghost: { text: '★', style: { right: '6%', top: '6%', fontSize: 'clamp(44px,6vw,84px)', WebkitTextStroke: '2px color-mix(in srgb, var(--accent) 18%, transparent)' } } },
]

function ArrowRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-0.5">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function WindowCard({ w }: { w: HomeWin }) {
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState(false)
  // Tile grows into the section: wrap the route change in a view transition
  // where supported (and motion isn't reduced) so the page cross-fades/scales.
  const go = () => {
    const start = (document as unknown as { startViewTransition?: (cb: () => void) => void }).startViewTransition?.bind(document)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (start && !reduced) start(() => flushSync(() => navigate(w.to)))
    else navigate(w.to)
  }
  return (
    <button
      type="button"
      onClick={go}
      className="hw-card group aspect-[3/4] sm:aspect-[10/15] lg:aspect-auto lg:h-full lg:min-h-0 lg:flex-1 lg:basis-0"
      aria-label={`${w.title} — ${w.desc}`}
    >
      <div className={`hw-photo hw-${w.key}`}>
        <img
          src={`${IMG_BASE}home/${w.key}.jpg`}
          alt=""
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={(e) => { e.currentTarget.style.display = 'none' }}
          className={`hw-img ${loaded ? 'is-on' : ''}`}
        />
      </div>
      {w.ghost && <div className="hw-ghost" style={w.ghost.style}>{w.ghost.text}</div>}
      <div className="hw-grain" />
      <div className="hw-body">
        <span className="mb-1 inline-flex items-center gap-1.5 text-[0.58rem] font-extrabold tracking-[0.16em] text-accent-2 uppercase">◆ {w.kicker}</span>
        <h3 className="font-display text-lg leading-[0.95] text-white uppercase md:text-xl">{w.title}</h3>
        <div className="mt-2 mb-2.5 h-0.5 w-7 rounded-full" style={{ background: 'linear-gradient(90deg, var(--accent-2), var(--accent-strong))' }} />
        <div className="flex items-center justify-between gap-1.5">
          <span className="truncate text-[11px] font-bold text-[#e9e4d8]">{w.stat}</span>
          <span className="grid size-7 shrink-0 place-items-center rounded-full border border-white/20 bg-white/10 text-accent-2 backdrop-blur-sm"><ArrowRight /></span>
        </div>
      </div>
    </button>
  )
}

export default function Home() {
  const { data } = useCore()
  const rootRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  // On desktop, size the grid so the six equal windows fill the viewport with
  // no page scroll. On smaller screens they stack and scroll normally.
  const [gridH, setGridH] = useState<number | undefined>(undefined)
  useLayoutEffect(() => {
    const grid = gridRef.current
    if (!grid) return
    const compute = () => {
      const desktop = window.matchMedia('(min-width: 1024px)').matches
      if (!desktop) { setGridH(undefined); return }
      const top = grid.getBoundingClientRect().top
      setGridH(Math.max(300, Math.round(window.innerHeight - top - 28)))
    }
    compute()
    window.addEventListener('resize', compute)
    // Recompute when the hero reflows (e.g. the pre-season note appears).
    const ro = new ResizeObserver(compute)
    if (rootRef.current) ro.observe(rootRef.current)
    return () => { window.removeEventListener('resize', compute); ro.disconnect() }
  }, [])

  return (
    <div ref={rootRef} className="mx-auto w-full max-w-[1760px] px-4 pt-5 pb-6 md:px-6 md:pt-6 lg:pb-0">
      {data && <GameweekCover data={data} />}
      <Hero />
      <div
        ref={gridRef}
        style={gridH ? { height: gridH } : undefined}
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:gap-3.5"
      >
        {WINDOWS.map((w) => <WindowCard key={w.key} w={w} />)}
      </div>
    </div>
  )
}
