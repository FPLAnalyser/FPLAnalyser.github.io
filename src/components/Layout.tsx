import { useEffect, useState } from 'react'
import { PREVIEW } from '../lib/flags'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Icon } from './Icon'
import { PreviewBadge } from './PreviewBadge'
import { OnboardingModal } from './OnboardingModal'
import { ThemeSwitcher } from './ThemeSwitcher'
import { SeasonSwitcher } from './SeasonSwitcher'
import { GlobalSearch, SearchSheet } from './GlobalSearch'
import { BottomNav } from './BottomNav'
import { SUPPORT_URL, SUPPORT_LABEL } from '../lib/support'
import { countPage } from '../lib/analytics'
import { PullToRefresh } from './PullToRefresh'
import { AppOnboarding } from './AppOnboarding'
import { useCore } from '../lib/useData'
import { ensureLiveCodes } from '../lib/photoCodes'
import type { RatingRow } from '../lib/types'

// Same sequence as the home tiles in `pages/Home.tsx` — the two are the only
// full menus on the site and disagreeing about the order makes both feel
// arbitrary. Change one, change the other.
//
// Short labels: the nav is a single non-wrapping row with a hidden scrollbar,
// so anything past the edge is effectively invisible. The pages keep their
// full titles ("GW Preview", "GW Review", "Squad Builder").
/* Captaincy is unfinished and has no link in production. It is spliced back
   in for preview builds so the work stays reachable while it is being done. */
const LINKS: { to: string; label: string }[] = [
  { to: '/', label: 'Home' },
  { to: '/preview', label: 'Preview' },
  { to: '/squad', label: 'Squad' },
  ...(PREVIEW ? [{ to: '/captaincy', label: 'Captaincy' }] : []),
  { to: '/fixtures', label: 'Fixtures' },
  { to: '/players', label: 'Players' },
  { to: '/scout', label: 'Scouting' },
  { to: '/teams', label: 'Teams' },
  { to: '/loadteam', label: 'My Team' },
  { to: '/review', label: 'Review' },
]

export function Layout() {
  // Onboarding no longer auto-opens; it's only reachable from the info button.
  const [helpOpen, setHelpOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const { data } = useCore()
  const { pathname } = useLocation()

  // Count the page. Here rather than in App because this is inside the router,
  // which is what makes `pathname` the real page — a hash route is invisible
  // from outside it, and invisible to anything that counts by URL.
  //
  // Fires on every route change including the first, which is what a page view
  // is. Does nothing at all on a build without VITE_GOATCOUNTER.
  useEffect(() => {
    countPage(pathname, document.title)
  }, [pathname])

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
        <div className="mx-auto flex h-14 max-w-[1760px] items-center gap-2 px-3 md:h-[70px] md:px-6">
          <NavLink to="/" end className="flex shrink-0 items-center gap-2 leading-none md:gap-2.5" aria-label="FPL Analyser — home">
            <span className="flex flex-col justify-center">
              <span className="font-brand text-[15px] font-normal tracking-[0.045em] text-ink sm:text-[17px] md:text-xl">
                <span className="metallic-num font-medium">FPL</span> Analyser
              </span>
              <span className="mt-0.5 hidden text-[10px] font-semibold tracking-[0.22em] text-ink-3 uppercase md:block">
                Data · <span className="text-accent">Insight</span> · Points
              </span>
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
                  `relative flex min-h-11 items-center whitespace-nowrap rounded-md px-2 text-sm font-medium transition-colors lg:px-2.5 xl:px-2.5 2xl:px-3 ${
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
          <div className="ml-3 hidden w-44 shrink-0 xl:block 2xl:w-60">
            <GlobalSearch />
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-0.5 md:ml-3 xl:ml-2">
            {/* Search trigger — md to xl only. Below md the bottom bar carries a
                centre Search of its own, so this was a second button for the
                same sheet; it also made the header cluster 205px wide against
                a 320px phone, which pushed every page 10px sideways. Above xl
                the inline search box takes over. */}
            <button
              className="hidden min-h-11 min-w-10 items-center justify-center rounded-md text-ink-2 transition-colors hover:text-ink sm:min-w-11 md:flex xl:hidden"
              aria-label="Search players & teams"
              onClick={() => setSearchOpen(true)}
            >
              <Icon name="search" size={18} />
            </button>
            <ThemeSwitcher />
            <button
              className="flex min-h-11 min-w-10 items-center justify-center rounded-md text-ink-2 transition-colors hover:text-ink sm:min-w-11"
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
      <PreviewBadge />

      <PullToRefresh>
        <main className="pb-[calc(env(safe-area-inset-bottom)+76px)] md:pb-[env(safe-area-inset-bottom)]">
          <Outlet />
          {/* Attribution licences require the credit to be reachable by anyone
              who sees the image, so the link has to be on every page rather
              than tucked inside a menu. */}
          <footer className="mx-auto max-w-[1400px] px-2.5 pt-2 pb-8 text-[12px] text-ink-3 sm:px-4 md:px-6">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-4">
              <span>FPL Analyser — independent, and not affiliated with the Premier League or Fantasy Premier League.</span>
              {/* THE ARCHIVE, OUT OF THE HEADER. It sat in the nav cluster
                  costing 77px of a row that runs out of width at 1280, for a
                  control almost nobody touches: it names the current season,
                  which every page already implies, and its only real job is
                  reaching last season's data. Down here it is still one click
                  from every page and it is no longer competing with the nav.
                  It renders as a plain label when only one season exists. */}
              <SeasonSwitcher />
              <NavLink to="/legal" className="text-accent underline underline-offset-2 hover:text-accent-2">
                Data, credits &amp; privacy
              </NavLink>
              {/* The whole site is free. One quiet link, in the least intrusive
                  place on the page — a tip jar that interrupts reads as a
                  paywall in waiting, which is exactly what it isn't. */}
              {SUPPORT_URL && (
                <a
                  href={SUPPORT_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent underline underline-offset-2 hover:text-accent-2"
                >
                  {SUPPORT_LABEL}
                </a>
              )}
            </div>
          </footer>
        </main>
      </PullToRefresh>

      <BottomNav onSearch={() => setSearchOpen(true)} />
      <SearchSheet open={searchOpen} onClose={() => setSearchOpen(false)} />
      <OnboardingModal open={helpOpen} onClose={() => setHelpOpen(false)} />
      <AppOnboarding />
    </div>
  )
}
