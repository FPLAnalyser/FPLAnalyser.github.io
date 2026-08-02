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
  /** The armband the picture put on this card, if any. */
  armband: 'C' | 'V' | null
  player: RatingRow | null
  distance: number
  /** Which ring the match came from — how much to trust it. */
  how: 'club+pos' | 'club' | 'name' | null
  /** No other player in the pool came close, so a fuzzy read is still safe. */
  clear: boolean
  /** The app cut the name short, so the read is a prefix by design. */
  truncated: boolean
  /** Nearest few players, for the correction picker. */
  alternatives: RatingRow[]
}

/* Letters NFKD leaves alone.
 *
 * Decomposition splits é into e + a combining accent, which the next line
 * strips — but ß, ø, đ, ł and the ligatures are single code points with no
 * decomposition, so `[^a-z]` simply deleted them. Groß normalised to "gro",
 * three letters against an OCR read of five, and a correct match came back
 * two edits out and wearing a warning. These are the expansions a reader
 * would write by hand. */
const FOLD: Record<string, string> = {
  ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', å: 'a', đ: 'd', ð: 'd', þ: 'th',
  ł: 'l', ħ: 'h', ı: 'i', ŋ: 'n', ʼ: '', ß̩: 'ss',
}

/** Fold accents and punctuation away: the OCR drops diacritics and the app
 *  abbreviates, so comparing anything but bare letters just adds noise. */
export function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ßæœøåđðþłħıŋʼ]/g, (c) => FOLD[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '')
}

/* One glyph that we expand into two letters, and the bill for it.
 *
 * ß, æ, œ and þ are single characters the English model has no shape for, so
 * it draws one approximate shape and moves on. Folding them to "ss", "ae",
 * "oe", "th" is right for a reader but wrong for a comparison: it charges the
 * recogniser for a letter it was never shown. Groß folds to "gross", five
 * letters against a four-letter read, and both goes at this have now been the
 * same bug — "Grofl" the first time, "Grol" the second. Enumerating what ß
 * looks like when it comes back wrong is a losing game; between them it has
 * come back as fl, fi, l, b, B, p, k and 13.
 *
 * So don't. Put a wildcard where the glyph was and charge nothing for whatever
 * one character the model drew there. Three names in the whole pool carry one
 * of these letters and exactly one carries ß, so this widens almost nothing:
 * no other name in the game even begins "gro". */
const WIDE_FOLD = /[ßæœþ]/
export const WILD = '\u0001'

/** The candidate's name with each two-letter fold replaced by a wildcard, or
 *  null when the name has none — which is nearly all of them. */
export function wildName(s: string): string | null {
  const low = s.toLowerCase()
  if (!WIDE_FOLD.test(low)) return null
  return low
    .replace(/[ßæœþ]/g, WILD)
    .replace(/[øåđðłħıŋʼ]/g, (c) => FOLD[c] ?? c)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(new RegExp('[^a-z' + WILD + ']', 'g'), '')
}

/* Letter pairs the recogniser reliably confuses, and what they were.
 *
 * The English model has no ß in its character set, so it draws Groß's as the
 * nearest shapes it does have and returns "Grofl" — two edits from "Gross",
 * which is inside the threshold but close enough to a second Brighton
 * midfielder to be worth a warning nobody wants to read. `rn` for `m` is the
 * oldest confusion in OCR and costs nothing to carry.
 *
 * These are applied as *alternative readings*, never as a rewrite: the read is
 * scored against the original spelling and each variant, and the best wins. So
 * a genuine "Fletcher" still scores zero against itself and only gains the
 * chance to also match a name spelt "Sstcher", of which there are none. */
const CONFUSIONS: [RegExp, string][] = [[/fl/g, 'ss'], [/fi/g, 'ss'], [/rn/g, 'm']]

/** The read, plus every single-confusion rewrite of it. */
export function readings(target: string): string[] {
  const out = [target]
  for (const [re, to] of CONFUSIONS) {
    const v = target.replace(re, to)
    if (v !== target && !out.includes(v)) out.push(v)
  }
  return out
}

/** Did the app cut this name short? The pitch pill has a fixed width and the
 *  FPL app ellipsises anything longer — "Dewsbur…", "B.Fernand…" — so the read
 *  is a prefix, not a misreading, and has to be matched as one. Two dots or
 *  more: one trailing dot is an abbreviation ("Bruno G."), not a truncation. */
export function looksTruncated(read: string): boolean {
  return /(\.\s*){2,}$|…\s*$/.test(read.trim())
}

/** Edit distance. A WILD in `b` matches any single character for free — see
 *  `wildName` for why the candidate side is where that belongs. */
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
      const same = a[i - 1] === b[j - 1] || b[j - 1] === WILD
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (same ? 0 : 1))
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
  armband?: 'C' | 'V' | null
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
  const normed = pool.map((p) => ({ p, n: normName(String(p.web_name)), w: wildName(String(p.web_name)) }))

  return cards.map((card, index) => {
    const pos = posForRow(card.row, rowCount, card.col)
    const club = card.opponent && card.venue ? (byFixture.get(`${card.opponent}|${card.venue}`) ?? null) : null
    const target = normName(card.name)
    const cut = looksTruncated(card.name) && target.length >= 5

    /* Distance from the read to one player's name.
     *
     * Two ways to be close and they are not interchangeable. A misreading
     * differs all the way along — "Grofl" for "Groß". A truncation agrees
     * perfectly and then stops — "Dewsbur" for "Dewsbury-Hall" — and full-
     * string distance charges it five edits for the letters the app chose not
     * to draw, which put a correct match out of reach of any sane threshold.
     * So also score against the candidate's opening letters, and take the
     * better of the two. The +1 when the app did not mark the name as cut
     * keeps a genuine full-string match ahead of a prefix that merely starts
     * the same way; when it did mark it, the prefix reading is simply right. */
    const forms = readings(target)
    const one = (t: string, cand: string) => {
      const full = levenshtein(t, cand)
      if (cand.length <= t.length) return full
      const pref = levenshtein(t, cand.slice(0, t.length))
      return cut ? pref : Math.min(full, pref + 1)
    }
    const score = (cand: string) => Math.min(...forms.map((t) => one(t, cand)))
    /* The wildcard form only ever helps, never hurts: it is the same name with
     * one glyph excused, so its distance is at most the folded form's. */
    const best = (x: { n: string; w: string | null }) =>
      x.w ? Math.min(score(x.n), score(x.w)) : score(x.n)

    const rank = (subset: typeof normed) => {
      const scored = subset.map((x) => ({ player: x.p, distance: best(x) }))
      scored.sort((a, b) => a.distance - b.distance)
      return scored
    }
    const inClub = club ? normed.filter((x) => String(x.p.team) === club) : []
    const rings: { list: Candidate[]; max: number; how: SlotMatch['how'] }[] = [
      { list: rank(pos ? inClub.filter((x) => x.p.position === pos) : inClub), max: 2, how: 'club+pos' },
      { list: rank(inClub), max: 2, how: 'club' },
      { list: rank(pos ? normed.filter((x) => x.p.position === pos) : normed), max: 1, how: 'name' },
    ]

    let hit: { player: RatingRow; distance: number; how: SlotMatch['how']; clear: boolean } | null = null
    for (const r of rings) {
      const top = r.list[0]
      /* An empty read matches nothing: distance then just measures name length
       * and the shortest name in the pool "wins". A very short one is barely
       * better — two letters sat two edits from a real player and would have
       * been applied. Below five letters the allowance shrinks with the read,
       * and below three there is nothing to go on at all. */
      const max = target.length < 3 ? -1 : Math.min(r.max, target.length - 3)
      if (!target || !top || top.distance > max) continue
      /* How alone the winner is, which is a better confidence signal than its
       * own distance. Two edits out of a ten-man pool where the runner-up is
       * six edits away is not a doubtful match — it is the only candidate, and
       * warning about it trains readers to ignore the warnings. Two edits with
       * a runner-up at three is a genuine coin-toss and must be flagged. */
      const runnerUp = r.list.find((c) => c.player.element !== top.player.element)
      hit = {
        player: top.player,
        distance: top.distance,
        how: r.how,
        clear: !runnerUp || runnerUp.distance - top.distance >= 3,
      }
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
      armband: card.armband ?? null,
      player: hit?.player ?? null,
      distance: hit?.distance ?? -1,
      how: hit?.how ?? null,
      clear: hit?.clear ?? false,
      truncated: cut,
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
