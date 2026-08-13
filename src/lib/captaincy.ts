import { GOAL_PTS, CS_PTS, sumParts, xpPartsForGw, type XpModel, type MarketOdds, type ShotProfiles, type XpParts } from './xp'
import { num, str } from './rows'
import type { Availability } from './availability'
import type { FixtureEaseRow, RatingRow } from './types'

/* ════════════════════════════════════════════════════════════════════════
   Captaincy — a captain is a distribution, not an average.

   The armband doubles a score, and doubling doubles the variance with it.
   Two players on the same expected points are not the same pick: the one who
   returns 2 or 14 is a different bet from the one who returns 6 every week,
   and which you want depends entirely on whether you are chasing or holding
   a lead. So this module prices a captain three ways — mean, ceiling, floor —
   and then against the field, because captaining the player everyone else
   captains gains you nothing however many points he scores.

   The distribution is not simulated. `xpPartsForGw` already exposes the rates
   behind the random parts (lamGoal, lamAssist, lamAgainst, p60), so the exact
   convolution is cheap and, unlike a Monte Carlo, gives the same answer twice.

   THE APPROXIMATION, STATED: whether he features, whether he lasts the hour,
   goals, assists and goals conceded are all drawn as random, and bonus is paid
   only when it is earned — a return, or a clean sheet for the players paid for
   one. Defensive contribution, saves and cards enter at their expected value:
   the small, smooth parts, which understates the spread a little. Those three
   are the only places this is not honest about its own tails.

   Whatever it does, it may not disagree with the mean it came from. The mean
   of this distribution reconstructs the engine's own xP to within 0.001 across
   forwards, rotation midfielders, keepers and defenders — checked by
   `tools/captaincy-probe.ts`, which is where every error above was caught.
   ════════════════════════════════════════════════════════════════════════ */

/** A captain's score is doubled, so the thresholds are doubled too: a haul is
 *  12+ AFTER the armband, a blank is 4 or fewer. */
export const HAUL_CAPTAINED = 12
export const BLANK_CAPTAINED = 4

const MAX_G = 6
const MAX_A = 4
const MAX_C = 8
/** A cameo is worth about half a start — the same weighting the engine's own
 *  effective-minutes factor uses for a sub appearance. */
const CAMEO = 0.5

/** Poisson pmf for k = 0..n, with the tail folded into the last bucket so the
 *  weights always sum to one and nothing leaks out of the distribution. */
function poisson(lambda: number, n: number): number[] {
  const out: number[] = []
  let p = Math.exp(-lambda)
  let acc = 0
  for (let k = 0; k <= n; k++) {
    out.push(p)
    acc += p
    p = (p * lambda) / (k + 1)
  }
  out[n] += Math.max(0, 1 - acc)
  return out
}

export interface CapOutlook {
  /** Expected points for the week, before the armband. */
  xp: number
  /** P(12 or more after doubling) and P(4 or fewer after doubling). */
  haul: number
  blank: number
  /** The doubled score at the 90th and 10th percentile of the distribution. */
  ceiling: number
  floor: number
  /** False when there is no component baseline to build a distribution from,
   *  so haul, blank, ceiling and floor mean nothing and must not be shown. */
  modelled: boolean
}

/** The week's points distribution, keyed on the DOUBLED score against its
 *  probability. Separated from `capOutlook` so it can be checked against the
 *  thing it must agree with: sum the distribution and its mean has to come
 *  back to the engine's own xP, or a scoring source is counted twice. */
export function distributionFor(parts: XpParts, pos: string): Map<number, number> {
  const goalPts = GOAL_PTS[pos] ?? 4
  const csPts = CS_PTS[pos] ?? 0
  const backline = pos === 'GKP' || pos === 'DEF'

  /* Three branches, because "didn't play" is a real outcome and the one that
     makes a blank a blank. The engine hands over enough to separate them:
     appearance = 2*p60 + (ppl - p60), so the chance he features at all falls
     straight out of it. (The fallback path for players with no component
     baseline dumps a flat projection into `appearance` instead, which would
     make that arithmetic nonsense — hence the clamp.) */
  const p60 = Math.min(1, Math.max(0, parts.p60))
  const pPlay = Math.min(1, Math.max(p60, parts.appearance - p60))

  /* cs, conceded, saves and dc all arrive already multiplied by p60, because
     the engine quotes them as expectations over the whole week. Inside the
     played-the-hour branch that factor is applied again by the branch itself,
     so it has to come back out first or it lands twice. */
  const savesIn60 = p60 > 0.01 ? parts.saves / p60 : 0
  const dcIn60 = p60 > 0.01 ? parts.dc / p60 : 0

  /* lamGoal and lamAssist are NOT rates for a game he starts — the engine has
     already weighted them by its effective-minutes factor, emf = p60 + ½(ppl −
     p60), so they are expectations across the whole week, minutes risk and
     all. Splitting the week into branches and then using them as-is discounts
     the same risk twice: the probe caught it as a 0.73-point hole in a
     rotation midfielder's mean. Divide emf back out to recover the per-start
     rate, and let the branches reapply it — at 1.0 for the hour and 0.5 for a
     cameo, which is exactly the weighting emf was built from. */
  const emf = p60 + 0.5 * Math.max(pPlay - p60, 0)
  const startGoal = emf > 0.01 ? parts.lamGoal / emf : 0
  const startAssist = emf > 0.01 ? parts.lamAssist / emf : 0
  const cardsInPlay = pPlay > 0.01 ? parts.cards / pPlay : 0

  const pG = poisson(startGoal, MAX_G)
  const pA = poisson(startAssist, MAX_A)
  const pC = poisson(parts.lamAgainst, MAX_C)
  const pGc = poisson(startGoal * CAMEO, MAX_G)
  const pAc = poisson(startAssist * CAMEO, MAX_A)

  /* Bonus is NOT a constant. Holding it at its mean added a point to every
     outcome including the ones where he did nothing, which is what put a 0%
     blank against the best captain in the game: with ~1.0 baked in, his worst
     possible week was already above the blank line. Bonus is paid only when it
     is earned, priced so the week's expectation still lands where the engine
     put it — which means dividing by the chance of earning it across BOTH
     playing branches, not one.

     What counts as earning it depends on the shirt. A forward's bonus comes
     with a goal; a keeper's comes with a clean sheet and a pile of saves, and
     he may go a season without an attacking return. Keying bonus on returns
     alone made his trigger probability ~1%, tripped the guard below, and
     dropped his bonus on the floor — half a point a week, every week, which
     the probe caught as the last surviving gap. So a clean sheet earns it too,
     for the players it is actually paid to. */
  const pRetHour = 1 - Math.exp(-(startGoal + startAssist))
  const pRetCameo = 1 - Math.exp(-CAMEO * (startGoal + startAssist))
  const pCs = backline ? Math.exp(-parts.lamAgainst) : 0
  const pEarn =
    p60 * (1 - (1 - pRetHour) * (1 - pCs))
    + Math.max(pPlay - p60, 0) * pRetCameo
  // A player who can plausibly earn it gets it when he does; one who cannot
  // (no threat, no clean sheet to keep) still has the points in his
  // projection, so they ride along with the appearance rather than vanish.
  const payOnEarn = pEarn > 0.02
  const bonusOnEarn = payOnEarn ? Math.min(3, parts.bonus / pEarn) : 0
  const bonusFlat = payOnEarn ? 0 : (pPlay > 0.01 ? parts.bonus / pPlay : 0)

  // Points -> probability. Keyed on the DOUBLED score, since every question
  // asked of this distribution is a question about the captained return.
  const dist = new Map<number, number>()
  /* Scores land on whole points, but saves, def-con and the priced bonus are
     fractional, so an outcome often falls between two buckets. Rounding to the
     nearer one biases the whole distribution — it cost a keeper 0.2 points of
     mean, every week, in the same direction. Splitting the weight across the
     two neighbouring buckets in proportion keeps the mean exact. */
  const add = (pts: number, w: number) => {
    if (w <= 0) return
    const x = pts * 2
    const lo = Math.floor(x)
    const frac = x - lo
    dist.set(lo, (dist.get(lo) ?? 0) + w * (1 - frac))
    if (frac > 0) dist.set(lo + 1, (dist.get(lo + 1) ?? 0) + w * frac)
  }

  // Didn't feature: nothing at all, and doubling nothing is still nothing.
  add(0, 1 - pPlay)

  for (const hour of [true, false]) {
    // Below the hour he is on for the appearance point, and the clean sheet
    // is gone whatever the defence does — which is why CS hangs off `hour`.
    const wBranch = hour ? p60 : pPlay - p60
    if (wBranch <= 0) continue
    const gs = hour ? pG : pGc
    const as = hour ? pA : pAc
    const appearance = hour ? 2 : 1
    for (let g = 0; g <= MAX_G; g++) {
      if (gs[g] <= 0) continue
      for (let a = 0; a <= MAX_A; a++) {
        if (as[a] <= 0) continue
        const returned = g + a > 0
        const base = appearance + g * goalPts + a * 3 + cardsInPlay + bonusFlat
          + (hour ? savesIn60 + dcIn60 : 0)
        if (!hour) {
          // No clean sheet and no conceded deduction without the hour, so the
          // opposition's goals do not enter — one bucket, not nine.
          add(base + (returned ? bonusOnEarn : 0), wBranch * gs[g] * as[a])
          continue
        }
        for (let c = 0; c <= MAX_C; c++) {
          if (pC[c] <= 0) continue
          let pts = base
          // Bonus lands once, whether he earned it with a return, a clean
          // sheet, or both.
          if (returned || (backline && c === 0)) pts += bonusOnEarn
          if (c === 0) pts += csPts
          // One point off per two conceded, keepers and defenders only.
          if (backline) pts -= Math.floor(c / 2)
          add(pts, wBranch * gs[g] * as[a] * pC[c])
        }
      }
    }
  }

  return dist
}

/** The full points distribution for one player in one week, then the numbers
 *  read off it. Returns null when the player has no projection at all. */
export function capOutlook(
  r: RatingRow,
  gw: number,
  fixtureEase: FixtureEaseRow[],
  avail: Availability | undefined,
  model: XpModel | null,
  market: MarketOdds | null,
  profiles: ShotProfiles | null,
): CapOutlook | null {
  const parts = xpPartsForGw(r, gw, fixtureEase, avail, model, market, profiles)
  if (!parts) return null
  const xp = sumParts(parts)
  if (xp <= 0) return { xp: 0, haul: 0, blank: 1, ceiling: 0, floor: 0, modelled: true }

  /* Some players have no component baseline — a signing from abroad, a
     promoted club's forward — and for them the engine falls back to a flat
     projection dropped whole into `appearance`. Read as minutes points that
     becomes "he plays, he scores one point", which put Isak on the board at
     9.2 expected points with a 100% chance of blanking. There is no
     distribution to be had here, so the honest answer is to say so rather
     than compute one from a field that means something else. */
  if (parts.p60 === 0 && parts.appearance > 0) {
    return { xp, haul: 0, blank: 0, ceiling: 0, floor: 0, modelled: false }
  }

  const dist = distributionFor(parts, String(r.position))
  const keys = [...dist.keys()].sort((x, y) => x - y)
  let haul = 0
  let blank = 0
  for (const k of keys) {
    const w = dist.get(k)!
    if (k >= HAUL_CAPTAINED) haul += w
    if (k <= BLANK_CAPTAINED) blank += w
  }
  const at = (q: number): number => {
    let acc = 0
    for (const k of keys) {
      acc += dist.get(k)!
      if (acc >= q) return k
    }
    return keys[keys.length - 1] ?? 0
  }
  return { xp, haul, blank, ceiling: at(0.9), floor: at(0.1), modelled: true }
}

export interface CapRow {
  element: number
  code: number | null
  name: string
  team: string
  position: string
  /** Opponent and venue for the week, already formatted ("BOU (H)"). */
  fixture: string
  owned: number
  outlook: CapOutlook
  /** Ownership x (1 + modelled captaincy share) — see `effectiveOwnership`. */
  eo: number
  capShare: number
  /** Captained expected points minus the field's expected captain return. */
  edge: number
}

/* FPL does not publish captaincy before a deadline, so the share of the field
   on each captain has to be modelled. Managers captain the highest projection
   they own, so the share is expected points weighted by ownership and pushed
   through a softmax — sharper than xP alone, because captaincy concentrates
   far harder than ownership does. The exponent is a judgement, not a
   measurement, which is why the UI labels every EO figure as modelled. */
const CAPTAINCY_SHARPNESS = 1.35

export function fieldCaptaincy(rows: { xp: number; owned: number }[]): number[] {
  const weights = rows.map((r) => Math.max(0, r.owned / 100) * Math.exp(CAPTAINCY_SHARPNESS * r.xp))
  const total = weights.reduce((a, b) => a + b, 0)
  return total > 0 ? weights.map((w) => w / total) : weights.map(() => 0)
}

/** What the average manager's armband is expected to return this week: every
 *  captain's doubled projection, weighted by how much of the field is on him.
 *  This is the number your pick has to beat to have gained anything. */
export function fieldReturn(rows: { xp: number }[], shares: number[]): number {
  return rows.reduce((acc, r, i) => acc + r.xp * 2 * (shares[i] ?? 0), 0)
}

/** Build the captain board for one gameweek: every player with a projection,
 *  priced against the field, best edge first. */
export function captainBoard(
  ratings: RatingRow[],
  gw: number,
  fixtureEase: FixtureEaseRow[],
  avail: Availability | undefined,
  model: XpModel | null,
  market: MarketOdds | null,
  profiles: ShotProfiles | null,
  limit = 40,
): { rows: CapRow[]; field: number } {
  const seeded: (Omit<CapRow, 'eo' | 'capShare' | 'edge'>)[] = []
  for (const r of ratings) {
    const outlook = capOutlook(r, gw, fixtureEase, avail, model, market, profiles)
    if (!outlook || outlook.xp <= 0) continue
    const fix = fixtureEase.filter((f) => f.team === r.team && f.gw === gw)
    seeded.push({
      element: num(r, 'element') ?? 0,
      code: num(r, 'code'),
      name: str(r, 'web_name') ?? '',
      team: String(r.team),
      position: String(r.position),
      fixture: fix.map((f) => `${f.opponent} (${f.venue})`).join(' + '),
      owned: num(r, 'selected_by_percent') ?? 0,
      outlook,
    })
  }
  // The field is worked out over EVERY projected player, not the shortlist —
  // truncate first and the shares renormalise over the top few, which quietly
  // inflates the benchmark the whole board is judged against.
  const shares = fieldCaptaincy(seeded.map((s) => ({ xp: s.outlook.xp, owned: s.owned })))
  const field = fieldReturn(seeded.map((s) => ({ xp: s.outlook.xp })), shares)

  const rows: CapRow[] = seeded.map((s, i) => ({
    ...s,
    capShare: shares[i] ?? 0,
    eo: s.owned * (1 + (shares[i] ?? 0)),
    edge: s.outlook.xp * 2 - field,
  }))
  rows.sort((a, b) => b.outlook.xp - a.outlook.xp)
  return { rows: rows.slice(0, limit), field }
}

/** The best captain projection in each week of a window — what a Triple
 *  Captain is worth then, since the chip simply adds one more multiple. */
export interface TcWeek {
  gw: number
  name: string
  team: string
  fixture: string
  /** One extra multiple of the captain: the chip's value that week. */
  gain: number
  /** True when no later week in the window beats this one — the stopping rule. */
  best: boolean
}

export function tripleCaptainWeeks(
  ratings: RatingRow[],
  gws: number[],
  fixtureEase: FixtureEaseRow[],
  avail: Availability | undefined,
  model: XpModel | null,
  market: MarketOdds | null,
  profiles: ShotProfiles | null,
): TcWeek[] {
  const weeks: TcWeek[] = []
  for (const gw of gws) {
    let top: { xp: number; r: RatingRow } | null = null
    for (const r of ratings) {
      const parts = xpPartsForGw(r, gw, fixtureEase, avail, model, market, profiles)
      if (!parts) continue
      const xp = sumParts(parts)
      if (xp > 0 && (!top || xp > top.xp)) top = { xp, r }
    }
    if (!top) continue
    const fix = fixtureEase.filter((f) => f.team === top!.r.team && f.gw === gw)
    weeks.push({
      gw,
      name: str(top.r, 'web_name') ?? '',
      team: String(top.r.team),
      fixture: fix.map((f) => f.opponent).join('+'),
      gain: top.xp,
      best: false,
    })
  }
  // A week is worth spending in only if nothing LEFT beats it. Walking
  // backwards makes that one pass: carry the best still to come.
  let bestAhead = -Infinity
  for (let i = weeks.length - 1; i >= 0; i--) {
    weeks[i].best = weeks[i].gain >= bestAhead
    bestAhead = Math.max(bestAhead, weeks[i].gain)
  }
  return weeks
}

/** Top `n` captain options in each week of a window — the matrix. */
export function captainMatrix(
  ratings: RatingRow[],
  gws: number[],
  fixtureEase: FixtureEaseRow[],
  avail: Availability | undefined,
  model: XpModel | null,
  market: MarketOdds | null,
  profiles: ShotProfiles | null,
  n = 5,
  maxOwned = 101,
): Map<number, { name: string; team: string; fixture: string; xp: number; owned: number }[]> {
  const out = new Map<number, { name: string; team: string; fixture: string; xp: number; owned: number }[]>()
  const pool = ratings.filter((r) => (num(r, 'selected_by_percent') ?? 0) < maxOwned)
  for (const gw of gws) {
    const week: { name: string; team: string; fixture: string; xp: number; owned: number }[] = []
    for (const r of pool) {
      const parts = xpPartsForGw(r, gw, fixtureEase, avail, model, market, profiles)
      if (!parts) continue
      const xp = sumParts(parts)
      if (xp <= 0) continue
      const fix = fixtureEase.filter((f) => f.team === r.team && f.gw === gw)
      week.push({
        name: str(r, 'web_name') ?? '',
        team: String(r.team),
        fixture: fix.map((f) => (f.venue === 'H' ? f.opponent.toUpperCase() : f.opponent.toLowerCase())).join('+'),
        xp,
        owned: num(r, 'selected_by_percent') ?? 0,
      })
    }
    week.sort((a, b) => b.xp - a.xp)
    out.set(gw, week.slice(0, n))
  }
  return out
}
