/* Live gameweek scores, while the football is actually on.
 *
 * WHY THIS EXISTS ALONGSIDE THE STORED FILE. site_data/<season>/actuals/gw<N>.json
 * is the durable record: the scheduled job pulls the same FPL endpoint and
 * commits it, and everything that scores a projection reads from there. What it
 * cannot be is quick. Measured over a Saturday, the scheduled job fired at
 * 11:36, 12:04, 13:15, 14:19, 15:11, 15:58, 16:50, 17:37, 18:15, 19:11, 19:47,
 * 20:39, 21:12 and 21:48 — gaps of thirty to seventy minutes against a cron
 * asking for fifteen. GitHub delays and drops scheduled runs under load; the
 * cron is a request, not a promise. Then a commit has to build and deploy,
 * which is another ninety seconds.
 *
 * So the file is half an hour behind during a gameweek, and no amount of
 * tuning the schedule fixes that. This reads the same endpoint from the
 * browser instead, through our own Worker, and gets there in about a second.
 *
 * IT IS A GARNISH, NEVER THE MEAL. Everything on the page renders from the
 * stored file first. If this returns nothing — no Worker configured, FPL down,
 * a network the reader is behind — the page is exactly what it was, one commit
 * behind, and says so. It must never be the reason a score is missing.
 */
import { useEffect, useRef, useState } from 'react'

/** Set at build time to our Cloudflare Worker. Empty until it is deployed, and
 *  empty means this whole file is inert — see `useLiveGw`. */
const OWN_PROXY = (import.meta.env.VITE_FPL_PROXY as string | undefined)?.replace(/\/$/, '')

/** True when live scores are available at all. The UI reads this to decide
 *  whether to offer a "live" badge or stay quiet, rather than showing a
 *  permanently broken indicator on a site whose Worker is not set up. */
export const liveAvailable = !!OWN_PROXY

export interface LivePlayer {
  element: number
  points: number
  minutes: number
  bonus: number
  /** Provisional bonus, computed from BPS while the match is in flight. FPL
   *  does not award bonus until a fixture ends, so during it `bonus` is 0 and
   *  this is the honest estimate — kept separate so nothing adds them twice. */
  bps: number
}

export interface LiveGw {
  gw: number
  players: Map<number, LivePlayer>
  fetchedAt: Date
}

/* One in-flight request per gameweek, shared by every component that asks.
   Two panels on the same page must not each open their own poll. */
const inflight = new Map<number, Promise<LiveGw | null>>()

async function fetchLive(gw: number, signal?: AbortSignal): Promise<LiveGw | null> {
  if (!OWN_PROXY) return null
  const res = await fetch(`${OWN_PROXY}/api/event/${gw}/live/`, { signal })
  if (!res.ok) throw new Error(`live ${res.status}`)
  const json = (await res.json()) as { elements?: { id: number; stats?: Record<string, number> }[] }
  const players = new Map<number, LivePlayer>()
  for (const el of json.elements ?? []) {
    const s = el.stats ?? {}
    players.set(el.id, {
      element: el.id,
      points: Number(s.total_points ?? 0),
      minutes: Number(s.minutes ?? 0),
      bonus: Number(s.bonus ?? 0),
      bps: Number(s.bps ?? 0),
    })
  }
  return { gw, players, fetchedAt: new Date() }
}

/** Live scores for `gw`, refreshed while the tab is in front of the reader.
 *
 *  `gw` null switches it off, which is what a page does out of season or on a
 *  gameweek nobody is playing. Polling stops when the tab is hidden — a phone
 *  in a pocket has no use for a score it cannot show, and it is the difference
 *  between one request a minute and one a minute for the rest of the day.
 */
export function useLiveGw(gw: number | null, everyMs = 60_000): {
  live: LiveGw | null
  error: boolean
  stale: boolean
} {
  const [live, setLive] = useState<LiveGw | null>(null)
  const [error, setError] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    if (!OWN_PROXY || gw == null) { setLive(null); return }
    let dead = false
    const ctl = new AbortController()

    const tick = async () => {
      if (document.hidden) return
      try {
        /* Share one request per gameweek across every caller on the page. */
        let p = inflight.get(gw)
        if (!p) {
          p = fetchLive(gw, ctl.signal).finally(() => inflight.delete(gw))
          inflight.set(gw, p)
        }
        const got = await p
        if (!dead && got) { setLive(got); setError(false) }
      } catch {
        /* A failed poll is not a failed page. Keep whatever was last read and
           let the caller fall back to the stored file. */
        if (!dead) setError(true)
      }
    }

    void tick()
    timer.current = window.setInterval(tick, everyMs)
    const onVis = () => { if (!document.hidden) void tick() }
    document.addEventListener('visibilitychange', onVis)

    return () => {
      dead = true
      ctl.abort()
      if (timer.current) window.clearInterval(timer.current)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [gw, everyMs])

  /* Older than three polls means something has been failing quietly for a
     while, and the page should stop calling it live. */
  const stale = !!live && Date.now() - live.fetchedAt.getTime() > everyMs * 3
  return { live, error, stale }
}

/** Provisional bonus from BPS, for a fixture still in progress.
 *
 *  FPL awards 3/2/1 to the top three BPS in each match and does not publish it
 *  until the whistle. Everyone else computes it in the meantime, and a review
 *  that shows a player on 9 when every other site shows 12 looks broken rather
 *  than careful — so it is computed here, and labelled provisional wherever it
 *  is drawn.
 *
 *  Pass it the BPS for ONE fixture. Bonus is awarded per match, so handing it
 *  a whole gameweek would rank the league against itself and give three points
 *  to whoever had the best afternoon anywhere.
 */
export function provisionalBonus(bpsByElement: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>()
  if (!bpsByElement.size) return out

  /* Group by BPS, best first. FPL awards by PLACE, not by rank, and a tie
     consumes the places it fills — which the obvious implementation gets
     wrong. Two players level on top both take 3 and the next man takes 1, not
     2, because second place has already been used up. Three level on top and
     nobody else scores a bonus point at all. */
  const byScore = new Map<number, number[]>()
  for (const [el, v] of bpsByElement) {
    const g = byScore.get(v)
    if (g) g.push(el); else byScore.set(v, [el])
  }
  const groups = [...byScore.entries()].sort((a, b) => b[0] - a[0])

  let place = 1
  for (const [, els] of groups) {
    if (place > 3) break
    const award = place === 1 ? 3 : place === 2 ? 2 : 1
    for (const el of els) out.set(el, award)
    place += els.length
  }
  return out
}
