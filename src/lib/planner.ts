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
  transfers: { out: number; in: number }[]
  xi: number[]        // 11 starters
  bench: number[]     // 4 reserves, ordered (outfield first, then the reserve GK)
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
      if (i >= 0) squad[i] = t.in
    }
  }
  return squad
}

const isFreeChip = (c: Chip | null) => c === 'wildcard' || c === 'free-hit'

/** Free transfers available at the START of `gw` (before this week's moves).
 *  1 to begin with, +1 each gameweek, banked up to MAX_FT; wildcard/free-hit
 *  weeks don't consume transfers. The initial squad (startGw) is unlimited. */
export function freeTransfers(state: PlannerState, gw: number): number {
  if (gw <= state.startGw) return Infinity
  let ft = 1 // available at startGw + 1
  for (let g = state.startGw + 2; g <= gw; g++) {
    const prev = state.weeks[g - 1]
    const used = prev && !isFreeChip(prev.chip) ? prev.transfers.length : 0
    ft = Math.min(MAX_FT, Math.max(0, ft - used) + 1)
  }
  return ft
}

/** Points hit for `gw` given the transfers made that week. */
export function pointsHit(state: PlannerState, gw: number): number {
  const wk = state.weeks[gw]
  if (!wk || isFreeChip(wk.chip) || gw <= state.startGw) return 0
  const ft = freeTransfers(state, gw)
  return Math.max(0, wk.transfers.length - ft) * HIT_COST
}

/** Which chips are still available (each once per season). */
export function chipsUsed(state: PlannerState): Set<Chip> {
  const used = new Set<Chip>()
  for (const g of Object.keys(state.weeks)) { const c = state.weeks[+g].chip; if (c) used.add(c) }
  return used
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
  // Bench: reserve GK first-in-list convention is the LAST bench slot; order the
  // three outfield reserves by rating (best sub first).
  const benchOutfield = squad.filter((e) => !xiSet.has(e) && posOf(e) !== 'GKP').sort((a, b) => ratingOf(b) - ratingOf(a))
  const benchGk = squad.filter((e) => !xiSet.has(e) && posOf(e) === 'GKP')
  const bench = [...benchOutfield, ...benchGk]
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
