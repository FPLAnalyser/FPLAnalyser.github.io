import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { loadCore, loadTable } from './data'
import type { CoreData } from './types'

interface CoreState {
  data: CoreData | null
  error: unknown
}

const CoreContext = createContext<CoreState>({ data: null, error: null })

/** Loads the core tables once and shares the single copy with every page. */
export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CoreState>({ data: null, error: null })

  useEffect(() => {
    let alive = true
    loadCore()
      .then((data) => alive && setState({ data, error: null }))
      .catch((error) => alive && setState({ data: null, error }))
    return () => {
      alive = false
    }
  }, [])

  return <CoreContext.Provider value={state}>{children}</CoreContext.Provider>
}

/** Core tables (null until loaded). */
export function useCore() {
  return useContext(CoreContext)
}

interface LazyState<T> {
  data: T | null
  loading: boolean
  error: unknown
}

/**
 * Lazily fetch one of the large tables (player_shots, shots_for/conceded,
 * scouting …) on demand. Shared cache in data.ts means repeated mounts don't
 * refetch.
 */
export function useLazyTable<T = unknown>(name: string | null): LazyState<T> {
  const [state, setState] = useState<LazyState<T>>({ data: null, loading: !!name, error: null })

  useEffect(() => {
    if (!name) {
      setState({ data: null, loading: false, error: null })
      return
    }
    let alive = true
    setState({ data: null, loading: true, error: null })
    loadTable<T>(name)
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState({ data: null, loading: false, error }))
    return () => {
      alive = false
    }
  }, [name])

  return state
}
