import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { useSeason } from '../lib/season'

function Hero() {
  const { info } = useSeason()
  const preseason = Boolean(info?.provisional)
  const seasonLabel = info?.label ?? '2026/27'
  const ratingsFrom = info?.ratings_season ? info.ratings_season.replace('-', '/') : null
  return (
    <section className="mb-5 md:mb-6">
      <p className="mb-3 text-[11px] font-semibold tracking-[0.28em] text-accent uppercase">Data. Insight. Points.</p>
      <h1 className="max-w-3xl text-2xl leading-[1.08] font-extrabold tracking-[-0.02em] text-ink md:text-4xl">
        Turn Premier League data into FPL points.
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2 md:text-base">
        FPL Analyser rates every player on the numbers that actually predict returns — expected goals, minutes, form and
        fixtures — then turns them into a plain-language verdict and transfer calls for <em>your</em> team.
      </p>

      {preseason && (
        <div className="mt-4 max-w-2xl rounded-xl border border-accent/25 bg-accent-soft/40 p-3.5">
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
  { key: 'players', to: '/players', kicker: 'Explore', title: 'Players', desc: 'Every player rated 0–100 — form, value, fixtures and the editorial player hero.', stat: '600+ rated',
    ghost: { text: '8', style: { right: '3%', bottom: '-8%', fontSize: 'clamp(120px,16vw,190px)' } } },
  { key: 'teams', to: '/teams', kicker: 'Explore', title: 'Teams', desc: 'Attack, defence and set-piece ratings for all 20 clubs, with matchup previews.', stat: '20 clubs',
    ghost: { text: 'AFC', style: { left: '5%', bottom: '2%', fontSize: 'clamp(72px,9vw,120px)', WebkitTextStroke: '2px rgba(255,255,255,.10)' } } },
  { key: 'fixtures', to: '/fixtures', kicker: 'Plan', title: 'Fixtures', desc: 'Our own fixture rating and rotation planner.', stat: 'Next 6 GWs' },
  { key: 'scouting', to: '/scout', kicker: 'Discover', title: 'Scouting', desc: 'Filter the market for your next differential.', stat: 'Find gems' },
  { key: 'squad', to: '/squad', kicker: 'Build', title: 'Squad Builder', desc: 'Draft an XI and plan the season week by week.', stat: '£100.0m' },
  { key: 'myteam', to: '/loadteam', kicker: 'Track', title: 'My Team', desc: 'Link your side for a live rated breakdown.', stat: 'Live GW1',
    ghost: { text: '★', style: { right: '6%', top: '8%', fontSize: 'clamp(70px,9vw,110px)', WebkitTextStroke: '2px color-mix(in srgb, var(--accent) 18%, transparent)' } } },
]

function ArrowRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="transition-transform group-hover:translate-x-1">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

function WindowCard({ w }: { w: HomeWin }) {
  const navigate = useNavigate()
  const [loaded, setLoaded] = useState(false)
  return (
    <button type="button" onClick={() => navigate(w.to)} className="hw-card group min-h-[190px] lg:min-h-0" aria-label={`${w.title} — ${w.desc}`}>
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
        <span className="mb-1.5 inline-flex items-center gap-1.5 text-[0.62rem] font-extrabold tracking-[0.16em] text-accent-2 uppercase">◆ {w.kicker}</span>
        <h3 className="font-display text-2xl leading-none text-white uppercase md:text-[1.75rem]">{w.title}</h3>
        <p className="mt-1.5 max-w-[34ch] text-[13px] leading-snug text-[#d8d2c6]">{w.desc}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-bold text-white backdrop-blur-sm">{w.stat}</span>
          <span className="inline-flex items-center gap-1.5 text-sm font-extrabold text-accent-2"><span className="hidden sm:inline">Open</span> <ArrowRight /></span>
        </div>
      </div>
    </button>
  )
}

export default function Home() {
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
      <Hero />
      <div
        ref={gridRef}
        style={gridH ? { height: gridH } : undefined}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:grid-rows-2 lg:gap-4"
      >
        {WINDOWS.map((w) => <WindowCard key={w.key} w={w} />)}
      </div>
    </div>
  )
}
