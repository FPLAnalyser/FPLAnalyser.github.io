import { lazy, Suspense, useEffect } from 'react'
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import { IntroSplash } from './components/IntroSplash'
import { PageSkeleton } from './components/Skeleton'
import { ErrorBoundary } from './components/ErrorBoundary'
import { DataProvider } from './lib/useData'
import { ThemeProvider } from './lib/theme'
import { SeasonProvider } from './lib/season'

// Retry a dynamic import a few times so a flaky mobile network (or a
// mid-deploy chunk miss) doesn't leave a route blank until a manual refresh.
function lazyRetry(factory: () => Promise<{ default: React.ComponentType<unknown> }>) {
  return lazy(async () => {
    let lastErr: unknown
    for (let i = 0; i < 3; i++) {
      try {
        return await factory()
      } catch (e) {
        lastErr = e
        await new Promise((res) => setTimeout(res, 400 * (i + 1)))
      }
    }
    throw lastErr
  })
}

const PAGE_LOADERS = {
  home: () => import('./pages/Home'),
  players: () => import('./pages/Players'),
  teams: () => import('./pages/Teams'),
  rankings: () => import('./pages/Rankings'),
  myteam: () => import('./pages/MyTeam'),
  scouting: () => import('./pages/Scouting'),
  fixtures: () => import('./pages/Fixtures'),
  compare: () => import('./pages/Compare'),
}

const Home = lazyRetry(PAGE_LOADERS.home)
const Players = lazyRetry(PAGE_LOADERS.players)
const Teams = lazyRetry(PAGE_LOADERS.teams)
const Rankings = lazyRetry(PAGE_LOADERS.rankings)
const MyTeam = lazyRetry(PAGE_LOADERS.myteam)
const Scouting = lazyRetry(PAGE_LOADERS.scouting)
const Fixtures = lazyRetry(PAGE_LOADERS.fixtures)
const Compare = lazyRetry(PAGE_LOADERS.compare)
const Debug = lazyRetry(() => import('./pages/Debug'))

// Every route is wrapped so a render throw OR a stale-chunk import failure
// becomes a visible, recoverable message + a logged error — never a blank page.
const page = (el: React.ReactNode) => (
  <ErrorBoundary>
    <Suspense fallback={<PageSkeleton />}>{el}</Suspense>
  </ErrorBoundary>
)

// Paths mirror the legacy hash routes (#home, #player, …) so old links keep working.
const router = createHashRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: page(<Home />) },
      { path: 'home', element: <Navigate to="/" replace /> },
      { path: 'player', element: page(<Players />) },
      { path: 'teams', element: page(<Teams />) },
      { path: 'players', element: page(<Rankings />) },
      { path: 'rankings', element: <Navigate to="/players" replace /> },
      { path: 'compare', element: page(<Compare />) },
      { path: 'fixtures', element: page(<Fixtures />) },
      { path: 'loadteam', element: page(<MyTeam />) },
      { path: 'scout', element: page(<Scouting />) },
      { path: 'debug', element: page(<Debug />) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function App() {
  // Warm every route chunk once the first page has painted, so tapping a tab
  // never waits on a network fetch (chunks are tiny and SW-precached after this).
  useEffect(() => {
    const warm = () => Object.values(PAGE_LOADERS).forEach((load) => load().catch(() => {}))
    const idle = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback
    const id = idle ? idle(warm) : window.setTimeout(warm, 1500)
    return () => {
      if (!idle) window.clearTimeout(id as number)
    }
  }, [])

  return (
    <ThemeProvider>
      <SeasonProvider>
        <DataProvider>
          <IntroSplash />
          <RouterProvider router={router} />
        </DataProvider>
      </SeasonProvider>
    </ThemeProvider>
  )
}
