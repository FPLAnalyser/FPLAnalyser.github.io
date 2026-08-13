/* Does the modelled distribution's mean come back to the engine's own xP?

   It must. The distribution exists to say more than the mean does — haul,
   blank, ceiling, floor — but it may not disagree with the mean, and every
   error found here so far was a scoring source counted twice or discounted
   twice. So: build XpParts the way componentXp builds them (every part a
   function of the rates beside it, never a number typed in by hand — the
   first cut of this probe invented `conceded` and then blamed the code for
   the disagreement), run the convolution, and compare.  */
import { GOAL_PTS, CS_PTS, sumParts, type XpParts } from '../src/lib/xp'
import { distributionFor } from '../src/lib/captaincy'

/** E[floor(C/d)] for C ~ Poisson(l), the engine's conceded/saves shape. */
const expFloorDiv = (l: number, d: number): number => {
  let p = Math.exp(-l)
  let acc = 0
  for (let k = 0; k < 30; k++) {
    acc += Math.floor(k / d) * p
    p = (p * l) / (k + 1)
  }
  return acc
}

interface Case {
  label: string; pos: string
  xg90: number; xa90: number; lamAgainst: number
  p60: number; ppl: number; sv90?: number; dc?: number; bon?: number; yel?: number
}

/** componentXp, reproduced exactly — same formulas, same order. */
function partsFor(c: Case): XpParts {
  const emf = c.p60 + 0.5 * Math.max(c.ppl - c.p60, 0)
  const lamGoal = c.xg90 * emf
  const lamAssist = c.xa90 * emf
  const back = c.pos === 'GKP' || c.pos === 'DEF'
  return {
    goal: lamGoal * (GOAL_PTS[c.pos] ?? 0),
    assist: lamAssist * 3,
    cs: Math.exp(-c.lamAgainst) * (CS_PTS[c.pos] ?? 0) * c.p60,
    conceded: back ? -expFloorDiv(c.lamAgainst, 2) * c.p60 : 0,
    saves: c.pos === 'GKP' ? expFloorDiv(c.sv90 ?? 0, 3) * c.p60 : 0,
    dc: 2 * (c.dc ?? 0) * c.p60,
    bonus: (c.bon ?? 0) * c.ppl,
    appearance: 2 * c.p60 + Math.max(c.ppl - c.p60, 0),
    cards: -(c.yel ?? 0) * c.ppl,
    lamGoal, lamAssist, lamAgainst: c.lamAgainst, p60: c.p60, matchup: 1,
  }
}

const CASES: Case[] = [
  { label: 'nailed FWD', pos: 'FWD', xg90: 0.68, xa90: 0.2, lamAgainst: 1.1, p60: 0.92, ppl: 0.96, bon: 0.9, yel: 0.06 },
  { label: 'rotation MID', pos: 'MID', xg90: 0.3, xa90: 0.35, lamAgainst: 1.4, p60: 0.45, ppl: 0.8, dc: 0.25, bon: 0.4, yel: 0.12 },
  { label: 'keeper', pos: 'GKP', xg90: 0, xa90: 0.01, lamAgainst: 1.05, p60: 0.98, ppl: 0.99, sv90: 3.1, bon: 0.5, yel: 0.02 },
  { label: 'defender', pos: 'DEF', xg90: 0.1, xa90: 0.12, lamAgainst: 1.25, p60: 0.9, ppl: 0.94, dc: 0.4, bon: 0.4, yel: 0.14 },
  { label: 'fringe FWD', pos: 'FWD', xg90: 0.45, xa90: 0.15, lamAgainst: 1.6, p60: 0.2, ppl: 0.65, bon: 0.3, yel: 0.05 },
  { label: 'elite MID', pos: 'MID', xg90: 0.55, xa90: 0.45, lamAgainst: 0.9, p60: 0.95, ppl: 0.97, dc: 0.1, bon: 1.2, yel: 0.1 },
]

let worst = 0
for (const c of CASES) {
  const parts = partsFor(c)
  const dist = distributionFor(parts, c.pos)
  let mass = 0
  let mean = 0
  for (const [pts, w] of dist) { mass += w; mean += pts * w }
  const engine = sumParts(parts)
  const modelled = mean / 2 // the distribution is keyed on the DOUBLED score
  const gap = modelled - engine
  worst = Math.max(worst, Math.abs(gap))
  const massOk = Math.abs(mass - 1) < 1e-9
  console.log(
    `${c.label.padEnd(13)} engine ${engine.toFixed(3)}  dist ${modelled.toFixed(3)}` +
    `  gap ${gap >= 0 ? '+' : ''}${gap.toFixed(3)}  mass ${massOk ? 'ok' : mass.toFixed(6)}`,
  )
}
console.log(worst < 0.05 ? `\nPASS — worst gap ${worst.toFixed(4)}` : `\nFAIL — worst gap ${worst.toFixed(4)}`)
