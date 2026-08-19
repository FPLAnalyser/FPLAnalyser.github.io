import raw from './squad.json'

export type Player = {
  element: number
  code: number
  name: string
  team: string
  position: 'GKP' | 'DEF' | 'MID' | 'FWD'
  price: number
  rating: number
  xp: number
  ppg: number
  owned: number
}

/* The squad is real data: the best-rated player per position with a mirrored
   headshot, out of site_data/2026-27/ratings.json. Rating is
   season_overall_score * 20 — traced to SquadBuilder.tsx:1527 rather than
   assumed, because the season_overall_RATING field next to it is a string of
   stars and would have painted "⭐⭐⭐⭐" on every card.

   It costs £110.5m, so it is not a legal squad. That is fine for a board that
   exists to be looked at, and wrong for anything that ships. */
export const SQUAD = raw as Player[]

/** Pitch is 68 wide (x) by 100 long (z), centred on the origin, attacking
 *  towards +z. Rows are spaced the way the 2D board spaces them rather than
 *  the way a real 4-4-2 stands, because the point is a legible teamsheet. */
export const PITCH_W = 68
export const PITCH_L = 100

const ROW_Z: Record<Player['position'], number> = {
  GKP: -42,
  DEF: -21,
  MID: 4,
  FWD: 28,
}

/** How wide each row spreads, in metres.

    Not one shared span. Four defenders and four midfielders spread across the
    same width put every midfielder directly in front of a defender, and from
    behind the goal — which is where the standing variant looks from — the
    front row simply erases the back one. Giving the rows different widths
    staggers them, so every card has clear air beside the one behind it. It is
    also how a back four and a midfield four actually stand. */
const ROW_SPAN: Record<Player['position'], number> = {
  GKP: 0,
  DEF: 54,
  MID: 44,
  FWD: 26,
}

export type Slot = { player: Player; x: number; z: number; armband?: 'C' | 'V' }

/** The XI: 1-4-4-2 taken off the top of each position group, spread evenly
 *  across the row. The other four are the bench and stand off the pitch. */
export function pickXI(squad: Player[] = SQUAD): { xi: Slot[]; bench: Player[] } {
  const by = (pos: Player['position']) => squad.filter((p) => p.position === pos)
  const shape: [Player['position'], number][] = [['GKP', 1], ['DEF', 4], ['MID', 4], ['FWD', 2]]

  const xi: Slot[] = []
  const used = new Set<number>()
  for (const [pos, n] of shape) {
    const row = by(pos).slice(0, n)
    row.forEach((player, i) => {
      used.add(player.element)
      const span = ROW_SPAN[pos]
      const x = n === 1 ? 0 : -span / 2 + (span / (n - 1)) * i
      xi.push({ player, x, z: ROW_Z[pos] })
    })
  }

  // Armbands go to the two highest-rated starters, which is what the app's
  // autoLineup does with the same rating.
  const ranked = [...xi].sort((a, b) => b.player.rating - a.player.rating)
  if (ranked[0]) ranked[0].armband = 'C'
  if (ranked[1]) ranked[1].armband = 'V'

  return { xi, bench: squad.filter((p) => !used.has(p.element)) }
}
