import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { useRatingsSwitch } from '../lib/tweaks'

/* ════════════════════════════════════════════════════════════════════════
   House or yours.

   ONE VALUE, so one control. A setting per page would let the Fixtures grid
   and the Squad Builder print different difficulties for the same game, which
   is the failure this whole feature is built to avoid — and a global state
   deserves a global home rather than a copy in every page's furniture.

   IT LIVES IN THE HEADER, on the same line as the nav, which is what the
   season selector was moved out of the way for. That row had no slack when
   this was first tried — the switch cost 208px, clipped My Team and pushed
   Review off the nav at 1440 — and retiring the season control returned 77px,
   which is what makes it fit now.

   It fits at 1440 and above. Below that the nav links scroll sideways, which
   they already did at 1280 before any of this: the row is `overflow-x-auto` by
   design, and a link that needs a swipe is a smaller cost than a control
   nobody can find.

   TWO SIZES, ONE VALUE. A phone gets the state as a single pill that flips on
   tap, because the full pair plus its label does not fit beside the brand at
   320. Both write the same switch.

   IT DRAWS NOTHING UNTIL A CLUB HAS BEEN RE-RATED, so a reader who has never
   opened Your ratings never meets it, and the header is exactly as it was.
   ════════════════════════════════════════════════════════════════════════ */

/** The House / Yours switch. Renders nothing until a club has been re-rated. */
export function RatingsSwitch({ className = '' }: { className?: string }) {
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
  /* NO DISPLAY UTILITY IN HERE. Written as `inline-flex ...` it fought the
     `hidden` on the wide variant and won, so at 320 both controls were in the
     header and the row ran 63px past the viewport — the second time that exact
     mistake has been made in this file. The display belongs to the variant. */
  const plate = 'shrink-0 items-center gap-0.5 rounded-full border border-line-mid bg-surface-2 p-0.5'
  const label = `${count} club${count === 1 ? '' : 's'} re-rated by you. House uses the site's own numbers; Yours uses yours, everywhere.`
  return (
    <>
      {/* PHONE: the state, tappable. The pair plus its label runs the header
          cluster past a 320px viewport, and the pill still answers "whose
          numbers am I looking at" at a glance. */}
      <span className={`${plate} inline-flex sm:hidden ${className}`} title={label}>
        <button
          onClick={() => setOn(!on)}
          aria-pressed={on}
          title={on ? 'Your ratings are on — tap for the house numbers' : "The site's own numbers — tap for yours"}
          className={`min-h-8 rounded-full px-2.5 text-[11.5px] font-bold transition-colors ${
            on ? 'bg-accent text-bg-0' : 'text-ink-3'
          }`}
        >
          {on ? 'Yours' : 'House'}
        </button>
        <Link
          to="/my-ratings"
          title="Edit your ratings"
          aria-label="Edit your ratings"
          className="inline-flex min-h-8 items-center px-1 text-ink-3 transition-colors hover:text-accent"
        >
          <Icon name="pencil" size={13} />
        </Link>
      </span>

      <span className={`${plate} hidden sm:inline-flex ${className}`} title={label}>
        {/* The word waits for a screen wide enough that it is not competing
            with the nav links for the same pixels. */}
        <span className="hidden px-1.5 text-[10px] font-bold tracking-[0.1em] text-ink-3 uppercase lg:inline">
          Ratings
        </span>
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
    </>
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
