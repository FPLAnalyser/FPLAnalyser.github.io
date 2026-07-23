import { useState } from 'react'
import { Icon } from './Icon'
import { useSeason } from '../lib/season'

const short = (id?: string) => (id && id.length >= 7 ? `${id.slice(2, 4)}/${id.slice(5)}` : id ?? '')

/** Thin honesty strip shown while a season is provisional (pre-season): the
 *  ratings on show are carried over from last season until games are played. */
export function PreseasonBanner() {
  const { info } = useSeason()
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem('fpl_preseason_dismissed') === '1' } catch { return false }
  })
  if (!info?.provisional || dismissed) return null

  const dismiss = () => {
    try { sessionStorage.setItem('fpl_preseason_dismissed', '1') } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div className="border-b border-line bg-accent-soft">
      <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-3 py-2 text-[13px] text-ink-2 md:px-6">
        <span className="text-accent"><Icon name="info" size={15} /></span>
        <span>
          <b className="text-ink">Pre-season {info.label}.</b> Fixtures, squads and prices are live — player ratings are carried over from{' '}
          <b className="text-ink">{short(info.ratings_season)}</b> until games are played. New signings and promoted clubs show N/A for now.
        </span>
        <button onClick={dismiss} aria-label="Dismiss" className="ml-auto shrink-0 px-1 text-lg leading-none text-ink-3 hover:text-ink">×</button>
      </div>
    </div>
  )
}
