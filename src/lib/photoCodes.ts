// Live photo-code override.
//
// The pipeline's stored `code` per player is a point-in-time snapshot and can
// be stale for recently-transferred or newly-added players (wrong kit, or no
// image at that code) — while the live FPL API always has the current code.
// We fetch bootstrap-static once (best effort, on the user's device where the
// FPL API is reachable) and map element id -> current code.
//
// SAFETY: our data is an end-of-season snapshot; the live API could already be
// on a new season with reassigned element ids. So we only trust the live map
// if it AGREES with our own (element -> code) pairs for most players. High
// agreement = same element space (the few disagreements are exactly the stale
// codes we want to fix); low agreement = a different season -> discard.

import { fplFetch } from './api'

const SS_KEY = 'fpl_live_codes_v1'
let codes: Map<number, number> | null = null
let started = false
let version = 0
const listeners = new Set<() => void>()

function notify() {
  version += 1
  for (const l of listeners) l()
}

/** Best-effort, one-shot load of current FPL photo codes. Idempotent. */
export function ensureLiveCodes(ourPairs: [number, number][]) {
  if (started) return
  started = true

  try {
    const raw = sessionStorage.getItem(SS_KEY)
    if (raw) {
      codes = new Map<number, number>(JSON.parse(raw))
      notify()
    }
  } catch {
    /* ignore */
  }

  ;(async () => {
    try {
      const res = await fplFetch('https://fantasy.premierleague.com/api/bootstrap-static/')
      const data = await res.json()
      const live = new Map<number, number>()
      for (const el of data?.elements ?? []) {
        if (el?.id != null && el?.code != null) live.set(Number(el.id), Number(el.code))
      }
      if (live.size < 50) return

      // Agreement gate — is the live element space the same as ours?
      let checked = 0
      let agree = 0
      for (const [element, code] of ourPairs) {
        const lv = live.get(element)
        if (lv == null) continue
        checked += 1
        if (lv === code) agree += 1
      }
      if (checked < 20 || agree / checked < 0.6) return // different season / not trustworthy

      codes = live
      try {
        sessionStorage.setItem(SS_KEY, JSON.stringify([...live]))
      } catch {
        /* ignore */
      }
      notify()
    } catch {
      /* keep stored codes as the fallback */
    }
  })()
}

export function subscribeLiveCodes(cb: () => void) {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
export function liveCodesVersion() {
  return version
}

/** Current FPL photo code for an element id, or the pipeline fallback. */
export function liveCodeFor(element: number | null | undefined, fallback: number | null | undefined): number | null {
  if (element != null && codes?.has(element)) return codes.get(element) as number
  return fallback ?? null
}
