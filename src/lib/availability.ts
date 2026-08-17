import { useMemo } from 'react'
import { useLazyTable } from './useData'
import { minuteShares, seatFitness, type MinuteShare, type Shirts } from './minutes'

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
  /** GKP | DEF | MID | FWD, from the FPL squad list. */
  pos?: string
  /** Transfers in and out this gameweek, and the price move they have already
   *  caused (in tenths of a million). FPL publishes all three; it does not
   *  publish the threshold for the NEXT move, so nothing here is a forecast. */
  tin?: number
  tout?: number
  dprice?: number
  /** Today's price in millions, and today's ownership percentage. */
  price?: number
  own?: number
  pen_order?: number
  corner_order?: number
  fk_order?: number
}
export interface AvailEvent { gw: number; deadline: string; finished: boolean }
/** One fixture: gameweek, home/away FPL team ids, kickoff time. */
export interface AvailFixture {
  gw: number; h: number; a: number; k: string
  /** Final score, present only once the game is finished. */
  hs?: number; as?: number
}

/** A club's record and recent results, built from finished fixtures. */
export interface TeamRecord {
  played: number; won: number; drawn: number; lost: number
  gf: number; ga: number; pts: number
  /** Oldest first, most recent last — the way form is read. */
  form: ('W' | 'D' | 'L')[]
  /** 1–20 on points, then goal difference, then goals scored. */
  pos: number
}
interface AvailFile { generated_at: string; events: AvailEvent[]; players: AvailPlayer[]; fixtures?: AvailFixture[] }

export interface Availability {
  /** Expected START and APPEARANCE share for this season, allocated across
   *  each club's squad rather than read off last season's per-player history.
   *  Empty until both availability and the model are loaded, in which case
   *  every caller falls back to the history it always used. See lib/minutes. */
  shares: Map<number, MinuteShare>
  byElement: Map<number, AvailPlayer>
  byCode: Map<number, AvailPlayer>
  deadlines: Map<number, Date>
  /** `${teamId}:${gw}` → that team's kickoff times in the gameweek. */
  kickoffs: Map<string, Date[]>
  /** Every fixture in the season, scores included where played. */
  fixtures: AvailFixture[]
  /** FPL team id → record and form. Empty until the first game is played. */
  table: Map<number, TeamRecord>
  generatedAt: string | null
}

const EMPTY: Availability = { shares: new Map(), byElement: new Map(), byCode: new Map(), deadlines: new Map(), kickoffs: new Map(), fixtures: [], table: new Map(), generatedAt: null }

export function useAvailability(): Availability {
  const q = useLazyTable<AvailFile>('availability')
  /* The historical prior and the shirt counts, both already in the shared
     table cache — xp_model is on the wire for the projection regardless, so
     this is a map lookup rather than a second fetch. Read here rather than
     passed in because availability is threaded to every projection call site
     already and the model is not. */
  const xp = useLazyTable<{ players?: { code: number; p60?: number; ppl?: number; club?: string }[]; shirts?: Record<string, Shirts> }>('xp_model')
  /* The squad list, for the club each player is at NOW — availability carries
     a numeric FPL team id and the model carries a short code, so one of them
     has to be translated before they can be compared. */
  const teams = useLazyTable<{ short_name?: string }[]>('teams')
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
    /* THE SQUAD, NOT THE RATED SUBSET. Built from availability's 587 rows
       rather than the model's 342: the rating floor drops backups, and a
       backup who takes no shirt still has to be in the group or the players
       above him inherit minutes that in reality go to him. */
    const hist = new Map<number, { p60?: number; ppl?: number; club?: string }>()
    for (const p of xp.data?.players ?? []) hist.set(p.code, p)
    const shirts = xp.data?.shirts
    const shares = shirts
      ? minuteShares(
        d.players.map((p) => ({
          code: p.code,
          team: p.team ?? 0,
          pos: p.pos ?? '',
          price: p.price,
          own: p.own,
          fitness: seatFitness(p),
          p60: hist.get(p.code)?.p60,
          ppl: hist.get(p.code)?.ppl,
          sameClub: (() => {
            const was = hist.get(p.code)?.club
            if (!was || p.team == null) return true
            const now = teams.data?.[p.team - 1]?.short_name
            return now == null ? true : was === now
          })(),
        })),
        shirts,
      )
      : new Map<number, MinuteShare>()

    return { shares, byElement, byCode, deadlines, kickoffs, fixtures: d.fixtures ?? [], table: buildTable(d.fixtures ?? []), generatedAt: d.generated_at ?? null }
  }, [q.data, xp.data, teams.data])
}

/** The league table and each club's last five, from finished fixtures.
 *
 *  Derived here rather than shipped as its own file because the fixtures are
 *  already on the wire for the kickoff times — the scores ride along with
 *  them. Returns an empty map before a ball is kicked, which is the correct
 *  answer in August: there is no form yet, and inventing one from last season
 *  would be worse than showing nothing. */
function buildTable(fixtures: AvailFixture[]): Map<number, TeamRecord> {
  const t = new Map<number, TeamRecord>()
  const get = (id: number): TeamRecord => {
    let r = t.get(id)
    if (!r) { r = { played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, pts: 0, form: [], pos: 0 }; t.set(id, r) }
    return r
  }
  // Chronological, so `form` ends up oldest-first without a second sort.
  const played = fixtures.filter((f) => f.hs != null && f.as != null).sort((a, b) => (a.k < b.k ? -1 : 1))
  for (const f of played) {
    const hs = f.hs as number, as = f.as as number
    for (const [id, mine, theirs] of [[f.h, hs, as], [f.a, as, hs]] as const) {
      const r = get(id)
      r.played += 1; r.gf += mine; r.ga += theirs
      if (mine > theirs) { r.won += 1; r.pts += 3; r.form.push('W') }
      else if (mine === theirs) { r.drawn += 1; r.pts += 1; r.form.push('D') }
      else { r.lost += 1; r.form.push('L') }
    }
  }
  const order = [...t.entries()].sort((a, b) =>
    b[1].pts - a[1].pts || (b[1].gf - b[1].ga) - (a[1].gf - a[1].ga) || b[1].gf - a[1].gf)
  order.forEach(([, r], i) => { r.pos = i + 1 })
  return t
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

/** Plain English for FPL's status letter. */
export const STATUS_WORD: Record<string, string> = {
  i: 'Injured', s: 'Suspended', d: 'A doubt', u: 'Unavailable', n: 'Not eligible',
}

/** The first gameweek he's expected back for, walking forward from `fromGw`.
 *
 *  This is the fact a manager actually wants and FPL never states: the news
 *  says "Expected back 22 Aug", and what that means for your team is which
 *  gameweek you get him for. It reuses the same date-against-kickoff rule the
 *  projection uses, so the card and the points can't disagree. Null when he
 *  isn't back inside the window, or when there's no date to go on. */
export function returnsInGw(p: AvailPlayer | null, a: Availability, fromGw: number, within = 12): number | null {
  if (!p || p.status === 'a') return null
  for (let g = fromGw; g < fromGw + within; g++) {
    if (availabilityFactor(p, g, a) > 0) return g
  }
  return null
}

/** "3 days ago" — how stale the news is, which is half of how much to trust it. */
export function newsAge(iso?: string): string | null {
  if (!iso) return null
  const then = new Date(iso.replace(' ', 'T'))
  if (Number.isNaN(then.getTime())) return null
  const days = Math.floor((Date.now() - then.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 14) return `${days} days ago`
  return `${Math.floor(days / 7)} weeks ago`
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

/** Statuses that mean he is not playing: injured, suspended, unavailable, not
 *  in the squad. A doubt still holds the shirt — most doubts start — so `d` is
 *  deliberately not in here.
 *
 *  Exported because three files were each keeping their own copy of this set,
 *  and they have to agree: if the penalty rule counts a doubt as absent while
 *  the team-news list counts him as present, the page promotes a deputy over a
 *  man it is simultaneously showing as playing. */
export const OUT_STATUS: ReadonlySet<string> = new Set(['i', 's', 'u', 'n'])
export const notPlaying = (status: string | null | undefined): boolean =>
  OUT_STATUS.has(String(status ?? 'a'))

export interface PenaltyDuty {
  /** The man who actually takes them this week. */
  taker: AvailPlayer
  /** The first choice he is standing in for — null when he IS first choice. */
  deputisingFor: AvailPlayer | null
}

/** Who takes this club's penalties this week.
 *
 *  FPL publishes the club's stated ORDER, not who is fit, and it does not
 *  re-rank when someone gets hurt: Kroupi Jr stayed listed as Bournemouth's
 *  first choice through a foot injury that ruled him out for months. Reading
 *  `pen_order === 1` therefore answers "who is first choice", which is a
 *  question nobody is asking — what a manager wants to know before a deadline
 *  is who is standing over the ball on Saturday.
 *
 *  So: walk the queue and take the first man who is available. The caller is
 *  told who he is deputising for, because "Kluivert takes the penalties" and
 *  "Kluivert takes them while Kroupi Jr is out" are different claims and only
 *  one of them is true. Null when the club lists no takers, or when every man
 *  in the queue is unavailable. */
export function penaltyDuty(avail: Availability, teamId: number): PenaltyDuty | null {
  const queue: AvailPlayer[] = []
  for (const p of avail.byElement.values()) {
    if (p.team === teamId && p.pen_order != null) queue.push(p)
  }
  if (!queue.length) return null
  queue.sort((a, b) => (a.pen_order ?? 0) - (b.pen_order ?? 0))
  const i = queue.findIndex((p) => !notPlaying(p.status))
  if (i < 0) return null
  return { taker: queue[i], deputisingFor: i > 0 ? queue[0] : null }
}

/** True when this player is the man on penalties for his club this week —
 *  first choice, or first choice by promotion. The question every caller
 *  actually means when it reaches for `pen_order === 1`. */
export function onPenalties(avail: Availability, p: AvailPlayer | null): boolean {
  if (!p || p.team == null) return false
  return penaltyDuty(avail, p.team)?.taker.element === p.element
}
