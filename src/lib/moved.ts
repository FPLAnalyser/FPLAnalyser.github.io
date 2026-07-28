import { num } from './rows'
import type { CoreData, RatingRow, Row } from './types'

/* ════════════════════════════════════════════════════════════════════════
   Who has changed club since the numbers were recorded.

   Everything the pipeline derives from last season carries last season's
   club. The ratings table is rebuilt against the current squad list, so it
   carries this one. Where the two disagree, the player has moved — no extra
   feed needed, and it costs one map.

   This matters more than a wrong badge. A transfer invalidates a specific
   class of number: minutes, start rate, clean-sheet rate, save volume, share
   of team threat. Those describe a job at a club he has left. What survives
   is the shot-level quality — how well he finishes, how well he stops shots,
   how often he wins a header — because that is about the player.

   Dubravka is the case that makes it concrete. He started 92% of games at
   Burnley and the brief read "Nailed"; at Spurs he is third in line behind
   two keepers FPL prices at £4.5m to his £4.0m. Repeating that 92% as a claim
   about his role now is the single most damaging sentence the page can print,
   and we have nothing better to replace it with — so it says nothing until he
   plays.
   ════════════════════════════════════════════════════════════════════════ */

/** element → the club the season's numbers were earned at, for movers only. */
export function buildMovedFrom(data: CoreData | null): Map<number, string> {
  const out = new Map<number, string>()
  if (!data) return out
  const now = new Map<number, string>()
  for (const r of (data.ratings ?? []) as RatingRow[]) {
    const el = num(r as Row, 'element')
    if (el != null && r.team) now.set(el, String(r.team))
  }
  // Several last-season tables carry a club, and none of them covers everyone:
  // season-to-date holds 152 players, the persona table 275. Dubravka — the
  // case that prompted this — is in the second and not the first, so both get
  // read.
  for (const table of [data.personas4 as unknown as Row[], data.seasonToDate as Row[], data.metrics as Row[]]) {
    for (const r of table ?? []) {
      const el = num(r, 'element')
      const was = r.team == null ? null : String(r.team)
      if (el == null || !was || out.has(el)) continue
      const cur = now.get(el)
      if (cur && cur !== was) out.set(el, was)
    }
  }
  return out
}
