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

declare global {
  interface Window {
    /** Core-table fetches kicked off from index.html during HTML parse. */
    __early?: Record<string, Promise<Response>>
  }
}

const BASE = 'https://raw.githubusercontent.com/stefcourt2004-png/fpl-analyser/main/'

// One shared promise per table name → every caller gets the same data and we
// never fetch a table twice (covers eager core tables and lazy big tables).
const cache = new Map<string, Promise<unknown>>()

// Fetch a table, trying the local copy then the published main branch, with a
// few retries to ride out flaky mobile networks / a racing service worker.
async function fetchTable<T>(name: string): Promise<T> {
  // Use the download index.html already started, if there is one — it began
  // during HTML parse, long before this module was even downloaded.
  const early = typeof window !== 'undefined' ? window.__early?.[name] : undefined
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
    for (const url of [`site_data/${name}.json`, `${BASE}site_data/${name}.json`]) {
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
    ])
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
