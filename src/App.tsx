import { lazy, Suspense } from 'react'
import { createHashRouter, Navigate, RouterProvider } from 'react-router-dom'
import { Layout } from './components/Layout'
import { PageSkeleton } from './components/Skeleton'
import { DataProvider } from './lib/useData'

const Home = lazy(() => import('./pages/Home'))
const Players = lazy(() => import('./pages/Players'))
const Teams = lazy(() => import('./pages/Teams'))
const Rankings = lazy(() => import('./pages/Rankings'))
const MyTeam = lazy(() => import('./pages/MyTeam'))
const Scouting = lazy(() => import('./pages/Scouting'))

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
    <DataProvider>
      <RouterProvider router={router} />
    </DataProvider>
  )
}
