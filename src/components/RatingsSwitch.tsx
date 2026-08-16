import { Link } from 'react-router-dom'
import { Icon } from './Icon'
import { useRatingsSwitch } from '../lib/tweaks'

/* ════════════════════════════════════════════════════════════════════════
   House or yours, on every page it changes.

   ONE VALUE, MANY CONTROLS. Each of these reads and writes the same switch, so
   the site is only ever in one state — a per-page setting would let the
   Fixtures grid and the Squad Builder print different difficulties for the
   same game, which is the failure this whole feature is built to avoid.

   IT ONLY EXISTS ONCE YOU HAVE RE-RATED SOMETHING. A switch between two
   identical states is furniture, and this site already asks a first-time
   reader to take in enough. With no club dialled, `Entry` draws a quiet link
   instead — the page is worth finding, the toggle is not worth explaining.
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
      className={`min-h-8 rounded-full px-2.5 text-[12px] font-semibold transition-colors ${
        on === mine ? 'bg-accent-soft text-accent' : 'text-ink-3 hover:text-ink-2'
      }`}
    >
      {label}
    </button>
  )
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full border border-line-mid p-0.5 ${className}`}>
      <span className="px-1.5 text-[10px] font-bold tracking-[0.1em] text-ink-3 uppercase">Ratings</span>
      {btn(false, 'House', "The site's own numbers")}
      {btn(true, 'Yours', `Your ratings — ${count} club${count === 1 ? '' : 's'} re-rated`)}
      <Link
        to="/my-ratings"
        title="Edit your ratings"
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
 * beside the grid that provokes it, not in a nav bar — and once a club has
 * been dialled this steps aside for the switch, because by then the question
 * is which numbers you are looking at rather than where to change them.
 */
export function RatingsEntry({ className = '' }: { className?: string }) {
  const { count } = useRatingsSwitch()
  /* Purely the way in. Once a club is re-rated the banner's switch takes over
     and this steps aside — drawn in both places it was simply the same control
     twice on one screen. */
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
