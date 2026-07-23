import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { BASE, DEFAULT_SEASON, setActiveSeason } from './data'

// Season selection. The active season for this page load is resolved
// synchronously in index.html (window.__season, from localStorage or the
// build-time default). Switching seasons stores the choice and reloads so the
// eager preload and every fetch line up on the new folder. The list of
// available seasons comes from site_data/seasons.json.

export interface SeasonInfo {
  id: string
  label: string
  /** Pre-season carry-over: ratings shown are last season's, not yet earned. */
  provisional?: boolean
  /** Which season the carried-over ratings come from (e.g. "2025-26"). */
  ratings_season?: string
}
interface SeasonContextValue { season: string; info?: SeasonInfo; seasons: SeasonInfo[]; setSeason: (id: string) => void }

const labelOf = (id: string) => id.replace('-', '/')

const SeasonContext = createContext<SeasonContextValue>({ season: DEFAULT_SEASON, seasons: [], setSeason: () => {} })

export function SeasonProvider({ children }: { children: ReactNode }) {
  const active = (typeof window !== 'undefined' && window.__season) || DEFAULT_SEASON
  setActiveSeason(active)
  const [seasons, setSeasons] = useState<SeasonInfo[]>([{ id: active, label: labelOf(active) }])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      for (const url of ['site_data/seasons.json', `${BASE}site_data/seasons.json`]) {
        try {
          const r = await fetch(url)
          if (r.ok) {
            const m = await r.json()
            if (!cancelled && Array.isArray(m?.seasons) && m.seasons.length) {
              setSeasons(m.seasons.map((s: SeasonInfo) => ({ ...s, label: s.label || labelOf(s.id) })))
              return
            }
          }
        } catch {
          /* try next source */
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  const setSeason = (id: string) => {
    if (id === active) return
    try { localStorage.setItem('fpl_season', id) } catch { /* private mode */ }
    location.reload()
  }

  const info = seasons.find((s) => s.id === active)
  return <SeasonContext.Provider value={{ season: active, info, seasons, setSeason }}>{children}</SeasonContext.Provider>
}

export const useSeason = () => useContext(SeasonContext)
