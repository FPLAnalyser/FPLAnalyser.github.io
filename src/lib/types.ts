// Lightweight types for the site_data tables. The pipeline emits very wide row
// objects (40+ columns on ratings); rather than enumerate every column we type
// the handful of fields the UI reads by name and keep an index signature for
// the rest. Star-rating fields are pipeline strings like "⭐⭐⭐½".

export type Cell = string | number | boolean | null

export interface Row {
  [key: string]: Cell
}

export interface RatingRow extends Row {
  element: number
  web_name: string
  team: string
  position: 'GKP' | 'DEF' | 'MID' | 'FWD'
  price: number
  total_mins: number
  total_starts: number
  selected_by_percent: number
  code: number
  season_overall_score: number
  gw4_overall_score: number
  season_overall_rating: string
  gw4_overall_rating: string
}

export interface PersonaRow extends Row {
  element: number
  web_name: string
  team: string
  position: string
  personas: string
  persona_count: number
  starts_last4: number
}

export interface FixtureEaseRow extends Row {
  team: string
  gw: number
  opponent: string
  venue: 'H' | 'A'
  fdr: 1 | 2 | 3 | 4 | 5
}

export interface Meta {
  generated_at: string
  current_gw: number | null
  next_gw: number | null
  tables: Record<string, number>
}

export interface ShotEvent extends Row {
  x: number
  y: number
  xg: number
  result: string
  situation: string
  kickoff_date: string
}

export interface PlayerShotEvent extends ShotEvent {
  minute: number
  opp: string
}

/** The core tables loaded eagerly on first paint. */
export interface CoreData {
  ratings: RatingRow[]
  personas4: PersonaRow[]
  metrics: Row[]
  teamMetrics: Row[]
  seasonToDate: Row[]
  tierPerf: Row[]
  fixtureEase: FixtureEaseRow[]
  meta: Meta | null
  benchmarks: Row[] | null
  replacementPool: Row[]
  personaShifts: Row[]
  priceRisk: Row[]
  playerForm: Row[]
}
