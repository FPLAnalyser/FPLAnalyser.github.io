import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Icon } from './Icon'
import { OnboardingModal, hasSeenOnboarding } from './OnboardingModal'
import { ThemeSwitcher } from './ThemeSwitcher'

const LINKS: { to: string; label: string; kicker?: string }[] = [
  { to: '/', label: 'Briefing', kicker: 'Analytics' },
  { to: '/player', label: 'Players' },
  { to: '/teams', label: 'Teams' },
  { to: '/rankings', label: 'Rankings' },
  { to: '/loadteam', label: 'My Team', kicker: 'Tools' },
  { to: '/scout', label: 'Scouting' },
]

export function Layout() {
  const [helpOpen, setHelpOpen] = useState(() => !hasSeenOnboarding())
  const location = useLocation()
  const reduced = useReducedMotion()

  return (
    <div className="min-h-screen">
      <nav
        className="sticky top-0 z-[100] border-b border-line bg-glass backdrop-blur-xl"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-3 md:h-[70px] md:px-6">
          <NavLink to="/" className="mr-3 flex shrink-0 flex-col justify-center leading-none md:mr-5" aria-label="FPL Analyser — home">
            <span className="text-[17px] font-extrabold tracking-tight text-ink md:text-xl">
              FPL <span className="text-accent">Analyser</span>
            </span>
            <span className="mt-0.5 hidden text-[9px] font-semibold tracking-[0.22em] text-ink-3 uppercase md:block">
              Data · Insight · Points
            </span>
          </NavLink>
          <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:gap-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {LINKS.map((link) => (
              <span key={link.to} className="flex items-center">
                {link.kicker && (
                  <span
                    className="mr-1.5 ml-2 hidden text-[10px] font-semibold tracking-[0.14em] text-ink-3 uppercase lg:inline"
                    aria-hidden="true"
                  >
                    {link.kicker}
                  </span>
                )}
                <NavLink
                  to={link.to}
                  className={({ isActive }) =>
                    `relative flex min-h-11 items-center whitespace-nowrap rounded-md px-2.5 text-[13px] font-medium transition-colors md:px-3 md:text-sm ${
                      isActive ? 'text-accent' : 'text-ink-2 hover:text-ink'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {link.label}
                      {isActive && (
                        <motion.span
                          layoutId="nav-underline"
                          className="absolute inset-x-2 bottom-1 h-0.5 rounded-full bg-accent"
                          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                        />
                      )}
                    </>
                  )}
                </NavLink>
              </span>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
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

      <main style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      <OnboardingModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  )
}
