/* Where the reader's FPL Team ID lives, in one place.
 *
 * Two surfaces write it and one reads it: the home banner takes it, My Team
 * takes it, and My Team loads from it on mount. Written as a bare string
 * literal in each file it would have been a silent failure the first time one
 * of them was edited — a banner storing under one name and a page looking
 * under another looks exactly like the FPL API being down.
 *
 * localStorage only. The id is the reader's, it identifies their team on a
 * public API, and it never leaves the device except in the call that fetches
 * that team — see docs/DOMAIN_CATEGORISATION.md for why this site keeps its
 * data collection to nothing.
 */
export const TEAM_ID_KEY = 'fpl_team_id'

/** FPL team ids are numeric. Anything else is a typo, not an id. */
export const isTeamId = (v: string): boolean => /^\d+$/.test(v.trim())

export function readTeamId(): string {
  try {
    return localStorage.getItem(TEAM_ID_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveTeamId(id: string): void {
  try {
    localStorage.setItem(TEAM_ID_KEY, id.trim())
  } catch {
    /* Private browsing, or storage disabled. The id still works for this
       visit — it is passed straight to the loader — it just is not remembered. */
  }
}
