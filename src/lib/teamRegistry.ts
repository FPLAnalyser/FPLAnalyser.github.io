// Live team registry — short_name → permanent PL badge code + full name, loaded
// from site_data/<season>/teams.json. The hardcoded maps in util.ts only know a
// fixed set of clubs; this fills in promoted sides (and any future change) from
// the data itself, so badges and names never go missing at a season boundary.

const codeByShort = new Map<string, number>()
const nameByShort = new Map<string, string>()

interface TeamRow { short_name?: string; name?: string; code?: number }

export function registerTeams(rows: TeamRow[] | null | undefined) {
  if (!Array.isArray(rows)) return
  for (const t of rows) {
    if (t.short_name && typeof t.code === 'number') codeByShort.set(t.short_name, t.code)
    if (t.short_name && t.name) nameByShort.set(t.short_name, t.name)
  }
}

export const teamCodeFor = (short: string): number | undefined => codeByShort.get(short)
export const teamNameFor = (short: string): string | undefined => nameByShort.get(short)
