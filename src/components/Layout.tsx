import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Icon } from './Icon'
import { OnboardingModal, hasSeenOnboarding } from './OnboardingModal'
import { ThemeSwitcher } from './ThemeSwitcher'
import { GlobalSearch, SearchSheet } from './GlobalSearch'
import { BottomNav } from './BottomNav'
import { useCore } from '../lib/useData'
import { ensureLiveCodes } from '../lib/photoCodes'
import type { RatingRow } from '../lib/types'

const LINKS: { to: string; label: string }[] = [
  { to: '/', label: 'Home' },
  { to: '/players', label: 'Players' },
  { to: '/teams', label: 'Teams' },
  { to: '/fixtures', label: 'Fixtures' },
  { to: '/scout', label: 'Scouting' },
  { to: '/loadteam', label: 'My Team' },
]

export function Layout() {
  const [helpOpen, setHelpOpen] = useState(() => !hasSeenOnboarding())
  const [searchOpen, setSearchOpen] = useState(false)
  const { data } = useCore()

  // Best-effort: refresh player photo codes from the live FPL API so
  // transferred / newly-added players show the current kit (falls back to the
  // pipeline codes, and only applies if the live data matches our season).
  useEffect(() => {
    const ratings = (data?.ratings ?? []) as RatingRow[]
    if (!ratings.length) return
    ensureLiveCodes(ratings.filter((r) => r.element != null && r.code != null).map((r) => [r.element, r.code]))
  }, [data])

  return (
    <div className="min-h-screen">
      <nav
        className="sticky top-0 z-[100] border-b border-line bg-glass backdrop-blur-xl"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-3 md:h-[70px] md:px-6">
          <NavLink to="/" end className="flex shrink-0 flex-col justify-center leading-none" aria-label="FPL Analyser — home">
            <span className="text-[17px] font-extrabold tracking-tight text-ink md:text-xl">
              FPL <span className="text-accent">Analyser</span>
            </span>
            <span className="mt-0.5 hidden text-[9px] font-semibold tracking-[0.22em] text-ink-3 uppercase md:block">
              Data · Insight · Points
            </span>
          </NavLink>

          {/* Desktop nav links */}
          <div className="ml-3 hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:flex lg:ml-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === '/'}
                className={({ isActive }) =>
                  `relative flex min-h-11 items-center whitespace-nowrap rounded-md px-2.5 text-sm font-medium transition-colors lg:px-3 ${
                    isActive ? 'text-accent' : 'text-ink-2 hover:text-ink'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {link.label}
                    {isActive && <span className="absolute inset-x-2 bottom-1 h-0.5 rounded-full bg-accent" />}
                  </>
                )}
              </NavLink>
            ))}
          </div>

          {/* Desktop global search (inline at xl+) */}
          <div className="ml-3 hidden w-60 shrink-0 xl:block">
            <GlobalSearch />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-0.5 md:ml-3 xl:ml-2">
            {/* Search trigger — everything below xl (inline box takes over at xl) */}
            <button
              className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-2 transition-colors hover:text-ink xl:hidden"
              aria-label="Search players & teams"
              onClick={() => setSearchOpen(true)}
            >
              <Icon name="search" size={18} />
            </button>
            <ThemeSwitcher />
            <button
              className="flex min-h-11 min-w-11 items-center justify-center rounded-md text-ink-2 transition-colors hover:text-ink"
              title="How it works"
              aria-label="How it works"
              onClick={() => setHelpOpen(true)}
            >
              <Icon name="info" size={16} />
            </button>
          </div>
        </div>
      </nav>

      {/* No animated route transition: content must never depend on the
          animation engine to become visible (it silently fails on some WebKit
          versions, leaving pages mounted but at opacity 0). */}
      <main className="pb-[calc(env(safe-area-inset-bottom)+76px)] md:pb-[env(safe-area-inset-bottom)]">
        <Outlet />
      </main>

      <BottomNav onSearch={() => setSearchOpen(true)} />
      <SearchSheet open={searchOpen} onClose={() => setSearchOpen(false)} />
      <OnboardingModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
