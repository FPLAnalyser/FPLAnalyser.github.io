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

const BASE = 'https://raw.githubusercontent.com/stefcourt2004-png/fpl-analyser/main/'

// One shared promise per table name → every caller gets the same data and we
// never fetch a table twice (covers eager core tables and lazy big tables).
const cache = new Map<string, Promise<unknown>>()

export function loadTable<T = Row[]>(name: string): Promise<T> {
  const existing = cache.get(name)
  if (existing) return existing as Promise<T>

  const promise = (async () => {
    for (const url of [`site_data/${name}.json`, `${BASE}site_data/${name}.json`]) {
      try {
        const r = await fetch(url)
        if (r.ok) return (await r.json()) as T
      } catch {
        /* try next source */
      }
    }
    throw new Error(`no source for table ${name}`)
  })()

  cache.set(name, promise)
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
  corePromise = (async () => {
    const [
      ratings,
      personas4,
      metrics,
      teamMetrics,
      seasonToDate,
      tierPerf,
      fixtureEase,
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
      meta,
      benchmarks,
      replacementPool,
      personaShifts,
      priceRisk,
      playerForm,
    }
  })()
  return corePromise
}

export { BASE }
