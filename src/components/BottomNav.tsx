import { NavLink } from 'react-router-dom'
import { Icon, type IconName } from './Icon'

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Home', icon: 'bolt' },
  { to: '/players', label: 'Players', icon: 'trophy' },
  { to: '/fixtures', label: 'Fixtures', icon: 'calendar' },
  { to: '/scout', label: 'Scout', icon: 'target' },
  { to: '/loadteam', label: 'My Team', icon: 'pitch' },
]

/**
 * App-like fixed bottom tab bar for phones (hidden on md+). Four route tabs plus
 * a prominent centre Search action that opens the global search sheet.
 */
export function BottomNav({ onSearch }: { onSearch: () => void }) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-[150] border-t border-line bg-glass backdrop-blur-xl md:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      aria-label="Primary"
    >
      <div className="mx-auto grid max-w-lg grid-cols-6 items-end px-1">
        {TABS.slice(0, 3).map((t) => <Tab key={t.to} {...t} />)}
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onSearch}
            aria-label="Search players & teams"
            className="-mt-4 flex h-13 w-13 items-center justify-center rounded-full bg-accent text-accent-contrast shadow-float transition-transform active:scale-95"
          >
            <Icon name="search" size={20} />
          </button>
        </div>
        {TABS.slice(3).map((t) => <Tab key={t.to} {...t} />)}
      </div>
    </nav>
  )
}

function Tab({ to, label, icon }: { to: string; label: string; icon: IconName }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `relative flex min-h-14 flex-col items-center justify-center gap-1 py-2 text-[10px] font-semibold transition-colors ${
          isActive ? 'text-accent' : 'text-ink-3'
        }`
      }
    >
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute top-1 h-1 w-1 rounded-full bg-accent" />}
          <Icon name={icon} size={20} />
          {label}
        </>
      )}
    </NavLink>
  )
}
