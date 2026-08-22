import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PlannerState } from './planner'

/* ════════════════════════════════════════════════════════════════════════
   More than one squad.

   The builder held exactly one fifteen in `fpl_squad_build` and one plan in
   `fpl_planner`, and changing the fifteen wiped the plan. This makes the
   fifteen a LIST — build one, name it, keep it, start another — so that two
   ideas can exist at once and be compared rather than remembered.

   WHAT IS STORED HERE AND WHAT IS NOT. A plan record carries its name and
   its base fifteen; the week-by-week decisions stay where they already live,
   in the planner's own state, under a key scoped to the plan id. That split
   is deliberate: the library has to be cheap to read (it renders every card
   on every page load) and the weeks are the big part. It also means
   `usePlanner` needed one new prop rather than a rewrite.

   No account, and none needed. This is localStorage, so it costs nothing,
   works offline, and is per-device — which is the real trade. Moving a plan
   between devices is a share-code problem, the same one squad import already
   solves, not a reason to build sign-in.
   ════════════════════════════════════════════════════════════════════════ */

const STORE = 'fpl_plans'
/** The single-squad keys this replaces. Read once, on migration, never after. */
const LEGACY_SQUAD = 'fpl_squad_build'
const LEGACY_WEEKS = 'fpl_planner'

export const MAX_PLANS = 8

export interface StoredPlan {
  id: string
  name: string
  /** The fifteen as picked for `startGw`. */
  base: number[]
  updated: number
}

interface Library {
  plans: StoredPlan[]
  activeId: string | null
  /** Which plans are ticked for comparison. Kept here so the choice survives
   *  a reload — you tick two, wander off to change one, and come back. */
  compare: string[]
}

/** The planner's week store for a given plan. Exported because deleting a
 *  plan has to take its weeks with it, and because usePlanner reads it. */
export const weeksKey = (id: string) => `${LEGACY_WEEKS}:${id}`

const EMPTY: Library = { plans: [], activeId: null, compare: [] }

// Date.now is fine here — this is a user action in a browser, not a workflow
// script, and the timestamp is only ever shown back as "edited 2 hours ago".
const newId = () => `p${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`

function read(): Library {
  try {
    const raw = localStorage.getItem(STORE)
    if (raw) {
      const v = JSON.parse(raw) as Library
      if (Array.isArray(v?.plans)) {
        return { plans: v.plans, activeId: v.activeId ?? v.plans[0]?.id ?? null, compare: v.compare ?? [] }
      }
    }
  } catch { /* private mode, or something else wrote here */ }
  return migrate()
}

/** First run after the update: fold whatever the single-squad build held into
 *  a plan called "Plan 1", weeks and all, so nobody loses a squad to a
 *  refactor. An empty build migrates to an empty library, not to a plan
 *  containing nothing — a card for a squad you never made is clutter. */
function migrate(): Library {
  try {
    const raw = localStorage.getItem(LEGACY_SQUAD)
    const base = raw ? (JSON.parse(raw) as number[]) : []
    if (!Array.isArray(base) || !base.length) return EMPTY
    const id = newId()
    const lib: Library = {
      plans: [{ id, name: 'Plan 1', base, updated: Date.now() }],
      activeId: id,
      compare: [],
    }
    // Carry the week decisions across under the new key. If this throws we
    // still have the squad, which is the part that took work to build.
    try {
      const weeks = localStorage.getItem(LEGACY_WEEKS)
      if (weeks) localStorage.setItem(weeksKey(id), weeks)
    } catch { /* ignore */ }
    write(lib)
    return lib
  } catch {
    return EMPTY
  }
}

function write(lib: Library) {
  try { localStorage.setItem(STORE, JSON.stringify(lib)) } catch { /* private mode */ }
}

export interface Plans {
  plans: StoredPlan[]
  active: StoredPlan | null
  activeId: string | null
  compare: string[]
  setActive: (id: string) => void
  /** Create a plan and make it active. Returns its id. */
  create: (name: string, base: number[]) => string
  duplicate: (id: string) => string | null
  /** Branch a plan at a gameweek: the weeks BEFORE `gw` come across, `gw`
   *  itself and everything after it start empty. Returns the new plan — the
   *  caller needs its name to say what just happened, and asking for it back
   *  out of the library means guessing at the same de-duplication twice. */
  fork: (id: string, gw: number) => StoredPlan | null
  rename: (id: string, name: string) => void
  remove: (id: string) => void
  /** Replace the active plan's fifteen — what the builder calls on every pick. */
  setBase: (base: number[]) => void
  toggleCompare: (id: string) => void
  full: boolean
}

/** Put a squad into the library and make it active, WITHOUT a hook.
 *
 *  My Team needs this. It renders the Squad Builder with your real fifteen,
 *  and the builder reads the library through its own usePlans() — a separate
 *  instance from any the host holds. Seeding through the host's hook writes
 *  localStorage and updates the host's state, but the builder mounted in the
 *  same render keeps the snapshot it read first, so the board comes up empty.
 *  (The storage event that keeps two TABS in step does not fire in the
 *  document that wrote it.) Measured that way round before this was written.
 *
 *  So this is a plain read-modify-write the caller runs BEFORE the builder
 *  mounts, and usePlans picks it up in its own initial read.
 *
 *  `refresh` false leaves an existing plan's fifteen alone — the caller has
 *  decided your edits to it matter more than re-importing the same squad.
 *  Returns the plan's id.
 */
export function ensurePlan(name: string, base: number[], refresh: boolean): string {
  const lib = read()
  const label = name.slice(0, 28)
  const found = lib.plans.find((p) => p.name === label)
  if (found) {
    const next: Library = {
      ...lib,
      activeId: found.id,
      plans: refresh
        ? lib.plans.map((p) => (p.id === found.id ? { ...p, base: [...base], updated: Date.now() } : p))
        : lib.plans,
    }
    write(next)
    return found.id
  }
  const id = newId()
  // At the cap, the least recently edited plan makes way — otherwise your own
  // team could not be imported at all, which is the worse failure.
  const room = lib.plans.length >= MAX_PLANS
    ? [...lib.plans].sort((a, b) => a.updated - b.updated).slice(1)
    : lib.plans
  write({ ...lib, plans: [...room, { id, name: label, base: [...base], updated: Date.now() }], activeId: id })
  return id
}

export function usePlans(): Plans {
  const [lib, setLib] = useState<Library>(() => (typeof window === 'undefined' ? EMPTY : read()))

  const save = useCallback((next: Library) => {
    setLib(next)
    write(next)
  }, [])

  /* A plan edited in another tab is still your plan. Without this, two tabs
     each hold their own copy and the last one to write wins silently. */
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === STORE) setLib(read()) }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const active = useMemo(
    () => lib.plans.find((p) => p.id === lib.activeId) ?? lib.plans[0] ?? null,
    [lib],
  )

  const setActive = useCallback((id: string) => {
    setLib((l) => { const next = { ...l, activeId: id }; write(next); return next })
  }, [])

  const create = useCallback((name: string, base: number[]) => {
    const id = newId()
    setLib((l) => {
      const next: Library = {
        ...l,
        plans: [...l.plans, { id, name: name.slice(0, 28), base: [...base], updated: Date.now() }].slice(0, MAX_PLANS),
        activeId: id,
      }
      write(next)
      return next
    })
    return id
  }, [])

  const duplicate = useCallback((id: string) => {
    const src = lib.plans.find((p) => p.id === id)
    if (!src || lib.plans.length >= MAX_PLANS) return null
    const nid = newId()
    // Copy the weeks too. A duplicate that keeps the fifteen but forgets the
    // captain and the chips is not a copy of the plan, it is a copy of the
    // squad — and the whole point is to change one thing about a PLAN.
    try {
      const w = localStorage.getItem(weeksKey(id))
      if (w) localStorage.setItem(weeksKey(nid), w)
    } catch { /* ignore */ }
    const copy: StoredPlan = { id: nid, name: nextName(lib.plans, src.name), base: [...src.base], updated: Date.now() }
    save({ ...lib, plans: [...lib.plans, copy], activeId: nid })
    return nid
  }, [lib, save])

  /* FORK. Duplicate copies a whole plan; a fork copies the part of it you
     have already committed to and leaves the rest empty.

     Everything before `gw` comes across — those transfers are what makes the
     fifteen you are looking at, so dropping them would fork a different squad
     — and `gw` itself does not, because the week you are standing in is the
     week you want to answer differently. Copying it forward would hand you
     two plans that look different in the bar and behave identically until you
     noticed, which is the bug the duplicated-plans work already fixed once.

     `base` is copied unchanged: the weeks that survive replay against it, so
     the fork enters `gw` with exactly the fifteen the original had. */
  const fork = useCallback((id: string, gw: number) => {
    const src = lib.plans.find((p) => p.id === id)
    if (!src || lib.plans.length >= MAX_PLANS) return null
    const nid = newId()
    try {
      const raw = localStorage.getItem(weeksKey(id))
      if (raw) {
        const s = JSON.parse(raw) as PlannerState
        const weeks: PlannerState['weeks'] = {}
        for (const k of Object.keys(s.weeks ?? {})) {
          if (Number(k) < gw) weeks[Number(k)] = s.weeks[Number(k)]
        }
        localStorage.setItem(weeksKey(nid), JSON.stringify({ ...s, weeks }))
      }
    } catch { /* ignore — a fork with no weeks is still a usable plan */ }
    const copy: StoredPlan = {
      id: nid, name: forkName(lib.plans, src.name, gw), base: [...src.base], updated: Date.now(),
    }
    save({ ...lib, plans: [...lib.plans, copy], activeId: nid })
    return copy
  }, [lib, save])

  const rename = useCallback((id: string, name: string) => {
    setLib((l) => {
      const next = {
        ...l,
        plans: l.plans.map((p) => (p.id === id ? { ...p, name: name.slice(0, 28) || p.name, updated: Date.now() } : p)),
      }
      write(next)
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    try { localStorage.removeItem(weeksKey(id)) } catch { /* ignore */ }
    setLib((l) => {
      const plans = l.plans.filter((p) => p.id !== id)
      const next: Library = {
        ...l,
        plans,
        activeId: l.activeId === id ? (plans[0]?.id ?? null) : l.activeId,
        compare: l.compare.filter((c) => c !== id),
      }
      write(next)
      return next
    })
  }, [])

  const setBase = useCallback((base: number[]) => {
    setLib((l) => {
      if (!l.activeId) {
        // Picking a player with no plan open creates one rather than dropping
        // it on the floor — the first-run path for a brand new visitor.
        const id = newId()
        const next: Library = {
          plans: [{ id, name: 'Plan 1', base: [...base], updated: Date.now() }],
          activeId: id,
          compare: [],
        }
        write(next)
        return next
      }
      const cur = l.plans.find((p) => p.id === l.activeId)
      if (cur && cur.base.join(',') === base.join(',')) return l
      const next = {
        ...l,
        plans: l.plans.map((p) => (p.id === l.activeId ? { ...p, base: [...base], updated: Date.now() } : p)),
      }
      write(next)
      return next
    })
  }, [])

  const toggleCompare = useCallback((id: string) => {
    setLib((l) => {
      const on = l.compare.includes(id)
      // Four is where a comparison stops being readable: the week grid runs
      // out of rows and the head-to-head becomes six pairings.
      const compare = on ? l.compare.filter((c) => c !== id)
        : l.compare.length >= 4 ? l.compare : [...l.compare, id]
      const next = { ...l, compare }
      write(next)
      return next
    })
  }, [])

  return {
    plans: lib.plans,
    active,
    activeId: active?.id ?? null,
    compare: lib.compare.filter((id) => lib.plans.some((p) => p.id === id)),
    setActive, create, duplicate, fork, rename, remove, setBase, toggleCompare,
    full: lib.plans.length >= MAX_PLANS,
  }
}

/** "Balanced" forked at GW6 → "Balanced GW6". Forked again at the same week
 *  → "Balanced GW6 2", because two branches off one point is the normal case
 *  and they cannot both be called the same thing. The stem drops any previous
 *  fork suffix, so a fork of a fork is "Balanced GW9", not a name that grows
 *  a gameweek every time. */
function forkName(plans: StoredPlan[], from: string, gw: number): string {
  const stem = from.replace(/\s+\d+$/, '').replace(/\s+GW\d+$/, '').slice(0, 20)
  const first = `${stem} GW${gw}`
  if (!plans.some((p) => p.name === first)) return first
  return nextName(plans, first)
}

/** "Balanced" → "Balanced 2" → "Balanced 3". */
function nextName(plans: StoredPlan[], from: string): string {
  const stem = from.replace(/\s+\d+$/, '')
  for (let n = 2; n < 50; n++) {
    const candidate = `${stem} ${n}`
    if (!plans.some((p) => p.name === candidate)) return candidate
  }
  return `${stem} copy`
}

/** "2 hours ago", for the card. Absolute timestamps on something you edited
 *  twenty minutes ago are a date lookup, not information. */
export function agoOf(ts: number, now = Date.now()): string {
  const s = Math.max(0, (now - ts) / 1000)
  if (s < 90) return 'just now'
  const m = s / 60
  if (m < 60) return `${Math.round(m)} min ago`
  const h = m / 60
  if (h < 24) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}
