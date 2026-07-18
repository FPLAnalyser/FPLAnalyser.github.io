import { lazy, Suspense } from 'react'
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import { PageSkeleton } from './components/Skeleton'
import { DataProvider } from './lib/useData'
import { ThemeProvider } from './lib/theme'

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

const Home = lazyRetry(() => import('./pages/Home'))
const Players = lazyRetry(() => import('./pages/Players'))
const Teams = lazyRetry(() => import('./pages/Teams'))
const Rankings = lazyRetry(() => import('./pages/Rankings'))
const MyTeam = lazyRetry(() => import('./pages/MyTeam'))
const Scouting = lazyRetry(() => import('./pages/Scouting'))

const page = (el: React.ReactNode) => <Suspense fallback={<PageSkeleton />}>{el}</Suspense>

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
      { path: 'rankings', element: page(<Rankings />) },
      { path: 'loadteam', element: page(<MyTeam />) },
      { path: 'scout', element: page(<Scouting />) },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export default function App() {
  return (
    <ThemeProvider>
      <DataProvider>
        <RouterProvider router={router} />
      </DataProvider>
    </ThemeProvider>
  )
}
