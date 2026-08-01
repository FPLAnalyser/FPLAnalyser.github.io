import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { loadCore, loadTable, TableAbsent } from './data'
import type { CoreData, RatingRow } from './types'

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
    let attempts = 0
    const attempt = () => {
      loadCore()
        .then((data) => alive && setState({ data, error: null }))
        .catch((error) => {
          if (!alive) return
          attempts++
          if (attempts < 4) setTimeout(attempt, 600 * attempts)
          else setState({ data: null, error })
        })
    }
    attempt()
    return () => {
      alive = false
    }
  }, [])

  return <CoreContext.Provider value={state}>{children}</CoreContext.Provider>
}

/* The daily layer, as it sits in the file. availability.ts parses the same
   file into a much richer shape (flags, return dates, set-piece order), but it
   imports from here, so reading the two fields every page needs directly is
   what keeps the two modules from importing each other. */
interface LiveRow { element: number; code: number; price?: number; own?: number
  /** Numeric FPL team id (1–20), not our short code. */
  team?: number
  /** Present since the availability refresh started carrying them; a player
   *  the ratings build has never seen can only be rendered with these two. */
  name?: string
  pos?: string
}

/** Core tables (null until loaded), with price and ownership taken from the
 *  daily refresh rather than the pipeline snapshot.
 *
 *  The snapshot is rebuilt on its own schedule and the live file every day, so
 *  they drift: on the morning this was written 62% of players had a different
 *  ownership figure in the two, some by more than ten points. Squad Builder
 *  already overlaid the live numbers, but nothing else did, so a player's page
 *  quoted an ownership days out of date next to a Squad Builder that had it
 *  right. Doing it here means every page reads the same figure. */
export function useCore() {
  const core = useContext(CoreContext)
  const live = useLazyTable<{ players?: LiveRow[] }>('availability')
  return useMemo(() => {
    const rows = live.data?.players
    if (!core.data || !Array.isArray(rows) || !rows.length) return core
    const byElement = new Map<number, LiveRow>()
    const byCode = new Map<number, LiveRow>()
    for (const p of rows) {
      if (p.element != null) byElement.set(Number(p.element), p)
      if (p.code != null) byCode.set(Number(p.code), p)
    }
    let changed = false
    const ratings = (core.data.ratings as RatingRow[]).map((r) => {
      const l = byElement.get(Number(r.element)) ?? byCode.get(Number(r.code))
      if (!l || (l.price == null && l.own == null)) return r
      const next = { ...r }
      if (l.price != null) next.price = l.price
      if (l.own != null) next.selected_by_percent = l.own
      if (next.price !== r.price || next.selected_by_percent !== r.selected_by_percent) changed = true
      return next
    })
    /* Players the daily feed knows about and the ratings build does not.
     *
     * The ratings build is run by hand and the feed every morning, so during a
     * transfer window the feed is ahead: on the day this was written it listed
     * 564 players against the build's 555, and those nine — one of them an
     * Arsenal player at £6.5m already owned by 1.3% — existed in the FPL game
     * and on no page of this site. Not in search, not in the Squad Builder.
     *
     * They come in carrying only what the feed has: name, position, club,
     * price, ownership. No metrics, so `season_ok` is absent and every
     * leaderboard already leaves them out — which is right, because there is
     * nothing to rank them on. What they get is to exist: findable by name,
     * pickable in a squad, honestly marked N/A.
     *
     * The team id is mapped through the players present in both files rather
     * than a table of our own, so it cannot drift out of step with either. */
    const shortByTeamId = new Map<number, string>()
    for (const r of core.data.ratings as RatingRow[]) {
      const l = byElement.get(Number(r.element)) ?? byCode.get(Number(r.code))
      if (l?.team != null && r.team) shortByTeamId.set(Number(l.team), String(r.team))
    }
    const known = new Set((core.data.ratings as RatingRow[]).map((r) => Number(r.element)))
    const POS = new Set(['GKP', 'DEF', 'MID', 'FWD'])
    const unrated = rows
      .filter((p) => p.element != null && !known.has(Number(p.element)) && p.name && p.pos && POS.has(p.pos) && p.team != null && shortByTeamId.has(Number(p.team)))
      .map((p) => ({
        element: Number(p.element),
        code: Number(p.code),
        web_name: String(p.name),
        position: p.pos as RatingRow['position'],
        team: shortByTeamId.get(Number(p.team)) as string,
        price: p.price ?? 0,
        selected_by_percent: p.own ?? 0,
        total_mins: 0,
        /** No pipeline row behind this one. Pages that explain a rating check
         *  it before promising a breakdown that does not exist. */
        unrated: true,
      })) as unknown as RatingRow[]

    if (!changed && !unrated.length) return core
    return { ...core, data: { ...core.data, ratings: unrated.length ? [...ratings, ...unrated] : ratings } }
  }, [core, live.data])
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
    let attempts = 0
    setState({ data: null, loading: true, error: null })
    const attempt = () => {
      loadTable<T>(name)
        .then((data) => alive && setState({ data, loading: false, error: null }))
        .catch((error) => {
          if (!alive) return
          attempts++
          // An absent table is an answer, not a failure — retrying it just
          // holds the caller on a skeleton for several seconds before
          // arriving at the same place.
          if (!(error instanceof TableAbsent) && attempts < 4) setTimeout(attempt, 600 * attempts)
          else setState({ data: null, loading: false, error })
        })
    }
    attempt()
    return () => {
      alive = false
    }
  }, [name])

  return state
}
