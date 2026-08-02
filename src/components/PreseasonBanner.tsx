import { useState } from 'react'
import { Link } from 'react-router-dom'
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
          {/* The promoted clubs' gameweek 1 figures used to be called out here
              too. It is a caveat about eighty-odd players in a banner that
              every reader meets before anything else, and the data notes are
              one tap away and say it properly — this line is for what changes
              how the whole site reads, which is the carry-over. */}
          <b className="text-ink">Pre-season {info.label}.</b> Fixtures, squads and prices are live — player ratings are carried over from{' '}
          <b className="text-ink">{short(info.ratings_season)}</b> until games are played. New signings show N/A — see <Link to="/legal" className="underline decoration-dotted underline-offset-2 hover:text-ink">the data notes</Link>.
        </span>
        {/* Sized to WCAG 2.2 AA's 24px minimum — it was 17×18. */}
        <button onClick={dismiss} aria-label="Dismiss" className="ml-auto grid size-6 shrink-0 place-items-center text-lg leading-none text-ink-3 hover:text-ink">×</button>
      </div>
    </div>
  )
}
