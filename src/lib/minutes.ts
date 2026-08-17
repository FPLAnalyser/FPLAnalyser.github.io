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

/**
 * Distribute each club's shirts across its squad, position by position.
 *
 * Returns nothing for a group it cannot place — fewer than two players, or no
 * shirt count for the position — so a caller always falls back to the
 * player's own history rather than to a guess.
 */
export function minuteShares(seats: SquadSeat[], shirts: Record<string, Shirts>): Map<number, MinuteShare> {
  const out = new Map<number, MinuteShare>()
  const groups = new Map<string, SquadSeat[]>()
  for (const s of seats) {
    if (s.code == null || s.team == null || !s.pos) continue
    const k = `${s.team}|${s.pos}`
    const g = groups.get(k)
    if (g) g.push(s)
    else groups.set(k, [s])
  }

  for (const [k, g] of groups) {
    const pos = k.split('|')[1]
    const sh = shirts[pos]
    if (!sh || g.length < 2) continue

    /* Two opinions about the pecking order, each normalised to sum to one so
       neither can dominate by being on a bigger scale.

       The historical one is what he did last season, wherever that was. The
       market one is price times ownership: FPL prices a role before a ball is
       kicked, and ownership is several million managers forecasting the same
       Ownership enters PROPORTIONALLY, plus a floor. Written as
       `1 + own/100` it turned Kinsky's 19.8% against Vicario's 1.4% — a
       fourteen-to-one statement by several million managers about who keeps
       goal for Spurs — into a ratio of 1.18 to 1, which is not using the
       signal so much as acknowledging it. The floor keeps an unowned squad
       player ranked by his price rather than zeroed out. */
    /* A history from another club is discarded for ORDERING purposes and the
       player falls back to replacement level, to be placed by the market
       signal instead. Not discounted, discarded: it is not weak evidence about
       this pecking order, it is evidence about a different one. */
    const hist = share(g.map((s) => (s.p60 != null && s.p60 > 0 && s.sameClub !== false ? s.p60 : NO_RECORD)))
    const mkt = share(g.map((s) => Math.max(0.1, s.price ?? 4.5) * ((s.own ?? 0) + OWN_FLOOR)))

    /* Fitness multiplies AFTER the blend and BEFORE the normalisation, which
       is the whole point: a ruled-out player's weight drops to zero and the
       shirts he is not going to fill are shared out among whoever is left,
       rather than quietly vanishing from the club's total. */
    const raw = g.map((s, i) => (HIST_WEIGHT * hist[i] + (1 - HIST_WEIGHT) * mkt[i]) * s.fitness)
    let w = share(raw)

    /* Scale to the shirts, then push whatever the cap rejects back into the
       rest of the group and settle. Two passes is enough for a squad of this
       size; a third never moved anything in testing. */
    let starts = w.map((x) => x * sh.start)
    for (let pass = 0; pass < 3; pass++) {
      let spill = 0
      const room: number[] = []
      starts = starts.map((v) => {
        if (v > CAP) { spill += v - CAP; room.push(0); return CAP }
        room.push(CAP - v)
        return v
      })
      if (spill <= 1e-9) break
      const capacity = room.reduce((a, b) => a + b, 0)
      if (capacity <= 1e-9) break
      starts = starts.map((v, i) => v + spill * (room[i] / capacity))
    }

    /* Appearances: the same allocation against the bigger "used" count, and
       never below the starts — a player cannot start more games than he plays
       in. `used` exceeds `start` because substitutes exist. */
    w = share(raw)
    const plays = w.map((x, i) => Math.min(CAP + 0.05, Math.max(starts[i], x * sh.used)))

    g.forEach((s, i) => out.set(s.code, { p60: starts[i], ppl: plays[i] }))
  }
  return out
}
