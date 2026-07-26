import { useEffect, useMemo, useState } from 'react'
import { num } from './rows'
import {
  type PlannerState, type WeekPlan, type Pos, type Chip,
  squadAt, freeTransfers, bankedTransfers, pointsHit, chipsUsed, autoLineup,
  subPartners, swapPlayers, isFreeChip, MAX_FT,
} from './planner'
import type { FixtureEaseRow, RatingRow } from './types'

/* ════════════════════════════════════════════════════════════════════════
   The planner's state, lifted out of the board.

   Both halves of the Squad Builder need it at once — the pitch renders the
   week, and the player list beside it makes the transfers — so it can't live
   inside either. Everything here is the same engine as before, just owned by
   the page.
   ════════════════════════════════════════════════════════════════════════ */

const BUDGET = 100
const MAX_PER_CLUB = 3
const STORE = 'fpl_planner'

export interface Planner {
  ready: boolean
  gw: number
  gws: number[]
  setGw: (g: number) => void
  startGw: number
  week: WeekPlan | null
  squad: number[]
  /** Free transfers usable this week — Infinity on a wildcard/free hit. */
  ft: number
  /** What the bank holds entering the week, ignoring any chip. */
  banked: number
  hit: number
  usedChips: Set<Chip>
  spend: number
  posOf: (el: number) => Pos
  setWeek: (patch: Partial<WeekPlan>) => void
  setChip: (c: Chip) => void
  makeCaptain: (el: number) => void
  makeVice: (el: number) => void
  autoXI: () => void
  /** Legal swap partners for a player (bench options for a starter, and
   *  vice versa) — the UI highlights these rather than guessing for you. */
  partnersFor: (el: number) => number[]
  swap: (a: number, b: number) => boolean
  canReplace: (outEl: number, inEl: number) => string | null
  doTransfer: (outEl: number, inEl: number) => void
  undoTransfer: (outEl: number) => void
}

export function usePlanner({ base, byEl, startGw, fixtureEase }: {
  base: number[]
  byEl: Map<number, RatingRow>
  startGw: number
  fixtureEase: FixtureEaseRow[]
}): Planner {
  const posOf = (el: number) => String(byEl.get(el)?.position ?? 'MID') as Pos
  const ratingOf = (el: number) => (num(byEl.get(el) ?? {}, 'season_overall_score') ?? 0) * 20
  const priceOf = (el: number) => num(byEl.get(el) ?? {}, 'price') ?? 0
  const teamOf = (el: number) => String(byEl.get(el)?.team ?? '')

  const gws = useMemo(
    () => [...new Set(fixtureEase.map((f) => f.gw))].filter((g) => g >= startGw).sort((a, b) => a - b),
    [fixtureEase, startGw],
  )
  const [gw, setGw] = useState(startGw)
  const sig = base.join(',')
  const ready = base.length === 15

  const [state, setState] = useState<PlannerState>(() => {
    try {
      const raw = localStorage.getItem(STORE)
      if (raw) { const s = JSON.parse(raw); if (s.base?.join(',') === sig) return s }
    } catch { /* ignore */ }
    return { base: [...base], startGw, weeks: {} }
  })
  const persist = (s: PlannerState) => {
    setState(s)
    try { localStorage.setItem(STORE, JSON.stringify(s)) } catch { /* private mode */ }
  }

  // Rebuild from scratch when the base fifteen changes underneath us.
  useEffect(() => {
    if (state.base.join(',') !== sig) persist({ base: [...base], startGw, weeks: {} })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig])

  // Materialise the week being viewed: carry the previous lineup forward when
  // those players are all still here, else auto-pick the best legal eleven.
  useEffect(() => {
    if (!ready || state.weeks[gw] || state.base.join(',') !== sig) return
    const squad = squadAt(state, gw)
    const prevGw = Object.keys(state.weeks).map(Number).filter((g) => g < gw).sort((a, b) => b - a)[0]
    const prev = prevGw != null ? state.weeks[prevGw] : undefined
    const week: WeekPlan = prev && prev.xi.length === 11 && [...prev.xi, ...prev.bench].every((e) => squad.includes(e))
      ? { transfers: [], xi: [...prev.xi], bench: [...prev.bench], captain: prev.captain, vice: prev.vice, chip: null }
      : { transfers: [], ...autoLineup(squad, posOf, ratingOf), chip: null }
    persist({ ...state, weeks: { ...state.weeks, [gw]: week } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gw, state, ready, sig])

  const week = (ready && state.weeks[gw]) || null
  const squad = useMemo(() => squadAt(state, gw), [state, gw])
  const spend = squad.reduce((s, e) => s + priceOf(e), 0)

  const setWeek = (patch: Partial<WeekPlan>) => {
    if (!week) return
    persist({ ...state, weeks: { ...state.weeks, [gw]: { ...week, ...patch } } })
  }

  const canReplace = (outEl: number, inEl: number): string | null => {
    if (squad.includes(inEl)) return 'Already in your squad'
    if (posOf(inEl) !== posOf(outEl)) return `Must be a ${posOf(outEl)}`
    const clubs = squad.filter((e) => teamOf(e) === teamOf(inEl) && e !== outEl).length
    if (clubs >= MAX_PER_CLUB) return `Max ${MAX_PER_CLUB} from that club`
    if (spend - priceOf(outEl) + priceOf(inEl) > BUDGET + 1e-9) return 'Over budget'
    return null
  }

  return {
    ready, gw, gws, setGw, startGw, week, squad, posOf, spend,
    ft: freeTransfers(state, gw),
    banked: Math.min(MAX_FT, bankedTransfers(state, gw)),
    hit: pointsHit(state, gw),
    usedChips: chipsUsed(state),
    setWeek,
    setChip: (c: Chip) => setWeek({ chip: week?.chip === c ? null : c }),
    makeCaptain: (el: number) => setWeek({ captain: el, vice: week?.vice === el ? week?.captain ?? null : week?.vice ?? null }),
    makeVice: (el: number) => setWeek({ vice: el, captain: week?.captain === el ? week?.vice ?? null : week?.captain ?? null }),
    autoXI: () => setWeek({ ...autoLineup(squad, posOf, ratingOf) }),
    partnersFor: (el: number) => (week ? subPartners(el, week.xi, week.bench, posOf) : []),
    swap: (a: number, b: number) => {
      if (!week) return false
      const res = swapPlayers(a, b, week.xi, week.bench, posOf)
      if (!res) return false
      // Captaincy can't sit on the bench: hand it to the incoming starter.
      const benched = week.xi.includes(a) ? a : b
      const promoted = benched === a ? b : a
      setWeek({
        ...res,
        captain: week.captain === benched ? promoted : week.captain,
        vice: week.vice === benched ? promoted : week.vice,
      })
      return true
    },
    canReplace,
    doTransfer: (outEl: number, inEl: number) => {
      if (!week || canReplace(outEl, inEl)) return
      setWeek({
        transfers: [...week.transfers.filter((t) => t.out !== outEl), { out: outEl, in: inEl }],
        xi: week.xi.map((e) => (e === outEl ? inEl : e)),
        bench: week.bench.map((e) => (e === outEl ? inEl : e)),
        captain: week.captain === outEl ? inEl : week.captain,
        vice: week.vice === outEl ? inEl : week.vice,
      })
    },
    undoTransfer: (outEl: number) => {
      if (!week) return
      const t = week.transfers.find((x) => x.out === outEl)
      if (!t) return
      setWeek({
        transfers: week.transfers.filter((x) => x.out !== outEl),
        xi: week.xi.map((e) => (e === t.in ? outEl : e)),
        bench: week.bench.map((e) => (e === t.in ? outEl : e)),
        captain: week.captain === t.in ? outEl : week.captain,
        vice: week.vice === t.in ? outEl : week.vice,
      })
    },
  }
}

export { isFreeChip }
