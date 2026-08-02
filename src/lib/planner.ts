// planner.ts — pure logic for the week-by-week season planner.
//
// The same engine powers the Squad Builder's planner and (later) the My Team
// page: a base 15-man squad, then per-gameweek transfers, lineups, captaincy and
// chips. Kept free of React/DOM so it can be unit-checked and reused anywhere.

export type Pos = 'GKP' | 'DEF' | 'MID' | 'FWD'
export type Chip = 'wildcard' | 'bench-boost' | 'triple-captain' | 'free-hit'
export const CHIP_LABEL: Record<Chip, string> = {
  wildcard: 'Wildcard',
  'bench-boost': 'Bench Boost',
  'triple-captain': 'Triple Captain',
  'free-hit': 'Free Hit',
}

export const MAX_FT = 5
export const HIT_COST = 4
export const SQUAD_NEED: Record<Pos, number> = { GKP: 2, DEF: 5, MID: 5, FWD: 3 }

export interface WeekPlan {
  /** A gameweek's transfers. `in` is null while a player has been sold but
   *  not yet replaced — the state that lets two sales pool their money before
   *  either is spent, which one-for-one swapping can never reach. */
  transfers: { out: number; in: number | null }[]
  xi: number[]        // 11 starters
  bench: number[]     // 4 reserves in FPL's own order: reserve GK, then the three outfield subs in the order they come on
  captain: number | null
  vice: number | null
  chip: Chip | null
}
export interface PlannerState {
  base: number[]      // the initial 15 (squad at startGw)
  startGw: number
  weeks: Record<number, WeekPlan>
}

/** The 15-man squad in effect at `gw`: base + every transfer up to and
 *  including that gameweek, applied in order. */
export function squadAt(state: PlannerState, gw: number): number[] {
  const squad = [...state.base]
  const gws = Object.keys(state.weeks).map(Number).filter((g) => g <= gw).sort((a, b) => a - b)
  for (const g of gws) {
    for (const t of state.weeks[g].transfers) {
      const i = squad.indexOf(t.out)
      if (i < 0) continue
      if (t.in == null) squad.splice(i, 1)   // sold, nobody in yet
      else squad[i] = t.in
    }
  }
  return squad
}

export const isFreeChip = (c: Chip | null) => c === 'wildcard' || c === 'free-hit'

/** Free transfers banked entering `gw`, before this week's moves and before
 *  any chip. One to begin with, +1 a week, capped at MAX_FT. A wildcard or
 *  free hit freezes the bank: the week after the chip starts with exactly
 *  what the chip week started with. */
export function bankedTransfers(state: PlannerState, gw: number): number {
  if (gw <= state.startGw) return Infinity
  let ft = 1 // available at startGw + 1
  for (let g = state.startGw + 2; g <= gw; g++) {
    const prev = state.weeks[g - 1]
    if (prev && isFreeChip(prev.chip)) continue // chip week: bank untouched
    const used = prev ? prev.transfers.filter((t) => t.in != null).length : 0
    ft = Math.min(MAX_FT, Math.max(0, ft - used) + 1)
  }
  return ft
}

/** Transfers you can make in `gw` for free — unlimited on a wildcard or free
 *  hit week, and unlimited while picking the opening squad. */
export function freeTransfers(state: PlannerState, gw: number): number {
  if (gw <= state.startGw) return Infinity
  if (isFreeChip(state.weeks[gw]?.chip ?? null)) return Infinity
  return bankedTransfers(state, gw)
}

/** Points hit for `gw` given the transfers made that week. */
export function pointsHit(state: PlannerState, gw: number): number {
  const wk = state.weeks[gw]
  if (!wk || isFreeChip(wk.chip) || gw <= state.startGw) return 0
  const ft = freeTransfers(state, gw)
  // A sale on its own isn't a transfer yet — FPL only charges once someone
  // comes in, and pricing the hit before that would punish you for looking.
  const made = wk.transfers.filter((t) => t.in != null).length
  return Math.max(0, made - ft) * HIT_COST
}

/** Which chips are still available (each once per season). */
export function chipsUsed(state: PlannerState): Set<Chip> {
  const used = new Set<Chip>()
  for (const g of Object.keys(state.weeks)) { const c = state.weeks[+g].chip; if (c) used.add(c) }
  return used
}

/* ── chip halves ─────────────────────────────────────────────────────────────
   You get a full set of chips in each half of the season. The first set has
   to be played by the GW19 deadline or it's gone; the second unlocks at GW20
   and runs to the end. So a wildcard in GW8 doesn't stop you wildcarding
   again in GW28, and the planner has to know that or it greys out half a
   season's worth of chips. */
export const SECOND_HALF_FROM = 20
export type Half = 1 | 2
export const halfOf = (gw: number): Half => (gw >= SECOND_HALF_FROM ? 2 : 1)
export const HALF_LABEL: Record<Half, string> = { 1: 'first half', 2: 'second half' }
/** The last gameweek a first-half chip can be played. */
export const FIRST_HALF_LAST = SECOND_HALF_FROM - 1

/** Which gameweek a chip was spent in, within the same half as `gw`. */
export function chipSpentIn(state: PlannerState, chip: Chip, gw: number): number | null {
  const half = halfOf(gw)
  for (const key of Object.keys(state.weeks)) {
    const g = Number(key)
    if (halfOf(g) === half && state.weeks[g].chip === chip) return g
  }
  return null
}

/** Can this chip still be played in this gameweek? Only blocked by having
 *  already spent it in the same half — the other half's copy is untouched. */
export function chipAvailable(state: PlannerState, chip: Chip, gw: number): boolean {
  const spent = chipSpentIn(state, chip, gw)
  return spent == null || spent === gw
}

// ── Lineups ──────────────────────────────────────────────────────────────────

const FORMATIONS: [number, number, number][] = [] // [DEF, MID, FWD] with GK=1, sum=10
for (let d = 3; d <= 5; d++) for (let m = 2; m <= 5; m++) { const f = 10 - d - m; if (f >= 1 && f <= 3) FORMATIONS.push([d, m, f]) }

/** Pick the best legal XI (max total rating) from a 15-man squad, plus the
 *  ordered bench and default captain/vice (top two rated starters). */
export function autoLineup(
  squad: number[],
  posOf: (el: number) => Pos,
  ratingOf: (el: number) => number,
): { xi: number[]; bench: number[]; captain: number | null; vice: number | null } {
  const byPos = (p: Pos) => squad.filter((e) => posOf(e) === p).sort((a, b) => ratingOf(b) - ratingOf(a))
  const gk = byPos('GKP'), def = byPos('DEF'), mid = byPos('MID'), fwd = byPos('FWD')
  let best: { xi: number[]; score: number } | null = null
  for (const [d, m, f] of FORMATIONS) {
    if (def.length < d || mid.length < m || fwd.length < f || gk.length < 1) continue
    const xi = [gk[0], ...def.slice(0, d), ...mid.slice(0, m), ...fwd.slice(0, f)]
    const score = xi.reduce((s, e) => s + ratingOf(e), 0)
    if (!best || score > best.score) best = { xi, score }
  }
  const xi = best?.xi ?? squad.slice(0, 11)
  const xiSet = new Set(xi)
  /* Bench order is the FPL app's: reserve keeper first, then the three
   * outfield subs in the order they come on, best first.
   *
   * This used to be stored the other way round and re-sorted at render time,
   * which meant the array the planner passed around and the row a reader was
   * looking at disagreed about which slot was which. One convention, held
   * everywhere — the board, the share picture and a squad read off a
   * screenshot all mean the same thing by "the first bench slot". */
  const benchOutfield = squad.filter((e) => !xiSet.has(e) && posOf(e) !== 'GKP').sort((a, b) => ratingOf(b) - ratingOf(a))
  const benchGk = squad.filter((e) => !xiSet.has(e) && posOf(e) === 'GKP')
  const bench = [...benchGk, ...benchOutfield]
  const rankedStarters = [...xi].sort((a, b) => ratingOf(b) - ratingOf(a))
  return { xi, bench, captain: rankedStarters[0] ?? null, vice: rankedStarters[1] ?? null }
}

/** Is this a legal starting XI? (1 GK, 3–5 DEF, ≥2 MID, ≥1 FWD, 11 total). */
export function validXI(xi: number[], posOf: (el: number) => Pos): boolean {
  if (xi.length !== 11) return false
  const c = { GKP: 0, DEF: 0, MID: 0, FWD: 0 } as Record<Pos, number>
  for (const e of xi) c[posOf(e)]++
  return c.GKP === 1 && c.DEF >= 3 && c.DEF <= 5 && c.MID >= 2 && c.MID <= 5 && c.FWD >= 1 && c.FWD <= 3
}

/** Try to move a player between XI and bench, keeping a legal formation.
 *  Returns the new {xi, bench} or null if the swap would be illegal. */
export function toggleStarter(
  el: number,
  xi: number[],
  bench: number[],
  posOf: (e: number) => Pos,
): { xi: number[]; bench: number[] } | null {
  const inXI = xi.includes(el)
  if (inXI) {
    // Bench this starter → promote the best-positioned legal bench player.
    for (const b of bench) {
      const nextXI = xi.map((x) => (x === el ? b : x))
      if (validXI(nextXI, posOf)) {
        const nextBench = bench.map((x) => (x === b ? el : x))
        return { xi: nextXI, bench: nextBench }
      }
    }
    return null
  }
  // Start this bench player → drop a legal starter of a swappable position.
  for (const s of xi) {
    const nextXI = xi.map((x) => (x === s ? el : x))
    if (validXI(nextXI, posOf)) {
      const nextBench = bench.map((x) => (x === el ? s : x))
      return { xi: nextXI, bench: nextBench }
    }
  }
  return null
}


/** Who this player can legally swap with: bench options for a starter, XI
 *  options for a substitute. Empty when no swap keeps a legal formation —
 *  which is the honest answer for, say, the only goalkeeper. */
export function subPartners(
  el: number,
  xi: number[],
  bench: number[],
  posOf: (e: number) => Pos,
): number[] {
  if (xi.includes(el)) {
    return bench.filter((b) => validXI(xi.map((x) => (x === el ? b : x)), posOf))
  }
  if (bench.includes(el)) {
    return xi.filter((s) => validXI(xi.map((x) => (x === s ? el : x)), posOf))
  }
  return []
}

/** Swap a named starter with a named substitute. Returns null if the pair
 *  isn't one starter and one sub, or the result would be an illegal shape. */
export function swapPlayers(
  a: number,
  b: number,
  xi: number[],
  bench: number[],
  posOf: (e: number) => Pos,
): { xi: number[]; bench: number[] } | null {
  const starter = xi.includes(a) ? a : xi.includes(b) ? b : null
  const sub = bench.includes(a) ? a : bench.includes(b) ? b : null
  if (starter == null || sub == null) return null
  const nextXI = xi.map((x) => (x === starter ? sub : x))
  if (!validXI(nextXI, posOf)) return null
  return { xi: nextXI, bench: bench.map((x) => (x === sub ? starter : x)) }
}
