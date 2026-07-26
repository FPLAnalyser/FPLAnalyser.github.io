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
  news?: string
  news_added?: string
  chance?: number
  pen_order?: number
  corner_order?: number
  fk_order?: number
}
export interface AvailEvent { gw: number; deadline: string; finished: boolean }
interface AvailFile { generated_at: string; events: AvailEvent[]; players: AvailPlayer[] }

export interface Availability {
  byElement: Map<number, AvailPlayer>
  byCode: Map<number, AvailPlayer>
  deadlines: Map<number, Date>
  generatedAt: string | null
}

const EMPTY: Availability = { byElement: new Map(), byCode: new Map(), deadlines: new Map(), generatedAt: null }

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
    return { byElement, byCode, deadlines, generatedAt: d.generated_at ?? null }
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

const MONTHS: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }

/** The return date FPL buries in the news line — "Expected back 22 Aug",
 *  "Suspended until 30 Aug". Year inferred from the news date: if the month
 *  reads as earlier than when the news was posted, it means next year. */
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
  return new Date(Date.UTC(year, mon, day, 23, 59))
}

/** How much of a player you can expect for a given gameweek, 0–1.
 *
 *  Injured/suspended players with a stated return date score 0 for every
 *  gameweek whose deadline falls before it. With no date, FPL's own
 *  chance-of-playing carries it; with neither, an i/s/u flag means 0 rather
 *  than a hopeful guess. */
export function availabilityFactor(p: AvailPlayer | null, deadline: Date | null): number {
  if (!p || p.status === 'a') return 1
  const back = returnDateFrom(p)
  if (back && deadline) return deadline >= back ? 1 : 0
  if (p.status === 'd') return (p.chance ?? 75) / 100
  if (p.chance != null) return p.chance / 100
  return 0 // i / s / u / n with no date and no stated chance
}

export interface AvailBadgeInfo { label: string; tone: 'bad' | 'warn' | 'flat'; title: string }

/** The chip the UI shows next to a flagged player — null when fully fit. */
export function availBadge(p: AvailPlayer | null): AvailBadgeInfo | null {
  if (!p || p.status === 'a') return null
  const title = p.news || 'No detail from FPL'
  if (p.status === 'i') return { label: 'INJ', tone: 'bad', title }
  if (p.status === 's') return { label: 'SUS', tone: 'bad', title }
  if (p.status === 'd') return { label: `${p.chance ?? '?'}%`, tone: 'warn', title }
  return { label: 'OUT', tone: 'bad', title } // u / n — not available to pick
}
