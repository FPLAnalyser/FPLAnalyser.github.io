// shotzones.ts — shared Opta-style zone-grid geometry, classification and
// analysis for the shot maps. Ported verbatim from js/shotzones.js (pure,
// DOM-free parts only); SVG rendering lives in components/ShotMap.tsx.
import type { ShotEvent } from './types'

const YD_PER_M = 1.09361

// Box + grid geometry in metres on the 68 x 52.5 half-pitch (goal at y=0).
export const BOX_L = 13.84
export const BOX_R = 54.16
const BOX_THIRD = (BOX_R - BOX_L) / 3
const BOX_T1 = BOX_L + BOX_THIRD
const BOX_T2 = BOX_L + 2 * BOX_THIRD
const SIX_YARD_L = 24.84
const SIX_YARD_R = 43.16
const SIX_THIRD = (SIX_YARD_R - SIX_YARD_L) / 3
const SIX_T1 = SIX_YARD_L + SIX_THIRD
const SIX_T2 = SIX_YARD_L + 2 * SIX_THIRD

export const DEPTH = { d0: 0, d1: 5.5, d1b: 11, d2: 16.5, d2c: 23.25, d3: 30, d4: 52.5 }
export const VIEW_Y_MIN = -5
export const VIEW_H = DEPTH.d4 - VIEW_Y_MIN
export const VIEW_W = 68

export type Metric = 'xg' | 'goals' | 'shots'
export type ShotMode = 'for' | 'against'
export type ShotWindow = 'season' | '4gw' | '6gw'
export type Venue = 'all' | 'H' | 'A'

interface ZoneMetaEntry { name: string; narrative: string }
interface ZoneShape { x: number; y: number; w: number; h: number }

export const ZONE_META: Record<string, ZoneMetaEntry> = {
  'b1-l': { name: 'Left of Six-Yard Box', narrative: 'the left of the six-yard box' },
  'b1-m': { name: 'Six-Yard Box', narrative: 'right in the six-yard box' },
  'b1-r': { name: 'Right of Six-Yard Box', narrative: 'the right of the six-yard box' },
  'b2-wl': { name: 'Left Byline', narrative: 'the left byline' },
  'b2-el-n': { name: 'Left of Box, Near', narrative: 'the left of the box, close to goal' },
  'b2-el-f': { name: 'Left of Box, Far', narrative: 'the left of the box, further out' },
  'b2-l': { name: 'Inside Left', narrative: 'inside-left of the box' },
  'b2-m': { name: 'Middle of Box', narrative: 'the middle of the box' },
  'b2-r': { name: 'Inside Right', narrative: 'inside-right of the box' },
  'b2-er-n': { name: 'Right of Box, Near', narrative: 'the right of the box, close to goal' },
  'b2-er-f': { name: 'Right of Box, Far', narrative: 'the right of the box, further out' },
  'b2-wr': { name: 'Right Byline', narrative: 'the right byline' },
  'b3-c': { name: 'Back of Box', narrative: 'the back of the box' },
  'b4-wl': { name: 'Long Range, Wide Left', narrative: 'long range, wide on the left' },
  'b4-l': { name: 'Edge of Box, Left', narrative: 'just outside the box on the left' },
  'b4-m': { name: 'Edge of Box, Centre', narrative: 'just outside the box, centrally' },
  'b4-r': { name: 'Edge of Box, Right', narrative: 'just outside the box on the right' },
  'b4-wr': { name: 'Long Range, Wide Right', narrative: 'long range, wide on the right' },
  'b4b-l': { name: 'Long Range, Left of Box', narrative: 'long range, left of the box' },
  'b4b-m': { name: 'Long Range, Central', narrative: 'long range, centrally' },
  'b4b-r': { name: 'Long Range, Right of Box', narrative: 'long range, right of the box' },
  'b5-c': { name: 'Very Long Range', narrative: 'from very long range, near the halfway line' },
}

export const ZONE_SHAPES: Record<string, ZoneShape> = {
  'b1-l': { x: SIX_YARD_L, y: DEPTH.d0, w: SIX_THIRD, h: DEPTH.d1 - DEPTH.d0 },
  'b1-m': { x: SIX_T1, y: DEPTH.d0, w: SIX_THIRD, h: DEPTH.d1 - DEPTH.d0 },
  'b1-r': { x: SIX_T2, y: DEPTH.d0, w: SIX_THIRD, h: DEPTH.d1 - DEPTH.d0 },
  'b2-wl': { x: 0, y: DEPTH.d0, w: BOX_L, h: DEPTH.d2 - DEPTH.d0 },
  'b2-el-n': { x: BOX_L, y: DEPTH.d0, w: SIX_YARD_L - BOX_L, h: DEPTH.d1b - DEPTH.d0 },
  'b2-el-f': { x: BOX_L, y: DEPTH.d1b, w: SIX_YARD_L - BOX_L, h: DEPTH.d2 - DEPTH.d1b },
  'b2-l': { x: SIX_YARD_L, y: DEPTH.d1, w: SIX_THIRD, h: DEPTH.d1b - DEPTH.d1 },
  'b2-m': { x: SIX_T1, y: DEPTH.d1, w: SIX_THIRD, h: DEPTH.d1b - DEPTH.d1 },
  'b2-r': { x: SIX_T2, y: DEPTH.d1, w: SIX_THIRD, h: DEPTH.d1b - DEPTH.d1 },
  'b2-er-n': { x: SIX_YARD_R, y: DEPTH.d0, w: BOX_R - SIX_YARD_R, h: DEPTH.d1b - DEPTH.d0 },
  'b2-er-f': { x: SIX_YARD_R, y: DEPTH.d1b, w: BOX_R - SIX_YARD_R, h: DEPTH.d2 - DEPTH.d1b },
  'b2-wr': { x: BOX_R, y: DEPTH.d0, w: 68 - BOX_R, h: DEPTH.d2 - DEPTH.d0 },
  'b3-c': { x: SIX_YARD_L, y: DEPTH.d1b, w: SIX_YARD_R - SIX_YARD_L, h: DEPTH.d2 - DEPTH.d1b },
  'b4-wl': { x: 0, y: DEPTH.d2, w: BOX_L, h: DEPTH.d3 - DEPTH.d2 },
  'b4-l': { x: BOX_L, y: DEPTH.d2, w: BOX_THIRD, h: DEPTH.d2c - DEPTH.d2 },
  'b4-m': { x: BOX_T1, y: DEPTH.d2, w: BOX_THIRD, h: DEPTH.d2c - DEPTH.d2 },
  'b4-r': { x: BOX_T2, y: DEPTH.d2, w: BOX_THIRD, h: DEPTH.d2c - DEPTH.d2 },
  'b4-wr': { x: BOX_R, y: DEPTH.d2, w: 68 - BOX_R, h: DEPTH.d3 - DEPTH.d2 },
  'b4b-l': { x: BOX_L, y: DEPTH.d2c, w: BOX_THIRD, h: DEPTH.d3 - DEPTH.d2c },
  'b4b-m': { x: BOX_T1, y: DEPTH.d2c, w: BOX_THIRD, h: DEPTH.d3 - DEPTH.d2c },
  'b4b-r': { x: BOX_T2, y: DEPTH.d2c, w: BOX_THIRD, h: DEPTH.d3 - DEPTH.d2c },
  'b5-c': { x: 0, y: DEPTH.d3, w: 68, h: DEPTH.d4 - DEPTH.d3 },
}

interface MetricMetaEntry {
  label: string
  zoneKey: 'xg' | 'goals' | 'shots'
  totalKey: 'totalXg' | 'totalGoals' | 'totalShots'
  unit: string
  fmt: (v: number) => string
  noun: string
}

export const METRIC_META: Record<Metric, MetricMetaEntry> = {
  xg: { label: 'xG', zoneKey: 'xg', totalKey: 'totalXg', unit: 'xG', fmt: (v) => v.toFixed(1), noun: 'non-penalty xG' },
  goals: { label: 'Goals', zoneKey: 'goals', totalKey: 'totalGoals', unit: 'goals', fmt: (v) => String(v), noun: 'non-penalty goals' },
  shots: { label: 'Shots', zoneKey: 'shots', totalKey: 'totalShots', unit: 'shots', fmt: (v) => String(v), noun: 'shots' },
}

/** x,y are Understat's raw (unclamped) fractions — used for true distance. */
export function distanceYards(x: number | string, y: number | string): number {
  const depthM = (1 - Number(x)) * 105
  const widthOffsetM = (Number(y) - 0.5) * 68
  return Math.sqrt(depthM * depthM + widthOffsetM * widthOffsetM) * YD_PER_M
}

/** Plot/zone position: X clamped to the attacking half, Y mirrored for "against". */
export function toPitch(x: number | string, y: number | string, mode?: ShotMode): { cx: number; cy: number } {
  const clampedX = Math.max(0.5, Math.min(1, Number(x)))
  const clampedY = Math.max(0, Math.min(1, Number(y)))
  let cx = clampedY * 68
  if (mode === 'against') cx = 68 - cx
  return { cx, cy: (1 - clampedX) * 105 }
}

export function classifyZone(cx: number, cy: number): string {
  const inBoxWidth = cx >= BOX_L && cx <= BOX_R
  const inSixWidth = cx >= SIX_YARD_L && cx <= SIX_YARD_R
  const wide = cx < BOX_L ? 'wl' : cx > BOX_R ? 'wr' : null
  const sixSide = cx < SIX_YARD_L ? 'l' : cx > SIX_YARD_R ? 'r' : null

  if (cy <= DEPTH.d2) {
    if (!inBoxWidth) return `b2-${wide}`
    if (!inSixWidth) {
      const near = cy <= DEPTH.d1b
      return sixSide === 'l' ? (near ? 'b2-el-n' : 'b2-el-f') : near ? 'b2-er-n' : 'b2-er-f'
    }
    if (cy <= DEPTH.d1) return cx < SIX_T1 ? 'b1-l' : cx < SIX_T2 ? 'b1-m' : 'b1-r'
    if (cy <= DEPTH.d1b) return cx < SIX_T1 ? 'b2-l' : cx < SIX_T2 ? 'b2-m' : 'b2-r'
    return 'b3-c'
  }
  if (cy > DEPTH.d3) return 'b5-c'
  if (!inBoxWidth) return `b4-${wide}`
  if (cy <= DEPTH.d2c) return cx < BOX_T1 ? 'b4-l' : cx < BOX_T2 ? 'b4-m' : 'b4-r'
  return cx < BOX_T1 ? 'b4b-l' : cx < BOX_T2 ? 'b4b-m' : 'b4b-r'
}

export interface ZoneAgg { shots: number; goals: number; xg: number; corners: number; openPlay: number; distSum: number }
function emptyAgg(): ZoneAgg { return { shots: 0, goals: 0, xg: 0, corners: 0, openPlay: 0, distSum: 0 } }

export interface Analysis {
  zones: Record<string, ZoneAgg>
  matches: number
  totalShots: number
  totalGoals: number
  totalXg: number
  totalOnTarget: number
  avgDistance: number
}

export function analyse(shots: ShotEvent[], mode?: ShotMode): Analysis {
  const zones: Record<string, ZoneAgg> = {}
  Object.keys(ZONE_META).forEach((k) => { zones[k] = emptyAgg() })
  const dates = new Set<string>()
  let totalShots = 0, totalGoals = 0, totalXg = 0, totalOnTarget = 0, totalDistSum = 0

  for (const s of shots) {
    if (s.situation === 'Penalty') continue
    dates.add(String(s.kickoff_date))
    const { cx, cy } = toPitch(s.x, s.y, mode)
    const key = classifyZone(cx, cy)
    const z = zones[key]
    const xg = Number(s.xg) || 0
    const dist = distanceYards(s.x, s.y)
    z.shots++; z.xg += xg; z.distSum += dist
    totalShots++; totalXg += xg; totalDistSum += dist
    if (s.result === 'Goal') { z.goals++; totalGoals++ }
    if (s.result === 'Goal' || s.result === 'SavedShot') totalOnTarget++
    if (s.situation === 'FromCorner') z.corners++
    else if (s.situation === 'OpenPlay') z.openPlay++
  }

  return { zones, matches: dates.size, totalShots, totalGoals, totalXg, totalOnTarget, avgDistance: totalShots ? totalDistSum / totalShots : 0 }
}

export function windowShots(shots: ShotEvent[], window: ShotWindow): ShotEvent[] {
  if (window === 'season') return shots
  const n = window === '4gw' ? 4 : 6
  const dates = [...new Set(shots.map((s) => String(s.kickoff_date)))].sort().reverse().slice(0, n)
  const keep = new Set(dates)
  return shots.filter((s) => keep.has(String(s.kickoff_date)))
}

export function venueFilterShots(shots: ShotEvent[], venue: Venue): ShotEvent[] {
  return venue === 'all' ? shots : shots.filter((s) => s.venue === venue)
}

export interface NarrativeOpts { verb: string; shotsNoun: string; goalVerb: string }

/** Auto-generated bullet sentences describing where shots concentrate. */
export function buildNarrative(a: Analysis, subjectName: string, metric: Metric, opts: NarrativeOpts): string[] {
  if (!a.totalShots) return []
  const entries = Object.entries(a.zones).filter(([, z]) => z.shots > 0)
  if (!entries.length) return []
  const mm = METRIC_META[metric]
  const total = a[mm.totalKey]
  const { verb, shotsNoun, goalVerb } = opts
  const lines: string[] = []

  const [topKey, topAgg] = entries.slice().sort((x, y) => y[1][mm.zoneKey] - x[1][mm.zoneKey])[0]
  if (topAgg[mm.zoneKey] > 0 && total > 0) {
    const pct = Math.round((topAgg[mm.zoneKey] / total) * 100)
    lines.push(`${subjectName} ${verb} the most ${mm.noun} from ${ZONE_META[topKey].narrative} — ${mm.fmt(topAgg[mm.zoneKey])} ${mm.unit} (${pct}% of the total).`)
  }

  if (metric !== 'goals' && a.totalGoals > 0) {
    const [topGoalKey, topGoalAgg] = entries.slice().sort((x, y) => y[1].goals - x[1].goals)[0]
    if (topGoalKey !== topKey) {
      lines.push(`Most non-penalty goals ${goalVerb} have come from ${ZONE_META[topGoalKey].narrative} (${topGoalAgg.goals} of ${a.totalGoals}).`)
    }
  }

  const totalCorners = entries.reduce((sum, [, z]) => sum + z.corners, 0)
  if (totalCorners > 0) {
    const pct = Math.round((totalCorners / a.totalShots) * 100)
    lines.push(`${totalCorners} of ${a.totalShots} ${shotsNoun} (${pct}%) have come from corners.`)
  }

  return lines
}

export function tooltipText(key: string, agg: ZoneAgg): { title: string; lines: string[] } {
  const other = agg.shots - agg.corners - agg.openPlay
  const avgDist = agg.shots ? agg.distSum / agg.shots : 0
  return {
    title: ZONE_META[key].name,
    lines: [
      `${agg.shots} shots · ${agg.xg.toFixed(2)} xG · ${agg.goals} goal${agg.goals === 1 ? '' : 's'}`,
      `Avg. distance ${avgDist.toFixed(1)} yd`,
      `Open play ${agg.openPlay} · Corners ${agg.corners}${other > 0 ? ` · Other ${other}` : ''}`,
    ],
  }
}
