import { useEffect, useMemo, useState } from 'react'
import { num } from './rows'
import {
  type PlannerState, type WeekPlan, type Pos, type Chip,
  squadAt, freeTransfers, bankedTransfers, pointsHit, autoLineup,
  subPartners, swapPlayers, isFreeChip, chipAvailable, chipSpentIn, halfOf, MAX_FT,
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
  /** Whether each chip is still playable in the week on screen — a chip is
   *  only spent for the half it was played in. */
  chipOpen: (c: Chip) => boolean
  /** Which gameweek this chip was already spent in, this half. */
  chipSpent: (c: Chip) => number | null
  /** 1 before GW20, 2 after — the two chip sets. */
  half: 1 | 2
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
  /** Put a player on the market without naming a replacement. His fee lands
   *  in the bank straight away, which is the whole point: two sales pool
   *  their money and buy something neither could have afforded alone. */
  sell: (el: number) => void
  /** Players sold this week and not yet replaced. */
  pendingOut: number[]
  /** Fill an empty place with this player — why not, or null if he fits. */
  canFill: (inEl: number) => string | null
  /** Sign him into the empty place of his position. */
  fill: (inEl: number) => void
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

  const pendingOut = week ? week.transfers.filter((t) => t.in == null).map((t) => t.out) : []

  /** The squad as it will be once every empty place is filled — what the club
   *  cap has to be judged against, since a sold player's slot is going to be
   *  taken by whoever comes in. */
  const canFill = (inEl: number): string | null => {
    if (!week) return 'No gameweek in view'
    if (squad.includes(inEl)) return 'Already in your squad'
    // Selling a player takes him out of the squad, which briefly made him
    // look like a signing — the list offered him for his own empty place and
    // the transfer resolved to out === in, costing a move and changing
    // nothing. Keeping him is what that action is called.
    if (pendingOut.includes(inEl)) return 'You just sold him — keep him instead'
    const openHere = pendingOut.filter((e) => posOf(e) === posOf(inEl))
    if (!openHere.length) return `No empty ${posOf(inEl)} place — sell one first`
    const clubs = squad.filter((e) => teamOf(e) === teamOf(inEl)).length
    if (clubs >= MAX_PER_CLUB) return `Max ${MAX_PER_CLUB} from that club`
    if (spend + priceOf(inEl) > BUDGET + 1e-9) return `£${(BUDGET - spend).toFixed(1)}m in the bank`
    return null
  }

  const canReplace = (outEl: number, inEl: number): string | null => {
    if (squad.includes(inEl)) return 'Already in your squad'
    if (pendingOut.includes(inEl)) return 'You just sold him — keep him instead'
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
    chipOpen: (c: Chip) => chipAvailable(state, c, gw),
    chipSpent: (c: Chip) => chipSpentIn(state, c, gw),
    half: halfOf(gw),
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
    pendingOut,
    canFill,
    sell: (el: number) => {
      if (!week || week.transfers.some((t) => t.out === el)) return
      // The card stays on the pitch, greyed, so the shape of the team is
      // still readable while you decide who takes his place.
      persist({
        ...state,
        weeks: {
          ...state.weeks,
          [gw]: {
            ...week,
            transfers: [...week.transfers, { out: el, in: null }],
            captain: week.captain === el ? null : week.captain,
            vice: week.vice === el ? null : week.vice,
          },
        },
      })
    },
    fill: (inEl: number) => {
      if (!week || canFill(inEl)) return
      const outEl = pendingOut.find((e) => posOf(e) === posOf(inEl))
      if (outEl == null) return
      commit(gw, {
        ...week,
        transfers: week.transfers.map((t) => (t.out === outEl ? { ...t, in: inEl } : t)),
      }, outEl, inEl)
    },
    doTransfer: (outEl: number, inEl: number) => {
      if (!week || canReplace(outEl, inEl)) return
      commit(gw, {
        ...week,
        transfers: [...week.transfers.filter((t) => t.out !== outEl), { out: outEl, in: inEl }],
      }, outEl, inEl)
    },
    undoTransfer: (outEl: number) => {
      if (!week) return
      const t = week.transfers.find((x) => x.out === outEl)
      if (!t) return
      // Undoing a sale that never completed just drops it; undoing a finished
      // swap has to put the original man back everywhere he was replaced.
      if (t.in == null) {
        persist({ ...state, weeks: { ...state.weeks, [gw]: { ...week, transfers: week.transfers.filter((x) => x.out !== outEl) } } })
        return
      }
      commit(gw, { ...week, transfers: week.transfers.filter((x) => x.out !== outEl) }, t.in, outEl)
    },
  }

  /** Write a transfer into `gw` **and every week after it**.
   *
   *  A transfer isn't a one-week substitution — the player stays until you
   *  sell him. Weeks after this one may already have been materialised (you
   *  looked ahead, then came back to make the move), and those lineups still
   *  name the player who just left. Patching only the current week left him
   *  on the pitch in GW4 after being sold in GW3, which is what this fixes. */
  function commit(from: number, current: WeekPlan, outEl: number, inEl: number) {
    const swap = (e: number) => (e === outEl ? inEl : e)
    const weeks: Record<number, WeekPlan> = { ...state.weeks, [from]: replaceIn(current, swap) }
    for (const key of Object.keys(state.weeks)) {
      const g = Number(key)
      if (g <= from) continue
      const w = state.weeks[g]
      weeks[g] = {
        ...replaceIn(w, swap),
        // A later week that sold the departing player now sells his
        // replacement instead, and one that had already bought him is
        // dropped as a duplicate.
        transfers: w.transfers
          .filter((t) => t.in !== inEl)
          .map((t) => (t.out === outEl ? { ...t, out: inEl } : t)),
      }
    }
    persist({ ...state, weeks })
  }
}

const replaceIn = (w: WeekPlan, swap: (e: number) => number): WeekPlan => ({
  ...w,
  xi: w.xi.map(swap),
  bench: w.bench.map(swap),
  captain: w.captain == null ? null : swap(w.captain),
  vice: w.vice == null ? null : swap(w.vice),
})

export { isFreeChip }
