import { useMemo } from 'react'
import { useLazyTable } from './useData'

/* ════════════════════════════════════════════════════════════════════════
   The live layer: who is actually available, and who takes what — from
   site_data/<season>/availability.json, refreshed daily off the FPL API by
   a scheduled workflow. Everything here degrades to "no data": before the
   first refresh has run the file is absent, no flags show, and no xP is
   zeroed on a guess.
   ════════════════════════════════════════════════════════════════════════ */

export interface AvailPlayer {
  element: number
  code: number
  /** FPL's own letter: a available · d doubtful · i injured · s suspended ·
   *  u unavailable (e.g. left the league) · n not eligible */
  status: string
  /** FPL team id — keys into the fixtures list. */
  team?: number
  news?: string
  news_added?: string
  chance?: number
  /** Today's price in millions, and today's ownership percentage. */
  price?: number
  own?: number
  pen_order?: number
  corner_order?: number
  fk_order?: number
}
export interface AvailEvent { gw: number; deadline: string; finished: boolean }
/** One fixture: gameweek, home/away FPL team ids, kickoff time. */
export interface AvailFixture { gw: number; h: number; a: number; k: string }
interface AvailFile { generated_at: string; events: AvailEvent[]; players: AvailPlayer[]; fixtures?: AvailFixture[] }

export interface Availability {
  byElement: Map<number, AvailPlayer>
  byCode: Map<number, AvailPlayer>
  deadlines: Map<number, Date>
  /** `${teamId}:${gw}` → that team's kickoff times in the gameweek. */
  kickoffs: Map<string, Date[]>
  generatedAt: string | null
}

const EMPTY: Availability = { byElement: new Map(), byCode: new Map(), deadlines: new Map(), kickoffs: new Map(), generatedAt: null }

export function useAvailability(): Availability {
  const q = useLazyTable<AvailFile>('availability')
  return useMemo(() => {
    const d = q.data as AvailFile | null
    if (!d || !Array.isArray(d.players)) return EMPTY
    const byElement = new Map<number, AvailPlayer>()
    const byCode = new Map<number, AvailPlayer>()
    for (const p of d.players) {
      byElement.set(p.element, p)
      byCode.set(p.code, p)
    }
    const deadlines = new Map<number, Date>()
    for (const e of d.events ?? []) deadlines.set(e.gw, new Date(e.deadline))
    const kickoffs = new Map<string, Date[]>()
    for (const f of d.fixtures ?? []) {
      const when = new Date(f.k)
      for (const team of [f.h, f.a]) {
        const key = `${team}:${f.gw}`
        kickoffs.set(key, [...(kickoffs.get(key) ?? []), when])
      }
    }
    return { byElement, byCode, deadlines, kickoffs, generatedAt: d.generated_at ?? null }
  }, [q.data])
}

/** Look a player up by element id, falling back to the permanent code —
 *  element ids change each season, codes don't. */
export function availFor(a: Availability, element?: number | null, code?: number | null): AvailPlayer | null {
  if (element != null) {
    const hit = a.byElement.get(Number(element))
    if (hit) return hit
  }
  if (code != null) {
    const hit = a.byCode.get(Number(code))
    if (hit) return hit
  }
  return null
}

/** Overlay this morning's price and ownership onto the season build.
 *
 *  The ratings table is a season-history job; price settles nightly around
 *  01:30 UTC and ownership drifts all week. Left alone, a squad could be
 *  costed at last month's prices and the template read judged on last
 *  month's crowd. Where the live feed has a player, it wins; where it
 *  doesn't, nothing changes. */
export function withLivePrices<T extends { element?: unknown; code?: unknown }>(rows: T[], a: Availability): T[] {
  if (!a.byElement.size) return rows
  let changed = false
  const out = rows.map((r) => {
    const live = availFor(a, Number(r.element), Number(r.code))
    if (!live || (live.price == null && live.own == null)) return r
    const next = { ...r } as T & { price?: number; selected_by_percent?: number }
    if (live.price != null) next.price = live.price
    if (live.own != null) next.selected_by_percent = live.own
    changed = changed || next.price !== (r as { price?: number }).price
      || next.selected_by_percent !== (r as { selected_by_percent?: number }).selected_by_percent
    return next as T
  })
  return changed ? out : rows
}

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

/** The return date FPL buries in the news line — "Expected back 22 Aug",
 *  "Suspended until 6 Sep". Crucially, that date IS a fixture date: it names
 *  the game the player is expected back FOR, not a recovery day he sits out.
 *  Returned as midnight UTC so any kickoff on that calendar day counts as
 *  available. Year inferred from the news date: if the month reads as earlier
 *  than when the news was posted, it means next year. */
export function returnDateFrom(p: AvailPlayer | null): Date | null {
  if (!p?.news) return null
  const m = /(?:back|until)\s+(\d{1,2})\s+([A-Za-z]{3})/i.exec(p.news)
  if (!m) return null
  const day = Number(m[1])
  const mon = MONTHS[m[2].toLowerCase()]
  if (mon == null || !(day >= 1 && day <= 31)) return null
  const anchor = p.news_added ? new Date(p.news_added) : new Date()
  let year = anchor.getFullYear()
  if (mon < anchor.getMonth() - 1) year += 1
  return new Date(Date.UTC(year, mon, day))
}

/** How much of a player you can expect for a given gameweek, 0–1.
 *
 *  A stated return date is matched against the player's team's kickoff in
 *  that gameweek — he plays the fixture on that date, so "Suspended until
 *  6 Sep" keeps a player OUT of every week whose game falls before 6 Sep and
 *  IN for the week whose game is on it. Without fixture data the gameweek
 *  deadline stands in (conservative by at most the boundary week). With no
 *  date at all, FPL's own chance-of-playing carries it; with neither, an
 *  i/s/u flag means 0 rather than a hopeful guess. */
export function availabilityFactor(p: AvailPlayer | null, gw: number, a: Availability): number {
  if (!p || p.status === 'a') return 1
  const back = returnDateFrom(p)
  if (back) {
    const kicks = p.team != null ? a.kickoffs.get(`${p.team}:${gw}`) : undefined
    if (kicks?.length) return kicks.some((k) => k >= back) ? 1 : 0
    const deadline = a.deadlines.get(gw)
    if (deadline) return deadline >= back ? 1 : 0
  }
  if (p.status === 'd') return (p.chance ?? 75) / 100
  if (p.chance != null) return p.chance / 100
  return 0 // i / s / u / n with no date and no stated chance
}

/** How badly a flag hurts, on FPL's own three-step scale.
 *  1 yellow — 75% chance, a knock he should shake off
 *  2 amber  — 25–50%, a real doubt
 *  3 red    — nought, suspended, or otherwise not playing            */
export type AvailSeverity = 1 | 2 | 3

/** One ramp for the whole site, so a colour means the same thing on the pitch,
 *  in the transfer list and on a player page. Tuned for the dark player card,
 *  which is where they mostly live. */
export const SEV_COLOUR: Record<AvailSeverity, { bar: string; chip: string; ink: string }> = {
  1: { bar: '#F5CE3E', chip: '#F5CE3E', ink: '#231A00' },
  2: { bar: '#E88C21', chip: '#E88C21', ink: '#231400' },
  3: { bar: '#D9453C', chip: '#D9453C', ink: '#FFFFFF' },
}

export interface AvailBadgeInfo {
  label: string
  tone: 'bad' | 'warn' | 'flat'
  sev: AvailSeverity
  title: string
}

/** The chip the UI shows next to a flagged player — null when fully fit.
 *
 *  Colour carries how likely he is to play; the label carries why. Both are
 *  needed: a suspension and a knock are both red and are not the same
 *  problem, and red against amber is the one pair a colour-blind reader is
 *  most likely to lose. */
export function availBadge(p: AvailPlayer | null): AvailBadgeInfo | null {
  if (!p || p.status === 'a') return null
  const title = p.news || 'No detail from FPL'
  // Suspension is certain whatever chance the feed does or doesn't state.
  if (p.status === 's') return { label: 'SUS', tone: 'bad', sev: 3, title }
  const chance = p.chance ?? (p.status === 'd' ? 75 : 0)
  const sev: AvailSeverity = chance >= 75 ? 1 : chance >= 25 ? 2 : 3
  const tone = sev === 3 ? 'bad' : 'warn'
  if (p.status === 'i') return { label: chance > 0 ? `${chance}%` : 'INJ', tone, sev, title }
  if (p.status === 'd') return { label: `${chance}%`, tone, sev, title }
  return { label: 'OUT', tone: 'bad', sev: 3, title } // u / n — not available to pick
}
