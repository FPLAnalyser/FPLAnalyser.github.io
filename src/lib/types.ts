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

/** Our own team Attack/Defence ratings (0–100) + league rank, per window. */
export interface TeamRatingRow extends Row {
  team: string
  window: '4gw' | '6gw' | 'season'
  attack: number
  attack_rank: number
  defence: number
  defence_rank: number
  set_piece_share: number | null
  set_piece_threat: boolean
  // Underlying components surfaced for the list's Attack/Defence tabs.
  // finish_delta (goals−xG) and xgc_prevented (xGC−goals conceded) are raw and
  // carry a dataset-wide xG/goal offset, so the UI shows them relative to the
  // league mean.
  finish_delta: number | null
  xgc_prevented: number | null
  box_share: number | null
  box_share_conceded: number | null
  shots: number | null
  shots_conceded: number | null
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
  teamRatings: TeamRatingRow[]
  meta: Meta | null
  benchmarks: Row[] | null
  replacementPool: Row[]
  personaShifts: Row[]
  priceRisk: Row[]
  playerForm: Row[]
}
