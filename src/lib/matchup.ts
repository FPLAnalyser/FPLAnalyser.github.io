/**
 * Where a defence gives up its chances, and whose shot profile lands there.
 *
 * This lived inside the Fixtures page, computed for one opponent at a time.
 * The GW Preview wants the same thing for a whole round, and the last thing
 * this codebase needs is a second copy of shot-channel logic — the left/right
 * labels were wrong on every zone for months precisely because `toPitch`
 * existed twice with the lateral axis pointing opposite ways. One module.
 *
 * The measurement is deliberately modest. Across a full gameweek the fit
 * spread is about −9% to +15%, which is a tie-breaker between two players you
 * already fancy rather than a reason to captain somebody, and any surface
 * showing it should say so.
 */
import { classifyZone, toPitch } from './shotzones'
import type { Row, RatingRow } from './types'

export type Cat = 'left' | 'centre' | 'right' | 'setpiece'
export type CatOrHead = Cat | 'header'

export const CAT_LABEL: Record<Cat, string> = {
  left: 'the attacking left',
  centre: 'central areas',
  right: 'the attacking right',
  setpiece: 'set pieces',
}

/* The same channel said two ways, because one phrase cannot serve both halves
   of the sentence: a defence gives up chances *down* a flank, a player takes
   his *from* one. */
export const CONCEDE_AT: Record<CatOrHead, string> = {
  left: 'down the attacking left',
  centre: 'through the middle',
  right: 'down the attacking right',
  setpiece: 'from set pieces',
  header: 'to headers',
}
export const TAKES_AT: Record<CatOrHead, string> = {
  left: 'from the left',
  centre: 'from central positions',
  right: 'from the right',
  setpiece: 'from set pieces',
  header: 'with his head',
}

export function channelOf(zone: string): Exclude<Cat, 'setpiece'> {
  if (/-(wl|el)/.test(zone) || /-l($|-)/.test(zone)) return 'left'
  if (/-(wr|er)/.test(zone) || /-r($|-)/.test(zone)) return 'right'
  return 'centre'
}
export const isSetPiece = (sit: unknown) => sit === 'SetPiece' || sit === 'FromCorner' || sit === 'DirectFreekick'

export interface Profile { shares: Record<Cat, number>; headShare: number | null; totalXg: number }

/** xG-weighted share of each category for a list of shots (penalties excluded). */
export function profileOf(shots: Row[], withHead: boolean): Profile {
  const acc: Record<Cat, number> = { left: 0, centre: 0, right: 0, setpiece: 0 }
  let total = 0
  let headXg = 0
  for (const s of shots) {
    if (s.situation === 'Penalty') continue
    const xg = Number(s.xg) || 0
    if (!xg) continue
    total += xg
    if (isSetPiece(s.situation)) acc.setpiece += xg
    // Both player shots and shots-conceded are recorded in the attacking
    // team's frame — no mirroring, so channel labels line up on both sides.
    const { cx, cy } = toPitch(s.x as number, s.y as number)
    acc[channelOf(classifyZone(cx, cy))] += xg
    if (withHead && s.shot_type === 'Head') headXg += xg
  }
  const shares = Object.fromEntries(
    (Object.keys(acc) as Cat[]).map((k) => [k, total > 0 ? acc[k] / total : 0]),
  ) as Record<Cat, number>
  return { shares, headShare: withHead && total > 0 ? headXg / total : null, totalXg: total }
}

/** A shot sample too thin to profile says nothing; it just makes noise look
 *  like a signal. Twenty is the bar everywhere this is used. */
export const MIN_SHOTS = 20

/** The relative-to-league excess a category needs before it is worth a
 *  sentence. Below this the "weakness" is a couple of shots. */
export const WORTH_SAYING = 0.08

/** And the whole-profile fit a FIXTURE needs before its card earns a line.
 *
 *  The category bar alone is too easy to clear: measured across GW1, eight of
 *  the ten fixtures produced a qualifying sentence, including one at an
 *  overall fit of 1.1% — a real edge in one category cancelled by the rest.
 *  A line on eight cards in ten is furniture, not a finding. At 8% it is
 *  five, and the two ends of the round look different from each other:
 *
 *      14.3%  Igor Jesus v Leeds        1.1%  Tchaouna v Arsenal
 *      14.2%  Mitoma v Villa            3.9%  Wirtz v Newcastle
 *
 *  The ranked shortlist keeps the lower bar — it is a list of the best few in
 *  the round, so being eighth-best is information; being the eighth-best line
 *  on a fixture card is not. */
export const CARD_UPLIFT = 0.08

export interface Edge {
  player: RatingRow
  /** Opponent this is measured against. */
  opp: string
  /** Weighted sum of (his share × the opponent's relative excess), −1…1-ish. */
  uplift: number
  /** His season non-penalty xG — the volume the fit is applied to. */
  xg: number
  /** The single category doing most of the work, when one clears the bar. */
  best: { cat: CatOrHead; pShare: number; oShare: number; lShare: number; rel: number } | null
  /** Ranking key: fit is worth nothing on a player who barely shoots. */
  score: number
}

/** Score one player against one defence. Null when either side is too thin. */
export function edgeFor(
  player: RatingRow,
  playerShots: Row[] | undefined,
  oppProfile: Profile | undefined,
  league: Profile,
  opp: string,
  /* His headed share of shots, which has to be passed in: `player_shots.json`
     carries no body-part field, so `profileOf` reads 0 headers off it every
     time and the whole header route disappears without a word. It comes from
     the scouting table (`headed_shots_per90 / shots_per90`). Team profiles are
     built from `shots_conceded.json`, which does carry `shot_type`, so only
     the player side needs this. */
  playerHeadShare?: number | null,
): Edge | null {
  if (!playerShots || playerShots.length < MIN_SHOTS) return null
  if (!oppProfile || oppProfile.totalXg <= 0 || league.totalXg <= 0) return null
  const p = profileOf(playerShots, true)
  if (p.totalXg <= 0) return null

  const cats: { cat: CatOrHead; pShare: number; oShare: number; lShare: number }[] = (
    Object.keys(CAT_LABEL) as Cat[]
  ).map((c) => ({ cat: c, pShare: p.shares[c], oShare: oppProfile.shares[c], lShare: league.shares[c] }))
  const pHead = playerHeadShare ?? p.headShare
  if (pHead != null && oppProfile.headShare != null && league.headShare) {
    cats.push({ cat: 'header', pShare: pHead, oShare: oppProfile.headShare, lShare: league.headShare })
  }

  let uplift = 0
  let best: Edge['best'] = null
  for (const c of cats) {
    const rel = (c.oShare - c.lShare) / Math.max(c.lShare, 0.02)
    uplift += c.pShare * rel
    // A category only speaks for a player if he actually uses it.
    if (c.pShare >= 0.15 && (!best || c.pShare * rel > best.pShare * best.rel)) best = { ...c, rel }
  }
  return { player, opp, uplift, xg: p.totalXg, best, score: uplift * Math.sqrt(p.totalXg) }
}

/** One sentence, both subjects named, player first.
 *
 *  Returns null when nothing about the matchup clears the bar — which is most
 *  fixtures, and saying nothing is the right answer there. */
export function edgeSentence(e: Edge, oppLabel: string, withName = true): string | null {
  if (!e.best || e.best.rel <= WORTH_SAYING) return null
  const pc = (v: number) => `${(v * 100).toFixed(0)}%`
  // The explorer already has his name as the row heading; a fixture card does
  // not, so the subject is optional rather than always repeated.
  const takes = withName ? `${String(e.player.web_name)} takes` : 'Takes'
  return `${takes} ${pc(e.best.pShare)} of his chances ${TAKES_AT[e.best.cat]} — and ${oppLabel} give up ${pc(e.best.oShare)} of their xG ${CONCEDE_AT[e.best.cat]}, against ${pc(e.best.lShare)} league-wide.`
}
