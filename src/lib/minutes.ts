/* ════════════════════════════════════════════════════════════════════════
   Who actually starts, this season.

   THE BUG THIS FIXES. `p60` is the share of games a player STARTED FOR
   WHOEVER HE PLAYED FOR LAST SEASON. It is a per-player number with nothing
   tying it to the club he is at now, so summed across a squad it describes a
   team that cannot exist. Measured on this data:

     TOT GKP  1.90 implied starters across 3 rated keepers, 1 shirt
     TOT DEF  5.63 across 9 players, 4 shirts
     BRE MID  5.16 across 8 players, 4 shirts

   Spurs' three keepers are Kinsky 0.18, Vicario 0.82 and Dubravka 0.90 —
   earned at three different clubs. Those numbers were never comparable and
   adding them was never going to give one.

   It runs the other way too, and that is the half a reader notices: league
   wide the implied starters come to 94% of the keepers a club fields, 87% of
   the defenders, 83% of the midfielders and 78% of the forwards. Every
   position is under-allocated, so every projection built on it is short.

   MINUTES ARE ZERO-SUM. A club fields one keeper and about four defenders
   whoever is fit, so the fix is to allocate the shirts rather than to read
   each player's history in isolation. The counts come from the pipeline,
   measured off last season rather than assumed — assuming is how the first
   draft of this had forwards on two shirts when the real figure is 1.02,
   FPL's forward class being narrow enough that most attackers are midfielders.

   WHAT IT RUNS ON, all of it published daily and none of it needing a game to
   be played:

     · status and chance — an injured player takes no shirt, and the ones he
       would have taken go to whoever is fit. Timber and Saliba are both out
       at Arsenal as this is written; those minutes currently go nowhere.
     · price — FPL's own valuation of a role, set before a ball is kicked
     · ownership — several million managers forecasting who starts
     · last season's start rate, as a PRIOR and nothing more

   WHAT IS A JUDGEMENT HERE, stated plainly: the weight between the historical
   share and the market one. Everything else is arithmetic on published data,
   but that blend is chosen, not measured — there is no way to backtest it
   without last season's opening prices, which we do not hold. It is set even
   at 0.5 for that reason: neither source is trusted over the other.
   ════════════════════════════════════════════════════════════════════════ */

export interface MinuteShare {
  /** Share of his club's games he is expected to START (60+ minutes). */
  p60: number
  /** Share he is expected to APPEAR in at all. Never below p60. */
  ppl: number
}

export interface Shirts { start: number; used: number }

/** A projected lineup: each role slot, and who is expected to fill it.
 *  `share` sums to one within a slot. Keyed by club short name. */
export interface DepthCharts {
  captured?: string | null
  teams: Record<string, { formation?: string; slots: Record<string, { code: number; share: number }[]> }>
}

/** A player as this needs him: enough to place him in his club's pecking
 *  order, and nothing that requires a game to have been played. */
export interface SquadSeat {
  code: number
  team: number | string
  pos: string
  price?: number
  own?: number
  /** 0 when ruled out, 1 when fit, in between for a doubt. */
  fitness: number
  /** Last season's start and appearance share, where there is a record. */
  p60?: number
  ppl?: number
  /** True when that record was earned AT THIS CLUB. A start rate from
   *  somewhere else is evidence about the player, not about where he sits in
   *  this squad — Dubravka started 90% of Burnley's games and that told us
   *  nothing about who keeps goal for Spurs. */
  sameClub?: boolean
}

/** Nobody starts every single game — European nights, cups, knocks, a booking
 *  away from a ban. The cap keeps a nailed-on first choice honest and the
 *  overflow goes back to the rest of his position. */
const CAP = 0.94
/** What a player with no record at all is assumed to be worth before the
 *  market signal is applied: replacement level, not zero, because a squad
 *  player still takes some minutes. */
const NO_RECORD = 0.25
/** History against market. A judgement — see the header. */
const HIST_WEIGHT = 0.5
/** Ownership percentage points added to everyone before the market weight is
 *  taken, so a player nobody owns is still placed by his price instead of
 *  collapsing to nothing. Two points is about the level below which ownership
 *  stops carrying information. */
const OWN_FLOOR = 2
/** Where a fit player the depth chart never mentions ranks, as a fraction of
 *  the last man it does. Half of the smallest listed share — behind everyone
 *  named, ahead of nobody, and never zero. */
const UNLISTED = 0.5

/**
 * How much of a shirt a player can take, from his status alone.
 *
 * Deliberately NOT availabilityFactor, which resolves a return date against a
 * specific fixture's kickoff — that needs the Availability object this is
 * being called while building, and a gameweek the depth chart does not have.
 * The pecking order is a squad-level question: is he in contention at all.
 * Per-fixture availability is applied separately and on top, so a player back
 * in three weeks still loses those individual games.
 */
export function seatFitness(p: { status?: string; chance?: number }): number {
  if (!p || p.status === 'a') return 1
  if (p.status === 'd') return (p.chance ?? 75) / 100
  if (p.chance != null) return p.chance / 100
  return 0
}

const share = (xs: number[]): number[] => {
  const t = xs.reduce((a, b) => a + b, 0)
  return t > 0 ? xs.map((x) => x / t) : xs.map(() => (xs.length ? 1 / xs.length : 0))
}

/** The pecking order for one club-position, before the shirts are counted.
 *
 *  Two opinions, each normalised to sum to one so neither can dominate by
 *  being on a bigger scale. The historical one is what he did last season,
 *  wherever that was; the market one is price times ownership, FPL pricing a
 *  role before a ball is kicked and several million managers forecasting the
 *  same. Ownership enters PROPORTIONALLY, plus a floor: written as
 *  `1 + own/100` it turned Kinsky's 19.8% against Vicario's 1.4% — a
 *  fourteen-to-one statement about who keeps goal for Spurs — into a ratio of
 *  1.18 to 1, which is not using the signal so much as acknowledging it. The
 *  floor keeps an unowned squad player ranked by his price rather than zeroed.
 *
 *  A history from ANOTHER club is discarded rather than discounted: it is not
 *  weak evidence about this pecking order, it is evidence about a different
 *  one. Dubravka started 90% of Burnley's games and that told us nothing about
 *  who keeps goal for Spurs. */
function rawWeights(g: SquadSeat[]): number[] {
  const hist = share(g.map((s) => (s.p60 != null && s.p60 > 0 && s.sameClub !== false ? s.p60 : NO_RECORD)))
  const mkt = share(g.map((s) => Math.max(0.1, s.price ?? 4.5) * ((s.own ?? 0) + OWN_FLOOR)))
  return g.map((s, i) => (HIST_WEIGHT * hist[i] + (1 - HIST_WEIGHT) * mkt[i]) * s.fitness)
}

const sharpen = (xs: number[], g: number): number[] => (g === 1 ? xs : xs.map((x) => x ** g))

/**
 * How sharp a pecking order should be, solved rather than chosen.
 *
 * A blend of two sources that disagree comes out flatter than either of them.
 * Measured against last season that is harmless where a club fields ten of a
 * position and wrong where it fields one: a first-choice keeper really takes
 * 85% of his club's keeper starts and the flat blend gave him 65%, which put
 * Alisson on half a shirt behind five squad keepers.
 *
 * So each position's weights are raised to a power, and the power is solved so
 * that the LEAGUE-WIDE mean top-man share matches what last season actually
 * did — `conc`, measured in the pipeline. League-wide and not per club, which
 * is the part that matters: forcing every club's top keeper to 85% would erase
 * the real three-way at Spurs, where the market and the history genuinely
 * disagree about who plays. Sharpening the whole position instead leaves the
 * contested clubs contested and the settled ones settled.
 *
 * Where the allocation is already right the solve returns 1 and nothing moves,
 * which is why DEF and MID need no special case — they came out at 0.22 and
 * 0.19 against a real 0.23 and 0.20.
 */
function solveGamma(groups: Map<string, SquadSeat[]>, conc?: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {}
  if (!conc) return out
  const byPos = new Map<string, number[][]>()
  for (const [k, g] of groups) {
    if (g.length < 2) continue
    const pos = k.split('|')[1]
    const w = rawWeights(g)
    if (w.reduce((a, b) => a + b, 0) <= 0) continue
    byPos.set(pos, [...(byPos.get(pos) ?? []), w])
  }
  for (const [pos, ws] of byPos) {
    const target = conc[pos]
    if (!(target > 0 && target < 1)) continue
    const topAt = (gm: number) =>
      ws.reduce((acc, w) => acc + Math.max(...share(sharpen(w, gm))), 0) / ws.length
    if (topAt(1) >= target) { out[pos] = 1; continue }
    /* Bisect. Monotone in gamma — sharpening can only raise the top share —
       so twenty halvings of [1, 8] land well inside the rounding. */
    let lo = 1
    let hi = 8
    for (let i = 0; i < 20; i++) {
      const mid = (lo + hi) / 2
      if (topAt(mid) < target) lo = mid
      else hi = mid
    }
    out[pos] = (lo + hi) / 2
  }
  return out
}

/**
 * The pecking order from a projected lineup, where there is one.
 *
 * WHAT THE CHART ADDS AND WHAT IT MUST NOT TOUCH. FPL publishes one position
 * per player — DEF — so everything below pooled all seven Arsenal defenders
 * against 4.04 shirts, and Timber being ruled out spread his minutes across
 * centre backs. The chart knows he is the right back. So the chart supplies the
 * ORDERING and the role structure, and the measured shirt counts still set the
 * TOTALS: each slot is allocated as one unit, a player's units are summed
 * across the slots he appears in, and the result is then rescaled so his FPL
 * position still adds up to the shirts that position was measured to field.
 *
 * That split matters. Eleven slots against 10.42 measured starts would inflate
 * every projection by 5.6% if the slots were taken as shirts — a start being a
 * 60-minute appearance, and a man subbed at 55 not being one. Taking only the
 * ordering from the chart leaves the zero-sum property this whole file rests on
 * exactly where it was.
 *
 * FITNESS APPLIES INSIDE THE SLOT, which is the entire point: Timber's 86% of
 * Arsenal's right back goes to White and Mosquera in the ratio the chart gives
 * them, rather than leaking into the centre of defence.
 *
 * A player the chart does not mention gets nothing. That is the forecast
 * speaking — it is a claim that he will not play — and it is why this returns
 * null rather than a partial answer for a club with no chart at all.
 */
function chartWeights(
  seats: SquadSeat[],
  club: string | undefined,
  charts: DepthCharts | undefined,
): Map<number, number> | null {
  const slots = club ? charts?.teams?.[club]?.slots : undefined
  if (!slots) return null
  const fit = new Map<number, number>(seats.map((s) => [s.code, s.fitness]))
  const out = new Map<number, number>()
  let placed = 0
  for (const rows of Object.values(slots)) {
    const live = rows.filter((r) => fit.has(r.code))
    const w = live.map((r) => r.share * (fit.get(r.code) ?? 0))
    const total = w.reduce((a, b) => a + b, 0)
    if (total <= 1e-9) continue
    live.forEach((r, i) => {
      out.set(r.code, (out.get(r.code) ?? 0) + w[i] / total)
      placed++
    })
  }
  return placed ? out : null
}

/**
 * Distribute each club's shirts across its squad, position by position.
 *
 * Returns nothing for a group it cannot place — fewer than two players, or no
 * shirt count for the position — so a caller always falls back to the
 * player's own history rather than to a guess.
 */
export function minuteShares(
  seats: SquadSeat[],
  shirts: Record<string, Shirts>,
  conc?: Record<string, number>,
  charts?: DepthCharts,
  clubOf?: (team: number | string) => string | undefined,
): Map<number, MinuteShare> {
  const out = new Map<number, MinuteShare>()
  const groups = new Map<string, SquadSeat[]>()
  const byClub = new Map<string, SquadSeat[]>()
  for (const s of seats) {
    if (s.code == null || s.team == null || !s.pos) continue
    const k = `${s.team}|${s.pos}`
    const g = groups.get(k)
    if (g) g.push(s)
    else groups.set(k, [s])
    const t = String(s.team)
    byClub.set(t, [...(byClub.get(t) ?? []), s])
  }

  /* One chart lookup per club rather than per position group, because a slot
     crosses FPL positions — Palace's wing backs are DEF and their wide
     midfielders are MID, and both come out of the same eleven. */
  const chartOf = new Map<string, Map<number, number> | null>()
  for (const [t, g] of byClub) chartOf.set(t, chartWeights(g, clubOf?.(t), charts))

  const gamma = solveGamma(groups, conc)

  for (const [k, g] of groups) {
    const pos = k.split('|')[1]
    const sh = shirts[pos]
    if (!sh || g.length < 2) continue

    /* THE CHART WHERE THERE IS ONE, the blend where there is not.
       A projected lineup is a direct statement of the thing the blend is
       trying to infer, so it replaces the blend rather than joining it — and
       it is NOT sharpened, because its own concentration is already real
       (Raya 100%, Gabriel 97%) and gamma would push a genuine three-way into
       a false certainty. Shared out within the position exactly as the blend
       would be, so the shirts still add up to what was measured. */
    const chart = chartOf.get(String(g[0].team))
    const cw = chart ? g.map((s) => chart.get(s.code) ?? 0) : null
    /* A FIT PLAYER THE CHART OMITS IS UNLIKELY, NOT IMPOSSIBLE.
       Left at zero this projected Pope, Vicario, Romero, Rashford, Grealish
       and Elliott at exactly nothing — every one of them fit, available and
       pickable — on the strength of one forecaster leaving them out of a
       graphic. "Not in the projected eleven" is a strong opinion about a
       squad; "will not play a minute all season" is a different claim and not
       one this file is entitled to make.
       So an omitted player sits BELOW the last man listed in his position
       rather than off the end of it. A ruled-out player still gets nothing,
       because fitness multiplies through — the distinction being that we know
       he cannot play, where here we only think he will not. */
    if (cw) {
      const listed = cw.filter((x) => x > 1e-9)
      if (listed.length) {
        const floor = Math.min(...listed) * UNLISTED
        for (let i = 0; i < cw.length; i++) if (cw[i] <= 1e-9) cw[i] = floor * g[i].fitness
      }
    }
    /* Sum of zero means the chart has an eleven for this club but nobody in
       THIS position — every forward unlisted, or the whole group ruled out.
       `share` would answer that with a flat 1/n, which is a guess dressed as
       an allocation, so fall through to the blend instead. */
    const w = cw && cw.reduce((a, b) => a + b, 0) > 1e-9
      ? share(cw)
      : share(sharpen(rawWeights(g), gamma[pos] ?? 1))

    /* Scale to the shirts, then push whatever the cap rejects back into the
       rest of the group and settle.
       THE SPILL FOLLOWS THE PECKING ORDER, NOT THE HEADROOM. This shared the
       overflow in proportion to `CAP - v` — how much room a player had left —
       which is very nearly the opposite of the right answer, because the man
       with the most room is by definition the one the group ranks lowest. Two
       consequences, both measured on Arsenal's defence:

         · A RULED-OUT PLAYER ABSORBED THE MOST. Timber and Saliba are both
           out, `fitness` 0, weight 0 — and they held 0.24 of a shirt each,
           because zero weight means maximum headroom. Twelve per cent of
           Arsenal's back four was allocated to two men who cannot play, and
           every fit defender was short by his share of it.
         · IT INVERTED THE ORDER AMONG THE FIT. White at 0.43 had more room
           than Mosquera at 0.64, so White drew more of the spill than the
           player the blend ranks above him.

       Sharing it by `w` fixes both at once: a ruled-out player has weight
       zero and takes none of it, and the fit players take it in the order
       they were ranked. Players already at the cap are excluded so the spill
       does not immediately re-spill, and the loop settles what is left. */
    let starts = w.map((x) => x * sh.start)
    for (let pass = 0; pass < 6; pass++) {
      let spill = 0
      starts = starts.map((v) => {
        if (v > CAP) { spill += v - CAP; return CAP }
        return v
      })
      if (spill <= 1e-9) break
      const take = starts.map((v, i) => (v < CAP - 1e-9 ? w[i] : 0))
      const total = take.reduce((a, b) => a + b, 0)
      if (total <= 1e-9) break
      starts = starts.map((v, i) => v + spill * (take[i] / total))
    }

    /* Appearances: the SAME sharpened allocation against the bigger "used"
       count, and never below the starts — a player cannot start more games
       than he plays in. `used` exceeds `start` because substitutes exist.
       Sharpened like the starts rather than left flat, or a fourth-choice
       keeper who never starts would still be credited with appearing in a
       quarter of his club's games. */
    const plays = w.map((x, i) => Math.min(CAP + 0.05, Math.max(starts[i], x * sh.used)))

    g.forEach((s, i) => out.set(s.code, { p60: starts[i], ppl: plays[i] }))
  }
  return out
}
