import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { useRatingsSwitch } from '../lib/tweaks'

/* ════════════════════════════════════════════════════════════════════════
   House or yours.

   ONE VALUE, so one control. A setting per page would let the Fixtures grid
   and the Squad Builder print different difficulties for the same game, which
   is the failure this whole feature is built to avoid — and a global state
   deserves a global home rather than a copy in every page's furniture.

   IT HAS ITS OWN LINE, ABOVE THE PAGE. Two other homes were tried and both
   were wrong, in ways worth not repeating:

     · in the section banner it sat on a photograph with nothing behind it, so
       the one control on the site that says "these numbers are not the site's"
       was the hardest thing on the page to see
     · in the header it cost 208px of a row with none to give — measured at
       1440 it clipped My Team and pushed Review off the nav altogether, and at
       320 it ran the page 27px past the viewport

   A line of its own is in the same place on every route, has room at every
   width, and needs no second compact variant to maintain.

   IT DRAWS NOTHING UNTIL A CLUB HAS BEEN RE-RATED, so the line costs a reader
   who has never opened Your ratings exactly nothing.
   ════════════════════════════════════════════════════════════════════════ */

/** The House / Yours switch. Renders nothing until a club has been re-rated. */
export function RatingsSwitch() {
  const { on, count, setOn } = useRatingsSwitch()
  if (!count) return null
  const btn = (mine: boolean, label: string, title: string) => (
    <button
      onClick={() => setOn(mine)}
      title={title}
      aria-pressed={on === mine}
      className={`min-h-8 rounded-full px-2 text-[11.5px] font-bold transition-colors sm:px-2.5 sm:text-[12px] ${
        on === mine ? 'bg-accent text-bg-0 shadow-sm' : 'text-ink-3 hover:text-ink-2'
      }`}
    >
      {label}
    </button>
  )
  return (
    <span
      /* The display utility lives entirely inside the branch. Written as
         `inline-flex ... ${compact ? '' : 'hidden sm:inline-flex'}` both
         displays were in play and the base one won, so the header control and
         the phone one drew at the same time on a 390px screen. */
      className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-line-mid bg-surface-2 p-0.5"
      title={`${count} club${count === 1 ? '' : 's'} re-rated by you. House uses the site's own numbers; Yours uses yours, everywhere.`}
    >
      <span className="px-1.5 text-[10px] font-bold tracking-[0.1em] text-ink-3 uppercase">Ratings</span>
      {btn(false, 'House', "The site's own numbers")}
      {btn(true, 'Yours', `Your ratings — ${count} club${count === 1 ? '' : 's'} re-rated`)}
      <Link
        to="/my-ratings"
        title="Edit your ratings"
        aria-label="Edit your ratings"
        className="inline-flex min-h-8 items-center px-1.5 text-ink-3 transition-colors hover:text-accent"
      >
        <Icon name="pencil" size={13} />
      </Link>
    </span>
  )
}

/**
 * How the page gets found in the first place.
 *
 * Nobody opens a ratings editor unprompted; they look at a row of green cells
 * against a club they rate and think *that is wrong*. So the way in belongs
 * beside the grid that provokes it, not in a nav bar. Once a club has been
 * dialled this steps aside — by then the question is which numbers you are
 * looking at, which the header answers on every page.
 */
export function RatingsEntry({ className = '' }: { className?: string }) {
  const { count } = useRatingsSwitch()
  if (count) return null
  return (
    <Link
      to="/my-ratings"
      title="Disagree with a club's rating? Change it, and every fixture against them changes with it."
      className={`inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line-mid px-2.5 text-[12px]
                  font-semibold text-ink-3 transition-colors hover:border-accent hover:text-accent ${className}`}
    >
      <Icon name="pencil" size={13} /> Your ratings
    </Link>
  )
}
