import { useCallback, useEffect, useMemo, useState } from 'react'
import { tweakMultipliers, TWEAK_MAX, type TeamBase } from './baselines'
import type { MarketOdds } from './xp'
import type { FixtureEaseRow } from './types'

export { TWEAK_MAX } from './baselines'

/* ════════════════════════════════════════════════════════════════════════
   YOUR RATINGS.

   A reader asked to customise fixture difficulty. The obvious build is a box
   per fixture that you type 1–5 into, and it is the wrong one: difficulty is
   not a display value on this site, it is derived from how good two clubs
   are, and the same club strengths drive the goal lambdas that produce xP,
   clean sheets and everything downstream. Let someone edit the OUTPUT and
   they would recolour a fixture green while the projection under it did not
   move — two contradictory opinions about one game on one screen.

   So the edit is on the INPUT: two dials per club, attack and defence, in
   halves from −2 to +2, where the ends mean AS STRONG AS THE STRONGEST CLUB IN
   THE LEAGUE at that end of the pitch and as weak as the weakest. Everything
   else is derived from them, which is what keeps the site coherent:

     · a club's defence delta changes what every opponent is expected to
       score against them — so their clean sheets, their opponents' goals,
       their opponents' xP, and the difficulty of every fixture against them
     · a club's attack delta changes what they are expected to score — so
       their own xP and the difficulty they present to whoever they play

   One edit, thirty-eight fixtures, one source. See docs/CUSTOM_FDR.md.

   MEASURED AGAINST THE LEAGUE, NOT AGAINST THE CLUB. The first version made a
   step a fixed 13% of a club's own goal rate, and it could not do the job:
   Hull on both dials at maximum reached 2.21 on the 1–5, where 5.0 would have
   needed eight steps against a cap of two. A control that cannot say "this
   promoted side is actually dangerous" is not a rating control. Anchoring the
   ends to the league's best and worst makes every club able to reach both
   ends, and makes +2 mean the same thing on every card.

   RELATIVE, NOT ABSOLUTE. The house numbers refresh several times a day. A
   stored 2.11 would freeze a stale opinion; "halfway to the best attack in the
   league" still means what you meant after the next refresh.
   ════════════════════════════════════════════════════════════════════════ */

export interface Tweak { att: number; def: number }
export type Tweaks = Record<string, Tweak>

const STORE = 'fpl_tweaks'
export const TWEAK_STEP = 0.5

export const clampTweak = (v: number): number =>
  Math.max(-TWEAK_MAX, Math.min(TWEAK_MAX, Math.round(v / TWEAK_STEP) * TWEAK_STEP))

const read = (): Tweaks => {
  try {
    const raw = localStorage.getItem(STORE)
    if (!raw) return {}
    const v = JSON.parse(raw) as Tweaks
    if (!v || typeof v !== 'object') return {}
    const out: Tweaks = {}
    for (const [team, t] of Object.entries(v)) {
      const att = clampTweak(Number(t?.att) || 0)
      const def = clampTweak(Number(t?.def) || 0)
      if (att || def) out[team] = { att, def }
    }
    return out
  } catch { return {} }
}

/** Changed in one tab, honoured in the others — and in every hook on the
 *  page, which is the point: this has to move the whole site at once. */
const listeners = new Set<(t: Tweaks) => void>()
let current: Tweaks | null = null

const snapshot = (): Tweaks => (current ??= read())

function write(next: Tweaks) {
  current = next
  try { localStorage.setItem(STORE, JSON.stringify(next)) } catch { /* private mode */ }
  for (const fn of listeners) fn(next)
}

export function useTweaks() {
  const [tweaks, setTweaks] = useState<Tweaks>(snapshot)
  useEffect(() => {
    const fn = (t: Tweaks) => setTweaks(t)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])

  const set = useCallback((team: string, patch: Partial<Tweak>) => {
    const cur = snapshot()
    const now: Tweak = { att: clampTweak(patch.att ?? cur[team]?.att ?? 0), def: clampTweak(patch.def ?? cur[team]?.def ?? 0) }
    const next = { ...cur }
    if (now.att === 0 && now.def === 0) delete next[team]
    else next[team] = now
    write(next)
  }, [])

  const reset = useCallback(() => write({}), [])
  const count = useMemo(() => Object.keys(tweaks).length, [tweaks])
  return { tweaks, set, reset, count, active: count > 0 }
}

/** Read-only access for the engine hooks, which do not need to re-render on
 *  a change of their own — the components above them do. */
export function useTweakValues(): Tweaks {
  const [t, setT] = useState<Tweaks>(snapshot)
  useEffect(() => {
    const fn = (v: Tweaks) => setT(v)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  return t
}

/**
 * The market's goal lambdas, adjusted.
 *
 * MULTIPLIERS, NOT REWRITTEN ODDS. The first cut scaled every entry in
 * `byKey`, and it only moved the first gameweek or two — because that is as far
 * ahead as the bookmakers price. Everything past that falls back to the model's
 * own team strengths, which the rewrite never touched, so an opinion faded out
 * after a week. Carried as multipliers and applied inside componentXp, a priced
 * fixture and an unpriced one now get the same treatment, all thirty-eight
 * weeks of it.
 *
 * The multipliers come from `house` — the same per-game baselines the fixture
 * difficulty is built from — because that is where the league's best and worst
 * live, and a dial now means a position in that range rather than a percentage
 * of the club's own rate. Without those baselines there is no opinion to apply
 * yet, so the market comes back untouched and the page renders house numbers
 * until team_metrics lands.
 *
 * `strength` IS LEFT ALONE, and that is not an oversight. componentXp applies
 * these multipliers itself, and the unpriced branch of every scale is built out
 * of `strength` — so scaling it here as well applied the same opinion twice,
 * once through the strength and once through the multiplier. It also meant
 * nothing could show a reader the house number to compare against, because the
 * house number had already moved. One application, in one place.
 */
export function adjustMarket(market: MarketOdds | null, tweaks: Tweaks, house: Map<string, TeamBase>): MarketOdds | null {
  if (!market || !Object.keys(tweaks).length || house.size < 8) return market
  const tweak = tweakMultipliers(house, tweaks)
  if (!Object.keys(tweak).length) return market
  return { byKey: market.byKey, strength: market.strength, tweak }
}

/**
 * FPL's own FDR column, moved in step with the rest.
 *
 * Not what this site's grids draw — those are computed from the baselines
 * through buildDiffScale, and assuming otherwise is what made the first version
 * of this feature appear to do nothing. This is the fallback for an opponent
 * with no baseline at all, and a handful of squad views still read it directly,
 * so it moves too rather than sitting there contradicting the page around it.
 *
 * Derived from the same multipliers, so it cannot drift from them: a club whose
 * goal rate doubles is worth about two rungs of a five-point scale.
 */
export function adjustFixtureEase(rows: FixtureEaseRow[], tweaks: Tweaks, house: Map<string, TeamBase>): FixtureEaseRow[] {
  if (!rows.length || !Object.keys(tweaks).length || house.size < 8) return rows
  const mult = tweakMultipliers(house, tweaks)
  if (!Object.keys(mult).length) return rows
  return rows.map((f) => {
    const m = mult[f.opponent]
    if (!m) return f
    // A harder fixture is one where they score more (att above 1) and concede
    // less (def below 1); both push the same way.
    const shift = (m.att - 1) * 2 + (1 - m.def) * 2
    const fdr = Math.max(1, Math.min(5, Math.round(f.fdr + shift))) as FixtureEaseRow['fdr']
    return fdr === f.fdr ? f : { ...f, fdr }
  })
}

/**
 * What a club's dials actually do, in goals.
 *
 * Moving a slider from 0 to +2 without being told what it means is a guess,
 * and a projection built on a guess is worth nothing. So the page shows the
 * consequence beside the control: over the club's next few fixtures, what
 * they are expected to score and concede, and how often that is a clean
 * sheet — as the model has it, and as you have it.
 *
 * Deliberately the SAME quantities the projection is built from rather than a
 * summary invented for this page: goals for, goals against, and exp(−goals
 * against) for the clean sheet. If the preview and the engine ever disagree,
 * one of them is lying.
 */
export interface Impact { games: number; forGoals: number; against: number; cs: number }

export function clubImpact(
  team: string,
  rows: FixtureEaseRow[],
  strength: Record<string, { att: number; def: number }> | undefined,
  league: { att: number; def: number; hAtt: number } | undefined,
  tweaks: Tweaks,
  house: Map<string, TeamBase>,
  fromGw: number,
  n = 6,
): Impact | null {
  if (!strength || !league) return null
  /* The SAME multipliers componentXp uses, from the same builder. A preview of
     a projection computed a second way is not a preview of that projection. */
  const mult = tweakMultipliers(house, tweaks)
  const fixtures = rows
    .filter((f) => f.team === team && f.gw >= fromGw)
    .sort((a, b) => a.gw - b.gw)
    .slice(0, n)
  if (!fixtures.length) return null

  const me = strength[team]
  if (!me) return null
  const hA = league.hAtt || 1
  let f = 0
  let a = 0
  let cs = 0
  for (const fx of fixtures) {
    const opp = strength[fx.opponent]
    const home = fx.venue === 'H'
    const twMe = mult[team]
    const twOpp = mult[fx.opponent]
    const mineFor = (twMe?.att ?? 1) * (twOpp?.def ?? 1)
    const mineAgainst = (twOpp?.att ?? 1) * (twMe?.def ?? 1)
    const lamFor = me.att * (opp ? opp.def / league.def : 1) * (home ? hA : 1 / hA) * mineFor
    const lamAgainst = me.def * (opp ? opp.att / league.att : 1) * (home ? 1 / hA : hA) * mineAgainst
    f += lamFor
    a += lamAgainst
    cs += Math.exp(-lamAgainst)
  }
  const k = fixtures.length
  return { games: k, forGoals: f / k, against: a / k, cs: cs / k }
}

/** A club's opinion in words, for a tooltip or a chip. */
export const tweakLabel = (t: Tweak): string => {
  const bits: string[] = []
  if (t.att) bits.push(`attack ${t.att > 0 ? '+' : '−'}${Math.abs(t.att)}`)
  if (t.def) bits.push(`defence ${t.def > 0 ? '+' : '−'}${Math.abs(t.def)}`)
  return bits.join(' · ')
}

/** Where a dial puts a club, in words. The number alone does not say that the
 *  ends are the league's own extremes and a bit beyond, rather than an
 *  arbitrary amount — which is the whole reason a club already top of the
 *  league at something can still be moved. */
const ENDS: Record<'att' | 'def', [string, string]> = {
  att: ['weaker going forward than any club in the league', 'stronger going forward than any club in the league'],
  def: ['leakier at the back than any club in the league', 'meaner at the back than any club in the league'],
}

export function dialWords(v: number, side: 'att' | 'def'): string {
  if (v === 0) return 'As the model has them'
  const end = ENDS[side][v > 0 ? 1 : 0]
  const frac = Math.abs(v) / TWEAK_MAX
  return frac >= 1
    ? end.charAt(0).toUpperCase() + end.slice(1)
    : `${Math.round(frac * 100)}% of the way to ${end}`
}
