/**
 * Turn what the screenshot reader saw into actual players.
 *
 * Two clues come off each card and they are worth very different amounts. The
 * fixture pill is three capital letters and a bracket, which OCR gets right
 * essentially always, and in any one gameweek an (opponent, venue) pair
 * belongs to exactly one club — so it names the player's club outright. The
 * name pill is proportional type with diacritics and abbreviations, which OCR
 * gets approximately right; it is a fuzzy match, not a lookup.
 *
 * So: let the fixture pick the club, then match the name inside it. That turns
 * a 1-in-560 problem into a 1-in-10 one, and a name read as "Gueéhi" or "Jodo
 * Pedro" still lands on the right man.
 */
import type { FixtureEaseRow, RatingRow } from './types'

export type Pos = 'GKP' | 'DEF' | 'MID' | 'FWD'

export interface Candidate {
  player: RatingRow
  distance: number
}

export interface SlotMatch {
  /** Index into the reader's card list. */
  index: number
  row: number
  /** Position implied by the pitch row, where the row implies one. */
  pos: Pos | null
  /** Club implied by the fixture pill. */
  club: string | null
  read: string
  fixture: string
  player: RatingRow | null
  distance: number
  /** Which ring the match came from — how much to trust it. */
  how: 'club+pos' | 'club' | 'name' | null
  /** Nearest few players, for the correction picker. */
  alternatives: RatingRow[]
}

/** Fold accents and punctuation away: the OCR drops diacritics and the app
 *  abbreviates, so comparing anything but bare letters just adds noise. */
export function normName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '')
}

export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (!m) return n
  if (!n) return m
  let prev = new Array<number>(n + 1)
  let cur = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    const t = prev
    prev = cur
    cur = t
  }
  return prev[n]
}

/** Opponent+venue -> the club it can only be, for one gameweek. */
export function clubByFixture(fixtureEase: FixtureEaseRow[], gw: number): Map<string, string> {
  const m = new Map<string, string>()
  const dupes = new Set<string>()
  for (const f of fixtureEase) {
    if (Number(f.gw) !== gw) continue
    const k = `${f.opponent}|${f.venue}`
    if (m.has(k) && m.get(k) !== f.team) dupes.add(k)
    m.set(k, String(f.team))
  }
  // A double gameweek can put two clubs behind one pair. Rather than pick one,
  // drop the key — the matcher then falls through to a name-only search, which
  // is honest about knowing less.
  for (const k of dupes) m.delete(k)
  return m
}

/**
 * The pitch rows, in the order the FPL app draws them: keeper, defenders,
 * midfielders, forwards, then the bench. The bench's first man is the reserve
 * keeper; the other three are in the manager's own order, so their position is
 * not implied and the matcher searches the whole club.
 */
export function posForRow(row: number, rowCount: number, col: number): Pos | null {
  if (rowCount < 5) return null
  const bench = rowCount - 1
  if (row === bench) return col === 0 ? 'GKP' : null
  return (['GKP', 'DEF', 'MID', 'FWD'] as Pos[])[row] ?? null
}

interface ReadCard {
  row: number
  col: number
  name: string
  fixture: string
  opponent: string | null
  venue: string | null
}

/**
 * Three widening rings, taken in order, stopped at the first confident hit.
 *
 * Club-and-position is the tight one. Club-only covers a bench slot whose
 * position the pitch does not imply. Name-only covers a player the daily feed
 * still has at his old club — an in-window transfer we haven't caught, where
 * the reader's screenshot knows more than we do; it is held to a stricter
 * distance because it searches a pool fifty times the size.
 */
export function matchSquad(
  cards: ReadCard[],
  rowCount: number,
  pool: RatingRow[],
  fixtureEase: FixtureEaseRow[],
  gw: number,
): SlotMatch[] {
  /* Which gameweek's fixtures the screenshot is showing.
   *
   * The builder is anchored to the next gameweek to be played, but the app on
   * someone's phone is not: screenshot it after a deadline and every card
   * names the fixture being played right now, not the one we are picking for.
   * Read the wrong week and no club resolves at all, which quietly costs the
   * matcher its best clue. So try the week either side and keep whichever
   * accounts for the most cards — an unambiguous test, since a wrong week
   * matches almost nothing. */
  const pairs = cards.filter((c) => c.opponent && c.venue).map((c) => `${c.opponent}|${c.venue}`)
  let byFixture = clubByFixture(fixtureEase, gw)
  let hits = pairs.filter((k) => byFixture.has(k)).length
  for (const alt of [gw - 1, gw + 1, gw + 2]) {
    if (alt < 1 || hits >= pairs.length) break
    const m = clubByFixture(fixtureEase, alt)
    const n = pairs.filter((k) => m.has(k)).length
    if (n > hits) { byFixture = m; hits = n }
  }
  const normed = pool.map((p) => ({ p, n: normName(String(p.web_name)) }))

  return cards.map((card, index) => {
    const pos = posForRow(card.row, rowCount, card.col)
    const club = card.opponent && card.venue ? (byFixture.get(`${card.opponent}|${card.venue}`) ?? null) : null
    const target = normName(card.name)

    const rank = (subset: typeof normed) => {
      const scored = subset.map((x) => ({ player: x.p, distance: levenshtein(target, x.n) }))
      scored.sort((a, b) => a.distance - b.distance)
      return scored
    }
    const inClub = club ? normed.filter((x) => String(x.p.team) === club) : []
    const rings: { list: Candidate[]; max: number; how: SlotMatch['how'] }[] = [
      { list: rank(pos ? inClub.filter((x) => x.p.position === pos) : inClub), max: 2, how: 'club+pos' },
      { list: rank(inClub), max: 2, how: 'club' },
      { list: rank(pos ? normed.filter((x) => x.p.position === pos) : normed), max: 1, how: 'name' },
    ]

    let hit: { player: RatingRow; distance: number; how: SlotMatch['how'] } | null = null
    for (const r of rings) {
      const top = r.list[0]
      // An empty read matches nothing: distance then just measures name length
      // and the shortest name in the pool "wins".
      if (!target || !top || top.distance > r.max) continue
      hit = { player: top.player, distance: top.distance, how: r.how }
      break
    }

    /* What the picker offers if the match is wrong. The club's players come
     * first and in full — that is nearly always where the right man is, and a
     * reader correcting a mistake wants to see the squad, not a ranking — with
     * the closest names from everywhere else behind them. */
    const seen = new Set<number>()
    const alternatives: RatingRow[] = []
    for (const c of [...rings[1].list, ...rings[2].list]) {
      if (seen.has(Number(c.player.element))) continue
      seen.add(Number(c.player.element))
      alternatives.push(c.player)
      if (alternatives.length >= 40) break
    }

    return {
      index,
      row: card.row,
      pos,
      club,
      read: card.name,
      fixture: card.fixture,
      player: hit?.player ?? null,
      distance: hit?.distance ?? -1,
      how: hit?.how ?? null,
      alternatives,
    }
  })
}

/** Squad-legality read on a set of picks, in the language the builder uses. */
export function squadProblems(players: (RatingRow | null)[], budget = 100): string[] {
  const chosen = players.filter(Boolean) as RatingRow[]
  const out: string[] = []
  const need: Record<Pos, number> = { GKP: 2, DEF: 5, MID: 5, FWD: 3 }
  const have: Record<Pos, number> = { GKP: 0, DEF: 0, MID: 0, FWD: 0 }
  for (const p of chosen) {
    const k = p.position as Pos
    if (k in have) have[k]++
  }
  for (const k of Object.keys(need) as Pos[]) {
    if (have[k] !== need[k]) out.push(`${have[k]} ${k} — should be ${need[k]}`)
  }
  const byClub = new Map<string, number>()
  for (const p of chosen) byClub.set(String(p.team), (byClub.get(String(p.team)) ?? 0) + 1)
  for (const [t, n] of byClub) if (n > 3) out.push(`${n} from ${t} — the limit is 3`)
  const spend = chosen.reduce((s, p) => s + (Number(p.price) || 0), 0)
  if (spend > budget + 1e-9) out.push(`£${spend.toFixed(1)}m — over the £${budget.toFixed(0)}m budget`)
  const dup = new Set<number>()
  const once = new Set<number>()
  for (const p of chosen) {
    const el = Number(p.element)
    if (once.has(el)) dup.add(el)
    once.add(el)
  }
  if (dup.size) out.push(`${dup.size} player${dup.size > 1 ? 's' : ''} picked twice`)
  return out
}
