import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MarketOdds } from './xp'
import type { FixtureEaseRow } from './types'

/* ════════════════════════════════════════════════════════════════════════
   YOUR RATINGS.

   A reader asked to customise fixture difficulty. The obvious build is a box
   per fixture that you type 1–5 into, and it is the wrong one: difficulty is
   not a display value on this site, it is derived from how good two clubs
   are, and the same club strengths drive the goal lambdas that produce xP,
   clean sheets and everything downstream. Let someone edit the OUTPUT and
   they would recolour a fixture green while the projection under it did not
   move — two contradictory opinions about one game on one screen.

   So the edit is on the INPUT: two bounded deltas per club, attack and
   defence, in steps of a half up to ±2. Everything else is derived from
   them, which is what keeps the site coherent:

     · a club's defence delta changes what every opponent is expected to
       score against them — so their clean sheets, their opponents' goals,
       their opponents' xP, and the difficulty of every fixture against them
     · a club's attack delta changes what they are expected to score — so
       their own xP and the difficulty they present to whoever they play

   One edit, thirty-eight fixtures, one source. See docs/CUSTOM_FDR.md.

   DELTAS, NOT ABSOLUTES. The house numbers refresh several times a day. A
   stored absolute would freeze a stale opinion; a delta keeps meaning "I
   think you have this club a step wrong", which stays true after a refresh.
   ════════════════════════════════════════════════════════════════════════ */

export interface Tweak { att: number; def: number }
export type Tweaks = Record<string, Tweak>

const STORE = 'fpl_tweaks'
export const TWEAK_MAX = 2
export const TWEAK_STEP = 0.5

/** One step of opinion is worth this much of a goal rate. Two steps — the
 *  most anyone can enter — is a club a third better or worse at defending
 *  than the model has them, which is a strong disagreement and about as far
 *  as a projection stays worth printing. */
const PER_STEP = 0.88

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

/** How much of a goal rate a club's delta is worth. Positive `def` means a
 *  better defence, so fewer goals are expected against them. */
const defMult = (d: number) => Math.pow(PER_STEP, d)
const attMult = (a: number) => Math.pow(1 / PER_STEP, a)

/**
 * The market's goal lambdas, adjusted.
 *
 * Each entry is keyed `team:gw:opponent` and carries what THAT team is
 * expected to score (`for`) and concede (`against`). A club's own attack
 * delta lifts its `for`; the opponent's defence delta lifts it too, because
 * a leakier defence concedes more. `against` is the same statement from the
 * other side, so both move together and the two entries for one match stay
 * consistent with each other.
 */
export function adjustMarket(market: MarketOdds | null, tweaks: Tweaks): MarketOdds | null {
  if (!market || !Object.keys(tweaks).length) return market
  /* MULTIPLIERS, NOT REWRITTEN ODDS. The first cut scaled every entry in
     `byKey`, and it only moved the first gameweek or two — because that is as
     far ahead as the bookmakers price. Everything past that falls back to the
     model's own team strengths, which the rewrite never touched, so an
     opinion faded out after a week. Carried as multipliers and applied inside
     componentXp, a priced fixture and an unpriced one now get the same
     treatment, all thirty-eight weeks of it. */
  const tweak: Record<string, { att: number; def: number }> = {}
  for (const [team, t] of Object.entries(tweaks)) {
    tweak[team] = { att: attMult(t.att), def: defMult(t.def) }
  }
  /* `strength` IS LEFT ALONE, and that is not an oversight. componentXp now
     applies these multipliers itself, and the unpriced branch of every scale
     is built out of `strength` — so scaling it here as well applied the same
     opinion twice, once through the strength and once through the multiplier.
     It also meant nothing could show a reader the house number to compare
     against, because the house number had already moved. One application,
     in one place. */
  return { byKey: market.byKey, strength: market.strength, tweak }
}

/**
 * Fixture difficulty, derived from the same opinion.
 *
 * A fixture is harder when the OPPONENT is better, so both of their deltas
 * count: a stronger attack and a meaner defence each make the game worse to
 * own a player in. Rounded back to the 1–5 the whole site draws in, and
 * clamped, because a 0 or a 6 has no colour and no meaning.
 */
export function adjustFixtureEase(rows: FixtureEaseRow[], tweaks: Tweaks): FixtureEaseRow[] {
  if (!rows.length || !Object.keys(tweaks).length) return rows
  return rows.map((f) => {
    const opp = tweaks[f.opponent]
    if (!opp) return f
    /* 0.6 a step, not 0.5: at a half the smallest opinion anyone can enter
       rounded away to nothing and the colours never moved, which reads as the
       control being broken. One full step on either dial now always shows. */
    const shift = (opp.att + opp.def) * 0.6
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
  fromGw: number,
  n = 6,
): Impact | null {
  if (!strength || !league) return null
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
    const twMe = tweaks[team]
    const twOpp = tweaks[fx.opponent]
    const mineFor = Math.pow(1 / PER_STEP, twMe?.att ?? 0) * Math.pow(PER_STEP, twOpp?.def ?? 0)
    const mineAgainst = Math.pow(1 / PER_STEP, twOpp?.att ?? 0) * Math.pow(PER_STEP, twMe?.def ?? 0)
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
