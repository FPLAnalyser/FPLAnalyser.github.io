/* Your points, while they are still happening.
 *
 * Everything else on My Team reads the stored actuals, which are a commit
 * behind — half an hour of one, during a gameweek, because GitHub's scheduler
 * delays and drops runs under load. This reads the same FPL endpoint from the
 * browser through our own Worker and is a second behind instead.
 *
 * IT ADDS, IT NEVER REPLACES. Without a Worker configured, or with FPL down,
 * or on a network that blocks it, this renders nothing at all and the page is
 * exactly the page it was. The one thing it must not do is be the reason a
 * number is missing.
 */
import { useMemo } from 'react'
import { Icon } from './Icon'
import { useLiveGw, liveAvailable, provisionalBonus } from '../lib/live'

/* eslint-disable @typescript-eslint/no-explicit-any */
export function LiveStrip({ picksData, gw, finished }: {
  picksData: any
  /** The gameweek being played. Null switches the whole thing off. */
  gw: number | null
  /** FPL has closed the gameweek: bonus is final and there is nothing left to
   *  watch, so the strip stands down rather than claiming to be live. */
  finished?: boolean
}) {
  const watching = liveAvailable && !finished ? gw : null
  const { live, stale } = useLiveGw(watching)

  const sum = useMemo(() => {
    if (!live) return null
    const picks: any[] = picksData?.picks ?? []
    if (!picks.length) return null
    let total = 0, playing = 0, done = 0, toPlay = 0, provisional = 0
    for (const pick of picks) {
      const mult = Number(pick.multiplier ?? 0)
      const p = live.players.get(Number(pick.element))
      if (!p) { if (mult > 0) toPlay++; continue }
      if (mult > 0) {
        total += p.points * mult
        /* Bonus is not awarded until a fixture ends, so while one is in flight
           FPL's `bonus` is zero and the provisional figure has to be added
           separately — never on top of a bonus already given. */
        if (p.minutes > 0 && p.bonus === 0) provisional++
        if (p.minutes > 0) playing++
        else toPlay++
      }
      if (p.minutes > 0) done++
    }
    return { total, playing, toPlay, provisional, seen: done }
  }, [live, picksData])

  if (!live || !sum) return null

  const when = live.fetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-accent/40 bg-accent-soft px-3 py-2">
      <span className={`grid size-2 place-items-center rounded-full ${stale ? 'bg-ink-3' : 'bg-good'}`}
            aria-hidden="true" />
      <span className="text-[11px] font-extrabold tracking-[0.12em] text-accent uppercase">
        {stale ? 'Live · reconnecting' : `Live · GW${live.gw}`}
      </span>
      <span className="font-num text-[19px] font-extrabold tabular-nums text-ink">{sum.total}</span>
      <span className="text-[12.5px] text-ink-2">
        {sum.playing} of your eleven {sum.playing === 1 ? 'has' : 'have'} played
        {sum.toPlay > 0 && <>, {sum.toPlay} still to come</>}
      </span>
      {sum.provisional > 0 && (
        <span className="text-[11.5px] text-ink-3">· bonus provisional on {sum.provisional}</span>
      )}
      <span className="ml-auto flex items-center gap-1 text-[11px] text-ink-3">
        <Icon name="clock" size={11} /> {when}
      </span>
    </div>
  )
}

/* Re-exported so a caller can show provisional bonus per fixture without
   reaching past this file into lib/live. */
export { provisionalBonus }
