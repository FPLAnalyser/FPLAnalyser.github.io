// data.ts — table loading + a shared in-memory cache.
//
// Ported from the legacy js/data.js: prefer local site_data/<name>.json (so
// local/dev previews use local data), then fall back to the published main
// branch. The legacy CSV fallback is intentionally dropped — every pipeline
// run has emitted site_data JSON for the whole history of build_site_data.py.
//
// This module is deliberately free of React/DOM imports so it can be reused by
// a future Capacitor native HTTP layer.

import type { CoreData, Row } from './types'
import { registerTeams } from './teamRegistry'

declare global {
  interface Window {
    /** Core-table fetches kicked off from index.html during HTML parse. */
    __early?: Record<string, Promise<Response>>
    /** Season segment resolved synchronously in index.html (localStorage/default). */
    __season?: string
  }
}

const BASE = 'https://raw.githubusercontent.com/stefcourt2004-png/fpl-analyser/main/'

// In the native (Capacitor) app the web assets — and their bundled copy of
// site_data — are frozen at build time, so we fetch the published data FIRST
// (fresh, updated by the pipeline pushes) and fall back to the bundled copy only
// when offline. On the web we keep the local-first order (same-origin, fastest).
const IS_NATIVE = typeof window !== 'undefined'
  && !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.()

// Data is namespaced by season on disk: site_data/<season>/<name>.json. The
// active season is resolved once per page load (index.html sets window.__season
// from localStorage or the build-time default; switching seasons reloads).
export const DEFAULT_SEASON = '2025-26'
let activeSeason: string | null = null
export function setActiveSeason(id: string) {
  activeSeason = id
}
function seasonSeg(): string {
  if (activeSeason) return activeSeason
  if (typeof window !== 'undefined' && window.__season) return window.__season
  return DEFAULT_SEASON
}

// One shared promise per table name → every caller gets the same data and we
// never fetch a table twice (covers eager core tables and lazy big tables).
const cache = new Map<string, Promise<unknown>>()

// Fetch a table, trying the local copy then the published main branch, with a
// few retries to ride out flaky mobile networks / a racing service worker.
async function fetchTable<T>(name: string): Promise<T> {
  // Use the download index.html already started, if there is one — it began
  // during HTML parse, long before this module was even downloaded.
  // Skip the index.html eager fetch on native — it targets the bundled (frozen)
  // copy, and we want the fresh published data there.
  const early = !IS_NATIVE && typeof window !== 'undefined' ? window.__early?.[name] : undefined
  if (early) {
    delete window.__early![name]
    try {
      const r = await early
      if (r.ok) return (await r.json()) as T
    } catch {
      /* fall through to the normal retrying path */
    }
  }
  let lastErr: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    const seg = seasonSeg()
    const local = `site_data/${seg}/${name}.json`
    const remote = `${BASE}site_data/${seg}/${name}.json`
    for (const url of IS_NATIVE ? [remote, local] : [local, remote]) {
      try {
        // Default HTTP caching: the service worker (stale-while-revalidate)
        // owns freshness; forcing revalidation here made mobile loads crawl.
        const r = await fetch(url)
        if (r.ok) return (await r.json()) as T
      } catch (e) {
        lastErr = e
      }
    }
    if (attempt < 2) await new Promise((res) => setTimeout(res, 350 * (attempt + 1)))
  }
  throw lastErr ?? new Error(`no source for table ${name}`)
}

export function loadTable<T = Row[]>(name: string): Promise<T> {
  const existing = cache.get(name)
  if (existing) return existing as Promise<T>

  const promise = fetchTable<T>(name)
  cache.set(name, promise)
  // On failure, evict so the next caller retries instead of reusing a rejected
  // promise (which previously left the page stuck until a full page reload).
  promise.catch(() => {
    if (cache.get(name) === promise) cache.delete(name)
  })
  return promise
}

/** Optional table — resolves to a fallback instead of throwing if absent. */
async function optional<T>(name: string, fallback: T): Promise<T> {
  try {
    return await loadTable<T>(name)
  } catch {
    return fallback
  }
}

let corePromise: Promise<CoreData> | null = null

/** Loads and caches the core tables needed across most pages. */
export function loadCore(): Promise<CoreData> {
  if (corePromise) return corePromise
  const p = (async () => {
    const [
      ratings,
      personas4,
      metrics,
      teamMetrics,
      seasonToDate,
      tierPerf,
      fixtureEase,
      teamRatings,
      meta,
      benchmarks,
      replacementPool,
      personaShifts,
      priceRisk,
      playerForm,
      teams,
    ] = await Promise.all([
      loadTable('ratings') as Promise<CoreData['ratings']>,
      loadTable('personas_4gw') as Promise<CoreData['personas4']>,
      loadTable('advanced_metrics') as Promise<Row[]>,
      loadTable('team_metrics') as Promise<Row[]>,
      loadTable('season_to_date') as Promise<Row[]>,
      loadTable('player_tiers') as Promise<Row[]>,
      optional<CoreData['fixtureEase']>('fixture_ease', []),
      optional<CoreData['teamRatings']>('team_ratings', []),
      optional<CoreData['meta']>('meta', null),
      optional<Row[] | null>('benchmarks', null),
      optional<Row[]>('replacement_pool', []),
      optional<Row[]>('persona_shifts', []),
      optional<Row[]>('price_risk', []),
      optional<Row[]>('player_form', []),
      optional<Row[]>('teams', []),
    ])
    // Register team badge codes / names from the season's teams table (covers
    // promoted clubs the hardcoded fallback map doesn't know) before any UI
    // renders. Optional table — absent for older seasons, which use the map.
    registerTeams(teams)
    // Cache-bust token for external player photos: keyed to the data's build
    // date, so regenerating the data (e.g. after transfers) re-fetches headshots
    // and picks up new club kits instead of a browser-cached old one.
    if (typeof window !== 'undefined') {
      const gen = meta && typeof (meta as { generated_at?: string }).generated_at === 'string'
        ? (meta as { generated_at?: string }).generated_at!.slice(0, 10)
        : ''
      ;(window as unknown as { __photoVer?: string }).__photoVer = gen
    }
    return {
      ratings,
      personas4,
      metrics,
      teamMetrics,
      seasonToDate,
      tierPerf,
      fixtureEase,
      teamRatings,
      meta,
      benchmarks,
      replacementPool,
      personaShifts,
      priceRisk,
      playerForm,
    }
  })()
  corePromise = p
  // Reset on failure so a later mount/navigation can retry the core load.
  p.catch(() => {
    if (corePromise === p) corePromise = null
  })
  return corePromise
}

export { BASE }
